/* ==========================================================================
   graph.js —— 功能页：函数图像

   用户输入形如 sin(x)、x^2/8、2x+1、log(x)、sqrt(x-1) 的式子，在 canvas 上
   画出图像。可以同时画多条曲线，各自一个颜色、一个开关。

   ★ 全程在浏览器里算，后端一点不碰（和 convert.js 一样的原则）。

   ★ 解析：手写递归下降，**不用 eval / new Function**。
       把用户输入当代码执行等于开了个后门（哪天支持 "?f=..." 分享链接就是
       XSS 入口）。points24.js 里也是同样的取舍。
       解析得到一棵语法树，再"编译"成一组闭包 —— 之后每次求值只是几次函数
       调用，没有字符串参与，画出几千个点也不心疼。

   ★ 语法（比 points24 那个四则运算解析器扩展了几处）：
       · 函数调用：sin(x)、min(a, b)……（认得的函数名见 GFX_FUNCS）
       · 常量：pi / e / tau
       · 幂：^，**右结合**，且比一元负号绑得紧 —— 于是
             -x^2  = -(x^2)     （数学惯例）
             2^3^2 = 2^(3^2)    （右结合）
       · **隐式乘法**：2x、3sin(x)、x(x+1)、(x+1)(x-1) 都能写。
         判断办法是"下一个记号能不能起一个因子"（数字 / 名字 / 左括号），
         是就当成乘号插进去。
   ★ 一个刻画意的取舍：函数名后面**必须**带括号（写 sin x 会报错）。
     理由是 sin x + 1 到底该读成 sin(x+1) 还是 sin(x)+1，没有公认答案，
     与其猜，不如要求写清楚。

   ★ 定义域外不报错：除以 0 得 Infinity、sqrt(-1) 得 NaN，都是正常结果。
     采样时把它们当成"抬笔"，曲线就在那里断开 —— 见 gfxDrawCurve。

   依赖 core.js（$ / $$ / setError / clearError）与 tools.js（tool:open 事件）。
   ========================================================================== */

/* ==========================================================
   一、函数库 / 常量
   ========================================================== */
const GFX_FUNCS = (() => {
  const unary = fn => ({ fn, arity: 1 });
  const M = Math;
  return {
    // 三角
    sin: unary(M.sin), cos: unary(M.cos), tan: unary(M.tan),
    cot: unary(x => 1 / M.tan(x)),
    sec: unary(x => 1 / M.cos(x)),
    csc: unary(x => 1 / M.sin(x)),
    // 反三角
    asin: unary(M.asin), acos: unary(M.acos), atan: unary(M.atan),
    atan2: { fn: M.atan2, arity: 2 },
    // 双曲
    sinh: unary(M.sinh), cosh: unary(M.cosh), tanh: unary(M.tanh),
    // 指数 / 对数
    //   对数分三种写法，界面提示里也写清楚了：
    //     ln  = 自然对数（底 e）
    //     log = 常用对数（底 10）—— 和很多计算器一致
    //     log2 / log10 = 底 2 / 底 10
    exp: unary(M.exp),
    ln: unary(M.log),
    log: unary(M.log10),
    log10: unary(M.log10),
    log2: unary(M.log2),
    // 幂 / 根
    sqrt: unary(M.sqrt), cbrt: unary(M.cbrt),
    pow: { fn: M.pow, arity: 2 },
    // 取整 / 符号 / 绝对值
    abs: unary(M.abs), sign: unary(M.sign),
    floor: unary(M.floor), ceil: unary(M.ceil),
    round: unary(M.round), trunc: unary(M.trunc),
    mod: { fn: (a, b) => a % b, arity: 2 },
    // 多参数
    min: { fn: (...a) => Math.min(...a), arity: -1 },
    max: { fn: (...a) => Math.max(...a), arity: -1 },
  };
})();

const GFX_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/* 根号当**前缀运算符**处理（而不是普通函数名），因为它后面可以不带括号：
     √x、√(x+1)、√4x、∛x、∜x 都得认出来。
   值是根指数，编译时换成 sqrt / cbrt / pow(a, 1/n)。 */
const GFX_RAD = { '\u221A': 2, '\u221B': 3, '\u221C': 4 };

/* 上标数字/符号：x²、x⁻¹、x²³ 这种写法在日常输入里很常见（尤其从别处
   复制来的式子）。归一化时整段转成 ^2、^-1、^23 —— 转完和手写的 ^ 完全
   等价，于是优先级、右结合那些规则一个字都不用改。 */
const GFX_SUP = {
  '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
  '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
  '\u2078': '8', '\u2079': '9', '\u207A': '+', '\u207B': '-',
};

/* 自定义变量的名字不能乱来：不能是 x（自变量）、不能撞常量或函数名。
   返回空串表示合法，否则是错误说明。selfId 用来放过"自己"（改名时不算重复）。 */
function gfxVarNameError(name, selfId) {
  const n = String(name || '').trim();
  if (!n) return '请输入变量名';
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(n)) return '变量名只能是字母、数字、下划线，且不能以数字开头';
  if (n.length > 12) return '变量名太长了';
  const low = n.toLowerCase();
  if (low === 'x') return 'x 是自变量，不能当变量名';
  if (low in GFX_CONSTS) return `「${name}」已经被常量占用`;
  if (GFX_FUNCS[low]) return `「${name}」已经被函数占用`;
  if (gfxVars.some(v => v.id !== selfId && v.name.toLowerCase() === low)) return '这个变量名重复了';
  return '';
}

/* 曲线配色。挑的是明度接近、色相拉开的几档，
   叠在一起也能分得清（顺序也是默认给新函数取色的顺序）。 */
const GFX_COLORS = [
  '#2563eb',  // 蓝（主题蓝）
  '#E25539',  // 砖红（二十四点那张卡的底色）
  '#1DB994',  // 绿（函数图像那张卡的底色）
  '#7c3aed',  // 紫
  '#d97706',  // 橙
  '#0891b2',  // 青
  '#db2777',  // 玫红
  '#65a30d',  // 橄榄
];

/* ==========================================================
   二、解析：文本 → 语法树
   ========================================================== */

/** 带位置的解析错误，好把"第几个字符"报给用户 */
class GfxError extends Error {
  constructor(message, pos) {
    super(message);
    this.name = 'GfxError';
    this.pos = pos;
  }
}

/** 全角符号、各种乘除减写法统一成 ASCII（中文输入法的常见产物） */
function gfxNormalize(s) {
  return String(s)
    .replace(/\uFF08/g, '(')                              // （
    .replace(/\uFF09/g, ')')                              // ）
    .replace(/[\u00D7\u2715\u2716\u2217]/g, '*')          // × ✕ ✖ ∗
    .replace(/[\u00F7\uFF0F]/g, '/')                      // ÷ ／
    .replace(/[\u2212\u2013\u2014\u30FC\uFF0D]/g, '-')    // − – — ー －
    .replace(/\uFF0B/g, '+')                              // ＋
    .replace(/\uFF3E/g, '^')                              // ＾
    .replace(/\uFF5C/g, '|')                              // ｜（全角竖线）
    .replace(/\u2223/g, '|')                              // ∣（数学竖线）
    .replace(/[\uFF10-\uFF19]/g, c =>                     // ０-９
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 上标：x² → x^2、x⁻¹ → x^-1。
    // 连着的整段一起转（x²³ → x^23），并以 ^ 起头；转出来的就是普通 ASCII，
    // 后面那些规则不会再动它。
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079\u207A\u207B]+/g, run => {
      let digits = '';
      for (const ch of run) digits += GFX_SUP[ch] || '';
      return '^' + digits;
    })
    // π 换成 pi 时**两头补空格**：不补的话 2π → "2pi" 还好，
    // 但 πx → "pix"、xπ → "xpi" 会被当成一个名字，报"不认识的名称"。
    // 补上空格正好变成两个记号，交给隐式乘法接上。
    .replace(/\u03C0/g, ' pi ')
    .replace(/\u3000/g, ' ');                             // 全角空格
}

function gfxTokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }

    // 数字（允许 3.5、.5）
    if ((c >= '0' && c <= '9') ||
        (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < src.length && (/[0-9]/.test(src[j]) || src[j] === '.')) j++;
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new GfxError('这个数字写得不完整：' + raw, i);
      out.push({ t: 'num', v, pos: i });
      i = j;
      continue;
    }

    // 名字（函数名 / 变量 / 常量）
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase(),
                 raw: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const rad = GFX_RAD[c];
    if (rad) { out.push({ t: 'rad', n: rad, pos: i }); i++; continue; }

    if ('+-*/^(),|'.indexOf(c) >= 0) { out.push({ t: 'op', v: c, pos: i }); i++; continue; }

    throw new GfxError('不认识这个符号：「' + c + '」', i);
  }
  return out;
}

