/**
 * 内容装载：页面渲染用的数据源。
 *
 * 顺序：数据库已上线内容 → 回落到 data/*.js 内置种子（保证站点永不空白）。
 * 「已上线」= status=queued 且 publish_at <= 今天（北京时间）。
 */

import { facts as seedFacts } from '../data/facts.js';
import { feihua as seedFeihua } from '../data/feihua.js';
import { jokes as seedJokes } from '../data/jokes.js';
import { listPublished, contentStats, todayItem } from './db.mjs';
import { todayCN } from './config.mjs';

export const PAGE_SIZE = 10;

export function excerpt(text, n = 66) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function byDateDesc(a, b) {
  return String(b.date || '').localeCompare(String(a.date || ''));
}

/* ---------- 行 → 页面条目 ---------- */

export function rowToItem(row) {
  const date = (row.publish_at || '').slice(0, 10);
  const fromReader = Boolean(row.from_reader);
  const extra = row.extra || {};

  if (row.kind === 'fact') {
    return {
      slug: row.slug,
      title: row.title || excerpt(row.body, 30) || '来自林间的投稿',
      body: row.body,
      feihua: extra.feihua || '',
      tags: Array.isArray(extra.tags) ? extra.tags : [],
      source: extra.source || (fromReader ? '来源：林间投稿' : '来源：林间收录'),
      date,
      fromReader,
    };
  }

  if (row.kind === 'joke') {
    return {
      slug: row.slug,
      title: row.title || excerpt(row.body.split(/[\n。！？.!?]/)[0], 24) || '一条冷笑话',
      line: extra.line || excerpt(row.body, 40),
      full: extra.full || row.body,
      cat: extra.cat || '生活',
      date,
      fromReader,
    };
  }

  // feihua
  return {
    slug: row.slug,
    text: row.body,
    tags: Array.isArray(extra.tags) ? extra.tags : [],
    date,
    fromReader,
  };
}

/* ---------- 内置种子 data/seeds.js → content 行 ---------- */

export function seedContentRows() {
  const rows = [];
  const push = (r) => rows.push(r);

  for (const f of seedFacts) {
    push({
      kind: 'fact',
      slug: f.slug,
      title: f.title,
      body: f.body,
      extra: { feihua: f.feihua || '', tags: f.tags || [], source: f.source || '' },
      status: 'queued',
      publish_at: f.date,
      from_reader: 0,
    });
  }
  for (const h of seedFeihua) {
    push({
      kind: 'feihua',
      slug: h.slug,
      title: '',
      body: h.text,
      extra: { tags: h.tags || [] },
      status: 'queued',
      publish_at: h.date,
      from_reader: 0,
    });
  }
  for (const j of seedJokes) {
    push({
      kind: 'joke',
      slug: j.slug,
      title: j.title,
      body: j.full || j.line,
      extra: { line: j.line || '', full: j.full || '', cat: j.cat || '生活' },
      status: 'queued',
      publish_at: j.date,
      from_reader: 0,
    });
  }
  return rows;
}

function seedSiteContent() {
  const facts = [...seedFacts].sort(byDateDesc).map((f) => ({ ...f, fromReader: false }));
  const feihua = [...seedFeihua].sort(byDateDesc).map((f) => ({ ...f, fromReader: false }));
  const jokes = [...seedJokes].sort(byDateDesc).map((j) => ({ ...j, fromReader: false }));
  return { facts, feihua, jokes, source: 'seed' };
}

/* ---------- 主装载（渲染层使用，带 60 秒内存缓存） ---------- */

const CACHE_MS = 60 * 1000;
let cache = { at: 0, data: null };

export async function loadSiteContent({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_MS) return cache.data;

  const today = todayCN();
  let data = null;
  try {
    const rows = await listPublished(today);
    if (rows.length > 0) {
      const byKind = { fact: [], joke: [], feihua: [] };
      rows.forEach((row) => byKind[row.kind]?.push(rowToItem(row)));
      data = {
        facts: byKind.fact.sort(byDateDesc),
        jokes: byKind.joke.sort(byDateDesc),
        feihua: byKind.feihua.sort(byDateDesc),
        source: 'db',
      };
    }
  } catch (e) {
    console.error('loadSiteContent db failed, fallback to seeds:', e?.message || e);
  }

  if (!data) data = seedSiteContent();

  let stats = null;
  let todayRow = null;
  try {
    stats = await contentStats(today);
    todayRow = await todayItem(today);
  } catch {
    /* 忽略 */
  }

  const out = { ...data, today, todayItem: todayRow ? rowToItem(todayRow) : null, stats };
  cache = { at: now, data: out };
  return out;
}

export function clearContentCache() {
  cache = { at: 0, data: null };
}
