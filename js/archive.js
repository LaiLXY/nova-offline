/* ==========================================================================
   archive.js —— 彩蛋墙

   主页底栏齿轮左边那颗「彩蛋」按钮点进来就是这一页（#toolArchive）。
   它收的是「规则之外」的东西：

     越狱者      nova_prisoner_clear === '1'          囚徒困境通关
     碎裂的囚笼  parseInt(nova_prisoner_spoil) > 0     （封死到第几级都算）
     欢迎回家    nova_morse_home === '1'              异语道破的电码播放里解出 I am Roy.
     群灯俱寂    nova_lights_silent === '1'           关灯游戏用最少步走完一局
     都不是      → ？？？ + 黑底白问号

   ★ 前两条来自囚徒困境，后两条分别来自异语道破和关灯游戏 —— 四条各算各的；
     只有前两条在**剧情**里互斥。

   ★ 这一页不存任何自己的状态，全部现算。
     一旦给墙单独记一个「已解锁」，就会出现「存档被清空缓存清掉了、
     墙的键还留着」这种自相矛盾 —— 格子亮着，卡片却是完好的。
     现算的副作用刚好是对的：清完缓存这面墙自己回空。

   ★ 两条互斥，所以墙永远缺一格：
     通关的人（囚徒困境再点进去直接看彩蛋）再也答不出错，
     答错的人（卡片损坏 / 封死）再也进不去 —— 这是设计之初就定的。

   ★ 小红点（is-dot）：解锁了、但还没进墙看过 → 按钮右上角亮一颗。
     判断靠 nova_archive_seen 这个键，里面记「看过哪几条」，
     和「有哪几条解锁」是两个问题，所以这里存一份不违反上面那条：
     解锁永远现算，seen 只回答"看过没有"。清空缓存会把两个一起删掉，
     于是红点也不会凭空亮在空墙上。

   图标不复制 markup：解锁用首页卡片上现成的 svg，未解锁用 HTML 里那个白问号，
   两边都是「克隆一份」而不是把形状抄第二遍。
   ========================================================================== */

