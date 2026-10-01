// v3.2.0 冒烟：权限强引导 + 主流手机适配
//   A.（node 侧）源码守卫：
//      - app.js 有 BRAND_HINTS/brandHint/permGuide/permGuideSheet、heroCard 拼接 permGuide、
//        boot() 首启自动弹（guideShown）、case 'guideDone'
//      - JsApi.java status 加 "linked"/"manufacturer"；FloatService.startRun 失败落 note（sysNote 节流）；
//        TapService onUnbind 也广播 service off（全文件应出现 2 处：onDestroy + onUnbind）
//   B.（浏览器；mock 开关 __mockAcc/__mockOverlay/__mockLinked/__mockBrand + prefs 真 merge）。
//      每个场景独立 page（evaluateOnNewDocument 注入 flags），互不污染：
//      1. 首启强引导：acc=false + Xiaomi → 自动弹引导层（①开无障碍 ②授权悬浮窗 + 小米「后台弹出界面」提示）
//         → 点「我知道了」关层 + guideShown 落 savePrefs
//      2. 不二弹：guideShown 已存 → 不弹层，但主卡下常驻引导卡仍在（①行 + 小米提示）
//      3. 只缺悬浮窗：overlay=false → 弹层只有②；关掉后常驻卡还在
//      4. 假死态：acc=true + linked=false → 「服务没连上」+ 去重开（不出现①②行）
//      5. 厂商分支：HUAWEI → 「应用启动管理」文案；generic → 通用兜底文案
//      6. 全开零引导：不设开关 → 无引导卡 + hero 正常 + runrow 回归（v3.0 会话卡不回归）
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
const jsApiSrc = fs.readFileSync(path.join(ROOT, 'src', 'com', 'lazytap', 'clicker', 'JsApi.java'), 'utf8');
const floatSrc = fs.readFileSync(path.join(ROOT, 'src', 'com', 'lazytap', 'clicker', 'FloatService.java'), 'utf8');
const tapSrc = fs.readFileSync(path.join(ROOT, 'src', 'com', 'lazytap', 'clicker', 'TapService.java'), 'utf8');
const need = [
  ['app.js', appSrc, 'var BRAND_HINTS'],
  ['app.js', appSrc, 'function brandHint'],
  ['app.js', appSrc, 'function permGuide'],
  ['app.js', appSrc, 'function permGuideSheet'],
  ['app.js', appSrc, "+ permGuide(st)"],
  ['app.js', appSrc, "case 'guideDone'"],
  ['app.js', appSrc, '!S.prefs.guideShown && broken'],
  ['JsApi.java', jsApiSrc, '"linked"'],
  ['JsApi.java', jsApiSrc, '"manufacturer"'],
  ['FloatService.java', floatSrc, 'note("悬浮窗没授权，运行浮层没显示'],
  ['FloatService.java', floatSrc, 'note("运行浮层没拉起来']
];
for (const [f, src, s] of need) {
  if (!src.includes(s)) errs.push(f + ' 缺关键代码: ' + s);
}
// onUnbind 补广播：TapService 全文应有 2 处 "service", "off"（onDestroy + onUnbind）
const emitCount = (tapSrc.match(/Bus\.emit\("service", "off"\)/g) || []).length;
if (emitCount < 2) errs.push('TapService.java 应有 2 处 service off 广播（onDestroy + onUnbind），实际 ' + emitCount);

