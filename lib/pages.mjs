/**
 * 页面渲染：所有页面 HTML 的唯一来源。
 * 静态兜底构建（scripts/build.mjs --static）与动态渲染（api/render.js）共用这里，
 * 保证两种模式输出一致。
 *
 * ctx = { facts, feihua, jokes, today, todayItem, stats, source }
 */

import { site } from '../data/site.js';
import { page, head, header, footer, esc, icon } from './html.mjs';

export const PAGE_SIZE = 10;

export function excerpt(text, n = 66) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/* ---------------- 通用小组件 ---------------- */

function relatedTo(target, pool, limit = 5) {
  const tags = new Set(target.tags || []);
  const scored = pool
    .filter((f) => f.slug !== target.slug)
    .map((f) => {
      let score = 0;
      for (const t of f.tags || []) if (tags.has(t)) score += 1;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.f.date).localeCompare(String(a.f.date)));

  const out = scored.slice(0, limit).map((x) => x.f);
  for (const f of pool) {
    if (out.length >= Math.min(limit, 4)) break;
    if (f.slug === target.slug || out.includes(f)) continue;
    if (!(f.tags || []).some((t) => tags.has(t))) out.push(f);
  }
  return out.slice(0, limit);
}

function factListItems(list) {
  if (!list.length) return `<li><p class="empty-tip">这一栏还是空的，内容正在路上。</p></li>`;
  return list
    .map(
      (f) => `
      <li>
        <p class="item-title"><a href="/facts/${f.slug}/">${esc(f.title)}</a></p>
        <p class="item-summary">${esc(excerpt(f.body))}</p>
        <p class="item-meta"><span>${esc(f.date)}</span><span class="tag">${esc((f.tags || []).join(' / '))}</span>${
          f.fromReader ? '<span class="reader-flag">来自林间投稿</span>' : ''
        }</p>
      </li>`
    )
    .join('');
}

/** 今日冷知：优先取“今天上线的那条冷知”，否则按日期轮换 */
function dailyFact(ctx) {
  const t = ctx.todayItem;
  if (t && 'feihua' in t && 'body' in t) return t;
  return ctx.facts[0] || null;
}

/* ---------------- 冷知详情页 ---------------- */

export function renderFactPage(ctx, f) {
  const rel = relatedTo(f, ctx.facts, 5);
  const body = `
<main id="main">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑">
      <a href="/">首页</a><span class="sep">/</span>
      <a href="/facts/">冷知列表</a><span class="sep">/</span>
      <span>${esc(f.title)}</span>
    </nav>

    <article class="article">
      <p class="article-kicker">${esc(f.date)}${f.fromReader ? '　来自林间投稿' : ''}</p>
      <h1>${esc(f.title)}</h1>
      <div class="article-body">
        <p>${esc(f.body)}</p>
      </div>
      ${f.feihua ? `<p class="article-feihua">废话：${esc(f.feihua)}</p>` : ''}
      <div class="tags" style="margin-top:24px">
        ${(f.tags || []).map((t) => `<a class="tag-pill" href="/search/?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
      </div>
      <p class="article-source">${esc(f.source || '来源：林间收录')}</p>
    </article>

    <section class="related" aria-labelledby="related-h">
      <div class="section-head">
        <h2 id="related-h">相关冷知</h2>
        <a class="more" href="/facts/">全部冷知</a>
      </div>
      <ul>
        ${rel
          .map(
            (r) =>
              `<li><a href="/facts/${r.slug}/">${esc(r.title)}</a><span class="item-meta" style="display:inline;margin-left:12px">${esc(r.date)}</span></li>`
          )
          .join('\n        ')}
      </ul>
    </section>

    <div class="share-row">
      <a href="/facts/">换一条冷知</a>
      <a href="/submit/">我也投一条</a>
      <a href="/archive/">看年轮</a>
    </div>
  </div>
</main>`;

  return page(
    {
      title: f.title,
      description: excerpt(f.body, 76),
      path: `/facts/${f.slug}/`,
      ogType: 'article',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: f.title,
          description: excerpt(f.body, 90),
          datePublished: f.date,
          dateModified: f.date,
          inLanguage: 'zh-CN',
          author: { '@type': 'Organization', name: `Sylveris ${site.name}` },
          publisher: { '@type': 'Organization', name: `Sylveris ${site.name}`, url: site.url + '/' },
          mainEntityOfPage: `${site.url}/facts/${f.slug}/`,
          keywords: (f.tags || []).join(','),
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: '首页', item: site.url + '/' },
            { '@type': 'ListItem', position: 2, name: '冷知列表', item: site.url + '/facts/' },
            { '@type': 'ListItem', position: 3, name: f.title, item: `${site.url}/facts/${f.slug}/` },
          ],
        },
      ],
    },
    body
  );
}

/* ---------------- 列表页 ---------------- */

export function renderFactsIndex(ctx, pageNum) {
  const allFacts = ctx.facts;
  const start = (pageNum - 1) * PAGE_SIZE;
  const slice = allFacts.slice(start, start + PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(allFacts.length / PAGE_SIZE));

  const pager =
    pages > 1
      ? `<nav class="pager" aria-label="分页">
      ${pageNum > 1 ? `<a href="${pageNum === 2 ? '/facts/' : '/facts/page/' + (pageNum - 1) + '/'}">← 上一页</a>` : '<span></span>'}
      <span>第 ${pageNum} / ${pages} 页，共 ${allFacts.length} 条</span>
      ${pageNum < pages ? `<a href="/facts/page/${pageNum + 1}/">下一页 →</a>` : '<span></span>'}
    </nav>`
      : '';

  // 随机冷知：只放在第 1 页最上面（旧 /random/ 独立页已并入这里）
  const randomCard =
    pageNum === 1 && allFacts.length
      ? `<section class="section" aria-labelledby="rand-h" style="margin-bottom:28px">
      <div class="section-head"><h2 id="rand-h">随机冷知</h2><span class="more">随手翻开一条</span></div>
      <div class="random-card" id="random-card">
      <p class="r-fact">${esc(allFacts[0].title)}。</p>
      <p class="r-feihua">废话：${esc(allFacts[0].feihua || '这一条没有废话。')}</p>
      <p class="item-meta r-meta">${esc(allFacts[0].date)}　${esc(allFacts[0].source || '')}</p>
      <div class="random-actions">
        <button class="btn" id="random-btn" type="button">换一条</button>
        <a class="btn btn-ghost" href="/facts/${allFacts[0].slug}/" data-random-link>读详情</a>
        <a class="btn btn-quiet" href="/archive/">看年轮</a>
      </div>
    </div>
    </section>`
      : '';

  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">冷知列表</h1>
    <p class="page-lede">冷静地知道一点没用的东西。每条只写必要的一段，来源附在文末。</p>
    ${randomCard}
    <ul class="list">
      ${factListItems(slice)}
    </ul>
    ${pager}
  </div>
</main>`;

  const p = `/facts/${pageNum === 1 ? '' : 'page/' + pageNum + '/'}`;
  return page(
    {
      title: pageNum === 1 ? '冷知列表' : `冷知列表 第${pageNum}页`,
      description: `全部冷知识归档，按收录日期排列。共 ${allFacts.length} 条，来自 Sylveris ${site.name}。`,
      path: p,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: '冷知列表',
          url: site.url + p,
          inLanguage: 'zh-CN',
          about: slice.map((f) => ({
            '@type': 'Thing',
            name: f.title,
            url: `${site.url}/facts/${f.slug}/`,
          })),
        },
      ],
    },
    body
  );
}

