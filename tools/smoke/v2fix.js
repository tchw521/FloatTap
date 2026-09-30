// v2.0.0 修复项回归：图色默认百分比 / 条件子页的插入变量与试算 / 条件改动可撤销
// 每段独立：开头先把弹层关干净，选择器一律限定在 #sheet 内，避免跨段状态串味
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

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
  const shot = n => page.screenshot({ path: `${OUT}/v20f-${n}.png` });

  /** 只在弹层里点，避免误点到页面上的同名按钮 */
  const inSheet = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const e = [...document.querySelectorAll('#sheet ' + sel)]
        .find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('弹层里找不到: ' + sel + ' / ' + txt);
    await wait(380);
  };
  const closeSheet = async () => {
    await page.evaluate(() => {
      const m = document.getElementById('modal');
      if (m && !m.classList.contains('hidden')) {
        const b = [...document.querySelectorAll('#sheet [data-act="cancelAct"]')][0];
        if (b) b.click();
        else m.classList.add('hidden');
      }
    });
    await wait(300);
  };
  const newAct = async name => {
    await page.evaluate(() => { const b = document.querySelector('button[data-act="addAct"]'); if (b) b.click(); });
    await wait(380);
    await page.evaluate(n => {
      const e = [...document.querySelectorAll('#sheet .tile')].find(x => x.textContent.includes(n));
      if (e) e.click();
    }, name);
    await wait(380);
  };
  const storedCond = () => page.evaluate(() => {
    const a = JSON.parse(window.app.scripts())[0].actions;
    for (let i = a.length - 1; i >= 0; i--) if (a[i].t === 'cond') return a[i];
    return null;
  });

  await wait(600);
  if (!(await page.evaluate(() => !!window.app))) { console.log('❌ 假桥没注入'); await browser.close(); process.exit(1); }
  await page.evaluate(() => {
    const e = [...document.querySelectorAll('.item .grow')].find(x => x.textContent.includes('每天签到'));
    if (e) e.click();
  });
  await wait(400);

  const baseCount = await page.evaluate(() => JSON.parse(window.app.scripts())[0].actions.length);

  // ===== 修复1：新建「找色」动作，区域默认按百分比（全屏）=====
  await newAct('找色');
  let pct = await page.evaluate(() => {
    const sw = document.querySelector('#sheet [data-field="pct"]');
    return sw ? sw.classList.contains('on') : null;
  });
  if (pct !== true) errs.push('新建「找色」pct 默认没开（会在左上角 100px 里找）');
  await shot('01-findcolor-pct');
  await closeSheet();

  // ===== 修复2：条件子页里「插入变量」和「试算」要能用 =====
  await newAct('条件判断');
  await inSheet('.row .btn', '表达式成立');
  await inSheet('.conditem .btn', '改');
  const inSub = await page.evaluate(() => !!document.querySelector('#sheet [data-cfield="v"]'));
  if (!inSub) errs.push('没进条件子页');
  await shot('02-cond-subpage');

  await inSheet('.btn', '插入变量');
  const hasMenu = await page.evaluate(() => !!document.getElementById('varmenu'));
  if (!hasMenu) errs.push('条件子页「插入变量」没展开菜单');
  await shot('03-insvar-menu');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#varmenu .btn')]
      .find(x => (x.dataset.v || '').indexOf('{{') === 0);
    if (b) b.click();
  });
  await wait(380);
  const v1 = await page.evaluate(() => {
    const i = document.querySelector('#sheet [data-cfield="v"]');
    return i ? i.value : null;
  });
  if (!v1 || v1.indexOf('{{') < 0) errs.push('条件子页插入变量没写进输入框，实际 ' + JSON.stringify(v1));
  await shot('04-insvar-done');

  await page.evaluate(() => {
    const i = document.querySelector('#sheet [data-cfield="v"]');
    if (i) { i.value = '3>2'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await inSheet('.btn', '试算');
  const tt = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  if (!/算出来是/.test(tt)) errs.push('条件子页「试算」没结果，toast=' + tt);
  await shot('05-tryexpr');

  // ===== 修复3：条件子页的改动，点「取消」要丢掉（新建动作落盘是 v1.x 既有行为）=====
  await inSheet('.btn', '确定');
  await inSheet('.row .btn', '随机概率');       // 再加一条，也不该落盘
  await closeSheet();                            // 取消整个动作编辑
  // 取消应该是「完全撤销」：新建的动作整个删掉，不留痕迹
  const cond1 = await storedCond();
  if (cond1) errs.push('取消后 cond 动作还留着（应整个撤销），cs=' + JSON.stringify(cond1.cs));
  const nAct = await page.evaluate(() => JSON.parse(window.app.scripts())[0].actions.length);
  if (nAct !== baseCount) errs.push('取消后动作数没回到原样：' + baseCount + ' → ' + nAct);
  await shot('06-cancel-revert');

  // ===== 修复4：新建颜色条件默认百分比，且保存后能留住 =====
  await newAct('条件判断');
  await inSheet('.row .btn', '屏幕上有颜色');
  await inSheet('.conditem .btn', '改');
  let cpct = await page.evaluate(() => {
    const sw = document.querySelector('#sheet [data-cfield="pct"]');
    return sw ? sw.classList.contains('on') : null;
  });
  if (cpct !== true) errs.push('新建颜色条件 pct 默认没开（会只在左上角找）');
  await shot('07-cond-color-pct');

  await inSheet('.btn', '确定');
  await inSheet('.btn', '保存');
  const cond2 = await storedCond();
  const c0 = cond2 && cond2.cs && cond2.cs[0];
  if (!c0) errs.push('颜色条件没存下来');
  else {
    if (c0.k !== 'color') errs.push('存的条件类型不对：' + c0.k);
    if (c0.pct !== 1) errs.push('颜色条件保存后 pct 丢了，实际 ' + c0.pct);
  }
  await shot('08-saved');

  await browser.close();
  if (errs.length) {
    console.log('❌ 修复项回归有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.0.0 修复项回归通过：找色默认全屏百分比 / 条件子页插变量+试算 / 取消可撤销 / 颜色条件默认百分比且能存住，共 8 张截图');
})();
