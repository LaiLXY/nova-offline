/* ==========================================================================
   magic.js —— 功能页：九宫幻方

   玩法：n 阶幻方 = n×n 个格子里填 1…n²（每个数恰好用一次），使得
   每一行、每一列、两条主对角线之和都相等 —— 这个和叫幻方常数

       M = n(n² + 1) / 2

   （3 阶 15、4 阶 34、5 阶 65、6 阶 111、7 阶 175、8 阶 260、9 阶 369）

   ★ 阶数只开放 3–9，因为幻方的三种"家族"正好在这个区间里各出现一次：
       奇数阶  3 / 5 / 7 / 9   连续摆数法（Siamese，de la Loubère）
       双偶数阶 4 / 8          互补对换法
       单偶数阶 6              LUX 法
     三种造法见下面「二、三种造法」。再往下（10 阶以上）就只是把同一套
     法子往大里套，玩法没有新东西，格子却已经小到快点不动了。

   ★ 出题和判题全在浏览器里做，一次请求都不发 —— 和二十四点、罗马数字
     一样是个纯前端页。

   ★ 判题**不比对参考答案**，只验规则：填满了、1…n² 各出现一次、
     每条线和都等于 M —— 就是过关。
     幻方不是数独：同一个盘面常常有好几组合法解（旋转 / 镜像之后照样
     成立，甚至换一种构造也还是幻方）。拿固定答案去比对会误杀，
     所以这里按"这盘是不是幻方"来判 —— 玩家找到别的解也算他对。

   ★ 难点全在"挖空"这一下：挖掉的格子必须还让题**有得做**。
     这里的做法是每行、每列**至少留一个已知数**（见 mgCarve），
     剩下的交给盘面上那圈"和"提示 —— 玩家边填边能看见每行每列离 M
     还差多少，一路推下去就行，不用硬算。

   依赖 core.js（$ / $$ / toast / Device）与 tools.js（tool:open 事件）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const mgPage     = $('#toolMagic');
const mgBoard    = $('#mgBoard');
const mgOrderBox = $('#mgOrders');
const mgDiffBox  = $('#mgDiffs');
const mgSetToggle = $('#mgSetToggle');
const mgSetBody   = $('#mgSetBody');
const mgSetSum    = $('#mgSetSum');
const mgRoundEl  = $('#mgRound');
const mgScoreEl  = $('#mgScore');
const mgTipEl    = $('#mgTip');
const mgCheckBtn = $('#mgCheck');
const mgHintBtn  = $('#mgHint');
const mgNewBtn   = $('#mgNew');
const mgResetBtn = $('#mgReset');
const mgAnsBtn   = $('#mgAnswer');
const mgPad      = $('#mgPad');
const mgPadKeys  = $('#mgPadKeys');
const mgPadTitle = $('#mgPadTitle');
const mgPadDone  = $('#mgPadDone');

/* ---------- 常量 / 状态 ---------- */
const MG_ORDERS = [3, 4, 5, 6, 7, 8, 9];

/* 难度只调"挖掉多少比例"，不换玩法：
   挖得越多、剩下的已知数越少，能直接读出来的线就越少。 */
const MG_DIFFS = [
  { name: '易', ratio: 0.30 },
  { name: '中', ratio: 0.42 },
  { name: '难', ratio: 0.55 },
];

let mgN        = 3;      // 当前阶数
let mgDiff     = 0;      // 当前难度下标
let mgRound    = 0;      // 本阶换到第几题（只用于显示）
let mgSolution = null;   // n×n，一组标准答案
let mgClue     = null;   // n×n，true = 已知数（不给改）
let mgInputs   = [];     // 下标 → input 元素（已知数那格是 null）
let mgFocusIdx = -1;     // 当前选中的格子下标（软键盘往这里填）
let mgSeconds  = 0;      // 计时（只在页面可见时走）
let mgTimer    = null;
let mgSolved   = false;  // 已经过关
let mgGaveUp   = false;  // 看过答案（看过就不再判过关）
let mgHints    = 0;      // 用过几次提示
let mgOwner    = null;   // 上次进来时登录的是谁

/* 设置区收没收起，记在 localStorage —— 写法和 core.js 存「记住我」令牌
   那两处一样，都裹 try/catch：无痕模式下 localStorage 可能直接抛错，
   不能让它把整页带崩。 */
const MG_SET_KEY = 'nova_magic_set_collapsed';

/* ==========================================================
   一、小工具
   ========================================================== */

/** 幻方常数 M = n(n²+1)/2 */
function mgConstant(n) {
  return (n * (n * n + 1)) / 2;
}

/** 可复现的伪随机数发生器（mulberry32）。
 *
 *  用它而不是 Math.random()：同一题面每次刷出来都一样，
 *  「换一题」也真的会换（种子里带了轮次），好复现也好排查。 */
function mgRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 原地洗牌（Fisher–Yates） */
function mgShuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ==========================================================
   二、三种造法
   ========================================================== */

/** 奇数阶：连续摆数法（Siamese / de la Loubère）
 *
 *  1 放第一行正中间；之后每次都往**右上方**走一格，走到边界就绕回来
 *  （第一行往上→最后一行，最后一列往右→第一列）。
 *  要是那个格子已经有数了，就改放在当前位置的**正下方**。
 *  奇数阶用这一个法子全部搞定，3 阶出来就是洛书。 */
