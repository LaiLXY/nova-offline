/* ==========================================================================
   game2048.js —— 功能页：二零四八

   4×4 的盘面，往四个方向推，同值方块撞在一起就合成两倍。
   凑出 2048 就算通关（还能接着往上推）。

   ★ 移动 / 合并 / 判负全在浏览器里算，一次请求都不发。
     最高分存在本机浏览器的 localStorage 里：破纪录时写一次、进来时读一次。
     离线版没有账号，换设备就是重新开始。

   ★ 动画是这一页的重点，做法是「方块永远不重建，只改位置」：
       · 滑动：每个方块绝对定位，位置由 --r / --c 两个变量 + transform
               决定。改这两个变量，CSS 的 transition 自己把它滑过去。
       · 合并：被吃掉的那个方块**滑到目标格上**，等滑动走完再从 DOM 里摘掉；
               目标方块这时才翻倍，并弹一下（.g48-pop）。
               —— 分两步是为了让"两个方块撞在一起"这件事看得见。一上来就
                  翻倍、删掉另一个的话，用户只会看到一个方块原地变大，
                  看不出是谁跟谁合的。
       · 新块：滑完才落（.g48-new，缩放淡入），不和滑动抢注意力。
       · 飘分：合并的位置浮一个「+N」上去，一眼知道这一步挣了多少。
     所以一次移动是**两拍**：先滑（G48_SLIDE 毫秒），滑完再翻倍 / 落新块。
     这两拍之间不接受新操作（g48Busy），否则狂按方向键会让盘面和动画
     对不上号。0.13 秒的锁，手速再快也感觉不出来。

   ★ 方块是两层（见 tools.css 的 .g48-tile / .g48-face）：
       · 外层 .g48-tile 只管**位置** —— left/top 落在第一格，再用 transform
         平移 r/c 格。滑动动画就是它的 transition。
       · 内层 .g48-face 只管**长相** —— 配色、字号、"落下来"和"弹一下"。
     分成两层是为了让两个动画互不打架：位置动画和缩放动画都要用
     transform，同元素上会互相覆盖；分到父子两层就各演各的。

   ★ 撤销是真的整盘回退：每走一步前把「16 个格子的值 + 当前得分」压进栈，
     撤销时按快照重建。所以能一路退回开局，也能在**无路可走之后**救回来
     一步 —— 那正是它最有用的时候。重开一局会清空这个栈。

   ★ 操作方式（三套都通）：
       · 手机：在棋盘上滑动（棋盘 touch-action: none，不会顺手滚页面）
       · 电脑：方向键 / W A S D，另外 U 撤销、R 重开
       · 两边：下面对十字方向盘上的四个键

   ★ 移动的定义（一步都没挪动就不算一步）：
     推到头之后位置和原来一样、又没合成 —— 这次方向键等于没按，
     既不入撤销栈、也不落新块。少了这条判断，一直按同一个方向会
     凭空多出方块来。

   依赖 core.js（$ / toast）、tools.js（tool:open 事件）与 home.js（currentAccount）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const g48Page    = document.getElementById('toolGame2048');
const g48Board   = $('#g48Board');
const g48CellsEl = $('#g48Cells');
const g48ScoreEl = $('#g48Score');
const g48BestEl  = $('#g48Best');
const g48NoteEl  = $('#g48Note');
const g48PadEl   = $('#g48Pad');
const g48UndoBtn = $('#g48Undo');
const g48NewBtn  = $('#g48New');
const g48Overlay = $('#g48Overlay');
const g48OvTitle = $('#g48OvTitle');
const g48OvText  = $('#g48OvText');
const g48OvMain  = $('#g48OvPrimary');
const g48OvUndo  = $('#g48OvSecond');
const g48Confirm = $('#g48ResetConfirm');

/* ---------- 常量 ---------- */
const G48_N        = 4;          // 4×4
const G48_SLIDE    = 130;        // 滑动时长(ms) —— 比 CSS 里的 transition 略长一点，
                                 //   保证"翻倍"发生在方块真的停稳之后
const G48_FLOAT_MS = 560;        // 飘分留多久(ms)，和 CSS 那条动画对齐
const G48_UNDO_MAX = 80;         // 撤销栈上限：够退一整局，也不至于吃内存
const G48_WIN      = 2048;       // 通关线
const G48_SWIPE    = 24;         // 滑动超过多少像素才算一次有效操作
const G48_NOTE     = '合并同值方块，凑出 2048';
const G48_SAVE_MS  = 2500;       // 最高分自动存盘的防抖时延