function gfxParse(text, opts) {
  const src = gfxNormalize(text);
  const tokens = gfxTokenize(src);

  // 自定义变量：vars 是"已经定义过的变量名"（小写）集合，只在解析时用来**校验**
  // 名字认不认得。取值不在这里定死 —— 编译出的闭包求值时现查 gfxVarValues，
  // 于是改一个变量的值只要重画，不必把所有表达式重新解析一遍。
  const vars = (opts && opts.vars) || null;
  const allowX = !opts || opts.allowX !== false;
  const used = new Set();          // 这个表达式用到了哪些自定义变量（算依赖用）
  let pos = 0;
  // 当前处在几层未闭合的 |…| 里。只用来消除一个歧义：
  //   | 既能当"左界定"，又能当"隐式乘的因子开头"（2|x|）。
  //   在 |…| 内部时它必须是**右界定**，否则 |x| 会被读成 x * |…| 而报"没写完"。
  let pipeDepth = 0;

  const peek = (k = 0) => tokens[pos + k];
  const isOp = (tk, v) => tk && tk.t === 'op' && tk.v === v;
  const eat = v => { if (isOp(peek(), v)) { pos++; return true; } return false; };
  const endPos = () => (tokens.length ? tokens[tokens.length - 1].pos + 1 : src.length);

  // 表达式 = 项 (('+'|'-') 项)*
  function expr() {
    let node = term();
    for (;;) {
      const tk = peek();
      if (isOp(tk, '+') || isOp(tk, '-')) {
        pos++;
        node = { t: 'bin', op: tk.v, l: node, r: term() };
      } else break;
    }
    return node;
  }

  // 项 = 一元 (('*'|'/'|隐式乘) 一元)*
  function term() {
    let node = unary();
    for (;;) {
      const tk = peek();
      if (isOp(tk, '*') || isOp(tk, '/')) {
        pos++;
        node = { t: 'bin', op: tk.v, l: node, r: unary() };
      } else if (tk && (
          tk.t === 'num' || tk.t === 'id' || tk.t === 'rad' ||
          isOp(tk, '(') || (isOp(tk, '|') && pipeDepth === 0)
      )) {
        // 隐式乘：2x、3sin(x)、x(x+1)、(x+1)(x-1)、2√x、2|x|……
        // 下一个记号能起一个因子，就在中间补一个乘号。
        // 注意 | 这一项带了 pipeDepth === 0 的前提：在 |…| 内部，
        // 那个 | 是收尾用的，不该被当成乘号（见上面 pipeDepth 的说明）。
        node = { t: 'bin', op: '*', l: node, r: unary() };
      } else break;
    }
    return node;
  }

  // 一元 = ('+'|'-'|根号)* 幂
  //   —— 负号在**幂之外**，所以 -x^2 = -(x^2)，符合数学惯例
  //   —— 根号后面接一个 unary()，于是 √x^2 = √(x^2)、√√x 也能写；
  //      但 √4x 是 √4·x（只吃紧挨着的那一个因子），和书写习惯一致
  function unary() {
    const tk = peek();
    if (isOp(tk, '-')) { pos++; return { t: 'neg', a: unary() }; }
    if (isOp(tk, '+')) { pos++; return unary(); }
    if (tk && tk.t === 'rad') {
      pos++;
      // 2 次 = sqrt、3 次 = cbrt（都用内建的，比 pow 快也准）；
      // 其余（∜）走 root 节点，编译成 pow(a, 1/n)
      return { t: 'root', deg: tk.n, a: unary() };
    }
    return power();
  }

  // 幂 = 原子 ('^' 一元)?
  //   —— 右边又交给 unary，于是右结合，且 2^-1 这种也写得出
  function power() {
    const base = atom();
    if (isOp(peek(), '^')) {
      pos++;
      return { t: 'bin', op: '^', l: base, r: unary() };
    }
    return base;
  }

  function atom() {
    const tk = peek();
    if (!tk) throw new GfxError('算式没写完', src.length);

    if (tk.t === 'num') { pos++; return { t: 'num', v: tk.v }; }

    if (tk.t === 'id') {
      pos++;
      const name = tk.v;
      const def = GFX_FUNCS[name];

      // 函数调用：名字后面**必须**跟着左括号
      if (def && isOp(peek(), '(')) {
        pos++;                                  // 吃掉 '('
        const args = [];
        if (!isOp(peek(), ')')) {
          args.push(expr());
          while (eat(',')) args.push(expr());
        }
        if (!eat(')')) throw new GfxError('括号没有配对', tk.pos);
        if (def.arity >= 0 && args.length !== def.arity) {
          throw new GfxError(
            `${name} 需要 ${def.arity} 个参数，这里给了 ${args.length} 个`, tk.pos);
        }
        if (def.arity < 0 && args.length < 1) {
          throw new GfxError(`${name} 至少要有 1 个参数`, tk.pos);
        }
        return { t: 'call', name, args };
      }

      if (def) {
        // 只有函数名、没有括号 —— 明确报错，别猜用户想表达什么
        throw new GfxError('函数要写成 ' + name + '(…)，别忘了括号', tk.pos);
      }

      if (name === 'x') {
        if (!allowX) throw new GfxError('这里不能用 x —— 变量值得是个固定数', tk.pos);
        return { t: 'var', name: 'x' };
      }
      if (name in GFX_CONSTS) return { t: 'num', v: GFX_CONSTS[name] };
      if (vars && vars.has(name)) {
        used.add(name);                      // 记下依赖，变量之间算引用关系要用
        return { t: 'var', name };
      }

      // 报错时把可用的名字列出来，省得用户一个个猜
      const known = ['x', ...Object.keys(GFX_CONSTS), ...(vars ? [...vars] : [])];
      throw new GfxError(
        `不认识的名称：${tk.raw || name}（可用的有 ${known.join('、')}）`, tk.pos);
    }

    if (isOp(tk, '(')) {
      pos++;
      const node = expr();
      if (!eat(')')) throw new GfxError('括号没有配对', tk.pos);
      return node;
    }

    // 绝对值 |…|
    //   | 既当左界定也当右界定。消歧靠一个"当前在几层 | 里"的计数：
    //     · 该起因子的位置遇到 |     → 开一个绝对值（层数 +1）
    //     · 在 |…| 内部时，| 只可能是**右界定**（term 里那条隐式乘规则
    //       特意排除了这种情形），于是里面那个表达式正好在收尾的 | 处停下
    //   这样 |x||y|（两个绝对值相乘）、||x||（嵌套）都能正确读出来。
    if (isOp(tk, '|')) {
      pos++;
      pipeDepth++;
      const inner = expr();
      pipeDepth--;
      if (!eat('|')) throw new GfxError('绝对值符号 | 没有配对', tk.pos);
      return { t: 'call', name: 'abs', args: [inner] };
    }

    throw new GfxError('算式写得不太对，检查一下', tk.pos);
  }

  const root = expr();
  if (pos < tokens.length) {
    const tk = tokens[pos];
    throw new GfxError('有多余的内容：「' + (tk.raw || tk.v) + '」', tk.pos);
  }
  const fn = gfxCompile(root);
  // 把用到的自定义变量挂在函数上：算变量之间的依赖顺序要用（见 gfxRecalcVars）
  fn.deps = [...used];
  return fn;
}

/* ==========================================================
   三、编译：语法树 → 闭包
   出来的就是普通函数 (x) => number，之后画图只调它。
   ========================================================== */
function gfxCompile(node) {
  switch (node.t) {
    case 'num': {
      const v = node.v;
      return () => v;
    }
    case 'var':
      // x 是自变量；其它名字是用户自定义变量，**每次求值现查** gfxVarValues，
      // 于是改一个变量的值只要重画，不必把所有表达式重新解析一遍
      return node.name === 'x' ? (x => x) : (() => gfxVarLookup(node.name));
    case 'root': {
      const a = gfxCompile(node.a);
      const n = node.deg;
      if (n === 2) return x => Math.sqrt(a(x));
      if (n === 3) return x => Math.cbrt(a(x));
      return x => Math.pow(a(x), 1 / n);
    }
    case 'neg': {
      const a = gfxCompile(node.a);
      return x => -a(x);
    }
    case 'bin': {
      const l = gfxCompile(node.l);
      const r = gfxCompile(node.r);
      switch (node.op) {
        case '+': return x => l(x) + r(x);
        case '-': return x => l(x) - r(x);
        case '*': return x => l(x) * r(x);
        // 除 0 不给特殊处理：得到 Infinity / NaN，采样那头会当成"抬笔"，
        // 图像自然在断点处断开，正是想要的效果
        case '/': return x => l(x) / r(x);
        case '^': return x => Math.pow(l(x), r(x));
      }
      break;
    }
    case 'call': {
      const def = GFX_FUNCS[node.name];
      const args = node.args.map(gfxCompile);
      if (def.arity === 1) return x => def.fn(args[0](x));
      if (def.arity === 2) return x => def.fn(args[0](x), args[1](x));
      return x => def.fn(...args.map(a => a(x)));      // 变参（min / max）
    }
  }
  throw new Error('内部错误：无法编译这个节点');
}

