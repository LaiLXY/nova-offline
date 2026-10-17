/* ==========================================================================
   brahma.js —— 功能页：梵天汉诺（汉诺塔）

   玩法：三根柱子，开局 3–9 个盘从小到大全摞在第一根柱子上。
     · 一次只能搬一根柱子上最上面的那一个盘
     · 大盘不可以压在小盘上
     · 把整摞盘原样搬到最后一根柱子（下标 2）就过关
   最少步数 2ⁿ−1；走得比它多也能过，步数记在顶栏上。

   ★ 排版只有一份 DOM，靠 .bh-pegs 的 flex-direction 切两套：
       手机：column —— 三根柱子从上到下摞成三行
       电脑：row    —— 三根柱子并排立在一条底座上
     三根柱子"并排"的时机有三种，收在 bhWantRow 一个口子上：
       电脑端 / 屏幕自己就是横的（data-aspect=wide）/ 手机端按了「横屏」。
     切换只改 .bh-board 的 is-flat 一个 class，位置全部由 bhLayout 重算。

   ★「横屏」不是把横排塞进竖屏，是真的把屏幕横过来 —— 见 bhSetLand：
     给 <html> 挂 .bh-land，整个工具页顺时针转 90°，盒子按"高 × 宽"
     （长短边对调）重新排版，转完正好铺满整屏；#toasts 跟着一起转
     （否则提示会横在用户眼前）。用户把手机横过来就正了。
     ★ 转了之后，盘层自己的坐标轴也跟着转了 —— 局部 x 对着屏幕向下、
       局部 y 对着屏幕向左。所以 bhMeasure 量出来的 cx/top/bottom
       在横屏下得换一套算法，见各自的注释。别看着别扭就顺手"改回来"。

   ★ 搬盘只有"点选"一条路：点柱子拿起最上面的盘 → 再点一根柱子放下。
     曾经还能"按住直接拖"，2026-10-15 删掉了 —— 盘面小、柱子热区大，
     手机上拖拽要跟翻页抢手势、手指一抖就落错柱子，点选稳得多也更好解释。
     所以这里**没有** move 手势、也不 setPointerCapture：每次 pointerdown
     按坐标判一次"点在哪根柱子上"就把事情办完，之后再不看指针。

   ★ 盘不用 DOM 排，绝对定位在 .bh-disks 这一层里、靠 transform 平移：
       · 好处一：移动就是一次纯 CSS transition，和布局彻底解耦，
         切排版 / 缩放窗口都不会跳；
       · 好处二：能做"抬起 → 平移 → 落下"三段式动画（bhAnimMove），
         而不是从 A 点直勾勾滑到 B 点。
     代价是位置得自己算：先量柱子（bhMeasure），再按"第几层"推坐标
     （bhPosOn）。所以换排版、缩放、开新局都必须重量一次 —— 全部收在
     bhLayout 一个口子上。

   ★「看答案」不是摆一个终局盘面（终局永远一样，没什么可看的），
     它是一串走法。所以这里做两件事：
       · 从头演示：退回开局，播 2ⁿ−1 步的标准最优解
       · 从当前接着走：按玩家现在的盘面，现算一条最短路续播
     后者不能拿 2ⁿ−1 硬套 —— 见 bhSolve 的注释。

   ★ 动画中断的处理：每只盘自己记一个 token（el._bhTok）。同一只盘上
     叠了新的动画时，旧的那串 setTimeout 会认 token 不认人、自己退出，
     所以手快连点也不会把盘卡在半空。

   依赖 core.js（$ / $$ / toast）与 tools.js（tool:open 事件）。
   不记战绩、一次请求都不发 —— 和二十四点 / 罗马数字 / 九宫幻方 / 异或法则一样。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const bhPage       = $('#toolBrahma');
const bhBodyEl     = $('#toolBrahmaBody');
const bhSetup      = $('#bhSetup');
const bhOrdersEl   = $('#bhOrders');
const bhStartBtn   = $('#bhStart');
const bhGame       = $('#bhGame');
const bhRoundEl    = $('#bhRound');
const bhMetaEl     = $('#bhMeta');
const bhBoardEl    = $('#bhBoard');
const bhPegsEl     = $('#bhPegs');
const bhDisksEl    = $('#bhDisks');
const bhTipEl      = $('#bhTip');
const bhUndoBtn    = $('#bhUndo');
const bhRestartBtn = $('#bhRestart');
const bhQuitBtn    = $('#bhQuit');
const bhHeadActs   = $('#bhHeadActs');
const bhHeadAns    = $('#bhHeadActsAns');
const bhHeadPlay   = $('#bhHeadActsPlay');
const bhPlayPause  = $('#bhPlayPause');
const bhPlayStop   = $('#bhPlayStop');
const bhAgain2Btn  = $('#bhAgain2');
const bhRechoose2  = $('#bhRechoose2');
const bhOverlay    = $('#bhOverlay');
const bhOverTitle  = $('#bhOverlayTitle');
const bhOverText   = $('#bhOverlayText');
const bhOverlayOk  = $('#bhOverlayOk');
const bhOverlayAns = $('#bhOverlayAns');
const bhAnsStart   = $('#bhAnsStart');
const bhAnsNow     = $('#bhAnsNow');
const bhAgainBtn   = $('#bhAgain');
const bhRechooseEl = $('#bhRechoose');
const bhRestartDlg = $('#bhRestartConfirm');
const bhQuitDlg    = $('#bhQuitConfirm');
const bhRotBtn     = $('#bhRotBtn');
const bhRotLabel   = $('#bhRotLabel');

/* ---------- 常量 ---------- */
/* 可选的阶数（= 盘数）。3 阶 7 步，9 阶 511 步 —— 上限就放在 9：
   再多的话手机端三行摞起来一屏放不下，全靠滚动玩也别扭。 */
const BH_ORDERS    = [3, 4, 5, 6, 7, 8, 9];
const BH_DEF_ORDER = 3;

/* 九色盘：第 k 号盘用 BH_COLORS[k - 1]（1 号 = 最小那个）。
   ★ 原先做的是"同色系明暗渐变"，9 个盘摞在一起时相邻两块几乎分不出来
     （同一色相、明度只差一点点），所以改成一盘一色。
   ★ 白字落在浅色（黄、橙、绿、青、粉）上会糊，所以盘上的编号颜色
     不写死，由 bhInkOn 按底色亮度现算 —— 见下。 */
const BH_COLORS = [
  '#E21E1F',  // 1 号 · 红
  '#FC8D22',  // 2 号 · 橙
  '#FFD900',  // 3 号 · 黄（就是品牌黄）
  '#21B731',  // 4 号 · 绿
  '#29BFF1',  // 5 号 · 青
  '#2A67F5',  // 6 号 · 蓝
  '#6947F5',  // 7 号 · 紫
  '#FD5F90',  // 8 号 · 粉
  '#7B441D',  // 9 号 · 棕（最大）
];

/** 压在某个底色上的字该用黑还是白 —— 取对比度高的那个（WCAG 相对亮度）。
 *  黄底(0.69)和白字只有 1.5:1，根本看不清；换成近黑就是 14:1。
 *  阈值 0.34 是"白字够不够用"的分界：低于它白字才立得住。 */
