/* ==========================================================================
   convert.js —— 功能页：图片格式转换

   ★ 全程在浏览器里完成，图片不出本机。
     转换交给浏览器自己的编解码能力：
        File → createImageBitmap / <img>（解码）→ <canvas> → toBlob（编码）
     代价是**只能输出 canvas 支持的那三种**：PNG / JPEG / WebP。

   ★ 三条必须守住的边界（都在 UI 上跟用户说清了）：
     · JPEG 没有透明通道 —— 透明区域会填成用户选的底色，不填就是黑的
     · 动图（GIF / 动态 WebP）只拿得到第一帧，canvas 读不出动画
     · SVG 不接 —— 能被栅格化，但带外部引用的 SVG 可能让 canvas 废掉，
       第一版直接拒收，比转出一张空白图强

   ★ toBlob 的坑：传进去不支持的 MIME **不会报错，会静默回退成 PNG**。
     所以拿到 blob 后必须核对 blob.type，不然会以为成功、其实格式是错的。

   ★ 占位/依赖：core.js（$ / toast）与 tools.js（tool:open 事件）。
     另外用到 home.js 里的全局 currentAccount，用来判断该不该清掉
     上一位留在页面上的图片。
   ========================================================================== */

const pageConvert = document.getElementById('toolConvert');

/* ==========================================================
   一、常量 / 状态
   ========================================================== */

/* 能输出的三种。lossy 决定要不要给画质滑杆：
   PNG 是无损的，quality 参数对它无效，给了只会误导。 */
const CV_FORMATS = [
  { mime: 'image/png',  label: 'PNG',  ext: '.png',  lossy: false,
    hint: '无损，支持透明' },
  // 界面上统一写 JPG。JPEG 和 JPG 是同一个东西（同一个 MIME image/jpeg，
  // 只是扩展名长短不同），两种叫法并排出现会让用户以为要二选一。
  { mime: 'image/jpeg', label: 'JPG',  ext: '.jpg',  lossy: true,
    hint: '体积小，不支持透明' },
  { mime: 'image/webp', label: 'WebP', ext: '.webp', lossy: true,
    hint: '体积更小，支持透明' },
];

/* 尺寸：0 = 保持原尺寸；其余是"最长边不超过多少像素" */
const CV_SIZES = [
  { value: 0,    label: '原尺寸' },
  { value: 1920, label: '1920' },
  { value: 1280, label: '1280' },
  { value: 800,  label: '800' },
];

/* 「透明区域填充」的常用色。都是一些当底色不抢戏的中性色，
   白、浅灰、中灰、深灰、黑 —— 从浅到深排，一眼就能挑。 */
const CV_BG_PRESETS = ['#FFFFFF', '#F4F5F7', '#9AA1AC', '#1F2430', '#000000'];

const CV_BG_DEFAULT = '#FFFFFF';

/* 各种 MIME 的中文/通用叫法，只用于显示。
   jpeg / jpg 统一显示成 JPG（见 CV_FORMATS 上的说明）。 */
const MIME_LABEL = {
  'image/png': 'PNG',   'image/jpeg': 'JPG',  'image/jpg': 'JPG',
  'image/webp': 'WebP', 'image/gif': 'GIF',   'image/bmp': 'BMP',
  'image/x-ms-bmp': 'BMP', 'image/avif': 'AVIF', 'image/heic': 'HEIC',
  'image/heif': 'HEIF', 'image/tiff': 'TIFF', 'image/x-icon': 'ICO',
  'image/vnd.microsoft.icon': 'ICO', 'image/svg+xml': 'SVG',
};

/* 没有 MIME（有些系统不给 HEIC 标类型）时，认得出来的扩展名 */
const IMG_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'ico',
  'avif', 'heic', 'heif', 'tif', 'tiff', 'apng',
]);

/* canvas 的硬上限（保守值，各家浏览器略有出入）：
   单边超过 16384 或总像素过多会直接失败/吃爆内存。
   超了就自动等比缩小，宁可降尺寸也不让整张转不出来。 */
const CV_MAX_SIDE   = 16384;
const CV_MAX_PIXELS = 40e6;

const CV_MAX_FILES  = 60;      // 一次最多收多少张

