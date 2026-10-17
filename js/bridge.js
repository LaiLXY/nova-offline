/* ==========================================================================
   bridge.js —— 功能页：数字桥屿（数桥 / Hashi）

   玩法：盘面上一堆带数字的「岛」（1–8），用桥把它们连起来：
     · 桥只走横竖，两座岛之间最多两条（单桥 / 双桥）
     · 某座岛上的数字 = 这座岛要连的桥数
     · 桥不能穿过别的岛；桥与桥也不能交叉
     · 所有岛都连够自己的数字、并且连成「一片」（谁也不能孤着）→ 过关

   ★ 出题：先造答案，再反推题目 —— 和二十四点 / 异或法则是同一个路子
       1. 随机撒岛，要求「看得见的岛对」能连成一张网（不然没可能全连通）
       2. 从一座岛开始往外长：每次挑一条**不穿岛、也不和已经架好的桥交叉**的
          边，把一座还在外面的岛连进来（随机 Prim）—— 长完就是一棵连通的桥树，
          而且到这一步所有桥天然互不交叉
       3. 再随机补桥（0→1、1→2）：补的时候同样不许交叉、每座岛不超过 8 条
       4. 每座岛连了几条桥，就是它的数字
       5. 用求解器数一遍解的个数：**恰好 1 个**才收这道题
          · 解不唯一时，往答案里再塞一条桥（数字变大 = 约束更强）重算，
            连着塞不动了就整局重摇
   ★ 为什么死磕"唯一解"：数桥一旦多解，玩家按逻辑推出来的另一种合法布局
     会被判成"没过" —— 那是我的锅。宁可多摇几次，也要保证解只有一种。
     每局还会把这道题的答案（brSolution）留着，M2 的「提示一步」要用。

   ★ 求解器（brCountSolutions）就是这套约束上的回溯 + 传播：
       · 每条边可取 0/1/2：岛上"还差几条"，与它各方向"最多还能给几条"，
         两个区间一对，该定的定、该砍的砍
       · 交叉的两条边不能同时 > 0
       · 连通用并查集剪一刀：至少要 comps-1 条边才连得起来，
         能变正的边不够就直接判死
     数到第 2 个解就停（只关心"是不是唯一"），另有节点预算兜底：
     超预算就当"没验出来"，重摇 —— 绝不让页面卡住。

   ★ 落子与判错：这一版是**放宽**的，不拦"错"，但要让人一眼看出错在哪
       点一座岛 → 点它上下左右的另一座岛 = 架桥；同一对反复点：单 → 双 → 拆。
       也可以从一座岛**拖**到另一座岛；点桥身上一下就拆掉那条桥。
       · 扣不住的：非同行同列、中间隔着别的岛、同一对超过两条 —— 一律不生效
       · 扣得住但违规的：超数、交叉 —— 照画，岛和数字标红、交点画红结
       过关条件：每座岛连够数字 + 全盘连成一片 + 场上没有红标（没有红结）。

   ★ 盘面是一张 SVG，坐标直接按格子算：
       一格 = 100 个用户单位，四周各留 BR_PAD，岛的圆心 = (BR_PAD + c*100, …)。
       于是 viewBox 跟着尺寸走，岛 / 桥 / 虚线提示 / 红标全是脚本现铺的元素，
       换个屏幕、转个向都由浏览器自己缩放，不用 JS 量一次像素。

   依赖 core.js（$ / $$ / toast）与 tools.js（tool:open 事件）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const brPage     = $('#toolBridge');
const brSetup    = $('#brSetup');
const brGame     = $('#brGame');
const brSizesEl  = $('#brSizes');
const brStartBtn = $('#brStart');
const brSvg      = $('#brSvg');
const brRoundEl  = $('#brRound');
const brMetaEl   = $('#brMeta');
const brTimeEl   = $('#brTime');
const brStepsEl  = $('#brSteps');
const brTipEl    = $('#brTip');
const brUndoBtn  = $('#brUndo');
const brResetBtn = $('#brReset');
const brAgainBtn = $('#brAgain');
const brBackBtn  = $('#brBack');
const brGiveBtn  = $('#brGiveUp');
const brOverlay  = $('#brOverlay');
const brOvTitle  = $('#brOvTitle');
const brOvText   = $('#brOvText');
const brOvOk     = $('#brOvOk');
const brOvAgain  = $('#brOvAgain');
const brOvBack   = $('#brOvBack');
const brOvAnswer = $('#brOvAnswer');
const brAskDlg   = $('#brAskConfirm');
const brAskTitle = $('#brAskTitle');
const brAskText  = $('#brAskText');
const brAskOk    = $('#brAskOk');

/* ---------- 常量 ---------- */
const BR_UNIT = 100;          // 一格 = 100 个 SVG 用户单位
const BR_PAD  = 55;           // 四周留白（最边上的岛心到边界）
const BR_R    = 30;           // 岛的半径
const BR_NS   = 'http://www.w3.org/2000/svg';

/* 五档尺寸：格子边长 → 岛上撒几座岛（少了下不去手，多了挤成一团）。
   数字是"体验"参数，改大改小都不影响出题成不成立，只影响难度和出题速度。
   下面这些区间是拿离线压测扫出来的（每档 120~200 局、端到端计时）：

       5×5   6–7      7×7   11–13     9×9   16–19
       11×11 22–26    13×13 30–32

   大盘面单次撒岛很难凑出"唯一解"，靠的是大批量重摇 —— 五档都还是 100% 成题、
   p90 落在几百毫秒内（11×11 约 40–120ms，13×13 约 140–300ms）。
   再往上的 15×15 就不划算了：盘面一大、岛一稀，候选边变少，成题率掉到 93~98%，
   常有摇不出来的，得让用户重点一次，所以没做进档位。 */
const BR_SIZES = {
  5:  { name: '入门', islands: [6, 7] },
  7:  { name: '进阶', islands: [11, 13] },
  9:  { name: '困难', islands: [16, 19] },
  11: { name: '专家', islands: [22, 26] },
  13: { name: '大师', islands: [30, 32] },
};

/* 出题预算：一道题最多摇多少次、最多花多少毫秒。
   都到不了的话就放弃这一局，让用户再点一次「换一题」（见 brMakePuzzle）。 */
const BR_MAX_ATTEMPT = 260;
const BR_TIME_BUDGET = 1800;
const BR_STRENGTHEN  = 8;      // 解不唯一时，最多再往答案里塞几条桥重试

/* 求解器的节点预算：一通搜索走这么多步还没结果，就当"没验出来"。
   有它兜底，再离谱的盘面也不会把界面冻住。 */
