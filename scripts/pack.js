/* 打包：生成 win32-x64 / darwin-<arch> 绿色版目录 + 解压即用的 zip
 *
 *   node scripts/pack.js                                  Windows x64（默认）
 *   node scripts/pack.js --platform darwin --arch arm64    macOS Apple 芯片
 *   node scripts/pack.js --platform darwin --arch x64      macOS Intel
 *
 * 注意：macOS 包必须在 macOS 上运行本脚本。Windows 上交叉打包会丢失
 * Electron Framework 的符号链接与可执行位，产出的 .app 无法启动。
 * 仓库里的 .github/workflows/build-macos.yml 会在 GitHub 的 macOS runner 上构建。
 */
const packager = require('@electron/packager');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// packager 不允许把源目录复制到它自己的子目录，所以构建输出放到项目外
const OUT = path.join(ROOT, '..', '_pack_out');
const DIST = path.join(ROOT, 'dist');
const NAME = '飓风提词器';
const VERSION = require(path.join(ROOT, 'package.json')).version;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
};
const PLATFORM = arg('--platform', 'win32');
const ARCH = arg('--arch', PLATFORM === 'darwin' ? 'arm64' : 'x64');
const ZIP_ONLY = process.argv.includes('--zip-only');
const IS_MAC = PLATFORM === 'darwin';

if (!['win32', 'darwin'].includes(PLATFORM)) throw new Error('不支持的平台: ' + PLATFORM);
if (!['x64', 'arm64'].includes(ARCH)) throw new Error('不支持的架构: ' + ARCH);
if (PLATFORM === 'win32' && ARCH !== 'x64') throw new Error('Windows 只构建 x64');
if (IS_MAC && process.platform !== 'darwin') {
  throw new Error('macOS 包必须在 macOS 上构建（符号链接 / 可执行位无法在 Windows 保留），请使用 CI 或 Mac 本机');
}

const DIR_NAME = `${NAME}-${PLATFORM}-${ARCH}`;
const ZIP_PATH = path.join(DIST, IS_MAC
  ? `FloatingTeleprompter-mac-${ARCH}.zip`
  : '飓风提词器-桌面版-win64.zip');