/* ---- 当前设置 ---- */
let cvFormat   = 'image/png';
let cvQuality  = 0.9;          // 0–1
let cvMaxEdge  = 0;            // 0 = 原尺寸
let cvBgColor  = CV_BG_DEFAULT; // JPG 的透明区填充色（'#RRGGBB'）
let cvZipOn    = false;        // 勾了「打包成一个 ZIP 下载」
let cvWebpOk   = true;         // WebP 能不能导出（打开时实测）

/* ---- 运行状态 ---- */
const cvItems = [];            // 队列：{ id, file, name, size, thumbUrl, status, out, error, ... }
let cvIdSeq    = 0;
let cvBusy     = false;        // 正在批量转换
let cvDirty    = false;        // 转完又改了设置 → 按钮改成「重新转换」
let cvOwner    = null;         // 上次打开时登录的是谁

/* 一张画布反复用：批量转换是串行的，不用每张新建一个 */
const cvCanvas = document.createElement('canvas');

/* ---- 常用节点 ---- */
const cvDrop        = $('#cvDrop');
const cvInput       = $('#cvInput');
const cvFormats     = $('#cvFormats');
const cvSizes       = $('#cvSizes');
const cvQualityWrap = $('#cvQualityWrap');
const cvQualityEl   = $('#cvQuality');
const cvQualityVal  = $('#cvQualityVal');
const cvBgWrap      = $('#cvBgWrap');
const cvHexEl       = $('#cvHex');
const cvSwatch      = $('#cvSwatch');
const cvPresetsEl   = $('#cvPresets');
const cvZipEl       = $('#cvZip');
const cvGo          = $('#cvGo');
const cvListCard    = $('#cvListCard');
const cvList        = $('#cvList');
const cvCount       = $('#cvCount');
const cvAllBtn      = $('#cvAllBtn');
const cvClearBtn    = $('#cvClearBtn');

/* ==========================================================
   二、小工具
   ========================================================== */
function cvFormatByMime(mime) {
  return CV_FORMATS.find(f => f.mime === mime) || CV_FORMATS[0];
}

function cvLabelOfMime(mime) {
  return MIME_LABEL[mime] || mime;
}

/** 文件扩展名（小写，不带点） */
function cvExtOf(name) {
  const m = /\.([^.\\/]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 去掉扩展名的文件名 */
function cvBaseName(name) {
  const s = String(name || '').replace(/\.[^.\\/]+$/, '');
  return s || 'image';
}

/** 这个文件我们打不打得开——只做粗筛，真正的判据是"试着解码" */
function cvLooksLikeImage(file) {
  if ((file.type || '').startsWith('image/')) return true;
  return IMG_EXTS.has(cvExtOf(file.name));
}

function cvIsSvg(file) {
  return file.type === 'image/svg+xml' || cvExtOf(file.name) === 'svg';
}

/** 体积格式化：B / KB / MB */
function cvFmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) {
    const kb = bytes / 1024;
    return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
  }
  const mb = bytes / 1048576;
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
}

/** 转换前后的体积变化 */
function cvDeltaText(before, after) {
  if (!before || !after) return '';
  const pct = Math.round((after - before) / before * 100);
  if (pct === 0) return '体积不变';
  return pct < 0 ? `省 ${-pct}%` : `增 ${pct}%`;
}

/** 放下一帧，让浏览器有机会把进度画出来 */
function cvYield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** 把用户敲的颜色码归一成 '#RRGGBB'；不合法返回 null。
 *
 *  宽容一点：'#' 可省（中文输入法容易打出全角 ＃）、字母不分大小写、
 *  允许 3 位的简写（#f00 → #FF0000）。归一后统一大写——
 *  写进 canvas 的 fillStyle 用哪种都行，但显示和比较时只有一种写法省心。
 */
