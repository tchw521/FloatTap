// v4.3.0 冒烟：录制三态弹层（准备 → 录制中：计时+计数轮询 → 停止落列表）+ 拖拽排序实证
//   A.（node 侧）源码守卫：app.js 的 sheetRec/两态/计时/轮询/接线 + style.css 录制态 + CHANGELOG 头条 + 拖拽核心
//   B.（浏览器；mock 注入）：
//      1. 录制页点「⏺ 开始录制」→ 弹层准备态（说明 + 取消/开始录制），引擎未开跑
//      2. 点「开始录制」→ 录制中态：红点脉冲、计时走表、已记录 3 个动作（轮询 mock recording()）
//      3. 点「■ 停止录制」→ 弹层关、录制页列表「共 3 步」、动作卡落位
//      4. 编辑器动作时间线 ⋮⋮ 拖柄拖拽换位（pointer 事件实测，顺序真的换）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { MOCK_IIFE } = require('./mock.js');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const errs = [];

// ---------- A. 源码守卫 ----------
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('assets/www/app.js');
const cssSrc = read('assets/www/style.css');
const need = [
  ['app.js', appSrc, 'function sheetRec'],
  ['app.js', appSrc, 'id="recReady"'],
  ['app.js', appSrc, 'id="recRun"'],
  ['app.js', appSrc, 'function recTick'],
  ['app.js', appSrc, 'function recPoll'],
  ['app.js', appSrc, 'function recStartUi'],
  ['app.js', appSrc, 'function recStopUi'],
  ['app.js', appSrc, 'data-act="recGo"'],
  ['app.js', appSrc, 'data-act="recStopBtn"'],
  ['app.js', appSrc, 'data-act="recCancel"'],
  ['app.js', appSrc, '已记录'],
  ['app.js', appSrc, '录制三态弹层'],
  ['app.js', appSrc, 'v4.3.0</div>'],
  ['app.js', appSrc, 'function startDrag'],      // 拖拽排序（历史落地，本版钉住）
  ['app.js', appSrc, 'data-list="acts"'],
  ['style.css', cssSrc, '.rec-dot{'],
  ['style.css', cssSrc, '.rec-time{'],
  ['style.css', cssSrc, '.btn.rec-stop{'],
  ['style.css', cssSrc, '@keyframes recPulse']
];
for (const [f, src, s] of need) {
  if (!src.includes(s)) errs.push(f + ' 缺关键代码: ' + s);
}
if (appSrc.includes('recStart\'')); // 录制桥命令拼写只此一处：jcall('recording')
if (!appSrc.includes("jcall('recording')")) errs.push('app.js 缺实时轮询读数: jcall(recording)');