function bhInkOn(hex) {
  const ch = i => parseInt(hex.slice(i, i + 2), 16) / 255;
  const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(ch(1)) + 0.7152 * lin(ch(3)) + 0.0722 * lin(ch(5));
  return L > 0.34 ? '#1a1a1a' : '#fff';
}

/* 三段式动画的各段时长（毫秒）。速度倍率再往上乘，见 bhAnimMove。 */
const BH_LIFT_MS  = 130;   // 抬起
const BH_SLIDE_MS = 190;   // 平移（再按横向距离补一点）
const BH_DROP_MS  = 150;   // 落下
const BH_REFLOW_MS = 320;  // 整盘重排（切横屏 / 撤销 / 重来）

/* 盘厚下限（放不下时会被 bhFitBoard 压到这个数）。
   再薄编号就快糊在盘上了，所以到此为止 —— 宁可让 9 阶在小屏上稍微超一点。 */
const BH_DH_MIN  = 12;

/* 对局中盘面底下那行提示。index.html 里预置的也是这一句，改文案两处一起改。 */
const BH_TIP = '点一根柱子拿起最上面的盘，再点另一根放下';
/* 盘面锁死（过关 / 放弃 / 演示完）时的兜底提示 —— 正常会先用 bhLockTip 里那句 */
const BH_TIP_LOCKED = '盘面已锁定 · 可以「再来一局」或「重选阶数」';

/* 「放不下」这条报错的 key：同一时刻只留一条，见 core.js 的 toast()。
   连点柱子时（每点一下都撞一次规矩）不收拾的话屏幕上一摞一样的气泡。 */
const BH_TOAST_DROP = 'bh-drop';

/* ---------- 状态 ---------- */
let bhN        = BH_DEF_ORDER;   // 选中的阶数（开局时定下来，局内不可改）
let bhPegs     = [[], [], []];   // 三根柱子，从底到顶；元素是盘的序号（1 = 最小）
let bhColors   = [];             // 第 k 号盘的底色，bhColors[k]
let bhDiskEls  = [];             // 第 k 号盘的 DOM，bhDiskEls[k]
let bhPegEls   = [];             // 三根柱子的 DOM
let bhMoves    = 0;              // 玩家自己走了多少步
let bhRoundNo  = 0;              // 第几局（只增不减，重来 / 换阶都算新的一局）
let bhUndoStack = [];            // 撤销栈：整局状态快照 [{ pegs, moves }, …]
let bhOver     = false;          // 盘面锁死（过关 / 放弃 / 演示中）
let bhHold     = 0;              // 手上举着的是第几号盘（0 = 没拿）
let bhHoldFrom = -1;             // 这个盘是从哪根柱子上拎起来的
let bhPlay     = null;           // 自动演示的播放器状态，非空 = 正在演示
let bhLockTip  = '';             // 盘面锁死时那行提示（过关 / 放弃 / 演示完各写一句，见 bhSyncHead）
let bhGeo      = null;           // 量出来的几何，见 bhMeasure
let bhDhCap    = 0;              // 本局盘厚的上限（0 = 不限制），由 bhFitBoard 定

/* ---------- 一、几何：量柱子 → 定位盘 ---------- */

/** 盘厚。阶数越高越薄：9 个盘摞起来要是按 3 阶那么厚，手机端三行能顶出屏幕。
 *  系数 2.2 是照着手机竖屏调的 —— 9 阶端到端算下来盘面约 664px，
 *  加顶栏和提示正好一屏放得下，不用滚着玩。
 *  ★ 屏幕再矮一点（小屏手机）时会由 bhFitBoard 再压一道，见 bhDhCap。 */
function bhNaturalDh() { return Math.max(14, Math.round(30 - (bhN - 3) * 2.2)); }
function bhDiskH() {
  const nat = bhNaturalDh();
  return bhDhCap ? Math.max(BH_DH_MIN, Math.min(nat, bhDhCap)) : nat;
}
/** 盘与盘之间的缝。盘一多就收一收，不然整摞虚高。
 *  横屏时纵向只剩"竖屏时的宽度"，比竖屏还挤，再收一格 ——
 *  9 阶就是靠这一格加下面那个柱尖，把整摞盘收进一屏的。 */
function bhDiskGap() {
  if (bhLandOn()) return bhN <= 5 ? 3 : 2;
  return bhN <= 5 ? 4 : 3;
}

/** 现在是不是"横排"（三根柱子并排）。
 *  ★ 只看 .bh-board 上的 is-flat 一个 class —— 谁决定它见 bhWantRow / bhSyncRow，
 *    这里不再自己判断第二遍，免得多出第二个真相来源。 */
function bhRowMode() { return bhBoardEl.classList.contains('is-flat'); }

/** 三根柱子该不该并排。三种来历：
 *    · 电脑端（viewport=lg）
 *    · 屏幕**本身就是横的**（手机/平板自己转过来了，aspect=wide）——
 *      这时候用户要的横排已经有了，不需要按按钮，更不需要再把界面转 90°
 *    · 手机端按了顶栏的「横屏」（bhLand）
 *  前两条是"环境本来如此"，第三条是"手动补一个旋转"。 */
function bhWantRow() {
  return document.documentElement.dataset.viewport === 'lg'
      || document.documentElement.dataset.aspect === 'wide'
      || bhLandOn();
}
function bhSyncRow() { bhBoardEl.classList.toggle('is-flat', bhWantRow()); }

/* ---------- 横屏：真把屏幕横过来 ----------
   做法是把整个工具页顺时针转 90°（css 里 #toolBrahma 那条），用户再把手机
   横过来看。关键在尺寸：转 90° 之后，"转之前的宽"会变成屏幕的高、"转之前的
   高"会变成屏幕的宽，所以要铺满整屏，盒子得按 **高 × 宽**（长短边对调）来排。
   盒子从 390 宽变成 844 宽，等于把整个界面等比例放大到长边上。 */
function bhLandOn() { return document.documentElement.classList.contains('bh-land'); }

/** 屏幕现在是躺着的（宽 ≥ 高）。这种时候旋转没有意义 —— 横排已经有了。 */
function bhIsWideScreen() {
  const el = document.documentElement;
  return (el.clientWidth || window.innerWidth) >= (el.clientHeight || window.innerHeight);
}

/** 把"转之前的盒子尺寸"写给 css 变量。放在 <html> 上：#toasts 是
 *  .tool-page 的兄弟节点，得共用同一组尺寸才能一起转。 */
function bhSyncLandVars() {
  const el = document.documentElement;
  if (!bhLandOn()) { el.style.removeProperty('--bh-land-w'); el.style.removeProperty('--bh-land-h'); return; }
  const vw = el.clientWidth  || window.innerWidth;
  const vh = el.clientHeight || window.innerHeight;
  el.style.setProperty('--bh-land-w', vh + 'px');   // 转完 = 屏幕的高
  el.style.setProperty('--bh-land-h', vw + 'px');   // 转完 = 屏幕的宽
}

/** 开 / 关横屏。on 传 true 但屏幕本来就躺着时，会自动改成关 —— 那种情况下
 *  用户什么都不用做，界面已经是横的了（见 bhWantRow 第二条）。 */
function bhSetLand(on) {
  if (on && bhIsWideScreen()) on = false;
  document.documentElement.classList.toggle('bh-land', on);
  bhSyncLandVars();
  bhSyncRow();       // 幂等：不管有没有真变，都照当前环境把 is-flat 摆正
  return on;
}

