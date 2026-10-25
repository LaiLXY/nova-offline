/* ==========================================================================
   core.js —— Nova Offline 的基础工具
   $ / $$ · 设备检测 · Toast · 表单校验工具
   （离线版没有后端：原来那套 api / 令牌 / 账户校验已经整段去掉）
   ========================================================================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ==========================================================================
   Device —— 设备检测 + 屏幕自适配
   把断点结果写到 <html> 的 data-* 上，CSS 据此切换布局
   ========================================================================== */
const Device = (() => {
  // 只分三档：xs 小屏手机 / sm 大屏手机+平板 / lg PC
  //
  // 平板（768–1023）特意并入 sm：需求是「平板所有配置都跟随手机版，
  // 只改变窗口大小」，所以不给它单独一档。并进来的好处是所有
  // [data-viewport="sm"] 的规则（卡片宽度、内边距、管理后台的卡片式
  // 列表、Toast 位置等）平板自动照单全收，不会出现某几条漏掉、
  // 结果平板上半手机半桌面的情况。
  // 设备类型仍单独记在 data-device 上（平板仍识别为 tablet）。
  //
  // 注意：宽度分档只管"窗口多宽"。真平板里那些 CSS 宽度 ≥1024 的
  // （1920×1200 平板、iPad Pro 12.9 横屏 1366 …）按宽度会落进 lg，
  // 所以 apply() 里会把它们**强制归到 sm** —— 详见 apply 的注释。
  const BREAKPOINTS = [
    { name: 'xs', min: 0,    max: 479    },  // 小屏手机
    { name: 'sm', min: 480,  max: 1023   },  // 大屏手机 + 平板
    { name: 'lg', min: 1024, max: Infinity },// PC
  ];

  const viewportOf = w =>
    (BREAKPOINTS.find(b => w >= b.min && w <= b.max) || { name: 'lg' }).name;

  function deviceOf() {
    const ua = navigator.userAgent;
    const touch = navigator.maxTouchPoints || 0;
    // iPadOS 13+ 的 UA 伪装成 Macintosh，靠触摸点数量区分
    const isIPad = /Macintosh/.test(ua) && touch > 1;

    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || isIPad) return 'tablet';
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'mobile' : 'tablet';
    if (/iPhone|iPod|Windows Phone|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
    // 触屏 Windows 电脑（二合一 / 触屏笔记本）：maxTouchPoints 常 >1，但多数
    // 仍配鼠标或触控板，本质是 PC。若一律判 tablet，data-viewport 会被强制
    // 成 sm，1600/2200 的宽屏布局在 2560 大屏上会整片失效（工具卡缩成手机版）。
    // 判据：精细指针，或视口本身够宽（≥1600）→ PC；否则（纯触/窄屏）→ 平板。
    // （Macintosh + touch>1 已在上面按 iPadOS 判成平板，这里只剩 Windows。）
    if (touch > 1 && /Windows/i.test(ua)) {
      const finePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
      return (finePointer || window.innerWidth >= 1600) ? 'pc' : 'tablet';
    }
    return 'pc';
  }

  function snapshot() {
    const w = window.innerWidth, h = window.innerHeight;
    // 大屏兜底：CSS 视口 ≥1600 时，无视 UA 自报的设备类型（DevTools 移动模拟、
    // 移动 UA 伪装、触屏二合一…），一律按 PC 处理。否则所有挂在
    // html[data-device="pc"] 上的 1600/2200 宽屏规则会整片失效，大屏上工具卡
    // 缩成手机版。真机 CSS 宽：手机 ≤480、平板 ≤1500（iPad Pro 12.9 横屏 1366），
    // 够不到 1600，不会被误判。
    let device = deviceOf();
    if (w >= 1600) device = 'pc';
    return {
      viewport: viewportOf(w),
      device,
      width: w,
      height: h,
      touch: (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window,
      short: h < 640 && w > h,          // 横向矮窗口：压缩纵向留白
      // 宽高比：横向窗口（16:10=1.6 / 16:9=1.78 / 4:3=1.33）适合左右分栏
      aspect: (w / h) >= 1.3 ? 'wide' : 'tall',
      dpr: window.devicePixelRatio || 1,
    };
  }

  function apply(info) {
    const el = document.documentElement;

    // 真平板：**不论窗口多宽**都算平板。理由见下面 data-viewport / tabletLayout
    // 两处注释（大平板的 CSS 宽度常常 ≥1024，光看宽度会把它当成 PC）。
    const isTablet = info.device === 'tablet';

    el.dataset.device   = info.device;
    el.dataset.touch    = info.touch ? '1' : '0';
    el.dataset.short    = info.short ? '1' : '0';
    el.dataset.aspect   = info.aspect;

    // data-viewport：真平板一律算 sm。
    //
    // 宽度分档只说明「窗口有多宽」，说明不了「这是不是平板」——
    //   · 1920×1200 这类大平板，CSS 宽度常落在 1024–1400
    //   · iPad Pro 12.9 横屏 1366
    // 这些按宽度都会划进 lg，于是套上 PC 的左右分栏，和「平板所有配置都
    // 跟随手机版，只改变窗口大小」这条既定做法正好相反。
    // 所以平板直接归到 sm 档（拿到手机那一整套配置），再由下面的
    // data-layout="tablet" 统一放大。PC（device === 'pc'）一个字节都不受影响。
    el.dataset.viewport = isTablet ? 'sm' : info.viewport;

    // 平板布局开关（CSS 只认这一个 data-layout，不再用宽度媒体查询）
    //
    // 为什么不在 CSS 里按宽度判断：真机尺寸跨度太大，写死区间总会漏——
    //   iPad mini 竖屏 744 / iPad 竖屏 768、810、820、834 /
    //   iPad Pro 12.9 / 各类 1920×1200 平板（CSS 宽度 1024–1400）……
    // 所以交给 JS 一起判断：
    //   1) 真平板（UA 判定为 tablet）→ 打开。**不再限制宽度**：以前要求
    //      「没到 lg 档」，导致大平板掉回 PC 布局，现在改成一律算平板。
    //   2) 桌面窗口被缩到平板宽度(744–1023) → 也打开，方便电脑上预览
    const isTabletWidth = info.width >= 744 && info.width <= 1023;
    const tabletLayout = isTablet || isTabletWidth;
    el.dataset.layout = tabletLayout ? 'tablet' : 'default';

    // 移动端 100vh 会被地址栏撑破，用真实像素高度兜底
    el.style.setProperty('--vh', info.height + 'px');
  }

  let raf = null;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; apply(snapshot()); });
  }

  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  if (window.visualViewport) {   // 地址栏收起/展开
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
  }

  return {
    snapshot,
    isMobile: () => snapshot().device === 'mobile',
    isPC:     () => snapshot().device === 'pc',
    init:     () => apply(snapshot()),
  };
})();

