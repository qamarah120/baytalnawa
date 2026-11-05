const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { 'مكسرات': '🥜', 'حلويات': '🍯', 'بهارات': '🌶️', 'أعشاب': '🌿', 'قهوة': '☕', 'تمور': '🌴', 'سمن': '🧈', 'عسل': '🍯' };
let products = [], cat = 'الكل', info = {}; const cart = new Map();
const fmt = (n) => Number(n).toLocaleString('ar-SA', { maximumFractionDigits: 2 }) + ' ر.س';
function card(p) {
  const img = /^https?:\/\//.test(p.image || '') ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ICON[p.category] || '🛍️';
  return `<div class="card prod">${p.offer_percent ? `<span class="ribbon">خصم ${p.offer_percent}%</span>` : ''}<div class="ph">${img}</div>
  <b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.unit)}</small>
  <div>${p.offer_percent ? `<span class="old">${fmt(p.price)}</span> ` : ''}<span class="price">${fmt(p.final_price)}</span></div>
  ${p.in_stock ? `<button class="btn sm" data-add="${p.id}">أضف للسلة</button>` : '<span class="badge b-cancelled">نفد المخزون</span>'}</div>`;
}
function render() {
  const offers = products.filter((p) => p.offer_percent && p.in_stock);
  $('#offers').innerHTML = offers.length ? `<h2>🔥 العروض</h2><div class="products">${offers.map(card).join('')}</div>` : '';
  $('#tabs').innerHTML = ['الكل', ...(info.categories || [])].map((c) => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#list').innerHTML = products.filter((p) => cat === 'الكل' || p.category === cat).map(card).join('');
  $('#cartbtn').textContent = `السلة (${cart.size})`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-add]'), c = e.target.closest('[data-cat]');
  if (a) { const id = Number(a.dataset.add); cart.set(id, (cart.get(id) || 0) + 1); render(); }
  if (c) { cat = c.dataset.cat; render(); }
});
function openCart() {
  const lines = [...cart].map(([id, q]) => ({ p: products.find((x) => x.id === id), q })).filter((l) => l.p);
  const total = lines.reduce((s, l) => s + l.p.final_price * l.q, 0);
  $('#modal').innerHTML = `<div class="modal-bg"><div class="modal"><h3>سلتك</h3>
  ${lines.length ? lines.map((l) => `<div style="display:flex;gap:.5rem;align-items:center;margin:.3rem 0"><span style="flex:1">${esc(l.p.name)} (${esc(l.p.unit)})</span>
   <input type="number" min="0.5" step="0.5" value="${l.q}" data-q="${l.p.id}" style="width:80px"><b>${fmt(l.p.final_price * l.q)}</b></div>`).join('') +
  `<p><b>الإجمالي: ${fmt(total)}</b> <small>(شامل الضريبة)</small></p>
  <label>الاسم</label><input id="cn"><label>الجوال</label><input id="cp" inputmode="tel"><label>المدينة</label><input id="cc"><label>ملاحظات</label><textarea id="cnote" rows="2"></textarea>
  <p id="cerr" class="down"></p><button class="btn" id="send">إرسال الطلب</button> ` : '<p>السلة فارغة</p>'}
  <button class="btn ghost" id="close">إغلاق</button></div></div>`;
  $('#close').onclick = () => ($('#modal').innerHTML = '');
  document.querySelectorAll('[data-q]').forEach((i) => (i.onchange = () => { const q = Number(i.value); q > 0 ? cart.set(Number(i.dataset.q), q) : cart.delete(Number(i.dataset.q)); render(); openCart(); }));
  const s = $('#send'); if (s) s.onclick = async () => {
    s.disabled = true;
    const r = await fetch('/api/store/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('#cn').value, phone: $('#cp').value, city: $('#cc').value, notes: $('#cnote').value, items: lines.map((l) => ({ product_id: l.p.id, qty: l.q })) }) });
    const d = await r.json();
    if (!r.ok) { $('#cerr').textContent = d.error; s.disabled = false; return; }
    cart.clear(); render(); $('#modal').innerHTML = `<div class="modal-bg"><div class="modal"><h3>✅ ${esc(d.message)}</h3><p>رقم طلبك: ${d.id}</p><button class="btn" id="close">حسناً</button></div></div>`;
    $('#close').onclick = () => ($('#modal').innerHTML = '');
  };
}
$('#cartbtn').onclick = openCart;
(async () => {
  info = await (await fetch('/api/store/info')).json(); $('#sname').textContent = info.name; document.title = info.name;
  products = await (await fetch('/api/store/products')).json(); render();
})();
