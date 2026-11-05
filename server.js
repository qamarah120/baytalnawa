import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, tx, getSetting, setSetting } from './lib/db.js';
import { hashPassword, verifyPassword, signToken, userFromToken } from './lib/auth.js';
import { reorderSuggestions, businessInsights, CATEGORIES } from './lib/analyst.js';
import { indicators, news, NEWS_CATEGORIES, OFFICIAL } from './lib/market.js';

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
    name: 'text', sku: 'text', category: 'cat', unit: 'text', price: 'num', cost: 'num', stock: 'num', reorder_level: 'num', lead_days: 'int',
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

// ---------- تسجيل المبيعات (متابعة فقط، بلا فواتير) ----------
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).trim();
function parseDate(v) {
  const s = latin(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) { const k = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (k) m = [k[0], k[3], k[2], k[1]]; }
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const iso = dt.toISOString().slice(0, 10);
  if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10) || y < new Date().getFullYear() - 5) return null;
  return iso;
}
const parseNum = (v) => { let s = latin(v).replace(/٫/g, '.').replace(/\s/g, ''); if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const sqlTime = (date) => (date === today() ? new Date().toISOString().slice(0, 19).replace('T', ' ') : `${date} 12:00:00`);

function productFinder() {
  const all0 = all('SELECT * FROM products');
  const bySku = new Map(all0.filter((p) => p.sku).map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(all0.map((p) => [p.name.trim(), p]));
  return (key) => { const k = latin(key); return bySku.get(k.toLowerCase()) || byName.get(String(key ?? '').trim()) || null; };
}

// groups: [{ref, date, customer_id, customer_name, discount, notes, items:[{product, qty, price|null}]}]
function recordSales(groups, { updateStock, channel, userId = null }) {
  const out = { created: 0, skipped: 0, ids: [] };
  tx(() => {
    for (const g of groups) {
      if (g.ref && get('SELECT 1 FROM orders WHERE external_ref=?', g.ref)) { out.skipped++; continue; }
      let subtotal = 0;
      const lines = g.items.map((it) => { const price = it.price ?? effectivePrice(it.product); subtotal += price * it.qty; return { ...it, price }; });
      subtotal = round2(subtotal);
      const disc = Math.min(Math.max(num(g.discount), 0), subtotal), total = round2(subtotal - disc);
      const vat = round2(total * vatRate() / (100 + vatRate()));
      const id = Number(run(`INSERT INTO orders(customer_id,customer_name,user_id,channel,status,subtotal,discount,vat,total,notes,created_at,external_ref,stock_applied)
        VALUES(?,?,?,?,'completed',?,?,?,?,?,?,?,?)`, g.customer_id || null, g.customer_name || null, userId, channel, subtotal, disc, vat, total, g.notes || null, sqlTime(g.date), g.ref || null, updateStock ? 1 : 0).lastInsertRowid);
      for (const l of lines) {
        run('INSERT INTO order_items(order_id,product_id,name,qty,price,cost) VALUES(?,?,?,?,?,?)', id, l.product.id, l.product.name, l.qty, l.price, l.product.cost);
        if (updateStock) run('UPDATE products SET stock=MAX(stock-?,0) WHERE id=?', l.qty, l.product.id);
      }
      out.created++; out.ids.push(id);
    }
  });
  return out;
}
function deleteSale(id) {
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'السجل غير موجود');
  tx(() => {
    if (o.stock_applied) for (const i of all('SELECT * FROM order_items WHERE order_id=?', id)) run('UPDATE products SET stock=stock+? WHERE id=?', i.qty, i.product_id);
    run('DELETE FROM orders WHERE id=?', id);
  });
}

// قراءة CSV/TSV (من Excel: حفظ باسم CSV أو نسخ الخلايا ولصقها)
function parseTable(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = ['\t', ';', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const HEAD = {
  date: ['التاريخ', 'date'], product: ['المنتج', 'الصنف', 'product', 'sku', 'item', 'الرمز', 'الباركود', 'اسم المنتج'],
  qty: ['الكمية', 'qty', 'quantity'], price: ['السعر', 'price', 'سعر الوحدة', 'unit price', 'unit_price'],
  ref: ['رقم العملية', 'رقم الفاتورة', 'ref', 'invoice', 'reference', 'id'], customer: ['العميل', 'customer'],
};
function importGroups(text) {
  const rows = parseTable(text); const errors = [];
  if (rows.length < 2) throw bad('الملف فارغ أو لا يحتوي صفوف بيانات');
  const head = rows[0].map((h) => h.trim().toLowerCase()); const col = {};
  for (const [k, names] of Object.entries(HEAD)) col[k] = head.findIndex((h) => names.includes(h));
  for (const k of ['date', 'product', 'qty']) if (col[k] < 0) throw bad(`العمود مفقود: ${HEAD[k][0]} (الأعمدة المطلوبة: التاريخ، المنتج، الكمية. اختياري: السعر، رقم العملية، العميل)`);
  const find = productFinder(); const groups = new Map(); const occ = new Map(); let n = 0;
  rows.slice(1, 5001).forEach((r, idx) => {
    const line = idx + 2; const fail = (m) => errors.push({ line, error: m });
    const date = parseDate(r[col.date]), qty = parseNum(r[col.qty]), price = col.price >= 0 && String(r[col.price] ?? '').trim() !== '' ? parseNum(r[col.price]) : null;
    const p = find(r[col.product]);
    if (!date) return fail('تاريخ غير صحيح');
    if (!p) return fail(`منتج غير معروف: ${String(r[col.product] ?? '').trim()}`);
    if (qty == null || qty <= 0) return fail('كمية غير صحيحة');
    if (col.price >= 0 && String(r[col.price] ?? '').trim() !== '' && (price == null || price < 0)) return fail('سعر غير صحيح');
    const refRaw = col.ref >= 0 ? String(r[col.ref] ?? '').trim() : '';
    let ref;
    if (refRaw) ref = 'ext:' + refRaw.slice(0, 80);
    else { const base = `row:${date}|${p.id}|${qty}|${price ?? ''}`; const c = (occ.get(base) || 0) + 1; occ.set(base, c); ref = `${base}#${c}`; }
    const g = groups.get(ref) || { ref, date, customer_name: col.customer >= 0 ? str(r[col.customer], 100) : null, items: [] };
    g.items.push({ product: p, qty, price }); groups.set(ref, g); n++;
  });
  return { groups: [...groups.values()], errors, valid_rows: n, total_rows: Math.min(rows.length - 1, 5000) };
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
    active_offers: get("SELECT COUNT(*) n FROM products WHERE active=1 AND offer_percent>0 AND (offer_ends IS NULL OR offer_ends >= date('now'))").n,
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

// صفحة الهبوط (عامة): بيانات التواصل فقط
route('GET', '/api/landing', null, () => ({ name: getSetting('store_name', 'بيت النوى'), whatsapp: getSetting('whatsapp', ''), phone: getSetting('phone', ''), city: getSetting('city', '') }));

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

// سجل المبيعات والتسجيل والاستيراد
const SALES_R = ['admin', 'manager', 'sales'];
route('GET', '/api/orders', ['admin', 'manager', 'sales', 'accountant'], () => all(`SELECT o.*, COALESCE(c.name,o.customer_name) cname,
  (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) items FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='completed' ORDER BY o.created_at DESC, o.id DESC LIMIT 500`));
route('GET', '/api/orders/:id', ['admin', 'manager', 'sales', 'accountant'], ({ params }) => {
  const o = get('SELECT * FROM orders WHERE id=?', params.id);
  if (!o) throw new HttpError(404, 'غير موجود');
  return { ...o, items: all('SELECT * FROM order_items WHERE order_id=?', o.id) };
});
route('DELETE', '/api/orders/:id', MGR, ({ params }) => { deleteSale(Number(params.id)); return { ok: true }; });
route('POST', '/api/sales', SALES_R, ({ body, user }) => {
  const date = body.date ? parseDate(body.date) : today();
  if (!date) throw bad('تاريخ غير صحيح');
  if (!Array.isArray(body.items) || !body.items.length) throw bad('أضف صنفاً واحداً على الأقل');
  const items = body.items.map((it) => {
    const product = get('SELECT * FROM products WHERE id=?', Math.round(num(it.product_id)));
    const qty = num(it.qty); const price = it.price === '' || it.price == null ? null : num(it.price, -1);
    if (!product) throw bad('منتج غير موجود');
    if (qty <= 0) throw bad(`كمية غير صحيحة: ${product.name}`);
    if (price !== null && price < 0) throw bad(`سعر غير صحيح: ${product.name}`);
    return { product, qty, price };
  });
  const cust = body.customer_id ? get('SELECT id FROM customers WHERE id=?', Math.round(num(body.customer_id))) : null;
  const r = recordSales([{ date, customer_id: cust?.id, discount: body.discount, notes: str(body.notes), items }], { updateStock: true, channel: 'manual', userId: user.id });
  return { id: r.ids[0] };
});
route('POST', '/api/sales/import', SALES_R, ({ body, user }) => {
  const parsed = importGroups(body.text);
  const base = { total_rows: parsed.total_rows, valid_rows: parsed.valid_rows, orders: parsed.groups.length, errors: parsed.errors.slice(0, 50), error_count: parsed.errors.length };
  if (body.dry_run) return { ...base, dry_run: true };
  const r = recordSales(parsed.groups, { updateStock: !!body.update_stock, channel: 'import', userId: user.id });
  return { ...base, created: r.created, skipped: r.skipped };
});

// عروض عامة (للصفحة العامة): العروض السارية فقط
route('GET', '/api/offers', null, () => ({
  whatsapp: getSetting('whatsapp', ''), name: getSetting('store_name', 'بيت النوى'),
  offers: all('SELECT * FROM products WHERE active=1 AND offer_percent>0 AND stock>0 ORDER BY offer_percent DESC, name').filter((p) => effectivePrice(p) < p.price).map((p) => ({
    id: p.id, name: p.name, category: p.category, unit: p.unit, description: p.description, price: p.price, final_price: effectivePrice(p), percent: p.offer_percent, ends: p.offer_ends })),
}));

// الربط مع برنامج المبيعات عبر مفتاح API
const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
function checkApiKey(headers, ip) {
  const now = Date.now(); const a = (attempts.get('k' + ip) || []).filter((t) => now - t < 600e3);
  if (a.length >= 20) throw new HttpError(429, 'محاولات كثيرة');
  const stored = getSetting('api_key_hash'); const given = String(headers['x-api-key'] || '');
  const ok = stored && given && crypto.timingSafeEqual(Buffer.from(keyHash(given)), Buffer.from(stored));
  if (!ok) { attempts.set('k' + ip, [...a, now]); throw new HttpError(401, 'مفتاح الربط غير صحيح'); }
}
route('GET', '/api/integration/status', ['admin'], () => ({ enabled: !!getSetting('api_key_hash') }));
route('POST', '/api/integration/key', ['admin'], () => {
  const key = 'bn_' + crypto.randomBytes(24).toString('base64url'); setSetting('api_key_hash', keyHash(key)); return { key };
});
route('DELETE', '/api/integration/key', ['admin'], () => { run("DELETE FROM settings WHERE key='api_key_hash'"); return { ok: true }; });
route('POST', '/api/integration/sales', null, ({ body, headers, ip }) => {
  checkApiKey(headers, ip);
  const sales = Array.isArray(body.sales) ? body.sales.slice(0, 1000) : null;
  if (!sales) throw bad('الحقل sales مطلوب (مصفوفة)');
  const find = productFinder(); const groups = [], errors = [];
  sales.forEach((s, i) => {
    const date = s.date ? parseDate(s.date) : today();
    if (!date) return errors.push({ index: i, error: 'تاريخ غير صحيح' });
    const items = [];
    for (const it of Array.isArray(s.items) ? s.items : []) {
      const product = find(it.sku ?? it.product), qty = num(it.qty, 0), price = it.price == null || it.price === '' ? null : num(it.price, -1);
      if (!product) { errors.push({ index: i, error: `منتج غير معروف: ${it.sku ?? it.product}` }); continue; }
      if (qty <= 0 || (price !== null && price < 0)) { errors.push({ index: i, error: 'كمية أو سعر غير صحيح' }); continue; }
      items.push({ product, qty, price });
    }
    if (items.length) groups.push({ ref: s.ref ? 'ext:' + String(s.ref).slice(0, 80) : null, date, customer_name: str(s.customer, 100), items });
  });
  const r = recordSales(groups, { updateStock: body.update_stock === true, channel: 'api' });
  return { created: r.created, skipped_duplicates: r.skipped, errors };
});
route('POST', '/api/integration/stock', null, ({ body, headers, ip }) => {
  checkApiKey(headers, ip);
  const find = productFinder(); const errors = []; let updated = 0;
  tx(() => (Array.isArray(body.items) ? body.items.slice(0, 2000) : []).forEach((it, i) => {
    const p = find(it.sku ?? it.product), stock = num(it.stock, -1);
    if (!p || stock < 0) return errors.push({ index: i, error: !p ? `منتج غير معروف: ${it.sku ?? it.product}` : 'مخزون غير صحيح' });
    run('UPDATE products SET stock=? WHERE id=?', stock, p.id); updated++;
  }));
  return { updated, errors };
});

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
route('GET', '/api/analyst/product/:id', MGR.concat('accountant'), ({ params }) => {
  const p = get('SELECT id,name,unit,stock FROM products WHERE id=?', params.id);
  if (!p) throw new HttpError(404, 'غير موجود');
  const rows = Object.fromEntries(all(`SELECT date(o.created_at) d, SUM(oi.qty) q FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status='completed' AND oi.product_id=? AND o.created_at >= datetime('now','-60 days') GROUP BY d`, p.id).map((r) => [r.d, r.q]));
  const daily = [];
  for (let i = 59; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); daily.push({ d, q: rows[d] || 0 }); }
  const sug = reorderSuggestions().find((x) => x.product_id === p.id) || null;
  return { product: p, daily, suggestion: sug };
});
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
  return { categories: NEWS_CATEGORIES, sources: OFFICIAL[cat] || OFFICIAL.saudi, items: items || [], error: items ? null : 'تعذر جلب الأخبار (تحقق من الاتصال بالإنترنت)' };
});

// الإعدادات
route('GET', '/api/settings', ['admin'], () => ({ store_name: getSetting('store_name', 'بيت النوى'), whatsapp: getSetting('whatsapp', ''), phone: getSetting('phone', ''), city: getSetting('city', ''), vat_rate: getSetting('vat_rate', '15') }));
route('PUT', '/api/settings', ['admin'], ({ body }) => {
  if ('store_name' in body) setSetting('store_name', str(body.store_name, 80));
  if ('whatsapp' in body) setSetting('whatsapp', String(body.whatsapp || '').replace(/[^0-9]/g, '').slice(0, 15));
  if ('phone' in body) setSetting('phone', String(body.phone || '').replace(/[^0-9+]/g, '').slice(0, 16));
  if ('city' in body) setSetting('city', str(body.city, 60) || '');
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
      const out = await r.x.handler({ body, params: r.m.groups || {}, query: url.searchParams, user, ip: req.socket.remoteAddress, headers: req.headers });
      return sendJson(res, 200, out);
    }
    // ملفات ثابتة
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html'; else if (p === '/admin') p = '/admin.html'; else if (p === '/offers') p = '/offers.html';
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
