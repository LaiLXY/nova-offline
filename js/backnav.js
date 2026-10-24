/* ==========================================================================
   backnav.js —— 返回键 / 浏览器后退的层级栈（脏状态管理）
   --------------------------------------------------------------------------
   问题出在这个站是「一个 HTML + 一堆浮层」：主页、功能页、子页面、弹窗全靠
   改 class 切换，浏览器历史里从头到尾只有一条记录。于是手机上按返回键（或
   左右侧滑）时，界面上明明还压着好几层，历史里却一步都没有 —— 一下就退出
   站点回到桌面。界面的层级和历史的层级对不上，这就是「脏状态」。

   这里把「当前显示着几层」当成唯一真相，让历史深度跟着它走：

     · 层变多（打开功能页 / 子页面 / 弹窗）
         → pushState 补齐，历史里多出对应条数（同步落账，不等下一帧）
     · 层变少（点返回箭头 / 遮罩 / 取消 / 关闭按钮）
         → 我们自己 back 掉多余的那几条，并把这些 popstate 吞掉
           （不吞的话同一个返回会把下面一层又关掉）
     · 用户按返回键 → popstate
         → 关掉「视觉上最上面」的那一层，界面退一级、历史也退一级
     · 一层都不剩（主页 / 登录页）
         → 底下垫着 EXIT_GUARDS 条「护垫」，第一次按只弹「再按一次退出」，
           1 秒内再按一次才真离开站点

   层是哪来的？不靠各处手工登记，而是 init 时把 NB_LAYER_SEL 命中的元素
   收进一张表，之后盯着它们的 class / style / hidden 变化自己算。显示与否
   一律看 computed display —— 有的层用 .show 打开、有的用 hidden 属性，
   两套写法在这儿统一。

   关一层时优先叫它自己的关闭函数（NB_CLOSERS），这样键盘复位、焦点归还、
   播放停止这些收尾都不会漏；没有专门函数的（各种只做切换的浮层）就按
   .show / hidden 的写法原样收回去。
   ========================================================================== */

/* 算作「一层」的元素。页面级三类 + 各种浮层（通用弹窗、二次确认、
   挑选项、抽屉、各游戏的通关 / 放弃浮层）+ 聊天页里的「⋯」小菜单。 */
const NB_LAYER_SEL = [
  '.tool-page',
  '.sub-page',
  '.admin-page',
  '.menu-overlay',
  '.picker-overlay',
  '.adv-overlay',
  '.overlay',
  '.confirm-overlay',
  '.chat-ctx',
  '.xo-overlay',
  '.bs-overlay',
  '.bh-overlay',
  '.fc-overlay',
  '.g48-overlay',
  '.ms-overlay',
  '.br-overlay',
  '.sl-overlay',
  '.qn-overlay',
  '.lt-overlay',
].join(',');

/* id → 它自己的关闭函数（都是经典 script 的顶层 function，挂在 window 上）。
   写成字符串是为了让 backnav.js 能排在它们前面加载。没列到的走通用收法。
   离线版没有登录 / 站内信 / 好友那套页面，设置抽屉里的面板统一走 closePanel。 */
const NB_CLOSERS = {
  menuOverlay:  'closePanel',
  nameOverlay:  'closePanel',
  aboutOverlay: 'closePanel',
  /* 互不相犯：浮层关掉要顺手把棋盘锁进「已看完」状态，
     否则盘面停在 over 的半锁状态、点哪都没反应 */
  qnOverlay:    'qnDismissOverlay',
  /* 一位之差：结算浮层关掉 = 点了主按钮（过关 → 回看；放弃 → 看答案），
     不然盘面停在 over 的半锁状态、点哪都没反应 */
  hmOverlay:    'hmDismissOverlay',
  /* 关灯游戏：同互不相犯，浮层关掉要收尾，别停在 over 的半锁状态 */
  ltOverlay:    'ltDismissOverlay',
};