Device.init();

/* ---------- Toast ---------- */

/* 需要给底部常驻栏让位的选择器清单。
   离线版底部只留了「设置」齿轮那一条栏（.home-footer），
   提示气泡落在它上面会被挡住，所以列进来让它自己抬上去。 */
const TOAST_AVOID_BOTTOM = ['.home-footer'];

/** 提示气泡该贴哪一边：
 *  主页 / 功能页顶部都是黄色区或操作栏，贴顶会压住东西 → 贴**底部**；
 *  万一哪天真有个"什么都没有"的空页面，退化成贴顶。
 */
function toastSide() {
  const inApp = document.querySelector('.home-page.show, .tool-page.show');
  return inApp ? 'bottom' : 'top';
}

/** 定好提示该贴哪一边，并让开那一侧贴边的常驻栏。
 *
 *  用实测而不是写死偏移：主页底部那条栏的高度和位置随断点变
 *  （手机一条横栏、电脑右侧一列），写死的数字必然有对不上的时候。 */
function applyToastPlacement() {
  const host = $('#toasts');
  if (!host) return;

  host.style.top = '';
  host.style.bottom = '';

  if (toastSide() === 'top') {
    // 登录 / 注册 / 管理员登录页：贴顶。这几页顶部没有操作栏（那几条栏
    // 所属的页面都是 display:none，量出来高度是 0），所以直接到位。
    host.style.top = 'calc(12px + env(safe-area-inset-top, 0px))';
    host.style.bottom = 'auto';
    return;
  }

  // 站内：贴底，并让开贴底的常驻栏
  const h = host.getBoundingClientRect();
  if (!h.height) return;

  const vh = window.innerHeight;
  let lift = 0;
  TOAST_AVOID_BOTTOM.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.height) return;                 // 藏着的（display:none 量出来是 0）
      // 只有真贴在视口底部时才算"占位"；被内容顶到屏幕中间的不算
      if (r.bottom < vh - 2) return;
      // 和默认位置横向相交吗？相交就把提示抬到它上面去
      if (!(r.right < h.left || r.left > h.right)) {
        lift = Math.max(lift, vh - r.top);
      }
    });
  });

  // 多抬 10px 的间隙；没压到就保持 CSS 的默认值，不动它
  if (lift) {
    host.style.bottom =
      'calc(' + Math.round(lift + 10) + 'px + env(safe-area-inset-bottom, 0px))';
  }
}