/* ---------- 状态 ---------- */
let g48Grid   = [];      // 4×4：每格是方块对象，或者 null
let g48Tiles  = [];      // 盘上所有活着的方块（含正滑向目标的那个"将死"的）
let g48Score  = 0;       // 本局得分
let g48Best   = 0;       // 最高分（存在本机浏览器）
let g48History = [];     // 撤销栈：{ cells, score }
let g48Busy   = false;   // 两拍之间的锁（滑动那段时间）
let g48Over   = false;   // 这局已经走完了
let g48Won    = false;   // 这局已经道过贺（2048 只报一次）
let g48Moved  = false;   // 本局走过步子没有 —— 决定「重开」要不要问一句
let g48Timer  = null;    // 合并收尾的定时器
let g48NoteT  = null;    // 提示行回落的定时器
let g48SaveT  = null;    // 最高分存盘的防抖定时器
let g48Owner  = null;    // 上次进来时登录的是谁

/* ==========================================================
   一、小工具
   ========================================================== */

/** 这个坐标在盘内吗 */
const g48In = (r, c) => r >= 0 && r < G48_N && c >= 0 && c < G48_N;

/** 方向的位移向量。键名和按钮上的 data-dir 一致。 */
const G48_DIRS = {
  up:    { dr: -1, dc:  0 },
  down:  { dr:  1, dc:  0 },
  left:  { dr:  0, dc: -1 },
  right: { dr:  0, dc:  1 },
};

/** 遍历顺序：**先动的那一头要排在前面**。
 *  往上推从第 0 行开始，往下推从第 3 行开始 —— 反过来会让同一列的
 *  两个方块"互换身份"，合出来的位置就错了（而且会漏合）。 */
function g48Order(dir) {
  const rows = [0, 1, 2, 3];
  const cols = [0, 1, 2, 3];
  if (dir === 'down')  rows.reverse();
  if (dir === 'right') cols.reverse();
  const out = [];
  for (const r of rows) for (const c of cols) out.push([r, c]);
  return out;
}

/* ==========================================================
   二、方块：位置归外层、长相归内层
   ========================================================== */

/** 把位置写到方块上（改 --r / --c，CSS 的 transition 负责滑过去） */
function g48Place(tile, r, c) {
  tile.r = r;
  tile.c = c;
  tile.el.style.setProperty('--r', String(r));
  tile.el.style.setProperty('--c', String(c));
}

/** 只画和值有关的两样东西：配色（data-v）和字号档（data-len）。
 *  字号档按位数分 5 档并**夹到 5**：位数再多也没有对应的档位，
 *  夹住才能保证每一档都有规则接着，不会掉回默认那种大字号撑破格子。 */
function g48PaintFace(tile) {
  const face = tile.face;
  face.dataset.v   = String(tile.value);
  face.dataset.len = String(Math.min(String(tile.value).length, 5));
  face.textContent = String(tile.value);
}

/** 造一个方块（不落盘，只管 DOM） */
function g48MakeTile(value, isNew) {
  const el = document.createElement('div');
  el.className = 'g48-tile' + (isNew ? ' is-new' : '');

  const face = document.createElement('div');
  face.className = 'g48-face';
  el.appendChild(face);

  const tile = { r: 0, c: 0, value, el, face, dying: false, merged: false };
  g48PaintFace(tile);
  return tile;
}

/** 造一个方块并放到 (r,c) 上 */
function g48AddTile(r, c, value, isNew) {
  const tile = g48MakeTile(value, isNew);
  g48Place(tile, r, c);
  g48Board.appendChild(tile.el);
  g48Grid[r][c] = tile;
  g48Tiles.push(tile);
  return tile;
}

/** 底格：16 个不动的空格子。只在建棋盘时铺一次，之后永不重建
 *  —— 让运动的只有方块，底格跟着重画会晃眼。 */
function g48BuildCells() {
  g48CellsEl.textContent = '';
  for (let i = 0; i < G48_N * G48_N; i++) {
    const cell = document.createElement('div');
    cell.className = 'g48-cell';
    g48CellsEl.appendChild(cell);
  }
}

