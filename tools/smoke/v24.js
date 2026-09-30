// v2.4.0 冒烟：节点查找增强（控件 id / 正则 / 内容描述）
//   1. 「找文字」「如果」「条件·屏幕上有字」三处表单都能看到 id / 描述 / 正则
//   2. 填进去能存成字符串（专门盯 app.js 里那两处「文本白名单」，
//      漏了的话 id 填 2131427456 会被 num() 转成数字）
//   3. 动作列表的摘要里能看到 id「ok」，不然用户分不清这一条是按什么找的
//   4. 关于页更新日志第一条是 v2.4.0
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
  const shot = n => page.screenshot({ path: `${OUT}/v24-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const stored = () => page.evaluate(() => JSON.parse(window.app.scripts())[0].actions);

  const addAct = async (tile) => {
    const before = (await stored()).length;
    await page.evaluate(() => document.querySelector('button[data-act="addAct"]').click());
    await wait(420);
    const ok = await page.evaluate(t => {
      const e = [...document.querySelectorAll('#sheet .tile')].find(x => (x.textContent || '').includes(t));
      if (e) { e.click(); return true; }
      return false;
    }, tile);
    if (!ok) errs.push('加动作弹层里找不到：' + tile);
    await wait(450);
    const after = await stored();
    if (after.length !== before + 1) {
      errs.push('加「' + tile + '」后动作数不对：' + before + ' → ' + after.length);
      return null;
    }
    return after[after.length - 1];
  };
  const closeSheet = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#sheet button')]
        .find(x => (x.textContent || '').includes('确定') || (x.textContent || '').includes('保存'));
      if (b) b.click();
    });
    await wait(380);
  };
  /** 给当前表单里某个 data-field 的输入框填值 */
  const fill = async (key, val) => {
    const ok = await page.evaluate((k, v) => {
      const el = document.querySelector('#sheet [data-field="' + k + '"]');
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, key, val);
    if (!ok) errs.push('表单里找不到字段：' + key);
  };

  await wait(650);
  await page.evaluate(() => {
    document.querySelectorAll('.list .item')[0].querySelector('[data-act="edit"]').click();
  });
  await wait(450);
  await want('动作', '脚本编辑器');
  await shot('01-editor');

  // 1. 找文字：三个新条件的输入框都在，且填进去是字符串
  const find = await addAct('找文字');
  await want('控件 id', '找文字表单');
  await want('内容描述', '找文字表单');
  await want('正则', '找文字表单');
  await shot('02-find-form');
  await fill('id', '2131427456');
  await fill('desc', '3.0');
  await fill('re', '^\\d{4}$');
  await fill('s', '确定');
  await closeSheet();

  const saved = (await stored()).slice(-1)[0];
  if (saved.t !== 'find') {
    errs.push('最后一条不是 find：' + JSON.stringify(saved));
  } else {
    if (String(saved.id) !== '2131427456') errs.push('id 没存成字符串：' + JSON.stringify(saved.id));
    if (String(saved.desc) !== '3.0') errs.push('desc 被转成数字了（3.0 → ' + JSON.stringify(saved.desc) + '）');
    if (String(saved.re) !== '^\\d{4}$') errs.push('re 没存对：' + JSON.stringify(saved.re));
  }
  const listTxt = await page.evaluate(() => document.getElementById('acts') ? document.getElementById('acts').innerText : document.body.innerText);
  if (listTxt.indexOf('id「2131427456」') < 0) errs.push('动作摘要里看不到 id「2131427456」（用户分不清按什么找）');
  await shot('03-find-saved');

  // 2. 如果：同样三个字段
  const iff = await addAct('如果');
  await want('控件 id', '如果表单');
  await want('内容描述', '如果表单');
  await want('正则', '如果表单');
  await shot('04-if-form');
  await closeSheet();

  // 3. 条件系统里的「屏幕上有字」：走的是另一套表单（cfield）和另一套保存函数，
  //    那里有一条独立的文本白名单，最容易漏
  await addAct('条件判断');
  await wait(400);
  // v2.4.0：条件是用 data-act="condAdd" data-k="类型" 直接加的，不是从 tile 里挑
  const added = await page.evaluate(() => {
    const b = document.querySelector('#sheet [data-act="condAdd"][data-k="text"]');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!added) errs.push('条件判断里找不到「＋屏幕上有字」按钮');
  await wait(450);
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#sheet [data-act="condEdit"]')].pop();
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) errs.push('加完条件后找不到「改」按钮');
  await wait(450);
  await want('控件 id', '条件表单');
  await want('内容描述', '条件表单');
  await want('正则', '条件表单');
  await want('只看能点的按钮', '条件表单');
  await shot('05-cond-form');

  const cfill = async (key, val) => {
    const ok = await page.evaluate((k, v) => {
      const el = document.querySelector('#sheet [data-cfield="' + k + '"]');
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, key, val);
    if (!ok) errs.push('条件表单里找不到字段：' + key);
  };
  await cfill('id', '2131427456');
  await cfill('desc', '3.0');
  await cfill('re', '^\\d{4}$');
  await closeSheet();
  await wait(320);
  await closeSheet();
  await wait(320);

  const acts = await stored();
  const cond = acts[acts.length - 1];
  if (!cond || cond.t !== 'cond' || !cond.cs || !cond.cs.length) {
    errs.push('条件判断没存下条件：' + JSON.stringify(cond));
  } else {
    const c = cond.cs[cond.cs.length - 1];
    if (String(c.id) !== '2131427456') errs.push('条件里的 id 没存成字符串：' + JSON.stringify(c.id));
    if (String(c.desc) !== '3.0') errs.push('条件里的 desc 被转成数字了：' + JSON.stringify(c.desc));
    if (String(c.re) !== '^\\d{4}$') errs.push('条件里的 re 没存对：' + JSON.stringify(c.re));
  }
  await shot('06-cond-saved');

  // 4. 关于页日志
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#tabs button')].find(x => x.textContent.includes('我的'));
    if (b) b.click();
  });
  await wait(420);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.item')].find(x => x.textContent.includes('关于'));
    if (b) b.click();
  });
  await wait(420);
  const about = await page.evaluate(() => document.body.innerText);
  if (!about.includes('v2.4.0')) errs.push('关于页的更新日志第一条不是 v2.4.0');
  if (!about.includes('控件 id')) errs.push('更新日志里没提到控件 id');
  await shot('07-about-changelog');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.4.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v2.4.0 冒烟通过（7 张截图）');
})();