/* ---------------------------------------------------------- 随包使用说明 */
const README_TPL = `飓风提词器 · 桌面版  v{{VERSION}} · {{PLATFORM_NAME}}
================================================

【v1.0.2 更新 · 应用内增量更新】
· 新增检查更新：顶栏「检查更新」或状态栏版本号即可查看是否有新版本；
  启动时也会自动检查一次（可在更新窗口关闭）。发现新版本时按钮会出现红点。
· 一键更新：点「下载并安装」只下载程序代码补丁（约 2 MB），
  不用再重复下载 150 MB 完整安装包；下载完成后点「重启生效」即可。
· 安全：更新包带整包与逐文件 SHA-256 校验，只允许替换程序代码，
  绝不触碰 data/ 稿件、语音模型与 Electron 运行时；安装前自动备份旧文件
  到 data/backups/，校验或写入失败会自动回滚。
· 隐私：只从 GitHub 读取公开版本清单和更新包，不上传稿件、设置或任何本机信息；
  关闭自动检查后软件完全离线运行。
· 注意：v1.0.1 及更早版本没有内置更新器，需要手动下载这一次完整包；
  从 v1.0.2 起，后续版本都可以在软件内一键更新。

【v1.0.1 更新】
· 修复：开启鼠标穿透后，提词设置面板的关闭按钮（×）只有一小块位置能点、
  其余位置点不动的问题。现在设置面板整体都是可交互区，按钮热区也放大了，
  面板内所有滑块、开关、按钮在任何位置都能正常操作。

【🙏 致敬影视飓风 · 非官方声明】
本软件的灵感与核心功能设计，来自影视飓风团队创作并「完全免费、无任何隐藏收费」
地分享给所有创作者的「飓风提词器」。谨此致以诚挚谢意，感谢他们让创作者
告别广告与乱收费。
  原版应用：https://mcnt8r4c3f2k.aiforce.cloud/app/app_4k0qhy8j74gpb
  官方指南：https://bytedance.larkoffice.com/docx/BLJCdabRFoO0bhxx2OqcS0khnLh

本软件是【非官方】的独立重写版本，与影视飓风、飞书 / 字节跳动、飞书妙搭
无任何隶属、授权、合作或背书关系；全部代码与界面均为独立编写，未使用、
未复制、未分发原版任何源代码、素材、商标或云端接口。
「飓风提词器」名称及相关标识的权利归各自权利人所有，此处仅作指代与致谢。
本软件永久免费、无广告、无付费墙、不得作为商业产品售卖；
允许自愿、非强制的赞助（不构成购买、不影响任何功能、不授予额外权利）。
权利人如有任何意见，可在项目仓库提交 Issue，我们会及时更名、调整或下架。

{{RUN_STEPS}}

【核心功能】
· 稿件管理：新建 / 编辑 / 删除 / 搜索，本地保存，随文件夹一起拷走。
· 悬浮提词窗：无边框、永远置顶、背景透明度可调（调到 0 就是完全透明，只留文字）。
· 三种提词模式：
  - 定速滚动：按「字/秒」匀速滚动，可调语速。
  - 手动：滚轮 / 拖拽 / 方向键控制。
  - 语音跟读：内置离线中文模型，识别到哪一行就滚到哪一行，完全不联网。
    首次使用需加载并解压约 66MB 模型，约 10~40 秒，之后会自动缓存。
    若麦克风不可用或模型加载失败，会自动退回定速滚动。
· 显示设置：字号、行距、左右边距、镜像模式（分光镜硬件用）、文字颜色、
  自动适配、阅读区黄框、稿件内容实时编辑。
· 鼠标穿透：开启后文字区域不拦鼠标，可以直接点到下面的软件；
  把鼠标移到窗口顶部或底部会自动显示控制条并恢复可操作。
· 本地「AI 优化正文」：纯规则整理标点、断句、段落节奏，不调用任何外部服务。
· 应用内更新：自动 / 手动检查新版本，一键下载约 2 MB 代码补丁并重启生效，
  不重下完整安装包；全程 SHA-256 校验，安装前备份、失败自动回滚。

{{HOTKEYS}}

{{DATA_INFO}}

【关于悬浮透明】
背景不透明度只影响窗口底色，文字始终清晰。建议：把提词窗拖到摄像头正下方，
调窄窗口、把背景调到 30%~60%，再开启鼠标穿透，就能一边看镜头一边看词。

【开源、许可与再分发】
本项目自身代码采用「MIT 基础条款 + 免费使用附加条款」（见 LICENSE）：
软件本体永久免费；禁止出售、强制收费、植入广告、设置付费墙与商业产品交付；
明确允许自愿、非强制的赞助与打赏（不构成购买、不影响功能、不授予额外权利）；
再分发必须保持免费，并完整保留本说明中对影视飓风的致谢与以下声明文件：
  LICENSE · NOTICE.md · THIRD_PARTY_NOTICES.md · third_party/
注意：这不是标准 MIT 许可证，没有 SPDX 标识符。

官方并未发布过正式开源许可证；本项目据其公开的「完全免费」与
「可一键领取同款自行修改源码」，落实为上述免费与反商业化滥用承诺
（并允许自愿赞助），详见 NOTICE.md。

第三方开源组件：
  Electron 37.2.6 ................ MIT
  vosk-browser 0.0.8 ............. Apache-2.0
  Vosk 中文模型 small-cn-0.22 .... Apache-2.0（仅由 zip 转为 tar.gz，内容未改）
  @electron/packager .............. BSD-2-Clause（仅构建期，不随本软件分发）
完整声明与许可证全文见 THIRD_PARTY_NOTICES.md 与 third_party/。

项目仓库：https://github.com/neoshua/floating-teleprompter
`;