/** 清空盘面（DOM 和数据结构一起清） */
function g48ClearBoard() {
  g48Tiles.forEach(t => t.el.remove());
  g48Tiles = [];
  g48Grid = [];
  for (let r = 0; r < G48_N; r++) g48Grid.push(new Array(G48_N).fill(null));
}

/* ==========================================================
   三、落子 / 判负

   随机落一个 2 或 4。九成出 2、一成出 4 —— 和原版一个手感：
   小数字才铺得开、也才有得合。
   ========================================================== */
function g48Spawn() {
  const empty = [];
  for (let r = 0; r < G48_N; r++) {
    for (let c = 0; c < G48_N; c++) if (!g48Grid[r][c]) empty.push([r, c]);
  }
  if (!empty.length) return null;

  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  return g48AddTile(r, c, Math.random() < 0.9 ? 2 : 4, true);
}

/** 还有没有路可走：有空位就算有；否则看有没有相邻的同值对。
 *  每对相邻格只比一次 —— 只看右边和下边就够了。 */
function g48CanMove() {
  for (let r = 0; r < G48_N; r++) {
    for (let c = 0; c < G48_N; c++) {
      const t = g48Grid[r][c];
      if (!t) return true;

      const right = c + 1 < G48_N ? g48Grid[r][c + 1] : null;
      const down  = r + 1 < G48_N ? g48Grid[r + 1][c] : null;
      if (right && right.value === t.value) return true;
      if (down  && down.value  === t.value) return true;
    }
  }
  return false;
}

/* ==========================================================
   四、走一步

   这是整个玩法的核心。一趟遍历 + 一次收尾：
     遍历：每个方块先顶到最远，再看前面那一格能不能合
     收尾：摘掉被吃掉的、翻倍目标、飘分、加分、落新块、判胜负
   ========================================================== */
function g48Move(dir) {
  // 页面没开着 / 正在动画 / 这局结束了 / 弹窗开着 —— 一律不理
  if (!g48Page.classList.contains('show')) return;
  if (g48Busy || g48Over) return;
  if (g48Overlay.classList.contains('show')) return;
  if (g48Confirm.classList.contains('show')) return;

  const { dr, dc } = G48_DIRS[dir];
  const before = g48Snapshot();          // 走之前存一份，用来撤销

  let moved  = false;
  let gained = 0;
  const dying   = [];   // 滑到目标格上、等着被摘掉的方块
  const merging = [];   // 原地不动、值要翻倍的方块
  const spots   = [];   // [行, 列, 加了多少分] —— 用来飘分

  // 每个方块一轮只能被合一次（不然 2 2 2 2 往左推会连成 8）
  g48Tiles.forEach(t => { t.merged = false; });

  g48Order(dir).forEach(([r, c]) => {
    const tile = g48Grid[r][c];
    if (!tile) return;

    // 一路顶到头：前面那格是空的就继续走
    let nr = r, nc = c;
    for (;;) {
      const tr = nr + dr, tc = nc + dc;
      if (!g48In(tr, tc) || g48Grid[tr][tc]) break;
      nr = tr; nc = tc;
    }

    const tr = nr + dr, tc = nc + dc;
    const target = g48In(tr, tc) ? g48Grid[tr][tc] : null;

    if (target && target.value === tile.value && !target.merged) {
      /* —— 合并 ——
         本格的账先结掉：这一格归零，方块本身滑到 target 那一格上
         （位置变量一改，CSS 自己把它送过去）。
         它暂时还留在 DOM 里，等滑动走完再摘 —— 这样才看得见"撞上去"。 */
      target.merged = true;
      g48Grid[r][c] = null;
      g48Place(tile, tr, tc);
      tile.dying = true;
      dying.push(tile);
      merging.push(target);
      const gain = target.value * 2;
      spots.push([tr, tc, gain]);
      gained += gain;
      moved = true;
      return;
    }

    if (nr === r && nc === c) return;    // 顶不动也没得合，这一格跳过

    g48Grid[r][c] = null;
    g48Grid[nr][nc] = tile;
    g48Place(tile, nr, nc);
    moved = true;
  });

  // 一步都没挪动：这次方向键等于没按过。不入栈、不落新块。
  if (!moved) return;

  g48History.push(before);
  if (g48History.length > G48_UNDO_MAX) g48History.shift();
  g48Moved = true;
  g48PaintUndo();

  g48Busy = true;
  g48Timer = setTimeout(() => {
    g48Timer = null;

    /* ---------- 第二拍：滑动已经停稳了 ---------- */

    // 1) 摘掉被吃掉的
    dying.forEach(t => t.el.remove());
    g48Tiles = g48Tiles.filter(t => !t.dying);

    // 2) 目标方块翻倍 + 弹一下。
    //    "重播动画"的常规手法：摘类 → 强制一次重排 → 加回去。
    //    少了那次重排，连着两次合并的第二次不会播（类没变过）。
    let hitWin = false;
    merging.forEach(t => {
      t.value *= 2;
      g48PaintFace(t);
      if (t.value >= G48_WIN) hitWin = true;
      t.el.classList.remove('is-pop');
      void t.el.offsetWidth;
      t.el.classList.add('is-pop');
    });

    // 3) 飘分（几个点同时合并就同时飘几个）
    spots.forEach(([r, c, gain]) => g48Float(r, c, gain));

    // 4) 加分（顺带看破没破纪录）
    if (gained) g48AddScore(gained);

    // 5) 落一个新块
    g48Spawn();

    g48Busy = false;

    // 6) 收尾：先看通没通关，再看还有没有路
    if (hitWin && !g48Won) { g48Won = true; g48ShowWin(); return; }
    if (!g48CanMove()) g48ShowOver();
  }, G48_SLIDE);
}

