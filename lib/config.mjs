/**
 * 全局小配置：后台路径、缓存策略、时区。
 * 后台入口不放在任何页面链接里，也不进 sitemap，只在 README 里告诉你。
 */

/** 后台路径（可用环境变量 ADMIN_PATH 修改，形如 /xxxx-yyyy/） */
export function adminPath() {
  const raw = String(process.env.ADMIN_PATH || '/linjian-7c4f/');
  const p = raw.startsWith('/') ? raw : '/' + raw;
  return p.endsWith('/') ? p : p + '/';
}

/** 站点按北京时间（UTC+8）判定“今天” */
export function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 在 YYYY-MM-DD 上加 n 天 */
export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 页面缓存：浏览器短缓存，CDN 缓存 5 分钟（改内容最迟 5 分钟生效） */
export const HTML_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';
/** 数据接口缓存 */
export const DATA_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
/** 后台页面：绝不缓存 */
export const ADMIN_CACHE = 'no-store, no-cache, must-revalidate';
