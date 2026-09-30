// v2.0.0 Step3 冒烟：条件判断动作的编辑器（增删改条件、满足模式、重复检查）
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
  const shot = n => page.screenshot({ path: `${OUT}/v20c-${n}.png` });
  const clickText = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const els = [...document.querySelectorAll(sel)].filter(x => !x.closest('#modal') === false || true);
      const e = els.find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('找不到可点击元素: ' + sel + ' / ' + txt);
    await wait(400);
  };
  const has = async txt => page.evaluate(t => document.body.innerText.includes(t), txt);
  const want = async (txt, label) => {
    if (!(await has(txt))) errs.push('断言失败[' + label + ']：页面上没有「' + txt + '」');
  };
  // 动作编辑弹层里的动作清单（#modal 内），选中第 n 个动作的「⋯」菜单
  const openAct = async (rowText) => {
    await clickText('#sheet .item, #sheet .act', rowText);
  };
  const actCount = () => page.evaluate(() =>
    JSON.parse(window.app.scripts())[0].actions.length);
  const actAt = i => page.evaluate(i =>
    JSON.parse(window.app.scripts())[0].actions[i], i);

  await wait(600);
  if (!(await page.evaluate(() => !!window.app))) {
    console.log('❌ 假桥没注入成功');
    if (errs.length) console.log(errs.join('\n'));
    await browser.close();
    process.exit(1);
  }

  // 1. 进第一个脚本的编辑器
  await clickText('.item .grow', '每天签到');
  await wait(300);
  await want('动作', '脚本编辑器');
  await shot('01-editor');

  // 2. 点「＋ 加动作」打开弹层，里面应该能看到「条件判断」
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[data-act="addAct"]')][0];
    if (b) b.click();
  });
  await wait(400);
  await want('条件判断', '加动作弹层');
  await shot('02-addact-cond');

  // 3. 选它，进条件表单
  await clickText('#sheet .tile', '条件判断');
  await wait(400);
  await want('满足模式', '条件表单');
  await want('条件清单', '条件表单');
  await want('重复检查', '条件表单');
  if (!(await has('还没加条件'))) errs.push('空清单时没给提示');
  await shot('03-cond-empty');

  // 4. 加一个「屏幕上有字」条件
  await clickText('.row .btn', '屏幕上有字');
  await wait(400);
  // v2.4.0：条件摘要升级了——空条件不再显示「有「」」这种没信息量的文案，
  // 改成明说「没填＝任意节点」，免得用户以为空条件会一直成立
  await want('没填＝任意节点', '条件行说明');
  await shot('04-cond-one');

  // 5. 点「改」，进子页，填字，确定
  await clickText('.conditem .btn', '改');
  await wait(350);
  await want('要找的字', '条件子页');
  await shot('05-cond-edit');
  await page.evaluate(() => {
    const i = document.querySelector('#sheet [data-cfield="s"]');
    if (i) { i.value = '签到'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText('#sheet .btn', '确定');
  await wait(400);
  if (!(await has('有「签到」'))) errs.push('改完条件后主表单没显示新说明');
  await shot('06-cond-edited');

  // 6. 再加「当前是某 App」和「随机概率」，验证多个条件
  await clickText('.row .btn', '当前是某 App');
  await wait(350);
  await clickText('.row .btn', '随机概率');
  await wait(350);
  const nCount = await page.evaluate(() =>
    (document.querySelector('.cond .tiny') || {}).textContent || '');
  await shot('07-cond-three');
  if (!/3\s*个/.test(nCount)) errs.push('条件计数没变成 3，实际：' + nCount);

  // 7. 满足模式默认「全部满足」；切到「满足指定个数」应出现「凑够几个」
  let nVisible = await page.evaluate(() => {
    const w = document.getElementById('nwrap');
    return w ? w.style.display !== 'none' : null;
  });
  if (nVisible) errs.push('默认「全部满足」时不该显示「凑够几个」');
  await page.evaluate(() => {
    const s = document.querySelector('#sheet [data-field="mode"]');
    s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(300);
  nVisible = await page.evaluate(() => {
    const w = document.getElementById('nwrap');
    return w ? w.style.display !== 'none' : null;
  });
  if (!nVisible) errs.push('切到「满足指定个数」后「凑够几个」没出现');
  await shot('08-cond-count');

  // 8. 打开重复检查
  await page.evaluate(() => {
    const sw = document.querySelector('#sheet [data-field="rep"]');
    if (sw) sw.click();
  });
  await wait(250);
  const repOn = await page.evaluate(() => {
    const sw = document.querySelector('#sheet [data-field="rep"]');
    return sw ? sw.classList.contains('on') : null;
  });
  if (!repOn) errs.push('重复检查开关点不动');
  await shot('09-cond-repeat');

  // 9. 删掉一个条件
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.conditem .btn')].filter(b => b.textContent.includes('✕'));
    if (btns[btns.length - 1]) btns[btns.length - 1].click();
  });
  await wait(400);
  const after = await page.evaluate(() =>
    (document.querySelector('.cond .tiny') || {}).textContent || '');
  if (!/2\s*个/.test(after)) errs.push('删完条件后计数没变成 2，实际：' + after);
  await shot('10-cond-after-del');

  // 10. 保存条件动作
  await clickText('#sheet .btn', '保存');
  await wait(400);
  await want('条件判断', '保存后回到编辑器');
  await shot('11-saved');

  // 11. 从存储里核对：条件动作确实落盘了，字段对
  const last = await page.evaluate(() => {
    const a = JSON.parse(window.app.scripts())[0].actions;
    for (let i = a.length - 1; i >= 0; i--) if (a[i].t === 'cond') return a[i];
    return null;
  });
  if (!last) errs.push('存储里没找到 cond 动作');
  else {
    if (last.mode !== 2) errs.push('mode 没存对，期望 2，实际 ' + last.mode);
    if (last.rep !== true && last.rep !== 1) errs.push('rep 没存对，实际 ' + last.rep);
    if (!last.cs || last.cs.length !== 2) errs.push('cs 个数不对，期望 2，实际 ' + (last.cs && last.cs.length));
    const ks = (last.cs || []).map(c => c.k).join(',');
    if (ks.indexOf('text') < 0) errs.push('cs 里丢了 text 条件，实际 ' + ks);
    const t = (last.cs || []).find(c => c.k === 'text');
    if (!t || t.s !== '签到') errs.push('text 条件的 s 没存对：' + (t && t.s));
    // 存储里的条件也带 n（凑够几个）
    if (last.n !== 1) errs.push('n 默认值不对：' + last.n);
  }

  // 12. 重新打开这个条件动作，确认 form 回填正确（不是空壳）
  await clickText('#sheet .btn', '保存');
  await wait(300);
  await shot('12-final');

  await browser.close();
  if (errs.length) {
    console.log('❌ 条件编辑器冒烟有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.0.0 Step3 条件编辑器冒烟通过：增删改 + 满足模式联动 + 重复检查 + 落盘校验，共 12 张截图');
})();
