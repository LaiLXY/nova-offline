/* ==========================================================================
   xor.js —— 功能页：异或法则

   玩法：若干个 8×8 的盘（2–7 个），每个盘里固定三个标准俄罗斯方块。
     · 盘内三个方块**互不重叠**、也都不能拖出本盘；可以拖动、可以旋转
     · 盘与盘之间没有任何互斥关系 —— 跨盘重叠是常态，也是解题的关键
     · 结果 = 所有盘的方块逐格「异或」：某格被奇数个方块压住就亮，
       被偶数个（含 0 个）压住就灭 —— 这就是「奇现偶消」
     · 「当前图形」和「目标图形」逐格一致 → 过关

   ★ 出题照着二十四点的路子来：**先有答案，再出题**
       1. 摆一个"答案局面"（每盘三块、盘内不重叠、都在盘内）
       2. 各盘异或叠起来 = 目标图形
       3. 把这批方块重新打散 = 开局局面（玩家看到的就是这个）
     ★ 第 3 步用的是**同一批方块**（形状一个不改，只挪位置、改朝向）：
       玩家换不掉方块形状，要是开局另摇一套形状，目标图形就可能根本
       拼不出来。同一批就一定是可解的 —— 答案局面本身就是那批方块
       的一个合法摆法。所以每一局都保证有解，不用事后验。

   ★ 目标图形尽量「有形」：摆答案局面时让每块都贴着已经摆下的方块
     （贴着 = 距离近；跨盘允许重叠，所以最理想的距离就是 0）。
     连不成一片、或者格数太离谱（太少像散点、太多糊成一坨）的题会被
     打分筛掉，多摇几次挑最好的。偶然出现一两个单格是允许的。

   ★ 判题全在浏览器里做，一次请求都不发 —— 和二十四点、罗马数字、
     九宫幻方一样是个纯前端页，也不记战绩。

   ★ 拖动用 Pointer Events：按住方块拖，松手时吸附到格。
     松手的位置只要有一格出界、或者压到本盘别的方块，整块弹回
     **这次拖动前的位置**（不是开局位置），所以任何时刻盘面都是合法的，
     不存在"半成品"的中间态。

   ★ 旋转绕的是**方块重心附近的那一格**（见 XO_PIVOT），不是包围盒的角：
     长条要是绕着一端转，另一头得扫过四格远，边上稍挤一点就转不动了；
     绕重心转，只需要中间那两格周围空着，明显好转得多。
     转完出界 / 压到本盘别的块时，先试"整体挪一格"（XO_ROT_NUDGE），
     还不行就不生效、只回一句提示 —— 玩家挪一下再转。

   依赖 core.js（$ / $$ / toast）与 tools.js（tool:open 事件）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const xoPage       = $('#toolXor');
const xoSetup      = $('#xoSetup');
const xoCountsEl   = $('#xoCounts');
const xoStartBtn   = $('#xoStart');
const xoGame       = $('#xoGame');
const xoRoundEl    = $('#xoRound');
const xoMetaEl     = $('#xoMeta');
const xoUndoBtn    = $('#xoUndo');
const xoResetBtn   = $('#xoReset');
const xoQuitBtn    = $('#xoQuit');
const xoHeadActs   = $('#xoHeadActs');
const xoHeadActsAns = $('#xoHeadActsAns');
const xoAgain2Btn  = $('#xoAgain2');
const xoRechoose2  = $('#xoRechoose2');
const xoShowAnsBtn = $('#xoShowAnswer');
const xoTgtGrid    = $('#xoTgtGrid');
const xoLivGrid    = $('#xoLivGrid');
const xoBoardName  = $('#xoBoardName');
const xoRotLBtn    = $('#xoRotL');
const xoRotRBtn    = $('#xoRotR');
const xoTip        = $('#xoTip');
const xoBoardEl    = $('#xoBoard');
const xoCellsEl    = $('#xoCells');
const xoPiecesEl   = $('#xoPieces');
const xoNumsEl     = $('#xoNums');
const xoOverlay    = $('#xoOverlay');
const xoOverTitle  = $('#xoOverlayTitle');
const xoOverText   = $('#xoOverlayText');
const xoAgainBtn   = $('#xoAgain');
const xoRechoose   = $('#xoRechoose');
const xoOverlayOk  = $('#xoOverlayOk');
const xoQuitDialog = $('#xoQuitConfirm');
const xoResetDialog = $('#xoResetConfirm');

/* ---------- 常量 ---------- */
const XO_N     = 8;                    // 每个盘 8×8
const XO_SLOTS = 3;                    // 每个盘三个方块
const XO_DEF_BOARDS = 3;               // 默认开几个盘（可选 2–7，见 index.html 的 .xo-count）

/* 操作盘里三个方块的颜色（盘内三块互不重叠，所以这三色永远同时出现；
   不靠颜色区分"这是哪个盘"—— 盘由序号和当前显示的那一块决定）。
   目标图 / 实时图那两个蓝色 #0FAEFF 写在 css/tools.css 的第十节里。 */
const XO_COLORS = ['#C44127', '#F4CE49', '#6ECDD1'];

/* 七种标准俄罗斯方块。用字符画写，# = 有格子。
   空行空列在读取时会被裁掉（T / S / Z / J / L 的第三行），
   所以这里留着是为了跟标准形状的形状矩阵对上，好核对。 */