/** 把还在滑的那一段收掉（重开 / 撤销时用）。
 *  能走到这儿说明当前没锁着，所以不会打断一半的动画。 */
function g48CancelSlide() {
  if (g48Timer) { clearTimeout(g48Timer); g48Timer = null; }
  g48Busy = false;
}

/* ==========================================================
   五、分数与最高分
   ========================================================== */
function g48PaintScore() {
  g48ScoreEl.textContent = String(g48Score);
  g48BestEl.textContent  = String(g48Best);
}

function g48AddScore(gain) {
  g48Score += gain;
  g48ScoreEl.textContent = String(g48Score);
  // 得分数字跳一下，让"这一步挣了分"有个落点
  g48Bump(g48ScoreEl);

  if (g48Score > g48Best) {
    g48Best = g48Score;
    g48BestEl.textContent = String(g48Best);
    g48Bump(g48BestEl);
    g48ScheduleSave();     // 破纪录了，过一会儿写回本机
  }
}

/** 让一个数字"跳一下"：摘类 → 强制重排 → 加回去（同上，为了能连播） */
function g48Bump(el) {
  el.classList.remove('g48-bump');
  void el.offsetWidth;
  el.classList.add('g48-bump');
}

/** 合并处飘一个「+N」 */
function g48Float(r, c, gain) {
  const el = document.createElement('div');
  el.className = 'g48-float';
  el.textContent = '+' + gain;
  el.style.setProperty('--r', String(r));
  el.style.setProperty('--c', String(c));
  g48Board.appendChild(el);
  setTimeout(() => el.remove(), G48_FLOAT_MS + 120);
}

/** 提示行临时改一句话，过一会儿自己落回玩法摘要 */
function g48Flash(text) {
  g48NoteEl.textContent = text;
  g48NoteEl.classList.add('is-event');
  if (g48NoteT) clearTimeout(g48NoteT);
  g48NoteT = setTimeout(() => {
    g48NoteT = null;
    g48NoteEl.textContent = G48_NOTE;
    g48NoteEl.classList.remove('is-event');
  }, 1800);
}

/* ---------- 最高分：读一次 / 防抖写一次 ---------- */

/* 离线版：最高分存在本机浏览器里（localStorage），没有后端 */
const G48_BEST_KEY = 'nova_offline_game2048';

async function g48LoadBest() {
  try {
    const v = localStorage.getItem(G48_BEST_KEY);
    if (v !== null) g48Best = parseInt(v, 10) || 0;
  } catch (_) { /* 无痕模式下 localStorage 可能直接抛错，忽略 */ }
  g48PaintScore();
}

async function g48SaveBest() {
  if (g48SaveT) { clearTimeout(g48SaveT); g48SaveT = null; }
  try { localStorage.setItem(G48_BEST_KEY, String(g48Best)); } catch (_) {}
}

/** 破纪录时的存盘是"防抖"的：一直刷新纪录就一直往后推，
 *  停手 2.5 秒（或者这局结束 / 离开这一页）才真正写一次。
 *  不然一局下来得写几十次，分数却只是同一个数。 */
