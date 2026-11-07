#!/usr/bin/env node
/**
 * 一键准备运行所需的本地资产（纯 Node，无 Python / unzip / 额外依赖）：
 *
 *   1. vendor/vosk.js          <- node_modules/vosk-browser/dist/vosk.js（未修改的拷贝）
 *   2. assets/model/           <- 从 Vosk 官方下载 zip 并解压（可离线复用）
 *   3. assets/model.tar.gz     <- 按 WebAssembly 运行时要求重新打包（内部含 model/ 顶层目录）
 *
 * 用法：
 *   npm run setup
 *   node scripts/setup.mjs --force        # 强制重新生成 tar.gz
 *   node scripts/setup.mjs --vendor-only  # 只处理 vendor，不联网
 *
 * 语音模型许可证：Apache-2.0，来源 https://alphacephei.com/vosk/models
 * 见 THIRD_PARTY_NOTICES.md。本脚本只做归档格式转换，不修改模型内容。
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const VENDOR = path.join(ROOT, 'vendor');
const MODEL_DIR = path.join(ASSETS, 'model');
const MODEL_ZIP = path.join(ASSETS, 'vosk-model-cn.zip');
const MODEL_TGZ = path.join(ASSETS, 'model.tar.gz');
const VOSK_JS = path.join(VENDOR, 'vosk.js');
const VOSK_SRC = path.join(ROOT, 'node_modules', 'vosk-browser', 'dist', 'vosk.js');
const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip';

const FORCE = process.argv.includes('--force');
const VENDOR_ONLY = process.argv.includes('--vendor-only');

const log = (...a) => console.log('[setup]', ...a);
const human = n => (n / 1048576).toFixed(1) + ' MB';

/* ------------------------------------------------------------------ *
 * 1. vendor/vosk.js
 * ------------------------------------------------------------------ */
function prepareVendor() {
  if (fs.existsSync(VOSK_JS) && !FORCE) {
    log('vendor/vosk.js 已存在，跳过 (' + human(fs.statSync(VOSK_JS).size) + ')');
    return;
  }
  if (!fs.existsSync(VOSK_SRC)) {
    throw new Error(
      '找不到 node_modules/vosk-browser/dist/vosk.js。\n' +
      '       请先执行：npm install'
    );
  }
  fs.mkdirSync(VENDOR, { recursive: true });
  fs.copyFileSync(VOSK_SRC, VOSK_JS);
  log('已生成 vendor/vosk.js (' + human(fs.statSync(VOSK_JS).size) + ')');
}

/* ------------------------------------------------------------------ *
 * 2. 下载（支持重定向 / 进度 / 断点重跑）
 * ------------------------------------------------------------------ */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('重定向次数过多'));
    const u = new URL(url);
    const client = u.protocol === 'http:' ? http : https;
    const req = client.get(u, {
      headers: { 'User-Agent': 'storm-teleprompter-setup/1.0' },
      timeout: 60000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, u).href;
        log('重定向 →', next);
        return resolve(download(next, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('下载失败，HTTP ' + res.statusCode));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let lastPct = -1;
      const tmp = dest + '.part';
      const ws = fs.createWriteStream(tmp);
      res.on('data', chunk => {
        got += chunk.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`\r[setup] 下载中 ${pct}%  ${human(got)} / ${human(total)}   `);
          }
        }
      });
      res.on('error', e => { try { ws.destroy(); } catch (_) {} reject(e); });
      ws.on('error', reject);
      ws.on('finish', () => {
        process.stdout.write('\n');
        try { fs.rmSync(dest, { force: true }); } catch (_) {}
        fs.renameSync(tmp, dest);
        resolve();
      });
      res.pipe(ws);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时（60s）')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * 3. 最小 ZIP 读取器（central directory + deflate/store，零依赖）
 * ------------------------------------------------------------------ */