const XO_ART = {
  I: ['....', '####', '....', '....'],
  O: ['##', '##'],
  T: ['.#.', '###', '...'],
  S: ['.##', '##.', '...'],
  Z: ['##.', '.##', '...'],
  J: ['#..', '###', '...'],
  L: ['..#', '###', '...'],
};
const XO_TYPES = Object.keys(XO_ART);

/* ---------- 状态 ---------- */
let xoBoardCount = XO_DEF_BOARDS;   // 这一局开了几个盘（局内不可改）
let xoPieces     = [];              // [{ board, slot, type, rot, r, c, prev }, …]
                                    // prev = 上一次旋转前的位置（只给"转回来"用）
let xoTarget     = null;            // 目标图形，长度 64 的 0/1 数组
let xoAnswer     = [];              // 这一局的答案局面（看完答案时摆出来）
let xoOpening    = [];              // 开局局面（重置用）
let xoUndoStack  = [];              // 撤销栈（整局快照）
let xoSel        = -1;              // 选中的方块下标（-1 = 没选）
let xoActive     = 0;               // 当前显示的是第几个盘
let xoRoundNo    = 0;               // 第几局（本次进来算起，只用于显示）
let xoOver       = false;           // 本局是否已经结束（过关 / 放弃）
let xoAnswerMode = false;           // 正在看答案：方块锁定，不能拖也不能转
let xoSolvedView = false;           // 过关后点过「确认」：只看自己摆的那张盘，允许翻盘
let xoDrag       = null;            // 正在拖的那次拖动
let xoJustDragged = false;          // 刚刚拖完（用来吞掉随后那次 click）
let xoGridBuilt  = false;           // 格子是不是已经铺过了

/* ==========================================================
   一、方块形状：字符画 → 格子坐标 → 四档旋转
   ----------------------------------------------------------
   格子统一记成 [行, 列]，并且**贴回左上角**（最小行 / 最小列都归 0）。
   贴回去之后，一个方块的位置就只要记左上角 (r, c) 一格，简单得多。
   ========================================================== */

