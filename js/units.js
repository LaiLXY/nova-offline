/* ==========================================================================
   units.js —— 功能页：单位换算

   两层视图，都在 #toolUnits 这一个 .tool-page 里（用 hidden 切）：
     1. #unitCats  选类别（一张卡一个类别，现在是「长度」）
     2. #unitConv  换算界面：上框输数值 → 下框同步显示结果；
                   单位按钮点开是药丸弹窗（复用 app.css 那套 picker 外观）

   ★ 顶栏返回 / Esc 都是「先退一层」：
       换算界面 → 类别列表 → 才关掉整个功能页。
     tools.js 会把「返回」和「Esc」统一处理成关闭功能页，所以这里要拦一道：
       返回按钮 —— 在**捕获阶段**拦（tools.js 那个挂在冒泡阶段，捕获先跑）
       Esc     —— 挂在 window 的捕获阶段（事件从 window 往 document 传，
                  所以一定排在 tools.js 那个 document 捕获之前）
     代价是有一点点绕，换来的是「Esc 一次只退一层」和站内信 / 选择弹窗
     那些地方的手感一致。

   ★ 换算就是纯系数相乘：每个单位记一个「1 个它 = 多少基准单位」的 k，
     于是 结果 = 数值 × k(上) ÷ k(下)。长度以「米」为基准。
     带**偏移**的类别（温度：℉ = ℃ × 1.8 + 32）不能只靠一个 k，
     所以按类别分叉：UNITS 里挂一对 toBase / fromBase 钩子，
     没有钩子就走现在的纯系数那条路。

   ★ 还有一类连一对钩子都不够 ——「亮度」那一档跨了四个量
     （光通量 / 发光强度 / 光照度 / 亮度），单位之间还差着**立体角**和
     **面积**，得让用户另外补两个数。于是有了**副输入框**（cvtAux 那一节）：
       哪些副量用得着 = 上下单位的指数差（cvtAuxNeed），现算不写死
       副量怎么读     = 走下面同一套字符白名单 / 整串判读，额外多放行一个 π
                        （π 敲不出来，所以常用值做成了药丸，点一下就填进去）
     其它类别不带 aux 字段，这一整块永远不出现，行为一个字没变。

   ★ 输入口径分两层（cvtChar / cvtFilter → cvtParse）：
       1) 字符白名单：**只让敲数字、正负号、小数点、除号、e**（全角自动转半角），
          别的字符压根进不来 —— 其余字母、空格、中文都进不去。
          副输入框的立体角那一栏多放行一个 π（见 cvtAuxChar）。
       2) 整串判读：必须能读成下面几种之一，读不通就报错。
           自然数 / 0 / 负数 / 小数 / 分数（3/4 = 0.75）
           12   0   -7   1.5   .5   3/4   -1/2            ✓
           1.2.3   1/2/3   1/0   -   5-3                  ✗
           科学计数法（cvtParse，所有数值栏都认）
           1e+3   1e-9   1e3   2.5e+2   -4e+2             ✓
           1e+2.5   3/4e+2   ππ                            ✗

   ★ 软键盘（九、那一节）：从「罗马数字」的数字盘搬来，去掉「切换」，
     补上 . / e+ / π / 除号。**一个键盘伺候三个输入框**（数值 / 立体角 /
     面积），谁有焦点就往谁里面插字 —— 手机上让系统键盘弹三回是没法用的。
     「π」只在立体角的框里不是灰的。它是「函数图像」那种 flex 子项，
     不是浮层，收起来时空间原样还回去。

   ★ 两栏各挂一颗「复制」（七、那一节）：位置在字段头上、单位按钮的正上方
     （见 index.html 的 .cvt-head 和 css 里同名那条）。复制的是框里的
     **原文**，不拼单位；完事弹一条 toast。做法和手势整套照搬「罗马数字」
     那页 —— 连 execCommand 那条兜底也搬过来了（局域网 http 下剪贴板 API
     不给用，而本站经常是用 IP 打开的）。

   ★ 结果自己裁：不裁的话 1 厘米 ≈ 0.3937007874015748，一长串糊满输入框。
     这里按有效数字收尾（见 cvtFmt）；**整数例外，原样印出来** ——
     数据存储那两列换算出来都是整数，裁成科学计数法就把位数丢了。

   依赖 core.js（$ / setError / clearError / Device / toast）与 tools.js（tool:open）。
   ========================================================================== */

/* ---------- 常用节点 ---------- */
const UNIT_PAGE   = document.getElementById('toolUnits');
const unitBodyEl  = $('#toolUnitsBody');      // 滚动容器（两层视图都在这一个里滚）
const unitCatsEl  = $('#unitCats');
const unitConvEl  = $('#unitConv');
const unitTitleEl = $('.tool-title', UNIT_PAGE);

const cvtFrom    = $('#cvtFrom');
const cvtTo      = $('#cvtTo');
const cvtFromBtn = $('#cvtFromUnit');
const cvtToBtn   = $('#cvtToUnit');
const cvtSwapBtn = $('#cvtSwap');
const cvtCopyFromBtn = $('#cvtCopyFrom');    // 「数值」那栏的复制
const cvtCopyToBtn   = $('#cvtCopyTo');      // 「换算结果」那栏的复制
const cvtCatNoteEl = $('#cvtCatNote');       // 类别自己的注释（可选）

const unitPicker      = $('#unitPicker');
const unitPickerTitle = $('#unitPickerTitle');
const unitPickerChips = $('#unitPickerChips');
const unitPickerClose = $('#unitPickerClose');

/* 副输入块（只有「亮度」那一档用得上，见 UNITS.luminance 和下面 cvtAux* 那节） */
const cvtAuxEl        = $('#cvtAux');
const cvtAuxHeadEl    = $('#cvtAuxHead');
const cvtAuxOmegaItem = $('#cvtAuxOmegaItem');
const cvtAuxAreaItem  = $('#cvtAuxAreaItem');
const cvtAuxOmegaLbl  = $('#cvtAuxOmegaLabel');
const cvtAuxAreaLbl   = $('#cvtAuxAreaLabel');
const cvtAuxOmegaEl   = $('#cvtAuxOmega');
const cvtAuxAreaEl    = $('#cvtAuxArea');
const cvtAuxOmegaChips = $('#cvtAuxOmegaChips');

/* 软键盘（数值输入用，键位和取舍见下面 cvtPad 那一节） */
const cvtPad     = $('#cvtPad');
const cvtPadKeys = $('#cvtPadKeys');

/* ==========================================================
   一、数据：每个类别一份单位表
   ----------------------------------------------------------
   一条类别上有这些字段：
     name   类别名（显示在顶栏和类别卡上）
     from / to       进来时上、下两栏默认选中的单位 id
     units  单位表，每项 { id, label, sym, k }
              k     = 1 个该单位等于多少个**基准单位**
              sym   = 符号。像「亩」「斤」「天」这种没有通行符号的就不写，
                      那时按钮和药丸只显示中文名，不显示空括号
              group = 可选。同一类别里想分几组（体积 / 容积那样），
                      给这组单位挂同一个组名，弹窗里就会在**换组时换行**
                      并标出组名。用下面的 cvtGroup() 包一层最省事。
     note   可选。这一类想额外说明一句时写在这里（如能量那档的
            「注：大卡=千卡」），会显示在换算界面卡片下面；不写就不显示。
     toBase / fromBase（可选）带**偏移**的类别用它，见下面温度那条

   （图标配色不在这里 —— 13 张卡都是同一个蓝底白画，见 css/tools.css
     的 .unit-cat；本文件只管数据和换算。）

   基准单位每类各挑一个顺手的：
     长度 米      面积 平方米   体积 升       质量 千克
     时间 秒      速度 米/秒    温度 摄氏度   数据 字节
     压力 帕斯卡  功率 瓦       频率 赫兹     能量 焦耳

   加一个类别要动两处（和首页加功能卡片一个套路，两边靠 id 对齐）：
     · index.html 的 #unitCats 里复制一张类别卡，改 data-unit-cat / 图标 / 名字
     · 这里补一条，键名和 data-unit-cat 一致
   ========================================================== */

/** 给一组单位统一起个组名。只为写起来干净：
 *    ...cvtGroup('体积', [ ...单位... ]),
 *  等价于逐个在单位上写 group: '体积'。 */
const cvtGroup = (name, list) => list.map(u => Object.assign({ group: name }, u));

