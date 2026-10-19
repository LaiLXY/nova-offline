/* ==========================================================================
   sl.js —— 功能页：点阵连线（玩法 = 数回 / Slitherlink，单一自闭环）

   玩法：方格网上部分格子标数字 0–3。沿格线画一条**单一自闭环**
   （不自交、不中断），每个数字格恰好有「该数字条边」属于这条环。

   ★ 出题：先造答案，再反推题目（和数桥一个路子）
       1. 在 (N+1)×(N+1) 格点图上随机回溯游走，生成一条**简单闭合环**
          （每步走相邻未访问格点，走到起点且长度够就闭合；带步数预算防搜索爆炸）
       2. 把环经过的每条边标记为 1（线）
       3. 对每个格子数它四条边里有几条是线，作为该格的数字
          —— 这样盘面天然有解（生成的那条环就是解），且数字只可能是 0/1/2/3
       4. 难度 = 网格尺寸（5×5 / 7×7 / 10×10）

   ★ 交互：点一条边在 空 / 线 / 叉 之间循环切换
          · 线 = 环经过这里
          · 叉 = 确定不经过（推理辅助）
          · 空 = 还没定
       数字格实时显示「已画的边数 vs 应画边数」：刚好够变绿、超了变红、
       差太多又没空边可加变黄。

   ★ 过关判定（充要，自带多解容错）：
       1) 所有数字格：已画线边数 == 其数字
       2) 所有顶点度数 ∈ {0, 2}（无悬空端点、无分叉）
       3) 所有度数=2 的顶点连成**单一**连通分量（不是两个分离的小环）
       只要满足这三条就算过 —— 玩家用任意一种合法单一环解都认。

   纯本地、无后端；样式走 css/tools.css 的 .sl-*（对齐数桥 .br-*）。
   ========================================================================== */

