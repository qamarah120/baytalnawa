// بيانات السوق: مؤشرات وأخبار (Yahoo Finance + Google News RSS). تفشل بهدوء عند انقطاع الشبكة.
import { getSetting } from './db.js';

// ملاحظة: المؤشرات من Yahoo Finance (مصدر تجاري وليست رسمية). استخدم روابط المصادر الرسمية للتحقق.
export const INDICATORS = [
  { sym: '^TASI.SR', name: 'تاسي (السوق السعودي)', group: 'السعودية' },
  { sym: 'SAR=X', name: 'الدولار / الريال', group: 'السعودية', digits: 4 },
  { sym: '^DFMGI', name: 'سوق دبي المالي', group: 'الخليج' },
  { sym: '^ADI', name: 'سوق أبوظبي', group: 'الخليج' },
  { sym: '^GSPC', name: 'S&P 500', group: 'العالم' },
  { sym: '^STOXX50E', name: 'يورو ستوكس 50', group: 'العالم' },
  { sym: 'BZ=F', name: 'نفط برنت', group: 'السلع' },
  { sym: 'GC=F', name: 'الذهب', group: 'السلع' },
  { sym: 'KC=F', name: 'القهوة (عقود آجلة)', group: 'السلع', buy: 'قهوة' },
  { sym: 'SB=F', name: 'السكر', group: 'السلع', buy: 'حلويات' },
  { sym: 'ZL=F', name: 'زيت الصويا', group: 'السلع', buy: 'سمن' },
];

// المصادر الرسمية فقط. الأخبار لا تُعرض إلا إذا كان مصدرها أحد هذه النطاقات.
export const OFFICIAL = {
  saudi: [
    { name: 'وكالة الأنباء السعودية (واس)', host: 'spa.gov.sa', url: 'https://www.spa.gov.sa', desc: 'الأخبار الرسمية للمملكة' },
    { name: 'السوق المالية السعودية (تداول)', host: 'saudiexchange.sa', url: 'https://www.saudiexchange.sa', desc: 'مؤشر تاسي وإعلانات الشركات' },
    { name: 'البنك المركزي السعودي (ساما)', host: 'sama.gov.sa', url: 'https://www.sama.gov.sa', desc: 'السياسة النقدية وأسعار الصرف' },
    { name: 'الهيئة العامة للإحصاء', host: 'stats.gov.sa', url: 'https://www.stats.gov.sa', desc: 'التضخم والرقم القياسي لأسعار المستهلك' },
    { name: 'وزارة المالية', host: 'mof.gov.sa', url: 'https://www.mof.gov.sa', desc: 'الميزانية والسياسة المالية' },
    { name: 'وزارة التجارة', host: 'mc.gov.sa', url: 'https://mc.gov.sa', desc: 'حماية المستهلك والتجارة والأسعار' },
    { name: 'هيئة الزكاة والضريبة والجمارك', host: 'zatca.gov.sa', url: 'https://zatca.gov.sa', desc: 'ضريبة القيمة المضافة والفوترة الإلكترونية والجمارك' },
  ],
  food: [
    { name: 'الهيئة العامة للغذاء والدواء', host: 'sfda.gov.sa', url: 'https://www.sfda.gov.sa', desc: 'اشتراطات الأغذية والتنبيهات والاستدعاء' },
    { name: 'وزارة البيئة والمياه والزراعة', host: 'mewa.gov.sa', url: 'https://www.mewa.gov.sa', desc: 'الزراعة والثروة الزراعية' },
    { name: 'المركز الوطني للنخيل والتمور', host: 'ncpd.gov.sa', url: 'https://ncpd.gov.sa', desc: 'قطاع النخيل والتمور' },
    { name: 'هيئة الزكاة والضريبة والجمارك', host: 'zatca.gov.sa', url: 'https://zatca.gov.sa', desc: 'الرسوم الجمركية على الواردات' },
    { name: 'وزارة التجارة', host: 'mc.gov.sa', url: 'https://mc.gov.sa', desc: 'الرقابة على الأسواق' },
    { name: 'منظمة الأغذية والزراعة (FAO)', host: 'fao.org', url: 'https://www.fao.org/worldfoodsituation/foodpricesindex/en/', desc: 'مؤشر أسعار الغذاء العالمي' },
  ],
  gulf: [
    { name: 'الأمانة العامة لمجلس التعاون', host: 'gcc-sg.org', url: 'https://www.gcc-sg.org', desc: 'قرارات مجلس التعاون' },
    { name: 'مركز الإحصاء الخليجي', host: 'gccstat.org', url: 'https://gccstat.org', desc: 'إحصاءات دول الخليج' },
    { name: 'وكالة أنباء الإمارات (وام)', host: 'wam.ae', url: 'https://www.wam.ae', desc: 'الإمارات' },
    { name: 'وكالة الأنباء الكويتية (كونا)', host: 'kuna.net.kw', url: 'https://www.kuna.net.kw', desc: 'الكويت' },
    { name: 'وكالة الأنباء القطرية (قنا)', host: 'qna.org.qa', url: 'https://www.qna.org.qa', desc: 'قطر' },
    { name: 'وكالة أنباء البحرين', host: 'bna.bh', url: 'https://www.bna.bh', desc: 'البحرين' },
    { name: 'وكالة الأنباء العمانية', host: 'omannews.gov.om', url: 'https://omannews.gov.om', desc: 'عُمان' },
  ],
  world: [
    { name: 'صندوق النقد الدولي', host: 'imf.org', url: 'https://www.imf.org', desc: 'توقعات الاقتصاد العالمي' },
    { name: 'البنك الدولي', host: 'worldbank.org', url: 'https://www.worldbank.org', desc: 'بيانات وتقارير التنمية والسلع' },
    { name: 'منظمة الأغذية والزراعة (FAO)', host: 'fao.org', url: 'https://www.fao.org', desc: 'الغذاء والزراعة' },
    { name: 'منظمة التجارة العالمية', host: 'wto.org', url: 'https://www.wto.org', desc: 'التجارة الدولية' },
    { name: 'أوبك', host: 'opec.org', url: 'https://www.opec.org', desc: 'النفط' },
  ],
};
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v;
  try { const v = await fn(); cache.set(key, { t: Date.now(), v }); return v; }
  catch (e) { if (c) return c.v; throw e; }
}
const fetchT = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'Mozilla/5.0 BaytAlNawa' } });