const UNITS = {
  /* ---------- 长度（基准：米） ----------
     四组按「公制 → 市制 → 英制 → 天文」排：
       公制    纳米 → 艾米，每级差 1000（分米、微米、纳米是往下补的）
       市制    分、寸、尺、丈、里 —— 用**现行市制**的定义（1 尺 = 1/3 米，
               1 丈 = 10 尺，1 里 = 150 丈 = 500 米）。这几个写在算式里
               而不是小数：1/3 是循环小数，写成 0.333333 会带进误差。
               这些单位没有通行的西文符号，所以不写 sym（按钮上就不显示括号）
       英制    英寸 / 英尺 / 码 / 英里
       天文    光年、秒差距 —— 秒差距按定义写成「648000 × 天文单位 ÷ π」，
               同样是除不尽的循环小数
     注：市制里那个「分」和时间的「分钟」、数据的「分」都没关系，
     这里是长度单位（1 分 = 1/10 寸）。 */
  length: {
    name: '长度',
    from: 'm', to: 'cm',
    units: [
      // 公制
      { id: 'nm', label: '纳米', sym: 'nm', k: 1e-9 },
      { id: 'um', label: '微米', sym: 'µm', k: 1e-6 },
      { id: 'mm', label: '毫米', sym: 'mm', k: 0.001 },
      { id: 'cm', label: '厘米', sym: 'cm', k: 0.01 },
      { id: 'dm', label: '分米', sym: 'dm', k: 0.1 },
      { id: 'm',  label: '米',   sym: 'm',  k: 1 },
      { id: 'km', label: '千米', sym: 'km', k: 1000 },
      { id: 'Mm', label: '兆米', sym: 'Mm', k: 1e6 },
      { id: 'Gm', label: '吉米', sym: 'Gm', k: 1e9 },
      { id: 'Tm', label: '太米', sym: 'Tm', k: 1e12 },
      { id: 'Pm', label: '拍米', sym: 'Pm', k: 1e15 },
      { id: 'Em', label: '艾米', sym: 'Em', k: 1e18 },
      // 市制（1 尺 = 1/3 米）
      { id: 'fen', label: '分',            k: 1 / 300 },
      { id: 'cun', label: '寸',            k: 1 / 30 },
      { id: 'chi', label: '尺',            k: 1 / 3 },
      { id: 'zhang', label: '丈',          k: 10 / 3 },
      { id: 'li',  label: '里',            k: 500 },
      // 英制
      { id: 'in', label: '英寸', sym: 'in', k: 0.0254 },
      { id: 'ft', label: '英尺', sym: 'ft', k: 0.3048 },
      { id: 'yd', label: '码',   sym: 'yd', k: 0.9144 },
      { id: 'mi', label: '英里', sym: 'mi', k: 1609.344 },
      // 海里不属于英制，是航海 / 航空专用的长度：
      //   1 海里 = 1852 米（1929 年国际海里定义，精确值）
      //   它也是速度里「节」的分母（1 节 = 1 海里/时）
      { id: 'nmi', label: '海里', sym: 'nmi', k: 1852 },
      // 天文
      //   1 天文单位 = 149597870700 米（2012 年起定为**精确值**，≈ 日地平均距离）
      //   1 光年 = 光速 × 儒略年 = 299792458 × 31557600 米（精确值）
      //   1 秒差距 = 648000/π 天文单位，天文单位 = 149597870700 米（精确值）
      { id: 'au', label: '天文单位', sym: 'au', k: 149597870700 },
      { id: 'ly', label: '光年',   sym: 'ly', k: 9.4607304725808e15 },
      { id: 'pc', label: '秒差距', sym: 'pc', k: 648000 * 149597870700 / Math.PI },
    ],
  },

  /* ---------- 面积（基准：平方米） ----------
     平方毫米以下（微米、纳米）是补上来的；公亩 / 公顷 / 亩 / 顷是同一套
     「地积」单位，1 公顷 = 100 公亩 = 15 亩，1 顷 = 100 亩。
     市制的平方尺 / 平方寸由长度那边平方而来（1 尺 = 1/3 米 → 平方尺 = 1/9 平方米）。
     凡长度那一档有、这里原先缺的平方都补齐了（市制那几支除外，
     即不再加平方丈 / 平方里之类）：公制大前缀的平方、平方英里、平方海里、
     平方天文单位。天文那几个的写法直接引用上面的定义，免得抄错数。 */
  area: {
    name: '面积',
    from: 'm2', to: 'cm2',
    units: [
      // 公制
      { id: 'nm2', label: '平方纳米', sym: 'nm²', k: 1e-18 },
      { id: 'um2', label: '平方微米', sym: 'µm²', k: 1e-12 },
      { id: 'mm2', label: '平方毫米', sym: 'mm²', k: 1e-6 },
      { id: 'cm2', label: '平方厘米', sym: 'cm²', k: 1e-4 },
      { id: 'dm2', label: '平方分米', sym: 'dm²', k: 0.01 },
      { id: 'm2',  label: '平方米',   sym: 'm²',  k: 1 },
      { id: 'km2', label: '平方千米', sym: 'km²', k: 1e6 },
      // 公制大前缀的平方（长度那边有、这里原来缺的补上；值 = 对应长度值²）
      { id: 'Mm2', label: '平方兆米', sym: 'Mm²', k: 1e12 },
      { id: 'Gm2', label: '平方吉米', sym: 'Gm²', k: 1e18 },
      { id: 'Tm2', label: '平方太米', sym: 'Tm²', k: 1e24 },
      { id: 'Pm2', label: '平方拍米', sym: 'Pm²', k: 1e30 },
      { id: 'Em2', label: '平方艾米', sym: 'Em²', k: 1e36 },
      // 地积（公亩 / 公顷 / 市制）。1 亩 = 10000/15 平方米 —— 除不尽的
      // 循环小数，写成算式比写 666.6666667 准。顷 = 100 亩，同样写成算式。
      { id: 'are',  label: '公亩',   sym: 'a',  k: 100 },
      { id: 'ha',   label: '公顷',   sym: 'ha', k: 10000 },
      { id: 'mu',   label: '亩',                 k: 10000 / 15 },
      { id: 'qing', label: '顷',                 k: 1000000 / 15 },
      // 市制（1 尺 = 1/3 米 → 平方尺 = 1/9 平方米；平方寸 = 1/900）
      { id: 'chi2', label: '平方尺',             k: 1 / 9 },
      { id: 'cun2', label: '平方寸',             k: 1 / 900 },
      // 英制 / 美制
      { id: 'in2',  label: '平方英寸', sym: 'in²', k: 0.00064516 },
      { id: 'ft2',  label: '平方英尺', sym: 'ft²', k: 0.09290304 },
      { id: 'yd2',  label: '平方码',   sym: 'yd²', k: 0.83612736 },
      { id: 'acre', label: '英亩',     sym: 'ac',  k: 4046.8564224 },
      // 长度那边有、这里原来缺的平方：英里 / 海里（平方英里没有通行缩写，
      // 沿用 mi²；平方海里 = 1852² 平方米）
      { id: 'mi2',  label: '平方英里', sym: 'mi²',  k: 1609.344 ** 2 },
      { id: 'nmi2', label: '平方海里', sym: 'nmi²', k: 1852 ** 2 },
      // 天文：天文单位 / 光年 / 秒差距的平方（定义见上面长度那一档）
      { id: 'au2', label: '平方天文单位', sym: 'au²', k: (149597870700) ** 2 },
      { id: 'ly2', label: '平方光年',   sym: 'ly²', k: (9.4607304725808e15) ** 2 },
      { id: 'pc2', label: '平方秒差距', sym: 'pc²',
                    k: (648000 * 149597870700 / Math.PI) ** 2 },
    ],
  },

  /* ---------- 体积＆容积（基准：升） ----------
     这一档分两组，弹窗里也是**换行分开**展示的（靠单位的 group 字段，
     见 cvtRenderChips）—— 混在一起太挤，也分不清哪个是立体的量、
     哪个是装液体的量：
       体积  立方纳米 → 立方千米，外加立方英寸 / 立方英尺（立体的量）
       容积  毫升 / 升 / 加仑 / 品脱 / 液量盎司（升这一系）
     两组换算口径是同一个：1 立方米 = 1000 升，所以「立方 X」的 k
     就是「米制那一档的 X 的值³ × 1000」。
     立方厘米正好等于毫升、立方分米正好等于升 —— 两个都留着，按习惯取用。
     凡长度那一档有、这里原先缺的立方都补齐了（市制那几支除外）：
     公制大前缀的立方、立方码、立方英里、立方海里、立方天文单位 / 光年 / 秒差距。 */
  volume: {
    name: '体积＆容积',
    from: 'l', to: 'ml',
    units: [
      ...cvtGroup('体积', [
        { id: 'nm3', label: '立方纳米', sym: 'nm³', k: 1e-24 },
        { id: 'um3', label: '立方微米', sym: 'µm³', k: 1e-15 },
        { id: 'mm3', label: '立方毫米', sym: 'mm³', k: 1e-6 },
        { id: 'cm3', label: '立方厘米', sym: 'cm³', k: 0.001 },
        { id: 'dm3', label: '立方分米', sym: 'dm³', k: 1 },
        { id: 'm3',  label: '立方米',   sym: 'm³',  k: 1000 },
        { id: 'km3', label: '立方千米', sym: 'km³', k: 1e12 },
        // 公制大前缀的立方（长度那边有、这里原来缺的补上；
        // 值 = 对应长度值³ × 1000，和上面「立方 X」同一个口径）
        { id: 'Mm3', label: '立方兆米', sym: 'Mm³', k: 1e21 },
        { id: 'Gm3', label: '立方吉米', sym: 'Gm³', k: 1e30 },
        { id: 'Tm3', label: '立方太米', sym: 'Tm³', k: 1e39 },
        { id: 'Pm3', label: '立方拍米', sym: 'Pm³', k: 1e48 },
        { id: 'Em3', label: '立方艾米', sym: 'Em³', k: 1e57 },
        { id: 'in3', label: '立方英寸', sym: 'in³', k: 0.016387064 },
        { id: 'ft3', label: '立方英尺', sym: 'ft³', k: 28.316846592 },
        // 长度那边有、这里原来缺的立方：码 / 英里 / 海里 / 天文那三支
        // （英寸、英尺上面已有；值 = 对应长度值³ × 1000）
        { id: 'yd3',  label: '立方码',     sym: 'yd³',  k: 0.9144 ** 3 * 1000 },
        { id: 'mi3',  label: '立方英里',   sym: 'mi³',  k: 1609.344 ** 3 * 1000 },
        { id: 'nmi3', label: '立方海里',   sym: 'nmi³', k: 1852 ** 3 * 1000 },
        { id: 'au3',  label: '立方天文单位', sym: 'au³', k: 149597870700 ** 3 * 1000 },
        { id: 'ly3',  label: '立方光年',   sym: 'ly³',
                      k: (9.4607304725808e15) ** 3 * 1000 },
        { id: 'pc3',  label: '立方秒差距', sym: 'pc³',
                      k: (648000 * 149597870700 / Math.PI) ** 3 * 1000 },
      ]),
      ...cvtGroup('容积', [
        { id: 'ml',     label: '毫升',         sym: 'mL',    k: 0.001 },
        { id: 'l',      label: '升',           sym: 'L',     k: 1 },
        { id: 'galus',  label: '美制加仑',     sym: 'gal',   k: 3.785411784 },
        { id: 'galuk',  label: '英制加仑',     sym: 'gal',   k: 4.54609 },
        { id: 'ptus',   label: '美制品脱',     sym: 'pt',    k: 0.473176473 },
        { id: 'flozus', label: '美制液量盎司', sym: 'fl oz', k: 0.0295735295625 },
      ]),
    ],
  },

  /* ---------- 质量（基准：千克） ----------
     叫「质量」而不是「重量」：这里的系数都是质量，跟当地重力无关。
     公制 纳克 → 百万吨；市制 钱 / 两 / 斤 / 担；英制 盎司 / 磅 / 英石；
     美吨是 short ton = 2000 磅，英吨是 long ton = 2240 磅 —— 两个都写
     sym 'ton'（各自语言里的习惯写法），靠中文名区分。 */
  mass: {
    name: '质量',
    from: 'kg', to: 'g',
    units: [
      // 公制
      { id: 'ng',  label: '纳克',   sym: 'ng', k: 1e-12 },
      { id: 'ug',  label: '微克',   sym: 'µg', k: 1e-9 },
      { id: 'mg',  label: '毫克',   sym: 'mg', k: 1e-6 },
      { id: 'g',   label: '克',     sym: 'g',  k: 0.001 },
      { id: 'kg',  label: '千克',   sym: 'kg', k: 1 },
      { id: 't',   label: '吨',     sym: 't',  k: 1000 },
      { id: 'kt',  label: '千吨',   sym: 'kt', k: 1e6 },
      { id: 'mtt', label: '百万吨', sym: 'Mt', k: 1e9 },
      // 市制：1 斤 = 500 g = 10 两 = 100 钱；1 担 = 100 斤
      { id: 'qian',  label: '钱', k: 0.005 },
      { id: 'liang', label: '两', k: 0.05 },
      { id: 'jin',   label: '斤', k: 0.5 },
      { id: 'dan',   label: '担', k: 50 },
      // 英制 / 美制
      { id: 'oz',    label: '盎司', sym: 'oz',  k: 0.028349523125 },
      { id: 'lb',    label: '磅',   sym: 'lb',  k: 0.45359237 },
      { id: 'st',    label: '英石', sym: 'st',  k: 6.35029318 },
      { id: 'uston', label: '美吨', sym: 'ton', k: 907.18474 },      // 2000 磅
      { id: 'ukton', label: '英吨', sym: 'ton', k: 1016.0469088 },   // 2240 磅
    ],
  },

  /* ---------- 时间（基准：秒） ----------
     月、季、年没有固定长度，分别按 30 天 / 90 天 / 365 天算 ——
     标签里都写清楚了，免得有人拿它当"这个月到底有几天"。
     世纪按 100 个上面的「年」算（36500 天）。 */
  time: {
    name: '时间',
    from: 'h', to: 'min',
    units: [
      { id: 'ms',  label: '毫秒',         sym: 'ms',  k: 0.001 },
      { id: 's',   label: '秒',           sym: 's',   k: 1 },
      { id: 'min', label: '分钟',         sym: 'min', k: 60 },
      { id: 'h',   label: '小时',         sym: 'h',   k: 3600 },
      { id: 'd',   label: '天',                        k: 86400 },
      { id: 'wk',  label: '周',                        k: 604800 },
      { id: 'mon', label: '月（30 天）',               k: 2592000 },
      { id: 'qtr', label: '季（90 天）',               k: 7776000 },
      { id: 'yr',  label: '年（365 天）',              k: 31536000 },
      { id: 'cen', label: '世纪（100 年）',            k: 3153600000 },
    ],
  },

  /* ---------- 速度（基准：米/秒） ---------- */
  speed: {
    name: '速度',
    from: 'kmh', to: 'ms',
    // 1 km/h = 1000/3600 m/s；1 节 = 1 海里/时 = 1852/3600 m/s
    units: [
      { id: 'ms',   label: '米/秒',   sym: 'm/s',   k: 1 },
      { id: 'kmh',  label: '千米/时', sym: 'km/h',  k: 1000 / 3600 },
      { id: 'mph',  label: '英里/时', sym: 'mph',   k: 0.44704 },
      { id: 'kn',   label: '节',      sym: 'kn',    k: 1852 / 3600 },
      { id: 'fts',  label: '英尺/秒', sym: 'ft/s',  k: 0.3048 },
      { id: 'mmin', label: '米/分',   sym: 'm/min', k: 1 / 60 },
    ],
  },

  /* ---------- 温度（基准：摄氏度） ----------
     这一档**没有 k**：这些刻度之间除了倍率还差一个偏移（℉ = ℃×1.8+32），
     一个系数装不下，所以改走下面两个钩子。
     兰氏度（°R）和开尔文一样从绝对零度起算，但每一度和华氏度一样大，
     所以 0 °R = -273.15 ℃、0 ℃ = 491.67 °R。
     列氏度（°Ré）和摄氏度一样拿水当基准，冰点也定在 0，但沸点定在 80，
     所以 1 °Ré = 1.25 ℃（℃ = °Ré × 5/4，反过来 °Ré = ℃ × 4/5）。
     罗氏度（°Rø）把水的冰点挪到 7.5、沸点定在 60（0 留给盐水的冰点），
     于是 ℃ = (°Rø − 7.5) × 40/21、°Rø = ℃ × 21/40 + 7.5。
     注意这三支 R 系刻度的符号都带后缀字母，就是为了彼此分开：
     兰氏度 °R、列氏度 °Ré、罗氏度 °Rø —— 只写 °R 的话弹窗里根本认不出谁是谁。
     其余类别不写这两个钩子，走的就是纯系数那条路。 */
  temp: {
    name: '温度',
    from: 'c', to: 'f',
    units: [
      { id: 'c',  label: '摄氏度', sym: '℃' },
      { id: 'f',  label: '华氏度', sym: '℉' },
      { id: 'k',  label: '开尔文', sym: 'K' },
      { id: 'r',  label: '兰氏度', sym: '°R' },
      { id: 're', label: '列氏度', sym: '°Ré' },
      { id: 'ro', label: '罗氏度', sym: '°Rø' },
    ],
    /** 该单位的值 → 摄氏度 */
    toBase(v, id) {
      if (id === 'f')  return (v - 32) / 1.8;
      if (id === 'k')  return v - 273.15;
      if (id === 'r')  return v / 1.8 - 273.15;
      if (id === 're') return v * 5 / 4;              // 1 °Ré = 1.25 ℃
      if (id === 'ro') return (v - 7.5) * 40 / 21;    // 7.5 °Rø = 0 ℃
      return v;
    },
    /** 摄氏度 → 该单位的值 */
    fromBase(v, id) {
      if (id === 'f')  return v * 1.8 + 32;
      if (id === 'k')  return v + 273.15;
      if (id === 'r')  return (v + 273.15) * 1.8;
      if (id === 're') return v * 4 / 5;
      if (id === 'ro') return v * 21 / 40 + 7.5;
      return v;
    },
  },

  /* ---------- 数据存储（基准：字节） ----------
     两套进位都留着，别混：
       KB / MB / GB…  十进制，1000 进位（硬盘厂商标的就是这套）
       KiB / MiB / GiB…  二进制，1024 进位（操作系统里显示的是这套）
     符号写「1024 B」这类说明，一眼就知道它按哪套算。
     单位补齐到 22 个以后，弹窗里按 group 分成**两段换行展示**
     （和体积＆容积那档一个做法）—— 22 个药丸混在一起太挤，也容易
     把 KB 和 KiB 认成一家。

     十进制那一列一直排到昆字节（QB）：太 / 拍 / 艾 / 泽 / 尧 是 SI 的老
     前缀，容（ronna，10²⁷）和昆（quetta，10³⁰）是 2022 年第 27 届国际
     计量大会新加的两个 —— 再往上没有更新的前缀了。所以 EB 之后不是
     跳到了没有，而是先把这两级补上，日常里的「全球数据总量」那类数
     就有地方落脚了。

     二进制那一列同样排到头：KiB → QiB 共十级，和上面的十级一一对应
     （PiB / EiB / ZiB / YiB 是老前缀，Ri / Qi 和上面对应的容 / 昆一样
     是 2022 年新加的）。
     这一列的值一律写成 1024 的幂，不写字面量：1024ⁿ = 2¹⁰ⁿ 是**精确的
     二次幂**，double 能原样装下（一直到最后 QiB = 2¹⁰⁰ 都精确），
     而 1180591620717411303424 这种二十几位的数写成十进制，抄错的概率
     远大于写 1024 ** 7。 */
  data: {
    name: '数据存储',
    from: 'gb', to: 'mb',
    units: [
      ...cvtGroup('十进制（1000 进位）', [
        { id: 'bit', label: '位',     sym: 'bit',      k: 0.125 },
        { id: 'b',   label: '字节',   sym: 'B',        k: 1 },
        { id: 'kb',  label: '千字节', sym: 'KB',       k: 1000 },
        { id: 'mb',  label: '兆字节', sym: 'MB',       k: 1e6 },
        { id: 'gb',  label: '吉字节', sym: 'GB',       k: 1e9 },
        { id: 'tb',  label: '太字节', sym: 'TB',       k: 1e12 },
        { id: 'pb',  label: '拍字节', sym: 'PB',       k: 1e15 },
        { id: 'eb',  label: '艾字节', sym: 'EB',       k: 1e18 },
        { id: 'zb',  label: '泽字节', sym: 'ZB',       k: 1e21 },
        { id: 'yb',  label: '尧字节', sym: 'YB',       k: 1e24 },
        { id: 'rb',  label: '容字节', sym: 'RB',       k: 1e27 },
        { id: 'qb',  label: '昆字节', sym: 'QB',       k: 1e30 },
      ]),
      ...cvtGroup('二进制（1024 进位）', [
        { id: 'kib', label: 'KiB',    sym: '1024 B',   k: 1024 },
        { id: 'mib', label: 'MiB',    sym: '1024 KiB', k: 1024 ** 2 },
        { id: 'gib', label: 'GiB',    sym: '1024 MiB', k: 1024 ** 3 },
        { id: 'tib', label: 'TiB',    sym: '1024 GiB', k: 1024 ** 4 },
        { id: 'pib', label: 'PiB',    sym: '1024 TiB', k: 1024 ** 5 },
        { id: 'eib', label: 'EiB',    sym: '1024 PiB', k: 1024 ** 6 },
        { id: 'zib', label: 'ZiB',    sym: '1024 EiB', k: 1024 ** 7 },
        { id: 'yib', label: 'YiB',    sym: '1024 ZiB', k: 1024 ** 8 },
        { id: 'rib', label: 'RiB',    sym: '1024 YiB', k: 1024 ** 9 },
        { id: 'qib', label: 'QiB',    sym: '1024 RiB', k: 1024 ** 10 },
      ]),
    ],
  },

  /* ---------- 压力（基准：帕斯卡） ----------
     1 标准大气压 = 101325 Pa（精确定义）。
     毫米汞柱和托不是一回事，别混：托的定义是**精确的** 1 atm/760
     = 133.322368421… Pa；毫米汞柱按汞的密度和标准重力算出来是
     133.322387415 Pa，两者差在小数点后第 5 位。两个都留，各自按定义写。
     英寸汞柱 = 25.4 毫米汞柱（同族的英制写法）。 */
  pressure: {
    name: '压力',
    from: 'atm', to: 'kpa',
    units: [
      { id: 'pa',    label: '帕斯卡',     sym: 'Pa',    k: 1 },
      { id: 'kpa',   label: '千帕',       sym: 'kPa',   k: 1000 },
      { id: 'mpa',   label: '兆帕',       sym: 'MPa',   k: 1e6 },
      { id: 'gpa',   label: '吉帕',       sym: 'GPa',   k: 1e9 },
      { id: 'bar',   label: '巴',         sym: 'bar',   k: 1e5 },
      { id: 'mbar',  label: '毫巴',       sym: 'mbar',  k: 100 },
      { id: 'atm',   label: '标准大气压', sym: 'atm',   k: 101325 },
      { id: 'torr',  label: '托',         sym: 'Torr',  k: 101325 / 760 },
      { id: 'mmhg',  label: '毫米汞柱',   sym: 'mmHg',  k: 133.322387415 },
      { id: 'inhg',  label: '英寸汞柱',   sym: 'inHg',  k: 3386.388640341 },
      // 毫米水柱：4 ℃ 的水在标准重力下一毫米高 ≈ 9.80665 Pa
      { id: 'mmh2o', label: '毫米水柱',   sym: 'mmH₂O', k: 9.80665 },
      { id: 'psi',   label: '磅每平方英寸', sym: 'psi', k: 6894.757293168361 },
    ],
  },

  /* ---------- 功率（基准：瓦） ----------
     两种马力不是一回事：公制马力 PS = 735.49875 W（欧洲 / 中国常用），
     英制马力 hp = 745.6998715822702 W（英美常用）。
     冷吨（制冷量）另有讲究：北美按 12000 BTU/时 = 3516.8528… W 算，
     写成算式保留精确值。 */
  power: {
    name: '功率',
    // 「匹」是买空调、说发动机时最常用的叫法（1 匹 ≈ 1 公制马力），
    // 单位表里写的是标准名「公制马力」，不解释一下容易让人以为少了它
    note: '注：匹=公制马力',
    from: 'kw', to: 'w',
    units: [
      { id: 'mw',    label: '毫瓦',     sym: 'mW', k: 0.001 },
      { id: 'w',     label: '瓦',       sym: 'W',  k: 1 },
      { id: 'kw',    label: '千瓦',     sym: 'kW', k: 1000 },
      { id: 'megaw', label: '兆瓦',     sym: 'MW', k: 1e6 },
      { id: 'gw',    label: '吉瓦',     sym: 'GW', k: 1e9 },
      { id: 'ps',    label: '公制马力', sym: 'PS', k: 735.49875 },
      { id: 'hp',    label: '英制马力', sym: 'hp', k: 745.6998715822702 },
      { id: 'rt',    label: '冷吨',     sym: 'RT', k: 12000 * 1055.05585262 / 3600 },
    ],
  },

  /* ---------- 频率（基准：赫兹） ---------- */
  freq: {
    name: '频率',
    from: 'mhz', to: 'khz',
    units: [
      { id: 'hz',  label: '赫兹',   sym: 'Hz',  k: 1 },
      { id: 'khz', label: '千赫兹', sym: 'kHz', k: 1000 },
      { id: 'mhz', label: '兆赫兹', sym: 'MHz', k: 1e6 },
      { id: 'ghz', label: '吉赫兹', sym: 'GHz', k: 1e9 },
      { id: 'thz', label: '太赫兹', sym: 'THz', k: 1e12 },
      { id: 'rpm', label: '转/分',  sym: 'rpm', k: 1 / 60 },
    ],
  },

  /* ---------- 能量＆热量（基准：焦耳） ----------
     分两组，弹窗里换行展示（同体积＆容积那档）：热量在前、能量在后。

     几处容易混的地方，都按下面的口径定死：

     卡路里：这个词有好几个定义（热化学卡 4.184 J、国际表卡 4.1868 J、
       15℃ 卡 4.1855 J）。营养学和物理题里通用的都是**热化学卡 4.184 J**，
       所以照它算；千卡（= 大卡）= 1000 卡，正是食品标签上那个「千卡」。

     瓦时：1 Wh = 3600 J（= 1 W 持续 1 小时），所以 kWh = 3.6e6 J、
       兆瓦时 = 3.6e9 J。这几个是纯算术，没有定义分歧。

     英热单位：取国际表 BTU_IT = 1055.05585262 J —— 和功率那档的「冷吨」
       同一个口径（冷吨也是按 BTU/时 定的），两处别用不同的 BTU。

     英尺·磅力：1 lbf = 4.4482216152605 N、1 ft = 0.3048 m，乘起来是
       1.3558179483314004 J。写成算式，让两个定义都在代码里看得见。

     撒姆（therm）：= 100,000 BTU，所以直接拿上面 BTU 的数乘 100000，
       不另抄一个近似值。

     电子伏特：1 eV = 1.602176634e-19 J，2019 年国际单位制改版后
       这个数是**精确值**（由基本电荷定义而来），不是测量出来的。

     吨 TNT 当量：按定义 1 g TNT = 4184 J，所以 1 吨 = 4.184e9 J。
       千吨 TNT 当量 = 1000 倍。注意它和「卡路里」共用 4184 这个数 ——
       这是定义上的巧合（都由热化学卡推出来），不是笔误。 */
  energy: {
    name: '能量＆热量',
    // 两行都是"日常叫法 ↔ 单位表里的标准名"的对照，各占一行（\n 换行，
    // 见 .cvt-cat-note 的 white-space）：
    //   「大卡」是食品标签上的说法，单位表里写的是千卡
    //   「度」是电表的说法，就是千瓦时 —— 说"1 度电"没人会换算，
    //     得明确告诉他这个"度"就是千瓦时
    note: '注：大卡=千卡\n注：1 度电的「度」= 千瓦时',
    from: 'kj', to: 'kcal',
    units: [
      // 和体积＆容积一样分两组、弹窗里换行展示（见 cvtRenderChips）。
      // 热量放前面：这一档最常用的两个（千卡、卡路里）都在这里，
      // 平时算食品热量、题目里的热量，进来一眼就能看到。
      ...cvtGroup('热量', [
        { id: 'cal',   label: '卡路里',       sym: 'cal',    k: 4.184 },
        { id: 'kcal',  label: '千卡',         sym: 'kcal',   k: 4184 },
        { id: 'btu',   label: '英热单位',     sym: 'BTU',    k: 1055.05585262 },
        { id: 'therm', label: '撒姆',         sym: 'therm',  k: 100000 * 1055.05585262 },
      ]),
      // 能量这一组按「国际单位制 → 电能 → 力学 → 微观 → 爆炸当量」排
      ...cvtGroup('能量', [
        { id: 'j',     label: '焦耳',         sym: 'J',      k: 1 },
        { id: 'kj',    label: '千焦',         sym: 'kJ',     k: 1000 },
        { id: 'mj',    label: '兆焦',         sym: 'MJ',     k: 1e6 },
        { id: 'wh',    label: '瓦时',         sym: 'Wh',     k: 3600 },
        { id: 'kwh',   label: '千瓦时',       sym: 'kWh',    k: 3.6e6 },
        { id: 'mwh',   label: '兆瓦时',       sym: 'MWh',    k: 3.6e9 },
        { id: 'ftlbf', label: '英尺·磅力',    sym: 'ft·lbf', k: 4.4482216152605 * 0.3048 },
        { id: 'ev',    label: '电子伏特',     sym: 'eV',     k: 1.602176634e-19 },
        { id: 'kev',   label: '千电子伏特',   sym: 'keV',    k: 1.602176634e-16 },
        { id: 'mev',   label: '兆电子伏特',   sym: 'MeV',    k: 1.602176634e-13 },
        { id: 'ttnt',  label: '吨TNT当量',    sym: 'tTNT',   k: 4.184e9 },
        { id: 'kttnt', label: '千吨TNT当量',  sym: 'ktTNT',  k: 4.184e12 },
      ]),
    ],
  },

  /* ---------- 亮度＆光度（基准：流明） ----------
     ★ 这一档和上面所有类别都不一样，是**唯一需要副输入框**的：
     别的类别里各单位是"同一个量、不同大小"（1 米 = 100 厘米），
     这一档的四个单位是**四个不同的量**：

       流明 lm    光通量 Φ
       坎德拉 cd  发光强度 I = Φ / Ω     （每立体角 —— "这个方向多亮"）
       勒克斯 lx  光照度   E = Φ / A     （每面积   —— "照到地上多亮"）
       尼特 nit   亮度     L = Φ / (Ω·A) （既每立体角、又每面积）

     把它们接起来的是两座桥：**立体角 Ω**（球面度 sr）和**面积 A**（m²）。
     所以「1 流明等于多少尼特」这种问法，答数取决于你给多大的 Ω 和 A ——
     信息不够，一个系数说不出来。这就是这一档必须多两个副输入框的原因。

     实现上给每个单位记一对指数 (a, b)，含义是「该单位 = lm · srᵃ · mᵇ」：
       lm (0,0)    cd (-1,0)    lx (0,-1)    nit (-1,-1)
     于是
       基准值（流明） Φ = 数值 × Ω^(−a) × A^(−b)
     反过来除一次，就落到目标单位。剩下的交给上面那套 toBase / fromBase 钩子，
     只是比温度那两个多接一个 aux 参数（= 用户填的立体角和面积）。

     哪个副量用得着，由**上下单位的指数差**现算（见 cvtAuxNeed），不写死：
       指数 a 不同 → 要立体角      指数 b 不同 → 要面积
       （两个都不同 → 两个都要；lm↔nit 和 cd↔lx 就是这两对）
     于是：
       lm↔cd   只要 Ω      lm↔lx   只要 A      lm↔nit   Ω 和 A
       cd↔nit  只要 A      lx↔nit  只要 Ω      cd↔lx    Ω 和 A

     sr 在 SI 里是无量纲的（1 sr = 1 m²/m²），所以塞不进单位表里那个 k，
     只能让用户当场给 —— 这是它必须是个"框"而不是"系数"的根本原因。 */
  luminance: {
    name: '亮度',
    from: 'lm', to: 'cd',
    /* 单位表按**四个量**分组，弹窗里一行一个（和「体积＆容积」一个套路，
       见 cvtRenderChips）：
           光通量   流明
           光照度   勒克斯
           发光强度 坎德拉
           亮度     尼特
       这里每个组里只有一个单位 —— 分组在这儿不是为了"同类聚在一起"，
       而是为了让那个量名（光通量 / 光照度 / …）作为一行的标题出现，
       让人一眼看出「流明是量光通量的、尼特是量亮度的」。
       别的类别里单位是同名不同大小，混着列也无所谓；这一档四个单位
       名字完全不搭，不标出各自是哪个量就真分不清。
       （所以这一档也没有 UNITS[].note：要说的话全在弹窗里了。） */
    units: [
      ...cvtGroup('光通量', [
        { id: 'lm',  label: '流明',   sym: 'lm',  a: 0,  b: 0 },
      ]),
      ...cvtGroup('光照度', [
        { id: 'lx',  label: '勒克斯', sym: 'lx',  a: 0,  b: -1 },
      ]),
      ...cvtGroup('发光强度', [
        { id: 'cd',  label: '坎德拉', sym: 'cd',  a: -1, b: 0 },
      ]),
      ...cvtGroup('亮度', [
        { id: 'nit', label: '尼特',   sym: 'nit', a: -1, b: -1 },
      ]),
    ],
    /* 副输入框的说明。哪几个会出现由 cvtAuxNeed 算，这里只管它们长什么样。
       placeholder 里的例子是给用户看的 —— 真要填，点上面那排药丸就行，
       不用（也没法）把 π 敲进键盘。「4/3π」这种分数×π 也认（= 4π/3），
       所以也放进示例里。 */
    aux: {
      omega: { label: '立体角 Ω', unit: 'sr', placeholder: '例如 4π、0.5π、4/3π' },
      area:  { label: '面积 A',   unit: 'm²', placeholder: '例如 1、0.5' },
    },
    /** 该单位的值 → 流明（aux = { omega, area }，用不上的那个可以不传） */
    toBase(v, id, aux) {
      const u = this.units.find(x => x.id === id);
      return v * cvtAuxWeight(u, aux);
    },
    /** 流明 → 该单位的值 */
    fromBase(v, id, aux) {
      const u = this.units.find(x => x.id === id);
      return v / cvtAuxWeight(u, aux);
    },
  },
};