/* ---------------- 首页 ---------------- */

export function renderHome(ctx) {
  const allFacts = ctx.facts;
  const latest = allFacts.slice(0, 5);
  const daily = dailyFact(ctx);
  const iso = ctx.today;

  const dailyHtml = daily
    ? `<div class="daily" id="daily">
        <p class="daily-date">${esc(iso)}</p>
        <p class="daily-fact">${esc(daily.title)}。</p>
        <p class="daily-feihua">废话：${esc(daily.feihua || '这一条没有废话。')}</p>
        <div class="daily-meta">
          <span>${esc(daily.source || '')}</span>
          <a href="/facts/${daily.slug}/" data-daily-link>读这一条 →</a>
        </div>
      </div>`
    : `<div class="daily" id="daily"><p class="daily-date">${esc(iso)}</p>
        <p class="daily-fact">林子还在长，内容快来了。</p></div>`;

  const body = `
<main id="main">
  <div class="wrap">

    <section class="hero section">
      <p class="eyebrow">Sylveris · 冷知识林子</p>
      <h1><span class="brand-inline">Sylveris</span> 春林冷知</h1>
      <p class="lede">一片可以慢慢散步的冷知识林子。冷静地知道一点没用的东西。</p>
    </section>

    <section class="section" aria-labelledby="daily-h">
      <div class="section-head">
        <h2 id="daily-h">今日冷知</h2>
        <span class="more">每天自动更换</span>
      </div>
      ${dailyHtml}
    </section>

    <section class="section" aria-labelledby="entries-h">
      <div class="section-head">
        <h2 id="entries-h">三个入口</h2>
      </div>
      <div class="entries">
        <a class="entry" href="/facts/">
          <span class="entry-icon">${icon('random')}</span>
          <h3>随机冷知</h3>
          <p>不问来路，随手翻开一条。</p>
          <span class="arrow">换一条 →</span>
        </a>
        <a class="entry" href="/feihua/">
          <span class="entry-icon">${icon('feihua')}</span>
          <h3>废话文学馆</h3>
          <p>说了很多，又好像什么都没说。</p>
          <span class="arrow">进去看看 →</span>
        </a>
        <a class="entry" href="/jokes/">
          <span class="entry-icon">${icon('joke')}</span>
          <h3>冷笑话</h3>
          <p>不好笑也没关系，冷也是一种温度。</p>
          <span class="arrow">听一个 →</span>
        </a>
      </div>
    </section>

    <section class="section" aria-labelledby="latest-h">
      <div class="section-head">
        <h2 id="latest-h">最新冷知</h2>
        <a class="more" href="/facts/">全部 ${allFacts.length} 条 →</a>
      </div>
      <ul class="list">
        ${factListItems(latest)}
      </ul>
    </section>

    <section class="section" aria-labelledby="submit-h">
      <div class="section-head">
        <h2 id="submit-h">林间投稿</h2>
        <a class="more" href="/submit/">投稿说明 →</a>
      </div>
      <p class="page-lede" style="margin-bottom:20px">
        知道一条没用但有意思的事？写下来交给我们。投稿会先进审核队列，通过后出现在对应板块，并标注「来自林间投稿」。
      </p>
      <a class="btn" href="/submit/">去投稿</a>
    </section>

  </div>
</main>`;

  return page(
    {
      title: '',
      description: site.description,
      path: '/',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: '最新冷知',
          itemListElement: latest.map((f, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: f.title,
            url: `${site.url}/facts/${f.slug}/`,
          })),
        },
      ],
    },
    body
  );
}

/* ---------------- 废话文学馆 ---------------- */

