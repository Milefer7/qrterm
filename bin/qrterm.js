#!/usr/bin/env node
/**
 * CLI: qrterm [text] [--mode half|half256|block|chars] [--ec M] [--margin 2] [--clear] [--title T]
 * 不带 text 时从 stdin 读（方便管道： echo URL | qrterm）。
 */
const qrterm = require('../src/qrterm');

const argv = process.argv.slice(2);
const opts = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--mode' || a === '-m') opts.mode = argv[++i];
  else if (a === '--ec') opts.ecLevel = argv[++i];
  else if (a === '--margin') opts.margin = Number(argv[++i]);
  else if (a === '--title') opts.title = argv[++i];
  else if (a === '--clear') opts.clear = true;
  else if (a === '--no-color') opts.color = false;
  else if (a === '-h' || a === '--help') {
    console.log(`用法: qrterm [内容] [选项]

  -m, --mode <half|half256|block|chars>  默认按终端能力自动选
      --ec <L|M|Q|H>                     纠错级别，默认 M
      --margin <n>                       静区模块数，默认 2（别低于 2）
      --title <文字>                     二维码上方的标题
      --clear                            先清屏再画（换码重画时用）
      --no-color                         纯字符模式
  -h, --help                             帮助

不带内容时从 stdin 读，例如： echo 'https://example.com' | qrterm`);
    process.exit(0);
  } else words.push(a);
}

const main = (text) => {
  const data = String(text).trim();
  if (!data) {
    console.error('qrterm: 没有内容可编码');
    process.exit(1);
  }
  const out = qrterm.print(data, opts);
  console.error(`[qrterm] mode=${out.mode} size=${out.size} ${out.cols}列 x ${out.rows}行`);
};

if (words.length) main(words.join(' '));
else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', () => main(buf));
}