const UNIT_HOME = 'length';          // 每次进来从哪一类开始

/* ---------- 运行状态 ---------- */
let cvtCat     = UNIT_HOME;              // 当前类别
let cvtSel     = { from: '', to: '' };   // 上下两栏分别选中的单位 id
let cvtPicking = null;                   // 弹窗正为哪一栏开着：'from' | 'to' | null

/* ==========================================================
   二、小工具
   ========================================================== */

/** 当前类别的单位表 */
function cvtUnits() {
  const cat = UNITS[cvtCat];
  return cat ? cat.units : [];
}

/** 按 id 取一个单位（取不到返回 null，调用方自己兜） */
function cvtUnit(id) {
  return cvtUnits().find(u => u.id === id) || null;
}

/** 副输入的权重：Ω^(−a) · A^(−b)。
 *
 *  只有「亮度」那一档用得上，指数 a / b 的含义见 UNITS.luminance 那段说明。
 *  指数是 0 的那一项在这次换算里用不到，aux 里没给值也照样对
 *  （Math.pow(任意数, 0) 恒为 1）—— 所以「只要立体角」的那些组合
 *  完全不用管面积填没填。 */
function cvtAuxWeight(u, aux) {
  const a = u.a || 0;
  const b = u.b || 0;
  const omega = aux && aux.omega != null ? aux.omega : 1;
  const area  = aux && aux.area  != null ? aux.area  : 1;
  return Math.pow(omega, -a) * Math.pow(area, -b);
}

