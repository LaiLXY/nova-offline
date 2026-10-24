/* ==========================================================================
   hamming.js —— 功能页：一位之差（汉明）

   三种模式（页面骨架照「异语道破」的子卡片成式，壳样式复用 .ms-*）：
     · 纠错挑战  先摆好一个合法码字，再偷偷翻转其中一位（保证恰好一位），
                 玩家点出被翻转的那位。
     · 距离挑战  上下两组等长 0/1 串，玩家给「上下不一样」的列做标记，
                 全部标对过关；两组至少差 3 位，不会一组不差。
     · 编码挑战  数据位锁死，玩家把校验位（2 的幂位）摆到
                 「每组校验圈里 1 的个数是偶数」（偶校验）。

   ★ 汉明码约定（index.html 的「码字约定」同款口径）：
       · 位置从 1 数起；2 的幂（1、2、4、8）是校验位，其余是数据位
       · 校验位 P_p 管的位置 = 满足 (位置 & p) !== 0 的那些格
         （位置号转二进制后这一位是 1 的都归它管）
       · 偶校验：每一组圈里 1 的个数是偶数，等价于整组异或 = 0

   ★ 判题全在浏览器里做，一次请求都不发，不记战绩 —— 和异或法则
     一样是纯前端页。

   ★ 二次确认尺度（对齐 sl/br/qn/fc/bs/2048 的统一口径）：
       · 对局中「换一道」问一句（没动过的局直接换，只弹 toast）
       · 「放弃」永远问
       · 已经收尾（结算浮层 / 回看）走顶栏出口，不问

   ★ 结算浮层 #hmOverlay 用 .ms-overlay 壳（.show 开关）。
     手机返回键会把它当一层历史退掉（backnav 的 NB_LAYER_SEL 里
     已有 .ms-overlay）—— 所以 NB_CLOSERS 里登记了 hmOverlay →
     hmDismissOverlay：按返回关浮层 = 点了主按钮（过关 → 回看；
     放弃 → 看答案），和 qnOverlay 一个路子。

   依赖 core.js（$ / toast）与 tools.js（tool:open 事件）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const hmPage        = $('#toolHamming');
const hmHome        = $('#hmHome');
const hmErrSetup    = $('#hmErrSetup');
const hmErrGame     = $('#hmErrGame');
const hmDistSetup   = $('#hmDistSetup');
const hmDistGame    = $('#hmDistGame');
const hmEncSetup    = $('#hmEncSetup');
const hmEncGame     = $('#hmEncGame');
const hmErrLensEl   = $('#hmErrLens');
const hmDistLensEl  = $('#hmDistLens');
const hmEncLensEl   = $('#hmEncLens');
const hmErrBoardEl  = $('#hmErrBoard');
const hmDistAEl     = $('#hmDistBoardA');
const hmDistBEl     = $('#hmDistBoardB');
const hmEncBoardEl  = $('#hmEncBoard');
const hmEncGroupsEl = $('#hmEncGroups');
const hmOverlay     = $('#hmOverlay');
const hmOvTitle     = $('#hmOvTitle');
const hmOvText      = $('#hmOvText');
const hmOvPrimary   = $('#hmOvPrimary');
const hmAskConfirm  = $('#hmAskConfirm');
const hmAskTitle    = $('#hmAskTitle');
const hmAskText     = $('#hmAskText');
const hmAskOk       = $('#hmAskOk');
const hmAskCancel   = $('#hmAskCancel');

/* ---------- 常量 ---------- */
/* 汉明码：长度 n = 2^r - 1，校验位在 1、2、4、…、2^(r-1) */
function hmParityPositions(len) {
  const ps = [];
  for (let p = 1; p <= len; p *= 2) ps.push(p);
  return ps;
}
const HM_IS_PARITY = (len, pos) => (pos & (pos - 1)) === 0;   // 2 的幂（pos ≤ len 时恒成立）

/* ---------- 状态 ---------- */
let hmMode   = null;                 // 'err' | 'dist' | 'enc'（当前对局属于哪个模式）
let hmLen    = { err: 7, dist: 12, enc: 7 };   // 各模式记住的规格（回到选规格页时高亮用它）
let hmRound  = { err: 0, dist: 0, enc: 0 };    // 各模式第几局（显示用）
let hmOver   = false;                // 本局结束（过关 / 放弃）
let hmWon    = false;                // 结束的方式：过关？（决定浮层主按钮的去向）
let hmRevealed = false;              // 已经进回看 / 答案视图（顶栏换过出口、盘面涂过色）
let hmDirty  = false;                // 这局动过没有（「换一道」要不要问）
let hmMiss   = 0;                    // 本局失误次数

