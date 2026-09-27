#!/usr/bin/env node
/**
 * 本地开发服务器（零依赖）：与 Vercel 行为一致。
 *
 *   - /assets/* 等静态文件  → public/
 *   - /api/*                → api/ 目录下的函数
 *   - 其余一切页面路径       → api/render.js 动态渲染（数据库优先，种子兜底）
 *
 * 用法：
 *   npm run serve            启动 http://localhost:5173（页面实时从数据渲染）
 *   npm run serve -- 5175    换端口启动（端口被占用时很有用）
 *   npm run serve -- --static 预览静态兜底产物（需先 npm run build:static）
 *
 * 改了 lib/ api/ data/ scripts/ 里的代码会自动重启，改 public/ 下的资源刷新即可。
 *
 * 环境变量：PORT（默认 5173）、ADMIN_PATH（后台隐藏路径）、STATIC_FALLBACK=1
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../lib/env.mjs'; // 读取 .env：PORT / ADMIN_PATH / TURSO_* / STATIC_FALLBACK

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
/** 端口优先级：命令行参数 > 环境变量 PORT > 默认 5173（如 npm run serve -- 5175） */
const ARG_PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const PORT = Number(ARG_PORT || process.env.PORT) || 5173;
/** 静态兜底模式：--static 或环境变量 STATIC_FALLBACK=1（与云端开关闭环一致） */
const STATIC_MODE = process.argv.includes('--static') || process.env.STATIC_FALLBACK === '1';

/**
 * 代码热重启：Node 的 ESM 缓存按模块 URL 固化，改了 lib/ api/ data/ 里的文件后，
 * 光刷新页面是拿不到新代码的。这里监听这些目录，一变就原地重启自己。
 * （public/ 下的 CSS/JS 每次请求都现读，不需要重启。）
 */
function watchForRestart() {
  const dirs = ['lib', 'api', 'data', 'scripts']
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d));

  // 精确判断：直接比对代码文件本身（store.json 这类运行期数据不计入）。
  // fs.watch 在 Windows 上回调的 filename 可能为空，只靠文件名过滤不可靠。
  const snapshot = () => {
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 6) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(p, depth + 1);
        } else if (e.name !== 'store.json' && /\.(mjs|js|json)$/.test(e.name)) {
          try {
            out.push(p + ':' + fs.statSync(p).mtimeMs);
          } catch {
            /* 文件正被写入，跳过 */
          }
        }
      }
    };
    for (const d of dirs) walk(d, 0);
    return out.join('|');
  };

  let last = snapshot();
  let timer = null;
  let restarting = false;

  const doRestart = () => {
    if (restarting) return;
    const now = snapshot();
    if (now === last) return; // 代码没变（只是运行期数据），不重启
    last = now;
    restarting = true;
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    console.log('\n检测到代码变更，重启本地服务…');
    const spawnChild = () => {
      const child = spawn(process.execPath, [process.argv[1], ...(STATIC_MODE ? ['--static'] : [])], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, PORT: String(PORT) },
      });
      // 当前进程留着等子进程退出，日志才会继续往同一个输出里写
      child.on('exit', (code) => process.exit(code ?? 0));
    };

    // 必须先释放端口，否则子进程会 EADDRINUSE
    try {
      if (server && server.listening) {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => spawnChild());
        return;
      }
    } catch {
      /* 落到下面的直接启动 */
    }
    spawnChild();
  };

  const watchers = [];
  for (const dir of dirs) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        // 运行期产生的数据/临时文件不算「代码变更」，否则每次登录、编辑都会重启
        if (filename) {
          const base = path.basename(filename);
          if (base === 'store.json' || base.startsWith('.') || base.endsWith('.tmp')) return;
        }
        clearTimeout(timer);
        timer = setTimeout(doRestart, 350);
      });
      watchers.push(w);
    } catch {
      /* 某个目录不支持 watch 就跳过 */
    }
  }
}