/** 科学计数法：最多 4 位小数，并去掉尾数后面多余的 0（1.0000e-7 → 1e-7） */
function cvtSci(v) {
  return v.toExponential(4).replace(/\.?0+e/, 'e');
}

/** 换算结果的显示：
 *
 *  · **整数原样印**（见下面那条）：数据存储那两列换算出来全是整数，
 *    用户要的就是那串确切数字，科学计数法反而把位数裁掉了
 *  · **「10 位有效数字」只管小数**：整数已经在上面被接走了，走到这一步的
 *    都不是整数。小数按**有效数字**收尾（10 位），不是按小数位 ——
 *    0.0006213711922 和 1609.344 这种量级差很远的数，用同一个小数位数
 *    是没法兼顾的
 *  · 收完再去掉尾随的 0（100.0000000 → 100），输入框里才干净
 *  · 太大 / 太小的数改用科学计数法，否则「0.000000000001」这种一行全是 0
 */
function cvtFmt(v) {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';

  const a = Math.abs(v);

  /* 整数先兜一道：1 TiB → B 是 1099511627776，写成 1.0995e+12 等于把用户
     想看的那几位裁了；而且下面 toPrecision(10) 那条路还会把 999999999999
     这种 12 位整数舍成 1e+12，更亏。
     上限卡在 2⁵³（Number.isSafeInteger，即 |v| ≤ 2⁵³−1）：double 只保证
     这个范围内的整数一位不差，再往上 Number → String 印出来的末几位是
     假的 —— 2⁶⁰ 会印成 1152921504606847000，而它的真身是
     1152921504606846976。所以超了就老老实实回到科学计数法，绝不印假数字。 */
  if (Number.isSafeInteger(v)) return String(v);

  if (a >= 1e12 || a < 1e-6) return cvtSci(v);

  const s = v.toPrecision(10);
  if (s.indexOf('e') >= 0) return cvtSci(v);      // 兜底：仍被写成指数形式
  return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 单个字符的归一 + 放行：
 *    · 全角数字、全角标点、中文句号、各种减号 / 除号 → 半角 ASCII
 *    · 数字 / - / + / . / / / e 各自放行
 *    · 其余一律返回空串（调用方会把它丢掉）
 *
 *  放行表收得很窄，但比原来多了两个字符 —— `e` 和 `+`，为的是科学计数法
 *  （1e+3 这种）。`e` 只认得小写（大写 E、全角 ｅ 都归一成它），
 *  于是 `1E3` 和 `1e3` 是同一个意思，`+` 则只用在指数里
 *  （`+5` 这种写法判读那步会挡下来，见 cvtParsePlain）。
 *  空格、中文、别的字母照样进不来。归一都是一比一，所以改完不影响光标位置。 */
function cvtChar(ch) {
  if (ch >= '\uFF10' && ch <= '\uFF19') {                // ０-９
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }
  if (ch === '\uFF0E' || ch === '\u3002') return '.';    // ．。
  if (ch === '\u2212' || ch === '\uFF0D' ||
      ch === '\u2013' || ch === '\u2014') return '-';    // − － – —
  if (ch === '\u00F7' || ch === '\uFF0F') return '/';    // ÷ ／
  if (ch === '\uFF0B') return '+';                       // ＋
  if (ch === '\uFF45' || ch === '\uFF25' || ch === 'E') return 'e';  // ｅ Ｅ E
  if ('0123456789.-/+e'.indexOf(ch) >= 0) return ch;
  return '';
}

/** 就地过一遍输入框，把放行表之外的字符剔掉。
 *
 *  直接改 value 会把光标顶到末尾，所以要先数出「光标前面被删掉了几个
 *  字符」，再把光标放回原来的位置 —— 否则在中间插一个字，光标就飞到最后。
 *
 *  charMap 可以换成别的一套放行表 —— 副输入框要放行 π，走的就是
 *  cvtAuxChar（见下）。不传就是主输入框那套最窄的表。 */
function cvtFilter(el, charMap) {
  const map = charMap || cvtChar;
  const raw = el.value;
  const caret = typeof el.selectionStart === 'number' ? el.selectionStart : raw.length;
  let out = '';
  let dropped = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = map(raw.charAt(i));
    if (ch) out += ch;
    else if (i < caret) dropped++;
  }

  if (out === raw) return;
  el.value = out;
  const pos = Math.max(0, Math.min(caret - dropped, out.length));
  try { el.setSelectionRange(pos, pos); } catch (_) {}
}