/** 把这一局的尺寸写成 CSS 变量（柱高、盘厚、缝）。
 *  柱高 = 整摞盘的高度 + 14（柱尖露一点点）；顺序不能反 —— 先写变量，再量，再摆盘。 */
function bhApplyVars() {
  const dh = bhDiskH(), gap = bhDiskGap();
  const stack = bhN * dh + (bhN - 1) * gap;
  const pole  = stack + (bhLandOn() ? 10 : 14);   // 柱尖露出一点点，横屏下少露 4px
  bhBoardEl.style.setProperty('--bh-dh', dh + 'px');
  bhBoardEl.style.setProperty('--bh-dgap', gap + 'px');
  bhBoardEl.style.setProperty('--bh-stack', stack + 'px');
  bhBoardEl.style.setProperty('--bh-pole', pole + 'px');
}

/** 对局中让盘面一定放得下一屏 —— 放不下就按缺口把盘压薄。
 *
 *  为什么要这么做：三根柱子竖着摞在手机上很高（9 阶尤其），一旦这一页能滚，
 *  点柱子就总带着"顺手把页面滑走"的风险 —— 落点跳来跳去，玩起来很难受。
 *  最干净的解法是让对局里干脆没得滚（再配合 bhSyncScrollLock 把滚动关掉），
 *  所以这里先把尺寸摁进一屏。
 *
 *  ★ 斜率不是 N+1 —— 这一点踩过坑：竖排时三根柱子是**上下摞着**的，
 *    盘面高度 = 3 根柱子 + 2 条缝，所以盘厚每涨 1px，盘面要长 3N+1；
 *    只有并排（电脑 / 横屏）时才是 N+1。按 N+1 去除会一口气多压三倍，
 *    7–9 阶平白薄了一截（实测 9 阶被压到 12，其实 15 就够）。 */
function bhFitBoard() {
  bhDhCap = 0;
  bhApplyVars();
  if (bhGame.hidden) return;                 // 选阶数那一屏本来就该能滚
  const slope = bhN * (bhRowMode() ? 1 : 3) + 1;
  // 三枪收敛：斜率准了第一枪就基本到位，后两枪只修取整残差。
  for (let pass = 0; pass < 3; pass++) {
    const over = bhBodyEl.scrollHeight - bhBodyEl.clientHeight;
    if (over <= 0) return;
    const cur = bhDiskH();
    if (cur <= BH_DH_MIN) return;
    const next = Math.floor(cur - (over + 1) / slope);
    if (next >= cur) return;
    bhDhCap = bhDhCap ? Math.min(bhDhCap, next) : next;
    bhApplyVars();
  }
}

/** 对局中（盘面放得下一屏）就把这一页的滚动关掉：手机上没有"滑一下"这回事，
 *  手指从盘上划过去就只可能是搬盘，不会再顺手把页面滚走、也不会误碰。
 *  真放不下时（小屏 + 高阶）就别锁 —— 宁可让用户滚着玩，也不能看不全。
 *  ★ 只在对局里锁；选阶数那一屏有规则和典故，必须能滚。
 *  ★ 选择器在 css 里是 `html.bh-lock #toolBrahmaBody`，只管这一页。 */
function bhSyncScrollLock() {
  const lock = !bhGame.hidden && bhBodyEl.scrollHeight <= bhBodyEl.clientHeight + 1;
  document.documentElement.classList.toggle('bh-lock', lock);
}

/** 量一次盘面。以 .bh-disks 这一层为原点（盘就摆在它里头），
 *  每根柱子记两组坐标：
 *    cx / top / bottom —— 柱子的中线、"柱顶"/底座上沿（盘层局部坐标，算盘位用）
 *    left / topAbs / right / bottomAbs —— 页面坐标矩形（判断手指点在哪根柱子上用）
 *  ★ 手机上三根柱子是上下三行，左右范围完全一样，只有上下分得开；
 *    电脑上正好反过来。所以命中判定必须整块矩形一起比，不能只看 x 或只看 y。
 *
 *  ★ 横屏（bh-land）下 cx / top / bottom 那一组得换算法，别再想着"化简"：
 *    整个工具页顺时针转了 90°，盘层的局部坐标轴跟着转 ——
 *      局部 x 轴 → 屏幕的 y 轴（向下）
 *      局部 y 轴 → 屏幕的 x 轴（向左）
 *    于是（o = .bh-disks 的屏幕矩形，转完之后它的"右边缘"就是局部 y 的原点）：
 *      局部 x = 屏幕 y - o.top         局部 y = o.right - 屏幕 x
 *    left/topAbs/right/bottomAbs 那四个数是给手指做命中判定的，用的是
 *    屏幕坐标，跟转不转无关 —— 照旧。
 *    （这一段推导见 css/tools.css 第十三节末尾那条注释的配图。） */
function bhMeasure() {
  const o = bhDisksEl.getBoundingClientRect();
  const land = bhLandOn();
  bhGeo = {
    pegs: bhPegEls.map(pel => {
      const pr = pel.getBoundingClientRect();
      const pl = pel.firstElementChild.getBoundingClientRect();   // 柱子本体
      const base = {
        left: pr.left, topAbs: pr.top, right: pr.right, bottomAbs: pr.bottom,
        // 柱子的"局部宽度"：竖排/横排都指柱子并排那一条边上的占位。
        // 横屏时屏幕上量到的是它的高，别直接拿 pr.width 当宽度用。
        wLocal: land ? (pr.bottom - pr.top) : (pr.right - pr.left),
      };
      return land ? Object.assign(base, {
        cx:     (pl.top + pl.bottom) / 2 - o.top,
        top:    o.right - pl.right,      // pl 右边缘 = 柱顶那一头（局部 y 最小）
        bottom: o.right - pl.left,
      }) : Object.assign(base, {
        cx:     pl.left - o.left + pl.width / 2,
        top:    pl.top - o.top,
        bottom: pl.bottom - o.top,
      });
    }),
  };
}

/** 第 k 号盘摆在"第 peg 根柱子的第 idx 层"时的位置（盘层局部坐标）。
 *  idx 从 0 起（0 = 最底下那层）。 */
function bhPosOn(peg, idx, k) {
  const g = bhGeo.pegs[peg];
  const w = bhDiskW(k);
  return {
    x: g.cx - w / 2,
    y: g.bottom - (idx + 1) * bhDiskH() - idx * bhDiskGap(),
  };
}

/** 盘的宽度：按卡片的比例算 —— 柱宽（手机端是整行宽）取一个比例当最宽的盘，
 *  最窄的给个下限，中间按序号线性插值。
 *  横排时柱子只有 1/3 宽，比例放到 0.9 让盘尽量铺满、看得清；
 *  竖排时柱子独占一行，0.72 就够宽了，留点边更好看。 */
function bhDiskW(k) {
  const pegW = bhGeo.pegs[0].wLocal;          // 局部宽度，横屏下 ≠ 屏幕宽度
  const wMax = pegW * (bhRowMode() ? 0.9 : 0.72);
  const wMin = wMax * 0.30;
  if (bhN <= 1) return Math.round(wMax);
  return Math.round(wMin + (k - 1) / (bhN - 1) * (wMax - wMin));
}

