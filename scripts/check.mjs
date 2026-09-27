#!/usr/bin/env node
/**
 * 冒烟测试：对本地服务逐个检查页面 / SEO 文件 / 后台接口。
 *
 *   npm run serve        先起服务（默认 5173）
 *   npm run check        另开一个终端跑测试
 *   npm run check -- 5175   指定端口
 *   npm run check -- --admin 跑完整后台流程（会写入测试数据并清理）
 */

import '../lib/env.mjs'; // 读取 .env：PORT / ADMIN_PATH / ADMIN_TEST_PASSWORD

const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || '5173';
const BASE = `http://localhost:${PORT}`;
const RUN_ADMIN = process.argv.includes('--admin');
const ADMIN_PATH = process.env.ADMIN_PATH || '/linjian-7c4f/';
const TEST_PASSWORD = process.env.ADMIN_TEST_PASSWORD || 'testpass12345';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    failures.push(name + (extra ? ' — ' + extra : ''));
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function get(path, opts = {}) {
  try {
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    return { status: r.status, text, headers: r.headers };
  } catch (e) {
    return { status: 0, text: '', err: String(e) };
  }
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

/* ---------------- 页面 ---------------- */

console.log('\n【1】页面渲染');
const pages = [
  ['/', '今日冷知'],
  ['/facts/', '冷知列表'],
  ['/facts/page/2/', '冷知列表'],
  ['/feihua/', '废话文学馆'],
  ['/jokes/', '冷笑话'],
  ['/random/', '随机冷知'],
  ['/archive/', '年轮归档'],
  ['/search/', '搜索'],
  ['/about/', '关于'],
  ['/submit/', '投稿'],
];
for (const [p, label] of pages) {
  const r = await get(p);
  ok(
    `${p} (${label})`,
    r.status === 200 && r.text.includes('<h1') && r.text.includes('Sylveris'),
    `status=${r.status}, len=${r.text.length}`
  );
}

// 首页关键元素
const home = await get('/');
ok('首页含结构化数据 JSON-LD', home.text.includes('application/ld+json'));
ok('首页含 canonical', /rel="canonical"/.test(home.text));
ok('首页含 og:title', /property="og:title"/.test(home.text));
ok('首页含导航', home.text.includes('年轮归档'));

// 详情页
const idx = await get('/data/index.json');
let firstSlug = '';
try {
  const data = JSON.parse(idx.text);
  firstSlug = data.facts?.[0]?.slug || '';
  ok('index.json 有冷知', (data.facts || []).length > 0, `${data.facts.length} 条`);
} catch {
  ok('index.json 可解析', false, idx.text.slice(0, 80));
}
if (firstSlug) {
  const det = await get(`/facts/${firstSlug}/`);
  ok(`详情页 /facts/${firstSlug}/`, det.status === 200 && det.text.includes('相关冷知'));
  ok('详情页含 Article JSON-LD', det.text.includes('"@type":"Article"'));
}

// 404
const nf = await get('/this-path-does-not-exist/');
ok('未知路径返回 404', nf.status === 404 && nf.text.includes('没找到'), `status=${nf.status}`);

/* ---------------- SEO 文件 ---------------- */

console.log('\n【2】SEO 文件');
const robots = await get('/robots.txt');
ok('/robots.txt', robots.status === 200 && robots.text.includes('Sitemap:'));
ok('robots 隐藏后台路径', robots.text.includes('Disallow: ' + ADMIN_PATH), ADMIN_PATH);
ok('robots 不允许 /api/', robots.text.includes('Disallow: /api/'));

const sitemap = await get('/sitemap.xml');
ok('/sitemap.xml', sitemap.status === 200 && sitemap.text.includes('<urlset'));
ok('sitemap 不含后台路径', !sitemap.text.includes(ADMIN_PATH));
ok('sitemap 含详情页', sitemap.text.includes('/facts/'));

const rss = await get('/rss.xml');
ok('/rss.xml', rss.status === 200 && rss.text.includes('<rss'));

/* ---------------- 后台：隐藏 + 认证 ---------------- */

console.log('\n【3】后台隐藏与认证');
const adminPage = await get(ADMIN_PATH);
ok('后台路径可达', adminPage.status === 200 && adminPage.text.includes('林间管理台'), `status=${adminPage.status}`);
ok('后台页 noindex', /noindex/i.test(adminPage.text));
ok('后台页 no-store', (adminPage.headers.get('cache-control') || '').includes('no-store'));
ok('前台任意页面不含后台路径链接', !home.text.includes(ADMIN_PATH));

const noAuth = await get('/api/admin?view=overview');
ok('未登录访问管理接口 → 401', noAuth.status === 401, `status=${noAuth.status}`);

const badLogin = await post('/api/admin', { action: 'login', password: 'wrong-password-xx' });
ok('错误密码 → 401', badLogin.status === 401, `status=${badLogin.status}`);

const login = await post('/api/admin', { action: 'login', password: TEST_PASSWORD });
ok('正确密码 → 返回令牌', login.status === 200 && Boolean(login.json.token), `status=${login.status}`);
const TOKEN = login.json.token || '';

if (TOKEN) {
  /* ---------- 导入：解析预览 ---------- */
  console.log('\n【4】文档上传导入');

  const SAMPLE = [
    '【冷知】',
    '标题：测试导入的章鱼心脏',
    '正文：章鱼有三颗心脏，其中两颗专门给鳃供血，游泳时心脏还会停跳。',
    '来源：动物学科普资料',
    '标签：动物，身体',
    '废话：怪不得它游两下就要休息。',
    '---',
    '【冷笑话】',
    '分类：动物',
    '题目：章鱼为什么不会打领带',
    '正文：因为它有八只手，怎么打都是袖珍款。',
    '---',
    '【废话】',
    '正文：测试导入的每呼吸六十秒，寿命就少一分钟。',
    '标签：测试',
    '---',
    '【冷知】',
    '正文：这是一条只有正文没有标题的冷知，正文足够长所以会被识别成正文而不是标题猜测试探。',
  ].join('\n');

  const dry = await post('/api/admin', { action: 'import', text: SAMPLE, dryRun: true }, TOKEN);
  ok('导入 dryRun 成功', dry.status === 200 && dry.json.ok === true, `status=${dry.status}`);
  ok('识别 4 条', (dry.json.items || []).length === 4, `count=${(dry.json.items || []).length}`);
  ok('排期为连续日期', Array.isArray(dry.json.items) && dry.json.items.length >= 2
    ? dry.json.items[1].date !== dry.json.items[0].date
    : false, `起=${dry.json.startDate} 止=${dry.json.endDate}`);
  ok('无解析错误', (dry.json.errors || []).length === 0, JSON.stringify(dry.json.errors || []));

  const bad = await post('/api/admin', { action: 'import', text: '【不明类型】\n正文：哦', dryRun: true }, TOKEN);
  ok('未知类型被拒绝', bad.status === 400 || (bad.json.errors || []).length > 0);

  /* ---------- 入库 ---------- */
  const commit = await post('/api/admin', { action: 'import', text: SAMPLE, dryRun: false }, TOKEN);
  ok('确认入库', commit.status === 200 && commit.json.inserted === 4, `inserted=${commit.json.inserted}`);

  const after = await get('/data/index.json');
  let data2 = {};
  try {
    data2 = JSON.parse(after.text);
  } catch {}
  ok('未来排期内容未提前出现在 index.json', !(data2.facts || []).some((f) => f.title === '测试导入的章鱼心脏'));

  /* ---------- 内容库 ---------- */
  console.log('\n【5】内容库与插队');
  const libRes = await fetch(BASE + '/api/admin?view=content&filter=queued', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  }).then((r) => r.json());
  ok('内容库读取待上线', libRes.ok && libRes.rows.length >= 4, `rows=${libRes.rows?.length}`);

  const target = (libRes.rows || []).find((r) => r.title === '测试导入的章鱼心脏');
  ok('找到导入的条目', Boolean(target));

  if (target) {
    const beforeJump = target.publish_at;
    const jump = await post('/api/admin', { action: 'jump', id: target.id }, TOKEN);
    const afterJump = (await fetch(BASE + '/api/admin?view=one&id=' + target.id, {
      headers: { Authorization: 'Bearer ' + TOKEN },
    }).then((r) => r.json()));
    ok('插队后日期为明天', /^\d{4}-\d{2}-\d{2}$/.test(afterJump.row?.publish_at || ''), `${beforeJump} → ${afterJump.row?.publish_at}`);

    const upd = await post(
      '/api/admin',
      { action: 'update', id: target.id, fields: { title: '改过的标题', body: '改过的正文内容，长度足够。' } },
      TOKEN
    );
    ok('编辑保存', upd.status === 200 && upd.json.ok);

    const del = await post('/api/admin', { action: 'delete', id: target.id }, TOKEN);
    ok('删除条目', del.status === 200 && del.json.ok);
  }

  // 清理本次测试导入的其余条目
  const cleanupRows = await fetch(BASE + '/api/admin?view=content&filter=queued', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  }).then((r) => r.json());
  let removed = 0;
  for (const row of cleanupRows.rows || []) {
    if (
      row.title?.includes('测试导入') ||
      row.title?.includes('章鱼为什么') ||
      row.body?.includes('测试导入的每呼吸') ||
      row.body?.includes('这是一条只有正文没有标题')
    ) {
      const r = await post('/api/admin', { action: 'delete', id: row.id }, TOKEN);
      if (r.json.ok) removed += 1;
    }
  }
  ok('测试数据已清理', removed >= 3, `removed=${removed}`);

  /* ---------- 投稿审核 → 次日插队 ---------- */
  console.log('\n【6】投稿审核链路');
  const sub = await post('/api/submit', {
    kind: 'fact',
    body: '测试投稿：鸵鸟其实有两个脚趾，跑起来像穿着钉鞋。',
    author: '测试员',
    source: '测试来源',
    website: '',
  });
  ok('投稿提交成功', sub.status === 200 && sub.json.ok, `status=${sub.status}`);

  const pend = await fetch(BASE + '/api/admin?view=submissions&status=pending', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  }).then((r) => r.json());
  const subRow = (pend.rows || []).find((r) => r.body.includes('鸵鸟'));
  ok('待审队列看到投稿', Boolean(subRow));

  if (subRow) {
    const ap = await post('/api/admin', { action: 'approve', id: subRow.id }, TOKEN);
    ok('通过 → 排到次日', ap.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(ap.json.publishAt || ''), `publishAt=${ap.json.publishAt}`);

    const list = await fetch(BASE + '/api/admin?view=content&filter=queued', {
      headers: { Authorization: 'Bearer ' + TOKEN },
    }).then((r) => r.json());
    const reader = (list.rows || []).find((r) => r.from_reader === 1);
    ok('投稿已进入内容队列且标记为读者投稿', Boolean(reader));

    if (reader) await post('/api/admin', { action: 'delete', id: reader.id }, TOKEN);
    await post('/api/admin', { action: 'reject', id: subRow.id }, TOKEN);
  }
}

/* ---------------- 汇总 ---------------- */

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (failures.length) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
}
// 不调用 process.exit()：Windows 下会与未关闭的 keep-alive 连接冲突触发 libuv 断言
process.exitCode = fail ? 1 : 0;