/* ==========================================================
   四、画布 / 视野
   ----------------------------------------------------------
   视野用一个「中心 + 比例」表示，而不是 xmin/xmax/ymin/ymax 四个数：
     · 比例（scale）= 一个屏幕像素对应多少世界单位
     · x 与 y **共用一个比例**，于是横纵等比例 —— 圆看着是圆，
       sin 的振幅不会因为画布被拉长而变形
     · 平移就是改中心，缩放就是改比例，不用管两个轴各自的范围
   ========================================================== */
const gfxPlot   = $('#gfxPlot');
const gfxCanvas = $('#gfxCanvas');

const gfxView = { cx: 0, cy: 0, scale: 0.03 };   // scale 在首次量到尺寸后重算
let gfxSize = { w: 0, h: 0 };
let gfxDpr  = 1;
let gfxCtx  = null;

const gfxXMin = () => gfxView.cx - gfxView.scale * gfxSize.w / 2;
const gfxYMax = () => gfxView.cy + gfxView.scale * gfxSize.h / 2;
const gfxToPx = x => (x - gfxXMin()) / gfxView.scale;
const gfxToPy = y => (gfxYMax() - y) / gfxView.scale;
const gfxToX  = px => gfxXMin() + px * gfxView.scale;
const gfxToY  = py => gfxYMax() - py * gfxView.scale;

/** 量一次画布尺寸并适配 DPR。w/h 为 0（页面还没显示）时直接跳过。 */
function gfxFit() {
  if (!gfxPlot || !gfxCanvas) return;

  // 以**画布自己的矩形**为准（可以是小数），而不是容器的 clientWidth（整数）：
  //   clientWidth = 447，而画布实际显示 447.33 —— 差这 0.33px，
  //   绘图坐标和指针映射就对不齐，表现为"以光标为锚点缩放时，
  //   光标底下的点每缩一次漂走一点"。用画布矩形，两套坐标天然一致。
  const rect = gfxCanvas.getBoundingClientRect();
  let w = rect.width;
  let h = rect.height;
  if (!(w > 0) || !(h > 0)) {
    // 还没显示出来（display:none）时矩形是 0，退回容器量一把
    w = gfxPlot.clientWidth;
    h = gfxPlot.clientHeight;
  }
  if (!(w > 0) || !(h > 0)) return;

  const prevXSpan = gfxSize.w ? gfxView.scale * gfxSize.w : 0;

  const dpr = window.devicePixelRatio || 1;
  gfxDpr = dpr;
  // 后备存储按物理像素，CSS 那边是 100% —— 两边不一致时浏览器会缩放，
  // 于是高清屏上线条才不发虚
  gfxCanvas.width  = Math.round(w * dpr);
  gfxCanvas.height = Math.round(h * dpr);
  gfxSize = { w, h };

  if (prevXSpan) {
    // 窗口变了：保持**横向可见范围**不变，纵向随高度自然增减
    gfxView.scale = prevXSpan / w;
  } else {
    gfxResetView();
    return;
  }
  gfxScheduleDraw();
}

/** 复位：横向约 [-10, 10]，纵向按画布比例自动定 */
function gfxResetView() {
  gfxView.cx = 0;
  gfxView.cy = 0;
  gfxView.scale = 20 / Math.max(gfxSize.w, 1);
  gfxScheduleDraw();
}

/* ---- 绘制调度：一帧内多次请求只画一次 ---- */
let gfxRaf = null;
function gfxScheduleDraw() {
  if (gfxRaf) return;
  gfxRaf = requestAnimationFrame(() => { gfxRaf = null; gfxDraw(); });
}

/* ==========================================================
   五、网格 / 坐标轴
   ========================================================== */

/** 1-2-5 步长：出来的刻度数字才好看（1、2、5、10…，而不是 1.37、2.74） */
function gfxNiceStep(span, target) {
  const raw = span / Math.max(target, 1);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

/** 刻度文字：按步长决定小数位，再去掉多余的 0 */
function gfxFmtTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-5) {
    return v.toExponential(0).replace('e+', 'e');
  }
  const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  let s = v.toFixed(dec);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

const GFX_FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