/** 抬起的高度：高过"源柱和目标柱里**更高**的那根柱顶"再一点点。
 *  这样横排时是从柱顶上方平平地飞过去，竖排时是先升到最高那根柱顶上方再落下去。
 *  ★ 至少留 2px：盘层从 .bh-board 的 padding 内沿起算，上面那点 padding
 *    就是给"抬起来的盘"留的（padding-top = 盘厚 + 4，见 css）。 */
function bhLiftY(a, b) {
  const t = Math.min(bhGeo.pegs[a].top, bhGeo.pegs[b].top);
  return Math.max(2, t - bhDiskH() - 2);
}

/** 摆到指定位置。dur = 0 就是"立刻到位"（切排版、缩放窗口时用，别让盘飞）。 */
function bhSetPos(el, x, y, dur) {
  el.style.transitionDuration = dur + 'ms';
  el.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
}

/** 第 k 号盘现在在哪根柱子的第几层 */
function bhWhere(k) {
  for (let p = 0; p < 3; p++) {
    const i = bhPegs[p].indexOf(k);
    if (i >= 0) return { peg: p, idx: i };
  }
  return { peg: 0, idx: 0 };
}

/** 重量一次几何，并把所有盘摆回"该在的地方"。
 *  切排版、缩放窗口、开新局、撤销、重来都走这里一个口子。
 *  animate = true 时盘会滑过去（切横屏那种整体重排，滑一下比瞬移好看）。 */
function bhLayout(animate) {
  // 盘厚 / 缝 / 柱高都同时取决于阶数和"竖摞还是并排"，所以每次重排都先写一遍
  // 变量、再量 —— 顺序反了量到的就是旧尺寸。切横屏也走这里，别只在开新局时写。
  // bhFitBoard 里面就带 bhApplyVars：它先按自然盘厚排一遍，装不下再压薄重写。
  bhFitBoard();
  bhMeasure();
  const dur = animate ? BH_REFLOW_MS : 0;
  for (let k = 1; k <= bhN; k++) {
    const el = bhDiskEls[k];
    const w  = bhDiskW(k) + 'px';
    if (el.style.width !== w) el.style.width = w;   // 宽度没变就别写，省一次重排
    const at = bhWhere(k);
    const p  = bhPosOn(at.peg, at.idx, k);
    if (bhHold === k) {
      // 手上举着的那个盘摆到抬起位，别按盘面坐标放
      el.classList.add('is-hold');
      bhSetPos(el, p.x, bhLiftY(at.peg, at.peg), dur);
    } else {
      el.classList.remove('is-hold');
      bhSetPos(el, p.x, p.y, dur);
    }
  }
  bhSyncScrollLock();
}

/* ---------- 二、动画：抬起 → 平移 → 落下 ---------- */

/** 把第 k 号盘从 (fromPeg, idxFrom) 挪到 (toPeg, idxTo)。
 *  三段各自设 transition-duration：先拎起来、横过去、再稳稳放下 ——
 *  比从 A 点直勾勾滑到 B 点像那么回事。
 *  ★ el._bhTok 是这只盘的"动画代次"：同一只盘上又叠了新动画时，
 *    旧的那串 setTimeout 认 token 不认人，会自己退出，不会把盘写回半路。 */
function bhAnimMove(k, fromPeg, idxFrom, toPeg, idxTo, speed, opt) {
  opt = opt || {};
  const el = bhDiskEls[k];
  const p0 = bhPosOn(fromPeg, idxFrom, k);
  const p1 = bhPosOn(toPeg, idxTo, k);
  const yl = bhLiftY(fromPeg, toPeg);
  const d  = m => Math.max(60, Math.round(m * speed));
  const tok = el._bhTok = (el._bhTok || 0) + 1;

  const lift  = d(BH_LIFT_MS);
  const slide = d(BH_SLIDE_MS + Math.min(140, Math.abs(p1.x - p0.x) * 0.35));
  const drop  = d(BH_DROP_MS);

  el.classList.add('is-hold');
  el.style.zIndex = '6';

  bhSetPos(el, p0.x, yl, lift);
  setTimeout(() => {
    if (el._bhTok !== tok) return;
    bhSetPos(el, p1.x, yl, slide);
    setTimeout(() => {
      if (el._bhTok !== tok) return;
      bhSetPos(el, p1.x, p1.y, drop);
      setTimeout(() => {
        if (el._bhTok !== tok) return;
        el.style.zIndex = '';
        el.classList.remove('is-hold');
        if (opt.done) opt.done();
      }, drop);
    }, slide + 8);
  }, lift + 8);
}

/* ---------- 三、渲染 ---------- */

/** 按当前阶数铺一遍盘面：三根柱子 + 若干个盘 + 九色分配。
 *  只在开新局时调用 —— 局内盘只挪位置，DOM 一个都不动。 */
function bhBuildBoard() {
  bhPegsEl.innerHTML = '';
  bhPegEls = [];
  for (let i = 0; i < 3; i++) {
    const peg = document.createElement('div');
    peg.className = 'bh-peg';
    const pole = document.createElement('div');
    pole.className = 'bh-pole';
    peg.appendChild(pole);
    bhPegsEl.appendChild(peg);
    bhPegEls.push(peg);
  }

  // 一盘一色：1 号盘拿第 1 个色……最多到 9 号盘，正好用满九个
  bhColors = new Array(bhN + 1);
  for (let k = 1; k <= bhN; k++) bhColors[k] = BH_COLORS[k - 1];

  bhDisksEl.innerHTML = '';
  bhDiskEls = new Array(bhN + 1);
  for (let k = 1; k <= bhN; k++) {
    const d = document.createElement('div');
    d.className = 'bh-disk';
    d.dataset.k = String(k);
    d.style.background = bhColors[k];
    const ink = bhInkOn(bhColors[k]);       // 浅底上换成近黑，编号才不糊
    d.style.color = ink;
    d.style.textShadow = ink === '#fff' ? '0 1px 1px rgba(0,0,0,.18)' : 'none';
    d.textContent = String(k);              // 编号兜底：颜色只看"不一样"，大小还得看数字
    bhDisksEl.appendChild(d);
    bhDiskEls[k] = d;
  }
}

/** 盘面回到开局（整摞在第一根柱子上，大盘在下） */
function bhPegsOpening() {
  const a = [[], [], []];
  for (let k = bhN; k >= 1; k--) a[0].push(k);
  return a;
}

function bhRenderMeta() {
  bhRoundEl.textContent = '第 ' + bhRoundNo + ' 局';
  if (bhPlay) {
    bhMetaEl.textContent = '演示中 · 第 ' + bhPlay.i + ' / ' + bhPlay.moves.length + ' 步';
    bhMetaEl.classList.remove('over');
    return;
  }
  const best = Math.pow(2, bhN) - 1;
  let s = bhN + ' 阶 · 已用 ' + bhMoves + ' 步 · 最优 ' + best + ' 步';
  const over = !bhOver && bhMoves > best;
  if (over) s += '（已超出 ' + (bhMoves - best) + ' 步）';
  bhMetaEl.textContent = s;
  // 超出最优只在外观上提醒一下，不弹框、不拦人 —— 绕远了也算过关
  bhMetaEl.classList.toggle('over', over);
}

/* ---------- 四、规则 ---------- */

const bhTop = p => bhPegs[p].length ? bhPegs[p][bhPegs[p].length - 1] : 0;

