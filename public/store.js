const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { 'مكسرات': '🥜', 'حلويات': '🍰', 'بهارات': '🌶️', 'أعشاب': '🌿', 'قهوة': '☕', 'تمور': '🌴', 'سمن': '🧈', 'عسل': '🍯' };
let products = [], cat = 'الكل', info = {}, q = '', sort = 'cat'; let cart = new Map();
try { cart = new Map(JSON.parse(localStorage.getItem('bn_cart') || '[]')); } catch {}
const save = () => { try { localStorage.setItem('bn_cart', JSON.stringify([...cart])); } catch {} };
const fmt = (n) => Number(n).toLocaleString('ar-SA', { maximumFractionDigits: 2 }) + ' ر.س';
const step = (p) => (p.unit === 'كجم' ? 0.5 : 1);
const cartCount = () => [...cart.keys()].filter((id) => products.some((p) => p.id === id)).length;

function card(p) {
  const img = /^https:\/\//.test(p.image || '') ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : ICON[p.category] || '🛍️';
  const inCart = cart.get(p.id);
  const ctl = !p.in_stock ? '<span class="badge b-cancelled">نفد المخزون</span>'
    : inCart ? `<div class="stepper"><button data-dec="${p.id}" aria-label="إنقاص">−</button><b>${inCart} ${esc(p.unit)}</b><button data-inc="${p.id}" aria-label="زيادة">+</button></div>`
    : `<button class="btn sm" data-add="${p.id}">أضف للسلة</button>`;
  return `<article class="card prod">${p.offer_percent ? `<span class="ribbon">خصم ${p.offer_percent}%</span>` : ''}<div class="ph">${img}</div>
  <b>${esc(p.name)}</b><small class="l">${esc(p.category)} · ${esc(p.unit)}</small>${p.description ? `<small class="desc">${esc(p.description)}</small>` : ''}
  <div>${p.offer_percent ? `<span class="old">${fmt(p.price)}</span> ` : ''}<span class="price">${fmt(p.final_price)}</span>${p.offer_ends ? `<br><small class="down">العرض حتى ${esc(p.offer_ends)}</small>` : ''}</div>${ctl}</article>`;
}
function visible() {
  let r = products.filter((p) => (cat === 'الكل' || p.category === cat) && (!q || (p.name + p.description + p.category).includes(q)));
  const by = { low: (a, b) => a.final_price - b.final_price, high: (a, b) => b.final_price - a.final_price, offer: (a, b) => b.offer_percent - a.offer_percent };
  return by[sort] ? r.sort(by[sort]) : r;
}
function render() {
  const offers = products.filter((p) => p.offer_percent && p.in_stock);
  $('#offers').innerHTML = offers.length && !q && cat === 'الكل' ? `<h2>🔥 عروض لفترة محدودة</h2><div class="products hscroll">${offers.map(card).join('')}</div><h2>كل المنتجات</h2>` : '';
  $('#tabs').innerHTML = ['الكل', ...(info.categories || [])].map((c) => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${c !== 'الكل' ? (ICON[c] || '') + ' ' : ''}${esc(c)}</button>`).join('');
  const v = visible(); $('#list').innerHTML = v.map(card).join(''); $('#empty').hidden = v.length > 0;
  $('#cc0').textContent = cartCount();
}
function setQty(id, q2) { const p = products.find((x) => x.id === id); if (!p) return; q2 > 0 ? cart.set(id, Math.round(q2 * 100) / 100) : cart.delete(id); save(); render(); if ($('#modal').innerHTML) openCart(); }
document.addEventListener('click', (e) => {
  const g = (k) => e.target.closest(`[data-${k}]`)?.dataset[k];
  const add = g('add'), inc = g('inc'), dec = g('dec'), c = g('cat');
  if (add) setQty(+add, step(products.find((p) => p.id === +add)));
  if (inc) setQty(+inc, (cart.get(+inc) || 0) + step(products.find((p) => p.id === +inc)));
  if (dec) setQty(+dec, (cart.get(+dec) || 0) - step(products.find((p) => p.id === +dec)));
  if (c) { cat = c; render(); }
});
$('#search').oninput = (e) => { q = e.target.value.trim(); render(); };
$('#sort').onchange = (e) => { sort = e.target.value; render(); };

function openCart() {
  const lines = [...cart].map(([id, n]) => ({ p: products.find((x) => x.id === id), n })).filter((l) => l.p);
  const total = lines.reduce((s, l) => s + l.p.final_price * l.n, 0);
  const saved = JSON.parse(localStorage.getItem('bn_cust') || '{}');
  $('#modal').innerHTML = `<div class="modal-bg"><div class="modal"><h3>🛒 سلتك</h3>
  ${lines.length ? lines.map((l) => `<div class="cl"><span style="flex:1">${esc(l.p.name)}</span><div class="stepper"><button data-dec="${l.p.id}">−</button><b>${l.n} ${esc(l.p.unit)}</b><button data-inc="${l.p.id}">+</button></div><b style="min-width:80px;text-align:left">${fmt(l.p.final_price * l.n)}</b></div>`).join('') +
  `<p><b>الإجمالي: ${fmt(total)}</b> <small class="l">(شامل الضريبة)</small></p>
  <label>الاسم</label><input id="cn" value="${esc(saved.n || '')}" autocomplete="name"><label>الجوال</label><input id="cp" inputmode="tel" value="${esc(saved.p || '')}" autocomplete="tel"><label>المدينة</label><input id="cc" value="${esc(saved.c || '')}"><label>ملاحظات</label><textarea id="cnote" rows="2"></textarea>
  <p id="cerr" class="down"></p><button class="btn" id="send">إرسال الطلب</button> ${info.whatsapp ? '<button class="btn gold" id="wsend">إرسال عبر واتساب</button> ' : ''}` : '<p>السلة فارغة</p>'}
  <button class="btn ghost" id="close">إغلاق</button></div></div>`;
  $('#close').onclick = () => ($('#modal').innerHTML = '');
  const cust = () => { const o = { n: $('#cn').value, p: $('#cp').value, c: $('#cc').value }; try { localStorage.setItem('bn_cust', JSON.stringify(o)); } catch {} return o; };
  const w = $('#wsend'); if (w) w.onclick = () => {
    const o = cust(), msg = `طلب جديد من ${o.n || 'عميل'}\n` + lines.map((l) => `• ${l.p.name} × ${l.n} ${l.p.unit} = ${fmt(l.p.final_price * l.n)}`).join('\n') + `\nالإجمالي: ${fmt(total)}` + (o.c ? `\nالمدينة: ${o.c}` : '');
    window.open(`https://wa.me/${info.whatsapp}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  };
  const s = $('#send'); if (s) s.onclick = async () => {
    const o = cust(); s.disabled = true; $('#cerr').textContent = '';
    try {
      const r = await fetch('/api/store/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: o.n, phone: o.p, city: o.c, notes: $('#cnote').value, items: lines.map((l) => ({ product_id: l.p.id, qty: l.n })) }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      cart.clear(); save(); render();
      $('#modal').innerHTML = `<div class="modal-bg"><div class="modal" style="text-align:center"><div style="font-size:3rem">✅</div><h3>${esc(d.message)}</h3><p>رقم طلبك: <b>${d.id}</b></p><button class="btn" id="close">حسناً</button></div></div>`;
      $('#close').onclick = () => ($('#modal').innerHTML = '');
    } catch (er) { $('#cerr').textContent = er.message || 'تعذر الإرسال'; s.disabled = false; }
  };
}
$('#cartbtn').onclick = openCart;
document.addEventListener('keydown', (e) => e.key === 'Escape' && ($('#modal').innerHTML = ''));
(async () => {
  try {
    info = await (await fetch('/api/store/info')).json(); $('#sname').textContent = info.name; document.title = info.name;
    if (info.whatsapp) { const a = $('#wa'); a.hidden = false; a.href = `https://wa.me/${info.whatsapp}`; }
    products = await (await fetch('/api/store/products')).json();
    for (const id of [...cart.keys()]) if (!products.some((p) => p.id === id && p.in_stock)) cart.delete(id);
    render();
  } catch { $('#list').innerHTML = '<p>تعذر تحميل المنتجات، حاول لاحقاً.</p>'; }
})();
