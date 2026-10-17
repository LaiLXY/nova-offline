/* ==========================================================================
   roman.js —— 功能页：罗马数字

   阿拉伯数字 ⇄ 罗马数字，范围 0–3999（0 写作 N）。

   ★ 全程在浏览器里算，后端一点不碰（和 convert.js / graph.js 一样的原则）。

   ★ **只有一个输入框**，另一栏是只读的结果：不设方向开关，
     也不用"你现在想往哪边转"—— 输入里是数字就当阿拉伯数字读，
     是字母就当罗马数字读（见 rmReadInput）。于是
        1999   → MCMXCIX
        mcmxcix → 1999
     都从同一个框进去。两栏各挂一个「复制」，结果拿走、原文也能拿走。

   ★ 只认**标准写法**：一条正则就够（RM_CANON）—— 同一符号最多连写三次、
     V / L / D 不重复、减写法只有六种固定搭配。
     写得不标准的（IIII、VX）不算"坏输入"：只要能读出一个 1–3999 的值，
     就直接把标准写法告诉他（「写法不规范：4 应该写作 IV」）。把 4 写成
     IIII 的人需要的是正确写法，不是一句「无效的罗马数字」。

   ★ 软键盘复用「函数图像」那套外观（css/tools.css 第六节的 .gfx-pad /
     .gfx-key），只差两处：
       · 网格 3 列。键位少（每套 12 个），5 列会挤成细细一条：
           数字盘 7 8 9 / 4 5 6 / 1 2 3 / 切换 0 退格
           罗马盘 I V X / L C D / M V I / 切换 N 退格
       · 「切换」在**两套键位之间**换（数字 ⇄ 罗马）—— 输入框只有一个、
         数字和字母都能填，所以键盘得两套都备着。
     罗马盘第三行末尾那个 V 和 I 是**重复的键**：I 和 V 是罗马数字里出现
     最多的两个符号（1 和 5、以及所有 4/9 的搭配都用到），
     再放一份在最下面一行，单手够得着。

   依赖 core.js（$ / setError / clearError / Device / toast）、
        tools.js（tool:open 事件）与 home.js（currentAccount）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const RM_PAGE = document.getElementById('toolRoman');

const rmIn      = $('#rmIn');
const rmOut     = $('#rmOut');
const rmBreakEl = $('#rmBreak');
const rmBreakRom = $('#rmBreakRom');
const rmBreakNum = $('#rmBreakNum');

const rmPad     = $('#rmPad');
const rmPadKeys = $('#rmPadKeys');

const RM_MAX = 3999;      // 上限：M 最多连写三个（4000 起得另想办法）
let rmOwner = null;       // 打开这个功能页时登录的是谁（换人就清干净）

/* ==========================================================
   一、换算
   ========================================================== */

/* 从大到小的面值，带上六个减写法搭配。
   贪心就能出**标准写法**：每一步都取不超过余数的最大面值，
   于是 1999 自然是 1000 + 900 + 90 + 9（M CM XC IX），不会写成别的样子。 */
const RM_STEPS = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100,  'C'], [90,  'XC'], [50,  'L'], [40,  'XL'],
  [10,   'X'], [9,   'IX'], [5,   'V'], [4,   'IV'], [1, 'I'],
];

const RM_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/* 标准写法（1–3999）就这一条正则，四段分别管千 / 百 / 十 / 个位：
     M{0,3}            千位：1–3 个 M（4000 起本工具不涉及）
     CM|CD|D?C{0,3}    百位：900 / 400 / 500–800 / 100–300
     XC|XL|L?X{0,3}    十位：同样四档
     IX|IV|V?I{0,3}    个位：同样四档
   它顺带把 IIII、VX、IM 这些不合规矩的写法全挡住了 —— 用不着再手写一遍规则。 */
const RM_CANON = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/* 拆解用的记号表。两字符的（减写法）必须排在单字符**前面**，
   否则在 'CM' 的第 0 位上会先撞到 'C'、拆成 C + M。
   'N'（= 0）也在表里：拆解那一行对 0 一样要能显示。 */
