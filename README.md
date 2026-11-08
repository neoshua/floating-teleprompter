# 浮窗提词器 · 桌面版

**Windows / macOS 上真正悬浮透明的提词器：无边框、置顶、背景可全透明、鼠标可穿透，免安装、全程离线。**

![提词悬浮窗](docs/screenshots/prompt.png)

> ### 🙏 致敬与致谢
>
> 本项目的灵感与核心功能设计，全部来自 **[影视飓风](https://www.ysjf.com/home)** 创作并
> **完全免费、无任何隐藏收费**地分享给所有创作者的「**飓风提词器**」。
> 感谢他们用飞书妙搭做出这套工具、公开完整使用指南，并允许大家「一键领取同款」自行修改，
> 让创作者不必再忍受广告与乱收费。没有这份分享，就没有这个项目。
>
> 原版应用：[飓风提词器](https://mcnt8r4c3f2k.aiforce.cloud/app/app_4k0qhy8j74gpb) ·
> [获取同款模板](https://miaoda.feishu.cn/home?templateID=1863321057085483&mode=preview) ·
> [官方使用指南](https://bytedance.larkoffice.com/docx/BLJCdabRFoO0bhxx2OqcS0khnLh)
>
> ### ⚠️ 非官方声明
>
> **本项目是非官方的独立重写版本**，不是官方桌面版或官方移植版，与影视飓风、
> 飞书 / 字节跳动、飞书妙搭之间**不存在任何隶属、授权、合作或背书关系**。
> 项目**未使用、未复制、未分发**原版的任何源代码、素材、商标或云端接口，
> 全部代码与界面均为独立编写。「飓风提词器」名称及标识归各自权利人所有。
>
> 本项目遵循原版「完全免费」的精神：**软件本体永久免费、无广告、无付费墙、
> 不得作为商业产品售卖**；同时允许**自愿、非强制**的赞助支持，赞助不构成购买、
> 不影响任何功能、不授予任何额外权利。
> 完整声明见 [NOTICE.md](./NOTICE.md)，授权见 [LICENSE](./LICENSE)。
> 权利人如有任何意见，欢迎提交 Issue，我们会及时更名、调整或下架。

> 仓库标题使用「浮窗提词器」以与官方区分；软件内的「飓风提词器 · 桌面版」
> 字样仅用于指代原作与表达致谢，软件「关于」页同样载有完整的非官方声明。

---

网页版很好用，但它做不到**桌面悬浮透明**——浏览器窗口会挡住提词器后面的画面，
也没法置顶到拍摄软件之上、让鼠标穿透到下层。这个桌面版就是为解决这一点而生：
把提词窗拖到摄像头旁边，把背景不透明度调到 0，就只剩文字浮在画面上。

## 功能

**从原版沿用并复刻的核心能力**

- 稿件管理：新建 / 编辑 / 删除 / 搜索，内置 3 篇示例稿
- 三种提词模式：
  - **定速滚动** —— 按「字/秒」匀速推进，速度可调
  - **手动滚动** —— 滚轮 / 拖拽 / 方向键 / PageUp·Down
  - **语音跟读** —— 说到哪，滚到哪
- 显示设置：字号 40–96px、行距、左右边距、镜像模式（分光镜硬件）、文字颜色、
  自动适配、`READING AREA` 阅读区黄框、播放中实时改稿
- 本地规则版「AI 优化正文」：整理标点、长句断句、段落节奏，可一键撤销
- 进度、字数、WPM / 置信度调试信息

**桌面端新增（网页做不到的部分）**

- 无边框悬浮窗，**背景不透明度 0–100% 可调**：调到 0 时窗口完全透出后面的画面，
  文字始终清晰
- 永远置顶、可拖到摄像头正下方、一键铺满屏幕
- **鼠标点击穿透**：文字区域不拦鼠标，可直接点到下层软件；
  Windows 下鼠标移到顶栏 / 底栏会自动恢复可操作
- 全局快捷键（在其他软件里也生效）与系统托盘
- 稿件存在 exe 同级 `data/store.json`，整个文件夹拷走数据跟着走
- **应用内增量更新**：自动 / 手动检查新版本，一键下载约 2 MB 代码补丁、重启生效，
  不必反复下载 150 MB 完整包；全程 SHA-256 校验、安装前备份、失败自动回滚

**两处与原版不同**

| | 原版（网页 / 妙搭） | 本项目 |
| --- | --- | --- |
| 语音识别 | 浏览器在线识别，常因版本兼容失效 | 内置**离线中文模型**（WebAssembly），不联网、不上传 |
| 稿件存储 | 飞书妙搭云端 | 纯本地 JSON，无账号、无云同步 |

![稿件管理](docs/screenshots/manager.png)

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows x64 | 已发布 | `v1.0.3`，Release 附件 `FloatingTeleprompter-win64.zip`，解压双击即用 |
| macOS Apple 芯片 / Intel | 已发布 | `v1.0.3`，Release 附件 `FloatingTeleprompter-mac-arm64.dmg` / `-x64.dmg`，打开后拖进 Applications |
| Android | 规划中 | 系统有悬浮窗权限，能力上最贴合提词器；需要另写原生 / WebView 壳层 |
| iOS / iPadOS | 最后评估 | 系统不允许第三方 App 悬浮在其他应用之上，只能用画中画近似，形态差异大 |

**为什么 macOS 包不能在这台 Windows 上直接打出来**：Electron 的 `.app` 依赖
`Contents/Frameworks` 里的符号链接和 Unix 可执行位，Windows 的压缩工具会把链接
当普通文件、丢掉 `+x`，产出的 `.app` 打不开。因此仓库提供 GitHub Actions 工作流，
在真正的 macOS runner 上用 `zip -y` 打包、用 `hdiutil` 生成 DMG，并分别验证
主二进制可执行、符号链接仍在。`scripts/pack.js` 检测到「Windows 上请求 darwin」
时会直接报错，避免产出坏包。

**macOS 版本的已知差异**（代码里已做适配）：

- 分发形态是 DMG 拖拽安装：打开 DMG，把 `.app` 拖到窗口里的 `Applications`
  快捷方式上，就能在启动台 / 应用程序列表 / Spotlight 里找到；这本来就是 macOS
  对非 App Store 应用的标准安装方式（Apple 官方说明），没有 `.pkg` 安装器。
  CI 同时产出一份 `.zip` 绿色版供高级用户使用。
- 未做 Apple 签名 / 公证。首次打开需按住 Control 点按 →「打开」，或执行
  `xattr -cr "/Applications/飓风提词器.app"`。要免除这一步需要 Apple Developer 账号。
- 全局快捷键改用 `⌥⇧`（Option+Shift）前缀，避开 Spotlight 与系统快捷键冲突；
  `⌘Q` 退出，关闭主窗口只隐藏、菜单栏图标仍在。
- 数据目录：优先 `飓风提词器.app` 同级的 `data/`；若 .app 位于 `/Applications` 等
  不可写位置，自动回退到 `~/Library/Application Support/飓风提词器/data/`。
- 菜单栏使用 Template 图标（随系统明暗自动着色）；`Info.plist` 带麦克风用途说明，
  否则 macOS 10.14+ 在申请录音权限时会直接终止应用。
- **应用内更新与 Windows 完全一致**：`updater.js` 是平台无关的主进程模块，两个平台
  共用同一套检查、增量补丁下载与 SHA-256 校验、安装前备份、失败回滚、重启生效逻辑；
  补丁也是同一个（业务代码都是纯 JS）。`latest.json` 的 `fullByPlatform` 按
  「平台-架构」提供完整包，Mac 用户不会被推 Windows 安装包。托盘菜单、帮助菜单、
  顶栏「检查更新」与启动 3 秒静默检查在两个平台都可用。
- **macOS 特有前提**：更新会把新代码写入 `.app/Contents/Resources/app/`，所以 `.app`
  必须位于当前用户可写的位置（「应用程序」或解压文件夹），**不能从只读 `.dmg` 里运行**。
  安装前会做写权限预检，不可写时直接给出处置提示、不会白下载补丁。本版本未签名；
  若自行用 `codesign` 签过名，修改 bundle 内文件会使签名失效，这种情况请用完整包覆盖。
- Mac 上「重启生效」同样走 Electron `app.relaunch()`。菜单栏 Template 图、Finder 图标
  （`.app/Contents/Resources/icon.icns`）、`Info.plist` 与 `使用说明.txt` 属于完整包内容。

> 发版约定：增量补丁只含代码文件（`main.js`、`updater.js`、`src/*`、`vendor/*` 等），
> 不含 `data/`、`assets/` 里的模型与图标，也不含 `.app/Contents/Info.plist`。
> 因此更换图标、修改麦克风权限用途说明、升级 Electron 运行时，都必须重新出完整包，
> 不能只发补丁。

## 快速开始

### 方式一：直接用（推荐给大多数创作者）

到 [Releases](https://github.com/neoshua/floating-teleprompter/releases) 下载
`FloatingTeleprompter-win64.zip`（为兼容各地网络环境，Release 附件使用英文文件名；
解压出来的文件夹与 `飓风提词器.exe` 仍是中文名）：

1. 解压到任意普通目录（**不要**放在 `C:\Program Files` 等需管理员权限的位置）
2. 双击 `飓风提词器.exe` —— 无需安装、无需联网、无需登录
3. 首次运行 Windows 可能弹出 SmartScreen「已保护你的电脑」，
   点「更多信息 → 仍要运行」即可（未签名程序的正常提示）

软件不含任何联网上传、统计或遥测逻辑。唯一的联网行为是可选的「检查更新」：
启动时（可关闭）从 GitHub 读取一份公开版本清单，不发送稿件、设置或任何本机标识；
关闭自动检查后软件完全离线运行。

#### 应用内更新（v1.0.2 起）

升级**不必重新下载完整安装包**。点顶栏「检查更新」或状态栏右下角版本号，
即可打开更新窗口：

- 发现新版本时顶栏按钮出现红点，并显示版本说明与补丁体积（通常 1–2 MB）
- 点「下载并安装」→ 校验 → 自动备份 → 替换代码 → 点「重启生效」
- 只替换程序代码；`data/` 稿件与设置、语音模型、Electron 运行时都不动
- 更新包做整包 + 逐文件 SHA-256 校验，写入路径有白名单，失败自动回滚
- 「启动时自动检查」可在更新窗口里关掉，关掉后完全不联网

> v1.0.1 及更早版本没有内置更新器，**需要手动下载这一次完整包**；
> 从 v1.0.2 开始，后续所有版本都能在软件内一键更新。
> 若哪次改动涉及 Electron 运行时或语音模型，更新窗口会提示改下完整包。

### macOS：DMG 拖拽安装（v1.0.3 起）

到 [Releases](https://github.com/neoshua/floating-teleprompter/releases) 按芯片下载
`FloatingTeleprompter-mac-arm64.dmg`（Apple 芯片 M 系列）或
`FloatingTeleprompter-mac-x64.dmg`（Intel）：

1. 双击 DMG 打开，把「飓风提词器.app」拖到窗口里的 **Applications** 快捷方式上
   （也就是拖进「应用程序」文件夹）。这就是 macOS 对非 App Store 应用的标准安装方式，
   不需要管理员密码，也没有 `.pkg` 安装器。
2. 拖完即可在启动台 / 应用程序列表 / Spotlight 中找到并打开，也可拖到程序坞固定。
3. 本版本**未做 Apple 签名 / 公证**，首次打开会被 Gatekeeper 拦下：在 Finder 里
   按住 Control 点按 `.app` →「打开」→ 再点「打开」，或执行
   `xattr -cr "/Applications/飓风提词器.app"`，处理一次之后就能正常双击启动。
4. 首次使用「语音跟读」时允许麦克风权限；音频只在本机离线识别，不上传、不保存。

> ⚠️ **务必先把 `.app` 拖出来再用**。DMG 挂载出来的磁盘映像是只读的，若直接在里面
> 双击运行，以后点应用内「下载并安装」时新代码写不进 `.app`；安装前的写权限预检
> 会给出提示并中止，不会白下载，也不会弄坏程序。本版本未签名，若自行用 `codesign`
> 签过名，增量更新会使签名失效，这种情况请改用完整包覆盖安装。

不想要拖拽安装时，GitHub Actions 的 Artifact 里也保留 `.zip` 绿色版（不随 Release
分发），用 macOS 自带的「归档实用工具」解压即可；不要用会丢掉符号链接与可执行位的
第三方解压工具重压，否则 `.app` 打不开。

### 方式二：从源码运行

需要 Node.js ≥ 18 与 npm。

```bash
git clone https://github.com/neoshua/floating-teleprompter.git
cd floating-teleprompter

npm install          # 安装 Electron 等依赖
npm run setup        # 一键生成语音资产（见下）
npm start            # 启动开发版
```

`npm run setup` 会做两件事，都是本地操作：

1. 从 `node_modules/vosk-browser/dist/` 复制 `vosk.js` 到 `vendor/`
2. 从 [Vosk 官方](https://alphacephei.com/vosk/models)下载约 43MB 的
   `vosk-model-small-cn-0.22`，转换打包成 WebAssembly 所需的
   `assets/model.tar.gz`（内部保持 `model/` 顶层目录）

脚本为纯 Node 实现，**不需要 Python、unzip 或额外系统工具**，
支持断点重跑（文件已存在则跳过）。国内网络若下载缓慢，可手动下载 zip 放到
`assets/` 再重跑脚本。

### 打包自己的绿色版

```bash
npm run pack                    # 生成 dist/飓风提词器-桌面版-win64.zip
node scripts/make-patch.js      # 生成 dist/patch-vX.Y.Z.zip 与 dist/latest.json
node scripts/test-update.js     # 更新链路端到端回归测试（10 项）
```

**macOS 包（含 DMG）必须在 macOS 上构建**（原因见「平台支持」）。仓库已配置
GitHub Actions：`Actions → Build macOS → Run workflow` 会为每个架构产出 `.dmg`
与 `.zip` 两个 Artifact，并在挂载 DMG 后自检快捷方式、符号链接、可执行位与代码文件。
Mac 本机可：

```bash
npm install && npm run setup
npm run pack:mac                # Apple 芯片 → dist/FloatingTeleprompter-mac-arm64.zip
bash scripts/make-dmg.sh arm64  #            → dist/FloatingTeleprompter-mac-arm64.dmg
npm run pack:mac-intel          # Intel      → dist/FloatingTeleprompter-mac-x64.zip
bash scripts/make-dmg.sh x64    #            → dist/FloatingTeleprompter-mac-x64.dmg
```

构建产物中会自动附带 `LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、
`third_party/` 与 `使用说明.txt`，请一并分发、不要删除。

**发版顺序有硬性要求**：`latest.json` 里写死了 DMG 的 SHA-256。必须先跑完 CI、
把 Artifact 下载到 `dist/`，再运行 `node scripts/make-patch.js --min-version <上一版>`
生成补丁与清单，最后把 `.dmg`、`patch-vX.Y.Z.zip`、`latest.json` 与 Windows 完整包
**一次性**上传到同一个 Release。CI 不会在 Release 发布后重新构建并覆盖附件——
两次构建出的 DMG 不是同一份，覆盖会让哈希校验失效。

`latest.json` 是应用读取的版本清单，里面含补丁的 URL、大小与 SHA-256，
并用 `fullByPlatform` 按「平台-架构」登记完整包（macOS 指向 DMG）；补丁是
**全量代码快照**（不含运行时与模型），所以停在任意旧版本的用户都能一步升到最新。

## 使用要点

**悬浮透明怎么调**：进提词窗 → 底部控制条拖「背景」滑块。
建议先调窄窗口、拖到摄像头下方，背景设 30%–60%，再开启鼠标穿透；
追求「文字浮在画面上」时把背景调到 0。

**语音跟读**：切到「语音跟读」模式并允许麦克风。首次会加载约 66MB 模型，
需要几秒到几十秒，之后走缓存；若模型或麦克风不可用会自动退回定速滚动。
音频只在本机 WebAssembly 中处理，不离开设备。

### 快捷键

提词窗聚焦时：

| 键 | 作用 | 键 | 作用 |
| --- | --- | --- | --- |
| `空格` | 播放 / 暂停 | `←` `→` | 微调一个字 |
| `↑` `↓` | 上下移动 | `PageUp` `PageDown` | 大幅跳转 |
| `R` | 回到开头 | `T` | 鼠标穿透开关 |
| `O` | 置顶开关 | `M` | 镜像模式 |
| `F` | 铺满屏幕 | `+` `-` | 字号 |
| `[` `]` | 语速 | `Esc` | 返回稿件管理 |

全局快捷键（在任何软件中都生效，可在设置中关闭）：

- **Windows**：`Ctrl+Alt+空格` 播放暂停 · `Ctrl+Alt+↑/↓` 微调 · `Ctrl+Alt+R` 回到开头 ·
  `Ctrl+Alt+P` 穿透 · `Ctrl+Alt+T` 显示 / 隐藏提词窗。
- **macOS**：`⌥⇧空格` 播放暂停 · `⌥⇧↑/↓` 微调 · `⌥⇧R` 回到开头 ·
  `⌥⇧P` 穿透 · `⌥⇧T` 显示 / 隐藏提词窗。刻意不用 `⌘⌥`，避免与 Spotlight
  和系统快捷键冲突；`⌘Q` 退出程序，关闭主窗口只隐藏、菜单栏图标仍在。

## 目录结构

```
main.js                 主进程：透明窗口、置顶、穿透、托盘、本地存储与 IPC
preload.js              安全的 IPC 桥接
updater.js              应用内增量更新：版本检查、下载校验、备份、回滚、重启
src/
  index.html            稿件管理窗
  manager.css / .js
  prompt.html           提词悬浮窗
  prompt.css / .js      三模式滚动、显示设置、语音对齐
  asr.js                离线语音识别封装（文本对齐驱动滚动）
  common.js             共享工具与本地存储
  ai-optimize.js        本地规则版正文优化
scripts/
  setup.mjs             一键生成 vendor/ 与语音模型归档（纯 Node）
  make-mac-assets.js    生成 macOS 的 icon.icns 与菜单栏 Template 图标
  pack.js               打包 Windows / macOS 绿色版
  make-patch.js         生成增量补丁与 latest.json 版本清单
  test-update.js        更新链路端到端回归测试
.github/workflows/
  build-macos.yml       在 macOS runner 上构建 arm64 / x64 并校验产物
assets/                  Windows / macOS 图标（模型归档由 setup 生成，不入库）
third_party/             上游许可证全文
docs/screenshots/        界面预览图
```

## 许可、致谢与再分发

软件内的「关于 · 致谢」页同样载有完整致谢与非官方声明，托盘菜单也可随时打开：

![关于与致谢](docs/screenshots/about.png)

- 本项目自身代码：[LICENSE](./LICENSE) —— **MIT 基础条款 + 免费使用附加条款**：
  软件本体永久免费，禁止出售、强制收费、广告、付费墙与商业产品交付；
  **明确允许自愿、非强制的赞助与打赏**（赞助不构成购买、不影响任何功能、
  不授予额外权利）。再分发必须保持免费并保留全部署名。
  注意它不是标准 MIT，没有 SPDX 标识符。
- 原作权利、非官方声明、对影视飓风的致谢：[NOTICE.md](./NOTICE.md)
- 第三方组件与上游许可证：[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

> 关于「影视飓风的开源协议」：经核查，官方**并未发布过正式开源许可证**，
> 公开渠道可确认的是「完全免费」与「可一键领取同款并自行修改源码」。
> 本项目因此选择以永久免费 + 禁止商业化滥用（允许自愿赞助）+ 显著署名 +
> 不使用原版代码的方式尊重原作意愿，详见 NOTICE.md 第三节。

## 支持这个项目

软件本体永久免费、无广告、无付费墙，**赞助与否不会带来任何功能差别**。
如果你觉得它有用，欢迎**自愿、非强制**地支持后续维护；赞助不构成购买，
不授予任何额外权利，详见 `LICENSE` 第 2 条。

> 收款 / 赞助入口筹备中，公布前不会放置任何二维码或收款链接。
> 在那之前，给仓库点个 ⭐ Star、提个 Issue 或 PR，就是很实在的支持。

## 更新日志

**v1.0.3**（2026-11-08）—— macOS 正式发布与 DMG 拖拽安装

- 主进程适配 macOS：系统应用菜单（否则会显示「Electron」且 `⌘Q` 无效）、
  Template 菜单栏图标、`⌥⇧` 全局快捷键、`.app` 同级数据目录与不可写回退、
  关闭主窗口只隐藏，以及关闭 `forward` 让穿透命中判定与 Windows 走同一套轮询。
- `Info.plist` 补 `NSMicrophoneUsageDescription`，避免语音跟读申请权限时被系统终止。
- 新增 `scripts/make-mac-assets.js` 生成 `.icns` 与菜单栏图标；`pack.js` 支持
  `--platform/--arch`、macOS 专属构建参数与 `zip -y`（保留符号链接和可执行位）。
- 新增 `.github/workflows/build-macos.yml`，在 macOS runner 上构建并挂载校验；
  `latest.json` 增加 `fullByPlatform`（macOS 指向 DMG），不会再给 Mac 用户推 Windows 包。
- 新增 `scripts/make-dmg.sh`：从已校验的 zip 生成带 Applications 快捷方式的 DMG，
  重新挂载自检符号链接、可执行位与代码文件。CI 改为只产 Artifact、不再于 Release
  发布后覆盖附件，保证 `latest.json` 的 SHA-256 与线上文件是同一份。
- 随包说明改为「先拖进 Applications 再用」，明确 DMG 只读、不能在挂载盘内直接运行。
- 验证：更新链路回归 12/12 通过；Windows 完整包重打自检通过；
  arm64 / x64 DMG 均由 macOS runner 挂载校验。

**v1.0.2**（2026-11-07）—— 应用内增量更新

- 新增应用内更新：顶栏「检查更新」/ 状态栏版本号可手动检查，启动时自动检查一次
  （可关闭）；发现新版本时显示红点、版本说明与补丁体积。
- 增量补丁只含程序代码（约 2 MB），一键下载并重启即完成升级，不必反复下载
  150 MB 完整包；`data/` 稿件与设置、语音模型、Electron 运行时均不改动。
- 安全设计：版本清单与补丁整包 + 逐文件 SHA-256 校验、下载域名白名单、
  写入路径白名单、安装前备份到 `data/backups/`、写入失败自动回滚。
- 自检固化：`--selftest` 合并更新器本地回归项；新增 `scripts/test-update.js`
  覆盖 zip 往返、版本门槛、篡改拦截、路径越界、备份、用户数据零改动与失败回滚共 9 项
  （macOS 适配后追加「完整包按平台分发」共 10 项）。
- 新增 `scripts/make-patch.js`，发版时生成 `patch-vX.Y.Z.zip` 与 `latest.json`。

**v1.0.1**（2026-11-07）—— 交互修复

- 修复开启鼠标穿透时，提词设置面板只有顶部 / 底部两条带可点，导致右上角关闭按钮（×）
  **只有一小块位置能点、其余位置点不动**的问题。命中判定改为由界面上报真实控件矩形，
  整窗高的设置 / 调试浮层都会完整纳入可交互区；同时放大按钮热区、显式声明
  `-webkit-app-region: no-drag`，轮询间隔从 110ms 缩到 40ms。
- 自检新增回归验证：关闭按钮矩形内 9 个采样点必须全部命中按钮且判为可交互。

**v1.0.0** —— 首个开源版本。

## 参与

欢迎提交 Issue 与 Pull Request。提交前请确保：

- 不引入任何强制收费、广告、付费墙、遥测或联网上传逻辑
  （自愿、非强制且与功能无关的赞助入口除外）
- 不引入原版的源代码、素材或商标文件
- 保留并随分发附带 `LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`
- `node --check` 通过，`npm start` 可正常启动
