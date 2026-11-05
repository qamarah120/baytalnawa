import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx, getSetting, setSetting } from './lib/db.js';
import { hashPassword, verifyPassword, signToken, userFromToken } from './lib/auth.js';
import { reorderSuggestions, businessInsights, CATEGORIES } from './lib/analyst.js';
import { indicators, news, NEWS_CATEGORIES } from './lib/market.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const str = (v, max = 500) => (v == null ? null : String(v).slice(0, max).trim());
const today = () => new Date().toISOString().slice(0, 10);

export const effectivePrice = (p) =>
  p.offer_percent > 0 && (!p.offer_ends || p.offer_ends >= today()) ? Math.round(p.price * (1 - p.offer_percent / 100) * 100) / 100 : p.price;
const vatRate = () => num(getSetting('vat_rate', '15'), 15);
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- CRUD عام ----------
const ENTITIES = {
  products: { table: 'products', roles: ['admin', 'manager', 'sales'], write: ['admin', 'manager'], fields: {
    name: 'text', category: 'cat', unit: 'text', price: 'num', cost: 'num', stock: 'num', reorder_level: 'num', lead_days: 'int',
    supplier_id: 'id', description: 'text', image: 'text', offer_percent: 'pct', offer_ends: 'date', active: 'bool' }, req: ['name', 'category'] },
  customers: { table: 'customers', roles: ['admin', 'manager', 'sales', 'accountant'], write: ['admin', 'manager', 'sales'], fields: {
    name: 'text', phone: 'text', city: 'text', type: 'text', notes: 'text' }, req: ['name'] },
  employees: { table: 'employees', roles: ['admin', 'manager'], write: ['admin'], fields: {
    name: 'text', job: 'text', phone: 'text', salary: 'num', hired_at: 'date', active: 'bool' }, req: ['name'] },
  suppliers: { table: 'suppliers', roles: ['admin', 'manager', 'accountant'], write: ['admin', 'manager'], fields: {
    name: 'text', phone: 'text', country: 'text', notes: 'text' }, req: ['name'] },
};
function clean(ent, body, partial) {
  const out = {};
  for (const [k, t] of Object.entries(ent.fields)) {
    if (!(k in body)) { if (!partial && t === 'bool') out[k] = 1; continue; }
    let v = body[k];
    if (t === 'text') v = str(v);
    else if (t === 'cat') { v = str(v); if (!CATEGORIES.includes(v)) throw bad('فئة غير صحيحة'); }
    else if (t === 'num') { v = num(v); if (v < 0) throw bad(`قيمة سالبة: ${k}`); }
    else if (t === 'int') v = Math.max(0, Math.round(num(v)));
    else if (t === 'pct') { v = num(v); if (v < 0 || v > 90) throw bad('نسبة الخصم 0–90'); }
    else if (t === 'id') v = v ? Math.round(num(v)) : null;
    else if (t === 'bool') v = v ? 1 : 0;
    else if (t === 'date') { v = v ? str(v, 10) : null; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('تاريخ غير صحيح'); }
    out[k] = v;
  }
  if (!partial) for (const r of ent.req) if (!out[r]) throw bad(`الحقل مطلوب: ${r}`);
  return out;
}

