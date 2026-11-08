/**
 * 增量更新链路端到端回归测试（纯本地、不联网、不碰真实程序目录）
 *
 * 覆盖：zip 生成/解析一致性、版本门槛、整包与逐文件 SHA-256 校验、
 *       路径白名单、跨目录越界、真实写入 + 备份 + 用户数据不受影响、失败回滚。
 * 用法：node scripts/test-update.js   （需先执行 node scripts/make-patch.js）
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sha256, readZip, verifyPatch, writeFiles, compareVersions, isSafeRel,
  selectFull, ensureWritableAppRoot, macBundleRoot, finalizeMacBundle
} = require('../updater');
const { makeZip } = require('./make-patch');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VERSION = require(path.join(ROOT, 'package.json')).version;
const TAG = 'v' + VERSION;
const REAL_PATCH = path.join(DIST, `patch-${TAG}.zip`);
const LATEST = path.join(DIST, 'latest.json');

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String((e && e.message) || e) });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function expectThrow(fn, keyword) {
  let threw = false, msg = '';
  try { fn(); } catch (e) { threw = true; msg = String(e.message || e); }
  assert(threw, '预期抛错但没有：' + keyword);
  if (keyword) assert(msg.includes(keyword), `错误信息不含「${keyword}」：${msg}`);
  return msg;
}
function buildPatch(version, minVersion, filesMap, extra = {}) {
  const manifest = { version, minVersion, files: {}, ...extra };
  for (const [rel, data] of Object.entries(filesMap)) {
    manifest.files[rel] = { size: data.length, sha256: sha256(data) };
  }
  return makeZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf8') },
    ...Object.entries(filesMap).map(([name, data]) => ({ name, data }))
  ]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-update-'));
const appRoot = path.join(tmp, 'app');
const dataDir = path.join(tmp, 'data');

try {
  /* 1. 真实补丁与版本清单 */
  let realZip = null, latest = null;
  check('真实补丁与 latest.json 存在', () => {
    assert(fs.existsSync(REAL_PATCH), '缺少 ' + REAL_PATCH + '，请先运行 make-patch.js');
    assert(fs.existsSync(LATEST), '缺少 latest.json');
    realZip = fs.readFileSync(REAL_PATCH);
    latest = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
    assert(latest.version === VERSION, 'latest.json 版本与 package.json 不一致');
    assert(latest.patch.sha256 === sha256(realZip), 'latest.json 里补丁 SHA-256 与实际文件不符');
    assert(latest.patch.size === realZip.length, 'latest.json 里补丁大小与实际文件不符');
    return `${(realZip.length / 1048576).toFixed(2)} MB / ${latest.patch.sha256.slice(0, 12)}…`;
  });

  check('客户端 ZIP 解析器能读到全部文件', () => {
    const files = readZip(realZip);
    assert(files.has('manifest.json'), '缺 manifest.json');
    const mf = JSON.parse(files.get('manifest.json').toString('utf8'));
    assert(mf.version === VERSION, 'manifest 版本不符');
    const n = Object.keys(mf.files).length;
    assert(n >= 10, '文件数异常：' + n);
    for (const [rel, meta] of Object.entries(mf.files)) {
      assert(isSafeRel(rel), '路径不在白名单：' + rel);
      assert(files.has(rel), '补丁缺文件：' + rel);
      assert(sha256(files.get(rel)) === meta.sha256, '文件校验不符：' + rel);
      const disk = path.join(ROOT, rel);
      assert(fs.existsSync(disk), '源码不存在：' + rel);
      assert(
        sha256(fs.readFileSync(disk)) === meta.sha256,
        `补丁内容与源码不一致：${rel}（源码已改动但尚未重新出补丁 → 先跑 node scripts/make-patch.js）`
      );
    }
    return `${n} 个代码文件，全部与源码逐字节一致`;
  });

  check('版本门槛：旧版本 / 同版本都不允许安装', () => {
    expectThrow(() => verifyPatch(realZip, '1.0.0'), '最低支持');
    expectThrow(() => verifyPatch(realZip, VERSION), '不高于当前版本');
    return `minVersion=${latest.minVersion}，1.0.0 与 ${VERSION} 均被正确拒绝`;
  });

  /* 2. 构造一个更高的测试版本，验证「发现更新 → 校验 → 安装」 */
  const testVersion = '9.9.9';
  const newMain = Buffer.from('// new main\nconsole.log("v9.9.9");\n');
  const newSrc = Buffer.from('// new manager\n');
  const newFile = Buffer.from('// brand new updater module\n');
  const testFiles = {
    'main.js': newMain,
    'src/manager.js': newSrc,
    'updater.js': newFile
  };
  const testPatch = buildPatch(testVersion, VERSION, testFiles);

  check('模拟新版本：校验通过并识别为可安装', () => {
    const r = verifyPatch(testPatch, VERSION);
    assert(r.manifest.version === testVersion, '版本解析错误');
    assert(r.pending.size === 3, '待写文件数错误');
    assert(compareVersions(testVersion, VERSION) > 0, '版本比较错误');
    return `v${VERSION} → v${testVersion}，3 个文件待写`;
  });

  check('篡改补丁内容会被 SHA-256 拦截', () => {
    const bad = buildPatch(testVersion, VERSION, { 'main.js': newMain });
    const files = readZip(bad);
    const mf = JSON.parse(files.get('manifest.json').toString('utf8'));
    mf.files['main.js'].sha256 = '0'.repeat(64);
    const tampered = makeZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(mf)) },
      { name: 'main.js', data: newMain }
    ]);
    expectThrow(() => verifyPatch(tampered, VERSION), '校验失败');
    return 'manifest 校验值被改 → 拒绝安装';
  });

  check('恶意 / 越界路径会被白名单拦截', () => {
    const bad = buildPatch(testVersion, VERSION, { 'main.js': newMain });
    const files = readZip(bad);
    const mf = JSON.parse(files.get('manifest.json').toString('utf8'));
    mf.files['../../evil.js'] = { size: 4, sha256: sha256(Buffer.from('evil')) };
    const evilZip = makeZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(mf)) },
      { name: 'main.js', data: newMain },
      { name: '../../evil.js', data: Buffer.from('evil') }
    ]);
    expectThrow(() => verifyPatch(evilZip, VERSION), '不允许的路径');
    assert(!isSafeRel('data/store.json'), 'data/ 必须被拒绝');
    assert(!isSafeRel('assets/model.tar.gz'), 'assets/ 必须被拒绝');
    return '路径遍历、data/、assets/ 均被拒绝';
  });

  /* 3. 真实写入（临时目录） */
  fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'data'), { recursive: true });
  const oldMain = Buffer.from('// old main v1\n');
  const oldSrc = Buffer.from('// old manager v1\n');
  const userData = Buffer.from('{"articles":[{"title":"用户稿件"}]}');
  fs.writeFileSync(path.join(appRoot, 'main.js'), oldMain);
  fs.writeFileSync(path.join(appRoot, 'src/manager.js'), oldSrc);
  fs.writeFileSync(path.join(appRoot, 'data/store.json'), userData);

  let installRes = null;
  check('安装：备份 + 原子写入 + 用户数据零改动', () => {
    const r = verifyPatch(testPatch, VERSION);
    installRes = writeFiles(appRoot, r.pending, { version: VERSION, dataDir, label: 'test' });
    assert(installRes.changed === 3, '变化文件数应为 3，实际 ' + installRes.changed);
    assert(fs.readFileSync(path.join(appRoot, 'main.js')).equals(newMain), 'main.js 未更新');
    assert(fs.readFileSync(path.join(appRoot, 'src/manager.js')).equals(newSrc), 'manager.js 未更新');
    assert(fs.existsSync(path.join(appRoot, 'updater.js')), '新增文件未写入');
    assert(fs.readFileSync(path.join(appRoot, 'data/store.json')).equals(userData), '用户稿件被改动！');
    assert(installRes.backupDir && fs.existsSync(installRes.backupDir), '备份目录未创建');
    assert(fs.readFileSync(path.join(installRes.backupDir, 'main.js')).equals(oldMain), '旧文件未备份');
    return `替换 ${installRes.changed} 个文件，data/store.json 原样保留`;
  });

  check('失败回滚：中途写入出错时恢复全部旧文件', () => {
    // 让 appRoot/src 变成普通文件：第一个文件 main.js 会先写入成功，
    // 第二个 src/manager.js 因父目录不是目录而失败，从而触发真正的回滚。
    fs.writeFileSync(path.join(appRoot, 'main.js'), oldMain);
    fs.rmSync(path.join(appRoot, 'src'), { recursive: true, force: true });
    fs.writeFileSync(path.join(appRoot, 'src'), 'not a directory');
    const r = verifyPatch(testPatch, VERSION);
    expectThrow(() => writeFiles(appRoot, r.pending, { version: VERSION, dataDir, label: 'rollback' }), '已回滚');
    assert(fs.readFileSync(path.join(appRoot, 'main.js')).equals(oldMain), '回滚后 main.js 未恢复');
    return '模拟中途写入失败 → 自动回滚，main.js 恢复旧内容';
  });

  check('异常目标路径在备份阶段被安全拦下', () => {
    const r = verifyPatch(testPatch, VERSION);
    fs.rmSync(path.join(appRoot, 'src'), { force: true });
    fs.mkdirSync(path.join(appRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'src/manager.js'));  // 目标是目录，无法备份
    const msg = expectThrow(
      () => writeFiles(appRoot, r.pending, { version: VERSION, dataDir, label: 'guard' }),
      '未做任何改动'
    );
    return '明确报错且未写入：' + msg;
  });

  check('完整包清单按「平台-架构」分发', () => {
    const by = {
      'win32-x64': { name: 'FloatingTeleprompter-win64.zip' },
      'darwin-arm64': { name: 'FloatingTeleprompter-mac-arm64.zip' },
      'darwin-x64': { name: 'FloatingTeleprompter-mac-x64.zip' }
    };
    const origPlatform = process.platform, origArch = process.arch;
    const set = (key, value) => Object.defineProperty(process, key, { value, configurable: true });
    try {
      set('platform', 'win32'); set('arch', 'x64');
      assert(selectFull({ fullByPlatform: by, full: { name: 'legacy' } }).name === by['win32-x64'].name, 'win32 选错');
      set('platform', 'darwin'); set('arch', 'arm64');
      assert(selectFull({ fullByPlatform: by }).name === by['darwin-arm64'].name, 'darwin-arm64 选错');
      set('arch', 'x64');
      assert(selectFull({ fullByPlatform: by }).name === by['darwin-x64'].name, 'darwin-x64 选错');
      // v1.0.2 的旧清单只有 full（Windows 包），不能把它推给 Mac 用户
      assert(selectFull({ full: { name: 'legacy' } }) === null, '旧清单把 Windows 包给了 Mac');
      set('platform', 'win32');
      assert(selectFull({ full: { name: 'legacy' } }).name === 'legacy', '旧客户端兼容失效');
    } finally {
      set('platform', origPlatform); set('arch', origArch);
    }
    return '三种平台各自命中；旧清单不会给 Mac 推 Windows 包';
  });

  check('安装前写权限预检：可写目录通过且不留探针', () => {
    const dir = path.join(tmp, 'writable-app');
    fs.mkdirSync(dir, { recursive: true });
    assert(ensureWritableAppRoot(dir, 'darwin') === true, '可写目录未通过');
    assert(!fs.existsSync(path.join(dir, '.upd-write-probe')), '探针文件未清理');
    return '探针创建即删除，业务文件零改动';
  });

  check('安装前写权限预检：只读/异常目录给出 macOS 可操作提示', () => {
    const dir = path.join(tmp, 'readonly-app');
    fs.mkdirSync(dir, { recursive: true });
    // 让探针路径变成目录，跨平台稳定触发写入失败（等价于无写权限）
    fs.mkdirSync(path.join(dir, '.upd-write-probe'));
    const msg = expectThrow(
      () => ensureWritableAppRoot(dir, 'darwin'),
      '程序目录不可写'
    );
    assert(msg.includes('应用程序'), '缺少 macOS 的处置指引');
    assert(msg.includes('.dmg'), '未提示只读磁盘映像场景');
    return '下载前即拦截，提示拖入「应用程序」并避开 .dmg';
  });

  check('macOS 签名自愈：只认本应用的标准 .app 结构', () => {
    const base = path.join(tmp, 'BundleTest.app');
    const contents = path.join(base, 'Contents');
    const code = path.join(contents, 'Resources', 'app');
    fs.mkdirSync(code, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist/>');
    assert(macBundleRoot(code) === path.resolve(base), '未推导出 .app 根');
    assert(macBundleRoot(tmp) === null, '普通目录不应被当成 .app');
    assert(macBundleRoot(path.join(code, 'src')) === null, '子目录不应被当成代码根');
    fs.rmSync(path.join(contents, 'Info.plist'));
    assert(macBundleRoot(code) === null, '缺 Info.plist 时应拒绝');
    return '路径推导 + 结构校验，拒绝作用于任意目录';
  });

  check('macOS 签名自愈：清隔离属性优先、重签兜底、缺工具不抛错', () => {
    const base = path.join(tmp, 'SignTest.app');
    const contents = path.join(base, 'Contents');
    const code = path.join(contents, 'Resources', 'app');
    fs.mkdirSync(code, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), '<plist/>');
    const calls = [];
    const runner = (cmd, args) => { calls.push([cmd, args]); };
    const r = finalizeMacBundle(code, { platform: 'darwin', run: runner });
    assert(r.attempted && r.quarantineCleared && r.resigned, '两步未都执行');
    assert(calls[0][0] === 'xattr' && calls[0][1][0] === '-cr', '第一步应清隔离属性');
    assert(calls[0][1][1] === path.resolve(base), '作用域必须是本应用 .app');
    assert(calls[1][0] === 'codesign' && calls[1][1].includes(path.resolve(base)), '第二步应重签 .app');
    assert(finalizeMacBundle(code, { platform: 'win32', run: runner }).attempted === false,
      'Windows 上不应执行');
    // 普通用户 Mac 上可能没装 Xcode CLT：codesign 不存在时静默降级
    const r2 = finalizeMacBundle(code, {
      platform: 'darwin',
      run: (cmd) => { if (cmd === 'codesign') throw new Error('ENOENT'); }
    });
    assert(r2.quarantineCleared && !r2.resigned && r2.notes.length === 1,
      '缺 codesign 时应降级而不是让更新失败');
    return 'xattr 为主 + codesign 兜底，缺 CLT 时静默降级';
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const ok = results.every(r => r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
console.log(`\n[test-update] ${results.filter(r => r.ok).length}/${results.length} passed, ok=${ok}`);
process.exit(ok ? 0 : 1);