async function quote(i) {
  const r = await fetchT(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(i.sym)}?range=1mo&interval=1d`);
  if (!r.ok) throw new Error('http ' + r.status);
  const res = (await r.json()).chart.result[0];
  const closes = res.indicators.quote[0].close.filter((x) => x != null);
  const price = res.meta.regularMarketPrice ?? closes.at(-1);
  const prev = closes.length > 1 ? closes.at(-2) : res.meta.chartPreviousClose;
  const week = closes.length > 5 ? closes.at(-6) : closes[0];
  return {
    ...i, price, change: prev ? ((price - prev) / prev) * 100 : null,
    week_change: week ? ((price - week) / week) * 100 : null, series: closes.slice(-20),
  };
}

export async function indicators() {
  return cached('ind', 10 * 60e3, async () => {
    const res = await Promise.allSettled(INDICATORS.map(quote));
    const items = res.map((r, k) => (r.status === 'fulfilled' ? r.value : { ...INDICATORS[k], error: true }));
    const insights = [];
    for (const q of items) {
      if (q.error || !q.buy || q.week_change == null) continue;
      if (q.week_change >= 3) insights.push({ level: 'warn', text: `${q.name} ارتفع ${q.week_change.toFixed(1)}% خلال أسبوع: قد ترتفع تكلفة ${q.buy}، فكّر في تثبيت أمر الشراء مبكراً.` });
      if (q.week_change <= -3) insights.push({ level: 'good', text: `${q.name} انخفض ${Math.abs(q.week_change).toFixed(1)}% خلال أسبوع: فرصة للتفاوض على سعر ${q.buy}.` });
    }
    return { updated: new Date().toISOString(), items, insights };
  });
}

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isOfficial = (srcUrl, list) => { const h = hostOf(srcUrl); return list.find((o) => h === o.host || h.endsWith('.' + o.host)); };

export async function news(cat = 'saudi') {
  const list = OFFICIAL[cat] || OFFICIAL.saudi;
  const q = `(${list.map((o) => 'site:' + o.host).join(' OR ')}) when:30d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ar&gl=SA&ceid=SA:ar`;
  return cached('news:' + cat, 15 * 60e3, async () => {
    const r = await fetchT(url);
    if (!r.ok) throw new Error('http ' + r.status);
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const src = (m[1].match(/<source[^>]*url="([^"]+)"/) || [])[1] || '';
      const off = isOfficial(src, list);
      return { title: tag(m[1], 'title'), link: tag(m[1], 'link'), source: off ? off.name : tag(m[1], 'source'), host: off?.host || hostOf(src), date: tag(m[1], 'pubDate'), official: !!off };
    }).filter((n) => n.official && /^https?:\/\//.test(n.link)).slice(0, 20); // مصادر رسمية فقط
  });
}
export const NEWS_CATEGORIES = { saudi: 'السعودية', food: 'الغذاء والتجارة', gulf: 'الخليج', world: 'العالم' };