/** 去掉四周的空行空列，把形状贴回左上角 */
function xoNormalize(cells) {
  const minR = Math.min(...cells.map(p => p[0]));
  const minC = Math.min(...cells.map(p => p[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

function xoArtToCells(art) {
  const cells = [];
  art.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') cells.push([r, c]);
  });
  return xoNormalize(cells);
}

/** 顺时针 90°：整体 (r,c) → (c, maxR-r)，再贴回左上角。
 *  （maxR 是当前占到的最大行；用包围盒转，形状不会"跑偏"。） */
function xoRotateCW(cells) {
  const maxR = Math.max(...cells.map(p => p[0]));
  return xoNormalize(cells.map(([r, c]) => [c, maxR - r]));
}

/** 类型 → [0°, 90°, 180°, 270°] 四档格子坐标 */
const XO_ROTS = {};
XO_TYPES.forEach(t => {
  const list = [xoArtToCells(XO_ART[t])];
  for (let i = 1; i < 4; i++) list.push(xoRotateCW(list[i - 1]));
  XO_ROTS[t] = list;
});

/* ---------- 旋转的支点（每种形状、每个朝向各一个格子） ----------
   ★ 支点取"最靠近方块重心的那一格"，不是包围盒的角。
     用角当支点的话，长条（I）会绕着**一端**转 —— 那一端不动，
     另一头要扫过四格远，稍微靠近边或别的方块就转不动了。
     改成绕重心附近那一格转，四格长的条只需要中间那两格周围有空，
     同样一块地方转得开的概率大得多。
   ★ 支点记成"该朝向自己的坐标里的一格"，它在四个朝向之间是**同一格**
     （跟着形状一起转过去的），所以绕着它转是精确的：转过去再转回来
     会回到原位，连转四次也回到起始朝向、起始位置，不会一格一格地漂。
     做法：先把每个朝向自己的支点算出来，旋转时让"这一格的绝对位置"
     保持不变即可（见 xoRotateTo）。 */
function xoNearestToCentroid(cells) {
  const cy = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cx = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  let best = cells[0], bestD = Infinity;
  cells.forEach(c => {
    const d = (c[0] - cy) * (c[0] - cy) + (c[1] - cx) * (c[1] - cx);
    if (d < bestD - 1e-9) { bestD = d; best = c; }
  });
  return best;
}

const XO_PIVOT = {};
XO_TYPES.forEach(t => {
  const list = XO_ROTS[t];
  const piv = [xoNearestToCentroid(list[0]).slice()];
  // 朝向 i-1 → i 的映射是 (r,c) → (c - minC, maxR - r)（见 xoRotateCW），
  // 支点跟着走一遍，就得到它在每个朝向里的坐标。
  for (let i = 1; i < 4; i++) {
    const prev = list[i - 1];
    const maxR = Math.max(...prev.map(p => p[0]));
    const minC = Math.min(...prev.map(p => p[1]));
    const pr = piv[i - 1];
    piv.push([pr[1] - minC, maxR - pr[0]]);
  }
  XO_PIVOT[t] = piv;
});

/* ==========================================================
   二、格子 / 掩码的小工具
   ----------------------------------------------------------
   掩码 = 长度 64 的 0/1 数组，下标 key = 行 * 8 + 列，
   和界面上格子的铺法（一行一行铺）顺序一致，可以直接对着刷。
   ========================================================== */
function xoKey(r, c) { return r * XO_N + c; }

/** 某个方块当前压住的格子（绝对坐标） */
function xoCellsOf(p) {
  return XO_ROTS[p.type][p.rot].map(([r, c]) => [p.r + r, p.c + c]);
}

/** 所有盘叠在一起的异或结果 */
function xoXorOf(pieces) {
  const mask = new Array(XO_N * XO_N).fill(0);
  pieces.forEach(p => {
    xoCellsOf(p).forEach(([r, c]) => {
      if (r >= 0 && r < XO_N && c >= 0 && c < XO_N) mask[xoKey(r, c)] ^= 1;
    });
  });
  return mask;
}

function xoMaskEq(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function xoCount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/** 把亮着的格子按四邻（上下左右）分堆，返回每一堆的大小（大的在前）。
 *  用来看"散不散"：一堆就是连成一片的一块，堆数越多越碎。
 *  斜着靠在一起不算连 —— 图上也是这样，只有共边才算连上。 */
function xoComponents(mask) {
  const seen = new Uint8Array(mask.length);
  const sizes = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop();
      n++;
      const r = (k / XO_N) | 0, c = k % XO_N;
      const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [nr, nc] of nb) {
        if (nr < 0 || nr >= XO_N || nc < 0 || nc >= XO_N) continue;
        const nk = xoKey(nr, nc);
        if (mask[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}

/* ==========================================================
   三、摆放的合法性
   ========================================================== */

/** 生成时用：给定形状和左上角，能不能放进这个盘（taken = 本盘已占的格子） */
function xoPlaceOk(type, rot, r0, c0, taken) {
  const cells = XO_ROTS[type][rot];
  for (const [dr, dc] of cells) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || r >= XO_N || c < 0 || c >= XO_N) return false;
    if (taken.has(xoKey(r, c))) return false;
  }
  return true;
}

/** 玩的时候用：把第 idx 块换成 type/rot 并挪到 (r0,c0)，行不行？
 *  返回 null（行）/ 'out'（出界）/ 'overlap'（压到本盘别的方块） */
function xoFitReason(pieces, idx, type, rot, r0, c0) {
  const board = pieces[idx].board;
  const cells = XO_ROTS[type][rot];
  for (const [dr, dc] of cells) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || r >= XO_N || c < 0 || c >= XO_N) return 'out';
  }
  for (let i = 0; i < pieces.length; i++) {
    if (i === idx || pieces[i].board !== board) continue;
    const other = xoCellsOf(pieces[i]);
    for (const [dr, dc] of cells) {
      const r = r0 + dr, c = c0 + dc;
      if (other.some(([or, oc]) => or === r && oc === c)) return 'overlap';
    }
  }
  return null;
}

/* ==========================================================
   四、出题
   ========================================================== */

/* ==========================================================
   四、出题
   ----------------------------------------------------------
   总的路子还是"先有答案，再出题"，但答案局面不是随便摆的 ——
   摆法直接决定目标图形好不好看，所以这里用**逐块贪心**：
   每放一块，都把落点候选挨个试一遍，挑"放上去之后目标图形
   最不碎、格数最舒服"的那一个（同分就随机挑，题面才不重样）。

   为什么不干脆随机摆完再筛：随机摆 + 硬要求"连成一片"实测只有
   1%–2% 的命中率（重叠即抵消，抵消一多图形就碎成渣），出一次题
   要摇几百遍；贪心基本一次就成，而且图形明显更整。
   ========================================================== */

/** 每块试多少个落点候选（贪心用） */
const XO_CANDIDATES = 70;

/** 给目标图形打分：连成一片最要紧，碎块和格数离谱都扣分
 *  （分数只用来"从几个候选里挑更好的"，不追求绝对数值） */
function xoShapeScore(mask) {
  const lit = xoCount(mask);
  if (!lit) return -1;

  const sizes = xoComponents(mask);
  const frac = sizes[0] / lit;             // 最大那一块占了多少

  let s = Math.round(frac * 70);           // 主体连成一片：占大头
  s -= (sizes.length - 1) * 8;             // 每多一块碎的就扣一点

  if (lit >= 8 && lit <= 20) s += 25;      // 格数舒服的区间
  else if (lit >= 6 && lit <= 24) s += 14;
  else if (lit <= 30) s += 4;
  s -= Math.max(0, lit - 20) * 1.5;        // 太满也糊成一坨，不好看

  return s;
}

/** 这块目标图形够不够好（够好就不必再摇下一套）
 *  允许分成两块 —— 偶发一两个孤格是能接受的，不必追求绝对连成一片。 */
function xoShapeGood(mask) {
  const lit = xoCount(mask);
  if (lit < 8 || lit > 26) return false;
  const sizes = xoComponents(mask);
  return sizes.length <= 2 || (sizes.length <= 3 && sizes[0] / lit >= 0.85);
}

/** 贪心摆一套答案局面：每个盘三块，盘内不重叠、都在盘内。
 *  每次放一块之前试 XO_CANDIDATES 个候选落点，取"叠出来的目标图形
 *  打分最高"的那个。 */
function xoGrowAnswer(boards) {
  const pieces = [];
  const xor = new Array(XO_N * XO_N).fill(0);   // 已摆下的方块叠出来的图形

  for (let b = 0; b < boards; b++) {
    const taken = new Set();                    // 本盘已占的格子（盘内不能重叠）

    for (let s = 0; s < XO_SLOTS; s++) {
      let best = null, bestScore = -Infinity, ties = 0;

      for (let t = 0; t < XO_CANDIDATES; t++) {
        const type = XO_TYPES[Math.floor(Math.random() * XO_TYPES.length)];
        const rot  = Math.floor(Math.random() * 4);
        const cells = XO_ROTS[type][rot];
        const h = Math.max(...cells.map(p => p[0])) + 1;
        const w = Math.max(...cells.map(p => p[1])) + 1;
        const r0 = Math.floor(Math.random() * (XO_N - h + 1));
        const c0 = Math.floor(Math.random() * (XO_N - w + 1));
        if (!xoPlaceOk(type, rot, r0, c0, taken)) continue;

        // 试着叠上去，看看图形会变成什么样（异或：压到就是抵消）
        const trial = xor.slice();
        cells.forEach(([dr, dc]) => { trial[xoKey(r0 + dr, c0 + dc)] ^= 1; });

        const score = xoShapeScore(trial) + Math.random() * 3;
        if (score > bestScore) {
          bestScore = score; ties = 1;
          best = { type, rot, r: r0, c: c0, cells };
        } else if (score === bestScore && Math.random() < 1 / (++ties)) {
          best = { type, rot, r: r0, c: c0, cells };   // 同分随机挑，题面才不重样
        }
      }

      if (!best) return null;                   // 这块实在没地方放，整次作废

      best.cells.forEach(([dr, dc]) => {
        const k = xoKey(best.r + dr, best.c + dc);
        taken.add(k);
        xor[k] ^= 1;
      });
      pieces.push({ board: b, slot: s, type: best.type, rot: best.rot, r: best.r, c: best.c });
    }
  }
  return pieces;
}

/** 出题：摆一套答案局面 → 各盘异或 = 目标图形。
 *  贪心基本一次就好；偶尔拿到不满意的（分得太碎），再摇一套挑更好的，
 *  但最多摇 XO_ATTEMPTS 次 —— 别让"开始"按下去半天没反应。 */
function xoGenSolution(boards) {
  const XO_ATTEMPTS = 30;
  let best = null, bestScore = -1;

  for (let attempt = 0; attempt < XO_ATTEMPTS; attempt++) {
    const cand = xoGrowAnswer(boards);
    if (!cand) continue;

    const mask = xoXorOf(cand);
    if (xoShapeGood(mask)) return cand;        // 够好了，别再摇

    const score = xoShapeScore(mask);
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

/** 生成时用：给定形状，随机挑一个能放进这个盘的落点 */
function xoPickRandomPlacement(type, taken) {
  for (let t = 0; t < 80; t++) {
    const rot = Math.floor(Math.random() * 4);
    const cells = XO_ROTS[type][rot];
    const h = Math.max(...cells.map(p => p[0])) + 1;
    const w = Math.max(...cells.map(p => p[1])) + 1;
    const r0 = Math.floor(Math.random() * (XO_N - h + 1));
    const c0 = Math.floor(Math.random() * (XO_N - w + 1));
    if (xoPlaceOk(type, rot, r0, c0, taken)) return { rot, r: r0, c: c0 };
  }
  return null;
}

/** 开局局面：把答案局面上那**同一批方块**（同样的形状）随便打散。
 *
 *  ★ 必须用同一批方块：玩家只能挪 / 转手头这些块，形状是换不掉的。
 *    要是开局另摇一套形状，目标图形就可能根本拼不出来 ——
 *    所以这里只动位置和朝向，形状一个不改，题目就一定是可解的
 *    （答案局面本身就是那批方块的一个合法摆法）。
 *
 *  顺带保证一件事：打散之后不能已经等于目标（不然开局就赢了），
 *  所以"打散到跟答案局面碰巧一样"的那些次会被丢掉重摇。 */
function xoScramblePieces(sol, boards, target) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const pieces = [];
    let ok = true;

    for (let b = 0; b < boards && ok; b++) {
      // 本盘这三块的形状（打乱顺序，免得开局每次都摆成一个样）
      const types = sol.filter(p => p.board === b).map(p => p.type);
      for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = types[i]; types[i] = types[j]; types[j] = t;
      }

      const taken = new Set();
      for (let s = 0; s < types.length; s++) {
        const at = xoPickRandomPlacement(types[s], taken);
        if (!at) { ok = false; break; }        // 这块实在没地方放，整次重来
        const p = { board: b, slot: s, type: types[s], rot: at.rot, r: at.r, c: at.c };
        pieces.push(p);
        xoCellsOf(p).forEach(([r, c]) => taken.add(xoKey(r, c)));
      }
    }

    if (ok && !xoMaskEq(xoXorOf(pieces), target)) return pieces;
  }
  return null;
}


