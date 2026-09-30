// v2.5.0 冒烟：三态运行（暂停/恢复）
//   1. 假桥把 status 改成「暂停中」：首页大卡要显示「中场休息 / 已暂停」、
//      多出「▶ 继续跑」和「■ 立刻刹车」两个按钮，徽标出「已暂停」
//   2. 日志页要显示「⏸ 已暂停 · 脚本名」和「▶ 恢复」按钮
//   3. 切回运行态：按钮文案变成「⏸ 暂停」，暂停元素全部消失
//   4. JS 在跑（running=false + js=true）：不该出现任何暂停入口（v2.5.0 不暂停 JS）
//   5. 关于页更新日志第一条是 v2.5.0
// 状态驱动方式：改写 window.app.status 再手动触发 window.__on('status')，
// 等价于原生 Bus 推状态过来，不用真起引擎。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const stOf = (over) => JSON.stringify(Object.assign({
  running: false, paused: false, current: 'a1', runName: '每天签到', prog: '3/5',
  acc: true, overlay: true, recording: false, touch: true, ball: true,
  log: [{ t: Date.now(), lv: 0, m: '开跑：每天签到' }, { t: Date.now(), lv: 0, m: '暂停了（音量键短按继续）' }],
  screen: { w: 1080, h: 1920 }, vars: [], js: false
}, over));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const errs = [];
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(MOCK_IIFE);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = n => page.screenshot({ path: `${OUT}/v25-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const dontWant = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (ok) errs.push(at + ' 里不该出现「' + txt + '」');
  };
  // 推一个假状态给前端并刷新
  const push = async (over) => {
    await page.evaluate((json) => {
      window.app.status = () => json;
      window.__on('status', '');
    }, stOf(over));
    await wait(350);
  };
  // 先切到「我的」Tab，再点某个子页
  const goMine = async (k) => {
    await page.evaluate(() => {
      const t = document.querySelector('#tabs button[data-tab="mine"]');
      if (t) t.click();
    });
    await wait(400);
    await page.evaluate((k) => {
      const it = document.querySelector('[data-act="mineGo"][data-k="' + k + '"]');
      if (it) it.click();
    }, k);
    await wait(450);
  };

  await wait(650);

  // 1. 暂停态：首页大卡
  await push({ paused: true, running: false });
  await want('中场休息', '暂停首页大卡');
  await want('已暂停 · 每天签到', '暂停首页大卡');
  await want('▶ 继续跑', '暂停首页按钮');
  await want('■ 立刻刹车', '暂停首页按钮');
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('[data-act="togglePause"]')].length);
  if (btns < 1) errs.push('首页没有 data-act="togglePause" 按钮');
  // 真点一下：链路（call → mock → 无异常）走通就算过，返回值不影响
  await page.evaluate(() => {
    const b = document.querySelector('[data-act="togglePause"]');
    if (b) b.click();
  });
  await wait(300);
  await want('已暂停', '点完暂停按钮状态还在（没炸）');
  const badge = await page.evaluate(() =>
    [...document.querySelectorAll('.badge')].some(b => b.classList.contains('paused')));
  if (!badge) errs.push('首页徽标里没有 .badge.paused（已暂停徽标缺失）');
  await shot('01-home-paused');

  // 2. 暂停态：日志页
  await goMine('log');
  await want('⏸ 已暂停 · 每天签到', '日志页大卡');
  await want('▶ 恢复', '日志页按钮');
  await want('■ 停止', '日志页按钮');
  await want('暂停了（音量键短按继续）', '日志内容');
  await shot('02-log-paused');

  // 3. 切回运行态：按钮文案换向，暂停元素消失
  await push({ paused: false, running: true });
  await want('🏃 正在跑 · 每天签到', '运行态日志页大卡');
  await want('⏸ 暂停', '运行态按钮');
  await dontWant('▶ 恢复', '运行态不该出现恢复按钮');
  await dontWant('中场休息', '运行态不该出现暂停文案');
  await shot('03-log-running');

  // 4. JS 在跑：不出现暂停入口（v2.5.0 不暂停 JS）
  await push({ paused: false, running: false, js: true, runName: '' });
  await want('JS 脚本', 'JS 态提示存在（状态条/页面任一处）');
  await shot('04-log-js');
  await goMine('log');   // 仍在日志页（goMine 幂等），再回首页看大卡
  await page.evaluate(() => {
    const t = document.querySelector('#tabs button[data-tab="scripts"]');
    if (t) t.click();
  });
  await wait(450);
  await dontWant('⏸ 暂停', 'JS 态不该出现暂停按钮');
  await shot('05-home-js');

  // 5. 关于页：更新日志第一条
  await goMine('about');
  const about = await page.evaluate(() => document.body.innerText);
  if (!about.includes('v2.5.0')) errs.push('关于页的更新日志第一条不是 v2.5.0');
  if (!about.includes('v2.4.0')) errs.push('更新日志丢了 v2.4.0 条目');
  await shot('06-about-changelog');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.5.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v2.5.0 三态冒烟通过（6 张截图）');
})();