function gfxDrawGrid(ctx) {
  const { w, h } = gfxSize;
  const xSpan = gfxView.scale * w;
  const ySpan = gfxView.scale * h;
  const stepX = gfxNiceStep(xSpan, Math.max(2, Math.round(w / 96)));
  const stepY = gfxNiceStep(ySpan, Math.max(2, Math.round(h / 76)));

  const i0 = Math.ceil(gfxXMin() / stepX);
  const i1 = Math.floor((gfxXMin() + xSpan) / stepX);
  const j0 = Math.ceil((gfxYMax() - ySpan) / stepY);
  const j1 = Math.floor(gfxYMax() / stepY);
  if (i1 - i0 > 400 || j1 - j0 > 400) return;      // 保险：别画出海量线

  // ---- 网格 ----
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#eef0f4';
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const px = Math.round(gfxToPx(i * stepX)) + 0.5;   // +0.5 → 1px 线不糊
    ctx.moveTo(px, 0); ctx.lineTo(px, h);
  }
  for (let j = j0; j <= j1; j++) {
    const py = Math.round(gfxToPy(j * stepY)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(w, py);
  }
  ctx.stroke();

  // ---- 坐标轴（x=0 / y=0，可能不在视野里）----
  const x0px = gfxToPx(0);
  const y0px = gfxToPy(0);
  const hasY = x0px >= 0 && x0px <= w;
  const hasX = y0px >= 0 && y0px <= h;

  ctx.strokeStyle = '#c3c9d4';
  ctx.beginPath();
  if (hasY) { const px = Math.round(x0px) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
  if (hasX) { const py = Math.round(y0px) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
  ctx.stroke();

  // ---- 刻度文字 ----
  // 贴着坐标轴画；轴跑到画布外时，夹到边缘，保证标签始终看得见
  ctx.fillStyle = '#9aa1ac';
  ctx.font = GFX_FONT;

  const labY = Math.min(Math.max(y0px, 4), h - 16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = i0; i <= i1; i++) {
    if (i === 0 && hasY) continue;                 // 原点的 0 交给 y 轴那侧写
    const x = i * stepX;
    ctx.fillText(gfxFmtTick(x, stepX), gfxToPx(x), labY + 4);
  }

  const labX = Math.min(Math.max(x0px, 40), w - 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let j = j0; j <= j1; j++) {
    if (j === 0) continue;                         // 0 不重复写
    const y = j * stepY;
    ctx.fillText(gfxFmtTick(y, stepY), labX - 6, gfxToPy(y));
  }
}

/* ==========================================================
   六、画一条曲线
   ----------------------------------------------------------
   核心是「按屏幕列采样 + 该抬笔时抬笔」：
     · 屏幕多宽就采多少个点，分辨率天然够（一条曲线也就几百次求值）
     · 定义域外（sqrt(-1) → NaN、1/0 → Infinity）当成抬笔，
       曲线在那里断开 —— 而不是抛错中断整张图
     · 相邻两点若跳得离谱，说明中间夹着渐近线（tan、1/x），
       也要抬笔，否则会连出一条**假的竖线**
   ========================================================== */
function gfxDrawCurve(ctx, fn, color) {
  const { w, h } = gfxSize;
  const farAway = h * 60;          // 比这还远的点直接丢掉（不是夹到边缘）
  // 一屏三倍高。这个数是量出来的，不是拍脑袋：
  //   · 取 4 倍时，tan(2x) 会漏掉 6 处极点，画出 6 条横贯画布的**假竖线**
  //   · 收到 1 倍时，tan 干净了，但 x^5 这种合法陡峭的函数会被切出 44 个缺口
  //   3 倍 + 下面那条"横跨画布"判断一起用：tan/1x² 一根假线都不剩，
  //   而 x^5 只在屏幕外断开 6 处（看不见）。
  const jumpLimit = h * 3;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let pen = false;
  let prevPy = 0;

  for (let px = 0; px <= w; px++) {
    const x = gfxToX(px);
    let y;
    try { y = fn(x); } catch (_) { y = NaN; }

    if (!Number.isFinite(y)) { pen = false; continue; }      // 定义域外

    const py = gfxToPy(y);
    if (Math.abs(py) > farAway) { pen = false; continue; }   // 跑太远，丢掉

    if (pen) {
      // 中间夹着渐近线（tan、1/x 的极点）就抬笔，否则会连出一条假竖线。
      // 两种情形都算：
      //   · 跳得离谱（超过三倍屏高）
      //   · 一端在画布上方、另一端在下方 —— 这条线必然横穿可见区，
      //     而连续函数在相邻两列间不可能这样（能这样就说明中间断了）
      const spans = (prevPy < 0 && py > h) || (prevPy > h && py < 0);
      if (Math.abs(py - prevPy) > jumpLimit || spans) pen = false;
    }

    if (pen) ctx.lineTo(px, py);
    else { ctx.moveTo(px, py); pen = true; }

    prevPy = py;
  }
  ctx.stroke();
}

/* ==========================================================
   七、总绘制
   ========================================================== */
function gfxDraw() {
  if (!gfxCanvas || !gfxSize.w) return;
  if (!gfxCtx) gfxCtx = gfxCanvas.getContext('2d');
  const ctx = gfxCtx;
  if (!ctx) return;

  // setTransform 是**重置**变换，不是叠加 —— 反复 resize 也不会累积
  ctx.setTransform(gfxDpr, 0, 0, gfxDpr, 0, 0);
  ctx.clearRect(0, 0, gfxSize.w, gfxSize.h);

  gfxDrawGrid(ctx);                                   // 先网格
  gfxFns.forEach(f => {                               // 后曲线（压在网格上）
    if (f.visible && f.fn) gfxDrawCurve(ctx, f.fn, f.color);
  });
}

/* ==========================================================
   八、自定义变量
   ----------------------------------------------------------
   用户可以定义 a、b、k 这类变量，在表达式里直接用（a*sin(b*x)）。
   三个设计要点：

   1) 值是"活"的：编译后的闭包求值时现查 gfxVarValues，不是解析时定死。
      于是拖动数值、改一个值，只要重画，不用把每条表达式重新解析一遍。
   2) 变量值本身也是表达式（可以写 pi/2、2*e、甚至引用别的变量）。
   3) 变量之间允许任意顺序互相引用，用"反复试算直到没有进展"的办法排顺序；
      最后还剩下没算出来的，就是循环引用 —— 报出来而不是死循环。
   ========================================================== */
const gfxVarsEl = $('#gfxVars');

let gfxVars = [];                     // { id, name, expr, fn, deps, error }
let gfxVarSeq = 0;
const gfxVarValues = new Map();       // 变量名(小写) → 数值，编译后的闭包从这里取

/** 编译后的自定义变量节点求值时调它。取不到就给 NaN（曲线自然断开）。 */
function gfxVarLookup(name) {
  const v = gfxVarValues.get(name);
  return typeof v === 'number' ? v : NaN;
}

/** 当前已定义的变量名集合（小写），解析表达式时用来校验名字 */
function gfxVarNameSet() {
  const s = new Set();
  gfxVars.forEach(v => { if (v.name) s.add(v.name.toLowerCase()); });
  return s;
}

/** 把某个表达式编译成 (x) => number，允许用已定义的变量。
 *  opts.allowX=false 用于变量值（值必须是固定的，不能含自变量）。 */
function gfxCompileExpr(text, allowX) {
  return gfxParse(text, { vars: gfxVarNameSet(), allowX: allowX !== false });
}

/** 按依赖顺序把所有变量的值算一遍，写进 gfxVarValues。
 *
 *  只清 error（求值期的问题）—— nameError / parseError 是"解析"的结论，
 *  由 gfxParseVar 管，这里动了会把它们抹掉。 */
function gfxRecalcVars() {
  gfxVarValues.clear();
  gfxVars.forEach(v => { v.error = ''; });

  const pending = gfxVars.filter(v => v.name && v.fn);
  let progress = true;

  // 反复扫，每一轮把"依赖都已经算出来"的算掉，直到一轮下来毫无进展。
  // 这样任意定义顺序都能用（b 引用还没定义的 a 也行），
  // 而且天然不会因为互相引用而卡死。
  while (progress && pending.length) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const v = pending[i];
      const ready = (v.deps || []).every(n => gfxVarValues.has(n));
      if (!ready) continue;

      let val;
      try { val = v.fn(0); } catch (_) { val = NaN; }
      gfxVarValues.set(v.name.toLowerCase(), val);
      if (!Number.isFinite(val)) v.error = '算不出一个确定的数';
      pending.splice(i, 1);
      progress = true;
    }
  }

  // 剩下的：依赖了不存在或互相引用的变量
  pending.forEach(v => { v.error = '有变量还没定义好，或者几个变量互相引用'; });
  gfxPaintVarErrors();
}

/** 把每个变量的错误按优先级画到对应的输入框下面，并重画曲线 */
function gfxPaintVarErrors() {
  gfxVars.forEach(v => {
    if (!v.valEl) return;
    const msg = v.nameError || v.parseError || v.error;
    if (msg) setError(v.valEl, msg);
    else clearError(v.valEl);
  });
  // 变量的值可能变了，用到它们的曲线都得重画
  gfxScheduleDraw();
}

/** 变量名/增删变了：所有表达式都要重新解析（名字的合法性变了） */
function gfxReparseAllFns() {
  gfxFns.forEach(f => gfxSetExpr(f, f.expr));
}

/* ---- 造一行变量界面 ---- */
function gfxMakeVarRow(item) {
  const row = document.createElement('div');
  row.className = 'gfx-var';
  row.dataset.id = String(item.id);

  const nameWrap = document.createElement('div');
  nameWrap.className = 'input-wrap gfx-var-name-box';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'gfx-var-name';
  nameInput.maxLength = 12;
  nameInput.value = item.name || '';
  nameInput.placeholder = 'a';
  nameInput.autocomplete = 'off';
  nameInput.autocapitalize = 'off';
  nameInput.autocorrect = 'off';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', '变量名');
  nameWrap.appendChild(nameInput);

  const eq = document.createElement('span');
  eq.className = 'gfx-var-eq';
  eq.textContent = '=';
  eq.setAttribute('aria-hidden', 'true');

  // 值和它的报错要包一层：setError() 要求 .hint 紧跟 .input-wrap
  const field = document.createElement('div');
  field.className = 'gfx-field';
  const valWrap = document.createElement('div');
  valWrap.className = 'input-wrap gfx-input';
  valWrap.setAttribute('data-field', '');
  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'gfx-var-val';
  valInput.maxLength = 80;
  valInput.value = item.expr || '';
  valInput.placeholder = '例如 2、pi/2';
  valInput.autocomplete = 'off';
  valInput.autocapitalize = 'off';
  valInput.autocorrect = 'off';
  valInput.spellcheck = false;
  valInput.setAttribute('aria-label', '变量值');
  valWrap.appendChild(valInput);
  gfxPadBind(valInput);     // 变量值也走软键盘（名字那一栏不接，它是字母）
  const hint = document.createElement('div');
  hint.className = 'hint';
  field.append(valWrap, hint);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'gfx-del';
  del.setAttribute('aria-label', '删除这个变量');
  del.title = '删除';
  del.textContent = '\u2715';

  row.append(nameWrap, eq, field, del);

  item.rowEl = row;
  item.nameEl = nameInput;
  item.valEl = valInput;

  nameInput.addEventListener('input', () => gfxOnVarNameInput(item));
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
  });
  valInput.addEventListener('input', () => gfxOnVarValInput(item));
  valInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); valInput.blur(); }
  });
  del.addEventListener('click', () => gfxRemoveVar(item.id));

  return row;
}

/** 变量名（或值）的防抖：打字时不必每个按键都重新解析 */
const gfxVarTimers = new Map();
function gfxDebounceVar(item, fn) {
  const t = gfxVarTimers.get(item.id);
  if (t) clearTimeout(t);
  gfxVarTimers.set(item.id, setTimeout(() => {
    gfxVarTimers.delete(item.id);
    fn();
  }, 150));
}

/* 一个变量身上有**三种**错误，分开存，别混在一起：
     nameError  —— 名字不合法（重复、撞常量、含非法字符…）
     parseError —— 值表达式解析失败（写错符号、值里用了 x、引用了没定义的变量）
     error      —— 求值阶段的问题（几个变量互相引用、算不出确定的数）
   分开的原因：parseError 只有在"重新解析"时才会变，而 error 每次重算都要清。
   以前只有一个 error 字段、重算时无条件清空，于是
   "b = a*2 里 a 还没定义"这种解析错误会被静默抹掉，留下一行看着正常、
   其实压根没参与计算的变量。 */

