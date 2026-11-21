#!/usr/bin/env node
/**
 * 示例：扫码登录时，把网页里的二维码直接画在终端，手机扫一扫完成登录。
 *
 * 用法（需要 playwright + 已下载 chromium）：
 *   LOGIN_URL=https://example.com/login node examples/playwright-login.js
 *
 * 换成自己的站点时只需要改三处：
 *   1. START_URL
 *   2. isLoggedIn() 的判定（登录成功后页面长什么样）
 *   3. qrSelectors（二维码元素长什么样，默认已覆盖常见的 img[src*=qrcode] / canvas）
 */
'use strict';

const { chromium } = require('playwright');
const qrterm = require('../src/qrterm');
const { readQr } = require('../src/from-page');

const START_URL = process.env.LOGIN_URL || 'https://example.com/login';
const PROFILE_DIR = process.env.PROFILE_DIR || undefined; // 传了就复用登录态
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15 * 60 * 1000);

// 二维码可能有多种长相，按顺序尝试
const QR_SELECTORS = [
  'img[src*="qrcode"]',
  'img[src*="qr"]',
  'canvas',
  '.qrcode img',
  '#qrcode img',
];

/** 登录成功的判定：二维码消失 + 页面出现已登录特征 */
function isLoggedIn(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    return /退出|退出登录|个人中心|Dashboard|Sign out/i.test(text);
  });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR || '', {
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // Ctrl+C 时干净退出，不留 chromium 进程
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      stopping = true;
      try { await ctx.close(); } catch {}
      process.exit(130);
    });
  }
  process.on('unhandledRejection', (e) => {
    if (!stopping) { console.error(e); process.exit(1); }
  });

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // 给登录框/iframe 一点渲染时间

  if (await isLoggedIn(page)) {
    console.log('登录态仍然有效，无需扫码。');
    await ctx.close();
    return;
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let last = '';
  let printedAt = 0;

  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) break;

    // 二维码可能在 iframe 里：逐个 frame 试
    let hit = null;
    for (const frame of page.frames()) {
      try {
        hit = await readQr(frame, { selectors: QR_SELECTORS });
      } catch { /* frame 正在导航 */ }
      if (hit) break;
    }

    if (hit && (hit.data !== last || Date.now() - printedAt > 120_000)) {
      qrterm.print(hit.data, {
        mode: process.env.QR_MODE || 'auto',
        title: hit.data === last ? '二维码已刷新，请重新扫码' : '扫码登录',
        clear: true,
      });
      last = hit.data;
      printedAt = Date.now();
      console.log(`  ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 等待扫码…（过期会自动重画）`);
    }

    await page.waitForTimeout(1500);
  }

  if (!(await isLoggedIn(page))) {
    console.error('\n超时：没有完成扫码登录。');
    await ctx.close();
    process.exit(1);
  }

  console.log('\n扫码成功，登录态已保存在浏览器上下文里。');
  await page.waitForTimeout(5000); // 让 cookie 落盘
  await ctx.close();
})();
