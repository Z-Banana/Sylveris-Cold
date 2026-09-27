#!/usr/bin/env node
/**
 * 冒烟测试：对本地服务逐个检查页面 / SEO 文件 / 后台接口。
 *
 *   npm run serve        先起服务（默认 5173）
 *   npm run check        另开一个终端跑测试（页面 / SEO / 后台隐藏 / 访问上报，只读）
 *   npm run check -- 5175   指定端口
 *   npm run check -- --admin 跑完整后台流程（写入测试数据 → 清理 → 还原排期）
 */

import '../lib/env.mjs'; // 读取 .env：PORT / ADMIN_PATH / ADMIN_TEST_PASSWORD
import { deleteSubmission } from '../lib/db.mjs'; // 投稿表没有删除接口，测试残留自己清（与服务端同一套 .env）

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
ok(
  '首页含 Vercel Web Analytics 脚本',
  /window\.vaq/.test(home.text) && /_vercel\/(insights|analytics)/.test(home.text),
  home.text.match(/<script defer src="([^"]+)">/)?.[1] || '未找到脚本地址'
);

// 随机冷知已并入列表页顶部，旧 /random/ 301 跳转
const factsList = await get('/facts/');
ok('冷知列表顶部有随机冷知卡片', factsList.text.includes('id="random-card"') && factsList.text.includes('随机冷知'));
const oldRandom = await fetch(BASE + '/random/', { redirect: 'manual' });
const oldRandomBare = await fetch(BASE + '/random', { redirect: 'manual' });
const loc1 = oldRandom.headers.get('location') || '';
const loc2 = oldRandomBare.headers.get('location') || '';
ok(
  '/random/ 与 /random 都 301 到 /facts/',
  oldRandom.status === 301 && oldRandomBare.status === 301 && loc1.startsWith('/facts') && loc2.startsWith('/facts'),
  `301=${oldRandom.status}/${oldRandomBare.status}, loc=${loc1}`
);

