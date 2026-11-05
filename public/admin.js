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

// ---------- لوحة المؤشرات التفاعلية ----------
const PAL = ['#c8923a', '#5a3a22', '#2e7d4f', '#2a5d9f', '#b3392f', '#8e5ea2', '#d4b483', '#3b9aa0'];
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const METRICS = { revenue: ['الإيراد (بدون ضريبة)', '#c8923a', true], profit: ['الربح الإجمالي', '#2e7d4f', true], orders: ['عدد الطلبات', '#2a5d9f', false] };
const delta = (c, p, pp) => {
  if (pp) { const d = c - p; return `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} نقطة</span>`; }
  if (!p) return c ? '<span class="up">جديد</span>' : '<span class="l">—</span>';
  const d = ((c - p) / Math.abs(p)) * 100, a = Math.abs(d); return `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${a > 999 ? '+999' : a.toFixed(1)}%</span>`;
};
function lineChart(daily, metric) {
  const W = 760, H = 250, L = 24, R = 24, T = 14, B = 26, n = daily.length;
  const vals = daily.map((d) => d[metric]), max = Math.max(1, ...vals) * 1.1;
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2), y = (v) => T + (1 - v / max) * (H - T - B);
  const col = METRICS[metric][1], pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const step = Math.ceil(n / 8);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f / 1.1).toFixed(1)}" y2="${y(max * f / 1.1).toFixed(1)}" stroke="#e8dccb" stroke-dasharray="3 3"/>`).join('');
  const ticks = daily.map((d, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" font-size="11" fill="#7b6b5c" text-anchor="middle">${d.d.slice(5)}</text>` : '')).join('');
  return `<div class="chart" id="lc" dir="ltr"><svg viewBox="0 0 ${W} ${H}" width="100%">${grid}
    <polygon points="${L},${H - B} ${pts.join(' ')} ${x(n - 1)},${H - B}" fill="${col}" opacity=".12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>
    <line id="cl" y1="${T}" y2="${H - B}" stroke="#7b6b5c" stroke-dasharray="3 3" visibility="hidden"/><circle id="cd" r="5" fill="${col}" stroke="#fff" stroke-width="2" visibility="hidden"/>${ticks}</svg><div class="tip" id="tip" hidden></div></div>`;
}
function bindLine(daily, metric, W = 760, H = 250, L = 24, R = 24, T = 14, B = 26) {
  const box = $('#lc'); if (!box) return; const n = daily.length, max = Math.max(1, ...daily.map((d) => d[metric])) * 1.1;
  const svg = box.querySelector('svg'), tip = $('#tip'), cl = $('#cl'), cd = $('#cd');
  box.onmousemove = box.ontouchmove = (e) => {
    const r = svg.getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((cx / r.width) * W - L) / (W - L - R) * (n - 1)))), d = daily[i];
    const px = L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0), py = T + (1 - d[metric] / max) * (H - T - B);
    cl.setAttribute('x1', px); cl.setAttribute('x2', px); cl.setAttribute('visibility', 'visible'); cd.setAttribute('cx', px); cd.setAttribute('cy', py); cd.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.style.left = Math.min(Math.max((px / W) * r.width, 70), r.width - 70) + 'px';
    tip.innerHTML = `<b>${esc(d.d)}</b><br>إيراد: ${money(d.revenue)}<br>ربح: ${money(d.profit)}<br>طلبات: ${d.orders}`;
  };
  box.onmouseleave = () => { tip.hidden = true; cl.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); };
}
function donut(cats, sel) {
  const tot = cats.reduce((s, c) => s + c.v, 0) || 1; let a0 = -Math.PI / 2; const R = 80, r = 50, C = 100;
  const arcs = cats.map((c, i) => {
    const a1 = a0 + (c.v / tot) * Math.PI * 2 - 0.0001, big = a1 - a0 > Math.PI ? 1 : 0, o = sel && sel !== c.c ? 0.3 : 1;
    const P = (a, rad) => `${(C + rad * Math.cos(a)).toFixed(2)} ${(C + rad * Math.sin(a)).toFixed(2)}`;
    const p = `<path class="arc" data-c="${esc(c.c)}" d="M${P(a0, R)} A${R} ${R} 0 ${big} 1 ${P(a1, R)} L${P(a1, r)} A${r} ${r} 0 ${big} 0 ${P(a0, r)}Z" fill="${PAL[i % 8]}" opacity="${o}" style="cursor:pointer"><title>${esc(c.c)}: ${money(c.v)}</title></path>`;
    a0 = a1 + 0.0001; return p;
  }).join('');
  return `<svg viewBox="0 0 200 200" width="190">${arcs}<text x="100" y="96" text-anchor="middle" font-size="11" fill="#7b6b5c" id="dl">${sel ? esc(sel) : 'الإجمالي'}</text><text x="100" y="114" text-anchor="middle" font-size="14" font-weight="700" fill="#5a3a22" id="dv">${money(sel ? (cats.find((c) => c.c === sel)?.v || 0) : tot)}</text></svg>`;
}
const hbars = (rows, fmt, color = 'var(--gold)') => { const m = Math.max(1, ...rows.map((r) => r.v)); return rows.map((r) => `<div class="row" ${r.attr || ''}><span style="width:78px">${esc(r.l)}</span><div class="bar-i" style="width:${(r.v / m) * 55}%;background:${color}"></div><span>${fmt(r.v)}</span></div>`).join(''); };

