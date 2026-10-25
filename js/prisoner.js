/* ==========================================================================
   prisoner.js —— 功能页：囚徒困境（★ 彩蛋门，不是对局）

   首页那张卡永远写着「开发中」——正式版这一页确实还没做完。
   但离线版里它藏了一道门：点进去是三关问答，全过才看得见彩蛋。

     第一关  判决：四选一，答 B（双方都背叛）
     第二关  破译：凯撒密文答 RELEASE，两次机会
     第三关  一句话：两选一，答 A（合作）
     全过 → 彩蛋页；同时首页那张卡角标变绿写「通关」、整体恢复彩色

   ★ 三关里任何一关错，卡片当场毁掉（存档记 1）：
       名字变 [404]、角标「损坏」、描述「页面不存在」；
       之后每点一次出一句台词（1→2→3→4）：
         第 1 次「…你还没放弃？」
         第 2 次「卡片结构正在瓦解」
         第 3 次「副本已吞噬」  ← 说完这一句，当场变贴图（存档记 4）
       贴图之后 pointer-events:none —— 怎么点都没有反应。
     清站点数据可以把这张卡救回来（作者自己调试也靠这个）。

   存档两个 key，互不覆盖：
     nova_prisoner_spoil   '0' 完好 / '1' 刚毁 / '2'~'3' 听过几句 / '4' 已封死
     nova_prisoner_clear   '1' = 已通关
   ========================================================================== */

