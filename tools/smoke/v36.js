// v4.4.0 冒烟：全面重绘对齐液态玻璃原型（标题头/就绪卡/编辑器 ed-top+statline+动作坞/高光斑）
//   A.（node 侧）源码守卫：app.js 结构件 + style.css 新类 + CHANGELOG 头条
//   B.（浏览器）：
//      1. 脚本页：h-title「我的脚本」+ 权限就绪卡 perm + 卡片高光斑 hl
//      2. 编辑器：ed-top（圆返回 + 大字名 + 圆播放）+ statline 三胶囊 + 底部动作坞 d1/d2；点 d1 直达录制页
//      3. 录制页：标题头 + hero 状态卡共存（v4.3.0 断言兼容）
//      4. 市场页/我的页：标题头就位
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { MOCK_IIFE } = require('./mock.js');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

let seq = 0;   // 截图序号（模块级，收尾日志要用）
const errs = [];

// ---------- A. 源码守卫 ----------
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('assets/www/app.js');
const cssSrc = read('assets/www/style.css');
const need = [
  ['app.js', appSrc, 'function pageHead'],
  ['app.js', appSrc, 'function permCard'],
  ['app.js', appSrc, 'function estSec'],
  ['app.js', appSrc, 'class="ed-top"'],
  ['app.js', appSrc, 'class="statline"'],
  ['app.js', appSrc, 'class="dock"'],
  ['app.js', appSrc, 'data-tab="record"'],
  ['app.js', appSrc, 'class="hl"'],
  ['app.js', appSrc, '权限全部就绪'],
  ['app.js', appSrc, 'v4.4.0</div>'],
  ['style.css', cssSrc, '.h-title{'],
  ['style.css', cssSrc, '.perm{'],
  ['style.css', cssSrc, '.item .hl,'],
  ['style.css', cssSrc, '.ed-top{'],
  ['style.css', cssSrc, '.statline{'],
  ['style.css', cssSrc, '.dock{'],
  ['style.css', cssSrc, '.tb-fab::after{']
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
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v36-${String(++seq).padStart(2, '0')}-${n}.png` });
  const clickEl = async (page, sel) => {
    const ok = await page.evaluate(s => {
      const e = document.querySelector(s);
      if (!e) return false;
      e.click(); return true;
    }, sel);
    if (!ok) errs.push('找不到元素: ' + sel);
    await wait(350);
  };
  const goTab = async (page, t) => {
    await clickEl(page, '#tabs button[data-tab="' + t + '"]');
    await wait(250);
  };

  // 1. 脚本页：标题头 + 就绪卡 + 高光斑
  let p = await openApp();
  const st1 = await p.evaluate(() => ({
    title: (document.querySelector('.phead .h-title') || {}).textContent || '',
    sub: (document.querySelector('.phead .h-sub') || {}).textContent || '',
    perm: !!document.querySelector('.perm .pi'),
    permTxt: (document.querySelector('.perm .pd') || {}).textContent || '',
    hl: document.querySelectorAll('#page .item .hl').length,
    hero: !!document.querySelector('.hero')
  }));
  if (st1.title !== '我的脚本') errs.push('场景1：标题应为「我的脚本」，实际 ' + st1.title);
  if (!st1.sub.includes('全部离线可用')) errs.push('场景1：副标题缺关键词');
  if (!st1.perm) errs.push('场景1：权限就绪卡应显示（mock 权限齐全）');
  if (!st1.permTxt.includes('无障碍已连接')) errs.push('场景1：就绪卡文案缺关键词');
  if (!st1.hl) errs.push('场景1：脚本卡应有高光斑 hl');
  if (!st1.hero) errs.push('场景1：运行状态 hero 应保留');
  await shot(p, 'scripts-phead');
  await p.close();

  // 2. 编辑器：ed-top + statline + dock；d1 直达录制页
  p = await openApp();
  await clickEl(p, '[data-act="edit"][data-id="a4"]');
  await wait(250);
  const st2 = await p.evaluate(() => ({
    bk: !!document.querySelector('.ed-top .bk[data-act="back"]'),
    name: document.getElementById('sname') && document.getElementById('sname').classList.contains('en'),
    play: !!document.querySelector('.ed-top .play[data-act="run"]'),
    stats: [...document.querySelectorAll('.statline .st')].map(x => x.textContent),
    dock: !!document.querySelector('.dock .d2[data-act="addAct"]'),
    d1: (document.querySelector('.dock .d1') || {}).textContent || '',
    save: !!document.querySelector('[data-act="save"]'),
    acts: document.querySelectorAll('#page .item').length
  }));
  if (!st2.bk || !st2.name || !st2.play) errs.push('场景2：ed-top 三件套不齐（bk/name.en/play）');
  if (st2.stats.length < 3) errs.push('场景2：统计胶囊应 ≥3 枚，实际 ' + st2.stats.length);
  if (!st2.stats.some(x => x.includes('预计'))) errs.push('场景2：缺「预计」耗时胶囊');
  if (!st2.stats[0].includes('3 个动作')) errs.push('场景2：动作数胶囊应为 3（a4 有 3 步），实际 ' + st2.stats[0]);
  if (!st2.dock || !st2.d1.includes('录制')) errs.push('场景2：动作坞 d1/d2 不齐');
  if (!st2.save) errs.push('场景2：保存按钮应保留');
  await shot(p, 'editor-edtop-dock');
  await clickEl(p, '.dock .d1');
  const st2b = await p.evaluate(() => ({
    tab: document.querySelector('#tabs button.on') && document.querySelector('#tabs button.on').dataset.tab,
    title: (document.querySelector('.phead .h-title') || {}).textContent || ''
  }));
  if (st2b.tab !== 'record') errs.push('场景2：点动作坞录制应切到录制页，实际 ' + st2b.tab);
  await p.close();

  // 3. 录制页：标题头 + hero 共存
  p = await openApp();
  await goTab(p, 'record');
  const st3 = await p.evaluate(() => ({
    title: (document.querySelector('.phead .h-title') || {}).textContent || '',
    heroHt: (document.querySelector('.hero .ht') || {}).textContent || ''
  }));
  if (st3.title !== '操作录制') errs.push('场景3：标题应为「操作录制」');
  if (!st3.heroHt) errs.push('场景3：hero 状态卡应保留（v4.3.0 兼容）');
  await shot(p, 'record-phead');
  await p.close();

  // 4. 市场页 + 我的页标题头
  p = await openApp();
  await goTab(p, 'market');
  const st4 = await p.evaluate(() => ({
    title: (document.querySelector('.phead .h-title') || {}).textContent || '',
    hl: document.querySelectorAll('#page .item .hl').length
  }));
  if (st4.title !== '脚本市场') errs.push('场景4：市场标题不对：' + st4.title);
  if (!st4.hl) errs.push('场景4：市场卡应有高光斑');
  await shot(p, 'market-phead');
  await goTab(p, 'mine');
  const st5 = await p.evaluate(() =>
    (document.querySelector('.phead .h-title') || {}).textContent || '');
  if (st5 !== '我的') errs.push('场景4：我的标题不对：' + st5);
  await shot(p, 'mine-phead');
  await p.close();

  await browser.close();
  process.exitCode = errs.length ? 1 : 0;
  const tag = errs.length ? 'FAIL' : 'OK';
  console.log('[v36] ' + tag + ' (' + seq + ' 张截图)');
  for (const e of errs) console.log('  - ' + e);
})().catch(e => { console.error('[v36] EXC ' + (e && e.message)); process.exitCode = 1; });
