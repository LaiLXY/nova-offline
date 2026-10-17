/* ==========================================================================
   points24.js —— 功能页：二十四点

   玩法：发四张「牌」（数字 1–13），用 + − × ÷ 和括号把它们**各用一次**，
   凑出 24。

   ★ 出题和判题全在浏览器里完成，不碰后端：
       · 出题：随机取四个数 → 用求解器筛出「保证有解」的那一组
         （没解的题会让用户干瞪眼，所以要挑有解的）
       · 判题：自己写的小解析器（递归下降）算值，顺带把用到的数字收集起来，
               再检查「是不是这四张牌、各用了一次」
     刻意不用 eval()：那等于把用户输入当代码跑，这里只需要四则运算。

   ★ 战绩（解出多少局）存在本机浏览器的 localStorage 里：
     解出一局写一次、进来读一次。离线版没有账号，
     换台设备 / 换个浏览器就是新的计数。
     这个文件从头到尾一次网络请求都不发。

   ★ 判题的两种失败要分清楚，提示才不误导：
       · 算式写得不对 / 用错了数字 → 贴在输入框下面（红框 + 红字）
       · 数字用对了、但结果不是 24 → 也算失败，但把实际结果告诉用户

   ★ 四张牌和运算符按钮都能点：手机上敲 × ÷ 和括号很麻烦，点一下就行。

   依赖 core.js（$ / toast / setError / clearError）、
   tools.js（tool:open 事件）与 home.js（currentAccount，用来判断是否换了人）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const ptPage    = document.getElementById('toolPoints24');
const ptCardsEl = $('#ptCards');
const ptRoundEl = $('#ptRound');
const ptScoreEl = $('#ptScore');
const ptExpr    = $('#ptExpr');
const ptKeysEl  = $('#ptKeys');
const ptSubmit  = $('#ptSubmit');
const ptNewBtn  = $('#ptNew');
const ptAnsBtn  = $('#ptAnswer');
const ptNoteEl  = $('#ptNote');

/* ---------- 常量 / 状态 ---------- */
const PT_MIN = 1, PT_MAX = 13, PT_TARGET = 24;

let ptNums    = [];      // 当前这四张牌
let ptRoundNo = 0;       // 第几局（本次进来算起，只用于显示）
let ptSolved  = 0;       // 累计解出局数（存在本机浏览器）
let ptAnswer  = '';      // 当前这局的参考答案（内部用 * / - 记，显示时再转成 × ÷ −）
let ptCaret   = 0;       // 输入框里光标的位置（点键盘按钮时按它插入）
let ptOwner   = null;    // 上次进来时登录的是谁
let ptRoundSolved = false; // 本局是不是已经算出来过了——算对过就不再重复计分

/* ==========================================================
   一、数字 → 算式：自己写的小解析器

   只认「不带小数点的数字 + - * / ( )」，这样就不必担心注入 ——
   没有函数调用、没有属性访问，纯四则运算。
   ========================================================== */

/** 把中文输入法容易打出来的全角符号、各种乘除减写法，统一成 ASCII */
function ptNormalize(s) {
  return String(s)
    .replace(/\uFF08/g, '(')                          // （
    .replace(/\uFF09/g, ')')                          // ）
    .replace(/[\u00D7\u2715\u2716]/g, '*')            // × ✕ ✖
    .replace(/[\u00F7\uFF0F]/g, '/')                  // ÷ ／
    .replace(/[\u2212\u2013\u2014\u30FC\uFF0D]/g, '-') // − – — ー －
    .replace(/\uFF0B/g, '+')                          // ＋
    .replace(/[\uFF10-\uFF19]/g, c =>                 // ０-９
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');                         // 全角空格
}

function ptTokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
      out.push({ t: 'num', v: parseInt(src.slice(i, j), 10) });
      i = j;
      continue;
    }
    if ('+-*/()'.indexOf(c) >= 0) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('算式里有不认识的符号「' + c + '」');
  }
  return out;
}

