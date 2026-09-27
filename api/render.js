/**
 * api/render.js — 动态渲染入口（由 vercel.json 的 rewrite 转发一切页面请求）。
 *
 * 路由：
 *   /                        首页
 *   /facts/  /facts/page/N/  冷知列表
 *   /facts/<slug>/           冷知详情
 *   /feihua/ /jokes/ /random/ /archive/ /search/ /about/ /submit/
 *   /sitemap.xml /rss.xml /robots.txt /data/index.json
 *   <ADMIN_PATH>             隐藏管理台（no-store）
 *   其余                      404 页（状态码 404）
 *
 * 页面 HTML 由 CDN 缓存 5 分钟：改内容、插队最迟 5 分钟后全网生效。
 */

import {
  loadSiteContent,
} from '../lib/content.mjs';
import {
  renderHome,
  renderFactsIndex,
  renderFactPage,
  renderFeihua,
  renderJokes,
  renderRandom,
  renderArchive,
  renderSearch,
  renderAbout,
  renderSubmit,
  render404,
  renderAdminConsole,
  buildSitemap,
  buildRss,
  buildRobots,
  buildIndexJson,
  PAGE_SIZE,
} from '../lib/pages.mjs';
import { adminPath, HTML_CACHE, DATA_CACHE, ADMIN_CACHE } from '../lib/config.mjs';

function send(res, status, type, body, cache) {
  res.status(status);
  res.setHeader('Content-Type', type);
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: '方法不允许' }), 'no-store');
  }

  let raw = String(req.query?.path || '/');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* 保持原样 */
  }
  if (!raw.startsWith('/')) raw = '/' + raw;
  // 统一去掉重复斜杠
  raw = raw.replace(/\/{2,}/g, '/');

  try {
    const ctx = await loadSiteContent();
    const aPath = adminPath();

    /* ---------- 管理台（隐藏入口） ---------- */
    if (raw === aPath || raw === aPath.slice(0, -1)) {
      const html = renderAdminConsole(ctx, aPath);
      if (req.method === 'HEAD') return send(res, 200, 'text/html; charset=utf-8', '', ADMIN_CACHE);
      return send(res, 200, 'text/html; charset=utf-8', html, ADMIN_CACHE);
    }

    /* ---------- SEO 文件 ---------- */
    if (raw === '/robots.txt') {
      return send(res, 200, 'text/plain; charset=utf-8', buildRobots(aPath), DATA_CACHE);
    }
    if (raw === '/sitemap.xml') {
      return send(res, 200, 'application/xml; charset=utf-8', buildSitemap(ctx), DATA_CACHE);
    }
    if (raw === '/rss.xml') {
      return send(res, 200, 'application/rss+xml; charset=utf-8', buildRss(ctx), DATA_CACHE);
    }
    if (raw === '/data/index.json') {
      return send(res, 200, 'application/json; charset=utf-8', buildIndexJson(ctx), DATA_CACHE);
    }

    /* ---------- 页面路由 ---------- */
    let html = null;
    let status = 200;

    const path = raw.replace(/\?.*$/, '');

    if (path === '/' || path === '/index.html') {
      html = renderHome(ctx);
    } else if (path === '/facts/' || path === '/facts') {
      html = renderFactsIndex(ctx, 1);
    } else {
      let m = path.match(/^\/facts\/page\/(\d+)\/?$/);
      if (m) {
        const n = Math.max(1, Number(m[1]));
        html = renderFactsIndex(ctx, n);
      } else {
        m = path.match(/^\/facts\/([^/]+)\/?$/);
        if (m) {
          const slug = m[1];
          const hit = ctx.facts.find((f) => f.slug === slug);
          if (hit) html = renderFactPage(ctx, hit);
        }
      }
    }

    if (html === null) {
      if (path === '/feihua/' || path === '/feihua') html = renderFeihua(ctx);
      else if (path === '/jokes/' || path === '/jokes') html = renderJokes(ctx);
      else if (path === '/random/' || path === '/random') html = renderRandom(ctx);
      else if (path === '/archive/' || path === '/archive') html = renderArchive(ctx);
      else if (path === '/search/' || path === '/search') html = renderSearch(ctx);
      else if (path === '/about/' || path === '/about') html = renderAbout(ctx);
      else if (path === '/submit/' || path === '/submit') html = renderSubmit(ctx);
    }

    if (html === null) {
      status = 404;
      html = render404();
    }

    if (req.method === 'HEAD') return send(res, status, 'text/html; charset=utf-8', '', HTML_CACHE);
    return send(res, status, 'text/html; charset=utf-8', html, HTML_CACHE);
  } catch (e) {
    console.error('render failed:', e);
    // 渲染失败时尽量给出 404 页而不是白屏
    try {
      const html = render404();
      return send(res, 500, 'text/html; charset=utf-8', html, 'no-store');
    } catch {
      return send(res, 500, 'text/plain; charset=utf-8', 'Internal Server Error', 'no-store');
    }
  }
}