function mgGenOdd(n) {
  const g = Array.from({ length: n }, () => Array(n).fill(0));
  let r = 0, c = (n - 1) >> 1;

  for (let v = 1; v <= n * n; v++) {
    g[r][c] = v;
    let nr = (r - 1 + n) % n, nc = (c + 1) % n;
    if (g[nr][nc]) { nr = (r + 1) % n; nc = c; }   // 右上被占 → 落到下方
    r = nr; c = nc;
  }
  return g;
}

/** 双偶数阶（4 的倍数）：互补对换法
 *
 *  先按自然顺序把 1…n² 一行行填满，再把满足下面条件的位置取"补数"
 *  （值 v 换成 n²+1−v —— 这两个数加起来正好是 n²+1，所以叫互补）：
 *      行号、列号对 4 取余相等      或      两者余数之和为 3
 *  4 阶出来的就是丢勒那幅《忧郁 I》里的幻方。 */
function mgGenDoubleEven(n) {
  const g = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i * n + j + 1);
    g.push(row);
  }

  const N = n * n + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i % 4, b = j % 4;
      if (a === b || a + b === 3) g[i][j] = N - g[i][j];
    }
  }
  return g;
}

/* 2×2 小块的四种编号摆法（表格里的数字是"这一格放第几个数"，
   1 = 块内最小的那个）。L / U / X 的名字来自 4、3、2 三个数连起来
   像哪个字母 —— 这是 LUX 法名字的由来。 */
const MG_LUX = {
  L: [4, 1, 2, 3],   // 左上 右上 左下 右下
  U: [1, 4, 2, 3],
  X: [1, 4, 3, 2],
};

/** 单偶数阶（模 4 余 2，这里就是 6 阶）：LUX 法（Strachey）
 *
 *  三步：
 *   1) 先造一个 m = n/2 阶的奇数阶幻方（m 一定是奇数，走连续摆数法），
 *      里面的数 1…m² 只当作**小块的编号**，不是最终的数字。
 *   2) 把 m×m 个编号摊成 m×m 个 2×2 小块：上面 k+1 行全是 L 块、
 *      中间一行是 U 块、下面 k-1 行是 X 块，
 *      然后把正中间那个 U 和它**正上方**的 L 对调一下。
 *   3) 编号为 v 的小块里放 4 个连续的数：4(v−1)+1 … 4v，
 *      按那一块的 L / U / X 摆法落到 2×2 的四个位置上。
 *  6 阶是唯一需要绕一下的阶数，也是三种里最容易写错的一个。 */
function mgGenSingleEven(n) {
  const m = n / 2;
  const k = (m - 1) / 2;            // m = 2k+1
  const base = mgGenOdd(m);

  // 第 2 步：先铺标签，再做中间那一处对调
  const label = [];
  for (let i = 0; i < m; i++) {
    const row = [];
    for (let j = 0; j < m; j++) {
      row.push(i <= k ? 'L' : (i === k + 1 ? 'U' : 'X'));
    }
    label.push(row);
  }
  const tmp = label[k + 1][k];
  label[k + 1][k] = label[k][k];
  label[k][k] = tmp;

  // 第 3 步：把编号展开成真正的数字
  const g = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const v = base[i][j];
      const a = (v - 1) * 4 + 1;                  // 这一块的 4 个连续数
      const pat = MG_LUX[label[i][j]];
      const cell = [[2 * i, 2 * j], [2 * i, 2 * j + 1],
                    [2 * i + 1, 2 * j], [2 * i + 1, 2 * j + 1]];
      for (let t = 0; t < 4; t++) {
        g[cell[t][0]][cell[t][1]] = a + pat[t] - 1;
      }
    }
  }
  return g;
}

/** 按阶数挑造法 */
function mgGenerate(n) {
  if (n % 2 === 1) return mgGenOdd(n);         // 3 / 5 / 7 / 9
  if (n % 4 === 0) return mgGenDoubleEven(n);  // 4 / 8
  return mgGenSingleEven(n);                   // 6
}

/* ==========================================================
   三、校验 + 变换
   ========================================================== */

/** 是不是一个合格的 n 阶幻方：1…n² 各一次，横竖两条对角线同和 */
function mgIsMagic(g) {
  const n = g.length;
  const M = mgConstant(n);
  const seen = new Set();

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = g[i][j];
      if (!Number.isInteger(v) || v < 1 || v > n * n || seen.has(v)) return false;
      seen.add(v);
    }
  }
  if (seen.size !== n * n) return false;

  for (let i = 0; i < n; i++) {
    let rs = 0, cs = 0;
    for (let j = 0; j < n; j++) { rs += g[i][j]; cs += g[j][i]; }
    if (rs !== M || cs !== M) return false;
  }

  let d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) { d1 += g[i][i]; d2 += g[i][n - 1 - i]; }
  return d1 === M && d2 === M;
}

function mgRot90(g) {
  const n = g.length;
  const o = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) o[j][n - 1 - i] = g[i][j];
  }
  return o;
}