/* ==========================================================
   五、界面：格子铺一次，之后只改 class
   ----------------------------------------------------------
   小图（目标 / 当前）和操作盘的格子在 DOM 里都只铺一次 ——
   拖动时频繁重画的只有方块那一层，格子不动，手上才跟得住。
   ========================================================== */

/** 铺 8×8 个空格子（小图用的那种） */
function xoBuildMiniGrid(el) {
  el.textContent = '';
  for (let i = 0; i < XO_N * XO_N; i++) {
    const d = document.createElement('div');
    d.className = 'xo-cell';
    el.appendChild(d);
  }
}

/** 把一个掩码刷到小图上（格子是一行一行铺的，下标正好对得上） */
function xoPaintMini(el, mask) {
  const cells = el.children;
  for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('lit', !!mask[i]);
}

function xoUpdateLive() {
  xoPaintMini(xoLivGrid, xoXorOf(xoPieces));
}

/** 操作盘：铺 64 个底格 */
function xoBuildBoardGrid() {
  xoCellsEl.textContent = '';
  for (let r = 0; r < XO_N; r++) {
    for (let c = 0; c < XO_N; c++) {
      const d = document.createElement('div');
      d.className = 'xo-cell';
      d.dataset.r = r;
      d.dataset.c = c;
      xoCellsEl.appendChild(d);
    }
  }
}