/** 能不能把 from 那根柱子上最上面的盘搬到 to。小盘压大盘可以，反过来不行。 */
function bhCanMove(from, to) {
  if (from === to || from < 0 || to < 0) return false;
  if (!bhPegs[from].length) return false;
  const t = bhTop(to);
  return !t || bhTop(from) < t;
}

const bhIsWin = () => bhPegs[2].length === bhN;

/** 真搬一步：改状态 + 播动画 + 记步数。
 *  opt.count === false 时不记进玩家的步数（自动演示就是这种）。 */
function bhDoMove(from, to, opt) {
  opt = opt || {};
  const k       = bhPegs[from][bhPegs[from].length - 1];
  const idxFrom = bhPegs[from].length - 1;
  bhPegs[from].pop();
  bhPegs[to].push(k);
  const idxTo = bhPegs[to].length - 1;
  bhAnimMove(k, from, idxFrom, to, idxTo, opt.speed || 1, opt);
  if (opt.count !== false) bhMoves++;
  bhRenderMeta();
  return k;
}

function bhPushUndo() {
  bhUndoStack.push({ pegs: bhPegs.map(a => a.slice()), moves: bhMoves });
  if (bhUndoStack.length > 600) bhUndoStack.shift();   // 9 阶最优 511 步，留个头
}

/* ---------- 五、任意局面 → 终点的最短走法 ----------
   ★ 标准三柱汉诺塔"最优解唯一"，但那说的是**从开局起步**。
     玩家走到一半、盘子散在别处时，剩下一段的最短路得现算 ——
     不能拿 2ⁿ−1 硬套（已经走歪的盘面，剩下的步数可能比 2ⁿ−1 还多）。
     做法是经典递归，O(n)，一次请求不发：

       solve(k)：把 1..k 号盘从现在的局面走到目标（全在第 3 根柱）
         · s[k] 已经在第 3 根 → 大盘不用动，问题缩到 1..k−1
         · 否则大盘至少要动一次：先把 1..k−1 全挪到"另外那根"（gather），
           把 k 号盘搬过去，最后把那摞小的从那儿整摞搬回第 3 根（perfect）

     gather(m, k)：把 1..k 全挪到 m 柱（它们现在散在各处）
     perfect(a, b, k)：把已经摞成一摞的 1..k 从 a 整摞搬到 b（标准最优解）
     三个都是同一个递归，合起来不超过 3n 层，9 阶也就是几十次调用。

   ★ 只记 [from, to]，不记盘号 —— 两根柱子之间能走的盘是唯一确定的
     （小的压大的，只有那一个合法），搬的时候现算就是了。 */
function bhSolve(srcPegs) {
  const s = new Array(bhN + 1);
  for (let p = 0; p < 3; p++) for (const k of srcPegs[p]) s[k] = p;
  const out = [];
  const GOAL = 2;

  const perfect = (from, to, k) => {
    if (k <= 0) return;
    const aux = 3 - from - to;
    perfect(from, aux, k - 1);
    out.push([from, to]);
    perfect(aux, to, k - 1);
  };
  const gather = (m, k) => {
    if (k <= 0) return;
    if (s[k] === m) { gather(m, k - 1); return; }
    const t = 3 - s[k] - m;
    gather(t, k - 1);          // 先把它上面那些都挪到第三根去
    out.push([s[k], m]);       // 再搬它
    s[k] = m;
    perfect(t, m, k - 1);      // 最后把那摞整摞搬过来
  };
  const solve = k => {
    if (k <= 0) return;
    if (s[k] === GOAL) { solve(k - 1); return; }
    const m = 3 - s[k] - GOAL;
    gather(m, k - 1);
    out.push([s[k], GOAL]);
    s[k] = GOAL;
    perfect(m, GOAL, k - 1);
  };
  solve(bhN);
  return out;
}

/* ---------- 六、自动演示（从头播 / 从当前接着走） ---------- */

/** 演示的快慢：步数越多走得越快。
 *  3–4 阶慢慢演（看清每一步），9 阶 511 步就得快一点，不然要看五分钟。 */
function bhPlaySpeed() {
  if (bhN <= 4) return 1;
  if (bhN <= 6) return 0.72;
  return 0.5;
}

function bhPlayStart(moves, tip) {
  if (!moves.length) {
    toast('ok', '已经在终点了', '这些盘已经全在最后一根柱子上');
    return;
  }
  bhPlayStopNow();
  bhCancelHold();
  bhOver = true;
  bhPlay = { moves, i: 0, paused: false, timer: null, speed: bhPlaySpeed() };
  bhSyncHead();
  bhPlayPause.textContent = '暂停';
  bhTipEl.textContent = tip;
  bhRenderMeta();
  bhPlayStep();
}

function bhPlayStep() {
  if (!bhPlay) return;
  if (bhPlay.i >= bhPlay.moves.length) { bhPlayEnd(false); return; }
  const mv = bhPlay.moves[bhPlay.i];
  bhPlay.i++;
  bhRenderMeta();
  const sp = bhPlay.speed;
  bhDoMove(mv[0], mv[1], {
    count: false,
    speed: sp,
    done: () => {
      if (!bhPlay || bhPlay.paused) return;
      bhPlay.timer = setTimeout(bhPlayStep, Math.round(50 * sp));
    },
  });
}

/** 收起播放器（不动顶栏，由调用方决定后面显示哪一组按钮） */
function bhPlayStopNow() {
  if (bhPlay) { clearTimeout(bhPlay.timer); bhPlay = null; }
}

/** 演示结束 / 被停掉：顶栏换成「再来一局 / 重选阶数」，盘面留着 */
function bhPlayEnd(stopped) {
  bhPlayStopNow();
  bhLockTip = stopped
    ? '演示已停止 · 可以「再来一局」或「重选阶数」'
    : '演示结束 · 可以「再来一局」或「重选阶数」';
  bhSyncHead();
  bhRenderMeta();
  if (!stopped) toast('ok', '演示结束', '这就是这条路上最少的走法');
}

/* ---------- 七、交互：点选 ----------
   ★ 搬盘只有一条路：点柱子拿起最上面的盘 → 再点一根柱子放下。
     从前还能"按住直接拖"，2026-10-15 删掉了 —— 盘面小、柱子热区大，
     拖拽在手机上要跟翻页抢手势、手指一抖就落错柱子；点选稳得多，
     也不用在 pointermove 里每帧换算坐标、跟 pointercancel 打交道。
   ★ 所以这里**没有** move 手势：每次 pointerdown 量一次几何、按坐标判一次
     "点在哪根柱子上"，这一下就办完了，之后再不看指针。
     旧习惯改不过来的（按住就想拖）：那一下只是把盘拿起来（盘举在原地、
     不跟手指走），接着点一下目标柱子照旧放得下 —— 不会落错地方，也没白按。
   ★ 不调 setPointerCapture —— 一旦捕获，后面 pointerup / click 的 e.target
     就变成被捕获的那个元素了，判断"点在哪个盘上"会失真（这个坑异或法则
     那页已经踩过）。所以命中一律按坐标算，谁最近算谁。 */

/** 手指/鼠标点在哪根柱子上（离得太远算没点着）。
 *  ★ 手机上三根柱子是上下三行、左右范围一模一样，只有电脑上才左右分开，
 *    所以这里整块矩形一起比，不能只看 x 或只看 y。 */
