/**
 * 飓风提词器 桌面版 —— 主进程
 * 双窗口：管理窗（稿件/编辑） + 提词窗（无边框、真透明、置顶、可穿透）
 */
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen,
        session, nativeImage, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { createUpdater } = require('./updater');

const ROOT = __dirname;
const IS_MAC = process.platform === 'darwin';
const IS_SELFTEST = process.argv.includes('--selftest');
const ICON_PATH = path.join(ROOT, 'assets', IS_MAC ? 'icon.icns' : 'icon.ico');
const TRAY_ICON_PATH = path.join(ROOT, 'assets', IS_MAC ? 'trayTemplate.png' : 'icon.ico');
// Windows 版已验证 forward:true；macOS 上关掉 forward，让两个平台都走
// 完全相同的「主进程轮询系统光标 → 恢复交互」逻辑，避开平台实现差异。
const MOUSE_FORWARD = !IS_MAC;
// macOS 上 ⌘⌥Space / ⌘⌥↑ 常被 Spotlight、输入法和系统快捷键占用，
// 改用 ⌥⇧ 前缀；Windows 保持 Ctrl+Alt 不变。
const HOTKEY_PREFIX = IS_MAC ? 'Alt+Shift' : 'CommandOrControl+Alt';

let managerWin = null;
let promptWin = null;
let tray = null;
let serverPort = 0;
let clickThrough = false;
let promptHiddenByUser = false;
let updater = null;

/* ---------------------------------------------------------------- 数据存储 */
// 绿色版：数据放在 exe 同级 data/，随目录一起拷走；不可写时回退到 userData
function resolveDataDir() {
  // macOS 的 .app 包内不可写（写进去会破坏签名，且可能以只读方式挂载），
  // 因此绿色版数据目录放在 .app 同级；不可写时回退到 ~/Library/Application Support。
  const candidates = [];
  if (!app.isPackaged) {
    candidates.push(path.join(ROOT, 'data'));
  } else if (IS_MAC) {
    const exeDir = path.dirname(app.getPath('exe')); // .../名字.app/Contents/MacOS
    candidates.push(path.resolve(exeDir, '..', '..', '..', 'data'));
  } else {
    candidates.push(path.join(path.dirname(app.getPath('exe')), 'data'));
  }
  candidates.push(path.join(app.getPath('userData'), 'data'));
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.writable');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      return dir;
    } catch (_) { /* 换下一个候选目录 */ }
  }
  return path.join(app.getPath('userData'), 'data');
}
let DATA_DIR = null;
let STORE_PATH = null;

const DEFAULT_SETTINGS = {
  fontSize: 60,
  lineHeight: 1.5,
  margin: 5,
  mirror: false,
  autoFit: true,
  mode: 'timed',          // timed | manual | voice
  speed: 4.2,             // 字/秒
  opacity: 86,            // 提词窗背景不透明度，百分制（0 = 完全透出桌面）
  alwaysOnTop: true,
  showReadingArea: true,
  textColor: '#ffffff',
  globalHotkeys: true
};

