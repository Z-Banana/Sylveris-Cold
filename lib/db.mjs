/**
 * 存储层：优先使用 Turso（免费额度），未配置时回落到本地 JSON 文件。
 *
 * 环境变量：
 *   TURSO_DATABASE_URL   如 libsql://xxx.turso.tech
 *   TURSO_AUTH_TOKEN     数据库令牌
 *
 * 表：
 *   submissions  访客投稿（待审/通过/退回）
 *   content      内容池（kind/slug/title/body/extra/status/publish_at …）
 *   settings     键值设置（管理员密码哈希、会话密钥等）
 *
 * 本地未配置 Turso 时，数据写入 data/store.json，便于开发调试。
 */

import './env.mjs'; // 先读取项目根目录的 .env（本地）；云端无该文件时为空操作
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_FILE = path.join(ROOT, 'data', 'store.json');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    extra TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    publish_at TEXT,
    from_reader INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_content_slug ON content(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_content_status_date ON content(status, publish_at)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

let clientPromise = null;

export function hasTurso() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

async function getClient() {
  if (!hasTurso()) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import('@libsql/client');
      const c = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      await c.batch(
        SCHEMA.map((sql) => ({ sql, args: [] })),
        'write'
      );
      return c;
    })().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  return clientPromise;
}

/* ---------- 本地 JSON 回落 ---------- */

function emptyStore() {
  return { submissions: [], content: [], settings: {} };
}