const BR_SOLVE_BUDGET = 120000;

/* ---------- 状态 ---------- */
let brSize    = 5;            // 当前这局的盘面边长（格数）
let brIslands = [];           // [{ r, c, n }]：岛的格子坐标与数字
let brEdges   = [];           // 候选边（同行/同列、中间没别的岛）：{r1,c1,r2,c2,cross,inc}
let brInc     = [];           // 岛 → 与它相邻的边下标数组
let brEdgeKey = new Map();    // "a,b"（小的在前）→ 边下标，落子时反查用
let brVal     = [];           // 每条边上的桥数 0/1/2（玩家看到的一切都由它推出来）
let brSolution = [];          // 这一局的标准答案（M2 的「提示一步」用）
let brSel     = -1;           // 当前选中的岛下标（-1 = 没选）
let brUndo    = [];           // 撤销栈：{ val, steps } 快照
let brSteps   = 0;            // 步数（架桥 / 拆桥的次数）
let brRound   = 0;            // 第几局（本次进来算起，只用于显示）
let brOver    = false;        // 本局是否已经结束（过关 / 放弃；结束了就不让再动盘面）
let brAnswerMode = false;     // 正在看标准答案（放弃之后走「查看答案」才为真）
let brGaveUp  = false;        // 这一局是放弃掉的（和"过关"分开，提示语不一样）
let brDrag    = null;         // 正在拖的那一次（{ from, x0, y0, moved, over }）
let brEmptyTap = null;        // 按在空白处的那一下（抬起来没动 = 点空白，收掉选中）
let brJustDragged = false;    // 刚拖完，用来吞掉随后那次 click
let brSayTimer = null;        // 临时提示的复原定时器

/* 计时：累计的暂停时长 + 这一段的暂停起点（切走标签页 / 离开功能页都算暂停） */
let brT0 = 0, brPausedTotal = 0, brPauseStart = 0, brTickTimer = null;

/* ==========================================================
   一、出题（撒岛 / 造解 / 唯一解校验）
   ========================================================== */

/** 某个尺寸的岛数：在配置的区间里随机取一个 */
function brPickIslandCount(size) {
  const cfg = BR_SIZES[size] || BR_SIZES[5];
  const lo = cfg.islands[0], hi = cfg.islands[1];
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** 随机撒岛。要求：每座岛都看得见别人，且「看得见的岛对」能连成一张网。
 *  连不成网就重撒（返回 null 让上层再试）—— 这样的盘面根本没可能全连通。 */
function brPlaceIslands(size, want) {
  const cells = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) cells.push(r * size + c);
  // 洗牌取前 want 个（Fisher–Yates 只洗前 want 个够了）
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(Math.random() * (cells.length - i));
    const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
  }
  const take = new Set(cells.slice(0, want));
  const islands = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (take.has(r * size + c)) islands.push({ r, c, n: 0 });
  }

  // 可见图连通性：按行 / 按列数相邻的岛，连成并查集
  const parent = islands.map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const byRow = new Map(), byCol = new Map();
  islands.forEach((is, i) => {
    if (!byRow.has(is.r)) byRow.set(is.r, []);
    if (!byCol.has(is.c)) byCol.set(is.c, []);
    byRow.get(is.r).push(i); byCol.get(is.c).push(i);
  });
  for (const list of byRow.values()) {
    list.sort((a, b) => islands[a].c - islands[b].c);
    for (let i = 1; i < list.length; i++) join(list[i - 1], list[i]);
  }
  for (const list of byCol.values()) {
    list.sort((a, b) => islands[a].r - islands[b].r);
    for (let i = 1; i < list.length; i++) join(list[i - 1], list[i]);
  }
  const root0 = find(0);
  for (let i = 1; i < islands.length; i++) if (find(i) !== root0) return null;

  islands.sort((a, b) => (a.r - b.r) || (a.c - b.c));
  return islands;
}

/** 候选边：同行/同列、中间没有别的岛的岛对（也就是"看得见"的两座岛）。
 *  顺带算出每条边和谁交叉 —— 判红结、出题时避开交叉都要用。 */
function brBuildEdges(size, islands) {
  const edges = [];
  const at = new Map();
  islands.forEach((is, i) => at.set(is.r * size + is.c, i));

  // 按行扫：同一行里相邻的两座岛就是一条横边（中间那几格没岛，因为"相邻"）
  const byRow = new Map(), byCol = new Map();
  islands.forEach((is, i) => {
    if (!byRow.has(is.r)) byRow.set(is.r, []);
    if (!byCol.has(is.c)) byCol.set(is.c, []);
    byRow.get(is.r).push(i); byCol.get(is.c).push(i);
  });
  for (const [r, list] of byRow) {
    list.sort((a, b) => islands[a].c - islands[b].c);
    for (let i = 1; i < list.length; i++) {
      edges.push({ r1: r, c1: islands[list[i - 1]].c, r2: r, c2: islands[list[i]].c,
                   inc: [list[i - 1], list[i]], cross: [] });
    }
  }
  for (const [c, list] of byCol) {
    list.sort((a, b) => islands[a].r - islands[b].r);
    for (let i = 1; i < list.length; i++) {
      edges.push({ r1: islands[list[i - 1]].r, c1: c, r2: islands[list[i]].r, c2: c,
                   inc: [list[i - 1], list[i]], cross: [] });
    }
  }

  // 一横一竖才可能交叉；两条同向的边不会交叉。端点重合（共用一座岛）不算交叉。
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      const ah = a.r1 === a.r2, bh = b.r1 === b.r2;
      if (ah === bh) continue;
      const h = ah ? a : b, v = ah ? b : a;        // h 横、v 竖
      if (v.c1 > h.c1 && v.c1 < h.c2 && h.r1 > v.r1 && h.r1 < v.r2) {
        a.cross.push(j); b.cross.push(i);
      }
    }
  }
  return edges;
}

/** 岛 → 相邻边下标；顺带建"哪两座岛之间是哪条边"的反查表 */
function brBuildIndex(islands, edges) {
  const inc = islands.map(() => []);
  const key = new Map();
  edges.forEach((ed, i) => {
    inc[ed.inc[0]].push(i);
    inc[ed.inc[1]].push(i);
    key.set(brPairKey(ed.inc[0], ed.inc[1]), i);
  });
  return { inc, key };
}

function brPairKey(a, b) { return a < b ? a * 1000 + b : b * 1000 + a; }

/** 每座岛现在的桥数 */
function brDegrees(islands, edges, val) {
  const deg = islands.map(() => 0);
  edges.forEach((ed, i) => {
    if (!val[i]) return;
    deg[ed.inc[0]] += val[i];
    deg[ed.inc[1]] += val[i];
  });
  return deg;
}