/** 正方形的 8 种对称（4 个旋转 × 是否左右翻）。
 *
 *  这些操作把行变列、把对角线换成另一条对角线，但"每条线的和"一个都
 *  没变 —— 所以变换完必然还是幻方。3 阶只有这一个基本解，
 *  靠这 8 种摆法就能出 8 个看着不一样的题面。 */
function mgTransform(g, t) {
  let o = g.map(row => row.slice());
  if (t & 4) o = o.map(row => row.slice().reverse());
  for (let i = 0; i < (t & 3); i++) o = mgRot90(o);
  return o;
}

/* ==========================================================
   四、出题：先造解，再挖空
   ========================================================== */

/** 挖空。
 *
 *  两条规矩：
 *    · 每行、每列**至少留一个**已知数 —— 一行全空的话，玩家连这行的
 *      和该往哪凑都没了参照，那就不是做题是猜谜了。
 *    · 先按随机顺序挑，挑够比例就停。
 *  第一轮受"至少留一个"约束，可能凑不满（极小概率）；真凑不满就松开
 *  这条约束再来一轮补足，保证题面难度和标称一致。 */
function mgCarve(g, ratio, rnd) {
  const n = g.length;
  const cells = n * n;
  const want = Math.min(Math.round(cells * ratio), cells - 1);

  const clue = Array.from({ length: n }, () => Array(n).fill(true));
  const rowLeft = Array(n).fill(n);
  const colLeft = Array(n).fill(n);
  const order = mgShuffle([...Array(cells).keys()], rnd);
  let removed = 0;

  // minLeft 依次取 1、0：先保证每行每列都留一个，实在凑不满再放宽
  for (const minLeft of [1, 0]) {
    for (const p of order) {
      if (removed >= want) break;
      const r = (p / n) | 0, c = p % n;
      if (!clue[r][c]) continue;
      if (rowLeft[r] <= minLeft || colLeft[c] <= minLeft) continue;
      clue[r][c] = false;
      rowLeft[r]--; colLeft[c]--;
      removed++;
    }
    if (removed >= want) break;
  }
  return clue;
}

/** 出新的一题：造解 → 随机摆正 → 挖空 */
function mgMakePuzzle() {
  const n = mgN;
  const rnd = mgRand((Date.now() ^ (n * 7919) ^ (mgRound * 104729) ^ (mgDiff * 6151)) >>> 0);

  let g = mgGenerate(n);
  g = mgTransform(g, Math.floor(rnd() * 8));
  // 兜底：万一变换后不合法（不该发生），退回原样，宁可题面普通也别出错题
  if (!mgIsMagic(g)) g = mgGenerate(n);

  mgSolution = g;
  mgClue = mgCarve(g, MG_DIFFS[mgDiff].ratio, rnd);
}

/* ==========================================================
   五、铺界面
   ========================================================== */

function mgBuildChips() {
  // 阶数
  mgOrderBox.textContent = '';
  MG_ORDERS.forEach(n => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.order = String(n);
    b.textContent = n + ' 阶';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => mgSetOrder(n));
    mgOrderBox.appendChild(b);
  });

  // 难度
  mgDiffBox.textContent = '';
  MG_DIFFS.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.diff = String(i);
    b.textContent = d.name;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => mgSetDiff(i));
    mgDiffBox.appendChild(b);
  });
}

function mgPaintChips() {
  $$('.chip', mgOrderBox).forEach(b => {
    b.setAttribute('aria-checked', String(+b.dataset.order === mgN));
  });
  $$('.chip', mgDiffBox).forEach(b => {
    b.setAttribute('aria-checked', String(+b.dataset.diff === mgDiff));
  });
  mgPaintSetSum();
}

/** 设置卡头上那行摘要：收起之后全靠它说明现在选的是什么 */
function mgPaintSetSum() {
  if (mgSetSum) mgSetSum.textContent = mgN + ' 阶 · ' + MG_DIFFS[mgDiff].name;
}

/** 收起 / 展开设置区。收起是为了防误触 —— 玩的时候手指在棋盘上忙，
 *  这块紧挨着棋盘，很容易顺手划到。
 *  persist = false 时只改界面不落盘：启动时「恢复上次状态」不该顺手
 *  写一条 localStorage，否则「清空缓存」刚删干净，一刷新又冒出来一条。 */
function mgFoldSet(on, persist) {
  if (mgSetBody) mgSetBody.hidden = on;
  if (mgSetToggle) {
    mgSetToggle.textContent = on ? '展开' : '收起';
    mgSetToggle.setAttribute('aria-expanded', on ? 'false' : 'true');
  }
  if (persist === false) return;
  try { localStorage.setItem(MG_SET_KEY, on ? '1' : '0'); } catch (_) {}
}

function mgReadFolded() {
  try { return localStorage.getItem(MG_SET_KEY) === '1'; } catch (_) { return false; }
}

