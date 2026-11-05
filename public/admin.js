const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });
const CATS = ['مكسرات', 'حلويات', 'بهارات', 'أعشاب', 'قهوة', 'تمور', 'سمن', 'عسل'];
const STATUS = { pending: 'قيد الانتظار', completed: 'مكتمل', cancelled: 'ملغي', draft: 'مسودة', ordered: 'تم الطلب', received: 'تم الاستلام', critical: 'عاجل', soon: 'قريباً', ok: 'جيد' };
const ROLE = { admin: 'مدير النظام', manager: 'مدير', sales: 'مبيعات', accountant: 'محاسب' };
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
let token = sessionStorage.getItem('t'), me = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); }
  if (!r.ok) throw new Error(d.error || 'خطأ');
  return d;
}
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 3000); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
function logout() { sessionStorage.removeItem('t'); token = null; me = null; showLogin(); }

// ---------- نافذة نموذج ----------
function formModal(title, fields, vals, onSave) {
  const h = fields.map((f) => {
    const v = vals[f.k] ?? '';
    let inp;
    if (f.t === 'select') inp = `<select name="${f.k}">${f.opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    else if (f.t === 'checkbox') inp = `<input type="checkbox" name="${f.k}" ${v === '' || v ? 'checked' : ''} style="width:auto">`;
    else if (f.t === 'textarea') inp = `<textarea name="${f.k}" rows="3">${esc(v)}</textarea>`;
    else inp = `<input name="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any" min="0"' : ''} value="${esc(v)}" ${f.req ? 'required' : ''}>`;
    return `<label>${esc(f.l)}</label>${inp}`;
  }).join('');
  $('#modal').innerHTML = `<div class="modal-bg"><form class="modal"><h3>${esc(title)}</h3>${h}<p style="margin-top:1rem"><button class="btn">حفظ</button> <button type="button" class="btn ghost" id="mc">إلغاء</button></p></form></div>`;
  $('#mc').onclick = closeModal;
  $('#modal form').onsubmit = guard(async (e) => {
    e.preventDefault();
    const o = {};
    for (const f of fields) { const el = e.target.elements[f.k]; o[f.k] = f.t === 'checkbox' ? el.checked : el.value; }
    await onSave(o); closeModal();
  });
}
const closeModal = () => ($('#modal').innerHTML = '');
function table(cols, rows, actions) {
  return `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c.l)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${c.html ? c.html(r) : esc(c.f ? c.f(r) : r[c.k])}</td>`).join('')}${actions ? `<td>${actions(r)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${cols.length + 1}">لا توجد بيانات</td></tr>`}</tbody></table></div>`;
}

// ---------- الصفحات ----------
const pages = {};
let cache = {};
const getList = async (e) => (cache[e] = await api('/' + e));

function crud(key, title, cols, fieldsFn, can) {
  pages[key] = async (root) => {
    let rows = await api('/' + key); const fields = await fieldsFn();
    const draw = () => {
      root.innerHTML = `<div class="bar"><h1>${title}</h1><span><input id="q" placeholder="بحث..." style="width:180px"> ${can ? '<button class="btn" id="add">+ إضافة</button>' : ''}</span></div><div id="t"></div>`;
      const show = (q = '') => { const f = rows.filter((r) => JSON.stringify(Object.values(r)).includes(q));
        $('#t').innerHTML = table(cols, f, can ? (r) => `<button class="btn sm ghost" data-e="${r.id}">تعديل</button> <button class="btn sm danger" data-d="${r.id}">حذف</button>` : null); };
      show(); $('#q').oninput = (e) => show(e.target.value);
      if (can) {
        $('#add').onclick = () => formModal('إضافة', fields, {}, async (o) => { await api('/' + key, 'POST', o); toast('تمت الإضافة'); rows = await api('/' + key); draw(); });
        $('#t').onclick = guard(async (e) => {
          const ed = e.target.dataset.e, del = e.target.dataset.d;
          if (ed) { const r = rows.find((x) => x.id == ed); formModal('تعديل', fields, r, async (o) => { await api(`/${key}/${ed}`, 'PUT', o); toast('تم الحفظ'); rows = await api('/' + key); draw(); }); }
          if (del && confirm('تأكيد الحذف؟')) { await api(`/${key}/${del}`, 'DELETE'); rows = await api('/' + key); draw(); }
        });
      }
    };
    draw();
  };
}
const supplierOpts = async () => [['', '— بدون —'], ...(await api('/suppliers').catch(() => [])).map((s) => [s.id, s.name])];
const WR = (...r) => r.includes(me.role);
crud('products', 'المنتجات والعروض', [
  { l: 'المنتج', k: 'name' }, { l: 'الفئة', k: 'category' }, { l: 'الوحدة', k: 'unit' },
  { l: 'السعر', f: (r) => money(r.price) }, { l: 'التكلفة', f: (r) => money(r.cost) },
  { l: 'الهامش', f: (r) => (r.price ? Math.round(((r.price - r.cost) / r.price) * 100) + '%' : '-') },
  { l: 'المخزون', html: (r) => `<span class="${r.stock <= r.reorder_level ? 'down' : ''}">${esc(r.stock)}</span>` },
  { l: 'العرض', html: (r) => (r.offer_percent ? `<span class="badge b-soon">${r.offer_percent}%${r.offer_ends ? ' حتى ' + esc(r.offer_ends) : ''}</span>` : '') },
  { l: 'ظاهر', f: (r) => (r.active ? 'نعم' : 'لا') },
], async () => [
  { k: 'name', l: 'اسم المنتج', req: 1 }, { k: 'category', l: 'الفئة', t: 'select', opts: CATS.map((c) => [c, c]) },
  { k: 'unit', l: 'الوحدة (كجم/جرام/حبة)' }, { k: 'price', l: 'سعر البيع (شامل الضريبة)', t: 'number' }, { k: 'cost', l: 'تكلفة الشراء', t: 'number' },
  { k: 'stock', l: 'المخزون الحالي', t: 'number' }, { k: 'reorder_level', l: 'حد إعادة الطلب', t: 'number' }, { k: 'lead_days', l: 'مدة التوريد (أيام)', t: 'number' },
  { k: 'supplier_id', l: 'المورد', t: 'select', opts: await supplierOpts() }, { k: 'offer_percent', l: 'خصم العرض %', t: 'number' }, { k: 'offer_ends', l: 'نهاية العرض', t: 'date' },
  { k: 'image', l: 'رابط صورة (اختياري)' }, { k: 'description', l: 'الوصف', t: 'textarea' }, { k: 'active', l: 'ظاهر في المتجر', t: 'checkbox' },
], true);
crud('customers', 'العملاء', [{ l: 'الاسم', k: 'name' }, { l: 'الجوال', k: 'phone' }, { l: 'المدينة', k: 'city' }, { l: 'النوع', k: 'type' }, { l: 'ملاحظات', k: 'notes' }, { l: 'منذ', f: (r) => r.created_at.slice(0, 10) }],
  async () => [{ k: 'name', l: 'الاسم', req: 1 }, { k: 'phone', l: 'الجوال' }, { k: 'city', l: 'المدينة' }, { k: 'type', l: 'النوع', t: 'select', opts: [['فرد', 'فرد'], ['تجاري', 'تجاري (مطعم/مقهى/متجر)']] }, { k: 'notes', l: 'ملاحظات', t: 'textarea' }], true);
crud('employees', 'الموظفون', [{ l: 'الاسم', k: 'name' }, { l: 'الوظيفة', k: 'job' }, { l: 'الجوال', k: 'phone' }, { l: 'الراتب', f: (r) => money(r.salary) }, { l: 'التعيين', k: 'hired_at' }, { l: 'نشط', f: (r) => (r.active ? 'نعم' : 'لا') }],
  async () => [{ k: 'name', l: 'الاسم', req: 1 }, { k: 'job', l: 'الوظيفة' }, { k: 'phone', l: 'الجوال' }, { k: 'salary', l: 'الراتب', t: 'number' }, { k: 'hired_at', l: 'تاريخ التعيين', t: 'date' }, { k: 'active', l: 'على رأس العمل', t: 'checkbox' }], true);
crud('suppliers', 'الموردون', [{ l: 'المورد', k: 'name' }, { l: 'الجوال', k: 'phone' }, { l: 'الدولة', k: 'country' }, { l: 'ملاحظات', k: 'notes' }],
  async () => [{ k: 'name', l: 'الاسم', req: 1 }, { k: 'phone', l: 'الجوال' }, { k: 'country', l: 'الدولة' }, { k: 'notes', l: 'ملاحظات', t: 'textarea' }], true);

pages.dashboard = async (root) => {
  const s = await api('/reports/summary?days=30');
  const max = Math.max(1, ...s.daily.map((d) => d.v)), cmax = Math.max(1, ...s.by_category.map((d) => d.v));
  const k = (l, v, cls = '') => `<div class="card kpi"><div class="v ${cls}">${v}</div><div class="l">${l}</div></div>`;
  root.innerHTML = `<div class="bar"><h1>الرئيسية (آخر 30 يوماً)</h1></div>
  <div class="grid g4">${k('الإيرادات (ر.س)', money(s.revenue))}${k('صافي بعد الضريبة', money(s.net_revenue))}${k('الربح الإجمالي', money(s.gross_profit), 'up')}${k('هامش الربح', s.margin + '%')}
  ${k('عدد الطلبات', s.orders)}${k('متوسط الطلب', money(s.avg_order))}${k('ضريبة القيمة المضافة', money(s.vat))}${k('قيمة المخزون', money(s.inventory_value))}
  ${k('طلبات بانتظار التأكيد', s.pending_orders, s.pending_orders ? 'down' : '')}${k('أصناف تحت حد الطلب', s.low_stock, s.low_stock ? 'down' : '')}${k('العملاء', s.customers)}${k('رواتب شهرية', money(s.payroll))}</div>
  <div class="grid g2" style="margin-top:1rem"><div class="card bars"><b>المبيعات اليومية</b>${s.daily.slice(-14).map((d) => `<div class="row"><span style="width:80px">${esc(d.d.slice(5))}</span><div class="bar-i" style="width:${(d.v / max) * 60}%"></div><span>${money(d.v)}</span></div>`).join('') || '<p>لا مبيعات</p>'}</div>
  <div class="card bars"><b>حسب الفئة</b>${s.by_category.map((d) => `<div class="row"><span style="width:70px">${esc(d.c)}</span><div class="bar-i" style="width:${(d.v / cmax) * 60}%"></div><span>${money(d.v)}</span></div>`).join('')}
  <hr><b>الأكثر مبيعاً</b>${table([{ l: 'المنتج', k: 'name' }, { l: 'الكمية', k: 'qty' }, { l: 'المبلغ', f: (r) => money(r.v) }], s.top_products)}</div></div>`;
};

// نقطة بيع / طلب جديد
pages.sale = async (root) => {
  const [prods, custs] = await Promise.all([api('/products'), api('/customers')]);
  const items = new Map(); const eff = (p) => (p.offer_percent > 0 && (!p.offer_ends || p.offer_ends >= new Date().toISOString().slice(0, 10)) ? p.price * (1 - p.offer_percent / 100) : p.price);
  const draw = () => {
    const lines = [...items].map(([id, q]) => ({ p: prods.find((x) => x.id === id), q })); const total = lines.reduce((s, l) => s + eff(l.p) * l.q, 0);
    root.innerHTML = `<div class="bar"><h1>بيع جديد</h1></div><div class="grid g2"><div class="card"><label>أضف منتجاً</label><select id="pp"><option value="">اختر...</option>${prods.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)} — ${money(eff(p))} (متوفر ${p.stock})</option>`).join('')}</select>
    <label>العميل</label><select id="cu"><option value="">عميل نقدي</option>${custs.map((c) => `<option value="${c.id}">${esc(c.name)} ${esc(c.phone || '')}</option>`).join('')}</select>
    <label>خصم إضافي (ر.س)</label><input id="di" type="number" min="0" value="0"></div>
    <div class="card">${lines.map((l) => `<div style="display:flex;gap:.5rem;align-items:center;margin:.3rem 0"><span style="flex:1">${esc(l.p.name)}</span><input type="number" step="0.5" min="0" value="${l.q}" data-q="${l.p.id}" style="width:80px"><b>${money(eff(l.p) * l.q)}</b></div>`).join('') || '<p>لا أصناف</p>'}
    <p><b>الإجمالي قبل الخصم: ${money(total)} ر.س</b></p><button class="btn" id="done" ${lines.length ? '' : 'disabled'}>إتمام البيع</button></div></div>`;
    $('#pp').onchange = (e) => { const id = Number(e.target.value); if (id) { items.set(id, (items.get(id) || 0) + 1); const c = $('#cu').value, d = $('#di').value; draw(); $('#cu').value = c; $('#di').value = d; } };
    document.querySelectorAll('[data-q]').forEach((i) => (i.onchange = () => { Number(i.value) > 0 ? items.set(Number(i.dataset.q), Number(i.value)) : items.delete(Number(i.dataset.q)); const c = $('#cu').value, d = $('#di').value; draw(); $('#cu').value = c; $('#di').value = d; }));
    $('#done').onclick = guard(async () => { const r = await api('/orders', 'POST', { items: lines.map((l) => ({ product_id: l.p.id, qty: l.q })), customer_id: $('#cu').value || null, discount: $('#di').value, status: 'completed' }); toast('تم البيع، فاتورة رقم ' + r.id); items.clear(); nav('orders'); });
  };
  draw();
};
pages.orders = async (root) => {
  const rows = await api('/orders');
  root.innerHTML = `<div class="bar"><h1>الطلبات</h1><button class="btn" id="n">+ بيع جديد</button></div>${table([
    { l: '#', k: 'id' }, { l: 'التاريخ', f: (r) => r.created_at.slice(0, 16) }, { l: 'العميل', k: 'cname' }, { l: 'القناة', f: (r) => (r.channel === 'store' ? 'المتجر' : 'نقطة بيع') },
    { l: 'الأصناف', k: 'items' }, { l: 'الإجمالي', f: (r) => money(r.total) }, { l: 'الحالة', html: (r) => badge(r.status) }],
    rows, (r) => `<button class="btn sm ghost" data-v="${r.id}">عرض</button>${r.status === 'pending' ? ` <button class="btn sm" data-s="completed" data-id="${r.id}">تأكيد</button>` : ''}${r.status !== 'cancelled' ? ` <button class="btn sm danger" data-s="cancelled" data-id="${r.id}">إلغاء</button>` : ''}`)}`;
  $('#n').onclick = () => nav('sale');
  root.onclick = guard(async (e) => {
    const t = e.target;
    if (t.dataset.s) { if (t.dataset.s === 'cancelled' && !confirm('إلغاء الطلب؟')) return; await api(`/orders/${t.dataset.id}/status`, 'POST', { status: t.dataset.s }); toast('تم'); pages.orders(root); }
    if (t.dataset.v) { const o = await api('/orders/' + t.dataset.v); $('#modal').innerHTML = `<div class="modal-bg"><div class="modal"><h3>طلب #${o.id}</h3><p>${esc(o.customer_name || '')} ${esc(o.customer_phone || '')}</p>${o.notes ? `<p>ملاحظات: ${esc(o.notes)}</p>` : ''}${table([{ l: 'المنتج', k: 'name' }, { l: 'الكمية', k: 'qty' }, { l: 'السعر', f: (r) => money(r.price) }], o.items)}<p>الخصم: ${money(o.discount)} | الضريبة: ${money(o.vat)} | <b>الإجمالي: ${money(o.total)}</b></p><button class="btn ghost" id="mc">إغلاق</button></div></div>`; $('#mc').onclick = closeModal; }
  });
};