/** 副输入框的字符表 = 上面那套 + 圆周率 π。
 *
 *  π 只放在**立体角**那一栏用（面积跟圆周率没关系，那栏走的还是 cvtChar）。
 *  软键盘上专门有个「π」键（见下面 cvtPad 那一节），点一下就是这个字符；
 *  从别处粘一行 0.5π 进来，也认。
 *  ∏（U+220F，数学里的连乘号）长得像，顺手也归一成 π —— 粘错了不至于
 *  被静默吃掉，变成一个莫名其妙的结果。 */
function cvtAuxChar(ch) {
  if (ch === '\u03C0' || ch === '\u220F' || ch === '\u1D28') return 'π';
  return cvtChar(ch);
}

/* ==========================================================
   三、判读：整串必须读得出来，且是「自然数 / 0 / 负数 / 小数 / 分数 / 科学计数法」
   ========================================================== */

/** 不带指数的那一层判读。返回 { empty:true }、{ value } 或 { msg }。
 *
 *  认得的形状（正负号可选，且只能在最前面）：
 *      自然数 / 0   12、0
 *      小数         1.5、.5、1.（尾随的小数点当成整数）
 *      分数         a/b，a、b 都是自然数，b ≠ 0；按除法算
 *      负数         上面任意一种前面加 -
 *  其余一律报错：小数点或除号多了、符号不在最前、缺胳膊少腿……
 *  具体报什么在下面逐条给，尽量让用户一眼知道该改哪儿。
 *
 *  科学计数法那层（e±指数）在下面的 cvtParse 里，先摘掉指数再叫这里 ——
 *  于是「尾数怎么读」的规矩只有这一份，两处不会各写一套。 */
function cvtParsePlain(raw) {
  if (!raw) return { empty: true };

  let body = raw;
  let neg = false;
  if (body.charAt(0) === '-') { neg = true; body = body.slice(1); }
  else if (body.charAt(0) === '+') body = body.slice(1);   // 前面多打一个 + 不较真

  if (!body) return { msg: '数字还没写完' };
  if (body === '.') return { msg: '数字还没写完' };

  const parts = body.split('/');
  if (parts.length > 2) return { msg: '除号只能有一个' };

  if (parts.length === 2) {
    const a = parts[0], b = parts[1];
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) {
      return { msg: '分数要写成「数字/数字」，例如 3/4' };
    }
    if (Number(b) === 0) return { msg: '分母不能为 0' };
    const v = Number(a) / Number(b);
    return { value: neg ? -v : v };
  }

  if ((body.match(/\./g) || []).length > 1) return { msg: '小数点只能有一个' };
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(body)) {
    return { msg: '只能填一个数，例如 -3、1.5、3/4' };
  }
  const v = Number(body);
  return { value: neg ? -v : v };
}

/** 判读输入（带科学计数法）。返回 { empty:true }、{ value } 或 { msg }。
 *
 *  在 cvtParsePlain 上面多认一层**科学计数法**，形状是
 *
 *        尾数 e ± 指数
 *
 *      1e+3     → 1000        （键盘上那个「e+」键就是插 "e+"）
 *      1e-9     → 1e-9        （不用 e 的话得写 0.000000001）
 *      1e3      → 1000        （指数前的 ± 可以省）
 *      2.5e+2   → 250
 *      -4e+2    → -400
 *      1.5e-4   → 0.00015
 *
 *  几条刻意的取舍：
 *    · 指数必须是**整数**，不带小数点（1e+2.5 不收）—— 真有这种需求，
 *      尾数上拨一位就行
 *    · 尾数不许是**分数**：`3/4e+2` 到底该读成 (3/4)×100 还是 3/(4×100)？
 *      两种都讲得通，索性两个都不认，让人改写成 0.75e+2
 *    · e 只能有一个，尾数照旧走 cvtParsePlain，所以 12、-3、1.5 都能当尾数
 */
function cvtParse(raw) {
  if (!raw) return { empty: true };

  const eAt = raw.search(/[eE]/);
  if (eAt < 0) return cvtParsePlain(raw);

  const mant = raw.slice(0, eAt);
  let exp = raw.slice(eAt + 1);

  if (exp.search(/[eE]/) >= 0) return { msg: 'e 只能有一个' };
  if (mant.indexOf('/') >= 0) {
    return { msg: '科学计数法不能再带分数，尾数写成小数，例如 0.75e+3' };
  }
  if (!exp) return { msg: 'e 后面还要写指数，例如 1e+3' };

  let sign = 1;
  if (exp.charAt(0) === '+') exp = exp.slice(1);
  else if (exp.charAt(0) === '-') { sign = -1; exp = exp.slice(1); }
  if (!/^\d+$/.test(exp)) return { msg: '指数要写成整数，例如 1e+3、2.5e-4' };

  const m = cvtParsePlain(mant);
  if (m.empty) return { msg: 'e 前面要有一个数，例如 1e+3' };
  if (m.msg) return m;

  // 0e+999 之类：Math.pow 会给 Infinity、0×Infinity 又是 NaN，先把 0 摘出去
  const v = m.value === 0 ? 0 : m.value * Math.pow(10, sign * Number(exp));
  return Number.isFinite(v) ? { value: v } : { msg: '这个数字太大了' };
}

/** 副输入框的判读：cvtParse 那套 + 允许**末尾带一个 π**。
 *
 *    4π   → 4 × π          （点药丸就是把这个串写进框里）
 *    π    → π
 *    0.5π → 0.5 × π
 *    1    → 1
 *
 *  allowPi 为 false 的框（面积）就不认 π —— 面积跟圆周率没关系，
 *  万一写了个 π 出来，直接按 cvtParse 报错，别静默算出一个怪结果。 */
function cvtAuxParse(raw, allowPi) {
  if (!raw) return { empty: true };

  let body = raw;
  let pi = false;
  if (allowPi && body.slice(-1) === 'π') {
    pi = true;
    body = body.slice(0, -1);
  }
  if (!body) return pi ? { value: Math.PI } : { msg: '数字还没写完' };

  const p = cvtParse(body);
  if (p.empty || p.msg) return p;
  return { value: pi ? p.value * Math.PI : p.value };
}

/* ==========================================================
   四、换算：上框 → 下框
   ========================================================== */

/** 把一个值从「上单位」换到「下单位」。
 *
 *  三条路：
 *    · 纯系数（绝大多数类别）：值 × k上 ÷ k下
 *    · 带偏移的类别（温度）：走类别自己的 toBase / fromBase 钩子，
 *      先化成基准值，再从基准值化到目标单位
 *    · 跨量的类别（亮度）：同一对钩子，但多传一个 aux
 *      （= 用户填的立体角 / 面积），因为那两个量光靠单位是推不出来的
 */