/** 解析一个变量（名字 + 值），**不动**求值结果，也不刷界面 */
function gfxParseVar(item) {
  item.nameError = gfxVarNameError(item.nameEl.value, item.id);
  item.name = item.nameError ? '' : item.nameEl.value.trim();

  const raw = item.valEl.value.trim();
  item.expr = item.valEl.value;

  if (!raw) {
    item.fn = null;
    item.deps = [];
    item.parseError = '';
    return;
  }
  try {
    const fn = gfxCompileExpr(raw, false);       // 值里不许出现 x
    item.fn = fn;
    item.deps = fn.deps || [];
    item.parseError = '';
  } catch (err) {
    item.fn = null;
    item.deps = [];
    item.parseError = (err && err.message) || '这个值写得不太对';
    if (err instanceof GfxError && typeof err.pos === 'number') {
      item.parseError += `（第 ${err.pos + 1} 个字符附近）`;
    }
  }
}

/** 把所有变量重新解析一遍。
 *
 *  变量名集合一变（增、删、改名），别的变量值里引用的名字就可能从
 *  "没定义"变成"有定义"（反之亦然），所以**所有**变量都得重解析，
 *  不能只解析被改的那一个 —— 否则 b = a*2 这种先定义、a 后定义的写法
 *  永远停在"解析失败"上。 */
function gfxReparseVars() {
  gfxVars.forEach(gfxParseVar);
  gfxRecalcVars();
}

/** 取一个变量的值（供 gfxVarLookup 之外的场合，比如调试） */
function gfxVarValue(name) {
  const v = gfxVarValues.get(String(name || '').toLowerCase());
  return typeof v === 'number' ? v : NaN;
}

function gfxOnVarNameInput(item) {
  gfxDebounceVar(item, () => {
    gfxReparseVars();
    // 可用名字变了，函数表达式也可能从"报错"变成"能算"，一并重解析
    gfxReparseAllFns();
  });
}

function gfxOnVarValInput(item) {
  gfxDebounceVar(item, () => {
    gfxParseVar(item);
    gfxRecalcVars();
    // 只是值变了：闭包是现查的，函数不必重解析；但之前因"变量没定义"
    // 而报错的那些要再试一次（比如刚把 a 的值填上）
    gfxFns.forEach(f => { if (!f.fn) gfxSetExpr(f, f.expr); });
  });
}

function gfxAddVar(name, expr) {
  const item = {
    id: ++gfxVarSeq,
    name: name || gfxNextVarName(),
    expr: expr || '',
    fn: null, deps: [],
    nameError: '', parseError: '', error: '',
  };
  gfxVars.push(item);
  gfxVarsEl.appendChild(gfxMakeVarRow(item));
  gfxReparseVars();
  gfxReparseAllFns();        // 多了一个可用名字，函数要重新试
  gfxSyncVarHint();
  return item;
}

/** 取一个还没被占用的默认名：a、b、c…… */
function gfxNextVarName() {
  const used = gfxVarNameSet();
  for (const c of 'abcdefghijklmnopqrstuvwxyz') {
    if (!used.has(c)) return c;
  }
  let i = 1;
  while (used.has('v' + i)) i++;
  return 'v' + i;
}

function gfxRemoveVar(id) {
  const i = gfxVars.findIndex(v => v.id === id);
  if (i < 0) return;
  const [item] = gfxVars.splice(i, 1);
  const t = gfxVarTimers.get(id);
  if (t) { clearTimeout(t); gfxVarTimers.delete(id); }
  if (item.rowEl && item.rowEl.parentNode) item.rowEl.parentNode.removeChild(item.rowEl);
  gfxReparseVars();
  gfxReparseAllFns();          // 名字没了，用到它的表达式要重新报错
  gfxSyncVarHint();
}

function gfxClearVars() {
  gfxVars.splice(0).forEach(v => {
    const t = gfxVarTimers.get(v.id);
    if (t) { clearTimeout(t); gfxVarTimers.delete(v.id); }
  });
  gfxVarTimers.clear();
  gfxVarsEl.textContent = '';
  gfxVarSeq = 0;
  gfxVarValues.clear();
  gfxSyncVarHint();
}

/** 有变量时才显示那段说明，没变量时这一块只剩一行按钮，不占地方 */
const gfxVarHintEl = $('#gfxVarsHint');
function gfxSyncVarHint() {
  if (gfxVarHintEl) gfxVarHintEl.hidden = gfxVars.length === 0;
}

/* ==========================================================
   九、函数列表（界面 + 状态）
   ========================================================== */
const gfxListEl = $('#gfxList');

let gfxFns = [];        // { id, expr, color, visible, fn, error }
let gfxSeq = 0;
let gfxOwner = null;    // 上次进来时登录的是谁

/** 一条函数：解析表达式。成功就把 fn 换掉，失败挂上 error 并把曲线撤下。 */
function gfxSetExpr(item, text) {
  const input = item.inputEl;
  const trimmed = String(text || '').trim();

  item.expr = text;

  if (!trimmed) {
    item.fn = null;
    item.error = '';
    if (input) clearError(input);
    gfxScheduleDraw();
    return;
  }

  try {
    item.fn = gfxCompileExpr(trimmed, true);
    item.error = '';
    if (input) clearError(input);
  } catch (err) {
    item.fn = null;
    item.error = (err && err.message) || '算式写得不太对';
    if (input && err instanceof GfxError && typeof err.pos === 'number') {
      item.error = `${item.error}（第 ${err.pos + 1} 个字符附近）`;
    }
    if (input) setError(input, item.error);
  }
  gfxScheduleDraw();
}

/** 造一行界面 */
function gfxMakeRow(item) {
  const row = document.createElement('div');
  row.className = 'gfx-row';
  row.dataset.id = String(item.id);

  const line = document.createElement('div');
  line.className = 'gfx-line';

  // 颜色块：点一下换下一个颜色（省一个取色器，也比原生取色器好看）
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'gfx-dot';
  dot.style.background = item.color;
  dot.title = '换个颜色';
  dot.setAttribute('aria-label', '换个颜色');
  dot.addEventListener('click', () => {
    const i = GFX_COLORS.indexOf(item.color);
    item.color = GFX_COLORS[(i + 1) % GFX_COLORS.length];
    dot.style.background = item.color;
    gfxScheduleDraw();
  });

  const wrap = document.createElement('div');
  wrap.className = 'input-wrap gfx-input';
  wrap.setAttribute('data-field', '');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gfx-expr';
  input.maxLength = 120;
  input.placeholder = '例如 sin(x)、x^2/8、2x+1';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.autocorrect = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', '函数表达式');
  input.value = item.expr || '';
  input.addEventListener('input', () => gfxOnInput(item));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });
  wrap.appendChild(input);
  gfxPadBind(input);        // 接软键盘（触摸设备上同时关掉系统键盘）

  // 显示 / 隐藏
  const eye = document.createElement('label');
  eye.className = 'gfx-eye';
  eye.title = '显示 / 隐藏这条曲线';
  const box = document.createElement('span');
  box.className = 'checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = item.visible;
  const mark = document.createElement('span');
  box.append(cb, mark);
  eye.appendChild(box);
  cb.addEventListener('change', () => {
    item.visible = cb.checked;
    row.classList.toggle('is-off', !item.visible);
    gfxScheduleDraw();
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'gfx-del';
  del.setAttribute('aria-label', '删除这个函数');
  del.title = '删除';
  del.textContent = '\u2715';       // ✕
  del.addEventListener('click', () => gfxRemove(item.id));

  // 输入框和它的报错提示包一层。
  // 必须这样套：core.js 的 setError() 是"改 .input-wrap 的下一个兄弟"，
  // 所以 .hint 得**紧跟在** .input-wrap 后面。直接把它放在行末尾的话，
  // 中间隔着 eye/del，setError 找不到提示元素，报错就永远不显示
  // （.input-wrap 的红框还会照常加上，于是只有红框没有文字）。
  const field = document.createElement('div');
  field.className = 'gfx-field';
  const hint = document.createElement('div');
  hint.className = 'hint';
  field.append(wrap, hint);

  line.append(dot, field, eye, del);
  row.append(line);

  item.rowEl = row;
  item.inputEl = input;
  item.dotEl = dot;
  return row;
}

/** 输入防抖：打字时不必每个键都重新解析 + 重采样 */
const gfxTimers = new Map();
function gfxOnInput(item) {
  const prev = gfxTimers.get(item.id);
  if (prev) clearTimeout(prev);
  gfxTimers.set(item.id, setTimeout(() => {
    gfxTimers.delete(item.id);
    gfxSetExpr(item, item.inputEl.value);
  }, 150));
}

function gfxAdd(expr) {
  const item = {
    id: ++gfxSeq,
    expr: expr || '',
    color: GFX_COLORS[(gfxFns.length) % GFX_COLORS.length],
    visible: true,
    fn: null,
    error: '',
  };
  gfxFns.push(item);
  const row = gfxMakeRow(item);
  gfxListEl.appendChild(row);
  if (item.expr) gfxSetExpr(item, item.expr); else gfxScheduleDraw();
  return item;
}

function gfxRemove(id) {
  const i = gfxFns.findIndex(f => f.id === id);
  if (i < 0) return;
  const [item] = gfxFns.splice(i, 1);
  const t = gfxTimers.get(id);
  if (t) { clearTimeout(t); gfxTimers.delete(id); }
  if (item.rowEl && item.rowEl.parentNode) item.rowEl.parentNode.removeChild(item.rowEl);
  gfxScheduleDraw();
}

/** 退出登录 / 换人：清空，免得下一位看到上一位写的函数与变量 */
function gfxClearAll() {
  gfxFns.splice(0).forEach(f => {
    const t = gfxTimers.get(f.id);
    if (t) { clearTimeout(t); gfxTimers.delete(f.id); }
  });
  gfxTimers.clear();
  gfxListEl.textContent = '';
  gfxSeq = 0;
  gfxClearVars();
  gfxScheduleDraw();
}

/* ==========================================================
   十、交互：拖动平移 / 滚轮缩放 / 双指捏合
   ========================================================== */
const gfxPointers = new Map();     // pointerId → {x, y}（相对画布，CSS 像素）
let gfxGesture = null;

/** 指针位置 → 画布坐标。
 *
 *  必须换算到 gfxSize 那套（绘图用的）坐标里，不能直接拿 CSS 像素当坐标：
 *  gfxSize 取自 clientWidth（整数 447），而 getBoundingClientRect 可能是
 *  小数（447.33）。不换算的话，"以光标为锚点缩放"会差一点点 —— 每缩一次
 *  光标底下的点就漂走一点，连续缩放很明显。 */
function gfxLocalPos(e) {
  const r = gfxCanvas.getBoundingClientRect();
  const kx = r.width ? gfxSize.w / r.width : 1;
  const ky = r.height ? gfxSize.h / r.height : 1;
  return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky };
}