let hmErrData = null;                // { ans, bits, errPos }（下标 1..len）
let hmSel     = 0;                   // 纠错：选中的位置（0 = 没选）

let hmDistData = null;               // { a, b, diff:Set }（下标 1..len）
let hmMarks    = new Set();          // 距离：标了的列

let hmEncData  = null;               // { bits, ansParity }（bits 的校验位显示当前摆的值）
let hmParity   = {};                 // 编码：玩家摆的校验位 p → 0/1
let hmGroupOn  = new Set();          // 编码：点亮的校验组（P1/P2/P4/P8）

let hmAskCb   = null;                // 二次确认点「确定」后要跑的函数
let hmAskKind = '';                  // 'new' | 'quit'（只是留着，方便排查）

/* ==========================================================
   一、码字工具
   ========================================================== */

/** 偶校验编码：把 data（位置 → 0/1）铺进 1..len，
 *  校验位取「它管的其余位置」的异或（整组异或 = 0）。 */
function hmEncode(len, data) {
  const bits = new Array(len + 1).fill(0);
  for (let pos = 1; pos <= len; pos++) if (!HM_IS_PARITY(len, pos)) bits[pos] = data[pos] ? 1 : 0;
  hmParityPositions(len).forEach(p => {
    let x = 0;
    for (let pos = 1; pos <= len; pos++) {
      if (pos !== p && (pos & p)) x ^= bits[pos];
    }
    bits[p] = x;
  });
  return bits;
}

/** 一组校验圈现在的异或（0 = 偶数个 1，合法） */
function hmGroupXor(bits, p, len) {
  let x = 0;
  for (let pos = 1; pos <= len; pos++) if (pos & p) x ^= bits[pos];
  return x;
}

/* ==========================================================
   二、出题（先有答案，再出题）
   ========================================================== */

/** 纠错：合法码字 + 恰好翻转一位 */
function hmGenErr(len) {
  const data = {};
  for (let pos = 1; pos <= len; pos++) if (!HM_IS_PARITY(len, pos)) data[pos] = Math.random() < 0.5 ? 0 : 1;
  const ans  = hmEncode(len, data);
  const bits = ans.slice();
  const errPos = 1 + Math.floor(Math.random() * len);
  bits[errPos] ^= 1;
  return { ans, bits, errPos };
}