(function () {
  'use strict';

  const page = $('#toolPrisoner');
  const card = $('#btnPrisoner');
  if (!page || !card) return;                       // 守卫：结构不在就不初始化

  /* ---------- 存档 ---------- */
  const K_SPOIL = 'nova_prisoner_spoil';
  const K_CLEAR = 'nova_prisoner_clear';

  /* file:// 下个别浏览器会直接抛（本地存储被禁），读不到就当没存过 ——
     彩蛋不该因为存不了档就整个不工作 */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 存不了就只活这一屏 */ } }

  /* 毁坏程度：0 完好 / 1 刚毁（还能听 3 句）/ 2、3 听过几句 / 4 已封死。
     ★ 这里必须是 0~4 五档 —— 三句台词要一轮一轮放，
       若把"封死"也压到 3，第三句永远走不到（会先在 lv>=3 那里 return）。 */
  function spoilLevel() {
    const n = parseInt(lsGet(K_SPOIL) || '0', 10);
    return n >= 0 && n <= 4 ? n : 0;
  }
  function setSpoil(n) { lsSet(K_SPOIL, String(n)); }
  const isCleared = () => lsGet(K_CLEAR) === '1';
  function setCleared() { lsSet(K_CLEAR, '1'); }

  /* ---------- 卡片外观（三态：完好 / 损坏 / 通关） ---------- */
  const prName = $('#prName');
  const prTag  = $('#prTag');
  const prDesc = $('#prDesc');

  function paintCard() {
    /* 每次都从"完好"重来，免得 classList 里有残留 */
    card.classList.remove('is-cleared', 'is-sealed');

    /* ---- 通关：整张卡恢复彩色 ----
       logo 的绿底、白描线、深色标题全靠去掉 is-maintenance 回来
       （见 css/tools.css 的 .tool-btn.is-maintenance 那三条），
       只剩角标是绿的。 */
    if (isCleared()) {
      card.classList.remove('is-maintenance');
      prName.textContent = '囚徒困境';
      prTag.textContent  = '通关';
      prTag.className    = 'tool-maint-tag is-ok';
      prDesc.textContent = '背叛与信任';
      return;
    }

    card.classList.add('is-maintenance');

    /* ---- 损坏：名字都没了，只剩一个 404 ---- */
    if (spoilLevel() > 0) {
      prName.textContent = '[404]';
      prTag.textContent  = '损坏';
      prTag.className    = 'tool-maint-tag';
      prDesc.textContent = '页面不存在';
      /* 三句台词都听完了 = 连"坏掉的按钮"都不剩，只剩一张图 */
      if (spoilLevel() >= 4) card.classList.add('is-sealed');
      return;
    }

    /* ---- 完好（只是挂着「开发中」） ---- */
    prName.textContent = '囚徒困境';
    prTag.textContent  = '开发中';
    prTag.className    = 'tool-maint-tag';
    prDesc.textContent = '背叛与信任';
  }

  /* ---------- 坏掉的卡片：三句台词 ----------
     ★ 监听挂在卡片元素自身上（不是 document），所以一定比 tools.js
       那条「冒泡阶段打开功能页」的委托先跑到，stopPropagation 拦得住。
     完好 / 已通关的卡不拦，让它照常进页面。 */
  const SPOIL_LINES = ['…你还没放弃？', '卡片结构正在瓦解', '副本已吞噬'];

  card.addEventListener('click', e => {
    if (isCleared()) return;
    const lv = spoilLevel();
    if (lv <= 0) return;                    // 完好：交给 tools.js 打开
    e.preventDefault();
    e.stopPropagation();
    if (lv > 3) return;                     // 三句都听完了，已封死

    toast('info', SPOIL_LINES[lv - 1]);
    setSpoil(lv + 1);
    if (lv + 1 > 3) paintCard();            // 第三句说完，当场变贴图
  }, true);

  /* ---------- 四幕切换 ---------- */
  const stages = {
    '1':   $('#prStage1'),
    '2':   $('#prStage2'),
    '3':   $('#prStage3'),
    'egg': $('#prEgg'),
  };
  const prBody = $('#prBody');

  /* ---------- 打字机 ----------
     只打"【系统提示】"那两行和密文 —— 别的都直接给，
     满屏逐字打会把节奏拖死。原文存在 dataset 里，
     第二次进同一幕时 textContent 已经是完整的，得从 dataset 取。 */
  const typers = new Map();

  function typeInto(el, text, speed, done) {
    const old = typers.get(el);
    if (old) clearInterval(old);
    el.textContent = '';
    el.classList.add('is-typing');
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(id);
        typers.delete(el);
        el.classList.remove('is-typing');
        el.textContent = text;
        if (done) done();
      }
    }, speed);
    typers.set(el, id);
  }

  function typeFrom(el, speed, done) {
    if (!el) return;
    const text = el.dataset.text || el.textContent;
    el.dataset.text = text;
    typeInto(el, text, speed, done);
  }

  /* 换幕 / 退出前必须停：否则旧定时器会继续往已经藏起来的 <p> 里写字，
     下次进来两个 interval 抢同一个 textContent */
  function stopTypers() {
    typers.forEach(id => clearInterval(id));
    typers.clear();
    page.querySelectorAll('.is-typing').forEach(el => el.classList.remove('is-typing'));
  }

  function showStage(k) {
    stopTypers();
    Object.keys(stages).forEach(x => { stages[x].hidden = x !== k; });
    prBody.scrollTop = 0;

    /* 重放入场动画：先摘类、强制重排、再挂回去 */
    const el = stages[k];
    el.classList.remove('is-enter');
    void el.offsetWidth;
    el.classList.add('is-enter');

    if (k === '1') {
      typeFrom($('#prSys1'), 26);
    } else if (k === '2') {
      typeFrom($('#prSys2'), 26);
      /* 密文一个一个落下来，像终端在吐字符；吐完那道绿光算"解开了" */
      typeFrom($('#prCipherText'), 42, () => {
        const box = $('.pr-cipher');
        if (!box) return;
        box.classList.remove('is-decoded');
        void box.offsetWidth;
        box.classList.add('is-decoded');
        setTimeout(() => box.classList.remove('is-decoded'), 600);
      });
    }
  }

  /* 答对转场：先把这一幕抖一下（glitch），抖完才换 —— 
     顺序错了会看不见故障，直接跳到下一幕 */
  function advance(from, to) {
    const el = stages[from];
    el.classList.remove('is-glitch');
    void el.offsetWidth;
    el.classList.add('is-glitch');
    setTimeout(() => {
      el.classList.remove('is-glitch');
      showStage(to);
    }, 200);
  }

  /* ---------- 第一关：判决 ---------- */
  const opts1   = $('#prOpts1');
  const submit1 = $('#prSubmit1');
  let pick1 = '';

  /* 选中 ≠ 交卷：一次错的代价是整张卡，所以留一步「确认」好让人改主意 */
  opts1.addEventListener('click', e => {
    const b = e.target.closest('.pr-opt');
    if (!b) return;
    opts1.querySelectorAll('.pr-opt').forEach(x => x.classList.toggle('on', x === b));
    pick1 = b.dataset.val;
    submit1.disabled = false;
  });

  submit1.addEventListener('click', () => {
    if (!pick1) return;
    if (pick1 === 'B') advance('1', '2');
    else doom();
  });

  /* ---------- 第二关：破译 ---------- */
  const input2  = $('#prInput');
  const submit2 = $('#prSubmit2');
  let tries2 = 0;

  /* 归一：只留字母、转小写。
     ★ 顺手放过 "RELEASE." "release the prisoner" 这类手滑 ——
       这是道算术题，不该因为一个句号或空格掉命。 */
  function normalize(s) {
    return String(s).toLowerCase().replace(/[^a-z]/g, '');
  }

  function doSubmit2() {
    const norm = normalize(input2.value);
    if (!norm) return;                      // 空着交卷不算一次机会

    if (norm === 'release' || norm === 'releasetheprisoner') {
      advance('2', '3');
      return;
    }

    tries2 += 1;
    if (tries2 === 1) {
      /* 第一次错给一次重算：密文是算出来的，不是猜的，
         看岔一个字母就永久封卡太狠。
         ★ 不给"还剩几次"的提示 —— 系统不解释规则。 */
      toast('info', '你真的这么想？', '方向再对一遍。');
      input2.value = '';
      input2.focus();
      return;
    }
    doom();
  }

  submit2.addEventListener('click', doSubmit2);
  input2.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSubmit2(); }
  });

  /* ---------- 第三关：一句话 ---------- */
  const opts3   = $('#prOpts3');
  const submit3 = $('#prSubmit3');
  let pick3 = '';

  opts3.addEventListener('click', e => {
    const b = e.target.closest('.pr-opt');
    if (!b) return;
    opts3.querySelectorAll('.pr-opt').forEach(x => x.classList.toggle('on', x === b));
    pick3 = b.dataset.val;
    submit3.disabled = false;
  });

  submit3.addEventListener('click', () => {
    if (!pick3) return;
    if (pick3 === 'A') win();
    else doom();
  });

  /* ---------- 两个结局 ----------
     都不立刻收场：先让这一屏"死"给玩家看（红闪 / 故障），
     0.2~0.44 秒之后才换场景。ending 上锁，免得连点两下重复触发。 */
  let ending = false;

  function doom() {
    if (ending) return;
    ending = true;

    setSpoil(1);
    paintCard();
    page.classList.add('is-alarm');         // 四角泛红、整屏压暗
    setTimeout(() => {
      page.classList.remove('is-alarm');
      stopTypers();
      closeTool(page);                      // 先回首页，提示条才量得到底栏高度
      toast('err', '你已被副本吞没');
      ending = false;
    }, 440);
  }

  function win() {
    if (ending) return;
    ending = true;

    setCleared();
    paintCard();

    const el = stages['3'];
    el.classList.remove('is-glitch');
    void el.offsetWidth;
    el.classList.add('is-glitch');
    setTimeout(() => {
      el.classList.remove('is-glitch');
      showStage('egg');
      toast('ok', '副本通关，你看见了规则之外的东西');
      ending = false;
    }, 200);
  }

  /* ---------- 「逻辑规则」折叠 ---------- */
  const ruleToggle = $('#prRuleToggle');
  const ruleBox    = $('#prRule');

  ruleToggle.addEventListener('click', () => {
    const open = ruleBox.hidden;
    ruleBox.hidden = !open;
    ruleToggle.classList.toggle('on', open);
    ruleToggle.setAttribute('aria-expanded', String(open));
  });

  /* ---------- 进页面 ---------- */
  function resetRun() {
    pick1 = ''; pick3 = ''; tries2 = 0;
    ending = false;
    opts1.querySelectorAll('.pr-opt').forEach(x => x.classList.remove('on'));
    opts3.querySelectorAll('.pr-opt').forEach(x => x.classList.remove('on'));
    submit1.disabled = true;
    submit3.disabled = true;
    input2.value = '';
    ruleBox.hidden = true;
    ruleToggle.classList.remove('on');
    ruleToggle.setAttribute('aria-expanded', 'false');
  }

  /* tools.js 的 openTool 会广播 tool:open，这里接住做进入前的准备 */
  document.addEventListener('tool:open', e => {
    if (e.detail.key !== 'prisoner') return;
    /* 通关的人再点进来，直接看彩蛋 —— 不用重答，也不该重答 */
    if (isCleared()) { showStage('egg'); return; }
    resetRun();
    showStage('1');
  });

  /* 页面一加载就按存档把卡片画好：刷新之后 [404]、通关色都要留住 */
  paintCard();
})();
