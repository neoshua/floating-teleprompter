/* 打包：生成 win32-x64 绿色版目录 + 解压即用的 zip */
const packager = require('@electron/packager');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// packager 不允许把源目录复制到它自己的子目录，所以构建输出放到项目外
const OUT = path.join(ROOT, '..', '_pack_out');
const DIST = path.join(ROOT, 'dist');
const NAME = '飓风提词器';
const ZIP_PATH = path.join(DIST, '飓风提词器-桌面版-win64.zip');

const ZIP_ONLY = process.argv.includes('--zip-only');

const README = `飓风提词器 · 桌面版  v1.0.0
================================================

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

【怎么运行】
1. 把整个文件夹解压到一个普通目录（建议不要放在 C:\\Program Files 等需要管理员权限的位置）。
2. 双击「飓风提词器.exe」即可，无需安装、无需联网、无需登录。
3. 首次运行 Windows 可能提示「已保护你的电脑」——这是未签名程序的正常提示，
   点「更多信息」→「仍要运行」即可。软件不含任何联网上传行为。

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

【快捷键】（提词窗聚焦时）
  空格        播放 / 暂停
  ← → ↑ ↓    微调滚动位置        PageUp / PageDown  大幅跳转
  R           回到开头            T  鼠标穿透开关
  O           置顶开关            M  镜像模式
  F           铺满屏幕            + / -  字号       [ / ]  语速
  Esc         返回稿件管理

  全局快捷键（在任何软件里都生效，可在设置中关闭）：
  Ctrl+Alt+空格   播放/暂停        Ctrl+Alt+↑/↓  微调
  Ctrl+Alt+R      回到开头        Ctrl+Alt+P  穿透
  Ctrl+Alt+T      显示/隐藏提词窗

【数据】
稿件与设置保存在本目录的 data\\store.json。换电脑时把整个文件夹复制过去即可。
托盘图标（右下角）可快速显示/隐藏提词窗、开关穿透、打开数据目录、
查看「关于与致谢」（含对影视飓风的致谢与非官方声明）、退出。

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

async function main() {
  let appDir;
  if (ZIP_ONLY) {
    appDir = path.join(OUT, `${NAME}-win32-x64`);
    if (!fs.existsSync(appDir)) throw new Error('没有可复用的构建目录，请先完整打包一次');
    console.log('[pack] reusing existing build:', appDir);
  } else {
  console.log('[pack] building win32-x64 directory ...');
  const appPaths = await packager({
    dir: ROOT,
    out: OUT,
    name: NAME,
    platform: 'win32',
    arch: 'x64',
    electronVersion: '37.2.6',
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    appVersion: '1.0.0',
    overwrite: true,
    asar: false,
    prune: false,
    tmpdir: false,
    win32metadata: {
      CompanyName: 'Storm Teleprompter',
      FileDescription: '飓风提词器 桌面版 · 悬浮透明提词器',
      ProductName: '飓风提词器',
      OriginalFilename: '飓风提词器.exe'
    },
    ignore: [
      /^\/node_modules($|\/)/,
      /^\/dist($|\/)/,
      /^\/data($|\/)/,
      /^\/scripts($|\/)/,
      /^\/docs($|\/)/,
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
  });

  appDir = appPaths[0];
  }
  console.log('[pack] output:', appDir);

  fs.writeFileSync(path.join(appDir, '使用说明.txt'), README, 'utf8');
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });

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

  // 核对关键资产确实进了包
  const appResources = path.join(appDir, 'resources', 'app');
  const required = [
    'main.js', 'preload.js', 'package.json',
    'src/index.html', 'src/prompt.html', 'src/prompt.js',
    'vendor/vosk.js', 'assets/model.tar.gz', 'assets/icon.ico'
  ];
  for (const rel of required) {
    const p = path.join(appResources, rel);
    if (!fs.existsSync(p)) throw new Error('打包缺少文件: ' + rel);
  }
  const modelSize = fs.statSync(path.join(appResources, 'assets', 'model.tar.gz')).size;
  if (modelSize < 30 * 1024 * 1024) throw new Error('语音模型不完整: ' + modelSize);
  console.log('[pack] assets verified, model', (modelSize / 1048576).toFixed(1), 'MB');

  // 压缩为 zip（保留顶层文件夹）
  console.log('[pack] creating zip ...');
  fs.mkdirSync(DIST, { recursive: true });
  const py = `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
top = os.path.basename(src)
KEEP_LOCALES = {'en-US.pak', 'zh-CN.pak', 'zh-TW.pak'}
skipped = 0
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr(top + '/data/', '')
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ('__pycache__',)]
        rel_root = os.path.relpath(root, src).replace(os.sep, '/')
        for f in files:
            # 只保留中英文语言包；data 目录保持为空；不带入任何测试残留
            if rel_root == 'data': continue
            if rel_root == 'locales' and f.endswith('.pak') and f not in KEEP_LOCALES:
                skipped += 1; continue
            if f.endswith('.log') or f == 'selftest.json':
                skipped += 1; continue
            p = os.path.join(root, f)
            rel = os.path.relpath(p, src).replace(os.sep, '/')
            z.write(p, top + '/' + rel)
print('ZIP_OK', round(os.path.getsize(dst)/1048576, 1), 'MB', '| skipped', skipped, 'files')
`;
  const out = execFileSync('python', ['-c', py, appDir, ZIP_PATH], { encoding: 'utf8' });
  console.log('[pack]', out.trim());
  console.log('[pack] ZIP:', ZIP_PATH);
}

main().catch(e => { console.error('[pack] FAILED', e); process.exit(1); });
