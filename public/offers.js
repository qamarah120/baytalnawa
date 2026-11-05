const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { 'مكسرات': '🥜', 'حلويات': '🍰', 'بهارات': '🌶️', 'أعشاب': '🌿', 'قهوة': '☕', 'تمور': '🌴', 'سمن': '🧈', 'عسل': '🍯' };
const fmt = (n) => Number(n).toLocaleString('ar-SA', { maximumFractionDigits: 2 }) + ' ر.س';
$('#yr').textContent = new Date().getFullYear();
let data = { offers: [] }, cat = 'الكل';
function daysLeft(e) { if (!e) return null; const d = Math.ceil((new Date(e + 'T23:59:59') - Date.now()) / 86400000); return d; }
function draw() {
  const cats = ['الكل', ...new Set(data.offers.map((o) => o.category))];
  $('#chips').innerHTML = cats.length > 2 ? cats.map((c) => `<button class="${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('') : '';
  const f = data.offers.filter((o) => cat === 'الكل' || o.category === cat);
  $('#empty').hidden = f.length > 0;
  $('#list').innerHTML = f.map((o) => {
    const d = daysLeft(o.ends);
    const wa = data.whatsapp ? `<a class="btn gold sm" target="_blank" rel="noopener" href="https://wa.me/${esc(data.whatsapp)}?text=${encodeURIComponent('أرغب بالاستفسار عن عرض: ' + o.name)}">اسأل عن العرض</a>` : '';
    return `<article class="offer"><span class="pct">-${esc(o.percent)}%</span><div class="oi">${ICON[o.category] || '🛍️'}</div><h3>${esc(o.name)}</h3><small class="l">${esc(o.category)} · ${esc(o.unit)}</small>
    ${o.description ? `<p class="od">${esc(o.description)}</p>` : ''}<div class="pr"><s>${fmt(o.price)}</s> <b>${fmt(o.final_price)}</b></div>
    ${o.ends ? `<small class="end">${d <= 0 ? 'ينتهي اليوم' : d <= 3 ? `باقي ${d} ${d === 1 ? 'يوم' : 'أيام'} فقط` : 'ينتهي في ' + esc(o.ends)}</small>` : ''}<div>${wa}</div></article>`;
  }).join('');
}
document.addEventListener('click', (e) => { const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; draw(); } });
fetch('/api/offers').then((r) => r.json()).then((d) => { data = d; document.querySelectorAll('.nm').forEach((e) => (e.textContent = d.name)); draw(); }).catch(() => { $('#empty').hidden = false; $('#empty').textContent = 'تعذر تحميل العروض.'; });
