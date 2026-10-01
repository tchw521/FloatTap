// v2.3.0 冒烟：静默失效大扫除
//   1. 动作表单里那批「引擎一直在读、以前没入口」的开关现在能看见了
//      （找文字·只看能点的按钮 / 如果·只看能点的·第几个 / 找色·采样间隔·超时 / 找图·超时）
//   2. 双击 / 长按 / 随机点 新建出来是 (50,50)，不再是 (0,0)
//   3. 「等待」动作只露出 ms，且默认 d=0（等待时长以 ms 为准）
//   4. 关于页的更新日志第一条是 v2.3.0（以前停更在 v1.4.0）
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
  const shot = n => page.screenshot({ path: `${OUT}/v23-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => {
      if (document.body.innerText.includes(t)) return true;
      const s = document.getElementById('sheet');   // v4.2.0 高级段默认隐藏但字段仍在表单里
      return !!(s && s.textContent.includes(t));
    }, txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const stored = () => page.evaluate(() => JSON.parse(window.app.scripts())[0].actions);

  /** 在「加动作」弹层里挑一个类型，返回新建出来的动作 JSON */
  const addAct = async (tile) => {
    const before = (await stored()).length;
    await page.evaluate(() => document.querySelector('button[data-act="addAct"]').click());
    await wait(420);
    const ok = await page.evaluate(t => {
      const e = [...document.querySelectorAll('#sheet .titem')].find(x => (x.textContent || '').includes(t));
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

  await wait(650);

  // 打开第一个脚本的编辑页
  await page.evaluate(() => {
    document.querySelectorAll('.list .item')[0].querySelector('[data-act="edit"]').click();
  });
  await wait(450);
  await want('动作', '脚本编辑器');
  await shot('01-editor');

  // 1. 找文字：新增的「只看能点的按钮」「最多等 ms」都在表单里
  const find = await addAct('找文字');
  await want('只看能点的按钮', '找文字表单');
  await want('最多等 ms', '找文字表单');
  if (find && find.clickable === undefined) errs.push('新建「找文字」没带 clickable 默认值：' + JSON.stringify(find));
  if (find && find.timeout === undefined) errs.push('新建「找文字」没带 timeout 默认值：' + JSON.stringify(find));
  await shot('02-find-form');
  await closeSheet();

  // 2. 如果：新增「只看能点的按钮」「第几个」
  const iff = await addAct('如果');
  await want('只看能点的按钮', '如果表单');
  if (iff && iff.clickable === undefined) errs.push('新建「如果」没带 clickable：' + JSON.stringify(iff));
  if (iff && iff.index === undefined) errs.push('新建「如果」没带 index：' + JSON.stringify(iff));
  await shot('03-if-form');
  await closeSheet();

  // 3. 找色 / 找图：采样间隔 与 超时
  const fc = await addAct('找色');
  await want('采样间隔', '找色表单');
  if (fc && fc.step === undefined) errs.push('新建「找色」没带 step：' + JSON.stringify(fc));
  if (fc && fc.timeout === undefined) errs.push('新建「找色」没带 timeout：' + JSON.stringify(fc));
  await shot('04-findcolor-form');
  await closeSheet();

  const fi = await addAct('找图');
  if (fi && fi.timeout === undefined) errs.push('新建「找图」没带 timeout：' + JSON.stringify(fi));
  await closeSheet();

  // 4. 双击 / 长按 / 随机点：默认落点不再是 (0,0)
  for (const t of ['双击', '长按', '随机点']) {
    const a = await addAct(t);
    if (!a) continue;
    if (a.x === undefined || a.y === undefined) {
      errs.push('新建「' + t + '」没有 x/y：' + JSON.stringify(a));
    } else if (Number(a.x) === 0 && Number(a.y) === 0) {
      errs.push('新建「' + t + '」默认落在 (0,0)：' + JSON.stringify(a));
    }
    await closeSheet();
  }
  await shot('05-defaults');

  // 5. 等待：表单只露 ms，默认 d=0
  const w = await addAct('等待');
  if (w && Number(w.d) !== 0) errs.push('新建「等待」的 d 不是 0（会让等待时长被默认的 300 混进来）：' + JSON.stringify(w));
  if (w && Number(w.ms) <= 0) errs.push('新建「等待」的 ms 不对：' + JSON.stringify(w));
  const formTxt = await page.evaluate(() => document.querySelector('#sheet').innerText);
  if (formTxt.includes('之后等待 ms')) errs.push('「等待」表单不该再露出「之后等待 ms」（时长以 ms 为准）');
  await closeSheet();

  // 6. 关于页的更新日志第一条是 v2.3.0
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
  if (!about.includes('v2.3.0')) errs.push('关于页的更新日志第一条不是 v2.3.0');
  if (!about.includes('v1.0.0')) errs.push('更新日志丢了老版本条目');
  await shot('06-about-changelog');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.3.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v2.3.0 冒烟通过（6 张截图）');
})();