let seq = 0;   // 截图序号（模块级，收尾日志要用）
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const wait = ms => new Promise(r2 => setTimeout(r2, ms));
  const openApp = async flags => {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(MOCK_IIFE);
    // mock 覆盖要预置在页面脚本前（boot 首次 status() 就生效），学 v32 的做法
    await page.evaluateOnNewDocument(f => { Object.assign(window, f); }, flags || {});
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
    await wait(1100);
    return page;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v35-${String(++seq).padStart(2, '0')}-${n}.png` });
  let seq = 0;
  const clickEl = async (page, sel) => {
    const ok = await page.evaluate(s => {
      const e = document.querySelector(s);
      if (!e) return false;
      e.click(); return true;
    }, sel);
    if (!ok) errs.push('找不到元素: ' + sel);
    await wait(350);
  };
  const goRecord = async page => {
    await clickEl(page, '#tabs button[data-tab="record"]');
    await wait(250);
  };

  // 1. 准备态弹层（__mockRec=false：没在录，点开始应弹层而非直接开跑）
  let p = await openApp({ __mockRec: false });
  await goRecord(p);
  const heroTxt = await p.evaluate(() => document.querySelector('.hero .ht').textContent);
  if (heroTxt.includes('正在录制')) errs.push('场景1：__mockRec=false 时 hero 不应显示正在录制');
  await clickEl(p, '[data-act="rec"]');
  const st1 = await p.evaluate(() => ({
    ready: !!document.getElementById('recReady'),
    readyShown: document.getElementById('recReady') && document.getElementById('recReady').style.display !== 'none',
    runHidden: document.getElementById('recRun') && document.getElementById('recRun').style.display === 'none',
    tips: document.getElementById('recReady') ? document.getElementById('recReady').textContent : '',
    goBtn: !!document.querySelector('[data-act="recGo"]')
  }));
  if (!st1.ready || !st1.readyShown) errs.push('场景1：准备态应显示');
  if (!st1.runHidden) errs.push('场景1：录制中态应隐藏');
  if (!st1.tips.includes('点哪里记哪里') || !st1.tips.includes('撤销上一步')) errs.push('场景1：准备态说明缺关键词');
  if (!st1.goBtn) errs.push('场景1：缺「开始录制」按钮');
  await shot(p, 'rec-ready');
  await p.close();

  // 2. 录制中态：红点 + 计时 + 计数轮询（mock recording() 固定 3 条）
  p = await openApp({ __mockRec: false });
  await goRecord(p);
  await clickEl(p, '[data-act="rec"]');
  await clickEl(p, '[data-act="recGo"]');
  await wait(1300);                       // 让计时至少走到 00:01，轮询至少跑一轮
  const st2 = await p.evaluate(() => ({
    readyHidden: document.getElementById('recReady').style.display === 'none',
    runShown: document.getElementById('recRun').style.display !== 'none',
    dot: !!document.querySelector('#recRun .rec-dot'),
    time: document.getElementById('recTime').textContent,
    cnt: document.getElementById('recCnt').textContent,
    stopBtn: !!document.querySelector('[data-act="recStopBtn"]')
  }));
  if (!st2.readyHidden || !st2.runShown) errs.push('场景2：未切到录制中态');
  if (!st2.dot) errs.push('场景2：缺红点脉冲');
  if (!/00:0[12]/.test(st2.time)) errs.push('场景2：计时应为 00:01 左右，实际 ' + st2.time);
  if (st2.cnt !== '3') errs.push('场景2：已记录应为 3（轮询 mock recording()），实际 ' + st2.cnt);
  if (!st2.stopBtn) errs.push('场景2：缺停止按钮');
  await shot(p, 'rec-running');
  await p.close();

  // 3. 停止落列表：弹层关 + 录制页「共 3 步」+ 动作卡
  p = await openApp({ __mockRec: false });
  await goRecord(p);
  await clickEl(p, '[data-act="rec"]');
  await clickEl(p, '[data-act="recGo"]');
  await wait(300);
  await clickEl(p, '[data-act="recStopBtn"]');
  await wait(800);                        // recStopUi 里 500ms 后才 loadRec
  const st3 = await p.evaluate(() => ({
    closed: document.getElementById('modal').classList.contains('hidden'),
    body: document.body.innerText,
    items: document.querySelectorAll('#page .item').length
  }));
  if (!st3.closed) errs.push('场景3：停止后弹层应关闭');
  if (!st3.body.includes('共 3 步')) errs.push('场景3：录制页应显示共 3 步');
  if (!st3.body.includes('1. 点击') || !st3.body.includes('2. 滑动')) errs.push('场景3：动作卡应落列表（1. 点击 / 2. 滑动）');
  if (st3.items < 3) errs.push('场景3：列表动作卡应 ≥3 张，实际 ' + st3.items);
  await shot(p, 'rec-stopped-list');
  await p.close();

  // 4. 拖拽换位实证：编辑器动作时间线 ⋮⋮ 拖柄，pointer 三件套拖第 0 项到第 1 位（a4 有 3 个动作）
  p = await openApp();
  await clickEl(p, '[data-act="edit"][data-id="a4"]');
  await wait(250);
  const before = await p.evaluate(() =>
    [...document.querySelectorAll('#page .item .t')].map(x => x.textContent.trim()).slice(0, 4));
  const dragged = await p.evaluate(() => {
    const grip = document.querySelector('.grip[data-list="acts"]');
    if (!grip) return 'no-grip';
    const r = grip.getBoundingClientRect();
    const y0 = r.y + r.height / 2;
    grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.x + 8, clientY: y0, bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.x + 8, clientY: y0 + 120, bubbles: true, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: r.x + 8, clientY: y0 + 120, bubbles: true, pointerId: 1 }));
    return 'ok';
  });
  await wait(400);
  if (dragged !== 'ok') errs.push('场景4：找不到动作拖柄（grip）');
  else {
    const after = await p.evaluate(() =>
      [...document.querySelectorAll('#page .item .t')].map(x => x.textContent.trim()).slice(0, 4));
    if (JSON.stringify(before) === JSON.stringify(after)) {
      errs.push('场景4：拖拽后动作顺序未变 | 前=' + before.join('|') + ' 后=' + after.join('|'));
    }
  }
  await shot(p, 'drag-sorted');
  await p.close();

  await browser.close();
  process.exitCode = errs.length ? 1 : 0;
  const tag = errs.length ? 'FAIL' : 'OK';
  console.log('[v35] ' + tag + ' (' + seq + ' 张截图)');
  for (const e of errs) console.log('  - ' + e);
})().catch(e => { console.error('[v35] EXC ' + (e && e.message)); process.exitCode = 1; });