function demoArticles() {
  const now = Date.now();
  return [
    {
      id: 'demo-welcome', title: '使用说明 · 先读我',
      content: '欢迎使用飓风提词器桌面版。\n\n这是一个可以悬浮在任意软件上方的提词窗口：把窗口拖到摄像头附近，调低背景不透明度，就能一边看镜头一边看词。\n\n点击首页的「开始提词」进入提词窗。空格键播放或暂停，上下方向键微调位置，按 T 切换鼠标穿透，按 O 切换置顶，按 Esc 回到首页。\n\n底部控制条可以切换三种模式：定速滚动、手动滚动、以及语音跟读。语音跟读使用内置的离线中文模型，不需要联网，也不需要登录。\n\n右侧设置里可以调整字号、行距、左右边距、镜像模式和背景透明度。镜像模式用于分光镜反射式提词器硬件。\n\n稿件全部保存在软件目录的 data 文件夹里，拷贝整个文件夹即可换一台电脑继续使用。',
      createdAt: now - 3000, updatedAt: now - 3000
    },
    {
      id: 'demo-coffee', title: '直播带货 · 咖啡豆',
      content: '想喝一杯好咖啡，真的不需要那么复杂，也不必非得出门排队。其实最好的咖啡馆，就在你自家的厨房里。\n\n很多朋友刚开始尝试手冲，或者家用法压壶的时候，总觉得自己冲出来的味道不对。要么太淡像水，要么苦得难以下咽。这往往不是你的冲煮参数有问题，而是咖啡豆的鲜活度流失了。\n\n咖啡豆本质上是一种生鲜农产品，它的香气灵魂，就在于烘焙后的那段黄金赏味期。\n\n你看我手里这款豆子，严选海拔一千二百米以上的精品庄园豆，每一颗都经过严格的人工手选，剔除了那些影响味道的瑕疵豆。\n\n我们采用的是精准的中深烘焙工艺。这种烘焙度能最大程度激发豆子本身的坚果与焦糖风味。当你撕开单向排气阀的那一瞬间，那种高级的油脂香和淡淡的黑巧克力味，会扑面而来。\n\n入口的质感非常厚实，就像喝了一口融化的丝绒。回甘里带着木质调的稳重，和奶油般的顺滑。\n\n现在下单，除了家庭装优惠，还会附赠一份冲煮参数建议卡。哪怕你是零基础的新手，也能在家轻松还原出专业级的风味。',
      createdAt: now - 2000, updatedAt: now - 2000
    },
    {
      id: 'demo-opening', title: '开业致辞',
      content: '各位嘉宾，亲爱的朋友们，大家中午好！\n\n今天是我们火锅店正式开张的大喜日子。看着高朋满座、烟火气升腾，我心里充满了感激。\n\n火锅讲究的就是一个团圆红火。我们开这家店的初衷很简单，就是想用最正宗的底料、最鲜活的食材，为大家伙提供一个踏实涮肉、痛快喝酒的好地方。\n\n咱们家的每一片毛肚、每一块牛肉都是精挑细选，绝不含糊。为的就是让每一位食客，都能感受到这份实实在在的诚意。\n\n开业初期，如果有招待不周的地方，还请大家多多包涵。您的每一条建议，都是我们进步的动力。\n\n话不多说，所有的情谊都在这滚烫的锅底里。祝愿大家今天吃得舒心、聊得开心，往后的日子也像这火锅一样，红红火火、热气腾腾。\n\n现在我宣布，正式开席！',
      createdAt: now - 1000, updatedAt: now - 1000
    }
  ];
}

function freshStore() {
  return { version: 1, articles: demoArticles(), settings: { ...DEFAULT_SETTINGS } };
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    // 兼容早期误写入的小数形式（0.86 → 86）
    if (settings.opacity > 0 && settings.opacity <= 1) settings.opacity = Math.round(settings.opacity * 100);
    return {
      version: 1,
      articles: Array.isArray(raw.articles) ? raw.articles : [],
      settings
    };
  } catch (_) {
    const s = freshStore();
    writeStore(s);
    return s;
  }
}

let writeTimer = null;
function writeStore(data) {
  // 合并写入，避免短时间多次 IO
  clearTimeout(writeTimer);
  const snapshot = JSON.stringify(data, null, 2);
  writeTimer = setTimeout(() => {
    try {
      const tmp = STORE_PATH + '.tmp';
      fs.writeFileSync(tmp, snapshot, 'utf8');
      fs.renameSync(tmp, STORE_PATH);
    } catch (e) { console.error('[store] write failed', e); }
  }, 60);
  return data;
}

let STORE = null;
function broadcast(channel, payload) {
  for (const w of [managerWin, promptWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/* --------------------------------------------------- 本地静态服务器（供 wasm / 模型加载） */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.tar': 'application/x-tar',
  '.fst': 'application/octet-stream', '.mdl': 'application/octet-stream',
  '.conf': 'text/plain; charset=utf-8', '.int': 'application/octet-stream',
  '.stats': 'application/octet-stream', '.dubm': 'application/octet-stream',
  '.ie': 'application/octet-stream', '.mat': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8', '': 'application/octet-stream'
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (_) { res.writeHead(400); return res.end('bad request'); }
      if (pathname === '/') pathname = '/src/index.html';
      const filePath = path.normalize(path.join(ROOT, pathname));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(filePath).toLowerCase();
        const headers = {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        };
        // 大模型文件可能被 Range 请求
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          const start = m && m[1] ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
          if (start >= stat.size) { res.writeHead(416); return res.end(); }
          headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
          headers['Content-Length'] = end - start + 1;
          res.writeHead(206, headers);
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
      });
    });
    // 固定端口可让 wasm 的 IndexedDB 模型缓存跨次启动复用（第二次启动秒开）；
    // 端口被占用时退回随机端口，不影响多开。
    const PREFERRED_PORT = 18763;
    const onListen = () => resolve({ server, port: server.address().port });
    const onError = (err) => {
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE') {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', onListen);
      } else reject(err);
    };
    server.once('error', onError);
    // 只绑定回环地址，外部无法访问
    server.listen(PREFERRED_PORT, '127.0.0.1', onListen);
  });
}