function bhPegAt(cx, cy) {
  if (!bhGeo) return -1;
  let best = -1, bestD = Infinity;
  bhGeo.pegs.forEach((g, i) => {
    const dx = Math.max(g.left - cx, 0, cx - g.right);
    const dy = Math.max(g.topAbs - cy, 0, cy - g.bottomAbs);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = i; }
  });
  return bestD <= 44 ? best : -1;
}

/** 把"手上这个盘能放上去的柱子"淡淡描一圈（落点提示）。
 *  从前拖拽是"手指划过哪根就亮哪根"，现在没有"划过"这回事了 ——
 *  改成拿起盘的那一下，把所有能放的位置一次点亮。
 *  ★ 手上没盘就全灭 —— 它只表示"现在能放哪儿"。 */
function bhSyncOver() {
  bhPegEls.forEach((el, i) => el.classList.toggle('is-over',
    !!bhHold && bhHoldFrom >= 0 && i !== bhHoldFrom && bhCanMove(bhHoldFrom, i)));
}

function bhShakePeg(p) {
  const el = bhPegEls[p];
  if (!el) return;
  el.classList.remove('is-shake');
  void el.offsetWidth;                 // 逼一次重排，动画才能重放
  el.classList.add('is-shake');
  setTimeout(() => el.classList.remove('is-shake'), 360);
}

/** 从第 p 根柱子上把最上面那个盘拎起来 */
function bhPickUp(p) {
  const k = bhPegs[p][bhPegs[p].length - 1];
  bhHold = k;
  bhHoldFrom = p;
  const el = bhDiskEls[k];
  const w  = bhDiskW(k);
  const g  = bhGeo.pegs[p];
  el.classList.add('is-hold');
  el.style.zIndex = '6';
  bhSetPos(el, g.cx - w / 2, bhLiftY(p, p), 150);
  bhSyncOver();
}

/** 把拎起来的盘放回原处（取消这次操作） */
function bhCancelHold() {
  if (!bhHold) return;
  bhHold = 0;
  bhHoldFrom = -1;
  bhSyncOver();
  bhLayout(true);
}

/** 把拎起来的盘放到第 to 根柱子上（调用前已经确认合法） */
function bhCommitTo(to) {
  const from = bhHoldFrom;
  const k = bhHold;
  bhHold = 0;
  bhHoldFrom = -1;
  bhSyncOver();
  bhDiskEls[k].classList.remove('is-hold');
  bhDiskEls[k].style.zIndex = '';
  bhPushUndo();
  bhDoMove(from, to, {
    count: true,
    done: () => { if (bhIsWin()) bhWin(); },
  });
}

/** 点在盘面上：手上没盘就拿起最上面那个，有盘就放下（或告诉他放不下）。
 *  ★ 用 pointerdown 而不是 click：按下就拎起来，反馈即时；
 *    点选不用等"抬手才知道这是不是拖"，所以这一下就能办完。
 *  ★ 空柱子静默忽略 —— 别报错也别抖。手机上手指蹭过柱子是常事，
 *    每蹭一下弹一句"这根柱子上没有盘"能把人烦死，而且那本来也不是误操作。 */
function bhOnDown(e) {
  if (bhOver || bhPlay) return;
  if (e.button != null && e.button !== 0) return;   // 只认左键 / 单指
  bhMeasure();                                      // 每次按下量一次（中途可能滚过页）

  // ★ 点在"正举着的那只盘"身上 = 把它放回去。
  //   必须专门判这一下：举起来的盘浮在原柱子上方，竖排时正好压在**上一根**
  //   柱子的下缘里，光按坐标算会把它算成"搬到上一根柱子去"，白走一步。
  if (bhHold && e.target === bhDiskEls[bhHold]) { bhCancelHold(); return; }

  const p = bhPegAt(e.clientX, e.clientY);
  if (p < 0) return;                                // 点在盘面外：接着举着，不理

  if (!bhHold) {
    if (!bhPegs[p].length) return;                  // 空柱子：什么也不做
    bhPickUp(p);
    return;
  }
  if (p === bhHoldFrom) { bhCancelHold(); return; }  // 再点原来那根 = 放回去
  if (bhCanMove(bhHoldFrom, p)) { bhCommitTo(p); return; }
  bhShakePeg(p);
  // ★ 带 key：连着撞规矩时屏幕上只留最新那一条，不叠成一摞（见 core.js 的 toast）
  toast('err', '放不下', '大盘不能压在小盘上', BH_TOAST_DROP);
}

/* ---------- 八、流程 ---------- */

function bhCloseConfirms() {
  bhRestartDlg.classList.remove('show');
  bhQuitDlg.classList.remove('show');
}

/** 按当前状态把顶栏那一组按钮 + 盘面底下那行提示语摆正。
 *
 *  三种状态互斥，该谁露面只看状态：
 *    · 自动演示中（bhPlay）→ 「暂停 / 停止」
 *    · 盘面锁死（bhOver）  → 「再来一局 / 重选阶数」
 *    · 对局中（其余）      → 「撤销 / 重来 / 放弃」
 *
 *  ★ 进卡片（tool:open）时必须照它摆一次。以前那段写的是
 *    `bhHeadAns.hidden = bhOver` 再加 `bhHeadActs.hidden = bhOver` ——
 *    bhOver 为真时**两组按钮一起被藏起来**，于是
 *    「过关 → 点确定 → 返回主页 → 再进这张卡片」整页只剩顶栏那个「横屏」，
 *    盘面锁着、一个按钮都没有，局面再也接不下去。
 *  ★ 提示语也一起摆：锁死的盘面还写着"点一根柱子拿起最上面的盘"是骗人的，
 *    这时候点哪儿都没反应。 */
function bhSyncHead() {
  if (bhPlay) {
    bhHeadPlay.hidden = false;
    bhHeadActs.hidden = true;
    bhHeadAns.hidden  = true;
    return;
  }
  bhHeadPlay.hidden = true;
  bhHeadActs.hidden = !!bhOver;
  bhHeadAns.hidden  = !bhOver;
  bhTipEl.textContent = bhOver ? (bhLockTip || BH_TIP_LOCKED) : BH_TIP;
}

/** 顶栏那个「横屏 / 竖屏」按钮。
 *  电脑端藏掉（本来就是并排）；屏幕自己已经躺着的也藏掉 ——
 *  那种情况盘面已经是并排的，按下这个按钮什么也不会发生，留着只会让人犯嘀咕。
 *  文案和 aria-pressed 都跟着 bh-land 这个类走。 */