const WIN_RUN = `【怎么运行（Windows）】
1. 把整个文件夹解压到一个普通目录（建议不要放在 C:\\Program Files 等需要管理员权限的位置）。
2. 双击「飓风提词器.exe」即可，无需安装、无需联网、无需登录。
3. 首次运行 Windows 可能提示「已保护你的电脑」——这是未签名程序的正常提示，
   点「更多信息」→「仍要运行」即可。软件不含任何联网上传、统计或遥测逻辑；
   唯一联网的是可关闭的「检查更新」，只读取 GitHub 公开版本清单，不上传任何数据。
4. 以后有新版本时，顶栏「检查更新」会出现红点，在软件内下载约 2 MB 的
   代码补丁并重启即可，不必重新下载完整安装包（v1.0.2 起支持）。`;

const MAC_RUN = `【怎么运行（macOS · {{ARCH_NAME}}）】
1. 解压后把「飓风提词器.app」拖进「应用程序」，也可以直接留在解压目录里双击。
   【注意】应用内更新需要 .app 位于当前用户可写的位置，请勿从只读的 .dmg
   磁盘映像里直接运行；否则以后点「下载并安装」会因无法写入而中止（会自动
   回滚，不会弄坏程序），把它拖进「应用程序」再更新即可。
2. 本版本【未做 Apple 签名与公证】，首次打开会被系统拦下，这是未签名程序的
   正常提示，两种方式任选其一：
   方式一：在 Finder 里按住 Control 点按 .app →「打开」→ 再点「打开」；
   方式二：终端执行  xattr -cr "/Applications/飓风提词器.app"
   处理一次之后就能正常双击启动。软件不含任何联网上传、统计或遥测逻辑；
   唯一联网的是可关闭的「检查更新」，只读取 GitHub 公开版本清单。
3. 首次使用「语音跟读」时系统会询问麦克风权限，请选择「允许」。
   音频只在本机离线识别，不上传、不保存。
4. 提词窗已设为在所有桌面空间（含全屏应用）可见。若某个全屏 App 仍盖住它，
   先切回桌面打开提词窗，或关闭该 App 的「显示器具有单独的空间」。
5. 关闭主窗口只会隐藏，程序仍在菜单栏，点菜单栏图标可重新打开；真正退出用
   ⌘Q 或菜单栏里的「退出」。以后有新版本，顶栏「检查更新」会出现红点，
   在软件内下载约 2 MB 代码补丁并重启即可（Windows / macOS 用的是同一套更新器）。
   更新只替换 .app 内的 JS 代码，稿件、设置、语音模型与麦克风授权都不受影响；
   本版本未做 Apple 签名，若你自行用 codesign 给 .app 签过名，更新会使签名
   失效，这种情况请改用完整包覆盖安装。`;

const LOCAL_HOTKEYS = `【快捷键】（提词窗聚焦时）
  空格        播放 / 暂停
  ← → ↑ ↓    微调滚动位置        PageUp / PageDown  大幅跳转
  R           回到开头            T  鼠标穿透开关
  O           置顶开关            M  镜像模式
  F           铺满屏幕            + / -  字号       [ / ]  语速
  Esc         返回稿件管理`;

const WIN_HOTKEYS = LOCAL_HOTKEYS + `

  全局快捷键（在任何软件里都生效，可在设置中关闭）：
  Ctrl+Alt+空格   播放/暂停        Ctrl+Alt+↑/↓  微调
  Ctrl+Alt+R      回到开头        Ctrl+Alt+P  穿透
  Ctrl+Alt+T      显示/隐藏提词窗`;