// ---------- منطق الطلبات ----------
function buildItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('السلة فارغة');
  return items.map((it) => {
    const p = get('SELECT * FROM products WHERE id=? AND active=1', Math.round(num(it.product_id)));
    const qty = num(it.qty);
    if (!p) throw bad('منتج غير موجود');
    if (qty <= 0) throw bad('كمية غير صحيحة');
    return { p, qty, price: effectivePrice(p) };
  });
}
function createOrder({ items, customer_id = null, customer_name = null, customer_phone = null, discount = 0, status, channel, user_id = null, notes = null }) {
  const lines = buildItems(items);
  return tx(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
    const disc = Math.min(Math.max(num(discount), 0), subtotal);
    const total = round2(subtotal - disc);
    const vat = round2(total * vatRate() / (100 + vatRate())); // الأسعار شاملة الضريبة
    const r = run(`INSERT INTO orders(customer_id,customer_name,customer_phone,user_id,channel,status,subtotal,discount,vat,total,notes)
      VALUES(?,?,?,?,?,'pending',?,?,?,?,?)`, customer_id, customer_name, customer_phone, user_id, channel, subtotal, disc, vat, total, notes);
    const id = Number(r.lastInsertRowid);
    for (const l of lines) run('INSERT INTO order_items(order_id,product_id,name,qty,price,cost) VALUES(?,?,?,?,?,?)', id, l.p.id, l.p.name, l.qty, l.price, l.p.cost);
    if (status === 'completed') setOrderStatus(id, 'completed');
    return id;
  });
}
function setOrderStatus(id, status) {
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'الطلب غير موجود');
  if (o.status === status) return;
  if (!['pending', 'completed', 'cancelled'].includes(status)) throw bad('حالة غير صحيحة');
  tx(() => {
    const items = all('SELECT * FROM order_items WHERE order_id=?', id);
    if (status === 'completed' && o.status !== 'completed') {
      for (const i of items) {
        const p = get('SELECT stock,name FROM products WHERE id=?', i.product_id);
        if (p && p.stock < i.qty) throw bad(`المخزون غير كاف: ${p.name} (المتوفر ${p.stock})`);
      }
      for (const i of items) run('UPDATE products SET stock=stock-? WHERE id=?', i.qty, i.product_id);
    } else if (o.status === 'completed') {
      for (const i of items) run('UPDATE products SET stock=stock+? WHERE id=?', i.qty, i.product_id);
    }
    run('UPDATE orders SET status=? WHERE id=?', status, id);
  });
}
function createPO({ supplier_id, items, notes }) {
  if (!Array.isArray(items) || !items.length) throw bad('لا توجد أصناف');
  return tx(() => {
    const lines = items.map((it) => {
      const p = get('SELECT * FROM products WHERE id=?', Math.round(num(it.product_id)));
      if (!p) throw bad('منتج غير موجود');
      const qty = num(it.qty); if (qty <= 0) throw bad('كمية غير صحيحة');
      return { p, qty, cost: it.cost != null ? num(it.cost) : p.cost };
    });
    const total = round2(lines.reduce((s, l) => s + l.qty * l.cost, 0));
    const id = Number(run('INSERT INTO purchase_orders(supplier_id,total,notes) VALUES(?,?,?)', supplier_id || null, total, str(notes)).lastInsertRowid);
    for (const l of lines) run('INSERT INTO purchase_items(po_id,product_id,name,qty,cost) VALUES(?,?,?,?,?)', id, l.p.id, l.p.name, l.qty, l.cost);
    return id;
  });
}