/** 距离：两组等长串，差 k 位（k ≥ 3，保证不会一组不差） */
function hmGenDist(len) {
  const k = 3 + Math.floor(Math.random() * (len - 3));   // len=8 → 3..7，len=16 → 3..15
  const a = new Array(len + 1).fill(0);
  for (let pos = 1; pos <= len; pos++) a[pos] = Math.random() < 0.5 ? 0 : 1;

  const pool = [];
  for (let pos = 1; pos <= len; pos++) pool.push(pos);
  for (let i = pool.length - 1; i > 0; i--) {            // 洗牌后取前 k 个
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const diff = new Set(pool.slice(0, k));
  const b = a.slice();
  diff.forEach(pos => { b[pos] ^= 1; });
  return { a, b, diff };
}

/** 编码：随机数据位 + 标准校验位答案。
 *  ★ 保证答案校验位不全为 0：全 0 的题开局就已经是合法码字，没意思。 */
function hmGenEnc(len) {
  for (let t = 0; t < 50; t++) {
    const data = {};
    for (let pos = 1; pos <= len; pos++) if (!HM_IS_PARITY(len, pos)) data[pos] = Math.random() < 0.5 ? 0 : 1;
    const ans = hmEncode(len, data);
    const anyOne = hmParityPositions(len).some(p => ans[p] === 1);
    if (anyOne) return { data, ans };
  }
  /* 50 次全 0 的概率是 (1/2)^{150} 量级，真兜到就摆一组必然有 1 的数据 */
  const data = {};
  for (let pos = 1; pos <= len; pos++) if (!HM_IS_PARITY(len, pos)) data[pos] = 1;
  return { data, ans: hmEncode(len, data) };
}

/* ==========================================================
   三、格子渲染
   ========================================================== */

/** 单个位格子：上面小位置号、下面大位值 */
function hmMakeCell(pos, val, parity) {
  const d = document.createElement('div');
  d.className = 'hm-cell' + (parity ? ' is-parity' : '');
  d.dataset.pos = pos;

  const tag = document.createElement('span');
  tag.className = 'hm-pos';
  tag.textContent = parity ? 'P' + pos : pos;

  const bit = document.createElement('span');
  bit.className = 'hm-bit';
  bit.textContent = val;

  d.appendChild(tag);
  d.appendChild(bit);
  return d;
}

/** 铺纠错 / 编码那种一排位格子（15 位折成每行 8 列） */
function hmPaintBoard(el, bits, opts) {
  const len = bits.length - 1;
  el.style.setProperty('--hm-cols', len > 9 ? 8 : len);
  el.textContent = '';
  for (let pos = 1; pos <= len; pos++) {
    const parity = HM_IS_PARITY(len, pos);
    const val = opts && opts.values ? opts.values(pos, bits[pos]) : bits[pos];
    const cell = hmMakeCell(pos, val, parity);
    if (opts && opts.cls) {
      const extra = opts.cls(pos, parity);
      if (extra) cell.classList.add(extra);
    }
    el.appendChild(cell);
  }
}

/** 铺距离模式的一组（不标校验位；reveal 时用 is-err 红标差异列） */
function hmPaintDistRow(el, bits, marked, cls) {
  const len = bits.length - 1;
  el.style.setProperty('--hm-cols', len > 9 ? 8 : len);
  el.textContent = '';
  for (let pos = 1; pos <= len; pos++) {
    const cell = hmMakeCell(pos, bits[pos], false);
    if (marked && marked.has(pos)) cell.classList.add(cls || 'is-mark');
    el.appendChild(cell);
  }
}

/** 抖一下盘面（答错反馈，复用摩斯那把 msShake 键帧） */
function hmShake(el) {
  el.classList.remove('is-shake');
  void el.offsetWidth;                 // 强制回流，连错两次也能重放动画
  el.classList.add('is-shake');
}

/* ==========================================================
   四、页面切换 / 顶栏
   ========================================================== */

const HM_SECTIONS = ['hmHome', 'hmErrSetup', 'hmErrGame', 'hmDistSetup', 'hmDistGame', 'hmEncSetup', 'hmEncGame', 'hmRule'];

function hmShow(id) {
  HM_SECTIONS.forEach(s => { $('#' + s).hidden = (s !== id); });
}

/** 顶栏出口切换：对局中 = 换一道 / 放弃；收尾后 = 再来一局 / 重选规格 */
function hmSwapHead(prefix, ended) {
  $('#' + prefix + 'Acts').hidden = ended;
  $('#' + prefix + 'ActsAns').hidden = !ended;
}

/* ==========================================================
   五、结算浮层 / 二次确认
   ========================================================== */

function hmWin(text) {
  hmOver = true;
  hmWon = true;
  hmOvTitle.textContent = '过关！';
  hmOvText.textContent = text;
  hmOvPrimary.textContent = '确 认';
  /* 过关这一路不需要额外出口（收浮层后顶栏就有），只留一颗确认 */
  $('#hmOvExtra').hidden = true;
  $('#hmOvExit').hidden = true;
  hmOverlay.classList.add('show');
}

function hmAbandon() {
  hmOver = true;
  hmWon = false;
  hmOvTitle.textContent = '已放弃这一局';
  hmOvText.textContent = '本局已结束。可查看本题答案，也可再来一局、重选规格，或返回选择玩法。';
  hmOvPrimary.textContent = '查看答案';
  /* 放弃这一路给足出口：查看答案 / 再来一局 / 重选规格（按模式换字） / 退出 */
  $('#hmOvRechoose').textContent = hmMode === 'dist' ? '重选位数' : '重选码长';
  $('#hmOvExtra').hidden = false;
  $('#hmOvExit').hidden = false;
  hmOverlay.classList.add('show');
}

/** 关结算浮层 = 点了主按钮（主按钮点按和手机返回键都走这里）：
 *  过关 → 回看自己的答案；放弃 → 直接看答案。 */
function hmDismissOverlay() {
  hmOverlay.classList.remove('show');
  hmReveal();
}

/** 回看 / 答案视图：盘面涂色 + 顶栏换出口 + tip 换话（按模式分发） */
function hmReveal() {
  if (hmRevealed) return;
  hmRevealed = true;
  if (hmMode === 'err')  hmErrReveal();
  if (hmMode === 'dist') hmDistReveal();
  if (hmMode === 'enc')  hmEncReveal();
}

/* 二次确认（换一道 / 放弃共用一个壳） */
function hmAsk(kind, title, text, okLabel, cb) {
  hmAskKind = kind;
  hmAskCb = cb;
  hmAskTitle.textContent = title;
  hmAskText.textContent = text;
  hmAskOk.textContent = okLabel;
  hmAskConfirm.classList.add('show');
}

function hmCloseAsk() {
  hmAskConfirm.classList.remove('show');
  hmAskCb = null;
}

/* Esc = 关最上面那一层。
   挂在 window 捕获阶段，抢在 tools.js 的「Esc = 返回」前面：
     · 二次确认开着 → 只收确认框（否则会连整页一起退掉）
     · 结算浮层开着 → 收浮层并按主按钮的去向收尾（过关回看 / 放弃看答案），
       否则 tools.js 会把整个功能页关掉、浮层留在主页上面。 */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (hmAskConfirm.classList.contains('show')) {
    e.stopPropagation();
    e.preventDefault();
    hmCloseAsk();
    return;
  }
  if (hmOverlay.classList.contains('show')) {
    e.stopPropagation();
    e.preventDefault();
    hmDismissOverlay();
  }
}, true);

