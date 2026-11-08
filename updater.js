/**
 * 飓风提词器 桌面版 —— 应用内增量更新（主进程模块）
 *
 * 设计目标：Electron 运行时（~197MB）与离线语音模型（~43MB）几乎不会变，
 * 每次发版只替换「代码」部分（几百 KB ~ 2MB）。用户不必反复下载完整安装包。
 *
 * 流程：读取 latest.json → 比较版本 → 下载 patch zip → 整包 SHA-256 校验
 *      → 逐文件 SHA-256 校验 + 路径白名单 → 备份旧文件 → 原子写入 → 失败回滚
 *      → 用户手动点「重启生效」。
 *
 * 隐私与安全：只访问下面白名单里的 GitHub 域名、只读公开版本清单与更新包，
 * 不上传任何稿件、设置或本机标识；所有下载内容都必须在 latest.json 里有
 * 对应的 SHA-256；写入路径严格限制在 resources/app 下的代码目录，
 * 绝不触碰 data/（用户稿件）、assets/（模型与图标）与 Electron 运行时。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'neoshua/floating-teleprompter';
const LATEST_ASSET = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

// 下载只允许这些主机（含 GitHub Release CDN 的常见跳转域名）
const ALLOWED_HOSTS = new Set([
  'github.com', 'api.github.com', 'raw.githubusercontent.com',
  'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com', 'github-cloud.githubusercontent.com'
]);

// 允许被补丁覆盖的相对路径，限定在代码 / 说明文件范围内
const SAFE_PATH = /^(?:main\.js|preload\.js|updater\.js|package\.json|README\.md|LICENSE|NOTICE\.md|THIRD_PARTY_NOTICES\.md|src\/[A-Za-z0-9_.-]+|vendor\/[A-Za-z0-9_.-]+|third_party\/[A-Za-z0-9_.-]+)$/;

const MAX_PATCH_SIZE = 24 * 1024 * 1024;   // 补丁包上限 24MB
const MAX_UNPACKED = 48 * 1024 * 1024;     // 解压总量上限 48MB
const CHECK_TTL = 5 * 60 * 1000;           // 检查结果缓存 5 分钟

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 语义化版本比较：>0 表示 a 更新，0 相等，<0 更旧。支持 v 前缀与 -beta 后缀 */
function compareVersions(a, b) {
  const norm = (v) => String(v || '0').trim().replace(/^v/i, '')
    .split(/[.+-]/).map(s => (/^\d+$/.test(s) ? parseInt(s, 10) : 0));
  const x = norm(a), y = norm(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function isSafeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes('..')) return false;
  if (path.isAbsolute(rel) || rel.startsWith('/')) return false;
  if (!SAFE_PATH.test(rel)) return false;
  // 再校验一次解析后确实还落在 appRoot 之内
  return true;
}

