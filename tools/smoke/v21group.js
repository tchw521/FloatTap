// v2.1.0 冒烟：动作分组 —— 建分组 / 进分组加子动作 / 四种跑法能选能存 / 落盘结构对
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
  const shot = n => page.screenshot({ path: `${OUT}/v21-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  await wait(600);

  const inSheet = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const e = [...document.querySelectorAll('#sheet ' + sel)].find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('弹层里找不到: ' + sel + ' / ' + txt);
    await wait(400);
  };
  const stored = () => page.evaluate(() => JSON.parse(window.app.scripts())[0].actions);

  // 1. 打开第一个脚本
  await page.evaluate(() => {
    document.querySelectorAll('.list .item')[0].querySelector('[data-act="edit"]').click();
  });
  await wait(450);
  await want('动作', '脚本编辑器');
  const base = (await stored()).length;

  // 2. 加一个「动作分组」
  await page.evaluate(() => document.querySelector('button[data-act="addAct"]').click());
  await wait(420);
  await want('动作分组', '加动作弹层');
  await inSheet('.tile', '动作分组');
  await want('怎么跑', '分组表单');
  await shot('01-group-form');

  // 3. 分组名 + 选「同时来」，保存
  await page.evaluate(() => {
    const nm = document.querySelector('#sheet [data-field="name"]');
    if (nm) nm.value = '抢红包三连';
    const md = document.querySelector('#sheet [data-field="mode"]');
    if (md) { md.value = '1'; md.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await wait(300);
  await inSheet('.btn', '保存');
  const list1 = await stored();
  const g = list1[list1.length - 1];
  if (!g || g.t !== 'group') errs.push('没存下分组动作，最后一项是 ' + JSON.stringify(g && g.t));
  else {
    if (g.name !== '抢红包三连') errs.push('分组名没存上：' + g.name);
    if (+g.mode !== 1) errs.push('分组跑法没存上，期望 1（同时来）实际 ' + JSON.stringify(g.mode));
    if (!Array.isArray(g.acts)) errs.push('分组里没有 acts 数组');
  }
  await shot('02-group-saved');

  // 4. 列表里分组行要点进去，不是弹普通表单
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-act="editGroup"]')][0];
    if (r) r.click();
  });
  await wait(450);
  await want('子动作', '分组内页');
  await want('这一组怎么跑', '分组内页');
  await shot('03-group-inside');

  // 5. 在分组里加两个子动作
  for (const kind of ['点击', '滑动']) {
    await page.evaluate(() => document.querySelector('button[data-act="addAct"]').click());
    await wait(400);
    await inSheet('.tile', kind);
    await inSheet('.btn', '保存');
  }
  const list2 = await stored();
  const g2 = list2[list2.length - 1];
  if (!g2 || !g2.acts || g2.acts.length !== 2) {
    errs.push('分组里没加上 2 个子动作，实际 ' + (g2 && g2.acts ? g2.acts.length : '没有'));
  } else {
    if (g2.acts[0].t !== 'click') errs.push('第一个子动作类型不对：' + g2.acts[0].t);
    if (g2.acts[1].t !== 'swipe') errs.push('第二个子动作类型不对：' + g2.acts[1].t);
  }
  // 关键：子动作不能跑到脚本根层的动作列表里
  if (list2.length !== base + 1) {
    errs.push('分组里的动作被加到脚本根层了：根层 ' + base + ' → ' + list2.length + '（应该只多 1 个分组）');
  }
  await shot('04-group-two-acts');

  // 6. 四种跑法都能选，且切换有对应说明
  for (const [v, n] of [['0', '按顺序'], ['1', '同时'], ['2', '打乱'], ['3', '随机']]) {
    await page.evaluate(vv => {
      const md = document.getElementById('gmode');
      if (md) { md.value = vv; md.dispatchEvent(new Event('change', { bubbles: true })); }
    }, v);
    await wait(280);
    const tip = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.tiny.muted')].map(x => x.innerText).join(' ');
      return t;
    });
    if (!tip.includes(n)) errs.push('选跑法 ' + v + ' 时说明里没有「' + n + '」');
  }
  await shot('05-gmode-tips');

  // 7. 改跑法并存下来
  await page.evaluate(() => {
    const md = document.getElementById('gmode');
    if (md) md.value = '2';
  });
  await page.evaluate(() => {
    document.querySelector('button[data-act="saveGroup"]').click();
  });
  await wait(400);
  const list3 = await stored();
  const g3 = list3[list3.length - 1];
  if (!g3 || +g3.mode !== 2) errs.push('分组跑法改完没保存，实际 ' + (g3 && g3.mode));

  // 8. 返回要退回脚本层，动作列表还在
  await page.evaluate(() => {
    document.querySelector('[data-act="back"]').click();
  });
  await wait(450);
  const backOk = await page.evaluate(() => document.body.innerText.includes('个动作'));
  if (!backOk) errs.push('从分组返回后没回到脚本编辑器动作列表');
  await shot('06-back-to-script');

  await browser.close();
  if (errs.length) {
    console.log('❌ 动作分组有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.1.0 动作分组冒烟通过：建分组 / 进分组加子动作 / 四种跑法可存 / 返回不出错，共 6 张截图');
})();