/** 一格在盘上的像素步长（格子宽 + 间距），拖动吸附按它换算 */
function xoStepPx() {
  const first = xoCellsEl.firstElementChild;
  if (!first) return 32;
  const cw = first.getBoundingClientRect().width;
  const gw = xoCellsEl.getBoundingClientRect().width;
  const gap = (gw - XO_N * cw) / (XO_N - 1);
  return cw + gap;
}

/** 重画当前这个盘上的方块（位置、颜色、选中态） */
function xoRenderBoard() {
  xoPiecesEl.textContent = '';

  xoPieces.forEach((p, i) => {
    if (p.board !== xoActive) return;

    const el = document.createElement('div');
    el.className = 'xo-piece' + (i === xoSel ? ' sel' : '');
    el.dataset.piece = i;
    el.style.setProperty('--xo-piece-color', XO_COLORS[p.slot]);
    // 整个方块的落点：左上是 (c, r) 格
    el.style.transform =
      'translate(calc(' + p.c + ' * (var(--xo-cell) + var(--xo-gap))),' +
      ' calc(' + p.r + ' * (var(--xo-cell) + var(--xo-gap))))';

    // 内层专门给拖动用：按住时只动它，不必整盘重画
    const inner = document.createElement('div');
    inner.className = 'xo-piece-inner';

    XO_ROTS[p.type][p.rot].forEach(([dr, dc]) => {
      const d = document.createElement('div');
      d.className = 'xo-pcell';
      d.dataset.r = p.r + dr;
      d.dataset.c = p.c + dc;
      d.style.left = 'calc(' + dc + ' * (var(--xo-cell) + var(--xo-gap)))';
      d.style.top  = 'calc(' + dr + ' * (var(--xo-cell) + var(--xo-gap)))';
      inner.appendChild(d);
    });

    el.appendChild(inner);
    xoPiecesEl.appendChild(el);
  });
}

/** 序号：一个盘一个，点它切到那个盘 */
function xoRenderNums() {
  xoNumsEl.textContent = '';
  for (let b = 0; b < xoBoardCount; b++) {
    const b0 = b;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xo-num' + (b === xoActive ? ' on' : '');
    btn.textContent = String(b + 1);
    btn.setAttribute('aria-label', '切到第 ' + (b + 1) + ' 个操作盘');
    btn.addEventListener('click', () => xoSwitchBoard(b0));
    xoNumsEl.appendChild(btn);
  }
}

function xoSwitchBoard(b) {
  // 过关 / 放弃之后不许切盘；「看答案」和过关后的「确认」这两种回看状态除外
  if (xoOver && !xoAnswerMode && !xoSolvedView) return;
  xoActive = b;
  xoSel = -1;                       // 选中是"跟着盘走"的，换盘就清掉
  xoBoardName.textContent = '操作盘' + (b + 1);
  xoRenderNums();
  xoRenderBoard();
}

/* 第一次进这个功能页时把格子铺好（三块小图 + 操作盘） */
function xoBuildOnce() {
  if (xoGridBuilt) return;
  xoBuildMiniGrid(xoTgtGrid);
  xoBuildMiniGrid(xoLivGrid);
  xoBuildBoardGrid();
  xoGridBuilt = true;
}

/* ==========================================================
   六、拖动 / 选中 / 旋转
   ========================================================== */

