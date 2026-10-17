/* ==========================================================================
   bash.js —— 功能页：巴什博弈（Bash Game / 同余博弈）
   --------------------------------------------------------------------------
   玩法：n 颗石子，你和对手轮流取 1…m 颗，取走最后一颗者胜。
        胜负只看 n % (m+1)：把残局每次都凑成 m+1 的倍数，就稳赢。

   设计要点：
     · 每局都「保证玩家有必胜策略」——你先手时 n%(m+1)≠0；你后手时
       n%(m+1)=0（AI 先手、正处在必败态）。AI 其余时候始终取最优解，
       所以玩家只要每一步都凑对就能赢，走错才会输。
     · 核心可视化是石堆下方的「m+1 刻度尺」：标出 0、m+1、2(m+1)…，
       一颗游标（黄色进度条右端）跟着剩余数走——把"同余制衡"演出来。
     · 难度只调 m 与 n 的范围，以及是否显示刻度尺 / 提示。

   依赖：core.js（$ / $$ / toast）、tools.js（tool:open 事件）。
   一次请求都不发，不记战绩（同数字桥屿 / 四色谜题）。
   ========================================================================== */
(function () {
  'use strict';

  const BS = $('#toolBash');
  if (!BS) return;

  /* ---------- 难度档 ---------- */
  const BS_TIERS = [
    { key: 'easy',   mRange: [3, 3], nMin: 12, nMax: 20, first: 'you', ruler: true,  hint: true,  name: '入门' },
    { key: 'normal', mRange: [3, 4], nMin: 20, nMax: 35, first: null,  ruler: true,  hint: false, name: '进阶' },
    { key: 'hard',   mRange: [2, 6], nMin: 30, nMax: 50, first: null,  ruler: false, hint: false, name: '困难' },
  ];
  let bsTier = BS_TIERS[0];

  /* ---------- 元素引用 ---------- */
  const bsSetup      = $('#bsSetup');
  const bsTiersEl    = $('#bsTiers');
  const bsStart      = $('#bsStart');
  const bsGame       = $('#bsGame');
  const bsRoundEl    = $('#bsRound');
  const bsMetaEl     = $('#bsMeta');
  const bsRemainNum  = $('#bsRemainNum');
  const bsStones     = $('#bsStones');
  const bsRuler      = $('#bsRuler');
  const bsRulerFill  = $('#bsRulerFill');
  const bsRulerTicks = $('#bsRulerTicks');
  const bsTip        = $('#bsTip');
  const bsTakes      = $('#bsTakes');
  const bsLog        = $('#bsLog');
  const bsResetEl    = $('#bsReset');
  const bsRechooseEl = $('#bsRechoose');
  const bsOverlay    = $('#bsOverlay');
  const bsAskConfirm = $('#bsAskConfirm');
  const bsAskTitle   = $('#bsAskTitle');
  const bsAskText    = $('#bsAskText');
  const bsAskOk      = $('#bsAskOk');
  const bsAskCancel  = $('#bsAskCancel');
  const bsOvTitle    = $('#bsOvTitle');
  const bsOvText     = $('#bsOvText');
  const bsOvOk       = $('#bsOvOk');
  const bsOvNew      = $('#bsOvNew');
  const bsOvBack     = $('#bsOvBack');

  /* ---------- 局内状态 ---------- */
  let bsRound = 0;
  let bsN = 0;          // 开局总石子
  let bsM = 0;          // 每轮最多取几颗
  let bsRemain = 0;     // 剩余
  let bsFirst = 'you';  // 谁先手
  let bsState = 'idle'; // 'you' | 'busy' | 'over'
  let bsStonesEls = []; // 石子 DOM
  let bsLogRows = [];   // { who:'you'|'ai', take, remainBefore }
  let bsAiTimer = null;

  /* ---------- 工具 ---------- */
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- 开局：生成保证玩家可赢的局面 ---------- */
  function genRound(tier) {
    bsM = randInt(tier.mRange[0], tier.mRange[1]);
    const first = tier.first || (Math.random() < 0.5 ? 'you' : 'ai');
    let n;
    // 玩家先手需要 n%(m+1)≠0；玩家后手需要 n%(m+1)==0
    do {
      n = randInt(tier.nMin, tier.nMax);
    } while (first === 'you' ? n % (bsM + 1) === 0 : n % (bsM + 1) !== 0);
    bsN = n; bsRemain = n; bsFirst = first;
  }

  function bsNewRound(tier) {
    bsTier = tier;
    genRound(tier);
    bsRound++;
    bsLogRows = [];
    bsState = (bsFirst === 'ai') ? 'busy' : 'you';

    bsGame.classList.remove('is-done');
    bsSetup.hidden = true;
    bsGame.hidden = false;
    bsOverlay.classList.remove('show');

    bsRoundEl.textContent = '第 ' + bsRound + ' 局';
    const who = bsFirst === 'you' ? '你先手' : '对手先手';
    bsMetaEl.textContent = bsTier.name + ' · ' + bsN + ' 颗 · 取 1–' + bsM + ' · ' + who;

    buildStones();
    buildRuler();
    renderRemain();
    renderLog();
    renderTakes();

    if (bsFirst === 'ai') {
      bsTip.textContent = '对手先手，思考中…';
      bsAiTimer = setTimeout(aiTurn, 640);
    } else {
      updateHint();
    }
  }

  function buildStones() {
    bsStones.innerHTML = '';
    bsStonesEls = [];
    for (let i = 0; i < bsN; i++) {
      const s = document.createElement('div');
      s.className = 'bs-stone';
      bsStones.appendChild(s);
      bsStonesEls.push(s);
    }
  }

  function buildRuler() {
    if (!bsTier.ruler) { bsRuler.hidden = true; return; }
    bsRuler.hidden = false;
    bsRulerTicks.innerHTML = '';
    const step = bsM + 1;
    for (let k = step; k <= bsN; k += step) {
      const pct = (k / bsN) * 100;
      const tick = document.createElement('span');
      tick.className = 'bs-ruler-tick';
      tick.style.left = pct + '%';
      tick.innerHTML = '<i></i><b>' + k + '</b>';
      bsRulerTicks.appendChild(tick);
    }
    bsRulerFill.style.width = '100%';
  }

  function renderRemain() {
    bsRemainNum.textContent = bsRemain;
    bsRemainNum.classList.remove('is-pop');
    void bsRemainNum.offsetWidth; // 重启动画
    bsRemainNum.classList.add('is-pop');
    bsRulerFill.style.width = (bsRemain / bsN * 100) + '%';
  }

  /* 取走最右侧（末尾）尚未消失的 k 颗石子 */
  function takeStones(k) {
    let taken = 0;
    for (let i = bsStonesEls.length - 1; i >= 0 && taken < k; i--) {
      if (!bsStonesEls[i].classList.contains('is-gone')) {
        bsStonesEls[i].classList.add('is-gone');
        taken++;
      }
    }
  }

  function doTake(who, k) {
    const before = bsRemain;
    bsRemain -= k;
    takeStones(k);
    renderRemain();
    bsLogRows.push({ who, take: k, remainBefore: before });
    renderLog();
  }

  function playerTake(k) {
    if (bsState !== 'you' || k > bsRemain || k < 1) return;
    bsState = 'busy';
    renderTakes();
    doTake('you', k);
    if (bsRemain === 0) { endRound(true); return; }
    bsTip.textContent = '对手思考中…';
    bsAiTimer = setTimeout(aiTurn, 640);
  }

  /* AI 最优：余数不为 0 时取余数把残局推回倍数；否则（必败态）随机拖延 */
  function aiChoose() {
    const mod = bsRemain % (bsM + 1);
    if (mod !== 0) return mod;
    return randInt(1, Math.min(bsM, bsRemain));
  }

  function aiTurn() {
    if (bsState !== 'busy') return;
    const k = aiChoose();
    doTake('ai', k);
    if (bsRemain === 0) { endRound(false); return; }
    bsState = 'you';
    renderTakes();
    updateHint();
  }

  function updateHint() {
    if (bsState !== 'you') { bsTip.textContent = '对手思考中…'; return; }
    if (!bsTier.ruler) { bsTip.textContent = '轮到你了，取 1–' + bsM + ' 颗。'; return; }
    const mod = bsRemain % (bsM + 1);
    if (bsTier.hint) {
      if (mod !== 0) bsTip.textContent = '取 ' + mod + ' 颗，把它推回 ' + (bsM + 1) + ' 的倍数。';
      else bsTip.textContent = '已落在倍数上——尽力拖延吧。';
    } else {
      bsTip.textContent = '轮到你了，取 1–' + bsM + ' 颗。';
    }
  }

  function renderTakes() {
    bsTakes.innerHTML = '';
    for (let k = 1; k <= bsM; k++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bs-take';
      b.textContent = k;
      if (bsState !== 'you' || k > bsRemain) b.disabled = true;
      else if (k === bsRemain) b.classList.add('is-win');
      b.addEventListener('click', () => playerTake(k));
      bsTakes.appendChild(b);
    }
  }

  function renderLog() {
    bsLog.innerHTML = '';
    bsLogRows.slice(-6).reverse().forEach(r => {
      const row = document.createElement('div');
      row.className = 'bs-log-row';
      const whoTxt = r.who === 'you' ? '你' : '对手';
      row.innerHTML = '<span>' + whoTxt + ' 取 <b>' + r.take + '</b> 颗</span>' +
                      '<span>剩 ' + (r.remainBefore - r.take) + '</span>';
      bsLog.appendChild(row);
    });
  }

  function endRound(win) {
    bsState = 'over';
    renderTakes();
    bsGame.classList.add('is-done');
    bsOvTitle.textContent = win ? '你赢了' : '这一局输了';
    bsOvText.textContent = win ? buildWinText() : buildLoseText();
    bsOverlay.classList.add('show');
  }

  function buildWinText() {
    const turns = bsLogRows.filter(r => r.who === 'you').length;
    return '你用 ' + turns + ' 手取完所有石子。每一步都把残局凑成 ' + (bsM + 1) +
           ' 的倍数，对手始终陷在必败里——这正是「同余」的精髓。';
  }

  /* 找出玩家第一处走错的手：轮到玩家时残局非倍数，却没取余数 */
  function buildLoseText() {
    for (let i = 0; i < bsLogRows.length; i++) {
      const r = bsLogRows[i];
      if (r.who !== 'you') continue;
      const mod = r.remainBefore % (bsM + 1);
      if (mod !== 0 && r.take !== mod) {
        return '第 ' + (i + 1) + ' 手你取了 ' + r.take + ' 颗，其实只要取 ' + mod +
               ' 颗、把残局推回 ' + (bsM + 1) + ' 的倍数，就能把对手钉死在必败线上。' +
               '记住：把每次留下的数量都凑成 ' + (bsM + 1) + ' 的倍数。';
      }
    }
    return '你只要每次把残局凑成 ' + (bsM + 1) + ' 的倍数，对手就永远摆脱不了必败。再试一次。';
  }

  function clearAi() {
    if (bsAiTimer) { clearTimeout(bsAiTimer); bsAiTimer = null; }
  }

  /* 通用二次确认（复用 base.css 的 .confirm-overlay） */
  function bsAsk(title, text, okText, onOk) {
    bsAskTitle.textContent = title;
    bsAskText.textContent = text;
    bsAskOk.textContent = okText;
    bsAskConfirm.classList.add('show');
    bsAskOk.onclick = () => { bsAskConfirm.classList.remove('show'); onOk(); };
  }

  function bsToSetup() {
    clearAi();
    bsGame.hidden = true;
    bsSetup.hidden = false;
  }

  /* ==========================================================================
     事件绑定
     ========================================================================== */
  $$('#bsTiers .bs-tier', bsSetup).forEach(b => b.addEventListener('click', () => {
    $$('#bsTiers .bs-tier', bsSetup).forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    bsTier = BS_TIERS.find(t => t.key === b.dataset.tier);
  }));

  bsStart.addEventListener('click', () => bsNewRound(bsTier));
  /* 你先手且尚未有任何一步（初始状态）→ 直接执行，不弹二次确认 */
  function bsNeedConfirm() { return !(bsFirst === 'you' && bsLogRows.length === 0); }
  bsResetEl.addEventListener('click', () => {
    if (!bsNeedConfirm()) { clearAi(); bsNewRound(bsTier); return; }
    bsAsk('重来本局？', '当前这局会作废，重新发一副新石子。', '重来', () => { clearAi(); bsNewRound(bsTier); });
  });
  bsRechooseEl.addEventListener('click', () => {
    if (!bsNeedConfirm()) { bsToSetup(); return; }
    bsAsk('重选难度？', '当前这局会作废，回到选难度界面。', '重选难度', bsToSetup);
  });

  bsOvOk.addEventListener('click', () => bsOverlay.classList.remove('show'));
  bsOvNew.addEventListener('click', () => { bsOverlay.classList.remove('show'); clearAi(); bsNewRound(bsTier); });
  bsOvBack.addEventListener('click', () => { bsOverlay.classList.remove('show'); bsToSetup(); });
  bsAskCancel.addEventListener('click', () => bsAskConfirm.classList.remove('show'));

  /* 进卡片时：清掉可能在跑的 AI 回合；若还在选档，把高亮补到当前难度 */
  document.addEventListener('tool:open', e => {
    if (!e.detail || e.detail.page !== BS) return;
    clearAi();
    if (bsGame.hidden) {
      $$('#bsTiers .bs-tier', bsSetup).forEach(b =>
        b.classList.toggle('on', b.dataset.tier === bsTier.key));
    }
  });

})();
