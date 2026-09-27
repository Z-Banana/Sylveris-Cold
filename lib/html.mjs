/**
 * HTML 模板：全站共用的 <head>、页头、页脚。
 * 不做花哨的东西，只保证语义、SEO 与排版一致。
 */

import { site } from '../data/site.js';

export const navItems = [
  { href: '/', label: '首页' },
  { href: '/facts/', label: '冷知列表' },
  { href: '/feihua/', label: '废话文学馆' },
  { href: '/jokes/', label: '冷笑话' },
  { href: '/archive/', label: '年轮归档' },
  { href: '/random/', label: '随机冷知' },
  { href: '/search/', label: '搜索' },
];

const ICONS = {
  random:
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
  feihua:
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 10h8M8 13h5"/></svg>',
  joke:
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.4 2.2 2.1 3.5 2.1s2.5-.7 3.5-2.1"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
};

export function icon(name) {
  return ICONS[name] || '';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { esc };

/** 页面头部：SEO、结构化数据、社交卡片 */
export function head({
  title,
  description,
  path = '/',
  canonical,
  jsonLd = [],
  ogType = 'website',
  image,
  noindex = false,
} = {}) {
  const url = canonical || site.url + (path === '/' ? '/' : path);
  const desc = description || site.description;
  const og = image || `${site.url}/assets/icons/icon-512.png`;
  const fullTitle = title ? `${title} · Sylveris ${site.name}` : `Sylveris ${site.name}｜${site.tagline}`;

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: `Sylveris ${site.name}`,
      alternateName: site.name,
      url: site.url + '/',
      inLanguage: 'zh-CN',
      description: site.description,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${site.url}/search/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    ...jsonLd,
  ];

  return `<!DOCTYPE html>
<html lang="${site.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(site.keywords.join(','))}">
<meta name="author" content="${esc(site.author)}">
<meta name="robots" content="${noindex ? 'noindex,nofollow' : 'index,follow,max-snippet:-1,max-image-preview:large'}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#f6f5f0">
<meta name="format-detection" content="telephone=no">

<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Sylveris ${site.name}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:locale" content="zh_CN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(og)}">

<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/assets/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="manifest" href="/assets/icons/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)} RSS" href="/rss.xml">
<link rel="stylesheet" href="/assets/css/style.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>`;
}

export function header(current = '/') {
  const links = navItems
    .map((n) => {
      const active = n.href === current ? ' aria-current="page"' : '';
      return `<a href="${n.href}"${active}>${n.label}</a>`;
    })
    .join('\n        ');

  return `<header class="site-head">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Sylveris ${site.name} 首页">
      <span class="brand-mark">Sylveris</span>
      <span class="brand-name">${site.name}</span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">菜单</button>
    <nav class="nav" id="site-nav" aria-label="主导航">
        ${links}
    </nav>
  </div>
</header>`;
}

export function footer() {
  const year = new Date().getFullYear();
  return `<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <h2>林子里</h2>
        <ul>
          <li><a href="/facts/">冷知列表</a></li>
          <li><a href="/feihua/">废话文学馆</a></li>
          <li><a href="/jokes/">冷笑话</a></li>
          <li><a href="/archive/">年轮归档</a></li>
        </ul>
      </div>
      <div>
        <h2>做点什么</h2>
        <ul>
          <li><a href="/random/">随机冷知</a></li>
          <li><a href="/submit/">投稿</a></li>
          <li><a href="/search/">搜索</a></li>
          <li><a href="/about/">关于本站</a></li>
        </ul>
      </div>
      <div>
        <h2>订阅</h2>
        <ul>
          <li><a href="/rss.xml">RSS 订阅</a></li>
          <li><a href="/sitemap.xml">站点地图</a></li>
        </ul>
        <form class="search-box" action="/search/" method="get" style="margin-top:14px;max-width:280px" role="search">
          <input type="search" name="q" placeholder="站内搜索" aria-label="站内搜索">
          <button class="btn btn-quiet" type="submit">搜</button>
        </form>
      </div>
    </div>
    <p class="foot-note">
      <span class="brand-inline">Sylveris</span> ${site.name}　${site.tagline}<br>
      © ${year} ${site.author}　·　<a href="/rss.xml">RSS</a>　·　<a href="/about/">关于</a>　·　<a href="/archive/">归档</a>
      ${site.icp ? `<br><a href="https://beian.miit.gov.cn/" rel="nofollow noopener" target="_blank">${site.icp}</a>` : ''}
    </p>
  </div>
</footer>
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

/** 完整页面 */
export function page(opts, body) {
  return head(opts) + '\n' + header(opts.path) + '\n' + body + '\n' + footer();
}