function g48ScheduleSave() {
  if (g48SaveT) clearTimeout(g48SaveT);
  g48SaveT = setTimeout(g48SaveBest, G48_SAVE_MS);
}

/* ==========================================================
   六、撤销 / 重开
   ========================================================== */

/** 当前盘面的快照：16 个格子的值 + 得分 */
function g48Snapshot() {
  return {
    cells: g48Grid.map(row => row.map(t => (t ? t.value : 0))),
    score: g48Score,
  };
}

/** 按快照把整盘重铺一遍（不加滑动动画）。
 *  撤销是"回到刚才"，一格一格滑回去反而像是在走新的一步。 */
function g48Restore(snap) {
  g48ClearBoard();
  snap.cells.forEach((row, r) => row.forEach((v, c) => {
    if (v) g48AddTile(r, c, v, false);
  }));
  g48Score = snap.score;
  g48PaintScore();
}

function g48PaintUndo() {
  const has = g48History.length > 0;
  g48UndoBtn.disabled = !has;
  g48OvUndo.hidden = !has;
}

function g48Undo() {
  if (g48Busy || !g48History.length) return;

  const snap = g48History.pop();
  g48CancelSlide();
  g48Restore(snap);

  // 撤销之后这局又能接着走了
  g48Over = false;
  g48Moved = true;
  g48Overlay.classList.remove('show');
  g48PaintUndo();
  g48Flash('已撤销一步');
}

/** quiet = true 时不弹提示（进页面时第一次铺盘、换账号时都用它） */
function g48NewGame(quiet) {
  g48CancelSlide();

  g48ClearBoard();
  g48History = [];
  g48Over  = false;
  g48Won   = false;
  g48Moved = false;
  g48Score = 0;
  g48PaintScore();
  g48PaintUndo();
  g48Overlay.classList.remove('show');

  // 开局两块：一局能走多远，头两块挺关键，两块都按 9:1 出 2 / 4
  g48Spawn();
  g48Spawn();

  if (!quiet) {
    g48Flash('新的一局，合并同值方块');
    if (typeof toast === 'function') toast('ok', '新的一局', '凑出 2048 就算通关');
  }
}

/** 「重开一局」的入口：盘上还有进展就先问一句，
 *  一进来就按（什么都还没损失）直接重开，不必多问。 */
function g48AskNewGame() {
  if (g48Busy) return;
  if (g48Over) { g48NewGame(); return; }
  if (g48Moved || g48Score > 0) { g48Confirm.classList.add('show'); return; }
  g48NewGame();
}

/* ==========================================================
   七、结束 / 胜利浮层
   ========================================================== */

/** 无路可走了。顺带把这局的最高分存盘 —— 这是最该存的那个时刻。 */
function g48ShowOver() {
  g48Over = true;
  g48SaveBest();

  g48OvTitle.textContent = '无处可动了';
  g48OvText.textContent  = '本局得分 ' + g48Score + ' · 最高分 ' + g48Best;
  g48OvMain.textContent  = '重开一局';
  g48OvMain.dataset.act  = 'new';
  g48PaintUndo();                 // 有撤销栈才给「撤销一步」这个出口
  g48Overlay.classList.add('show');
  g48Flash('无处可动了');
}

/** 凑出 2048 了。这局还没结束，可以接着往上推。 */
function g48ShowWin() {
  g48SaveBest();

  g48OvTitle.textContent = '凑出 2048 了！';
  g48OvText.textContent  = '本局得分 ' + g48Score + '，还能接着往上推';
  g48OvMain.textContent  = '继续挑战';
  g48OvMain.dataset.act  = 'close';
  g48OvUndo.hidden = true;
  g48Overlay.classList.add('show');
  if (typeof toast === 'function') toast('ok', '凑出 2048', '还能继续，往上接着推');
}

/* ==========================================================
   八、事件绑定
   ========================================================== */

/* ---------- 8.1 方向键（十字方向盘） ---------- */
g48PadEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-dir]');
  if (!btn) return;
  g48Move(btn.dataset.dir);
});

/* ---------- 8.2 键盘 ----------
   只在功能页开着的时候接管，免得在别的页面把方向键吃掉了。
   字母键统一按小写比对（Shift / 大写锁定下 e.key 会是大写）。 */
