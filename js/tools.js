/* ==========================================================================
   tools.js —— 功能页（格式转换等）
   依赖 core.js 提供的 $ / $$（本文件在它之后加载）

   现在功能页是一张白屏占位，只处理「进入 / 返回」。
   新增功能时：在 index.html 里加一个 .tool-page（配好 id），
   再到下面的 TOOLS 里登记一行即可，其余不用改。
   ========================================================================== */

/* 功能登记表：data-tool 的值 → 对应页面的 id
   加一张卡片只要两处对齐：这里的 key = 卡片的 data-tool = 页面 id。
   （卡片维护那边不用管，这个文件是从 DOM 现读 [data-tool] 的） */
const TOOLS = {
  convert:  'toolConvert',
  points24: 'toolPoints24',
  units:    'toolUnits',
  graph:    'toolGraph',
  roman:    'toolRoman',
  xor:      'toolXor',
  magic:    'toolMagic',
  bash:     'toolBash',
  brahma:   'toolBrahma',
  fourcolor:'toolFourColor',
  game2048: 'toolGame2048',
  morse:    'toolMorse',
  bridge:   'toolBridge',
  sl:       'toolSl',
  queen:    'toolQueen',
  hamming:  'toolHamming',
  lights:   'toolLights',
  /* 囚徒困境：★ 它不是"做完了的功能"，是一道藏起来的门 ——
     卡片照旧挂「开发中」，但点得进来（三关问答 + 彩蛋，见 js/prisoner.js）。
     所以它不能留在下面的 WIP_TOOLS 里：那一层是捕获阶段拦截，会把点击吃掉。 */
  prisoner: 'toolPrisoner',
};

/* ---------- 开发中、点不进去的卡片 ----------
   卡片在 index.html 里已经画成「下线卡片」的样子
   （.tool-btn.is-maintenance + 名字后面挂「开发中」），
   点它只弹一句提示：既没有页面，也没有任何放行的路子。
   放**捕获阶段**并 stopPropagation：把下面那个入口点击挡在外面 ——
   就算哪天 TOOLS 里又把它加回去，这层也拦得住。
   （方格生灭 / 三门之惑 / 位移之秘 —— 囚徒困境已从这里摘掉，见 TOOLS 里那条注释） */
const WIP_TOOLS = {
  life:     '方格生灭',
  monty:    '三门之惑',
  caesar:   '位移之秘',
};

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-tool]');
  if (!btn) return;
  const name = WIP_TOOLS[btn.dataset.tool];
  if (!name) return;
  e.preventDefault();
  e.stopPropagation();
  toast('info', `「${name}」处于开发中，暂时不可使用`);
}, true);

/** 取当前打开着的功能页（没有则 null） */
function currentToolPage() {
  return document.querySelector('.tool-page.show');
}

/** 打开某个功能页 */
function openTool(key) {
  const id = TOOLS[key];
  if (!id) return;
  const page = document.getElementById(id);
  if (!page) return;
  page.classList.add('show');
  // 广播一下"某个功能页被打开了"，让功能页自己有机会做进入前的准备
  // （比如转换页要清掉上一位登录用户留下的图片）
  document.dispatchEvent(new CustomEvent('tool:open', { detail: { key, page } }));
}

/** 关闭功能页；不传就关掉当前打开的那个 */
function closeTool(page) {
  const target = page || currentToolPage();
  if (target) target.classList.remove('show');
}

/* ---------- 入口按钮：点 .tool-btn 进入对应功能页 ---------- */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-tool]');
  if (!btn) return;
  openTool(btn.dataset.tool);
});

/* ---------- 返回按钮 ----------
   有页内二级视图的（异语道破的编码 / 游戏 / 码表、单位换算的换算界面）
   先退一级，别一下把整个功能页关掉 —— 和手机返回键一个口径。 */
document.addEventListener('click', e => {
  const back = e.target.closest('[data-tool-back]');
  if (!back) return;
  const page = back.closest('.tool-page');
  if (typeof NovaBack !== 'undefined' && NovaBack.backOnce(page)) return;
  closeTool(page);
});

/* ---------- Esc 返回 ----------
   放在捕获阶段并 stopPropagation：
   免得同一个 Esc 顺带把主页底下的菜单 / 设置页也一起关掉
   （和 picker 的处理方式保持一致） */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const page = currentToolPage();
  if (!page) return;
  e.stopPropagation();
  /* 和返回箭头一个口径：页内还有上级视图就先退一级 */
  if (typeof NovaBack !== 'undefined' && NovaBack.backOnce(page)) return;
  closeTool(page);
}, true);