/** 递归下降求值。返回 { value, nums }；nums 是算式里出现过的数字。 */
function ptParseExpr(text) {
  const tokens = ptTokenize(ptNormalize(text));
  const nums = [];
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // 表达式 = 项 (('+'|'-') 项)*
  function expr() {
    let v = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  // 项 = 因子 (('*'|'/') 因子)*
  function term() {
    let v = factor();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = next().v;
      const r = factor();
      if (op === '*') {
        v = v * r;
      } else {
        if (Math.abs(r) < 1e-12) throw new Error('不能除以 0');
        v = v / r;
      }
    }
    return v;
  }

  // 因子 = 数字 | '(' 表达式 ')' | ('+'|'-') 因子
  function factor() {
    const tk = peek();
    if (!tk) throw new Error('算式没写完');
    if (tk.t === 'op' && tk.v === '(') {
      next();
      const v = expr();
      const close = peek();
      if (!close || close.t !== 'op' || close.v !== ')') throw new Error('括号没有配对');
      next();
      return v;
    }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      next();
      const v = factor();
      return tk.v === '-' ? -v : v;
    }
    if (tk.t === 'num') { next(); nums.push(tk.v); return tk.v; }
    throw new Error('算式写得不太对，检查一下');
  }

  const value = expr();
  if (pos < tokens.length) throw new Error('算式写得不太对，检查一下');
  return { value, nums };
}

/** 两组数字是不是同一组（各用一次）——排序后逐个比 */
function ptSameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

/* ==========================================================
   二、求解器：判断一组牌有没有解，并给出一个答案

   思路是「两两合并」：每次挑两个数，用四种运算合成一个，放回去，
   直到只剩一个数 —— 是 24 就记下这条路。四张牌最多一万次左右，
   随手就能算完，不用做任何优化。
   ========================================================== */

/** 去掉最外层那对包裹整个式子的括号 */
function ptStripOuter(s) {
  if (s[0] !== '(' || s[s.length - 1] !== ')') return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i === s.length - 1 ? ptStripOuter(s.slice(1, -1)) : s;
    }
  }
  return s;
}

/** 返回解法列表（已去重、短的在前）；空数组表示这组牌无解 */
function ptSolve(nums) {
  const EPS = 1e-6;
  const found = [];
  const seen = new Set();

  function go(items) {
    if (items.length === 1) {
      if (Math.abs(items[0].val - PT_TARGET) < EPS) {
        const s = ptStripOuter(items[0].expr);
        if (!seen.has(s)) { seen.add(s); found.push(s); }
      }
      return;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const a = items[i], b = items[j];
        const rest = items.filter((_, k) => k !== i && k !== j);

        const cands = [
          { val: a.val + b.val, expr: '(' + a.expr + '+' + b.expr + ')' },
          { val: a.val * b.val, expr: '(' + a.expr + '*' + b.expr + ')' },
          { val: a.val - b.val, expr: '(' + a.expr + '-' + b.expr + ')' },
        ];
        if (Math.abs(b.val) > EPS) {
          cands.push({ val: a.val / b.val, expr: '(' + a.expr + '/' + b.expr + ')' });
        }
        cands.forEach(c => go(rest.concat(c)));
      }
    }
  }

  go(nums.map(n => ({ val: n, expr: String(n) })));
  found.sort((x, y) => x.length - y.length);   // 短的优先，通常也更好看
  return found;
}

/* ==========================================================
   三、出题
   ========================================================== */
function ptNewPuzzle() {
  let last = ptNums.join(',');
  for (let attempt = 0; attempt < 300; attempt++) {
    const nums = Array.from({ length: 4 },
      () => PT_MIN + Math.floor(Math.random() * (PT_MAX - PT_MIN + 1)));
    if (nums.join(',') === last) continue;     // 别和上一局一模一样
    const sols = ptSolve(nums);
    if (sols.length) return { nums, answer: sols[0] };
  }
  // 兜底：1–13 里绝大多数组合都有解，正常走不到这里
  return { nums: [3, 3, 8, 8], answer: '8/(3-8/3)' };
}

/* ==========================================================
   四、把牌和键盘铺到界面上
   ========================================================== */
function ptRenderCards() {
  ptCardsEl.textContent = '';
  ptNums.forEach(n => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pt-num';
    b.textContent = String(n);
    b.setAttribute('aria-label', '数字 ' + n + '，点击填入算式');
    b.addEventListener('click', () => ptInsert(String(n)));
    ptCardsEl.appendChild(b);
  });
}

/* 运算符键盘。全角/半角的写法都收，但这里统一插**好看的**那个符号，
   反正 ptNormalize 会再转回来。 */
