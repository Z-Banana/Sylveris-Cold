/**
 * 导入解析：把 AI 写好的文本文档（或 JSON）解析成待入库条目。
 *
 * 支持两种格式：
 *
 * 1) 分段文本（推荐，AI 直接输出）：
 *    【冷知】
 *    标题：章鱼有三颗心脏
 *    正文：……
 *    来源：常见动物学资料
 *    标签：动物，身体
 *    废话：怪不得它要心碎三次才死心。
 *    ---
 *    【冷笑话】
 *    分类：动物
 *    题目：……
 *    正文：……
 *    ---
 *    【废话】
 *    正文：每呼吸 60 秒，就减少一分钟寿命。
 *
 * 2) JSON：数组或 { items: [...] }，字段同名（kind/type、title、body/text、
 *    tags、source、feihua、cat）。
 *
 * 只做校验和规范化，不写库；返回 { items, errors }。
 */

import crypto from 'node:crypto';

const KIND_ALIAS = {
  冷知: 'fact', 冷知识: 'fact', fact: 'fact', 知识: 'fact',
  废话: 'feihua', 废话文学: 'feihua', feihua: 'feihua',
  冷笑话: 'joke', 笑话: 'joke', joke: 'joke',
};

const MAX_BODY = 2000;
const MAX_TITLE = 120;

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/<[^>]*>/g, '') // 丢掉任何标签，杜绝 HTML 注入
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,，、/｜|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function deriveSlug(kind, title, body, used) {
  const prefix = kind === 'fact' ? 'f' : kind === 'joke' ? 'j' : 'h';
  const base = crypto.createHash('sha1').update(`${kind}|${title}|${body}`).digest('hex').slice(0, 9);
  let slug = `${prefix}-${base}`;
  let i = 2;
  while (used.has(slug)) slug = `${prefix}-${base}-${i++}`;
  used.add(slug);
  return slug;
}

function firstSentence(text, n = 30) {
  return cleanText(String(text).split(/[\n。！？.!?]/)[0], n);
}

/* ---------------- 分段文本格式 ---------------- */

// 字段名归一化：所有别名 → 一个规范名
const KEY_ALIAS = {
  标题: '标题', 题目: '标题', 标题句: '标题', title: '标题', name: '标题',
  正文: '正文', 内容: '正文', body: '正文', text: '正文', content: '正文',
  来源: '来源', source: '来源',
  标签: '标签', tags: '标签',
  废话: '废话', feihua: '废话',
  分类: '分类', 类别: '分类', category: '分类', cat: '分类',
};
const AUTOCOMPLETE_KEYS = new Set(['标题', '正文', '来源', '标签', '废话', '分类']);

function splitSegments(text) {
  const lines = text.split('\n');
  const segments = [];
  let cur = null;
  let currentField = null;
  let autoTitle = false; // 当前「标题」是无字段名的裸行猜出来的

  const push = () => {
    if (cur && (cur.header || Object.keys(cur.fields).length)) segments.push(cur);
    cur = null;
    currentField = null;
    autoTitle = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 【冷知】 / 【冷笑话】 / 【废话】 开新段
    const head = line.match(/^【(.+?)】$/);
    if (head) {
      push();
      cur = { header: head[1].trim(), fields: {}, order: segments.length };
      continue;
    }

    // --- 分隔线
    if (/^(-{3,}|={3,}|——+)$/.test(line)) {
      push();
      continue;
    }

    if (!cur) cur = { header: '', fields: {}, order: segments.length };
    if (!line) continue;

    // 「字段：值」识别
    const kv = line.match(/^([一-龥A-Za-z]{1,8})\s*[:：]\s*(.*)$/);
    const canon = kv ? KEY_ALIAS[kv[1].trim().toLowerCase()] : null;
    if (kv && canon) {
      currentField = canon;
      autoTitle = canon === '标题'; // 又出现显式「标题：」则覆盖裸行猜测
      cur.fields[canon] = (cur.fields[canon] ? cur.fields[canon] + '\n' : '') + kv[2];
      if (autoTitle) cur.fields.__titleExplicit = '1';
      continue;
    }

    // 裸行归属
    if (!currentField && Object.keys(cur.fields).filter((k) => k !== '__titleExplicit').length === 0) {
      // 段落第一行：短的当标题，长的当正文
      if (line.length <= 40) {
        currentField = '标题';
        autoTitle = true;
        cur.fields['标题'] = line;
      } else {
        currentField = '正文';
        cur.fields['正文'] = line;
      }
    } else if (currentField === '标题' && autoTitle) {
      // 裸行猜的标题后面又来一段：并入正文，标题就用第一句
      currentField = '正文';
      cur.fields['正文'] = (cur.fields['正文'] ? cur.fields['正文'] + '\n' : '') + line;
    } else {
      const f = currentField || '正文';
      cur.fields[f] = (cur.fields[f] ? cur.fields[f] + '\n' : '') + line;
    }
  }
  push();
  return segments;
}

