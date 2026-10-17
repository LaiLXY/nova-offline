/* ==========================================================================
   morse.js —— 功能页：异语道破（摩斯电码）
   --------------------------------------------------------------------------
   两个模式（二级选择 → 各自三级）：

     一、摩斯翻译（照罗马数字的双输入框成式）
        enc：文字 → 电码。/ 分隔字母、\ 分隔单词，空格自动变 \，
             撇号跟词内字母同等（I'm → ··/·----·/--），其余标点独立成段。
             例：Thank you. → -/····/·-/-·/-·-\-·--/---/··-\·-·-·-
        dec：电码 → 文字。反着查表；没写 / 的段用最长匹配尽力切分。
        「电码 → 文字」的输入框接自绘软键盘（.gfx-pad 外观，键位：
        · — 两个大键 + / \ 退格），触摸设备屏蔽系统键盘。

     二、译电挑战
        一局一个词：纸带每格上是电码、下填字母。
        声音 Web Audio 合成（600Hz 正弦 + 5ms 包络防爆音）；
        ★ 一条时间轴两用：先把每个符号的 (start, dur) 算成数组，
        音频按它调度、视觉高亮用同一组 setTimeout —— 静音时只跑视觉，
        节奏仍然看得见，音频和画面永不漂移。
        三档：入门 4–5 字母对照表常显 / 进阶 6–8 对照表可展开 /
        困难 8–12 字母（或数字串）无对照表 18wpm。

   依赖：core.js（$ / $$ / toast）、tools.js（tool:open）、
        graph.js（gfxPadEnsureVisible / gfxClearPadScroller）。
   一次请求都不发，不记战绩。
   ========================================================================== */
