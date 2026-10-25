/* ==========================================================================
   units.js —— 功能页：单位换算

   ★ 视图层级（都在 #toolUnits 这一个 .tool-page 里，用 hidden 切）：
     ① #unitCats  选领域。25 张卡写在 index.html 里，各有自己的 SVG 图标。
     ② #unitSubs  选量 —— **只有"一个领域好几个量"的那五张卡才有这一层**
                  （电学 / 磁学 / 放射性 / 粘度 / 浓度）。卡片由
                  cvtRenderKids 现画，名单是 UNITS[父键].kids。
                  角度、分辨率只有一个量，点卡片直接进第 ③ 层，不经过这里。
     ③ #unitConv  换算界面：上框输数值 → 下框同步显示结果；
                  单位按钮点开是药丸弹窗（复用 app.css 那套 picker 外观）。
                  顶栏标题对子量显示成「电学-电容」（见 cvtCatTitle）。
     #unitBridge 是 ③ 的一个岔路视图（体积 ⇄ 质量），不在这条链上：
                  上下两栏**是两个量**（不是同一个量的两种单位），中间靠
                  用户填的密度接起来 —— 质量 = 体积 × 密度。
                  入口只有一处：体积 / 质量那两张换算页底下的虚线跳转
                  （见下面「九之二、」）—— 给算到一半才想起来要换量的人，
                  顺手把当前数值和单位带过去。
                  ★ 它**不进类别列表**：跨量换算不是"又一类单位"，
                    摆一张卡在那儿反而让人以为点进去是单位表。

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
     密度那一档里还混着**非线性刻度**（API 度、波美度、特威德尔度、
     柏拉图度、白利度），同一对钩子，但单位上多挂一个 sg（见 UNITS.density）。

   ★ 还有一类连一对钩子都不够 ——「光学」那一档跨了四个量
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
const unitBodyEl  = $('#toolUnitsBody');      // 滚动容器（三层视图都在这一个里滚）
const unitCatsEl  = $('#unitCats');           // 第一层：选领域
const unitSubsEl  = $('#unitSubs');           // 第二层：一个领域里的量（动态渲染，只有多量领域才有）
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
const cvtBridgeBtn = $('#cvtBridge');        // 「体积 / 质量」两档下面的跨量跳转（可选）
const cvtBridgeNameEl = $('#cvtBridgeName');

const unitPicker      = $('#unitPicker');
const unitPickerTitle = $('#unitPickerTitle');
const unitPickerChips = $('#unitPickerChips');
const unitPickerClose = $('#unitPickerClose');

/* 副输入块（只有「光学」那一档用得上，见 UNITS.optics 和下面 cvtAux* 那节） */
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

/* 体积 ⇄ 质量那一层（第三层视图，见下面「九之二、」）。
   它不是类别 —— 上下两栏是两个量，中间靠密度接起来。 */