(function () {
  'use strict';
  const page = $('#toolSl');
  if (!page) return;                       // 守卫：页面不存在就不初始化

  /* ---------- 常量 ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const UNIT = 56;                         // 单元格间距（viewBox 单位）
  const PAD = 30;                          // 外边距
  const CELL = UNIT * 0.6;                // 数字格背景边长

  /* ---------- DOM ---------- */
  const slSvg = $('#slSvg');
  const slSizesEl = $('#slSizes');
  const slStartBtn = $('#slStart');
  const slRoundEl = $('#slRound');
  const slMetaEl = $('#slMeta');
  const slUndoBtn = $('#slUndo');
  const slResetBtn = $('#slReset');
  const slAgainBtn = $('#slAgain');
  const slBackBtn = $('#slBack');
  const slGiveBtn = $('#slGiveUp');
  const slTimeEl = $('#slTime');
  const slStepsEl = $('#slSteps');
  const slTipEl = $('#slTip');
  const slGame = $('#slGame');
  const slSetup = $('#slSetup');
  const slOverlay = $('#slOverlay');
  const slOvTitle = $('#slOvTitle');
  const slOvText = $('#slOvText');
  const slOvOk = $('#slOvOk');
  const slOvAgain = $('#slOvAgain');
  const slOvBack = $('#slOvBack');
  const slOvAnswer = $('#slOvAnswer');
  const slAskConfirm = $('#slAskConfirm');
  const slAskTitle = $('#slAskTitle');
  const slAskText = $('#slAskText');
  const slAskOk = $('#slAskOk');
  const slAskCancel = $('#slAskCancel');

  /* ---------- 状态 ---------- */
  let N = 5;
  let selSize = 5;
  let H = [], V = [];                      // 边状态：0 空 / 1 线 / 2 叉
  let num = [];                            // 数字格：0..3 或 null（不显示）
  let solH = [], solV = [];                // 生成时的解（线集合），用于"查看答案"
  let cellStates = [];                     // 渲染时缓存每格状态，供提示语用
  let undoStack = [];
  let steps = 0;
  let over = false;
  let answerMode = false;
  let gaveUp = false;
  let round = 0;

  /* ---------- 计时 ---------- */
  let slTimer = null, slStartT = 0, slAccum = 0, slPaused = false;
  function slStartClock() {
    slStartT = Date.now(); slAccum = 0; slPaused = false;
    if (slTimer) clearInterval(slTimer);
    slTimer = setInterval(slTick, 500);
    slTimeEl.textContent = '0:00';
  }
  function slTick() {
    if (slPaused) return;
    const s = Math.floor((slAccum + (Date.now() - slStartT)) / 1000);
    slTimeEl.textContent = fmtTime(s);
  }
  function slPause() { if (slPaused) return; slAccum += Date.now() - slStartT; slPaused = true; }
  function slResume() { if (!slPaused) return; slStartT = Date.now(); slPaused = false; }
  function slSyncPause() { if (document.hidden) slPause(); else slResume(); }
  function fmtTime(s) { const m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); }

  /* ---------- 小工具 ---------- */
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function clone2(a) { return a.map(row => row.slice()); }

  /* ---------- 生成：随机游走 + 消环（LERW），造一条简单闭合环 ----------
     走过的路径始终是「简单路径」：一旦走到已走过的格点，就把成环那段抹掉
     （loop erase）。长度够了才允许回到起点闭合，因此能出蜿蜒的长环，
     而不是一圈小方框。 */
  function genLoopPath(n, minLen) {
    const W = n + 1, total = W * W;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const maxSteps = total * 80;
    for (let attempt = 0; attempt < 60; attempt++) {
      const start = Math.floor(Math.random() * total);
      const path = [start];
      const at = new Map([[start, 0]]);
      let cur = start;
      for (let s = 0; s < maxSteps; s++) {
        const r = Math.floor(cur / W), c = cur % W;
        const nb = [];
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= W || nc < 0 || nc >= W) continue;
          nb.push(nr * W + nc);
        }
        // 长度不够时不许回起点，逼着往外长；够长了再挑没走过的格点优先
        const fresh = [];
        for (const v of nb) {
          if (v === start) { if (path.length >= minLen) fresh.push(v); }
          else if (!at.has(v)) fresh.push(v);
        }
        const pool = (fresh.length && Math.random() < 0.85) ? fresh : nb;
        const next = pool[Math.floor(Math.random() * pool.length)];
        if (next === start && path.length >= minLen) return path;   // 闭合成简单环
        const k = at.get(next);
        if (k !== undefined) {                    // 消环：回退到 next
          for (let i = k + 1; i < path.length; i++) at.delete(path[i]);
          path.length = k + 1;
          cur = next;
        } else {
          at.set(next, path.length);
          path.push(next);
          cur = next;
        }
      }
    }
    return null;
  }
  function pathToEdges(path, n) {
    const W = n + 1, edges = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const ar = Math.floor(a / W), ac = a % W, br = Math.floor(b / W), bc = b % W;
      if (ar === br) edges.push({ t: 'h', r: ar, c: Math.min(ac, bc) });
      else edges.push({ t: 'v', r: Math.min(ar, br), c: ac });
    }
    return edges;
  }
  /* 某格四条边里有几条线（格子口径，不是格点度数） */
  function cellCountFrom(Hg, Vg, r, c) {
    let k = 0;
    if (Hg[r][c]) k++;          // 上
    if (Hg[r + 1][c]) k++;      // 下
    if (Vg[r][c]) k++;          // 左
    if (Vg[r][c + 1]) k++;      // 右
    return k;
  }
  function genPuzzle(size) {
    const want = Math.max(12, Math.round((size + 1) * (size + 1) * 0.62));   // 目标环长（格点数）
    let path = null;
    for (let k = 0; k < 12 && !path; k++) path = genLoopPath(size, want);
    for (let k = 0; k < 12 && !path; k++) path = genLoopPath(size, Math.max(8, Math.round(want * 0.6)));
    if (!path) path = genLoopPath(size, 4);

    // 解：线集合
    const Hh = []; for (let r = 0; r <= size; r++) Hh.push(new Array(size).fill(0));
    const Vv = []; for (let r = 0; r < size; r++) Vv.push(new Array(size + 1).fill(0));
    for (const e of pathToEdges(path, size)) {
      if (e.t === 'h') Hh[e.r][e.c] = 1; else Vv[e.r][e.c] = 1;
    }

    // 每个格子的正确数字（四边里几条是线）
    const counts = [];
    for (let r = 0; r < size; r++) {
      counts.push([]);
      for (let c = 0; c < size; c++) counts[r].push(cellCountFrom(Hh, Vv, r, c));
    }

    // 只亮出一部分数字（真实数回也是这样）：3 一定亮，0 很少亮
    const prob = k => (k === 3 ? 0.85 : k === 2 ? 0.5 : k === 1 ? 0.34 : 0.1);
    const num = [];
    let shown = 0;
    for (let r = 0; r < size; r++) {
      num.push([]);
      for (let c = 0; c < size; c++) {
        const k = counts[r][c];
        const show = Math.random() < prob(k);
        if (show) shown++;
        num[r].push(show ? k : null);
      }
    }
    // 保底：至少亮出约 0.36·size² 个数字，否则随机补
    const floor = Math.max(4, Math.round(size * size * 0.36));
    let guard = 0;
    while (shown < floor && guard++ < 500) {
      const r = Math.floor(Math.random() * size), c = Math.floor(Math.random() * size);
      if (num[r][c] == null) { num[r][c] = counts[r][c]; shown++; }
    }

    // 玩家盘面：全空
    const emptyH = []; for (let r = 0; r <= size; r++) emptyH.push(new Array(size).fill(0));
    const emptyV = []; for (let r = 0; r < size; r++) emptyV.push(new Array(size + 1).fill(0));

    return {
      size, H: emptyH, V: emptyV, num, counts,
      solH: clone2(Hh), solV: clone2(Vv),
      loopLen: path.length,
    };
  }

  /* ---------- 边 / 格 几何与查询 ---------- */
  function edgeGeom(type, r, c) {
    if (type === 'h') {
      return { x1: PAD + c * UNIT, y1: PAD + r * UNIT, x2: PAD + (c + 1) * UNIT, y2: PAD + r * UNIT };
    }
    return { x1: PAD + c * UNIT, y1: PAD + r * UNIT, x2: PAD + c * UNIT, y2: PAD + (r + 1) * UNIT };
  }
  function forEachEdge(cb) {
    for (let r = 0; r <= N; r++) for (let c = 0; c < N; c++) cb('h', r, c, H[r][c]);
    for (let r = 0; r < N; r++) for (let c = 0; c <= N; c++) cb('v', r, c, V[r][c]);
  }
  function getEdge(type, r, c) { return type === 'h' ? H[r][c] : V[r][c]; }
  function setEdge(type, r, c, v) { if (type === 'h') H[r][c] = v; else V[r][c] = v; }

  /* 格子四边：上 H[r][c] / 下 H[r+1][c] / 左 V[r][c] / 右 V[r][c+1] */
  function countLine(r, c) {
    let k = 0;
    if (H[r][c] === 1) k++;
    if (H[r + 1][c] === 1) k++;
    if (V[r][c] === 1) k++;
    if (V[r][c + 1] === 1) k++;
    return k;
  }
  function countDecided(r, c) {
    let k = 0;
    if (H[r][c]) k++;
    if (H[r + 1][c]) k++;
    if (V[r][c]) k++;
    if (V[r][c + 1]) k++;
    return k;
  }
  function cellState(r, c) {
    const n = num[r][c];
    if (n == null) return '';
    const line = countLine(r, c);
    if (line > n) return 'bad';
    // 0 格一开始就「满足」没有意义（一条边都还没判），要四条边都叉掉才算定下来；
    // 但过关 / 看答案时盘面已定，直接算满足
    if (n === 0) return (over || countDecided(r, c) === 4) ? 'ok' : '';
    if (line === n) return 'ok';
    if (countDecided(r, c) === 4 && line < n) return 'stuck';
    return '';
  }

  /* ---------- 单一环检测 ---------- */
  function degree(vr, vc) {
    let d = 0;
    if (vr > 0 && V[vr - 1][vc] === 1) d++; if (vr < N && V[vr][vc] === 1) d++;
    if (vc > 0 && H[vr][vc - 1] === 1) d++; if (vc < N && H[vr][vc] === 1) d++;
    return d;
  }
  function singleLoop() {
    const verts = [];
    for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) if (degree(r, c) === 2) verts.push(r * (N + 1) + c);
    if (!verts.length) return false;
    const seen = new Set([verts[0]]); const q = [verts[0]];
    while (q.length) {
      const v = q.shift(); const r = Math.floor(v / (N + 1)), c = v % (N + 1);
      const ns = [];
      if (r > 0 && V[r - 1][c] === 1) ns.push((r - 1) * (N + 1) + c);
      if (r < N && V[r][c] === 1) ns.push((r + 1) * (N + 1) + c);
      if (c > 0 && H[r][c - 1] === 1) ns.push(r * (N + 1) + c - 1);
      if (c < N && H[r][c] === 1) ns.push(r * (N + 1) + c + 1);
      for (const n of ns) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    for (const v of verts) if (!seen.has(v)) return false;
    return true;
  }

  /* ---------- 渲染 ---------- */
  function crossEl(p) {
    const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2, d = 9;
    const g = svgEl('g');
    g.appendChild(svgEl('line', { class: 'sl-cross', x1: mx - d, y1: my - d, x2: mx + d, y2: my + d }));
    g.appendChild(svgEl('line', { class: 'sl-cross', x1: mx - d, y1: my + d, x2: mx + d, y2: my - d }));
    return g;
  }
  function slRender() {
    const side = N * UNIT + PAD * 2;
    slSvg.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
    while (slSvg.firstChild) slSvg.removeChild(slSvg.firstChild);

    const gHints = svgEl('g'), gDots = svgEl('g'), gCells = svgEl('g'),
          gLines = svgEl('g'), gCross = svgEl('g'), gHits = svgEl('g');

    // 边：引导线 / 实线 / 叉 + 透明点击热区
    forEachEdge((type, r, c, st) => {
      const p = edgeGeom(type, r, c);
      if (st === 1) {
        gLines.appendChild(svgEl('line', { class: 'sl-line', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 }));
      } else if (st === 2) {
        gCross.appendChild(crossEl(p));
      } else {
        gHints.appendChild(svgEl('line', { class: 'sl-hint', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 }));
      }
      const hit = svgEl('line', { class: 'sl-hit', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 });
      hit.dataset.edge = type + ':' + r + ':' + c;
      gHits.appendChild(hit);
    });

    // 数字格背景 + 数字
    cellStates = [];
    const half = CELL / 2;
    for (let r = 0; r < N; r++) {
      cellStates.push([]);
      for (let c = 0; c < N; c++) {
        const st = cellState(r, c);
        cellStates[r].push(st);
        if (num[r][c] != null) {
          const cx = PAD + (c + 0.5) * UNIT, cy = PAD + (r + 0.5) * UNIT;
          gCells.appendChild(svgEl('rect', {
            class: 'sl-cell' + (st ? ' is-' + st : ''),
            x: cx - half, y: cy - half, width: CELL, height: CELL, rx: 8,
          }));
          const t = svgEl('text', { class: 'sl-num' + (st ? ' is-' + st : ''), x: cx, y: cy });
          t.textContent = String(num[r][c]);
          gCells.appendChild(t);
        }
      }
    }

    // 顶点（格点）：半径随盘大小补偿，保证小盘上也有同样粗细的视觉大小
    const dotR = N <= 5 ? 3.8 : N <= 7 ? 4.2 : 4.6;
    for (let vr = 0; vr <= N; vr++) for (let vc = 0; vc <= N; vc++) {
      gDots.appendChild(svgEl('circle', { class: 'sl-dot', cx: PAD + vc * UNIT, cy: PAD + vr * UNIT, r: dotR }));
    }

    slSvg.appendChild(gHints);
    slSvg.appendChild(gDots);
    slSvg.appendChild(gCells);
    slSvg.appendChild(gLines);
    slSvg.appendChild(gCross);
    slSvg.appendChild(gHits);

    // HUD + 提示
    slStepsEl.textContent = String(steps);
    slUndoBtn.disabled = !undoStack.length;
    slTipEl.classList.remove('is-warn');
    slTipEl.textContent = slDefaultTip();
  }

  function slDefaultTip() {
    if (over) {
      if (answerMode) return '这是本局的标准答案 · 棋盘已锁，点「换一题」或「改尺寸」继续';
      if (gaveUp) return '这一局已经放弃 · 可以点「查看答案」看标准解，或者直接换一题';
      return '这是你解出来的答案 · 棋盘已锁，点「换一题」或「改尺寸」继续';
    }
    let bad = 0, stuck = 0, unsat = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (num[r][c] == null) continue;
      const st = cellStates[r] && cellStates[r][c];
      if (st === 'bad') bad++; else if (st === 'stuck') stuck++; else if (st === '') unsat++;
    }
    let s = '';
    if (bad) s += bad + ' 格边数超了';
    if (stuck) s += (s ? '，' : '') + stuck + ' 格卡死了';
    if (unsat) s += (s ? '，' : '') + unsat + ' 格还没满足';
    if (!s) s = '数字都满足了，把线连成一条单一闭环就过关';
    return s;
  }

  /* ---------- 过关 / 放弃 / 看答案 ---------- */
  function winCheck() {
    if (over) return;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (num[r][c] != null && countLine(r, c) !== num[r][c]) return;
    }
    for (let vr = 0; vr <= N; vr++) for (let vc = 0; vc <= N; vc++) {
      const d = degree(vr, vc); if (d !== 0 && d !== 2) return;
    }
    if (!singleLoop()) return;
    over = true; answerMode = false; gaveUp = false;
    slRender();
    slOvTitle.textContent = '过关！';
    slOvText.textContent = N + ' × ' + N + ' · 用时 ' + slTimeEl.textContent + ' · ' + steps + ' 步';
    slOvOk.hidden = false; slOvAnswer.hidden = true;
    slOverlay.classList.add('show');
    slPause();
  }
  function slGiveUp() {
    over = true; answerMode = false; gaveUp = true;
    slRender();
    slOvTitle.textContent = '已放弃这一局';
    slOvText.textContent = '可以看答案，也可以直接换一局。';
    slOvOk.hidden = true; slOvAnswer.hidden = false;
    slOverlay.classList.add('show');
    slPause();
  }
  function slEnterSolvedView() {
    slOverlay.classList.remove('show');
    slGame.classList.add('is-done');
    slRender();
  }
  function slEnterAnswerView() {
    slOverlay.classList.remove('show');
    H = clone2(solH); V = clone2(solV);
    over = true; answerMode = true; gaveUp = false;
    slGame.classList.add('is-done');
    slRender();
  }

  /* ---------- 撤销 / 重开 / 换题 / 改尺寸 ---------- */
  function pushUndo() {
    undoStack.push({ H: clone2(H), V: clone2(V), steps: steps });
    if (undoStack.length > 200) undoStack.shift();
  }
  function slUndoStep() {
    if (!undoStack.length) return;
    const s = undoStack.pop();
    H = s.H; V = s.V; steps = s.steps;
    over = false; answerMode = false; gaveUp = false;
    slOverlay.classList.remove('show');
    slGame.classList.remove('is-done');
    slRender();
  }
  function slResetAll() {
    H = H.map(a => a.map(() => 0)); V = V.map(a => a.map(() => 0));
    steps = 0; over = false; answerMode = false; gaveUp = false;
    slOverlay.classList.remove('show');
    slGame.classList.remove('is-done');
    slRender();
    slStartClock();                      // 重开 = 重新计时
  }
  function slNewRound(size) {
    N = size;
    const puz = genPuzzle(size);
    H = puz.H; V = puz.V; num = puz.num; solH = puz.solH; solV = puz.solV;
    undoStack = []; steps = 0; over = false; answerMode = false; gaveUp = false;
    round++;
    slRoundEl.textContent = '第 ' + round + ' 局';
    slMetaEl.textContent = size + ' × ' + size;
    slSetup.hidden = true; slGame.hidden = false;
    slGame.classList.remove('is-done');
    slOverlay.classList.remove('show');
    slRender();
    slStartClock();
  }
  function slToSetup() {
    slGame.hidden = true; slSetup.hidden = false;
    slGame.classList.remove('is-done');
    over = false; answerMode = false; gaveUp = false;
    if (slTimer) clearInterval(slTimer);
  }

  /* ---------- 二次确认 ---------- */
  const NL_ASK = {
    reset: { title: '重开这一局？', text: '画好的线全部清空，计时也重新开始。', ok: '重开', run: slResetAll },
    again: { title: '换一题？', text: '当前这一局作废，重新生成一道。', ok: '换一题', run: () => slNewRound(N) },
    size:  { title: '改尺寸？', text: '当前这一局作废，回到选尺寸。', ok: '改尺寸', run: slToSetup },
    give:  { title: '放弃这一局？', text: '可以看标准答案，或直接换一局。', ok: '放弃', run: slGiveUp },
  };
  let slAskKind = null;
  function slAskOpen(kind) {
    /* 这一局已经收尾（过关 / 放弃 / 看答案）→ 换一题 / 改尺寸没什么可丢的，直接走 */
    if (over && (kind === 'again' || kind === 'size')) { NL_ASK[kind].run(); return; }
    if (kind === 'reset') {
      let any = false;
      forEachEdge((t, r, c, st) => { if (st) any = true; });
      if (!any) { slTipEl.textContent = '盘面还是空的，没什么可重开的。'; return; }
    }
    slAskKind = kind;
    const cfg = NL_ASK[kind];
    slAskTitle.textContent = cfg.title;
    slAskText.textContent = cfg.text;
    slAskOk.textContent = cfg.ok;
    slAskConfirm.classList.add('show');
  }
  function slCloseConfirm() { slAskConfirm.classList.remove('show'); slAskKind = null; }

  /* ---------- 事件 ---------- */
  function slPaintSizeButtons() {
    [...slSizesEl.children].forEach(x => x.classList.toggle('on', +x.dataset.size === selSize));
  }

  slSizesEl.addEventListener('click', e => {
    const b = e.target.closest('.sl-size'); if (!b) return;
    selSize = +b.dataset.size;
    slPaintSizeButtons();
  });
  slStartBtn.addEventListener('click', () => slNewRound(selSize));
  slUndoBtn.addEventListener('click', slUndoStep);
  slResetBtn.addEventListener('click', () => slAskOpen('reset'));
  slAgainBtn.addEventListener('click', () => slAskOpen('again'));
  slBackBtn.addEventListener('click', () => slAskOpen('size'));
  slGiveBtn.addEventListener('click', () => slAskOpen('give'));

  slSvg.addEventListener('click', e => {
    if (over) return;
    const hit = e.target.closest ? e.target.closest('[data-edge]') : null;
    if (!hit) return;
    const parts = hit.dataset.edge.split(':');
    const type = parts[0], r = +parts[1], c = +parts[2];
    const cur = getEdge(type, r, c);
    const next = cur === 0 ? 1 : cur === 1 ? 2 : 0;   // 空 → 线 → 叉 → 空
    pushUndo();
    setEdge(type, r, c, next);
    steps++;
    slRender();
    winCheck();
  });

  slOvOk.addEventListener('click', slEnterSolvedView);
  slOvAgain.addEventListener('click', () => slNewRound(N));
  slOvBack.addEventListener('click', slToSetup);
  slOvAnswer.addEventListener('click', slEnterAnswerView);

  slAskOk.addEventListener('click', () => {
    const k = slAskKind; slCloseConfirm();
    if (k && NL_ASK[k]) NL_ASK[k].run();
  });
  slAskCancel.addEventListener('click', slCloseConfirm);
  slAskConfirm.addEventListener('click', e => { if (e.target === slAskConfirm) slCloseConfirm(); });

  document.addEventListener('visibilitychange', slSyncPause);
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== 'toolSl') return;
    slPaintSizeButtons();
    slSyncPause();
  });

  slPaintSizeButtons();
})();
