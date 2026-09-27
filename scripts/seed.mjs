#!/usr/bin/env node
/**
 * 首次上线前把 data/*.js 内置内容灌进数据库（Turso / 本地 store.json）。
 *
 *   npm run seed            内容库为空时导入；非空则跳过
 *   npm run seed -- --force 无论是否为空都追加导入（会自动去重 slug）
 *
 * 之后日常维护只在后台上传 AI 文档即可，无需再跑构建。
 */

import crypto from 'node:crypto';
import { seedContentRows } from '../lib/content.mjs';
import { listContentRows, insertContentRows } from '../lib/db.mjs';
import { todayCN } from '../lib/config.mjs';

const force = process.argv.includes('--force');
const today = todayCN();

const existing = await listContentRows({});
const existingSlugs = new Set(existing.map((r) => r.slug));

if (existing.length > 0 && !force) {
  console.log(`内容库已有 ${existing.length} 条，跳过导入。（要强制追加请加 --force）`);
  process.exit(0);
}

const rows = seedContentRows()
  .filter((r) => !existingSlugs.has(r.slug))
  .map((r) => ({
    ...r,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

if (rows.length === 0) {
  console.log('没有可导入的新内容（slug 已全部存在）。');
  process.exit(0);
}

await insertContentRows(rows);

const live = rows.filter((r) => r.publish_at && r.publish_at <= today).length;
const future = rows.length - live;
console.log(
  `导入完成：共 ${rows.length} 条（已上线 ${live} 条、未来排期 ${future} 条） → ${process.env.TURSO_DATABASE_URL ? 'Turso 数据库' : '本地 data/store.json'}`
);
console.log('提示：已上线条目按原日期回填，因此站点内容与静态版完全一致。');