const PT_KEYS = [
  { label: '+',  insert: '+' },
  { label: '\u2212', insert: '\u2212' },   // −
  { label: '\u00D7', insert: '\u00D7' },   // ×
  { label: '\u00F7', insert: '\u00F7' },   // ÷
  { label: '(',  insert: '(' },
  { label: ')',  insert: ')' },
  { label: '退格', act: 'back',  title: '删掉最后一个字符' },
  { label: '清空', act: 'clear', title: '清空算式' },
];

function ptBuildKeys() {
  ptKeysEl.textContent = '';
  PT_KEYS.forEach(def => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip pt-key';
    b.textContent = def.label;
    if (def.title) b.title = def.title;
    b.addEventListener('click', () => {
      if (def.act === 'back') ptBackspace();
      else if (def.act === 'clear') {
        ptExpr.value = '';
        ptCaret = 0;
        ptClearResult();
        if (typeof Device !== 'undefined' && Device.isPC()) ptExpr.focus();
      } else {
        ptInsert(def.insert);
      }
    });
    ptKeysEl.appendChild(b);
  });
}

/* ==========================================================
   五、算式输入：插入 / 退格 / 清结果
   ========================================================== */

/* 记光标位置：点完键盘按钮焦点会跑到按钮上，这时 selectionStart
   未必靠谱，所以只在输入框自己的事件里更新它。 */
['keyup', 'click', 'input', 'select', 'focus'].forEach(ev => {
  ptExpr.addEventListener(ev, () => {
    if (typeof ptExpr.selectionStart === 'number') ptCaret = ptExpr.selectionStart;
  });
});

function ptInsert(text) {
  const v = ptExpr.value;
  const pos = Math.min(Math.max(ptCaret, 0), v.length);
  ptExpr.value = v.slice(0, pos) + text + v.slice(pos);
  ptCaret = pos + text.length;
  if (typeof Device !== 'undefined' && Device.isPC()) {
    ptExpr.focus();
    ptExpr.setSelectionRange(ptCaret, ptCaret);
  }
  ptClearResult();
}

function ptBackspace() {
  const v = ptExpr.value;
  const pos = Math.min(Math.max(ptCaret, 0), v.length);
  if (pos <= 0) return;
  ptExpr.value = v.slice(0, pos - 1) + v.slice(pos);
  ptCaret = pos - 1;
  if (typeof Device !== 'undefined' && Device.isPC()) {
    ptExpr.focus();
    ptExpr.setSelectionRange(ptCaret, ptCaret);
  }
  ptClearResult();
}

/** 清掉红框 / 绿框和提示行（点一下牌、改一个字都该把它收掉） */
function ptClearResult() {
  clearError(ptExpr);                                   // 去 .err、收起 .hint
  const wrap = ptExpr.closest('[data-field]');
  if (wrap) wrap.classList.remove('ok');
  const hint = wrap ? wrap.nextElementSibling : null;
  if (hint && hint.classList.contains('hint')) hint.classList.remove('ok');
}

function ptFail(msg) {
  const wrap = ptExpr.closest('[data-field]');
  if (wrap) wrap.classList.remove('ok');
  setError(ptExpr, msg);
}

function ptWin() {
  ptClearResult();
  const wrap = ptExpr.closest('[data-field]');
  if (wrap) wrap.classList.add('ok');
  const hint = wrap ? wrap.nextElementSibling : null;

  // 本局已经算出来过了：只回一句提示，**不再计分、不再写入**。
  // 少了这道判断，同一局反复点「验证」会一直 +1（分数能刷上天）。
  // 标记在下面同步置位，所以连点两下「验证」也只算一次。
  if (ptRoundSolved) {
    if (hint && hint.classList.contains('hint')) {
      hint.textContent = '这局已经算出来了，点「换一组」继续';
      hint.classList.add('show', 'ok');
    }
    return;
  }
  ptRoundSolved = true;

  if (hint && hint.classList.contains('hint')) {
    hint.textContent = '算对了！';
    hint.classList.add('show', 'ok');
  }
  // 先本地 +1，界面立刻有反馈；再写回本机，下次进来还在
  ptSolved++;
  ptPaintScore();
  ptSaveScore();
  toast('ok', '算对了', '四个数字各用一次，结果正好是 24');
}