/** 以 (px, py) 为锚点缩放：那个像素下的世界坐标保持不动。
 *  factor > 1 是缩小（视野变大），< 1 是放大。 */
function gfxZoomAt(px, py, factor) {
  const wx = gfxToX(px);
  const wy = gfxToY(py);

  const old = gfxView.scale;
  gfxView.scale = old * factor;

  // 别缩到浮点精度崩掉，也别缩到什么都看不见
  const xSpan = gfxView.scale * gfxSize.w;
  if (!(xSpan > 1e-6) || !(xSpan < 1e7)) { gfxView.scale = old; return; }

  // 反推中心：让 (px, py) 依然落在 (wx, wy) 上
  gfxView.cx = wx + gfxView.scale * gfxSize.w / 2 - px * gfxView.scale;
  gfxView.cy = wy - gfxView.scale * gfxSize.h / 2 + py * gfxView.scale;
  gfxScheduleDraw();
}

function gfxStartGesture() {
  const pts = [...gfxPointers.values()];
  if (pts.length === 1) {
    gfxGesture = { mode: 'pan', from: pts[0], view: { ...gfxView } };
  } else if (pts.length >= 2) {
    const [a, b] = pts;
    gfxGesture = {
      mode: 'pinch',
      d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...gfxView },
    };
  } else {
    gfxGesture = null;
  }
}

function gfxApplyGesture() {
  const pts = [...gfxPointers.values()];
  if (!gfxGesture) return;

  if (gfxGesture.mode === 'pan' && pts.length === 1) {
    const dx = pts[0].x - gfxGesture.from.x;
    const dy = pts[0].y - gfxGesture.from.y;
    const s = gfxGesture.view.scale;
    // 内容跟着手走 → 视野中心反向移
    gfxView.cx = gfxGesture.view.cx - dx * s;
    gfxView.cy = gfxGesture.view.cy + dy * s;
    gfxScheduleDraw();
    return;
  }

  if (gfxGesture.mode === 'pinch' && pts.length >= 2) {
    const [a, b] = pts;
    const d1 = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const k = gfxGesture.d0 / d1;          // 手指张开 → k<1 → 放大

    Object.assign(gfxView, gfxGesture.view);   // 回到手势开始时的状态
    gfxZoomAt(gfxGesture.mid.x, gfxGesture.mid.y, k);
    // 锚点是起始中点；再按中点位移补一次平移，双指拖动才跟手
    const s = gfxView.scale;
    gfxView.cx -= (mid.x - gfxGesture.mid.x) * s;
    gfxView.cy += (mid.y - gfxGesture.mid.y) * s;
    gfxScheduleDraw();
  }
}

gfxCanvas.addEventListener('pointerdown', e => {
  // 手指滑出画布也继续跟。个别合成/异常事件里 pointerId 未必有效，
  // 抓不住就吞掉异常 —— 顶多跟到画布边缘，不影响拖动本身。
  try { gfxCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  gfxPointers.set(e.pointerId, gfxLocalPos(e));
  gfxStartGesture();
  e.preventDefault();
});

gfxCanvas.addEventListener('pointermove', e => {
  const pos = gfxLocalPos(e);
  if (gfxPointers.has(e.pointerId)) {
    gfxPointers.set(e.pointerId, pos);
    gfxApplyGesture();
  }
  gfxPaintReadout(pos);
});

function gfxEndPointer(e) {
  gfxPointers.delete(e.pointerId);
  gfxStartGesture();          // 还剩手指就重新起一个手势（双指→单指接着拖）
}

gfxCanvas.addEventListener('pointerup', gfxEndPointer);
gfxCanvas.addEventListener('pointercancel', gfxEndPointer);
gfxCanvas.addEventListener('pointerleave', e => {
  if (!gfxPointers.size) gfxPaintReadout(null);
});

// passive:false —— 要 preventDefault 拦住页面滚动
gfxCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const pos = gfxLocalPos(e);
  gfxZoomAt(pos.x, pos.y, Math.exp(e.deltaY * 0.0015));
}, { passive: false });

/* 光标处的坐标读数。纯粹是个顺手的小功能，指针不在画布上就显示 — */
const gfxReadoutEl = $('#gfxReadout');
function gfxPaintReadout(pos) {
  if (!gfxReadoutEl) return;
  if (!pos) { gfxReadoutEl.textContent = '—'; return; }
  const x = gfxToX(pos.x);
  const y = gfxToY(pos.y);
  const fmt = v => (Math.abs(v) < 1e-9 ? '0'
        : (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)
          ? v.toExponential(2)
          : String(Math.round(v * 1000) / 1000));
  gfxReadoutEl.textContent = `x = ${fmt(x)}　y = ${fmt(y)}`;
}

/* ==========================================================
   十一、事件绑定
   ========================================================== */
$('#gfxAdd').addEventListener('click', () => {
  const item = gfxAdd('');
  if (item && item.inputEl) setTimeout(() => item.inputEl.focus(), 60);
  gfxScrollIntoView(item);
});

$('#gfxAddVar').addEventListener('click', () => {
  const item = gfxAddVar('', '');
  gfxSyncVarHint();
  // 新变量还没有值，先把光标放到名字上，用户顺着填就行
  if (item && item.nameEl) setTimeout(() => item.nameEl.focus(), 60);
});