function segmentToItem(seg, index, used) {
  const f = seg.fields;
  const kind = KIND_ALIAS[(f['分类'] || seg.header || '').trim().toLowerCase()] ||
    KIND_ALIAS[(seg.header || '').trim()] ||
    null;

  const errors = [];
  if (!kind) {
    errors.push({ index, reason: `第 ${index + 1} 段：类型无法识别（请以【冷知】【冷笑话】【废话】开头）` });
    return { errors };
  }

  const body0 = cleanText(f['正文'] ?? f['内容'] ?? f['body'] ?? f['text'] ?? '', MAX_BODY);
  const title0 = cleanText(f['标题'] ?? f['题目'] ?? f['标题句'] ?? f['title'] ?? '', MAX_TITLE);
  // 只有一行短文本、没写「正文：」时，把它当正文处理
  const body = body0 || title0;
  const title = body0 ? title0 : '';

  if (!body) {
    errors.push({ index, reason: `第 ${index + 1} 段：正文为空` });
    return { errors };
  }
  if (body.length < 4) {
    errors.push({ index, reason: `第 ${index + 1} 段：正文太短（不足 4 字）` });
    return { errors };
  }

  const item = {
    kind,
    title,
    body,
    extra: {},
    slug: deriveSlug(kind, title, body, used),
  };

  if (kind === 'fact') {
    item.extra.feihua = cleanText(f['废话'] || '', 160);
    item.extra.tags = parseTags(f['标签']);
    item.extra.source = cleanText(f['来源'], 160);
    if (!item.title) item.title = firstSentence(body, 30) || '未命名冷知';
  } else if (kind === 'joke') {
    item.extra.cat = cleanText(f['分类'] || seg.header || '生活', 12) || '生活';
    if (KIND_ALIAS[item.extra.cat] === 'joke') item.extra.cat = '生活'; // 表头写成「冷笑话」时兜底
    item.extra.line = cleanText(body, 40);
    item.extra.full = body;
    if (!item.title) item.title = firstSentence(body, 24) || '一条冷笑话';
  } else {
    item.extra.tags = parseTags(f['标签']);
    item.title = '';
  }

  return { item, errors: [] };
}

/* ---------------- JSON 格式 ---------------- */

function jsonToItems(json, used) {
  const arr = Array.isArray(json) ? json : json.items || json.content || json.data;
  if (!Array.isArray(arr)) throw new Error('JSON 需要是数组，或包含 items 字段的对象');

  const items = [];
  const errors = [];
  arr.forEach((raw, index) => {
    const o = raw && typeof raw === 'object' ? raw : {};
    const kind = KIND_ALIAS[String(o.kind ?? o.type ?? '').trim().toLowerCase()] ||
      KIND_ALIAS[String(o.kind ?? o.type ?? '').trim()] || null;
    const body = cleanText(o.body ?? o.text ?? o.content ?? '', MAX_BODY);
    const title = cleanText(o.title ?? o.name ?? '', MAX_TITLE);

    if (!kind) {
      errors.push({ index, reason: `第 ${index + 1} 条：类型不对（kind 应为 fact/joke/feihua 或 冷知/冷笑话/废话）` });
      return;
    }
    if (!body) {
      errors.push({ index, reason: `第 ${index + 1} 条：正文为空` });
      return;
    }

    const item = { kind, title, body, extra: {}, slug: deriveSlug(kind, title, body, used) };
    if (kind === 'fact') {
      item.extra = {
        feihua: cleanText(o.feihua, 160),
        tags: parseTags(Array.isArray(o.tags) ? o.tags.join(',') : o.tags),
        source: cleanText(o.source, 160),
      };
      if (!item.title) item.title = firstSentence(body, 30) || '未命名冷知';
    } else if (kind === 'joke') {
      item.extra = {
        cat: cleanText(o.cat ?? o.category ?? '生活', 12) || '生活',
        line: cleanText(o.line, 40) || cleanText(body, 40),
        full: body,
      };
      if (!item.title) item.title = firstSentence(body, 24) || '一条冷笑话';
    } else {
      item.extra = { tags: parseTags(Array.isArray(o.tags) ? o.tags.join(',') : o.tags) };
      item.title = '';
    }
    items.push(item);
  });

  return { items, errors };
}

/* ---------------- 入口 ---------------- */

/**
 * @param {string} raw 上传的文本（txt 分段格式）或 JSON 字符串
 * @param {Set<string>} [existingSlugs] 已存在的 slug，用于去重
 * @returns {{ format: string, items: Array, errors: Array }}
 */
export function parseImport(raw, existingSlugs = new Set()) {
  const text = String(raw ?? '').replace(/^﻿/, '').trim();
  const used = new Set(existingSlugs);

  if (!text) return { format: '-', items: [], errors: [{ index: -1, reason: '内容为空' }] };

  // JSON 探测
  if (/^[[{]/.test(text)) {
    try {
      const { items, errors } = jsonToItems(JSON.parse(text), used);
      return { format: 'json', items, errors };
    } catch (e) {
      return { format: 'json', items: [], errors: [{ index: -1, reason: 'JSON 解析失败：' + (e.message || e) }] };
    }
  }

  const segments = splitSegments(text);
  if (segments.length === 0) {
    return { format: 'text', items: [], errors: [{ index: -1, reason: '没有识别到内容段落' }] };
  }

  const items = [];
  const errors = [];
  segments.forEach((seg, i) => {
    const r = segmentToItem(seg, i, used);
    if (r.item) items.push(r.item);
    errors.push(...r.errors);
  });

  return { format: 'text', items, errors };
}
