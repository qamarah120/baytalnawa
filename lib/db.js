import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dir, { recursive: true });
export const DATA_DIR = dir;
export const db = new DatabaseSync(process.env.DB_FILE || path.join(dir, 'baytalnawa.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'sales', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, job TEXT, phone TEXT,
  salary REAL DEFAULT 0, hired_at TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, country TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT DEFAULT 'كجم',
  price REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0, lead_days INTEGER NOT NULL DEFAULT 7,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT, image TEXT, offer_percent REAL NOT NULL DEFAULT 0, offer_ends TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, city TEXT,
  type TEXT DEFAULT 'فرد', notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT, customer_phone TEXT, user_id INTEGER, channel TEXT DEFAULT 'store',
  status TEXT NOT NULL DEFAULT 'pending', subtotal REAL DEFAULT 0, discount REAL DEFAULT 0,
  vat REAL DEFAULT 0, total REAL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, name TEXT,
  qty REAL NOT NULL, price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS purchase_orders(
  id INTEGER PRIMARY KEY, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft', total REAL DEFAULT 0, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_items(
  id INTEGER PRIMARY KEY, po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, name TEXT,
  qty REAL NOT NULL, cost REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

// ترحيلات خفيفة
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('products').includes('sku')) db.exec('ALTER TABLE products ADD COLUMN sku TEXT');
if (!cols('orders').includes('external_ref')) db.exec('ALTER TABLE orders ADD COLUMN external_ref TEXT');
if (!cols('orders').includes('stock_applied')) db.exec('ALTER TABLE orders ADD COLUMN stock_applied INTEGER NOT NULL DEFAULT 1');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_ref ON orders(external_ref) WHERE external_ref IS NOT NULL');

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : def;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}
