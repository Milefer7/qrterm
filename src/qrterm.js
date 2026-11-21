/**
 * qrterm —— 在终端里画二维码（可直接扫的那种）。
 *
 * 核心约束只有一条：二维码的「深色模块」必须真的显示成深色。
 * 终端主题千差万别，所以这里不依赖前景色，而是把每个模块的背景色写死：
 *   深模块 = 黑底，浅模块 = 白底 → 无论终端是深色还是浅色主题，都是黑码白底。
 * 这是很多「终端二维码」库扫不出来的根本原因（它们用前景字符画，遇到深色主题就反色了）。
 *
 * 依赖：qrcode（只用来生成矩阵，不负责绘制）
 */
'use strict';

const QRCode = require('qrcode');

const DEFAULT_MARGIN = 2; // 静区，单位=模块
const MODES = ['half', 'half256', 'block', 'chars'];

/* ---------------- 矩阵 ---------------- */

/**
 * @param {string} text
 * @param {{ecLevel?: 'L'|'M'|'Q'|'H'}} [opts]
 * @returns {{size:number, get:(x:number,y:number)=>boolean}}
 */
function matrix(text, opts = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: opts.ecLevel || 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return { size, get: (x, y) => !!data[y * size + x] };
}

/* ---------------- 三种画法 ---------------- */

/**
 * 半块模式：一个字符承载上下两个模块（▀ 的上半=前景色，下半=背景色）。
 * 横向 1 字符/模块、纵向 1 行/2 模块，正方形不被拉变形；
 * 41 模块的码约 45 列 × 21 行，80 列终端刚好塞下，是目前最好用的默认值。
 */
function renderHalf(m, { margin = DEFAULT_MARGIN, truecolor = true } = {}) {
  const { size } = m;
  const cell = (x, y) => x >= 0 && y >= 0 && x < size && y < size && m.get(x, y);
  const fg = (dark) => (truecolor
    ? (dark ? '\x1b[38;2;0;0;0m' : '\x1b[38;2;255;255;255m')
    : (dark ? '\x1b[38;5;16m' : '\x1b[38;5;231m'));
  const bg = (dark) => (truecolor
    ? (dark ? '\x1b[48;2;0;0;0m' : '\x1b[48;2;255;255;255m')
    : (dark ? '\x1b[48;5;16m' : '\x1b[48;5;231m'));

  const lines = [];
  for (let y = -margin; y < size + margin; y += 2) {
    let line = '';
    for (let x = -margin; x < size + margin; x++) {
      line += fg(cell(x, y)) + bg(cell(x, y + 1)) + '\u2580';
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}

/**
 * 十六色块模式：每个模块 2 个空格宽，靠 40/47 背景色区分。
 * 只用到最基础的 SGR，任何终端/日志查看器都能正确显示；代价是宽度翻倍（约 90 列）。
 */
function renderBlock(m, { margin = DEFAULT_MARGIN } = {}) {
  const { size } = m;
  const cell = (x, y) => x >= 0 && y >= 0 && x < size && y < size && m.get(x, y);
  const lines = [];
  for (let y = -margin; y < size + margin; y++) {
    let line = '';
    for (let x = -margin; x < size + margin; x++) {
      line += (cell(x, y) ? '\x1b[40m' : '\x1b[47m') + '  ';
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}

/**
 * 纯字符模式：没有颜色，深模块画 ██，浅模块留空。
 * 只适合浅色背景终端（深色终端会变成反色码，部分扫码器不认），
 * 主要用于输出被重定向到文件/日志、或终端明确不支持颜色时。
 */
function renderChars(m, { margin = DEFAULT_MARGIN } = {}) {
  const { size } = m;
  const cell = (x, y) => x >= 0 && y >= 0 && x < size && y < size && m.get(x, y);
  const lines = [];
  for (let y = -margin; y < size + margin; y++) {
    let line = '';
    for (let x = -margin; x < size + margin; x++) line += cell(x, y) ? '\u2588\u2588' : '  ';
    lines.push(line);
  }
  return lines;
}

/* ---------------- 自动选模式 ---------------- */

/**
 * 按终端能力挑模式：
 *   非 TTY / NO_COLOR / TERM=dumb   → chars
 *   COLORTERM=truecolor|24bit       → half（真彩色）
 *   TERM 含 256                     → half256
 *   其余                            → block（最保守）
 */
function detectMode({ isTTY, env = {} } = {}) {
  if (!isTTY || env.NO_COLOR || env.TERM === 'dumb') return 'chars';
  const ct = String(env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'half';
  if (/256/.test(String(env.TERM || ''))) return 'half256';
  return 'block';
}

/** 该模式下二维码会占多少列（含静区） */
function widthOf(size, mode, margin = DEFAULT_MARGIN) {
  const modules = size + margin * 2;
  return mode === 'half' || mode === 'half256' ? modules : modules * 2;
}

/**
 * 渲染成若干行字符串。
 * @param {string} text 二维码内容
 * @param {object} [opts]
 * @param {'auto'|'half'|'half256'|'block'|'chars'} [opts.mode='auto']
 * @param {number} [opts.margin=2] 静区（模块数），小于 2 容易扫不出
 * @param {'L'|'M'|'Q'|'H'} [opts.ecLevel='M'] 纠错级别
 * @param {boolean} [opts.color=true] false 等价于 mode='chars'
 * @param {boolean} [opts.isTTY] 仅在 mode='auto' 时用；默认取 process.stdout.isTTY
 * @param {object} [opts.env] 仅在 mode='auto' 时用；默认取 process.env
 * @returns {{lines:string[], mode:string, size:number, cols:number, rows:number}}
 */
function render(text, opts = {}) {
  const {
    margin = DEFAULT_MARGIN,
    ecLevel = 'M',
    color = true,
    isTTY = process.stdout.isTTY,
    env = process.env,
  } = opts;

  let mode = opts.mode || 'auto';
  if (!color) mode = 'chars';
  if (mode === 'auto') mode = detectMode({ isTTY, env });
  if (!MODES.includes(mode)) throw new TypeError(`unknown mode: ${mode}`);

  const m = matrix(text, { ecLevel });
  const lines = mode === 'half' ? renderHalf(m, { margin, truecolor: true })
    : mode === 'half256' ? renderHalf(m, { margin, truecolor: false })
    : mode === 'block' ? renderBlock(m, { margin })
    : renderChars(m, { margin });

  return {
    lines,
    mode,
    size: m.size,
    cols: widthOf(m.size, mode, margin),
    rows: lines.length,
  };
}

/**
 * 直接打到 stdout（或指定 stream），可选清屏。
 * @param {string} text
 * @param {object} [opts] render 的选项 + {stream, clear, title, indent}
 */
function print(text, opts = {}) {
  const { stream = process.stdout, clear = false, title, indent = '  ' } = opts;
  const out = render(text, opts);
  if (clear && stream.isTTY) stream.write('\x1b[2J\x1b[H');
  if (title) stream.write('\n' + indent + title + '\n\n');
  for (const line of out.lines) stream.write(indent + line + '\n');
  stream.write('\n');
  return out;
}

module.exports = { matrix, render, print, detectMode, widthOf, MODES, DEFAULT_MARGIN };
