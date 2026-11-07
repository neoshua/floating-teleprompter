/* 共享工具：状态、文本规范化、DOM 助手 */
(function (global) {
  'use strict';

  const api = global.api;

  const Store = {
    data: null,
    async init() {
      this.data = await api.getStore();
      return this.data;
    },
    get articles() { return this.data.articles || []; },
    get settings() { return this.data.settings || {}; },
    async saveArticles(articles) {
      this.data.articles = articles;
      await api.saveArticles(articles);
    },
    async saveSettings(patch) {
      Object.assign(this.data.settings, patch);
      await api.saveSettings(patch);
    },
    bind(onChange) {
      api.on('store:changed', (data) => {
        this.data = data;
        if (onChange) onChange(data);
      });
    }
  };

  function uid() {
    return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(ts) {
    const d = new Date(ts || Date.now());
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  }

  const PUNCT = /[\s，。！？；：、,.!?;:~～…—\-–_"'“”‘’()（）\[\]【】{}<>《》/\\|@#$%^&*+=`\t\r\n]/;

  /**
   * 把稿件规范化为可比对的字符序列。
   * 返回 { chars: string[], map: number[] }，map[i] 是第 i 个有效字符在原文中的下标。
   * 中文/字母/数字计入；标点与空白不计，便于与语音识别结果对齐。
   */
  function normalize(text) {
    const chars = [], map = [];
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (PUNCT.test(c)) continue;
      chars.push(c.toLowerCase());
      map.push(i);
    }
    return { chars, map };
  }

  /** 语音识别结果 → 纯汉字/字母数字串 */
  function heardToChars(text) {
    return normalize(text).chars;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  global.TP = { api, Store, uid, escapeHtml, fmtDate, normalize, heardToChars, clamp, debounce, qs, qsa };
})(window);
