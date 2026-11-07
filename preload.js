const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = new Set([
  'store:changed',
  'prompt:load', 'prompt:content', 'prompt:opacity', 'prompt:click-through', 'prompt:hover-ui',
  'hotkey:toggle-play', 'hotkey:nudge-up', 'hotkey:nudge-down',
  'hotkey:restart', 'hotkey:toggle-through',
  'app:show-about'
]);

contextBridge.exposeInMainWorld('api', {
  /* 数据 */
  getStore: () => ipcRenderer.invoke('store:get'),
  saveArticles: (articles) => ipcRenderer.invoke('store:save-articles', articles),
  saveSettings: (patch) => ipcRenderer.invoke('store:save-settings', patch),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  /* 窗口 */
  openPrompt: (id) => ipcRenderer.invoke('prompt:open', id),
  closePrompt: () => ipcRenderer.invoke('prompt:close'),
  hidePrompt: () => ipcRenderer.invoke('prompt:hide'),
  openManager: () => ipcRenderer.invoke('win:open-manager'),
  setClickThrough: (on) => ipcRenderer.invoke('prompt:set-click-through', on),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('prompt:set-ignore-mouse', ignore),
  setUIRegions: (regions) => ipcRenderer.invoke('prompt:set-ui-regions', regions),
  hitProbe: (points) => ipcRenderer.invoke('selftest:hit-probe', points),
  toggleMaximize: () => ipcRenderer.invoke('prompt:toggle-maximize'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  maximize: () => ipcRenderer.invoke('win:maximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),

  /* 事件 */
  on: (channel, callback) => {
    if (!ALLOWED_CHANNELS.has(channel)) return () => {};
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /* 调试 / 自检 */
  log: (...args) => ipcRenderer.send('log', ...args),
  selftestResult: (result) => ipcRenderer.send('selftest:result', result)
});