pages.purchases = async (root) => {
  const rows = await api('/purchases');
  root.innerHTML = `<div class="bar"><h1>أوامر الشراء</h1><button class="btn gold" id="an">اقتراحات المحلل ←</button></div>${table([
    { l: '#', k: 'id' }, { l: 'التاريخ', f: (r) => r.created_at.slice(0, 10) }, { l: 'المورد', f: (r) => r.supplier || '—' }, { l: 'الأصناف', k: 'items' }, { l: 'الإجمالي', f: (r) => money(r.total) }, { l: 'الحالة', html: (r) => badge(r.status) }],
    rows, (r) => `<button class="btn sm ghost" data-v="${r.id}">عرض</button>${r.status === 'draft' ? ` <button class="btn sm" data-s="ordered" data-id="${r.id}">اعتماد وإرسال</button>` : ''}${r.status === 'ordered' ? ` <button class="btn sm" data-s="received" data-id="${r.id}">استلام للمخزون</button>` : ''}${['draft', 'ordered'].includes(r.status) ? ` <button class="btn sm danger" data-s="cancelled" data-id="${r.id}">إلغاء</button>` : ''}`)}`;
  $('#an').onclick = () => nav('analyst');
  root.onclick = guard(async (e) => {
    const t = e.target;
    if (t.dataset.s) { if (!confirm('تأكيد تغيير الحالة؟')) return; await api(`/purchases/${t.dataset.id}/status`, 'POST', { status: t.dataset.s }); toast('تم'); pages.purchases(root); }
    if (t.dataset.v) { const o = await api('/purchases/' + t.dataset.v); $('#modal').innerHTML = `<div class="modal-bg"><div class="modal"><h3>أمر شراء #${o.id}</h3>${table([{ l: 'المنتج', k: 'name' }, { l: 'الكمية', k: 'qty' }, { l: 'التكلفة', f: (r) => money(r.cost) }, { l: 'المجموع', f: (r) => money(r.qty * r.cost) }], o.items)}<p><b>الإجمالي: ${money(o.total)}</b></p><button class="btn ghost" id="mc">إغلاق</button></div></div>`; $('#mc').onclick = closeModal; }
  });
};

