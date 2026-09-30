// v2.0.1 修复项回归：rep 开关落盘成数字 / 第一个条件取色回对页 / 恶意 icon 不注入 HTML
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

// 第 3 段用：icon 和 tone 里夹带 HTML，脚本名和备注是正常的
const EVIL = [{
  id: 'evil', name: '带恶意图标的脚本', desc: 'icon 里塞了 onerror',
  icon: '<img src=x onerror="window.__pwned=1">',
  tone: '1" onmouseover="window.__pwned=1"',
  actions: [{ t: 'click', x: 50, y: 50, pct: 1, d: 100 }]
}];

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
  const shot = n => page.screenshot({ path: `${OUT}/v21f-${n}.png` });
  await wait(600);

  // 只在弹层里点，避免误点到页面上的同名按钮
  const inSheet = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const e = [...document.querySelectorAll('#sheet ' + sel)]
        .find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('弹层里找不到: ' + sel + ' / ' + txt);
    await wait(400);
  };
  const closeSheet = async () => {
    await page.evaluate(() => {
      const m = document.getElementById('modal');
      if (m) m.classList.add('hidden');
    });
    await wait(250);
  };
  const storedCond = () => page.evaluate(() => {
    const s = JSON.parse(window.app.scripts())[0];
    return s.actions.find(a => a.t === 'cond') || null;
  });

  // ===== 1. 重复检查 rep 要落盘成数字 1，不能是布尔 =====
  await page.evaluate(() => {
    document.querySelectorAll('.list .item')[0].querySelector('[data-act="edit"]').click();
  });
  await wait(420);
  await page.evaluate(() => {
    document.querySelector('button[data-act="addAct"]').click();
  });
  await wait(420);
  await inSheet('.tile', '条件判断');          // 动作类型是 .tile
  const hasRep = await page.evaluate(() => !!document.querySelector('#sheet [data-field="rep"]'));
  if (!hasRep) errs.push('条件表单里没有「重复检查」开关');
  await page.evaluate(() => {
    const sw = document.querySelector('#sheet [data-field="rep"]');
    if (sw && !sw.classList.contains('on')) sw.click();
  });
  await wait(300);
  await shot('01-rep-on');
  await inSheet('.btn', '保存');
  const c1 = await storedCond();
  if (!c1) errs.push('没存下 cond 动作');
  else if (c1.rep !== 1) {
    errs.push('rep 没落盘成数字 1，实际 ' + JSON.stringify(c1.rep)
      + '（布尔会让 Java 端 optInt 读成 0，重复检查等于没开）');
  }

  // ===== 2. 第一个条件（序号 0）取色后要回条件子页 =====
  //      sub=0 是假值，以前会跳回动作主表单，取到的颜色和子页里改的东西全丢
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-act="editAct"]')]
      .find(x => (x.textContent || '').includes('条件'));
    if (r) r.click();
  });
  await wait(420);
  await inSheet('.row .btn', '屏幕上有颜色');    // 加第一个条件
  await inSheet('.conditem .btn', '改');         // 进序号 0 的条件子页
  const inSub = await page.evaluate(() => !!document.querySelector('#sheet [data-cfield]'));
  if (!inSub) errs.push('没进到条件子页，后面的取色断言没意义');
  await shot('02-cond-sub-0');

  // 从条件子页发起截图取色
  const pickBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet [data-act]')]
      .find(x => (x.dataset.act || '').indexOf('pick') === 0);
    if (b) { b.click(); return b.dataset.act; }
    return null;
  });
  await wait(450);
  if (!pickBtn) errs.push('条件子页里没有取色按钮（data-act 以 pick 开头）');
  // 在取色面板上选一个颜色
  await page.evaluate(() => {
    const cv = document.getElementById('sc');
    if (cv) {
      const r = cv.getBoundingClientRect();
      const ev = t => new MouseEvent(t, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true });
      cv.dispatchEvent(ev('mousedown'));
      cv.dispatchEvent(ev('mouseup'));
      cv.dispatchEvent(ev('click'));
    }
  });
  await wait(500);
  const back = await page.evaluate(() => ({
    hasCField: !!document.querySelector('#sheet [data-cfield]'),
    title: (document.querySelector('#sheet h3') || {}).innerText || '(没标题)'
  }));
  if (!back.hasCField) {
    errs.push('第一个条件取完色没回到条件子页（现在是「' + back.title + '」）—— sub=0 被当假值了');
  }
  await shot('03-after-pick');
  await closeSheet();

  // ===== 3. 恶意 icon / tone 不能被当 HTML 执行 =====
  await page.evaluate(`window.__scripts = ${JSON.stringify(EVIL)};`);
  await page.reload({ waitUntil: 'load' });

  await wait(700);
  const evilState = await page.evaluate(() => ({
    pwned: !!window.__pwned,
    imgs: document.querySelectorAll('#page img').length,
    shown: (document.querySelector('#page .ic') || {}).textContent || ''
  }));
  if (evilState.pwned) errs.push('恶意 icon/tone 被当成 HTML 执行了（window.__pwned 被置位）');
  if (evilState.imgs > 0) errs.push('恶意 icon 被解析成了 ' + evilState.imgs + ' 个 img 标签');
  await shot('04-xss-icon');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.0.1 修复项有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.0.1 修复项回归通过：rep 落盘成数字 / 第一个条件取色回对页 / 恶意 icon 不执行，共 4 张截图');
})();
