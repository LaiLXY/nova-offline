/* ==========================================================================
   morse.js —— 功能页：异语道破（摩斯电码）
   --------------------------------------------------------------------------
   三个模式（二级选择 → 各自三级）：

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

     三、电码播放（第五节的 pl* 系列）
        页面主体就是「电码 → 文字」（同一个软键盘，跟着焦点决定写哪个框），
        多一条播报：播放 → 暂停 ⇄ 继续播放 / 从头播放；播报中锁死输入框，
        纸带上实时高亮正在发的符号，离开本页立刻静音。
        时间轴算法同译电挑战，但要能暂停续播，所以换成
        「播放头 + 提前 220ms 预排」的调度法（见第五节注释）。

   依赖：core.js（$ / $$ / toast）、tools.js（tool:open）、
        graph.js（gfxPadEnsureVisible / gfxClearPadScroller）、backnav.js。
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

  /* 输出大小写折叠栏（翻译页 + 播报页各一条，共用同一个 msCaseMode） */
  const msCase = $('#msCase'), msPlCase = $('#msPlCase');
  const MS_CASE_BARS = [];

  /* 电码播放（三级 A4） */
  const msPlayer = $('#msPlayer');
  const msPlIn = $('#msPlIn'), msPlOut = $('#msPlOut');
  const msPlTape = $('#msPlTape'), msPlProg = $('#msPlProg');
  const msPlToggle = $('#msPlToggle'), msPlRestart = $('#msPlRestart');
  const msPlCopyIn = $('#msPlCopyIn'), msPlCopyOut = $('#msPlCopyOut');
  const msPlSpeed = $('#msPlSpeed'), msPlSpeedBtn = $('#msPlSpeedBtn');
  const msPlSpeedOpts = $('#msPlSpeedOpts'), msPlSpeedCur = $('#msPlSpeedCur');

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
  const MS_SECTIONS = [msHome, msTransHome, msTrans, msPlayer, msChart, msGameHome, msGame];

  function msShow(sec) {
    MS_SECTIONS.forEach(s => { s.hidden = (s !== sec); });
  }

  document.addEventListener('click', e => {
    const back = e.target.closest('[data-ms-back]');
    if (!back || !PAGE.contains(back)) return;
    msStopAudio();
    plStop();                    /* 播报页退出去必须当场静音 */
    msPadHide();
    msShow(back.dataset.msBack === 'transHome' ? msTransHome : msHome);
  });

  /* 返回键（js/backnav.js）：先退内部视图 —— 编码 / 解码、播报、游戏、码表都回到
     各自的上一级，别一下把整个异语道破关掉。真退到底了才 return false，
     让 backnav 去关功能页。
     top 必须就是本页：上面还压着通关浮层时，那层该先关，不归这里管。 */
  if (typeof NovaBack !== 'undefined') {
    NovaBack.inner(top => {
      if (top !== PAGE) return false;
      if (!msTrans.hidden)   { msStopAudio(); msPadHide(); msShow(msTransHome); return true; }
      if (!msPlayer.hidden)  { plStop(); msPadHide(); msShow(msHome); return true; }
      if (!msChart.hidden)   { msShow(msHome); return true; }
      if (!msGame.hidden)    { msStopAudio(); msPadHide(); msShow(msGameHome); return true; }
      if (!msGameHome.hidden || !msTransHome.hidden) { msShow(msHome); return true; }
      return false;
    });
  }

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
     auto：句子首字母大写 + 专有名词还原 + 独立的 i → I
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

  /* ---------- 专有名词词库（只给「自动」用） ----------
     数据在 js/morse-terms.js（由名词库脚本从 terms.py 生成，别手改）。
     链路：全小写 → 句首大写 → 整词换回正确写法 → 独立 i→I。
     ⚠ 顺序不能反：先替换再跑句首大写，iOS 会被抬成 IOS。
     同形词（china 中国 / 瓷器）靠紧邻的一个邻词判，规则表见 NOVA_MORSE_HOMO。
     语境大写（provincial：前一个是 23 个省之一才写 Provincial）也走同一张表。 */
  const MS_TERMS = new Map();
  const MS_HOMO = (typeof NOVA_MORSE_HOMO !== 'undefined' && NOVA_MORSE_HOMO) || {};
  const MS_WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  const MS_TERM_RE = (function () {
    const list = (typeof NOVA_MORSE_TERMS !== 'undefined' && NOVA_MORSE_TERMS) || [];
    list.forEach(function (t) {
      const k = String(t).toLowerCase();
      if (!MS_TERMS.has(k)) MS_TERMS.set(k, t);      /* 同一拼写只留第一条 */
    });
    if (!MS_TERMS.size) return null;                  /* 词库空：整条链路不产生开销 */
    const keys = Array.from(MS_TERMS.keys())
      .sort(function (a, b) { return b.length - a.length; })   /* 长词优先：New York 不被 York 抢走 */
      .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    return new RegExp('(^|[^A-Za-z])(' + keys.join('|') + ')(?![A-Za-z])', 'gi');
  })();

  /* 取紧邻的前后两个单词（小写）。只认一个词是刻意的边界：
     a piece of china 隔着 of，仍判成中国，宁可漏判瓷器也不能把 capital of china 判错 */
  function msNeighbors(text, start, end) {
    const head = text.slice(0, start).match(MS_WORD_RE);
    const tail = text.slice(end).match(MS_WORD_RE);
    return [head ? head[head.length - 1].toLowerCase() : '',
            tail ? tail[0].toLowerCase() : ''];
  }

  /* 句首判断：从 start 往前跳过空白，遇开头或 . ! ? 即句首 */
  function msAtSentenceStart(text, start) {
    for (let i = start - 1; i >= 0; i--) {
      const code = text.charCodeAt(i);
      if (code === 32 || code === 9 || code === 10 || code === 13) continue;   /* 空格 tab LF CR */
      const c = text.charAt(i);
      return c === '.' || c === '!' || c === '?';
    }
    return true;
  }

  /* 被判成小写的词落在句首时仍要抬首字母：polish the shoes → Polish the shoes。
     只作用在「判小写」这条路上；词库写法本身带大写的（iPhone / eBay）不走这里。 */
  function msSoftLower(word, atStart) {
    return atStart ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }

  /* 同形词判大小写：判小写的邻词优先 → 判大写的邻词 → 默认写回
     ub 也可以装普名词（provincial：前一个是 23 个省之一才大写） */
  function msHomograph(key, before, after, atStart) {
    const h = MS_HOMO[key];
    if (!h) return MS_TERMS.get(key);
    if (h.la.indexOf(after) >= 0 || h.lb.indexOf(before) >= 0) return msSoftLower(key, atStart);
    if (h.ua.indexOf(after) >= 0 || h.ub.indexOf(before) >= 0) return MS_TERMS.get(key);
    return msSoftLower(h.d, atStart);
  }

  function msTermsApply(text) {
    if (!MS_TERM_RE) return text;
    return text.replace(MS_TERM_RE, function (m, pre, word, offset) {
      const key = word.toLowerCase();
      if (!MS_TERMS.has(key)) return m;
      const start = offset + pre.length;
      const nb = msNeighbors(text, start, start + word.length);
      return pre + msHomograph(key, nb[0], nb[1], msAtSentenceStart(text, start));
    });
  }

  function msApplyCase(text) {
    if (msCaseMode === 'upper') return text.toUpperCase();
    if (msCaseMode === 'lower') return text.toLowerCase();
    const s = msCaseSentence(text, false);
    if (msCaseMode !== 'auto') return s;              /* sentence：只做句首，不套词库 */
    return msTermsApply(s).replace(/\bi\b/g, 'I');
  }

  /* 折叠栏两条（翻译页 / 播报页），内容同源：改一处两处的当前值一起变 */
  function msInitCaseBar(root) {
    if (!root) return;
    const bar = {
      toggle: root.querySelector('.ms-case-toggle'),
      opts: root.querySelector('.ms-case-opts'),
      arrow: root.querySelector('.ms-case-arrow'),
      cur: root.querySelector('.ms-case-cur'),
      btns: $$('.ms-case-opt', root)
    };
    if (!bar.toggle || !bar.opts) return;
    bar.toggle.addEventListener('click', () => {
      bar.opts.hidden = !bar.opts.hidden;
      bar.toggle.setAttribute('aria-expanded', String(!bar.opts.hidden));
      if (bar.arrow) bar.arrow.textContent = bar.opts.hidden ? '▾' : '▴';
    });
    bar.btns.forEach(b => b.addEventListener('click', () => {
      msCaseMode = b.dataset.case;
      msPaintCase();
      msSync();                        /* 翻译页结果立即按新规则重排 */
      msPlSyncOut();                   /* 播报页结果同规则 */
    }));
    MS_CASE_BARS.push(bar);
  }

  function msPaintCase() {
    MS_CASE_BARS.forEach(bar => {
      bar.btns.forEach(x => x.classList.toggle('is-on', x.dataset.case === msCaseMode));
      if (bar.cur) bar.cur.textContent = MS_CASE_NAMES[msCaseMode];
    });
  }

  /* ==========================================================
     三、摩斯软键盘（外观复用 .gfx-pad；键位照设计图）
     ----------------------------------------------------------
     一个键盘两处用：「电码 → 文字」与「电码播放」的输入框长相一样、
     键位也一样，所以不铺第二套 —— 点谁就写谁（msPadTarget）。
     播报中那格输入框是锁着的，此时不弹键盘。
     ========================================================== */
  let msPadCaret = 0;
  let msPadTarget = null;            /* 软键盘当前写哪个输入框（null = 还没用过） */

  function msPadInput() { return msPadTarget || msIn; }

  /* 只有摩斯电码输入框才弹键盘：翻译页要 dec 方向，播报页播报中不给弹 */
  function msPadCanShow(el) {
    if (!el) return false;
    if (el === msPlIn) return plState !== 'playing';
    if (el === msIn) return msDir === 'dec';
    return false;
  }

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

  /* 插字后派发 input 事件 —— 同步全交给各自的 input 链路 */
  function msPadInsert(text) {
    const el = msPadInput();
    const v = el.value;
    const pos = Math.min(Math.max(msPadCaret, 0), v.length);
    el.value = v.slice(0, pos) + text + v.slice(pos);
    msPadCaret = pos + text.length;
    try { el.setSelectionRange(msPadCaret, msPadCaret); } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function msPadBackspace() {
    const el = msPadInput();
    const v = el.value;
    const pos = Math.min(Math.max(msPadCaret, 0), v.length);
    if (pos === 0) return;
    el.value = v.slice(0, pos - 1) + v.slice(pos);
    msPadCaret = pos - 1;
    try { el.setSelectionRange(msPadCaret, msPadCaret); } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function msPadShowFor(el) {
    if (!msPad || !msPadCanShow(el)) return;
    msPadTarget = el;
    msPadCaret = typeof el.selectionStart === 'number'
      ? el.selectionStart : el.value.length;
    msPadRender();
    msPad.hidden = false;
    gfxPadEnsureVisible(el, msPad);
  }

  function msPadHide() {
    if (!msPad || msPad.hidden) return;
    msPad.hidden = true;
    gfxClearPadScroller();
  }

  /* 两个摩斯输入框（翻译页 / 播报页）共用一套绑定 */
  function msPadBindInput(input) {
    if (!input) return;
    input.addEventListener('focus', () => msPadShowFor(input));
    /* 兜底：个别浏览器点一下未必派发 focus */
    input.addEventListener('click', () => {
      if (msPad && msPad.hidden) msPadShowFor(input);
      if (msPadTarget === input && typeof input.selectionStart === 'number') {
        msPadCaret = input.selectionStart;
      }
    });
    /* 失焦等一个 tick：点软键盘按钮也会先 blur 一下 */
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (msPad && msPad.contains(document.activeElement)) return;
        msPadHide();
      }, 0);
    });
    ['click', 'keyup', 'input', 'select'].forEach(ev => {
      input.addEventListener(ev, () => {
        if (msPadTarget === input && typeof input.selectionStart === 'number') {
          msPadCaret = input.selectionStart;
        }
      });
    });
  }

  function msPadBind() {
    msPadBindInput(msIn);
    msPadBindInput(msPlIn);
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

    /* 只认这一个口子进游戏：别的分节一律收掉（早先只翻 msGameHome/msGame
       两格，万一从模式选择直接开局，模式选择会跟游戏页叠着一起显示） */
    msShow(msGame);
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
     五、电码播放（电码 → 文字，逐符号播报 + 实时高亮）
     ----------------------------------------------------------
     ★ 一条时间轴两用（同译电挑战的老办法）：先把每个符号的 (start, dur)
       算成一串事件，音频按它「往前看 220ms」预排，视觉高亮读同一个播放头
       （performance.now 推），画面和声音不会各走各的。
     ★ 暂停 = 记下播放头位置 + 掐掉已排的音；继续 = 从那个位置重排，
       所以停在符号中间也能接着响、接着亮。
     ★ 退出页面（返回箭头 / 返回键 / Esc / 浏览器后退）一律 plStop()，
       见下面的 MutationObserver 与各导航分支。
     ========================================================== */
  const MS_PLAY_WPM_DEFAULT = 18;    /* 播报速度默认 18 wpm：1200/wpm = 一「点」的毫秒数 */
  let plWpm = MS_PLAY_WPM_DEFAULT;   /* 当前速度，可选 12 / 13 / 15 / 18 / 20（#msPlSpeed） */
  const MS_PLAY_LOOKAHEAD = 220;     /* 音频预排窗口（毫秒） */
  const MS_PLAY_LEAD = 0.02;         /* 给音频线程留的余量（秒） */

  let plEvents = [];                 /* { el, start, dur, li } 按时间升序 */
  let plLetters = [];                /* 每个字母的格子（高亮当前字母用） */
  let plTotal = 0;                   /* 整段时长（毫秒） */
  let plState = 'idle';              /* idle | playing | paused */
  let plPos = 0;                     /* 暂停时记住的播放头 */
  let plStartAt = 0;                 /* 播放头归零的基准（performance.now） */
  let plIdx = 0, plVi = 0;           /* 调度指针 / 高亮指针 */
  let plCurLi = -1, plOn = null;      /* 当前字母格 / 当前亮着的符号 */
  let plAc = null, plOscs = [];
  let plTick = null, plRaf = 0;
  let plLastAt = 0;                  /* 上一个音的排期时刻（秒），防止时钟抖动排乱序 */

  /* 输入归一：长划圆点统一，空格也当词间隔（粘贴带空格的电码是常态） */
  function msPlSrc() {
    return msNormMorse(msPlIn.value).replace(/\s+/g, '\\');
  }

  function msPlSyncOut() {
    const v = msPlIn.value;
    msPlOut.value = v.trim() ? msApplyCase(msDecode(msPlSrc())) : '';
  }

  /* 拆词 → 字母 → 符号，顺手把纸带铺出来（每个符号一个 <i> 供高亮） */
  function msPlRender() {
    const src = msPlSrc();
    msPlTape.textContent = '';
    plEvents = []; plLetters = []; plTotal = 0;
    plOn = null; plCurLi = -1; plIdx = 0; plVi = 0;

    const words = [];
    let word = [], letter = [];
    const closeLetter = () => { if (letter.length) { word.push(letter); letter = []; } };
    const closeWord = () => { closeLetter(); if (word.length) { words.push(word); word = []; } };
    for (const ch of src) {
      if (ch === '·' || ch === '-') letter.push(ch);
      else if (ch === '/') closeLetter();
      else closeWord();
    }
    closeWord();

    if (!words.length) {
      const empty = document.createElement('span');
      empty.className = 'ms-plempty';
      empty.textContent = '还没有可播放的电码 —— 在上面敲 · 与 - 试试';
      msPlTape.appendChild(empty);
      return;
    }

    const u = 1200 / plWpm;          /* 点 = 1 单位，划 = 3 单位 */
    let t = 0, li = 0;
    words.forEach((w, wi) => {
      if (wi > 0) t += 7 * u;        /* 词间隔 7 单位 */
      const wEl = document.createElement('span');
      wEl.className = 'ms-plword';
      w.forEach((chars, ci) => {
        if (ci > 0) t += 3 * u;      /* 字母间隔 3 单位 */
        const lEl = document.createElement('span');
        lEl.className = 'ms-plletter';
        const myLi = li++;
        chars.forEach((ch, si) => {
          if (si > 0) t += u;        /* 符号间隔 1 单位 */
          const sym = document.createElement('i');
          sym.className = 'ms-plsym ' + (ch === '·' ? 'is-dot' : 'is-dash');
          const dur = ch === '·' ? u : 3 * u;
          plEvents.push({ el: sym, start: t, dur: dur, li: myLi });
          t += dur;
          lEl.appendChild(sym);
        });
        plLetters[myLi] = lEl;
        wEl.appendChild(lEl);
      });
      msPlTape.appendChild(wEl);
    });
    plTotal = t;
  }

  /* ---------- 播放头 / 高亮 ---------- */
  function plPosNow() {
    return plState === 'playing' ? performance.now() - plStartAt : plPos;
  }

  function plSetOn(el) {
    if (plOn === el) return;
    if (plOn) plOn.classList.remove('is-on');
    plOn = el;
    if (plOn) plOn.classList.add('is-on');
  }

  function plSetLetter(li) {
    if (li === plCurLi) return;
    if (plCurLi >= 0 && plLetters[plCurLi]) plLetters[plCurLi].classList.remove('is-cur');
    plCurLi = li;
    const el = li >= 0 ? plLetters[li] : null;
    if (!el) return;
    el.classList.add('is-cur');
    msPlScrollTo(el);
  }

  /* 纸带比视野高时，把当前字母滚到中间 */
  function msPlScrollTo(el) {
    const box = msPlTape;
    if (!box || !box.clientHeight) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top >= b.top + 4 && r.bottom <= b.bottom - 4) return;
    box.scrollTop += (r.top - b.top) - box.clientHeight / 2 + r.height / 2;
  }

  function plHighlight(pos) {
    while (plVi < plEvents.length && plEvents[plVi].start + plEvents[plVi].dur <= pos) plVi++;
    const next = plEvents[plVi];
    plSetOn(next && next.start <= pos ? next.el : null);
    /* 间隙里仍停在刚发完的字母上，别提前跳到下一个 */
    let li = -1;
    if (next && next.start <= pos) li = next.li;
    else if (plVi > 0) li = plEvents[plVi - 1].li;
    plSetLetter(li);
  }

  function plFrame() {
    if (plState !== 'playing') return;
    const pos = plPosNow();
    plHighlight(pos);
    if (plTotal > 0) {
      msPlProg.style.width = (Math.min(1, pos / plTotal) * 100).toFixed(2) + '%';
    }
    if (pos >= plTotal) { plStop(); return; }
    plRaf = requestAnimationFrame(plFrame);
  }

  /* ---------- 音频（600Hz 正弦 + 5ms 包络，同译电挑战） ---------- */
  function plEnsureAudio() {
    try {
      plAc = plAc || new (window.AudioContext || window.webkitAudioContext)();
      if (plAc.state === 'suspended') plAc.resume();
      return plAc;
    } catch (_) { return null; }
  }

  function plTone(at, dur) {
    const ac = plAc;
    if (!ac || !(dur > 0)) return;
    const end = at + dur;
    const ramp = Math.min(0.006, dur * 0.4);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = 600;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + ramp);
    g.gain.setValueAtTime(0.25, Math.max(at + ramp, end - ramp));
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(at + ramp + 0.002, end));
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(at);
    osc.stop(end + 0.04);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (_) {} };
    plOscs.push(osc);
    /* 长文本会堆很多已经响完的句柄，顺手清一清 */
    if (plOscs.length > 80) plOscs = plOscs.filter(o => o.playbackState !== 'finished');
  }

  /* 往前看一小段，把还没排的音排进去（每 40ms 跑一次）。
     ⚠ base 一个 tick 只取一次：音频时钟是按块跳的，逐事件重取会让相邻
     两个符号的起点差出几毫秒、甚至前后颠倒；plLastAt 再兜一道单调。 */
  function plSchedule() {
    if (plState !== 'playing' || !plAc) return;
    const base = plAc.currentTime + MS_PLAY_LEAD;
    const pos = plPosNow();
    const until = pos + MS_PLAY_LOOKAHEAD;
    while (plIdx < plEvents.length) {
      const ev = plEvents[plIdx];
      if (ev.start > until) break;
      /* 从符号中间续播：前半截已经响过，只补剩下的 */
      const skip = Math.max(0, pos - ev.start);
      const dur = ev.dur - skip;
      if (dur > 0) {
        const at = Math.max(plLastAt, base + Math.max(0, ev.start - pos) / 1000);
        plLastAt = at;
        plTone(at, dur / 1000);
      }
      plIdx++;
    }
  }

  function plKillTimers() {
    if (plTick) { clearInterval(plTick); plTick = null; }
    if (plRaf) { cancelAnimationFrame(plRaf); plRaf = 0; }
    plLastAt = 0;
    plOscs.forEach(o => {
      try { o.stop(); } catch (_) {}
      try { o.disconnect(); } catch (_) {}
    });
    plOscs = [];
  }

  function plPaint() {
    const has = plEvents.length > 0;
    const st = plState;
    msPlToggle.textContent = st === 'playing' ? '暂停' : (st === 'paused' ? '继续播放' : '播放');
    msPlToggle.classList.toggle('is-on', st === 'playing');
    msPlToggle.disabled = !has;
    msPlRestart.hidden = st !== 'paused';   /* 从头播放只在暂停时露出 */
    msPlIn.readOnly = st === 'playing';     /* 播报途中锁住输入框 */
    msPlayer.classList.toggle('is-playing', st === 'playing');
    if (st === 'playing') msPadHide();
  }

  /* 从 from 毫秒处起播（0 = 从头，暂停后传 plPos 即续播） */
  function plStart(from) {
    if (!plEvents.length) return;
    plKillTimers();
    plEnsureAudio();
    plPos = Math.max(0, Math.min(from || 0, plTotal));
    plStartAt = performance.now() - plPos;
    plIdx = 0;
    while (plIdx < plEvents.length && plEvents[plIdx].start + plEvents[plIdx].dur <= plPos) plIdx++;
    plVi = plIdx;
    plState = 'playing';
    plPaint();
    plSchedule();
    plTick = setInterval(plSchedule, 40);
    plRaf = requestAnimationFrame(plFrame);
    msPlProg.style.width = (plTotal ? Math.min(1, plPos / plTotal) * 100 : 0).toFixed(2) + '%';
  }

  function plPause() {
    if (plState !== 'playing') return;
    plPos = Math.min(plPosNow(), plTotal);
    plState = 'paused';
    plKillTimers();
    plPaint();
  }

  /* 停：静音 + 指针归零（播完 / 退出页面 / 改了电码都走这里） */
  function plStop() {
    plKillTimers();
    plState = 'idle';
    plPos = 0; plIdx = 0; plVi = 0;
    if (plOn) { plOn.classList.remove('is-on'); plOn = null; }
    plSetLetter(-1);
    if (msPlProg) msPlProg.style.width = '0%';
    plSpeedClose();                    /* 停下也把速度下拉收掉，别留在页面上 */
    plPaint();
  }

  /* ---------- 播放速度（返回键右边的下拉；12 / 13 / 15 / 18 / 20 wpm） ---------- */
  function plSpeedSync() {
    msPlSpeedCur.textContent = plWpm + ' wpm';
    $$('.ms-speed-opt', msPlSpeedOpts).forEach(b => {
      const on = Number(b.dataset.wpm) === plWpm;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  function plSpeedClose() {
    if (!msPlSpeedOpts || msPlSpeedOpts.hidden) return false;
    msPlSpeedOpts.hidden = true;
    msPlSpeedBtn.setAttribute('aria-expanded', 'false');
    return true;
  }

  /* ==========================================================
     六、事件绑定
     ========================================================== */
  $('#msGoTrans').addEventListener('click', () => msShow(msTransHome));
  $('#msGoGame').addEventListener('click', () => msShow(msGameHome));
  $('#msGoPlay').addEventListener('click', () => { plStop(); msShow(msPlayer); });
  $('#msGoChart').addEventListener('click', () => { msBuildChart(); msShow(msChart); });
  $('#msGoEnc').addEventListener('click', () => { msSetDir('enc'); msShow(msTrans); });
  $('#msGoDec').addEventListener('click', () => { msSetDir('dec'); msShow(msTrans); });

  /* ---------- 播报页：输入 → 结果 + 时间轴 ---------- */
  msPlIn.addEventListener('input', () => {
    plStop();                 /* 电码变了，原来的时间轴作废 */
    msPlRender();
    msPlSyncOut();
    plPaint();
  });
  msPlIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    msPlIn.blur();
  });

  msPlToggle.addEventListener('click', () => {
    if (plState === 'playing') { plPause(); return; }
    if (!plEvents.length) {
      toast('info', '还没有电码可播放', '先在上面敲几个 · 与 -', 'morse-play');
      return;
    }
    plStart(plState === 'paused' ? plPos : 0);
  });

  msPlRestart.addEventListener('click', () => {
    if (!plEvents.length) return;
    plStart(0);
  });

  /* ---------- 播报速度：换速 → 先停，再按新时长重排整条时间轴 ---------- */
  msPlSpeedBtn.addEventListener('click', () => {
    const willOpen = msPlSpeedOpts.hidden;
    msPlSpeedOpts.hidden = !willOpen;
    msPlSpeedBtn.setAttribute('aria-expanded', String(willOpen));
  });

  $$('.ms-speed-opt', msPlSpeedOpts).forEach(b => b.addEventListener('click', () => {
    plSpeedClose();
    const w = Number(b.dataset.wpm);
    if (!w || w === plWpm) return;
    const wasPlaying = plState === 'playing';
    plWpm = w;
    plSpeedSync();
    if (!plEvents.length) return;       /* 还没敲电码：只记住这个速度 */
    plStop();                            /* 时间轴要按新单位重算，先停下来 */
    msPlRender();
    plPaint();
    if (wasPlaying) toast('info', '已换成 ' + w + ' wpm', '播报从头开始', 'morse-wpm');
  }));

  /* 点别处收下拉（按钮自己的 click 已先展开，contains 判定会放行） */
  document.addEventListener('click', e => {
    if (!msPlSpeed.contains(e.target)) plSpeedClose();
  });

  /* Esc 先收下拉：window 捕获早于 tools.js 的 document 捕获，收得掉就吃掉这一下 */
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!plSpeedClose()) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /* 播报途中把功能页关掉（返回箭头 / Esc / 浏览器后退）→ 当场静音。
     closeTool 不广播事件，所以盯 .show 这个类。 */
  new MutationObserver(() => {
    if (PAGE.classList.contains('show')) return;
    plStop();
    msStopAudio();
    msPadHide();
  }).observe(PAGE, { attributes: true, attributeFilter: ['class'] });

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

  [[msCopyIn, msIn, '输入'], [msCopyOut, msOut, '结果'],
   [msPlCopyIn, msPlIn, '输入'], [msPlCopyOut, msPlOut, '结果']].forEach(([btn, input, label]) => {
    btn.setAttribute('aria-label', '复制' + label);
    /* 拦 mousedown：别让输入框失焦、软键盘闪收 */
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => msCopy(input, label));
  });

  /* 大小写折叠栏：翻译页 / 播报页各一条，同一套逻辑 */
  msInitCaseBar(msCase);
  msInitCaseBar(msPlCase);
  msPaintCase();

  if (msPad) {
    msPadClear.addEventListener('click', () => {
      const el = msPadInput();
      el.value = '';
      msPadCaret = 0;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      try { el.setSelectionRange(0, 0); } catch (_) {}
      el.focus();
    });
    /* 「完成」只收键盘，值留着 */
    msPadDone.addEventListener('click', () => { msPadHide(); msPadInput().blur(); });
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
    plStop();
    if (msGame.hidden) {
      $$('#msTiers .ms-tier', msGameHome).forEach(b =>
        b.classList.toggle('on', b.dataset.tier === msTier.key));
    }
  });

  /* ==========================================================
     七、初始化
     ========================================================== */
  msBuildTable();
  msSetDir('enc');
  plSpeedSync();
  msPlRender();
  plPaint();
  /* 播报页的输入框同样只认自绘软键盘（触摸设备屏蔽系统键盘） */
  if (typeof Device !== 'undefined' && !Device.isPC()) {
    msPlIn.setAttribute('inputmode', 'none');
  }

})();
