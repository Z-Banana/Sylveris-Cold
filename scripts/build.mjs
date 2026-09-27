#!/usr/bin/env node
/**
 * 构建脚本 —— 两种模式：
 *
 * 1) 默认（云端正常部署，零静态页面）
 *      node scripts/build.mjs
 *    只把 public/ 的静态资源复制到 dist/。页面全部由 api/render.js 在请求时
 *    从数据库渲染（见 vercel.json 的 rewrite），所以「改内容不用重新构建」。
 *
 * 2) 静态兜底（--static 或环境变量 STATIC_FALLBACK=1）
 *      node scripts/build.mjs --static
 *    生成完整静态站（63+ 页），用于 Turso / Serverless 故障时的应急切换：
 *    把构建模式切到 static 后重新部署，站点即脱离数据库独立工作。
 *    内容优先取数据库已上线条目，取不到则回落到 data/*.js 内置种子。
 *
 * 用法：node scripts/build.mjs [--static]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { site } from '../data/site.js';
import { loadSiteContent } from '../lib/content.mjs';
import {
  renderHome,
  renderFactsIndex,
  renderFactPage,
  renderFeihua,
  renderJokes,
  renderArchive,
  renderSearch,
  renderAbout,
  renderSubmit,
  render404,
  buildSitemap,
  buildRss,
  buildRobots,
  buildIndexJson,
  PAGE_SIZE,
} from '../lib/pages.mjs';
import { adminPath } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const isStatic =
  process.argv.includes('--static') || process.env.STATIC_FALLBACK === '1';

/* ---------------- 工具 ---------------- */

function write(rel, content) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, site.encoding || 'utf8');
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * 递归删除。注意：本机上 fs.rmSync({recursive:true}）会静默失败（返回成功但
 * 目录仍在），因此手动递归 unlink + rmdir，并在最后校验确实删干净了。
 */
function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) removeDir(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function resetDist() {
  removeDir(DIST);
  if (fs.existsSync(DIST)) {
    throw new Error(`无法清空 dist/：${fs.readdirSync(DIST).join(', ')}`);
  }
  fs.mkdirSync(DIST, { recursive: true });
}

/** 构建后自检：确保没有历史遗留文件（尤其是旧版静态后台页）混进产物 */
function assertClean() {
  const forbidden = ['admin'];
  const found = forbidden.filter((name) => fs.existsSync(path.join(DIST, name)));
  if (found.length) {
    throw new Error(`产物中混入了不该存在的目录/文件：${found.join(', ')}，构建中止。`);
  }
}

/** 只复制静态资源（默认模式） */
function buildAssets() {
  resetDist();
  copyDir(path.join(ROOT, 'public'), DIST);
  // service worker / webmanifest 若存在则一并复制（public 已含）
  const files = fs.existsSync(DIST) ? countFiles(DIST) : 0;
  assertClean();
  console.log(`构建完成：静态资源 ${files} 个 → dist/（页面由 /api/render 动态渲染）`);
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

/** 全量静态站（兜底） */
async function buildStatic() {
  const ctx = await loadSiteContent({ force: true });
  const { facts, feihua, jokes } = ctx;
  const aPath = adminPath();

  resetDist();
  copyDir(path.join(ROOT, 'public'), DIST);

  let pages = 0;
  const emit = (rel, html) => {
    write(rel, html);
    pages += 1;
  };

  emit('index.html', renderHome(ctx));

  // 冷知列表（分页）
  const totalPages = Math.max(1, Math.ceil(facts.length / PAGE_SIZE));
  for (let p = 1; p <= totalPages; p++) {
    emit(p === 1 ? 'facts/index.html' : `facts/page/${p}/index.html`, renderFactsIndex(ctx, p));
  }
  // 冷知详情
  for (const f of facts) {
    emit(`facts/${f.slug}/index.html`, renderFactPage(ctx, f));
  }

  emit('feihua/index.html', renderFeihua(ctx));
  emit('jokes/index.html', renderJokes(ctx));
  // /random/ 不再是独立页（随机冷知已并入 /facts/ 顶部，云端用 301 跳转）
  emit('archive/index.html', renderArchive(ctx));
  emit('search/index.html', renderSearch(ctx));
  emit('about/index.html', renderAbout(ctx));
  emit('submit/index.html', renderSubmit(ctx));
  emit('404.html', render404());

  // SEO 文件
  write('sitemap.xml', buildSitemap(ctx));
  write('rss.xml', buildRss(ctx));
  write('robots.txt', buildRobots(aPath));
  write('data/index.json', buildIndexJson(ctx));
  pages += 4;

  assertClean();

  console.log(
    `构建完成（静态兜底）：冷知 ${facts.length} 条、废话 ${feihua.length} 句、冷笑话 ${jokes.length} 条、` +
      `静态页 ${pages} 个 → dist/（数据源：${ctx.source === 'db' ? '数据库' : '内置种子'}）`
  );
  if (ctx.source === 'seed') {
    console.log('提示：数据库暂无已上线内容，已用 data/*.js 种子构建。');
  }
}

if (isStatic) {
  await buildStatic();
} else {
  buildAssets();
}