/** 现在把边 e 设成 v 条桥，合不合规（只看出题/落子都认的那两条硬规矩：
 *  不能和已有的桥交叉、每座岛最多 8 条）。 */
function brCanSet(edges, val, deg, e, v) {
  if (v > 0) {
    for (const f of edges[e].cross) if (val[f] > 0) return false;
  }
  const [a, b] = edges[e].inc;
  const d = deg[a] - val[e] + v;
  if (d > 8) return false;
  const d2 = deg[b] - val[e] + v;
  if (d2 > 8) return false;
  return true;
}

/** 造一个答案：从一座岛开始往外长（随机 Prim），保证连通、且桥互不交叉。
 *  返回每条边的桥数数组；实在长不出来返回 null。 */
function brBuildSolution(islands, edges, inc) {
  const k = islands.length, m = edges.length;
  const val = new Int8Array(m);
  const deg = new Int8Array(k);
  const inside = new Uint8Array(k);          // 是不是已经连进来了
  let count = 1;
  inside[0] = 1;

  while (count < k) {
    // 前线：一端在里面、一端在外面的边，去掉不合规的（交叉 / 度数满了）
    const cand = [];
    for (let i = 0; i < k; i++) {
      if (!inside[i]) continue;
      for (const e of inc[i]) {
        const other = edges[e].inc[0] === i ? edges[e].inc[1] : edges[e].inc[0];
        if (inside[other]) continue;
        if (!brCanSet(edges, val, deg, e, 1)) continue;
        cand.push(e);
      }
    }
    if (!cand.length) return null;

    // 偏爱"短桥"：长度在最短那半里的随机挑一条，盘面更好看
    cand.sort((a, b) => brEdgeLen(edges[a]) - brEdgeLen(edges[b]));
    const e = cand[Math.floor(Math.random() * Math.max(1, Math.ceil(cand.length / 2)))];
    val[e] = 1;
    deg[edges[e].inc[0]] += 1;
    deg[edges[e].inc[1]] += 1;
    const other = inside[edges[e].inc[0]] ? edges[e].inc[1] : edges[e].inc[0];
    inside[other] = 1;
    count++;
  }

  // 再随机补桥：0 → 1，或者 1 → 2（补出来的数字更有看头，也更容易是唯一解）
  for (let pass = 0; pass < 2; pass++) {
    const order = brShuffle(Array.from({ length: m }, (_, i) => i));
    for (const e of order) {
      if (val[e] >= 2) continue;
      // 度数低的岛优先照顾：光盯着随机补，出来的题会是一堆 1 和 2，
      // 而"高数字必须拉双桥"才是这玩法的推理乐趣所在
      const d0 = deg[edges[e].inc[0]], d1 = deg[edges[e].inc[1]];
      const p = (val[e] === 0 ? 0.14 : 0.16) + (d0 + d1 < 5 ? 0.18 : 0) + (d0 + d1 < 8 ? 0.08 : 0);
      if (Math.random() >= p) continue;
      if (!brCanSet(edges, val, deg, e, val[e] + 1)) continue;
      val[e] += 1;
      deg[edges[e].inc[0]] += 1;
      deg[edges[e].inc[1]] += 1;
    }
  }
  return val;
}

function brEdgeLen(ed) {
  return ed.r1 === ed.r2 ? ed.c2 - ed.c1 : ed.r2 - ed.r1;
}

function brShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ==========================================================
   二、求解器：数一数这道题有几个解

   返回 1 表示唯一解，0 表示无解（正常出题不该出现），
   2 表示"至少两个"（多解，不收），-1 表示超预算、没验出来。
   ========================================================== */

/* 每条边的候选值用位掩码记：bit0 = 允许 0，bit1 = 允许 1，bit2 = 允许 2 */
const BR_V0 = 1, BR_V1 = 2, BR_V2 = 4, BR_VALL = 7;

function brMinVal(d) { return (d & BR_V0) ? 0 : ((d & BR_V1) ? 1 : 2); }
function brMaxVal(d) { return (d & BR_V2) ? 2 : ((d & BR_V1) ? 1 : 0); }
function brSingle(d) { return d === BR_V0 ? 0 : (d === BR_V1 ? 1 : (d === BR_V2 ? 2 : -1)); }

/** 传播一轮：把"岛上还差几条"与各方向的上限对一对，该定的定、该砍的砍。
 *  变了就再来一轮，直到不动（或发现矛盾）。dom 是会被就地改的副本。 */
function brPropagate(dom, islands, edges, inc, nums) {
  const k = islands.length, m = edges.length;
  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < k; i++) {
      let fixed = 0, cap = 0;
      for (const e of inc[i]) {
        const d = dom[e];
        const s = brSingle(d);
        if (s >= 0) fixed += s;
        cap += brMaxVal(d);
      }
      const need = nums[i];
      if (fixed > need) return false;          // 已经连多了
      if (cap < need) return false;            // 各方向都拉满也不够
      if (fixed === need) {
        for (const e of inc[i]) {              // 剩下的方向只能给 0（已经定死的不动）
          if (brSingle(dom[e]) >= 0) continue;
          if (!(dom[e] & BR_V0)) return false;
          if (dom[e] !== BR_V0) { dom[e] = BR_V0; changed = true; }
        }
      } else if (cap === need) {
        for (const e of inc[i]) {              // 每个方向都得拉满
          const v = brMaxVal(dom[e]);
          const bit = v === 0 ? BR_V0 : (v === 1 ? BR_V1 : BR_V2);
          if (dom[e] !== bit) { dom[e] = bit; changed = true; }
        }
      }
    }

    // 交叉：一条边确定要架桥（>0），和它交叉的那条就只能给 0
    for (let e = 0; e < m; e++) {
      if (brMinVal(dom[e]) < 1) continue;
      for (const f of edges[e].cross) {
        if (brMinVal(dom[f]) >= 1) return false;
        if (dom[f] !== BR_V0) { dom[f] = BR_V0; changed = true; }
      }
    }

    // 连通剪枝：至少要 k-1 条边才连得起来，能变正的边不够就别往下搜了
    const parent = new Array(k);
    for (let i = 0; i < k; i++) parent[i] = i;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    let forced = 0, possible = 0;
    for (let e = 0; e < m; e++) {
      const d = dom[e];
      if (brMaxVal(d) >= 1) possible++;
      if (brMinVal(d) >= 1) {
        forced++;
        const a = find(edges[e].inc[0]), b = find(edges[e].inc[1]);
        if (a !== b) parent[a] = b;
      }
    }
    let comps = 0;
    for (let i = 0; i < k; i++) if (find(i) === i) comps++;
    if (comps - 1 > possible - forced) return false;
  }
  return true;
}

