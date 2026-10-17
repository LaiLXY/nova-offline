/* ==========================================================================
   home.js —— Nova Offline 的启动脚本
   离线版没有登录 / 注册 / 账号体系：打开就是主页，欢迎语默认叫「用户」。
   ========================================================================== */

/* ★ currentAccount 是「身份键」，不是给人看的名字。
   功能页拿它判断"换没换人"（points24 / game2048 / roman / convert 都读它），
   所以「更改称呼」绝对不能动这里 —— 改个名字就像换了个人，
   当前这局的盘面、输入框里的算式会被当成"别人的"清掉。
   页面上显示的名字另存 localStorage（nova_offline_name），见下方 homeName()。 */
const currentAccount = '用户';

/* 称呼：存在本机浏览器里；没存过 / 存的是空串 → 用默认的「用户」 */
const NAME_KEY = 'nova_offline_name';
const NAME_DEFAULT = '用户';

function homeName() {
  try {
    const v = localStorage.getItem(NAME_KEY);
    return v && v.trim() ? v : NAME_DEFAULT;
  } catch (_) {
    return NAME_DEFAULT;     // 隐私模式等拿不到 storage：退回默认
  }
}

const homePage = $('#homePage');
const homeUsername = $('#homeUsername');

/** 把欢迎语里的名字刷成当前称呼（settings.js 存完也叫一次） */
function paintHomeName() {
  if (homeUsername) homeUsername.textContent = homeName();
}

paintHomeName();
if (homePage) homePage.classList.add('show');
