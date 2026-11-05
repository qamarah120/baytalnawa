// المحلل: يقترح أوامر الشراء والكميات بناءً على المبيعات الفعلية والمواسم السعودية.
import { all, get } from './db.js';

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric' });
export function hijri(d) {
  const p = Object.fromEntries(hijriFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { month: Number(p.month), day: Number(p.day) };
}

// مضاعفات الطلب الموسمية حسب الفئة
const SEASONS = {
  ramadan:   { 'تمور': 2.6, 'مكسرات': 1.8, 'حلويات': 1.8, 'قهوة': 1.5, 'بهارات': 1.4, 'سمن': 1.4, 'عسل': 1.3, 'أعشاب': 1.1 },
  eid:       { 'حلويات': 2.0, 'مكسرات': 1.6, 'قهوة': 1.5, 'تمور': 1.5, 'سمن': 1.2, 'عسل': 1.1, 'بهارات': 1.1, 'أعشاب': 1.0 },
  hajj:      { 'تمور': 1.3, 'قهوة': 1.2, 'مكسرات': 1.2 },
  national:  { 'حلويات': 1.2, 'مكسرات': 1.2, 'قهوة': 1.15 },
  winter:    { 'عسل': 1.4, 'أعشاب': 1.35, 'سمن': 1.2, 'قهوة': 1.2, 'مكسرات': 1.15, 'تمور': 1.1 },
  summer:    { 'عسل': 0.8, 'سمن': 0.85, 'قهوة': 0.9, 'أعشاب': 0.9 },
};
export const CATEGORIES = ['مكسرات', 'حلويات', 'بهارات', 'أعشاب', 'قهوة', 'تمور', 'سمن', 'عسل'];

export function seasonTags(d) {
  const h = hijri(d), tags = [];
  if (h.month === 9) tags.push('ramadan');
  if ((h.month === 10 && h.day <= 4) || (h.month === 12 && h.day >= 8 && h.day <= 14)) tags.push('eid');
  if (h.month === 12 && h.day <= 14) tags.push('hajj');
  if (d.getMonth() === 8 && d.getDate() >= 16 && d.getDate() <= 23) tags.push('national');
  const m = d.getMonth();
  if (m === 11 || m <= 1) tags.push('winter');
  if (m >= 5 && m <= 7) tags.push('summer');
  return tags;
}
const SEASON_AR = { ramadan: 'رمضان', eid: 'العيد', hajj: 'موسم الحج', national: 'اليوم الوطني', winter: 'الشتاء', summer: 'الصيف' };

// متوسط المضاعف الموسمي للفئة خلال الأيام القادمة
export function seasonFactor(category, startDate, days) {
  let sum = 0; const seen = new Set();
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    const tags = seasonTags(d);
    let f = 1;
    for (const t of tags) { const m = SEASONS[t]?.[category]; if (m) f = Math.max(f, m); }
    if (f === 1) for (const t of tags) { const m = SEASONS[t]?.[category]; if (m && m < 1) f = m; }
    sum += f;
    tags.forEach((t) => seen.add(t));
  }
  return { factor: sum / days, tags: [...seen].map((t) => SEASON_AR[t]) };
}

const REVIEW_DAYS = 30;     // نغطي الطلب لهذه المدة بعد وصول الشحنة
const SAFETY = 0.2;         // مخزون أمان 20%

