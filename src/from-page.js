/**
 * from-page —— 从网页里抓二维码并解出内容（配合 Playwright 用）。
 *
 * 典型场景：扫码登录。很多站点把二维码放在 iframe 里，且是 <img src=".../qrcode?key=xxx">
 * 或 <canvas>。这里做两件事：
 *   1. 找到二维码元素并从「图片」解出内容（jsQR），而不是靠肉眼看截图；
 *   2. 内容一变（换 key）就回调，调用方负责重新画到终端即可。
 *
 * 依赖：jsqr、pngjs（只在需要解码时用到）
 * 注意：解出来的是「内容」，用任何二维码库重新编码都能被扫，
 *       但 key 通常有时效，所以内容一变必须重画，不能缓存。
 */
'use strict';

const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const DEFAULT_SELECTORS = [
  'img[src*="qrcode"]',
  'img[src*="qr"]',
  'canvas',
  '.qrcode img',
  '.qrcode canvas',
];

function decodePng(buf) {
  const png = PNG.sync.read(buf);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return code && code.data ? code.data : null;
}

async function fetchPng(ctx, src) {
  if (src.startsWith('data:')) return Buffer.from(src.split(',')[1], 'base64');
  const resp = await ctx.request.get(src);
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()} for ${src.slice(0, 80)}`);
  return resp.body();
}

/**
 * 在当前页面/iframe 里解一次二维码。
 * 先直接下原图（最快最清晰），失败再截元素图兜底。
 *
 * @param {import('playwright').Page|import('playwright').Frame} target
 * @param {object} [opts]
 * @param {string[]} [opts.selectors] 候选选择器
 * @param {import('playwright').BrowserContext} [opts.ctx] 用于带 cookie 下载图片，默认 target 所在 context
 * @returns {Promise<{data:string, src:string, selector:string}|null>}
 */
async function readQr(target, opts = {}) {
  const selectors = opts.selectors || DEFAULT_SELECTORS;
  const ctx = opts.ctx || (target.context ? target.context() : target.page().context());

  for (const selector of selectors) {
    const el = await target.$(selector);
    if (!el) continue;

    // 1) 原图：<img src> 直接下载解码
    const src = await el.evaluate((node) => (node.tagName === 'IMG' ? node.src : '')).catch(() => '');
    if (src) {
      try {
        const data = decodePng(await fetchPng(ctx, src));
        if (data) return { data, src, selector };
      } catch { /* 落到截图兜底 */ }
    }

    // 2) 截图兜底：canvas、背景图、跨域受限的 img 都走这里
    try {
      const data = decodePng(await el.screenshot({ type: 'png' }));
      if (data) return { data, src, selector };
    } catch { /* 元素不可见等 */ }
  }
  return null;
}

/**
 * 轮询二维码，内容变化时回调（用于「换码后重画」）。
 *
 * @param {import('playwright').Page|import('playwright').Frame} target
 * @param {object} opts
 * @param {(data:string, meta:{src:string,selector:string}) => void} opts.onData
 * @param {() => Promise<boolean>} [opts.isDone] 返回 true 结束轮询（比如检测到已登录）
 * @param {number} [opts.intervalMs=1500]
 * @param {number} [opts.timeoutMs=900000]
 * @param {string[]} [opts.selectors]
 * @returns {Promise<{reason:'done'|'timeout'|'aborted', last?:string}>}
 */
async function watchQr(target, opts) {
  const {
    onData,
    isDone,
    intervalMs = 1500,
    timeoutMs = 15 * 60 * 1000,
    selectors,
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let last = '';

  while (Date.now() < deadline) {
    if (isDone && (await isDone())) return { reason: 'done', last };
    const hit = await readQr(target, { selectors });
    if (hit && hit.data !== last) {
      last = hit.data;
      onData(hit.data, hit);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { reason: 'timeout', last };
}

module.exports = { readQr, watchQr, decodePng, DEFAULT_SELECTORS };