export function renderFeihua(ctx) {
  const allFeihua = ctx.feihua;
  const first = allFeihua[0] || null;
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">废话文学馆</h1>
    <p class="page-lede">每呼吸 60 秒，就减少一分钟寿命。收录那些说了等于没说、但听上去很有道理的话。</p>

    <section class="section" aria-labelledby="rand-h">
      <div class="section-head"><h2 id="rand-h">随机废话</h2><span class="more">随手抽一句</span></div>
      ${
        first
          ? `<div class="random-card" id="feihua-card">
      <p class="r-fact">${esc(first.text)}</p>
      <p class="item-meta r-meta">${esc((first.tags || []).join(' / '))}</p>
      <div class="random-actions">
        <button class="btn" id="feihua-btn" type="button">换一句</button>
        <a class="btn btn-ghost" href="#list-h">看全部收录</a>
        <a class="btn btn-quiet" href="/submit/">我也投一句</a>
      </div>
    </div>`
          : `<p class="empty-tip">还没有收录，第一条快来了。</p>`
      }
    </section>

    <section class="section" aria-labelledby="list-h">
      <div class="section-head"><h2 id="list-h">废话收录</h2><span class="more">${allFeihua.length} 句</span></div>
      <ul class="list">
        ${
          allFeihua.length
            ? allFeihua
                .map(
                  (f) => `
        <li id="${esc(f.slug)}">
          <p class="item-title" style="font-weight:500">${esc(f.text)}</p>
          <p class="item-meta"><span class="tag">${esc((f.tags || []).join(' / '))}</span>${
                    f.fromReader ? '<span class="reader-flag">来自林间投稿</span>' : ''
                  }</p>
        </li>`
                )
                .join('')
            : `<li><p class="empty-tip">还没有收录，第一条快来了。</p></li>`
        }
      </ul>
    </section>
  </div>
</main>`;

  return page(
    {
      title: '废话文学馆',
      description:
        '废话文学馆：收录「每呼吸 60 秒，就减少一分钟寿命」这类说了等于没说的话，随机抽一句，也欢迎投稿。',
      path: '/feihua/',
    },
    body
  );
}

/* ---------------- 冷笑话 ---------------- */

export function renderJokes(ctx) {
  const allJokes = ctx.jokes;
  const first = allJokes[0] || null;
  const cats = ['全部', ...Array.from(new Set(allJokes.map((j) => j.cat)))];
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">冷笑话</h1>
    <p class="page-lede">不好笑也正常。点一下标题，展开完整的一段。</p>

    <section class="section" aria-labelledby="rand-h" style="margin-bottom:28px">
      <div class="section-head"><h2 id="rand-h">随机冷笑话</h2><span class="more">不好笑就换一条</span></div>
      ${
        first
          ? `<div class="random-card" id="joke-card">
      <p class="r-fact">${esc(first.title)}</p>
      <p class="r-feihua">${esc(first.line)}</p>
      <p class="item-meta r-meta">${esc(first.cat)}</p>
      <div class="r-full" id="joke-full" hidden>${esc(first.full)}${
                first.fromReader ? '<br><span class="reader-flag" style="font-size:13px">来自林间投稿</span>' : ''
              }</div>
      <div class="random-actions">
        <button class="btn" id="joke-btn" type="button">换一条</button>
        <button class="btn btn-ghost" id="joke-expand" type="button" aria-expanded="false" aria-controls="joke-full">展开全文</button>
        <a class="btn btn-quiet" href="/submit/">我也投一条</a>
      </div>
    </div>`
          : `<p class="empty-tip">还没有笑话，冷空气正在路上。</p>`
      }
    </section>

    <div class="cat-bar" id="cat-bar" role="group" aria-label="分类筛选">
      ${cats
        .map(
          (c, i) =>
            `<button type="button" data-cat="${esc(c)}" class="${i === 0 ? 'is-active' : ''}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(c)}</button>`
        )
        .join('')}
      <span class="more" id="joke-count" style="align-self:center;margin-left:8px">${allJokes.length} 条</span>
    </div>

    <div id="joke-list">
      ${
        allJokes.length
          ? allJokes
              .map(
                (j) => `
      <details class="joke" id="${esc(j.slug)}" data-cat="${esc(j.cat)}">
        <summary>
          <span class="j-title">${esc(j.title)}</span>
          <span class="j-line">${esc(j.line)}</span>
          <span class="j-cue">展开全文</span>
        </summary>
        <div class="j-full">${esc(j.full)}${
                  j.fromReader ? '<br><span class="reader-flag" style="font-size:13px">来自林间投稿</span>' : ''
                }</div>
      </details>`
              )
              .join('')
          : `<p class="empty-tip">还没有笑话，冷空气正在路上。</p>`
      }
    </div>
  </div>
</main>`;

  const jsonLd = allJokes.length
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: allJokes.slice(0, 12).map((j) => ({
            '@type': 'Question',
            name: j.title,
            acceptedAnswer: { '@type': 'Answer', text: j.full },
          })),
        },
      ]
    : [];

  return page(
    {
      title: '冷笑话',
      description: '冷笑话合集，按「动物」「生活」「文字梗」分类，点开看完整的一段。',
      path: '/jokes/',
      jsonLd,
    },
    body
  );
}

/* ---------------- 年轮归档 ---------------- */

export function renderArchive(ctx) {
  const months = new Map();
  for (const f of ctx.facts) {
    const m = (f.date || '').slice(0, 7);
    if (!m) continue;
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(f);
  }
  const keys = [...months.keys()].sort().reverse();

  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">年轮归档</h1>
    <p class="page-lede">一圈一年，一条一天。按月份倒序排列。</p>
    <div class="year-ring">
      ${
        keys.length
          ? keys
              .map((k) => {
                const [y, mm] = k.split('-');
                const items = months
                  .get(k)
                  .map(
                    (f) =>
                      `<li><span class="d">${esc(f.date.slice(5))}</span><a href="/facts/${f.slug}/">${esc(f.title)}。</a></li>`
                  )
                  .join('\n            ');
                return `      <section class="month">
        <h2>${y} 年 ${Number(mm)} 月<span style="float:right;font-weight:400;color:var(--ink-3);font-size:13px">${months.get(k).length} 条</span></h2>
        <ol>
            ${items}
        </ol>
      </section>`;
              })
              .join('\n')
          : `<p class="empty-tip">年轮还没长出来。</p>`
      }
    </div>
  </div>
</main>`;

  return page(
    {
      title: '年轮归档',
      description: `冷知识年轮归档，按月份排列，共 ${ctx.facts.length} 条。`,
      path: '/archive/',
    },
    body
  );
}

/* ---------------- 搜索 ---------------- */