/* ------------------------------------------------------------- HTTPS 下载 */
function request(url, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (_) { return reject(new Error('更新地址格式无效')); }
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
      return reject(new Error('更新地址不在允许的主机白名单内：' + u.hostname));
    }
    if (redirects > 6) return reject(new Error('更新地址跳转次数过多'));

    const req = https.get(u, {
      headers: {
        'User-Agent': `FloatingTeleprompter/${opts.version || '0'}`,
        'Accept': opts.json ? 'application/vnd.github+json, application/json' : '*/*',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache'
      },
      timeout: opts.timeout || 20000
    }, (res) => {
      const code = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, u).href; } catch (_) {
          return reject(new Error('更新地址跳转无效'));
        }
        return resolve(request(next, opts, redirects + 1));
      }
      if (code !== 200) { res.resume(); return reject(new Error('HTTP ' + code)); }

      const declared = Number(res.headers['content-length']) || 0;
      if (declared > MAX_PATCH_SIZE && opts.binary) {
        res.resume(); return reject(new Error('更新包体积异常：' + declared));
      }
      const chunks = [];
      let got = 0;
      res.on('data', (c) => {
        chunks.push(c);
        got += c.length;
        if (got > MAX_PATCH_SIZE && opts.binary) {
          req.destroy(new Error('更新包体积超出上限'));
          return;
        }
        if (opts.onProgress) opts.onProgress(got, declared);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

async function fetchJson(url, version) {
  const buf = await request(url, { json: true, timeout: 12000, version });
  return JSON.parse(buf.toString('utf8'));
}

/* 完整包按「平台-架构」分发；补丁只含代码，所有平台共用同一个。
   latest.json 里的 full 是历史字段（Windows 包），保留以兼容 v1.0.2 客户端。 */
// macOS 从 v1.0.3 起主推 DMG；zip 作为绿色版保留在 CI Artifact，
// 老 Release 里若只有 zip，兜底时也能选中。
const FULL_ASSET_NAMES = {
  'win32-x64': ['FloatingTeleprompter-win64.zip'],
  'darwin-arm64': ['FloatingTeleprompter-mac-arm64.dmg', 'FloatingTeleprompter-mac-arm64.zip'],
  'darwin-x64': ['FloatingTeleprompter-mac-x64.dmg', 'FloatingTeleprompter-mac-x64.zip']
};
function fullKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}
/** 按当前平台挑完整包；旧清单没有 fullByPlatform 时不把 Windows 包丢给 Mac 用户 */
function selectFull(doc) {
  const by = doc && doc.fullByPlatform;
  if (by) {
    if (by[fullKey()]) return by[fullKey()];
    if (by[process.platform]) return by[process.platform];
  }
  return process.platform === 'win32' ? (doc && doc.full) || null : null;
}

/** GitHub API 兜底：优先再取 release 里的 latest.json，没有就现场拼一份 */
async function normalizeApiRelease(release, version) {
  const asset = (release.assets || []).find(a => a.name === 'latest.json');
  if (asset && asset.browser_download_url) {
    return fetchJson(asset.browser_download_url, version);
  }
  const v = String(release.tag_name || '').replace(/^v/i, '');
  const pick = (...names) => {
    for (const name of names) {
      const a = (release.assets || []).find(x => x.name === name);
      if (a) return { name, url: a.browser_download_url, size: a.size };
    }
    return null;
  };
  const fullByPlatform = {};
  for (const [key, names] of Object.entries(FULL_ASSET_NAMES)) {
    const hit = pick(...names);
    if (hit) fullByPlatform[key] = hit;
  }
  return {
    version: v,
    minVersion: v,
    notes: String(release.body || '').slice(0, 2000),
    patch: pick(`patch-v${v}.zip`),
    full: fullByPlatform[fullKey()] || fullByPlatform['win32-x64'] || null,
    fullByPlatform,
    releaseUrl: release.html_url || RELEASE_PAGE
  };
}

/* ------------------------------------------------------- 最小 ZIP 解析器 */
/**
 * 只支持我们自己用 Python zipfile 生成的 zip：store(0) / deflate(8)，
 * 无加密、无分卷、无 ZIP64。返回 Map<相对路径, Buffer>。
 */
function readZip(buf) {
  if (buf.length < 22) throw new Error('更新包不是有效的 zip');
  let eocd = -1;
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('更新包缺少 zip 目录');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (off === 0xffffffff || count === 0xffff) throw new Error('不支持 ZIP64 更新包');

  const out = new Map();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error('更新包目录损坏');
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (compSize === 0xffffffff || rawSize === 0xffffffff) throw new Error('不支持 ZIP64 更新包');
    total += rawSize;
    if (total > MAX_UNPACKED) throw new Error('更新包解压后体积超出上限');
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error('更新包文件头损坏：' + name);
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataAt = localOff + 30 + lNameLen + lExtraLen;
    if (dataAt + compSize > buf.length) throw new Error('更新包内容被截断：' + name);
    const raw = buf.subarray(dataAt, dataAt + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('更新包使用了不支持的压缩方式：' + method);
    if (data.length !== rawSize) throw new Error('更新包文件大小不符：' + name);
    out.set(name, data);
  }
  return out;
}

/* ------------------------------------------------------------- 补丁校验 */
/** 校验补丁内容（不写磁盘），返回待写入的 {rel: Buffer} */
function verifyPatch(buf, currentVersion, opts = {}) {
  const files = readZip(buf);
  const mf = files.get('manifest.json');
  if (!mf) throw new Error('更新包缺少 manifest.json');
  const manifest = JSON.parse(mf.toString('utf8'));
  if (!manifest || !manifest.version || !manifest.files) throw new Error('更新包清单格式错误');
  // skipVersionGate 仅供生成端回读 / 离线测试使用；客户端安装时必须做版本判断
  if (!opts.skipVersionGate) {
    if (compareVersions(manifest.version, currentVersion) <= 0) {
      throw new Error('更新包版本不高于当前版本');
    }
    if (manifest.minVersion && compareVersions(currentVersion, manifest.minVersion) < 0) {
      throw new Error(`增量补丁最低支持 v${manifest.minVersion}，请下载完整安装包`);
    }
  }
  const pending = new Map();
  for (const [rel, meta] of Object.entries(manifest.files)) {
    if (!isSafeRel(rel)) throw new Error('更新包包含不允许的路径：' + rel);
    const data = files.get(rel);
    if (!data) throw new Error('更新包缺少文件：' + rel);
    if (!meta.sha256) throw new Error('更新包缺少文件校验值：' + rel);
    if (meta.size != null && data.length !== Number(meta.size)) {
      throw new Error('更新包文件大小不符：' + rel);
    }
    if (sha256(data) !== String(meta.sha256).toLowerCase()) {
      throw new Error('更新包文件校验失败：' + rel);
    }
    pending.set(rel, data);
  }
  if (pending.size === 0) throw new Error('更新包没有可安装的文件');
  return { manifest, pending };
}

/**
 * 把校验过的文件写入目标根目录。先整体备份，任何一步失败即回滚。
 * dataDir 传入 null 时跳过备份与记录（仅供自检 / 测试 dry-run）。
 */
function writeFiles(targetRoot, pending, opts = {}) {
  const { version = '0', dataDir = null, backup = !!dataDir, label = '' } = opts;
  const root = path.resolve(targetRoot);
  const entries = [...pending.entries()];
  for (const [rel] of entries) {
    if (!isSafeRel(rel)) throw new Error('不允许的路径：' + rel);
    const abs = path.resolve(root, rel);
    if (abs !== path.join(root, rel) || !abs.startsWith(root + path.sep)) {
      throw new Error('路径越界：' + rel);
    }
  }

  const backupDir = backup
    ? path.join(dataDir, 'backups', `${Date.now()}-v${version}${label ? '-' + label : ''}`)
    : null;
  const existing = new Map();
  const added = [];
  if (backupDir) fs.mkdirSync(backupDir, { recursive: true });

  // 阶段一：备份所有会被覆盖的旧文件
  for (const [rel] of entries) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      let buf;
      try { buf = fs.readFileSync(abs); }
      catch (e) { throw new Error(`无法备份现有文件 ${rel}（${e.code || e.message}），未做任何改动`); }
      existing.set(rel, buf);
      if (backupDir) {
        const b = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.writeFileSync(b, buf);
      }
    } else added.push(rel);
  }

  // 阶段二：原子写入（tmp + rename，锁文件时降级直写）
  const written = [];
  const writeOne = (abs, buf) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + '.upd-tmp';
    try {
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, abs);
      return;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      // Windows 上 Defender 偶尔锁住目标文件导致 rename 失败，降级为直写
      fs.writeFileSync(abs, buf);
    }
  };

  try {
    for (const [rel, buf] of entries) {
      const abs = path.join(root, rel);
      writeOne(abs, buf);
      written.push(rel);
      if (sha256(fs.readFileSync(abs)) !== sha256(buf)) {
        throw new Error('写入后校验失败：' + rel);
      }
    }
  } catch (e) {
    // 回滚：恢复旧内容，删除新增文件
    for (const rel of written.slice().reverse()) {
      const abs = path.join(root, rel);
      try {
        if (existing.has(rel)) writeOne(abs, existing.get(rel));
        else fs.unlinkSync(abs);
      } catch (_) {}
    }
    throw new Error('安装失败，已回滚到更新前状态：' + e.message);
  }

  let changed = 0;
  for (const [rel, buf] of entries) {
    if (!existing.has(rel) || sha256(existing.get(rel)) !== sha256(buf)) changed++;
  }
  const record = {
    from: version, to: null, at: new Date().toISOString(),
    backup: backupDir, changed, files: entries.length, added
  };
  return { record, changed, added, backupDir };
}