/** 数字收尾：最多留四位小数，去多余的 0，别甩一串浮点尾巴 */
function ptFmtNum(v) {
  if (!Number.isFinite(v)) return '—';
  return String(Math.round(v * 1e4) / 1e4);
}

/* ==========================================================
   六、判题
   ========================================================== */
function ptCheck() {
  ptClearResult();

  const raw = ptExpr.value.trim();
  if (!raw) { ptFail('先写一个算式吧'); return; }

  let parsed;
  try {
    parsed = ptParseExpr(raw);
  } catch (err) {
    ptFail((err && err.message) || '算式写得不太对，检查一下');
    return;
  }

  // 数字必须是这四张牌，且各用一次
  if (!ptSameMultiset(parsed.nums, ptNums)) {
    ptFail('要把 ' + ptNums.join('、') + ' 这四个数字各用一次');
    return;
  }

  if (Math.abs(parsed.value - PT_TARGET) > 1e-6) {
    ptFail('结果是 ' + ptFmtNum(parsed.value) + '，不是 24');
    return;
  }

  ptWin();
}

/* ==========================================================
   七、界面：开局 / 新一局 / 看答案 / 战绩
   ----------------------------------------------------------
   战绩存在本机浏览器（localStorage），换设备不跟着走。
   这里只做两件事：进来读一次、解出一局写回一次。
   ========================================================== */
function ptPaintScore() {
  ptScoreEl.textContent = '已解出 ' + ptSolved + ' 局';
  ptScoreEl.classList.toggle('done', ptSolved > 0);
}

/* 离线版：战绩存在本机浏览器里（localStorage），没有后端 */
const PT_SCORE_KEY = 'nova_offline_points24';

/** 读一次累计局数。读不到就按当前值显示（只是个计分，不值得打扰用户） */
async function ptLoadScore() {
  try {
    const v = localStorage.getItem(PT_SCORE_KEY);
    if (v !== null) ptSolved = parseInt(v, 10) || 0;
  } catch (_) { /* 无痕模式下 localStorage 可能直接抛错，忽略 */ }
  ptPaintScore();
}

/** 解出一局：进这个函数时 ptSolved 已经加过了，这里只负责写回本机 */
async function ptSaveScore() {
  try { localStorage.setItem(PT_SCORE_KEY, String(ptSolved)); } catch (_) {}
}

function ptNewRound() {
  const puzzle = ptNewPuzzle();
  ptNums   = puzzle.nums;
  ptAnswer = puzzle.answer;
  ptRoundNo++;
  ptRoundSolved = false;      // 新的一局，重新开始计分

  ptRoundEl.textContent = '第 ' + ptRoundNo + ' 局';
  ptRenderCards();

  ptExpr.value = '';
  ptCaret = 0;
  ptClearResult();
  ptNoteEl.hidden = true;
  ptNoteEl.textContent = '';

  if (typeof Device !== 'undefined' && Device.isPC()) ptExpr.focus();
}

function ptShowAnswer() {
  if (!ptAnswer) return;
  ptNoteEl.textContent = '';
  ptNoteEl.appendChild(document.createTextNode('参考答案：'));
  const b = document.createElement('b');
  b.textContent = ptAnswer.replace(/\*/g, '\u00D7').replace(/\//g, '\u00F7').replace(/-/g, '\u2212');
  ptNoteEl.appendChild(b);
  ptNoteEl.hidden = false;
}

/* ==========================================================
   八、事件绑定
   ========================================================== */
ptSubmit.addEventListener('click', ptCheck);
ptNewBtn.addEventListener('click', ptNewRound);
ptAnsBtn.addEventListener('click', ptShowAnswer);

ptExpr.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); ptCheck(); }
});

/* 进这个功能页时对齐一次战绩：
     · 换了人 → 先清零、重开一局（别把上一位的分数和牌面留着）
     · 同一个人 → 进来也读一次本机记下的数 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== ptPage) return;

  const who = typeof currentAccount === 'string' ? currentAccount : null;
  if (ptOwner !== who) {
    ptOwner  = who;
    ptSolved = 0;              // 先清零，等那个读数回来（免得闪出旧分数）
    ptRoundNo = 0;
    ptPaintScore();
    ptNewRound();
  }
  ptLoadScore();
});

/* ==========================================================
   九、初始化
   ========================================================== */
ptBuildKeys();
ptPaintScore();
ptNewRound();