const RM_TOKENS = ['CM', 'CD', 'XC', 'XL', 'IX', 'IV',
                   'M', 'D', 'C', 'L', 'X', 'V', 'I', 'N'];

/** 阿拉伯 → 罗马。0 单独返回 N（古罗马没有 0，按惯例用 nulla 的首字母）。 */
function rmToRoman(n) {
  if (n === 0) return 'N';
  let out = '';
  for (const [v, s] of RM_STEPS) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}

/** 罗马 → 阿拉伯的**宽松**读数：只按「小的在大之前就减」累加，
 *  不检查写法是否标准。用来给不规范写法算出「你想写的其实是几」。
 *  碰到不认识的字符返回 null。 */
function rmValueLoose(s) {
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const a = RM_VAL[s[i]];
    if (!a) return null;
    const b = RM_VAL[s[i + 1]];
    v += (b && b > a) ? -a : a;
  }
  return v;
}

/** 一个记号的数值（'N' = 0，其它记号都是标准搭配，交给宽松读数） */
const rmTokenValue = t => (t === 'N' ? 0 : rmValueLoose(t));

/** 把一段标准写法拆成记号：'MCMXCIX' → ['M','CM','XC','IX']。
 *  拆不动（出现不该有的组合）返回 null。 */
function rmSplit(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const t = RM_TOKENS.find(t => s.startsWith(t, i));
    if (!t) return null;
    out.push(t);
    i += t.length;
  }
  return out;
}

/* ==========================================================
   二、读数（校验）
   ----------------------------------------------------------
   输入框里可能是数字、也可能是罗马数字，这里一次认完，结果三种：
     { empty: true }                       没输入 —— 不算错，清掉结果就行
     { value: n, kind: 'ar' | 'ro' }       读通了；kind 记下**原文是哪一种**
     { msg: '…' }                          读不通 / 不规范，msg 直接给用户看
   kind 是用来定方向的：原文是数字，结果就给罗马；反之给阿拉伯。
   ========================================================== */
function rmReadInput(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { empty: true };

  // 空格和千分位逗号只是顺手打的，不参与判读
  const compact = s.replace(/[\s,，]/g, '');

  if (/^\d+$/.test(compact)) {
    if (Number(compact) > RM_MAX) {
      return { msg: '只支持 0–3999（最大 MMMCMXCIX = 3999）' };
    }
    return { value: Number(compact), kind: 'ar' };
  }

  // 剩下的按罗马数字读，大小写都认。
  // 'N'（= 0）要先认掉：它不在那七个符号里，直接过下面的字符检查会被挡下。
  const up = compact.toUpperCase();
  if (up === 'N') return { value: 0, kind: 'ro' };
  if (!/^[IVXLCDM]+$/.test(up)) {
    return { msg: '只能填阿拉伯数字或罗马数字：0–3999，或 I V X L C D M（0 写 N）' };
  }
  if (RM_CANON.test(up)) return { value: rmValueLoose(up), kind: 'ro' };

  /* 走不到标准正则里，但未必是瞎敲的：IIII、VX 这种"读得懂、只是不合规矩"
     的写法，先把值读出来，再把标准写法告诉他。 */
  const v = rmValueLoose(up);
  if (v > RM_MAX) return { msg: '超出范围：本工具最大 3999（MMMCMXCIX）' };
  if (v >= 1) return { msg: `写法不规范：${v} 应该写作 ${rmToRoman(v)}` };
  return { msg: '不是有效的罗马数字（同一符号最多连写三次，V / L / D 不能重复）' };
}

/* ==========================================================
   三、输入 → 结果
   ========================================================== */

/** 把拆解式填到卡片底部：`M + CM + XC + IX = 1000 + 900 + 90 + 9`。
 *  tokens 为空就整块收起来（没输入 / 读不通时都有它的份）。 */
function rmPaintBreak(tokens) {
  if (!tokens || !tokens.length) {
    rmBreakEl.hidden = true;
    return;
  }
  rmBreakRom.textContent = tokens.join(' + ');
  rmBreakNum.textContent = tokens.map(rmTokenValue).join(' + ');
  rmBreakEl.hidden = false;
}

