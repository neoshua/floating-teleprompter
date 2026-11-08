/**
 * 生成「增量更新补丁」与版本清单 latest.json。
 *
 * 每次发版和完整包一起上传到 GitHub Release：
 *   patch-vX.Y.Z.zip   只包含会变的代码 / 说明文件，不含 Electron 运行时与语音模型
 *   latest.json         应用启动时读取的公开版本清单（含补丁大小与 SHA-256）
 *
 * 补丁里放的是【全量代码快照】而不是差量，因此无论用户停在哪个旧版本，
 * 都能一步升到最新版；安装时按 SHA-256 比对，只写真正变化的文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sha256, isSafeRel, readZip, verifyPatch } = require('../updater');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPO = 'neoshua/floating-teleprompter';
const VERSION = require(path.join(ROOT, 'package.json')).version;
const TAG = 'v' + VERSION;
const PATCH_NAME = `patch-${TAG}.zip`;
const FULL_NAME = 'FloatingTeleprompter-win64.zip';
const FULL_LOCAL = path.join(DIST, '飓风提词器-桌面版-win64.zip');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const NOTES_FILE = arg('--notes-file', null);
const MIN_VERSION = arg('--min-version', VERSION);

const DEFAULT_NOTES = `${TAG}
· macOS 版正式发布：Apple 芯片 / Intel 各一个 DMG，打开后把 .app 拖进 Applications 即可，
  能正常出现在启动台 / 应用程序列表；不再需要自己找文件夹里的 .app。
· Mac 与 Windows 共用同一套应用内增量更新：检查、SHA-256 校验、备份、失败回滚、
  重启生效，完整包也按「平台-架构」分发，Mac 用户不会被推 Windows 安装包。
· DMG 挂载出来的磁盘映像是只读的，请先把 .app 拖到「应用程序」再运行；直接在
  挂载盘里运行会让以后的应用内更新因无法写入而中止（预检会提示，不会损坏程序）。
· 本版本未做 Apple 签名 / 公证，首次打开需按 Control 点按 →「打开」。
· Windows 端仅同步版本号与完整包登记，功能无变化；稿件、设置、语音模型均不受更新影响。`;

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

/** 生成标准 zip（无加密 / 无 ZIP64），Node 与常见解压工具都能打开 */
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);    // made by: UNIX / 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* -------------------------------------------------------------- 收集文件 */
const TOP_FILES = [
  'main.js', 'preload.js', 'updater.js', 'package.json',
  'README.md', 'LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md'
];
const SUB_DIRS = ['src', 'vendor', 'third_party'];

function collect() {
  const out = [];
  for (const rel of TOP_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) throw new Error('缺少源码文件：' + rel);
    out.push({ name: rel, data: fs.readFileSync(p) });
  }
  for (const dir of SUB_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      if (f.startsWith('.') || /\.(log|tmp|bak)$/i.test(f)) continue;
      if (!fs.statSync(path.join(abs, f)).isFile()) continue;
      const rel = `${dir}/${f}`;
      if (!isSafeRel(rel)) throw new Error('补丁包含不允许的路径：' + rel);
      out.push({ name: rel, data: fs.readFileSync(path.join(abs, f)) });
    }
  }
  return out;
}

function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const files = collect();
  const manifest = {
    version: VERSION,
    minVersion: MIN_VERSION,
    generatedAt: new Date().toISOString(),
    note: '仅替换程序代码；data/ 与 assets/ 不受影响，安装前自动备份，失败自动回滚。',
    files: {}
  };
  for (const f of files) {
    manifest.files[f.name] = { size: f.data.length, sha256: sha256(f.data) };
  }
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }, ...files];
  const zip = makeZip(entries);

  // 生成完立刻用客户端同一套解析器 + 校验器回读，保证端侧一定能装
  const roundTrip = verifyPatch(zip, '0.0.1', { skipVersionGate: true });
  if (roundTrip.manifest.version !== VERSION) throw new Error('补丁回读版本不一致');
  if (roundTrip.pending.size !== files.length) throw new Error('补丁回读文件数不一致');

  const patchPath = path.join(DIST, PATCH_NAME);
  fs.writeFileSync(patchPath, zip);

  const base = `https://github.com/${REPO}/releases/download/${TAG}/`;
  const notes = NOTES_FILE
    ? fs.readFileSync(path.resolve(NOTES_FILE), 'utf8').trim()
    : DEFAULT_NOTES;
  const full = fs.existsSync(FULL_LOCAL)
    ? {
        name: FULL_NAME, url: base + FULL_NAME,
        size: fs.statSync(FULL_LOCAL).size,
        sha256: sha256(fs.readFileSync(FULL_LOCAL))
      }
    : null;
  // 完整包按「平台-架构」分别登记，应用端按 process.platform/process.arch 取用。
  // full 保留为 Windows 包，兼容只认这个字段的 v1.0.2 客户端。
  const fullByPlatform = {};
  if (full) fullByPlatform['win32-x64'] = full;
  // macOS 主推 DMG；若这次只出了 zip（旧流程 / CI Artifact），仍登记为完整包，
  // 不让 Mac 用户在「下载完整安装包」时拿不到东西。
  const MAC_ASSETS = {
    'darwin-arm64': ['FloatingTeleprompter-mac-arm64.dmg', 'FloatingTeleprompter-mac-arm64.zip'],
    'darwin-x64': ['FloatingTeleprompter-mac-x64.dmg', 'FloatingTeleprompter-mac-x64.zip']
  };
  for (const [key, names] of Object.entries(MAC_ASSETS)) {
    const name = names.find(n => fs.existsSync(path.join(DIST, n)));
    if (!name) continue;
    const p = path.join(DIST, name);
    fullByPlatform[key] = {
      name, url: base + name,
      size: fs.statSync(p).size,
      sha256: sha256(fs.readFileSync(p))
    };
  }
  const latest = {
    version: VERSION,
    minVersion: MIN_VERSION,
    released: new Date().toISOString().slice(0, 10),
    notes,
    patch: { name: PATCH_NAME, url: base + PATCH_NAME, size: zip.length, sha256: sha256(zip) },
    full,
    fullByPlatform,
    releaseUrl: `https://github.com/${REPO}/releases/tag/${TAG}`
  };
  fs.writeFileSync(path.join(DIST, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');

  console.log('[patch] version      ', TAG, '| minVersion', MIN_VERSION);
  console.log('[patch] code files   ', files.length, '| raw', (files.reduce((n, f) => n + f.data.length, 0) / 1048576).toFixed(2), 'MB');
  console.log('[patch] zip size     ', (zip.length / 1048576).toFixed(2), 'MB →', PATCH_NAME);
  console.log('[patch] zip sha256   ', sha256(zip));
  console.log('[patch] full package ', full ? (full.size / 1048576).toFixed(1) + ' MB' : '(not built yet)');
  console.log('[patch] fullByPlatform', Object.keys(fullByPlatform).join(', ') || '(none)');
  console.log('[patch] round-trip   ', 'OK — 客户端解析器与校验器回读通过');
  console.log('[patch] latest.json  ', path.join(DIST, 'latest.json'));
}

if (require.main === module) main();
module.exports = { makeZip, collect, crc32 };
