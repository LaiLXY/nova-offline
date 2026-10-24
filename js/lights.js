/* ==========================================================================
   lights.js —— 功能页：关灯游戏

   玩法：N×N 的盘面开局是一张乱盘（部分亮着）；点一个格子，它自己和
   上下左右四格一起翻转（亮的灭、灭的亮），把全部灯关掉就过关。

   ★ 出题：从全亮盘出发，随机按 K 下十字翻转 —— 翻转操作自反且可交换，
     所以题目必有解。出完再用 GF(2) 高斯消元解一遍，最少步数不达标的
     题重出，保证各档难度有下限。

   ★「看答案」不是摆一张标记图，是一串走法（照梵天汉诺的播放器成式）：
       · 从**当前盘面**现算余下最少步，逐格演示 —— 先高亮要按的格，
         再翻转十字，一步一停，看得清；
       · 可暂停 / 停止；停止就停在半路，顶栏留「演示答案」可以续播；
       · 演示不算玩家步数、不进撤销栈。

   纯本地、无后端；样式走 css/tools.css 的 .lt-*（结构对齐互不相犯 .qn-*）。
   ========================================================================== */

(function () {
  'use strict';
  const page = $('#toolLights');
  if (!page) return;                       // 守卫：页面不存在就不初始化

  /* ---------- 常量 ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const CELL = 56;                         // 单元格边长（viewBox 单位）
  const PAD = 14;                          // 盘面外边距
  const MIN_STEPS = { 4: 4, 5: 6, 6: 8, 7: 12 };   // 各尺寸最少步下限

  /* ---------- DOM ---------- */
  const ltSvg = $('#ltSvg');
  const ltSizes = $('#ltSizes');
  const ltStart = $('#ltStart');
  const ltRound = $('#ltRound');
  const ltMeta = $('#ltMeta');
  const ltTime = $('#ltTime');
  const ltSteps = $('#ltSteps');
  const ltLit = $('#ltLit');
  const ltTip = $('#ltTip');
  const ltUndo = $('#ltUndo');
  const ltReset = $('#ltReset');
  const ltAgain = $('#ltAgain');
  const ltBack = $('#ltBack');
  const ltGiveUp = $('#ltGiveUp');
  const ltActsMain = $('#ltActsMain');
  const ltActsAns = $('#ltActsAns');
  const ltActsPlay = $('#ltActsPlay');
  const ltDemo = $('#ltDemo');
  const ltPlayPauseBtn = $('#ltPlayPause');
  const ltPlayStopBtn = $('#ltPlayStop');
  const ltGame = $('#ltGame');
  const ltSetup = $('#ltSetup');
  const ltOverlay = $('#ltOverlay');
  const ltOvTitle = $('#ltOvTitle');
  const ltOvText = $('#ltOvText');
  const ltOvOk = $('#ltOvOk');
  const ltOvAgain = $('#ltOvAgain');
  const ltOvBack = $('#ltOvBack');
  const ltOvAnswer = $('#ltOvAnswer');
  const ltAskConfirm = $('#ltAskConfirm');
  const ltAskTitle = $('#ltAskTitle');
  const ltAskText = $('#ltAskText');
  const ltAskOk = $('#ltAskOk');
  const ltAskCancel = $('#ltAskCancel');

  /* ---------- 状态 ---------- */
  let N = 5;
  let selSize = 5;
  let lights = new Uint8Array(0);     // 1 = 亮
  let initial = new Uint8Array(0);    // 开局盘面（重开回到这里）
  let minSteps = 0;                   // 开局盘面的最少步（过关浮层里报数用）
  let undoStack = [];
  let steps = 0;
  let over = false;
  let gaveUp = false;
  let round = 0;
  let play = null;                    // 演示播放器（见「答案演示」一节）
  let playCur = -1;                   // 演示中正要按的那格（画高亮圈）

  /* ---------- 计时 ---------- */
  let ltTimer = null, ltStartT = 0, ltAccum = 0, ltPaused = false;
  function ltStartClock() {
    ltStartT = Date.now(); ltAccum = 0; ltPaused = false;
    if (ltTimer) clearInterval(ltTimer);
    ltTimer = setInterval(ltTick, 500);
    ltTime.textContent = '0:00';
  }
  function ltTick() {
    if (ltPaused) return;
    const s = Math.floor((ltAccum + (Date.now() - ltStartT)) / 1000);
    ltTime.textContent = ltFmt(s);
  }
  function ltPause() { if (ltPaused) return; ltAccum += Date.now() - ltStartT; ltPaused = true; }
  function ltResume() { if (!ltPaused) return; ltStartT = Date.now(); ltPaused = false; }
  function ltSyncPause() { if (document.hidden) ltPause(); else ltResume(); }
  function ltFmt(s) { const m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); }

  /* ---------- 小工具 ---------- */
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function litCount() {
    let n = 0;
    for (let i = 0; i < lights.length; i++) if (lights[i]) n++;
    return n;
  }
  /* 十字翻转：自己 + 上下左右（越界忽略） */
  function toggleCross(arr, r, c) {
    const d = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of d) {
      const r1 = r + dr, c1 = c + dc;
      if (r1 < 0 || r1 >= N || c1 < 0 || c1 >= N) continue;
      arr[r1 * N + c1] ^= 1;
    }
  }

  /* ---------- GF(2) 求解：最少步答案 ----------
     每个格子一个 0/1 未知数（按不按），按 i 会翻转 i 和它的四邻。
     对「当前盘面 → 全灭」列方程，模 2 高斯消元；
     有自由变量就枚举零空间（维数小），取重量最小的解。 */
  function solveMin(cur) {
    const sz = N * N;
    const rows = [];
    for (let j = 0; j < sz; j++) {
      const row = new Uint8Array(sz + 1);
      const r = Math.floor(j / N), c = j % N;
      const d = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dr, dc] of d) {
        const r1 = r + dr, c1 = c + dc;
        if (r1 >= 0 && r1 < N && c1 >= 0 && c1 < N) row[r1 * N + c1] = 1;
      }
      row[sz] = cur[j];                    // 目标：全灭，所以 b = 当前亮灯
      rows.push(row);
    }
    const where = new Int32Array(sz).fill(-1);   // 主元列 → 行号
    let rank = 0;
    for (let col = 0; col < sz && rank < sz; col++) {
      let piv = -1;
      for (let i = rank; i < sz; i++) { if (rows[i][col]) { piv = i; break; } }
      if (piv < 0) continue;
      const t = rows[rank]; rows[rank] = rows[piv]; rows[piv] = t;
      for (let i = 0; i < sz; i++) {
        if (i !== rank && rows[i][col]) {
          for (let k = col; k <= sz; k++) rows[i][k] ^= rows[rank][k];
        }
      }
      where[col] = rank; rank++;
    }
    for (let i = rank; i < sz; i++) if (rows[i][sz]) return null;   // 无解（种子法出题不会走到）
    const freeCols = [];
    for (let c = 0; c < sz; c++) if (where[c] < 0) freeCols.push(c);
    const base = new Uint8Array(sz);
    for (let c = 0; c < sz; c++) if (where[c] >= 0) base[c] = rows[where[c]][sz];

    function weight(x) { let w = 0; for (let i = 0; i < sz; i++) w += x[i]; return w; }
    let bestX = base, bestW = weight(base);
    if (freeCols.length <= 12) {           // 本站各尺寸维数 ≤ 4，暴力枚举零空间
      const combos = 1 << freeCols.length;
      for (let m = 1; m < combos; m++) {
        const x = base.slice();
        for (let b = 0; b < freeCols.length; b++) {
          if (!(m >> b & 1)) continue;
          const fc = freeCols[b];
          x[fc] ^= 1;
          for (let c = 0; c < sz; c++) {
            if (where[c] >= 0 && rows[where[c]][fc]) x[c] ^= 1;
          }
        }
        const w = weight(x);
        if (w < bestW) { bestW = w; bestX = x; }
      }
    }
    const cells = new Set();
    for (let i = 0; i < sz; i++) if (bestX[i]) cells.add(i);
    return { steps: bestW, cells };
  }

  /* ---------- 出题：种子点击 + 最少步达标 ----------
     从全亮盘按 K 下（K ≥ 下限）→ 必有解；
     4×4 / 5×5 有自由变量，最少步可能比 K 少，不达标就重出。 */
  function genPuzzle(n, minReq) {
    let best = null;
    for (let t = 0; t < 400; t++) {
      const arr = new Uint8Array(n * n).fill(1);     // 开局全亮，种子点击把它打乱
      const order = [];
      for (let i = 0; i < n * n; i++) order.push(i);
      for (let i = n * n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
      const k = minReq + Math.floor(Math.random() * 4);
      for (let i = 0; i < k; i++) {
        const idx = order[i];
        toggleCross(arr, Math.floor(idx / n), idx % n);
      }
      const sol = solveMin(arr);           // solveMin 用到全局 N（genFor 已设好）
      if (!sol) continue;
      if (sol.steps >= minReq) return { lights: arr, sol };
      if (!best || sol.steps > best.sol.steps) best = { lights: arr, sol };
    }
    return best;
  }
  /* solveMin 依赖全局 N；出题在 N 赋值之后调用，这里包一层语义更清楚 */
  function genFor(size) {
    const savedN = N;
    N = size;
    const out = genPuzzle(size, MIN_STEPS[size] || 5);
    N = savedN;
    return out;
  }

  /* ---------- 顶栏三组按钮：常规 / 演示入口 / 播放器 ---------- */
  function ltSyncHead() {
    const demoing = !!play;
    const ansGroup = !demoing && over && gaveUp;
    ltActsMain.hidden = demoing || ansGroup;
    ltActsAns.hidden = !ansGroup;
    ltActsPlay.hidden = !demoing;
  }

  /* ---------- 提示语 ---------- */
  function tipState() {
    if (play) {
      return { text: '正在演示最少步解 · 第 ' + play.i + ' / ' + play.moves.length + ' 步', warn: false };
    }
    if (over) {
      if (gaveUp) return { text: '这一局已经放弃 · 盘面停在半路，点「演示答案」看走法', warn: false };
      return { text: '灯已经全灭 · 盘面已锁，点「换一题」或「改尺寸」继续', warn: false };
    }
    const lit = litCount();
    if (steps === 0) return { text: '点一个格子，它和上下左右会一起翻转', warn: false };
    return { text: '已按 ' + steps + ' 步 · 还剩 ' + lit + ' 盏灯亮着', warn: false };
  }

  /* ---------- 渲染 ---------- */
  function ltRender() {
    const side = N * CELL + PAD * 2;
    ltSvg.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
    while (ltSvg.firstChild) ltSvg.removeChild(ltSvg.firstChild);

    const gBg = svgEl('g'), gOn = svgEl('g'), gPress = svgEl('g'), gHit = svgEl('g');
    gBg.appendChild(svgEl('rect', { class: 'lt-bg', x: 0, y: 0, width: side, height: side }));

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const k = r * N + c;
        const x = PAD + c * CELL, y = PAD + r * CELL;
        gBg.appendChild(svgEl('rect', {
          class: 'lt-offcell',
          x: x + 1, y: y + 1, width: CELL - 2, height: CELL - 2, rx: 10,
        }));
        if (lights[k]) {
          gOn.appendChild(svgEl('rect', {
            class: 'lt-oncell',
            x: x + 8, y: y + 8, width: CELL - 16, height: CELL - 16, rx: 12,
          }));
        }
        if (playCur === k) {
          gPress.appendChild(svgEl('rect', {
            class: 'lt-press',
            x: x + 4, y: y + 4, width: CELL - 8, height: CELL - 8, rx: 12,
          }));
        }
      }
    }
    // 点击热区（铺满整格，压在最上面）
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const hit = svgEl('rect', {
          class: 'lt-hit',
          x: PAD + c * CELL, y: PAD + r * CELL, width: CELL, height: CELL,
        });
        hit.dataset.cell = r + ':' + c;
        gHit.appendChild(hit);
      }
    }
    ltSvg.appendChild(gBg);
    ltSvg.appendChild(gOn);
    ltSvg.appendChild(gPress);
    ltSvg.appendChild(gHit);

    // HUD + 提示
    ltSteps.textContent = String(steps);
    ltLit.textContent = String(litCount());
    ltUndo.disabled = !undoStack.length;
    const t = tipState();
    ltTip.textContent = t.text;
    ltTip.classList.toggle('is-warn', t.warn);
  }

  /* ---------- 过关 / 放弃 ---------- */
  function ltWinCheck() {
    if (over) return;
    if (litCount() !== 0) return;
    over = true; gaveUp = false;
    ltGame.classList.add('is-done');
    ltRender();
    ltSyncHead();
    ltOvTitle.textContent = '过关！';
    ltOvText.textContent = N + ' × ' + N + ' · 用时 ' + ltTime.textContent +
      ' · ' + steps + ' 步（最少 ' + minSteps + ' 步）';
    ltOvOk.hidden = false;
    ltOvAnswer.hidden = true;
    ltOverlay.classList.add('show');
    ltPause();
  }
  function ltSolvedView() {
    ltOverlay.classList.remove('show');
    ltGame.classList.add('is-done');
    ltRender();
    ltSyncHead();
  }
  function ltDoGiveUp() {
    over = true; gaveUp = true;
    ltGame.classList.add('is-done');
    ltRender();
    ltSyncHead();
    ltOvTitle.textContent = '已放弃这一局';
    ltOvText.textContent = '可以看一段最少步的演示动画，也可以直接换一局。';
    ltOvOk.hidden = true;
    ltOvAnswer.hidden = false;
    ltOverlay.classList.add('show');
    ltPause();
  }
  /* 给 backnav 用：物理返回键 / 顶栏返回箭头关浮层时，别把盘面丢在半锁状态。
     放弃后关浮层 = 先收着，顶栏留「演示答案」，想看随时点。 */
  window.ltDismissOverlay = function () {
    if (!ltOverlay.classList.contains('show')) return;
    ltOverlay.classList.remove('show');
    ltGame.classList.add('is-done');
    ltRender();
    ltSyncHead();
  };

  /* ---------- 答案演示（照梵天汉诺的播放器成式） ----------
     从当前盘面现算余下最少步，逐格演示：先高亮要按的格（340ms×速度），
     再翻转十字，稍停进入下一步。暂停 / 停止随时可点；
     停止停在半路，顶栏留「演示答案」续播。不进撤销栈、不计玩家步数。 */
  function ltPlaySpeed() {
    if (N <= 4) return 1;
    if (N <= 5) return 0.85;
    if (N <= 6) return 0.7;
    return 0.55;                           // 7×7 步数多，放快些
  }
  function ltPlayStopNow() {
    if (play) { clearTimeout(play.timer); play = null; }
    playCur = -1;
  }
  function ltPlayEnd(stopped) {
    ltPlayStopNow();
    ltRender();
    if (stopped) {
      ltSyncHead();
      ltTip.textContent = '演示已停止 · 盘面停在半路，点「演示答案」续播，或换一局';
      return;
    }
    gaveUp = false;                        // 演完了 = 没有可续的，顶栏回常规收尾组
    ltSyncHead();
    toast('ok', '演示结束', '这就是余下盘面的最少步走法');
  }
  function ltStartDemo() {
    if (play) return;
    const sol = solveMin(lights);
    if (!sol || !sol.steps) {
      toast('ok', '已经全灭了', '没有要演示的步子');
      gaveUp = false;
      ltOverlay.classList.remove('show');
      ltSyncHead();
      ltRender();
      return;
    }
    ltPlayStopNow();
    over = true; gaveUp = true;
    ltGame.classList.add('is-done');
    ltOverlay.classList.remove('show');
    play = { moves: [...sol.cells], i: 0, paused: false, timer: null, speed: ltPlaySpeed() };
    ltSyncHead();
    ltPlayPauseBtn.textContent = '暂停';
    ltPlayStep();
  }
  function ltPlayStep() {
    if (!play || play.paused) return;
    if (!page.classList.contains('show')) { ltPlayStopNow(); return; }   // 功能页被关了
    if (document.hidden) { play.timer = setTimeout(ltPlayStep, 400); return; }   // 后台先等着
    if (play.i >= play.moves.length) { ltPlayEnd(false); return; }
    const k = play.moves[play.i];
    play.i++;
    playCur = k;
    ltRender();
    const sp = play.speed;
    play.timer = setTimeout(() => {
      if (!play) return;
      toggleCross(lights, Math.floor(k / N), k % N);
      playCur = -1;
      ltRender();
      if (!play || play.paused) return;
      play.timer = setTimeout(ltPlayStep, Math.round(60 * sp));
    }, Math.round(340 * sp));
  }
  function ltPlayPauseToggle() {
    if (!play) return;
    if (play.paused) {
      play.paused = false;
      ltPlayPauseBtn.textContent = '暂停';
      ltPlayStep();
    } else {
      play.paused = true;
      clearTimeout(play.timer);
      /* 高亮还挂在半空（正要按的那格）→ 步子回退一格，续播时从头按这一步 */
      if (playCur >= 0) { play.i--; playCur = -1; ltRender(); }
      ltPlayPauseBtn.textContent = '继续';
    }
  }

  /* ---------- 撤销 / 重开 / 换题 / 改尺寸 ---------- */
  function pushUndo() {
    undoStack.push({ lights: lights.slice(), steps: steps });
    if (undoStack.length > 200) undoStack.shift();
  }
  function ltUndoStep() {
    if (!undoStack.length) return;
    const s = undoStack.pop();
    lights = s.lights;
    steps = s.steps;
    over = false; gaveUp = false;
    ltPlayStopNow();
    ltOverlay.classList.remove('show');
    ltGame.classList.remove('is-done');
    ltRender();
    ltSyncHead();
  }
  function ltResetAll() {
    lights = initial.slice();
    steps = 0; over = false; gaveUp = false;
    undoStack = [];
    ltPlayStopNow();
    ltOverlay.classList.remove('show');
    ltGame.classList.remove('is-done');
    ltRender();
    ltSyncHead();
    ltStartClock();
  }
  function ltNewRound(size) {
    N = size;
    const out = genFor(size);
    lights = out.lights;
    initial = out.lights.slice();
    minSteps = out.sol.steps;
    undoStack = [];
    steps = 0; over = false; gaveUp = false;
    round++;
    ltPlayStopNow();
    ltRound.textContent = '第 ' + round + ' 局';
    ltMeta.textContent = size + ' × ' + size;
    ltSetup.hidden = true;
    ltGame.hidden = false;
    ltGame.classList.remove('is-done');
    ltOverlay.classList.remove('show');
    ltRender();
    ltSyncHead();
    ltStartClock();
  }
  function ltToSetup() {
    ltGame.hidden = true;
    ltSetup.hidden = false;
    ltGame.classList.remove('is-done');
    over = false; gaveUp = false;
    ltPlayStopNow();
    if (ltTimer) clearInterval(ltTimer);
    ltSyncHead();
  }

  /* ---------- 二次确认 ---------- */
  const LT_ASK = {
    reset: { title: '重开这一局？', text: '回到这一局的开局盘面，步数清零，计时重新开始。', ok: '重开', run: ltResetAll },
    again: { title: '换一题？', text: '当前这一局作废，重新开一盘（开局盘面会变）。', ok: '换一题', run: () => ltNewRound(N) },
    size:  { title: '改尺寸？', text: '当前这一局作废，回到选盘面。', ok: '改尺寸', run: ltToSetup },
    give:  { title: '放弃这一局？', text: '可以看一段最少步的演示动画，或直接换一局。', ok: '放弃', run: ltDoGiveUp },
  };
  let ltAskKind = null;
  function ltAskOpen(kind) {
    /* 这一局已经收尾（过关 / 放弃 / 看过演示）→ 换一题 / 改尺寸没什么可丢的，直接走。
       只有还在玩的时候才值得问一句。 */
    if (over && (kind === 'again' || kind === 'size')) { LT_ASK[kind].run(); return; }
    if (kind === 'reset' && !steps) {
      flashTip('还没按过，不用重开。');
      return;
    }
    ltAskKind = kind;
    const cfg = LT_ASK[kind];
    ltAskTitle.textContent = cfg.title;
    ltAskText.textContent = cfg.text;
    ltAskOk.textContent = cfg.ok;
    ltAskConfirm.classList.add('show');
  }
  function ltCloseConfirm() {
    ltAskConfirm.classList.remove('show');
    ltAskKind = null;
  }
  function flashTip(msg) {
    ltTip.textContent = msg;
    ltTip.classList.add('is-warn');
  }

  /* ---------- 事件 ---------- */
  function paintSizeButtons() {
    [...ltSizes.children].forEach(x => x.classList.toggle('on', +x.dataset.size === selSize));
  }

  ltSizes.addEventListener('click', e => {
    const b = e.target.closest('.lt-size');
    if (!b) return;
    selSize = +b.dataset.size;
    paintSizeButtons();
  });
  ltStart.addEventListener('click', () => ltNewRound(selSize));
  ltUndo.addEventListener('click', ltUndoStep);
  ltReset.addEventListener('click', () => ltAskOpen('reset'));
  ltAgain.addEventListener('click', () => ltAskOpen('again'));
  ltBack.addEventListener('click', () => ltAskOpen('size'));
  ltGiveUp.addEventListener('click', () => ltAskOpen('give'));

  ltSvg.addEventListener('click', e => {
    if (over || play) return;
    const hit = e.target.closest ? e.target.closest('[data-cell]') : null;
    if (!hit) return;
    const parts = hit.dataset.cell.split(':');
    const r = +parts[0], c = +parts[1];
    pushUndo();
    toggleCross(lights, r, c);
    steps++;
    ltRender();
    ltWinCheck();
  });

  ltOvOk.addEventListener('click', ltSolvedView);
  ltOvAgain.addEventListener('click', () => ltNewRound(N));
  ltOvBack.addEventListener('click', ltToSetup);
  ltOvAnswer.addEventListener('click', ltStartDemo);
  ltDemo.addEventListener('click', ltStartDemo);
  ltPlayPauseBtn.addEventListener('click', ltPlayPauseToggle);
  ltPlayStopBtn.addEventListener('click', () => ltPlayEnd(true));

  ltAskOk.addEventListener('click', () => {
    const k = ltAskKind;
    ltCloseConfirm();
    if (k && LT_ASK[k]) LT_ASK[k].run();
  });
  ltAskCancel.addEventListener('click', ltCloseConfirm);
  ltAskConfirm.addEventListener('click', e => { if (e.target === ltAskConfirm) ltCloseConfirm(); });

  document.addEventListener('visibilitychange', ltSyncPause);
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== 'toolLights') return;
    paintSizeButtons();
    ltSyncPause();
  });

  /* Esc：确认框 → 演示中（停止）→ 才交给 backnav / tools.js。
     挂 window 捕获阶段（照梵天汉诺），拦下之后 tools.js 那个「Esc = 返回」就收不到。 */
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!page.classList.contains('show')) return;
    if (ltAskConfirm.classList.contains('show')) {
      e.stopPropagation(); e.preventDefault();
      ltCloseConfirm();
      return;
    }
    if (play) {
      e.stopPropagation(); e.preventDefault();
      ltPlayEnd(true);
    }
  }, true);

  /* 顶栏返回箭头 / 物理返回键：浮层开着就先关浮层（和 backnav 一个口径），
     别一下把整个功能页关掉。 */
  if (typeof NovaBack !== 'undefined' && NovaBack.inner) {
    NovaBack.inner(top => {
      if (top !== page) return false;
      if (!ltOverlay.classList.contains('show')) return false;
      window.ltDismissOverlay();
      return true;
    });
  }

  paintSizeButtons();
})();
