/* ==========================================================================
   settings.js —— 底部「设置」齿轮
   离线版没有账号，设置里只有两项：
     · 更改称呼：改欢迎页上叫你的名字（只存本机 localStorage，见 home.js）
     · 关于 Nova：版本号 / 上次更新时间（写死在下面两个常量里）
   ========================================================================== */

/* ★ 发版时只改这两行，其他地方都读它们 */
const APP_VERSION = '1.1';
const APP_UPDATED = '2026.10.19';

const btnSettings  = $('#btnSettings');
const menuOverlay  = $('#menuOverlay');
const nameOverlay  = $('#nameOverlay');
const aboutOverlay = $('#aboutOverlay');

const setNameInput = $('#nameInput');
const setNameHint  = $('#nameHint');

/* 关掉之后把焦点还给齿轮 —— 键盘用户不会"丢在原地" */
function focusGear() {
  if (btnSettings) btnSettings.focus();
}

function openPanel(el, focusSel) {
  if (!el) return;
  el.classList.add('show');
  const t = focusSel ? el.querySelector(focusSel) : null;
  if (t) {
    setTimeout(() => {
      t.focus();
      /* 输入框里预填着旧名字：全选，直接打字就能覆盖 */
      if (t.select) t.select();
    }, 0);
  }
}
function closePanel(el) {
  if (el) el.classList.remove('show');
}

/* ---------- 齿轮 → 设置菜单 ---------- */
function openMenu() {
  openPanel(menuOverlay, '#miName');
}
if (btnSettings) btnSettings.addEventListener('click', openMenu);

const miCancel = $('#miCancel');
if (miCancel) miCancel.addEventListener('click', () => {
  closePanel(menuOverlay);
  focusGear();
});

/* ---------- 1) 更改称呼 ---------- */
function openNameDialog() {
  if (!nameOverlay) return;
  if (setNameInput) {
    setNameInput.value = homeName();
    setNameInput.classList.remove('err');
  }
  if (setNameHint) {
    setNameHint.classList.remove('err');
    setNameHint.textContent = '留空保存 = 恢复成默认的「' + NAME_DEFAULT + '」';
  }
  openPanel(nameOverlay, '#nameInput');
}

function saveName() {
  if (!setNameInput) return;
  /* 连续空白压成一个空格：名字里不该出现一串空格 */
  const raw = setNameInput.value.replace(/\s+/g, ' ').trim();

  if ([...raw].length > 12) {
    if (setNameHint) {
      setNameHint.classList.add('err');
      setNameHint.textContent = '最多 12 个字，现在 ' + [...raw].length + ' 个';
    }
    return;
  }

  try {
    if (!raw || raw === NAME_DEFAULT) localStorage.removeItem(NAME_KEY);
    else localStorage.setItem(NAME_KEY, raw);
  } catch (_) { /* 存不了（隐私模式）：这一次照样改，刷新后会退回默认 */ }

  paintHomeName();
  closePanel(nameOverlay);
  focusGear();
  toast('ok', raw && raw !== NAME_DEFAULT
    ? '称呼已改为「' + raw + '」'
    : '称呼已恢复成「' + NAME_DEFAULT + '」');
}

const miName = $('#miName');
if (miName) miName.addEventListener('click', () => {
  closePanel(menuOverlay);
  openNameDialog();
});

const nameSave = $('#nameSave');
if (nameSave) nameSave.addEventListener('click', saveName);

const nameCancel = $('#nameCancel');
if (nameCancel) nameCancel.addEventListener('click', () => {
  closePanel(nameOverlay);
  focusGear();
});

if (setNameInput) setNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveName(); }
});

/* ---------- 2) 关于 Nova ---------- */
function openAboutDialog() {
  if (!aboutOverlay) return;
  const v = $('#aboutVer');
  const d = $('#aboutDate');
  if (v) v.textContent = APP_VERSION;
  if (d) d.textContent = APP_UPDATED;
  openPanel(aboutOverlay, '#aboutClose');
}

const miAbout = $('#miAbout');
if (miAbout) miAbout.addEventListener('click', () => {
  closePanel(menuOverlay);
  openAboutDialog();
});

const aboutClose = $('#aboutClose');
if (aboutClose) aboutClose.addEventListener('click', () => {
  closePanel(aboutOverlay);
  focusGear();
});

/* ---------- 点遮罩关闭 ---------- */
[
  [menuOverlay, () => closePanel(menuOverlay)],
  [nameOverlay, () => closePanel(nameOverlay)],
  [aboutOverlay, () => closePanel(aboutOverlay)],
].forEach(([el, close]) => {
  if (!el) return;
  el.addEventListener('click', e => {
    /* 只认"点在外层遮罩上"：点弹窗里面的空白处不算 */
    if (e.target !== el) return;
    close();
    focusGear();
  });
});

/* ---------- Esc 逐层关 ----------
   走冒泡阶段：功能页自己的 Esc（tools.js 在捕获阶段拦）优先，
   那边 stopPropagation 之后这里自然收不到，不会把主页的菜单一起关掉 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const order = [aboutOverlay, nameOverlay, menuOverlay];
  for (const el of order) {
    if (el && el.classList.contains('show')) {
      closePanel(el);
      focusGear();
      return;
    }
  }
});