/** 所有边都定死了：核对"每座岛都连够 + 全盘连成一片" */
function brIsSolved(dom, islands, edges, inc, nums) {
  const k = islands.length, m = edges.length;
  const deg = new Array(k).fill(0);
  const parent = new Array(k);
  for (let i = 0; i < k; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let e = 0; e < m; e++) {
    const v = brSingle(dom[e]);
    if (v === undefined || v < 0) return false;
    if (!v) continue;
    deg[edges[e].inc[0]] += v;
    deg[edges[e].inc[1]] += v;
    const a = find(edges[e].inc[0]), b = find(edges[e].inc[1]);
    if (a !== b) parent[a] = b;
  }
  for (let i = 0; i < k; i++) if (deg[i] !== nums[i]) return false;
  const root = find(0);
  for (let i = 1; i < k; i++) if (find(i) !== root) return false;
  return true;
}

/** 回溯数解：最多数到 cap 个就收手。节点数超预算返回 -1。 */
function brCountSolutions(islands, edges, inc, nums, cap) {
  const m = edges.length;
  const dom0 = new Uint8Array(m).fill(BR_VALL);
  let nodes = 0;

  function dfs(dom) {
    if (++nodes > BR_SOLVE_BUDGET) return -1;
    if (!brPropagate(dom, islands, edges, inc, nums)) return 0;

    // 挑一个"选项最少"的未定边来分支（MRV），顺带做随机化免得老走同一条路
    let pick = -1, best = 9, ties = 0;
    for (let e = 0; e < m; e++) {
      const d = dom[e];
      if (d === BR_V0 || d === BR_V1 || d === BR_V2) continue;
      let n = 0;
      if (d & BR_V0) n++; if (d & BR_V1) n++; if (d & BR_V2) n++;
      if (n < best) { best = n; pick = e; ties = 1; }
      else if (n === best && Math.random() < 1 / ++ties) pick = e;
    }
    if (pick < 0) return brIsSolved(dom, islands, edges, inc, nums) ? 1 : 0;

    let total = 0;
    for (let v = 0; v <= 2; v++) {
      if (!(dom[pick] & (v === 0 ? BR_V0 : v === 1 ? BR_V1 : BR_V2))) continue;
      const nd = dom.slice();
      nd[pick] = v === 0 ? BR_V0 : v === 1 ? BR_V1 : BR_V2;
      const got = dfs(nd);
      if (got < 0) return -1;
      total += got;
      if (total >= cap) break;
    }
    return total;
  }
  return dfs(dom0);
}

/** 出一次题。成功返回 { islands, edges, nums, sol }，失败返回 null。 */
function brTryOnce(size) {
  const want = brPickIslandCount(size);
  const islands = brPlaceIslands(size, want);
  if (!islands) return null;

  const edges = brBuildEdges(size, islands);
  if (!edges.length) return null;
  const { inc, key } = brBuildIndex(islands, edges);

  let val = brBuildSolution(islands, edges, inc);
  if (!val) return null;
  let deg = brDegrees(islands, edges, val);
  if (deg.some(d => d < 1 || d > 8)) return null;

  // 唯一解校验；不唯一就再塞一条桥（数字变大、约束变强）重算
  for (let s = 0; ; s++) {
    const nums = deg.slice();
    const cnt = brCountSolutions(islands, edges, inc, nums, 2);
    if (cnt < 0) return null;                    // 没验出来，重摇
    if (cnt === 1) {
      return { islands, edges, inc, key, nums, sol: Array.from(val) };
    }
    if (s >= BR_STRENGTHEN) return null;
    if (!brStrengthen(val, edges, inc, deg)) return null;
  }
}

/** 往答案里再塞一条桥（挑"度数最小的岛"附近先塞，低数字最松、最值得勒紧） */
function brStrengthen(val, edges, inc, deg) {
  const cand = [];
  edges.forEach((ed, e) => {
    if (val[e] >= 2) return;
    if (!brCanSet(edges, val, deg, e, val[e] + 1)) return;
    cand.push({ e, w: deg[ed.inc[0]] + deg[ed.inc[1]] });
  });
  if (!cand.length) return false;
  cand.sort((a, b) => a.w - b.w);
  const pick = cand[Math.floor(Math.random() * Math.max(1, Math.ceil(cand.length / 3)))];
  val[pick.e] += 1;
  deg[edges[pick.e].inc[0]] += 1;
  deg[edges[pick.e].inc[1]] += 1;
  return true;
}

/** 出题总入口：在预算内反复摇，摇出来为止（调用方负责"没出来"的兜底） */
function brMakePuzzle(size) {
  const t0 = Date.now();
  for (let i = 0; i < BR_MAX_ATTEMPT; i++) {
    const p = brTryOnce(size);
    if (p) return p;
    if (i > 8 && Date.now() - t0 > BR_TIME_BUDGET) break;
  }
  return null;
}

/* ==========================================================
   三、盘面渲染（整张 SVG 现铺）

   层序（从下到上）：桥 → 选中岛的虚线提示 → 桥的点击区 → 岛 → 红结
   桥的点击区夹在中间：点桥身能拆桥，但贴着岛点下去仍然是点岛。
   ========================================================== */