/** 把整个盘面重铺一遍（只在换题 / 换阶时调用） */
function mgRender() {
  const n = mgN;

  mgBoard.style.setProperty('--n', String(n));
  mgBoard.classList.remove('is-done');
  mgBoard.textContent = '';

  mgInputs = new Array(n * n).fill(null);
  mgFocusIdx = -1;

  const frag = document.createDocumentFragment();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const cell = document.createElement('div');
      cell.className = 'mg-cell';
      cell.dataset.idx = String(idx);
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      // 两条主对角线先标记在格子上，聚焦高亮时按这个走
      if (r === c) cell.dataset.d1 = '1';
      if (r + c === n - 1) cell.dataset.d2 = '1';

      if (mgClue[r][c]) {
        cell.classList.add('is-clue');
        const v = document.createElement('span');
        v.className = 'mg-val';
        v.textContent = String(mgSolution[r][c]);
        cell.appendChild(v);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.autocomplete = 'off';
        inp.autocapitalize = 'off';
        inp.spellcheck = false;
        inp.maxLength = 2;
        inp.className = 'mg-in';
        inp.setAttribute('aria-label', '第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列');
        cell.appendChild(inp);
        mgInputs[idx] = inp;
      }
      frag.appendChild(cell);
    }

    // 这一行右侧的"当前和"
    const rs = document.createElement('div');
    rs.className = 'mg-sum mg-sum-row';
    rs.dataset.row = String(r);
    frag.appendChild(rs);
  }

  // 最后一行：每一列下方的"当前和"
  for (let c = 0; c < n; c++) {
    const cs = document.createElement('div');
    cs.className = 'mg-sum mg-sum-col';
    cs.dataset.col = String(c);
    frag.appendChild(cs);
  }

  // 两条对角线的和：横跨盘面的一整行，贴在盘面下方的两个角上 ——
  //   ↙（右上→左下）放**左下角**，↘（左上→右下）放**右下角**，
  // 各落在自己那条对角线走到底的那一头，和行/列的和一样"贴着终点报数"。
  const diags = document.createElement('div');
  diags.className = 'mg-diags';
  diags.innerHTML =
    '<span class="mg-diag mg-d2" title="右上到左下这条对角线的和">' +
      '<b>\u2199</b><i>·</i></span>' +
    '<span class="mg-diag mg-d1" title="左上到右下这条对角线的和">' +
      '<b>\u2198</b><i>·</i></span>';
  frag.appendChild(diags);

  mgBoard.appendChild(frag);
  mgBindBoard();
  mgSyncInputMode();

  const M = mgConstant(n);
  mgRoundEl.textContent = n + ' 阶 · 第 ' + mgRound + ' 题';
  mgScoreEl.textContent = '常数 ' + M + ' · 空 ' + mgBlanks() + ' 格';

  // 盘面刚铺好时页面可能还藏者（宽度量出来是 0），交给 rAF 再量一次
  mgFitSoon();
  mgPaint();
}

/** 空格数 */
function mgBlanks() {
  let k = 0;
  for (let r = 0; r < mgN; r++) {
    for (let c = 0; c < mgN; c++) if (!mgClue[r][c]) k++;
  }
  return k;
}

/** 量一个格子的实际宽度，写进 --mg-cw，字号跟着它缩放。
 *
 *  纯 CSS 做不到"字号跟着格宽走"：格宽由列数 (n) 和容器宽共同决定，
 *  n 又是运行时才知道的。量一次、写个变量，最省事也最准。 */
function mgFit() {
  const cell = mgBoard.querySelector('.mg-cell');
  if (!cell) return;
  const w = cell.getBoundingClientRect().width;
  if (w > 0) mgBoard.style.setProperty('--mg-cw', w + 'px');
}

let mgFitRaf = null;
function mgFitSoon() {
  if (mgFitRaf) return;
  mgFitRaf = requestAnimationFrame(() => { mgFitRaf = null; mgFit(); });
}

/** 输入方式：非 PC 设备上给输入框设 inputmode="none"。
 *
 *  本站的输入全都自带键盘，系统键盘一弹就顶掉半屏、还会盖住棋盘 ——
 *  所以触摸设备上索性不叫它出来（和罗马数字、函数图像那两页同一套做法，
 *  见 roman.js 的 rmPadBind / graph.js 的 gfxPadBind）。
 *  设成 none **不影响**光标、选区、物理键盘，只是不叫出屏幕键盘而已；
 *  PC 上给 numeric，让浏览器知道这是个数字栏（桌面本来也没屏幕键盘）。
 *
 *  单独抽出来是因为设备档位会随窗口大小变（core.js 的 Device 在 resize
 *  时重算），转个屏就可能从 PC 变触摸 —— 那时得跟着改回来。 */
function mgSyncInputMode() {
  const touch = typeof Device !== 'undefined' && !Device.isPC();
  mgInputs.forEach(inp => {
    if (!inp) return;
    inp.setAttribute('inputmode', touch ? 'none' : 'numeric');
  });
}

/* ==========================================================
   六、事件绑定（每次重铺后都要重挂）
   ========================================================== */

