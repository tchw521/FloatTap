// v3.0.0 冒烟：多任务并行（会话大卡 runrow / 列表双高亮 / 单停 / 停全部 / 变量分组 / 满员 toast）
//   A.（node 侧）源码守卫：app.js 有 runRows/fmtElapsed 渲染、style.css 有 .runrow 系列样式
//      （内核侧 RunnerPool/Lanes/LogStore 由 PoolTest 守，这里只看前端三件套）
//   B.（浏览器，mock 用 __runs 驱动多会话——形状与 RunSlot.snapshot 一致）
//      1. 大卡 2 条 runrow：标题「2 条会话在跑」+ #1/#2 徽标 + 进度/时长 + paused 行按钮语义
//      2. 三条含 JS：js 会话无 ⏸ 按钮、引擎会话有；单条 .rs 分别走 进度 与 fmtElapsed
//      3. 列表双高亮：runs 里的两个脚本 .item.run，不在 runs 里的不高亮，运行项按钮变 ■
//      4. 单停：row1 的 ■ → runrow 少一条、#2 还在、__lastStopArg 记对、大卡降级「已暂停 · 连点器」
//      5. 停全部：立刻刹车 → 回空闲「一切就绪」+「▶ 跑上次那个」
//      6. 变量页分组：varsList 3 组 →「会话 #N · 名字」+ 变量 chip
//      7. 满员 toast：__mockFull → 点 ▶ →「会话已满」
//      8. 徽标回归：v2.7 的日志徽标路径不回归 + 关于页版本号
//   浮层多条是原生 View，浏览器测不了——靠 SlotTest 形状断言 + 真机人工。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { MOCK_IIFE } = require('./mock.js');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const errs = [];