// ---------- التقارير ----------
const ts = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
function totals(from, to) {
  const t = get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(vat),0) vat FROM orders WHERE status='completed' AND created_at >= ? AND created_at < ?`, from, to);
  const cogs = get(`SELECT COALESCE(SUM(oi.qty*oi.cost),0) c FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='completed' AND o.created_at >= ? AND o.created_at < ?`, from, to).c;
  const net = t.revenue - t.vat;
  return { orders: t.orders, revenue: round2(t.revenue), vat: round2(t.vat), net_revenue: round2(net), cogs: round2(cogs), gross_profit: round2(net - cogs),
    margin: net > 0 ? round2(((net - cogs) / net) * 100) : 0, avg_order: t.orders ? round2(t.revenue / t.orders) : 0 };
}
function summary(days, category) {
  const now = new Date(Date.now() + 60000), from = new Date(Date.now() - days * 86400000), prevFrom = new Date(from.getTime() - days * 86400000);
  const F = ts(from), T = ts(now);
  const cur = totals(F, T), prev = totals(ts(prevFrom), F);
  // سلسلة يومية كاملة (إيراد + ربح) مع ملء الأيام الفارغة
  const rev = Object.fromEntries(all(`SELECT date(created_at) d, SUM(total-vat) v FROM orders WHERE status='completed' AND created_at >= ? GROUP BY d`, F).map((r) => [r.d, r.v]));
  const cg = Object.fromEntries(all(`SELECT date(o.created_at) d, SUM(oi.qty*oi.cost) v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='completed' AND o.created_at >= ? GROUP BY d`, F).map((r) => [r.d, r.v]));
  const cnt = Object.fromEntries(all(`SELECT date(created_at) d, COUNT(*) n FROM orders WHERE status='completed' AND created_at >= ? GROUP BY d`, F).map((r) => [r.d, r.n]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ d, revenue: round2(rev[d] || 0), profit: round2((rev[d] || 0) - (cg[d] || 0)), orders: cnt[d] || 0 });
  }
  const cf = category ? ' AND p.category = ?' : '', cp = category ? [category] : [];
  return {
    days, category: category || null, ...cur, prev, daily,
    by_category: all(`SELECT p.category c, ROUND(SUM(oi.qty*oi.price),2) v, ROUND(SUM(oi.qty*(oi.price-oi.cost)),2) profit FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE o.status='completed' AND o.created_at >= ? GROUP BY p.category ORDER BY v DESC`, F),
    top_products: all(`SELECT oi.name, p.category, ROUND(SUM(oi.qty),2) qty, ROUND(SUM(oi.qty*oi.price),2) v, ROUND(SUM(oi.qty*(oi.price-oi.cost)),2) profit FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE o.status='completed' AND o.created_at >= ?${cf} GROUP BY oi.product_id ORDER BY v DESC LIMIT 10`, F, ...cp),
    top_customers: all(`SELECT COALESCE(c.name,o.customer_name,'عميل نقدي') name, COUNT(*) orders, ROUND(SUM(o.total),2) v FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='completed' AND o.created_at >= ? GROUP BY COALESCE(o.customer_id, o.customer_name) ORDER BY v DESC LIMIT 5`, F),
    by_channel: all(`SELECT channel c, COUNT(*) n, ROUND(SUM(total),2) v FROM orders WHERE status='completed' AND created_at >= ? GROUP BY channel`, F),
    by_weekday: all(`SELECT CAST(strftime('%w',created_at) AS INT) w, ROUND(SUM(total),2) v FROM orders WHERE status='completed' AND created_at >= ? GROUP BY w`, F),
    pending_orders: get("SELECT COUNT(*) n FROM orders WHERE status='pending'").n,
    low_stock: get('SELECT COUNT(*) n FROM products WHERE active=1 AND stock <= reorder_level').n,
    low_stock_items: all('SELECT name, stock, unit, reorder_level FROM products WHERE active=1 AND stock <= reorder_level ORDER BY stock/(reorder_level+0.001) LIMIT 6'),
    inventory_value: round2(get('SELECT COALESCE(SUM(stock*cost),0) v FROM products').v),
    inventory_by_category: all('SELECT category c, ROUND(SUM(stock*cost),2) v FROM products GROUP BY category ORDER BY v DESC'),
    customers: get('SELECT COUNT(*) n FROM customers').n,
    products: get('SELECT COUNT(*) n FROM products WHERE active=1').n,
    payroll: round2(get('SELECT COALESCE(SUM(salary),0) s FROM employees WHERE active=1').s),
  };
}

// ---------- الراوتر ----------
const routes = [];
const route = (method, pattern, roles, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), roles, handler });
const ALL = ['admin', 'manager', 'sales', 'accountant'];
const MGR = ['admin', 'manager'];

// عام (المتجر)
route('GET', '/api/store/info', null, () => ({ name: getSetting('store_name', 'بيت النوى'), whatsapp: getSetting('whatsapp', ''), categories: CATEGORIES }));
route('GET', '/api/store/products', null, () => all('SELECT * FROM products WHERE active=1 ORDER BY category,name').map((p) => ({
  id: p.id, name: p.name, category: p.category, unit: p.unit, description: p.description, image: p.image,
  price: p.price, final_price: effectivePrice(p), offer_percent: effectivePrice(p) < p.price ? p.offer_percent : 0,
  offer_ends: effectivePrice(p) < p.price ? p.offer_ends : null, in_stock: p.stock > 0 })));
const rate = new Map();
route('POST', '/api/store/order', null, ({ body, ip }) => {
  const now = Date.now(); const hits = (rate.get(ip) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= 10) throw new HttpError(429, 'طلبات كثيرة، حاول لاحقاً');
  rate.set(ip, [...hits, now]);
  const name = str(body.name, 100), phone = str(body.phone, 20);
  if (!name || !phone || !/^[0-9+\s-]{7,20}$/.test(phone)) throw bad('الاسم ورقم جوال صحيح مطلوبان');
  let cust = get('SELECT id FROM customers WHERE phone=?', phone);
  if (!cust) cust = { id: Number(run('INSERT INTO customers(name,phone,city) VALUES(?,?,?)', name, phone, str(body.city, 60)).lastInsertRowid) };
  const id = createOrder({ items: body.items, customer_id: cust.id, customer_name: name, customer_phone: phone, status: 'pending', channel: 'store', notes: str(body.notes) });
  return { id, message: 'تم استلام طلبك وسنتواصل معك قريباً' };
});

// المصادقة
const attempts = new Map();
route('POST', '/api/login', null, ({ body, ip }) => {
  const now = Date.now(); const a = (attempts.get(ip) || []).filter((t) => now - t < 600e3);
  if (a.length >= 8) throw new HttpError(429, 'محاولات كثيرة، انتظر 10 دقائق');
  const u = get('SELECT * FROM users WHERE username=? AND active=1', str(body.username, 50) || '');
  if (!u || !verifyPassword(String(body.password || ''), u.pass_hash)) { attempts.set(ip, [...a, now]); throw new HttpError(401, 'بيانات الدخول غير صحيحة'); }
  return { token: signToken(u), user: { id: u.id, name: u.name, role: u.role } };
});
route('GET', '/api/me', ALL, ({ user }) => user);
route('POST', '/api/me/password', ALL, ({ user, body }) => {
  const u = get('SELECT * FROM users WHERE id=?', user.id);
  if (!verifyPassword(String(body.old || ''), u.pass_hash)) throw bad('كلمة المرور الحالية خاطئة');
  if (String(body.new || '').length < 8) throw bad('كلمة المرور 8 أحرف على الأقل');
  run('UPDATE users SET pass_hash=? WHERE id=?', hashPassword(body.new), user.id);
  return { ok: true };
});

// CRUD
for (const [name, ent] of Object.entries(ENTITIES)) {
  route('GET', `/api/${name}`, ent.roles, () => all(`SELECT * FROM ${ent.table} ORDER BY id DESC`));
  route('POST', `/api/${name}`, ent.write, ({ body }) => {
    const d = clean(ent, body, false); const k = Object.keys(d);
    return { id: Number(run(`INSERT INTO ${ent.table}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`, ...k.map((x) => d[x])).lastInsertRowid) };
  });
  route('PUT', `/api/${name}/:id`, ent.write, ({ body, params }) => {
    const d = clean(ent, body, true); const k = Object.keys(d);
    if (!k.length) throw bad('لا توجد بيانات');
    run(`UPDATE ${ent.table} SET ${k.map((x) => x + '=?').join(',')} WHERE id=?`, ...k.map((x) => d[x]), params.id);
    return { ok: true };
  });
  route('DELETE', `/api/${name}/:id`, ent.write, ({ params }) => {
    try { run(`DELETE FROM ${ent.table} WHERE id=?`, params.id); } catch { throw bad('لا يمكن الحذف: السجل مرتبط ببيانات أخرى'); }
    return { ok: true };
  });
}

// المستخدمون (للمدير فقط)
const ROLES = ['admin', 'manager', 'sales', 'accountant'];
route('GET', '/api/users', ['admin'], () => all('SELECT id,name,username,role,active FROM users ORDER BY id'));
route('POST', '/api/users', ['admin'], ({ body }) => {
  const username = str(body.username, 50), name = str(body.name, 100);
  if (!username || !name || String(body.password || '').length < 8) throw bad('الاسم واسم المستخدم وكلمة مرور (8+) مطلوبة');
  if (!ROLES.includes(body.role)) throw bad('دور غير صحيح');
  if (get('SELECT 1 FROM users WHERE username=?', username)) throw bad('اسم المستخدم مستخدم');
  return { id: Number(run('INSERT INTO users(name,username,pass_hash,role) VALUES(?,?,?,?)', name, username, hashPassword(body.password), body.role).lastInsertRowid) };
});
route('PUT', '/api/users/:id', ['admin'], ({ body, params, user }) => {
  const id = Number(params.id);
  if (id === user.id && (body.active === false || (body.role && body.role !== 'admin'))) throw bad('لا يمكنك تعطيل حسابك أو تغيير دورك');
  if (body.role && !ROLES.includes(body.role)) throw bad('دور غير صحيح');
  if (body.role) run('UPDATE users SET role=? WHERE id=?', body.role, id);
  if (body.name) run('UPDATE users SET name=? WHERE id=?', str(body.name, 100), id);
  if ('active' in body) run('UPDATE users SET active=? WHERE id=?', body.active ? 1 : 0, id);
  if (body.password) { if (String(body.password).length < 8) throw bad('كلمة المرور 8+'); run('UPDATE users SET pass_hash=? WHERE id=?', hashPassword(body.password), id); }
  return { ok: true };
});

// الطلبات
route('GET', '/api/orders', ['admin', 'manager', 'sales', 'accountant'], () => all(`SELECT o.*, COALESCE(c.name,o.customer_name) cname,
  (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) items FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 300`));
route('GET', '/api/orders/:id', ['admin', 'manager', 'sales', 'accountant'], ({ params }) => {
  const o = get('SELECT * FROM orders WHERE id=?', params.id);
  if (!o) throw new HttpError(404, 'غير موجود');
  return { ...o, items: all('SELECT * FROM order_items WHERE order_id=?', o.id) };
});
route('POST', '/api/orders', ['admin', 'manager', 'sales'], ({ body, user }) =>
  ({ id: createOrder({ items: body.items, customer_id: body.customer_id || null, discount: body.discount, status: body.status === 'pending' ? 'pending' : 'completed', channel: 'pos', user_id: user.id, notes: str(body.notes) }) }));
route('POST', '/api/orders/:id/status', ['admin', 'manager', 'sales'], ({ params, body }) => { setOrderStatus(Number(params.id), body.status); return { ok: true }; });

// المشتريات
route('GET', '/api/purchases', ['admin', 'manager', 'accountant'], () => all(`SELECT po.*, s.name supplier,
  (SELECT COUNT(*) FROM purchase_items WHERE po_id=po.id) items FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id ORDER BY po.id DESC`));
route('GET', '/api/purchases/:id', ['admin', 'manager', 'accountant'], ({ params }) => {
  const po = get('SELECT * FROM purchase_orders WHERE id=?', params.id);
  if (!po) throw new HttpError(404, 'غير موجود');
  return { ...po, items: all('SELECT * FROM purchase_items WHERE po_id=?', po.id) };
});
route('POST', '/api/purchases', MGR, ({ body }) => ({ id: createPO(body) }));
route('POST', '/api/purchases/:id/status', MGR, ({ params, body }) => {
  const po = get('SELECT * FROM purchase_orders WHERE id=?', params.id);
  if (!po) throw new HttpError(404, 'غير موجود');
  const allowed = { draft: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'] };
  if (!allowed[po.status]?.includes(body.status)) throw bad('انتقال حالة غير مسموح');
  tx(() => {
    if (body.status === 'received') for (const i of all('SELECT * FROM purchase_items WHERE po_id=?', po.id)) {
      // تحديث التكلفة بمتوسط مرجح
      const p = get('SELECT stock,cost FROM products WHERE id=?', i.product_id);
      if (!p) continue;
      const newStock = p.stock + i.qty;
      const avg = newStock > 0 ? (Math.max(p.stock, 0) * p.cost + i.qty * i.cost) / (Math.max(p.stock, 0) + i.qty) : i.cost;
      run('UPDATE products SET stock=?, cost=? WHERE id=?', newStock, round2(avg), i.product_id);
    }
    run('UPDATE purchase_orders SET status=? WHERE id=?', body.status, po.id);
  });
  return { ok: true };
});

// التقارير والمحلل
route('GET', '/api/reports/summary', ['admin', 'manager', 'accountant'], ({ query }) => summary(Math.min(Math.max(Math.round(num(query.get('days') || 30, 30)), 1), 365), CATEGORIES.includes(query.get('category')) ? query.get('category') : null));
route('GET', '/api/analyst/reorder', MGR.concat('accountant'), () => ({ suggestions: reorderSuggestions(), insights: businessInsights() }));
route('POST', '/api/analyst/create-po', MGR, ({ body }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  const groups = new Map();
  for (const it of items) {
    const p = get('SELECT supplier_id FROM products WHERE id=?', Math.round(num(it.product_id)));
    if (!p) continue;
    const k = p.supplier_id || 0; groups.set(k, [...(groups.get(k) || []), it]);
  }
  if (!groups.size) throw bad('اختر أصنافاً');
  return { ids: [...groups].map(([sid, its]) => createPO({ supplier_id: sid || null, items: its, notes: 'أنشئ من المحلل' })) };
});
route('GET', '/api/market/indicators', MGR.concat('accountant'), async () => indicators().catch(() => ({ items: [], insights: [], error: 'تعذر جلب المؤشرات (تحقق من الاتصال بالإنترنت)' })));
route('GET', '/api/market/news', MGR.concat('accountant'), async ({ query }) => {
  const cat = query.get('cat') || 'saudi';
  const items = await news(cat).catch(() => null);
  return { categories: NEWS_CATEGORIES, items: items || [], error: items ? null : 'تعذر جلب الأخبار (تحقق من الاتصال بالإنترنت)' };
});

// الإعدادات
route('GET', '/api/settings', ['admin'], () => ({ store_name: getSetting('store_name', 'بيت النوى'), whatsapp: getSetting('whatsapp', ''), vat_rate: getSetting('vat_rate', '15') }));
route('PUT', '/api/settings', ['admin'], ({ body }) => {
  if ('store_name' in body) setSetting('store_name', str(body.store_name, 80));
  if ('whatsapp' in body) setSetting('whatsapp', String(body.whatsapp || '').replace(/[^0-9]/g, '').slice(0, 15));
  if ('vat_rate' in body) { const v = num(body.vat_rate, -1); if (v < 0 || v > 50) throw bad('نسبة ضريبة غير صحيحة'); setSetting('vat_rate', v); }
  return { ok: true };
});

// ---------- الخادم ----------
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'" };
const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC, ...headers }); res.end(body); };
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw new HttpError(413, 'حجم الطلب كبير'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('JSON غير صحيح'); }
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const r = routes.map((x) => ({ x, m: x.method === req.method && url.pathname.match(x.re) })).find((o) => o.m);
      if (!r) throw new HttpError(404, 'مسار غير موجود');
      let user = null;
      if (r.x.roles) {
        user = userFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
        if (!user) throw new HttpError(401, 'يجب تسجيل الدخول');
        if (!r.x.roles.includes(user.role)) throw new HttpError(403, 'لا تملك صلاحية');
      }
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const out = await r.x.handler({ body, params: r.m.groups || {}, query: url.searchParams, user, ip: req.socket.remoteAddress });
      return sendJson(res, 200, out);
    }
    // ملفات ثابتة
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html'; else if (p === '/admin') p = '/admin.html';
    const file = path.join(PUB, path.normalize(p));
    if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'غير موجود', { 'content-type': 'text/plain; charset=utf-8' });
    send(res, 200, fs.readFileSync(file), { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    sendJson(res, status, { error: status === 500 ? 'خطأ داخلي' : e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ensureAdmin } = await import('./lib/bootstrap.js');
  ensureAdmin();
  server.listen(PORT, () => console.log(`بيت النوى يعمل على http://localhost:${PORT}  (لوحة التحكم: /admin)`));
}
