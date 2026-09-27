/**
 * POST /api/visit — 页面访问计数，后台「访问统计」的数据来源。
 *
 * 设计原则：
 *   - 只累加「日期 + 板块」两个维度的次数，**不存 IP、不存 UA、不存任何可识别信息**；
 *   - 页面由 CDN 缓存 5 分钟，若在服务端渲染时计数会漏掉绝大多数命中缓存的访问，
 *     所以改由前端在页面加载时上报一次（JS 不执行的爬虫天然不计入）；
 *   - 已过滤已知爬虫 UA，并用 Origin 做同源校验，避免被跨站伪造刷数；
 *   - 任何失败都返回 ok，绝不能影响页面。
 */

import { recordVisit, visitBucket } from '../lib/db.mjs';
import { todayCN } from '../lib/config.mjs';

const BOT =
  /bot|crawl|spider|slurp|preview|monitor|scanner|headless|lighthouse|pagespeed|pingdom|uptime|curl|wget|python|java\/|libhttp|okhttp|go-http|scrapy|axios|node-fetch/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: '只接受 POST' });
  }

  const host = String(req.headers.host || '');
  const origin = String(req.headers.origin || '');
  if (origin && host && !origin.endsWith(host)) {
    return res.status(403).json({ ok: false, error: '跨站请求已拒绝' });
  }

  const ua = String(req.headers['user-agent'] || '');
  if (BOT.test(ua)) return res.status(200).json({ ok: true, skipped: 'bot' });

  let p = '/';
  let notFound = false;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    p = String(body.path || '/');
    notFound = body.nf === 1 || body.nf === true;
  } catch {
    /* 保持默认 */
  }
  if (!p.startsWith('/')) p = '/';

  // 404 单独成一栏：能直接看出有没有坏链、爬虫在撞什么地址
  const bucket = notFound ? '404 页' : visitBucket(p);
  await recordVisit(todayCN(), bucket);
  return res.status(200).json({ ok: true });
}