function bhSyncRotBtn() {
  const lg  = document.documentElement.dataset.viewport === 'lg';
  const on  = bhLandOn();
  bhRotBtn.hidden = lg || bhGame.hidden || bhIsWideScreen();
  bhRotLabel.textContent = on ? '竖屏' : '横屏';
  bhRotBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function bhNewRound(n) {
  bhCloseConfirms();
  bhPlayStopNow();
  bhN = n;
  bhRoundNo++;
  bhBuildBoard();
  bhPegs      = bhPegsOpening();
  bhMoves     = 0;
  bhUndoStack = [];
  bhOver      = false;
  bhHold      = 0;
  bhHoldFrom  = -1;
  bhSyncOver();                // 柱子刚重建过，顺手把落点高亮清干净
  bhLockTip   = '';            // 新一局：把上局锁死时那句提示忘掉
  bhApplyVars();
  bhSyncHead();

  bhOverlay.hidden = true;
  bhSetup.hidden = true;
  bhGame.hidden = false;

  bhSyncRow();          // 并排还是竖摞，按当前环境（电脑 / 屏幕是横的 / 按了横屏）定
  bhSyncLandVars();
  bhLayout(false);
  // 下一帧再量一次：盘面刚从 display:none 出来，稳妥起见补一枪（位置不变，不会闪）
  requestAnimationFrame(() => bhLayout(false));

  bhRenderMeta();
  bhSyncRotBtn();
  Array.prototype.forEach.call(bhOrdersEl.children, b => {
    b.classList.toggle('on', +b.dataset.order === n);
  });
}

function bhShowSetup() {
  bhCloseConfirms();
  bhPlayStopNow();
  bhCancelHold();
  bhOver = false;
  // 回到选阶数就把横屏关掉：那是一次"看盘面"的临时切换，
  // 换一局重新开始还按上次的方向来，反而容易搞不清现在是什么排法。
  // （横屏状态就存在 <html> 的 .bh-land 这一个 class 上，没有第二处状态；
  //   bhSetLand 会顺手把 is-flat 重算一遍，屏幕本来就是横的仍然保持并排。）
  bhSetLand(false);
  bhOverlay.hidden = true;
  bhGame.hidden = true;
  bhSetup.hidden = false;
  bhDhCap = 0;                 // 回设置页就把"压薄的盘"忘掉，下一局重新算
  bhSyncScrollLock();          // 设置页有规则和典故，得能滚 —— 顺手解掉对局那道的锁
  bhSyncRotBtn();
}

/* 撤销：整局快照回退一格。
   如果退回去和现在只差一步（普通搬盘），就走三段式动画；差得多（撤销"重来"）
   就整体重排。两者在观感上都是"盘自己滑回去"。 */
function bhReverse(cur, prev) {
  let n = 0, disk = 0, from = -1, to = -1;
  for (let k = 1; k <= bhN; k++) {
    const a = bhWhereIn(cur, k), b = bhWhereIn(prev, k);
    if (a !== b) { n++; disk = k; from = a; to = b; }
  }
  return n === 1 ? { k: disk, from, to } : null;
}
function bhWhereIn(pegs, k) {
  for (let p = 0; p < 3; p++) if (pegs[p].indexOf(k) >= 0) return p;
  return 0;
}

function bhUndo() {
  if (bhOver || bhPlay) return;
  if (!bhUndoStack.length) {
    toast('ok', '没有可撤销的了', '盘面已经是开局的样子');
    return;
  }
  const entry = bhUndoStack.pop();
  const prev  = entry.pegs;
  const rev   = bhReverse(bhPegs, prev);
  if (rev) {
    const idxFrom = bhPegs[rev.from].length - 1;
    const idxTo   = prev[rev.to].length - 1;
    bhPegs  = prev.map(a => a.slice());
    bhMoves = entry.moves;
    bhAnimMove(rev.k, rev.from, idxFrom, rev.to, idxTo, 1);
    bhRenderMeta();
  } else {
    bhPegs  = prev.map(a => a.slice());
    bhMoves = entry.moves;
    bhLayout(true);
    bhRenderMeta();
  }
}

function bhRestart() {
  bhCloseConfirms();
  bhPlayStopNow();
  bhCancelHold();
  bhPushUndo();
  bhPegs  = bhPegsOpening();
  bhMoves = 0;
  bhOver  = false;
  bhSyncHead();
  bhLayout(true);
  bhRenderMeta();
  toast('ok', '已重来', '所有盘都搬回第一根柱子上');
}

function bhWin() {
  bhOver = true;
  bhCancelHold();
  const best = Math.pow(2, bhN) - 1;
  bhOverTitle.textContent = '过关！';
  bhOverText.textContent = bhN + ' 个盘全搬到最后一根柱子上了，用了 ' + bhMoves + ' 步'
    + (bhMoves === best
        ? ' —— 正好是最少的 ' + best + ' 步，走得漂亮。'
        : '（最少只要 ' + best + ' 步，多走了 ' + (bhMoves - best) + ' 步）。');
  bhOverlayOk.hidden = false;      // 「确认」只在过关时给
  bhOverlayAns.hidden = true;
  bhOverlay.hidden = false;
  bhRenderMeta();
}

function bhAbandon() {
  bhOver = true;
  bhCancelHold();
  bhLockTip = '盘面已锁定 · 想看得自己点一下（从头演示 / 从当前接着走）';
  bhOverTitle.textContent = '已放弃这一局';
  bhOverText.textContent = '想看的话，可以让它从头演示一遍，也可以按你现在的盘面接着走完。';
  bhOverlayOk.hidden = true;
  bhOverlayAns.hidden = false;
  bhOverlay.hidden = false;
  bhRenderMeta();
}

/** 过关浮层上点「确认」：收掉浮层，把**玩家自己搬出来的**盘面留在眼前。
 *  盘已经锁死，顶栏换成「再来一局 / 重选阶数」—— 这是他自己解的，原样看着就好。 */
function bhEnterSolvedView() {
  bhCloseConfirms();
  bhOverlay.hidden = true;
  bhOver = true;
  bhLockTip = '这是你自己搬出来的 · 盘已锁定，可以「再来一局」或「重选阶数」';
  bhSyncHead();
  bhRenderMeta();
}

/* 从头演示：退回开局，播 2ⁿ−1 步的标准最优解。
   这是一次"看答案"，不进撤销栈（不是玩家走的一步）。 */
function bhDemoFromStart() {
  bhOverlay.hidden = true;
  bhPlayStopNow();
  bhCancelHold();
  bhPegs  = bhPegsOpening();
  bhMoves = 0;
  bhOver  = true;
  bhLayout(false);
  bhRenderMeta();
  bhPlayStart(bhSolve(bhPegs), '从头演示最短的一条走法');
}

/* 从当前接着走：按玩家现在摆在哪儿，现算一条到终点的最短路续播。
   ★ 已经走歪的盘面，这条路的步数不一定等于 2ⁿ−1 —— 由 bhSolve 现算。 */
function bhDemoFromNow() {
  bhOverlay.hidden = true;
  bhPlayStopNow();
  bhCancelHold();
  bhOver = true;
  const moves = bhSolve(bhPegs);
  if (!moves.length) {
    toast('ok', '已经在终点了', '这些盘已经全在最后一根柱子上');
    bhLockTip = '这些盘已经全在最后一根柱子上了 · 可以「再来一局」或「重选阶数」';
    bhSyncHead();
    return;
  }
  bhPlayStart(moves, '按你现在的盘面往下走，共 ' + moves.length + ' 步');
}

/* ---------- 九、事件绑定 ---------- */

bhOrdersEl.addEventListener('click', e => {
  const btn = e.target.closest('.bh-order');
  if (!btn) return;
  bhN = +btn.dataset.order;
  Array.prototype.forEach.call(bhOrdersEl.children, b => b.classList.toggle('on', b === btn));
});

bhStartBtn.addEventListener('click', () => bhNewRound(bhN));
bhUndoBtn.addEventListener('click', bhUndo);

bhRestartBtn.addEventListener('click', () => {
  if (bhOver || bhPlay) return;
  // 一步都没走过就不弹框了，只提示一句（照数桥那条规矩）
  if (!bhMoves && !bhUndoStack.length) {
    toast('ok', '本来就还没动过', '盘面就是开局的样子');
    return;
  }
  bhRestartDlg.classList.add('show');
});

bhQuitBtn.addEventListener('click', () => {
  if (bhOver || bhPlay) return;
  bhQuitDlg.classList.add('show');
});

/* 二次确认的两个框：套同一个壳，只差"问什么、点了干什么" */
function bhWireConfirm(el, onOk) {
  el.querySelector('.acts .danger').addEventListener('click', () => {
    el.classList.remove('show');
    onOk();
  });
  el.querySelector('.acts button:not(.danger)')
    .addEventListener('click', () => el.classList.remove('show'));
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); });
}
bhWireConfirm(bhRestartDlg, bhRestart);
bhWireConfirm(bhQuitDlg, bhAbandon);