/**
 * 安装前预检：确认代码目录真的可写，避免白下载几 MB 之后才失败。
 * Windows 绿色版一般没问题；macOS 的 .app 若还留在只读磁盘映像里、或放在
 * 当前用户无写权限的位置，备份阶段才会抛 EROFS，用户看不懂该怎么处理。
 * 探针只创建一个隐藏小文件并立即删除，不会改动任何业务数据。
 */
function ensureWritableAppRoot(appRoot, platform = process.platform) {
  const probe = path.join(appRoot, '.upd-write-probe');
  try {
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    const hint = platform === 'darwin'
      ? '请把「飓风提词器.app」拖进「应用程序」或解压到可写文件夹后重试；不要从只读的磁盘映像（.dmg）里直接运行。'
      : '请检查程序目录的写入权限，或把整个文件夹移到当前用户可写的位置后重试。';
    throw new Error(`程序目录不可写，无法应用更新（${e.code || e.message}）。${hint}`);
  }
}

/* ------------------------------------------- macOS 更新后的「可打开」自愈 */

/**
 * 从代码目录推导本应用的 .app bundle 根路径，并严格校验结构。
 * 打包后 __dirname（appRoot）是 <...app>/Contents/Resources/app。
 * 任何一步对不上就返回 null —— 绝不把 xattr / codesign 作用到未经确认的目录。
 */
