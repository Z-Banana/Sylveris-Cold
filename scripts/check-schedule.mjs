#!/usr/bin/env node
/**
 * 排期语义验证（跑完自动清理）：
 *   1. 明天槽位已有内容时，「插队」应把后面整体后移一天，插队那条落在明天。
 *   2. 审核通过的投稿同样占明天槽位，原占位者顺延。
 *
 * 用法：node scripts/check-schedule.mjs [端口]
 */

import '../lib/env.mjs'; // 读取 .env：PORT / ADMIN_TEST_PASSWORD
import { deleteSubmission } from '../lib/db.mjs'; // 投稿表没有删除接口，测试残留自己清

const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || '5173';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = process.env.ADMIN_TEST_PASSWORD || 'testpass12345';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const loginRes = await fetch(BASE + '/api/admin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'login', password: PASSWORD }),
});
const { token } = await loginRes.json();
if (!token) {
  console.error('登录失败，请先运行 npm run set-password -- <密码>');
  process.exit(1);
}

const api = {
  post: async (body) => {
    const r = await fetch(BASE + '/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  },
  get: async (q) => {
    const r = await fetch(BASE + '/api/admin?' + q, {
      headers: { Authorization: 'Bearer ' + token },
    });
    return r.json();
  },
};

const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const tomorrow = addDays(today, 1);

const created = [];
let subId = null; // 本次测试用的投稿记录 id
const cleanup = async () => {
  for (const id of created) await api.post({ action: 'delete', id });
};

/** 分页取全部待上线内容（接口默认只给 50 条、单次最多 200 条） */
const allQueued = async () => {
  const out = [];
  for (let offset = 0; offset <= 4000; offset += 200) {
    const r = await api.get(`view=content&filter=queued&limit=200&offset=${offset}`);
    out.push(...(r.rows || []));
    if ((r.rows || []).length < 200) break;
  }
  return out;
};

// 快照线上排期：插队与「投稿通过」都会把 >= 明天的内容整体后移一天，测试结束必须拨回
const scheduleBefore = new Map((await allQueued()).map((r) => [r.id, r.publish_at]));

const restore = async () => {
  const pending = [];
  for (const row of await allQueued()) {
    const orig = scheduleBefore.get(row.id);
    if (orig && row.publish_at !== orig) pending.push([row.id, orig]);
  }
  let shifted = 0;
  for (let i = 0; i < pending.length; i += 8) {
    const res = await Promise.all(
      pending.slice(i, i + 8).map(([id, publish_at]) => api.post({ action: 'update', id, fields: { publish_at } }))
    );
    shifted += res.filter((r) => r.json.ok).length;
  }
  const after = await allQueued();
  ok(
    '线上排期已还原（排期测试不留后移）',
    after.every((r) => !scheduleBefore.has(r.id) || scheduleBefore.get(r.id) === r.publish_at),
    `回拨 ${shifted} 条`
  );
};

try {
  console.log('\n【插队排期】');

  // 从明天起连续排 3 条
  const text = ['【冷知】', '正文：排期验证条目甲，正文足够长以便识别。', '---',
    '【冷知】', '正文：排期验证条目乙，正文足够长以便识别。', '---',
    '【冷知】', '正文：排期验证条目丙，正文足够长以便识别。'].join('\n');
  const ins = await api.post({ action: 'import', text, dryRun: false, startDate: tomorrow });
  ok('导入 3 条（明天起）', ins.json.inserted === 3, `起=${ins.json.startDate}`);

  const rows = (await allQueued()).filter((r) => (r.body || '').includes('排期验证条目'));
  for (const r of rows) created.push(r.id);

  const byBody = Object.fromEntries(rows.map((r) => [r.body.slice(0, 20), r]));
  const get = (k) => rows.find((r) => r.body.includes(k));
  const jia = get('甲');
  const yi = get('乙');
  const bing = get('丙');

  const dates0 = rows.map((r) => r.publish_at).sort();
  ok('三条按明天/后天/大后天排列',
    dates0.join(',') === [tomorrow, addDays(tomorrow, 1), addDays(tomorrow, 2)].sort().join(','),
    dates0.join(' , '));

  // 对「丙」插队：它应变成明天，甲、乙各后移一天
  const j = await api.post({ action: 'jump', id: bing.id });
  ok('插队返回明天', j.json.publishAt === tomorrow, `publishAt=${j.json.publishAt}`);

  const rows2 = (await allQueued()).filter((r) => (r.body || '').includes('排期验证条目'));
  const jia2 = rows2.find((r) => r.id === jia.id);
  const yi2 = rows2.find((r) => r.id === yi.id);
  const bing2 = rows2.find((r) => r.id === bing.id);

  ok('丙排在明天（插队成功）', bing2.publish_at === tomorrow, bing2.publish_at);
  ok('甲顺延到后天', jia2.publish_at === addDays(tomorrow, 1), jia2.publish_at);
  ok('乙顺延到大后天', yi2.publish_at === addDays(tomorrow, 2), yi2.publish_at);
  ok('整体仍是一天一条、无空档',
    [bing2.publish_at, jia2.publish_at, yi2.publish_at].sort().join(',') ===
      [tomorrow, addDays(tomorrow, 1), addDays(tomorrow, 2)].sort().join(','));

  // 投稿通过也应占明天槽位并让位
  console.log('\n【审核插队】');
  await fetch(BASE + '/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'fact', body: '排期验证投稿：穿山甲一次能产一只幼崽，且靠舌头觅食。', author: '测试', website: '' }),
  });
  const pend = await api.get('view=submissions&status=pending');
  const sub = (pend.rows || []).find((r) => r.body.includes('排期验证投稿'));
  ok('投稿进入待审', Boolean(sub));

  if (sub) {
    subId = sub.id;
    const ap = await api.post({ action: 'approve', id: sub.id });
    ok('通过后排在明天', ap.json.publishAt === tomorrow, `publishAt=${ap.json.publishAt}`);

    const rows3 = await allQueued();
    const reader = rows3.find((r) => r.body.includes('排期验证投稿'));
    if (reader) created.push(reader.id);
    const readerNext = rows3.filter((r) => (r.body || '').includes('排期验证条目'));

    ok('原明天占位者（丙）顺延到后天',
      readerNext.find((r) => r.id === bing.id)?.publish_at === addDays(tomorrow, 1),
      readerNext.find((r) => r.id === bing.id)?.publish_at);
    // 线上内容本来就有同一天多条（冷知 + 冷笑话同日），所以只校验测试排期自身连续无空档
    const testDates = [
      ...new Set(rows3.filter((r) => /排期验证/.test(String(r.body || ''))).map((r) => r.publish_at)),
    ].sort();
    const span = testDates.length
      ? Math.round((new Date(testDates.at(-1) + 'T00:00:00Z') - new Date(testDates[0] + 'T00:00:00Z')) / 86400000) + 1
      : 0;
    ok('测试排期从明天起连续、无空档', testDates.length === span && testDates[0] === tomorrow, testDates.join(' , '));
  }
} finally {
  await cleanup();
  if (subId) await deleteSubmission(subId).catch(() => false); // 审核留下的测试投稿记录一并清掉
  await restore();
  console.log(`\n测试数据已清理，排期已还原。`);
}

console.log(`结果：${pass} 通过，${fail} 失败`);
// 不调用 process.exit()：Windows 下会与未关闭的 keep-alive 连接冲突触发 libuv 断言
process.exitCode = fail ? 1 : 0;
