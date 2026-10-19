/* ==========================================================================
   queen.js —— 功能页：互不相犯（N 皇后）

   玩法：在 N×N 的棋盘上摆 N 枚皇后，任意两枚都不同行、不同列、不同斜线。

   ★ 出题：先用随机回溯摆出一组完整解（5/6/8/10 都有解），
     再从中挑几枚作为「预设」（深灰、不能移动），玩家补齐剩下的。
     预设本身来自一组真解，所以题目一定有解；但玩家的摆法不必和它对上 ——
     只要摆满 N 枚且互不攻击就算过（多解容错，8×8 有 92 组解）。

   ★ 辅助：
     · 每放一枚，它横竖斜吃到的格子染浅红；两枚互相攻击 → 皇后变红
     · 每次落子后跑一遍「还能不能补完」的求解器，补不完就提示"已经无解"
       （只提示、不拦手，撤销能退回去）

   纯本地、无后端；样式走 css/tools.css 的 .qn-*（结构对齐点阵连线 .sl-*）。
   ========================================================================== */

(function () {
  'use strict';
  const page = $('#toolQueen');
  if (!page) return;                       // 守卫：页面不存在就不初始化

  /* ---------- 常量 ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const CELL = 56;                         // 单元格边长（viewBox 单位）
  const PAD = 14;                          // 棋盘外边距
  const GIVENS = { 5: 1, 6: 1, 8: 2, 10: 3 };   // 各尺寸开局预设几枚

  /* ---------- DOM ---------- */
  const qnSvg = $('#qnSvg');
  const qnSizes = $('#qnSizes');
  const qnStart = $('#qnStart');
  const qnRound = $('#qnRound');
  const qnMeta = $('#qnMeta');
  const qnTime = $('#qnTime');
  const qnCount = $('#qnCount');
  const qnTip = $('#qnTip');
  const qnUndo = $('#qnUndo');
  const qnReset = $('#qnReset');
  const qnAgain = $('#qnAgain');
  const qnBack = $('#qnBack');
  const qnGiveUp = $('#qnGiveUp');
  const qnGame = $('#qnGame');
  const qnSetup = $('#qnSetup');
  const qnOverlay = $('#qnOverlay');
  const qnOvTitle = $('#qnOvTitle');
  const qnOvText = $('#qnOvText');
  const qnOvOk = $('#qnOvOk');
  const qnOvAgain = $('#qnOvAgain');
  const qnOvBack = $('#qnOvBack');
  const qnOvAnswer = $('#qnOvAnswer');
  const qnAskConfirm = $('#qnAskConfirm');
  const qnAskTitle = $('#qnAskTitle');
  const qnAskText = $('#qnAskText');
  const qnAskOk = $('#qnAskOk');
  const qnAskCancel = $('#qnAskCancel');

  /* ---------- 状态 ---------- */
  let N = 8;
  let selSize = 8;
  let fixed = new Set();         // 预设皇后：r*N+c
  let mine = new Set();          // 自己摆的皇后：r*N+c
  let solution = [];             // 出一题时的那组解：solution[行] = 列
  let undoStack = [];
  let steps = 0;
  let over = false;
  let answerMode = false;
  let gaveUp = false;
  let round = 0;

  /* ---------- 计时 ---------- */
  let qnTimer = null, qnStartT = 0, qnAccum = 0, qnPaused = false;
  function qnStartClock() {
    qnStartT = Date.now(); qnAccum = 0; qnPaused = false;
    if (qnTimer) clearInterval(qnTimer);
    qnTimer = setInterval(qnTick, 500);
    qnTime.textContent = '0:00';
  }
  function qnTick() {
    if (qnPaused) return;
    const s = Math.floor((qnAccum + (Date.now() - qnStartT)) / 1000);
    qnTime.textContent = qnFmt(s);
  }
  function qnPause() { if (qnPaused) return; qnAccum += Date.now() - qnStartT; qnPaused = true; }
  function qnResume() { if (!qnPaused) return; qnStartT = Date.now(); qnPaused = false; }
  function qnSyncPause() { if (document.hidden) qnPause(); else qnResume(); }
  function qnFmt(s) { const m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); }

  /* ---------- 小工具 ---------- */
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function queenList() {
    const arr = [];
    for (const k of fixed) arr.push({ r: Math.floor(k / N), c: k % N, fixed: true });
    for (const k of mine) arr.push({ r: Math.floor(k / N), c: k % N, fixed: false });
    return arr;
  }

  /* ---------- 攻击格 / 冲突皇后 ----------
     一次算清：被任何皇后吃到的格子（含皇后自己那格），
     以及正被别的皇后攻击的皇后（这些画成红色）。 */
  function analyze() {
    const qs = queenList();
    const n = N;
    const attack = new Uint8Array(n * n);
    const bad = new Set();
    for (const q of qs) {
      for (let i = 0; i < n; i++) { attack[q.r * n + i] = 1; attack[i * n + q.c] = 1; }
      for (let d = -n; d <= n; d++) {
        const r1 = q.r + d, c1 = q.c + d;
        if (r1 >= 0 && r1 < n && c1 >= 0 && c1 < n) attack[r1 * n + c1] = 1;
        const r2 = q.r + d, c2 = q.c - d;
        if (r2 >= 0 && r2 < n && c2 >= 0 && c2 < n) attack[r2 * n + c2] = 1;
      }
    }
    for (let i = 0; i < qs.length; i++) {
      for (let j = i + 1; j < qs.length; j++) {
        const a = qs[i], b = qs[j];
        if (a.r === b.r || a.c === b.c || Math.abs(a.r - b.r) === Math.abs(a.c - b.c)) {
          bad.add(a.r * n + a.c);
          bad.add(b.r * n + b.c);
        }
      }
    }
    return { qs, attack, bad };
  }

  /* ---------- 求解：现在的摆法还能不能补完 ----------
     一行只能有一枚皇后，所以 N 枚皇后 = 每行恰好一枚。
     把已有的按行钉住，空行逐行回溯。n ≤ 10，瞬间出结果。 */
  function solvable() {
    const n = N;
    const rowC = new Array(n).fill(-1);
    for (const q of queenList()) {
      if (rowC[q.r] !== -1) return false;         // 同一行摆了两枚，必无解
      rowC[q.r] = q.c;
    }
    const used = new Array(n).fill(false);
    const d1 = new Array(n * 2).fill(false);
    const d2 = new Array(n * 2 + 1).fill(false);
    for (let r = 0; r < n; r++) {
      if (rowC[r] < 0) continue;
      const c = rowC[r];
      if (used[c] || d1[r + c] || d2[r - c + n]) return false;
      used[c] = d1[r + c] = d2[r - c + n] = true;
    }
    function go(r) {
      if (r === n) return true;
      if (rowC[r] >= 0) return go(r + 1);
      for (let c = 0; c < n; c++) {
        if (used[c] || d1[r + c] || d2[r - c + n]) continue;
        used[c] = d1[r + c] = d2[r - c + n] = true;
        if (go(r + 1)) return true;
        used[c] = d1[r + c] = d2[r - c + n] = false;
      }
      return false;
    }
    return go(0);
  }

  /* ---------- 出题：随机回溯拿一组解 + 随机挑几枚当预设 ---------- */
  function randomSolution(n) {
    const cols = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    const d1 = new Array(n * 2).fill(false);
    const d2 = new Array(n * 2 + 1).fill(false);
    function go(r) {
      if (r === n) return true;
      const order = [];
      for (let i = 0; i < n; i++) order.push(i);
      for (let i = n - 1; i > 0; i--) {          // 洗牌：每次开局解法不同
        const j = Math.floor(Math.random() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      for (const c of order) {
        if (used[c] || d1[r + c] || d2[r - c + n]) continue;
        cols[r] = c;
        used[c] = d1[r + c] = d2[r - c + n] = true;
        if (go(r + 1)) return true;
        used[c] = d1[r + c] = d2[r - c + n] = false;
        cols[r] = -1;
      }
      return false;
    }
    go(0);
    return cols;
  }
  function pickGivens(size, sol) {
    const rows = [];
    for (let r = 0; r < size; r++) rows.push(r);
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
    }
    const k = Math.min(GIVENS[size] || 1, size - 1);
    const set = new Set();
    for (let i = 0; i < k; i++) set.add(rows[i] * size + sol[rows[i]]);
    return set;
  }

  /* ---------- 画一枚皇后 ----------
     24×24 的冠形：五个尖（三点带圆珠）+ 底座。
     整组用 transform 缩到格子里，fill 由 .qn-q 那几条 CSS 决定。 */
  function queenNode(r, c, isFixed, isBad) {
    const k = (CELL * 0.84) / 24;
    const cx = PAD + (c + 0.5) * CELL;
    const cy = PAD + (r + 0.5) * CELL;
    const g = svgEl('g', {
      class: 'qn-q' + (isFixed ? ' is-fixed' : '') + (isBad ? ' is-bad' : ''),
      transform: 'translate(' + (cx - 12 * k) + ' ' + (cy - 12.6 * k) + ') scale(' + k + ')',
    });
    g.dataset.cell = r + ':' + c;
    g.appendChild(svgEl('path', {
      d: 'M6.6 17.8 L6.95 9.4 L9.55 11.8 L12 6.1 L14.45 11.8 L17.05 9.4 L17.4 17.8 Z',
    }));
    g.appendChild(svgEl('rect', { x: 5.9, y: 18.6, width: 12.2, height: 2.7, rx: 1.35 }));
    g.appendChild(svgEl('circle', { cx: 6.95, cy: 8.2, r: 1.05 }));
    g.appendChild(svgEl('circle', { cx: 12, cy: 4.9, r: 1.15 }));
    g.appendChild(svgEl('circle', { cx: 17.05, cy: 8.2, r: 1.05 }));
    return g;
  }

  /* ---------- 提示语 ---------- */
  function tipState(info) {
    if (over) {
      if (answerMode) return { text: '这是一组标准答案 · 棋盘已锁，点「换一题」或「改尺寸」继续', warn: false };
      if (gaveUp) return { text: '这一局已经放弃 · 点「换一题」或「改尺寸」继续', warn: false };
      return { text: '这是你解出来的摆法 · 棋盘已锁，点「换一题」或「改尺寸」继续', warn: false };
    }
    if (info.bad.size) {
      return { text: '有 ' + info.bad.size + ' 枚皇后正互相攻击（红色）', warn: true };
    }
    if (!info.qs.length) return { text: '点一个空格，放下第一枚皇后', warn: false };
    if (info.qs.length < N) {
      if (!solvable()) return { text: '这样摆下去已经补不完了 · 撤销几步再试', warn: true };
      return { text: '已放 ' + info.qs.length + ' / ' + N + ' 枚 · 还差 ' + (N - info.qs.length) + ' 枚', warn: false };
    }
    return { text: '', warn: false };
  }

  /* ---------- 渲染 ---------- */
  function qnRender() {
    const side = N * CELL + PAD * 2;
    qnSvg.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
    while (qnSvg.firstChild) qnSvg.removeChild(qnSvg.firstChild);

    const info = analyze();
    const occupied = new Set(info.qs.map(q => q.r * N + q.c));
    const gBg = svgEl('g'), gAtk = svgEl('g'), gFix = svgEl('g'),
          gQ = svgEl('g'), gHit = svgEl('g');

    // 棋盘底 + 深浅格
    gBg.appendChild(svgEl('rect', { class: 'qn-bg', x: 0, y: 0, width: side, height: side }));
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if ((r + c) % 2 === 0) continue;
        gBg.appendChild(svgEl('rect', {
          class: 'qn-dark',
          x: PAD + c * CELL, y: PAD + r * CELL, width: CELL, height: CELL,
        }));
      }
    }

    // 受攻格（皇后自己那格不染，皇后图形盖着）。
    // 过关 / 看答案后不再铺浅红，成品盘面干净些；放弃未看答案时保留，方便复盘。
    const showAttack = !(over && !gaveUp);
    if (showAttack) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const k = r * N + c;
          if (!info.attack[k] || occupied.has(k)) continue;
          gAtk.appendChild(svgEl('rect', {
            class: 'qn-attack',
            x: PAD + c * CELL, y: PAD + r * CELL, width: CELL, height: CELL,
          }));
        }
      }
    }

    // 预设皇后的浅灰方片（"这枚动不了"）
    for (const k of fixed) {
      const r = Math.floor(k / N), c = k % N;
      gFix.appendChild(svgEl('rect', {
        class: 'qn-fixed-cell',
        x: PAD + c * CELL + 7, y: PAD + r * CELL + 7,
        width: CELL - 14, height: CELL - 14, rx: 9,
      }));
    }

    // 皇后
    info.qs.forEach(q => {
      gQ.appendChild(queenNode(q.r, q.c, q.fixed, info.bad.has(q.r * N + q.c)));
    });

    // 点击热区（铺满整格，压在最上面）
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const hit = svgEl('rect', {
          class: 'qn-hit',
          x: PAD + c * CELL, y: PAD + r * CELL, width: CELL, height: CELL,
        });
        hit.dataset.cell = r + ':' + c;
        gHit.appendChild(hit);
      }
    }

    qnSvg.appendChild(gBg);
    qnSvg.appendChild(gAtk);
    qnSvg.appendChild(gFix);
    qnSvg.appendChild(gQ);
    qnSvg.appendChild(gHit);

    // HUD + 提示
    qnCount.textContent = info.qs.length + ' / ' + N;
    qnUndo.disabled = !undoStack.length;
    const t = tipState(info);
    qnTip.textContent = t.text;
    qnTip.classList.toggle('is-warn', t.warn);
  }

  /* ---------- 落子判定 ---------- */
  function qnWinCheck() {
    if (over) return;
    const info = analyze();
    if (info.qs.length !== N || info.bad.size) return;
    over = true; answerMode = false; gaveUp = false;
    qnGame.classList.add('is-done');
    qnRender();
    qnOvTitle.textContent = '过关！';
    qnOvText.textContent = N + ' × ' + N + ' · 用时 ' + qnTime.textContent + ' · ' + steps + ' 步';
    qnOvOk.hidden = false;
    qnOvAnswer.hidden = true;
    qnOverlay.classList.add('show');
    qnPause();
  }

  /* ---------- 过关 / 放弃 / 看答案 ---------- */
  function qnSolvedView() {
    qnOverlay.classList.remove('show');
    qnGame.classList.add('is-done');
    qnRender();
  }
  function qnDoGiveUp() {
    over = true; answerMode = false; gaveUp = true;
    qnGame.classList.add('is-done');
    qnRender();
    qnOvTitle.textContent = '已放弃这一局';
    qnOvText.textContent = '可以看一组答案，也可以直接换一局。';
    qnOvOk.hidden = true;
    qnOvAnswer.hidden = false;
    qnOverlay.classList.add('show');
    qnPause();
  }
  function qnAnswerView() {
    qnOverlay.classList.remove('show');
    mine = new Set();
    for (let r = 0; r < N; r++) {
      const k = r * N + solution[r];
      if (!fixed.has(k)) mine.add(k);
    }
    over = true; answerMode = true; gaveUp = false;
    qnGame.classList.add('is-done');
    qnRender();
  }
  /* 给 backnav 用：物理返回键 / 顶栏返回箭头关浮层时，别把棋盘丢在半锁状态 */
  window.qnDismissOverlay = function () {
    if (!qnOverlay.classList.contains('show')) return;
    if (gaveUp) qnAnswerView();      // 放弃后浮层关掉 = 直接看答案（没别的路可走）
    else qnSolvedView();
  };

  /* ---------- 撤销 / 重开 / 换题 / 改尺寸 ---------- */
  function pushUndo() {
    undoStack.push({ mine: [...mine], steps: steps });
    if (undoStack.length > 200) undoStack.shift();
  }
  function qnUndoStep() {
    if (!undoStack.length) return;
    const s = undoStack.pop();
    mine = new Set(s.mine);
    steps = s.steps;
    over = false; answerMode = false; gaveUp = false;
    qnOverlay.classList.remove('show');
    qnGame.classList.remove('is-done');
    qnRender();
  }
  function qnResetAll() {
    mine.clear();
    steps = 0; over = false; answerMode = false; gaveUp = false;
    qnOverlay.classList.remove('show');
    qnGame.classList.remove('is-done');
    qnRender();
    qnStartClock();
  }
  function qnNewRound(size) {
    N = size;
    solution = randomSolution(size);
    fixed = pickGivens(size, solution);
    mine = new Set();
    undoStack = [];
    steps = 0; over = false; answerMode = false; gaveUp = false;
    round++;
    qnRound.textContent = '第 ' + round + ' 局';
    qnMeta.textContent = size + ' × ' + size;
    qnSetup.hidden = true;
    qnGame.hidden = false;
    qnGame.classList.remove('is-done');
    qnOverlay.classList.remove('show');
    qnRender();
    qnStartClock();
  }
  function qnToSetup() {
    qnGame.hidden = true;
    qnSetup.hidden = false;
    qnGame.classList.remove('is-done');
    over = false; answerMode = false; gaveUp = false;
    if (qnTimer) clearInterval(qnTimer);
  }

  /* ---------- 二次确认 ---------- */
  const QN_ASK = {
    reset: { title: '重开这一局？', text: '自己摆的皇后全部清空，预设的几枚留着，计时重新开始。', ok: '重开', run: qnResetAll },
    again: { title: '换一题？', text: '当前这一局作废，重新开一盘（预设位置会变）。', ok: '换一题', run: () => qnNewRound(N) },
    size:  { title: '改尺寸？', text: '当前这一局作废，回到选棋盘。', ok: '改尺寸', run: qnToSetup },
    give:  { title: '放弃这一局？', text: '可以看一组标准答案，或直接换一局。', ok: '放弃', run: qnDoGiveUp },
  };
  let qnAskKind = null;
  function qnAskOpen(kind) {
    /* 这一局已经收尾（过关 / 放弃 / 看答案）→ 换一题 / 改尺寸没什么可丢的，直接走。
       只有还在下的时候才值得问一句。 */
    if (over && (kind === 'again' || kind === 'size')) { QN_ASK[kind].run(); return; }
    if (kind === 'reset' && !mine.size) {
      flashTip('还没落子，不用重开。');
      return;
    }
    qnAskKind = kind;
    const cfg = QN_ASK[kind];
    qnAskTitle.textContent = cfg.title;
    qnAskText.textContent = cfg.text;
    qnAskOk.textContent = cfg.ok;
    qnAskConfirm.classList.add('show');
  }
  function qnCloseConfirm() {
    qnAskConfirm.classList.remove('show');
    qnAskKind = null;
  }
  function flashTip(msg) {
    qnTip.textContent = msg;
    qnTip.classList.add('is-warn');
  }

  /* ---------- 事件 ---------- */
  function paintSizeButtons() {
    [...qnSizes.children].forEach(x => x.classList.toggle('on', +x.dataset.size === selSize));
  }

  qnSizes.addEventListener('click', e => {
    const b = e.target.closest('.qn-size');
    if (!b) return;
    selSize = +b.dataset.size;
    paintSizeButtons();
  });
  qnStart.addEventListener('click', () => qnNewRound(selSize));
  qnUndo.addEventListener('click', qnUndoStep);
  qnReset.addEventListener('click', () => qnAskOpen('reset'));
  qnAgain.addEventListener('click', () => qnAskOpen('again'));
  qnBack.addEventListener('click', () => qnAskOpen('size'));
  qnGiveUp.addEventListener('click', () => qnAskOpen('give'));

  qnSvg.addEventListener('click', e => {
    if (over) return;
    const hit = e.target.closest ? e.target.closest('[data-cell]') : null;
    if (!hit) return;
    const parts = hit.dataset.cell.split(':');
    const r = +parts[0], c = +parts[1];
    const k = r * N + c;
    if (fixed.has(k)) { flashTip('这枚是开局预设的，不能移动。'); return; }
    pushUndo();
    if (mine.has(k)) mine.delete(k); else mine.add(k);
    steps++;
    qnRender();
    qnWinCheck();
  });

  qnOvOk.addEventListener('click', qnSolvedView);
  qnOvAgain.addEventListener('click', () => qnNewRound(N));
  qnOvBack.addEventListener('click', qnToSetup);
  qnOvAnswer.addEventListener('click', qnAnswerView);

  qnAskOk.addEventListener('click', () => {
    const k = qnAskKind;
    qnCloseConfirm();
    if (k && QN_ASK[k]) QN_ASK[k].run();
  });
  qnAskCancel.addEventListener('click', qnCloseConfirm);
  qnAskConfirm.addEventListener('click', e => { if (e.target === qnAskConfirm) qnCloseConfirm(); });

  document.addEventListener('visibilitychange', qnSyncPause);
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== 'toolQueen') return;
    paintSizeButtons();
    qnSyncPause();
  });

  /* 顶栏返回箭头 / Esc：浮层开着就先关浮层（和物理返回键一个口径），
     别一下把整个功能页关掉。 */
  if (typeof NovaBack !== 'undefined' && NovaBack.inner) {
    NovaBack.inner(top => {
      if (top !== page) return false;
      if (!qnOverlay.classList.contains('show')) return false;
      window.qnDismissOverlay();
      return true;
    });
  }

  paintSizeButtons();
})();