function cvNormalizeHex(raw) {
  // 去掉首尾空白，以及文中任何 # / ＃ / 空白
  const s = String(raw == null ? '' : raw).trim().replace(/[#＃\s]/g, '');
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;

  let hex = s;
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) return null;
  return '#' + hex.toUpperCase();
}

/** 触发一次下载。object URL 要留一会儿再撤，撤早了下载会被打断 */
function cvSaveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ==========================================================
   三、ZIP 打包（「打包成一个 ZIP 下载」勾上时走这条）

   不引第三方库，自己按 ZIP 规范拼字节。规格上只需要三个结构：
     本地文件头 → 文件数据 → 中央目录 → 中央目录结束记录
   用**存储方式（method 0，不压缩）**：装进去的都是 PNG/JPG/WebP，
   本身已经是压缩过的，再套一层 deflate 基本省不下体积，却要多一套
   压缩流的兼容处理，不划算。

   不支持的：ZIP64（单文件 > 4GB、总量 > 4GB、超过 65535 个文件）。
   这种量级在图片转换这里不现实，超了直接报错拦住，而不是拼出一个坏包。
   ========================================================== */

/* CRC-32 查表（ZIP 规定的那个多项式 0xEDB88320，反射写法） */
const CV_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function cvCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CV_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** JS 的 Date → ZIP 要的 MS-DOS 日期/时间。年份从 1980 起算，秒只有 2 秒精度。 */
function cvDosDateTime(d) {
  const time = ((d.getHours() & 31) << 11)
             | ((d.getMinutes() & 63) << 5)
             | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9)
             | (((d.getMonth() + 1) & 15) << 5)
             | (d.getDate() & 31);
  return { time, date };
}

/** 包内文件名：去掉路径分隔符和控制字符（免得被当成目录、或拼出坏包），并去重 */
function cvZipEntryName(name, used) {
  let base = String(name || 'image')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim() || 'image';
  if (base.length > 120) base = base.slice(0, 120);

  let out = base;
  let i = 1;
  while (used.has(out.toLowerCase())) {
    i++;
    const dot = base.lastIndexOf('.');
    out = dot > 0
      ? `${base.slice(0, dot)} (${i})${base.slice(dot)}`
      : `${base} (${i})`;
  }
  used.add(out.toLowerCase());
  return out;
}

/** entries: [{ name, blob }] → ZIP 的 Blob */
async function cvBuildZip(entries) {
  if (entries.length > 65535) {
    throw new Error('一次最多打包 65535 个文件');
  }

  const enc = new TextEncoder();
  const { time, date } = cvDosDateTime(new Date());
  const parts = [];        // 本地：头 + 数据，按顺序排
  const central = [];      // 中央目录，收尾时统一拼上
  let offset = 0;          // 已写出的字节数（= 下一个本地头的偏移）

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    // 先物化成字节：既要算 CRC，也要知道确切长度
    const data = new Uint8Array(await e.blob.arrayBuffer());
    const size = data.length;

    if (size > 0xFFFFFFFF) throw new Error('「' + e.name + '」超过 4GB，打包不了');
    if (offset + 30 + nameBytes.length + size > 0xFFFFFFFF) {
      throw new Error('打包后的体积超过 4GB，装不进一个 ZIP');
    }

    const crc = cvCrc32(data);

    /* ---- 本地文件头（30 字节定长 + 文件名） ---- */
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);          // 签名
    ldv.setUint16(4, 20, true);                  // 需要的解压版本
    ldv.setUint16(6, 0x0800, true);              // 标志位：文件名是 UTF-8
    ldv.setUint16(8, 0, true);                   // 压缩方式 0 = 存储
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, date, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);               // 压缩后大小（存储 = 原大小）
    ldv.setUint32(22, size, true);               // 原始大小
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);                  // 扩展字段长度
    lh.set(nameBytes, 30);

    parts.push(lh, data);

    /* ---- 中央目录项（46 字节定长 + 文件名） ---- */
    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);          // 签名
    cdv.setUint16(4, 20, true);                  // 创建者版本
    cdv.setUint16(6, 20, true);                  // 需要的解压版本
    cdv.setUint16(8, 0x0800, true);              // 标志位：UTF-8 文件名
    cdv.setUint16(10, 0, true);                  // 压缩方式
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    // 30 扩展字段 / 32 注释 / 34 起始磁盘 / 36 内部属性 / 38 外部属性 都留 0
    cdv.setUint32(42, offset, true);             // 对应本地头的偏移
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + size;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);

  /* ---- 中央目录结束记录（22 字节，无注释） ---- */
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);            // 签名
  edv.setUint16(8, entries.length, true);        // 本磁盘条目数
  edv.setUint16(10, entries.length, true);       // 总条目数
  edv.setUint32(12, cdSize, true);               // 中央目录大小
  edv.setUint32(16, offset, true);               // 中央目录起始偏移

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}

