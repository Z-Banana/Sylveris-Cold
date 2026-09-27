/* Sylveris 春林冷知 — 交互脚本
   只做必要的事：导航、今日冷知、随机（冷知 / 废话 / 冷笑话）、筛选、搜索、投稿、访问上报。
   不依赖任何外部库。 */

(function () {
  'use strict';

  /* ---------- 移动端导航 ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------- 数据源：由构建时生成的 /data/index.json ---------- */
  var DATA = null;
  function loadData(cb) {
    if (DATA) { cb(DATA); return; }
    fetch('/data/index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        DATA = json || { facts: [], feihua: [], jokes: [] };
        cb(DATA);
      })
      .catch(function () { cb({ facts: [], feihua: [], jokes: [] }); });
  }

  function dayNumber(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function formatDate(iso) {
    var p = iso.split('-');
    return p[0] + '-' + p[1] + '-' + p[2];
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 今日冷知：按日期做种子，从数组里选 ---------- */
  var dailyBox = document.getElementById('daily');
  if (dailyBox) {
    var today = new Date();
    var iso =
      today.getFullYear() +
      '-' + String(today.getMonth() + 1).padStart(2, '0') +
      '-' + String(today.getDate()).padStart(2, '0');
    loadData(function (data) {
      if (!data.facts.length) return;
      var exact = data.facts.filter(function (f) { return f.date === iso; })[0];
      var pick = exact || data.facts[dayNumber(today) % data.facts.length];
      var dateEl = dailyBox.querySelector('.daily-date');
      var factEl = dailyBox.querySelector('.daily-fact');
      var feiEl = dailyBox.querySelector('.daily-feihua');
      var linkEl = dailyBox.querySelector('[data-daily-link]');
      if (dateEl) dateEl.textContent = formatDate(iso);
      if (factEl) factEl.textContent = pick.title + '。';
      if (feiEl && pick.feihua) feiEl.textContent = '废话：' + pick.feihua;
      if (linkEl && pick.slug) linkEl.setAttribute('href', '/facts/' + pick.slug + '/');
    });
  }

  /* ---------- 随机冷知 ---------- */
  var randomBox = document.getElementById('random-card');
  if (randomBox) {
    var lastSlug = null;
    function renderRandom() {
      loadData(function (data) {
        if (!data.facts.length) return;
        var pick = data.facts[Math.floor(Math.random() * data.facts.length)];
        if (data.facts.length > 1) {
          var guard = 0;
          while (pick.slug === lastSlug && guard++ < 8) {
            pick = data.facts[Math.floor(Math.random() * data.facts.length)];
          }
        }
        lastSlug = pick.slug;
        var f = randomBox.querySelector('.r-fact');
        var h = randomBox.querySelector('.r-feihua');
        var m = randomBox.querySelector('.r-meta');
        var link = randomBox.querySelector('[data-random-link]');
        if (f) f.textContent = pick.title + '。';
        if (h) h.textContent = pick.feihua ? '废话：' + pick.feihua : '';
        if (m) m.textContent = (pick.date || '') + (pick.source ? '　' + pick.source : '');
        if (link) link.setAttribute('href', '/facts/' + pick.slug + '/');
      });
    }
    var btn = document.getElementById('random-btn');
    if (btn) btn.addEventListener('click', renderRandom);
    renderRandom();
  }

  /* ---------- 冷笑话分类筛选 ---------- */
  var catBar = document.getElementById('cat-bar');
  var jokeList = document.getElementById('joke-list');
  if (catBar && jokeList) {
    catBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-cat]');
      if (!btn) return;
      var cat = btn.getAttribute('data-cat');
      [].forEach.call(catBar.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      [].forEach.call(jokeList.querySelectorAll('.joke'), function (el) {
        var show = cat === '全部' || el.getAttribute('data-cat') === cat;
        el.hidden = !show;
        if (!show) el.open = false;
      });
      var shown = jokeList.querySelectorAll('.joke:not([hidden])').length;
      var tip = document.getElementById('joke-count');
      if (tip) tip.textContent = shown + ' 条';
    });
  }

  /* ---------- 随机小工具：废话、冷笑话共用 ---------- */
  function makeRandom(boxId, btnId, listName, apply) {
    var box = document.getElementById(boxId);
    if (!box) return;
    var btn = document.getElementById(btnId);
    var last = null;

    function pick() {
      loadData(function (data) {
        var list = data[listName] || [];
        if (!list.length) return;
        var item = list[Math.floor(Math.random() * list.length)];
        if (list.length > 1) {
          var guard = 0;
          while (item === last && guard++ < 8) {
            item = list[Math.floor(Math.random() * list.length)];
          }
        }
        last = item;
        apply(box, item);
      });
    }

    if (btn) btn.addEventListener('click', pick);
    pick();
  }

  /* ---------- 随机废话 ---------- */
  makeRandom('feihua-card', 'feihua-btn', 'feihua', function (box, h) {
    var t = box.querySelector('.r-fact');
    var m = box.querySelector('.r-meta');
    if (t) t.textContent = h.text;
    if (m) {
      m.textContent = h.tags && h.tags.length ? h.tags.join(' / ') : '';
    }
  });

  /* ---------- 随机冷笑话：展开全文在卡片内部展开，不跳走 ---------- */
  var jokeExpand = document.getElementById('joke-expand');
  if (jokeExpand) {
    jokeExpand.addEventListener('click', function () {
      var full = document.getElementById('joke-full');
      if (!full) return;
      var willOpen = full.hidden;
      full.hidden = !willOpen;
      jokeExpand.textContent = willOpen ? '收起全文' : '展开全文';
      jokeExpand.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  makeRandom('joke-card', 'joke-btn', 'jokes', function (box, j) {
    var t = box.querySelector('.r-fact');
    var s = box.querySelector('.r-feihua');
    var m = box.querySelector('.r-meta');
    var f = box.querySelector('.r-full');
    if (t) t.textContent = j.title;
    if (s) s.textContent = j.line || '';
    if (m) {
      m.textContent = j.cat || '';
    }
    if (f) {
      f.textContent = j.full || '';
      if (j.fromReader) {
        f.appendChild(document.createElement('br'));
        var flag = document.createElement('span');
        flag.className = 'reader-flag';
        flag.style.fontSize = '13px';
        flag.textContent = '来自林间投稿';
        f.appendChild(flag);
      }
      f.hidden = true; // 换一条后收起，按钮复位
    }
    if (jokeExpand) {
      jokeExpand.textContent = '展开全文';
      jokeExpand.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- 搜索：结果页纯列表 ---------- */
  var searchForm = document.getElementById('search-form');
  if (searchForm) {
    var inputEl = document.getElementById('search-input');
    var out = document.getElementById('search-results');
    var count = document.getElementById('search-count');

    function run(q) {
      if (!out) return;
      q = (q || '').trim();
      if (!q) {
        out.innerHTML = '';
        if (count) count.textContent = '';
        return;
      }
      loadData(function (data) {
        var hits = [];
        data.facts.forEach(function (f) {
          var hay = (f.title + ' ' + (f.body || '') + ' ' + (f.tags || []).join(' '));
          if (hay.indexOf(q) > -1) {
            hits.push({
              type: '冷知',
              title: f.title,
              url: '/facts/' + f.slug + '/',
              summary: (f.body || '').slice(0, 74),
              date: f.date,
            });
          }
        });
        data.jokes.forEach(function (j) {
          var hay = j.title + ' ' + (j.line || '') + ' ' + (j.full || '') + ' ' + j.cat;
          if (hay.indexOf(q) > -1) {
            hits.push({
              type: '冷笑话',
              title: j.title,
              url: '/jokes/#' + j.slug,
              summary: j.line,
              date: j.date,
            });
          }
        });
        data.feihua.forEach(function (h) {
          if (h.text.indexOf(q) > -1) {
            hits.push({
              type: '废话',
              title: h.text,
              url: '/feihua/#' + h.slug,
              summary: '',
              date: h.date,
            });
          }
        });

        if (count) {
          count.textContent = hits.length
            ? '找到 ' + hits.length + ' 条与「' + q + '」有关的内容'
            : '没有找到与「' + q + '」有关的内容';
        }
        out.innerHTML = hits
          .map(function (h) {
            return (
              '<li>' +
              '<p class="item-title"><a href="' + h.url + '">' + esc(h.title) + '</a></p>' +
              (h.summary ? '<p class="item-summary">' + esc(h.summary) + '</p>' : '') +
              '<p class="item-meta"><span>' + h.type + '</span>' +
              (h.date ? '<span>' + h.date + '</span>' : '') + '</p>' +
              '</li>'
            );
          })
          .join('');
      });
    }

    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = inputEl ? inputEl.value : '';
      run(q);
      try {
        var url = new URL(window.location.href);
        if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
        window.history.replaceState({}, '', url.toString());
      } catch (err) { /* 忽略 */ }
    });

    var initial = '';
    try {
      initial = new URL(window.location.href).searchParams.get('q') || '';
    } catch (err) { initial = ''; }
    if (initial) {
      if (inputEl) inputEl.value = initial;
      run(initial);
    }
  }

  /* ---------- 投稿表单 ---------- */
  var submitForm = document.getElementById('submit-form');
  if (submitForm) {
    var status = document.getElementById('submit-status');
    submitForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(submitForm);
      var payload = {
        kind: fd.get('kind'),
        body: (fd.get('body') || '').toString().trim(),
        author: (fd.get('author') || '').toString().trim(),
        source: (fd.get('source') || '').toString().trim(),
        website: (fd.get('website') || '').toString(), // 蜜罐字段，正常人不填
      };

      function show(msg, ok) {
        if (!status) return;
        status.textContent = msg;
        status.classList.add('is-visible');
        status.classList.toggle('is-error', !ok);
      }

      if (!payload.body) { show('正文不能为空。', false); return; }
      if (payload.body.length < 4) { show('正文太短了，至少写四个字。', false); return; }
      if (payload.website) { show('提交失败，请稍后再试。', false); return; }

      show('正在送到林间…', true);

      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.ok) {
            show('收到了。投稿进入审核队列，通过后会出现在对应板块，并标注「来自林间投稿」。', true);
            submitForm.reset();
          } else {
            show((res.j && res.j.error) || '提交失败，请稍后再试。', false);
          }
        })
        .catch(function () {
          show('网络不通，提交失败，请稍后再试。', false);
        });
    });
  }

  /* ---------- 访问上报：后台「访问统计」的数据来源 ----------
     只发「路径」和是否 404，服务端按天 + 板块累加，不存 IP、不存任何个人信息。
     后台页（#ad-app）不上报，避免自己看后台把数字刷上去。 */
  if (!document.getElementById('ad-app') && typeof fetch === 'function') {
    try {
      // 404 页的特征是 noindex（正常页面是 index,follow），据此把「没找到」单独归一类
      var robotsMeta = document.querySelector('meta[name="robots"]');
      var isNoindex = robotsMeta && /noindex/i.test(robotsMeta.getAttribute('content') || '');
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, nf: isNoindex ? 1 : 0 }),
        keepalive: true,
        credentials: 'same-origin',
      });
    } catch (e) {
      /* 上报失败不影响浏览 */
    }
  }
})();