/** 弹一条提示。
 *
 *  ★ 同一种类只留一条：新消息直接覆盖旧消息，而不是像现在这样顶上去叠成一小摞。
 *    - 分类按 `type`：`err`（报错）和 `ok`（成功提示）各占一个独立的位置，
 *      所以**报错和成功可以并存**；但**同一个 type 永远只有一条** ——
 *      再来一条同 type 的会先把旧的那条收掉，再挂新的。
 *    - 给"会被连续触发"的同一种报错（比如梵天汉诺连点柱子，每点一下都弹一次
 *      「大盘不能压在小盘上」）天然就是这行为，不用再单独处理。
 *
 *  ★ 第 4 个参数 key 保留做兜底（同 key 也只留一条），绝大多数情况下已经被
 *    type 这条规则覆盖，调用方不用再为"别叠起来"操心。
 *
 *  ★ 返回刚挂上去的那个节点，调用方想自己管（提前收掉 / 改内容）也可以。 */
function toast(type, title, desc = '', key = '') {
  const ic = { ok: '✓', err: '!' }[type] || 'i';
  const host = $('#toasts');

  // 同种类只留一条：先把同 type 的旧气泡收掉（连同它的定时器，免得回头空转重算位置）
  const prev = host.querySelector('.toast[data-type="' + type + '"]');
  if (prev) {
    if (prev._timer) clearTimeout(prev._timer);
    prev.remove();
  }
  // 兜底：同 key 的旧气泡也收掉（和 type 多半是同一个，重复 remove 无害）
  if (key) {
    const oldKey = host.querySelector('.toast[data-key="' + key + '"]');
    if (oldKey && oldKey !== prev) {
      if (oldKey._timer) clearTimeout(oldKey._timer);
      oldKey.remove();
    }
  }

  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.dataset.type = type;
  if (key) el.dataset.key = key;
  el.innerHTML = `<div class="ic">${ic}</div><div><b style="font-weight:600">${title}</b>${
    desc ? `<div style="color:var(--muted);font-size:12px;margin-top:2px">${desc}</div>` : ''
  }</div>`;
  host.appendChild(el);
  applyToastPlacement();                     // 挂上去之后再量，才知道真实尺寸
  el._timer = setTimeout(() => {
    el.remove();
    applyToastPlacement();                   // 收掉一条后重新算，别留下多余的偏移
  }, 2600);
  return el;
}

/* ---------- 表单工具 ---------- */
function setError(input, msg) {
  const wrap = input.closest('[data-field]');
  const hint = wrap?.nextElementSibling;
  wrap?.classList.add('err');
  if (hint?.classList.contains('hint')) {
    hint.textContent = msg;
    hint.classList.add('show');
  }
}

function clearError(input) {
  const wrap = input.closest('[data-field]');
  const hint = wrap?.nextElementSibling;
  wrap?.classList.remove('err');
  if (hint?.classList.contains('hint')) hint.classList.remove('show');
}

$$('[data-field] input, [data-field] textarea').forEach(inp => {
  inp.addEventListener('input', () => clearError(inp));
});