const MAC_HOTKEYS = LOCAL_HOTKEYS + `

  全局快捷键（在任何软件里都生效，可在设置中关闭）：
  ⌥⇧空格 (Option+Shift+Space)  播放/暂停     ⌥⇧↑/↓  微调
  ⌥⇧R     回到开头      ⌥⇧P  穿透      ⌥⇧T  显示/隐藏提词窗
  注：macOS 上刻意不用 Ctrl+Alt / ⌘⌥，是为了避开 Spotlight 与系统快捷键冲突。`;

const WIN_DATA = `【数据】
稿件与设置保存在本目录的 data\\store.json。换电脑时把整个文件夹复制过去即可。
每次应用内更新会把被替换的旧代码备份到 data\\backups\\，更新失败会自动回滚；
data\\store.json 和语音模型在任何更新中都不会被改动。
托盘图标（任务栏右下角）可快速显示/隐藏提词窗、开关穿透、打开数据目录、
查看「关于与致谢」（含对影视飓风的致谢与非官方声明）、退出。`;

const MAC_DATA = `【数据】
稿件与设置不写进 .app 包内（保持程序包干净，也避开权限问题），保存在：
  · 优先：「飓风提词器.app」同级的 data/store.json（.app 留在解压文件夹里时）
  · 若该位置不可写，自动改用：
    ~/Library/Application Support/飓风提词器/data/store.json
  点菜单栏图标 →「打开数据目录」可直接定位。换电脑复制该 data 文件夹即可。
每次应用内更新会把被替换的旧代码备份到 data/backups/，更新失败会自动回滚；
data/store.json 和语音模型在任何更新中都不会被改动。
注意：更新时需要把新代码写入 .app/Contents/Resources/app/，所以 .app 本身
必须位于当前用户可写的位置（「应用程序」或解压文件夹），不能从只读磁盘映像
里运行；安装前会自动做写权限预检，不可写时直接给出提示、不会白下载补丁。
菜单栏右上角的图标可快速显示/隐藏提词窗、开关穿透、打开数据目录、
查看「关于与致谢」（含对影视飓风的致谢与非官方声明）、退出。`;

function renderReadme(platform = PLATFORM, arch = ARCH) {
  const isMac = platform === 'darwin';
  const archName = arch === 'arm64' ? 'Apple 芯片 / arm64' : 'Intel / x64';
  return README_TPL
    .replace('{{VERSION}}', VERSION)
    .replace('{{PLATFORM_NAME}}', isMac ? 'macOS' : 'Windows')
    .replace('{{RUN_STEPS}}', isMac ? MAC_RUN.replace('{{ARCH_NAME}}', archName) : WIN_RUN)
    .replace('{{HOTKEYS}}', isMac ? MAC_HOTKEYS : WIN_HOTKEYS)
    .replace('{{DATA_INFO}}', isMac ? MAC_DATA : WIN_DATA);
}

/* ------------------------------------------------------------------ 打包 */
function pruneLocales(appDir) {
  const KEEP = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
  let removed = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'locales') {
          for (const f of fs.readdirSync(abs)) {
            if (f.endsWith('.pak') && !KEEP.has(f)) { fs.unlinkSync(path.join(abs, f)); removed++; }
          }
        } else walk(abs);
      }
    }
  };
  walk(appDir);
  return removed;
}