export function renderSearch() {
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">搜索</h1>
    <p class="page-lede">在冷知、废话与冷笑话里找一找。结果是纯列表，只有标题和摘要。</p>

    <form class="search-box" id="search-form" role="search">
      <input type="search" id="search-input" name="q" placeholder="比如：章鱼、浆果、上班" aria-label="站内搜索">
      <button class="btn" type="submit">搜索</button>
    </form>

    <p class="search-count" id="search-count"></p>
    <ul class="list" id="search-results"></ul>

    <noscript>
      <p class="empty-tip">搜索需要启用 JavaScript。你也可以直接浏览 <a href="/facts/">冷知列表</a> 或 <a href="/archive/">年轮归档</a>。</p>
    </noscript>
  </div>
</main>`;

  return page(
    {
      title: '搜索',
      description: '站内搜索：冷知识、废话文学与冷笑话。',
      path: '/search/',
      noindex: false,
    },
    body
  );
}

/* ---------------- 关于 ---------------- */

export function renderAbout() {
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">关于 <span style="color:var(--green-deep)">Sylveris</span> 春林冷知</h1>
    <div class="prose">
      <p>一片可以慢慢散步的冷知识林子。冷静地知道一点没用的东西。</p>

      <h2>这里有什么</h2>
      <ul>
        <li><strong>每日冷知</strong>：首页每天换一条，日期一到自动更新。</li>
        <li><strong>冷知列表与详情</strong>：每条附来源，底部给三到五条相关冷知。</li>
        <li><strong>废话文学馆</strong>：收录废话，也能随手抽一句。</li>
        <li><strong>冷笑话</strong>：按动物、生活、文字梗分类，点开看全文，也能随机抽一条。</li>
        <li><strong>年轮归档</strong>：按月份纯文字排列，像树的年轮。</li>
        <li><strong>林间投稿</strong>：你写，我们审，通过了就挂出来。</li>
      </ul>

      <h2>不做什么</h2>
      <p>不做积分等级，不做排行榜，不弹窗，不做深浅色切换，不放聊天机器人。页面元素少一点，留白多一点，读起来才不累。</p>

      <h2>来源与勘误</h2>
      <p>每条冷知都标注来源或参考方向。内容为编辑整理，若发现错误，欢迎<a href="/submit/">投稿</a>指出。</p>

      <h2>投稿规则</h2>
      <p>投稿提交后进入审核队列，不会即时公开。通过审核的内容会出现在对应板块，并标注「来自林间投稿」。请不要提交广告、侵权或与本站调性不符的内容。</p>

      <h2>订阅</h2>
      <p>提供 <a href="/rss.xml">RSS</a> 与 <a href="/sitemap.xml">站点地图</a>，搜索引擎可提交 <a href="/sitemap.xml">sitemap.xml</a>。</p>

      <h2>更多小工具</h2>
      <p>更多小工具，见 <a href="${site.homeSite ? site.homeSite.url : 'https://sylveris.top'}" rel="noopener">${site.homeSite ? site.homeSite.name : '银叶集'}</a>。</p>
    </div>
  </div>
</main>`;

  return page(
    {
      title: '关于',
      description: '关于 Sylveris 春林冷知：定位、内容范围、来源说明与投稿规则。',
      path: '/about/',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          name: '关于 Sylveris 春林冷知',
          url: site.url + '/about/',
          inLanguage: 'zh-CN',
        },
      ],
    },
    body
  );
}

/* ---------------- 投稿 ---------------- */

