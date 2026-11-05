import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, get } from './db.js';

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const k = crypto.scryptSync(pw, salt, 32);
  const b = Buffer.from(key, 'hex');
  return b.length === k.length && crypto.timingSafeEqual(k, b);
}
const b64 = (b) => Buffer.from(b).toString('base64url');
export function signToken(user, ttlSec = 12 * 3600) {
  const payload = b64(JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function userFromToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), c = Buffer.from(exp);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (data.exp < Date.now() / 1000) return null;
  const u = get('SELECT id,name,username,role,active FROM users WHERE id=?', data.id);
  return u && u.active ? u : null;
}
