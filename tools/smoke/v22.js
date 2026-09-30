// v2.2.0 冒烟：运行日志面板重做（时间 / 级别着色 / 过滤 / 清空 / 复制）
//             + 设置页两个新开关（运行浮层 / 音量键急停）
//
// mock.js 里的 log 还是老格式（纯字符串数组），这里额外注入一份结构化日志，
// 顺便把两个新桥接（clearLogs / copyText）和两项新配置补上。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { MOCK_IIFE } = require('./mock.js');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const NOW = Date.now();
const LOGS = [
  { t: NOW - 9000, lv: 0, m: '开跑：每天签到', c: '09:12:01' },
  { t: NOW - 8000, lv: 0, m: '先等 3 秒，你快切过去', c: '09:12:02' },
  { t: NOW - 5000, lv: 0, m: '打开 com.tencent.mm', c: '09:12:05' },
  { t: NOW - 4500, lv: 1, m: '没找到「签到」，再等等', c: '09:12:06' },
  { t: NOW - 3000, lv: 0, m: '找到「签到」@540,1180', c: '09:12:08' },
  { t: NOW - 2000, lv: 2, m: '动作出错：手势被系统拒了', c: '09:12:09' },
  { t: NOW - 1000, lv: 1, m: '没找到图「跳过广告」', c: '09:12:10' }
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
  await page.evaluateOnNewDocument(lg => {
    window.__logs = lg;
  }, LOGS);
  await page.evaluateOnNewDocument(() => {
    const orig = window.app;
    window.app = Object.assign({}, orig, {
      status: () => JSON.stringify({
        running: true, current: 'a1', acc: true, overlay: true,
        recording: false, touch: true, ball: true,
        log: window.__logs,
        prog: '5/9', runName: '每天签到',
        screen: { w: 1080, h: 1920 }, vars: [], js: false
      }),
      prefs: () => JSON.stringify({
        ballSize: 54, ballAlpha: 0.88, speed: 1, mode: 'normal', vibrate: true,
        boot: false, theme: 'orange', lastScript: 'a1',
        runOverlay: true, volStop: false
      }),
      clearLogs: () => { window.__logs = []; return 'ok'; },
      copyText: s => { window.__copied = s; return 'ok'; }
    });
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = n => page.screenshot({ path: `${OUT}/v22-${n}.png` });
  // 设置页很长，一屏截不下「运行中的小帮手」那块，滚到它再拍
  const shotAt = async (n, txt) => {
    await page.evaluate(t => {
      const all = [...document.querySelectorAll('*')];
      const e = all.filter(x => (x.textContent || '').includes(t) && x.children.length === 0).pop();
      if (e) e.scrollIntoView({ block: 'center' });
    }, txt);
    await wait(360);
    await page.screenshot({ path: `${OUT}/v22-${n}.png` });
  };
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
  };
  const click = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const e = [...document.querySelectorAll(sel)].find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('找不到可点元素: ' + sel + ' / ' + txt);
    await wait(400);
  };
  await wait(650);

  // 1. 进「我的 → 运行日志」
  await click('#tabs button', '我的');
  await click('.item', '运行日志');
  await want('运行状态', '日志页');
  await want('正在跑', '日志页');
  // 运行状态条要把「跑哪个脚本 + 跑到第几步」显示出来
  await want('每天签到', '日志页头');
  await want('第 5/9 步', '日志页头');
  await shot('01-log-running');

  // 2. 每行都带时间，且按级别分了色
  const rows = await page.evaluate(() => [...document.querySelectorAll('.log .lg')].map(x => ({
    cls: x.className, t: (x.querySelector('.lt') || {}).textContent || '', m: x.innerText
  })));
  if (rows.length !== LOGS.length) {
    errs.push('日志行数不对，期望 ' + LOGS.length + ' 实际 ' + rows.length);
  }
  if (!rows.every(r => /^\d{2}:\d{2}:\d{2}$/.test(r.t))) {
    errs.push('有的日志行没显示时间：' + JSON.stringify(rows.map(r => r.t)));
  }
  const errRow = rows.find(r => r.m.includes('动作出错'));
  const warnRow = rows.find(r => r.m.includes('没找到「签到」'));
  const infoRow = rows.find(r => r.m.includes('开跑'));
  if (!errRow || !errRow.cls.includes('lv2')) errs.push('出错日志没标成 lv2：' + JSON.stringify(errRow));
  if (!warnRow || !warnRow.cls.includes('lv1')) errs.push('提醒日志没标成 lv1：' + JSON.stringify(warnRow));
  if (!infoRow || !infoRow.cls.includes('lv0')) errs.push('普通日志没标成 lv0：' + JSON.stringify(infoRow));
  await want('1 条出错', '统计行');
  await want('2 条提醒', '统计行');
  await shot('02-log-levels');

  // 3. 「只看提醒」过滤：普通日志消失，提醒和出错留下
  await click('[data-act="logFilter"]', '全部');
  await want('只看提醒', '过滤按钮');
  const filtered = await page.evaluate(() => [...document.querySelectorAll('.log .lg')].map(x => x.innerText));
  if (filtered.length !== 3) errs.push('过滤后应该剩 3 条（2 提醒 + 1 出错），实际 ' + filtered.length);
  if (filtered.some(x => x.includes('开跑'))) errs.push('过滤后普通日志还在');
  await shot('03-log-filtered');
  await click('[data-act="logFilter"]', '只看提醒');   // 切回全部

  // 4. 复制：三条都带上时间
  await click('[data-act="logCopy"]', '复制');
  const copied = await page.evaluate(() => window.__copied || '');
  if (!copied) errs.push('点复制没拿到文本');
  else {
    const n = copied.split('\n').length;
    if (n !== LOGS.length) errs.push('复制的行数不对：' + n);
    if (!/\d{2}:\d{2}:\d{2}/.test(copied)) errs.push('复制的日志没带时间');
    if (!copied.includes('动作出错')) errs.push('复制的日志内容不全');
  }

  // 5. 清空
  await click('[data-act="logClear"]', '清空');
  const after = await page.evaluate(() => window.__logs.length);
  if (after !== 0) errs.push('清完之后后端日志还有 ' + after + ' 条');
  await wait(300);
  await shot('04-log-cleared');

  // 6. 设置页两个新开关 + 运行浮层默认开、音量键默认关
  await click('#tabs button', '我的');
  await click('.item', '设置');
  await want('运行中的小帮手', '设置页');
  await want('运行浮层', '设置页');
  await want('音量键急停', '设置页');
  const sw = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.switch[data-toggle]').forEach(s => {
      out[s.dataset.toggle] = s.classList.contains('on');
    });
    return out;
  });
  if (sw.runOverlay !== true) errs.push('运行浮层应该默认开，实际 ' + sw.runOverlay);
  if (sw.volStop !== false) errs.push('音量键急停应该默认关（否则调音量误停），实际 ' + sw.volStop);
  await shotAt('05-settings-new', '运行浮层');

  // 7. 开关能真的改（走 savePrefs）
  await page.evaluate(() => document.querySelector('.switch[data-toggle="volStop"]').click());
  await wait(400);
  const volOn = await page.evaluate(() => document.querySelector('.switch[data-toggle="volStop"]').classList.contains('on'));
  if (!volOn) errs.push('音量键急停开关点了没变开');
  await shotAt('06-volstop-on', '运行浮层');

  // 8. 老格式日志（纯字符串）不能崩 —— 升级上来的用户就是这种数据
  await page.evaluate(() => {
    window.__logs = ['开跑：老脚本', '没找到「确定」，跳过', '动作出错：x'];
  });
  await click('#tabs button', '我的');
  await click('.item', '运行日志');
  await want('开跑：老脚本', '老格式日志');
  const legacy = await page.evaluate(() => [...document.querySelectorAll('.log .lg')].map(x => x.className));
  if (!legacy.some(c => c.includes('lv2'))) errs.push('老格式里的「动作出错」没被认成错误级');
  if (!legacy.some(c => c.includes('lv1'))) errs.push('老格式里的「没找到…跳过」没被认成提醒级');
  await shot('07-log-legacy');

  await browser.close();
  if (errs.length) {
    console.log('❌ v2.2.0 有问题 ' + errs.length + ' 处：');
    errs.forEach(e => console.log('  · ' + e));
    process.exit(1);
  }
  console.log('✅ v2.2.0 冒烟通过：日志时间/级别/过滤/复制/清空 + 两个新开关 + 老格式兼容，共 7 张截图');
})();