function cvtConvert(v, aux) {
  const cat = UNITS[cvtCat];
  const f = cvtUnit(cvtSel.from);
  const t = cvtUnit(cvtSel.to);
  if (!f || !t) return null;

  if (cat && typeof cat.toBase === 'function' && typeof cat.fromBase === 'function') {
    return cat.fromBase(cat.toBase(v, f.id, aux), t.id, aux);
  }
  return v * f.k / t.k;
}

/** 上框是唯一输入源，下框只是显示（readonly）。空着不算错，直接清空结果。
 *
 *  顺序上有一点讲究：**先**把副输入那块摆好（显隐 + 清提示），再算数值。
 *  因为副输入块只跟「上下单位」有关，跟主框里填没填没关系 —— 上下单位
 *  一换（互换按钮 / 换单位），这一块该出现该消失都要立刻跟上。 */
function cvtSync() {
  const need = cvtAuxNeed();
  cvtPaintAux(need);
  cvtAuxClearNotes();

  const raw = cvtFrom.value;
  if (!raw) {
    cvtTo.value = '';
    clearError(cvtFrom);
    // 主框空着也要把副输入摆好：用户可能先填几何量、再回来填数值
    cvtDemandAux(need);
    return;
  }

  const p = cvtParse(raw);
  if (p.msg) {
    cvtTo.value = '';
    setError(cvtFrom, p.msg);
    cvtDemandAux(need);
    return;
  }
  // 位数多到 Number 也接不住（几百位数字）——单独说一句，别让它静默变成 Infinity
  if (!Number.isFinite(p.value)) {
    cvtTo.value = '';
    setError(cvtFrom, '这个数字太大了');
    cvtDemandAux(need);
    return;
  }
  clearError(cvtFrom);

  // 副输入：需要但没填 / 填错了，就先不出结果。
  // 没填只给一句灰提示，不标红 —— 刚进这一类时本来就是空的，
  // 一上来就满屏红框太吓人；填了但不对才标红。
  const aux = cvtReadAux(need);
  if (aux.msg) {
    cvtTo.value = '';
    cvtAuxNote(aux);
    return;
  }

  const out = cvtConvert(p.value, aux.values);
  cvtTo.value = out === null ? '' : cvtFmt(out);
}

/* ----------------------------------------------------------
   四之二、副输入框（立体角 / 面积）
   ----------------------------------------------------------
   只有「亮度」那一档（UNITS.luminance）用得上：那一档的单位跨了四个量，
   光靠单位之间的系数换不过去，还得知道光摊在多宽的立体角、多大一片面积上。

   这一节干三件事：
     cvtAuxNeed    —— 当前这对上下单位，到底缺哪个几何量（现算，不写死）
     cvtPaintAux   —— 按上一步的结果摆显隐、写标签和那句说明
     cvtReadAux    —— 把框里的字读成数（顺带校验），给换算那步用
   其它类别没有 aux 字段：cvtAuxNeed 一律返回"都不要"，整块 hidden，
   行为和一个字没改之前完全一样。
   ---------------------------------------------------------- */

/** 当前这对上下单位，需不需要立体角 / 面积。
 *
 *  判据是**指数差**（指数 a / b 的含义见 UNITS.luminance）：
 *    a 不同 → 差着立体角     b 不同 → 差着面积
 *  不用一张 (from,to) 的表逐个列 —— 单位加一个（比如将来补「熙提」）
 *  也照样对。 */
function cvtAuxNeed() {
  const none = { omega: false, area: false };
  const cat = UNITS[cvtCat];
  if (!cat || !cat.aux) return none;

  const f = cvtUnit(cvtSel.from);
  const t = cvtUnit(cvtSel.to);
  if (!f || !t) return none;

  return {
    omega: (f.a || 0) !== (t.a || 0),
    area:  (f.b || 0) !== (t.b || 0),
  };
}

/** 摆副输入块：整体的显隐、每一栏的显隐、标签上的单位、顶头那句说明。
 *
 *  标签和 placeholder 都从数据的 aux 里取 —— 想改文案改 UNITS 那边就行，
 *  不用回来翻这里。（回形针一样的空括号问题在这不存在：
 *  label 自带单位，symbol 有就写、没有就只剩名字。） */
function cvtPaintAux(need) {
  const cat = UNITS[cvtCat];
  const spec = (cat && cat.aux) || null;
  const want = !!(spec && (need.omega || need.area));

  cvtAuxEl.hidden = !want;
  if (!want) return;

  cvtAuxOmegaItem.hidden = !need.omega;
  cvtAuxAreaItem.hidden  = !need.area;

  if (need.omega && spec.omega) {
    cvtAuxOmegaLbl.textContent = spec.omega.label + '（' + spec.omega.unit + '）';
    cvtAuxOmegaEl.placeholder = spec.omega.placeholder || '';
  }
  if (need.area && spec.area) {
    cvtAuxAreaLbl.textContent = spec.area.label + '（' + spec.area.unit + '）';
    cvtAuxAreaEl.placeholder = spec.area.placeholder || '';
  }

  // 说明「这一对单位之间到底差着什么」——不然冒出来一个空框，用户不知道要填啥。
  // 名字取当前的上下单位，跟着换单位一起变。
  const f = cvtUnit(cvtSel.from);
  const t = cvtUnit(cvtSel.to);
  const parts = [];
  if (need.omega) parts.push('立体角');
  if (need.area) parts.push('面积');
  cvtAuxHeadEl.textContent =
    '「' + (f ? f.label : '？') + '」和「' + (t ? t.label : '？') + '」之间还差' +
    parts.join('和') + '，填好才能换算';

  cvtPaintAuxChips();
}

/** 把两个副输入框的提示清干净（红框、灰提示都收掉）。
 *  每次 cvtSync 开头都过一遍，免得上一对单位的报错留在那儿。 */
function cvtAuxClearNotes() {
  [cvtAuxOmegaEl, cvtAuxAreaEl].forEach(el => {
    clearError(el);
    cvtSoftHint(el, '');
  });
}

/** 副输入框的清空（进类别 / 复位时用）。
 *
 *  特意**不**预填。4π 是最常见的那种情形（各向同性光源），但"1 流明等于
 *  多少尼特"没有哪组几何量能算标准答案 —— 先填一个数进去，用户很容易
 *  直接读走那个结果，却没意识到那是我们替他假设的。宁可留空，让他自己
 *  点一下（药丸就是为这一步准备的：4π / 2π / π 各一个，一下就好）。 */
function cvtAuxClearInputs() {
  cvtAuxOmegaEl.value = '';
  cvtAuxAreaEl.value = '';
  cvtAuxClearNotes();
  cvtPaintAuxChips();
}

/** 给输入框挂一句**中性**提示（灰的，不是报错的红）。
 *
 *  core.js 的 .hint 默认是告警色，这里加个 .soft 改回次要文字色 ——
 *  「还没填」是正常状态，不该长成一条错误。 */
function cvtSoftHint(el, msg) {
  const wrap = el.closest('[data-field]');
  const hint = wrap && wrap.nextElementSibling;
  if (!hint || !hint.classList.contains('hint')) return;
  hint.textContent = msg || '';
  hint.classList.toggle('show', !!msg);
  hint.classList.toggle('soft', !!msg);
}

/** 把 cvtReadAux 的结果挂到对应的输入框上。
 *
 *  标红前先摘掉 .soft —— 那句灰提示和红提示共用同一个 .hint（core.js 的
 *  setError 只管 textContent 和 .show，不碰别的类），不摘的话红字会被
 *  上一次的 .soft 压成灰色，看起来像没在报错。 */
function cvtAuxNote(r) {
  if (!r || !r.msg) return;
  const wrap = r.el.closest('[data-field]');
  const hint = wrap && wrap.nextElementSibling;
  if (hint && hint.classList.contains('hint')) hint.classList.remove('soft');

  if (r.hard) setError(r.el, r.msg);
  else cvtSoftHint(r.el, r.msg);
}

/** 读副输入框。返回 { values } 或 { el, msg, hard }。
 *
 *  hard=true  → 填了但不对（标红）
 *  hard=false → 还没填（灰提示）
 *  只读「这一次用得上」的那几个（need 说了算），用不上的连看都不看 ——
 *  所以切换单位时留在框里的旧值不会跑进来作怪。 */
function cvtReadAux(need) {
  const values = {};
  const list = [
    ['omega', need.omega, cvtAuxOmegaEl, true],
    ['area',  need.area,  cvtAuxAreaEl,  false],
  ];

  for (const [key, want, el, allowPi] of list) {
    if (!want) continue;

    if (!el.value) {
      return { el, msg: '填好这一项才能算出结果', hard: false };
    }
    const p = cvtAuxParse(el.value, allowPi);
    if (p.msg) return { el, msg: p.msg, hard: true };
    if (!Number.isFinite(p.value)) return { el, msg: '这个数字太大了', hard: true };
    // 立体角 / 面积都得是正数：0 会让结果爆掉（除以 0），负数则没有物理意义
    if (!(p.value > 0)) {
      return { el, msg: key === 'omega' ? '立体角得大于 0' : '面积得大于 0', hard: true };
    }
    values[key] = p.value;
  }
  return { values };
}

/** 主框空着 / 写错了的时候，也把副输入框的提示摆好。
 *  用户很可能是先填立体角、再回头填数值的，提示不该等他填完数值才出现。 */
function cvtDemandAux(need) {
  cvtAuxNote(cvtReadAux(need));
}

/** 药丸的选中态：框里的字正好等于某个常用值（4π / 2π / π）就点亮它。
 *  用户自己敲了个 12.566 进来的话，三个药丸就都不亮 —— 那也正常。 */
function cvtPaintAuxChips() {
  const cur = cvtAuxOmegaEl.value;
  $$('[data-cvt-omega]', cvtAuxOmegaChips).forEach(chip => {
    chip.setAttribute('aria-checked', String(chip.dataset.cvtOmega === cur));
  });
}

/** 把两栏的单位写到按钮上：`米 (m)`，后面跟一个下拉箭头。
 *  没有符号的单位（亩 / 斤 / 天…）就只写名字，不留一对空括号。 */
function cvtPaintUnits() {
  [['from', cvtFromBtn, '原单位'], ['to', cvtToBtn, '目标单位']].forEach(([which, btn, label]) => {
    const u = cvtUnit(cvtSel[which]);
    btn.textContent = u ? (u.sym ? u.label + ' (' + u.sym + ')' : u.label) : '—';

    const arrow = document.createElement('span');
    arrow.className = 'picker-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    btn.appendChild(arrow);

    btn.setAttribute('aria-label', label + '：' + (u ? u.label : '未选择') + '，点击更换');
  });
}

/* ==========================================================
   五、单位弹窗（药丸）
   ========================================================== */

/** 分组的小标题 + 强制换行。
 *
 *  单位多了以后（体积＆容积这种），所有药丸挤在一起就分不清哪几个是
 *  一伙的 —— 这里在换组的地方插一条占满整行的说明，下一组自然从新行
 *  开始（.chips-full 是 app.css 里已有的"独占一行"盒子，星座那个
 *  弹窗也在用）。 */