function readStore() {
  try {
    const raw = fs.readFileSync(LOCAL_FILE, 'utf8');
    const json = JSON.parse(raw);
    return {
      submissions: Array.isArray(json.submissions) ? json.submissions : [],
      content: Array.isArray(json.content) ? json.content : [],
      settings: json.settings && typeof json.settings === 'object' ? json.settings : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function bumpUpdatedAt(row) {
  return { ...row, updated_at: new Date().toISOString() };
}

/* ---------- 公共：投稿 ---------- */

export function isValidKind(kind) {
  return ['fact', 'feihua', 'joke'].includes(kind);
}

/** 新增投稿，进入审核队列 */
export async function addSubmission({ kind, body, author, source }) {
  const row = {
    id: crypto.randomUUID(),
    kind,
    body: String(body).slice(0, 1000),
    author: author ? String(author).slice(0, 40) : null,
    source: source ? String(source).slice(0, 160) : null,
    status: 'pending',
    created_at: new Date().toISOString(),
    reviewed_at: null,
  };

  const c = await getClient().catch(() => null);
  if (c) {
    await c.execute({
      sql: `INSERT INTO submissions (id, kind, body, author, source, status, created_at, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, row.kind, row.body, row.author, row.source, row.status, row.created_at, row.reviewed_at],
    });
    return row;
  }

  const store = readStore();
  store.submissions.unshift(row);
  writeStore(store);
  return row;
}

/** 查询投稿。status 为空则全部 */
export async function listSubmissions(status) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = status
      ? await c.execute({
          sql: `SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC LIMIT 500`,
          args: [status],
        })
      : await c.execute({
          sql: `SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500`,
          args: [],
        });
    return r.rows.map((row) => ({ ...row }));
  }

  const rows = readStore().submissions;
  return status ? rows.filter((r) => r.status === status) : rows;
}

/** 审核：approve / reject */
export async function reviewSubmission(id, action) {
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
  if (!status) throw new Error('bad action');

  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `UPDATE submissions SET status = ?, reviewed_at = ? WHERE id = ?`,
      args: [status, new Date().toISOString(), id],
    });
    return r.rowsAffected > 0;
  }

  const store = readStore();
  const hit = store.submissions.find((r) => r.id === id);
  if (!hit) return false;
  hit.status = status;
  hit.reviewed_at = new Date().toISOString();
  writeStore(store);
  return true;
}

/** 兼容旧构建：已通过审核的投稿 */
export async function approvedSubmissions() {
  try {
    const rows = await listSubmissions('approved');
    return rows.map((r) => ({
      kind: r.kind,
      slug: 'reader-' + String(r.id).slice(0, 8),
      title: String(r.body).split(/[\n。！？.!?]/)[0].slice(0, 40) || '来自林间的投稿',
      body: r.body,
      author: r.author,
      source: r.source,
      date: (r.reviewed_at || r.created_at || '').slice(0, 10),
      fromReader: true,
    }));
  } catch {
    return [];
  }
}

/* ---------- 公共：内容池 ---------- */

function normalizeRow(row) {
  let extra = row.extra;
  if (typeof extra === 'string') {
    try {
      extra = JSON.parse(extra || '{}');
    } catch {
      extra = {};
    }
  }
  return {
    ...row,
    extra: extra && typeof extra === 'object' ? extra : {},
    from_reader: row.from_reader ? 1 : 0,
    publish_at: row.publish_at || null,
  };
}

/** 全部内容（管理端用）。status 不传则全部。 */
export async function listContentRows({ status, limit = 2000 } = {}) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = status
      ? await c.execute({
          sql: `SELECT * FROM content WHERE status = ? ORDER BY publish_at DESC, created_at DESC LIMIT ?`,
          args: [status, limit],
        })
      : await c.execute({
          sql: `SELECT * FROM content ORDER BY publish_at DESC, created_at DESC LIMIT ?`,
          args: [limit],
        });
    return r.rows.map(normalizeRow);
  }

  let rows = readStore().content;
  if (status) rows = rows.filter((r) => r.status === status);
  return rows.slice(0, limit).map(normalizeRow);
}

/** 已上线内容：status=queued 且 publish_at <= today（按日期倒序） */
export async function listPublished(today) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT * FROM content WHERE status = 'queued' AND publish_at IS NOT NULL AND publish_at <= ?
            ORDER BY publish_at DESC LIMIT 5000`,
      args: [today],
    });
    return r.rows.map(normalizeRow);
  }

  return readStore()
    .content.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at <= today)
    .sort((a, b) => String(b.publish_at).localeCompare(String(a.publish_at)))
    .map(normalizeRow);
}

export async function getPublishedBySlug(slug, today) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT * FROM content WHERE slug = ? AND status = 'queued' AND publish_at <= ?`,
      args: [slug, today],
    });
    return r.rows[0] ? normalizeRow(r.rows[0]) : null;
  }
  const hit = readStore().content.find((r) => r.slug === slug && r.status === 'queued' && r.publish_at && r.publish_at <= today);
  return hit ? normalizeRow(hit) : null;
}

/** 批量入库（排期由调用方算好） */
export async function insertContentRows(rows) {
  const now = new Date().toISOString();
  const c = await getClient().catch(() => null);
  if (c) {
    await c.batch(
      rows.map((r) => ({
        sql: `INSERT INTO content (id, kind, slug, title, body, extra, status, publish_at, from_reader, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          r.id,
          r.kind,
          r.slug,
          r.title || '',
          r.body,
          JSON.stringify(r.extra || {}),
          r.status || 'queued',
          r.publish_at || null,
          r.from_reader ? 1 : 0,
          now,
          now,
        ],
      })),
      'write'
    );
    return rows.length;
  }

  const store = readStore();
  store.content.push(
    ...rows.map((r) => ({
      ...r,
      extra: r.extra || {},
      status: r.status || 'queued',
      from_reader: r.from_reader ? 1 : 0,
      created_at: now,
      updated_at: now,
    }))
  );
  writeStore(store);
  return rows.length;
}

/** 局部更新。patch 只允许白名单字段。 */
export async function updateContentRow(id, patch) {
  const allow = ['kind', 'slug', 'title', 'body', 'extra', 'status', 'publish_at'];
  const fields = {};
  for (const k of allow) if (k in patch) fields[k] = patch[k];
  if ('extra' in fields) fields.extra = JSON.stringify(fields.extra || {});
  if (Object.keys(fields).length === 0) return false;
  fields.updated_at = new Date().toISOString();

  const c = await getClient().catch(() => null);
  if (c) {
    const keys = Object.keys(fields);
    const r = await c.execute({
      sql: `UPDATE content SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      args: [...keys.map((k) => fields[k]), id],
    });
    return r.rowsAffected > 0;
  }

  const store = readStore();
  const hit = store.content.find((r) => r.id === id);
  if (!hit) return false;
  Object.assign(hit, fields);
  writeStore(store);
  return true;
}

export async function deleteContentRow(id) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({ sql: `DELETE FROM content WHERE id = ?`, args: [id] });
    return r.rowsAffected > 0;
  }
  const store = readStore();
  const before = store.content.length;
  store.content = store.content.filter((r) => r.id !== id);
  writeStore(store);
  return store.content.length < before;
}

/** 未来待上线的排期（含今天），按日期升序 */
export async function futureQueuedRows(today) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT * FROM content WHERE status = 'queued' AND publish_at IS NOT NULL AND publish_at >= ?
            ORDER BY publish_at ASC LIMIT 5000`,
      args: [today],
    });
    return r.rows.map(normalizeRow);
  }
  return readStore()
    .content.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at >= today)
    .sort((a, b) => String(a.publish_at).localeCompare(String(b.publish_at)))
    .map(normalizeRow);
}

