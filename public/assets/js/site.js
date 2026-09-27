/* Sylveris 春林冷知 — 交互脚本
   只做必要的事：导航、今日冷知、随机、筛选、废话生成、搜索、投稿。
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

  /* ---------- 废话生成器：关键词 + 模板，随机取一句 ---------- */
  var genForm = document.getElementById('gen-form');
  if (genForm) {
    var TEMPLATES = [
      '如果你是{w}，那你就是{w}。',
      '每提到一次{w}，就离{w}更近了一点。',
      '{w}之所以是{w}，就因为它是{w}。',
      '据不完全统计，{w}的统计并不完全。',
      '只要{w}足够{w}，{w}就能达到{w}的程度。',
      '关于{w}这件事，知道的人知道，不知道的人不知道。',
      '如果{w}不是{w}，那它就不是{w}。',
      '听懂{w}的人，已经听懂了{w}。',
      '你和{w}之间，只差一个{w}。',
      '今天的{w}，确实还是今天的{w}。',
      '问题不在于{w}有没有问题，而在于{w}就在这里。',
      '{w}这个东西，有和没有是一样的，就看它在不在。',
      '三天之内，{w}会度过{w}的三天。',
      '众所周知，{w}是知道的人都知道的。',
    ];
    var HINTS = ['天气', '上班', '周末', '睡觉', '吃饭', '开会', '摸鱼'];
    var result = document.getElementById('gen-result');
    var input = document.getElementById('gen-word');

    function generate(word) {
      var w = (word || '').trim();
      if (!w) {
        w = HINTS[Math.floor(Math.random() * HINTS.length)];
        if (input) input.value = w;
      }
      if (w.length > 12) w = w.slice(0, 12);
      var tpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
      if (result) result.textContent = tpl.split('{w}').join(w);
    }

    genForm.addEventListener('submit', function (e) {
      e.preventDefault();
      generate(input ? input.value : '');
    });

    var hintBox = document.getElementById('gen-hints');
    if (hintBox) {
      hintBox.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-w]');
        if (!b) return;
        if (input) input.value = b.getAttribute('data-w');
        generate(b.getAttribute('data-w'));
      });
    }
  }

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
})();
