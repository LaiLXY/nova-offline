/* ==========================================================================
   四色谜题（四色定理）  .fc-* 见 css/tools.css
   --------------------------------------------------------------------------
   玩法：随机撒点 → Voronoi 切到圆形内 → 得到不规则分块；玩家用四种颜色给
   每一块上色，相邻（共用一条边）的两块不能同色，全填上且无冲突即过关。

   依赖：core.js（$ / $$ / toast）、tools.js（tool:open 事件）。
   不引任何图形库：Voronoi 用「半平面交」现算，着色用回溯，全在浏览器里跑。

   颜色取自主页另四张卡片（巴什博弈 / 函数图像 / 罗马数字 / 异或法则）。
   选档 UI 对齐「数字桥屿 / 梵天汉诺 / 异或法则」：先选难度、再开始、
   规则垫在下面；通关 / 放弃 / 看答案的浮层复用那套统一交互。
   ========================================================================== */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const FC = $('#toolFourColor');
  if (!FC) return;

  /* ---------- 颜色（主页另四张卡片的配色） ---------- */
  const FC_COLORS = ['#FFD900', '#21B731', '#F66A00', '#0CBAEF']; // 黄 / 绿 / 橙 / 天蓝
  // 取色来源：巴什博弈(黄) / 梵天汉诺(绿) / 罗马数字(橙) / 异或法则(天蓝)

  /* ---------- 难度档（对齐「数字桥屿」那套分级卡片） ---------- */
  const FC_TIERS = [
    { key: 'easy',   n: 6,  name: '入门' },
    { key: 'normal', n: 10, name: '进阶' },
    { key: 'hard',   n: 16, name: '困难' },
    { key: 'master', n: 24, name: '大师' },
  ];
  let fcTier = FC_TIERS[0];

  /* ---------- 状态 ---------- */
  let fcRound   = 0;
  let fcPolys   = [];      // 每块的多边形：[{x,y}, ...]，坐标在 0..100 的 viewBox 内
  let fcAdj     = [];      // 邻接表：每块 -> 相邻块下标数组
  let fcEdges   = [];      // 相邻块之间的公共边：{i, j, a:{x,y}, b:{x,y}}
  let fcColor   = [];      // 每块的着色（0..3，-1 = 未上色）
  let fcUndo    = [];      // 撤销栈：{ idx, prev }
  let fcOver    = false;   // 本局是否已结束（过关 / 放弃）
  let fcAnsMode = false;   // 正在看标准答案
  let fcGaveUp  = false;   // 本局是放弃掉的
  let fcSel     = 0;       // 当前选中的颜色（0..3），-1 = 橡皮
  let fcCellEls = [];      // 每块对应的 <polygon> 元素

  /* ---------- 元素引用 ---------- */
  const fcSetup      = $('#fcSetup');
  const fcGame       = $('#fcGame');
  const fcTiersEl    = $('#fcTiers');
  const fcStart      = $('#fcStart');
  const fcRoundEl    = $('#fcRound');
  const fcMetaEl     = $('#fcMeta');
  const fcCellsEl    = $('#fcCells');
  const fcRedEl      = $('#fcRed');
  const fcTip        = $('#fcTip');
  const fcPalette    = $('#fcPalette');
  const fcErase      = $('#fcErase');
  const fcOverlay    = $('#fcOverlay');
  const fcOvTitle    = $('#fcOvTitle');
  const fcOvText     = $('#fcOvText');
  const fcOvOk       = $('#fcOvOk');
  const fcOvAnswer   = $('#fcOvAnswer');
  const fcOvNew      = $('#fcOvNew');
  const fcOvBack     = $('#fcOvBack');
  const fcAskConfirm = $('#fcAskConfirm');
  const fcAskTitle   = $('#fcAskTitle');
  const fcAskText    = $('#fcAskText');
  const fcAskOk      = $('#fcAskOk');
  const fcAskCancel  = $('#fcAskCancel');
  const fcUndoEl     = $('#fcUndo');
  const fcResetEl    = $('#fcReset');
  const fcNewEl      = $('#fcNew');
  const fcRechooseEl = $('#fcRechoose');
  const fcGiveUpEl   = $('#fcGiveUp');

  /* ==========================================================================
     一、几何：Voronoi 单元格（半平面交）+ 圆形裁剪 + 邻接
     ========================================================================== */
  const CIRCLE = circlePoly(50, 50, 47, 72);

  function circlePoly(cx, cy, r, seg) {
    const poly = [];
    for (let k = 0; k < seg; k++) {
      const a = 2 * Math.PI * k / seg;
      poly.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return poly;
  }

  /* 多边形有向面积（用于决定凸多边形裁剪的内侧方向） */
  function area(poly) {
    let s = 0;
    for (let k = 0; k < poly.length; k++) {
      const A = poly[k], B = poly[(k + 1) % poly.length];
      s += A.x * B.y - B.x * A.y;
    }
    return s / 2;
  }

  /* 把 poly 裁到「更靠近 i 而不是 j」的半平面（半平面交一步） */
  function clipHalfPlane(poly, i, j) {
    const jxi = { x: j.x - i.x, y: j.y - i.y };
    const ci = i.x * i.x + i.y * i.y;
    const cj = j.x * j.x + j.y * j.y;
    const val = p => 2 * (p.x * jxi.x + p.y * jxi.y) + (ci - cj); // <0 表示更靠近 i
    const out = [];
    const n = poly.length;
    for (let k = 0; k < n; k++) {
      const A = poly[k], B = poly[(k + 1) % n];
      const va = val(A), vb = val(B);
      const ain = va <= 0, bin = vb <= 0;
      if (ain && bin) out.push(B);
      else if (ain && !bin) out.push(mix(A, B, va, vb));
      else if (!ain && bin) { out.push(mix(A, B, va, vb)); out.push(B); }
    }
    return out;
  }

  /* 把 poly 裁到凸多边形 clip 内部（Sutherland–Hodgman） */
  function clipConvex(poly, clip) {
    const orient = area(clip) >= 0 ? 1 : -1;
    let out = poly.slice();
    for (let e = 0; e < clip.length; e++) {
      const C = clip[e], D = clip[(e + 1) % clip.length];
      const inp = out; out = [];
      const f = P => ((D.x - C.x) * (P.y - C.y) - (D.y - C.y) * (P.x - C.x)) * orient;
      for (let k = 0; k < inp.length; k++) {
        const A = inp[k], B = inp[(k + 1) % inp.length];
        const fa = f(A), fb = f(B);
        const ain = fa >= 0, bin = fb >= 0;
        if (ain && bin) out.push(B);
        else if (ain && !bin) out.push(mix(A, B, fa, fb));
        else if (!ain && bin) { out.push(mix(A, B, fa, fb)); out.push(B); }
      }
      if (out.length === 0) break;
    }
    return out;
  }

  function mix(A, B, fa, fb) {
    const t = fa / (fa - fb);
    return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  }

  /* 第 i 个种子的 Voronoi 单元格：从大方框起，依次裁掉「更靠近别人」的半平面，
     最后裁进圆里。 */
  function voronoiCell(i, pts) {
    let poly = [
      { x: -20, y: -20 }, { x: 120, y: -20 }, { x: 120, y: 120 }, { x: -20, y: 120 },
    ];
    for (let j = 0; j < pts.length && poly.length >= 3; j++) {
      if (j === i) continue;
      poly = clipHalfPlane(poly, pts[i], pts[j]);
    }
    return clipConvex(poly, CIRCLE);
  }

  /* 多边形质心（Lloyd 松弛用，让分块更均匀） */
  function centroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let k = 0; k < poly.length; k++) {
      const A = poly[k], B = poly[(k + 1) % poly.length];
      const cr = A.x * B.y - B.x * A.y;
      a += cr; cx += (A.x + B.x) * cr; cy += (A.y + B.y) * cr;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-9) {
      let sx = 0, sy = 0;
      poly.forEach(p => { sx += p.x; sy += p.y; });
      return { x: sx / poly.length, y: sy / poly.length };
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  /* 由分块多边形推导邻接：共享一条边的两块互为相邻。
     顶点量化成整数 id，边用两端 id 标识；恰好出现在两块里的边即公共边。 */
  function buildAdj(polys) {
    const vmap = new Map();
    let vid = 0;
    const vkey = p => {
      const k = Math.round(p.x * 100) + '_' + Math.round(p.y * 100);
      if (!vmap.has(k)) vmap.set(k, vid++);
      return vmap.get(k);
    };
    const edgeMap = new Map();
    polys.forEach((poly, ci) => {
      const n = poly.length;
      for (let k = 0; k < n; k++) {
        const A = poly[k], B = poly[(k + 1) % n];
        const ia = vkey(A), ib = vkey(B);
        const ek = ia < ib ? ia + '_' + ib : ib + '_' + ia;
        if (!edgeMap.has(ek)) edgeMap.set(ek, { cells: new Set([ci]), a: A, b: B });
        else edgeMap.get(ek).cells.add(ci);
      }
    });
    const adj = polys.map(() => new Set());
    const edges = [];
    for (const info of edgeMap.values()) {
      if (info.cells.size === 2) {
        const cells = [...info.cells];
        adj[cells[0]].add(cells[1]);
        adj[cells[1]].add(cells[0]);
        edges.push({ i: cells[0], j: cells[1], a: info.a, b: info.b });
      }
    }
    return { adj: adj.map(s => [...s]), edges };
  }

  /* 出一道题：撒点 → Lloyd 松弛 2 次 → 算单元格与邻接。失败返回 null（上层重试）。 */
  function tryMake(n) {
    let pts = [];
    let guard = 0;
    while (pts.length < n && guard++ < 4000) {
      const x = 6 + Math.random() * 88, y = 6 + Math.random() * 88;
      if ((x - 50) ** 2 + (y - 50) ** 2 <= 44 * 44) pts.push({ x, y });
    }
    if (pts.length < n) return null;
    for (let it = 0; it < 2; it++) {
      const polys = pts.map((_, i) => voronoiCell(i, pts));
      if (polys.some(p => p.length < 3)) return null;
      pts = polys.map(p => centroid(p));
    }
    const polys = pts.map((_, i) => voronoiCell(i, pts));
    if (polys.some(p => p.length < 3)) return null;
    const { adj, edges } = buildAdj(polys);
    return { polys, adj, edges };
  }

  function fcMakePuzzle(n) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const res = tryMake(n);
      if (res) return res;
    }
    return null;
  }

  /* ==========================================================================
     二、着色求解（看答案用，回溯 + 按度数排序）
     平面地图必可 4 色，因此一定能解出来。
     ========================================================================== */
  function solve4() {
    const n = fcPolys.length;
    const order = [...Array(n).keys()].sort((a, b) => fcAdj[b].length - fcAdj[a].length);
    const col = new Array(n).fill(-1);
    function rec(k) {
      if (k === n) return true;
      const v = order[k];
      const used = new Set(fcAdj[v].map(u => col[u]).filter(c => c >= 0));
      for (let c = 0; c < 4; c++) {
        if (used.has(c)) continue;
        col[v] = c;
        if (rec(k + 1)) return true;
      }
      col[v] = -1;
      return false;
    }
    rec(0);
    return col;
  }

  /* ==========================================================================
     三、渲染
     ========================================================================== */
  function fcBuildBoard() {
    fcCellsEl.innerHTML = '';
    fcRedEl.innerHTML = '';
    fcCellEls = fcPolys.map((poly, idx) => {
      const ptsStr = poly.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');
      const el = document.createElementNS(SVGNS, 'polygon');
      el.setAttribute('points', ptsStr);
      el.setAttribute('class', 'fc-cell');
      el.dataset.i = idx;
      el.addEventListener('click', onCell);
      el.addEventListener('animationend', () => el.classList.remove('is-shake'));
      fcCellsEl.appendChild(el);
      return el;
    });
    fcColor = fcPolys.map(() => -1);
    fcRedEl.innerHTML = '';
  }

  function renderCell(idx) {
    const el = fcCellEls[idx];
    const c = fcColor[idx];
    /* 注意：不能只靠 setAttribute('fill', ...)，因为 .fc-cell { fill:#fff } 这条
       CSS 规则的优先级高于呈现属性，会把颜色盖成白色。改用内联样式（优先级最高）。 */
    if (c < 0) {
      el.style.fill = '';                 // 清空内联样式，退回 CSS 默认的白色
    } else {
      el.style.fill = FC_COLORS[c];
    }
    el.classList.toggle('filled', c >= 0);
  }

  function renderAll() {
    fcCellEls.forEach((_, idx) => renderCell(idx));
    redrawRed();
  }

  function redrawRed() {
    fcRedEl.innerHTML = '';
    fcEdges.forEach(e => {
      if (fcColor[e.i] >= 0 && fcColor[e.i] === fcColor[e.j]) {
        const l = document.createElementNS(SVGNS, 'line');
        l.setAttribute('x1', e.a.x); l.setAttribute('y1', e.a.y);
        l.setAttribute('x2', e.b.x); l.setAttribute('y2', e.b.y);
        l.setAttribute('class', 'fc-redline');
        fcRedEl.appendChild(l);
      }
    });
  }

  function computeConflicts() {
    const bad = new Set();
    fcEdges.forEach(e => {
      if (fcColor[e.i] >= 0 && fcColor[e.i] === fcColor[e.j]) { bad.add(e.i); bad.add(e.j); }
    });
    return bad;
  }

  function conflictCount() {
    let cnt = 0;
    fcEdges.forEach(e => { if (fcColor[e.i] >= 0 && fcColor[e.i] === fcColor[e.j]) cnt++; });
    return cnt;
  }

  function allFilled() {
    return fcColor.every(c => c >= 0);
  }

  /* 上色 / 擦除之后统一收口：重绘、算冲突、抖一下冲突块、判过关 */
  function afterChange() {
    renderAll();
    const bad = computeConflicts();
    bad.forEach(idx => {
      const el = fcCellEls[idx];
      el.classList.remove('is-shake');
      requestAnimationFrame(() => el.classList.add('is-shake'));
    });
    const cnt = conflictCount();
    if (cnt > 0) {
      fcTip.textContent = '冲突 ' + cnt + ' 处 · 相邻两块不能同色';
      fcTip.classList.add('is-warn');
    } else if (allFilled()) {
      fcTip.textContent = '没有冲突 · 全部填完';
      fcTip.classList.remove('is-warn');
    } else {
      fcTip.textContent = '没有冲突 · 把剩下的块也填上';
      fcTip.classList.remove('is-warn');
    }
    if (fcOver) return;
    if (cnt === 0 && allFilled()) fcWin();
  }

  function pushUndo(idx) {
    fcUndo.push({ idx, prev: fcColor[idx] });
    fcUpdateUndo();
  }

  /* ==========================================================================
     四、交互
     ========================================================================== */
  function onCell(e) {
    if (fcOver) return;
    const idx = +e.currentTarget.dataset.i;
    const prev = fcColor[idx];
    if (fcSel === -1) {                 // 橡皮：擦掉
      if (prev === -1) return;
      pushUndo(idx); fcColor[idx] = -1; afterChange();
    } else {                            // 选中的颜色
      if (prev === fcSel) return;
      pushUndo(idx); fcColor[idx] = fcSel; afterChange();
    }
  }

  function syncPalette() {
    $$('.fc-swatch', fcPalette).forEach(b =>
      b.classList.toggle('on', +b.dataset.color === fcSel));
    fcErase.classList.toggle('on', fcSel === -1);
  }

  function fcHasProgress() {
    return fcColor.some(c => c >= 0);
  }

  function fcUpdateUndo() {
    fcUndoEl.disabled = fcUndo.length === 0;
  }

  /* ---------- 开局 / 收尾 ---------- */
  function fcNewRound(tier) {
    fcTier = tier;
    const puzzle = fcMakePuzzle(tier.n);
    if (!puzzle) { toast('err', '这局没出出来', '再点一次开始试试'); return; }
    fcPolys = puzzle.polys;
    fcAdj   = puzzle.adj;
    fcEdges = puzzle.edges;
    fcUndo  = [];
    fcOver  = false;
    fcAnsMode = false;
    fcGaveUp  = false;
    fcSel   = 0;
    fcRound++;

    fcGame.classList.remove('is-done');
    fcOvOk.hidden = false;
    fcOvAnswer.hidden = true;
    fcSetup.hidden = true;
    fcGame.hidden = false;

    fcRoundEl.textContent = '第 ' + fcRound + ' 局';
    fcMetaEl.textContent = fcTier.name + ' · ' + fcTier.n + ' 块';

    syncPalette();
    fcBuildBoard();
    renderAll();
    fcUpdateUndo();
    fcTip.textContent = '先选一种颜色，再点任意一块上色';
    fcTip.classList.remove('is-warn');
  }

  function fcReallyReset() {
    fcColor = fcPolys.map(() => -1);
    fcUndo  = [];
    fcOver  = false;
    fcAnsMode = false;
    fcGaveUp  = false;
    fcGame.classList.remove('is-done');
    fcOvOk.hidden = true;
    fcOvAnswer.hidden = true;
    renderAll();
    fcUpdateUndo();
    fcTip.textContent = '先选一种颜色，再点任意一块上色';
    fcTip.classList.remove('is-warn');
  }

  function fcReset() {
    if (!fcHasProgress()) { fcReallyReset(); return; }
    fcAsk('重来这一局？', '所有颜色都会清空，重新来过。', '重来', fcReallyReset);
  }

  function fcUndoStep() {
    if (!fcUndo.length) return;
    const { idx, prev } = fcUndo.pop();
    fcColor[idx] = prev;
    renderCell(idx);
    afterChange();
    fcUpdateUndo();
  }

  function fcNewSame() {
    const go = () => fcNewRound(fcTier);
    if (fcHasProgress() && !fcOver) fcAsk('换一题？', '当前进度会清空，换一张新图。', '换一题', go);
    else go();
  }

  function fcToSetup() {
    const go = () => { fcGame.hidden = true; fcSetup.hidden = false; };
    if (fcHasProgress() && !fcOver) fcAsk('重选难度？', '当前进度会清空，回到选难度。', '重选难度', go);
    else go();
  }

  function fcGiveUp() {
    fcAsk('放弃这一局？', '', '放弃', () => {
      fcOver = true;
      fcGaveUp = true;
      fcAnsMode = false;
      fcGame.classList.add('is-done');
      fcOvTitle.textContent = '已放弃这一局';
      fcOvText.textContent = '可以看答案，也可以直接换一题。';
      fcOvOk.hidden = true;
      fcOvAnswer.hidden = false;
      fcOverlay.classList.add('show');
      fcTip.textContent = '已放弃 · 可看答案或换一题';
      fcTip.classList.remove('is-warn');
    });
  }

  function fcWin() {
    fcOver = true;
    fcAnsMode = false;
    fcGame.classList.add('is-done');
    fcOvTitle.textContent = '过关！';
    fcOvText.textContent = '全部填完，且没有两块同色相邻。';
    fcOvOk.hidden = false;
    fcOvAnswer.hidden = true;
    fcOverlay.classList.add('show');
    fcTip.textContent = '这是你填出来的答案 · 盘面已锁定，可换一题或重选难度';
  }

  function fcEnterAnswer() {
    fcOverlay.classList.remove('show');
    const sol = solve4();
    fcColor = sol.slice();
    fcOver = true;
    fcAnsMode = true;
    fcGaveUp = false;
    fcGame.classList.add('is-done');
    renderAll();
    fcTip.textContent = '这是参考答案 · 盘面已锁定，可换一题或重选难度';
  }

  /* 通用二次确认（复用 base.css 的 .confirm-overlay） */
  function fcAsk(title, text, okText, onOk) {
    fcAskTitle.textContent = title;
    fcAskText.textContent = text;
    fcAskOk.textContent = okText;
    fcAskConfirm.classList.add('show');
    fcAskOk.onclick = () => { fcAskConfirm.classList.remove('show'); onOk(); };
  }

  /* ==========================================================================
     五、事件绑定
     ========================================================================== */
  $$('#fcTiers .fc-tier', fcSetup).forEach(b => b.addEventListener('click', () => {
    $$('#fcTiers .fc-tier', fcSetup).forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    fcTier = FC_TIERS.find(t => t.key === b.dataset.tier);
  }));

  $$('.fc-swatch', fcPalette).forEach(b =>
    b.addEventListener('click', () => { fcSel = +b.dataset.color; syncPalette(); }));
  fcErase.addEventListener('click', () => { fcSel = -1; syncPalette(); });

  fcStart.addEventListener('click', () => fcNewRound(fcTier));
  fcUndoEl.addEventListener('click', fcUndoStep);
  fcResetEl.addEventListener('click', fcReset);
  fcNewEl.addEventListener('click', fcNewSame);
  fcRechooseEl.addEventListener('click', fcToSetup);
  fcGiveUpEl.addEventListener('click', fcGiveUp);

  fcOvOk.addEventListener('click', () => fcOverlay.classList.remove('show'));
  fcOvAnswer.addEventListener('click', fcEnterAnswer);
  fcOvNew.addEventListener('click', () => { fcOverlay.classList.remove('show'); fcNewRound(fcTier); });
  fcOvBack.addEventListener('click', () => { fcOverlay.classList.remove('show'); fcGame.hidden = true; fcSetup.hidden = false; });

  fcAskCancel.addEventListener('click', () => fcAskConfirm.classList.remove('show'));

  /* 进卡片时，若还在选档那一步，把高亮补到当前难度上 */
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== FC) return;
    if (fcGame.hidden) {
      $$('#fcTiers .fc-tier', fcSetup).forEach(b =>
        b.classList.toggle('on', b.dataset.tier === fcTier.key));
    }
  });

})();