function cvtGroupBreak(name) {
  const row = document.createElement('div');
  row.className = 'chips-full chips-group';
  row.textContent = name;
  return row;
}

function cvtRenderChips() {
  const cur = cvtSel[cvtPicking];

  unitPickerChips.textContent = '';
  let lastGroup = null;

  cvtUnits().forEach(u => {
    // 换组了：先插一条换行 + 组名。第一组也要标，不然看不出分组是从哪开始的
    if (u.group && u.group !== lastGroup) {
      unitPickerChips.appendChild(cvtGroupBreak(u.group));
      lastGroup = u.group;
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(u.id === cur));
    chip.dataset.unit = u.id;
    chip.appendChild(document.createTextNode(u.label));

    // 没有符号的单位这里就不挂 .sym，只留中文名
    if (u.sym) {
      const sym = document.createElement('span');
      sym.className = 'sym';
      sym.textContent = u.sym;
      chip.appendChild(sym);
    }

    unitPickerChips.appendChild(chip);
  });
}

function cvtOpenPicker(which) {
  cvtPicking = which;
  unitPickerTitle.textContent = which === 'from' ? '选择原单位' : '选择目标单位';
  cvtRenderChips();
  unitPicker.classList.add('show');
}

function cvtClosePicker() {
  unitPicker.classList.remove('show');
  cvtPicking = null;
}

/* ==========================================================
   六、视图切换
   ========================================================== */

/* 类别列表的滚动位置。进出子页面时记一下、还回去，见下面两个函数的注释。 */
let cvtCatsScroll = 0;

/** 回到「选类别」那一层 */
function cvtShowCats() {
  cvtClosePicker();
  cvtPadHide();                 // 键盘是给数值框用的，回列表就没它的事了
  unitConvEl.hidden = true;
  unitCatsEl.hidden = false;
  unitTitleEl.textContent = '单位换算';

  // 把类别列表滚回进子页面之前的位置。
  // 必须**先**把列表显示出来再设 scrollTop：列表还藏着的时候内容高度是 0，
  // 设进去的值会被浏览器直接夹成 0，等于没还原。
  unitBodyEl.scrollTop = cvtCatsScroll;
}

/** 类别自己的注释（UNITS[cat].note，可选）。
 *  没有这条的类别就把整块收起来 —— 不留一块空的灰底。 */
function cvtPaintCatNote(cat) {
  if (!cvtCatNoteEl) return;
  const text = (cat && cat.note) || '';
  cvtCatNoteEl.textContent = text;
  cvtCatNoteEl.hidden = !text;
}

/** 进某个类别的换算界面 */
function cvtOpenCat(id) {
  const cat = UNITS[id];
  if (!cat) return;

  // 记下当前滚到哪儿了：退回来时还要回到这儿（类别有十来个，列表挺长，
  // 每次退出来都被弹回顶部很难受）
  cvtCatsScroll = unitBodyEl.scrollTop;

  cvtCat = id;
  cvtSel = { from: cat.from, to: cat.to };

  // 给个 1：一进来就能看到一条换算结果，不用先自己敲一个数
  cvtFrom.value = '1';
  clearError(cvtFrom);
  cvtAuxClearInputs();                         // 副输入框一律从空白进（不预填，见下）
  cvtPaintUnits();
  cvtPaintCatNote(cat);
  cvtSync();

  unitCatsEl.hidden = true;
  unitConvEl.hidden = false;
  unitTitleEl.textContent = cat.name;          // 顶栏跟着变成类别名
  unitBodyEl.scrollTop = 0;                    // 子页面自己从顶部开始

  /* 这里**不**自动聚焦。以前电脑上会顺手 focus + select（把示例那个 1
     整段选上，敲第一个键就替换掉），但副作用是：一进类别软键盘（.gfx-pad）
     就自己弹出来 —— 用户还没想打字，屏幕先被键盘占掉一截。现在进类别就是
     干干净净一张卡，等用户点了数值框，键盘再出来（focus → cvtPadShow）。
     手机上本来也不聚焦（会弹起系统键盘，挡掉半屏），这一改两边一致。 */
}

/** 复位到初始状态：默认类别、默认单位、数值 1，并停在「选类别」的顶部 */
function cvtReset() {
  cvtCat = UNIT_HOME;
  const cat = UNITS[cvtCat];
  cvtSel = { from: cat.from, to: cat.to };

  cvtFrom.value = '1';
  clearError(cvtFrom);
  cvtAuxClearInputs();
  cvtPaintUnits();
  cvtPaintCatNote(cat);
  cvtSync();

  cvtCatsScroll = 0;      // 重新进来 = 从头看，不沿用上一次的滚动位置
  cvtShowCats();
}

/* ==========================================================
   七、复制（数值 / 结果各一颗）
   ----------------------------------------------------------
   位置：字段头上（.cvt-head 里、label 的右边），也就是下面那颗单位
   按钮的**正上方** —— 一眼看得出它管的是哪一栏，不会跟单位按钮混。
   按钮外观见 css/tools.css 的 .cvt-copy。

   复制的是框里的**原文**：不拼单位、不加等号。用户想拿去用的时候，
   「100 厘米」自己拼一下就有了；反过来，原文要是被拼过就还原不回去。

   两栏共用同一个函数，靠传进来的输入框和名字区分是哪一栏。
   做法、提示语、兜底整套都跟「罗马数字」那页一致（见 js/roman.js
   的四、复制）—— 同一颗按钮，换个页面不该变成另一套手感。
   ========================================================== */

/** 复制提示共用的 key（见 core.js 的 toast 第 4 个参数）：
 *  传了 key 就**同一时刻只留一条**，新的来之前先把旧的那条收掉。
 *
 *  这里必须收：「复制」是最容易被连点的动作 —— 数值点一下、结果点一下，
 *  或者空框点一次报错、填上数再点一次成功。不收的话屏幕上就是两条几乎
 *  一样的气泡叠在一起。三处提示（空内容 / 已复制 / 复制失败）共用同一个
 *  key，所以「先报错、后成功」也只会看到最后那条。
 *  想要回旧的各弹各的，把这个参数去掉即可。 */
const CVT_TOAST_COPY = 'cvt-copy';

/** execCommand 那条老路。剪贴板 API 只在**安全上下文**里给用
 *  （https / localhost 算，局域网 IP 走 http 就不算），
 *  离线版常常是直接双击文件（file://）打开，所以兜底这条路必须留着。 */
function cvtCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // 放在视口里、但挪到看不见的地方：display:none 的节点选不中
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

/** 复制某一栏的内容。两栏共用，靠传进来的输入框和名字区分。 */
async function cvtCopy(input, label) {
  const text = input.value;
  if (!text) {
    // 上框空着 = 还没填数；下框空着 = 上面还没填对，两句话说清楚
    toast('err', '还没有内容可以复制', label === '结果' ? '先在上面填一个数' : '', CVT_TOAST_COPY);
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      cvtCopyFallback(text);
    }
    // 长串截一下再当说明，别把整个提示撑开
    toast('ok', '已复制' + label, text.length > 24 ? text.slice(0, 24) + '…' : text, CVT_TOAST_COPY);
  } catch (_) {
    // 兜底也失败（权限被拒 / 老浏览器）：把话说清楚，让用户自己选中
    toast('err', '复制失败', '请手动选中后复制', CVT_TOAST_COPY);
  }
}

/* ==========================================================
   八、交换上下单位（数字跟着一起换位置）
   ========================================================== */
function cvtSwap() {
  const oldFrom = cvtSel.from;
  cvtSel.from = cvtSel.to;
  cvtSel.to = oldFrom;
  cvtPaintUnits();

  // 数字一起换位：原来在下框的结果挪到上框，再按新单位往下算一遍。
  // 这样「1 米 = 100 厘米」一交换就成了「100 厘米 = 1 米」——同一个长度，
  // 只是换个方向读。上框空着或写错了（下框也是空的）就只换单位。
  const moved = cvtTo.value;
  if (moved) cvtFrom.value = moved;

  cvtSync();

  if (typeof Device !== 'undefined' && Device.isPC()) cvtFrom.focus();
}

/* ==========================================================
   九、软键盘
   ----------------------------------------------------------
   键位是从「罗马数字」那个**数字盘**搬来的（见 js/roman.js）：外观、
   交互、甚至"拦掉 mousedown 保住输入框焦点"那一手都照抄，只改键面：

     数字盘（罗马那页）        这一页
       7 8 9                    e+   e-   /   π
       4 5 6                    7    8    9
       1 2 3                    4    5    6
       切换 0 退格              1    2    3
                                .    0    退格

   · 去掉「切换」—— 这一页只有一套键位，没什么可切的
   · 补上小数点、除号、科学计数法的 e+ / e-、圆周率 π
   · **顶上那行 4 个键**（e+ e- / π），底下四行是标准的 3 列数字盘。
     这么排是为了不把键盘撑高：总共还是 5 行，和原来一样。
     靠 css 的 .gfx-pad-keys.is-numpad 撑开（12 列网格，顶行每键占 3 格、
     下面每键占 4 格），见 css/tools.css。

   ★ 一个键盘伺候**三个输入框**（数值 / 立体角 / 面积）：谁拿到焦点就
     往谁里面插字（cvtPadTarget）。这一档是这么来的 —— 亮度那类要同时填
     数值和几何量，而手机上让系统键盘弹三回是没法用的。

   ★ 「π」是唯一一个**会灰掉**的键：只有立体角那个框认得 π
     （面积和数值都跟圆周率没关系）。光标在别的框上时它置灰 ——
     按下去没反应比看得见的"用不上"更让人犯嘀咕。

   ★ 键位写成下面的数组，加减键都在这一处改。fn:1 是蓝调（功能键），
     op:1 是"排在顶上那行"。 */
const CVT_PAD_KEYS = [
  { l: 'e+', fn: 1, op: 1, ins: 'e+', title: '正的指数，例如 1e+3' },
  { l: 'e-', fn: 1, op: 1, ins: 'e-', title: '负的指数，例如 1e-4' },
  { l: '/',  fn: 1, op: 1,           title: '除号（写分数），例如 3/4' },
  { l: 'π',  fn: 1, op: 1, title: '圆周率，只在「立体角」里用得上', needsPi: true },

  '7', '8', '9',
  '4', '5', '6',
  '1', '2', '3',

  { l: '.', fn: 1, title: '小数点', ins: '.' },
  '0',
  { act: 'back' },
];

let cvtPadTarget = null;     // 现在这个键盘在给哪个输入框打字
let cvtPadCaret  = 0;        // 那个框里的光标位置

/** 某个输入框用哪套字符表 —— 和它 input 事件里 cvtFilter 传的那套必须一致，
 *  否则键盘插进去的字会被自己的过滤器吃掉（π 就是这么个例子）。 */
function cvtPadCharFor(el) {
  return el === cvtAuxOmegaEl ? cvtAuxChar : cvtChar;
}

/** 造一个键。拦 mousedown 是照抄 roman.js 的做法：不拦的话点一下
 *  输入框就失焦，键盘会跟着收起来，字也就插不进去了。 */