function makeZip(appDir) {
  fs.mkdirSync(DIST, { recursive: true });
  if (!IS_MAC) {
    // Windows：用 Python zipfile 生成，顺手跳过 data/ 内容与测试残留
    const py = `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
top = os.path.basename(src)
skipped = 0
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr(top + '/data/', '')
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ('__pycache__',)]
        rel_root = os.path.relpath(root, src).replace(os.sep, '/')
        for f in files:
            if rel_root == 'data': continue
            if f.endswith('.log') or f == 'selftest.json' or f == '.gitkeep':
                skipped += 1; continue
            p = os.path.join(root, f)
            rel = os.path.relpath(p, src).replace(os.sep, '/')
            z.write(p, top + '/' + rel)
print('ZIP_OK', round(os.path.getsize(dst)/1048576, 1), 'MB', '| skipped', skipped, 'files')
`;
    return execFileSync('python', ['-c', py, appDir, ZIP_PATH], { encoding: 'utf8' }).trim();
  }
  // macOS：必须用 zip -y 把符号链接存成链接，并保留 Unix 可执行位。
  // Python zipfile 会把 symlink 当普通文件、丢掉 mode，解压出的 .app 打不开。
  const top = path.basename(appDir);
  execFileSync('zip', ['-r', '-y', '-q', path.resolve(ZIP_PATH), top,
    '-x', '*.DS_Store', '*__pycache__*', '*.log'], { cwd: path.dirname(appDir) });
  return `ZIP_OK ${(fs.statSync(ZIP_PATH).size / 1048576).toFixed(1)} MB (symlinks + unix modes preserved)`;
}