export function renderSubmit() {
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">林间投稿</h1>
    <p class="page-lede">知道一条没用但有意思的事？写下来。投稿进入审核队列，不会即时公开。</p>

    <div class="form-status" id="submit-status" role="status" aria-live="polite"></div>

    <form id="submit-form" class="prose" style="max-width:560px" novalidate>
      <div class="field">
        <label for="f-kind">类型</label>
        <select id="f-kind" name="kind" required>
          <option value="fact">冷知</option>
          <option value="feihua">废话</option>
          <option value="joke">冷笑话</option>
        </select>
      </div>

      <div class="field">
        <label for="f-body">正文</label>
        <textarea id="f-body" name="body" maxlength="1000" required
          placeholder="一句话也行，一段也行。&#10;例：章鱼有三颗心脏。"></textarea>
        <p class="hint">最多 1000 字。冷笑话请把梗写完整。</p>
      </div>

      <div class="field">
        <label for="f-author">署名（可选）</label>
        <input type="text" id="f-author" name="author" maxlength="40" placeholder="不填就写「匿名」">
      </div>

      <div class="field">
        <label for="f-source">来源（可选）</label>
        <input type="text" id="f-source" name="source" maxlength="160" placeholder="书名、链接、或者「自己想的」">
      </div>

      <div class="field" style="position:absolute;left:-9999px" aria-hidden="true">
        <label for="f-website">请留空</label>
        <input type="text" id="f-website" name="website" tabindex="-1" autocomplete="off">
      </div>

      <button class="btn" type="submit">提交投稿</button>
      <p class="form-note" style="margin-top:18px">
        提交即表示你确认内容原创或已获授权，且同意本站审核后署名展示。审核结果不单独通知。
      </p>
    </form>
  </div>
</main>`;

  return page(
    {
      title: '投稿',
      description: '向 Sylveris 春林冷知投稿：冷知识、废话、冷笑话。投稿进入审核队列，通过后署名展示。',
      path: '/submit/',
    },
    body
  );
}

/* ---------------- 404 ---------------- */

export function render404() {
  const body = `
<main id="main">
  <div class="wrap">
    <h1 class="page-title">这条林子小路没找到</h1>
    <p class="page-lede">你要找的页面不在这里。也许是链接旧了，也许它已经走远了。</p>
    <p><a class="btn btn-ghost" href="/">回首页</a>
       <a class="btn btn-quiet" href="/facts/" style="margin-left:12px">看冷知列表</a></p>
  </div>
</main>`;

  return (
    head({ title: '页面不存在', description: '页面不存在。', path: '/404.html', noindex: true }) +
    '\n' +
    header('/') +
    '\n' +
    body +
    '\n' +
    footer()
  );
}

/* ================= 管理台（隐藏入口） ================= */

const ADMIN_TPL = `你是冷知识编辑。按下面格式输出，用 --- 分隔每条，一次给 N 条：

【冷知】
标题：一句话标题（12 字以内）
正文：一段 80~200 字的冷知识，最后一句收个尾。
来源：书名 / 资料方向
标签：两个标签，用中文逗号隔开
废话：一句相关的废话（可空）
---
【冷笑话】
分类：动物 / 生活 / 文字梗
题目：题目
正文：完整的梗，别太长
---
【废话】
正文：一句说了等于没说的话
标签：关键词`;

export function renderAdminConsole(ctx, adminPath) {
  const body = `
<main id="main">
  <div class="wrap admin">
    <h1 class="page-title">林间管理台</h1>

    <div id="ad-login" class="ad-login">
      <div class="search-box" style="max-width:420px">
        <input type="password" id="ad-pw" placeholder="管理密码" aria-label="管理密码" autocomplete="current-password">
        <button class="btn" id="ad-login-btn" type="button">进入</button>
      </div>
      <p class="search-count" id="ad-login-msg" role="status" aria-live="polite"></p>
    </div>

    <div id="ad-app" hidden>
      <div class="ad-stats" id="ad-stats"></div>
      <p class="ad-notice" id="ad-notice" hidden></p>

      <div class="ad-tabs" id="ad-tabs" role="tablist">
        <button type="button" data-tab="import" class="is-active">上传导入</button>
        <button type="button" data-tab="library">内容库</button>
        <button type="button" data-tab="review">投稿审核</button>
        <button type="button" data-tab="stats">访问统计</button>
        <button type="button" data-tab="logout" class="ad-logout">退出</button>
      </div>

      <!-- 上传导入 -->
      <section id="ad-tab-import" class="ad-panel">
        <p class="page-lede" style="margin-bottom:16px">
          把 AI 写好的 .txt 或 .json 传上来（也可以直接粘贴）。先解析预览，确认无误再入库。
          入库后按「一天一条」自动排期。
        </p>

        <div class="field">
          <label for="ad-file">选择文件</label>
          <input type="file" id="ad-file" accept=".txt,.json,.md,text/plain,application/json">
        </div>
        <div class="field">
          <label for="ad-text">或直接粘贴内容</label>
          <textarea id="ad-text" rows="12" placeholder="【冷知】&#10;标题：…&#10;正文：…&#10;来源：…&#10;标签：a，b&#10;---&#10;【冷笑话】&#10;分类：动物&#10;正文：…"></textarea>
        </div>

        <details class="ad-tpl">
          <summary>给 AI 的提示词模板（点开复制）</summary>
          <pre id="ad-tpl-pre">${esc(ADMIN_TPL)}</pre>
          <button type="button" class="btn btn-quiet" id="ad-tpl-copy">复制模板</button>
        </details>

        <div class="ad-actions">
          <label class="ad-inline-label" for="ad-start">起始日期（可空＝自动排在现有队列之后）
            <input type="date" id="ad-start"></label>
          <button class="btn btn-ghost" id="ad-parse" type="button">解析预览</button>
          <button class="btn" id="ad-commit" type="button" disabled>确认入库</button>
        </div>

        <p class="search-count" id="ad-import-msg" role="status" aria-live="polite"></p>
        <div id="ad-preview" class="ad-preview"></div>
      </section>

      <!-- 内容库 -->
      <section id="ad-tab-library" class="ad-panel" hidden>
        <div class="ad-filter">
          <button type="button" data-filter="" class="is-active">全部</button>
          <button type="button" data-filter="queued">待上线</button>
          <button type="button" data-filter="live">已上线</button>
          <button type="button" data-filter="draft">草稿</button>
          <input type="search" id="ad-search" placeholder="搜标题 / 正文" aria-label="搜索内容">
        </div>
        <p class="search-count" id="ad-lib-msg" role="status" aria-live="polite"></p>
        <div id="ad-lib-list" class="ad-list"></div>
        <button class="btn btn-quiet" id="ad-lib-more" type="button" hidden>加载更多</button>
      </section>

      <!-- 投稿审核 -->
      <section id="ad-tab-review" class="ad-panel" hidden>
        <p class="page-lede" style="margin-bottom:16px">通过的投稿会排进内容队列，按次日插队上线，并标注「来自林间投稿」。</p>
        <p class="search-count" id="ad-rev-msg" role="status" aria-live="polite"></p>
        <ul class="list" id="ad-rev-list"></ul>
      </section>

      <!-- 访问统计 -->
      <section id="ad-tab-stats" class="ad-panel" hidden>
        <p class="page-lede" style="margin-bottom:16px">
          数字来自页面脚本每次加载时上报一次，服务端按「日期 + 板块」累加。
          只记次数，<strong>不存 IP、不存 UA、不存任何可识别信息</strong>，已过滤已知爬虫。
        </p>
        <div class="ad-stats" id="ad-visit-cards"></div>
        <p class="search-count" id="ad-visit-msg" role="status" aria-live="polite"></p>
        <div class="ad-two-col">
          <div>
            <h3 class="ad-sub-h">按天（近 30 天）</h3>
            <div class="ad-table-wrap" id="ad-visit-dates"></div>
          </div>
          <div>
            <h3 class="ad-sub-h">按板块（近 30 天）</h3>
            <div class="ad-table-wrap" id="ad-visit-buckets"></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</main>

<script>
(function () {
  window.__TODAY__ = '${ctx.today}';
  var KEY = 'sy_tk';
  var pending = null; // 待入库的解析结果

  function $(id) { return document.getElementById(id); }
  function tk() { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setTk(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kindLabel(k) { return k === 'fact' ? '冷知' : k === 'joke' ? '冷笑话' : k === 'feihua' ? '废话' : k; }
  function statusLabel(s) { return s === 'draft' ? '草稿' : '待上线'; }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk() }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; });
    });
  }

  function dieIfAuth(res) {
    if (res.s === 401) { setTk(''); showLogin('登录已过期，请重新进入。'); return true; }
    return false;
  }

  /* ---------- 登录 ---------- */
  function showLogin(msg) {
    $('ad-login').hidden = false;
    $('ad-app').hidden = true;
    if (msg) $('ad-login-msg').textContent = msg;
  }
  function showApp() {
    $('ad-login').hidden = true;
    $('ad-app').hidden = false;
    loadStats();
    showTab('import');
  }
  $('ad-login-btn').addEventListener('click', doLogin);
  $('ad-pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  function doLogin() {
    var pw = $('ad-pw').value;
    if (!pw) { $('ad-login-msg').textContent = '请输入密码。'; return; }
    $('ad-login-msg').textContent = '验证中…';
    fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', password: pw })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j.ok && j.token) { setTk(j.token); $('ad-pw').value = ''; $('ad-login-msg').textContent = ''; showApp(); }
        else $('ad-login-msg').textContent = j.error || '密码不对。';
      })
      .catch(function () { $('ad-login-msg').textContent = '网络错误。'; });
  }

  /* ---------- 页签 ---------- */
  function showTab(name) {
    if (name === 'logout') { setTk(''); showLogin('已退出。'); return; }
    ['import', 'library', 'review', 'stats'].forEach(function (t) {
      $('ad-tab-' + t).hidden = t !== name;
    });
    var btns = $('ad-tabs').querySelectorAll('button[data-tab]');
    [].forEach.call(btns, function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === name); });
    if (name === 'library') loadLibrary(true);
    if (name === 'review') loadReview();
    if (name === 'import') loadStats();
    if (name === 'stats') loadVisits();
  }
  $('ad-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) showTab(b.getAttribute('data-tab'));
  });

  /* ---------- 统计条 ---------- */
  function loadStats() {
    api('/api/admin?view=overview').then(function (res) {
      if (dieIfAuth(res)) return;
      if (!res.j.ok) { return; }
      var o = res.j.overview || {};
      var cells = [
        ['已上线', o.live + ' 条'],
        ['队列', o.queued + ' 条（约 ' + Math.max(o.queued, 0) + ' 天）'],
        ['草稿', o.draft + ' 条'],
        ['今天', o.todayTitle || '（今天没有新排期）'],
        ['下一条', o.nextDate || '—']
      ];
      $('ad-stats').innerHTML = cells.map(function (c) {
        return '<div class="ad-stat"><span>' + esc(c[0]) + '</span><strong>' + esc(c[1]) + '</strong></div>';
      }).join('');

      // 内容库为空 → 站点在用内置种子，提示站长先导入
      var notice = $('ad-notice');
      if (o.seeded) {
        notice.hidden = false;
        notice.innerHTML = '内容库还是空的，站点正在展示 <strong>' + (o.siteFacts || 0) +
          ' 条内置种子冷知</strong>（来自 data/*.js）。在这里上传的内容会按天排期上线；' +
          '若要让种子也进队列管理，先在项目目录运行 <code>npm run seed</code>。';
      } else {
        notice.hidden = true;
        notice.textContent = '';
      }
    });
  }

  /* ---------- 访问统计 ---------- */
  function pct(part, total) {
    return total ? Math.round((part / total) * 100) + '%' : '0%';
  }

  function loadVisits() {
    var msg = $('ad-visit-msg');
    msg.textContent = '统计中…';
    api('/api/admin?view=visits').then(function (res) {
      if (dieIfAuth(res)) return;
      if (!res.j.ok) { msg.textContent = (res.j && res.j.error) || '读取失败。'; return; }

      var v = res.j.visits || {};
      var dates = v.byDate || [];
      var buckets = v.byBucket || [];
      var total = v.total || 0;

      $('ad-visit-cards').innerHTML = [
        ['今日访问', (v.todayViews || 0) + ' 次'],
        ['昨日访问', (v.yesterdayViews || 0) + ' 次'],
        ['近 30 天', total + ' 次'],
        ['有访问的天数', dates.length + ' 天'],
      ].map(function (c) {
        return '<div class="ad-stat"><span>' + esc(c[0]) + '</span><strong>' + esc(c[1]) + '</strong></div>';
      }).join('');

      $('ad-visit-dates').innerHTML = dates.length
        ? '<table class="ad-table"><thead><tr><th>日期</th><th>访问</th><th>占比</th></tr></thead><tbody>' +
          dates.map(function (d) {
            return '<tr><td>' + esc(d.date) + '</td><td>' + d.views + '</td><td>' + pct(d.views, total) + '</td></tr>';
          }).join('') +
          '</tbody></table>'
        : '<p class="empty-tip">还没有访问记录。用浏览器打开站点任意一页，就会自动上报一次。</p>';

      $('ad-visit-buckets').innerHTML = buckets.length
        ? '<table class="ad-table"><thead><tr><th>板块</th><th>访问</th><th>占比</th></tr></thead><tbody>' +
          buckets.map(function (b) {
            return '<tr><td>' + esc(b.bucket) + '</td><td>' + b.views + '</td><td>' + pct(b.views, total) + '</td></tr>';
          }).join('') +
          '</tbody></table>'
        : '<p class="empty-tip">暂无数据。</p>';

      msg.textContent = '统计区间 ' + (v.since || '') + ' ~ ' + (v.today || '') + '，共 ' + total + ' 次。';
    }).catch(function () {
      msg.textContent = '网络错误，统计读取失败。';
    });
  }

  /* ---------- 上传导入 ---------- */
  $('ad-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { $('ad-text').value = String(reader.result || ''); $('ad-import-msg').textContent = '已读取 ' + f.name + '，点「解析预览」。'; };
    reader.readAsText(f, 'utf-8');
  });

  $('ad-tpl-copy').addEventListener('click', function () {
    var text = $('ad-tpl-pre').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    $('ad-import-msg').textContent = '模板已复制，粘贴给 AI 即可。';
  });

  $('ad-parse').addEventListener('click', function () {
    var text = $('ad-text').value;
    if (!text.trim()) { $('ad-import-msg').textContent = '先粘贴内容或选择文件。'; return; }
    $('ad-import-msg').textContent = '解析中…';
    $('ad-commit').disabled = true;
    api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'import', text: text, dryRun: true, startDate: $('ad-start').value || null }) })
      .then(function (res) {
        if (dieIfAuth(res)) return;
        var j = res.j;
        if (!j.ok) { $('ad-import-msg').textContent = '失败：' + (j.error || res.s); return; }
        pending = j.items;
        var msg = '识别到 ' + j.items.length + ' 条，排期 ' + (j.startDate || '—') + ' → ' + (j.endDate || '—') + '，每天 1 条。';
        if (j.errors && j.errors.length) msg += ' 另有 ' + j.errors.length + ' 条有问题（见下表红色提示），不会入库。';
        $('ad-import-msg').textContent = msg;
        $('ad-preview').innerHTML =
          (j.errors && j.errors.length
            ? '<div class="ad-err"><strong>被拒绝的段落：</strong>' + j.errors.map(function (e) { return '<p>' + esc(e.reason) + '</p>'; }).join('') + '</div>'
            : '') +
          '<table class="ad-table"><thead><tr><th>#</th><th>类型</th><th>标题 / 正文</th><th>上线日期</th></tr></thead><tbody>' +
          j.items.map(function (it, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + kindLabel(it.kind) + '</td><td>' + esc(it.preview) + '</td><td>' + esc(it.date) + '</td></tr>';
          }).join('') +
          '</tbody></table>';
        $('ad-commit').disabled = j.items.length === 0;
      })
      .catch(function () { $('ad-import-msg').textContent = '网络错误。'; });
  });

  $('ad-commit').addEventListener('click', function () {
    if (!pending || !pending.length) return;
    $('ad-commit').disabled = true;
    api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'import', text: $('ad-text').value, dryRun: false, startDate: $('ad-start').value || null }) })
      .then(function (res) {
        if (dieIfAuth(res)) return;
        var j = res.j;
        if (!j.ok) { $('ad-import-msg').textContent = '入库失败：' + (j.error || res.s); $('ad-commit').disabled = false; return; }
        $('ad-import-msg').textContent = '已入库 ' + j.inserted + ' 条，排期 ' + j.startDate + ' → ' + j.endDate + '。';
        $('ad-preview').innerHTML = '';
        $('ad-text').value = '';
        $('ad-start').value = '';
        pending = null;
        loadStats();
      })
      .catch(function () { $('ad-import-msg').textContent = '网络错误。'; $('ad-commit').disabled = false; });
  });

  /* ---------- 内容库 ---------- */
  var libFilter = '', libOffset = 0, libQuery = '';

  document.querySelector('#ad-tab-library .ad-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-filter]');
    if (!b) return;
    libFilter = b.getAttribute('data-filter');
    libOffset = 0;
    [].forEach.call(this.querySelectorAll('button[data-filter]'), function (x) { x.classList.toggle('is-active', x === b); });
    loadLibrary(true);
  });
  var searchTimer = null;
  $('ad-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { libQuery = $('ad-search').value; libOffset = 0; loadLibrary(true); }, 300);
  });
  $('ad-lib-more').addEventListener('click', function () { loadLibrary(false); });

  function loadLibrary(reset) {
    if (reset) libOffset = 0;
    $('ad-lib-msg').textContent = '读取中…';
    api('/api/admin?view=content&filter=' + encodeURIComponent(libFilter) + '&q=' + encodeURIComponent(libQuery) + '&offset=' + libOffset)
      .then(function (res) {
        if (dieIfAuth(res)) return;
        if (!res.j.ok) { $('ad-lib-msg').textContent = '失败：' + (res.j.error || res.s); return; }
        var rows = res.j.rows || [];
        if (reset) $('ad-lib-list').innerHTML = '';
        if (!rows.length && reset) $('ad-lib-list').innerHTML = '<p class="empty-tip">没有匹配的内容。</p>';
        $('ad-lib-list').insertAdjacentHTML('beforeend', rows.map(libRow).join(''));
        libOffset += rows.length;
        $('ad-lib-more').hidden = rows.length < 50;
        $('ad-lib-msg').textContent = '共 ' + (res.j.total || 0) + ' 条匹配。';
      })
      .catch(function () { $('ad-lib-msg').textContent = '网络错误。'; });
  }

  function libRow(r) {
    var title = r.kind === 'feihua' ? r.body : (r.title || r.body);
    var isLive = r.status === 'queued' && r.publish_at && r.publish_at <= window.__TODAY__;
    var badge = r.status === 'draft' ? '<span class="ad-badge ad-draft">草稿</span>'
      : isLive ? '<span class="ad-badge ad-live">已上线</span>'
      : '<span class="ad-badge">待上线</span>';
    return '<div class="ad-item" data-id="' + esc(r.id) + '">' +
      '<div class="ad-item-head">' +
        '<span class="ad-date">' + esc(r.publish_at || '—') + '</span>' +
        '<span class="ad-kind">' + kindLabel(r.kind) + '</span>' + badge +
        (r.from_reader ? '<span class="reader-flag">林间投稿</span>' : '') +
        '<strong>' + esc(title) + '</strong>' +
      '</div>' +
      '<p class="ad-item-body">' + esc((r.body || '').slice(0, 120)) + '</p>' +
      '<div class="ad-item-acts">' +
        '<button type="button" class="btn btn-quiet" data-act="edit">编辑</button>' +
        '<button type="button" class="btn btn-ghost" data-act="jump">插队（次日）</button>' +
        '<button type="button" class="btn btn-quiet ad-danger" data-act="del">删除</button>' +
      '</div>' +
      '<div class="ad-edit" hidden></div>' +
    '</div>';
  }

  $('ad-lib-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var box = btn.closest('.ad-item');
    var id = box.getAttribute('data-id');
    var act = btn.getAttribute('data-act');

    if (act === 'edit') {
      var pane = box.querySelector('.ad-edit');
      if (!pane.hidden) { pane.hidden = true; return; }
      api('/api/admin?view=one&id=' + encodeURIComponent(id)).then(function (res) {
        if (dieIfAuth(res) || !res.j.ok) return;
        var r = res.j.row;
        pane.innerHTML = editForm(r);
        pane.hidden = false;
        pane.querySelector('[data-act="save"]').addEventListener('click', function () {
          var f = pane;
          var extra = JSON.parse(JSON.stringify(r.extra || {}));
          var fields = {
            title: f.querySelector('[name=title]').value,
            body: f.querySelector('[name=body]').value,
            publish_at: f.querySelector('[name=date]').value,
            status: f.querySelector('[name=status]').value
          };
          if (r.kind === 'fact') {
            extra.source = f.querySelector('[name=source]').value;
            extra.tags = f.querySelector('[name=tags]').value.split(/[,，、\\s]+/).filter(Boolean);
            extra.feihua = f.querySelector('[name=feihua]').value;
          } else if (r.kind === 'joke') {
            extra.cat = f.querySelector('[name=cat]').value || '生活';
            extra.line = (fields.body || '').slice(0, 40);
            extra.full = fields.body;
          } else {
            extra.tags = f.querySelector('[name=tags]').value.split(/[,，、\\s]+/).filter(Boolean);
          }
          fields.extra = extra;
          btn.disabled = true;
          api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'update', id: id, fields: fields }) })
            .then(function (res2) {
              btn.disabled = false;
              if (dieIfAuth(res2)) return;
              if (res2.j.ok) { loadLibrary(false); loadStats(); }
              else pane.insertAdjacentHTML('afterbegin', '<p class="ad-err">' + esc(res2.j.error || '保存失败') + '</p>');
            });
        });
      });
      return;
    }

    if (act === 'jump') {
      if (!confirm('把这条排到明天上线？后面已排期的内容整体后移一天。')) return;
      btn.disabled = true;
      api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'jump', id: id }) })
        .then(function (res) {
          btn.disabled = false;
          if (dieIfAuth(res)) return;
          if (res.j.ok) { loadLibrary(false); loadStats(); }
          else alert(res.j.error || '操作失败');
        });
      return;
    }

    if (act === 'del') {
      if (!confirm('确认删除这条内容？不可恢复。')) return;
      btn.disabled = true;
      api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'delete', id: id }) })
        .then(function (res) {
          if (dieIfAuth(res)) return;
          if (res.j.ok) { box.remove(); loadStats(); }
          else { btn.disabled = false; alert(res.j.error || '删除失败'); }
        });
    }
  });

  function editForm(r) {
    var e = r.extra || {};
    var rows = '';
    rows += '<div class="field"><label>标题</label><input name="title" value="' + esc(r.title || '') + '"></div>';
    rows += '<div class="field"><label>正文</label><textarea name="body" rows="6">' + esc(r.body || '') + '</textarea></div>';
    if (r.kind === 'fact') {
      rows += '<div class="field"><label>来源</label><input name="source" value="' + esc(e.source || '') + '"></div>';
      rows += '<div class="field"><label>标签（逗号分隔）</label><input name="tags" value="' + esc((e.tags || []).join('，')) + '"></div>';
      rows += '<div class="field"><label>关联废话</label><input name="feihua" value="' + esc(e.feihua || '') + '"></div>';
    } else if (r.kind === 'joke') {
      rows += '<div class="field"><label>分类</label><input name="cat" value="' + esc(e.cat || '生活') + '"></div>';
    } else {
      rows += '<div class="field"><label>标签（逗号分隔）</label><input name="tags" value="' + esc((e.tags || []).join('，')) + '"></div>';
    }
    rows += '<div class="field"><label>上线日期</label><input type="date" name="date" value="' + esc(r.publish_at || '') + '"></div>';
    rows += '<div class="field"><label>状态</label><select name="status">' +
      '<option value="queued"' + (r.status === 'queued' ? ' selected' : '') + '>排队上线</option>' +
      '<option value="draft"' + (r.status === 'draft' ? ' selected' : '') + '>草稿（不上线）</option>' +
      '</select></div>';
    rows += '<div class="ad-actions"><button type="button" class="btn" data-act="save">保存</button></div>';
    return rows;
  }

  /* ---------- 投稿审核 ---------- */
  function loadReview() {
    $('ad-rev-msg').textContent = '读取中…';
    api('/api/admin?view=submissions&status=pending')
      .then(function (res) {
        if (dieIfAuth(res)) return;
        if (!res.j.ok) { $('ad-rev-msg').textContent = '失败：' + (res.j.error || res.s); return; }
        var rows = res.j.rows || [];
        $('ad-rev-msg').textContent = rows.length ? '队列中 ' + rows.length + ' 条待审。' : '队列是空的。';
        $('ad-rev-list').innerHTML = rows.map(function (row) {
          return '<li data-id="' + esc(row.id) + '">' +
            '<p class="item-title" style="font-weight:500">' + esc(row.body) + '</p>' +
            '<p class="item-meta"><span>' + kindLabel(row.kind) + '</span><span>' + String(row.created_at || '').slice(0, 16).replace('T', ' ') + '</span>' +
            (row.author ? '<span>署名：' + esc(row.author) + '</span>' : '') +
            (row.source ? '<span>来源：' + esc(row.source) + '</span>' : '') + '</p>' +
            '<p style="margin-top:10px;display:flex;gap:10px">' +
            '<button class="btn btn-quiet" data-act="reject">退回</button>' +
            '<button class="btn" data-act="approve">通过（次日插队上线）</button></p>' +
            '</li>';
        }).join('');
      })
      .catch(function () { $('ad-rev-msg').textContent = '网络错误。'; });
  }

  $('ad-rev-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var li = btn.closest('li');
    var id = li.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    if (act === 'approve' && !confirm('通过并排到明天上线？')) return;
    btn.disabled = true;
    api('/api/admin', { method: 'POST', body: JSON.stringify({ action: act, id: id }) })
      .then(function (res) {
        if (dieIfAuth(res)) return;
        if (res.j.ok) { li.remove(); $('ad-rev-msg').textContent = '已处理，队列剩 ' + $('ad-rev-list').children.length + ' 条。'; loadStats(); }
        else { btn.disabled = false; $('ad-rev-msg').textContent = '失败：' + (res.j.error || '未知错误'); }
      })
      .catch(function () { btn.disabled = false; $('ad-rev-msg').textContent = '网络错误。'; });
  });

  /* ---------- 启动 ---------- */
  if (tk()) showApp(); else showLogin('');
})();
</script>`;

  return page(
    {
      title: '林间管理台',
      description: '内容管理。',
      path: adminPath,
      noindex: true,
      analytics: false, // 后台不打点，自己的浏览不进统计
    },
    body
  );
}

/* ================= SEO 文件 ================= */

export function buildSitemap(ctx) {
  const urls = [
    { loc: '/', priority: '1.0' },
    { loc: '/facts/', priority: '0.9' },
    { loc: '/feihua/', priority: '0.8' },
    { loc: '/jokes/', priority: '0.8' },
    { loc: '/archive/', priority: '0.7' },
    { loc: '/search/', priority: '0.5' },
    { loc: '/about/', priority: '0.5' },
    { loc: '/submit/', priority: '0.6' },
  ];

  const pages = Math.max(1, Math.ceil(ctx.facts.length / PAGE_SIZE));
  for (let i = 2; i <= pages; i++) urls.push({ loc: `/facts/page/${i}/`, priority: '0.6' });

  const today = new Date().toISOString().slice(0, 10);
  for (const f of ctx.facts) urls.push({ loc: `/facts/${f.slug}/`, lastmod: f.date, priority: '0.8' });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${site.url}${u.loc}</loc><lastmod>${u.lastmod || today}</lastmod><changefreq>${
            u.loc === '/' ? 'daily' : 'weekly'
          }</changefreq><priority>${u.priority}</priority></url>`
      )
      .join('\n') +
    `\n</urlset>\n`
  );
}