/* ---------------------------------------------------------------- 窗口 */
const WEB_PREFS = {
  preload: path.join(ROOT, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  spellcheck: false,
  backgroundThrottling: false
};

function createManager() {
  const win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 940, minHeight: 620,
    frame: false, backgroundColor: '#0c0c0e', show: false,
    title: '飓风提词器',
    icon: ICON_PATH,
    webPreferences: WEB_PREFS
  });
  win.loadURL(`http://127.0.0.1:${serverPort}/src/index.html?role=manager`);
  win.once('ready-to-show', () => { if (!IS_SELFTEST) win.show(); });
  // 透明 / 无边框窗口偶尔不触发 ready-to-show，兜底显示
  if (!IS_SELFTEST) setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 1500);
  win.on('closed', () => { managerWin = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

function createPrompt() {
  const bounds = screen.getPrimaryDisplay().workArea;
  const w = Math.min(1040, Math.round(bounds.width * 0.8));
  const h = Math.min(460, Math.round(bounds.height * 0.5));
  const win = new BrowserWindow({
    width: w, height: h, minWidth: 460, minHeight: 220,
    x: Math.round(bounds.x + (bounds.width - w) / 2),
    y: Math.round(bounds.y + Math.min(110, bounds.height * 0.12)),
    frame: false,
    transparent: true,             // 关键：真透明窗口
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: STORE.settings.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    title: '提词窗口',
    icon: ICON_PATH,
    webPreferences: WEB_PREFS
  });
  win.setAlwaysOnTop(STORE.settings.alwaysOnTop, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(`http://127.0.0.1:${serverPort}/src/prompt.html?role=prompt${IS_SELFTEST ? '&selftest=1' : ''}`);
  win.once('ready-to-show', () => { if (!IS_SELFTEST) { win.show(); win.focus(); } });
  if (!IS_SELFTEST) setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 1500);
  win.on('closed', () => {
    promptWin = null; clickThrough = false; uiRegions = [];
    stopHoverWatcher(); unregisterHotkeys();
  });
  return win;
}

function openPrompt(articleId) {
  if (!promptWin || promptWin.isDestroyed()) promptWin = createPrompt();
  else { promptWin.show(); promptWin.focus(); }
  promptHiddenByUser = false;
  const article = STORE.articles.find(a => a.id === articleId) || STORE.articles[0] || null;
  const send = () => {
    if (promptWin && !promptWin.isDestroyed())
      promptWin.webContents.send('prompt:load', { article, store: STORE });
  };
  if (promptWin.webContents.isLoading()) promptWin.webContents.once('did-finish-load', send);
  else send();
  registerHotkeys();
  return true;
}

function setClickThrough(on) {
  clickThrough = !!on;
  lastIgnore = null;
  if (promptWin && !promptWin.isDestroyed()) {
    // 交互恢复一律交给下面的主进程光标轮询，两个平台行为一致
    promptWin.setIgnoreMouseEvents(clickThrough, { forward: MOUSE_FORWARD });
    lastIgnore = clickThrough;
    promptWin.webContents.send('prompt:click-through', clickThrough);
  }
  if (clickThrough) { startHoverWatcher(); refreshHover(); }
  else stopHoverWatcher();
  return clickThrough;
}

/* 开启穿透后窗口不再收到 mousemove，主进程直接轮询系统光标位置。
   Windows 与 macOS 都走这套逻辑，不依赖平台差异较大的 forward 行为。
   可交互区域由渲染层上报真实控件矩形
   （顶栏 / 底栏 / 打开的设置或调试浮层），避免用硬编码条带漏判：
   旧逻辑只认顶部 46px 和底部 88px，导致整窗高的设置面板里
   只有这两条带能点，关闭按钮横跨 46px 边界就出现「半截点不动」。 */
let hoverTimer = null;
let uiRegions = [];
let lastIgnore = null;
const HIT_PAD = 8;   // 命中容差，吸收窗口边框 / 缩放 / 圆角带来的偏差

function fallbackRegions(b) {
  return [
    { x: 0, y: 0, w: b.width, h: 46 },
    { x: 0, y: b.height - 88, w: b.width, h: 88 }
  ];
}
function activeRegions(b) {
  return uiRegions.length ? uiRegions : fallbackRegions(b);
}
function inRegions(x, y, b) {
  return activeRegions(b).some(r =>
    x >= r.x - HIT_PAD && x <= r.x + r.w + HIT_PAD &&
    y >= r.y - HIT_PAD && y <= r.y + r.h + HIT_PAD);
}
function applyIgnore(ignore, force) {
  if (!promptWin || promptWin.isDestroyed()) return;
  ignore = !!ignore;
  if (!force && lastIgnore === ignore) return;
  lastIgnore = ignore;
  promptWin.setIgnoreMouseEvents(ignore, { forward: MOUSE_FORWARD });
  promptWin.webContents.send('prompt:hover-ui', !ignore);
}
function refreshHover(force) {
  if (!clickThrough || !promptWin || promptWin.isDestroyed() || !promptWin.isVisible()) return;
  try {
    const p = screen.getCursorScreenPoint();
    const b = promptWin.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    const inside = x >= 0 && x <= b.width && y >= 0 && y <= b.height;
    applyIgnore(!(inside && inRegions(x, y, b)), force);
  } catch (_) {}
}
function startHoverWatcher() {
  stopHoverWatcher();
  lastIgnore = null;
  hoverTimer = setInterval(() => refreshHover(), 40);
}
function stopHoverWatcher() {
  if (hoverTimer) { clearInterval(hoverTimer); hoverTimer = null; }
  lastIgnore = null;
  try {
    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.setIgnoreMouseEvents(false);
      promptWin.webContents.send('prompt:hover-ui', true);
    }
  } catch (_) {}
}

/* ---------------------------------------------------------------- 全局快捷键 */
let hotkeysOn = false;
const HOTKEY_MAP = [
  ['Space', 'hotkey:toggle-play'],
  ['Up', 'hotkey:nudge-up'],
  ['Down', 'hotkey:nudge-down'],
  ['R', 'hotkey:restart'],
  ['P', 'hotkey:toggle-through']
].map(([key, channel]) => [`${HOTKEY_PREFIX}+${key}`, channel]);

function registerHotkeys() {
  if (hotkeysOn || !STORE.settings.globalHotkeys) return;
  let ok = true;
  for (const [accel, channel] of HOTKEY_MAP) {
    try {
      const registered = globalShortcut.register(accel, () => {
        if (promptWin && !promptWin.isDestroyed()) promptWin.webContents.send(channel);
      });
      if (!registered) ok = false;
    } catch (_) { ok = false; }
  }
  try {
    globalShortcut.register(`${HOTKEY_PREFIX}+T`, () => {
      if (!promptWin || promptWin.isDestroyed()) return;
      if (promptWin.isVisible()) { promptWin.hide(); promptHiddenByUser = true; }
      else { promptWin.show(); promptHiddenByUser = false; }
    });
  } catch (_) {}
  hotkeysOn = ok;
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
  hotkeysOn = false;
}

/* ---------------------------------------------------------------- 托盘 */
function sendToManager(channel) {
  if (!managerWin || managerWin.isDestroyed()) managerWin = createManager();
  managerWin.show();
  managerWin.focus();
  const send = () => {
    if (managerWin && !managerWin.isDestroyed()) managerWin.webContents.send(channel);
  };
  if (managerWin.webContents.isLoading()) {
    managerWin.webContents.once('did-finish-load', () => setTimeout(send, 150));
  } else setTimeout(send, 60);
}

function showAbout() { sendToManager('app:show-about'); }
function showUpdateDialog() { sendToManager('app:show-update'); }

function createTray() {
  if (!fs.existsSync(TRAY_ICON_PATH)) return;
  let img = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (img.isEmpty()) return;
  if (IS_MAC) {
    // 菜单栏图标必须是 Template：纯黑形状 + alpha，由系统按明暗自动着色。
    // 同目录的 trayTemplate@2x.png 会被 Electron 自动识别为 Retina 版本。
    img.setTemplateImage(true);
    tray = new Tray(img);
  } else {
    tray = new Tray(img.resize({ width: 16, height: 16 }));
  }
  tray.setToolTip('飓风提词器 桌面版');
  const menu = Menu.buildFromTemplate([
    { label: '打开稿件管理', click: () => { if (managerWin) { managerWin.show(); managerWin.focus(); } else managerWin = createManager(); } },
    { label: '显示 / 隐藏提词窗', click: () => {
        if (!promptWin || promptWin.isDestroyed()) return;
        if (promptWin.isVisible()) { promptWin.hide(); promptHiddenByUser = true; }
        else { promptWin.show(); promptHiddenByUser = false; }
      } },
    { label: '鼠标穿透 开 / 关', click: () => setClickThrough(!clickThrough) },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(DATA_DIR) },
    { label: '关于与致谢', click: () => showAbout() },
    { label: '检查更新…', click: () => showUpdateDialog() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (managerWin) { managerWin.show(); managerWin.focus(); } });
}

/* ---------------------------------------------------------------- IPC */
function bindIpc() {
  ipcMain.handle('store:get', () => STORE);
  ipcMain.handle('store:save-articles', (_e, articles) => {
    STORE.articles = articles;
    broadcast('store:changed', STORE);
    return writeStore(STORE);
  });
  ipcMain.handle('store:save-settings', (_e, patch) => {
    STORE.settings = { ...STORE.settings, ...patch };
    if (promptWin && !promptWin.isDestroyed()) {
      promptWin.setAlwaysOnTop(STORE.settings.alwaysOnTop, 'screen-saver');
    }
    if (patch.globalHotkeys !== undefined) {
      unregisterHotkeys();
      if (patch.globalHotkeys) registerHotkeys();
    }
    broadcast('store:changed', STORE);
    return writeStore(STORE);
  });

  ipcMain.handle('prompt:open', (_e, id) => openPrompt(id));
  ipcMain.handle('prompt:close', () => {
    clickThrough = false;
    stopHoverWatcher();
    if (promptWin && !promptWin.isDestroyed()) promptWin.close();
    promptWin = null;
    unregisterHotkeys();
    return true;
  });
  ipcMain.handle('prompt:hide', () => { if (promptWin && !promptWin.isDestroyed()) promptWin.hide(); return true; });
  ipcMain.handle('prompt:request-article', () => {
    const active = promptWin && promptWin.webContents;
    return STORE;
  });
  ipcMain.handle('prompt:set-click-through', (_e, on) => setClickThrough(on));
  ipcMain.handle('prompt:set-ignore-mouse', (_e, ignore) => {
    // 与轮询共用 lastIgnore，避免渲染层调用后轮询状态不同步而把穿透偷偷打开
    if (promptWin && !promptWin.isDestroyed()) {
      const v = !!ignore && clickThrough;
      promptWin.setIgnoreMouseEvents(v, { forward: MOUSE_FORWARD });
      lastIgnore = v;
    }
    return true;
  });
  // 渲染层上报真实可交互矩形；收到后立即重算一次，不必等下一帧
  ipcMain.handle('prompt:set-ui-regions', (_e, regions) => {
    uiRegions = Array.isArray(regions)
      ? regions.filter(r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0).slice(0, 16)
      : [];
    refreshHover();
    return uiRegions.length;
  });
  // 自检用：给定窗口内坐标，返回穿透状态下是否会被判为可交互
  ipcMain.handle('selftest:hit-probe', (_e, points) => {
    if (!IS_SELFTEST || !promptWin || promptWin.isDestroyed()) return [];
    const b = promptWin.getBounds();
    return (Array.isArray(points) ? points : []).map(pt => ({
      x: pt.x, y: pt.y, interactive: inRegions(Number(pt.x), Number(pt.y), b)
    }));
  });
  ipcMain.handle('prompt:set-opacity', (_e, v) => {
    if (promptWin && !promptWin.isDestroyed()) promptWin.webContents.send('prompt:opacity', v);
    return true;
  });
  ipcMain.handle('prompt:reload-article', (_e, content) => {
    if (promptWin && !promptWin.isDestroyed()) promptWin.webContents.send('prompt:content', content);
    return true;
  });
  ipcMain.handle('prompt:toggle-maximize', () => {
    if (!promptWin || promptWin.isDestroyed()) return false;
    const bounds = screen.getDisplayMatching(promptWin.getBounds()).workArea;
    const maxed = promptWin.getBounds().width >= bounds.width - 4;
    if (maxed) promptWin.setBounds({ width: 1040, height: 460, x: bounds.x + 120, y: bounds.y + 80 });
    else promptWin.setBounds(bounds);
    return !maxed;
  });

  // 窗口控制（自绘标题栏）
  ipcMain.handle('win:minimize', (e) => { BrowserWindow.fromWebContents(e.sender)?.minimize(); });
  ipcMain.handle('win:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.handle('win:close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w === managerWin) {
      // macOS 习惯：关闭窗口不退出应用，保留菜单栏入口；⌘Q / 托盘「退出」才真退出
      if (IS_MAC) w.hide();
      else { app.isQuitting = true; app.quit(); }
    } else w.close();
  });
  ipcMain.handle('win:open-manager', () => {
    if (!managerWin || managerWin.isDestroyed()) managerWin = createManager();
    managerWin.show(); managerWin.focus();
  });
  ipcMain.handle('app:open-data-dir', () => shell.openPath(DATA_DIR));
  // 只允许打开白名单内的官方/项目链接，避免渲染层被滥用为任意 URL 启动器
  ipcMain.handle('app:open-external', async (_e, url) => {
    if (typeof url !== 'string') return false;
    const ALLOWED_HOSTS = new Set([
      'mcnt8r4c3f2k.aiforce.cloud', 'bytedance.larkoffice.com',
      'miaoda.feishu.cn', 'feishu.cn', 'www.ysjf.com',
      'github.com', 'alphacephei.com'
    ]);
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return false;
      await shell.openExternal(u.href);
      return true;
    } catch (_) { return false; }
  });
  ipcMain.handle('app:info', () => ({
    dataDir: DATA_DIR, modelDir: path.join(ROOT, 'assets', 'model'),
    packaged: app.isPackaged, version: app.getVersion(), port: serverPort,
    platform: process.platform, isMac: IS_MAC, hotkeyPrefix: HOTKEY_PREFIX
  }));

  /* 应用内增量更新（只替换代码，不重下 150MB 完整包） */
  ipcMain.handle('update:check', (_e, force) => updater.check(!!force));
  ipcMain.handle('update:install', (_e, info) => updater.install(info));
  ipcMain.handle('update:restart', () => { updater.restart(); return true; });
  ipcMain.handle('update:settings', () => updater.getSettings());
  ipcMain.handle('update:set-settings', (_e, patch) => updater.setSettings(patch || {}));
  ipcMain.handle('audio:permission', async () => {
    // macOS 10.14+ 需要显式申请麦克风权限（Info.plist 里已附用途说明），
    // 否则语音跟读会静默失败。音频仍只在本机 WebAssembly 中处理。
    if (IS_MAC && systemPreferences.askForMediaAccess) {
      try { return await systemPreferences.askForMediaAccess('microphone'); }
      catch (_) { return true; }
    }
    return true;
  });

  // 渲染层日志回传（自检用）
  ipcMain.on('log', (_e, ...args) => console.log('[renderer]', ...args));
  ipcMain.on('selftest:result', async (_e, result) => {
    // 主进程侧的更新器回归项（纯本地、不联网）并入交付级自检
    try {
      result.checks = result.checks || {};
      result.checks.updater = updater.selfTest();
      if (!result.checks.updater.ok) result.ok = false;
    } catch (e) {
      result.checks = result.checks || {};
      result.checks.updater = { ok: false, error: String(e) };
      result.ok = false;
    }
    try { fs.writeFileSync(path.join(DATA_DIR, 'selftest.json'), JSON.stringify(result, null, 2)); } catch (_) {}
    console.log('[selftest]', JSON.stringify(result));
    if (!IS_SELFTEST) return;
    // 自检时抓两张仅含本应用窗口的画面，用于人工确认布局（不影响正常使用）
    try {
      for (const [name, win] of [['manager', managerWin], ['prompt', promptWin]]) {
        if (!win || win.isDestroyed()) continue;
        try { win.showInactive(); } catch (_) {}
        await new Promise(r => setTimeout(r, 400));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(DATA_DIR, `preview-${name}.png`), img.toPNG());
        if (name === 'manager') {
          // 额外确认「关于与致谢」页的排版与致谢文案确实可见
          await win.webContents.executeJavaScript("document.getElementById('about').hidden=false");
          await new Promise(r => setTimeout(r, 300));
          const imgAbout = await win.webContents.capturePage();
          fs.writeFileSync(path.join(DATA_DIR, 'preview-about.png'), imgAbout.toPNG());
          await win.webContents.executeJavaScript("document.getElementById('about').hidden=true");

          // 确认更新入口、弹窗与运行时版本号确实都渲染出来了
          const ui = await win.webContents.executeJavaScript(`(() => {
            const q = id => document.getElementById(id);
            return {
              panel: !!q('update'), entry: !!q('btn-update'), action: !!q('upd-action'),
              autoToggle: !!q('upd-auto'), release: !!q('upd-release'),
              versionChip: (q('btn-version') || {}).textContent || ''
            };
          })()`);
          result.checks.updateUI = ui;
          result.checks.updateUIOk = !!(ui.panel && ui.entry && ui.action &&
            ui.autoToggle && ui.release && /^v?\d+\.\d+\.\d+$/.test(ui.versionChip.trim()));
          if (!result.checks.updateUIOk) result.ok = false;
        }
      }
    } catch (e) { console.log('[selftest] capture skipped:', e.message); }
    // 合并完主进程侧回归项后再落盘一次，保证交付自检结果完整
    try { fs.writeFileSync(path.join(DATA_DIR, 'selftest.json'), JSON.stringify(result, null, 2)); } catch (_) {}
    setTimeout(() => app.exit(0), 250);
  });
}

