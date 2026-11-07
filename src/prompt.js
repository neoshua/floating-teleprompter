(function () {
  'use strict';
  const { api, Store, clamp, qs, qsa, debounce } = window.TP;

  const S = {
    article: null, settings: null,
    norm: { chars: [], map: [] }, spans: [], lines: null, lineTops: [],
    currentIdx: 0, voiceTargetIdx: 0, currentY: 0,
    playing: false, mode: 'timed', lastTick: 0, lastUi: 0,
    asr: null, voiceToken: 0,
    heardFinal: '', heardPartial: '', heardCount: 0,
    matchScore: 0, missStreak: 0, lastMatchAt: 0,
    ownEdit: false, clickThrough: false, interactive: true,
    settingsOpen: false, debugOpen: false,
    lastHiTop: -1, drag: null, readTop: 0
  };

  const $ = (id) => document.getElementById(id);
  const app = $('app'), stage = $('stage'), scriptEl = $('script'), inner = $('script-inner');
  const MODE_LABEL = { timed: '定速滚动', manual: '手动滚动', voice: '语音跟读' };
  const IS_WIN = navigator.userAgent.includes('Windows');

  /* ------------------------------------------------------------ 文稿渲染 */
  function renderScript(keepRatio) {
    const raw = (S.article && S.article.content) || '（空白稿件，返回首页新建一篇吧）';
    const text = raw.replace(/\r/g, '');
    const oldLen = S.norm.chars.length;
    const ratio = keepRatio && oldLen > 1 ? S.currentIdx / oldLen : 0;

    const norm = window.TP.normalize(text);
    const mapSet = new Set(norm.map);
    S.norm = norm;
    S.spans = new Array(norm.chars.length);
    $('article-title').textContent = (S.article && S.article.title) || '提词窗口';

    const frag = document.createDocumentFragment();
    const lines = text.split('\n');
    let base = 0, ni = 0;
    for (const lineText of lines) {
      const p = document.createElement('p');
      if (!lineText) {
        p.className = 'para blank';
      } else {
        p.className = 'para';
        for (let j = 0; j < lineText.length; j++) {
          const i = base + j;
          const span = document.createElement('span');
          span.className = 'ch';
          span.textContent = lineText[j];
          if (mapSet.has(i)) { span.dataset.i = ni; S.spans[ni] = span; ni++; }
          p.appendChild(span);
        }
      }
      frag.appendChild(p);
      base += lineText.length + 1;
    }
    inner.replaceChildren(frag);

    // 重新计算行分组（offsetTop 依赖布局，需在下一帧读取）
    requestAnimationFrame(() => {
      buildLines();
      if (keepRatio) { S.currentIdx = ratio * Math.max(1, S.norm.chars.length - 1); S.voiceTargetIdx = S.currentIdx; }
      S.currentY = Math.max(0, topForIndex(S.currentIdx) - S.readTop);
      scriptEl.style.transform = `translate3d(0,${-S.currentY}px,0)`;
      S.lastHiTop = -1;
      updateHighlight(true);
    });
  }

  function buildLines() {
    const map = new Map();
    for (const el of S.spans) {
      if (!el) continue;
      const t = el.offsetTop;
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(el);
    }
    S.lines = map;
    S.lineTops = Array.from(map.keys()).sort((a, b) => a - b);
  }

  function charTop(i) {
    if (!S.spans.length) return 0;
    const el = S.spans[clamp(Math.floor(i), 0, S.spans.length - 1)];
    return el ? el.offsetTop : 0;
  }

  function topForIndex(idx) {
    if (!S.spans.length) return 0;
    const i0 = clamp(Math.floor(idx), 0, S.spans.length - 1);
    const a = charTop(i0);
    const b = charTop(Math.min(i0 + 1, S.spans.length - 1));
    return a + (b - a) * (idx - i0);
  }

  function updateHighlight(force) {
    if (!S.lines || !S.spans.length) return;
    const top = charTop(S.currentIdx);
    if (!force && top === S.lastHiTop) return;
    S.lastHiTop = top;
    let passed = true;
    for (const t of S.lineTops) {
      const isCur = t === top;
      const cls = isCur ? 'ch current' : (passed ? 'ch past' : 'ch');
      for (const el of S.lines.get(t)) if (el.className !== cls) el.className = cls;
      if (isCur) passed = false;
    }
  }

  /* ------------------------------------------------------------ 设置应用 */
  function effectiveFontSize() {
    const st = S.settings;
    if (st.autoFit) return clamp(Math.round(stage.clientHeight / 7.2), 24, 110);
    return st.fontSize;
  }

  function applySettings() {
    const st = S.settings;
    const root = document.documentElement.style;
    const fs = effectiveFontSize();
    S.readTop = Math.round(stage.clientHeight * 0.19);
    const readH = Math.round(fs * st.lineHeight * 2.45);

    root.setProperty('--bg-alpha', String((st.opacity ?? 86) / 100));
    root.setProperty('--ui-alpha', String(Math.max(0.42, (st.opacity ?? 86) / 100)));
    root.setProperty('--text-color', st.textColor || '#ffffff');
    root.setProperty('--font-size', fs + 'px');
    root.setProperty('--line-height', String(st.lineHeight));
    root.setProperty('--pad', st.margin + '%');
    root.setProperty('--read-top', S.readTop + 'px');
    root.setProperty('--read-height', readH + 'px');
    scriptEl.style.paddingTop = S.readTop + 'px';

    app.classList.toggle('mirror', !!st.mirror);
    app.classList.toggle('hide-reading', !st.showReadingArea);
    app.classList.toggle('no-current', S.mode === 'manual');
    $('btn-pin').classList.toggle('on', !!st.alwaysOnTop);
    $('speed').value = st.speed;
    $('speed-val').textContent = Number(st.speed).toFixed(1) + ' 字/秒';
    $('opacity').value = st.opacity;
    $('opacity-val').textContent = st.opacity + '%';

    syncSettingsUI();
    scheduleBuildLines();
  }

  let buildLinesTimer = null;
  function scheduleBuildLines() {
    clearTimeout(buildLinesTimer);
    buildLinesTimer = setTimeout(buildLines, 160);
  }

  function syncSettingsUI() {
    const st = S.settings;
    const setSwitch = (id, on) => $(id).classList.toggle('on', !!on);
    setSwitch('set-autofit', st.autoFit);
    setSwitch('set-mirror', st.mirror);
    setSwitch('set-reading', st.showReadingArea);
    setSwitch('set-hotkeys', st.globalHotkeys);
    $('set-font').value = st.fontSize; $('set-font-val').textContent = st.fontSize + 'px';
    $('set-line').value = st.lineHeight; $('set-line-val').textContent = Number(st.lineHeight).toFixed(1);
    $('set-margin').value = st.margin; $('set-margin-val').textContent = st.margin + '%';
    $('set-opacity').value = st.opacity; $('set-opacity-val').textContent = st.opacity + '%';
    qsa('#colors button').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === (st.textColor || '').toLowerCase()));
    if (document.activeElement !== $('set-content') && S.article)
      $('set-content').value = S.article.content || '';
    markChips();
  }

  function markChips() {
    const st = S.settings;
    qsa('#font-chips button').forEach(b => b.classList.toggle('on', parseInt(b.textContent, 10) === Number(st.fontSize)));
    qsa('#line-chips button').forEach(b => b.classList.toggle('on', Number(b.textContent) === Number(st.lineHeight)));
    qsa('#margin-chips button').forEach(b => b.classList.toggle('on', parseInt(b.textContent, 10) === Number(st.margin)));
  }

  function saveSettings(patch) {
    Object.assign(S.settings, patch);
    applySettings();
    return Store.saveSettings(patch);
  }

  /* ------------------------------------------------------------ 播放循环 */
  function tick(now) {
    const dt = S.lastTick ? Math.min(0.08, (now - S.lastTick) / 1000) : 0;
    S.lastTick = now;
    const len = S.norm.chars.length;

    if (S.playing && len > 1) {
      if (S.mode === 'timed') S.currentIdx += S.settings.speed * dt;
      else if (S.mode === 'voice') S.currentIdx += (S.voiceTargetIdx - S.currentIdx) * Math.min(1, dt * 3.4);
    }
    S.currentIdx = clamp(S.currentIdx, 0, Math.max(0, len - 1));

    const target = Math.max(0, topForIndex(S.currentIdx) - S.readTop);
    S.currentY += (target - S.currentY) * Math.min(1, dt * 8);
    scriptEl.style.transform = `translate3d(0,${-S.currentY.toFixed(2)}px,0)`;
    updateHighlight(false);

    if (now - S.lastUi > 110) { S.lastUi = now; updateStat(); }
    requestAnimationFrame(tick);
  }

  function updateStat() {
    const len = S.norm.chars.length || 1;
    const pct = Math.round(S.currentIdx / len * 100);
    $('stat').textContent = `总字数 ${S.norm.chars.length} · 进度 ${pct}%`;
    $('dbg-pos').textContent = `${Math.round(S.currentIdx)} / ${S.norm.chars.length}`;
    $('dbg-cps').textContent = Number(S.settings.speed).toFixed(2);
  }

  function setPlaying(on) {
    if (S.mode === 'manual' && on) { toast('手动模式：用滚轮、拖拽或 ← → 控制'); return; }
    S.playing = on;
    $('btn-play').textContent = on ? '❚❚' : '▶';
    if (S.mode === 'voice') { on ? startVoice() : stopVoice(); }
  }

  function togglePlay() { setPlaying(!S.playing); }

  function restart() {
    S.currentIdx = 0; S.voiceTargetIdx = 0; S.currentY = 0;
    S.heardFinal = ''; S.heardPartial = ''; S.missStreak = 0;
    S.lastHiTop = -1;
    toast('已回到开头');
  }

  function nudgePixels(px) {
    const fs = effectiveFontSize();
    const lineChars = Math.max(8, (stage.clientWidth * (1 - S.settings.margin / 50)) / fs);
    const delta = px / Math.max(1, fs * S.settings.lineHeight) * lineChars;
    S.currentIdx = clamp(S.currentIdx + delta, 0, Math.max(0, S.norm.chars.length - 1));
    if (S.mode === 'voice') S.voiceTargetIdx = S.currentIdx;
    S.currentY = Math.max(0, topForIndex(S.currentIdx) - S.readTop);
  }

  /* ------------------------------------------------------------ 模式 */
  function setMode(mode, skipSave, autoStart) {
    if (!MODE_LABEL[mode]) return;
    const prev = S.mode;
    S.mode = mode;
    if (prev === 'voice' && mode !== 'voice') stopVoice();
    S.playing = false;
    $('btn-play').textContent = '▶';
    $('mode-chip').textContent = MODE_LABEL[mode];
    qsa('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('speed-wrap').hidden = mode !== 'timed';
    $('voice-box').hidden = mode !== 'voice';
    app.classList.toggle('no-current', mode === 'manual');
    $('dbg-strategy').textContent = mode.toUpperCase();
    if (mode === 'voice') {
      voiceStatus('idle', autoStart === false ? '点播放开始语音跟读' : '离线模型待加载');
      if (autoStart !== false) {
        startVoice().then(ok => { if (ok) { S.playing = true; $('btn-play').textContent = '❚❚'; } });
      }
    }
    if (!skipSave) saveSettings({ mode });
  }

  /* ------------------------------------------------------------ 离线语音跟读 */
  function voiceStatus(state, msg) {
    $('voice-text').textContent = msg;
    $('pulse').classList.toggle('live', state === 'listening');
    $('dbg-asr').textContent = state.toUpperCase();
    if (state === 'loading') $('voice-sub').textContent = '首次加载需解压约 66MB，之后自动缓存';
    else if (state === 'listening') $('voice-sub').textContent = '离线识别中 · 说到哪滚到哪';
    else $('voice-sub').textContent = '无需联网 · 本地识别';
  }

  async function startVoice() {
    if (S.mode !== 'voice') return false;
    if (S.asr && S.asr.running) return true;
    if (!S.asr) {
      S.asr = new window.TP.OfflineASR({
        onStatus: voiceStatus,
        onText: onHeard,
        onLevel: (v) => { $('level-bar').style.width = Math.round(v * 100) + '%'; }
      });
    }
    const token = ++S.voiceToken;
    try {
      await S.asr.start();
      if (token !== S.voiceToken || S.mode !== 'voice') { S.asr.stop(); return false; }
      S.voiceTargetIdx = Math.max(S.voiceTargetIdx, S.currentIdx);
      return true;
    } catch (e) {
      if (token !== S.voiceToken) return false;
      voiceStatus('error', '语音不可用');
      toast('语音跟读启动失败：' + (e.message || e) + '\n已切换到定速滚动', 5200);
      setMode('timed');
      return false;
    }
  }

  function stopVoice() {
    S.voiceToken++;
    if (S.asr) S.asr.stop();
    $('level-bar').style.width = '0%';
    if (S.mode !== 'voice') voiceStatus('idle', '离线模型待加载');
  }

  function onHeard(text, isFinal) {
    const chars = window.TP.heardToChars(text);
    if (!chars.length) return;
    if (isFinal) {
      S.heardFinal = (S.heardFinal + chars.join('')).slice(-240);
      S.heardPartial = '';
      S.heardCount += chars.length;
    } else {
      S.heardPartial = chars.join('');
    }
    $('dbg-heard').textContent = String(S.heardCount);
    alignHeard(window.TP.heardToChars(S.heardFinal + S.heardPartial));
  }

  /** 把听到的字与稿件做模糊对齐，推进朗读位置（识别有误也能跟住） */
  function alignHeard(heard) {
    const chars = S.norm.chars;
    if (!chars.length || heard.length < 3) return;
    const base = Math.floor(Math.max(S.voiceTargetIdx, S.currentIdx));
    const reach = S.missStreak > 3 ? 900 : 280;
    const end = Math.min(chars.length, base + reach);

    for (const n of [8, 6, 4]) {
      if (heard.length < n) continue;
      const anchor = heard.slice(-n);
      const start = Math.max(0, base - 24);
      let best = { score: -99, pos: -1 };
      for (let p = start; p + n <= end; p++) {
        let sc = 0, bigram = 0;
        for (let k = 0; k < n; k++) {
          if (chars[p + k] === anchor[k]) {
            sc++;
            if (k < n - 1 && chars[p + k + 1] === anchor[k + 1]) bigram++;
          }
        }
        sc += bigram * 0.35 - Math.abs(p - base) * 0.002;
        if (sc > best.score) best = { score: sc, pos: p };
      }
      if (best.score >= n * 0.45) {
        const newIdx = best.pos + n;
        if (newIdx > S.voiceTargetIdx && newIdx > S.currentIdx - 12) {
          S.voiceTargetIdx = Math.min(newIdx, chars.length - 1);
          S.matchScore = Math.round(best.score / n * 100);
          S.missStreak = 0;
          S.lastMatchAt = performance.now();
          $('dbg-match').textContent = S.matchScore + '%';
          return;
        }
      }
    }
    S.missStreak++;
    if (S.missStreak === 6) toast('没有跟上朗读内容，可检查稿件是否一致，或按 R 重置');
  }

  /* ------------------------------------------------------------ 穿透 / 悬浮 */
  function updateThroughUI() {
    $('btn-through').classList.toggle('on', S.clickThrough);
    app.classList.toggle('hidden-ui', S.clickThrough && !S.interactive && !S.settingsOpen);
  }

  async function setClickThrough(on) {
    S.clickThrough = !!on;
    await api.setClickThrough(on);
    if (!on) { S.interactive = true; await api.setIgnoreMouse(false); }
    updateThroughUI();
    toast(on ? '鼠标穿透已开启：文字区可点到后面的软件；移到顶/底栏可操作，或按 Ctrl+Alt+P / 用托盘菜单关闭'
             : '鼠标穿透已关闭', 3600);
  }

  function handleHover(e) {
    // Windows 上穿透后收不到 mousemove，改由主进程轮询光标位置驱动
    if (!S.clickThrough || IS_WIN) return;
    const topBottom = $('topbar').getBoundingClientRect().bottom;
    const barTop = $('controlbar').getBoundingClientRect().top;
    const wantInteractive = S.settingsOpen ||
      e.clientY < topBottom || e.clientY > barTop - 4;
    if (wantInteractive === S.interactive) return;
    S.interactive = wantInteractive;
    api.setIgnoreMouse(!wantInteractive);
    updateThroughUI();
  }

  /* ------------------------------------------------------------ UI 事件 */
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.whiteSpace = 'pre-line';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }

  function bindUI() {
    qsa('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('btn-play').onclick = togglePlay;
    $('btn-restart').onclick = restart;
    $('btn-back').onclick = () => nudgePixels(-stage.clientHeight * 0.22);
    $('btn-fwd').onclick = () => nudgePixels(stage.clientHeight * 0.22);

    $('speed').oninput = e => {
      const v = Number(e.target.value);
      $('speed-val').textContent = v.toFixed(1) + ' 字/秒';
      saveSettings({ speed: v });
    };
    qsa('#speed-presets button').forEach(b => b.onclick = () => {
      $('speed').value = b.dataset.v;
      $('speed').dispatchEvent(new Event('input'));
    });

    $('opacity').oninput = e => {
      const v = Number(e.target.value);
      $('opacity-val').textContent = v + '%';
      saveSettings({ opacity: v });
    };
    $('btn-through').onclick = () => setClickThrough(!S.clickThrough);
    $('btn-pin').onclick = () => {
      const on = !S.settings.alwaysOnTop;
      saveSettings({ alwaysOnTop: on });
      toast(on ? '窗口已置顶' : '已取消置顶');
    };
    $('btn-settings').onclick = () => openSettings(!S.settingsOpen);
    $('set-close').onclick = () => openSettings(false);
    $('btn-debug').onclick = () => { S.debugOpen = !S.debugOpen; $('debug').hidden = !S.debugOpen; };
    $('btn-max').onclick = () => api.toggleMaximize();
    $('btn-min').onclick = () => api.minimize();
    $('btn-close').onclick = backToManager;
    $('set-back').onclick = backToManager;
    $('set-hide').onclick = () => api.hidePrompt();

    document.addEventListener('mousemove', handleHover);
    api.on('prompt:click-through', (on) => { S.clickThrough = on; updateThroughUI(); });
    api.on('prompt:hover-ui', (interactive) => {
      if (!S.clickThrough) return;
      S.interactive = !!interactive;
      updateThroughUI();
    });

    /* 设置面板 */
    const sw = (id, key) => $(id).onclick = () => saveSettings({ [key]: !S.settings[key] });
    sw('set-autofit', 'autoFit'); sw('set-mirror', 'mirror');
    sw('set-reading', 'showReadingArea'); sw('set-hotkeys', 'globalHotkeys');

    $('set-font').oninput = e => saveSettings({ fontSize: Number(e.target.value), autoFit: false });
    $('set-line').oninput = e => saveSettings({ lineHeight: Number(e.target.value) });
    $('set-margin').oninput = e => saveSettings({ margin: Number(e.target.value) });
    $('set-opacity').oninput = e => saveSettings({ opacity: Number(e.target.value) });
    qsa('#font-chips button').forEach(b => b.onclick = () => saveSettings({ fontSize: parseInt(b.textContent, 10), autoFit: false }));
    qsa('#line-chips button').forEach(b => b.onclick = () => saveSettings({ lineHeight: Number(b.textContent) }));
    qsa('#margin-chips button').forEach(b => b.onclick = () => saveSettings({ margin: parseInt(b.textContent, 10) }));
    qsa('#colors button').forEach(b => b.onclick = () => saveSettings({ textColor: b.dataset.c }));
    $('custom-color').oninput = e => saveSettings({ textColor: e.target.value });

    const persistContent = debounce(async (value) => {
      if (!S.article) return;
      const articles = Store.articles.map(a => a.id === S.article.id
        ? { ...a, content: value, updatedAt: Date.now() } : a);
      S.ownEdit = true;
      await Store.saveArticles(articles);
      S.article = { ...S.article, content: value };
      setTimeout(() => { S.ownEdit = false; }, 350);
    }, 420);
    $('set-content').oninput = e => {
      S.article = { ...S.article, content: e.target.value };
      renderScript(true);
      persistContent(e.target.value);
    };
    $('set-optimize').onclick = () => {
      const el = $('set-content');
      const r = window.TP.optimize(el.value);
      el.value = r.text;
      el.dispatchEvent(new Event('input'));
      toast(`✦ ${r.note}（调整 ${r.changes} 处）`);
    };

    /* 滚轮 / 拖拽 */
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      nudgePixels(e.deltaY * 1.15);
    }, { passive: false });
    stage.addEventListener('mousedown', e => {
      if (e.target.closest('#settings')) return;
      S.drag = { y: e.clientY, idx: S.currentIdx };
    });
    window.addEventListener('mousemove', e => {
      if (!S.drag) return;
      nudgePixels((S.drag.y - e.clientY) * 1.6);
      S.drag.y = e.clientY;
    });
    window.addEventListener('mouseup', () => { S.drag = null; });

    /* 局部快捷键 */
    document.addEventListener('keydown', onKeyDown);

    /* 主进程转发的全局快捷键 */
    api.on('hotkey:toggle-play', togglePlay);
    api.on('hotkey:nudge-up', () => nudgePixels(-effectiveFontSize() * 0.8));
    api.on('hotkey:nudge-down', () => nudgePixels(effectiveFontSize() * 0.8));
    api.on('hotkey:restart', restart);
    api.on('hotkey:toggle-through', () => setClickThrough(!S.clickThrough));

    window.addEventListener('resize', () => { applySettings(); });
  }

  function openSettings(on) {
    S.settingsOpen = on;
    $('settings').hidden = !on;
    if (on && S.clickThrough) { S.interactive = true; api.setIgnoreMouse(false); }
    updateThroughUI();
    if (on) syncSettingsUI();
  }

  function backToManager() {
    stopVoice();
    api.openManager();
    api.closePrompt();
  }

  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') { e.target.blur(); openSettings(false); }
      return;
    }
    const k = e.key;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); nudgePixels(-effectiveFontSize() * 0.7); }
    else if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); nudgePixels(effectiveFontSize() * 0.7); }
    else if (k === 'PageUp') { e.preventDefault(); nudgePixels(-stage.clientHeight * 0.4); }
    else if (k === 'PageDown') { e.preventDefault(); nudgePixels(stage.clientHeight * 0.4); }
    else if (k === 'r' || k === 'R') restart();
    else if (k === 't' || k === 'T') setClickThrough(!S.clickThrough);
    else if (k === 'o' || k === 'O') $('btn-pin').click();
    else if (k === 'm' || k === 'M') saveSettings({ mirror: !S.settings.mirror });
    else if (k === 'f' || k === 'F') api.toggleMaximize();
    else if (k === '+' || k === '=') saveSettings({ fontSize: clamp(S.settings.fontSize + 4, 24, 120), autoFit: false });
    else if (k === '-' || k === '_') saveSettings({ fontSize: clamp(S.settings.fontSize - 4, 24, 120), autoFit: false });
    else if (k === '[') saveSettings({ speed: clamp(Number(S.settings.speed) - 0.3, 1, 10) });
    else if (k === ']') saveSettings({ speed: clamp(Number(S.settings.speed) + 0.3, 1, 10) });
    else if (k === 'Escape') { openSettings(false); backToManager(); }
  }

  /* ------------------------------------------------------------ 数据同步 */
  function onLoad(payload) {
    const { article, store } = payload || {};
    Store.data = store;
    S.settings = { ...store.settings };
    S.article = article;
    S.currentIdx = 0; S.voiceTargetIdx = 0; S.currentY = 0;
    S.heardFinal = ''; S.heardPartial = ''; S.heardCount = 0; S.missStreak = 0;
    renderScript(false);
    applySettings();
    setMode(S.settings.mode || 'timed', true, false);
  }

  function onStoreChanged(data) {
    S.settings = { ...data.settings };
    if (S.article) {
      const a = data.articles.find(x => x.id === S.article.id);
      if (a) {
        const changed = a.content !== S.article.content;
        S.article = a;
        if (changed && !S.ownEdit) renderScript(true);
      }
    }
    applySettings();
  }

  /* ------------------------------------------------------------ 自检 */
  async function runSelfTest() {
    const checks = {};
    const result = { ok: false, checks, at: new Date().toISOString() };
    try {
      checks.api = !!window.api;
      checks.storeReady = !!(await api.getStore());
      checks.voskGlobal = !!window.Vosk;
      checks.optimize = window.TP.optimize('测试一下，没有标点而且这个句子特别长需要自动断句处理才方便口播朗读').text.length > 10;
      const snap = await api.getStore();
      onLoad({ article: snap.articles[0], store: snap });
      await new Promise(r => setTimeout(r, 600));
      checks.spansRendered = S.spans.length;
      checks.mode = S.mode;
      checks.loadIpc = !!S.loadReceived;
      const probe = await new window.TP.OfflineASR({}).probe();
      checks.modelReachable = probe.ok;
      checks.modelRange = probe.info;
      const asr = new window.TP.OfflineASR({ onStatus: () => {}, onText: () => {}, onLevel: () => {} });
      const t0 = Date.now();
      await asr.load();
      checks.modelLoaded = true;
      checks.modelLoadMs = Date.now() - t0;
      checks.recognizerCreated = !!asr.model.KaldiRecognizer;

      // 真正喂一段音频，验证 wasm 识别管线可用（而不只是模型文件存在）
      const rec = new asr.model.KaldiRecognizer(16000);
      let sawResult = false;
      rec.on('result', () => { sawResult = true; });
      rec.on('partialresult', () => { sawResult = true; });
      for (let i = 0; i < 4 && !sawResult; i++) {
        rec.acceptWaveformFloat(new Float32Array(4096), 16000);
        await new Promise(r => setTimeout(r, 700));
      }
      if (!sawResult) await new Promise(r => setTimeout(r, 1200));
      checks.recognizerAudio = sawResult;
      try { rec.remove(); } catch (_) {}

      result.ok = checks.api && checks.voskGlobal && checks.spansRendered > 10 &&
        checks.loadIpc && checks.modelReachable && checks.modelLoaded &&
        checks.recognizerCreated && checks.recognizerAudio;
    } catch (e) {
      result.error = String((e && e.stack) || e);
    }
    try { api.selftestResult(result); } catch (_) {}
  }

  /* ------------------------------------------------------------ 启动 */
  async function init() {
    await Store.init();
    S.settings = { ...Store.settings };
    Store.bind(onStoreChanged);
    api.on('prompt:load', (p) => { S.loadReceived = true; onLoad(p); });
    bindUI();
    applySettings();
    setMode(S.settings.mode || 'timed', true, false);
    requestAnimationFrame(tick);
    if (location.search.includes('selftest')) setTimeout(runSelfTest, 600);
  }

  init().catch(e => {
    console.error('[prompt] init failed', e);
    try { api.log('[prompt] init failed ' + e.stack); } catch (_) {}
  });
})();
