import crypto from 'node:crypto';
import { get, run } from './db.js';
import { hashPassword } from './auth.js';

// ينشئ حساب المدير عند أول تشغيل بكلمة مرور عشوائية تُطبع مرة واحدة
export function ensureAdmin() {
  if (get('SELECT 1 FROM users LIMIT 1')) return;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  run("INSERT INTO users(name,username,pass_hash,role) VALUES('المدير','admin',?,'admin')", hashPassword(pw));
  console.log(`\n=== تم إنشاء حساب المدير ===\nاسم المستخدم: admin\nكلمة المرور: ${pw}\n(غيّرها بعد الدخول)\n`);
}
