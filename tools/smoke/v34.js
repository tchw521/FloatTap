// v4.2.0 冒烟：弹窗流重做（常用大行 + 分组网格 + 通用/高级两段 + 屏幕预览拾取）
//   A.（node 侧）源码守卫：app.js 的 ACT_QUICK/ACT_GROUPS/ADV_F/pv 组件 + style.css 新类 + CHANGELOG 头条
//   B.（浏览器；mock 注入 7 个脚本，编辑器/弹层全真渲染）：
//      1. 「＋ 加动作」弹层：常用 6 大行 + 六组标题 + 27 个动作一个不落
//      2. 点「点击」进表单：两段 seg、通用段 pvbox+坐标输入、高级段默认隐藏；点预览屏回填 x/y（pct 百分比）
//      3. 切「高级设置」：repeat/pct/截屏取点就位；切回通用后已回填的值不丢
//      4. 滑动表单：双 pin + 连线 + 起点/终点切换，拾取只改终点对
//      5. 找文字表单：desc/id/re 收进高级段（通用段无这些输入框）
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
  ['app.js', appSrc, 'var ACT_QUICK'],
  ['app.js', appSrc, 'var ACT_GROUPS'],
  ['app.js', appSrc, 'var ADV_F'],
  ['app.js', appSrc, 'function pvBoxHtml'],
  ['app.js', appSrc, 'function pvPick'],
  ['app.js', appSrc, 'function pvSyncLine'],
  ['app.js', appSrc, 'function actFieldHtml'],
  ['app.js', appSrc, "data-act=\"formTab\""],
  ['app.js', appSrc, "data-act=\"pvPick\""],
  ['app.js', appSrc, "data-act=\"pvTarget\""],
  ['app.js', appSrc, '屏幕预览 · 点按拾取坐标'],
  ['app.js', appSrc, 'v4.2.0</div>'],
  ['style.css', cssSrc, '.qk{'],
  ['style.css', cssSrc, '.tgrid{'],
  ['style.css', cssSrc, '.segbar .sg.on{'],
  ['style.css', cssSrc, '.pvbox{'],
  ['style.css', cssSrc, '.pvpin{']
];
for (const [f, src, s] of need) {
  if (!src.includes(s)) errs.push(f + ' 缺关键代码: ' + s);
}
// 分组网格 27 动作不漏（node 侧再算一遍，与 F.java 双保险）
const grpBlock = (appSrc.match(/var ACT_GROUPS\s*=\s*\[([\s\S]*?)\];/) || [])[1] || '';
const grpKeys = new Set([...grpBlock.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]));
const typesBlock = appSrc.slice(appSrc.indexOf('var TYPES = {'), appSrc.indexOf("var CMP_OP"));
const typeKeys = new Set([...typesBlock.matchAll(/^    ([a-zA-Z]+): \{/gm)].map(m => m[1]));
for (const k of typeKeys) if (!grpKeys.has(k)) errs.push('ACT_GROUPS 漏了动作: ' + k);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const wait = ms => new Promise(r2 => setTimeout(r2, ms));
  const openApp = async () => {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(MOCK_IIFE);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
    await wait(1100);
    return page;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v34-${String(++seq).padStart(2, '0')}-${n}.png` });
  let seq = 0;
  // 预览屏按百分比派发精确坐标的 click（物理 mouse.click 有 1~2px 边框偏差，断言会抖）
  const pvTap = async (page, px, py) => {
    await page.evaluate((px, py) => {
      const b = document.querySelector('#sheet .pvbox').getBoundingClientRect();
      document.querySelector('#sheet .pvbox').dispatchEvent(
        new MouseEvent('click', { clientX: b.x + b.width * px, clientY: b.y + b.height * py, bubbles: true }));
    }, px, py);
    await wait(300);
  };
  const clickEl = async (page, sel) => {
    const ok = await page.evaluate(s => {
      const e = document.querySelector(s);
      if (!e) return false;
      e.click(); return true;
    }, sel);
    if (!ok) errs.push('找不到元素: ' + sel);
    await wait(350);
  };
  const openEditorOf = async (page, id) => {
    await clickEl(page, '[data-act="edit"][data-id="' + id + '"]');
    await wait(250);
  };

  // 1. 「＋ 加动作」弹层：常用大行 + 六组 + 27 动作
  let p = await openApp();
  await openEditorOf(p, 'a2');
  await clickEl(p, '[data-act="addAct"]');
  const st1 = await p.evaluate(() => ({
    qk: document.querySelectorAll('#sheet .qk[data-act="pickType"]').length,
    grp: document.querySelectorAll('#sheet .grp-t.sub').length,
    items: document.querySelectorAll('#sheet .titem[data-act="pickType"]').length,
    names: [...document.querySelectorAll('#sheet .titem .tn')].map(x => x.textContent)
  }));
  if (st1.qk !== 6) errs.push('场景1：常用大行应为 6 个，实际 ' + st1.qk);
  if (st1.grp !== 6) errs.push('场景1：分组标题应为 6 组，实际 ' + st1.grp);
  if (st1.items !== 27) errs.push('场景1：全部动作应为 27 项，实际 ' + st1.items);
  for (const nm of ['长按', '找色', '子脚本', '放互斥锁', '找图']) {
    if (!st1.names.includes(nm)) errs.push('场景1：分组网格缺「' + nm + '」');
  }
  await shot(p, 'add-act-groups');
  await p.close();

  // 2. 点击动作表单：两段 + 预览拾取回填
  p = await openApp();
  await openEditorOf(p, 'a2');
  await clickEl(p, '[data-act="addAct"]');
  await clickEl(p, '[data-act="pickType"][data-t="click"]');
  const st2a = await p.evaluate(() => {
    const std = document.getElementById('fstd'), adv = document.getElementById('fadv');
    return {
      seg: document.querySelectorAll('#sheet .segbar .sg').length,
      pv: !!document.querySelector('#fstd .pvbox'),
      xIn: !!document.querySelector('#fstd [data-field="x"]'),
      advHidden: adv && adv.style.display === 'none',
      goInAdv: !!adv.querySelector('[data-field="go"], .kv'),
      title: (document.querySelector('#sheet h3') || {}).textContent || ''
    };
  });
  if (st2a.seg !== 2) errs.push('场景2：seg 两段应存在，实际 ' + st2a.seg);
  if (!st2a.pv) errs.push('场景2：通用段应有屏幕预览盒');
  if (!st2a.xIn) errs.push('场景2：通用段应有 X 坐标输入框');
  if (!st2a.advHidden) errs.push('场景2：高级段默认应隐藏');
  // 点预览屏 (30%, 70%)：新动作 def 无 pct → 开关默认关 → 像素模式回填（与截屏取点 usePoint 同算法）
  await pvTap(p, 0.30, 0.70);
  const st2b = await p.evaluate(() => ({
    x: document.querySelector('#sheet [data-field="x"]').value,
    y: document.querySelector('#sheet [data-field="y"]').value,
    pinL: document.getElementById('pvPin1') ? document.getElementById('pvPin1').style.left : null,
    pinT: document.getElementById('pvPin1') ? document.getElementById('pvPin1').style.top : null
  }));
  if (Math.abs(+st2b.x - 324) > 6 || Math.abs(+st2b.y - 1344) > 22) {   // 1 整数像素在 96px 高预览盒 ≈ 1% ≈ 20px
    errs.push('场景2：像素模式应回填 x≈324/y≈1344（30%/70% × 1080×1920），实际 ' + st2b.x + '/' + st2b.y);
  }
  if (Math.abs(parseFloat(st2b.pinL) - 30) > 1.1 || Math.abs(parseFloat(st2b.pinT) - 70) > 1.1) {
    errs.push('场景2：pin 应跟到 30%/70% 附近，实际 ' + st2b.pinL + '/' + st2b.pinT);
  }
  await shot(p, 'form-pvpick-click');
  await p.close();

  // 3. 高级段切换 + pct 两路 + 值保留
  p = await openApp();
  await openEditorOf(p, 'a2');
  await clickEl(p, '[data-act="addAct"]');
  await clickEl(p, '[data-act="pickType"][data-t="click"]');
  await pvTap(p, 0.30, 0.70);   // 先拾一次（像素模式）
  await clickEl(p, '[data-act="formTab"][data-v="adv"]');
  const st3a = await p.evaluate(() => {
    const std = document.getElementById('fstd'), adv = document.getElementById('fadv');
    return {
      stdHidden: std.style.display === 'none', advShown: adv.style.display === '',
      repeat: !!adv.querySelector('[data-field="repeat"]'),
      pct: !!adv.querySelector('[data-field="pct"]'),
      pick: !!adv.querySelector('[data-act="pickPoint"]')
    };
  });
  if (!st3a.stdHidden || !st3a.advShown) errs.push('场景3：切换后两段显隐不对');
  if (!st3a.repeat || !st3a.pct || !st3a.pick) {
    errs.push('场景3：高级段缺 repeat/pct/截屏取点（' + JSON.stringify(st3a) + '）');
  }
  // 打开「百分比坐标」开关，切回通用再拾取 → 这次应回填百分比
  await clickEl(p, '#fadv [data-field="pct"]');
  await clickEl(p, '[data-act="formTab"][data-v="std"]');
  const st3b1 = await p.evaluate(() => ({
    x: document.querySelector('#sheet [data-field="x"]').value,
    pctOn: document.querySelector('#sheet [data-field="pct"]').classList.contains('on')
  }));
  if (st3b1.x === '') errs.push('场景3：切回通用后已拾取的 x 不该丢');
  if (!st3b1.pctOn) errs.push('场景3：高级段打开的百分比开关切段后应保持开');
  await pvTap(p, 0.30, 0.70);
  const st3b2 = await p.evaluate(() => document.querySelector('#sheet [data-field="x"]').value);
  // clientX 是整数像素，30% of 356px 落在 29.8~30.1 区间，容差 ±1
  if (Math.abs(+st3b2 - 30) > 1.2) errs.push('场景3：百分比模式拾取应回填 x≈30，实际 ' + st3b2);
  await shot(p, 'form-advanced-tab');
  await p.close();

  // 4. 滑动表单：双 pin + 起点/终点切换
  p = await openApp();
  await openEditorOf(p, 'a3');
  await clickEl(p, '[data-act="editAct"][data-i="0"]');
  const st4a = await p.evaluate(() => ({
    p1: !!document.getElementById('pvPin1'), p2: !!document.getElementById('pvPin2'),
    line: !!document.getElementById('pvLine'), seg: !!document.querySelector('#sheet .pvseg')
  }));
  if (!st4a.p1 || !st4a.p2 || !st4a.line || !st4a.seg) {
    errs.push('场景4：滑动表单应带双 pin + 连线 + 起终点切换（' + JSON.stringify(st4a) + '）');
  }
  await clickEl(p, '[data-act="pvTarget"][data-v="p2"]');
  const tgtNow = await p.evaluate(() => document.querySelector('#sheet .pvbox').dataset.tgt);
  if (tgtNow !== 'p2') errs.push('场景4：点「终点」后拾取目标应切到 p2，实际 ' + tgtNow);
  await pvTap(p, 0.80, 0.20);   // a3 的 swipe pct:1 → 百分比模式
  await wait(300);
  const st4b = await p.evaluate(() => ({
    x1: document.querySelector('#sheet [data-field="x1"]').value,
    y1: document.querySelector('#sheet [data-field="y1"]').value,
    x2: document.querySelector('#sheet [data-field="x2"]').value,
    y2: document.querySelector('#sheet [data-field="y2"]').value
  }));
  if (Math.abs(+st4b.x2 - 80) > 1.2 || Math.abs(+st4b.y2 - 20) > 2.2) {
    errs.push('场景4：终点应回填 (80,20) 附近，实际 ' + JSON.stringify(st4b));
  }
  if (+st4b.x1 !== 50 || +st4b.y1 !== 78) errs.push('场景4：起点不应被改（应保持 50/78），实际 ' + JSON.stringify(st4b));
  await shot(p, 'form-pvpick-swipe');
  await p.close();

  // 5. 找文字：desc/id/re 收进高级段
  p = await openApp();
  await openEditorOf(p, 'a1');
  await clickEl(p, '[data-act="editAct"][data-i="1"]');
  const st5 = await p.evaluate(() => {
    const std = document.getElementById('fstd'), adv = document.getElementById('fadv');
    return {
      hasText: !!std.querySelector('[data-field="s"]'),
      descInStd: !!std.querySelector('[data-field="desc"]'),
      descInAdv: !!adv.querySelector('[data-field="desc"]'),
      reInAdv: !!adv.querySelector('[data-field="re"]'),
      clickableInAdv: !!adv.querySelector('[data-field="clickable"]'),
      pv: !!std.querySelector('.pvbox')
    };
  });
  if (!st5.hasText) errs.push('场景5：找文字的「屏幕上的文字」应在通用段');
  if (st5.descInStd || !st5.descInAdv || !st5.reInAdv || !st5.clickableInAdv) {
    errs.push('场景5：desc/re/clickable 应收进高级段（' + JSON.stringify(st5) + '）');
  }
  if (st5.pv) errs.push('场景5：找文字没有点坐标，不该出预览盒');
  await p.close();

  await browser.close();
  if (errs.length) {
    console.log('❌ 冒烟有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  } else {
    console.log('✅ v4.2.0 弹窗流重做冒烟通过（4 张截图）');
  }
})().catch(e => { console.error('冒烟崩了：', e); process.exit(1); });