// 测试数据基准（抄 v30/v31）：2 引擎会话，场景 6 的 runrow 回归用
const RUNS2 = [
  { runId: 1, state: 'running', id: 'a1', name: '每天签到', prog: 3, total: 9, elapsed: 52000, js: false },
  { runId: 2, state: 'paused', id: 'a2', name: '连点器', prog: 0, total: 0, elapsed: 12000, js: false }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const wait = ms => new Promise(r2 => setTimeout(r2, ms));
  let seq = 0;
  // 每个场景独立 page：flags 在导航前注入页面上下文（Object.assign(window, flags)），
  // reload/新场景互不污染——首启弹层只在 boot() 跑，不能用「设开关再等」模拟
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
  const shot = (page, n) => page.screenshot({ path: `${OUT}/v32-${String(++seq).padStart(2, '0')}-${n}.png` });
  const wantOn = async (page, txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const wantNo = async (page, txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (ok) errs.push(at + ' 里不该出现「' + txt + '」');
  };
  const modalOpen = page => page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));

  // 1. 首启强引导：acc+overlay 都缺 + Xiaomi → 自动弹层（①② + 小米路径提示）→ 我知道了 → 关层 + guideShown 落盘
  let p = await openApp({ __mockAcc: false, __mockOverlay: false, __mockBrand: 'Xiaomi' });
  if (!(await modalOpen(p))) errs.push('场景1：权限没给齐时首启应自动弹引导层');
  await wantOn(p, '先给两个权限', '首启弹层标题');
  await wantOn(p, '开无障碍服务', '弹层①按钮');
  await wantOn(p, '授权悬浮窗', '弹层②按钮');
  await wantOn(p, '后台弹出界面', '弹层小米路径提示');
  await shot(p, 'first-guide-sheet');
  const clicked = await p.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="guideDone"]')][0];
    if (b) { b.click(); return true; }
    return false;
  });
  if (!clicked) errs.push('场景1：找不到「我知道了」按钮');
  await wait(420);
  if (await modalOpen(p)) errs.push('场景1：点我知道了后弹层应关闭');
  const lp = await p.evaluate(() => window.__lastPrefs || '');
  if (lp.indexOf('guideShown') < 0) errs.push('场景1：guideShown 应随弹层落 savePrefs，实际 ' + lp);
  await p.close();

  // 2. 不二弹：guideShown 已存 → 弹层不出现，但主卡下常驻引导卡仍在
  p = await openApp({ __mockAcc: false, __mockBrand: 'Xiaomi', __mockPrefsObj: { guideShown: true } });
  if (await modalOpen(p)) errs.push('场景2：guideShown 已存不该再自动弹层');
  await wantOn(p, '先把权限给齐', '常驻引导卡标题');
  await wantOn(p, '去开启', '常驻卡①按钮');
  await wantOn(p, '后台弹出界面', '常驻卡厂商提示');
  await shot(p, 'sticky-guide-card');
  await p.close();

  // 3. 只缺悬浮窗：弹层只有②；关掉后常驻卡仍在（权限没齐就一直显示）
  p = await openApp({ __mockOverlay: false });
  await wantOn(p, '先给两个权限', '场景3弹层出现');
  await wantOn(p, '授权悬浮窗', '场景3②按钮');
  await wantNo(p, '开无障碍服务', '场景3不该有①按钮');
  await p.evaluate(() => { const b = [...document.querySelectorAll('[data-act="guideDone"]')][0]; if (b) b.click(); });
  await wait(420);
  await wantOn(p, '先把权限给齐', '场景3关层后常驻卡仍在');
  await wantOn(p, '去授权', '场景3常驻卡②按钮');
  await wantNo(p, '去开启', '场景3常驻卡不该有①按钮（acc 已开）');
  await wantOn(p, '电池优化白名单', '场景3 generic 通用提示');
  await shot(p, 'overlay-only');
  await p.close();

  // 4. 假死态：acc 开但 linked=false → 「服务没连上」提示，不出现①②行
  p = await openApp({ __mockAcc: true, __mockLinked: false, __mockPrefsObj: { guideShown: true } });
  await wantOn(p, '服务没连上', '假死提示');
  await wantOn(p, '关掉再开一次', '假死操作指引');
  await wantNo(p, '① 无障碍服务——点击的引擎', '假死时不该有①行（开关是开的）');
  await wantNo(p, '② 悬浮窗权限', '假死时不该有②行');
  await shot(p, 'acc-dead-state');
  await p.close();

  // 5. 厂商分支：HUAWEI → 启动管理文案；generic → 通用兜底
  p = await openApp({ __mockAcc: false, __mockBrand: 'HUAWEI', __mockPrefsObj: { guideShown: true } });
  await wantOn(p, '应用启动管理', '华为路径提示');
  await shot(p, 'huawei-hint');
  await p.close();
  p = await openApp({ __mockAcc: false, __mockBrand: 'Sony', __mockPrefsObj: { guideShown: true } });
  await wantOn(p, '其他手机', '未识别品牌走通用提示');
  await p.close();

  // 6. 全开零引导：不设任何开关 → 无引导卡 + hero 正常 + runrow 回归
  p = await openApp({});
  await wantNo(p, '先把权限给齐', '权限齐了不该有引导卡');
  await wantNo(p, '服务没连上', '不该有假死提示');
  await wantOn(p, '一切就绪', 'hero 空闲态回归');
  // runrow 回归：setRuns 2 条（走 我的 → 运行日志 → 刷新，v30/v31 同款流程）
  await p.evaluate(() => {
    const els = [...document.querySelectorAll('#tabs button')];
    const e = els.find(x => (x.textContent || '').includes('我的'));
    if (e) e.click();
  });
  await wait(500);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll('[data-act="mineGo"]')];
    const e = els.find(x => (x.textContent || '').includes('运行日志'));
    if (e) e.click();
  });
  await wait(500);
  await p.evaluate(rs => {
    window.__runs = JSON.parse(JSON.stringify(rs));
    delete window.__mockRunning; delete window.__mockPaused; delete window.__mockJs;
  }, RUNS2);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('[data-act="logRefresh"]')][0];
    if (b) b.click();
  });
  await wait(700);
  await p.evaluate(() => {
    const els = [...document.querySelectorAll('#tabs button')];
    const e = els.find(x => (x.textContent || '').includes('脚本'));
    if (e) e.click();
  });
  await wait(700);
  const h6 = await p.evaluate(() => ({
    ht: (document.querySelector('.ht') || {}).textContent || '',
    n: document.querySelectorAll('.runrow').length
  }));
  if (!h6.ht.includes('2 条会话在跑')) errs.push('场景6：runrow 回归——大卡应「2 条会话在跑」，实际「' + h6.ht + '」');
  if (h6.n !== 2) errs.push('场景6：runrow 应 2 条，实际 ' + h6.n);
  await shot(p, 'all-ok-runrow');
  await p.close();

  await browser.close();
  if (errs.length) {
    console.log('❌ v3.2.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v3.2.0 权限强引导 + 厂商适配冒烟通过（' + seq + ' 张截图）');
})();