/* Esc：先关确认框，而不是把整个功能页退掉。
   挂在 window 的**捕获阶段** —— 捕获是从 window 往下走，所以这里比
   tools.js 挂在 document 捕获阶段那个"Esc = 返回"先跑，拦下之后 tools.js
   就收不到了。顺带：有盘拎在手上就放回去，正在演示就停掉。 */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!bhPage.classList.contains('show')) return;
  if (bhRestartDlg.classList.contains('show') || bhQuitDlg.classList.contains('show')) {
    e.stopPropagation();
    e.preventDefault();
    bhCloseConfirms();
    return;
  }
  if (bhHold) { e.stopPropagation(); bhCancelHold(); return; }
  if (bhPlay) { e.stopPropagation(); bhPlayEnd(true); return; }
}, true);

bhOverlayOk.addEventListener('click', bhEnterSolvedView);
bhAnsStart.addEventListener('click', bhDemoFromStart);
bhAnsNow.addEventListener('click', bhDemoFromNow);
bhAgainBtn.addEventListener('click', () => bhNewRound(bhN));
bhRechooseEl.addEventListener('click', bhShowSetup);
bhAgain2Btn.addEventListener('click', () => bhNewRound(bhN));
bhRechoose2.addEventListener('click', bhShowSetup);

bhPlayPause.addEventListener('click', () => {
  if (!bhPlay) return;
  bhPlay.paused = !bhPlay.paused;
  bhPlayPause.textContent = bhPlay.paused ? '继续' : '暂停';
  if (bhPlay.paused) clearTimeout(bhPlay.timer);
  else bhPlayStep();
});
bhPlayStop.addEventListener('click', () => { if (bhPlay) bhPlayEnd(true); });

/* 「横屏」= 整个工具页顺时针转 90°，用户把手机横过来看（不转手机就只能歪着头）。
   转完坐标系整个换了一套，所以盘必须重新量、重新摆 —— 而且**不带动画**：
   屏幕转动本来就是一瞬的事（跟手机自己转屏一个观感），这时盘还在慢慢滑反而怪。
   ★ 转完不弹提示：界面自己整个转过去了，就是最清楚的反馈；
     为此再弹一条"已转成横屏"是多余的一下。 */
bhRotBtn.addEventListener('click', () => {
  const want = !bhLandOn();
  if (want && bhIsWideScreen()) {
    toast('ok', '屏幕已经是横的', '直接把手机横过来就好，盘面已经是并排的');
    return;
  }
  bhSetLand(want);
  bhLayout(false);
  bhSyncRotBtn();
});

/* 盘面：一下 pointerdown 就把事情办完（拿起 / 放下）。
   底格和盘是兄弟节点（.bh-pegs / .bh-disks），挂在这层才一次都收得到。 */
bhBoardEl.addEventListener('pointerdown', bhOnDown);
/* 手势被浏览器收走时（手指其实是想翻页，不是想搬盘）把举着的盘放回去。
   ★ 只在对局里、且盘面真的没锁住时才会发生（见 bhSyncScrollLock）。 */
bhBoardEl.addEventListener('pointercancel', bhCancelHold);

/* 退出这一页时把手上的盘放下、把演示停掉，免得下次进来是个半路状态。
   ★ 横屏也一并收掉：.bh-land 挂在 <html> 上，留着的话提示层（#toasts）
     在别的页面里也一直歪着。用 MutationObserver 盯 .show 的增减，
     返回键和 Esc 两条退出路径就都盖住了（tools.js 没有 close 事件可听）。 */
let bhWasShown = false;
const bhLeaveCleanup = () => {
  // 演示演到一半就走：也算"演示停了"，下次进来那句话才对得上
  if (bhPlay) bhLockTip = '演示已停止 · 可以「再来一局」或「重选阶数」';
  bhPlayStopNow();
  bhHold = 0;
  bhHoldFrom = -1;
  bhSyncOver();              // 半路退出可能留着落点高亮，一起收掉
  bhSetLand(false);
  document.documentElement.classList.remove('bh-lock');   // 别把"不滚"留给别的页
};
new MutationObserver(() => {
  const shown = bhPage.classList.contains('show');
  if (bhWasShown && !shown) bhLeaveCleanup();
  bhWasShown = shown;
}).observe(bhPage, { attributes: true, attributeFilter: ['class'] });

/* 缩放 / 转屏：几何全变了，重量一次。Device 的 data-viewport 更新挂在
   rAF 上（core.js 先注册，排在前头），所以这里也排一帧，读到的就是新档位。 */
let bhResizeRaf = null;
window.addEventListener('resize', () => {
  if (bhResizeRaf) return;
  bhResizeRaf = requestAnimationFrame(() => {
    bhResizeRaf = null;
    // 用户把手机真的转过来了（屏幕自己变横）→ 横屏交还给"环境本来如此"：
    // 这时候再转 90° 反而是歪的，而且盘面已经是并排的了。
    if (bhLandOn() && bhIsWideScreen()) bhSetLand(false);
    bhSyncLandVars();          // 视口尺寸变了，转之前的盒子也得跟着变
    bhSyncRow();
    if (bhPage.classList.contains('show') && !bhGame.hidden) bhLayout(false);
    bhSyncScrollLock();
    bhSyncRotBtn();
  });
}, { passive: true });

/* ---------- 十、初始化 ---------- */
bhSyncRotBtn();

/* 进来时按需要补一次：第一次进来停在"选阶数"，之后保持上次的样子。
   功能页是 display:none 的，藏起来的时候量出来全是 0，
   所以每次进来都得重量一次几何。 */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== bhPage) return;
  bhPlayStopNow();
  bhHold = 0;
  bhHoldFrom = -1;
  bhSyncOver();
  bhSyncRow();
  bhSyncLandVars();
  if (!bhGame.hidden) {
    // 顶栏 / 提示语按当前状态摆正 —— 上次如果是"盘面锁死"（过关 / 放弃 / 演示完），
    // 这里给的就是「再来一局 / 重选阶数」。见 bhSyncHead 的注释：以前这里把
    // 两组按钮一起藏起来，导致再进来整页只剩一个「横屏」按钮、接不下去。
    bhSyncHead();
    bhLayout(false);
    requestAnimationFrame(() => bhLayout(false));
  }
  bhSyncScrollLock();
  bhSyncRotBtn();
});
