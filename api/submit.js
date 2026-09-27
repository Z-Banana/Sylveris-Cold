/**
 * POST /api/submit — 接收投稿，写入审核队列。
 * Vercel Serverless Function（Node.js Runtime）。
 */

import { addSubmission, isValidKind } from '../lib/db.mjs';

const RATE = new Map(); // 简易限流：ip -> [timestamps]
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function limited(ip) {
  const now = Date.now();
  const list = (RATE.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) return true;
  list.push(now);
  RATE.set(ip, list);
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: '仅支持 POST' });

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    'local';

  if (limited(ip)) {
    return res.status(429).json({ ok: false, error: '投得太勤了，歇一会儿再投。' });
  }

  const body = req.body || {};
  const kind = String(body.kind || '');
  const text = String(body.body || '').trim();
  const author = String(body.author || '').trim();
  const source = String(body.source || '').trim();

  // 蜜罐：机器人会填，正常人不会
  if (body.website) return res.status(200).json({ ok: true });

  if (!isValidKind(kind)) return res.status(400).json({ ok: false, error: '类型不对。' });
  if (!text) return res.status(400).json({ ok: false, error: '正文不能为空。' });
  if (text.length < 4) return res.status(400).json({ ok: false, error: '正文太短了。' });
  if (text.length > 1000) return res.status(400).json({ ok: false, error: '正文超过 1000 字。' });
  if (author.length > 40) return res.status(400).json({ ok: false, error: '署名太长了。' });
  if (source.length > 160) return res.status(400).json({ ok: false, error: '来源太长了。' });
  if (/<script|https?:\/\//i.test(author + source)) {
    return res.status(400).json({ ok: false, error: '署名和来源里不要放链接或代码。' });
  }

  try {
    const row = await addSubmission({ kind, body: text, author: author || null, source: source || null });
    return res.status(200).json({ ok: true, id: row.id });
  } catch (e) {
    console.error('submit failed:', e);
    return res.status(500).json({ ok: false, error: '服务暂时不可用，请稍后再试。' });
  }
}
