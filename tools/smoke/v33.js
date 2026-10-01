// v4.1.0 冒烟：坐标指示器 + 防检测落点偏移
//   A.（node 侧）源码守卫：
//      - Pins.java 存在（形状常量 / showSwipe / hide / FLAG_NOT_TOUCHABLE / pinOn 门禁）
//      - ScriptRunner 接线（Rnd.offset ×2 + Pins.show + Pins.showSwipe + 收工 hide）
//      - Prefs 新键（pinOn / randOffset / pinMs）；app.js 设置卡与 CHANGELOG 头条
//   B.（浏览器；mock prefs 真 merge，savePrefs 写 → prefs 回读闭环）：
//      1. 设置子页「指示器与防检测」卡：坐标指示器默认开 + 落点偏移默认 5px
//      2. 点开关关闭 → savePrefs "pinOn":false → 重渲染后仍关 → 再点开
//      3. 落点偏移滑到 9 → savePrefs "randOffset":9 → 回读 slider=9、label=9px
//      4. 关于子页 CHANGELOG 头条 v4.1.0
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
const pinsSrc = read('src/com/lazytap/clicker/Pins.java');
const runnerSrc = read('src/com/lazytap/clicker/ScriptRunner.java');
const prefsSrc = read('src/com/lazytap/clicker/Prefs.java');
const appSrc = read('assets/www/app.js');
const need = [
  ['Pins.java', pinsSrc, 'SHAPE_HOLD'],
  ['Pins.java', pinsSrc, 'showSwipe'],
  ['Pins.java', pinsSrc, 'FLAG_NOT_TOUCHABLE'],
  ['Pins.java', pinsSrc, 'getBool("pinOn", true)'],
  ['ScriptRunner.java', runnerSrc, 'Rnd.offset(off, rnd)'],
  ['ScriptRunner.java', runnerSrc, 'Pins.show(svc, x, y, shape, vars.step)'],
  ['ScriptRunner.java', runnerSrc, 'Pins.showSwipe(svc, x1, y1, x2, y2, vars.step)'],
  ['ScriptRunner.java', runnerSrc, 'Pins.hide()'],
  ['Prefs.java', prefsSrc, '"pinOn"'],
  ['Prefs.java', prefsSrc, '"randOffset"'],
  ['Prefs.java', prefsSrc, '"pinMs"'],
  ['app.js', appSrc, '指示器与防检测'],
  ['app.js', appSrc, "sw('pinOn'"],
  ['app.js', appSrc, "slider('randOffset'"],
  ['app.js', appSrc, 'v4.1.0</div>']
];
for (const [f, src, s] of need) {
  if (!src.includes(s)) errs.push(f + ' 缺关键代码: ' + s);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const wait = ms => new Promise(r2 => setTimeout(r2, ms));
  let seq = 0;
  const openApp = async flags => {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(MOCK_IIFE);
    await page.evaluateOnNewDocument(f => { Object.assign(window, f); }, flags || {});
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
    await wait(1100);
    return page;
  };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v33-${String(++seq).padStart(2, '0')}-${n}.png` });
  const goMineSub = async (page, k) => {
    await page.evaluate(k2 => {
      const els = [...document.querySelectorAll('#tabs button')];
      const e = els.find(x => (x.textContent || '').includes('我的'));
      if (e) e.click();
    }, k);
    await wait(300);
    await page.evaluate(k2 => {
      const it = document.querySelector('[data-act="mineGo"][data-k="' + k2 + '"]');
      if (it) it.click();
    }, k);
    await wait(300);
  };
  const wantOn = async (page, txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };

  // 1. 设置子页：指示器卡 + 默认值（pinOn 开、randOffset 5px）
  let p = await openApp({});
  await goMineSub(p, 'settings');
  await wantOn(p, '指示器与防检测', '设置卡标题');
  await wantOn(p, '坐标指示器', '开关行');
  await wantOn(p, '落点偏移', '滑杆行');
  const st1 = await p.evaluate(() => {
    const sw = document.querySelector('[data-toggle="pinOn"]');
    const sl = document.querySelector('[data-pref="randOffset"]');
    return { on: !!(sw && sw.classList.contains('on')), v: sl ? sl.value : null };
  });
  if (!st1.on) errs.push('场景1：坐标指示器应默认开（pinOn 未存 → 显示开）');
  if (st1.v !== '5') errs.push('场景1：落点偏移默认应为 5，实际 ' + st1.v);
  await shot(p, 'pin-settings-default');
  await p.close();

  // 2. 开关闭环：点关 → savePrefs false → 重渲染仍关 → 再点开
  p = await openApp({});
  await goMineSub(p, 'settings');
  await p.evaluate(() => document.querySelector('[data-toggle="pinOn"]').click());
  await wait(400);
  let st2 = await p.evaluate(() => ({
    on: document.querySelector('[data-toggle="pinOn"]').classList.contains('on'),
    last: window.__lastPrefs || ''
  }));
  if (st2.on) errs.push('场景2：点击后开关应变关');
  if (st2.last.indexOf('"pinOn":false') < 0) errs.push('场景2：savePrefs 应落 "pinOn":false，实际 ' + st2.last);
  await p.evaluate(() => document.querySelector('[data-toggle="pinOn"]').click());
  await wait(400);
  st2 = await p.evaluate(() => ({
    on: document.querySelector('[data-toggle="pinOn"]').classList.contains('on'),
    last: window.__lastPrefs || ''
  }));
  if (!st2.on || st2.last.indexOf('"pinOn":true') < 0) errs.push('场景2：再点应回开并落 "pinOn":true');
  await p.close();

  // 3. 偏移滑杆闭环：拖动（input 更新 label）→ 松手（change 保存）→ 重开页面回读
  p = await openApp({});
  await goMineSub(p, 'settings');
  await p.evaluate(() => {
    const sl = document.querySelector('[data-pref="randOffset"]');
    sl.value = '9';
    sl.dispatchEvent(new Event('input', { bubbles: true }));   // 拖动中：label 变 9px
    sl.dispatchEvent(new Event('change', { bubbles: true }));  // 松手：savePrefs
  });
  await wait(500);
  const st3 = await p.evaluate(() => ({
    v: document.querySelector('[data-pref="randOffset"]').value,
    txt: document.body.innerText,
    last: window.__lastPrefs || ''
  }));
  if (st3.last.indexOf('"randOffset":9') < 0) errs.push('场景3：savePrefs 应落 "randOffset":9，实际 ' + st3.last);
  if (st3.txt.indexOf('9px') < 0) errs.push('场景3：label 应显示 9px（input 即时更新）');
  await shot(p, 'pin-offset-9');
  await p.close();

  // 4. 关于子页 CHANGELOG 头条 v4.1.0
  p = await openApp({});
  await goMineSub(p, 'about');
  const aboutTxt = await p.evaluate(() => document.body.innerText);
  if (!/v4\.1\.0/.test(aboutTxt) || aboutTxt.indexOf('坐标指示器') < 0) {
    errs.push('场景4：关于页 CHANGELOG 应以 v4.1.0 打头');
  }
  await shot(p, 'changelog-410');
  await p.close();

  await browser.close();
  if (errs.length) {
    console.log('❌ 冒烟有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  } else {
    console.log('✅ v4.1.0 坐标指示器 + 防检测偏移冒烟通过（3 张截图）');
  }
})().catch(e => { console.error('冒烟崩了：', e); process.exit(1); });