const unitBridgeEl   = $('#unitBridge');
const bdFromEl       = $('#bdFrom');
const bdToEl         = $('#bdTo');
const bdDensityEl    = $('#bdDensity');
const bdFromUnitBtn  = $('#bdFromUnit');
const bdToUnitBtn    = $('#bdToUnit');
const bdDensityBtn   = $('#bdDensityUnit');
const bdSwapBtn      = $('#bdSwap');
const bdFromLabelEl  = $('#bdFromLabel');
const bdToLabelEl    = $('#bdToLabel');
const bdRhoHeadEl    = $('#bdRhoHead');
const bdNoteEl       = $('#bdNote');
const bdRhoChipsEl   = $('#bdRhoChips');     // 密度快捷键那排药丸
const bdCopyFromBtn  = $('#bdCopyFrom');
const bdCopyToBtn    = $('#bdCopyTo');

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
     toBase / fromBase（可选）带**偏移**的类别用它，见下面温度那条；
            密度那一档的**比重刻度**也走这两个钩子（单位上挂 sg）

     ★ 多量领域（2026-10-25 起）用另外两个字段，和上面几个是二选一的两种形态：
       kids   这个领域下面有哪几个量（键名数组）。**有 kids 就不能有 units**，
              点卡片会先进第二层选量。
       parent 子量挂的父键。子量的 name 会和父名拼成「电学-电容」当顶栏标题。
       glyph  第二层卡片图标块里那个符号（V / Ω / Wb / mol/L…）。没有它就用空。

   （图标配色不在这里 —— 25 张卡都是同一个蓝底白画，见 css/tools.css
     的 .unit-cat；第二层那些量卡的符号色也是从那儿继承的。
     本文件只管数据和换算。）

   基准单位每类各挑一个顺手的：
     长度 米      面积 平方米   体积 升       质量 千克
     时间 秒      速度 米/秒    温度 摄氏度   数据 字节
     压力 帕斯卡  功率 瓦       频率 赫兹     能量 焦耳
     力 牛顿      力矩 牛·米    动量 千克·米/秒   加速度 米/秒²
     密度 千克/立方米           光学 流明
     电压 伏      电流 安       电阻 欧       电导 西
     电容 法      电感 亨       电荷 库仑     磁感应强度 特斯拉
     磁通量 韦伯  磁场强度 安/米              活度 贝可
     吸收剂量 戈瑞 剂量当量 西弗 照射量 库/千克
     质量浓度 千克/立方米       摩尔浓度 摩尔/立方米   质量分数 1（纯比例）
     动力粘度 帕·秒             运动粘度 平方米/秒
     角度 度      分辨率 dpi

   加一个类别要动两处（和首页加功能卡片一个套路，两边靠 id 对齐）：
     · index.html 的 #unitCats 里复制一张类别卡，改 data-unit-cat / 图标 / 名字
     · 这里补一条，键名和 data-unit-cat 一致
   ★ 但"一个领域多个量"（如电学）只给第一处加**一张**领域卡，各个量全在
     这里写：领域条目只放 kids，量条目自己挂 parent。第二层卡片是现画的，
     不用去 index.html 抄一遍。
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
        { id: 'ml',     label: '毫升',         sym: 'mL',     k: 0.001 },
        { id: 'l',      label: '升',           sym: 'L',      k: 1 },
        /* ★ 加仑 / 夸脱 / 品脱 / 杯 的美英两套差得不小（1 UK gal ≈ 1.2009 US gal），
           中文名已经写了美制 / 英制，符号也一律带 US / UK 前缀 ——
           只写一个 "gal" 抄到纸上就分不清是哪套，所以这里不留含糊的写法。 */
        { id: 'galus',  label: '美制加仑',     sym: 'US gal', k: 3.785411784 },   // 精确
        { id: 'galuk',  label: '英制加仑',     sym: 'UK gal', k: 4.54609 },       // 精确
        { id: 'qtus',   label: '美制夸脱',     sym: 'US qt',  k: 0.946352946 },   // = 1/4 US gal
        { id: 'qtuk',   label: '英制夸脱',     sym: 'UK qt',  k: 1.1365225 },     // = 1/4 UK gal
        { id: 'ptus',   label: '美制品脱',     sym: 'US pt',  k: 0.473176473 },   // = 1/8 US gal
        { id: 'ptuk',   label: '英制品脱',     sym: 'UK pt',  k: 0.56826125 },    // = 1/8 UK gal
        { id: 'cupus',  label: '美制杯',       sym: 'US cup', k: 0.2365882365 },  // = 8 US fl oz
        { id: 'cupuk',  label: '英制杯',       sym: 'UK cup', k: 0.284130625 },   // = 10 UK fl oz
        { id: 'flozus', label: '美制液量盎司', sym: 'fl oz',  k: 0.0295735295625 },
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
      // 宝石：1 克拉 = 0.2 克（公制克拉，1907 年起国际通用；不是"K 金"那个 Karat）
      { id: 'ct',  label: '克拉',   sym: 'ct', k: 0.0002 },
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

  /* ---------- 压力＆压强（基准：帕斯卡） ----------
     压力和压强是同一个量（力 ÷ 受力面积），中文里两套叫法都有人用，
     卡片名就把两个都写上。1 标准大气压 = 101325 Pa（精确定义）。
     毫米汞柱和托不是一回事，别混：托的定义是**精确的** 1 atm/760
     = 133.322368421… Pa；毫米汞柱按汞的密度和标准重力算出来是
     133.322387415 Pa，两者差在小数点后第 5 位。两个都留，各自按定义写。
     英寸汞柱 = 25.4 毫米汞柱（同族的英制写法）。

     另外几支：
       皮兹 pz —— MTS 制（米·吨·秒）的压强单位，1 pz = 1 sn/m² = 1000 Pa
       工程大气压 at —— 1 kgf/cm² = 98066.5 Pa（精确，别和 atm 混）
       磅每平方英尺 psf —— psi ÷ 144
       英寸水柱 inH₂O —— 25.4 毫米水柱，和上面那支同一个基准（4 ℃ 的水） */
  pressure: {
    name: '压力＆压强',
    note: '注：压力 = 压强（力 ÷ 面积），这里两套叫法通吃',
    from: 'atm', to: 'kpa',
    units: [
      { id: 'pa',    label: '帕斯卡',     sym: 'Pa',    k: 1 },
      { id: 'pz',    label: '皮兹',       sym: 'pz',    k: 1000 },
      { id: 'kpa',   label: '千帕',       sym: 'kPa',   k: 1000 },
      { id: 'mpa',   label: '兆帕',       sym: 'MPa',   k: 1e6 },
      { id: 'gpa',   label: '吉帕',       sym: 'GPa',   k: 1e9 },
      { id: 'bar',   label: '巴',         sym: 'bar',   k: 1e5 },
      { id: 'mbar',  label: '毫巴',       sym: 'mbar',  k: 100 },
      { id: 'at',    label: '工程大气压', sym: 'at',    k: 98066.5 },
      { id: 'atm',   label: '标准大气压', sym: 'atm',   k: 101325 },
      { id: 'torr',  label: '托',         sym: 'Torr',  k: 101325 / 760 },
      { id: 'mmhg',  label: '毫米汞柱',   sym: 'mmHg',  k: 133.322387415 },
      { id: 'inhg',  label: '英寸汞柱',   sym: 'inHg',  k: 3386.388640341 },
      // 水柱：4 ℃ 的水在标准重力下一毫米高 = 9.80665 Pa，英寸就是它的 25.4 倍
      { id: 'mmh2o', label: '毫米水柱',   sym: 'mmH₂O', k: 9.80665 },
      { id: 'inh2o', label: '英寸水柱',   sym: 'inH₂O', k: 25.4 * 9.80665 },
      { id: 'psi',   label: '磅每平方英寸', sym: 'psi', k: 6894.757293168361 },
      { id: 'psf',   label: '磅每平方英尺', sym: 'psf', k: 6894.757293168361 / 144 },
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

  /* ---------- 力学五档 ----------
     力 / 力矩 / 动量＆冲量 / 加速度 / 密度 —— 2026-10-19 从「力学」拆出来
     的五张卡。它们互相之间是**量纲不同、不能互算**的量（1 牛顿不等于
     多少牛·米），所以没有合在一张卡里靠副输入硬桥，而是各占一档，
     档内照旧纯系数 —— 机制上和长度、质量这些没有半点区别。

     三个常客的来历（都挂在 g0 = 9.80665 m/s² 上，1901 年起是精确值）：
       千克力 kgf = 1 kg × g0；磅力 lbf = 1 lb(0.45359237 kg，精确) × g0；
       标准重力 g = g0。磅达 pdl = 1 lb·ft/s²（不掺 g0）。

     密度的英制两支：1 lb = 0.45359237 kg（精确），
       1 ft = 0.3048 m（精确）→ 1 lb/ft³ = 16.018463373960… kg/m³
       1 in³ = 16.387064 cm³（精确）→ 1 lb/in³ = 27679.904710203… kg/m³ */
  force: {
    name: '力',
    from: 'n', to: 'kgf',
    units: [
      // 公制
      { id: 'mn',  label: '毫牛',   sym: 'mN',  k: 0.001 },
      { id: 'n',   label: '牛',     sym: 'N',   k: 1 },
      { id: 'kn',  label: '千牛',   sym: 'kN',  k: 1000 },
      { id: 'mnn', label: '兆牛',   sym: 'MN',  k: 1e6 },
      // 重力单位（都按 g0 = 9.80665 m/s² 折算）
      { id: 'dyn', label: '达因',   sym: 'dyn', k: 1e-5 },
      { id: 'gf',  label: '克力',   sym: 'gf',  k: 0.00980665 },
      { id: 'kgf', label: '千克力', sym: 'kgf', k: 9.80665 },
      { id: 'tf',  label: '吨力',   sym: 'tf',  k: 9806.65 },
      // 英制
      { id: 'lbf', label: '磅力',   sym: 'lbf', k: 4.4482216152605 },
      { id: 'kip', label: '千磅力', sym: 'kip', k: 1000 * 4.4482216152605 },
      { id: 'ozf', label: '盎司力', sym: 'ozf', k: 4.4482216152605 / 16 },
      { id: 'pdl', label: '磅达',   sym: 'pdl', k: 0.45359237 * 0.3048 },
    ],
  },

  torque: {
    name: '力矩',
    from: 'nm', to: 'kgfm',
    units: [
      // 公制（含 CGS：达因·厘米 = 1e-5 N × 1e-2 m）
      { id: 'mnmm',  label: '毫牛·米',     sym: 'mN·m',  k: 0.001 },
      { id: 'nm',    label: '牛·米',       sym: 'N·m',   k: 1 },
      { id: 'knm',   label: '千牛·米',     sym: 'kN·m',  k: 1000 },
      { id: 'mnmm2', label: '兆牛·米',     sym: 'MN·m',  k: 1e6 },
      { id: 'dyncm', label: '达因·厘米',   sym: 'dyn·cm', k: 1e-7 },
      // 重力单位
      { id: 'gfcm',  label: '克力·厘米',   sym: 'gf·cm',  k: 0.00980665 * 0.01 },
      { id: 'kgfcm', label: '千克力·厘米', sym: 'kgf·cm', k: 0.0980665 },
      { id: 'kgfm',  label: '千克力·米',   sym: 'kgf·m',  k: 9.80665 },
      // 英制
      { id: 'ozfin', label: '盎司力·英寸', sym: 'ozf·in', k: 4.4482216152605 / 16 * 0.0254 },
      { id: 'lbfin', label: '磅力·英寸',   sym: 'lbf·in', k: 4.4482216152605 * 0.0254 },
      { id: 'lbfft', label: '磅力·英尺',   sym: 'lbf·ft', k: 4.4482216152605 * 0.3048 },
      { id: 'pdlft', label: '磅达·英尺',   sym: 'pdl·ft', k: 0.45359237 * 0.3048 * 0.3048 },
    ],
  },

  /* 动量和冲量是同一个量纲（kg·m/s = N·s），放一档里按两个量分组展示；
     组之间照样能互算 —— 1 kg·m/s 本来就精确等于 1 N·s。
     英制的 slug（司勒格）= 14.593902937206… kg，是 lbf·s²/ft，写法上
     直接引用 lbf 的数：1 slug·ft/s = 1 lbf·s。 */
  momentum: {
    name: '动量＆冲量',
    from: 'kgms', to: 'ns',
    units: [
      ...cvtGroup('动量', [
        { id: 'gcm_s', label: '克·厘米/秒', sym: 'g·cm/s', k: 1e-5 },
        { id: 'kgcm_s', label: '千克·厘米/秒', sym: 'kg·cm/s', k: 0.01 },
        { id: 'gm_s',  label: '克·米/秒',   sym: 'g·m/s',  k: 0.001 },
        { id: 'kgms',  label: '千克·米/秒', sym: 'kg·m/s', k: 1 },
        { id: 'tms',   label: '吨·米/秒',   sym: 't·m/s',  k: 1000 },
        { id: 'lbfts', label: '磅·英尺/秒', sym: 'lb·ft/s', k: 0.45359237 * 0.3048 },
        { id: 'slugfts', label: '司勒格·英尺/秒', sym: 'slug·ft/s', k: 4.4482216152605 },
      ]),
      ...cvtGroup('冲量', [
        { id: 'dyns', label: '达因·秒', sym: 'dyn·s', k: 1e-5 },
        { id: 'pds',  label: '磅达·秒', sym: 'pdl·s', k: 0.45359237 * 0.3048 },
        { id: 'mns',  label: '毫牛·秒', sym: 'mN·s', k: 0.001 },
        { id: 'ns',   label: '牛·秒',   sym: 'N·s',  k: 1 },
        { id: 'kns',  label: '千牛·秒', sym: 'kN·s', k: 1000 },
        { id: 'kgfs', label: '千克力·秒', sym: 'kgf·s', k: 9.80665 },
        { id: 'lbfs', label: '磅力·秒', sym: 'lbf·s', k: 4.4482216152605 },
      ]),
    ],
  },

  acceleration: {
    name: '加速度',
    from: 'ms2', to: 'g0',
    note: '注：1 Gal（伽）= 1 cm/s²；g = 标准重力 9.80665 m/s²',
    units: [
      // 公制
      { id: 'mms2', label: '毫米/秒²',  sym: 'mm/s²', k: 0.001 },
      { id: 'cms2', label: '厘米/秒²',  sym: 'cm/s²', k: 0.01 },
      { id: 'ms2',  label: '米/秒²',    sym: 'm/s²',  k: 1 },
      { id: 'kmh_s', label: '千米/时·秒', sym: 'km/(h·s)', k: 1000 / 3600 },
      // 大地测量里的伽
      { id: 'gal',  label: '伽',        sym: 'Gal',   k: 0.01 },
      { id: 'mgal', label: '毫伽',      sym: 'mGal',  k: 1e-5 },
      // 标准重力
      { id: 'g0',   label: '标准重力',  sym: 'g',     k: 9.80665 },
      // 英制
      { id: 'ins2', label: '英寸/秒²',  sym: 'in/s²', k: 0.0254 },
      { id: 'yds2', label: '码/秒²',    sym: 'yd/s²', k: 0.9144 },
      { id: 'fts2', label: '英尺/秒²',  sym: 'ft/s²', k: 0.3048 },
    ],
  },

  /* ---------- 密度（基准：千克/立方米） ----------
     ★ 这一档里混着两种单位，是继温度之后**第二类**要走钩子的：
       · 普通单位（g/cm³、lb/ft³ …）照旧一个系数 k
       · **比重刻度**（API 度、波美度、特威德尔度、柏拉图度、白利度）不是"多少倍"，
         而是某套刻度上的读数，和密度是**非线性**关系 —— 一个 k 装不下，
         所以给这些单位挂 sg: { to, from, w } 三个东西：
           to(v)    读数 → 比重（相对水的密度）
           from(sg) 比重 → 读数（必须是 to 的严格反函数，来回换不能飘）
           w        这套刻度定义时用的水有多重（kg/m³）
         于是 密度 = to(读数) × w，反方向先除 w 再 from()。
       为什么 w 不统一：API／波美／特威德尔是英制体系，定义在 60°F 的水上
       （999.016 kg/m³）；柏拉图度是糖度（麦汁），定义在 20°C 上
       （998.203 kg/m³）。差的那 0.1% 就来自这里。

     六套刻度的式子（都写成能反解的形式）：
       API        SG = 141.5 / (°API + 131.5)      °API = 141.5/SG − 131.5
       波美（重）  SG = 145 / (145 − °Bé)           °Bé  = 145 − 145/SG
       波美（轻）  SG = 140 / (°Bé + 130)           °Bé  = 140/SG − 130
       特威德尔    SG = 1 + °Tw / 200               °Tw  = (SG − 1) × 200
       柏拉图      SG = 1 + P/(258.6 − 0.8795P)     P = 258.6x/(1 + 0.8795x)，x = SG−1
       白利度      SG = 1 + Bx/(258.6 − 0.87955Bx)  Bx = 258.6x/(1 + 0.87955x)，x = SG−1
       波美的重轻两套**都留着**：它们的量程不重叠（重波美只管比重 > 1 的
       盐水、糖浆、酸碱液；轻波美只管比重 < 1 的酒精、氨水），同一个读数
       落在哪一套由用户选的那个单位决定，不会互相打架。
       柏拉图用的是可逆的近似式（ASBC 那个三次多项式更准但没有闭式反解），
       在 0~30 °P 这段和 ASBC 差在 0.01 °P 量级。
       白利度取 ICUMSA GS4-13 那条式子（0.87955 = 227.1/258.2），20 °C 下
       0~30 °Bx 与糖度表差在 0.0001 SG 以内，到 80 °Bx 这种糖浆才偏 1% 上下。
       它和柏拉图度**本来就几乎同值**（两套刻度都长在 20 °C 的糖液密度表上，
       同一杯糖水读出来只差零点几度），所以 Bx ⇄ °P 基本 1:1 —— 不是笔误。

     英制几支的来历：1 lb = 0.45359237 kg、1 ft = 0.3048 m、1 in = 0.0254 m
     都是精确值；加仑按**美制**（3.785411784 L，精确）；slug = lbf·s²/ft。 */
  density: {
    name: '密度',
    from: 'kgm3', to: 'gcm3',
    note: '注：磅/加仑按美制（1 gal = 3.785411784 L）\n注：重波美 = 145 − 145/比重、轻波美 = 140/比重 − 130\n注：API／波美／特威德尔按 60°F 的水，柏拉图／白利度按 20°C 的糖液（两者几乎同值）',
    units: [
      // 公制（1 mg/L = 1 g/m³ = 0.001 kg/m³；1 mg/mL = 1 g/L = 1 kg/m³）
      ...cvtGroup('公制', [
        { id: 'mgl',   label: '毫克/升',     sym: 'mg/L',  k: 0.001 },
        { id: 'gl',    label: '克/升',       sym: 'g/L',   k: 1 },
        { id: 'mgml',  label: '毫克/毫升',   sym: 'mg/mL', k: 1 },
        { id: 'kgm3',  label: '千克/立方米', sym: 'kg/m³', k: 1 },
        { id: 'gcm3',  label: '克/立方厘米', sym: 'g/cm³', k: 1000 },
        { id: 'gml',   label: '克/毫升',     sym: 'g/mL',  k: 1000 },
        { id: 'kgL',   label: '千克/升',     sym: 'kg/L',  k: 1000 },
        { id: 'tm3',   label: '吨/立方米',   sym: 't/m³',  k: 1000 },
      ]),
      // 英制
      ...cvtGroup('英制', [
        { id: 'lbft3', label: '磅/立方英尺', sym: 'lb/ft³', k: 16.01846337396014 },
        { id: 'lbin3', label: '磅/立方英寸', sym: 'lb/in³', k: 27679.90471020312 },
        { id: 'ozin3', label: '盎司/立方英寸', sym: 'oz/in³', k: (0.45359237 / 16) / 1.6387064e-5 },
        { id: 'slugft3', label: '斯勒格/立方英尺', sym: 'slug/ft³', k: (4.4482216152605 / 0.3048) / 0.028316846592 },
        { id: 'lbgal', label: '磅/加仑',     sym: 'lb/US gal', k: 0.45359237 / 0.003785411784 },
      ]),
      // 比重刻度（非线性，走下面的 toBase / fromBase）
      ...cvtGroup('比重刻度', [
        {
          id: 'api', label: 'API度', sym: '°API',
          sg: {
            to: v => 141.5 / (v + 131.5),
            from: sg => 141.5 / sg - 131.5,
            w: 999.016,
          },
        },
        /* 波美度有**重轻两套**，同一个读数在两边对应不同密度，必须分开：
             重波美  145 − 145/比重   （比重 > 1：盐水、糖浆、酸碱液）
             轻波美  140/比重 − 130   （比重 < 1：酒精、氨水这类轻液）
           16 世纪那套浮计就是"同一支管子，轻液沉得深、重液浮得高"，
           于是分了两个刻度。两套的符号都是 °Bé，靠中文名（重/轻）区分。 */
        {
          id: 'be', label: '重波美度', sym: '°Bé',
          sg: {
            to: v => 145 / (145 - v),
            from: sg => 145 - 145 / sg,
            w: 999.016,
          },
        },
        {
          id: 'bel', label: '轻波美度', sym: '°Bé',
          sg: {
            to: v => 140 / (v + 130),
            from: sg => 140 / sg - 130,
            w: 999.016,
          },
        },
        {
          id: 'tw', label: '特威德尔度', sym: '°Tw',
          sg: {
            to: v => 1 + v / 200,
            from: sg => (sg - 1) * 200,
            w: 999.016,
          },
        },
        {
          id: 'plato', label: '柏拉图度', sym: '°P',
          sg: {
            to: v => 1 + v / (258.6 - 0.8795 * v),
            from: sg => { const x = sg - 1; return 258.6 * x / (1 + 0.8795 * x); },
            w: 998.203,
          },
        },
        /* 白利度（°Bx / Brix）：每 100 g 糖液里溶了多少克蔗糖（质量百分数），
           按 20 °C 的纯蔗糖溶液定义。式子照 ICUMSA GS4-13 写成能反解的形式：
           0.87955 就是那条式子里的 227.1/258.2，所以它和柏拉图度只差在小数点
           后第五位 —— 两套刻度本来就同源，Bx ⇄ °P 基本 1:1（见上面的长注释）。 */
        {
          id: 'brix', label: '白利度', sym: '°Bx',
          sg: {
            to: v => 1 + v / (258.6 - v * 227.1 / 258.2),
            from: sg => { const x = sg - 1; return 258.6 * x / (1 + 227.1 / 258.2 * x); },
            w: 998.203,
          },
        },
      ]),
    ],
    /** 该单位的值 → 千克/立方米（普通单位乘 k，刻度单位先翻成比重再乘水重） */
    toBase(v, id) {
      const u = this.units.find(x => x.id === id);
      if (!u) return v;
      return u.sg ? u.sg.to(v) * u.sg.w : v * u.k;
    },
    /** 千克/立方米 → 该单位的值 */
    fromBase(v, id) {
      const u = this.units.find(x => x.id === id);
      if (!u) return v;
      return u.sg ? u.sg.from(v / u.sg.w) : v / u.k;
    },
  },

  /* ---------- 光学（基准：流明） ----------
     ★ 这一档和上面所有类别都不一样，是**唯一需要副输入框**的：
     别的类别里各单位是"同一个量、不同大小"（1 米 = 100 厘米），
     这一档的四个单位是**四个不同的量**（光度学那四个）：

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
  optics: {
    name: '光学',
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

  /* ==================================================================
     2026-10-25 新增的七个领域（电学 / 磁学 / 放射性 / 粘度 / 浓度 / 角度 / 分辨率）

     ★ 「一个领域好几个量」的那五个（电学、磁学、放射性、粘度、浓度）
       在本表里是**空壳 + 一份名单**：只有 name 和 kids，没有 units。
       点这类卡片先进第二层「选量」，再进换算页（见 cvtShowKids）。
       ⚠ 别给它们补 units —— cvtOpenCat 会直接拦掉，写了也不生效。
       子量的条目反过来挂 parent: '<父键>'，顶栏标题因此能拼成「电学-电容」。

     ★ 角度和分辨率只有一个量，所以**不设** kids：卡片点进去就是换算页，
       和长度、面积那些一模一样。只有真的需要选量的领域才多一层。

     ★ 基准单位仍是「每类挑一个」的老规矩，见下面各条注释。
     ================================================================== */

  /* ---------- 电学 ----------
     七个量各占一张子卡。为什么不合成一张「电学」大卡：换算页两栏只能
     选同一个量，把伏特和安培摆在同一张单位表里，"1 伏 = ? 安" 这种
     没有物理意义的换算会变成可选项。 */
  electric: {
    name: '电学',
    kids: ['voltage', 'current', 'resistance', 'conductance',
           'capacitance', 'inductance', 'charge'],
  },

  /* 电压（基准：伏） */
  voltage: {
    name: '电压',
    parent: 'electric',
    glyph: 'V',
    from: 'v', to: 'mv',
    units: [
      { id: 'uv', label: '微伏', sym: 'µV', k: 1e-6 },
      { id: 'mv', label: '毫伏', sym: 'mV', k: 1e-3 },
      { id: 'v',  label: '伏',   sym: 'V',  k: 1 },
      { id: 'kv', label: '千伏', sym: 'kV', k: 1e3 },
      { id: 'Mv', label: '兆伏', sym: 'MV', k: 1e6 },
    ],
  },

  /* 电流（基准：安） */
  current: {
    name: '电流',
    parent: 'electric',
    glyph: 'A',
    from: 'a', to: 'ma',
    units: [
      { id: 'na', label: '纳安', sym: 'nA', k: 1e-9 },
      { id: 'ua', label: '微安', sym: 'µA', k: 1e-6 },
      { id: 'ma', label: '毫安', sym: 'mA', k: 1e-3 },
      { id: 'a',  label: '安',   sym: 'A',  k: 1 },
      { id: 'ka', label: '千安', sym: 'kA', k: 1e3 },
    ],
  },

  /* 电阻（基准：欧） */
  resistance: {
    name: '电阻',
    parent: 'electric',
    glyph: 'Ω',
    from: 'ohm', to: 'kohm',
    units: [
      { id: 'mohm', label: '毫欧', sym: 'mΩ', k: 1e-3 },
      { id: 'ohm',  label: '欧',   sym: 'Ω',  k: 1 },
      { id: 'kohm', label: '千欧', sym: 'kΩ', k: 1e3 },
      { id: 'Mohm', label: '兆欧', sym: 'MΩ', k: 1e6 },
      { id: 'Gohm', label: '吉欧', sym: 'GΩ', k: 1e9 },
    ],
  },

  /* 电导（基准：西）—— 单独一张，不并进电阻。
     电导与电阻互为倒数，但两个量的单位不能靠一个系数互换。 */
  conductance: {
    name: '电导',
    parent: 'electric',
    glyph: 'S',
    from: 's', to: 'ms',
    units: [
      { id: 'us', label: '微西', sym: 'µS', k: 1e-6 },
      { id: 'ms', label: '毫西', sym: 'mS', k: 1e-3 },
      { id: 's',  label: '西',   sym: 'S',  k: 1 },
      { id: 'ks', label: '千西', sym: 'kS', k: 1e3 },
    ],
    note: '电导 G = 1 / 电阻 R。它和电阻是两个量，不能在这里直接互换 —— 要换请先取倒数。',
  },

  /* 电容（基准：法） */
  capacitance: {
    name: '电容',
    parent: 'electric',
    glyph: 'F',
    from: 'uf', to: 'nf',
    units: [
      { id: 'pf', label: '皮法', sym: 'pF', k: 1e-12 },
      { id: 'nf', label: '纳法', sym: 'nF', k: 1e-9 },
      { id: 'uf', label: '微法', sym: 'µF', k: 1e-6 },
      { id: 'mf', label: '毫法', sym: 'mF', k: 1e-3 },
      { id: 'f',  label: '法',   sym: 'F',  k: 1 },
    ],
  },

  /* 电感（基准：亨） */
  inductance: {
    name: '电感',
    parent: 'electric',
    glyph: 'H',
    from: 'mh', to: 'uh',
    units: [
      { id: 'nh', label: '纳亨', sym: 'nH', k: 1e-9 },
      { id: 'uh', label: '微亨', sym: 'µH', k: 1e-6 },
      { id: 'mh', label: '毫亨', sym: 'mH', k: 1e-3 },
      { id: 'h',  label: '亨',   sym: 'H',  k: 1 },
    ],
  },

  /* 电荷（基准：库仑）—— 安时、毫安时是电池上的日常写法 */
  charge: {
    name: '电荷',
    parent: 'electric',
    glyph: 'C',
    from: 'c', to: 'mah',
    units: [
      { id: 'uc',  label: '微库',   sym: 'µC',  k: 1e-6 },
      { id: 'mc',  label: '毫库',   sym: 'mC',  k: 1e-3 },
      { id: 'c',   label: '库仑',   sym: 'C',   k: 1 },
      { id: 'mah', label: '毫安时', sym: 'mAh', k: 3.6 },     // 0.001 A × 3600 s
      { id: 'ah',  label: '安时',   sym: 'Ah',  k: 3600 },
    ],
    note: '安时 / 毫安时是电池上的电荷量写法：1 Ah = 3600 库仑，1 mAh = 3.6 库仑。',
  },

  /* ---------- 磁学 ---------- */
  magnetism: {
    name: '磁学',
    kids: ['flux_density', 'magnetic_flux', 'field_strength'],
  },

  /* 磁感应强度（基准：特斯拉）—— 特斯拉与高斯不是千进制 */
  flux_density: {
    name: '磁感应强度',
    parent: 'magnetism',
    glyph: 'T',
    from: 't', to: 'mt',
    units: [
      ...cvtGroup('国际单位', [
        { id: 'nt', label: '纳特',   sym: 'nT', k: 1e-9 },
        { id: 'ut', label: '微特',   sym: 'µT', k: 1e-6 },
        { id: 'mt', label: '毫特',   sym: 'mT', k: 1e-3 },
        { id: 't',  label: '特斯拉', sym: 'T',  k: 1 },
      ]),
      ...cvtGroup('高斯制', [
        { id: 'kg', label: '千高斯', sym: 'kG', k: 0.1 },
        { id: 'g',  label: '高斯',   sym: 'G',  k: 1e-4 },
        { id: 'mg', label: '毫高斯', sym: 'mG', k: 1e-7 },
      ]),
    ],
    note: '特斯拉（SI）与高斯（CGS）不是千进制：1 T = 10000 G，1 G = 0.1 mT。',
  },

  /* 磁通量（基准：韦伯） */
  magnetic_flux: {
    name: '磁通量',
    parent: 'magnetism',
    glyph: 'Wb',
    from: 'wb', to: 'mx',
    units: [
      { id: 'uwb', label: '微韦',     sym: 'µWb', k: 1e-6 },
      { id: 'mwb', label: '毫韦',     sym: 'mWb', k: 1e-3 },
      { id: 'wb',  label: '韦伯',     sym: 'Wb',  k: 1 },
      { id: 'mx',  label: '麦克斯韦', sym: 'Mx',  k: 1e-8 },
    ],
    note: '1 韦伯 = 10⁸ 麦克斯韦。',
  },

  /* 磁场强度（基准：安/米）—— 奥斯特除不尽，写算式 */
  field_strength: {
    name: '磁场强度',
    parent: 'magnetism',
    glyph: 'A/m',
    from: 'am', to: 'oe',
    units: [
      { id: 'am',  label: '安/米',   sym: 'A/m',  k: 1 },
      { id: 'kam', label: '千安/米', sym: 'kA/m', k: 1e3 },
      { id: 'oe',  label: '奥斯特',  sym: 'Oe',   k: 1000 / (4 * Math.PI) },
    ],
    note: '1 奥斯特 = 1000/4π ≈ 79.5775 安/米（除不尽，这里按算式算）。',
  },

  /* ---------- 放射性 ---------- */
  radiation: {
    name: '放射性',
    kids: ['activity', 'absorbed_dose', 'dose_equivalent', 'exposure'],
  },

  /* 活度（基准：贝可）—— 居里是定义值 3.7e10 */
  activity: {
    name: '活度',
    parent: 'radiation',
    glyph: 'Bq',
    from: 'bq', to: 'ci',
    units: [
      { id: 'bq',  label: '贝可',   sym: 'Bq',  k: 1 },
      { id: 'kbq', label: '千贝可', sym: 'kBq', k: 1e3 },
      { id: 'mbq', label: '兆贝可', sym: 'MBq', k: 1e6 },
      { id: 'gbq', label: '吉贝可', sym: 'GBq', k: 1e9 },
      { id: 'tbq', label: '太贝可', sym: 'TBq', k: 1e12 },
      { id: 'ci',  label: '居里',   sym: 'Ci',  k: 3.7e10 },
      { id: 'mci', label: '毫居里', sym: 'mCi', k: 3.7e7 },
      { id: 'uci', label: '微居里', sym: 'µCi', k: 3.7e4 },
      { id: 'nci', label: '纳居里', sym: 'nCi', k: 37 },
    ],
    note: '1 居里 = 3.7×10¹⁰ 贝可（1 克镭的活度，定义值）。',
  },

  /* 吸收剂量（基准：戈瑞） */
  absorbed_dose: {
    name: '吸收剂量',
    parent: 'radiation',
    glyph: 'Gy',
    from: 'gy', to: 'mgy',
    units: [
      { id: 'ugy',  label: '微戈瑞', sym: 'µGy',  k: 1e-6 },
      { id: 'mgy',  label: '毫戈瑞', sym: 'mGy',  k: 1e-3 },
      { id: 'gy',   label: '戈瑞',   sym: 'Gy',   k: 1 },
      { id: 'mrad', label: '毫拉德', sym: 'mrad', k: 1e-5 },
      { id: 'rad',  label: '拉德',   sym: 'rad',  k: 0.01 },
    ],
    note: '1 戈瑞 = 100 拉德。',
  },

  /* 剂量当量（基准：西弗）—— 数值与戈瑞不能互换，已乘辐射权重 */
  dose_equivalent: {
    name: '剂量当量',
    parent: 'radiation',
    glyph: 'Sv',
    from: 'sv', to: 'msv',
    units: [
      { id: 'usv',  label: '微西弗', sym: 'µSv',  k: 1e-6 },
      { id: 'msv',  label: '毫西弗', sym: 'mSv',  k: 1e-3 },
      { id: 'sv',   label: '西弗',   sym: 'Sv',   k: 1 },
      { id: 'mrem', label: '毫雷姆', sym: 'mrem', k: 1e-5 },
      { id: 'rem',  label: '雷姆',   sym: 'rem',  k: 0.01 },
    ],
    note: '1 西弗 = 100 雷姆。吸收剂量和剂量当量是两回事，数值不能直接互当。',
  },

  /* 照射量（基准：库/千克）—— 伦琴是定义值 */
  exposure: {
    name: '照射量',
    parent: 'radiation',
    glyph: 'C/kg',
    from: 'ckg', to: 'r',
    units: [
      { id: 'ckg',  label: '库/千克',   sym: 'C/kg',  k: 1 },
      { id: 'mckg', label: '毫库/千克', sym: 'mC/kg', k: 1e-3 },
      { id: 'r',    label: '伦琴',      sym: 'R',     k: 2.58e-4 },
      { id: 'mr',   label: '毫伦琴',    sym: 'mR',    k: 2.58e-7 },
    ],
    note: '1 伦琴 = 2.58×10⁻⁴ 库/千克（定义值）。',
  },

  /* ---------- 浓度 ----------
     三个量各占一张：质量浓度带量纲、摩尔浓度带摩尔、质量分数是无量纲
     比例。三者都出现 ppm / % 这两个写法，但含义完全不同 —— 分成三张
     卡正是为了让用户必须选一次"是哪个 ppm"。 */
  concentration: {
    name: '浓度',
    kids: ['mass_concentration', 'molar_concentration', 'mass_fraction'],
  },

  /* 质量浓度（基准：千克/立方米）—— 1 g/L 正好 = 1 kg/m³ */
  mass_concentration: {
    name: '质量浓度',
    parent: 'concentration',
    glyph: 'g/L',
    from: 'gl', to: 'mgl',
    units: [
      { id: 'kgm3', label: '千克/立方米', sym: 'kg/m³', k: 1 },
      { id: 'gl',   label: '克/升',       sym: 'g/L',   k: 1 },
      { id: 'gml',  label: '克/毫升',     sym: 'g/mL',  k: 1000 },
      { id: 'mgl',  label: '毫克/升',     sym: 'mg/L',  k: 1e-3 },
      { id: 'ugml', label: '微克/毫升',   sym: 'µg/mL', k: 1e-3 },
      { id: 'ngml', label: '纳克/毫升',   sym: 'ng/mL', k: 1e-6 },
      { id: 'ppm',  label: 'ppm（水溶液）', k: 1e-3 },
      { id: 'ppb',  label: 'ppb（水溶液）', k: 1e-6 },
      { id: 'pctwv', label: '百分浓度',   sym: '%(w/v)', k: 10 },
    ],
    note: 'ppm / ppb / 百分浓度按「稀水溶液、密度≈1 g/mL」折算：1 ppm ≈ 1 mg/L、1% (w/v) ≈ 10 g/L。'
        + '溶剂不是水时这三条不成立。',
  },

  /* 摩尔浓度（基准：摩尔/立方米）—— 1 mol/L = 1000 mol/m³ */
  molar_concentration: {
    name: '摩尔浓度',
    parent: 'concentration',
    glyph: 'mol/L',
    from: 'moll', to: 'mmoll',
    units: [
      { id: 'molm3', label: '摩尔/立方米', sym: 'mol/m³', k: 1 },
      { id: 'moll',  label: '摩尔/升',     sym: 'mol/L',  k: 1000 },
      { id: 'mmoll', label: '毫摩尔/升',   sym: 'mmol/L', k: 1 },
      { id: 'umoll', label: '微摩尔/升',   sym: 'µmol/L', k: 1e-3 },
      { id: 'nmoll', label: '纳摩尔/升',   sym: 'nmol/L', k: 1e-6 },
    ],
    note: 'mol/L 就是常写的 M，mmol/L 就是 mM（化验单上最常见的那档）。',
  },

  /* 质量分数（基准：1 = 纯物质）—— 纯比例，和上面那张带 g/L 的不是一回事 */
  mass_fraction: {
    name: '质量分数',
    parent: 'concentration',
    glyph: '%',
    from: 'pct', to: 'ppm',
    units: [
      { id: 'pct',    label: '百分比', sym: '%',   k: 0.01 },
      { id: 'permil', label: '千分比', sym: '‰',   k: 1e-3 },
      { id: 'ppm',    label: 'ppm',    sym: 'ppm', k: 1e-6 },
      { id: 'ppb',    label: 'ppb',    sym: 'ppb', k: 1e-9 },
      { id: 'ppt',    label: 'ppt',    sym: 'ppt', k: 1e-12 },
    ],
    note: '这是无量纲的比例（溶质质量 ÷ 溶液质量），1 ppm 恒等于百万分之一，与溶剂无关。',
  },

  /* ---------- 粘度 ---------- */
  viscosity: {
    name: '粘度',
    kids: ['dynamic_viscosity', 'kinematic_viscosity'],
  },

  /* 动力粘度（基准：帕·秒）—— 泊是 CGS：1 P = 0.1 Pa·s */
  dynamic_viscosity: {
    name: '动力粘度',
    parent: 'viscosity',
    glyph: 'Pa·s',
    from: 'pas', to: 'mpas',
    units: [
      { id: 'upas',  label: '微帕·秒', sym: 'µPa·s', k: 1e-6 },
      { id: 'mpas',  label: '毫帕·秒', sym: 'mPa·s', k: 1e-3 },
      { id: 'pas',   label: '帕·秒',   sym: 'Pa·s',  k: 1 },
      { id: 'p',     label: '泊',      sym: 'P',     k: 0.1 },
      { id: 'cp',    label: '厘泊',    sym: 'cP',    k: 1e-3 },
      { id: 'kgfsm2', label: '千克力·秒/平方米', sym: 'kgf·s/m²', k: 9.80665 },
      { id: 'lbsft2', label: '磅力·秒/平方英尺', sym: 'lbf·s/ft²', k: 47.88025898033584 },
    ],
    note: '1 泊 = 0.1 帕·秒；1 厘泊正好等于 1 毫帕·秒（20 ℃ 的水约 1 cP）。',
  },

  /* 运动粘度（基准：平方米/秒）—— 斯是 CGS：1 St = 1 cm²/s */
  kinematic_viscosity: {
    name: '运动粘度',
    parent: 'viscosity',
    glyph: 'm²/s',
    from: 'mm2s', to: 'cst',
    units: [
      { id: 'mm2s', label: '平方毫米/秒', sym: 'mm²/s', k: 1e-6 },
      { id: 'cm2s', label: '平方厘米/秒', sym: 'cm²/s', k: 1e-4 },
      { id: 'm2s',  label: '平方米/秒',   sym: 'm²/s',  k: 1 },
      { id: 'st',   label: '斯',          sym: 'St',    k: 1e-4 },
      { id: 'cst',  label: '厘斯',        sym: 'cSt',   k: 1e-6 },
      { id: 'ft2s', label: '平方英尺/秒', sym: 'ft²/s', k: 0.09290304 },
    ],
    note: '1 斯 = 1 平方厘米/秒，1 厘斯正好等于 1 平方毫米/秒。',
  },

  /* ---------- 角度（基准：度） ----------
     选「度」当基准而不是弧度：用户进来最常问的是「1 度等于多少弧度」。
     弧度那几个用 180/π 的算式写，写成 57.29578 会带进截断误差。 */
  angle: {
    name: '角度',
    from: 'deg', to: 'rad',
    units: [
      ...cvtGroup('度分秒', [
        { id: 'sec', label: '角秒', sym: '″', k: 1 / 3600 },
        { id: 'min', label: '角分', sym: '′', k: 1 / 60 },
        { id: 'deg', label: '度',   sym: '°', k: 1 },
      ]),
      ...cvtGroup('弧度', [
        { id: 'urad', label: '微弧度', sym: 'µrad', k: 180 / Math.PI / 1e6 },
        { id: 'mrad', label: '毫弧度', sym: 'mrad', k: 180 / Math.PI / 1000 },
        { id: 'rad',  label: '弧度',   sym: 'rad',  k: 180 / Math.PI },
      ]),
      ...cvtGroup('其它', [
        { id: 'gon',  label: '百分度',       sym: 'gon', k: 0.9 },
        { id: 'mil',  label: '密位（1/6400）', sym: 'mil', k: 360 / 6400 },
        { id: 'turn', label: '转',            sym: 'r',   k: 360 },
      ]),
    ],
    note: '密位按北约的 1/6400 周算（苏制是 1/6000，两者差 6.7%，这里没收）。1 转 = 360°。',
  },

  /* ---------- 分辨率（基准：dpi = ppi） ----------
     dpi 和 ppi 数值完全一样，合并成一个条目，免得用户以为要二选一。
     线对/毫米是另一个口径（1 线对 = 2 像素），按折算值收，注释里写清楚。 */
  resolution: {
    name: '分辨率',
    from: 'dpi', to: 'dpcm',
    units: [
      { id: 'dpi',  label: '每英寸点数', sym: 'dpi',  k: 1 },
      { id: 'dpcm', label: '每厘米点数', sym: 'dpcm', k: 2.54 },
      { id: 'dpmm', label: '每毫米点数', sym: 'dpmm', k: 25.4 },
      { id: 'lpmm', label: '线对/毫米',  sym: 'lp/mm', k: 50.8 },
    ],
    note: 'dpi 与 ppi 是同一个数（这里合并成一条）。线对/毫米按 1 线对 = 2 像素折算：'
        + '1 lp/mm = 50.8 dpi，属近似值。',
  },
};

const UNIT_HOME = 'length';          // 每次进来从哪一类开始

/* ---------- 运行状态 ---------- */
let cvtCat     = UNIT_HOME;              // 当前类别（含子量，如 voltage）
let cvtParent  = '';                     // 当前类别所属的领域键（如 electric）；顶层类别为空串
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
 *  只有「光学」那一档用得上，指数 a / b 的含义见 UNITS.optics 那段说明。
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
 *    · 跨量的类别（光学）：同一对钩子，但多传一个 aux
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
   只有「光学」那一档（UNITS.optics）用得上：那一档的单位跨了四个量，
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
 *  判据是**指数差**（指数 a / b 的含义见 UNITS.optics）：
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

/** 把单位写到按钮上：`米 (m)`，后面跟一个下拉箭头。
 *  没有符号的单位（亩 / 斤 / 天…）就只写名字，不留一对空括号。
 *  体积⇄质量那一层也用这个（三个按钮长一个样）。 */
function cvtPaintUnitBtn(btn, u, label) {
  btn.textContent = u ? (u.sym ? u.label + ' (' + u.sym + ')' : u.label) : '—';

  const arrow = document.createElement('span');
  arrow.className = 'picker-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  btn.appendChild(arrow);

  btn.setAttribute('aria-label', label + '：' + (u ? u.label : '未选择') + '，点击更换');
}

function cvtPaintUnits() {
  [['from', cvtFromBtn, '原单位'], ['to', cvtToBtn, '目标单位']].forEach(([which, btn, label]) => {
    cvtPaintUnitBtn(btn, cvtUnit(cvtSel[which]), label);
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
  const src = cvtPickSource();
  const cur = src.cur;

  unitPickerChips.textContent = '';
  let lastGroup = null;

  src.units.forEach(u => {
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

/** 弹窗这次该列哪张单位表、当前选中哪个 —— 换算界面和体积⇄质量共用
 *  同一个药丸弹窗，只有数据源不同，在这里分道。 */
function cvtPickSource() {
  if (cvtPicking === 'bdFrom') return { units: bdUnits('from'), cur: bdSel.from };
  if (cvtPicking === 'bdTo')   return { units: bdUnits('to'),   cur: bdSel.to };
  if (cvtPicking === 'bdRho')  return { units: bdUnits('rho'),  cur: bdSel.rho };
  return { units: cvtUnits(), cur: cvtSel[cvtPicking] };
}

/** 弹窗标题：跨量的那一页得说清是哪一栏（体积 / 质量 / 密度），
 *  换算界面里就是老的「原单位 / 目标单位」。 */
function cvtPickerTitle(which) {
  if (which === 'bdFrom') return '选择' + bdQtyName('from') + '单位';
  if (which === 'bdTo')   return '选择' + bdQtyName('to')   + '单位';
  if (which === 'bdRho')  return '选择密度单位';
  return which === 'from' ? '选择原单位' : '选择目标单位';
}

function cvtOpenPicker(which) {
  cvtPicking = which;
  unitPickerTitle.textContent = cvtPickerTitle(which);
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

/* 两层列表各自的滚动位置。进出时记一下、还回去 —— 类别页和「选量」页
   都可能很长，每次退回来被弹回顶部很难受。
   ★ 只在**那一层当前可见**时才记，否则会把换算页的 scrollTop 误记进去。 */
let cvtCatsScroll = 0;      // 第一层：选领域
let cvtKidsScroll = 0;      // 第二层：一个领域里选量

/** 顶栏标题。子量拼成「电学-电容」，顶层类别就是它自己的名字。
 *  连字符是用户指定的写法（不是「/」也不是「·」），别改。 */
function cvtCatTitle(id) {
  const cat = UNITS[id];
  if (!cat) return '单位换算';
  const p = cat.parent ? UNITS[cat.parent] : null;
  return p ? p.name + '-' + cat.name : cat.name;
}

/** 回到第一层「选领域」 */
function cvtShowCats() {
  cvtClosePicker();
  cvtPadHide();                 // 键盘是给数值框用的，回列表就没它的事了
  unitConvEl.hidden = true;
  unitBridgeEl.hidden = true;
  unitSubsEl.hidden = true;
  unitCatsEl.hidden = false;
  cvtParent = '';
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

/** 体积 / 质量这两档下面那颗「换到另一个量去」的跳转。
 *
 *  只在这两档出现（别的类别跟质量、体积没关系，摆出来是噪音）；
 *  文案跟着类别走：体积页上是「体积 → 质量」，质量页上反过来。
 *  点它时会把**当前敲的数和单位一起带过去**（见事件绑定那一段），
 *  用户在体积页算到一半想接着算重量，不用回去重敲一遍。
 *  没有这一档就整块 hidden —— 不留一条空白的框。 */
function cvtPaintBridgeLink(catId) {
  if (!cvtBridgeBtn) return;

  const dir = catId === 'volume' ? 'v2m' : catId === 'mass' ? 'm2v' : '';
  cvtBridgeBtn.hidden = !dir;
  if (!dir) { cvtBridgeBtn.dataset.dir = ''; return; }

  cvtBridgeBtn.dataset.dir = dir;
  cvtBridgeNameEl.textContent = dir === 'v2m' ? '体积 → 质量' : '质量 → 体积';
}

/** 渲染一个领域下的「量」卡片（第二层）。
 *
 *  卡片是**现画**的，不像第一层那样写在 index.html 里：量名和顺序都在
 *  UNITS 的 kids 名单里，抄一份到 HTML 等于同一件事写两处，加一个量要
 *  改两个文件。第一层之所以留在 HTML，是因为那 25 张卡各有自己的 SVG 图标。
 *
 *  图标块里放的是该量的主单位符号（V / Ω / Wb / mol/L…），不是图形 ——
 *  21 个量各画一张图标不值当，符号反而认得更快。4 个字符以上的降一档字号。
 *  ⚠ 这段是 innerHTML 拼的，glyph / name 全部来自本文件的常量，没有用户输入。 */
function cvtRenderKids(parentId) {
  const p = UNITS[parentId];
  if (!p || !p.kids) return;

  unitSubsEl.innerHTML = p.kids.map(id => {
    const k = UNITS[id];
    if (!k) return '';
    const g = k.glyph || '';
    // 字号按符号长度分档（20 / 16 / 12.5px，见 css 的 .unit-kid-sym）
    const cls = g.length >= 4 ? ' is-long' : g.length === 3 ? ' is-mid' : '';
    return '<button type="button" class="tool-btn unit-cat" data-unit-kid="' + id + '">'
         +   '<span class="tool-btn-ico unit-kid-sym' + cls + '" aria-hidden="true">' + g + '</span>'
         +   '<span class="tool-btn-text"><span class="tool-btn-name">' + k.name + '</span></span>'
         +   '<span class="tool-btn-go" aria-hidden="true">'
         +     '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"'
         +          ' stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>'
         +   '</span>'
         + '</button>';
  }).join('');
}

/** 进第二层：某个领域下的量列表。
 *
 *  restore，true = 从换算页退回来的（要还原上次滚到哪儿）；
 *  从类别页点进来是"新开一页"，一律从顶部开始。 */
function cvtShowKids(parentId, restore) {
  const p = UNITS[parentId];
  if (!p) return;
  if (!p.kids) { cvtOpenCat(parentId); return; }   // 没子量的类别不该走到这儿，兜一下

  // 只有从类别页点进来才记类别页的位置（从换算页退回时记的是换算页的，会污染）
  if (restore !== true) cvtCatsScroll = unitBodyEl.scrollTop;
  cvtParent = parentId;

  cvtRenderKids(parentId);
  cvtClosePicker();
  cvtPadHide();

  unitCatsEl.hidden = true;
  unitConvEl.hidden = true;
  unitBridgeEl.hidden = true;
  unitSubsEl.hidden = false;
  unitTitleEl.textContent = p.name;

  // ★ 先让它显示出来再设 scrollTop：藏着的时候内容高度是 0，会被夹成 0
  unitBodyEl.scrollTop = restore === true ? cvtKidsScroll : 0;
}

/** 退一层 —— 顶栏返回、Esc、系统返回键三处共用这一份判断，免得三处走岔。
 *  返回 true 表示"这一下被页面吃掉了"；false 表示已经在第一层，
 *  该交给 tools.js 去关整个功能页。 */
function cvtBackOne() {
  if (!unitBridgeEl.hidden) { bdBack(); return true; }        // 体积⇄质量 → 换算页
  if (!unitConvEl.hidden) {                                   // 换算页 → 上一层列表
    if (cvtParent) cvtShowKids(cvtParent, true); else cvtShowCats();
    return true;
  }
  if (!unitSubsEl.hidden) { cvtShowCats(); return true; }     // 选量 → 类别页
  return false;                                               // 已经在类别页
}

/** 进某个类别的换算界面 */
function cvtOpenCat(id) {
  const cat = UNITS[id];
  if (!cat) return;
  if (cat.kids) { cvtShowKids(id); return; }    // 父领域：先进选量层，别当普通类别打开

  // 记下当前滚到哪儿了：退回来时还要回到这儿（列表挺长，
  // 每次退出来都被弹回顶部很难受）。哪一层可见就记哪一层。
  if (!unitSubsEl.hidden) cvtKidsScroll = unitBodyEl.scrollTop;
  else cvtCatsScroll = unitBodyEl.scrollTop;

  cvtCat = id;
  cvtParent = cat.parent || '';
  cvtSel = { from: cat.from, to: cat.to };

  // 给个 1：一进来就能看到一条换算结果，不用先自己敲一个数
  cvtFrom.value = '1';
  clearError(cvtFrom);
  cvtAuxClearInputs();                         // 副输入框一律从空白进（不预填，见下）
  cvtPaintUnits();
  cvtPaintCatNote(cat);
  cvtPaintBridgeLink(id);
  cvtSync();

  unitCatsEl.hidden = true;
  unitSubsEl.hidden = true;
  unitBridgeEl.hidden = true;
  unitConvEl.hidden = false;
  unitTitleEl.textContent = cvtCatTitle(id);   // 子量显示成「电学-电容」
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
   · 补上小数点、负号、除号、科学计数法的 e+ / e-、圆周率 π
   · **顶上那行 5 个键**（e+ e- / - π），底下四行是标准的 3 列数字盘。
     这么排是为了不把键盘撑高：总共还是 5 行，和原来一样。
     靠 css 的 .gfx-pad-keys.is-numpad 撑开（15 列网格，顶行每键占 3 格、
     下面每键占 5 格），见 css/tools.css。

   ★ 一个键盘伺候**三个输入框**（数值 / 立体角 / 面积）：谁拿到焦点就
     往谁里面插字（cvtPadTarget）。这一档是这么来的 —— 光学那类要同时填
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
  { l: '-',  fn: 1, op: 1, ins: '-', title: '负号，只能写在数的最前面，例如 -5' },
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
    // 顶上那行（e+ e- / - π）：换一套列宽，见 .is-numpad
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

/** 把这一页所有数值框都接到这个键盘上
 *  （换算界面的数值 + 立体角 + 面积，体积⇄质量的体积/质量 + 密度） */
function cvtPadBind() {
  const inputs = [cvtFrom, cvtAuxOmegaEl, cvtAuxAreaEl, bdFromEl, bdDensityEl];

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
   九之二、体积 ⇄ 质量（密度作桥）
   ----------------------------------------------------------
   质量 = 体积 × 密度。这个式子两头是**两个不同的量**，所以它不属于任何
   一张单位表 —— 单独一层视图。入口只有一处：体积 / 质量换算页底下的
   虚线跳转（见 cvtPaintBridgeLink），进来时带着那边的数值和单位，
   返回时也回到那张换算页。（不放进类别列表 —— 那不是一类单位。）

   状态只有三样：
     bdDir    方向：'v2m'（体积 → 质量）| 'm2v'
     bdSel    { from, to, rho } 三个单位 id（from/to 的含义跟着方向走）
     两个框里的数值就地读，不另存

   换算走三个基准：体积 升、质量 千克、密度 千克/立方米。
     v2m   V(L) → V/1000 (m³) × ρ(kg/m³) → kg → 目标质量单位
     m2v   m(kg) ÷ ρ(kg/m³) → m³ × 1000 → L → 目标体积单位
   密度那档的非线性刻度（API / 波美 / 柏拉图…）不用管：读数和 kg/m³
   之间的来回全借 UNITS.density 的 toBase，这里只管乘除。

   ★ 方向不是"算两遍"：进哪张卡就按哪个方向摆（上栏是体积还是质量），
     中间那颗互换按钮掉头时，上下单位一起换位、结果挪到上面 ——
     和换算界面那颗互换按钮一个手感。
   ========================================================== */

let bdDir = 'v2m';
let bdSel = { from: 'l', to: 'kg', rho: 'gcm3' };
let bdConvScroll = 0;      // 跳走之前换算页滚到哪儿了（返回时还原）

/* 密度快捷键：一组"实心料"、一组"水"，按体积那一栏用的是什么单位二选一。
   ★ 数值全部取**常温 20 ℃**（温度一变密度就变，水最明显）：
       水    998.2071 kg/m³ = 0.9982 g/cm³   （4 ℃ 那个 1.000 是教科书整数）
       纯铁  7.874 g/cm³
       纯银  10.49 g/cm³
       纯金  19.32 g/cm³
   点一颗 = 把密度框填上这个数、把密度单位切到 g/cm³（这几组数就是按它写的）。 */
const BD_RHO_PRESETS = {
  water:  { val: '0.9982' },
  iron:   { val: '7.874'  },
  silver: { val: '10.49'  },
  gold:   { val: '19.32'  },
};

/** 这一层某一栏是哪个量：'体积' | '质量'（方向反了，答案就反） */
function bdQtyName(which) {
  const isVol = bdDir === 'v2m' ? which === 'from' : which === 'to';
  return isVol ? '体积' : '质量';
}

/** 某一栏能选哪些单位 —— 密度那栏直接借密度档整张表（含比重刻度） */
function bdUnits(which) {
  if (which === 'rho') return UNITS.density.units;
  return bdQtyName(which) === '体积' ? UNITS.volume.units : UNITS.mass.units;
}

function bdUnit(which, id) {
  return bdUnits(which).find(u => u.id === id) || null;
}

/** 三个单位按钮 + 两栏标签 + 顶栏标题 + 那句公式，全跟着方向刷 */
function bdPaintUnits() {
  const fromIsVol = bdQtyName('from') === '体积';

  bdFromLabelEl.textContent = fromIsVol ? '体积 V' : '质量 m';
  bdToLabelEl.textContent   = fromIsVol ? '质量 m' : '体积 V';
  bdRhoHeadEl.textContent   = fromIsVol ? '质量 = 体积 × 密度' : '体积 = 质量 ÷ 密度';

  cvtPaintUnitBtn(bdFromUnitBtn,  bdUnit('from', bdSel.from),  bdQtyName('from') + '单位');
  cvtPaintUnitBtn(bdToUnitBtn,    bdUnit('to',   bdSel.to),    bdQtyName('to')   + '单位');
  cvtPaintUnitBtn(bdDensityBtn,   bdUnit('rho',  bdSel.rho),   '密度单位');

  unitTitleEl.textContent = bdQtyName('from') + ' → ' + bdQtyName('to');

  bdPaintRhoChips();

  /* 底下那句举例跟着方向换 —— 反过来读的时候，"同样 1 升"就不对味了：
     质量→体积问的是"这么多斤两占多大地方"。 */
  bdNoteEl.textContent = fromIsVol
    ? '密度决定结果：同样 1 升，水约 1 千克、汽油约 0.74 千克、铁约 7.87 千克（快捷键按常温 20 ℃）'
    : '密度决定结果：同样 1 千克，水约 1 升、汽油约 1.35 升、铁约 0.13 升（快捷键按常温 20 ℃）';
}

/** 清掉某栏的提示（红字和灰字一起收） */
function bdClearHint(el) {
  cvtSoftHint(el, '');      // 顺手摘掉 .soft，不然下次的红字会被压成灰的
  clearError(el);
}

/** 摆提示：soft=true 是"还没填"的灰字，false 是"填错了"的红字 */
function bdHint(el, msg, soft) {
  if (soft) { cvtSoftHint(el, msg); return; }
  cvtSoftHint(el, '');          // 先摘掉 .soft，不然这句红字会被压成灰的
  setError(el, msg);
}

/** 读密度那一栏 → { value: kg/m³ } 或 { msg, hard }。
 *  hard=false 只表示"还没填"（灰提示），不是错。
 *  非线性刻度由 UNITS.density.toBase 负责，这里只兜"换出来不是正数"的读数
 *  （比如重波美 145 度 = 比重无穷大，那是这个读数本身没有对应的密度）。 */
function bdReadDensity() {
  const raw = bdDensityEl.value;
  if (!raw) return { msg: '填一个密度才能换算', hard: false };

  const p = cvtParse(raw);
  if (p.msg) return { msg: p.msg, hard: true };
  if (!Number.isFinite(p.value)) return { msg: '这个数字太大了', hard: true };

  const rho = UNITS.density.toBase(p.value, bdSel.rho);
  if (!Number.isFinite(rho) || !(rho > 0)) {
    return { msg: '这个读数换不出正的密度，换一个试试', hard: true };
  }
  return { value: rho };
}

/** 上框 → 下框。空着不算错，只是没结果；密度缺了就先讨密度。 */
function bdSync() {
  // 1) 上面的数
  let v = null;
  if (bdFromEl.value) {
    const p = cvtParse(bdFromEl.value);
    if (p.msg) {
      bdToEl.value = '';
      setError(bdFromEl, p.msg);
      bdPaintRhoHint();          // 密度那句提示照摆，别让用户以为只要填上面
      return;
    }
    if (!Number.isFinite(p.value)) {
      bdToEl.value = '';
      setError(bdFromEl, '这个数字太大了');
      return;
    }
    v = p.value;
  }
  clearError(bdFromEl);

  // 2) 桥：密度
  const rho = bdReadDensity();
  if (rho.msg) {
    bdToEl.value = '';
    bdHint(bdDensityEl, rho.msg, !rho.hard);
    return;
  }
  bdClearHint(bdDensityEl);

  // 3) 上面空着就先不算（密度填好了也不出假结果）
  if (v === null) { bdToEl.value = ''; return; }

  const fromU = bdUnit('from', bdSel.from);
  const toU   = bdUnit('to',   bdSel.to);
  if (!fromU || !toU) { bdToEl.value = ''; return; }

  let res;
  if (bdDir === 'v2m') {
    const litres = v * fromU.k;              // → 升（体积的基准）
    const kg = litres / 1000 * rho.value;    // 升 → 立方米 → 千克
    res = kg / toU.k;                        // 千克 → 目标质量单位
  } else {
    const kg = v * fromU.k;                  // → 千克（质量的基准）
    const litres = kg / rho.value * 1000;    // 千克 → 立方米 → 升
    res = litres / toU.k;                    // 升 → 目标体积单位
  }
  bdToEl.value = cvtFmt(res);
}

/** 密度快捷键摆哪一组：看**体积那一栏**用的是立方单位，还是升/加仑这类容积单位。
 *    体积（cm³、m³…）→ 纯铁 / 纯银 / 纯金：量一块料有多重
 *    容积（L、mL、加仑…）→ 水：量一壶水有多重
 *  另一组整排 hidden（CSS 里补了 .chip[hidden]{display:none}，
 *  因为 .chip 自带 display:inline-flex，会压掉浏览器的 [hidden]）。 */
function bdPaintRhoChips() {
  if (!bdRhoChipsEl) return;

  const volWhich = bdQtyName('from') === '体积' ? 'from' : 'to';
  const volU = bdUnit(volWhich, bdSel[volWhich]);
  const isCap = !!volU && volU.group === '容积';

  // 亮哪一颗：密度单位正好是 g/cm³、框里的字也正好等于那个数
  const cur = bdDensityEl.value.trim();
  const inGcm3 = bdSel.rho === 'gcm3';

  $$('[data-bd-rho]', bdRhoChipsEl).forEach(chip => {
    const isWater = chip.dataset.bdRho === 'water';
    chip.hidden = isCap ? !isWater : isWater;
    const p = BD_RHO_PRESETS[chip.dataset.bdRho];
    chip.setAttribute('aria-checked', String(inGcm3 && cur === p.val));
  });
}

/** 上面填错时，也把密度那句"还缺一个密度"摆出来（和光学的 cvtDemandAux 一个意思） */
function bdPaintRhoHint() {
  const rho = bdReadDensity();
  if (rho.msg) bdHint(bdDensityEl, rho.msg, !rho.hard);
}

/** 进这一层：dir 决定上栏摆体积还是质量。
 *  seed 可选 = { value, unit }：从换算界面那颗跳转过来时，把那边刚敲的数和
 *  单位带过来（用户在体积页填了 12 升，跳过来就是 12 升 → ? 千克）。 */
function bdOpen(dir, seed) {
  bdDir = dir === 'm2v' ? 'm2v' : 'v2m';

  /* 默认摆一对最常用的：升 ⇄ 千克 + 水。
     密度写 0.9982（20 ℃ 的水），不写教科书那个整数 1 —— 快捷键也是这个值，
     一进来「水」那颗就是亮的，两种口径不会打架。 */
  bdSel = bdDir === 'v2m'
    ? { from: 'l', to: 'kg', rho: 'gcm3' }
    : { from: 'kg', to: 'l', rho: 'gcm3' };

  // 带过来的单位只在这边确实有才认（体积的是体积单位、质量的是质量单位）
  if (seed && seed.unit && bdUnit('from', seed.unit)) bdSel.from = seed.unit;

  bdFromEl.value = seed && seed.value ? seed.value : '1';
  bdDensityEl.value = BD_RHO_PRESETS.water.val;
  bdClearHint(bdFromEl);
  bdClearHint(bdDensityEl);

  bdPaintUnits();
  bdSync();

  cvtPadHide();
  cvtClosePicker();
  unitCatsEl.hidden = true;
  unitConvEl.hidden = true;
  unitBridgeEl.hidden = false;
  unitBodyEl.scrollTop = 0;
}

/** 退一层：回到那张换算页（数值和单位都还留着）。 */
function bdBack() {
  unitBridgeEl.hidden = true;
  unitConvEl.hidden = false;
  unitTitleEl.textContent = cvtCatTitle(cvtCat);
  // 先让它显示出来再设 scrollTop：藏着的时候内容高度是 0，设进去会被夹成 0
  unitBodyEl.scrollTop = bdConvScroll;
}

/** 掉头：方向和上下单位一起换，结果挪到上面（密度留着 —— 换的是方向，不是物质）*/
function bdSwap() {
  const moved = bdToEl.value;
  if (moved) bdFromEl.value = moved;

  const from = bdSel.from;
  bdSel.from = bdSel.to;
  bdSel.to = from;
  bdDir = bdDir === 'v2m' ? 'm2v' : 'v2m';

  bdPaintUnits();
  bdSync();
}

/* ==========================================================
   十、事件绑定
   ========================================================== */

/* ---- 选类别 / 选量 ----
   两层列表共用同一套卡片外观，但容器不同：第一层是写死在 index.html 里的
   #unitCats（每张卡有自己的 SVG 图标），第二层是 cvtRenderKids 现画的
   #unitSubs。两边都靠 data-* 认卡片，点下去都进同一个 cvtOpenCat。
   父领域（electric 之类）在 cvtOpenCat 里会被转到 cvtShowKids。 */
unitCatsEl.addEventListener('click', e => {
  const card = e.target.closest('[data-unit-cat]');
  if (!card) return;
  cvtOpenCat(card.dataset.unitCat);
});

unitSubsEl.addEventListener('click', e => {
  const card = e.target.closest('[data-unit-kid]');
  if (!card) return;
  cvtOpenCat(card.dataset.unitKid);
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

/* ---- 体积 ⇄ 质量：两个数各改各的，改完就重算 ----
   密度那一栏也走同一套字符白名单（°API 这种读数是数字，不是字母） */
bdFromEl.addEventListener('input', () => {
  cvtFilter(bdFromEl);
  bdSync();
});
bdDensityEl.addEventListener('input', () => {
  cvtFilter(bdDensityEl);
  bdSync();
});
bdSwapBtn.addEventListener('click', bdSwap);

/* ---- 密度快捷键：填数 + 把密度单位切回 g/cm³（这几组数就是按它写的） ----
   和光学的立体角药丸一样：点一下就是一整串，**不**顺手 focus（手机上会弹键盘）。
   填完仍是普通文本，用户还能接着改（7.874 → 7.9 之类）。 */
if (bdRhoChipsEl) {
  bdRhoChipsEl.addEventListener('click', e => {
    const chip = e.target.closest('[data-bd-rho]');
    if (!chip) return;

    const p = BD_RHO_PRESETS[chip.dataset.bdRho];
    if (!p) return;

    bdDensityEl.value = p.val;
    bdSel.rho = 'gcm3';
    bdClearHint(bdDensityEl);
    bdPaintUnits();          // 按钮上的单位名跟着换（可能刚从 °API 回来）
    bdSync();
    cvtPadHide();
  });
}

/* ---- 换算界面底下那颗「体积 → 质量」：带着当前数值和单位跳过去 ----
   数值原样搬（不重新格式化），单位也搬 —— 用户在体积页填的是「12 加仑」，
   跳过去还得先改回升就太别扭了。密度仍是默认的水，改一下就是别的物质。 */
if (cvtBridgeBtn) {
  cvtBridgeBtn.addEventListener('click', () => {
    const dir = cvtBridgeBtn.dataset.dir;
    if (!dir) return;
    bdConvScroll = unitBodyEl.scrollTop;
    bdOpen(dir, { value: cvtFrom.value, unit: cvtSel.from });
  });
}

/* ---- 复制：数值 / 结果各一颗（见七、那一节） ---- */
[[cvtCopyFromBtn, cvtFrom, '数值', '复制数值'],
 [cvtCopyToBtn,   cvtTo,   '结果', '复制结果'],
 [bdCopyFromBtn,  bdFromEl, '数值', '复制数值'],
 [bdCopyToBtn,    bdToEl,   '结果', '复制结果']].forEach(([btn, input, label, aria]) => {
  btn.setAttribute('aria-label', aria);
  // 拦 mousedown：不抢输入框的焦点，否则手机上的软键盘会跟着收起来
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => cvtCopy(input, label));
});

/* ---- 打开单位弹窗 ---- */
cvtFromBtn.addEventListener('click', () => cvtOpenPicker('from'));
cvtToBtn.addEventListener('click', () => cvtOpenPicker('to'));
bdFromUnitBtn.addEventListener('click', () => cvtOpenPicker('bdFrom'));
bdToUnitBtn.addEventListener('click', () => cvtOpenPicker('bdTo'));
bdDensityBtn.addEventListener('click', () => cvtOpenPicker('bdRho'));

/* ---- 选中一个单位 ----
   换单位**保留**框里的数字（1 米 → 1 千米），只是按新系数重算结果 ——
   单位换算器都是这个手感：数字是用户刚敲的，不该被悄悄改掉。
   体积⇄质量那层共用这个弹窗：它有三个栏（体积 / 质量 / 密度），
   落到哪个状态由 cvtPicking 说了算。 */
unitPickerChips.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip || !cvtPicking) return;

  const which = cvtPicking;
  const u = cvtPickSource().units.find(x => x.id === chip.dataset.unit);

  if (u) {
    if (which === 'bdFrom')      bdSel.from = u.id;
    else if (which === 'bdTo')   bdSel.to = u.id;
    else if (which === 'bdRho')  bdSel.rho = u.id;
    else                         cvtSel[which] = u.id;
  }

  cvtClosePicker();

  if (which.indexOf('bd') === 0) { bdPaintUnits(); bdSync(); }
  else { cvtPaintUnits(); cvtSync(); }
});

/* ---- 关闭弹窗：✕ / 点遮罩 ---- */
unitPickerClose.addEventListener('click', cvtClosePicker);
unitPicker.addEventListener('click', e => {
  if (e.target === unitPicker) cvtClosePicker();
});

/* ---- 顶栏返回：换算界面 / 体积⇄质量里先退回类别列表 ----
   放在**捕获阶段**：tools.js 的返回处理挂在冒泡阶段，捕获先跑，
   stopPropagation 就能把它挡下来（和 cards.js 拦卡片点击同一个套路）。 */
document.addEventListener('click', e => {
  const back = e.target.closest('[data-tool-back]');
  if (!back || back.closest('.tool-page') !== UNIT_PAGE) return;
  // cvtBackOne 顺带把「有几层可退」判断完了：返回 false 说明已经在类别页，
  // 那就别拦，交给 tools.js 去关掉整个功能页。
  if (!cvtBackOne()) return;
  e.preventDefault();
  e.stopPropagation();
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
  if (!cvtBackOne()) return;      // 已经在类别页：交给 tools.js 关掉功能页
  e.stopPropagation();
}, true);

/* ---- 返回键（js/backnav.js）：换算界面 / 体积⇄质量里先退回类别列表 ----
   顺序和上面那条顶栏返回一致；软键盘 / 单位选择器那两层由 backnav 按层处理，
   走到这里时只剩「子视图 vs 类别列表」这一级。 */
if (typeof NovaBack !== 'undefined') {
  NovaBack.inner(top => {
    if (top !== UNIT_PAGE) return false;    // 上面还压着单位选择器时，那层先关
    return cvtBackOne();                    // 换算页 / 选量 / 类别页三级都在里面判
  });
}

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
