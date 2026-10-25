/* ==========================================================================
   archive.js —— 彩蛋墙

   主页底栏齿轮左边那颗「奖牌」按钮点进来就是这一页（#toolArchive）。
   它收的是「规则之外」的东西：现在只有囚徒困境的两条结局。

     越狱者      nova_prisoner_clear === '1'
     碎裂的囚笼  parseInt(nova_prisoner_spoil) > 0   （封死到第几级都算）
     都不是      → ？？？ + 黑底白问号

   ★ 这一页不存任何自己的状态，全部现算。
     一旦给墙单独记一个「已解锁」，就会出现「存档被清空缓存清掉了、
     墙的键还留着」这种自相矛盾 —— 格子亮着，卡片却是完好的。
     现算的副作用刚好是对的：清完缓存这面墙自己回空。

   ★ 两条互斥，所以墙永远缺一格：
     通关的人（囚徒困境再点进去直接看彩蛋）再也答不出错，
     答错的人（卡片损坏 / 封死）再也进不去 —— 这是设计之初就定的。

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

  /* file:// 下个别浏览器 localStorage 直接抛，读不到就当没存过 */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  const cleared = () => lsGet(K_CLEAR) === '1';
  const spoiled = () => {
    const n = parseInt(lsGet(K_SPOIL) || '0', 10);
    return n >= 0 && n <= 4 ? n > 0 : false;
  };

  /* ---------- 条目表 ----------
     加一条新彩蛋只要往这儿塞一行：id 要和 HTML 里 data-arc 对上，
     on() 从存档现算，解锁了就把 name / sub 填进那一格。 */
  const ENTRIES = [
    { id: 'escape',  name: '越狱者',     sub: '遵守规则？能当饭吃吗？', on: cleared },
    { id: 'shatter', name: '碎裂的囚笼', sub: '永远的404',              on: spoiled },
  ];

  /* 图标原型：解锁态取囚徒困境卡片上的栏杆，锁定态取 HTML 里那个白问号。
     问号那份先 clone 出来当模板 —— 第一次 paint 就会把 HTML 里的原件换掉，
     留个副本才不会被"用掉"。 */
  const openGlyph = card.querySelector('.tool-btn-ico svg');
  const qProto = page.querySelector('.arc-tile .arc-glyph-q');
  const lockGlyph = qProto ? qProto.cloneNode(true) : null;

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

      /* 图标现克隆：解锁用卡片图标（囚徒那张是绿底白栏杆），
         未解锁用那个白问号 —— 每格都是 replaceChildren，
         所以来回切状态不会叠出两层。 */
      const src = open ? openGlyph : lockGlyph;
      if (src) tile.replaceChildren(src.cloneNode(true));
    });
  }

  /* tools.js 的 openTool 会广播 tool:open：
     从囚徒困境回来再点进来时存档可能已经变了，进页面前重画一次 */
  document.addEventListener('tool:open', e => {
    if (e.detail.key !== 'archive') return;
    paint();
  });

  /* 首次加载先画一遍：这样点进来时不会有一帧「全是问号」再跳成解锁态 */
  paint();
})();
