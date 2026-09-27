#!/usr/bin/env node
/**
 * 生成网站图标（无任何第三方依赖）。
 *
 * 设计：低饱和墨绿底 + 米白松树 + 一点冷色雪花，与站点主色一致。
 * 输出：
 *   public/assets/icons/icon.svg        矢量源文件
 *   public/assets/icons/favicon-16/32/48.png
 *   public/assets/icons/apple-touch-icon.png (180)
 *   public/assets/icons/icon-192.png / icon-512.png
 *   public/favicon.ico                   含 16/32/48 三档
 *   public/assets/icons/site.webmanifest
 *
 * 用法：node scripts/make-icons.mjs
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'public', 'assets', 'icons');

/* ---------------- PNG 编码（纯手写） ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** rgba: Uint8Array 长度 w*h*4 */
function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 绘制 ---------------- */

const SS = 4; // 超采样倍数，用于抗锯齿

const C = {
  bg: [63, 100, 82], // 墨绿 #3f6452
  bgDark: [54, 88, 72],
  tree: [246, 245, 240], // 米白 #f6f5f0
  snow: [168, 197, 208], // 冷雾蓝
};

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function inRoundRect(x, y, w, h, r, px, py) {
  if (px < 0 || py < 0 || px > w || py > h) return false;
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  const dx = px < rx ? rx - px : px > w - rx ? px - (w - rx) : 0;
  const dy = py < ry ? ry - py : py > h - ry ? py - (h - ry) : 0;
  if (dx === 0 || dy === 0) return true;
  return dx * dx / (rx * rx) + dy * dy / (ry * ry) <= 1;
}

function inTriangle(ax, ay, bx, by, cx, cy, px, py) {
  const d = (x1, y1, x2, y2, x3, y3) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = d(px, py, ax, ay, bx, by);
  const d2 = d(px, py, bx, by, cx, cy);
  const d3 = d(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = px - x1, wy = py - y1;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * vx, cy = y1 + t * vy;
  return Math.hypot(px - cx, py - cy);
}

/** 在 size x size 的画布上绘制图标，返回 RGBA */
function drawIcon(size) {
  const W = size, H = size;
  const SS2 = size >= 64 ? SS : 2;
  const rgba = new Uint8Array(W * H * 4);

  // 图标内部坐标（0..512 设计空间）
  const S = 512;
  const u = W / S;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS2; sy++) {
        for (let sx = 0; sx < SS2; sx++) {
          const px = (x + (sx + 0.5) / SS2) / u;
          const py = (y + (sy + 0.5) / SS2) / u;
          let col = [0, 0, 0];
          let alpha = 0;

          if (inRoundRect(0, 0, S, S, 96, px, py)) {
            alpha = 1;
            // 底色：极轻的上下明暗，保持平面感
            const t = py / S;
            col = mix(C.bg, C.bgDark, t * 0.55);

            // 松树：三层三角 + 树干
            const cx = S * 0.5;
            const trunkW = S * 0.055;
            const trunkTop = S * 0.70;
            const trunkBot = S * 0.845;
            const inTrunk =
              px >= cx - trunkW / 2 && px <= cx + trunkW / 2 &&
              py >= trunkTop && py <= trunkBot;

            const layer = (topY, halfW, botY) =>
              inTriangle(cx, topY, cx - halfW, botY, cx + halfW, botY, px, py);

            const inTree =
              layer(S * 0.20, S * 0.135, S * 0.455) ||
              layer(S * 0.325, S * 0.175, S * 0.575) ||
              layer(S * 0.45, S * 0.215, S * 0.70) ||
              inTrunk;

            if (inTree) col = C.tree;

            // 冷雾蓝雪花：树右上，四向短线 + 中心点
            const sx0 = S * 0.775, sy0 = S * 0.245;
            const arm = S * 0.062;
            const th = S * 0.016;
            const d1 = distToSeg(px, py, sx0 - arm, sy0, sx0 + arm, sy0);
            const d2 = distToSeg(px, py, sx0, sy0 - arm, sx0, sy0 + arm);
            const d3 = distToSeg(px, py, sx0 - arm * 0.7, sy0 - arm * 0.7, sx0 + arm * 0.7, sy0 + arm * 0.7);
            const d4 = distToSeg(px, py, sx0 - arm * 0.7, sy0 + arm * 0.7, sx0 + arm * 0.7, sy0 - arm * 0.7);
            const dot = Math.hypot(px - sx0, py - sy0);
            if (d1 < th || d2 < th || d3 < th * 0.8 || d4 < th * 0.8 || dot < th * 1.1) {
              col = C.snow;
            }
          }

          acc[0] += col[0] * alpha;
          acc[1] += col[1] * alpha;
          acc[2] += col[2] * alpha;
          acc[3] += alpha * 255;
        }
      }
      const n = SS2 * SS2;
      const i = (y * W + x) * 4;
      rgba[i] = Math.round(acc[0] / n);
      rgba[i + 1] = Math.round(acc[1] / n);
      rgba[i + 2] = Math.round(acc[2] / n);
      rgba[i + 3] = Math.round(acc[3] / n);
    }
  }
  return rgba;
}