pages.analyst = async (root) => {
  const { suggestions, insights } = await api('/analyst/reorder');
  const ind = await api('/market/indicators').catch(() => ({ insights: [] }));
  const all = [...insights, ...(ind.insights || [])];
  const total = (sel) => suggestions.filter((s) => sel.has(s.product_id)).reduce((a, s) => a + s.estimated_cost, 0);
  root.innerHTML = `<div class="bar"><h1>المحلل: أوامر الشراء والكميات</h1></div>
  <div class="card"><b>تنبيهات وتوصيات</b>${all.map((i) => `<div class="ins ${esc(i.level)}">${esc(i.text)}</div>`).join('') || '<p>لا تنبيهات حالياً ✅</p>'}</div>
  <p style="color:var(--mut)">الاقتراح = (الطلب اليومي × مضاعف الموسم × 30 يوماً + الطلب خلال مدة التوريد) + 20% أمان − المخزون. يعتمد على مبيعات آخر 30 و90 يوماً ومواسم رمضان والعيد واليوم الوطني والشتاء.</p>
  <div id="t"></div><p><b id="tot"></b> <button class="btn" id="mk">إنشاء أوامر شراء للمحدد (حسب المورد)</button></p>`;
  const sel = new Set(suggestions.filter((s) => s.urgency === 'critical').map((s) => s.product_id));
  const qtys = new Map(suggestions.map((s) => [s.product_id, s.suggested_qty]));
  const drawT = () => {
    $('#t').innerHTML = table([
      { l: '', html: (s) => `<input type="checkbox" data-c="${s.product_id}" style="width:auto" ${sel.has(s.product_id) ? 'checked' : ''}>` },
      { l: 'المنتج', k: 'name' }, { l: 'المورد', f: (s) => s.supplier_name || '—' }, { l: 'الأولوية', html: (s) => badge(s.urgency) },
      { l: 'المخزون', k: 'stock' }, { l: 'أيام التغطية', f: (s) => s.days_left ?? '—' }, { l: 'الموسم', f: (s) => '×' + s.season_factor },
      { l: 'الكمية المقترحة', html: (s) => `<input type="number" min="0" step="0.5" value="${qtys.get(s.product_id)}" data-q="${s.product_id}" style="width:90px">` },
      { l: 'التكلفة التقديرية', html: (s) => money(qtys.get(s.product_id) * s.cost) }, { l: 'السبب', html: (s) => `<small style="white-space:normal;display:block;min-width:220px">${s.reasons.map(esc).join(' · ')}</small>` }], suggestions);
    $('#tot').textContent = 'إجمالي المحدد: ' + money(suggestions.filter((s) => sel.has(s.product_id)).reduce((a, s) => a + qtys.get(s.product_id) * s.cost, 0)) + ' ر.س';
  };
  drawT();
  $('#t').onchange = (e) => { const c = e.target.dataset.c, q = e.target.dataset.q; if (c) e.target.checked ? sel.add(+c) : sel.delete(+c); if (q) qtys.set(+q, Number(e.target.value)); drawT(); };
  $('#mk').onclick = guard(async () => {
    const items = [...sel].map((id) => ({ product_id: id, qty: qtys.get(id) })).filter((i) => i.qty > 0);
    const r = await api('/analyst/create-po', 'POST', { items }); toast(`أُنشئ ${r.ids.length} أمر شراء (مسودة)`); nav('purchases');
  });
};