pages.dashboard = async (root) => {
  const st = { days: 30, metric: 'revenue', cat: null, d: null };
  const load = guard(async () => {
    st.d = await api(`/reports/summary?days=${st.days}${st.cat ? '&category=' + encodeURIComponent(st.cat) : ''}`); draw();
  });
  const kpi = (l, v, sub, go) => `<div class="card kpi ${go ? 'click' : ''}" ${go ? `data-go="${go}"` : ''}><div class="l">${l}</div><div class="v">${v}</div><div class="l">${sub || '&nbsp;'}</div></div>`;
  function draw() {
    const s = st.d, p = s.prev, per = { 7: 'أسبوع', 30: '30 يوماً', 90: '90 يوماً', 365: 'سنة' };
    const chan = { store: 'المتجر', pos: 'نقطة بيع' };
    root.innerHTML = `<div class="bar"><h1>لوحة المؤشرات</h1><span class="seg">${[7, 30, 90, 365].map((d) => `<button data-days="${d}" class="${d === s.days ? 'on' : ''}">${per[d]}</button>`).join('')}<button id="csv" title="تصدير البيانات اليومية">⬇ CSV</button></span></div>
    <div class="grid g4">
      ${kpi('الإيراد (شامل الضريبة)', money(s.revenue), delta(s.revenue, p.revenue) + ' عن الفترة السابقة')}
      ${kpi('الربح الإجمالي', `<span class="up">${money(s.gross_profit)}</span>`, delta(s.gross_profit, p.gross_profit) + ' عن الفترة السابقة')}
      ${kpi('هامش الربح', s.margin + '%', delta(s.margin, p.margin, 1))}
      ${kpi('الطلبات', s.orders, delta(s.orders, p.orders) + ' · متوسط ' + money(s.avg_order))}
      ${kpi('ضريبة القيمة المضافة', money(s.vat), delta(s.vat, p.vat))}
      ${kpi('طلبات بانتظار التأكيد', `<span class="${s.pending_orders ? 'down' : ''}">${s.pending_orders}</span>`, 'اضغط للمراجعة ←', 'orders')}
      ${kpi('أصناف تحت حد الطلب', `<span class="${s.low_stock ? 'down' : ''}">${s.low_stock}</span>`, 'اضغط لاقتراحات الشراء ←', 'analyst')}
      ${kpi('قيمة المخزون', money(s.inventory_value), `${s.products} منتج · ${s.customers} عميل`, 'products')}</div>
    <div class="card" style="margin-top:1rem"><div class="bar" style="margin:0 0 .5rem"><b>الاتجاه اليومي</b><span class="seg">${Object.entries(METRICS).map(([k, m]) => `<button data-m="${k}" class="${k === st.metric ? 'on' : ''}">${m[0]}</button>`).join('')}</span></div>${lineChart(s.daily, st.metric)}</div>
    <div class="grid g2" style="margin-top:1rem">
      <div class="card"><b>المبيعات حسب الفئة</b> <small class="l">(اضغط فئة للتعمق)</small><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap" id="dn">${donut(s.by_category, st.cat)}
        <div style="flex:1;min-width:190px">${s.by_category.map((c, i) => `<div class="leg ${st.cat === c.c ? 'on' : ''}" data-c="${esc(c.c)}"><i style="background:${PAL[i % 8]}"></i>${esc(c.c)}<span>${money(c.v)} <small class="up">ربح ${money(c.profit)}</small></span></div>`).join('')}</div></div></div>
      <div class="card"><b>الأكثر مبيعاً${st.cat ? ' في ' + esc(st.cat) + ' <button class="btn sm ghost" id="clr">✕ إلغاء</button>' : ''}</b>
        ${table([{ l: 'المنتج', k: 'name' }, { l: 'الكمية', k: 'qty' }, { l: 'المبيعات', f: (r) => money(r.v) }, { l: 'الربح', html: (r) => `<span class="up">${money(r.profit)}</span>` }], s.top_products)}</div>
      <div class="card bars"><b>أيام الأسبوع الأقوى</b>${hbars(WD.map((n, i) => ({ l: n, v: s.by_weekday.find((w) => w.w === i)?.v || 0 })), money)}
        <hr><b>القنوات</b>${hbars(s.by_channel.map((c) => ({ l: chan[c.c] || c.c, v: c.v })), money, 'var(--brown)')}</div>
      <div class="card"><b>أفضل العملاء</b>${table([{ l: 'العميل', k: 'name' }, { l: 'الطلبات', k: 'orders' }, { l: 'المشتريات', f: (r) => money(r.v) }], s.top_customers)}
        <hr><b>⚠ مخزون منخفض</b>${s.low_stock_items.map((i) => `<div class="ins warn click" data-go="products">${esc(i.name)}: ${esc(i.stock)} ${esc(i.unit)} (الحد ${esc(i.reorder_level)})</div>`).join('') || '<p class="l">كل الأصناف بمستوى جيد ✅</p>'}</div>
    </div>`;
    bindLine(s.daily, st.metric);
  }
  root.onclick = (e) => {
    const t = e.target, q = (sel) => t.closest(sel);
    if (q('[data-days]')) { st.days = +q('[data-days]').dataset.days; load(); }
    else if (q('[data-m]')) { st.metric = q('[data-m]').dataset.m; draw(); }
    else if (q('[data-c]')) { const c = q('[data-c]').dataset.c; st.cat = st.cat === c ? null : c; load(); }
    else if (q('#clr')) { st.cat = null; load(); }
    else if (q('[data-go]')) nav(q('[data-go]').dataset.go);
    else if (q('#csv')) {
      const rows = ['التاريخ,الإيراد,الربح,الطلبات', ...st.d.daily.map((d) => [d.d, d.revenue, d.profit, d.orders].join(','))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8' })); a.download = `sales-${st.days}d.csv`; a.click(); URL.revokeObjectURL(a.href);
    }
  };
  root.onmouseover = (e) => { const a = e.target.closest('.arc'); if (!a || st.cat) return; const c = st.d.by_category.find((x) => x.c === a.dataset.c); $('#dl').textContent = c.c; $('#dv').textContent = money(c.v); };
  await load();
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
  const root = $('#content'); root.innerHTML = 'جاري التحميل...'; root.onclick = null; root.onmouseover = null;
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