// 新增板块：随机废话 / 随机冷笑话（页面不显示时间）
const feihuaPage = await get('/feihua/');
ok('废话页有「随机废话」卡片', feihuaPage.text.includes('id="feihua-card"'));
ok('废话页已无关键词生成器', !feihuaPage.text.includes('gen-form'));
ok('废话页不显示日期', !/(item-meta r-meta|item-meta"><span)>[0-9]/.test(feihuaPage.text));

const jokesPage = await get('/jokes/');
ok('冷笑话页有「随机冷笑话」卡片', jokesPage.text.includes('id="joke-card"'));
ok('冷笑话页不显示时间', !/j-updated|更新 [0-9]|发布 [0-9]/.test(jokesPage.text));
ok(
  '随机冷笑话是「展开全文」按钮 + 卡片内全文容器',
  /id="joke-expand"[^>]*>展开全文</.test(jokesPage.text) && jokesPage.text.includes('id="joke-full"')
);

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
ok(
  '后台含「访问统计」页签',
  adminPage.text.includes('data-tab="stats"') && adminPage.text.includes('id="ad-tab-stats"')
);
ok('后台页不打点（无统计脚本）', !/window\.vaq/.test(adminPage.text));

const noAuth = await get('/api/admin?view=overview');
ok('未登录访问管理接口 → 401', noAuth.status === 401, `status=${noAuth.status}`);

const badLogin = await post('/api/admin', { action: 'login', password: 'wrong-password-xx' });
ok('错误密码 → 401', badLogin.status === 401, `status=${badLogin.status}`);

const login = await post('/api/admin', { action: 'login', password: TEST_PASSWORD });
ok('正确密码 → 返回令牌', login.status === 200 && Boolean(login.json.token), `status=${login.status}`);
const TOKEN = login.json.token || '';

if (TOKEN && RUN_ADMIN) {
  /**
   * 分页取全部待上线内容。
   * 接口单次最多 200 条、默认只返回 50 条（按日期倒序），线上队列有几百条时
   * 默认返回值里根本看不到最早那几天，测试必须自己翻页拿全量。
   */
  const allQueued = async (extra = '') => {
    const out = [];
    for (let offset = 0; offset <= 4000; offset += 200) {
      const r = await fetch(`${BASE}/api/admin?view=content&filter=queued&limit=200&offset=${offset}${extra}`, {
        headers: { Authorization: 'Bearer ' + TOKEN },
      }).then((x) => x.json());
      out.push(...(r.rows || []));
      if ((r.rows || []).length < 200) break;
    }
    return out;
  };

  // 快照线上排期：「插队」会把 >= 明天的所有内容整体后移一天，测试结束必须还原。
  const scheduleBefore = new Map((await allQueued()).map((r) => [r.id, r.publish_at]));
  let subId = null; // 本次测试用的投稿记录 id

  try {
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
    const queuedRows = await allQueued();
    ok('内容库读取待上线', queuedRows.length >= 4, `rows=${queuedRows.length}`);

    const target = (queuedRows || []).find((r) => r.title === '测试导入的章鱼心脏');
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

    // 清理本次测试导入的其余条目（只清「本次测试新建」且带测试标记的行，绝不动线上内容）
    const cleanupRows = await allQueued();
    let removed = 0;
    for (const row of cleanupRows) {
      if (scheduleBefore.has(row.id)) continue;
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
      subId = subRow.id;
      const ap = await post('/api/admin', { action: 'approve', id: subRow.id }, TOKEN);
      ok('通过 → 排到次日', ap.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(ap.json.publishAt || ''), `publishAt=${ap.json.publishAt}`);

      // 按正文找：不能用「第一条 from_reader」，那可能是线上真实的读者投稿
      const reader = (await allQueued()).find((r) => String(r.body || '').includes('测试投稿：鸵鸟'));
      ok('投稿已进入内容队列且标记为读者投稿', Boolean(reader) && reader.from_reader === 1);

      if (reader) await post('/api/admin', { action: 'delete', id: reader.id }, TOKEN);
      await post('/api/admin', { action: 'reject', id: subRow.id }, TOKEN);
    }

  } finally {
    if (subId) await deleteSubmission(subId).catch(() => false); // 审核留下的测试投稿记录一并清掉
    // 无论测试成败，都要把被「插队」整体后移的线上排期拨回去
    try {
      const pending = [];
      for (const row of await allQueued()) {
        const orig = scheduleBefore.get(row.id);
        if (orig && row.publish_at !== orig) pending.push([row.id, orig]);
      }
      let shifted = 0;
      for (let i = 0; i < pending.length; i += 8) {
        const res = await Promise.all(
          pending.slice(i, i + 8).map(([id, publish_at]) =>
            post('/api/admin', { action: 'update', id, fields: { publish_at } }, TOKEN)
          )
        );
        shifted += res.filter((r) => r.json.ok).length;
      }
      const afterQueue = await allQueued();
      ok(
        '线上排期已还原（插队测试不留后移）',
        afterQueue.every((r) => !scheduleBefore.has(r.id) || scheduleBefore.get(r.id) === r.publish_at),
        `回拨 ${shifted} 条`
      );
    } catch (e) {
      console.error('排期还原失败，请手工核对：', e);
      ok('线上排期已还原（插队测试不留后移）', false, String(e && e.message));
    }
  }
} else if (TOKEN) {
  console.log('\n（未加 --admin：跳过导入 / 编辑 / 插队 / 审核等写操作）');
}

/* ---------------- 访问上报（只读断言，不写库，避免污染统计） ---------------- */
console.log('\n【7】访问上报');

const visitGet = await fetch(BASE + '/api/visit');
ok('GET /api/visit → 405', visitGet.status === 405, `status=${visitGet.status}`);

const visitBot = await fetch(BASE + '/api/visit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'curl/8.5.0' },
  body: JSON.stringify({ path: '/' }),
}).then((r) => r.json().catch(() => ({})));
ok('爬虫 UA 上报被识别并跳过', visitBot.ok === true && visitBot.skipped === 'bot', JSON.stringify(visitBot));

const visitCross = await fetch(BASE + '/api/visit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Origin: 'https://evil.example.com',
  },
  body: JSON.stringify({ path: '/' }),
});
ok('跨站 Origin 上报 → 403', visitCross.status === 403, `status=${visitCross.status}`);

/* ---------------- 汇总 ---------------- */

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (failures.length) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
}
// 不调用 process.exit()：Windows 下会与未关闭的 keep-alive 连接冲突触发 libuv 断言
process.exitCode = fail ? 1 : 0;
