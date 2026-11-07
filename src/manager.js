(function () {
  'use strict';
  const { api, Store, uid, escapeHtml, fmtDate, qs, debounce } = window.TP;

  let editingId = null;
  let keyword = '';
  let undoSnapshot = null;
  let confirmAction = null;

  const $grid = qs('#grid');
  const $empty = qs('#empty');
  const $count = qs('#count');
  const $search = qs('#search');
  const $modal = qs('#modal');
  const $confirm = qs('#confirm');
  const $about = qs('#about');

  function excerpt(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120) || '（空白稿件）';
  }

  function render() {
    const list = Store.articles
      .filter(a => !keyword || (a.title + ' ' + a.content).toLowerCase().includes(keyword))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    $count.textContent = `${Store.articles.length} 条`;
    $empty.hidden = list.length > 0;
    $grid.innerHTML = list.map(a => `
      <article class="card" data-id="${escapeHtml(a.id)}">
        <div class="card-icon">▤</div>
        <h3 title="${escapeHtml(a.title)}">${escapeHtml(a.title || '未命名稿件')}</h3>
        <p>${escapeHtml(excerpt(a.content))}</p>
        <div class="card-foot">
          <span class="card-date">${fmtDate(a.updatedAt)} · ${String(a.content || '').replace(/\s/g, '').length} 字</span>
          <div class="card-actions">
            <button data-act="edit">编辑</button>
            <button data-act="del">删除</button>
            <button class="go" data-act="play">开始提词 ▶</button>
          </div>
        </div>
      </article>`).join('');
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(article) {
    editingId = article ? article.id : null;
    undoSnapshot = null;
    qs('#modal-title').textContent = article ? '编辑稿件' : '新建稿件';
    qs('#f-title').value = article ? (article.title || '') : '';
    qs('#f-content').value = article ? (article.content || '') : '';
    qs('#btn-undo').hidden = true;
    qs('#optimize-note').hidden = true;
    updateCount();
    $modal.hidden = false;
    setTimeout(() => (article ? qs('#f-content') : qs('#f-title')).focus(), 30);
  }

  function closeModal() { $modal.hidden = true; editingId = null; }

  function updateCount() {
    const n = qs('#f-content').value.replace(/\s/g, '').length;
    qs('#char-count').textContent = `${n} 字`;
  }

  async function save() {
    const title = qs('#f-title').value.trim() || '未命名稿件';
    const content = qs('#f-content').value;
    if (!content.trim()) { flashNote('正文不能为空', true); return; }
    const now = Date.now();
    const articles = Store.articles.slice();
    if (editingId) {
      const i = articles.findIndex(a => a.id === editingId);
      if (i >= 0) articles[i] = { ...articles[i], title, content, updatedAt: now };
    } else {
      articles.unshift({ id: uid(), title, content, createdAt: now, updatedAt: now });
    }
    await Store.saveArticles(articles);
    closeModal();
    render();
  }

  function optimize() {
    const $area = qs('#f-content');
    const before = $area.value;
    if (!before.trim()) { flashNote('先粘贴一点台词再优化', true); return; }
    undoSnapshot = before;
    const r = window.TP.optimize(before);
    $area.value = r.text;
    updateCount();
    qs('#btn-undo').hidden = false;
    flashNote(`✦ ${r.note}（调整 ${r.changes} 处，可撤销）`);
  }

  function flashNote(text, warn) {
    const el = qs('#optimize-note');
    el.textContent = text;
    el.hidden = false;
    el.style.color = warn ? '#ffb4a8' : '#d7c98d';
    clearTimeout(flashNote._t);
    flashNote._t = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function askConfirm(title, text, action) {
    qs('#confirm-title').textContent = title;
    qs('#confirm-text').textContent = text;
    confirmAction = action;
    $confirm.hidden = false;
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    qs('#btn-new').onclick = () => openModal(null);
    qs('#btn-new-hero').onclick = () => openModal(null);
    qs('#btn-quick').onclick = () => {
      const a = Store.articles[0];
      if (a) api.openPrompt(a.id);
      else openModal(null);
    };
    qs('#btn-optimize').onclick = optimize;
    qs('#btn-undo').onclick = () => {
      if (undoSnapshot == null) return;
      qs('#f-content').value = undoSnapshot;
      undoSnapshot = null;
      qs('#btn-undo').hidden = true;
      updateCount();
      flashNote('已恢复优化前的文本');
    };
    qs('#f-content').addEventListener('input', updateCount);
    qs('#btn-save').onclick = save;
    qs('#btn-cancel').onclick = closeModal;
    qs('#modal-close').onclick = closeModal;
    $modal.addEventListener('mousedown', e => { if (e.target === $modal) closeModal(); });

    qs('#confirm-no').onclick = () => { $confirm.hidden = true; confirmAction = null; };
    qs('#confirm-yes').onclick = async () => {
      $confirm.hidden = true;
      if (confirmAction) await confirmAction();
      confirmAction = null;
    };

    $search.addEventListener('input', debounce(e => { keyword = e.target.value.trim().toLowerCase(); render(); }, 120));

    $grid.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const card = e.target.closest('.card');
      const id = card && card.dataset.id;
      const article = Store.articles.find(a => a.id === id);
      if (!article) return;
      const act = btn.dataset.act;
      if (act === 'play') await api.openPrompt(id);
      else if (act === 'edit') openModal(article);
      else if (act === 'del') {
        askConfirm('删除稿件？', `「${article.title}」将被删除，此操作不可撤销。`, async () => {
          await Store.saveArticles(Store.articles.filter(a => a.id !== id));
          render();
        });
      }
    });

    qs('#btn-min').onclick = () => api.minimize();
    qs('#btn-max').onclick = () => api.maximize();
    qs('#btn-close').onclick = () => api.closeWindow();
    qs('#btn-data').onclick = () => api.openDataDir();

    /* 关于与致谢 */
    const openExternal = (url) => { try { api.openExternal(url); } catch (_) {} };
    qs('#btn-about').onclick = () => { $about.hidden = false; };
    api.on('app:show-about', () => { $about.hidden = false; });
    qs('#about-close').onclick = () => { $about.hidden = true; };
    qs('#about-ok').onclick = () => { $about.hidden = true; };
    qs('#about-repo').onclick = () => openExternal('https://github.com/neoshua/floating-teleprompter');
    $about.addEventListener('click', e => {
      if (e.target === $about) $about.hidden = true;
      const btn = e.target.closest('[data-url]');
      if (btn) openExternal(btn.dataset.url);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!$confirm.hidden) { $confirm.hidden = true; confirmAction = null; }
        else if (!$modal.hidden) closeModal();
        else if (!$about.hidden) $about.hidden = true;
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); openModal(null); }
      if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); $search.focus(); }
      if (ctrl && e.key === 'Enter' && !$modal.hidden) { e.preventDefault(); save(); }
      if (ctrl && e.key.toLowerCase() === 's' && !$modal.hidden) { e.preventDefault(); save(); }
    });
  }

  async function statusBar() {
    try {
      const info = await api.appInfo();
      qs('#status-dir').textContent = '数据目录：' + info.dataDir;
    } catch (_) {}
    try {
      const r = await fetch('/assets/model.tar.gz', { headers: { Range: 'bytes=0-0' } });
      qs('#status-asr').textContent = r.ok
        ? '离线中文语音模型：已就绪（无需联网）'
        : '离线中文语音模型：缺失';
    } catch (_) {
      qs('#status-asr').textContent = '离线中文语音模型：检查失败';
    }
  }

  async function init() {
    await Store.init();
    Store.bind(() => { render(); });
    bind();
    render();
    statusBar();
  }

  init().catch(e => console.error('[manager] init failed', e));
})();
