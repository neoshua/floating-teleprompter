/**
 * 生成 macOS 需要的图标资源（纯 Node，无第三方依赖）。
 *
 *   assets/icon.icns            .app / Finder 图标，直接复用 icon.ico 里的 PNG 条目
 *   assets/trayTemplate.png      16×16 菜单栏模板图（黑色形状 + alpha，由系统自动着色）
 *   assets/trayTemplate@2x.png   32×32 Retina 版，Electron 会按 @2x 自动关联
 *
 * Windows 只认 icon.ico，这些文件对它无害；CI 在打包前跑一次本脚本即可。
 * 运行：node scripts/make-mac-assets.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const ICO = path.join(ASSETS, 'icon.ico');

/* ------------------------------------------------------------------ CRC32 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- PNG 编码 */
/** 从 RGBA8888 像素生成 PNG（filter 0，无调色板） */
function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('RGBA buffer size mismatch');
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(head) >>> 0, 0);
    return Buffer.concat([len, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 从 icon.ico 取出指定尺寸内嵌的 PNG */
function extractIcoPngs() {
  const b = fs.readFileSync(ICO);
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) throw new Error('icon.ico 格式不正确');
  const count = b.readUInt16LE(4);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = b[o] || 256, h = b[o + 1] || 256;
    const size = b.readUInt32LE(o + 8), offset = b.readUInt32LE(o + 12);
    const data = b.slice(offset, offset + size);
    if (data.slice(0, 4).toString('hex') !== '89504e47') continue; // 只收 PNG 条目
    out.set(w, { data, w, h });
  }
  return out;
}

/** icns = 'icns' + 总长 + 若干 (type + 长度 + PNG) 条目 */
function makeIcns(pngs) {
  // ic07=128px, ic08=256px, ic13=128pt@2x(256px)。没有 512px 源图，不放 ic09。
  const types = [['ic07', 128], ['ic08', 256], ['ic13', 256]];
  const entries = [];
  for (const [type, size] of types) {
    const item = pngs.get(size);
    if (!item) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(item.data.length + 8, 4);
    entries.push(Buffer.concat([head, item.data]));
  }
  if (!entries.length) throw new Error('icon.ico 里没有可用的 128/256 PNG 条目');
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/**
 * 画菜单栏模板图：与界面 logo 呼应的双环，内环右侧留缺口。
 * macOS 的 template image 只用 alpha，RGB 必须为黑，系统按明暗菜单栏自动着色。
 * 每个像素做 3×3 超采样，边缘才不会锯齿。
 */
function makeTrayTemplate(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - 0.5 - c;
          const py = y + (sy + 0.5) / SS - 0.5 - c;
          const r = Math.sqrt(px * px + py * py) / (size / 2); // 归一化到 0..1
          // 外环
          const outer = r >= 0.72 && r <= 0.96;
          // 内环，右上 60° 扇区断开
          const ang = Math.atan2(py, px);
          const gap = ang > -Math.PI / 3 && ang < Math.PI / 3;
          const inner = r >= 0.32 && r <= 0.56 && !gap;
          if (outer || inner) hit++;
        }
      }
      const i = (y * size + x) * 4;
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0;
      rgba[i + 3] = Math.round(255 * hit / (SS * SS));
    }
  }
  return encodePng(size, size, rgba);
}

function main() {
  if (!fs.existsSync(ICO)) throw new Error('缺少 assets/icon.ico');
  const pngs = extractIcoPngs();
  const icns = makeIcns(pngs);
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'), icns);
  fs.writeFileSync(path.join(ASSETS, 'trayTemplate.png'), makeTrayTemplate(16));
  fs.writeFileSync(path.join(ASSETS, 'trayTemplate@2x.png'), makeTrayTemplate(32));

  // 回读校验：icns 头、PNG 签名、文件尺寸
  const checkIcns = fs.readFileSync(path.join(ASSETS, 'icon.icns'));
  if (checkIcns.slice(0, 4).toString('ascii') !== 'icns') throw new Error('icns 生成失败');
  if (checkIcns.readUInt32BE(4) !== checkIcns.length) throw new Error('icns 长度字段不符');
  for (const f of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    const b = fs.readFileSync(path.join(ASSETS, f));
    if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(f + ' 不是有效 PNG');
    if (b.readUInt32BE(16) !== b.readUInt32BE(20)) throw new Error(f + ' 不是正方形');
  }
  console.log('[mac-assets] icon.icns', (icns.length / 1024).toFixed(1), 'KB, entries', pngs.size);
  console.log('[mac-assets] trayTemplate.png 16x16 / trayTemplate@2x.png 32x32');
  console.log('[mac-assets] OK');
}

if (require.main === module) main();
module.exports = { encodePng, makeIcns, makeTrayTemplate, extractIcoPngs };