hmAskOk.addEventListener('click', () => {
  const cb = hmAskCb;
  hmCloseAsk();
  if (cb) cb();
});
hmAskCancel.addEventListener('click', hmCloseAsk);
hmAskConfirm.addEventListener('click', e => {
  if (e.target === hmAskConfirm) hmCloseAsk();
});

/* ==========================================================
   六、模式 A：纠错
   ========================================================== */

function hmErrNewRound() {
  hmCloseAsk();
  const len = hmLen.err;
  hmErrData = hmGenErr(len);
  hmSel = 0;
  hmMiss = 0;
  hmOver = false;
  hmWon = false;
  hmRevealed = false;
  hmDirty = false;
  hmRound.err++;

  hmOverlay.classList.remove('show');
  hmSwapHead('hmErr', false);
  $('#hmErrRound').textContent = '第 ' + hmRound.err + ' 局';
  $('#hmErrMeta').textContent = '汉明(' + len + ',' + (len - hmParityPositions(len).length) + ') 码';
  $('#hmErrTip').textContent = '被翻转的只有一位 · 点一格选中，再按下面的提交键';
  $('#hmErrSubmit').hidden = false;

  hmPaintBoard(hmErrBoardEl, hmErrData.bits);
  hmShow('hmErrGame');
}

function hmErrReveal() {
  hmSel = 0;
  hmSwapHead('hmErr', true);
  $('#hmErrTip').textContent = '被翻转的是第 ' + hmErrData.errPos + ' 位 · 盘面已锁定';
  $('#hmErrSubmit').hidden = true;
  hmPaintBoard(hmErrBoardEl, hmErrData.bits, {
    cls: pos => (pos === hmErrData.errPos ? 'is-err' : ''),
  });
}

hmErrBoardEl.addEventListener('click', e => {
  if (hmOver) return;
  const cell = e.target.closest('.hm-cell');
  if (!cell) return;
  hmDirty = true;
  hmSel = +cell.dataset.pos;
  Array.prototype.forEach.call(hmErrBoardEl.children, c =>
    c.classList.toggle('is-sel', +c.dataset.pos === hmSel));
});

