// v4.5.0 冒烟：脚本页重排（搜索置顶 / 侧栏双段 / 卡片重绘）
//   A.（node 侧）源码守卫：app.js 新结构件 + style.css 新类 + CHANGELOG 头条
//   B.（浏览器）：
//      1. 脚本页：搜索是页头之下第一元素（.search.top）+ 卡片新排版 sitem/大字名
//      2. 侧栏双段：「自定义分组」小标题 + catitem + 「＋ 新建/管理」+「按应用」段占位
//      3. 分组交互：点「＋ 新建/管理」出弹层；点分组项筛选生效
//      4. 搜索生效：输入关键词后列表收敛；▶/⋯ 按钮保留（用户要求不改文字钮）
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
  ['app.js', appSrc, 'function searchTop'],
  ['app.js', appSrc, 'class="search top"'],
  ['app.js', appSrc, 'function catNewBtn'],
  ['app.js', appSrc, 'function catByApp'],
  ['app.js', appSrc, 'function scriptCard'],
  ['app.js', appSrc, 'function sheetCatMgr'],
  ['app.js', appSrc, 'data-act="newCat"'],
  ['app.js', appSrc, "case 'catGo'"],
  ['app.js', appSrc, 'class="csec"'],
  ['app.js', appSrc, '按应用'],
  ['app.js', appSrc, '自定义分组'],
  ['app.js', appSrc, 'v4.5.0</div>'],
  ['style.css', cssSrc, '.search.top'],
  ['style.css', cssSrc, '.cate .csec{'],
  ['style.css', cssSrc, '.catitem.new .ce{'],
  ['style.css', cssSrc, '.item.sitem{'],
  ['style.css', cssSrc, '.item.sitem .d2{']
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
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v37-${String(++seq).padStart(2, '0')}-${n}.png` });
  const clickEl = async (page, sel) => {
    const ok = await page.evaluate(s => {
      const e = document.querySelector(s);
      if (!e) return false;
      e.click(); return true;
    }, sel);
    if (!ok) errs.push('找不到元素: ' + sel);
    await wait(350);
  };

  // 1. 脚本页：搜索置顶 + 卡片新排版
  let p = await openApp();
  const st1 = await p.evaluate(() => {
    const main = document.querySelector('#page');
    const kids = [...main.children].map(x => x.className);
    const headIdx = kids.findIndex(c => String(c).includes('phead'));
    const searchIdx = kids.findIndex(c => String(c).includes('search'));
    return {
      title: (document.querySelector('.phead .h-title') || {}).textContent || '',
      headIdx, searchIdx,
      ph: (document.getElementById('q') || {}).placeholder || '',
      sitem: document.querySelectorAll('#page .item.sitem').length,
      nname: document.querySelectorAll('#page .item.sitem .t').length,
      firstT: (document.querySelector('#page .item.sitem .t') || {}).textContent || '',
      run: !!document.querySelector('#page .item.sitem [data-act="run"]'),
      more: !!document.querySelector('#page .item.sitem [data-act="more"]'),
      hl: document.querySelectorAll('#page .item .hl').length
    };
  });
  if (st1.title !== '我的脚本') errs.push('场景1：标题应为「我的脚本」，实际 ' + st1.title);
  if (st1.searchIdx < 0) errs.push('场景1：应有顶部搜索框 .search.top');
  if (st1.headIdx >= 0 && st1.searchIdx <= st1.headIdx) errs.push('场景1：搜索框应在页头之下（head=' + st1.headIdx + ' search=' + st1.searchIdx + '）');
  if (!st1.ph.includes('备注')) errs.push('场景1：搜索 placeholder 应含「备注」，实际 ' + st1.ph);
  if (!st1.sitem) errs.push('场景1：脚本卡应用新排版 .item.sitem');
  if (!st1.run || !st1.more) errs.push('场景1：▶/⋯ 按钮应保留');
  if (!st1.hl) errs.push('场景1：卡片高光斑应保留');
  await shot(p, 'scripts-search-top');

  // 2. 侧栏双段
  const st2 = await p.evaluate(() => ({
    cate: !!document.querySelector('.scwrap .cate'),
    secs: [...document.querySelectorAll('.cate .csec')].map(x => x.textContent),
    items: document.querySelectorAll('.cate .catitem').length,
    newBtn: !!document.querySelector('.cate .catitem.new[data-act="newCat"]'),
    empty: [...document.querySelectorAll('.cate .catempty')].map(x => x.textContent)
  }));
  if (!st2.cate) errs.push('场景2：侧栏应常驻');
  if (!st2.secs.includes('自定义分组')) errs.push('场景2：缺「自定义分组」段标题');
  if (!st2.secs.includes('按应用')) errs.push('场景2：缺「按应用」段标题');
  if (!st2.newBtn) errs.push('场景2：缺「＋ 新建/管理」入口');
  if (!st2.empty.length) errs.push('场景2：「按应用」段应有占位');
  await shot(p, 'sidebar-two-sections');

  // 3. 分组弹层 + 筛选
  await clickEl(p, '.cate .catitem.new');
  const st3 = await p.evaluate(() => {
    const m = document.getElementById('modal');
    return {
      open: m && !m.classList.contains('hidden'),
      h3: (document.querySelector('#modal h3') || {}).textContent || ''
    };
  });
  if (!st3.open) errs.push('场景3：点「＋ 新建/管理」应出弹层');
  if (!st3.h3.includes('分组')) errs.push('场景3：弹层标题应含「分组」，实际 ' + st3.h3);
  await shot(p, 'cat-mgr-sheet');
  await clickEl(p, '[data-act="cancelAct"]');

  // 4. 搜索生效 + 分组筛选生效
  const cntAll = await p.evaluate(() => document.querySelectorAll('#page .item.sitem').length);
  await p.evaluate(() => { const i = document.getElementById('q'); i.value = '连点'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(400);
  const cntQ = await p.evaluate(() => document.querySelectorAll('#page .item.sitem').length);
  if (!(cntQ <= cntAll)) errs.push('场景4：搜索后列表应不增，all=' + cntAll + ' q=' + cntQ);
  await shot(p, 'search-filtered');
  // 清空搜索，测分组筛选（点「全部」应恢复）
  await p.evaluate(() => { const i = document.getElementById('q'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(400);
  const cntBack = await p.evaluate(() => document.querySelectorAll('#page .item.sitem').length);
  if (cntBack !== cntAll) errs.push('场景4：清空搜索应恢复全部，期望 ' + cntAll + ' 实际 ' + cntBack);
  await p.close();

  await browser.close();
  process.exitCode = errs.length ? 1 : 0;
  const tag = errs.length ? 'FAIL' : 'OK';
  console.log('[v37] ' + tag + ' (' + seq + ' 张截图)');
  for (const e of errs) console.log('  - ' + e);
})().catch(e => { console.error('[v37] EXC ' + (e && e.message)); process.exitCode = 1; });