/** 输入变了 → 读数 → 写结果 → 更新拆解。
 *  规矩一条：**输入框一个字都不动**（动了光标会被踢走、输入法也会断），
 *  大写 / 去前导 0 留到失焦时做，见 rmNormalize。 */
function rmSync() {
  const r = rmReadInput(rmIn.value);

  if (r.empty) {
    rmOut.value = '';
    clearError(rmIn);
    rmPaintBreak(null);
    return;
  }
  if (r.msg) {
    rmOut.value = '';              // 读不通就别留着上一个答案
    setError(rmIn, r.msg);
    rmPaintBreak(null);
    return;
  }

  clearError(rmIn);

  const rom = rmToRoman(r.value);
  rmOut.value = r.kind === 'ar' ? rom : String(r.value);

  // 拆解永远按罗马那一侧显示：两个方向看过去都是"这个数怎么写成罗马数字"
  rmPaintBreak(rmSplit(rom));
}

/** 失焦时给输入框收个尾：罗马那栏统一成大写（敲 i v x 的人很多），
 *  数字那栏去掉前导 0、顺手抹掉千分位逗号。
 *  只在"读得通"的时候动手 —— 写错的原文保留着，让人看得见自己敲的是什么。 */
function rmNormalize() {
  if (!rmIn.value.trim()) return;
  const r = rmReadInput(rmIn.value);
  if (r.value === undefined) return;

  const fixed = r.kind === 'ar' ? String(r.value) : rmToRoman(r.value);
  if (fixed === rmIn.value) return;

  rmIn.value = fixed;
  rmSync();
}

/* ==========================================================
   四、复制
   ========================================================== */

/** 复制提示共用的 key（见 core.js 的 toast 第 4 个参数）：
 *  传了 key 就**同一时刻只留一条**，新的来之前先把旧的那条收掉。
 *  连点两栏、或空框点一次再点一次，屏幕上都只留最后那条 ——
 *  和「单位换算」那页一个规矩（见 js/units.js 的 CVT_TOAST_COPY）。 */
const RM_TOAST_COPY = 'roman-copy';

/** execCommand 那条老路。剪贴板 API 只在**安全上下文**里给用
 *  （https / localhost 算，局域网 IP 走 http 就不算），
 *  离线版常常是直接双击文件（file://）打开，所以兜底这条路必须留着。 */
function rmCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // 放在视口里、但挪到看不见的地方：display:none 的节点选不中
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

/** 复制某一栏的内容。两栏共用，靠传进来的按钮区分是哪一栏。 */
async function rmCopy(input, label) {
  const text = input.value;
  if (!text) {
    toast('err', '还没有内容可以复制', label === '结果' ? '先在上面填一个数' : '', RM_TOAST_COPY);
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      rmCopyFallback(text);
    }
    // 长串截一下再当说明，别把整个提示撑开
    toast('ok', '已复制' + label, text.length > 24 ? text.slice(0, 24) + '…' : text, RM_TOAST_COPY);
  } catch (_) {
    // 兜底也失败（权限被拒 / 老浏览器）：把话说清楚，让用户自己选中
    toast('err', '复制失败', '请手动选中后复制', RM_TOAST_COPY);
  }
}

/* ==========================================================
   五、软键盘（键位和取舍见文件头上那一大段说明）
   ========================================================== */

/* 两套键位。一项要么是一个字符串（往框里插这个字），
   要么是一个对象：
     { act: 'swap' }   切换键
     { act: 'back' }   退格
     { l, fn, title }  字面键；fn 只是换个颜色（蓝调），好和普通键分开
   排列：
     数字盘 7 8 9 / 4 5 6 / 1 2 3 / 切换 0 退格
     罗马盘 I V X / L C D / M V I / 切换 N 退格
   （N 摆在数字盘 0 的位置上 —— 两套盘的"零"在同一个格子里） */
const RM_PAD_NUM = ['7', '8', '9', '4', '5', '6', '1', '2', '3',
                    { act: 'swap' }, '0', { act: 'back' }];