function mgBindBoard() {
  mgInputs.forEach((inp, idx) => {
    if (!inp) return;

    inp.addEventListener('focus', () => mgFocusOn(idx));
    inp.addEventListener('click', () => mgFocusOn(idx));

    inp.addEventListener('input', () => {
      // 只留数字，最多两位（最大是 9 阶的 81）
      const v = inp.value.replace(/\D/g, '').slice(0, 2);
      if (v !== inp.value) inp.value = v;
      mgFocusOn(idx);
      const st = mgPaint();
      if (st.filled === st.total && !mgSolved) mgCheck(false, st);
    });

    inp.addEventListener('keydown', e => {
      const k = e.key;

      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const to = mgNeighbor(idx, dr, dc);
        if (to >= 0) mgInputs[to].focus();
        return;
      }

      if (k === 'Enter') { e.preventDefault(); mgCheck(true); return; }

      // 空格子上按退格 → 退回上一个空格（一路退着改，不用摸鼠标）
      if (k === 'Backspace' && !inp.value) {
        const prev = mgPrevBlank(idx);
        if (prev >= 0) { e.preventDefault(); mgInputs[prev].focus(); }
      }
    });
  });
}

/** 沿 dr/dc 方向找下一个可填的格子（已知数那格跳过），没有就 -1 */
function mgNeighbor(idx, dr, dc) {
  const n = mgN;
  let r = (idx / n) | 0, c = idx % n;
  for (;;) {
    r += dr; c += dc;
    if (r < 0 || c < 0 || r >= n || c >= n) return -1;
    const k = r * n + c;
    if (mgInputs[k]) return k;
  }
}

function mgPrevBlank(idx) {
  for (let s = 1; s <= mgN * mgN; s++) {
    const k = (idx - s + mgN * mgN) % (mgN * mgN);
    if (mgInputs[k]) return k;
  }
  return -1;
}

function mgNextBlank(idx) {
  const cells = mgN * mgN;
  for (let s = 1; s <= cells; s++) {
    const k = (idx + s) % cells;
    const inp = mgInputs[k];
    if (inp && !inp.value) return k;
  }
  return -1;
}

/** 选中某格：旁边同行的、同列的、以及（若它在对角线上）同对角线的
 *  一起淡高亮 —— 幻方是"线上求和"的游戏，一眼看见整条线才好推。 */
function mgFocusOn(idx) {
  mgFocusIdx = idx;
  const n = mgN;
  const fr = (idx / n) | 0, fc = idx % n;
  const onD1 = fr === fc;
  const onD2 = fr + fc === n - 1;

  $$('.mg-cell', mgBoard).forEach(el => {
    const i = +el.dataset.idx;
    const r = +el.dataset.row, c = +el.dataset.col;

    const sel = i === idx;
    const cross = r === fr || c === fc;
    const diag = (onD1 && r === c) || (onD2 && r + c === n - 1);

    el.classList.toggle('is-sel', sel);
    el.classList.toggle('is-hl', cross && !sel);
    el.classList.toggle('is-diag', diag && !sel && !cross);
  });

  $$('.mg-sum-row', mgBoard).forEach(el => {
    el.classList.toggle('is-on', +el.dataset.row === fr);
  });
  $$('.mg-sum-col', mgBoard).forEach(el => {
    el.classList.toggle('is-on', +el.dataset.col === fc);
  });

  if (mgPadTitle) {
    mgPadTitle.textContent = '第 ' + (fr + 1) + ' 行第 ' + (fc + 1) + ' 列';
  }
}

/* ==========================================================
   七、读盘 + 上色（每敲一下都会跑）
   ========================================================== */

/** 把盘面读成 n×n 的二维数组，空格和非法值一律记 0 */
function mgValues() {
  const n = mgN;
  const g = Array.from({ length: n }, () => Array(n).fill(0));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mgClue[r][c]) { g[r][c] = mgSolution[r][c]; continue; }
      const inp = mgInputs[r * n + c];
      const v = inp ? parseInt(inp.value, 10) : NaN;
      g[r][c] = (Number.isInteger(v) && v >= 1 && v <= n * n) ? v : 0;
    }
  }
  return g;
}

/** 盘面上每条线的状态，画到右边和下边那圈"和"里。
 *
 *  返回 { g, filled, total, seen }，mgCheck 直接拿去用，
 *  免得把整盘再算一遍。 */