function cvtPadKey(label, opts) {
  const o = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gfx-key' + (o.fn ? ' is-fn' : '');
  b.textContent = label;
  b.title = o.title || label;
  b.setAttribute('aria-label', o.title || label);

  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', o.action);
  return b;
}

function cvtPadRender() {
  if (!cvtPadKeys || !cvtPadTarget) return;

  const map = cvtPadCharFor(cvtPadTarget);
  cvtPadKeys.textContent = '';

  CVT_PAD_KEYS.forEach(k => {
    if (typeof k === 'string') {
      cvtPadKeys.appendChild(cvtPadKey(k, { action: () => cvtPadInsert(k) }));
      return;
    }
    if (k.act === 'back') {
      cvtPadKeys.appendChild(cvtPadKey('退格', { fn: 1, title: '退格', action: cvtPadBackspace }));
      return;
    }

    const btn = cvtPadKey(k.l, {
      fn: k.fn, title: k.title,
      action: () => cvtPadInsert(k.ins || k.l),
    });
    // 顶上那行（e+ e- / π）：换一套列宽，见 .is-numpad
    if (k.op) btn.classList.add('is-op');

    // 这个框不认这个字符（只有 π 会撞上）：置灰 + 说明
    if (k.needsPi && map('π') !== 'π') {
      btn.disabled = true;
      btn.title = 'π 只在「立体角」里用得上';
      btn.setAttribute('aria-label', btn.title);
    }
    cvtPadKeys.appendChild(btn);
  });
}

/** 当前框里选中的区间 [start, end)。没选中就是光标处的一个空区间。
 *
 *  得认区间不能只认光标：用户（鼠标拖或键盘 Shift）选了半截数时，
 *  敲键盘上任何一个键都该**替换**掉选中的那一截 —— 只按 selectionStart
 *  插字的话，会在选区前面挤出一段重复的数字，用户还得回头退格。 */
function cvtPadRange(el) {
  const len = el.value.length;
  let s = cvtPadCaret, e = cvtPadCaret;
  if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
    s = Math.min(el.selectionStart, el.selectionEnd);
    e = Math.max(el.selectionStart, el.selectionEnd);
  }
  s = Math.max(0, Math.min(s, len));
  e = Math.max(s, Math.min(e, len));
  return [s, e];
}

/** 往当前框里插一段字。插完把焦点和光标补回原处，再**派发一个 input 事件**
 *  —— 过滤 / 校验 / 重算全交给上面已有的那条链路，这里不另写一套。 */
function cvtPadInsert(text) {
  const el = cvtPadTarget;
  if (!el) return;

  const [s, e] = cvtPadRange(el);
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  cvtPadCaret = s + text.length;

  cvtPadFocus(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function cvtPadBackspace() {
  const el = cvtPadTarget;
  if (!el) return;

  let [s, e] = cvtPadRange(el);
  if (s === e) {                   // 没选中就退一格
    if (s <= 0) return;
    s -= 1;
  }

  el.value = el.value.slice(0, s) + el.value.slice(e);
  cvtPadCaret = s;

  cvtPadFocus(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 清空当前框（结果跟着空 —— 它本来就是输入算出来的） */
function cvtPadClear() {
  const el = cvtPadTarget;
  if (!el) return;

  el.value = '';
  cvtPadCaret = 0;
  cvtPadFocus(el);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 把焦点和光标安回输入框里。preventScroll 很重要 —— 不然每按一个键
 *  浏览器都要把输入框滚进视口，而键盘自己就顶着屏幕底边。 */
function cvtPadFocus(el) {
  try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) {} }
  try { el.setSelectionRange(cvtPadCaret, cvtPadCaret); } catch (_) {}
}

function cvtPadShow(el) {
  if (!cvtPad || !el) return;
  cvtPadTarget = el;
  cvtPadCaret = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
  cvtPadRender();
  cvtPad.hidden = false;
  gfxPadEnsureVisible(el, cvtPad);
}

function cvtPadHide() {
  if (cvtPad) cvtPad.hidden = true;
  // 清掉 gfxPadEnsureVisible 给滚动容器补的底边距（和 gfxClearPadScroller 一个意思）
  gfxClearPadScroller();
}

/** 把三个输入框都接到这个键盘上 */
function cvtPadBind() {
  const inputs = [cvtFrom, cvtAuxOmegaEl, cvtAuxAreaEl];

  // 触摸设备：不叫出系统键盘。本站的输入都自带键盘，系统键盘只会挡掉半屏 ——
  // 而且这块键盘是"一个顶三个"的，让系统键盘插进来反而更乱。
  if (typeof Device !== 'undefined' && !Device.isPC()) {
    inputs.forEach(el => el.setAttribute('inputmode', 'none'));
  }

  inputs.forEach(el => {
    el.addEventListener('focus', () => cvtPadShow(el));

    // 兜底：个别浏览器 / 输入法下点一下未必派发 focus，点完再确认一次
    el.addEventListener('click', () => {
      if (cvtPad && cvtPad.hidden) cvtPadShow(el);
      if (typeof el.selectionStart === 'number') cvtPadCaret = el.selectionStart;
    });

    // 失焦时**不要立刻收**：点键盘上的按钮也会让输入框先 blur 一下。
    // 等一个 tick，看焦点是不是落在键盘上、或者挪到了另一个输入框 ——
    // 是就留着（换框时键盘不该闪一下）。
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (cvtPad && cvtPad.contains(document.activeElement)) return;
        if (inputs.indexOf(document.activeElement) >= 0) return;
        cvtPadHide();
      }, 0);
    });

    ['keyup', 'input', 'select'].forEach(ev => {
      el.addEventListener(ev, () => {
        if (typeof el.selectionStart === 'number') cvtPadCaret = el.selectionStart;
      });
    });
  });
}

/* ---- 键盘头部的两颗按钮 ---- */
if (cvtPad) {
  $('#cvtPadClear').addEventListener('click', cvtPadClear);

  // 「完成」只收键盘，值留着 —— 想接着改了，点一下输入框又出来
  $('#cvtPadDone').addEventListener('click', () => {
    cvtPadHide();
    if (cvtPadTarget) cvtPadTarget.blur();
  });
}

/* ==========================================================
   十、事件绑定
   ========================================================== */

/* ---- 选类别 ---- */
unitCatsEl.addEventListener('click', e => {
  const card = e.target.closest('[data-unit-cat]');
  if (!card) return;
  cvtOpenCat(card.dataset.unitCat);
});

/* ---- 数值输入：先过滤字符，再判读整串 ---- */
cvtFrom.addEventListener('input', () => {
  cvtFilter(cvtFrom);
  cvtSync();
});

/* ---- 副输入：立体角 / 面积 ----
   过滤换一套放行表（多一个 π），其余和主框一个套路：先过字符，再重算。
   注意 .chip 上的 aria-checked 也要跟着刷 —— 用户手敲一个 1 进 Ω 栏时，
   那三个药丸该亮不亮得跟着变。 */
cvtAuxOmegaEl.addEventListener('input', () => {
  cvtFilter(cvtAuxOmegaEl, cvtAuxChar);
  cvtPaintAuxChips();
  cvtSync();
});
cvtAuxAreaEl.addEventListener('input', () => {
  cvtFilter(cvtAuxAreaEl);
  cvtSync();
});

/* ---- 常用立体角药丸：4π / 2π / π 一键填进去 ----
   软键盘上虽然也有个 π 键了，但这三个值是最常敲的，点一下就是一整串
   （省掉「4」再点「π」两下），所以药丸留着。
   填完那个框里就是普通文本，用户还能接着往后补（4π → 4π/3 之类）。 */
cvtAuxOmegaChips.addEventListener('click', e => {
  const chip = e.target.closest('[data-cvt-omega]');
  if (!chip) return;

  cvtAuxOmegaEl.value = chip.dataset.cvtOmega;
  clearError(cvtAuxOmegaEl);
  cvtPaintAuxChips();
  cvtSync();

  // 点药丸就是"点一下就完事"：手机、电脑都**不要**弹软键盘（focus 会触发键盘）。
  // 真要接着敲（比如 4π → 4π/3），去点输入框，键盘自然就出来。
  cvtPadHide();
});

/* ---- 交换 ---- */
cvtSwapBtn.addEventListener('click', cvtSwap);

/* ---- 复制：数值 / 结果各一颗（见七、那一节） ---- */
[[cvtCopyFromBtn, cvtFrom, '数值', '复制数值'],
 [cvtCopyToBtn,   cvtTo,   '结果', '复制结果']].forEach(([btn, input, label, aria]) => {
  btn.setAttribute('aria-label', aria);
  // 拦 mousedown：不抢输入框的焦点，否则手机上的软键盘会跟着收起来
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => cvtCopy(input, label));
});

/* ---- 打开单位弹窗 ---- */
cvtFromBtn.addEventListener('click', () => cvtOpenPicker('from'));
cvtToBtn.addEventListener('click', () => cvtOpenPicker('to'));

/* ---- 选中一个单位 ----
   换单位**保留**框里的数字（1 米 → 1 千米），只是按新系数重算结果 ——
   单位换算器都是这个手感：数字是用户刚敲的，不该被悄悄改掉。 */
unitPickerChips.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip || !cvtPicking) return;

  const u = cvtUnit(chip.dataset.unit);
  if (u) cvtSel[cvtPicking] = u.id;

  cvtClosePicker();
  cvtPaintUnits();
  cvtSync();
});

/* ---- 关闭弹窗：✕ / 点遮罩 ---- */
unitPickerClose.addEventListener('click', cvtClosePicker);
unitPicker.addEventListener('click', e => {
  if (e.target === unitPicker) cvtClosePicker();
});

/* ---- 顶栏返回：换算界面里先退回类别列表 ----
   放在**捕获阶段**：tools.js 的返回处理挂在冒泡阶段，捕获先跑，
   stopPropagation 就能把它挡下来（和 cards.js 拦卡片点击同一个套路）。 */
document.addEventListener('click', e => {
  const back = e.target.closest('[data-tool-back]');
  if (!back || back.closest('.tool-page') !== UNIT_PAGE) return;
  if (unitConvEl.hidden) return;        // 已经在类别列表：交给 tools.js 关掉功能页
  e.preventDefault();
  e.stopPropagation();
  cvtShowCats();
}, true);

/* ---- Esc：一次只退一层（先收键盘，再关弹窗，再退类别列表） ----
   挂在 window 的捕获阶段（见文件头那段说明），才能抢在 tools.js 前面。 */
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;

  if (cvtPad && !cvtPad.hidden) {     // 软键盘开着：先收它（和「完成」一个效果）
    e.stopPropagation();
    cvtPadHide();
    if (cvtPadTarget) cvtPadTarget.blur();
    return;
  }
  if (unitPicker.classList.contains('show')) {
    e.stopPropagation();
    cvtClosePicker();
    return;
  }
  if (!UNIT_PAGE.classList.contains('show')) return;
  if (unitConvEl.hidden) return;
  e.stopPropagation();
  cvtShowCats();
}, true);

/* ---- 进这个功能页：每次从「选类别」开始，并把默认状态复位 ---- */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== UNIT_PAGE) return;
  cvtReset();
});

/* ==========================================================
   十一、初始化
   ========================================================== */
cvtPadBind();
cvtReset();