pages.market = async (root) => {
  root.innerHTML = '<div class="bar"><h1>السوق والأخبار</h1></div><div id="ind" class="card">جاري التحميل...</div><div class="tabs" id="tabs"></div><div id="news" class="card"></div>';
  const spark = (v) => { if (!v?.length) return ''; const mn = Math.min(...v), mx = Math.max(...v) || 1, r = mx - mn || 1; return `<svg width="90" height="24" viewBox="0 0 90 24"><polyline fill="none" stroke="#c8923a" stroke-width="1.6" points="${v.map((x, i) => `${(i / (v.length - 1)) * 90},${22 - ((x - mn) / r) * 20}`).join(' ')}"/></svg>`; };
  api('/market/indicators').then((d) => {
    const groups = {}; (d.items || []).forEach((i) => (groups[i.group] ||= []).push(i));
    $('#ind').innerHTML = (d.error ? `<p class="down">${esc(d.error)}</p>` : '') + (d.insights || []).map((i) => `<div class="ins ${esc(i.level)}">${esc(i.text)}</div>`).join('') +
      Object.entries(groups).map(([g, its]) => `<h3>${esc(g)}</h3><div class="grid g4">${its.map((i) => `<div class="card kpi"><div class="l">${esc(i.name)}</div>${i.error ? '<div class="l">غير متاح</div>' : `<div class="v">${Number(i.price).toLocaleString('en-US', { maximumFractionDigits: i.digits || 2 })}</div><div class="${i.change >= 0 ? 'up' : 'down'}">${i.change == null ? '' : (i.change >= 0 ? '▲ ' : '▼ ') + Math.abs(i.change).toFixed(2) + '%'}</div>${spark(i.series)}`}</div>`).join('')}</div>`).join('') +
      '<small style="color:var(--mut)">البيانات من Yahoo Finance وقد تتأخر. للاطلاع فقط وليست توصية استثمارية.</small>';
  }).catch((e) => ($('#ind').textContent = e.message));
  const load = guard(async (cat) => {
    $('#news').textContent = 'جاري التحميل...';
    const d = await api('/market/news?cat=' + cat);
    $('#tabs').innerHTML = Object.entries(d.categories).map(([k, v]) => `<button class="${k === cat ? 'on' : ''}" data-c="${k}">${esc(v)}</button>`).join('');
    $('#news').innerHTML = (d.error ? `<p class="down">${esc(d.error)}</p>` : '') + d.items.map((n) => `<p><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><br><small style="color:var(--mut)">${esc(n.source)} · ${esc(n.date)}</small></p>`).join('');
  });
  $('#tabs').onclick = (e) => e.target.dataset.c && load(e.target.dataset.c);
  load('saudi');
};