function xoOnDown(e) {
  if (xoOver) return;                // 过关 / 放弃 / 看答案：方块一律不动
  xoJustDragged = false;             // 新一次按下了，上一次拖动的影响到此为止

  const pieceEl = e.target.closest('.xo-piece');
  if (!pieceEl) return;               // 点空白 = 取消选中，交给 xoTapEmpty

  const idx = +pieceEl.dataset.piece;
  const p = xoPieces[idx];

  if (xoSel !== idx) {               // 点一下就选中它（旋转按钮作用在这个块上）
    xoSel = idx;
    xoRenderBoard();
  }

  // 重画之后节点是新的，重新取
  const el = xoPiecesEl.querySelector('.xo-piece[data-piece="' + idx + '"]');
  const inner = el ? el.querySelector('.xo-piece-inner') : null;
  if (!el || !inner) return;

  xoDrag = {
    idx, el, inner,
    startX: e.clientX, startY: e.clientY,
    startR: p.r, startC: p.c,
    step:  xoStepPx(),
    lastX: e.clientX, lastY: e.clientY,
    raf: 0,
    dr: 0, dc: 0,
    moved: false,
  };

  try { xoBoardEl.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}

/** 把"跟手"那层位移写进样式。拖动中每个 pointermove 都写一次样式本来也可以，
 *  但鼠标一次快速移动会连发好几个事件，都写就浪费 —— 统一攒到下一帧写一遍。 */
function xoPaintDrag() {
  const d = xoDrag;
  if (!d || !d.raf) return;
  d.raf = 0;
  d.inner.style.transform =
    'translate3d(' + (d.lastX - d.startX) + 'px,' +
    ' ' + (d.lastY - d.startY) + 'px, 0)';
}

function xoOnMove(e) {
  if (!xoDrag) return;
  const dx = e.clientX - xoDrag.startX;
  const dy = e.clientY - xoDrag.startY;

  // 小抖动不算拖动，不然"点一下选中"会变成"挪了一格"
  if (!xoDrag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

  if (!xoDrag.moved) {
    xoDrag.moved = true;
    xoDrag.el.classList.add('dragging');
  }

  // 落点仍按**整格**算（松手时用它），但跟手的那层用**原始像素**。
  // 早先这里是先取整、再乘回格子步长，拖动时方块一格一格地跳，
  // 电脑上格子大、鼠标快，这种"发涩"就特别明显。
  xoDrag.lastX = e.clientX;
  xoDrag.lastY = e.clientY;
  xoDrag.dc = Math.round(dx / xoDrag.step);
  xoDrag.dr = Math.round(dy / xoDrag.step);

  if (!xoDrag.raf) xoDrag.raf = requestAnimationFrame(xoPaintDrag);
  e.preventDefault();
}

function xoOnUp() {
  if (!xoDrag) return;
  const d = xoDrag;
  xoDrag = null;
  if (d.raf) cancelAnimationFrame(d.raf);

  if (!d.moved) return;              // 只是点了一下 = 选中，位置没变
  xoJustDragged = true;              // 吞掉松手后浏览器补发的那次 click

  const p = xoPieces[d.idx];
  const nr = d.startR + d.dr;
  const nc = d.startC + d.dc;

  if (nr === p.r && nc === p.c) {    // 拖了个寂寞
    xoRenderBoard();
    return;
  }

  const why = xoFitReason(xoPieces, d.idx, p.type, p.rot, nr, nc);
  if (why) {
    // 放不下就静默弹回这次拖动前的位置，不弹提示 ——
    // 拖动时手一偏就会碰到，每次都弹一个太吵了。
    xoRenderBoard();
    return;
  }

  xoPushUndo();
  p.r = nr;
  p.c = nc;
  p.prev = null;                     // 挪过位置了，"上一次旋转之前"就不作数了
  xoAfterMove();
}

/** 点盘上的空白处 = 取消选中。
 *  特意挂在 click 上而不是 pointerdown：滚动页面时也会先触发 pointerdown，
 *  挂那儿会让"想滑一下"顺手把选中的方块清了。click 只在真正点按时发。 */
function xoTapEmpty(e) {
  if (xoOver || xoSel === -1) return;
  if (xoJustDragged) { xoJustDragged = false; return; }  // 刚拖完那一下不算"点空白"
  if (e.target.closest('.xo-piece')) return;
  xoSel = -1;
  xoRenderBoard();
}

/** 绕支点转到 dir 方向之后，这个方块该摆在哪（含新朝向）。
 *  支点那一格的绝对位置保持不变，所以长条是"就地转"而不是"绕着一端甩"。 */
function xoRotateTo(p, dir) {
  const rot = (p.rot + (dir > 0 ? 1 : 3)) % 4;

  // 转过去形状没变（O 方块四个朝向本来就一样）：原地不动最合适 ——
  // 支点这套对它是没有固定点的（2×2 转一圈每格都换位置），
  // 不做这一步的话每转一下整块会平移一格。
  if (xoRotsSame(p.type, p.rot, rot)) return { rot, r: p.r, c: p.c };

  const pivOld = XO_PIVOT[p.type][p.rot];
  const pivNew = XO_PIVOT[p.type][rot];
  return {
    rot,
    r: (p.r + pivOld[0]) - pivNew[0],
    c: (p.c + pivOld[1]) - pivNew[1],
  };
}

/** 两个朝向占的格子是不是同一批（朝向不同但形状一样） */
function xoRotsSame(type, a, b) {
  const ka = XO_ROTS[type][a].map(c => c[0] + ',' + c[1]).sort().join('|');
  const kb = XO_ROTS[type][b].map(c => c[0] + ',' + c[1]).sort().join('|');
  return ka === kb;
}

/* 转不开时，允许整体挪一格再试一次（只在"多挪这一格就转得开"时才生效）。
   有它才不至于出现"明明旁边空着、就因为长条多伸了一格而转不动"。
   想要严格"转不动就是不转"的话，把它设成 false 即可。
   顺序试过几种排法，成功率一样（能挪开就能挪开，跟先试哪个方向无关），
   所以就用这个最直白的顺序。 */
const XO_ROT_NUDGE = true;
const XO_ROT_NUDGES = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];

/** 旋转：dir > 0 顺时针，dir < 0 逆时针。转不开就整个不生效。 */
function xoRotate(dir) {
  if (xoOver) return;
  if (xoSel < 0) {
    toast('err', '先选一个方块', '点一下要旋转的方块，再点旋转');
    return;
  }
  const p = xoPieces[xoSel];
  const t = xoRotateTo(p, dir);

  // 先看能不能"原样退回上一次旋转之前的样子"：往回转过的时候成立。
  // 这一步是为了抵消下面那个"挪一格"的兜底：兜底挪过一格的方块，
  // 光靠几何算回来会差一格，玩家右转一下再左转一下发现块跑偏了会很别扭。
  // （上一次转之前的样子本来就是合法的，中间又只动过这一个方块，
  //   所以这里一定放得下。）
  let at = null;
  if (p.prev && p.prev.rot === t.rot &&
      !xoFitReason(xoPieces, xoSel, p.type, t.rot, p.prev.r, p.prev.c)) {
    at = { r: p.prev.r, c: p.prev.c };
  }

  if (!at) {
    for (const [dr, dc] of XO_ROT_NUDGES) {
      if (!XO_ROT_NUDGE && (dr || dc)) break;
      const r = t.r + dr, c = t.c + dc;
      if (!xoFitReason(xoPieces, xoSel, p.type, t.rot, r, c)) { at = { r, c }; break; }
    }
  }
  if (!at) {
    toast('err', '这里转不开', '先把方块挪开一点，再转');
    return;
  }

  xoPushUndo();
  p.prev = { rot: p.rot, r: p.r, c: p.c };
  p.rot = t.rot;
  p.r = at.r;
  p.c = at.c;
  xoAfterMove();
}

/** 一次落定之后：重画 → 刷实时图 → 看赢没赢 */
function xoAfterMove() {
  xoRenderBoard();
  xoUpdateLive();
  if (xoMaskEq(xoXorOf(xoPieces), xoTarget)) xoWin();
}

/* ==========================================================
   七、撤销 / 重置 / 放弃 / 过关
   ========================================================== */
function xoSnapshot() {
  return xoPieces.map(p => Object.assign({}, p));
}

function xoPushUndo() {
  xoUndoStack.push(xoSnapshot());
  if (xoUndoStack.length > 300) xoUndoStack.shift();
}

function xoUndo() {
  if (xoOver) return;
  if (!xoUndoStack.length) { toast('err', '没有可撤销的步骤', '这就是开局的样子'); return; }
  xoPieces = xoUndoStack.pop();
  xoSel = -1;
  xoRenderBoard();
  xoUpdateLive();
}

function xoReset() {
  if (xoOver) return;
  xoPushUndo();                      // 重置本身也能撤销
  xoPieces = xoOpening.map(p => Object.assign({}, p));
  xoSel = -1;
  xoRenderBoard();
  xoUpdateLive();
  toast('ok', '已回到开局', '所有方块都摆回一开始的位置');
}

function xoWin() {
  xoOver = true;
  xoRenderBoard();
  xoOverTitle.textContent = '过关！';
  xoOverText.textContent = '当前图形和目标图形完全一致。';
  xoShowAnsBtn.hidden = true;        // 都过关了就不用看答案了
  xoOverlayOk.hidden = false;        // 「确认」只在过关时给（放弃那一路没有）
  xoOverlay.hidden = false;
}

function xoAbandon() {
  xoOver = true;
  xoRenderBoard();
  xoOverTitle.textContent = '已放弃这一局';
  xoOverText.textContent = '可以看答案，也可以直接换一局。';
  xoShowAnsBtn.hidden = false;
  xoOverlayOk.hidden = true;
  xoOverlay.hidden = false;
}

/** 过关浮层上点「确认」：收掉浮层，把**玩家自己摆出来的**局面留在眼前。
 *  ★ 和 xoEnterAnswerView（看答案）差在一点：这里**不换局面** ——
 *    盘上就是他自己解出来的那张，原样给他看就是了。
 *    方块照样锁死（xoOver 本来就是真），顶栏切成「再来一局 / 重选盘数」，
 *    点序号还能逐个盘翻着看。 */
function xoEnterSolvedView() {
  xoCloseConfirms();
  xoOverlay.hidden = true;
  xoOver = true;
  xoSel = -1;
  xoSolvedView = true;               // 只看不动：允许点序号翻盘，别的一概挡住

  xoUpdateLive();
  xoRenderNums();
  xoRenderBoard();

  xoHeadActs.hidden = true;
  xoHeadActsAns.hidden = false;
  xoGame.classList.add('answer');    // 旋转按钮一起藏掉（见 tools.css）
  xoTip.textContent = '这是你摆出来的答案 · 方块已锁定，点序号可以逐个盘看';
}

/** 看答案：把关掉浮层、回到操作页，几个盘里摆出正确答案。
 *  这一眼就是"原来这么摆"，所以方块全部锁死 —— 不能拖、不能转，
 *  顶栏那三个（撤销 / 重置 / 放弃）也换成"再来一局 / 重选盘数"。 */
function xoEnterAnswerView() {
  xoCloseConfirms();
  xoOverlay.hidden = true;
  xoAnswerMode = true;
  xoSolvedView = false;
  xoOver = true;                     // 锁定状态，拖动/旋转都会直接被挡掉
  xoSel = -1;
  xoActive = 0;

  xoPieces = xoAnswer.map(p => Object.assign({}, p));
  xoBoardName.textContent = '操作盘1';
  xoPaintMini(xoTgtGrid, xoTarget);
  xoUpdateLive();
  xoRenderNums();
  xoRenderBoard();

  xoHeadActs.hidden = true;
  xoHeadActsAns.hidden = false;
  xoGame.classList.add('answer');     // 样式上把旋转按钮也藏起来（见 tools.css）
  xoTip.textContent = '这是参考答案 · 方块已锁定，点序号可以逐个盘看';
}

/** 从"看答案"退回正常状态（再来一局 / 重选盘数时都要调用） */
function xoExitAnswerView() {
  xoAnswerMode = false;
  xoSolvedView = false;
  xoHeadActs.hidden = false;
  xoHeadActsAns.hidden = true;
  xoGame.classList.remove('answer');
  xoTip.textContent = '点方块选中 · 拖动挪位 · ⟲ ⟳ 旋转（放不下会自动弹回）';
}

/* ==========================================================
   八、开局
   ========================================================== */
function xoNewRound(boards) {
  xoCloseConfirms();
  const sol = xoGenSolution(boards);
  if (!sol) { toast('err', '这局没出出来', '再点一次开始试试'); return; }

  xoBoardCount = boards;
  xoTarget = xoXorOf(sol);
  xoAnswer = sol.map(p => Object.assign({}, p));   // 留一份答案，看答案时用

  let opening = xoScramblePieces(sol, boards, xoTarget);
  if (!opening) { toast('err', '这局没出出来', '再点一次开始试试'); return; }

  xoPieces    = opening;
  xoOpening   = xoSnapshot();
  xoUndoStack = [];
  xoSel       = -1;
  xoActive    = 0;
  xoOver      = false;
  xoRoundNo++;

  xoExitAnswerView();                // 从"看答案"状态开新局，先把顶栏那些换回来

  xoRoundEl.textContent = '第 ' + xoRoundNo + ' 局';
  xoMetaEl.textContent  = boards + ' 个操作盘';
  xoBoardName.textContent = '操作盘1';

  xoPaintMini(xoTgtGrid, xoTarget);
  xoUpdateLive();
  xoRenderNums();
  xoRenderBoard();

  xoOverlay.hidden = true;
  xoSetup.hidden = true;
  xoGame.hidden = false;
}

function xoShowSetup() {
  xoExitAnswerView();
  xoCloseConfirms();
  xoOverlay.hidden = true;
  xoGame.hidden = true;
  xoSetup.hidden = false;
}

/* ==========================================================
   九、事件绑定
   ========================================================== */

/* 盘数：选了就高亮；局内不可改（只有回到选盘这一步才能重选） */
xoCountsEl.addEventListener('click', e => {
  const btn = e.target.closest('.xo-count');
  if (!btn) return;
  xoBoardCount = +btn.dataset.count;
  Array.prototype.forEach.call(xoCountsEl.children, b => b.classList.toggle('on', b === btn));
});

xoStartBtn.addEventListener('click', () => xoNewRound(xoBoardCount));

xoUndoBtn.addEventListener('click', xoUndo);

/* ---------- 二次确认弹框（放弃、重置各一个） ----------
   两处只差"问什么、点了干什么"，所以套同一个壳：
   点浮层空白处 = 关掉；点「确认」= 关掉并执行；点另一个按钮 = 关掉。 */
function xoWireConfirm(el, onOk) {
  el.querySelector('.acts .danger').addEventListener('click', () => {
    el.classList.remove('show');
    onOk();
  });
  el.querySelector('.acts button:not(.danger)')
    .addEventListener('click', () => el.classList.remove('show'));
  el.addEventListener('click', e => {
    if (e.target === el) el.classList.remove('show');
  });
}

/* Esc 关确认框，而不是关掉整个功能页。
   关键在**挂在 window 的捕获阶段**：捕获是从 window 往下的，
   所以这里比 js/tools.js 挂在 document 捕获阶段那个"Esc = 返回"先跑，
   拦下来之后 tools.js 就收不到了 —— 否则按一下 Esc 会连整页一起退掉。 */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!xoQuitDialog.classList.contains('show') &&
      !xoResetDialog.classList.contains('show')) return;
  e.stopPropagation();
  e.preventDefault();
  xoCloseConfirms();
}, true);

