// بيانات السوق: مؤشرات وأخبار (Yahoo Finance + Google News RSS). تفشل بهدوء عند انقطاع الشبكة.
import { getSetting } from './db.js';

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

const FEEDS = {
  saudi: 'السوق السعودي تداول أسهم',
  gulf: 'أسواق الخليج الاقتصاد',
  world: 'الاقتصاد العالمي الأسواق',
  commodities: 'أسعار القهوة التمور المكسرات العسل',
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

export async function news(cat = 'saudi') {
  let custom = {};
  try { custom = JSON.parse(getSetting('news_feeds', '{}')); } catch {}
  const q = custom[cat] || FEEDS[cat] || FEEDS.saudi;
  const url = q.startsWith('http') ? q : `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&hl=ar&gl=SA&ceid=SA:ar`;
  return cached('news:' + cat, 15 * 60e3, async () => {
    const r = await fetchT(url);
    if (!r.ok) throw new Error('http ' + r.status);
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15).map((m) => ({
      title: tag(m[1], 'title'), link: tag(m[1], 'link'), source: tag(m[1], 'source'), date: tag(m[1], 'pubDate'),
    })).filter((n) => /^https?:\/\//.test(n.link));
  });
}
export const NEWS_CATEGORIES = { saudi: 'السعودية', gulf: 'الخليج', world: 'العالم', commodities: 'السلع والمنتجات' };
