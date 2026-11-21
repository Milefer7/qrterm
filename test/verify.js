/**
 * 自检：把 qrterm 画出来的「终端输出」反向解析成位图，再用 jsQR 解码，
 * 断言内容与原文完全一致 —— 等价于「这个码真的能被扫出来」。
 *
 * 覆盖：
 *   - 四种模式（half / half256 / block / chars）的极性与模块对齐
 *   - 静区是否真的存在（少一圈静区会显著降低识别率）
 *   - 每个模块都自带背景色（不依赖终端前景色 / 主题）
 *   - 宽度断言（80 列终端能否直接显示）
 */
'use strict';

const assert = require('assert');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const qrterm = require('../src/qrterm');

const SAMPLES = [
  'https://open.work.weixin.qq.com/wwopen/login/h5?key=2edec670b8e85485&bar_style_type=2',
  'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example',
  '短内容',
  'x'.repeat(300), // 逼出更高的版本，检验宽度自适应
];

/* ---------- 把终端输出还原成 0/1 矩阵 ---------- */

function toMatrix(mode, lines, margin) {
  const rows = [];
  if (mode === 'half' || mode === 'half256') {
    const re = /\x1b\[38;(?:2;(\d+);\d+;\d+|5;(\d+))m\x1b\[48;(?:2;(\d+);\d+;\d+|5;(\d+))m\u2580/g;
    for (const line of lines) {
      const cells = [...line.matchAll(re)];
      assert.strictEqual(cells.length, line.match(/\u2580/g).length, '每个 ▀ 都应解析到一组颜色');
      const top = cells.map((c) => (c[1] !== undefined ? Number(c[1]) < 128 : Number(c[2]) < 128));
      const bottom = cells.map((c) => (c[3] !== undefined ? Number(c[3]) < 128 : Number(c[4]) < 128));
      rows.push(top, bottom);
    }
    return rows;
  }

  const re = mode === 'block' ? /\x1b\[(4[07])m  /g : /\u2588\u2588|  /g;
  for (const line of lines) {
    const cells = [...line.matchAll(re)].map((c) => (mode === 'block' ? Number(c[1]) === 40 : c[0] === '\u2588\u2588'));
    // block/chars 一个单元格 2 字符宽，横向复制成 2 个模块保持正方形
    rows.push(cells.flatMap((d) => [d, d]));
  }
  return rows;
}

function decode(rows, scale = 4) {
  const h = rows.length * scale;
  const w = rows[0].length * scale;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = rows[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
      const i = (w * y + x) << 2;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  const code = jsQR(new Uint8ClampedArray(png.data), w, h);
  return code && code.data;
}

/* ---------- 用例 ---------- */

let pass = 0;
const check = (name, fn) => {
  fn();
  pass++;
  console.log('  ✓ ' + name);
};

for (const mode of qrterm.MODES) {
  for (const text of SAMPLES) {
    const out = qrterm.render(text, { mode, margin: 2 });
    const rows = toMatrix(mode, out.lines, 2);
    const got = decode(rows);

    check(`${mode} ${text.slice(0, 24)}… 解码一致`, () => {
      assert.strictEqual(got, text, `解码结果不一致: ${got && got.slice(0, 60)}`);
      const expectedRows = mode === 'half' || mode === 'half256'
        ? Math.ceil((out.size + 4) / 2) * 2   // 半块按两行一组，可能多出 1 行静区
        : out.size + 4;
      assert.strictEqual(rows.length, expectedRows, '行数应为 模块数 + 2*静区');
    });
  }
}

check('default 模式在 80 列终端不折行', () => {
  const out = qrterm.render(SAMPLES[0], { mode: 'half' });
  assert.ok(out.cols <= 80, `默认模式宽 ${out.cols} 列，超过 80`);
});

check('每个模块都显式设置背景色（不依赖终端主题）', () => {
  const half = qrterm.render(SAMPLES[0], { mode: 'half' }).lines.join('');
  const block = qrterm.render(SAMPLES[0], { mode: 'block' }).lines.join('');
  assert.ok(!/\x1b\[38m/.test(half) && /48;2;/.test(half), 'half 必须逐个模块设置背景色');
  assert.ok(/48;5;/.test(qrterm.render(SAMPLES[0], { mode: 'half256' }).lines.join('')), 'half256 应使用 256 色背景');
  assert.ok(!/\x1b\[3[0-7]m/.test(block), 'block 不应依赖前景色');
});

check('静区可配置，且 ≥2', () => {
  const a = qrterm.render('abc', { mode: 'half', margin: 2 });
  const b = qrterm.render('abc', { mode: 'half', margin: 4 });
  assert.strictEqual(b.cols - a.cols, 4);
  assert.strictEqual(b.rows - a.rows, 2);
});

check('detectMode 按终端能力降级', () => {
  assert.strictEqual(qrterm.detectMode({ isTTY: false }), 'chars');
  assert.strictEqual(qrterm.detectMode({ isTTY: true, env: { TERM: 'dumb' } }), 'chars');
  assert.strictEqual(qrterm.detectMode({ isTTY: true, env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' } }), 'half');
  assert.strictEqual(qrterm.detectMode({ isTTY: true, env: { TERM: 'xterm-256color' } }), 'half256');
  assert.strictEqual(qrterm.detectMode({ isTTY: true, env: { TERM: 'xterm' } }), 'block');
});

check('print 返回尺寸信息', () => {
  const out = qrterm.print('https://example.com', { stream: { write() {}, isTTY: false }, mode: 'chars' });
  assert.ok(out.cols > 0 && out.rows > 0 && out.size > 0);
});

console.log(`\n${pass} 项全部通过`);