function mgPaint() {
  const n = mgN;
  const M = mgConstant(n);
  const g = mgValues();

  let filled = 0, total = 0;
  const seen = new Map();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = g[r][c];
      if (!mgClue[r][c]) { total++; if (v) filled++; }
      if (v) seen.set(v, (seen.get(v) || 0) + 1);
    }
  }

  // 每行
  for (let r = 0; r < n; r++) {
    let s = 0, full = true;
    for (let c = 0; c < n; c++) { const v = g[r][c]; s += v; if (!v) full = false; }
    const el = mgBoard.querySelector('.mg-sum-row[data-row="' + r + '"]');
    if (!el) continue;
    el.textContent = s ? String(s) : '·';
    el.classList.toggle('ok', full && s === M);
    el.classList.toggle('bad', full && s !== M);
  }

  // 每列
  for (let c = 0; c < n; c++) {
    let s = 0, full = true;
    for (let r = 0; r < n; r++) { const v = g[r][c]; s += v; if (!v) full = false; }
    const el = mgBoard.querySelector('.mg-sum-col[data-col="' + c + '"]');
    if (!el) continue;
    el.textContent = s ? String(s) : '·';
    el.classList.toggle('ok', full && s === M);
    el.classList.toggle('bad', full && s !== M);
  }

  // 两条对角线
  let d1 = 0, d2 = 0, f1 = true, f2 = true;
  for (let i = 0; i < n; i++) {
    if (g[i][i]) d1 += g[i][i]; else f1 = false;
    if (g[i][n - 1 - i]) d2 += g[i][n - 1 - i]; else f2 = false;
  }
  const c1 = mgBoard.querySelector('.mg-diags .mg-d1');
  const c2 = mgBoard.querySelector('.mg-diags .mg-d2');
  if (c1) {
    c1.querySelector('i').textContent = d1 ? String(d1) : '·';
    c1.classList.toggle('ok', f1 && d1 === M);
    c1.classList.toggle('bad', f1 && d1 !== M);
  }
  if (c2) {
    c2.querySelector('i').textContent = d2 ? String(d2) : '·';
    c2.classList.toggle('ok', f2 && d2 === M);
    c2.classList.toggle('bad', f2 && d2 !== M);
  }

  // 重复 / 越界的数字标红
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const inp = mgInputs[r * n + c];
      if (!inp) continue;
      const raw = inp.value.trim();
      const v = g[r][c];
      inp.classList.toggle('is-dup', !!v && (seen.get(v) || 0) > 1);
      // 填了东西却不是 1…n² 里的数（比如 3 阶里敲了 55）
      inp.classList.toggle('is-bad', raw !== '' && !v);
    }
  }

  mgPaintTip(filled, total);
  return { g, filled, total, seen };
}

/** 往提示行写一句话（校验没过时说明是哪儿没过） */
function mgSay(msg) {
  if (mgTipEl) mgTipEl.textContent = msg;
}

function mgPaintTip(filled, total) {
  if (mgSolved) return;                     // 过关/看答案后的提示由那两处自己写
  if (filled === undefined) {
    total = 0; filled = 0;
    for (let r = 0; r < mgN; r++) {
      for (let c = 0; c < mgN; c++) {
        if (mgClue[r][c]) continue;
        total++;
        const inp = mgInputs[r * mgN + c];
        if (inp && inp.value.trim()) filled++;
      }
    }
  }
  const left = total - filled;
  const t = mgSeconds + ' 秒';
  // 填满那句不写死"对/不对"：这句只是"格子数"的旁白，真正的判定结果
  // 由 mgCheck 用 mgSay 盖上去（对 → 过关，错 → 指名哪条线不对）。
  mgSay(left > 0
    ? '还剩 ' + left + ' 格 · 已用 ' + t
    : '填满了，核对一下每条线');
}

/* ==========================================================
   八、判题 / 提示 / 答案
   ========================================================== */

/** 找出和不等于 M 的线，返回中文名（用于提示是哪条线错了） */
function mgBadLines(g, n, M) {
  const bad = [];

  for (let r = 0; r < n; r++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += g[r][c];
    if (s !== M) bad.push('第 ' + (r + 1) + ' 行');
  }
  for (let c = 0; c < n; c++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += g[r][c];
    if (s !== M) bad.push('第 ' + (c + 1) + ' 列');
  }
  let d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) { d1 += g[i][i]; d2 += g[i][n - 1 - i]; }
  if (d1 !== M) bad.push('主对角线');
  if (d2 !== M) bad.push('副对角线');

  return bad;
}

/** 校验。manual = 玩家点的「校验」（要出声），false = 填满后自动跑一次。
 *
 *  判的是"是不是幻方"，不跟 mgSolution 比 —— 见文件头那段说明。 */
function mgCheck(manual, st) {
  if (mgSolved) return false;

  const n = mgN;
  const M = mgConstant(n);
  const s = st || mgPaint();

  if (s.filled < s.total) {
    if (manual) {
      mgSay('还剩 ' + (s.total - s.filled) + ' 个空格没填');
      toast('err', '还没填完', '还剩 ' + (s.total - s.filled) + ' 个空格');
    }
    return false;
  }

  // 1…n² 必须各出现一次
  let dup = false;
  s.seen.forEach(k => { if (k > 1) dup = true; });
  if (dup || s.seen.size !== n * n) {
    if (manual) {
      mgSay('数字重复了，红字那几个各只能用一次');
      toast('err', '数字重复了', '1 到 ' + (n * n) + ' 每个数只能用一次，红字那几个是重复的');
    }
    return false;
  }

  const bad = mgBadLines(s.g, n, M);
  if (bad.length) {
    if (manual) {
      mgSay(bad.slice(0, 3).join('、') + ' 的和不是 ' + M);
      toast('err', '还差点', bad.slice(0, 3).join('、') +
        (bad.length > 3 ? ' 等 ' + bad.length + ' 条线' : '') + ' 的和不是 ' + M);
    }
    return false;
  }

  mgWin();
  return true;
}

/** 过关 / 看答案之后，「提示」「看答案」就没意义了，灰掉 */
function mgSetActions() {
  const off = mgSolved;
  if (mgHintBtn) mgHintBtn.disabled = off;
  if (mgAnsBtn) mgAnsBtn.disabled = off;
}