// ---------- A. 源码守卫 ----------
const appSrc = fs.readFileSync(path.join(ROOT, 'assets', 'www', 'app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'assets', 'www', 'style.css'), 'utf8');
if (!appSrc.includes('function runRows')) errs.push('app.js 缺 runRows 渲染');
if (!appSrc.includes('function fmtElapsed')) errs.push('app.js 缺 fmtElapsed 时长格式化');
if (!cssSrc.includes('.runrow{')) errs.push('style.css 缺 .runrow 样式');
if (!cssSrc.includes('.runrow .rt .lrb')) errs.push('style.css 缺 runrow 徽标样式');

// 测试数据基准（形状 = RunSlot.snapshot）：2 引擎（running/paused）+ 1 JS
const RUNS3 = [
  { runId: 1, state: 'running', id: 'a1', name: '每天签到', prog: 3, total: 9, elapsed: 52000, js: false },
  { runId: 2, state: 'paused', id: 'a2', name: '连点器', prog: 0, total: 0, elapsed: 12000, js: false },
  { runId: 3, state: 'running', id: 'a5', name: '循环签到', prog: 0, total: 0, elapsed: 3000, js: true }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(MOCK_IIFE);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
  const wait = ms => new Promise(r2 => setTimeout(r2, ms));
  const shot = n => page.screenshot({ path: `${OUT}/v30-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const wantNo = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (ok) errs.push(at + ' 里不该出现「' + txt + '」');
  };
  const clickSel = async (sel, txt) => {
    const tryOnce = () => page.evaluate((sel, txt) => {
      const els = [...document.querySelectorAll(sel)];
      const e = els.find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    let ok = await tryOnce();
    if (!ok) { await wait(500); ok = await tryOnce(); }
    if (!ok) errs.push('找不到可点击元素: ' + sel + ' / ' + txt);
    await wait(420);
  };
  const evalOf = (fn, arg) => page.evaluate(fn, arg);

  // 设 __runs 并让前端拉到：轮询只在日志 sub 页跑（1.2s），所以统一走
  // 「我的 → 运行日志 → 设 __runs → 点刷新」再切回目标 tab。开关全删，让派生接管。
  const setRuns = async runs => {
    await clickSel('#tabs button', '我的');
    await clickSel('[data-act="mineGo"]', '运行日志');
    await evalOf(rs => {
      window.__runs = JSON.parse(JSON.stringify(rs));
      delete window.__mockRunning; delete window.__mockPaused; delete window.__mockJs;
    }, runs);
    await clickSel('[data-act="logRefresh"]', '刷新');
  };
  const goScripts = () => clickSel('#tabs button', '脚本');

  await wait(1000);

  // 1. 大卡 2 条 runrow
  await setRuns(RUNS3.slice(0, 2));
  await goScripts();
  const h1 = await evalOf(() => ({
    ht: (document.querySelector('.ht') || {}).textContent || '',
    n: document.querySelectorAll('.runrow').length,
    row1: (document.querySelector('.runrow[data-runid="1"]') || {}).textContent || '',
    row2: (document.querySelector('.runrow[data-runid="2"]') || {}).textContent || '',
    p1: (document.querySelector('.runrow[data-runid="1"] [data-act="pauseRun"]') || {}).textContent || '',
    p2: (document.querySelector('.runrow[data-runid="2"] [data-act="pauseRun"]') || {}).textContent || ''
  }));
  if (!h1.ht.includes('2 条会话在跑')) errs.push('大卡标题应「2 条会话在跑」，实际「' + h1.ht + '」');
  if (h1.n !== 2) errs.push('runrow 应 2 条，实际 ' + h1.n);
  if (!h1.row1.includes('每天签到') || !h1.row1.includes('#1')) errs.push('row1 缺名字/#1：' + h1.row1);
  if (!h1.row1.includes('3/9')) errs.push('row1 应显示进度 3/9（total>0 不走时长）：' + h1.row1);
  if (!h1.row2.includes('连点器') || !h1.row2.includes('#2')) errs.push('row2 缺名字/#2：' + h1.row2);
  if (h1.p1 !== '⏸') errs.push('running 行暂停键应显示 ⏸，实际「' + h1.p1 + '」');
  if (h1.p2 !== '▶') errs.push('paused 行暂停键应显示 ▶（恢复语义），实际「' + h1.p2 + '」');
  await want('■ 停全部', '多会话大卡（停全部按钮）');
  await shot('01-hero-2rows');

  // 2. 三条含 JS：js 会话无 ⏸；单条 .rs 分别走进度与 fmtElapsed
  await setRuns(RUNS3);
  await goScripts();
  const h2 = await evalOf(() => ({
    ht: (document.querySelector('.ht') || {}).textContent || '',
    n: document.querySelectorAll('.runrow').length,
    r1: (document.querySelector('.runrow[data-runid="1"]') || {}).textContent || '',
    r3: (document.querySelector('.runrow[data-runid="3"]') || {}).textContent || '',
    jsPause: !!document.querySelector('.runrow[data-runid="3"] [data-act="pauseRun"]'),
    jsStop: !!document.querySelector('.runrow[data-runid="3"] [data-act="stopRun"]'),
    enPause: !!document.querySelector('.runrow[data-runid="1"] [data-act="pauseRun"]')
  }));
  if (!h2.ht.includes('3 条会话在跑')) errs.push('大卡标题应「3 条会话在跑」，实际「' + h2.ht + '」');
  if (h2.n !== 3) errs.push('runrow 应 3 条，实际 ' + h2.n);
  if (h2.jsPause) errs.push('js 会话（#3）不该有暂停键');
  if (!h2.jsStop) errs.push('js 会话（#3）该有停止键');
  if (!h2.enPause) errs.push('引擎会话（#1）该有暂停键');
  if (!h2.r1.includes('3/9')) errs.push('row1 进度渲染回归：' + h2.r1);
  if (!h2.r3.includes('循环签到') || !h2.r3.includes('#3')) errs.push('row3 缺名字/#3：' + h2.r3);
  if (!h2.r3.includes('3s')) errs.push('row3 应显示 fmtElapsed(3000)=「3s」：' + h2.r3);
  await shot('02-hero-3rows-js');

  // 3. 列表双高亮：runs 里的 a1/a2 高亮，a3/a4 不高亮；运行项按钮变 ■
  await setRuns(RUNS3.slice(0, 2));
  await goScripts();
  const h3 = await evalOf(() => ({
    runItems: [...document.querySelectorAll('.item.run')].map(x => x.dataset.id),
    a3run: !!document.querySelector('.item[data-id="a3"] [data-act="run"]'),
    a1stop: !!document.querySelector('.item[data-id="a1"] [data-act="stop"]')
  }));
  if (JSON.stringify(h3.runItems.sort()) !== JSON.stringify(['a1', 'a2']))
    errs.push('运行高亮应只有 a1/a2，实际 ' + JSON.stringify(h3.runItems));
  if (!h3.a3run) errs.push('不在 runs 里的 a3 该有 ▶ 可跑');
  if (!h3.a1stop) errs.push('在跑的 a1 列表按钮应是 ■ 停止');
  await shot('03-list-dual-highlight');

  // 4. 单停：row1 的 ■ → 少一条、#2 还在、参数记对、大卡降级单会话
  await evalOf(() => { const b = document.querySelector('.runrow[data-runid="1"] [data-act="stopRun"]'); if (b) b.click(); });
  await wait(900);
  const h4 = await evalOf(() => ({
    n: document.querySelectorAll('.runrow').length,
    row2: !!document.querySelector('.runrow[data-runid="2"]'),
    row1: !!document.querySelector('.runrow[data-runid="1"]'),
    ht: (document.querySelector('.ht') || {}).textContent || '',
    lastStop: window.__lastStopArg
  }));
  if (h4.lastStop !== '1') errs.push('stopRun 参数应记 "1"，实际 ' + JSON.stringify(h4.lastStop));
  if (h4.n !== 1 || h4.row1 || !h4.row2) errs.push('单停后应只剩 #2 一条（n=' + h4.n + '）');
  if (!h4.ht.includes('已暂停 · 连点器')) errs.push('单会话降级应「已暂停 · 连点器」，实际「' + h4.ht + '」');
  await shot('04-single-stop');

  // 5. 停全部：立刻刹车 → 空闲
  await clickSel('[data-act="stop"]', '刹车');
  await wait(600);
  const h5 = await evalOf(() => ({
    n: document.querySelectorAll('.runrow').length,
    ht: (document.querySelector('.ht') || {}).textContent || '',
    lastRun: !!document.querySelector('[data-act="runLast"]')
  }));
  if (h5.n !== 0) errs.push('停全部后不该还有 runrow（n=' + h5.n + '）');
  if (!h5.ht.includes('一切就绪')) errs.push('停全部后大卡应「一切就绪」，实际「' + h5.ht + '」');
  if (!h5.lastRun) errs.push('空闲态应有「▶ 跑上次那个」');
  await shot('05-back-idle');

  // 6. 变量页分组：3 条会话 → 编辑 a1 →「会话 #N · 名字」三组
  await setRuns(RUNS3);
  await goScripts();
  await clickSel('[data-act="edit"]', '每天签到');
  await wait(400);
  await want('会话 #1 · 每天签到', '变量分组（#1）');
  await want('会话 #2 · 连点器', '变量分组（#2）');
  await want('会话 #3 · 循环签到', '变量分组（#3）');
  await want('n = 2', '变量 chip（n）');
  await want('gap = 1000', '变量 chip（gap）');
  await shot('06-vars-grouped');

  // 7. 满员 toast：__mockFull → 点 a3 的 ▶ →「会话已满」
  await goScripts();   // tab 点击清掉编辑 sub
  await evalOf(() => {
    window.__mockFull = true;
    const b = document.querySelector('.item[data-id="a3"] [data-act="run"]');
    if (b) b.click();
  });
  await want('会话已满', '满员 toast');
  await evalOf(() => { window.__mockFull = false; });
  await shot('07-full-toast');

  // 8. 徽标回归：v2.7 的日志徽标路径不回归
  await clickSel('#tabs button', '我的');
  await clickSel('[data-act="mineGo"]', '运行日志');
  const h8 = await evalOf(() => ({
    n: document.querySelectorAll('.lrb').length,
    texts: [...document.querySelectorAll('.lrb')].map(x => x.textContent),
    sysClean: [...document.querySelectorAll('.lg')]
      .filter(x => /已连上无障碍服务|音量键急停/.test(x.textContent))
      .every(x => !x.querySelector('.lrb'))
  }));
  if (h8.n !== 8) errs.push('徽标数应 8，实际 ' + h8.n);
  const wantSeq = ['#1', '#1', '#1', '#2', '#2', '#2', '#2', '#3'];
  if (JSON.stringify(h8.texts) !== JSON.stringify(wantSeq))
    errs.push('徽标序列不对：' + JSON.stringify(h8.texts));
  if (!h8.sysClean) errs.push('r=0 系统行不该有徽标');
  await want('共 11 条', '日志统计不回归');
  await shot('08-log-badges');

  // 关于页（日志 sub 无返回按钮——tab 点击清 sub 回 mine 主页）
  await clickSel('#tabs button', '我的');
  await clickSel('[data-act="mineGo"]', '关于');
  await want('懒人点击器 v1.6.0', '关于页版本号（mock info）');
  await shot('09-about');

  await browser.close();
  if (errs.length) {
    console.log('❌ v3.0.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v3.0.0 多任务并行冒烟通过（9 张截图）');
})();