$('#hmErrSubmit').addEventListener('click', () => {
  if (hmOver) return;
  if (!hmSel) { toast('err', '先点选一位', '觉得哪位被翻转过，就先点上它'); return; }
  if (hmSel === hmErrData.errPos) {
    const tries = hmMiss + 1;
    hmWin(tries === 1
      ? '第 ' + hmSel + ' 位为翻转位。一次提交即命中。'
      : '第 ' + hmSel + ' 位为翻转位。本局共提交 ' + tries + ' 次。');
  } else {
    hmMiss++;
    toast('err', '第 ' + hmSel + ' 位无误', '重新核对各校验组内 1 的个数');
    hmShake(hmErrBoardEl);
    const wrong = hmErrBoardEl.querySelector('.hm-cell[data-pos="' + hmSel + '"]');
    if (wrong) {
      wrong.classList.add('is-wrong');
      setTimeout(() => wrong.classList.remove('is-wrong'), 450);
    }
  }
});

/* ==========================================================
   七、模式 B：距离
   ========================================================== */

function hmDistNewRound() {
  hmCloseAsk();
  const len = hmLen.dist;
  hmDistData = hmGenDist(len);
  hmMarks = new Set();
  hmMiss = 0;
  hmOver = false;
  hmWon = false;
  hmRevealed = false;
  hmDirty = false;
  hmRound.dist++;

  hmOverlay.classList.remove('show');
  hmSwapHead('hmDist', false);
  $('#hmDistRound').textContent = '第 ' + hmRound.dist + ' 局';
  $('#hmDistMeta').textContent = '每组 ' + len + ' 位';
  $('#hmDistTip').textContent = '点格子给这一列做标记 · 再点一次取消';
  $('#hmDistSubmit').hidden = false;

  hmPaintDistRow(hmDistAEl, hmDistData.a);
  hmPaintDistRow(hmDistBEl, hmDistData.b);
  hmShow('hmDistGame');
}

function hmDistReveal() {
  hmSwapHead('hmDist', true);
  const k = hmDistData.diff.size;
  $('#hmDistTip').textContent = '一共差 ' + k + ' 位 · 盘面已锁定';
  $('#hmDistSubmit').hidden = true;
  hmPaintDistRow(hmDistAEl, hmDistData.a, hmDistData.diff, 'is-err');
  hmPaintDistRow(hmDistBEl, hmDistData.b, hmDistData.diff, 'is-err');
}

/** 点任意一格 = 给这一列做 / 取消标记 */
function hmDistToggle(e) {
  if (hmOver) return;
  const cell = e.target.closest('.hm-cell');
  if (!cell) return;
  const pos = +cell.dataset.pos;
  hmDirty = true;
  if (hmMarks.has(pos)) hmMarks.delete(pos); else hmMarks.add(pos);
  hmPaintDistRow(hmDistAEl, hmDistData.a, hmMarks);
  hmPaintDistRow(hmDistBEl, hmDistData.b, hmMarks);
}
hmDistAEl.addEventListener('click', hmDistToggle);
hmDistBEl.addEventListener('click', hmDistToggle);

$('#hmDistSubmit').addEventListener('click', () => {
  if (hmOver) return;
  const diff = hmDistData.diff;
  const same = [...hmMarks].every(p => diff.has(p)) && hmMarks.size === diff.size;
  if (same) {
    hmWin('两组的汉明距离为 ' + diff.size + ' 位。' +
      (hmMiss ? '本局共提交 ' + (hmMiss + 1) + ' 次。' : '一次提交即命中。'));
  } else {
    hmMiss++;
    const hint = hmMarks.size === diff.size ? '个数相符，位置有误'
               : hmMarks.size > diff.size ? '标记多于实际，请复核'
               : '仍有漏标的列';
    toast('err', '标记与实际不符', hint);
    hmShake(hmDistAEl);
    hmShake(hmDistBEl);
  }
});

/* ==========================================================
   八、模式 C：编码
   ========================================================== */

function hmEncNewRound() {
  hmCloseAsk();
  const len = hmLen.enc;
  hmEncData = hmGenEnc(len);
  hmParity = {};
  hmParityPositions(len).forEach(p => { hmParity[p] = 0; });
  hmGroupOn = new Set();
  hmMiss = 0;
  hmOver = false;
  hmWon = false;
  hmRevealed = false;
  hmDirty = false;
  hmRound.enc++;

  /* P8 的 chip 在 (7,4) 码里管不到任何格，藏掉免得误导 */
  Array.prototype.forEach.call(hmEncGroupsEl.children, chip => {
    const p = +chip.dataset.p;
    chip.hidden = p > len;
    chip.classList.remove('is-on');
  });

  hmOverlay.classList.remove('show');
  hmSwapHead('hmEnc', false);
  $('#hmEncRound').textContent = '第 ' + hmRound.enc + ' 局';
  $('#hmEncMeta').textContent = '汉明(' + len + ',' + (len - hmParityPositions(len).length) + ') 码';
  $('#hmEncTip').textContent = '数据位锁死 · 点虚线格翻转校验位，摆到每组都是偶数个 1';
  $('#hmEncSubmit').hidden = false;

  hmEncPaint();
  hmShow('hmEncGame');
}

