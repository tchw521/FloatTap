// v2.7.0 冒烟：多任务基建（runId 徽标 + status runs 聚合）
//   A.（node 侧）源码守卫：app.js 有 logBadge 渲染分支、style.css 有 .lrb 样式
//      （内核侧 LogLine/RunSlot/Bus 由 F.java 与 SlotTest 守，这里只看前端两件套）
//   B.（浏览器）
//      1. 日志徽标：r=1/2/3 渲染 #r，r=0 系统行与老格式字符串行无徽标
//      2. 「只看提醒」过滤：徽标不参与统计与过滤，系统 lv1 行正常
//      3. 「复制」：拿到的是纯文本（无徽标），条数对
//      4. status 新旧字段并存：runs 数组塞两条 + running=true，大卡「正在跑」不回归
//      5. 恢复 idle：runs 清空后「空闲中」不回归
//      6. 「关于」页正常
//   浮层是原生 View，浏览器测不了——浮层多条验收靠 SlotTest 形状断言 + 真机人工。
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
if (!appSrc.includes('function logBadge')) errs.push('app.js 缺 logBadge 渲染分支');
if (!cssSrc.includes('.log .lrb')) errs.push('style.css 缺 .lrb 徽标样式');

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
  const shot = n => page.screenshot({ path: `${OUT}/v27-${n}.png` });
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
  const evalOf = fn => page.evaluate(fn);

  await wait(1000);

  // 进「我的」→「运行日志」
  await clickSel('#tabs button', '我的');
  await clickSel('[data-act="mineGo"]', '运行日志');

  // 1. 徽标渲染：r>0 有 #r，r=0 系统行与老格式行没有
  const badges = await evalOf(() => ({
    n: document.querySelectorAll('.lrb').length,
    texts: [...document.querySelectorAll('.lrb')].map(x => x.textContent),
    sysClean: [...document.querySelectorAll('.lg')]
      .filter(x => /已连上无障碍服务|音量键急停/.test(x.textContent))
      .every(x => !x.querySelector('.lrb')),
    legacyClean: [...document.querySelectorAll('.lg')]
      .filter(x => x.textContent.includes('比色 #12c46a'))
      .every(x => !x.querySelector('.lrb')),
    legacyText: [...document.querySelectorAll('.lg')]
      .some(x => x.textContent.includes('比色 #12c46a → 命中'))
  }));
  if (badges.n !== 8) errs.push('徽标数应 8（r1×3+r2×4+r3×1），实际 ' + badges.n);
  const wantSeq = ['#1', '#1', '#1', '#2', '#2', '#2', '#2', '#3'];
  if (JSON.stringify(badges.texts) !== JSON.stringify(wantSeq))
    errs.push('徽标序列不对：' + JSON.stringify(badges.texts));
  if (!badges.sysClean) errs.push('r=0 系统行不该有徽标');
  if (!badges.legacyClean || !badges.legacyText) errs.push('老格式字符串行渲染坏了或缺徽标豁免');
  await want('已连上无障碍服务', '日志页（r=0 系统行文本）');
  await shot('01-log-badges');

  // 2. 过滤：徽标不参与过滤/统计——只剩 lv1 系统行，「共 11 条」统计仍看全部
  await clickSel('[data-act="logFilter"]', '全部');
  await want('音量键急停（长按）', '过滤后（lv1 系统行）');
  await wantNo('开跑：每天签到', '过滤后');
  await want('共 11 条', '统计条数（不受过滤与徽标影响）');
  await want('1 条提醒', '提醒计数');
  await shot('02-log-filter');

  // 3. 切回全部并复制：复制的是纯文本（首行无徽标、共 11 行）
  await clickSel('[data-act="logFilter"]', '只看提醒');
  await clickSel('[data-act="logCopy"]', '复制');
  const cp = await evalOf(() => window.__lastCopy || '');
  const lines = cp.split('\n');
  if (lines.length !== 11) errs.push('复制行数应 11，实际 ' + lines.length);
  if (lines[0] !== '已连上无障碍服务') errs.push('复制首行应是纯文本「已连上无障碍服务」，实际「' + lines[0] + '」');
  if (!cp.includes('开跑：每天签到')) errs.push('复制内容缺日志正文');
  await want('日志已复制（11 条）', '复制 toast');
  await shot('03-log-copy');

  // 4. status 新旧字段并存：runs 塞两条 + running=true → 大卡「正在跑」不回归
  await evalOf(() => {
    window.__mockRunning = true;
    window.__runs = [
      { runId: 1, state: 'running', id: 'a1', name: '每天签到', prog: '3/9', total: 9, elapsed: 5, js: false },
      { runId: 2, state: 'paused', id: 'a2', name: '连点器', prog: '', total: 0, elapsed: 12, js: true }
    ];
  });
  await clickSel('[data-act="logRefresh"]', '刷新');
  const htRun = await evalOf(() => { const e = document.querySelector('.ht'); return e ? e.textContent : ''; });
  if (!htRun.includes('正在跑') || !htRun.includes('每天签到'))
    errs.push('大卡标题应是「正在跑 · 每天签到」，实际「' + htRun + '」');
  await want('正在跑', 'running 大卡（runs 字段并存下不回归）');
  await shot('04-running-card');

  // 5. 恢复 idle：runs 清空 →「空闲中」不回归
  await evalOf(() => { window.__mockRunning = false; window.__runs = []; });
  await clickSel('[data-act="logRefresh"]', '刷新');
  await want('空闲中', '恢复 idle 大卡');
  await shot('05-back-idle');

  // 6. 「关于」页正常（日志 sub 页没有返回按钮——tab 点击会清 sub 直接回 mine 主页）
  await clickSel('#tabs button', '我的');
  await clickSel('[data-act="mineGo"]', '关于');
  await want('懒人点击器 v1.6.0', '关于页版本号（mock info）');
  await want('更新日志', '关于页 CHANGELOG 区');
  await shot('06-about');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.7.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v2.7.0 多任务基建冒烟通过（6 张截图）');
})();
