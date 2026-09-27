/**
 * /api/admin — 管理台接口。
 *
 * 认证：
 *   POST { action:'login', password }  → { ok, token }（密码哈希校验，登录限流）
 *   其余所有调用需 Authorization: Bearer <token>
 *   兼容：环境变量 ADMIN_TOKEN 也可作为 Bearer（curl 便利通道）
 *
 * 读取：
 *   GET ?view=overview                 统计与今日/下一条
 *   GET ?view=visits                   访问统计（近 30 天，按天 / 按板块）
 *   GET ?view=submissions&status=      投稿队列
 *   GET ?view=content&filter=&q=&offset=&limit=   内容库
 *   GET ?view=one&id=                  单条内容（编辑表单用）
 *
 * 操作：
 *   { action:'import', text, dryRun, startDate }   解析预览 / 入库
 *   { action:'approve'|'reject', id }              投稿审核（通过＝次日插队上线）
 *   { action:'update', id, fields }                编辑内容
 *   { action:'delete', id }
 *   { action:'jump', id }                          插队到次日
 */

import crypto from 'node:crypto';
import {
  listSubmissions,
  reviewSubmission,
  listContentRows,
  insertContentRows,
  updateContentRow,
  deleteContentRow,
  futureQueuedRows,
  lastQueuedDate,
  shiftQueuedFrom,
  getSetting,
  contentStats,
  todayItem,
  visitStats,
} from '../lib/db.mjs';
import { parseImport } from '../lib/parse.mjs';
import { verifyPassword, issueToken, checkAuth, loginLimited, recordLoginFailure, clearLoginFailures } from '../lib/auth.mjs';
import { clearContentCache, excerpt, loadSiteContent } from '../lib/content.mjs';
import { todayCN, addDays } from '../lib/config.mjs';

function ipOf(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'local'
  );
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 腾出 date 这一天的位置：若当天已被占用，把 >= 当天的整体后移一天 */
async function makeSlot(date, today) {
  const rows = await futureQueuedRows(today);
  if (rows.some((r) => r.publish_at === date)) {
    await shiftQueuedFrom(date);
  }
}

