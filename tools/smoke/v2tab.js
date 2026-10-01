// v2.0.0 Step1 冒烟：底部 4 Tab 骨架（脚本/市场/录制/我的）+ 我的子页
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
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
  const shot = n => page.screenshot({ path: `${OUT}/v20-${n}.png` });
  const tab = async name => { await clickText('#tabs button', name); };
  const clickText = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const els = [...document.querySelectorAll(sel)].filter(x => !x.closest('#modal'));
      const e = els.find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('找不到可点击元素: ' + sel + ' / ' + txt);
    await wait(420);
  };
  const has = async txt => page.evaluate(t => document.body.innerText.includes(t), txt);
  const want = async (txt, label) => {
    if (!(await has(txt))) errs.push('断言失败[' + label + ']：页面上没有「' + txt + '」');
  };

  await wait(600);
  if (!(await page.evaluate(() => !!window.app))) {
    console.log('❌ 假桥没注入成功（window.app 不存在），后面的结果都不可信');
    if (errs.length) console.log('页面报错：\n' + errs.join('\n'));
    await browser.close();
    process.exit(1);
  }

  // 1. 默认落在「脚本」
  await want('每天签到', '脚本列表');
  await shot('01-tab-scripts');

  // 2. 底部 4 个功能 Tab + 中央 1 个制作键（v4.0.0 骨架），多了少了都算错
  const nTabs = await page.evaluate(() => document.querySelectorAll('#tabs button:not(.tb-fab)').length);
  if (nTabs !== 4) errs.push('底部功能 Tab 数量应为 4，实际 ' + nTabs);
  const nFab = await page.evaluate(() => document.querySelectorAll('#tabs button.tb-fab').length);
  if (nFab !== 1) errs.push('中央制作键应有 1 个，实际 ' + nFab);
  const tabNames = await page.evaluate(() =>
    [...document.querySelectorAll('#tabs button')]
      .filter(b => !b.classList.contains('tb-fab'))
      .map(b => { const sp = b.querySelectorAll('span'); return (sp.length ? sp[sp.length - 1] : b).textContent.trim(); })
      .join('/'));
  if (tabNames !== '脚本/市场/录制/我的') errs.push('Tab 名称不对：' + tabNames);

  // 3. 市场整页
  await tab('市场');
  await want('挑一个装进', '市场页');
  await shot('02-tab-market');
  const nBefore = await page.evaluate(() => JSON.parse(window.app.scripts()).length);
  await clickText('.item .btn', '装');
  await shot('03-market-installed');
  const nAfter = await page.evaluate(() => JSON.parse(window.app.scripts()).length);
  if (nAfter !== nBefore + 1) errs.push('装完脚本数没变：' + nBefore + ' → ' + nAfter);
  if (!(await has('装好了'))) errs.push('装完没弹提示');

  // 4. 录制
  await tab('录制');
  await want('录制', '录制页');
  await shot('04-tab-record');

  // 5. 我的（入口页）
  await tab('我的');
  await want('运行日志', '我的页');
  await want('自动触发', '我的页');
  await want('设置', '我的页');
  await want('关于', '我的页');
  await shot('05-tab-mine');

  // 6. 四个子页逐个进，并确认返回条在
  for (const [name, probe] of [['运行日志', '最近输出'], ['自动触发', '触发器'],
  ['设置', '悬浮球'], ['关于', '更新']]) {
    await clickText('.item', name);
    await want(probe, '子页 ' + name);
    if (!(await page.evaluate(() => !!document.querySelector('.subbar'))))
      errs.push('子页「' + name + '」没有返回条');
    await shot('06-sub-' + name);
    await clickText('.subbar .btn', '我的');
    await want('运行日志', '返回我的页');
  }

  // 7. 脚本页底部的市场按钮要能切过去
  await tab('脚本');
  await clickText('.row .btn', '脚本市场');
  await want('挑一个装进', '脚本页→市场');
  await shot('07-scripts-to-market');

  // 8. 深色模式下的 4 Tab
  await page.evaluate(() => { document.documentElement.classList.add('dark'); });
  await wait(300);
  await tab('我的');
  await shot('08-dark-mine');
  await tab('脚本');
  await shot('09-dark-scripts');

  // 9. 平板宽屏
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); });
  await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2 });
  await wait(400);
  await tab('我的');
  await shot('10-tablet-mine');

  await browser.close();
  if (errs.length) {
    console.log('❌ 冒烟有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.0.0 Step1 冒烟通过：4 Tab + 我的 4 个子页 + 市场整页，共 10 张截图');
})();
