#!/usr/bin/env node
/**
 * 设置/重置管理台密码（只存 scrypt 哈希，绝不保存明文）。
 *
 *   npm run set-password              交互式输入（终端不回显）
 *   npm run set-password -- MyP@ss    直接用参数设置（注意别加进 shell 历史）
 *   npm run set-password -- --check   检查是否已设置密码
 *
 * 写入位置：Turso 数据库的 settings 表（未配置 Turso 时写 data/store.json）。
 * 密码同时决定会话签名密钥 → 修改密码会让已登录的令牌全部失效。
 */

import readline from 'node:readline';
import { getSetting, setSetting } from '../lib/db.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { adminPath } from '../lib/config.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');

if (args.includes('--check')) {
  const stored = await getSetting('admin_password');
  console.log(stored ? '已设置密码。' : '尚未设置密码。');
  console.log(`后台路径：${adminPath()}`);
  process.exit(0);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const write = rl.output.write.bind(rl.output);
    let muted = false;
    rl.output.write = (chunk, ...rest) => {
      if (muted && typeof chunk === 'string' && !/[\r\n]/.test(chunk)) return true;
      return write(chunk, ...rest);
    };
    rl.question(question, (answer) => {
      muted = false;
      rl.close();
      resolve(answer);
    });
    muted = true; // 开始提问后隐藏回显
  });
}

async function main() {
  let password = args[0];

  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('非交互环境请用参数：npm run set-password -- <密码>');
      process.exit(1);
    }
    password = await askHidden('设置管理密码（至少 8 位）: ');
    process.stdout.write('\n');
    const again = await askHidden('再输入一次确认: ');
    process.stdout.write('\n');
    if (password !== again) {
      console.error('两次输入不一致，未设置。');
      process.exit(1);
    }
  }

  if (!password || password.length < 8) {
    console.error('密码太短：至少 8 位。');
    process.exit(1);
  }

  const prev = await getSetting('admin_password');
  await setSetting('admin_password', hashPassword(password));
  // 换密码同时换会话密钥 → 让所有已登录令牌立即失效
  await setSetting('session_secret', (await import('node:crypto')).randomBytes(32).toString('hex'));

  console.log(prev ? '密码已重置（旧登录已全部失效）。' : '密码已设置（只保存哈希，明文不留存）。');
  console.log(`后台路径：${adminPath()}`);
  console.log('该路径不在站内任何地方链接，也不进 sitemap / robots 白名单。');
}

await main();