function mgWin() {
  if (mgSolved) return;
  mgSolved = true;
  mgStopTimer();
  mgSetActions();

  mgBoard.classList.add('is-done');
  mgTipEl.textContent = '过关！' + mgN + ' 阶幻方 · 用时 ' + mgSeconds + ' 秒'
    + (mgHints ? ' · 提示 ' + mgHints + ' 次' : '');

  toast('ok', '过关！',
    mgN + ' 阶幻方 · 常数 ' + mgConstant(mgN) + ' · 用时 ' + mgSeconds + ' 秒');
}

/** 提示：挑一个还空着的格子，直接填对。
 *  优先挑"整行只剩它一个空格"的位置 —— 那种格是玩家下一步本来就能
 *  自己推出来的，给了也不可惜。 */
function mgHint() {
  if (mgSolved) return;

  const n = mgN;
  let pick = -1;

  for (let r = 0; r < n && pick < 0; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      if (!mgInputs[idx] || mgInputs[idx].value) continue;
      // 这一行 / 这一列是不是只剩它一个空格
      let rowRest = 0, colRest = 0;
      for (let k = 0; k < n; k++) {
        if (mgInputs[r * n + k] && !mgInputs[r * n + k].value) rowRest++;
        if (mgInputs[k * n + c] && !mgInputs[k * n + c].value) colRest++;
      }
      if (rowRest === 1 || colRest === 1) { pick = idx; break; }
    }
  }

  if (pick < 0) {                      // 没有"只剩一个"的，随便挑一个空的
    for (let idx = 0; idx < n * n; idx++) {
      if (mgInputs[idx] && !mgInputs[idx].value) { pick = idx; break; }
    }
  }
  if (pick < 0) return;

  const r = (pick / n) | 0, c = pick % n;
  const inp = mgInputs[pick];
  inp.value = String(mgSolution[r][c]);
  inp.classList.add('is-hint');
  mgHints++;

  mgFocusOn(pick);
  const st = mgPaint();
  if (st.filled === st.total) mgCheck(false, st);
}

/** 看答案：把空格全部按参考答案填上。
 *  填完就不再判过关 —— 看过答案的盘不算自己解出来的。 */
function mgShowAnswer() {
  if (mgSolved && !mgGaveUp) return;
  mgGaveUp = true;
  mgSolved = true;
  mgStopTimer();
  mgSetActions();

  const n = mgN;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const inp = mgInputs[idx];
      if (!inp) continue;
      inp.value = String(mgSolution[r][c]);
      inp.classList.add('is-given');
    }
  }

  mgPaint();
  mgTipEl.textContent = '这是其中一组答案 —— 换个角度、转一转还是幻方，点「换一题」再来';
  toast('ok', '已显示答案', '幻方常有不止一组解，这只是其中一组');
}

/* ==========================================================
   九、换题 / 换阶 / 换难度 / 计时
   ========================================================== */

function mgStartTimer() {
  mgStopTimer();
  mgSeconds = 0;
  mgTimer = setInterval(() => {
    // 不在这一页、或者标签页在后台 → 不计时（省得回来一看"用时"虚高）
    if (document.hidden) return;
    if (mgPage && !mgPage.classList.contains('show')) return;
    mgSeconds++;
    if (!mgSolved) mgPaintTip();
  }, 1000);
}

function mgStopTimer() {
  if (mgTimer) { clearInterval(mgTimer); mgTimer = null; }
}

/** 重开一题（题目不变，只把空格清掉） */
function mgResetBoard() {
  if (!mgInputs) return;
  mgInputs.forEach(inp => {
    if (!inp) return;
    inp.value = '';
    inp.classList.remove('is-hint', 'is-given', 'is-dup', 'is-bad');
  });
  mgSolved = false;
  mgGaveUp = false;
  mgHints = 0;
  mgBoard.classList.remove('is-done');
  mgSetActions();
  mgStartTimer();
  mgPaint();
}

/** 换一题：阶数、难度不变，重新造一题 */
function mgNewPuzzle() {
  mgRound++;
  mgMakePuzzle();
  mgSolved = false;
  mgGaveUp = false;
  mgHints = 0;
  mgRender();
  mgStartTimer();
}

/** 换一题（含清空轮次显示）后的统一收敛 */
function mgNewGame() {
  mgMakePuzzle();
  mgRound = 1;
  mgSolved = false;
  mgGaveUp = false;
  mgHints = 0;
  mgRender();
  mgStartTimer();
}

function mgSetOrder(n) {
  if (n === mgN) return;
  mgN = n;
  mgPaintChips();
  mgNewGame();
}

function mgSetDiff(i) {
  if (i === mgDiff) return;
  mgDiff = i;
  mgPaintChips();
  mgNewGame();
}

/* ==========================================================
   十、软键盘（手机上用）
   ----------------------------------------------------------
   外观复用 css/tools.css 第六节那套 .gfx-pad / .gfx-key —— 和函数
   图像、罗马数字同一套键帽。
   电脑上不弹：直接敲键盘更快。
   ========================================================== */