function macBundleRoot(appRoot) {
  const root = path.resolve(appRoot);
  const bundle = path.resolve(root, '..', '..', '..');
  const contents = path.join(bundle, 'Contents');
  if (!bundle.endsWith('.app')) return null;
  if (path.resolve(contents, 'Resources', 'app') !== root) return null;
  if (!fs.existsSync(path.join(contents, 'Info.plist'))) return null;
  if (!fs.existsSync(path.join(contents, 'MacOS'))) return null;
  return bundle;
}

/**
 * 补丁写完后，恢复 macOS .app 的「能双击打开」状态。
 *
 * 背景：v1.0.4 起打包时会做 ad-hoc 签名，CodeResources 把
 * Contents/Resources/app/*.js 的哈希封进 seal。应用内更新恰好会改写这些 JS，
 * 签名随即失效；此时若 .app 仍带着下载时系统加的 com.apple.quarantine，
 * Gatekeeper 有可能重新评估并报「已损坏，需要移到废纸篓」。
 * 真机验证结论：清掉 quarantine 后，非 hardened runtime 的 app 即使 seal
 * 不匹配也能正常启动 —— 所以清隔离属性是主力，重签是保险。
 *
 * 两步都 best-effort：普通用户 Mac 上不一定装了 Xcode 命令行工具（没有
 * codesign），但 xattr 是系统自带的。任何失败都只记录、不抛错 —— 文件此时
 * 已经写好了，把「更新成功」误判为失败并回滚反而更糟。
 *
 * 作用域只限本应用自己的 .app：路径由 macBundleRoot() 推导并校验，
 * 不接受外部传入；不触碰 .app 外的 data/ 等用户数据目录。
 */
function finalizeMacBundle(appRoot, opts = {}) {
  const platform = opts.platform || process.platform;
  const run = opts.run || ((cmd, args) => execFileSync(cmd, args, {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe']
  }));
  const result = {
    attempted: false, bundle: null,
    quarantineCleared: false, resigned: false, notes: []
  };
  if (platform !== 'darwin') return result;
  const bundle = macBundleRoot(appRoot);
  if (!bundle) return result;         // 源码模式 / 非标准布局，跳过
  result.attempted = true;
  result.bundle = bundle;

  try { run('xattr', ['-cr', bundle]); result.quarantineCleared = true; }
  catch (e) { result.notes.push('xattr: ' + (e.code || e.message)); }

  try {
    run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle]);
    result.resigned = true;
  } catch (e) { result.notes.push('codesign: ' + (e.code || e.message)); }

  return result;
}