const RM_PAD_ROMAN = [
  'I', 'V', 'X', 'L', 'C', 'D', 'M',
  // 最常用的两个符号再放一份，够手
  { l: 'V', fn: 1, title: 'V（常用符号，重复一个键）' },
  { l: 'I', fn: 1, title: 'I（常用符号，重复一个键）' },
  { act: 'swap' }, 'N', { act: 'back' },
];

let rmPadView = 'ro';     // 'ro' 罗马键盘 / 'num' 数字键盘，默认罗马那套
let rmPadCaret = 0;       // 输入框里的光标位置

/** 造一个键 */
function rmPadKey(label, opts) {
  const o = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gfx-key' + (o.fn ? ' is-fn' : '');
  b.textContent = label;
  if (o.title) b.title = o.title;
  b.setAttribute('aria-label', o.title || label);

  // 见 graph.js 的说明：拦掉 mousedown 的默认行为，别把输入框的焦点抢走
  // （抢走了输入框就 blur，软键盘会跟着闪一下收起来）
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', o.action);
  return b;
}

function rmPadRender() {
  if (!rmPadKeys) return;
  const keys = rmPadView === 'ro' ? RM_PAD_ROMAN : RM_PAD_NUM;

  rmPadKeys.className = 'gfx-pad-keys is-3col';
  rmPadKeys.textContent = '';

  keys.forEach(k => {
    if (typeof k === 'string') {
      rmPadKeys.appendChild(rmPadKey(k, { action: () => rmPadInsert(k) }));
      return;
    }
    if (k.act === 'swap') {
      rmPadKeys.appendChild(rmPadKey('切换', {
        fn: 1,
        title: rmPadView === 'ro' ? '换成数字键盘' : '换成罗马键盘',
        action: rmPadSwap,
      }));
    } else if (k.act === 'back') {
      rmPadKeys.appendChild(rmPadKey('\u232B', {
        fn: 1, title: '退格', action: rmPadBackspace,
      }));
    } else {
      rmPadKeys.appendChild(rmPadKey(k.l, {
        fn: k.fn, title: k.title, action: () => rmPadInsert(k.l),
      }));
    }
  });
}

/** 插字。插完把焦点和光标补回原处，再**派发一个 input 事件** ——
 *  同步 / 校验全交给上面那条已有的链路，不另写一套。 */
function rmPadInsert(text) {
  const v = rmIn.value;
  const pos = Math.min(Math.max(rmPadCaret, 0), v.length);
  rmIn.value = v.slice(0, pos) + text + v.slice(pos);
  rmPadCaret = pos + text.length;

  try { rmIn.focus({ preventScroll: true }); } catch (_) { rmIn.focus(); }
  try { rmIn.setSelectionRange(rmPadCaret, rmPadCaret); } catch (_) {}

  rmIn.dispatchEvent(new Event('input', { bubbles: true }));
}

