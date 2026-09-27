/**
 * 管理员认证：密码只存哈希（scrypt + 随机盐），会话令牌是 HMAC 签名的短票据。
 *
 * - 任何地方都不保存明文密码；
 * - 令牌 7 天过期，改密码（换 session_secret）后全部立即失效；
 * - 校验全程使用 timingSafeEqual，避免时序侧信道。
 */

import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.mjs';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const TOKEN_TTL = 7 * 24 * 3600 * 1000; // 7 天

/** 生成 `scrypt$N$r$p$salt$hash` 格式的密码哈希 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/** 校验密码（恒定时间比较） */
export function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 会话密钥：首次生成后保存在 settings，改密码时一并换掉 → 旧令牌全失效 */
async function sessionSecret() {
  let secret = await getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setSetting('session_secret', secret);
  }
  return secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** 签发令牌：base64url(payload).base64url(hmac) */
export async function issueToken() {
  const secret = await sessionSecret();
  const payload = b64url(
    JSON.stringify({ iat: Date.now(), exp: Date.now() + TOKEN_TTL, v: 1 })
  );
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** 校验令牌 */
export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  try {
    const secret = await sessionSecret();
    const [payload, sig] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    return Boolean(data && data.exp > Date.now());
  } catch {
    return false;
  }
}

/** 读取并校验请求的 Bearer 令牌（同时兼容旧的 ADMIN_TOKEN 环境变量） */
export async function checkAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;

  const legacy = process.env.ADMIN_TOKEN || '';
  if (legacy && token === legacy) return true; // 保留 curl 便利通道

  return verifyToken(token);
}

/* ---------- 登录限流（进程内，够用） ---------- */

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

export function recordLoginFailure(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  attempts.set(ip, list);
}

export function clearLoginFailures(ip) {
  attempts.delete(ip);
}