xoWireConfirm(xoQuitDialog, xoAbandon);
xoWireConfirm(xoResetDialog, xoReset);

/* 放弃：先二次确认（在角落，避免误点） */
xoQuitBtn.addEventListener('click', () => {
  if (xoOver) return;
  xoQuitDialog.classList.add('show');
});

/* 重置：也二次确认。重置本身是可撤销的（撤销栈里有这一步），
   但"整盘摆回开局"是个大动作，手滑点到挺烦的。 */
xoResetBtn.addEventListener('click', () => {
  if (xoOver) return;
  xoResetDialog.classList.add('show');
});

/* 换局 / 回选盘页 / 看答案：把可能开着的确认框一并收掉，
   免得留个浮层盖在新界面上 */
function xoCloseConfirms() {
  xoQuitDialog.classList.remove('show');
  xoResetDialog.classList.remove('show');
}

xoAgainBtn.addEventListener('click', () => xoNewRound(xoBoardCount));
xoRechoose.addEventListener('click', xoShowSetup);
xoShowAnsBtn.addEventListener('click', xoEnterAnswerView);
xoOverlayOk.addEventListener('click', xoEnterSolvedView);

/* 看过答案之后顶栏那两个（和浮层里那两个是一回事） */
xoAgain2Btn.addEventListener('click', () => xoNewRound(xoBoardCount));
xoRechoose2.addEventListener('click', xoShowSetup);

xoRotLBtn.addEventListener('click', () => xoRotate(-1));
xoRotRBtn.addEventListener('click', () => xoRotate(1));

/* 整个操作盘一起接事件：底格和方块那层是兄弟节点，
   挂在盘上才能一次都收得到（点底格 = 取消选中）。 */
xoBoardEl.addEventListener('pointerdown', xoOnDown);
xoBoardEl.addEventListener('pointermove', xoOnMove);
xoBoardEl.addEventListener('pointerup', xoOnUp);
xoBoardEl.addEventListener('pointercancel', xoOnUp);
xoBoardEl.addEventListener('click', xoTapEmpty);

/* ==========================================================
   十、初始化
   ========================================================== */
xoBuildOnce();

/* 进去时按需要补一次：第一次进来是"选盘数"，之后保持上次的样子。 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== xoPage) return;
  xoBuildOnce();
  if (xoGame.hidden && xoOverlay.hidden) {
    // 还在选盘那一步：把高亮补上（DOM 是新铺的或刚回来）
    Array.prototype.forEach.call(xoCountsEl.children, b => {
      b.classList.toggle('on', +b.dataset.count === xoBoardCount);
    });
  }
});