const NovaBack = (() => {
  const els   = [...document.querySelectorAll(NB_LAYER_SEL)];
  const known = new Set(els);

  /* 哪些层是靠 hidden 属性开关的（HTML 上本来就有 hidden，比如各游戏浮层）。
     关的时候要还回去；纯 .show 的层千万别碰 hidden，否则下次可能打不开。 */
  const usesHidden = new WeakMap();
  els.forEach(el => usesHidden.set(el, el.hasAttribute('hidden')));

  const EXIT_GUARDS = 2;       // 主页下面垫几条「护垫」历史
  const EXIT_WINDOW = 1000;    // 连按两次的时间窗（毫秒）

  let ignore    = 0;      // 我们自己 back() 之后，接下来的 popstate 要吞掉几个
  let closing   = false;  // 正在按返回键关层（这期间别让 sync 再 back）
  let scheduled = false;
  let stale     = 0;      // 刷新前压着的历史条目（层已经没了，得替用户退掉）
  const inners  = [];     // 页面自己登记的「内部还有一级可退」

  let exitArmedAt = 0;    // 上一次「再按一次退出」的时间点
  let leaving     = false;// 已经在往外走（双击成立）
  let leaveSteps  = 0;

  /* ---------- 历史深度：我们 push 出来的层数 ---------- */
  function depth() {
    const st = history.state;
    return st && typeof st.nb === 'number' ? st.nb : 0;
  }

  /* ---------- 一个层现在显示着吗 ----------
     只看 display / visibility：项目里所有层都是「display:none ↔ .show / hidden」
     这一套，没有人拿 opacity 藏东西。别去算 opacity —— 打开动画的头一帧
     opacity 还很低，会把刚打开的层判成没开、白白漏掉一条历史。 */
  function shown(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function visible() {
    return els.filter(shown);
  }

  /* ---------- 谁在最上面 ----------
     先看包含关系（聊天页里的「⋯」小菜单是聊天页的后代，永远更上），
     再比 z-index（.sub-page 235 < .menu-overlay 240 < 二次确认 250 …），
     同 z 时后进 DOM 的算更上（聊天页(300) 和用户主页(300) 就是这样叠的）。 */
  function above(a, b) {
    if (a.contains(b)) return 1;       // b 在 a 里面 → b 更上，a 排后面
    if (b.contains(a)) return -1;
    const za = Number(getComputedStyle(a).zIndex) || 0;
    const zb = Number(getComputedStyle(b).zIndex) || 0;
    if (za !== zb) return zb - za;
    return els.indexOf(b) - els.indexOf(a);
  }
  function topLayer() {
    return visible().sort(above)[0] || null;
  }

  /* ---------- 通用收回：按它原本的写法 ---------- */
  function hide(el) {
    if (el.classList.contains('show')) { el.classList.remove('show'); return; }
    if (usesHidden.get(el)) el.hidden = true;
  }

  function closeLayer(el) {
    const fn = NB_CLOSERS[el.id];
    if (fn && typeof window[fn] === 'function') { window[fn](el); return; }

    if (el.classList.contains('tool-page') && typeof closeTool === 'function') { closeTool(el); return; }
    if (el.classList.contains('sub-page') && typeof closeSubPage === 'function') { closeSubPage(el); return; }
    if (el.classList.contains('admin-page') && typeof hideAdminPanel === 'function') { hideAdminPanel(); return; }

    hide(el);
  }

  /* ---------- 页内二级视图 ----------
     页面自己登记过「这一层内部还有一级可退」（异语道破的编码 / 游戏、
     单位换算的换算界面、管理后台的子视图）。退掉了就 return true。 */
  function innerBack(top) {
    for (const fn of inners) {
      let done = false;
      try { done = fn(top) === true; } catch (err) { console.error('[backnav] 内部退级失败', err); }
      if (done) return true;
    }
    return false;
  }

  /* ---------- 历史跟着层数走 ---------- */
  function pushTo(n) {
    while (depth() < n) {
      history.pushState({ ...(history.state || {}), nb: depth() + 1 }, '');
    }
  }

  /* 逐条退，中间留一口气给浏览器（同一 tick 连发 back 会被合并）。
     退完才回调 —— 中途 depth() 还是旧值，这会儿千万别去补护垫。 */
  function backTo(n, done) {
    let left = depth() - n;
    const step = () => {
      if (left <= 0) { if (done) done(); return; }
      left--;
      ignore++;
      history.back();
      setTimeout(step, 20);
    };
    step();
  }

  /* ---------- 主页下面的「护垫」----------
     没有层的时候手边必须留一条历史，否则用户一按返回，浏览器当场就把站点
     带走了 —— JS 拦不住（popstate 是导航已经发生之后才来的）。
     护垫的 state 上是 g:1..EXIT_GUARDS，用来避免刷新后越垫越厚。 */
  function guards() {
    const st = history.state;
    return st && typeof st.g === 'number' ? st.g : 0;
  }
  function ensureGuard() {
    while (guards() < EXIT_GUARDS) {
      history.pushState({ ...(history.state || {}), nb: 0, g: guards() + 1 }, '');
    }
  }

  /* ---------- 双击退出 ---------- */
  function askExit() {
    const now = Date.now();
    if (exitArmedAt && now - exitArmedAt <= EXIT_WINDOW) {
      exitArmedAt = 0;
      leaving = true;
      leaveSteps = 0;
      stepOut();
      return;
    }
    exitArmedAt = now;
    toast('info', '再按一次退出', '');
    ensureGuard();          // 把自己按回去，别真退
  }

  function stepOut() {
    if (leaveSteps++ > EXIT_GUARDS + 1) { leaving = false; return; }
    setTimeout(() => {
      if (visible().length) { leaving = false; leaveSteps = 0; return; }
      history.back();
    }, 40);
  }

  /* ---------- 对齐 ---------- */
  function sync() {
    scheduled = false;
    const n = visible().length;
    const d = depth();
    if (n > d) pushTo(n);
    else if (n < d && !closing) backTo(n, () => setTimeout(sync, 0));

    if (n > 0) {
      // 界面里又有层了 → 双击退出的账一笔勾销
      leaving = false; leaveSteps = 0; exitArmedAt = 0;
    } else if (!leaving && d === 0) {
      // 一条历史都不剩了才补护垫；退账（backTo）还没走完时 d 仍是旧值
      ensureGuard();
    }
  }

  /* 同步执行，不走 requestAnimationFrame：
     手机上 tab 被切走、或首帧还没画时 rAF 不一定来，历史条目就漏了 ——
     漏一条，用户按一次返回就直接出站。宁可多算几次也不能漏。 */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    try { sync(); } catch (err) { console.error('[backnav] 对齐历史失败', err); }
  }

  /* ---------- 盯着层的显示状态 ---------- */
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (known.has(m.target)) { schedule(); return; }
    }
  });
  obs.observe(document.body, {
    subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden'],
  });

  /* ---------- 返回键 ---------- */
  window.addEventListener('popstate', () => {
    // 我们自己 back 掉的那几条，到这儿直接咽掉
    if (ignore > 0) { ignore--; return; }

    // 已经在往外走：接着退，直到浏览器把我们带走
    if (leaving) { stepOut(); return; }

    const top = topLayer();
    if (!top) {
      // 没有层可退：先替用户把刷新前留下的脏条目退干净
      if (stale > 0) { stale--; ignore++; setTimeout(() => history.back(), 0); return; }
      if (depth() > 0) { ignore++; setTimeout(() => history.back(), 0); return; }
      // 站在主页 / 登录页按了返回 → 问一次
      askExit();
      return;
    }

    closing = true;
    try {
      // 先问页面自己：这一层里是不是还有个二级视图可退（异语道破的
      // 编码 / 解码、单位换算的类别列表）。退掉了就不用关整个功能页，
      // 层数没变 → 下面的 sync 会把刚退掉的那条历史补回来。
      if (!innerBack(top)) closeLayer(top);
    } catch (err) { hide(top); console.error('[backnav] 关层失败', err); }
    closing = false;

    // 有的关闭函数会顺带收掉下面几层（比如关聊天页会先收「⋯」菜单），
    // 那多出来的历史条目在这里补退
    setTimeout(sync, 0);
  });

  /* 从后台切回来、或 bfcache 里翻回来时对一次账：
     期间要是有层被系统收掉（比如内存回收后重建），这里能补上 */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  window.addEventListener('pageshow', e => { if (e.persisted) { stale = 0; schedule(); } });

  /* ---------- 启动 ---------- */
  // 进站时把当前这条历史记成「第 0 层」；刷新留下的旧 nb 不作数（层已经没了）
  const bootN = depth();
  if (bootN !== 0) {
    stale = bootN;      // 刷新前那几层的历史条目，等用户按返回时替他一并退掉
    history.replaceState({ ...(history.state || {}), nb: 0 }, '');
  }
  // 首屏可能带着一层（比如从维护提示直接进来），补上；顺手垫好护垫
  sync();

  return {
    /** 层数变了想立刻对一次（一般不用手动调，observer 已经在盯） */
    sync,
    /** 页面登记「这一层内部还有一级可退」：返回键先退内部视图，
        真退掉了就 return true（历史那条会自动补回来） */
    inner(fn) { if (typeof fn === 'function') inners.push(fn); },
    /** 让某一层「退一级」：先问页内二级视图，退得掉就 true；
        退不掉返回 false，交给调用方真去关（功能页顶栏那个返回箭头用） */
    backOnce(layer) {
      const top = layer || topLayer();
      return top ? innerBack(top) : false;
    },
    /** 登录 / 登出这种「整站换壳」的场合：把深度对齐当前界面，别留脏账 */
    reset() {
      ignore = 0; leaving = false; leaveSteps = 0; exitArmedAt = 0;
      history.replaceState({ ...(history.state || {}), nb: 0, g: 0 }, '');
      sync();
    },
    get depth() { return depth(); },
    get layers() { return visible(); },
  };
})();