export function reorderSuggestions(now = new Date()) {
  const since = (n) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const sold = (n) => Object.fromEntries(all(
    `SELECT oi.product_id id, SUM(oi.qty) q FROM order_items oi JOIN orders o ON o.id=oi.order_id
     WHERE o.status='completed' AND o.created_at >= ? GROUP BY oi.product_id`, since(n)).map((r) => [r.id, r.q]));
  const s30 = sold(30), s90 = sold(90);
  const out = [];
  for (const p of all('SELECT p.*, s.name supplier_name FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1')) {
    const r30 = (s30[p.id] || 0) / 30, r90 = (s90[p.id] || 0) / 90;
    const hasHistory = (s90[p.id] || 0) > 0;
    const rate = hasHistory ? 0.6 * r30 + 0.4 * r90 : 0;     // معدل يومي أساسي
    const cover = p.lead_days + REVIEW_DAYS;
    // الموسم المتوقع خلال فترة التغطية (بعد وصول الشحنة)
    const sf = seasonFactor(p.category, new Date(now.getTime() + p.lead_days * 86400000), REVIEW_DAYS);
    const demand = rate * sf.factor * REVIEW_DAYS + rate * p.lead_days;
    const target = Math.max(demand * (1 + SAFETY), p.reorder_level);
    const daysLeft = rate > 0 ? p.stock / rate : null;
    let qty = Math.max(0, Math.ceil(target - p.stock));
    if (p.unit !== 'كجم') qty = Math.ceil(qty); else qty = Math.ceil(qty * 2) / 2;
    let urgency = 'ok';
    if (p.stock <= 0 || (daysLeft !== null && daysLeft < p.lead_days) ) urgency = 'critical';
    else if (p.stock <= p.reorder_level || (daysLeft !== null && daysLeft < cover)) urgency = 'soon';
    if (qty === 0 && urgency === 'ok') continue;
    const reasons = [];
    if (hasHistory) reasons.push(`معدل البيع ≈ ${rate.toFixed(2)} ${p.unit}/يوم`);
    else reasons.push('لا توجد مبيعات سابقة، الاقتراح بحسب حد إعادة الطلب');
    if (daysLeft !== null) reasons.push(`يكفي المخزون ${Math.floor(daysLeft)} يوم`);
    if (sf.factor > 1.05) reasons.push(`طلب موسمي مرتفع ×${sf.factor.toFixed(2)} (${sf.tags.join('، ')})`);
    if (sf.factor < 0.95) reasons.push(`طلب موسمي منخفض ×${sf.factor.toFixed(2)} (${sf.tags.join('، ')})`);
    if (p.stock <= p.reorder_level) reasons.push('المخزون عند حد إعادة الطلب أو أقل');
    out.push({
      product_id: p.id, name: p.name, category: p.category, unit: p.unit, stock: p.stock,
      supplier_id: p.supplier_id, supplier_name: p.supplier_name, cost: p.cost,
      daily_rate: Number(rate.toFixed(3)), days_left: daysLeft === null ? null : Math.floor(daysLeft),
      season_factor: Number(sf.factor.toFixed(2)), suggested_qty: qty,
      estimated_cost: Number((qty * p.cost).toFixed(2)), urgency, reasons,
    });
  }
  const rank = { critical: 0, soon: 1, ok: 2 };
  return out.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.estimated_cost - a.estimated_cost);
}

// تنبيهات مالية وتشغيلية
export function businessInsights() {
  const ins = [];
  for (const p of all("SELECT * FROM products WHERE active=1 AND price>0")) {
    const margin = (p.price - p.cost) / p.price;
    if (p.cost > 0 && margin < 0.15) ins.push({ level: 'warn', text: `هامش ربح ${p.name} منخفض (${(margin * 100).toFixed(0)}%) راجع السعر أو تكلفة الشراء.` });
  }
  const dead = all(`SELECT p.name, p.stock, p.cost FROM products p WHERE p.active=1 AND p.stock>0 AND p.id NOT IN (
      SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.status='completed' AND o.created_at >= datetime('now','-60 days') AND oi.product_id IS NOT NULL)`);
  for (const d of dead) ins.push({ level: 'info', text: `${d.name}: لا مبيعات منذ 60 يوماً ومخزونه ${d.stock} (قيمة ${(d.stock * d.cost).toFixed(0)} ر.س) فكّر في عرض لتصريفه.` });
  const exp = all("SELECT name, offer_ends FROM products WHERE active=1 AND offer_percent>0 AND offer_ends IS NOT NULL AND offer_ends BETWEEN date('now') AND date('now','+3 days')");
  for (const e of exp) ins.push({ level: 'info', text: `عرض ${e.name} ينتهي في ${e.offer_ends}.` });
  const upcoming = seasonTags(new Date(Date.now() + 30 * 86400000)).filter((t) => ['ramadan', 'eid', 'national'].includes(t));
  for (const t of upcoming) ins.push({ level: 'season', text: `موسم ${SEASON_AR[t]} خلال 30 يوماً: اطلب مبكراً لتغطية الطلب المتوقع.` });
  return ins;
}
