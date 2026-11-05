document.getElementById('yr').textContent = new Date().getFullYear();
fetch('/api/landing').then((r) => r.json()).then((d) => {
  document.querySelectorAll('.nm').forEach((e) => (e.textContent = d.name));
  document.title = d.name + ' | مكسرات · تمور · قهوة · عسل';
  const msg = encodeURIComponent('السلام عليكم، أود الاستفسار عن منتجاتكم');
  document.querySelectorAll('a.wa').forEach((a) => { if (d.whatsapp) { a.hidden = false; a.href = `https://wa.me/${d.whatsapp}?text=${msg}`; a.target = '_blank'; a.rel = 'noopener'; } });
  const ph = document.querySelector('a.ph'); if (d.phone) { ph.hidden = false; ph.href = 'tel:' + d.phone; ph.textContent = 'اتصال: ' + d.phone; }
  if (d.city) { const c = document.getElementById('city'); c.hidden = false; c.textContent = '📍 ' + d.city; }
  if (!d.whatsapp && !d.phone) document.getElementById('csub').textContent = 'بيانات التواصل ستتوفر قريباً.';
}).catch(() => {});