watchForRestart();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/* ---- Vercel 风格的 res 扩展 ---- */
function patchRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function invoke(req, res, file, query) {
  const mod = await import(pathToFileURL(path.join(ROOT, file)).href + `?t=${Date.now()}`);
  req.body = await readBody(req);
  req.query = query;
  await mod.default(req, patchRes(res));
}

async function handleApi(req, res, urlPath, url) {
  const map = {
    '/api/submit': 'api/submit.js',
    '/api/admin': 'api/admin.js',
    '/api/render': 'api/render.js',
    '/api/visit': 'api/visit.js',
  };
  const file = map[urlPath];
  if (!file) {
    patchRes(res).status(404).json({ ok: false, error: 'not found' });
    return;
  }
  await invoke(req, res, file, Object.fromEntries(url.searchParams));
}

/** 静态文件：public/ 优先，其次 dist/（兜底构建产物） */
function serveStatic(res, urlPath, tag) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';

  const candidates = [path.join(PUBLIC, rel), path.join(DIST, rel)];
  // cleanUrls：/facts/xxx 也能命中 /facts/xxx/index.html
  if (!path.extname(rel)) {
    candidates.push(path.join(PUBLIC, rel + '.html'), path.join(PUBLIC, rel, 'index.html'));
    candidates.push(path.join(DIST, rel + '.html'), path.join(DIST, rel, 'index.html'));
  }

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(PUBLIC) && !resolved.startsWith(DIST)) continue; // 防目录穿越
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      if (ext === '.html') res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
      if (tag) res.setHeader('X-Serve', tag);
      fs.createReadStream(resolved).pipe(res);
      return true;
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const urlPath = url.pathname;

    if (urlPath.startsWith('/api/')) {
      await handleApi(req, res, urlPath, url);
      return;
    }

    // 只读静态资源直接返回；其余（含 /sitemap.xml /robots.txt /data/index.json）走渲染层
    const isAsset =
      urlPath.startsWith('/assets/') ||
      ['.css', '.js', '.svg', '.png', '.ico', '.webmanifest', '.webp', '.jpg'].includes(
        path.extname(urlPath).toLowerCase()
      );

    if (isAsset && serveStatic(res, urlPath, 'asset')) return;

    // 静态兜底模式（--static / STATIC_FALLBACK=1，与云端开关闭环一致）：dist 里有页面就直接用
    if (STATIC_MODE && serveStatic(res, urlPath, 'static')) return;

    // 默认：页面统一交给 api/render.js（等价于 Vercel 的 rewrite 到 /api/render?path=/xxx）
    res.setHeader('X-Serve', 'render');
    await invoke(req, res, 'api/render.js', { path: urlPath });
  } catch (e) {
    console.error('serve error:', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  }
});

let listenTries = 0;
server.on('error', (err) => {
  // 端口被占时先等一会儿（热重启会先关旧服务再开新服务，需要短暂让位）
  if (err && err.code === 'EADDRINUSE' && listenTries < 6) {
    listenTries += 1;
    setTimeout(() => server.listen(PORT), 300);
    return;
  }
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n启动失败：端口 ${PORT} 已经被占用了。\n`);
    console.error('先查出占用它的进程：');
    console.error(`    netstat -ano | findstr :${PORT}\n`);
    console.error('然后任选其一：');
    console.error(`    ① 结束旧进程：  taskkill /PID 上面查到的PID /F`);
    console.error(`    ② 直接用旧的：  浏览器打开 http://localhost:${PORT}（它可能就是本项目的服务）`);
    console.error(`    ③ 换个端口：    npm run serve -- ${PORT + 2}\n`);
    console.error(`（换端口后测试要跟着换：npm run check -- ${PORT + 2}）\n`);
    process.exit(1);
  }
  console.error('启动失败：', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`本地预览：http://localhost:${PORT}`);
  console.log(
    `渲染模式：${STATIC_MODE ? '静态兜底（直接读 dist/）' : '动态渲染（数据库 → 种子）'}`
  );
  console.log(`后台路径：${process.env.ADMIN_PATH || '/linjian-7c4f/'}（需先运行 npm run set-password）`);
});