/* ---------------- ICO 容器（内嵌 PNG） ---------------- */

function encodeICO(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  const blobs = [];

  pngBuffers.forEach((png, i) => {
    const size = [16, 32, 48][i] || 32;
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
    blobs.push(png);
  });

  return Buffer.concat([header, ...entries, ...blobs]);
}

/* ---------------- SVG 源文件 ---------------- */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Sylveris 春林冷知">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f6452"/>
      <stop offset="1" stop-color="#365848"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <g fill="#f6f5f0">
    <path d="M256 96 L326 233 L186 233 Z"/>
    <path d="M256 156 L346 294 L166 294 Z"/>
    <path d="M256 219 L366 358 L146 358 Z"/>
    <rect x="241.6" y="358" width="28.8" height="76" rx="6"/>
  </g>
  <g stroke="#a8c5d0" stroke-width="9" stroke-linecap="round">
    <line x1="343" y1="125" x2="439" y2="125"/>
    <line x1="391" y1="77" x2="391" y2="173"/>
    <line x1="357" y1="91" x2="425" y2="159"/>
    <line x1="425" y1="91" x2="357" y2="159"/>
  </g>
  <circle cx="391" cy="125" r="9" fill="#a8c5d0"/>
</svg>
`;

/* ---------------- 输出 ---------------- */

fs.mkdirSync(ICON_DIR, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });

fs.writeFileSync(path.join(ICON_DIR, 'icon.svg'), SVG, 'utf8');

const sizes = [16, 32, 48, 180, 192, 512];
const pngCache = new Map();
for (const s of sizes) {
  const png = encodePNG(drawIcon(s), s, s);
  pngCache.set(s, png);
  fs.writeFileSync(path.join(ICON_DIR, `icon-${s}.png`), png);
  console.log(`  ✓ icon-${s}.png`);
}

fs.copyFileSync(path.join(ICON_DIR, 'icon-180.png'), path.join(ICON_DIR, 'apple-touch-icon.png'));

fs.writeFileSync(
  path.join(ROOT, 'public', 'favicon.ico'),
  encodeICO([pngCache.get(16), pngCache.get(32), pngCache.get(48)])
);
console.log('  ✓ favicon.ico');

const manifest = {
  name: 'Sylveris 春林冷知',
  short_name: '春林冷知',
  description: '冷静地知道一点没用的东西。',
  start_url: '/',
  display: 'standalone',
  background_color: '#f6f5f0',
  theme_color: '#3f6452',
  lang: 'zh-CN',
  icons: [
    { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
fs.writeFileSync(path.join(ICON_DIR, 'site.webmanifest'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('图标生成完成。');