const G48_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', a: 'left', s: 'down', d: 'right',
};

document.addEventListener('keydown', e => {
  if (!g48Page.classList.contains('show')) return;
  // 别抢系统的组合键（Ctrl+Z 之类）
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  const dir = G48_KEYS[key];
  if (dir) { e.preventDefault(); g48Move(dir); return; }
  if (key === 'u') { e.preventDefault(); g48Undo(); return; }
  if (key === 'r') { e.preventDefault(); g48AskNewGame(); }
});

/* ---------- 8.3 触摸滑动 ----------
   棋盘上挂了 touch-action: none，所以横着竖着怎么划都不会带动页面滚动，
   这里只管"划了多远、往哪划"。 */
let g48Touch = null;

g48Board.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { g48Touch = null; return; }
  const t = e.touches[0];
  g48Touch = { x: t.clientX, y: t.clientY };
}, { passive: true });

g48Board.addEventListener('touchend', e => {
  if (!g48Touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - g48Touch.x;
  const dy = t.clientY - g48Touch.y;
  g48Touch = null;

  const ax = Math.abs(dx), ay = Math.abs(dy);
  // 手抖、轻点：挪得太少，当没滑
  if (Math.max(ax, ay) < G48_SWIPE) return;

  // 哪个方向的位移大就按哪个方向走（斜着划也不会两边都动）
  g48Move(ax > ay ? (dx > 0 ? 'right' : 'left')
                  : (dy > 0 ? 'down'  : 'up'));
});

/* ---------- 8.4 两个按钮 ---------- */
g48UndoBtn.addEventListener('click', g48Undo);
g48NewBtn.addEventListener('click', g48AskNewGame);

/* ---------- 8.5 结束浮层上的按钮 ---------- */
g48OvMain.addEventListener('click', () => {
  g48Overlay.classList.remove('show');
  if (g48OvMain.dataset.act === 'new') g48NewGame();
});

g48OvUndo.addEventListener('click', g48Undo);   // g48Undo 内部会把浮层收掉

/* ---------- 8.6 「重开」的二次确认 ---------- */
$('#g48ResetCancel').addEventListener('click', () => g48Confirm.classList.remove('show'));
$('#g48ResetOk').addEventListener('click', () => {
  g48Confirm.classList.remove('show');
  g48NewGame();
});
g48Confirm.addEventListener('click', e => {
  if (e.target === g48Confirm) g48Confirm.classList.remove('show');
});

/* Esc 只关这一层（确认框 / 胜利浮层），而不是把整个功能页退掉。
   关键在**挂在 window 的捕获阶段**：捕获是从 window 往下的，所以这里
   比 js/tools.js 挂在 document 捕获阶段那个"Esc = 返回"先跑，
   拦下来之后 tools.js 就收不到了 —— 和 js/xor.js 那两处同一个做法。
   （结束浮层不拦：那儿只有一个出口，想去别处就正常退出这一页。） */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const confirmOpen = g48Confirm.classList.contains('show');
  const winOpen = g48Overlay.classList.contains('show') && g48OvMain.dataset.act === 'close';
  if (!confirmOpen && !winOpen) return;

  e.stopPropagation();
  e.preventDefault();
  if (confirmOpen) g48Confirm.classList.remove('show');
  if (winOpen) g48Overlay.classList.remove('show');
}, true);

/* ---------- 8.7 进页面 / 离开页面 ---------- */

/* 进来时对齐一次最高分：
     · 换了人 → 分数和盘面先清零、重开一局（别把上一位的留着）
     · 同一个人 → 进来也读一次本机记下的最高分
   盘面本身不重置 —— 中途退出去再回来，接着玩就是了。 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== g48Page) return;

  const who = typeof currentAccount === 'string' ? currentAccount : null;
  if (g48Owner !== who) {
    g48Owner = who;
    g48Best  = 0;
    g48NewGame(true);
  }
  g48LoadBest();
});

/* 离开这一页（返回按钮）和切到后台时，把还没存盘的最高分赶紧存掉 ——
   防抖那 2.5 秒可能等不到了。 */
document.addEventListener('click', e => {
  if (e.target.closest('[data-tool-back]') && g48SaveT) g48SaveBest();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && g48SaveT) g48SaveBest();
});

/* ==========================================================
   九、初始化
   ========================================================== */
g48BuildCells();
g48NewGame(true);
