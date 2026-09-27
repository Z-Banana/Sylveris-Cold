/**
 * 零依赖读取项目根目录的 `.env`（本地开发用；Vercel 会直接注入环境变量，
 * 云端没有 `.env` 文件时本模块是无操作的）。
 *
 * 规则：
 * - 一行一个 `KEY=VALUE`，`#` 开头是注释；
 * - 值可以用成对的单/双引号包起来；
 * - **已存在的环境变量优先**，不会被覆盖（不会破坏系统变量）。
 *
 * 用法：在需要环境变量的入口文件顶部 `import '../lib/env.mjs';`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parse(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** 显式加载指定文件；文件不存在时静默返回 */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const vars = parse(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
  return vars;
}

// 导入即生效
loadEnv();