/** 3 列 12 键：1-9 / 退格 0 清空 */
function mgPadRender() {
  if (!mgPadKeys) return;
  mgPadKeys.className = 'gfx-pad-keys is-3col';
  mgPadKeys.textContent = '';

  const defs = ['1', '2', '3', '4', '5', '6', '7', '8', '9',
                { act: 'back' }, '0', { act: 'clear' }];

  defs.forEach(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gfx-key';

    if (typeof d === 'string') {
      b.textContent = d;
      b.setAttribute('aria-label', d);
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => mgPadInsert(d));
      mgPadKeys.appendChild(b);
      return;
    }

    b.classList.add('is-fn');
    if (d.act === 'back') {
      b.textContent = '\u232B';
      b.title = '退格';
      b.setAttribute('aria-label', '退格');
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', mgPadBackspace);
    } else {
      b.textContent = '清空';
      b.title = '清空这一格';
      b.setAttribute('aria-label', '清空这一格');
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', mgPadClear);
    }
    mgPadKeys.appendChild(b);
  });
}

function mgPadShow() {
  if (!mgPad || !mgPad.hidden) return;
  mgPad.hidden = false;
}

function mgPadHide() {
  if (!mgPad) return;
  mgPad.hidden = true;
}

/** 这一格还能不能再接一位（比如 9 阶里 8 后面还能接 0–1，接成 80/81）。 */
function mgCanExtend(v) {
  return v * 10 <= mgN * mgN;
}

function mgPadInsert(d) {
  const idx = mgFocusIdx;
  const inp = idx >= 0 ? mgInputs[idx] : null;
  if (!inp) return;

  const cur = inp.value.replace(/\D/g, '');
  // 已经两位数就换掉重来，否则往后接
  inp.value = cur.length >= 2 ? d : cur + d;
  inp.classList.remove('is-hint', 'is-given');

  const v = parseInt(inp.value, 10);
  const st = mgPaint();

  if (st.filled === st.total && !mgSolved) { mgCheck(false, st); return; }

  // 这一格到头了（两位数，或者再接一位就超过 n²）→ 跳到下一个空格
  if (inp.value.length >= 2 || !mgCanExtend(v)) {
    const next = mgNextBlank(idx);
    if (next >= 0) { try { mgInputs[next].focus({ preventScroll: true }); } catch (_) { mgInputs[next].focus(); } }
  }
}

function mgPadBackspace() {
  const idx = mgFocusIdx;
  const inp = idx >= 0 ? mgInputs[idx] : null;
  if (!inp) return;

  if (inp.value) {
    inp.value = inp.value.slice(0, -1);
  } else {
    const prev = mgPrevBlank(idx);
    if (prev >= 0) {
      try { mgInputs[prev].focus({ preventScroll: true }); } catch (_) { mgInputs[prev].focus(); }
    }
  }
  mgPaint();
}

function mgPadClear() {
  const idx = mgFocusIdx;
  const inp = idx >= 0 ? mgInputs[idx] : null;
  if (!inp) return;
  inp.value = '';
  inp.classList.remove('is-hint', 'is-given');
  mgPaint();
  try { inp.focus({ preventScroll: true }); } catch (_) { inp.focus(); }
}

/* ==========================================================
   十一、事件 + 初始化
   ========================================================== */

mgCheckBtn.addEventListener('click', () => mgCheck(true));
mgHintBtn.addEventListener('click', mgHint);
mgNewBtn.addEventListener('click', mgNewPuzzle);
mgResetBtn.addEventListener('click', mgResetBoard);
mgAnsBtn.addEventListener('click', mgShowAnswer);

if (mgPadDone) {
  mgPadDone.addEventListener('click', () => {
    mgPadHide();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
}

/* 收起 / 展开：当前状态以 DOM 上的 hidden 为准，点一下取反 */
if (mgSetToggle) {
  mgSetToggle.addEventListener('click', () => {
    mgFoldSet(!(mgSetBody && mgSetBody.hidden));
  });
}

/* 一格一格点着填时，焦点落到空格子上就把键盘弹出来（电脑上不弹） */
document.addEventListener('focusin', e => {
  if (typeof Device !== 'undefined' && Device.isPC()) return;
  if (mgPad && mgPad.contains(e.target)) return;
  if (mgBoard && mgBoard.contains(e.target) && e.target.classList.contains('mg-in')) {
    mgPadShow();
  }
});

window.addEventListener('resize', () => { mgFitSoon(); mgSyncInputMode(); }, { passive: true });

/* 进这一页时：量一次格子宽度（页面藏着时量不出宽度）、对齐计时；
   换了账号就重开一题，别把上一位的盘面留着 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.key !== 'magic') return;

  mgFitSoon();

  const who = typeof currentAccount === 'string' ? currentAccount : null;
  if (mgOwner !== who) {
    mgOwner = who;
    mgNewGame();
  } else if (!mgSolved) {
    mgStartTimer();
  }
});

mgBuildChips();
mgPaintChips();
mgPadRender();
mgSetActions();
/* 恢复上次的收起状态（默认展开）。放在 mgNewGame 之前，
   这样首屏一出来就是用户上次留下的样子，不会先展开再"啪"地收起。
   第二个参数 false = 只摆界面、不写回存储（存储留给用户真去点收起时写）。 */
mgFoldSet(mgReadFolded(), false);
mgNewGame();