function readZip(buf) {
  const SIG_EOCD = 0x06054b50;
  const SIG_CEN = 0x02014b50;
  const SIG_LOC = 0x04034b50;

  let eocd = -1;
  const from = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('下载的文件不是有效的 zip（可能是不完整的下载）');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CEN) {
      throw new Error('zip 中央目录损坏，请删除 ' + MODEL_ZIP + ' 后重试');
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const rawName = buf.toString('utf8', off + 46, off + 46 + nameLen);

    if (buf.readUInt32LE(localOff) !== SIG_LOC) throw new Error('zip 本地文件头损坏');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    entries.push({ name: rawName, method, raw });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractModelDir(zipBuf) {
  const entries = readZip(zipBuf);
  // 官方 zip 内有一层顶层目录（如 vosk-model-small-cn-0.22/），需要去掉
  const first = entries.find(e => e.name.includes('/'));
  const top = first ? first.name.slice(0, first.name.indexOf('/') + 1) : '';
  log('zip 内共', entries.length, '项，顶层目录:', top || '(无)');

  fs.mkdirSync(MODEL_DIR, { recursive: true });
  let files = 0;
  for (const e of entries) {
    let rel = top && e.name.startsWith(top) ? e.name.slice(top.length) : e.name;
    if (!rel) continue;
    // 防路径穿越
    rel = rel.replace(/\\/g, '/');
    if (rel.startsWith('/') || rel.split('/').includes('..')) continue;
    if (rel.endsWith('/')) { fs.mkdirSync(path.join(MODEL_DIR, rel), { recursive: true }); continue; }
    const data = e.method === 0 ? e.raw
      : e.method === 8 ? zlib.inflateRawSync(e.raw)
        : (() => { throw new Error('不支持的 zip 压缩方式: ' + e.method); })();
    const out = path.join(MODEL_DIR, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
    files++;
  }
  log('已解压', files, '个模型文件到 assets/model/');
  if (!fs.existsSync(path.join(MODEL_DIR, 'am', 'final.mdl'))) {
    throw new Error('模型解压不完整：缺少 am/final.mdl');
  }
}

/* ------------------------------------------------------------------ *
 * 4. 生成 tar.gz（ustar，内部保持 model/ 顶层目录）
 * ------------------------------------------------------------------ */
function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(name, size, isDir, mtime) {
  const h = Buffer.alloc(512);
  let shortName = name;
  let prefix = '';
  if (Buffer.byteLength(name, 'utf8') > 100) {
    const idx = name.lastIndexOf('/', name.length - 1);
    if (idx > 0) { prefix = name.slice(0, idx); shortName = name.slice(idx + 1); }
  }
  if (Buffer.byteLength(shortName, 'utf8') > 100 || Buffer.byteLength(prefix, 'utf8') > 155) {
    throw new Error('tar 路径过长: ' + name);
  }
  h.write(shortName, 0, 100, 'utf8');
  h.write(isDir ? '0000755\0' : '0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');           // uid
  h.write('0000000\0', 116, 8, 'ascii');           // gid
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(Math.floor(mtime), 12), 136, 12, 'ascii');
  h.fill(0x20, 148, 156);                          // checksum 先填空格
  h.write(isDir ? '5' : '0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  if (prefix) h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

function buildTarGz() {
  const chunks = [];
  const mtime = Math.floor(Date.now() / 1000);

  const addDir = (name) => {
    chunks.push(tarHeader(name, 0, true, mtime));
  };
  const addFile = (name, data) => {
    chunks.push(tarHeader(name, data.length, false, mtime));
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  };

  addDir('model/');
  const walk = (absDir, relDir) => {
    const names = fs.readdirSync(absDir).sort();
    for (const n of names) {
      const abs = path.join(absDir, n);
      const rel = relDir + n;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        addDir(rel + '/');
        walk(abs, rel + '/');
      } else if (st.isFile()) {
        addFile(rel, fs.readFileSync(abs));
      }
    }
  };
  walk(MODEL_DIR, 'model/');
  chunks.push(Buffer.alloc(1024));                 // 两个结束零块

  const tar = Buffer.concat(chunks);
  const gz = zlib.gzipSync(tar, { level: 1 });
  fs.writeFileSync(MODEL_TGZ, gz);
  log('已生成 assets/model.tar.gz (' + human(gz.length) + ')');
}

/* ------------------------------------------------------------------ */
async function main() {
  log('项目目录:', ROOT);
  prepareVendor();
  if (VENDOR_ONLY) { log('仅处理 vendor，完成。'); return; }

  if (!fs.existsSync(MODEL_DIR) || !fs.existsSync(path.join(MODEL_DIR, 'am', 'final.mdl'))) {
    fs.mkdirSync(ASSETS, { recursive: true });
    if (fs.existsSync(MODEL_ZIP) && fs.statSync(MODEL_ZIP).size > 30 * 1048576) {
      log('发现已下载的模型 zip，直接解压 (' + human(fs.statSync(MODEL_ZIP).size) + ')');
    } else {
      log('开始下载离线中文语音模型…');
      log('来源:', MODEL_URL, '（Apache-2.0）');
      await download(MODEL_URL, MODEL_ZIP);
      log('下载完成:', human(fs.statSync(MODEL_ZIP).size));
    }
    extractModelDir(fs.readFileSync(MODEL_ZIP));
  } else {
    log('assets/model/ 已存在，跳过下载');
  }

  if (fs.existsSync(MODEL_TGZ) && !FORCE) {
    log('assets/model.tar.gz 已存在，跳过（--force 可强制重建）');
  } else {
    buildTarGz();
  }

  log('全部就绪。接下来：npm start  或  npm run pack');
  log('提示：assets/ 下的模型与 vendor/ 不进入 Git 仓库；分发时请保留 THIRD_PARTY_NOTICES.md。');
}

main().catch(e => {
  console.error('[setup] 失败:', e.message);
  console.error('        若下载中断，可删除 assets/vosk-model-cn.zip.part 后重试，');
  console.error('        或手动下载 zip 放到 assets/vosk-model-cn.zip 再运行本脚本。');
  process.exit(1);
});