(function () {
  'use strict';

  const page = $('#toolArchive');
  const gate = $('#btnArchive');
  const card = $('#btnPrisoner');
  if (!page || !gate || !card) return;          // 守卫：结构不在就不初始化

  /* ---------- 存档（和 prisoner.js 读同一对键） ---------- */
  const K_SPOIL = 'nova_prisoner_spoil';
  const K_CLEAR = 'nova_prisoner_clear';
  const K_HOME  = 'nova_morse_home';         // 第三条：电码播放解出 I am Roy.
  const K_SILENT = 'nova_lights_silent';     // 第四条：关灯一局用最少步走完
  const K_SEEN  = 'nova_archive_seen';      // 看过哪几条（只服务那颗小红点）

  /* file:// 下个别浏览器 localStorage 直接抛，读不到就当没存过 */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  const cleared = () => lsGet(K_CLEAR) === '1';
  const homeFound = () => lsGet(K_HOME) === '1';
  const silentFound = () => lsGet(K_SILENT) === '1';
  const spoiled = () => {
    const n = parseInt(lsGet(K_SPOIL) || '0', 10);
    return n >= 0 && n <= 4 ? n > 0 : false;
  };

  /* 图标原型：解锁态取**各自游戏卡片**上的图标，锁定态取 HTML 里那个白问号。
     问号那份先 clone 出来当模板 —— 第一次 paint 就会把 HTML 里的原件换掉，
     留个副本才不会被"用掉"。
     ★ 摩斯那张卡的图标带内联 style（点和杠分别走 fill / stroke 上色），
       克隆进墙里会盖掉 .arc-tile svg 的统一配色 —— 这里统一摘掉，
       由 CSS 按 data-arc 给色（见 css/tools.css）。 */
  function glyphOf(cardSel) {
    const host = cardSel ? $(cardSel) : null;
    const svg = host && host.querySelector('.tool-btn-ico svg');
    if (!svg) return null;
    const c = svg.cloneNode(true);
    c.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
    return c;
  }
  const openGlyph  = glyphOf('#btnPrisoner');
  const morseGlyph = glyphOf('#btnMorse');
  const lightsGlyph = glyphOf('#btnLights');
  const qProto = page.querySelector('.arc-tile .arc-glyph-q');
  const lockGlyph = qProto ? qProto.cloneNode(true) : null;

  /* ---------- 条目表 ----------
     加一条新彩蛋只要往这儿塞一行：id 要和 HTML 里 data-arc 对上，
     on() 从存档现算，解锁了就把 name / sub 填进那一格，
     glyph 是解锁态那张图标（不给就用囚徒那张）。
     ★ 副标题留空串也行：paint 写成 ''，CSS 的 .arc-sub:empty 会把它收掉。 */
  const ENTRIES = [
    { id: 'escape',  name: '越狱者',     sub: '遵守规则？能当饭吃吗？', on: cleared,     glyph: openGlyph },
    { id: 'shatter', name: '碎裂的囚笼', sub: '永远的404',              on: spoiled,     glyph: openGlyph },
    { id: 'home',    name: '欢迎回家',   sub: '身份校验通过',            on: homeFound,   glyph: morseGlyph },
    { id: 'silent',  name: '群灯俱寂',   sub: '你按熄了最后一片喧哗',    on: silentFound, glyph: lightsGlyph },
  ];

  /* ---------- 小红点 ----------
     「解锁了什么」永远现算；「看过什么」记在 nova_archive_seen 里（id 数组）。
     两者相减还有剩 → 按钮右上角亮一颗，点进来（markSeen）就灭。 */
  function unlockedIds() {
    return ENTRIES.filter(en => en.on()).map(en => en.id);
  }

  function readSeen() {
    const raw = lsGet(K_SEEN);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
    } catch (e) { return []; }
  }

  function syncDot() {
    const seen = readSeen();
    const fresh = unlockedIds().filter(id => seen.indexOf(id) < 0);
    const on = fresh.length > 0;
    gate.classList.toggle('is-dot', on);
    /* 读屏和悬停提示都跟着变 —— 红点对看不见颜色的人来说是不存在的 */
    gate.setAttribute('aria-label', on ? '彩蛋墙（有新条目）' : '彩蛋墙');
    gate.title = on ? '彩蛋墙 · 有新条目' : '彩蛋墙';
  }

  function markSeen() {
    /* 只在真的变了才落盘：空墙上看一眼不写键 ——
       和本项目"别在无关的时机 setItem"一个口径，顺手也让 localStorage 干净。 */
    const ids = unlockedIds();
    const seen = readSeen();
    if (ids.length !== seen.length || ids.some(id => seen.indexOf(id) < 0)) {
      lsSet(K_SEEN, JSON.stringify(ids));
    }
    syncDot();
  }

  /* ---------- 画 ----------
     每次都从存档重算，写完不缓存任何东西：条目就两条，
     重复调用比维护「哪儿该刷新」便宜得多。 */
  function paint() {
    ENTRIES.forEach(en => {
      const box = page.querySelector('[data-arc="' + en.id + '"]');
      if (!box) return;

      const open = !!en.on();
      box.classList.toggle('is-open', open);
      box.classList.toggle('is-locked', !open);

      const name = box.querySelector('.arc-name');
      const sub  = box.querySelector('.arc-sub');
      const tile = box.querySelector('.arc-tile');

      /* 未解锁：主标题只有三个问号，副标题干脆留空（:empty 会被 CSS 收掉），
         点了也没反应 —— 所以它不是按钮，别给它 tabindex。 */
      if (open) {
        name.textContent = en.name;
        sub.textContent  = en.sub;
      } else {
        name.textContent = '？？？';
        sub.textContent  = '';
      }

      /* 图标现克隆：解锁用各自卡片上的图标，未解锁用那个白问号 ——
         每格都是 replaceChildren，所以来回切状态不会叠出两层。 */
      const src = open ? (en.glyph || openGlyph) : lockGlyph;
      if (src) tile.replaceChildren(src.cloneNode(true));
    });
  }

  /* tools.js 的 openTool 会广播 tool:open：
     从囚徒困境回来再点进来时存档可能已经变了，进页面前重画一次。
     顺手 markSeen 把红点掐掉 —— 人都站在墙前面了，不用再提示"有新东西"。 */
  document.addEventListener('tool:open', e => {
    if (e.detail.key !== 'archive') return;
    paint();
    markSeen();
  });

  /* 任意功能页关掉都重算一次红点：
     囚徒困境的两种结局都是在页面里写档的（doom 直接 closeTool 回首页，
     win 之后玩家自己按返回），所以"关页"是唯一可靠的时机 ——
     不必知道是哪个游戏、也不必让游戏反过来通知墙。 */
  document.addEventListener('tool:close', () => syncDot());

  /* 首次加载先画一遍：这样点进来时不会有一帧「全是问号」再跳成解锁态 */
  paint();
  syncDot();
})();