/* ---------------------------------------------------------------- 启动 */
async function boot() {
  DATA_DIR = resolveDataDir();
  STORE_PATH = path.join(DATA_DIR, 'store.json');
  STORE = readStore();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'clipboard-read' || permission === 'notifications');
  });
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  const { port } = await startStaticServer();
  serverPort = port;

  updater = createUpdater({
    appRoot: ROOT,
    dataDir: DATA_DIR,
    version: app.getVersion(),
    packaged: app.isPackaged,
    emit: (channel, payload) => broadcast(channel, payload),
    restart: () => { app.isQuitting = true; app.relaunch(); app.exit(0); }
  });

  if (IS_MAC) {
    // 不设置应用菜单的话 macOS 会显示默认的「Electron」菜单，连 ⌘Q 都退不出程序。
    // 本项目窗口自绘标题栏，不需要默认菜单项，给最小可用的系统菜单即可。
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
      { label: '帮助', submenu: [
        { label: '关于与致谢', click: showAbout },
        { label: '检查更新…', click: showUpdateDialog }
      ] }
    ]));
  }

  bindIpc();
  createTray();
  managerWin = createManager();

  // 启动后静默检查一次（只读 GitHub 上的公开版本清单，不上传任何数据）。
  // 可在「软件更新」里关闭；自检模式不联网，避免干扰离线验证。
  if (!IS_SELFTEST && updater.getSettings().autoCheck) {
    setTimeout(async () => {
      try { broadcast('update:state', await updater.check(false)); }
      catch (e) { console.log('[update] auto check failed:', e.message); }
    }, 3000);
  }

  if (IS_SELFTEST) {
    // 无界面自检：创建提词窗并让渲染层报告各模块可用性
    setTimeout(() => openPrompt(STORE.articles[0]?.id), 900);
    setTimeout(() => { try { app.exit(2); } catch (_) {} }, 240000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) managerWin = createManager();
  });
}

app.on('will-quit', () => unregisterHotkeys());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.whenReady().then(boot).catch(err => {
  console.error('[boot] failed', err);
  try { fs.writeFileSync(path.join(ROOT, 'boot-error.log'), String(err && err.stack || err)); } catch (_) {}
});