function gfxScrollIntoView(item) {
  if (!item || !item.rowEl) return;
  const r = item.rowEl.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 20) {
    item.rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

$('#gfxZoomIn').addEventListener('click', () => {
  gfxZoomAt(gfxSize.w / 2, gfxSize.h / 2, 1 / 1.4);
});
$('#gfxZoomOut').addEventListener('click', () => {
  gfxZoomAt(gfxSize.w / 2, gfxSize.h / 2, 1.4);
});
$('#gfxReset').addEventListener('click', gfxResetView);

/* 容器尺寸变了就重新量。用 ResizeObserver 而不是 window.resize：
   侧栏收起、页面从 display:none 显示出来这些也能捕捉到。 */
if (window.ResizeObserver) {
  new ResizeObserver(() => gfxFit()).observe(gfxPlot);
} else {
  window.addEventListener('resize', gfxFit, { passive: true });
}

/* 进这个功能页时：换了人就清空重来；否则保持上次写的，只重量一次尺寸
   （页面隐藏时量出来是 0，必须等显示出来再量）。 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== document.getElementById('toolGraph')) return;
  const who = typeof currentAccount === 'string' ? currentAccount : null;
  if (gfxOwner !== who) {
    gfxOwner = who;
    gfxClearAll();
    gfxAdd('sin(x)');
    gfxAdd('cos(x)');
  }
  gfxPadHide();                 // 每次进来都从"没键盘"开始
  requestAnimationFrame(() => gfxFit());
});

/* ==========================================================
   十二、软键盘
   ----------------------------------------------------------
   函数式输入里符号太多（√ |x| π ^ ÷ |），手机上在系统键盘的符号页里
   翻来翻去很烦，所以自带一个。

   两个关键处理：

   1) 触摸设备上给表达式输入框加 inputmode="none"：点进去**不弹系统
      键盘**，只弹这个软键盘。光标、选区、物理键盘都照常能用 ——
      只是不叫出屏幕键盘而已。（变量名那一栏不加：它是字母，用系统
      键盘更合适。）

   2) 按键在 mousedown 上 preventDefault：不然点一下按钮，焦点就先被
      按钮抢走、输入框 blur，软键盘会闪一下又收起来。
      （只拦 mousedown，不拦 pointerdown —— 后者会连同 click 一起
      被某些浏览器吃掉。）

   另外按钮插的是**成对的**东西：按「(」得到 "()" 且光标停在括号里，
   按「sin」得到 "sin()" 光标也在括号里。少按一次、也不用回头补右括号。
   ========================================================== */
const gfxPad     = $('#gfxPad');
const gfxPadKeys = $('#gfxPadKeys');

/* 符号键盘：5 × 5 的固定格子，坐标按**第一象限**算 ——
   左下角是 (1,1)，第一位数是行（从下往上数），第二位数是列（从左往右数）：

     (5,1)sin (5,2)cos (5,3)tan (5,4)√   (5,5)|x|
     (4,1)7   (4,2)8   (4,3)9   (4,4)(   (4,5))
     (3,1)4   (3,2)5   (3,3)6   (3,4)+   (3,5)−
     (2,1)1   (2,2)2   (2,3)3   (2,4)×   (2,5)÷
     (1,1)ABC (1,2)0   (1,3).   (1,4)^   (1,5)⌫

   下面的数组按 DOM 顺序写（网格是从上往下铺的），所以第 5 行写在最前面。
   「清空」不占格子 —— 和罗马数字键盘一样放在抬头左上角；
   π 放在抬头「完成」的左边（log 也跟着放在那儿）。
   ★ ABC 是**切换键**：表达式里要写自定义变量名（a、b、k…）时切到字母键盘，
     切回来点「返回」。字母键盘见下面的 GFX_ABC_ROWS。
   i 是要插入的文字，back 是插完光标往回退几格（成对符号用），
   act 是特殊动作（退格 / 清空 / 切字母），fn 只是换个颜色好认。 */
const GFX_PAD_KEYS = [
  // (5,1)～(5,5)
  { l: 'sin', i: 'sin()', back: 1, fn: 1 },
  { l: 'cos', i: 'cos()', back: 1, fn: 1 },
  { l: 'tan', i: 'tan()', back: 1, fn: 1 },
  { l: '\u221A', i: '\u221A()', back: 1, fn: 1 },          // √()
  { l: '|x|', i: '||', back: 1, fn: 1 },

  // (4,1)～(4,5)
  { l: '7', i: '7' }, { l: '8', i: '8' }, { l: '9', i: '9' },
  { l: '(', i: '()', back: 1 },
  { l: ')', i: ')' },

  // (3,1)～(3,5)
  { l: '4', i: '4' }, { l: '5', i: '5' }, { l: '6', i: '6' },
  { l: '+', i: '+' },
  { l: '\u2212', i: '-' },                                 // −

  // (2,1)～(2,5)
  { l: '1', i: '1' }, { l: '2', i: '2' }, { l: '3', i: '3' },
  { l: '\u00D7', i: '*' },                                 // ×
  { l: '/', i: '/' },                                      // 除号直接写 /（函数里没人用 ÷）

  // (1,1)～(1,5)
  { l: 'ABC', act: 'abc', fn: 1, small: 1, title: '切换到字母键盘' },
  { l: '0', i: '0' },
  { l: '.', i: '.' },
  { l: '^', i: '^' },
  { l: '\u232B', act: 'back', fn: 1, title: '退格' },      // ⌫
];

/* 字母键盘（QWERTY）。'@' 开头的是动作键，不是往里插字：
     '@upper'  大写（锁定式：按一下一直大写到再按一次）
     '@back'   退格
     '@toSym'  返回符号键盘（独占最后一行，拉满宽度）
   前两行是 10 / 9 个字母键，第三行两端是动作键、中间 7 个字母，
   最后一行只剩「返回」一个键，拉满整行。
   键宽按"10 列"算、每行居中，于是 9 个键那两行自然内缩 —— 和手机上的
   键盘一个样子，而且**所有键宽完全一致**（不是让 9 个键各自撑宽）。 */
const GFX_ABC_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['@upper', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '@back'],
  ['@toSym'],
];

let gfxPadTarget = null;     // 正在编辑的那个表达式输入框
let gfxPadScroller = null;   // 它被顶起时用到的滚动容器（关键盘时清掉它的底边距）
let gfxPadCaret = 0;         // 它里面的光标位置
let gfxPadView  = 'sym';     // 'sym' 符号键盘 / 'abc' 字母键盘
let gfxPadUpper = false;     // 字母键盘是否大写
const gfxPadCaretKey = new WeakMap();   // 每个输入框各自记一份光标

function gfxPadShow(input) {
  if (!gfxPad || !input) return;
  gfxPadTarget = input;

  // 每次重新开始输入都回到符号键盘（表达式里符号用得多），大写也一并复位 ——
  // 免得上次留在字母键盘/大写，下次一弹出来就懵
  if (gfxPadView !== 'sym' || gfxPadUpper) {
    gfxPadView = 'sym';
    gfxPadUpper = false;
  }

  gfxRenderPad();
  gfxPad.hidden = false;

  // 键盘是钉在屏幕底部的浮层：若它盖住了正在编辑的输入框，
  // 把那个框滚到键盘上沿之上（见 gfxPadEnsureVisible）
  gfxPadEnsureVisible(input, gfxPad);
}

/** 找离 input 最近、且确实在滚动的祖先。键盘固定在视口底部是浮层，
 *  盖住输入框时要滚的是这个祖先，而不是键盘自己。 */
function gfxFindScroller(el) {
  let n = el.parentElement;
  while (n && n !== document.body) {
    const s = getComputedStyle(n).overflowY;
    // 只认 overflow-y 为 auto/scroll 的祖先（即真正的滚动容器）。
    // 故意**不**要求它"当前已溢出"：因为任何定高的滚动容器，一旦被我们补了
    // 一段键盘高度的底边距（见 gfxPadEnsureVisible），就会变成可滚 ——
    // 矮窗口下"内容刚好没溢出"的那类（单位换算、移动端函数图像）正是靠这招把
    // 最底下那个被键盘压住的输入框顶上来的。
    if (s === 'auto' || s === 'scroll') return n;
    n = n.parentElement;
  }
  return null;
}

/** 收键盘时把之前给滚动容器加的底边距清掉（所有用到 gfxPadEnsureVisible
 *  的页面都要调，否则底部会留一段空白）。graph / roman / units 各自的 hide
 *  都接这一下。 */
function gfxClearPadScroller() {
  if (gfxPadScroller) { gfxPadScroller.style.paddingBottom = ''; gfxPadScroller = null; }
  if (document.body.style.paddingBottom) document.body.style.paddingBottom = '';
}

/** 键盘固定在屏幕底部；若它挡住了正在编辑的输入框，
 *  就把那个框顶到键盘上沿之上（必要时滚最近的滚动容器）。
 *  关键：给滚动容器补一段"键盘高度"的底边距 —— 否则当输入框是最后一项、
 *  容器已经滚到底时，它会被键盘永远压住、再也顶不上来。 */
function gfxPadEnsureVisible(input, pad) {
  // pad：当前实际显示的那个软键盘（函数图像用 #gfxPad，单位换算用 #cvtPad，
  // 罗马数字用 #rmPad）—— 别写死 gfxPad，否则在另两页 gfxPad 是隐藏的、
  // 一进来就被挡在 return 外面，顶起逻辑根本不会跑。
  if (!pad || pad.hidden || !input) return;
  const kb = pad.getBoundingClientRect();
  const sc = gfxFindScroller(input);
  const padH = (kb.height + 16) + 'px';

  // 换滚动容器了：先把旧的底边距清掉，免得残留
  if (gfxPadScroller && gfxPadScroller !== sc) gfxPadScroller.style.paddingBottom = '';
  if (sc) { sc.style.paddingBottom = padH; gfxPadScroller = sc; }
  else { document.body.style.paddingBottom = padH; gfxPadScroller = null; }

  requestAnimationFrame(() => {
    if (pad.hidden) return;
    const kb2 = pad.getBoundingClientRect();
    const r   = input.getBoundingClientRect();
    const m   = 8;
    let delta = 0;
    if (r.bottom > kb2.top - m) delta = r.bottom - (kb2.top - m);  // 下半截被盖
    else if (r.top < m)         delta = r.top - m;                // 上半截跑出屏幕
    if (!delta) return;
    const sc2 = gfxFindScroller(input) || gfxPadScroller;
    if (sc2) sc2.scrollTop += delta;
    else window.scrollBy(0, delta);
  });
}