(function () {
  'use strict';

  const PAGE = $('#toolMorse');
  if (!PAGE) return;

  /* ---------- 电码表（点 U+00B7 ·，划 U+002D -） ---------- */
  const MS_CODE = {
    A: '·-', B: '-···', C: '-·-·', D: '-··', E: '·', F: '··-·',
    G: '--·', H: '····', I: '··', J: '·---', K: '-·-', L: '·-··',
    M: '--', N: '-·', O: '---', P: '·--·', Q: '--·-', R: '·-·',
    S: '···', T: '-', U: '··-', V: '···-', W: '·--', X: '-··-',
    Y: '-·--', Z: '--··',
    '0': '-----', '1': '·----', '2': '··---', '3': '···--', '4': '····-',
    '5': '·····', '6': '-····', '7': '--···', '8': '---··', '9': '----·',
    '.': '·-·-·-', ',': '--··--', '?': '··--··', '!': '-·-·--',
    "'": '·----·', '"': '·-··-·', ':': '---···', ';': '-·-·-·'
  };
  const MS_REV = {};
  Object.keys(MS_CODE).forEach(k => { MS_REV[MS_CODE[k]] = k; });

  /* ---------- 词库（全大写常规词，按长度分桶） ---------- */
  const MS_W45 = [
    'ECHO', 'MOON', 'STAR', 'WAVE', 'CODE', 'DAWN', 'GOLD', 'IRON', 'NOVA',
    'RAIN', 'SNOW', 'TIDE', 'ZERO', 'BLUE', 'FIRE', 'LAKE', 'OPAL', 'EARTH',
    'LIGHT', 'MUSIC', 'NIGHT', 'OCEAN', 'PILOT', 'RIVER', 'STORM', 'TIGER',
    'VENUS', 'CLOUD', 'DREAM', 'HONEY'
  ];
  const MS_W68 = [
    'BRIDGE', 'CANDLE', 'FOREST', 'GALAXY', 'MELODY', 'ORANGE', 'PLANET',
    'SILVER', 'VOYAGE', 'EMPIRE', 'THUNDER', 'HARMONY', 'JOURNEY', 'LIBERTY',
    'MYSTERY', 'COMPASS', 'LANTERN', 'PYRAMID', 'DIAMOND', 'ECLIPSE',
    'MORNING', 'RAINBOW', 'WHISPER', 'MOUNTAIN', 'TREASURE', 'MIDNIGHT'
  ];
  const MS_W812 = [
    'MOUNTAIN', 'TREASURE', 'MIDNIGHT', 'HORIZONS', 'MERIDIAN', 'EQUATION',
    'SYMPHONY', 'LABYRINTH', 'ASTRONOMY', 'BUTTERFLY', 'DISCOVERY',
    'NAVIGATOR', 'EXPEDITION', 'WAVELENGTH', 'PHILOSOPHY', 'SERENDIPITY',
    'OBSERVATORY'
  ];

  /* ---------- 难度 ---------- */
  const MS_TIERS = [
    { key: 'easy',   name: '入门', wpm: 10, table: 'show',   pool: MS_W45 },
    { key: 'normal', name: '进阶', wpm: 13, table: 'toggle', pool: MS_W68 },
    { key: 'hard',   name: '困难', wpm: 18, table: 'none',   pool: MS_W812, digits: true },
  ];
  let msTier = MS_TIERS[0];

  /* ---------- 元素 ---------- */
  const msHome = $('#msHome'), msTransHome = $('#msTransHome'), msTrans = $('#msTrans');
  const msGameHome = $('#msGameHome'), msGame = $('#msGame');
  const msChart = $('#msChart'), msChartBody = $('#msChartBody');
  const msOverlay = $('#msOverlay');
  const msOvTitle = $('#msOvTitle'), msOvText = $('#msOvText');
  const msOvOk = $('#msOvOk'), msOvNew = $('#msOvNew'), msOvBack = $('#msOvBack');
  const msAskConfirm = $('#msAskConfirm'), msAskTitle = $('#msAskTitle');
  const msAskText = $('#msAskText'), msAskOk = $('#msAskOk'), msAskCancel = $('#msAskCancel');

  const msIn = $('#msIn'), msOut = $('#msOut');
  const msDirTag = $('#msDirTag'), msInLabel = $('#msInLabel'), msNote = $('#msNote');
  const msCopyIn = $('#msCopyIn'), msCopyOut = $('#msCopyOut');
  const msPad = $('#msPad'), msPadKeys = $('#msPadKeys');
  const msPadClear = $('#msPadClear'), msPadDone = $('#msPadDone');

  /* 输出大小写折叠栏（仅 电码 → 文字 方向显示） */
  const msCase = $('#msCase'), msCaseToggle = $('#msCaseToggle');
  const msCaseOpts = $('#msCaseOpts'), msCaseCur = $('#msCaseCur'), msCaseArrow = $('#msCaseArrow');

  const msTiersEl = $('#msTiers'), msStart = $('#msStart');
  const msRoundEl = $('#msRound'), msMeta = $('#msMeta');
  const msSoundBtn = $('#msSound'), msTableBtn = $('#msTableBtn'), msHintBtn = $('#msHint');
  const msResetBtn = $('#msReset'), msRechooseBtn = $('#msRechoose');
  const msExitBtn = $('#msExit');
  /* 通关确定后顶栏换成这三个（无需二次确认） */
  const msDoneExit = $('#msDoneExit'), msDoneNew = $('#msDoneNew'), msDoneRechoose = $('#msDoneRechoose');
  const msTimeEl = $('#msTime'), msErrEl = $('#msErr'), msHintsEl = $('#msHints');
  const msTape = $('#msTape'), msTable = $('#msTable');
  const msPlayAll = $('#msPlayAll'), msPlayCur = $('#msPlayCur');
  const msKeys = $('#msKeys');

  /* ==========================================================
     一、层级导航（二级 ↔ 三级）
     ========================================================== */
  const MS_SECTIONS = [msHome, msTransHome, msTrans, msChart, msGameHome, msGame];

  function msShow(sec) {
    MS_SECTIONS.forEach(s => { s.hidden = (s !== sec); });
  }

  document.addEventListener('click', e => {
    const back = e.target.closest('[data-ms-back]');
    if (!back || !PAGE.contains(back)) return;
    msStopAudio();
    msPadHide();
    msShow(back.dataset.msBack === 'transHome' ? msTransHome : msHome);
  });

  /* ==========================================================
     二、翻译
     ========================================================== */
  let msDir = 'enc';

  function msSetDir(dir) {
    msDir = dir;
    const enc = dir === 'enc';
    msDirTag.textContent = enc ? '文字 → 电码' : '电码 → 文字';
    msInLabel.textContent = enc ? '输入（英文 / 拼音）' : '输入（摩斯电码）';
    msIn.placeholder = enc ? '如 I am Roy.' : '如 ··\\·-/--';
    msNote.textContent = enc
      ? '/ 分隔字母 · \\ 分隔单词 · 空格自动变 \\ · 不认识的字符跳过'
      : '/ 分隔字母 · \\ 分隔单词 · 没写 / 的段会自动切分';
    msCase.hidden = enc;               /* 大小写只对 译回文字 有意义 */
    msIn.value = '';
    msOut.value = '';
    msPadCaret = 0;
    /* 触摸设备上只有电码方向屏蔽系统键盘（用自绘软键盘） */
    if (typeof Device !== 'undefined' && !Device.isPC()) {
      if (enc) msIn.removeAttribute('inputmode');
      else msIn.setAttribute('inputmode', 'none');
    }
  }

  /* 摩斯串宽容化：长划 / 各种圆点统一成本站的 · 和 - */
  function msNormMorse(s) {
    return s.replace(/[—–―]/g, '-').replace(/[•●◦]/g, '·');
  }

  function msEncode(text) {
    const words = [];
    let cur = [];
    const flush = () => { if (cur.length) { words.push(cur.join('/')); cur = []; } };
    for (const ch of text.toUpperCase()) {
      if (ch === ' ') { flush(); continue; }
      const c = MS_CODE[ch];
      if (!c) continue;                 /* 不认识的字符跳过 */
      if (/[A-Z0-9']/.test(ch)) cur.push(c);
      else { flush(); words.push(c); }  /* 其余标点独立成段 */
    }
    flush();
    return words.join('\\');
  }

  /* 没写 / 的段：按反表最长匹配尽力切；切不开返回 null
     （最长码 6 符号：句号 ·-·-·- 、逗号 --··-- 等） */
  function msSplitSeg(seg) {
    if (seg.indexOf('/') >= 0) return seg.split('/').filter(x => x);
    const out = [];
    let i = 0;
    while (i < seg.length) {
      let len = Math.min(6, seg.length - i), hit = 0;
      for (; len >= 1; len--) {
        if (MS_REV[seg.slice(i, i + len)]) { hit = len; break; }
      }
      if (!hit) return null;
      out.push(seg.slice(i, i + hit));
      i += hit;
    }
    return out;
  }

  function msDecode(text) {
    const s = msNormMorse(text).trim();
    if (!s) return '';
    const parts = s.split(/\\+/).map(word => {
      const segs = msSplitSeg(word);
      if (!segs) return '□';
      return segs.map(t => MS_REV[t] || '□').join('');
    }).filter(w => w);
    let out = '';
    parts.forEach(p => {
      if (!out) { out = p; return; }
      /* 独立标点段贴回前词：ROY\·-·-·- → ROY.（不是 ROY .） */
      out += /^[.,?!'";:]$/.test(p) ? p : ' ' + p;
    });
    return out;
  }

  function msSync() {
    const v = msIn.value;
    if (!v.trim()) { msOut.value = ''; return; }
    msOut.value = msDir === 'enc' ? msEncode(v) : msApplyCase(msDecode(v));
  }

  /* ---------- 电码对照表（二级菜单「电码对照」进去看全表） ----------
     数字 0–9 / 字母 A–Z / 常用标点，数据全取自 MS_CODE，不另存一份。 */
  function msBuildChart() {
    if (!msChartBody || msChartBody.dataset.built) return;
    const groups = [
      { title: '数字 0–9', keys: '0123456789'.split('') },
      { title: '字母 A–Z', keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
      { title: '常用标点', keys: ['.', ',', '?', '!', "'", '"', ':', ';'] }
    ];
    groups.forEach(g => {
      const box = document.createElement('div');
      box.className = 'ms-chart-group';
      const t = document.createElement('div');
      t.className = 'ms-chart-title';
      t.textContent = g.title;
      box.appendChild(t);
      const grid = document.createElement('div');
      grid.className = 'ms-chart-grid';
      g.keys.forEach(k => {
        const it = document.createElement('div');
        it.className = 'ms-chart-item';
        const ch = document.createElement('span');
        ch.className = 'ms-chart-ch';
        ch.textContent = k;
        const code = document.createElement('span');
        code.className = 'ms-chart-code';
        code.textContent = MS_CODE[k] || '';
        it.appendChild(ch);
        it.appendChild(code);
        grid.appendChild(it);
      });
      box.appendChild(grid);
      msChartBody.appendChild(box);
    });
    msChartBody.dataset.built = '1';
  }

  /* ---------- 输出大小写（仅 dec 方向） ----------
     auto：句子首字母大写 + 独立的 i → I
     sentence：只做句子首字母大写
     upper / lower：整串变换。解码结果本身全大写，所以先统一转小写再抬。 */
  let msCaseMode = 'auto';
  const MS_CASE_NAMES = { auto: '自动', upper: '全部大写', lower: '全部小写', sentence: '仅句子首字母大写' };

  function msCaseSentence(text, withIRule) {
    let out = '', capNext = true;
    for (const ch of text.toLowerCase()) {
      if (capNext && ch >= 'a' && ch <= 'z') { out += ch.toUpperCase(); capNext = false; }
      else {
        out += ch;
        if (ch === '.' || ch === '!' || ch === '?') capNext = true;
      }
    }
    /* \b 词边界：独立的 i 才命中，hi / im 里的不算（i'm 也算独立） */
    if (withIRule) out = out.replace(/\bi\b/g, 'I');
    return out;
  }

  function msApplyCase(text) {
    if (msCaseMode === 'upper') return text.toUpperCase();
    if (msCaseMode === 'lower') return text.toLowerCase();
    return msCaseSentence(text, msCaseMode === 'auto');
  }

  /* ==========================================================
     三、摩斯软键盘（外观复用 .gfx-pad；键位照设计图）
     ========================================================== */
  let msPadCaret = 0;

  function msPadKey(html, opts) {
    const o = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gfx-key' + (o.fn ? ' is-fn' : '') + (o.cls ? ' ' + o.cls : '');
    b.innerHTML = html;
    if (o.title) b.title = o.title;
    b.setAttribute('aria-label', o.aria || o.title || '按键');
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', o.action);
    return b;
  }

  function msPadRender() {
    if (!msPadKeys) return;
    msPadKeys.className = 'gfx-pad-keys is-rows';
    msPadKeys.textContent = '';

    const row1 = document.createElement('div');
    row1.className = 'gfx-pad-row ms-pad-row-big';
    row1.appendChild(msPadKey('<span class="ms-bigdot"></span>',
      { title: '点（短）', aria: '输入点', action: () => msPadInsert('·') }));
    row1.appendChild(msPadKey('<span class="ms-bigdash"></span>',
      { title: '划（长）', aria: '输入划', action: () => msPadInsert('-') }));
    msPadKeys.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'gfx-pad-row ms-pad-row-sep';
    row2.appendChild(msPadKey('<b>/</b><small>字符间隔符</small>',
      { cls: 'is-fn is-stack', title: '插入字符间隔符 /', action: () => msPadInsert('/') }));
    row2.appendChild(msPadKey('<b>\\</b><small>单词间隔符</small>',
      { cls: 'is-fn is-stack', title: '插入单词间隔符 \\', action: () => msPadInsert('\\') }));
    row2.appendChild(msPadKey('\u232B', { fn: 1, title: '退格', aria: '退格', action: msPadBackspace }));
    msPadKeys.appendChild(row2);
  }

  /* 插字后派发 input 事件 —— 同步全交给已有的 msSync 链路 */
  function msPadInsert(text) {
    const v = msIn.value;
    const pos = Math.min(Math.max(msPadCaret, 0), v.length);
    msIn.value = v.slice(0, pos) + text + v.slice(pos);
    msPadCaret = pos + text.length;
    try { msIn.setSelectionRange(msPadCaret, msPadCaret); } catch (_) {}
    msIn.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function msPadBackspace() {
    const v = msIn.value;
    const pos = Math.min(Math.max(msPadCaret, 0), v.length);
    if (pos === 0) return;
    msIn.value = v.slice(0, pos - 1) + v.slice(pos);
    msPadCaret = pos - 1;
    try { msIn.setSelectionRange(msPadCaret, msPadCaret); } catch (_) {}
    msIn.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function msPadShow() {
    if (!msPad || msDir !== 'dec') return;
    msPadCaret = typeof msIn.selectionStart === 'number'
      ? msIn.selectionStart : msIn.value.length;
    msPadRender();
    msPad.hidden = false;
    gfxPadEnsureVisible(msIn, msPad);
  }

  function msPadHide() {
    if (!msPad || msPad.hidden) return;
    msPad.hidden = true;
    gfxClearPadScroller();
  }

  function msPadBind() {
    msIn.addEventListener('focus', msPadShow);
    /* 兜底：个别浏览器点一下未必派发 focus */
    msIn.addEventListener('click', () => {
      if (msPad && msPad.hidden && msDir === 'dec') msPadShow();
      if (typeof msIn.selectionStart === 'number') msPadCaret = msIn.selectionStart;
    });
    /* 失焦等一个 tick：点软键盘按钮也会先 blur 一下 */
    msIn.addEventListener('blur', () => {
      setTimeout(() => {
        if (msPad && msPad.contains(document.activeElement)) return;
        msPadHide();
      }, 0);
    });
    ['click', 'keyup', 'input', 'select'].forEach(ev => {
      msIn.addEventListener(ev, () => {
        if (typeof msIn.selectionStart === 'number') msPadCaret = msIn.selectionStart;
      });
    });
  }

  /* ---------- 复制（照罗马数字的 rmCopy 成式） ---------- */
  const MS_TOAST_COPY = 'morse-copy';

  function msCopyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  async function msCopy(input, label) {
    const text = input.value;
    if (!text) {
      toast('err', '还没有内容可以复制', label === '结果' ? '先在上面填一点内容' : '', MS_TOAST_COPY);
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else msCopyFallback(text);
      toast('ok', '已复制' + label, text.length > 24 ? text.slice(0, 24) + '…' : text, MS_TOAST_COPY);
    } catch (_) {
      toast('err', '复制失败', '请手动选中后复制', MS_TOAST_COPY);
    }
  }

  /* ==========================================================
     四、译电挑战
     ========================================================== */
  let msWord = '';
  let msWordIsDigits = false;
  let msCells = [];          /* { root, codeEls, letterEl } */
  let msCur = 0, msErr = 0, msHints = 0, msRound = 0;
  let msDone = false;
  let msT0 = 0, msTimer = null;
  let msMuted = false;

  /* 音频 */
  let msAc = null;
  let msTimeouts = [], msOscs = [];
  const msUnit = () => 1200 / msTier.wpm;

  function msPickWord(tier) {
    if (tier.digits && Math.random() < 0.2) {
      const len = 4 + Math.floor(Math.random() * 5);   /* 4–8 位数字串 */
      let s = '';
      for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
      return { word: s, digits: true };
    }
    return { word: tier.pool[Math.floor(Math.random() * tier.pool.length)], digits: false };
  }

  /* 顶栏按钮组切换：局中 = 六个常规键；通关确定后 = 退出/再来一局/更改难度 */
  const msLiveBtns = () => [msExitBtn, msSoundBtn, msTableBtn, msHintBtn, msResetBtn, msRechooseBtn];
  function msSetDoneUI(on) {
    msLiveBtns().forEach(b => { b.hidden = on; });
    [msDoneExit, msDoneNew, msDoneRechoose].forEach(b => { b.hidden = !on; });
  }

  function msNewRound(tier) {
    msTier = tier;
    const pick = msPickWord(tier);
    msWord = pick.word;
    msWordIsDigits = pick.digits;
    msRound++;
    msCur = 0; msErr = 0; msHints = 0; msDone = false;
    msStopAudio();

    msGameHome.hidden = true;
    msGame.hidden = false;
    msOverlay.classList.remove('show');
    msSetDoneUI(false);                /* 回到常规按钮组（msSetupTable 会再校正对照表键） */

    msRoundEl.textContent = '第 ' + msRound + ' 局';
    msMeta.textContent = tier.name + ' · ' + msWord.length + ' 格 · ' + tier.wpm + ' wpm';
    msErrEl.textContent = '0';
    msHintsEl.textContent = '0';
    msTimeEl.textContent = '0s';

    msBuildTape();
    msRenderKeys();
    msSetupTable();

    msT0 = Date.now();
    if (msTimer) clearInterval(msTimer);
    msTimer = setInterval(() => {
      msTimeEl.textContent = Math.floor((Date.now() - msT0) / 1000) + 's';
    }, 300);
  }

  function msBuildTape() {
    msTape.textContent = '';
    msCells = [];
    for (const ch of msWord) {
      const code = MS_CODE[ch];
      const cell = document.createElement('div');
      cell.className = 'ms-cell';
      const codeEl = document.createElement('div');
      codeEl.className = 'ms-code';
      const codeEls = [];
      for (const sym of code) {
        const s = document.createElement('i');
        s.className = 'ms-sym ' + (sym === '·' ? 'is-dot' : 'is-dash');
        codeEl.appendChild(s);
        codeEls.push(s);
      }
      const letter = document.createElement('div');
      letter.className = 'ms-letter';
      cell.appendChild(codeEl);
      cell.appendChild(letter);
      msTape.appendChild(cell);
      msCells.push({ root: cell, codeEls, letterEl: letter });
    }
    if (msCells[0]) msCells[0].root.classList.add('is-cur');
    msScrollCur();
  }

  /* 把当前格滚到可视区中间 */
  function msScrollCur() {
    const cell = msCells[msCur];
    if (!cell) return;
    const r = cell.root.getBoundingClientRect();
    const w = msTape.getBoundingClientRect();
    const target = msTape.scrollLeft + (r.left - w.left) - (w.width - r.width) / 2;
    msTape.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }

  function msRenderKeys() {
    if (!msKeys) return;
    msKeys.textContent = '';
    const keys = msWordIsDigits ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const k of keys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-key';
      b.textContent = k;
      b.addEventListener('click', () => msTypeLetter(k));
      msKeys.appendChild(b);
    }
  }

  /* 对照表只铺一次内容，这里只管显隐 */
  function msSetupTable() {
    if (msTier.table === 'show') {
      msTable.hidden = false;
      msTableBtn.hidden = true;
    } else if (msTier.table === 'toggle') {
      msTable.hidden = true;
      msTableBtn.hidden = false;
      msTableBtn.classList.remove('is-on');
    } else {
      msTable.hidden = true;
      msTableBtn.hidden = true;
    }
  }

  function msBuildTable() {
    if (!msTable || msTable.dataset.built) return;
    msTable.dataset.built = '1';
    let html = '';
    Object.keys(MS_CODE).forEach(ch => {
      html += '<span class="ms-ti"><b>' + ch + '</b><span>' + MS_CODE[ch] + '</span></span>';
    });
    msTable.innerHTML = html;
  }

  function msTypeLetter(ch, fromHint) {
    if (msDone || !msCells.length) return;
    const cell = msCells[msCur];
    if (!cell) return;
    if (ch === msWord[msCur]) {
      if (fromHint) { msHints++; msHintsEl.textContent = msHints; }
      cell.letterEl.textContent = ch;
      cell.root.classList.remove('is-cur');
      cell.root.classList.add('is-ok');
      msCur++;
      if (msCur >= msWord.length) { msEnd(); return; }
      msCells[msCur].root.classList.add('is-cur');
      msScrollCur();
    } else {
      msErr++;
      msErrEl.textContent = msErr;
      cell.root.classList.remove('is-shake');
      void cell.root.offsetWidth;
      cell.root.classList.add('is-shake');
    }
  }

  function msEnd() {
    msDone = true;
    msStopAudio();
    if (msTimer) { clearInterval(msTimer); msTimer = null; }
    const secs = Math.floor((Date.now() - msT0) / 1000);
    msOvTitle.textContent = '译完了';
    let verdict;
    if (msErr === 0 && msHints === 0) verdict = '零失误零提示——手稳耳准，标准的译电员。';
    else if (msErr === 0) verdict = '一遍就对，提示只是顺手借的。';
    else if (msHints === 0) verdict = '错了几次都扛住了，硬译下来的。';
    else verdict = '译完了就值得——多听两遍，手会越来越熟。';
    msOvText.textContent = '「' + msWord + '」 · 用时 ' + secs + ' 秒 · 错误 ' + msErr +
      ' 次 · 提示 ' + msHints + ' 次。' + verdict;
    msOverlay.classList.add('show');
  }

  /* ---------- 一条时间轴两用（见文件头说明） ---------- */
  function msTimeline(fromIdx, count) {
    const u = msUnit();
    const items = [];
    let t = 0;
    const end = Math.min(fromIdx + count, msWord.length);
    for (let i = fromIdx; i < end; i++) {
      const code = MS_CODE[msWord[i]];
      const syms = msCells[i].codeEls;
      for (let j = 0; j < code.length && j < syms.length; j++) {
        const dur = code[j] === '·' ? u : 3 * u;
        items.push({ el: syms[j], start: t, dur: dur });
        t += dur + u;              /* 符号间隔 1 */
      }
      t += 2 * u;                  /* 字母间隔共 3（符号间隔已含 1） */
    }
    return items;
  }

  function msStopAudio() {
    msTimeouts.forEach(clearTimeout);
    msTimeouts = [];
    msOscs.forEach(o => {
      try { o.stop(); } catch (_) {}
      try { o.disconnect(); } catch (_) {}
    });
    msOscs = [];
    $$('.ms-sym.is-on', msTape).forEach(el => el.classList.remove('is-on'));
  }

  function msPlay(fromIdx, count) {
    if (msGame.hidden || msDone) return;
    msStopAudio();
    const items = msTimeline(fromIdx, count);
    if (!items.length) return;
    if (!msMuted) {
      try {
        /* AudioContext 必须在播放手势里创建 / 唤醒 */
        msAc = msAc || new (window.AudioContext || window.webkitAudioContext)();
        if (msAc.state === 'suspended') msAc.resume();
        const t0 = msAc.currentTime + 0.06;
        items.forEach(it => {
          const osc = msAc.createOscillator();
          const g = msAc.createGain();
          osc.type = 'sine';
          osc.frequency.value = 600;
          const s = t0 + it.start / 1000;
          const e = t0 + (it.start + it.dur) / 1000;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.exponentialRampToValueAtTime(0.25, s + 0.005);
          g.gain.setValueAtTime(0.25, Math.max(s + 0.006, e - 0.006));
          g.gain.exponentialRampToValueAtTime(0.0001, e);
          osc.connect(g);
          g.connect(msAc.destination);
          osc.start(s);
          osc.stop(e + 0.03);
          osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (_) {} };
          msOscs.push(osc);
        });
      } catch (_) { /* 音频起不来就只剩视觉 */ }
    }
    /* 视觉高亮：同一组 (start, dur) */
    items.forEach(it => {
      msTimeouts.push(setTimeout(() => it.el.classList.add('is-on'), it.start));
      msTimeouts.push(setTimeout(() => it.el.classList.remove('is-on'), it.start + it.dur));
    });
  }

  /* ---------- 二次确认（照 bash 的 bsAsk 成式） ---------- */
  function msAsk(title, text, okText, onOk) {
    msAskTitle.textContent = title;
    msAskText.textContent = text;
    msAskOk.textContent = okText;
    msAskConfirm.classList.add('show');
    msAskOk.onclick = () => { msAskConfirm.classList.remove('show'); onOk(); };
  }

  /* 一格没填（初始状态）就不再多问 */
  function msResetRound() {
    msStopAudio();
    msNewRound(msTier);
  }

  function msToChoose() {
    msStopAudio();
    if (msTimer) { clearInterval(msTimer); msTimer = null; }
    msOverlay.classList.remove('show');
    msSetDoneUI(false);
    msShow(msGameHome);
  }

  /* ==========================================================
     五、事件绑定
     ========================================================== */
  $('#msGoTrans').addEventListener('click', () => msShow(msTransHome));
  $('#msGoGame').addEventListener('click', () => msShow(msGameHome));
  $('#msGoChart').addEventListener('click', () => { msBuildChart(); msShow(msChart); });
  $('#msGoEnc').addEventListener('click', () => { msSetDir('enc'); msShow(msTrans); });
  $('#msGoDec').addEventListener('click', () => { msSetDir('dec'); msShow(msTrans); });

  $$('#msTiers .ms-tier', msGameHome).forEach(b => b.addEventListener('click', () => {
    $$('#msTiers .ms-tier', msGameHome).forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    msTier = MS_TIERS.find(t => t.key === b.dataset.tier);
  }));

  msStart.addEventListener('click', () => msNewRound(msTier));

  msIn.addEventListener('input', msSync);
  msIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    msIn.blur();
  });

  [[msCopyIn, msIn, '输入'], [msCopyOut, msOut, '结果']].forEach(([btn, input, label]) => {
    btn.setAttribute('aria-label', '复制' + label);
    /* 拦 mousedown：别让输入框失焦、软键盘闪收 */
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => msCopy(input, label));
  });

  /* 大小写折叠栏：展开 / 收起 + 四选一 */
  msCaseToggle.addEventListener('click', () => {
    msCaseOpts.hidden = !msCaseOpts.hidden;
    msCaseToggle.setAttribute('aria-expanded', String(!msCaseOpts.hidden));
    msCaseArrow.textContent = msCaseOpts.hidden ? '▾' : '▴';
  });
  $$('#msCaseOpts .ms-case-opt').forEach(b => b.addEventListener('click', () => {
    msCaseMode = b.dataset.case;
    $$('#msCaseOpts .ms-case-opt').forEach(x => x.classList.toggle('is-on', x === b));
    msCaseCur.textContent = MS_CASE_NAMES[msCaseMode];
    msSync();                          /* 已有结果立即按新规则重排 */
  }));

  if (msPad) {
    msPadClear.addEventListener('click', () => {
      msIn.value = '';
      msPadCaret = 0;
      msSync();
      try { msIn.setSelectionRange(0, 0); } catch (_) {}
      msIn.focus();
    });
    /* 「完成」只收键盘，值留着 */
    msPadDone.addEventListener('click', () => { msPadHide(); msIn.blur(); });
  }
  msPadBind();

  msSoundBtn.addEventListener('click', () => {
    msMuted = !msMuted;
    msSoundBtn.textContent = msMuted ? '声音关' : '声音开';
    if (msMuted) msStopAudio();
  });

  msTableBtn.addEventListener('click', () => {
    msTable.hidden = !msTable.hidden;
    msTableBtn.classList.toggle('is-on', !msTable.hidden);
  });

  msHintBtn.addEventListener('click', () => {
    if (!msDone && msCells.length) msTypeLetter(msWord[msCur], true);
  });

  msPlayAll.addEventListener('click', () => msPlay(0, msWord.length));
  msPlayCur.addEventListener('click', () => msPlay(msCur, 1));

  msResetBtn.addEventListener('click', () => {
    if (msCur === 0) { msResetRound(); return; }
    msAsk('重来本局？', '当前进度会清空，重新出一题。', '重来', msResetRound);
  });
  msRechooseBtn.addEventListener('click', () => {
    if (msCur === 0) { msToChoose(); return; }
    msAsk('重选难度？', '当前进度会清空，回到选难度。', '重选难度', msToChoose);
  });

  /* 退出：停掉声音与计时，收掉浮层，回到二级菜单 */
  function msExitGame() {
    msStopAudio();
    if (msTimer) { clearInterval(msTimer); msTimer = null; }
    msOverlay.classList.remove('show');
    msAskConfirm.classList.remove('show');
    msSetDoneUI(false);
    msShow(msHome);
  }
  msExitBtn.addEventListener('click', () => {
    if (msCur === 0) { msExitGame(); return; }   /* 一格没填不多问（同重来/重选口径） */
    msAsk('退出译电？', '当前进度会清空，回到二级菜单。', '退出', msExitGame);
  });

  /* 通关确定后：顶栏换成 退出 / 再来一局 / 更改难度（都不用二次确认） */
  msOvOk.addEventListener('click', () => {
    msOverlay.classList.remove('show');
    if (msDone) msSetDoneUI(true);
  });
  msDoneExit.addEventListener('click', msExitGame);
  msDoneNew.addEventListener('click', () => msNewRound(msTier));
  msDoneRechoose.addEventListener('click', msToChoose);

  msOvNew.addEventListener('click', () => { msOverlay.classList.remove('show'); msNewRound(msTier); });
  msOvBack.addEventListener('click', msToChoose);
  msAskCancel.addEventListener('click', () => msAskConfirm.classList.remove('show'));

  /* 实体键盘直接作答：游戏页开着才响应；焦点在输入框时不抢 */
  document.addEventListener('keydown', e => {
    if (msGame.hidden || msDone || msOverlay.classList.contains('show')) return;
    if (!PAGE.classList.contains('show')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toUpperCase();
    const legal = msWordIsDigits ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (k.length === 1 && legal.indexOf(k) >= 0) {
      e.preventDefault();
      msTypeLetter(k);
    }
  });

  /* 进卡片：收软键盘、停声音；若在选档，把难度高亮对齐 */
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== PAGE) return;
    msPadHide();
    msStopAudio();
    if (msGame.hidden) {
      $$('#msTiers .ms-tier', msGameHome).forEach(b =>
        b.classList.toggle('on', b.dataset.tier === msTier.key));
    }
  });

  /* ==========================================================
     六、初始化
     ========================================================== */
  msBuildTable();
  msSetDir('enc');

})();
