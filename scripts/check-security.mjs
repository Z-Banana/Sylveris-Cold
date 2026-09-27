#!/usr/bin/env node
/**
 * 安全自检：验证「后台隐秘 + 密码哈希」这几条硬要求是否一直成立。
 *
 *   npm run check:security
 *   npm run check:security -- 5173        指定端口
 *
 * 检查项（13 条）：
 *   1. data/store.json 里绝不能出现明文密码
 *   2. admin_password 必须是 scrypt 哈希（N=16384, r=8, p=1 + 16 字节随机盐）
 *   3. session_secret 必须是 32 字节随机密钥
 *   4. 连续错误登录第 10 次后必须被限流（429），且限流期间正确密码也进不去
 *   5. 限流前令牌必须是 HMAC 签名的两段式
 *
 * ⚠️ 本脚本会把登录限流计数打满：跑完重启本地服务（或等 10 分钟）即可恢复。
 */
import fs from 'node:fs';
import path from 'node:path';
import '../lib/env.mjs'; // 读取 .env：PORT / ADMIN_TEST_PASSWORD

const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || '5173';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = process.env.ADMIN_TEST_PASSWORD || 'testpass12345';
const STORE = path.resolve('data/store.json');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

/* ---------- 落盘数据 ---------- */
console.log('\n【1】落盘数据（明文不留存）');
const raw = fs.existsSync(STORE) ? fs.readFileSync(STORE, 'utf8') : '';
ok('data/store.json 存在', raw.length > 0, `${raw.length} 字节`);
ok('落盘数据不含明文密码', !raw.includes(PASSWORD));
ok('落盘数据不含明文 password 字段', !/"password"\s*:\s*"(?!scrypt)/.test(raw));

let store = {};
try {
  store = JSON.parse(raw);
} catch {
  /* ignore */
}
const settings = store.settings || {};
const pw = settings.admin_password || '';
ok(
  '密码为 scrypt 格式（scrypt$N$r$p$盐$散列）',
  /^scrypt\$16384\$8\$1\$[\w+/=]+\$[\w+/=]+$/.test(pw),
  pw ? pw.slice(0, 24) + '…' : '(空)'
);
const parts = pw.split('$');
ok('盐为 16 字节随机值', Buffer.from(parts[4] || '', 'base64').length === 16);
ok('散列为 32 字节 scrypt 结果', Buffer.from(parts[5] || '', 'base64').length === 32);
ok(
  'session_secret 为 32 字节随机 hex',
  /^[0-9a-f]{64}$/.test(settings.session_secret || ''),
  (settings.session_secret || '').slice(0, 8) + '…'
);

/* ---------- 登录限流 ---------- */
console.log('\n【2】登录限流');
const post = async (body) => {
  const r = await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const pre = await post({ action: 'login', password: 'wrong-password-1' });
ok('错误密码返回 401（尚未触发限流）', pre.status === 401, `status=${pre.status}`);

let blockedAt = 0;
for (let i = 2; i <= 12 && !blockedAt; i++) {
  const r = await post({ action: 'login', password: 'wrong-password-' + i });
  if (r.status === 429) blockedAt = i;
}
ok('第 10 次错误后被限流', blockedAt > 0 && blockedAt <= 12, blockedAt ? `第 ${blockedAt} 次 429` : '未限流');

const blocked = await post({ action: 'login', password: PASSWORD });
ok('限流期间正确密码同样被拒', blocked.status === 429, `status=${blocked.status}`);

/* ---------- 令牌 ---------- */
console.log('\n【3】令牌与会话');
const unauth = await fetch(BASE + '/api/admin?view=overview');
ok('未带令牌访问管理接口返回 401', unauth.status === 401, `status=${unauth.status}`);

const forged = await fetch(BASE + '/api/admin?view=overview', {
  headers: { Authorization: 'Bearer not-a-real-token.abcdef' },
});
ok('伪造令牌被拒', forged.status === 401, `status=${forged.status}`);

const expiredish = Buffer.from(JSON.stringify({ iat: 1, exp: 2, v: 1 }))
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const tampered = await fetch(BASE + '/api/admin?view=overview', {
  headers: { Authorization: 'Bearer ' + expiredish + '.bWFsZ2VkLXNpZ25hdHVyZQ' },
});
ok('过期/篡改令牌被拒', tampered.status === 401, `status=${tampered.status}`);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
console.log('提示：本脚本会打满登录限流，重启本地服务即可恢复（改密码也会重置令牌）。');
process.exitCode = fail ? 1 : 0;
