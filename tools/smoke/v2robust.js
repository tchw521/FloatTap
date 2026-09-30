// v2.0.0 健壮性：喂畸形数据，看界面会不会白屏/报错。
// 真实场景：从市场导入别人写的脚本、老版本升级上来的脚本、手改过的 JSON —— 都可能长这样。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

// 畸形脚本：未知动作类型 / cond 缺 cs / cs 里有未知类型 / 字段是字符串 / 空脚本 / 超长名字
const BAD = [
  {
    id: 'b1', name: '未知动作', icon: '❓', tone: 2, loop: false,
    actions: [{ t: 'flyToMars', x: 1, d: 100 }, { t: 'click', x: 50, y: 50, pct: 1, d: 200 }]
  },
  {
    id: 'b2', name: '条件没填', icon: '🧩', tone: 3, loop: false,
    actions: [{ t: 'cond' }, { t: 'cond', mode: 2, n: 3, cs: [] }, { t: 'cond', mode: 9, cs: [{ k: 'unknownKind' }] }]
  },
  {
    id: 'b3', name: '字段乱写', icon: '🔧', tone: 4, loop: false,
    actions: [{ t: 'click', x: 'abc', y: null, d: '{{gap}}' }, { t: 'findColor', c: '', sim: '高', pct: 1 }]
  },
  { id: 'b4', name: '', icon: '', tone: 0, actions: [] },
  {
    id: 'b5', name: '超级长的名字'.repeat(20), icon: '📜', tone: 5, loop: true,
    actions: Array.from({ length: 60 }, (_, i) => ({ t: 'click', x: i, y: i, pct: 1, d: 10 }))
  }
];

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
  // 注意：这里必须是语句，不能包成 () => {...}（puppeteer 只求值不调用，注入会静默失效）
  await page.evaluateOnNewDocument(`window.__scripts = ${JSON.stringify(BAD)};`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = n => page.screenshot({ path: `${OUT}/v20r-${n}.png` });
  await wait(600);

  // 1. 列表页能出来，5 个脚本都在
  const cards = await page.$$eval('.list .item', els => els.length);
  if (cards !== 5) errs.push('畸形脚本列表没渲染全，只看到 ' + cards + ' 张卡');
  const bodyLen = await page.evaluate(() => document.body.innerText.length);
  if (bodyLen < 100) errs.push('页面基本是空的（疑似白屏），正文只有 ' + bodyLen + ' 字');
  await shot('01-list');

  // 2. 逐个点进去看动作列表（最容易在未知类型上崩）
  for (let i = 0; i < BAD.length; i++) {
    await page.evaluate(i => {
      const c = document.querySelectorAll('.list .item')[i];
      const e = c && c.querySelector('[data-act="edit"]');
      if (e) e.click();
    }, i);
    await wait(450);
    const rows = await page.$$eval('[data-act="editAct"]', els => els.length).catch(() => 0);
    const txt = await page.evaluate(() => document.body.innerText.length);
    if (txt < 50) errs.push('打开第 ' + (i + 1) + ' 个脚本后页面空了（白屏）');
    await shot('02-open-' + (i + 1));
    // 退回列表
    await page.evaluate(() => {
      const b = document.querySelector('[data-act="back"]');
      if (b) b.click();
    });
    await wait(400);
    // 兜底：直接切到脚本 Tab 重置
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('#tabs button')].find(b => b.textContent.includes('脚本'));
      if (t) t.click();
    });
    await wait(350);
  }

  // 3. 逐个脚本点开第一个动作，检查弹层标题跟这个动作是不是同一个
  //    （这里以前踩过坑：编辑状态残留会导致打开 A 脚本时看到 B 脚本动作的表单，
  //      保存下去就把 A 的动作改成了 B 的样子）
  const expectTitle = ['❓ flyToMars', '🧩 条件判断', '👆 点击', '（空脚本没动作）', '👆 点击'];
  for (let i = 0; i < BAD.length; i++) {
    // 清干净状态，再从列表进第 i 个脚本
    await page.evaluate(() => {
      const m = document.getElementById('modal');
      if (m) m.classList.add('hidden');
    });
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('#tabs button')].find(b => b.textContent.includes('脚本'));
      if (t) t.click();
    });
    await wait(250);
    await page.evaluate(() => {
      const back = document.querySelector('[data-act="back"]');
      if (back) back.click();
    });
    await wait(250);
    await page.evaluate(i => {
      const c = document.querySelectorAll('.list .item')[i];
      const e = c && c.querySelector('[data-act="edit"]');
      if (e) e.click();
    }, i);
    await wait(400);
    const first = await page.$('[data-act="editAct"]');
    if (!first) {
      if (BAD[i].actions.length) errs.push('脚本 ' + (i + 1) + ' 有动作却没渲染出可点的动作行');
      continue;
    }
    await first.click();
    await wait(400);
    const title = await page.evaluate(() => {
      const h = document.querySelector('#sheet h3');
      return h ? h.innerText.trim() : '(没标题)';
    });
    const want = expectTitle[i];
    if (!title.includes(want.replace('❓ ', '').replace('👆 ', '').replace('🧩 ', ''))) {
      errs.push('脚本 ' + (i + 1) + ' 的动作弹层标题不对：期望含「' + want + '」实际「' + title + '」');
    }
    await shot('04-title-' + (i + 1));
    await page.evaluate(() => {
      const m = document.getElementById('modal');
      if (m) m.classList.add('hidden');
    });
    await wait(200);
  }

  // 4. 进编辑器后 S.editId 必须跟这个脚本一致（这是上面那个 bug 的根）
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#tabs button')].find(b => b.textContent.includes('脚本'));
    if (t) t.click();
  });
  await wait(250);
  await page.evaluate(() => {
    const back = document.querySelector('[data-act="back"]');
    if (back) back.click();
  });
  await wait(250);
  await page.evaluate(() => {
    const c = document.querySelectorAll('.list .item')[2];
    const e = c && c.querySelector('[data-act="edit"]');
    if (e) e.click();
  });
  await wait(400);
  const idOk = await page.evaluate(() => {
    const row = document.querySelector('[data-act="editAct"]');
    return row ? row.dataset.id : null;
  });
  if (idOk !== 'b3') errs.push('进编辑器后动作行挂的脚本 id 不对：期望 b3 实际 ' + idOk);

  await browser.close();
  if (errs.length) {
    console.log('❌ 健壮性有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ 畸形数据健壮性通过：未知动作类型 / cond 缺字段 / 字段类型乱写 / 空脚本 / 60 步长脚本，共 7 张截图');
})();