function gfxPadHide() {
  if (!gfxPad) return;
  // 收回键盘时一并清掉之前给滚动容器加的底边距
  gfxClearPadScroller();
  gfxPad.hidden = true;
  gfxPadTarget = null;
}

/** 把某个表达式输入框接到软键盘上 */
function gfxPadBind(input) {
  const isPC = (typeof Device !== 'undefined') && Device.isPC();

  // 触摸设备：不叫出系统键盘（我们的软键盘就是输入法）；
  // 电脑端保留实体键盘，但点输入框也会弹出这个精简软键盘，
  // 方便直接点 sin / √ / |x| / π 这些符号，不必切输入法。
  if (!isPC) input.setAttribute('inputmode', 'none');

  input.addEventListener('focus', () => {
    gfxPadCaret = typeof input.selectionStart === 'number'
      ? input.selectionStart : input.value.length;
    gfxPadShow(input);
  });

  // 兜底：个别浏览器/输入法下点一下未必派发 focus，点完再确认一次。
  // 这时光标已经落好了，所以顺带同步一下光标位置。
  input.addEventListener('click', () => {
    if (gfxPad && gfxPad.hidden) gfxPadShow(input);
    if (typeof input.selectionStart === 'number') gfxPadCaret = input.selectionStart;
  });

  // 失焦时**不要立刻收**：点软键盘上的按钮也会让输入框先 blur 一下。
  // 等一个 tick，看焦点是不是落在软键盘里 —— 是就留着。
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (gfxPad && gfxPad.contains(document.activeElement)) return;
      if (gfxPadTarget === input) gfxPadHide();
    }, 0);
  });

  ['click', 'keyup', 'input', 'select'].forEach(ev => {
    input.addEventListener(ev, () => {
      if (typeof input.selectionStart === 'number') {
        gfxPadCaret = input.selectionStart;
        gfxPadCaretKey.set(input, gfxPadCaret);
      }
    });
  });
}

/** 往当前输入框里插入文字。back：插完光标往回退几格。
 *  直接派发 input 事件，解析 / 重画全交给已有的那条防抖链路，不重复一套。 */
function gfxPadInsert(text, back) {
  const el = gfxPadTarget;
  if (!el) return;
  const v = el.value;
  const pos = Math.min(Math.max(gfxPadCaret, 0), v.length);
  el.value = v.slice(0, pos) + text + v.slice(pos);

  const np = Math.max(0, pos + text.length - (back || 0));
  gfxPadCaret = np;
  gfxPadCaretKey.set(el, np);

  // 焦点可能在 mousedown 那一瞬丢过，补回来；preventScroll 免得页面跳
  try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
  try { el.setSelectionRange(np, np); } catch (_) {}

  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function gfxPadBackspace() {
  const el = gfxPadTarget;
  if (!el) return;
  const v = el.value;
  const pos = Math.min(Math.max(gfxPadCaret, 0), v.length);
  if (pos <= 0) return;
  el.value = v.slice(0, pos - 1) + v.slice(pos);
  gfxPadCaret = pos - 1;
  gfxPadCaretKey.set(el, gfxPadCaret);
  try { el.focus({ preventScroll: true }); } catch (_) {}
  try { el.setSelectionRange(gfxPadCaret, gfxPadCaret); } catch (_) {}
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function gfxPadClear() {
  const el = gfxPadTarget;
  if (!el) return;
  el.value = '';
  gfxPadCaret = 0;
  gfxPadCaretKey.set(el, 0);
  try { el.focus({ preventScroll: true }); } catch (_) {}
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 造一个键。
 *  opts: { fn 换个颜色, on 处于激活态, wide 加宽, full 独占整行, small 字号小一号, title, pressed, action } */
function gfxPadKey(label, opts) {
  const o = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gfx-key'
    + (o.fn ? ' is-fn' : '')
    + (o.on ? ' is-on' : '')
    + (o.wide ? ' is-wide' : '')
    + (o.full ? ' is-full' : '')
    + (o.small ? ' is-small' : '');
  b.textContent = label;
  if (o.title) b.title = o.title;
  b.setAttribute('aria-label', o.title || label);
  if (o.pressed) b.setAttribute('aria-pressed', 'true');

  // 见文件头第 2 条：拦掉 mousedown 的默认行为，别把输入框的焦点抢走
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', o.action);
  return b;
}

/** 符号键盘：5 × 5 网格。键位见 GFX_PAD_KEYS。 */
function gfxRenderPad() {
  if (gfxPadView === 'abc') { gfxRenderAbcPad(); return; }

  gfxPadKeys.className = 'gfx-pad-keys is-grid';
  gfxPadKeys.textContent = '';

  GFX_PAD_KEYS.forEach(def => {
    gfxPadKeys.appendChild(gfxPadKey(def.l, {
      fn: def.fn,
      wide: def.wide,
      small: def.small,
      title: def.title,
      action: () => {
        if (def.act === 'back') gfxPadBackspace();
        else if (def.act === 'clear') gfxPadClear();
        else if (def.act === 'abc') gfxShowAbcPad();
        else gfxPadInsert(def.i, def.back);
      },
    }));
  });
}

/** 字母键盘：每行一个 flex 行（键宽一致、行内容居中，见 GFX_ABC_ROWS 的说明） */
function gfxRenderAbcPad() {
  gfxPadKeys.className = 'gfx-pad-keys is-rows';
  gfxPadKeys.textContent = '';

  GFX_ABC_ROWS.forEach(letters => {
    const line = document.createElement('div');
    line.className = 'gfx-pad-row';

    letters.forEach(ch => {
      if (ch === '@upper') {
        line.appendChild(gfxPadKey('大写', {
          fn: 1, on: gfxPadUpper, pressed: gfxPadUpper, title: '大写',
          action: () => { gfxPadUpper = !gfxPadUpper; gfxRenderPad(); },
        }));
      } else if (ch === '@back') {
        line.appendChild(gfxPadKey('\u232B', {
          fn: 1, title: '退格', action: () => gfxPadBackspace(),
        }));
      } else if (ch === '@toSym') {
        line.appendChild(gfxPadKey('返回', {
          fn: 1, full: 1, title: '返回符号键盘',
          action: () => gfxShowSymPad(),
        }));
      } else {
        const out = gfxPadUpper ? ch.toUpperCase() : ch;
        // x / y 是函数里最常用的自变量：直接套函数键那身蓝（和退格同款 is-fn）
        const isVar = (ch === 'x' || ch === 'y');
        line.appendChild(gfxPadKey(out, {
          fn: isVar,
          title: isVar ? out + '（自变量）' : '',
          action: () => gfxPadInsert(out),
        }));
      }
    });

    gfxPadKeys.appendChild(line);
  });
}

function gfxShowAbcPad() { gfxPadView = 'abc'; gfxRenderPad(); }
function gfxShowSymPad() { gfxPadView = 'sym'; gfxRenderPad(); }

if (gfxPad) {
  /** 抬头上的按钮（清空 / log / π / 完成）：按下时不抢输入框焦点，
   *  否则光标一丢，插入位置就回到末尾了。 */
  function gfxPadHeadBtn(id, fn) {
    const b = $(id);
    if (!b) return;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', fn);
  }

  gfxPadHeadBtn('#gfxPadClear', () => { if (gfxPadTarget) gfxPadClear(); });
  gfxPadHeadBtn('#gfxPadLog',  () => { if (gfxPadTarget) gfxPadInsert('log()', 1); });
  gfxPadHeadBtn('#gfxPadPi',   () => { if (gfxPadTarget) gfxPadInsert('\u03C0'); });

  $('#gfxPadDone').addEventListener('click', () => {
    const el = gfxPadTarget;
    gfxPadHide();
    if (el) el.blur();
  });
}

/* ==========================================================
   十三、初始化
   ========================================================== */
gfxCtx = gfxCanvas ? gfxCanvas.getContext('2d') : null;
gfxRenderPad();
gfxSyncVarHint();
// 窗口尺寸变化（含换设备档 / 横竖屏）时，键盘若正开着，重新把输入框顶到上沿
window.addEventListener('resize', () => { if (gfxPadTarget) gfxPadEnsureVisible(gfxPadTarget, gfxPad); });
gfxAdd('sin(x)');
gfxAdd('cos(x)');
gfxFit();