/** ZIP 的下载文件名（带时间和张数，批量下载时好区分） */
function cvZipFileName(n) {
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  return `nova-images-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
       + `-${p(d.getHours())}${p(d.getMinutes())}-${n}.zip`;
}

/* ==========================================================
   四、设置区：药丸选择器
   ========================================================== */
function cvRenderChips(host, items, current, onPick) {
  host.textContent = '';
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(it.value === current));
    if (it.title) btn.title = it.title;
    btn.textContent = it.label;
    btn.addEventListener('click', () => onPick(it.value));
    host.appendChild(btn);
  });
}

function cvRenderFormats() {
  // WebP 要实测能不能导出：Safari 支持得晚，不支持就干脆别给这个选项
  const list = CV_FORMATS.filter(f => f.mime !== 'image/webp' || cvWebpOk);
  // 万一当前选中的正好被藏掉了，退回 PNG
  if (!list.some(f => f.mime === cvFormat)) cvFormat = 'image/png';

  cvRenderChips(
    cvFormats,
    list.map(f => ({ value: f.mime, label: f.label, title: f.hint })),
    cvFormat,
    v => { cvFormat = v; cvRenderFormats(); cvSyncFormatUI(); cvMarkDirty(); },
  );
}

function cvRenderSizes() {
  cvRenderChips(
    cvSizes,
    CV_SIZES.map(s => ({ value: s.value, label: s.label })),
    cvMaxEdge,
    v => { cvMaxEdge = v; cvRenderSizes(); cvMarkDirty(); },
  );
}

/** 跟着格式走：有损才给画质，JPG 才需要底色 */
function cvSyncFormatUI() {
  const fmt = cvFormatByMime(cvFormat);
  cvQualityWrap.hidden = !fmt.lossy;
  cvBgWrap.hidden = (fmt.mime !== 'image/jpeg');
}

/* ==========================================================
   五、透明区填充色（色块 + 色码输入 + 常用色）
   ========================================================== */

/** 把当前颜色画到色块上，并标出哪个常用色是选中的 */
function cvPaintBg() {
  cvSwatch.style.background = cvBgColor;

  $$('.cv-pip', cvPresetsEl).forEach(pip => {
    const on = pip.dataset.color === cvBgColor;
    pip.classList.toggle('on', on);
    // 用 aria-pressed 表达"这个色当前生效"，不只是视觉好看
    pip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function cvRenderPresets() {
  cvPresetsEl.textContent = '';
  CV_BG_PRESETS.forEach(hex => {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'cv-pip';
    pip.dataset.color = hex;
    pip.style.background = hex;
    pip.title = hex;
    pip.setAttribute('aria-label', '填充色 ' + hex);
    pip.addEventListener('click', () => cvSetBgColor(hex, { fillInput: true }));
    cvPresetsEl.appendChild(pip);
  });
}

/** 统一入口：设色 → 刷新界面 → 标脏（转过的图片需要重转） */
function cvSetBgColor(hex, opts) {
  cvBgColor = hex;
  if (opts && opts.fillInput) cvHexEl.value = hex;
  clearError(cvHexEl);
  cvPaintBg();
  cvMarkDirty();
}

/** 敲色码：合法就即时生效；输到一半先不吵，只有明显不对才提示 */
function cvOnHexInput() {
  const raw = cvHexEl.value.trim();
  const hex = cvNormalizeHex(raw);
  if (hex) {
    cvSetBgColor(hex);            // 不回填输入框，免得边打边被改写
    return;
  }

  // 还没输完（不足 6 位、也没混进别的字符）就先忍着，别边打边报错
  const body = raw.replace(/[#＃\s]/g, '');
  const badChar = /[^0-9a-fA-F]/.test(body);
  if (badChar || body.length >= 6) {
    setError(cvHexEl, '请输入 6 位色码，例如 #FFFFFF');
  } else {
    clearError(cvHexEl);
  }
  // 注意：这里**不动** cvBgColor —— 保持上一个有效色，
  // 免得半截输入把底色改成不可预期的值
}

/** 失焦：把输入框收回成一个合法色码（打错的就退回上一个有效值） */
function cvOnHexBlur() {
  const hex = cvNormalizeHex(cvHexEl.value);
  cvHexEl.value = hex || cvBgColor;
  clearError(cvHexEl);
}

/* ==========================================================
   六、解码 / 缩放 / 编码
   ========================================================== */

/** 把 File 解成能画进 canvas 的东西。返回 { src, w, h, release() }
 *
 *  优先 createImageBitmap：它支持 imageOrientation: 'from-image'，
 *  能把手机竖拍照片的 EXIF 旋转信息直接算进去，否则导出来是躺倒的。
 *  老浏览器退回 <img>（那时 EXIF 就顾不上了，但至少能转）。
 */
async function cvDecode(file) {
  if (typeof createImageBitmap === 'function') {
    // 先带方向参数试，不行再裸着试一次
    for (const opt of [{ imageOrientation: 'from-image' }, undefined]) {
      try {
        const bmp = opt ? await createImageBitmap(file, opt)
                        : await createImageBitmap(file);
        return {
          src: bmp,
          w: bmp.width,
          h: bmp.height,
          release: () => { try { if (bmp.close) bmp.close(); } catch (_) {} },
        };
      } catch (_) { /* 换下一种再试 */ }
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    if (typeof img.decode === 'function') {
      await img.decode();
    } else {
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('load failed'));
      });
    }
  } catch (_) {
    URL.revokeObjectURL(url);
    // 别把话说成"不支持这个格式"：文件本身坏了、或者系统给的类型不准，
    // 都会走到这儿，说清楚两种可能，用户才知道下一步怎么办。
    throw new Error('读不出这张图，可能文件已损坏，或浏览器不支持该格式');
  }
  // 注意：url 到画完再撤（见 release），有的浏览器撤早了图就没了
  return {
    src: img,
    w: img.naturalWidth,
    h: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

/** 算出实际要画的尺寸：先按用户选的最长边，再兜住 canvas 的硬上限 */
function cvTargetSize(w, h, maxEdge) {
  const longest = Math.max(w, h);
  let scale = 1;

  if (maxEdge > 0 && longest > maxEdge) scale = maxEdge / longest;
  if (longest * scale > CV_MAX_SIDE) scale = CV_MAX_SIDE / longest;

  const pixels = (w * scale) * (h * scale);
  if (pixels > CV_MAX_PIXELS) scale *= Math.sqrt(CV_MAX_PIXELS / pixels);

  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
    scaled: scale < 1,
  };
}

/** canvas → blob。这里必须核对 blob.type，理由见文件头。 */
function cvCanvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    let done = false;
    canvas.toBlob(blob => {
      done = true;
      if (!blob) {
        reject(new Error('没能生成图片，可能是尺寸太大'));
        return;
      }
      // toBlob 拿到不支持的格式会静默回退成 PNG，靠这个 type 才认得出来
      if (blob.type && blob.type !== mime) {
        reject(new Error('这个浏览器不支持导出 ' + cvLabelOfMime(mime)));
        return;
      }
      resolve(blob);
    }, mime, quality);

    // 极少数情况下 toBlob 的回调根本不触发，兜个底免得整批卡死
    setTimeout(() => {
      if (!done) reject(new Error('转换超时'));
    }, 30000);
  });
}

/** WebP 能不能导出：拿 2×2 的空画布实测一次（1×1 在个别版本上不准） */
async function cvDetectWebp() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.8));
    return !!blob && blob.type === 'image/webp';
  } catch (_) {
    return false;
  }
}

/* ==========================================================
   七、队列 / 列表渲染
   ========================================================== */

/** 加文件。返回是否真有加进去 */
function cvAddFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  let added = 0, svgCount = 0, otherCount = 0, overCount = 0;

  files.forEach(file => {
    if (cvItems.length >= CV_MAX_FILES) { overCount++; return; }
    if (cvIsSvg(file)) { svgCount++; return; }
    if (!cvLooksLikeImage(file)) { otherCount++; return; }

    const item = {
      id: ++cvIdSeq,
      file,
      name: file.name || 'image',
      size: file.size || 0,
      // 缩略图直接用原文件的 object URL，浏览器自己按需解码，省事又不占内存
      thumbUrl: URL.createObjectURL(file),
      status: 'idle',        // idle | working | done | fail
      out: null,
      error: '',
      row: null, metaEl: null, outEl: null, dlBtn: null,
    };

    cvItems.push(item);
    const row = cvMakeRow(item);
    cvList.appendChild(row);
    cvUpdateRow(item);
    added++;
  });

  cvSyncListUI();

  const skipped = [];
  if (svgCount) skipped.push(`${svgCount} 个 SVG`);
  if (otherCount) skipped.push(`${otherCount} 个非图片文件`);
  if (overCount) skipped.push(`${overCount} 个（超出 ${CV_MAX_FILES} 张上限）`);

  if (skipped.length) {
    toast('err', '已跳过 ' + skipped.join('、'),
          added ? `其余 ${added} 张已加入` : '这些都不支持转换');
  } else if (added) {
    toast('ok', `已加入 ${added} 张`, '选好格式后点「开始转换」');
  }
}

/** 造一行。文件名/尺寸都是用户数据，一律 textContent，不拼 HTML 串 */
function cvMakeRow(item) {
  const row = document.createElement('div');
  row.className = 'cv-item';
  row.dataset.id = String(item.id);

  const thumb = document.createElement('div');
  thumb.className = 'cv-thumb';
  const img = document.createElement('img');
  img.alt = '';
  img.src = item.thumbUrl;
  thumb.appendChild(img);

  const info = document.createElement('div');
  info.className = 'cv-info';

  const name = document.createElement('div');
  name.className = 'cv-name';
  name.textContent = item.name;
  name.title = item.name;

  const meta = document.createElement('div');
  meta.className = 'cv-meta';

  const out = document.createElement('div');
  out.className = 'cv-out';
  out.hidden = true;

  info.append(name, meta, out);

  const acts = document.createElement('div');
  acts.className = 'cv-acts';

  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'cv-dl';
  dl.textContent = '下载';
  dl.hidden = true;
  dl.addEventListener('click', () => {
    if (item.status === 'done' && item.out) cvSaveBlob(item.out.blob, item.out.name);
  });

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'cv-rm';
  rm.setAttribute('aria-label', '移除');
  rm.title = '移除';
  rm.textContent = '✕';
  rm.addEventListener('click', () => cvRemoveItem(item.id));

  acts.append(dl, rm);
  row.append(thumb, info, acts);

  item.row = row;
  item.metaEl = meta;
  item.outEl = out;
  item.dlBtn = dl;
  return row;
}

/** 刷新一行的显示（改的是已有节点，不重建，免得缩略图闪） */
function cvUpdateRow(item) {
  if (!item.row) return;

  const working = item.status === 'working';
  const done    = item.status === 'done';
  const fail    = item.status === 'fail';

  item.row.classList.toggle('is-working', working);
  item.row.classList.toggle('is-fail', fail);

  // 原图信息：格式 · 体积
  item.metaEl.textContent =
    `${cvLabelOfMime(item.file.type || cvExtOf(item.name))} · ${cvFmtSize(item.size)}`;

  let text = '';
  if (working) {
    text = '转换中…';
  } else if (fail) {
    text = item.error || '转换失败';
  } else if (done && item.out) {
    const o = item.out;
    const bits = [];
    // 尺寸被改过才写出来，没改就不啰嗦
    if (o.w !== o.origW || o.h !== o.origH) bits.push(`${o.w}×${o.h}`);
    bits.push(cvFmtSize(o.size));
    const delta = cvDeltaText(item.size, o.size);
    if (delta) bits.push(delta);
    text = `→ ${cvLabelOfMime(o.mime)} · ${bits.join(' · ')}`;
  }

  item.outEl.textContent = text;
  item.outEl.hidden = !text;
  item.dlBtn.hidden = !done;
  item.dlBtn.disabled = !done;
}

function cvRemoveItem(id) {
  const i = cvItems.findIndex(x => x.id === id);
  if (i < 0) return;
  const [item] = cvItems.splice(i, 1);
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  if (item.row && item.row.parentNode) item.row.parentNode.removeChild(item.row);
  cvSyncListUI();
}

function cvClearAll() {
  cvItems.splice(0).forEach(it => {
    if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  });
  cvList.textContent = '';
  cvDirty = false;
  cvSyncListUI();
}

/** 按钮文案：转过之后又改设置，就说「重新转换」 */
function cvSyncGoBtn() {
  const n = cvItems.length;
  cvGo.disabled = cvBusy || n === 0;
  cvGo.classList.toggle('loading', cvBusy);
  cvGo.textContent = cvBusy ? '转换中…' : (cvDirty ? '重新转换' : '开始转换');
}

function cvSyncListUI() {
  const n = cvItems.length;
  cvListCard.hidden = n === 0;

  const done = cvItems.filter(it => it.status === 'done').length;
  cvCount.textContent = n
    ? `${n} 张图片` + (done ? ` · 已转换 ${done} 张` : '')
    : '';

  // 勾了 ZIP，这个按钮就变成「打包下载」；文案跟着走，别让用户猜
  cvAllBtn.textContent = cvZipOn ? '下载 ZIP' : '全部下载';
  cvAllBtn.disabled = !done;
  cvClearBtn.disabled = cvBusy && n === 0;
  cvSyncGoBtn();
}

/** 设置变了：如果已经有转换结果，就提示需要重转 */
function cvMarkDirty() {
  if (cvItems.some(it => it.status === 'done')) cvDirty = true;
  cvSyncGoBtn();
}

/* ==========================================================
   八、转换
   ========================================================== */
async function cvConvertOne(item) {
  const fmt = cvFormatByMime(cvFormat);

  item.status = 'working';
  item.error = '';
  item.out = null;
  cvUpdateRow(item);

  let dec = null;
  try {
    dec = await cvDecode(item.file);
    if (!dec.w || !dec.h) throw new Error('读不到图片尺寸，文件可能已损坏');

    const size = cvTargetSize(dec.w, dec.h, cvMaxEdge);

    cvCanvas.width = size.w;
    cvCanvas.height = size.h;
    const ctx = cvCanvas.getContext('2d');
    if (!ctx) throw new Error('这个浏览器不支持画布');

    ctx.clearRect(0, 0, size.w, size.h);

    // JPEG 没有透明通道：不铺底，PNG 的透明区会变成黑色
    if (fmt.mime === 'image/jpeg') {
      ctx.fillStyle = cvBgColor;
      ctx.fillRect(0, 0, size.w, size.h);
    }

    ctx.imageSmoothingEnabled = true;
    if (size.scaled) ctx.imageSmoothingQuality = 'high';   // 缩小时抗锯齿
    ctx.drawImage(dec.src, 0, 0, size.w, size.h);

    const blob = await cvCanvasToBlob(cvCanvas, fmt.mime,
                                      fmt.lossy ? cvQuality : undefined);

    item.out = {
      blob,
      name: cvBaseName(item.name) + fmt.ext,
      mime: fmt.mime,
      size: blob.size,
      w: size.w, h: size.h,
      origW: dec.w, origH: dec.h,
    };
    item.status = 'done';
  } catch (err) {
    item.status = 'fail';
    item.error = (err && err.message) || '转换失败';
  } finally {
    if (dec && typeof dec.release === 'function') dec.release();
    cvUpdateRow(item);
  }
}

/** 串行转完整队。一张一张来，避免同时开好几张画布把内存吃爆。 */
async function cvConvertAll() {
  if (cvBusy || !cvItems.length) return;

  cvBusy = true;
  cvDirty = false;
  cvSyncListUI();

  const queue = cvItems.slice();     // 快照：转换途中新加的下一轮再说
  let ok = 0, fail = 0;

  for (const item of queue) {
    if (!cvItems.includes(item)) continue;   // 已经被移除了，跳过
    await cvConvertOne(item);
    if (item.status === 'done') ok++; else fail++;
    cvSyncListUI();
    await cvYield();
  }

  cvBusy = false;
  cvSyncListUI();

  if (fail) {
    toast('err', `完成 ${ok} 张，失败 ${fail} 张`, '失败原因标在对应那一行');
  } else {
    toast('ok', `已转换 ${ok} 张`, '点「下载」保存，或「全部下载」');
  }
}

/* ==========================================================
   九、事件绑定
   ========================================================== */

/* ---- 选文件 ---- */
cvDrop.addEventListener('click', () => cvInput.click());

cvInput.addEventListener('change', () => {
  cvAddFiles(cvInput.files);
  cvInput.value = '';        // 清掉，这样再选同一批文件也会触发 change
});

/* ---- 拖放 ---- */
['dragenter', 'dragover'].forEach(type => {
  cvDrop.addEventListener(type, e => {
    e.preventDefault();
    e.stopPropagation();
    cvDrop.classList.add('is-over');
  });
});
['dragleave', 'dragend', 'drop'].forEach(type => {
  cvDrop.addEventListener(type, e => {
    e.preventDefault();
    e.stopPropagation();
    cvDrop.classList.remove('is-over');
  });
});
cvDrop.addEventListener('drop', e => {
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length) cvAddFiles(dt.files);
});

// 拖到页面别处时别让浏览器直接把图片打开（那样会离开当前页面）
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', e => { e.preventDefault(); });

/* ---- 设置 ---- */
cvQualityEl.addEventListener('input', () => {
  const v = Number(cvQualityEl.value);
  cvQuality = v / 100;
  cvQualityVal.textContent = v + '%';
  cvMarkDirty();
});

cvHexEl.addEventListener('input', cvOnHexInput);
cvHexEl.addEventListener('blur', cvOnHexBlur);
// 回车就当"输完了"，立刻归一并收工
cvHexEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); cvOnHexBlur(); cvHexEl.blur(); }
});

/* ZIP 只影响"怎么把结果给你"，不影响转换本身 —— 所以不标 dirty */
cvZipEl.addEventListener('change', () => {
  cvZipOn = !!cvZipEl.checked;
  cvSyncListUI();
});

/* ---- 操作 ---- */
cvGo.addEventListener('click', () => {
  if (!cvBusy) cvConvertAll();
});

cvClearBtn.addEventListener('click', () => {
  if (cvBusy) return;        // 转着的时候别清，等它转完
  cvClearAll();
});

/* 全部下载：勾了 ZIP 就打包成一个文件，否则逐个另存。
   两条路都在这里收口，用户只需要点同一个按钮。 */
cvAllBtn.addEventListener('click', async () => {
  const done = cvItems.filter(it => it.status === 'done' && it.out);
  if (!done.length) return;

  cvAllBtn.disabled = true;

  try {
    if (cvZipOn) {
      cvAllBtn.textContent = '打包中…';
      const used = new Set();
      const entries = done.map(it => ({
        name: cvZipEntryName(it.out.name, used),
        blob: it.out.blob,
      }));
      const zip = await cvBuildZip(entries);
      cvSaveBlob(zip, cvZipFileName(entries.length));
      toast('ok', `已打包 ${entries.length} 张`, 'ZIP 里就是转换好的图片');
    } else {
      for (const item of done) {
        cvSaveBlob(item.out.blob, item.out.name);
        // 稍微错开一点，一口气触发太密会被浏览器当成可疑行为拦下
        await new Promise(r => setTimeout(r, 320));
      }
      toast('ok', `已开始下载 ${done.length} 张`,
            '浏览器若询问「是否允许下载多个文件」，请选允许');
    }
  } catch (err) {
    toast('err', '打包失败', (err && err.message) || '请稍后重试');
  } finally {
    cvSyncListUI();     // 顺手把按钮文案恢复成「下载 ZIP / 全部下载」
  }
});

/* ---- 换人登录后别把上一位的图片留在页面上 ---- */
document.addEventListener('tool:open', e => {
  if (!e.detail || e.detail.page !== pageConvert) return;
  if (cvOwner !== currentAccount) {
    cvOwner = currentAccount;
    cvClearAll();
  }
});

/* ==========================================================
   十、初始化
   ========================================================== */
(async function cvInit() {
  cvWebpOk = await cvDetectWebp();     // 先测出来再画，免得选项闪一下又消失
  cvRenderFormats();
  cvRenderSizes();
  cvSyncFormatUI();

  // 底色控件：输入框填上当前值，常用色铺好，色块点亮
  cvHexEl.value = cvBgColor;
  cvRenderPresets();
  cvPaintBg();

  cvSyncListUI();
})();