function brSvgEl(tag, attrs) {
  const el = document.createElementNS(BR_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** 边的两端点坐标（用户单位） */
function brPos(ed) {
  return {
    x1: BR_PAD + ed.c1 * BR_UNIT, y1: BR_PAD + ed.r1 * BR_UNIT,
    x2: BR_PAD + ed.c2 * BR_UNIT, y2: BR_PAD + ed.r2 * BR_UNIT,
  };
}

/** 某座岛现在的状态：'ok' 连够了 / 'bad' 连多了 / 'open' 还差 */
function brStateOf(i) {
  const need = brIslands[i].n;
  let deg = 0;
  for (const e of brInc[i]) deg += brVal[e];
  return deg > need ? 'bad' : (deg === need ? 'ok' : 'open');
}

/** 场上所有交叉点（两条都架了桥才算） */
function brCrossPoints() {
  const out = [];
  brEdges.forEach((ed, i) => {
    if (!brVal[i]) return;
    for (const j of ed.cross) {
      if (j < i || !brVal[j]) continue;
      const a = ed, b = brEdges[j];
      const ah = a.r1 === a.r2;
      const h = ah ? a : b, v = ah ? b : a;
      out.push({ r: h.r1, c: v.c1 });
    }
  });
  return out;
}

/** 全盘连成一片了吗（只算架了桥的边） */
function brConnected() {
  const k = brIslands.length;
  const parent = new Array(k);
  for (let i = 0; i < k; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  brEdges.forEach((ed, i) => {
    if (!brVal[i]) return;
    const a = find(ed.inc[0]), b = find(ed.inc[1]);
    if (a !== b) parent[a] = b;
  });
  const root = find(0);
  for (let i = 1; i < k; i++) if (find(i) !== root) return false;
  return true;
}

function brRender() {
  const side = (brSize - 1) * BR_UNIT + BR_PAD * 2;
  brSvg.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
  while (brSvg.firstChild) brSvg.removeChild(brSvg.firstChild);

  const gBridge = brSvgEl('g', { class: 'br-bridges' });
  const gGhost  = brSvgEl('g', { class: 'br-ghosts' });
  const gHit    = brSvgEl('g', { class: 'br-bhits' });
  const gIsland = brSvgEl('g', { class: 'br-islands' });
  const gMark   = brSvgEl('g', { class: 'br-marks' });

  // ---------- 桥 ----------
  brEdges.forEach((ed, i) => {
    const v = brVal[i];
    if (!v) return;
    const p = brPos(ed);
    const off = 11;                    // 双桥两条线各偏这么多
    if (v === 1) {
      gBridge.appendChild(brSvgEl('line', {
        class: 'br-bridge', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      }));
    } else if (ed.r1 === ed.r2) {      // 横桥 → 上下各一条
      [p.y1 - off, p.y1 + off].forEach(y => {
        gBridge.appendChild(brSvgEl('line', {
          class: 'br-bridge br-bridge2', x1: p.x1, y1: y, x2: p.x2, y2: y,
        }));
      });
    } else {                           // 竖桥 → 左右各一条
      [p.x1 - off, p.x1 + off].forEach(x => {
        gBridge.appendChild(brSvgEl('line', {
          class: 'br-bridge br-bridge2', x1: x, y1: p.y1, x2: x, y2: p.y2,
        }));
      });
    }
    gHit.appendChild(brSvgEl('line', {
      class: 'br-bhit', 'data-bridge': i, x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
    }));
  });

  // ---------- 选中岛的虚线提示：还能往哪几个方向架桥 ----------
  if (brSel >= 0 && !brOver) {
    for (const e of brInc[brSel]) {
      if (brVal[e]) continue;
      const other = brEdges[e].inc[0] === brSel ? brEdges[e].inc[1] : brEdges[e].inc[0];
      const p = brPos(brEdges[e]);
      const from = brEdges[e].inc[0] === brSel;
      gGhost.appendChild(brSvgEl('line', {
        class: 'br-ghost',
        x1: from ? p.x1 : p.x2, y1: from ? p.y1 : p.y2,
        x2: from ? p.x2 : p.x1, y2: from ? p.y2 : p.y1,
        'data-hint': other,
      }));
    }
  }

  // ---------- 岛 ----------
  brIslands.forEach((is, i) => {
    const cls = 'br-island is-' + brStateOf(i) + (i === brSel ? ' is-sel' : '');
    const g = brSvgEl('g', {
      class: cls, 'data-island': i,
      transform: 'translate(' + (BR_PAD + is.c * BR_UNIT) + ',' + (BR_PAD + is.r * BR_UNIT) + ')',
    });
    // 里面再包一层：抖一下的动画要用 transform，别跟外层的 translate 打架
    const inner = brSvgEl('g', { class: 'br-jiggle' });
    inner.appendChild(brSvgEl('circle', { class: 'br-hit', r: BR_UNIT * 0.47 }));
    inner.appendChild(brSvgEl('circle', { class: 'br-ring-sel', r: BR_R + 15 }));
    inner.appendChild(brSvgEl('circle', { class: 'br-ring-bad', r: BR_R + 9 }));
    inner.appendChild(brSvgEl('circle', { class: 'br-dot', r: BR_R }));
    const t = brSvgEl('text', { class: 'br-num', x: 0, y: 0, dy: '.35em' });
    t.textContent = String(is.n);
    inner.appendChild(t);
    g.appendChild(inner);
    gIsland.appendChild(g);
  });

  // ---------- 红结（交叉点） ----------
  brCrossPoints().forEach(pt => {
    const g = brSvgEl('g', {
      class: 'br-knot',
      transform: 'translate(' + (BR_PAD + pt.c * BR_UNIT) + ',' + (BR_PAD + pt.r * BR_UNIT) + ')',
    });
    g.appendChild(brSvgEl('circle', { class: 'br-knot-ring', r: 12 }));
    g.appendChild(brSvgEl('circle', { class: 'br-knot-core', r: 4.5 }));
    gMark.appendChild(g);
  });

  brSvg.appendChild(gBridge);
  brSvg.appendChild(gGhost);
  brSvg.appendChild(gHit);
  brSvg.appendChild(gIsland);
  brSvg.appendChild(gMark);

  // ---------- 顺带的：步数、撤销按钮、提示语 ----------
  brStepsEl.textContent = String(brSteps);
  brUndoBtn.disabled = !brUndo.length;
  brTipEl.classList.remove('is-warn');
  brTipEl.textContent = brDefaultTip();
}

/** 盘面的一句话总结（没架完 → 还差几座；架完了但有红标 → 说红标）
 *  ★ 过了关就换成另一句：这时候玩家多半刚点完浮层上的「确认」，
 *    正对着自己摆出来的那张盘，得告诉他盘已经锁了、下一步往哪儿走。 */
function brDefaultTip() {
  if (brOver) {
    if (brAnswerMode) return '这是本局的标准答案 · 棋盘已锁，点上面的「换一题」或「改尺寸」继续';
    if (brGaveUp)     return '这一局已经放弃 · 可以点「查看答案」看标准解，或者直接换一题';
    return '这是你解出来的答案 · 棋盘已锁，点上面的「换一题」或「改尺寸」继续';
  }
  const open = brIslands.filter((_, i) => brStateOf(i) !== 'ok').length;
  const cross = brCrossPoints().length;
  if (open === 0 && cross === 0 && brConnected()) return '刚好连成一片 —— 过关';
  if (open === 0) {
    if (cross) return '数字都连够了，但有 ' + cross + ' 处交叉要改';
    return '数字都连够了，但还没连成一片 —— 还有孤着的岛';
  }
  let s = '还差 ' + open + ' 座岛没连够';
  if (cross) s += ' · 有 ' + cross + ' 处交叉要改';
  return s;
}

/* ==========================================================
   四、落子
   ========================================================== */

/** 架桥 / 拆桥前的快照 */
function brPushUndo() {
  brUndo.push({ val: brVal.slice(), steps: brSteps });
  if (brUndo.length > 300) brUndo.shift();
}

/** 两座岛之间那条边的下标（不是同行同列、或中间隔着岛 → -1） */
function brEdgeBetween(a, b) {
  const e = brEdgeKey.get(brPairKey(a, b));
  return e === undefined ? -1 : e;
}

/** 同一条线吗（中间隔着岛也算"同一条线"，落子时用来分辨"没点到"还是"过不去"） */
function brAligned(a, b) {
  return brIslands[a].r === brIslands[b].r || brIslands[a].c === brIslands[b].c;
}

/** 把边 e 的桥数循环一下：0 → 1 → 2 → 0 */
function brCycleEdge(e) {
  if (brOver || e < 0) return;
  brPushUndo();
  brVal[e] = (brVal[e] + 1) % 3;
  brSteps++;
  brRender();
  brCheckWin();
}

/** 点一座岛 */
function brTapIsland(i) {
  if (brOver) return;
  if (brSel === i) { brSel = -1; brRender(); return; }
  if (brSel < 0) { brSel = i; brRender(); return; }

  const e = brEdgeBetween(brSel, i);
  if (e >= 0) { brCycleEdge(e); return; }        // 选中 → 这一对：架桥 / 加固 / 拆掉

  if (brAligned(brSel, i)) {                     // 一条线上，但中间隔着别的岛
    brSay('中间隔着岛，桥过不去', true);
    brJiggle(i);
    return;
  }
  brSel = i;                                     // 换了条线：改选它
  brRender();
}

/** 临时顶掉提示语（默认文案在 brRender 里会自己回来） */
function brSay(msg, warn) {
  clearTimeout(brSayTimer);
  brTipEl.textContent = msg;
  brTipEl.classList.toggle('is-warn', !!warn);
  brSayTimer = setTimeout(() => {
    brTipEl.classList.remove('is-warn');
    brTipEl.textContent = brDefaultTip();
  }, 2200);
}

/** 让某座岛抖一下（扣不住的那一下给个反馈） */
function brJiggle(i) {
  const g = brSvg.querySelector('[data-island="' + i + '"] .br-jiggle');
  if (!g) return;
  g.classList.remove('is-jiggle');
  void g.getBoundingClientRect();                // 强制重排，动画才重放得了
  g.classList.add('is-jiggle');
}

/** 点桥身 = 拆掉这条桥 */
function brRemoveEdge(e) {
  if (brOver || e < 0 || !brVal[e]) return;
  brPushUndo();
  brVal[e] = 0;
  brSteps++;
  brRender();
  brCheckWin();
}

/* ==========================================================
   五、过关 / 撤销 / 重开 / 换题
   ========================================================== */

function brCheckWin() {
  if (brOver) return;
  // 三个条件：每座岛都恰好连够、没有交叉、全盘连成一片
  for (let i = 0; i < brIslands.length; i++) if (brStateOf(i) !== 'ok') return;
  if (brCrossPoints().length) return;
  if (!brConnected()) return;

  brOver = true;
  brSel = -1;
  brAnswerMode = false;
  brGaveUp = false;
  brRender();
  brOvTitle.textContent = '过关！';
  brOvText.textContent = brSize + ' × ' + brSize + ' · ' + brIslands.length +
    ' 座岛 · 用时 ' + brTimeText() + ' · ' + brSteps + ' 步';
  brOvOk.hidden = false;          // 过关给「确认」，不给「查看答案」
  brOvAnswer.hidden = true;
  brOverlay.classList.add('show');
  brSyncPause();
}

/** 浮层上点「确认」：收掉浮层，把盘面留在眼前。
 *  这里不碰 brVal —— 摆出来的就是玩家自己的答案，原样给他看；
 *  棋盘还锁着（brOver 仍然为真），顶栏挂上 is-done，
 *  「撤销 / 重开 / 放弃」让位，只剩「换一题 / 改尺寸」两个出口。 */
function brEnterSolvedView() {
  brAnswerMode = false;
  brOverlay.classList.remove('show');
  brGame.classList.add('is-done');
  brRender();                                    // 顺带把提示语换成"这是你解出来的答案…"
}

/** 放弃这一局：盘锁死、弹浮层。★ 这里**不摆答案** —— 想看标准解得再点
 *  浮层里的「查看答案」（和异或法则的 xoAbandon 一个路子）。 */
function brGiveUp() {
  brOver = true;
  brSel = -1;
  brAnswerMode = false;
  brGaveUp = true;
  brRender();
  brOvTitle.textContent = '已放弃这一局';
  brOvText.textContent = '可以看答案，也可以直接换一局。';
  brOvOk.hidden = true;                          // 放弃这一路不给「确认」
  brOvAnswer.hidden = false;                     // 换成「查看答案」
  brOverlay.classList.add('show');
  brSyncPause();
}

/** 「查看答案」：把这一局的标准解摆上去。
 *  ★ 和 brEnterSolvedView（过关后看自己摆的）差别就一点：这里**要换局面**。 */
function brEnterAnswerView() {
  brOverlay.classList.remove('show');
  brVal = brSolution.slice();
  brSel = -1;
  brOver = true;
  brAnswerMode = true;
  brGame.classList.add('is-done');
  brRender();                                    // 提示语换成"这是本局的标准答案…"
}

function brUndoStep() {
  if (!brUndo.length) return;
  const snap = brUndo.pop();
  brVal = snap.val;
  brSteps = snap.steps;
  brOver = false;
  brAnswerMode = false;
  brGaveUp = false;
  brOverlay.classList.remove('show');
  brGame.classList.remove('is-done');
  brRender();
}

function brResetAll() {
  if (!brVal.some(v => v)) return;               // 一条桥都没有，没什么可重开的
  brPushUndo();
  brVal = brVal.map(() => 0);
  brSel = -1;
  brOver = false;
  brAnswerMode = false;
  brGaveUp = false;
  brOverlay.classList.remove('show');
  brGame.classList.remove('is-done');
  brRender();
}

/** 开一局：出题 → 铺盘面 → 计时归零 */
function brNewRound(size) {
  brCloseConfirm();
  const puzzle = brMakePuzzle(size);
  if (!puzzle) {
    toast('err', '这局没出出来', '再点一次「换一题」试试');
    return false;
  }
  brSize = size;
  brIslands = puzzle.islands;
  brEdges = puzzle.edges;
  brInc = puzzle.inc;
  brEdgeKey = puzzle.key;
  brSolution = puzzle.sol;
  brIslands.forEach((is, i) => { is.n = puzzle.nums[i]; });

  brVal = new Array(brEdges.length).fill(0);
  brSel = -1;
  brUndo = [];
  brSteps = 0;
  brOver = false;
  brAnswerMode = false;
  brGaveUp = false;
  brRound++;
  brDrag = null;
  brEmptyTap = null;

  brOverlay.classList.remove('show');
  brGame.classList.remove('is-done');            // 新的一局：顶栏五个按钮都回来
  brOvOk.hidden = false;                         // 浮层主按钮复位成「确认」
  brOvAnswer.hidden = true;
  brSetup.hidden = true;
  brGame.hidden = false;

  brRoundEl.textContent = '第 ' + brRound + ' 局';
  brMetaEl.textContent = brSize + ' × ' + brSize + ' · ' + brIslands.length + ' 座岛';
  brStartClock();
  brRender();
  return true;
}

/** 回第一页（选尺寸） */
function brToSetup() {
  brCloseConfirm();
  brOverlay.classList.remove('show');
  brGame.classList.remove('is-done');
  brAnswerMode = false;
  brGaveUp = false;
  brOvOk.hidden = false;                         // 浮层主按钮复位成「确认」
  brOvAnswer.hidden = true;
  brDrag = null;
  brEmptyTap = null;
  brGame.hidden = true;
  brSetup.hidden = false;
  brSyncPause();
  brPaintSizeButtons();
}

/* ---------- 计时 ----------
   只在"看着这一页"的时候走：切走标签页、或者退回上一页（功能页隐藏了），
   都算暂停。brElapsed 把暂停的时间扣掉。 */
function brStartClock() {
  brT0 = Date.now();
  brPausedTotal = 0;
  brPauseStart = 0;
  brTimeEl.textContent = '0:00';
  brSyncPause();
  if (!brTickTimer) brTickTimer = setInterval(brTick, 500);
}

function brSyncPause() {
  const paused = brOver || document.hidden || !brPage.classList.contains('show');
  if (paused && !brPauseStart) brPauseStart = Date.now();
  else if (!paused && brPauseStart) { brPausedTotal += Date.now() - brPauseStart; brPauseStart = 0; }
}

function brElapsed() {
  let ms = Date.now() - brT0 - brPausedTotal;
  if (brPauseStart) ms -= Date.now() - brPauseStart;
  return Math.max(0, ms);
}

function brTimeText() {
  const s = Math.floor(brElapsed() / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function brTick() {
  brSyncPause();
  brTimeEl.textContent = brTimeText();
}

/* ==========================================================
   六、事件绑定
   ========================================================== */

/** 选尺寸：点一下高亮，局内不改（回第一页才能换） */
function brPaintSizeButtons() {
  Array.prototype.forEach.call(brSizesEl.children, b => {
    b.classList.toggle('on', +b.dataset.size === brSize);
  });
}

brSizesEl.addEventListener('click', e => {
  const btn = e.target.closest('.br-size');
  if (!btn) return;
  brSize = +btn.dataset.size;
  brPaintSizeButtons();
});

brStartBtn.addEventListener('click', () => brNewRound(brSize));
brUndoBtn.addEventListener('click', brUndoStep);

/* 浮层上的按钮：「确认」/「查看答案」是主按钮，两种状态二选一（见 index.html）；
   另外两颗 = 直接开新的（省一步，和顶栏那两颗是一回事）。
   ★ 这两颗不再叠一道确认：浮层本身就是一次"停下来做决定"，再问就成了两层弹窗。 */
brOvOk.addEventListener('click', brEnterSolvedView);
brOvAnswer.addEventListener('click', brEnterAnswerView);
brOvAgain.addEventListener('click', () => brNewRound(brSize));
brOvBack.addEventListener('click', brToSetup);

/* ---------- 二次确认（重开 / 换一题 / 改尺寸 / 放弃 共用一个壳） ----------
   四处只差"问什么、点了干什么"，所以壳只有一个、文案现填。
   ★ 换一题 / 改尺寸 / 放弃**一律问一句**，不管盘上有没有桥 —— 这三下都会把
     眼下这一局丢掉，空盘误点也是白丢一局。
     只有「重开」例外：一条桥都没有时给一句提示、不弹框（没什么可拆的）。 */
const BR_ASK = {
  reset: {
    title: '重开这一局？',
    text: '架好的桥全部拆掉，回到开局那张空盘。这一下也可以用「撤销」退回来。',
    ok: '重开',
  },
  next: {
    title: '换一题？',
    text: '眼下这一局就不再往下做了，直接出一张同尺寸的新盘。',
    ok: '换一题',
  },
  size: {
    title: '回到选尺寸？',
    text: '眼下这一局就不再往下做了，回到第一页重新挑一张盘。',
    ok: '改尺寸',
  },
  giveup: {
    title: '放弃这一局？',
    text: '这局就不往下做了。放弃之后可以点「查看答案」看标准解。',
    ok: '放弃',
  },
};

let brAskAct = '';                 // 现在问的是哪一件事（BR_ASK 的键）

/** 问一句。act = 'reset' | 'next' | 'size' | 'giveup' */
function brAskOpen(act) {
  const a = BR_ASK[act];
  brAskAct = act;
  brAskTitle.textContent = a.title;
  brAskText.textContent  = a.text;
  brAskOk.textContent    = a.ok;
  brAskDlg.classList.add('show');
}

function brCloseConfirm() {
  brAskDlg.classList.remove('show');
  brAskAct = '';
}

/** 点了「确认」：关掉框，做刚才问的那件事 */
function brAskRun() {
  const act = brAskAct;
  brCloseConfirm();
  if (act === 'reset') brResetAll();
  else if (act === 'next') brNewRound(brSize);
  else if (act === 'size') brToSetup();
  else if (act === 'giveup') brGiveUp();
}

/* 重开：一条桥都没有就没什么可拆的，直接回一句 */
brResetBtn.addEventListener('click', () => {
  if (brOver) return;
  if (!brVal.some(v => v)) { brSay('还没架桥，不用重开'); return; }
  brAskOpen('reset');
});

/* 换一题 / 改尺寸 / 放弃：一律先问一句（这三下都会把眼下这局丢掉）。
   ★ 通关之后顶栏只剩「换一题 / 改尺寸」，它们照样会问 —— brOver 为真也不跳过。 */
brAgainBtn.addEventListener('click', () => brAskOpen('next'));
brBackBtn.addEventListener('click',  () => brAskOpen('size'));
brGiveBtn.addEventListener('click',  () => {
  if (brOver) return;
  brAskOpen('giveup');
});

brAskOk.addEventListener('click', brAskRun);
brAskDlg.querySelector('.acts button:not(.danger)')
  .addEventListener('click', brCloseConfirm);
/* 点浮层空白处 = 取消（和异或 / 二零四八那几个确认框一个手感） */
brAskDlg.addEventListener('click', e => { if (e.target === brAskDlg) brCloseConfirm(); });

/* Esc 先关确认框（挂在 window 捕获阶段，比 tools.js 那个"Esc = 返回"先跑，
   否则一下 Esc 会连整页一起退掉） */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!brAskDlg.classList.contains('show')) return;
  e.stopPropagation();
  e.preventDefault();
  brCloseConfirm();
}, true);

/* ---------- 盘面上的指针交互 ----------
   · 按下落在岛上：接管这次手势（setPointerCapture），拖动超过阈值就算"拖桥"
   · 按下落在空白处：什么都不做 —— 页面照常滚（岛上那块 touch-action: none，
     见 css/tools.css 的 .br-hit；空地方的 touch-action 还是 auto），
     只记一笔，抬起来还在原地就当作"点了一下空白"，把选中收掉。

   ★ 一个坑：setPointerCapture 之后，pointerup / click 的 target 会被
     改派到**捕获元素**（这里是 <svg>）上，所以那两个回调里
     不能靠 e.target 判断"点的哪座岛" —— 岛只能从 pointerdown 那一下认，
     其余一律记状态。 */
function brSvgPoint(clientX, clientY) {
  const ctm = brSvg.getScreenCTM();
  if (!ctm) return null;
  const p = brSvg.createSVGPoint();
  p.x = clientX; p.y = clientY;
  return p.matrixTransform(ctm.inverse());
}

/** 离某个坐标最近的岛（超过一定距离就算没指着岛） */
function brIslandAtSvg(x, y) {
  let best = -1, bestD = Infinity;
  brIslands.forEach((is, i) => {
    const dx = BR_PAD + is.c * BR_UNIT - x, dy = BR_PAD + is.r * BR_UNIT - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  });
  const lim = BR_UNIT * 0.62;
  return bestD <= lim * lim ? best : -1;
}

function brHighlightTarget(i) {
  const prev = brSvg.querySelector('.br-island.is-target');
  if (prev) prev.classList.remove('is-target');
  if (i >= 0) {
    const g = brSvg.querySelector('[data-island="' + i + '"]');
    if (g) g.classList.add('is-target');
  }
}

brSvg.addEventListener('pointerdown', e => {
  if (brOver) return;
  const g = e.target.closest ? e.target.closest('[data-island]') : null;
  if (!g) {                                         // 空地方：交给浏览器（能滚）
    brEmptyTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    return;
  }
  brEmptyTap = null;
  const i = +g.dataset.island;
  brDrag = { from: i, x0: e.clientX, y0: e.clientY, moved: false, over: -1 };
  try { brSvg.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器：没捕获也能用 */ }
});

/* 兜底：有的浏览器对 SVG 子元素上的 touch-action 支持得不利索，
   拖动一旦真的开始了，就把这次 touchmove 拦下来，别让它变成滚页面 */
brSvg.addEventListener('touchmove', e => {
  if (!brDrag) return;
  if (!brDrag.moved && Math.hypot(
      e.touches[0].clientX - brDrag.x0,
      e.touches[0].clientY - brDrag.y0) < 9) return;
  e.preventDefault();
}, { passive: false });

brSvg.addEventListener('pointermove', e => {
  if (!brDrag) return;
  if (!brDrag.moved && Math.hypot(e.clientX - brDrag.x0, e.clientY - brDrag.y0) < 9) return;
  if (!brDrag.moved) {
    // 刚够到"这是拖动"：先把旧的选中收掉，免得虚线提示跟这次拖动打架
    // （★ 只能在这里收 —— 放到 pointerdown 会把"点两点架桥"的第二次点清掉）
    if (brSel >= 0 && brSel !== brDrag.from) { brSel = -1; brRender(); }
  }
  brDrag.moved = true;
  const p = brSvgPoint(e.clientX, e.clientY);
  const i = p ? brIslandAtSvg(p.x, p.y) : -1;
  const target = (i >= 0 && i !== brDrag.from) ? i : -1;
  if (target !== brDrag.over) { brDrag.over = target; brHighlightTarget(target); }
});

brSvg.addEventListener('pointerup', e => {
  // 点空白：手指/鼠标没怎么动，就把选中收掉
  if (brEmptyTap && brEmptyTap.id === e.pointerId) {
    const far = Math.hypot(e.clientX - brEmptyTap.x, e.clientY - brEmptyTap.y) >= 9;
    brEmptyTap = null;
    if (!far && brSel >= 0) { brSel = -1; brRender(); }
    return;
  }
  if (!brDrag) return;
  const drag = brDrag;
  brDrag = null;
  brHighlightTarget(-1);
  if (drag.moved) {
    brJustDragged = true;
    setTimeout(() => { brJustDragged = false; }, 0);
    if (drag.over >= 0) {
      const edge = brEdgeBetween(drag.from, drag.over);
      if (edge >= 0) brCycleEdge(edge);
      else if (brAligned(drag.from, drag.over)) {
        brSay('中间隔着岛，桥过不去', true);
        brJiggle(drag.over);
      }
      // 拖到一条线以外的岛上：这一下不算数（不换选中，免得手一滑就跳）
    } else {
      brSel = -1;
      brRender();
    }
    return;
  }
  brTapIsland(drag.from);                            // 没拖动 = 点了一下
});

brSvg.addEventListener('pointercancel', () => {
  brDrag = null;
  brEmptyTap = null;
  brHighlightTarget(-1);
});

/* 点桥身拆桥（拖完那一下紧接着的 click 要吞掉） */
brSvg.addEventListener('click', e => {
  if (brJustDragged || brOver) return;
  const hit = e.target.closest ? e.target.closest('[data-bridge]') : null;
  if (hit) brRemoveEdge(+hit.dataset.bridge);
});

/* 焦点在盘面上时不要留下键盘滚动（M2 再加方向键操作） */
brSvg.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('visibilitychange', brSyncPause);

/* ==========================================================
   七、初始化
   ========================================================== */
brPaintSizeButtons();

/* 进来时把尺寸按钮的高亮补上（DOM 可能刚被别的页面改过） */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== brPage) return;
  if (brGame.hidden) brPaintSizeButtons();
  brSyncPause();
});