async function main() {
  let appDir;
  if (ZIP_ONLY) {
    appDir = path.join(OUT, DIR_NAME);
    if (!fs.existsSync(appDir)) throw new Error('没有可复用的构建目录，请先完整打包一次');
    console.log('[pack] reusing existing build:', appDir);
  } else {
    console.log(`[pack] building ${PLATFORM}-${ARCH} directory ...`);
    const packOpts = {
      dir: ROOT,
      out: OUT,
      name: NAME,
      platform: PLATFORM,
      arch: ARCH,
      electronVersion: '37.2.6',
      icon: path.join(ROOT, 'assets', IS_MAC ? 'icon.icns' : 'icon.ico'),
      appVersion: VERSION,
      overwrite: true,
      asar: false,
      prune: false,
      tmpdir: false,
      ...(IS_MAC ? {
        appBundleId: 'cn.storm.teleprompter',
        appCategoryType: 'public.app-category.productivity',
        darwinDarkModeSupport: true,
        // 没有麦克风用途说明，macOS 10.14+ 会在请求权限时直接崩掉
        extendInfo: {
          NSMicrophoneUsageDescription: '语音跟读需要使用麦克风。音频仅在本机离线识别，不会上传或保存。',
          NSHumanReadableCopyright: '非官方独立作品 · 永久免费、无广告',
          LSMinimumSystemVersion: '11.0'
        }
        // @electron/packager 默认不签名、不公证；分发方式见使用说明。
        // 有 Apple Developer 账号后可接 @electron/osx-sign 与公证步骤。
      } : {
        win32metadata: {
          CompanyName: 'Storm Teleprompter',
          FileDescription: '飓风提词器 桌面版 · 悬浮透明提词器',
          ProductName: '飓风提词器',
          OriginalFilename: '飓风提词器.exe'
        }
      }),
      ignore: [
        /^\/node_modules($|\/)/,
        /^\/dist($|\/)/,
        /^\/data($|\/)/,
        /^\/scripts($|\/)/,
        /^\/docs($|\/)/,
        /^\/\.github($|\/)/,
        /^\/web($|\/)/,
        // 自检解压目录 / 临时验证目录绝不能被当成源码复制进包
        /^\/_verify($|\/)/,
        /^\/_pack_out($|\/)/,
        /^\/assets\/model($|\/)/,
        /^\/assets\/_model_tmp($|\/)/,
        /^\/assets\/vosk-model-cn\.zip$/,
        /^\/selftest-run\.log$/,
        /^\/boot-error\.log$/,
        /^\/package-lock\.json$/,
        /\.log$/,
        /^\/\.git($|\/)/
      ]
    };

    let appPaths;
    try {
      appPaths = await packager(packOpts);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/EPERM|EEXIST|ENOTEMPTY|EBUSY|rename/i.test(msg)) throw e;
      // Windows 上 Defender / 资源管理器偶尔会短暂锁住上一次的输出目录，
      // 使 packager 重命名模板目录时报 EPERM。换一个全新子目录重试即可。
      const fallback = path.join(OUT, 'build-' + Date.now());
      fs.mkdirSync(fallback, { recursive: true });
      console.log('[pack] output dir busy, retrying in', fallback);
      appPaths = await packager({ ...packOpts, out: fallback });
    }
    appDir = appPaths[0];
  }
  console.log('[pack] output:', appDir);

  fs.writeFileSync(path.join(appDir, '使用说明.txt'), renderReadme(), 'utf8');
  const dataDir = path.join(appDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  // 让 macOS 的 zip 里也保留一个可见的 data 目录占位（Windows 压缩时会跳过它）
  if (IS_MAC) fs.writeFileSync(path.join(dataDir, '.gitkeep'), '', 'utf8');

  // 许可与致谢声明放在解压后一眼可见的根目录，请随包分发、不要删除
  const notices = ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md'];
  for (const f of notices) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error('缺少声明文件: ' + f);
    fs.copyFileSync(src, path.join(appDir, f));
  }
  const tpSrc = path.join(ROOT, 'third_party');
  if (!fs.existsSync(tpSrc)) throw new Error('缺少 third_party/ 许可证全文');
  const tpDst = path.join(appDir, 'third_party');
  fs.mkdirSync(tpDst, { recursive: true });
  for (const f of fs.readdirSync(tpSrc)) fs.copyFileSync(path.join(tpSrc, f), path.join(tpDst, f));
  console.log('[pack] license & attribution files included');

  // macOS 的 app 载荷在 .app/Contents/Resources/app，Windows 在 resources/app
  const appResources = IS_MAC
    ? path.join(appDir, `${NAME}.app`, 'Contents', 'Resources', 'app')
    : path.join(appDir, 'resources', 'app');
  const required = [
    'main.js', 'preload.js', 'updater.js', 'package.json',
    'src/index.html', 'src/manager.js', 'src/prompt.html', 'src/prompt.js',
    'vendor/vosk.js', 'assets/model.tar.gz', 'assets/icon.ico',
    ...(IS_MAC ? ['assets/icon.icns', 'assets/trayTemplate.png', 'assets/trayTemplate@2x.png'] : [])
  ];
  for (const rel of required) {
    const p = path.join(appResources, rel);
    if (!fs.existsSync(p)) throw new Error('打包缺少文件: ' + rel);
  }
  const modelSize = fs.statSync(path.join(appResources, 'assets', 'model.tar.gz')).size;
  if (modelSize < 30 * 1024 * 1024) throw new Error('语音模型不完整: ' + modelSize);
  console.log('[pack] assets verified, model', (modelSize / 1048576).toFixed(1), 'MB');

  if (IS_MAC) {
    const app = path.join(appDir, `${NAME}.app`);
    const binary = path.join(app, 'Contents', 'MacOS', NAME);
    if (!fs.existsSync(binary)) throw new Error('未找到 .app 主二进制: ' + binary);
    const infoPlist = path.join(app, 'Contents', 'Info.plist');
    if (!fs.existsSync(infoPlist)) throw new Error('缺少 Info.plist');
    const plist = fs.readFileSync(infoPlist, 'utf8');
    if (!plist.includes('NSMicrophoneUsageDescription')) {
      throw new Error('Info.plist 缺少 NSMicrophoneUsageDescription，macOS 上语音跟读会崩溃');
    }
    console.log('[pack] .app structure + Info.plist OK');
  }

  const removed = pruneLocales(appDir);
  console.log('[pack] pruned locales:', removed);
  console.log('[pack] creating zip ...');
  console.log('[pack]', makeZip(appDir));
  console.log('[pack] ZIP:', ZIP_PATH);
}

if (require.main === module) {
  main().catch(e => { console.error('[pack] FAILED', e); process.exit(1); });
}
module.exports = { renderReadme, pruneLocales };