/* ------------------------------------------------------------- 配置读写 */
function createUpdater(cfg) {
  const { appRoot, dataDir, version, packaged, emit, restart } = cfg;
  const settingsPath = path.join(dataDir, 'update-settings.json');
  let cache = null;
  let installing = false;

  function noop() {}
  const notify = typeof emit === 'function' ? emit : noop;

  function getSettings() {
    let autoCheck = true;
    try {
      const j = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (typeof j.autoCheck === 'boolean') autoCheck = j.autoCheck;
    } catch (_) {}
    return { autoCheck, current: version, packaged };
  }

  function setSettings(patch) {
    const s = getSettings();
    if (typeof patch.autoCheck === 'boolean') s.autoCheck = patch.autoCheck;
    try {
      fs.writeFileSync(settingsPath, JSON.stringify({ autoCheck: s.autoCheck }, null, 2), 'utf8');
    } catch (e) { return { ...s, saved: false, error: e.message }; }
    return { ...s, saved: true };
  }

  function base(state, extra) {
    return {
      state, current: version, checkedAt: Date.now(),
      latest: null, notes: '', released: '', patch: null, full: null,
      releaseUrl: RELEASE_PAGE, canPatch: false, reason: '', error: null,
      ...extra
    };
  }

  /** 检查更新。force=false 且距上次成功检查不足 CHECK_TTL 时直接返回缓存 */
  async function check(force = false) {
    if (!force && cache && Date.now() - cache.at < CHECK_TTL) return cache.result;
    let doc = null, lastErr = null;

    for (const url of [LATEST_ASSET, LATEST_API]) {
      try {
        const obj = await fetchJson(url, version);
        doc = obj && obj.tag_name ? await normalizeApiRelease(obj, version) : obj;
        if (doc && doc.version) break;
        doc = null;
      } catch (e) { lastErr = e; }
    }
    if (!doc || !doc.version) {
      const r = base('error', { error: (lastErr && lastErr.message) || '未能读取版本信息' });
      return r;
    }

    const cmp = compareVersions(doc.version, version);
    const minV = doc.minVersion || doc.version;
    // 没有 SHA-256 的补丁一律不接受，避免下载到被替换过的包
    const hasVerifiedPatch = !!(doc.patch && doc.patch.url && doc.patch.sha256);
    const canPatch = hasVerifiedPatch && compareVersions(version, minV) >= 0;
    const r = base(cmp > 0 ? 'available' : 'latest', {
      latest: doc.version,
      notes: String(doc.notes || '').slice(0, 3000),
      released: doc.released || '',
      patch: doc.patch || null,
      full: selectFull(doc),
      releaseUrl: doc.releaseUrl || `https://github.com/${REPO}/releases/tag/v${doc.version}`,
      canPatch: cmp > 0 && canPatch,
      reason: cmp > 0 && !canPatch
        ? (compareVersions(version, minV) < 0
            ? `当前版本过旧，增量补丁最低支持 v${minV}，请下载完整安装包`
            : '本次发布未提供增量补丁，请下载完整安装包')
        : ''
    });
    if (r.state !== 'error') cache = { at: Date.now(), result: r };
    return r;
  }

  /** 下载 + 安装一步完成；进度通过 update:progress 广播 */
  async function install(info) {
    if (installing) throw new Error('已有更新正在进行中');
    installing = true;
    try {
      // 先确认能写入代码目录，再联网下载；macOS 只读挂载时给出可操作的提示
      ensureWritableAppRoot(appRoot);
      const state = info && info.state === 'available' ? info : await check(true);
      if (state.state === 'error') throw new Error(state.error || '版本检查失败');
      if (state.state !== 'available') return { ok: false, reason: '已是最新版本' };
      if (!state.canPatch || !state.patch || !state.patch.url) {
        throw new Error(state.reason || '本次更新需要下载完整安装包');
      }

      const p = state.patch;
      notify('update:progress', { phase: 'download', percent: 0, text: '正在下载增量补丁…' });
      const buf = await request(p.url, {
        binary: true, timeout: 60000, version,
        onProgress: (got, total) => {
          const percent = total > 0 ? Math.min(99, Math.round(got / total * 100)) : 0;
          notify('update:progress', {
            phase: 'download', percent,
            text: `正在下载增量补丁… ${(got / 1048576).toFixed(1)} MB`
          });
        }
      });
      if (p.size && buf.length !== Number(p.size)) throw new Error('更新包大小与版本清单不符');
      if (!p.sha256) throw new Error('版本清单缺少更新包校验值，已中止安装');
      if (sha256(buf) !== String(p.sha256).toLowerCase()) {
        throw new Error('更新包 SHA-256 校验失败，已中止安装');
      }

      notify('update:progress', { phase: 'verify', percent: 100, text: '正在校验更新包…' });
      let verified;
      try { verified = verifyPatch(buf, version); }
      catch (e) { throw new Error('更新包校验失败：' + e.message); }
      if (verified.manifest.version !== state.latest) {
        throw new Error('更新包版本与版本清单不一致');
      }

      notify('update:progress', { phase: 'apply', percent: 100, text: '正在备份并安装…' });
      const res = writeFiles(appRoot, verified.pending, { version, dataDir, label: 'to-v' + state.latest });
      res.record.to = state.latest;
      // 补丁改写了 .app 内的 JS，ad-hoc 签名封印随之失效。清掉隔离属性并尽量
      // 重签，避免下次启动又被 Gatekeeper 判成「已损坏」。失败只记录不回滚。
      if (process.platform === 'darwin' && packaged) {
        const macFix = finalizeMacBundle(appRoot);
        res.record.macSignature = {
          attempted: macFix.attempted,
          quarantineCleared: macFix.quarantineCleared,
          resigned: macFix.resigned,
          notes: macFix.notes
        };
        if (macFix.notes.length) {
          console.warn('[updater] macOS 签名自愈部分失败:', macFix.notes.join('; '));
        }
      }
      try {
        fs.writeFileSync(path.join(dataDir, 'last-update.json'), JSON.stringify(res.record, null, 2), 'utf8');
      } catch (_) {}

      notify('update:progress', { phase: 'done', percent: 100, text: '更新完成，重启后生效' });
      cache = null;
      return {
        ok: true, version: state.latest, changed: res.changed,
        files: res.record.files, backup: res.backupDir, needRestart: true
      };
    } catch (e) {
      notify('update:progress', { phase: 'error', percent: 0, text: e.message });
      throw e;
    } finally {
      installing = false;
    }
  }

  /** 自检：纯本地逻辑，不联网、不写真实代码目录 */
  function selfTest() {
    const checks = {};
    try {
      checks.versionCompare = compareVersions('1.0.10', '1.0.9') > 0 &&
        compareVersions('v1.0.2', '1.0.2') === 0 && compareVersions('1.0.1', '1.0.2') < 0;
      checks.pathWhitelist = isSafeRel('main.js') && isSafeRel('src/manager.js') &&
        isSafeRel('updater.js') && !isSafeRel('../evil.js') &&
        !isSafeRel('data/store.json') && !isSafeRel('assets/model.tar.gz') &&
        !isSafeRel('src/../main.js') && !isSafeRel('C:/evil.js');

      // 用内存里造一个最小 zip 验证解析器（store 模式 + 本地/中央目录）
      const name = Buffer.from('probe.txt'), body = Buffer.from('storm-updater-ok');
      const crc = 0; // 解析侧以 SHA-256 校验，构造时 CRC 填 0 即可
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
      local.writeUInt32LE(crc >>> 0, 14);
      local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt32LE(crc >>> 0, 16);
      central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
      central.writeUInt16LE(name.length, 28);
      const centralOff = local.length + name.length + body.length;
      central.writeUInt32LE(0, 42);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
      eocd.writeUInt32LE(central.length + name.length, 12);
      eocd.writeUInt32LE(centralOff, 16);
      const zipBuf = Buffer.concat([local, name, body, central, name, eocd]);
      checks.zipParse = readZip(zipBuf).get('probe.txt').toString() === 'storm-updater-ok';

      checks.sha256 = sha256(Buffer.from('abc')) ===
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
      checks.hostWhitelist = ALLOWED_HOSTS.has('github.com') && !ALLOWED_HOSTS.has('evil.example.com');
      checks.ok = Object.values(checks).every(Boolean);
    } catch (e) {
      checks.ok = false;
      checks.error = String((e && e.message) || e);
    }
    return checks;
  }

  return {
    check, install, selfTest, getSettings, setSettings,
    restart: () => { if (typeof restart === 'function') restart(); },
    version
  };
}

module.exports = {
  createUpdater, compareVersions, isSafeRel, readZip, sha256,
  verifyPatch, writeFiles, selectFull, fullKey, ensureWritableAppRoot,
  macBundleRoot, finalizeMacBundle
};