export function buildRss(ctx) {
  const items = ctx.facts.slice(0, 20);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `<channel>\n` +
    `  <title>Sylveris ${site.name}</title>\n` +
    `  <link>${site.url}/</link>\n` +
    `  <description>${esc(site.description)}</description>\n` +
    `  <language>zh-cn</language>\n` +
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n` +
    `  <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml"/>\n` +
    items
      .map(
        (f) =>
          `  <item>\n` +
          `    <title>${esc(f.title)}</title>\n` +
          `    <link>${site.url}/facts/${f.slug}/</link>\n` +
          `    <guid isPermaLink="true">${site.url}/facts/${f.slug}/</guid>\n` +
          `    <pubDate>${new Date(f.date + 'T09:00:00+08:00').toUTCString()}</pubDate>\n` +
          `    <description>${esc(f.body)}</description>\n` +
          `  </item>`
      )
      .join('\n') +
    `\n</channel>\n</rss>\n`
  );
}

export function buildRobots(adminPath) {
  return `User-agent: *
Allow: /
Disallow: ${adminPath}
Disallow: /api/

Sitemap: ${site.url}/sitemap.xml
`;
}

export function buildIndexJson(ctx) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    facts: ctx.facts.map((f) => ({
      slug: f.slug,
      title: f.title,
      body: f.body,
      feihua: f.feihua,
      tags: f.tags,
      source: f.source,
      date: f.date,
    })),
    feihua: ctx.feihua.map((f) => ({ slug: f.slug, text: f.text, tags: f.tags, date: f.date })),
    jokes: ctx.jokes.map((j) => ({
      slug: j.slug,
      title: j.title,
      line: j.line,
      full: j.full,
      cat: j.cat,
      date: j.date,
      fromReader: Boolean(j.fromReader),
    })),
  });
}