pages.users = async (root) => {
  const rows = await api('/users');
  const fields = (edit) => [{ k: 'name', l: 'الاسم', req: 1 }, ...(edit ? [] : [{ k: 'username', l: 'اسم المستخدم', req: 1 }]), { k: 'password', l: edit ? 'كلمة مرور جديدة (اتركها فارغة)' : 'كلمة المرور (8+)', t: 'password' }, { k: 'role', l: 'الدور', t: 'select', opts: Object.entries(ROLE) }, ...(edit ? [{ k: 'active', l: 'فعّال', t: 'checkbox' }] : [])];
  root.innerHTML = `<div class="bar"><h1>المستخدمون والصلاحيات</h1><button class="btn" id="add">+ مستخدم</button></div>${table([{ l: 'الاسم', k: 'name' }, { l: 'المستخدم', k: 'username' }, { l: 'الدور', f: (r) => ROLE[r.role] }, { l: 'فعّال', f: (r) => (r.active ? 'نعم' : 'لا') }], rows, (r) => `<button class="btn sm ghost" data-e="${r.id}">تعديل</button>`)}
  <p style="color:var(--mut)">المدير: كل شيء · مدير: المنتجات والمشتريات والتحليل · مبيعات: البيع والعملاء · محاسب: عرض التقارير والمشتريات.</p>`;
  $('#add').onclick = () => formModal('مستخدم جديد', fields(false), { role: 'sales' }, async (o) => { await api('/users', 'POST', o); toast('تم'); pages.users(root); });
  root.onclick = (e) => { const id = e.target.dataset.e; if (!id) return; const r = rows.find((x) => x.id == id);
    formModal('تعديل مستخدم', fields(true), r, async (o) => { if (!o.password) delete o.password; await api('/users/' + id, 'PUT', o); toast('تم'); pages.users(root); }); };
};
pages.settings = async (root) => {
  const s = await api('/settings');
  root.innerHTML = `<div class="bar"><h1>الإعدادات</h1></div><div class="grid g2"><form class="card" id="f"><b>المتجر</b><label>اسم المتجر</label><input name="store_name" value="${esc(s.store_name)}"><label>واتساب (بدون +)</label><input name="whatsapp" value="${esc(s.whatsapp)}"><label>نسبة ضريبة القيمة المضافة %</label><input name="vat_rate" type="number" value="${esc(s.vat_rate)}"><p><button class="btn">حفظ</button></p></form>
  <form class="card" id="p"><b>تغيير كلمة مروري</b><label>الحالية</label><input type="password" name="old"><label>الجديدة (8+)</label><input type="password" name="new"><p><button class="btn">تغيير</button></p></form></div>`;
  $('#f').onsubmit = guard(async (e) => { e.preventDefault(); await api('/settings', 'PUT', Object.fromEntries(new FormData(e.target))); toast('تم الحفظ'); });
  $('#p').onsubmit = guard(async (e) => { e.preventDefault(); await api('/me/password', 'POST', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('تم التغيير'); });
};

// ---------- الهيكل ----------
const NAV = [
  ['dashboard', 'الرئيسية', ['admin', 'manager', 'accountant']], ['sale', 'بيع جديد', ['admin', 'manager', 'sales']], ['orders', 'الطلبات', ['admin', 'manager', 'sales', 'accountant']],
  ['products', 'المنتجات والعروض', ['admin', 'manager', 'sales']], ['customers', 'العملاء', ['admin', 'manager', 'sales', 'accountant']], ['suppliers', 'الموردون', ['admin', 'manager', 'accountant']],
  ['purchases', 'أوامر الشراء', ['admin', 'manager', 'accountant']], ['analyst', 'المحلل', ['admin', 'manager', 'accountant']], ['market', 'السوق والأخبار', ['admin', 'manager', 'accountant']],
  ['employees', 'الموظفون', ['admin', 'manager']], ['users', 'المستخدمون', ['admin']], ['settings', 'الإعدادات', ['admin']],
];
let current = null;
async function nav(p) {
  current = p; location.hash = p;
  document.querySelectorAll('.side a[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  const root = $('#content'); root.innerHTML = 'جاري التحميل...'; root.onclick = null;
  try { await pages[p](root); } catch (e) { root.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}
function showApp() {
  const items = NAV.filter((n) => n[2].includes(me.role));
  $('#app').innerHTML = `<div class="layout"><nav class="side"><h2>🌴 بيت النوى</h2>${items.map((n) => `<a data-p="${n[0]}">${n[1]}</a>`).join('')}<a href="/" target="_blank">المتجر ↗</a><hr><small style="padding:0 .8rem">${esc(me.name)} (${ROLE[me.role]})</small><a id="lo">خروج</a></nav><main class="main" id="content"></main></div>`;
  document.querySelectorAll('.side a[data-p]').forEach((a) => (a.onclick = () => nav(a.dataset.p)));
  $('#lo').onclick = logout;
  const h = location.hash.slice(1); nav(items.find((n) => n[0] === h) ? h : items[0][0]);
}
function showLogin() {
  $('#app').innerHTML = `<form class="card login" id="lf"><h2>🌴 بيت النوى</h2><label>اسم المستخدم</label><input name="username" autocomplete="username" required><label>كلمة المرور</label><input type="password" name="password" autocomplete="current-password" required><p id="le" class="down"></p><button class="btn">دخول</button></form>`;
  $('#lf').onsubmit = async (e) => { e.preventDefault(); try { const d = await api('/login', 'POST', Object.fromEntries(new FormData(e.target))); token = d.token; sessionStorage.setItem('t', token); me = d.user; showApp(); } catch (er) { $('#le').textContent = er.message; } };
}
(async () => { if (token) { try { me = await api('/me'); return showApp(); } catch {} } showLogin(); })();