/** 编码模式的当前码字：数据位 + 玩家摆的校验位 */
function hmEncBits() {
  const len = hmEncData.ans.length - 1;
  const bits = hmEncData.ans.slice();
  hmParityPositions(len).forEach(p => { bits[p] = hmParity[p]; });
  return bits;
}

/** 编码盘：数据位显示锁死的值，校验位显示玩家当前摆的值 */
function hmEncPaint(extraCls) {
  hmPaintBoard(hmEncBoardEl, hmEncBits(), {
    cls: pos => (extraCls && extraCls(pos)) || '',
  });
}

function hmEncReveal() {
  hmSwapHead('hmEnc', true);
  const len = hmEncData.ans.length - 1;
  const wrong = hmParityPositions(len).filter(p => hmParity[p] !== hmEncData.ans[p]).length;
  $('#hmEncTip').textContent = hmWon
    ? '校验位全对 · 盘面已锁定'
    : '有 ' + wrong + ' 个校验位摆得不对，已换成正确答案 · 盘面已锁定';
  $('#hmEncSubmit').hidden = true;
  hmGroupOn = new Set();
  Array.prototype.forEach.call(hmEncGroupsEl.children, chip => chip.classList.remove('is-on'));
  hmParity = {};
  hmParityPositions(len).forEach(p => { hmParity[p] = hmEncData.ans[p]; });
  hmEncPaint(pos => (HM_IS_PARITY(len, pos) ? 'is-ans' : ''));
}

/* 点校验位翻转它 */
hmEncBoardEl.addEventListener('click', e => {
  if (hmOver) return;
  const cell = e.target.closest('.hm-cell');
  if (!cell) return;
  const pos = +cell.dataset.pos;
  if (!HM_IS_PARITY(hmEncData.ans.length - 1, pos)) {
    toast('info', '数据位不可修改', '本模式仅调整校验位（虚线格）');
    return;
  }
  hmDirty = true;
  hmParity[pos] ^= 1;
  hmEncPaint();
});

/* 点 P1/P2/P4/P8：高亮它管的那些格（只是看圈） */
hmEncGroupsEl.addEventListener('click', e => {
  if (hmOver) return;
  const chip = e.target.closest('.hm-group-chip');
  if (!chip) return;
  const p = +chip.dataset.p;
  if (hmGroupOn.has(p)) hmGroupOn.delete(p); else hmGroupOn.add(p);
  chip.classList.toggle('is-on', hmGroupOn.has(p));
  const len = hmEncData.ans.length - 1;
  hmEncPaint(pos => (hmGroupOn.has(p) && (pos & p)) || [...hmGroupOn].some(g => pos & g) ? 'is-group' : '');
});

$('#hmEncSubmit').addEventListener('click', () => {
  if (hmOver) return;
  const len = hmEncData.ans.length - 1;
  const bad = hmParityPositions(len).filter(p => hmGroupXor(hmEncBits(), p, len) !== 0);
  if (!bad.length) {
    hmWin('码字合法：各组校验圈内 1 的个数均为偶数。' +
      (hmMiss ? '本局共提交 ' + (hmMiss + 1) + ' 次。' : '校验位一次摆对。'));
  } else {
    hmMiss++;
    toast('err', '码字尚不合法', 'P' + bad.join('、P') + ' 组内 1 的个数为奇数');
    hmShake(hmEncBoardEl);
  }
});

/* ==========================================================
   九、入口 / 换题 / 放弃 / 再来一局
   ========================================================== */

/* 模式选择 → 各自的选规格页 */
$('#hmGoErr').addEventListener('click',  () => { hmMode = 'err';  hmShow('hmErrSetup'); });
$('#hmGoDist').addEventListener('click', () => { hmMode = 'dist'; hmShow('hmDistSetup'); });
$('#hmGoEnc').addEventListener('click',  () => { hmMode = 'enc';  hmShow('hmEncSetup'); });
$('#hmGoRule').addEventListener('click', () => { hmShow('hmRule'); });