function rmPadBackspace() {
  const v = rmIn.value;
  const pos = Math.min(Math.max(rmPadCaret, 0), v.length);
  if (pos <= 0) return;

  rmIn.value = v.slice(0, pos - 1) + v.slice(pos);
  rmPadCaret = pos - 1;
  try { rmIn.focus({ preventScroll: true }); } catch (_) {}
  try { rmIn.setSelectionRange(rmPadCaret, rmPadCaret); } catch (_) {}

  rmIn.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 清空输入（结果跟着空 —— 它本来就是输入算出来的） */
function rmPadClear() {
  rmIn.value = '';
  rmPadCaret = 0;
  try { rmIn.focus({ preventScroll: true }); } catch (_) {}
  rmIn.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 「切换」：两套键位之间换。只换键盘，不动输入框里的内容。 */
function rmPadSwap() {
  rmPadView = rmPadView === 'ro' ? 'num' : 'ro';
  rmPadRender();
}

function rmPadShow() {
  if (!rmPad) return;
  rmPadCaret = typeof rmIn.selectionStart === 'number'
    ? rmIn.selectionStart : rmIn.value.length;

  rmPadRender();
  rmPad.hidden = false;
  gfxPadEnsureVisible(rmIn, rmPad);
}

function rmPadHide() {
  if (!rmPad) return;
  rmPad.hidden = true;
  // 清掉 gfxPadEnsureVisible 给滚动容器补的底边距（和 gfxClearPadScroller 一个意思）
  gfxClearPadScroller();
}

/** 把输入框接到软键盘上 */
function rmPadBind() {
  // 触摸设备：不叫出系统键盘。本站的输入全都自带键盘，系统键盘只会挡掉半屏
  if (typeof Device !== 'undefined' && !Device.isPC()) {
    rmIn.setAttribute('inputmode', 'none');
  }

  rmIn.addEventListener('focus', rmPadShow);

  // 兜底：个别浏览器/输入法下点一下未必派发 focus，点完再确认一次
  rmIn.addEventListener('click', () => {
    if (rmPad && rmPad.hidden) rmPadShow();
    if (typeof rmIn.selectionStart === 'number') rmPadCaret = rmIn.selectionStart;
  });

  // 失焦时**不要立刻收**：点软键盘上的按钮也会让输入框先 blur 一下。
  // 等一个 tick，看焦点是不是落在软键盘里 —— 是就留着。
  rmIn.addEventListener('blur', () => {
    setTimeout(() => {
      if (rmPad && rmPad.contains(document.activeElement)) return;
      rmPadHide();
    }, 0);
  });

  ['click', 'keyup', 'input', 'select'].forEach(ev => {
    rmIn.addEventListener(ev, () => {
      if (typeof rmIn.selectionStart === 'number') rmPadCaret = rmIn.selectionStart;
    });
  });
}

/* ==========================================================
   六、事件绑定
   ========================================================== */

rmIn.addEventListener('input', rmSync);
rmIn.addEventListener('blur', rmNormalize);

/* 回车 = 收工，和键盘上的「完成」一个意思 */
rmIn.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  rmIn.blur();
});

/* ---- 复制：两栏各一个 ---- */
[['#rmCopyIn', rmIn, '输入', '复制输入内容'],
 ['#rmCopyOut', rmOut, '结果', '复制结果']].forEach(([sel, input, label, aria]) => {
  const btn = $(sel);
  if (!btn) return;
  btn.setAttribute('aria-label', aria);
  // 拦 mousedown：不然点一下按钮输入框就失焦，软键盘跟着收起来
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => rmCopy(input, label));
});

/* ---- 键盘头部的两颗按钮 ---- */
if (rmPad) {
  $('#rmPadClear').addEventListener('click', rmPadClear);

  // 「完成」只收键盘，值留着 —— 想接着改了，点一下输入框又出来
  $('#rmPadDone').addEventListener('click', () => {
    rmPadHide();
    rmIn.blur();
  });
}

rmPadBind();

/* ---- 进这个功能页 ---- */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== RM_PAGE) return;

  rmPadHide();

  /* 换人登录：上一位留在页面上的内容不该给下一位看见
     （和转换页同一个理由）。首次打开只是"认人"、不清空 ——
     本来一进来就是空的，没必要多此一举。 */
  if (rmOwner === null) {
    rmOwner = currentAccount;
  } else if (rmOwner !== currentAccount) {
    rmOwner = currentAccount;
    rmIn.value = '';
    clearError(rmIn);
    rmSync();
  }

  /* 这里**不**自动聚焦（和「单位换算」那页同一个处理，见 js/units.js）。
     以前电脑上会顺手 focus + select，好处是敲键就能用，可副作用是
     focus 会连锁触发 rmPadShow —— 人刚点进来、还没想打字，软键盘先自己
     弹出来占掉半屏，看着像是"这页坏了自己蹦键盘"。
     现在进这个功能页就是干干净净一张卡：等用户点了输入框（focus），
     键盘再出来。手机上本来也不聚焦（会弹起系统键盘，挡掉半屏），
     这样两边行为一致。 */
});

/* ==========================================================
   七、初始化
   ========================================================== */

/* 一进来是空的（输入框上写「点击输入…」）。
   不预填内容 —— 免得每次进来都得先清空。 */
rmIn.value = '';
rmSync();
rmPadRender();