/** 最后一个已排期日期（无则 null） */
export async function lastQueuedDate() {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT MAX(publish_at) AS d FROM content WHERE status = 'queued' AND publish_at IS NOT NULL`,
      args: [],
    });
    return r.rows[0]?.d || null;
  }
  const dates = readStore()
    .content.filter((r) => r.status === 'queued' && r.publish_at)
    .map((r) => r.publish_at);
  return dates.length ? dates.sort().at(-1) : null;
}

/** 把 publish_at >= date 的待上线内容整体后移一天（给插队腾位置） */
export async function shiftQueuedFrom(date) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `UPDATE content SET publish_at = date(publish_at, '+1 day'), updated_at = ?
            WHERE status = 'queued' AND publish_at IS NOT NULL AND publish_at >= ?`,
      args: [new Date().toISOString(), date],
    });
    return r.rowsAffected;
  }

  const store = readStore();
  let n = 0;
  for (const row of store.content) {
    if (row.status === 'queued' && row.publish_at && row.publish_at >= date) {
      const d = new Date(row.publish_at + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      row.publish_at = d.toISOString().slice(0, 10);
      row.updated_at = new Date().toISOString();
      n++;
    }
  }
  writeStore(store);
  return n;
}

export async function slugExists(slug) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({ sql: `SELECT 1 FROM content WHERE slug = ?`, args: [slug] });
    return r.rows.length > 0;
  }
  return readStore().content.some((r) => r.slug === slug);
}

/** 统计：已上线 / 待上线 / 草稿 */
export async function contentStats(today) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT
              SUM(CASE WHEN status='queued' AND publish_at <= ? THEN 1 ELSE 0 END) AS live,
              SUM(CASE WHEN status='queued' AND publish_at >  ? THEN 1 ELSE 0 END) AS queued,
              SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft,
              COUNT(*) AS total
            FROM content`,
      args: [today, today],
    });
    const row = r.rows[0] || {};
    return {
      live: Number(row.live || 0),
      queued: Number(row.queued || 0),
      draft: Number(row.draft || 0),
      total: Number(row.total || 0),
    };
  }

  const rows = readStore().content;
  return {
    live: rows.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at <= today).length,
    queued: rows.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at > today).length,
    draft: rows.filter((r) => r.status === 'draft').length,
    total: rows.length,
  };
}

/** 今天上线的那条（可能没有） */
export async function todayItem(today) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({
      sql: `SELECT * FROM content WHERE status = 'queued' AND publish_at = ? ORDER BY updated_at DESC LIMIT 1`,
      args: [today],
    });
    return r.rows[0] ? normalizeRow(r.rows[0]) : null;
  }
  const hit = readStore().content.find((r) => r.status === 'queued' && r.publish_at === today);
  return hit ? normalizeRow(hit) : null;
}

/* ---------- 公共：设置（密码哈希等） ---------- */

export async function getSetting(key) {
  const c = await getClient().catch(() => null);
  if (c) {
    const r = await c.execute({ sql: `SELECT value FROM settings WHERE key = ?`, args: [key] });
    return r.rows[0] ? String(r.rows[0].value) : null;
  }
  const v = readStore().settings[key];
  return v == null ? null : String(v);
}

export async function setSetting(key, value) {
  const c = await getClient().catch(() => null);
  if (c) {
    await c.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [key, String(value)],
    });
    return true;
  }
  const store = readStore();
  store.settings[key] = String(value);
  writeStore(store);
  return true;
}