/** 导入排期起点：现有队列之后；队列空则明天 */
async function nextSlot(today) {
  const last = await lastQueuedDate();
  if (last && last >= today) return addDays(last, 1);
  return addDays(today, 1);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    /* ---------- 登录 ---------- */
    if (req.method === 'POST' && (req.body || {}).action === 'login') {
      const ip = ipOf(req);
      if (loginLimited(ip)) {
        return res.status(429).json({ ok: false, error: '尝试太频繁，10 分钟后再试。' });
      }
      const stored = await getSetting('admin_password');
      if (!stored) {
        return res.status(403).json({ ok: false, error: '尚未设置密码：请在项目目录运行 npm run set-password' });
      }
      const password = String((req.body || {}).password || '');
      if (!password || !verifyPassword(password, stored)) {
        recordLoginFailure(ip);
        return res.status(401).json({ ok: false, error: '密码不对。' });
      }
      clearLoginFailures(ip);
      const token = await issueToken();
      return res.status(200).json({ ok: true, token });
    }

    /* ---------- 其余调用需鉴权 ---------- */
    const ok = await checkAuth(req);
    if (!ok) return res.status(401).json({ ok: false, error: '未授权' });

    const today = todayCN();

    /* ---------- 读取 ---------- */
    if (req.method === 'GET') {
      const view = String(req.query?.view || '');

      if (view === 'overview') {
        const stats = await contentStats(today);
        const t = await todayItem(today);
        const future = await futureQueuedRows(today);
        const next = future.find((r) => r.publish_at > today);
        const site = await loadSiteContent({ force: true }).catch(() => null);
        return res.status(200).json({
          ok: true,
          overview: {
            ...stats,
            today,
            todayTitle: t ? t.title || excerpt(t.body, 30) : '',
            nextDate: next ? next.publish_at : null,
            // 内容库为空时站点会回落到内置种子，后台要提示站长先 seed
            seeded: stats.total === 0,
            siteSource: site ? site.source : 'seed',
            siteFacts: site ? site.facts.length : 0,
          },
        });
      }

      if (view === 'visits') {
        const v = await visitStats(addDays(today, -29), today, addDays(today, -1));
        return res.status(200).json({ ok: true, visits: v });
      }

      if (view === 'submissions') {
        const rows = await listSubmissions(String(req.query?.status || '') || undefined);
        return res.status(200).json({ ok: true, rows });
      }

      if (view === 'content' || view === 'one') {
        const all = await listContentRows({});
        if (view === 'one') {
          const row = all.find((r) => r.id === String(req.query?.id || ''));
          return row
            ? res.status(200).json({ ok: true, row })
            : res.status(404).json({ ok: false, error: '没有这条内容' });
        }

        const filter = String(req.query?.filter || '');
        const q = String(req.query?.q || '').trim().toLowerCase();
        let rows = all;
        if (filter === 'queued') rows = rows.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at > today);
        else if (filter === 'live') rows = rows.filter((r) => r.status === 'queued' && r.publish_at && r.publish_at <= today);
        else if (filter === 'draft') rows = rows.filter((r) => r.status === 'draft');
        if (q) {
          rows = rows.filter(
            (r) =>
              String(r.title || '').toLowerCase().includes(q) ||
              String(r.body || '').toLowerCase().includes(q)
          );
        }
        const offset = Math.max(0, Number(req.query?.offset || 0));
        const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
        return res.status(200).json({ ok: true, rows: rows.slice(offset, offset + limit), total: rows.length });
      }

      return res.status(400).json({ ok: false, error: '未知 view' });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: '方法不允许' });

    const body = req.body || {};
    const action = String(body.action || '');

    /* ---------- 导入 ---------- */
    if (action === 'import') {
      const text = String(body.text || '');
      if (!text.trim()) return res.status(400).json({ ok: false, error: '内容为空' });

      const existing = new Set((await listContentRows({})).map((r) => r.slug));
      const parsed = parseImport(text, existing);
      if (!parsed.items.length && parsed.errors.length) {
        return res.status(400).json({ ok: false, error: parsed.errors[0].reason, errors: parsed.errors });
      }

      const start = validDate(body.startDate) ? body.startDate : await nextSlot(today);
      const dates = parsed.items.map((_, i) => addDays(start, i));
      const preview = parsed.items.map((it, i) => ({
        kind: it.kind,
        preview: it.title || excerpt(it.body, 46),
        date: dates[i],
      }));

      if (body.dryRun) {
        return res.status(200).json({
          ok: true,
          format: parsed.format,
          items: preview,
          errors: parsed.errors,
          startDate: dates[0] || start,
          endDate: dates[dates.length - 1] || start,
        });
      }

      const now = new Date().toISOString();
      const rows = parsed.items.map((it, i) => ({
        id: crypto.randomUUID(),
        kind: it.kind,
        slug: it.slug,
        title: it.title,
        body: it.body,
        extra: it.extra,
        status: 'queued',
        publish_at: dates[i],
        from_reader: 0,
        created_at: now,
        updated_at: now,
      }));
      await insertContentRows(rows);
      clearContentCache();
      return res.status(200).json({
        ok: true,
        inserted: rows.length,
        errors: parsed.errors,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
      });
    }

    /* ---------- 投稿审核 ---------- */
    if (action === 'approve' || action === 'reject') {
      const id = String(body.id || '');
      if (!id) return res.status(400).json({ ok: false, error: '缺 id' });

      if (action === 'reject') {
        const done = await reviewSubmission(id, 'reject');
        return done
          ? res.status(200).json({ ok: true })
          : res.status(404).json({ ok: false, error: '没有这条投稿' });
      }

      // 通过 = 次日插队上线
      const subs = await listSubmissions('pending');
      const sub = subs.find((s) => s.id === id);
      if (!sub) return res.status(404).json({ ok: false, error: '没有这条待审投稿' });

      const target = addDays(today, 1);
      await makeSlot(target, today);

      const createdAt = new Date().toISOString();
      const title =
        String(sub.body).split(/[\n。！？.!?]/)[0].slice(0, 40) || '来自林间的投稿';

      const row = {
        id: crypto.randomUUID(),
        kind: sub.kind,
        slug: 'reader-' + String(sub.id).replace(/-/g, '').slice(0, 10),
        title: sub.kind === 'feihua' ? '' : title,
        body: sub.body,
        extra:
          sub.kind === 'fact'
            ? {
                feihua: '',
                tags: ['林间投稿'],
                source: sub.source ? `来源：${sub.source}` : '来源：林间投稿',
              }
            : sub.kind === 'joke'
              ? { cat: '林间投稿', line: excerpt(sub.body, 40), full: sub.body }
              : { tags: ['林间投稿'] },
        status: 'queued',
        publish_at: target,
        from_reader: 1,
        created_at: createdAt,
        updated_at: createdAt,
      };

      // slug 冲突兜底
      const existing = new Set((await listContentRows({})).map((r) => r.slug));
      let n = 2;
      while (existing.has(row.slug)) row.slug = `${row.slug}-${n++}`;

      await insertContentRows([row]);
      await reviewSubmission(id, 'approve');
      clearContentCache();
      return res.status(200).json({ ok: true, publishAt: target });
    }

    /* ---------- 编辑 ---------- */
    if (action === 'update') {
      const id = String(body.id || '');
      const fields = body.fields || {};
      const patch = {};
      if ('title' in fields) patch.title = String(fields.title || '').slice(0, 120);
      if ('body' in fields) {
        const b = String(fields.body || '').trim();
        if (!b) return res.status(400).json({ ok: false, error: '正文不能为空' });
        if (b.length > 2000) return res.status(400).json({ ok: false, error: '正文超过 2000 字' });
        patch.body = b;
      }
      if ('publish_at' in fields) {
        if (!validDate(fields.publish_at)) return res.status(400).json({ ok: false, error: '日期格式应为 YYYY-MM-DD' });
        patch.publish_at = fields.publish_at;
      }
      if ('status' in fields) {
        if (!['queued', 'draft'].includes(fields.status)) return res.status(400).json({ ok: false, error: '状态不对' });
        patch.status = fields.status;
      }
      if ('extra' in fields && fields.extra && typeof fields.extra === 'object') {
        patch.extra = fields.extra;
      }
      const done = await updateContentRow(id, patch);
      clearContentCache();
      return done
        ? res.status(200).json({ ok: true })
        : res.status(404).json({ ok: false, error: '没有这条内容' });
    }

    /* ---------- 删除 ---------- */
    if (action === 'delete') {
      const done = await deleteContentRow(String(body.id || ''));
      clearContentCache();
      return done
        ? res.status(200).json({ ok: true })
        : res.status(404).json({ ok: false, error: '没有这条内容' });
    }

    /* ---------- 插队：排到次日 ---------- */
    if (action === 'jump') {
      const id = String(body.id || '');
      const all = await listContentRows({});
      const row = all.find((r) => r.id === id);
      if (!row) return res.status(404).json({ ok: false, error: '没有这条内容' });

      const target = addDays(today, 1);
      if (row.publish_at !== target) await makeSlot(target, today);
      await updateContentRow(id, { publish_at: target, status: 'queued' });
      clearContentCache();
      return res.status(200).json({ ok: true, publishAt: target });
    }

    return res.status(400).json({ ok: false, error: '未知 action' });
  } catch (e) {
    console.error('admin api failed:', e);
    return res.status(500).json({ ok: false, error: '服务暂时不可用' });
  }
}
