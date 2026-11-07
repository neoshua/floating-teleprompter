/* 本地规则「AI 优化」：标点 / 断句 / 分段整理，全程离线，不联网、不调模型 */
(function (global) {
  'use strict';

  const CJK = '\u4e00-\u9fa5';
  const RE_CJK = new RegExp('[' + CJK + ']');
  // 适合换气的位置：在这些词后面断句最自然
  const PAUSE_WORDS = [
    '因为', '所以', '但是', '不过', '而且', '并且', '如果', '虽然', '即使', '其实',
    '然后', '同时', '另外', '尤其', '特别', '比如', '也就是说', '换句话说',
    '的', '了', '和', '或', '而', '就', '也', '还', '把', '被', '让', '在', '是', '有'
  ];
  const END_MARKS = '。！？!?…';

  function halfToFull(line) {
    let s = line;
    // 仅当处于中文语境时把半角标点换成中文标点
    s = s.replace(new RegExp('([' + CJK + '])\\s*,\\s*', 'g'), '$1，');
    s = s.replace(new RegExp('([' + CJK + '])\\s*\\.\\s*', 'g'), '$1。');
    s = s.replace(new RegExp('([' + CJK + '])\\s*\\?\\s*', 'g'), '$1？');
    s = s.replace(new RegExp('([' + CJK + '])\\s*!\\s*', 'g'), '$1！');
    s = s.replace(new RegExp('([' + CJK + '])\\s*:\\s*', 'g'), '$1：');
    s = s.replace(new RegExp('([' + CJK + '])\\s*;\\s*', 'g'), '$1；');
    return s;
  }

  function cleanLine(raw) {
    let s = String(raw || '').replace(/\r/g, '');
    // 去掉 markdown / 列表符号
    s = s.replace(/^\s{0,3}(#{1,6}|[-*•]+|>\s*|\d+[.、)])\s*/g, '');
    s = s.replace(/\*\*|__|`/g, '');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = halfToFull(s);
    // 中文之间的多余空格
    s = s.replace(new RegExp('([' + CJK + '])\\s+([' + CJK + '])', 'g'), '$1$2');
    s = s.replace(/[ \t]{2,}/g, ' ');
    // 连续重复标点
    s = s.replace(/([，。！？；：、])\1+/g, '$1');
    s = s.replace(/，([。！？])/g, '$1');
    return s.trim();
  }

  /** 长句按口播节奏断句 */
  function splitLongSentence(sentence) {
    const out = [];
    let rest = sentence;
    let guard = 0;
    while (rest.length > 30 && guard++ < 40) {
      let cut = -1;
      // 在 20~30 字之间优先寻找换气词
      for (let i = 20; i <= Math.min(30, rest.length - 4); i++) {
        const tail = rest.slice(0, i);
        if (PAUSE_WORDS.some(w => tail.endsWith(w))) cut = i;
      }
      if (cut < 0) {
        cut = 26;
        // 不切断英文单词 / 数字串
        while (cut < rest.length - 4 && /[A-Za-z0-9]/.test(rest[cut])) cut++;
      }
      out.push(rest.slice(0, cut).trim() + '，');
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out.join('');
  }

  function punctuate(text) {
    // 按已有停顿切开，逐段处理长句
    return text.split(/(?<=[，。！？；：、…])/).map(part => {
      if (!part) return '';
      const mark = part.slice(-1);
      const body = /[，。！？；：、…]/.test(mark) ? part.slice(0, -1) : part;
      const tail = body === part ? '' : mark;
      return splitLongSentence(body) + tail;
    }).join('');
  }

  function ensureEnding(para) {
    const s = para.trim();
    if (!s) return '';
    return END_MARKS.includes(s.slice(-1)) ? s : s + '。';
  }

  function optimize(input) {
    const original = String(input || '');
    if (!original.trim()) return { text: original, changes: 0, note: '内容为空' };

    let paras = original.split(/\n+/).map(cleanLine).filter(Boolean);
    paras = paras.map(p => ensureEnding(punctuate(p)));

    // 只有一大段且很长时，按句号重新分段，让提词时更容易找位置
    if (paras.length === 1 && paras[0].length > 240) {
      const sentences = paras[0].split(/(?<=[。！？])/).filter(Boolean);
      const grouped = [];
      for (let i = 0; i < sentences.length; i += 2) {
        grouped.push(sentences.slice(i, i + 2).join('').trim());
      }
      paras = grouped;
    }

    const text = paras.join('\n\n');
    const a = global.TP.normalize(original).chars.join('');
    const b = global.TP.normalize(text).chars.join('');
    let changes = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changes++;
    // 断句/分段带来的变化也算
    changes += Math.abs((text.match(/[，。！？]/g) || []).length - (original.match(/[，。！？]/g) || []).length);
    return { text, changes: Math.max(changes, 0), note: '已整理标点、断句与段落节奏' };
  }

  global.TP.optimize = optimize;
})(window);
