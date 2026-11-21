# qrterm

在终端里画**能直接扫**的二维码，以及从网页里抓二维码内容的小工具。

为扫码登录这类场景准备：不用弹浏览器窗口，二维码直接画在终端里，手机扫一下就登录。

```bash
$ qrterm 'https://example.com/login?ticket=abc'
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ...   # 白底黑块，深色/浅色终端都能扫
```

## 为什么不用现成的终端二维码库

大多数「终端二维码」是**用前景色字符**拼出来的。遇到深色主题终端，深色模块显示成亮色，整张码就反色了，很多扫码器（尤其国产 App 内置的）直接识别失败。

qrterm 的做法是反过来：**不依赖前景色，逐个模块写死背景色**（深模块黑底、浅模块白底）。于是不管终端是 Dracula 还是 Solarized，扫到的永远是「黑码白底」。`npm test` 会把终端输出反向解析成位图再解码，验证这一点。

## 安装

```bash
git clone https://github.com/Juslist/qrterm.git
cd qrterm
npm install

# 全局可用（可选）
npm link            # 之后任意目录直接 `qrterm '内容'`
```

在其他项目里引用：

```bash
npm install /path/to/qrterm
# 或者直接 copy src/ 目录（核心只依赖 qrcode；抓网页的部分才需要 jsqr + pngjs）
```

## CLI

```bash
qrterm 'https://example.com'                 # 自动按终端能力选模式
echo 'otpauth://totp/...' | qrterm           # 从 stdin 读
qrterm '内容' --mode block                    # 指定模式
qrterm '内容' --title '扫码登录' --clear       # 换码重画时先清屏
qrterm '内容' --ec H --margin 4               # 更高纠错/更大静区
```

| 选项 | 说明 |
|---|---|
| `-m, --mode half\|half256\|block\|chars` | 画法，默认按终端自动选 |
| `--ec L\|M\|Q\|H` | 纠错级别，默认 `M`（内容特别长时可降到 `L` 让码更小） |
| `--margin n` | 静区（模块数），默认 2，**不要低于 2** |
| `--title` | 二维码上方标题 |
| `--clear` | 先清屏再画（配合换码重画） |
| `--no-color` | 纯字符模式 |

## 模式与兼容性

| 模式 | 宽度 | 行数 | 适用 |
|---|---|---|---|
| `half`（默认） | `size+4` ≈ 45 列 | ≈ 一半 | 终端支持真彩色（`COLORTERM=truecolor/24bit`） |
| `half256` | 同上 | 同上 | 只支持 256 色，但仍是逐模块背景色 |
| `block` | ≈ 90 列 | `size+4` | 只支持 16 色的终端 / 日志查看器 |
| `chars` | ≈ 90 列 | `size+4` | 无颜色环境；**深色终端下会反色，慎用** |

自动选择规则：非 TTY、`NO_COLOR`、`TERM=dumb` → `chars`；`COLORTERM` 是真彩色 → `half`；`TERM` 含 256 → `half256`；其余 → `block`。

## API

```js
const qrterm = require('qrterm');

// 画到 stdout
qrterm.print('https://example.com', { mode: 'auto', title: '扫码登录', clear: true });

// 只拿行，自己决定输出到哪
const { lines, mode, size, cols, rows } = qrterm.render('内容', { ecLevel: 'M', margin: 2 });
lines.forEach((line) => console.log(line));

// 手动选模式 / 判断终端能力
qrterm.detectMode({ isTTY: process.stdout.isTTY, env: process.env });
qrterm.widthOf(size, 'half'); // 该模式下会占多少列
```

## 扫码登录配方（Playwright）

```js
const { chromium } = require('playwright');
const qrterm = require('qrterm');
const { readQr } = require('qrterm/src/from-page');

const ctx = await chromium.launchPersistentContext('./profile', { headless: true });
const page = ctx.pages()[0];
await page.goto(LOGIN_URL);

let last = '';
setInterval(async () => {
  for (const frame of page.frames()) {          // 二维码常在 iframe 里
    const hit = await readQr(frame, {
      selectors: ['img[src*="qrcode"]', 'canvas', '.qrcode img'],
    });
    if (hit && hit.data !== last) {             // 换 key 必须重画
      last = hit.data;
      qrterm.print(hit.data, { title: '扫码登录', clear: true });
    }
  }
}, 1500);
```

`readQr` 会先按 `<img src>` 下载原图解码（最清晰），失败再截元素图兜底（canvas / 背景图 / 跨域受限都走这条）。

完整可运行版本见 [`examples/playwright-login.js`](examples/playwright-login.js)：

```bash
LOGIN_URL=https://example.com/login node examples/playwright-login.js
```

## 已经踩过的坑

1. **反色**：只设前景色 = 深色主题下必反。必须逐模块设背景色（本库做法）。
2. **折行**：默认模式 41 模块的码约 45 列；若终端窄于这个宽度，`block`/`chars`（90 列）一定会被折断成两半，扫不出。渲染后打印宽度并检查 `process.stdout.columns`。
3. **静区**：二维码四周至少留 2 个模块白边。贴边画会被识别成「没有定位角」。
4. **换 key 要重画**：扫码登录的二维码通常 2~5 分钟换一次 key，内容一变必须清屏重画，否则用户扫的是旧码。
5. **字体行高**：半块模式依赖字符格子的高宽比（约 2:1）。某些终端行距被改大（>2.2 倍）会让码变长，识别率下降；`block` 模式不受影响但更宽。
6. **tmux/screen**：默认透传 ANSI，通常没问题；如果 tmux 版本老到不支持真彩色，用 `--mode half256` 或 `block`。
7. **截图/重定向**：`chars` 模式写进日志再 `cat` 出来，颜色和排版都可能丢；真要留存证据请存 PNG（`page.screenshot`），别存终端文本。
8. **SSH**：远端 TTY 通常也支持真彩色（`TERM=xterm-256color` + `COLORTERM=truecolor`），不行就降级 `block` or `half256`。

## 自检

```bash
npm test
```

把四种模式渲染出的终端文本反向解析回位图，用 jsQR 解码，逐条比对原文；同时断言静区、宽度、背景色策略。这样换终端、换字体前可以先在本地确认没画错——但**最终能不能扫，仍要用手机实测一次**。

## 依赖

- `qrcode`：生成矩阵（必装）
- `jsqr`、`pngjs`：只有 `from-page`（从网页解码图片）需要，列为 optionalDependencies
- `playwright`：示例需要，不写进依赖，由使用的项目自己提供
