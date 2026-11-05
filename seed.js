// بيانات تجريبية: node seed.js  (يعمل فقط على قاعدة فارغة من المنتجات)
import { get, run, tx } from './lib/db.js';
import { ensureAdmin } from './lib/bootstrap.js';
import { hashPassword } from './lib/auth.js';

ensureAdmin();
if (get('SELECT 1 FROM products LIMIT 1')) { console.log('توجد منتجات مسبقاً، لم يتم التعبئة.'); process.exit(0); }

const sup = {};
for (const [n, c] of [['مزارع القصيم للتمور', 'السعودية'], ['شركة الخليج للمكسرات', 'الإمارات'], ['بهارات الشرق', 'الهند'], ['نحّالو عسير', 'السعودية'], ['محمصة البن اليمني', 'اليمن'], ['ألبان الجزيرة', 'السعودية']])
  sup[n] = Number(run('INSERT INTO suppliers(name,country) VALUES(?,?)', n, c).lastInsertRowid);

// [الاسم، الفئة، الوحدة، سعر البيع، التكلفة، المخزون، حد الطلب، مدة التوريد، المورّد، المبيعات اليومية التقريبية]
const P = [
  ['تمر سكري القصيم', 'تمور', 'كجم', 45, 28, 120, 40, 5, 'مزارع القصيم للتمور', 4],
  ['تمر عجوة المدينة', 'تمور', 'كجم', 80, 55, 60, 25, 5, 'مزارع القصيم للتمور', 2],
  ['تمر خلاص', 'تمور', 'كجم', 40, 24, 8, 30, 5, 'مزارع القصيم للتمور', 3],
  ['لوز محمص', 'مكسرات', 'كجم', 85, 60, 35, 20, 10, 'شركة الخليج للمكسرات', 2.5],
  ['كاجو', 'مكسرات', 'كجم', 95, 70, 50, 20, 10, 'شركة الخليج للمكسرات', 2],
  ['فستق حلبي', 'مكسرات', 'كجم', 130, 98, 15, 15, 10, 'شركة الخليج للمكسرات', 1.2],
  ['بقلاوة مشكلة', 'حلويات', 'كجم', 70, 42, 25, 15, 3, 'شركة الخليج للمكسرات', 2],
  ['معمول بالتمر', 'حلويات', 'كجم', 55, 30, 30, 15, 3, 'مزارع القصيم للتمور', 1.5],
  ['كمون', 'بهارات', 'كجم', 30, 17, 40, 15, 14, 'بهارات الشرق', 1],
  ['هيل أخضر', 'بهارات', 'كجم', 260, 200, 10, 5, 14, 'بهارات الشرق', 0.4],
  ['زعفران', 'بهارات', 'جرام', 12, 8, 300, 100, 14, 'بهارات الشرق', 8],
  ['مرمية', 'أعشاب', 'كجم', 60, 35, 12, 5, 7, 'بهارات الشرق', 0.5],
  ['زنجبيل مجفف', 'أعشاب', 'كجم', 50, 30, 18, 8, 7, 'بهارات الشرق', 0.6],
  ['قهوة عربية محمصة', 'قهوة', 'كجم', 120, 80, 40, 15, 7, 'محمصة البن اليمني', 2],
  ['بن يمني', 'قهوة', 'كجم', 150, 105, 22, 10, 7, 'محمصة البن اليمني', 1.2],
  ['سمن بلدي', 'سمن', 'كجم', 75, 52, 28, 12, 7, 'ألبان الجزيرة', 1.5],
  ['عسل سدر', 'عسل', 'كجم', 350, 250, 20, 8, 10, 'نحّالو عسير', 0.9],
  ['عسل طلح', 'عسل', 'كجم', 220, 150, 25, 8, 10, 'نحّالو عسير', 1],
];
tx(() => {
  const ids = [];
  for (const [n, c, u, pr, co, st, ro, ld, s, rate] of P) {
    const id = Number(run(`INSERT INTO products(name,category,unit,price,cost,stock,reorder_level,lead_days,supplier_id,description) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      n, c, u, pr, co, st, ro, ld, sup[s] || sup['مزارع القصيم للتمور'], `${n} فاخر من بيت النوى`).lastInsertRowid);
    ids.push([id, pr, co, rate, c]);
  }
  run("UPDATE products SET offer_percent=15, offer_ends=date('now','+14 days') WHERE name IN ('تمر خلاص','معمول بالتمر')");
  const cities = ['الرياض', 'جدة', 'الدمام', 'بريدة', 'المدينة'];
  const custs = ['محمد العتيبي', 'سارة القحطاني', 'عبدالله الشمري', 'نورة الدوسري', 'فهد الحربي', 'مطعم الديوان', 'مقهى الريف'].map((n, i) =>
    Number(run('INSERT INTO customers(name,phone,city,type) VALUES(?,?,?,?)', n, '05' + String(10000000 + i * 1111111), cities[i % 5], i > 4 ? 'تجاري' : 'فرد').lastInsertRowid));
  for (const [n, j, s] of [['خالد المطيري', 'مدير المبيعات', 9000], ['ريم الغامدي', 'محاسبة', 7500], ['يوسف الزهراني', 'مسؤول مخزون', 6000]])
    run('INSERT INTO employees(name,job,salary,hired_at,phone) VALUES(?,?,?,?,?)', n, j, s, '2025-01-01', '0500000000');
  // مبيعات 90 يوماً
  let seedN = 7; const rnd = () => (seedN = (seedN * 16807) % 2147483647) / 2147483647;
  for (let d = 90; d >= 1; d--) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    for (let k = 0; k < 4; k++) {
      const o = Number(run("INSERT INTO orders(customer_id,channel,status,created_at) VALUES(?,'pos','completed',?)", custs[Math.floor(rnd() * custs.length)], `${day} ${10 + k * 3}:00:00`).lastInsertRowid);
      let sub = 0;
      for (const [id, pr, co, rate] of ids.filter(() => rnd() < 0.35)) {
        const qty = Math.max(0.5, Math.round(rate * (0.5 + rnd()) * 2) / 2);
        run('INSERT INTO order_items(order_id,product_id,name,qty,price,cost) VALUES(?,?,(SELECT name FROM products WHERE id=?),?,?,?)', o, id, id, qty, pr, co);
        sub += qty * pr;
      }
      sub = Math.round(sub * 100) / 100;
      run('UPDATE orders SET subtotal=?,total=?,vat=? WHERE id=?', sub, sub, Math.round(sub * 15 / 115 * 100) / 100, o);
    }
  }
  run("DELETE FROM orders WHERE total=0");
});
if (!get("SELECT 1 FROM users WHERE username='sales'")) {
  run("INSERT INTO users(name,username,pass_hash,role) VALUES('موظف مبيعات','sales',?,'sales')", hashPassword('sales12345'));
  console.log('حساب تجريبي: sales / sales12345');
}
console.log('تمت تعبئة البيانات التجريبية.');