/* 选规格页的「‹ 返回」回模式选择 */
document.addEventListener('click', e => {
  const back = e.target.closest('[data-hm-back]');
  if (!back) return;
  hmShow(back.dataset.hmBack === 'home' ? 'hmHome' : back.dataset.hmBack);
});

/* 规格：选了就高亮 */
function hmWireLens(el, mode) {
  el.addEventListener('click', e => {
    const tier = e.target.closest('.ms-tier');
    if (!tier) return;
    hmLen[mode] = +tier.dataset.len;
    Array.prototype.forEach.call(el.children, t => t.classList.toggle('on', t === tier));
  });
}
hmWireLens(hmErrLensEl, 'err');
hmWireLens(hmDistLensEl, 'dist');
hmWireLens(hmEncLensEl, 'enc');

$('#hmErrStart').addEventListener('click',  hmErrNewRound);
$('#hmDistStart').addEventListener('click', hmDistNewRound);
$('#hmEncStart').addEventListener('click',  hmEncNewRound);

/* 「换一道」：对局中问一句；一局还没动过就直接换，只弹 toast */
function hmNewRoundOf(mode) {
  ({ err: hmErrNewRound, dist: hmDistNewRound, enc: hmEncNewRound })[mode]();
}

function hmAskNew() {
  const again = () => hmNewRoundOf(hmMode);
  if (hmOver || !hmDirty) {
    if (!hmDirty && !hmOver) toast('ok', '已换一道', '本局尚未开始，直接换新题');
    again();
    return;
  }
  hmAsk('new', '换一道？', '这一局的进度会作废，出题重新来。', '换一道', again);
}
$('#hmErrNew').addEventListener('click',  () => { hmMode = 'err';  hmAskNew(); });
$('#hmDistNew').addEventListener('click', () => { hmMode = 'dist'; hmAskNew(); });
$('#hmEncNew').addEventListener('click',  () => { hmMode = 'enc';  hmAskNew(); });

/* 「放弃」：永远二次确认 */
function hmAskQuit() {
  hmAsk('quit', '放弃这一局？', '盘面会保留到你看完答案为止。', '放弃', hmAbandon);
}
$('#hmErrQuit').addEventListener('click',  hmAskQuit);
$('#hmDistQuit').addEventListener('click', hmAskQuit);
$('#hmEncQuit').addEventListener('click',  hmAskQuit);

/* 结算浮层主按钮（确认 / 查看答案同一颗，按状态分发） */
hmOvPrimary.addEventListener('click', hmDismissOverlay);

/* 放弃浮层多出来的三个出口：再来一局 / 重选码长（位数） / 退出
   ★ 退出 = 收浮层 + 回「选择玩法」（功能页的二级页面），不关整张卡片 ——
     下次从模式选择重新来过，不会停在一局已结束、盘面锁死的旧局上。 */
$('#hmOvAgain').addEventListener('click', () => {
  hmOverlay.classList.remove('show');
  hmNewRoundOf(hmMode);
});
$('#hmOvRechoose').addEventListener('click', () => {
  hmOverlay.classList.remove('show');
  hmShow('hm' + { err: 'Err', dist: 'Dist', enc: 'Enc' }[hmMode] + 'Setup');
});
$('#hmOvExit').addEventListener('click', () => {
  hmOverlay.classList.remove('show');
  hmCloseAsk();
  hmShow('hmHome');
});

/* 收尾后的顶栏出口：再来一局 / 重选规格 */
function hmWireEnd(prefix, mode) {
  $('#hm' + prefix + 'Again2').addEventListener('click', () => hmNewRoundOf(mode));
  $('#hm' + prefix + 'Rechoose2').addEventListener('click', () => {
    hmCloseAsk();
    hmOverlay.classList.remove('show');
    hmShow('hm' + prefix + 'Setup');
  });
}
hmWireEnd('Err', 'err');
hmWireEnd('Dist', 'dist');
hmWireEnd('Enc', 'enc');

/* ==========================================================
   十、初始化
   ========================================================== */

/* 进来时保持上次的样子（第一次是模式选择）；别的没什么要现铺的 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== hmPage) return;
});
