// v3.1.0 冒烟：伪 OCR + 多任务深化
//   A.（node 侧）源码守卫：
//      - app.js 有 TYPES.findText / CTYPES.ttext / globalSet / lock 四组入口、
//        viewTextTpls / loadTextTpls、case 'shotTpl'/'ttplSaveGo'/'ttplDel'、sub 映射 ttpl、
//        以及 bindShotCanvas 框选保留 mode（v3.1.0 修的「字模存进图色库」bug，钉死防回归）
//      - runner.js api 表挂 gset/gget/glock/gunlock
//      - run-tests.sh 剥包清单含 Match/GlobalVars/Locks 三新类
//      - 内核 ScriptRunner.java 有 execFindText/execGlobalSet/execLock（细对账归 F.java 单测）
//   B.（浏览器，mock 加 __ttxts + listTextTpls/saveTextTpl/delTextTpl 桩）
//      1. 文字模板子页：hero + 空态提示 + 截图按钮（cap granted → 不是「先授权」）
//      2. 框选存字模全流程：面板标题「框一个字存成文字模板」→ 画布点两下定框
//         → 弹「存成文字模板」（丢 mode 的 bug 修复断言）→ 存「签到」→ 清单可见
//      3. 图色路径回归：同入口 mode=tpl 弹「存成模板图」（isTT=false 老路径不变形）
//      4. findText 动作：类型列表有「找文字(图)」→ 下拉选到字模 + 「管理文字模板」按钮
//         → 摘要「找字模「签到」像≥85%」
//      5. 多任务四动作：globalSet/globalGet/lock/unlock 摘要逐个对；globalSet 的
//         「插入变量」菜单里翻得到 {{g.名字}}（mock builtinVars 与真内核 BUILTIN 对齐）
//      6. 条件「屏幕上有字模」：清单摘要「有字模「未选」」→ 改 → 下拉选 → 「有字模「签到」」
//      7. 字模删除 → 空态回归 + findText 表单空态提示（下拉和提示走同一份 OPTS.ttpls）
//      8. JS API 文档：gset/gget/glock/gunlock 四条
//      9. 更新日志头条 v3.1.0「伪 OCR + 多任务深化」
//     10. runrow 回归抽查：v3.0 会话大卡不被本版改动破坏
//   浮层/真机截屏行为浏览器测不了——内核匹配算法归 MatchTest，字模存取归 TextTplStore 路径。
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
const runnerSrc = fs.readFileSync(path.join(ROOT, 'assets', 'www', 'runner.js'), 'utf8');
const testsSrc = fs.readFileSync(path.join(ROOT, 'tools', 'test', 'run-tests.sh'), 'utf8');
const runnerJava = fs.readFileSync(path.join(ROOT, 'src', 'com', 'lazytap', 'clicker', 'ScriptRunner.java'), 'utf8');
const need = [
  ['app.js', appSrc, "findText: { n: '找文字(图)'"],
  ['app.js', appSrc, "ttext: { n: '屏幕上有字模'"],
  ['app.js', appSrc, "globalSet: { n: '写共享变量'"],
  ['app.js', appSrc, "lock: { n: '拿互斥锁'"],
  ['app.js', appSrc, 'function viewTextTpls'],
  ['app.js', appSrc, 'function loadTextTpls'],
  ['app.js', appSrc, "case 'shotTpl'"],
  ['app.js', appSrc, "case 'ttplSaveGo'"],
  ['app.js', appSrc, "case 'ttplDel'"],
  ['app.js', appSrc, 'ttpl: viewTextTpls'],
  ['app.js', appSrc, 'S.pick = { mode: mode, x: rect.x0'],
  ['runner.js', runnerSrc, 'gset: gset, gget: gget'],
  ['runner.js', runnerSrc, 'glock: glock, gunlock: gunlock'],
  ['run-tests.sh', testsSrc, 'Match GlobalVars Locks'],
  ['ScriptRunner.java', runnerJava, 'execFindText'],
  ['ScriptRunner.java', runnerJava, 'execGlobalSet'],
  ['ScriptRunner.java', runnerJava, 'execLock']
];
for (const [f, src, s] of need) {
  if (!src.includes(s)) errs.push(f + ' 缺关键代码: ' + s);
}

// 测试数据基准（形状 = RunSlot.snapshot，抄 v30）：2 引擎会话
const RUNS2 = [
  { runId: 1, state: 'running', id: 'a1', name: '每天签到', prog: 3, total: 9, elapsed: 52000, js: false },
  { runId: 2, state: 'paused', id: 'a2', name: '连点器', prog: 0, total: 0, elapsed: 12000, js: false }
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
  const shot = n => page.screenshot({ path: `${OUT}/v31-${n}.png` });
  const want = async (txt, at) => {
    const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
    if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
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
  // 表单输入：赋值 + input 事件（change/select 同理），跟 v2cond 的惯例一致。
  // 注意 page.evaluate 只能带一个参数包——sel 和 val 必须打成数组传，拆开就是 undefined
  const fill = async (sel, val) => {
    await page.evaluate((sel, val) => {
      const i = document.querySelector(sel);
      if (!i) return;
      i.value = val;
      i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }, sel, val);
  };
  // 截图面板画布点两下定框（bindShotCanvas 是「两下点击」不是拖拽）：
  // 画布 CSS 尺寸按容器缩放，clientX/Y 用比例换算 → 图像坐标 (216,288)-(540,480)，框 324×192 > 4×4
  const pickOnCanvas = async () => {
    for (const p of [[0.2, 0.15], [0.5, 0.25]]) {
      await evalOf(p => {
        const cv = document.getElementById('sc');
        if (!cv) return;
        const r = cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('click', {
          clientX: r.left + r.width * p[0], clientY: r.top + r.height * p[1], bubbles: true
        }));
      }, p);
      await wait(350);
    }
  };
  const goMine = () => clickSel('#tabs button', '我的');
  const goScripts = () => clickSel('#tabs button', '脚本');

  await wait(1000);

  // 1. 文字模板子页：空态
  await goMine();
  await clickSel('[data-act="mineGo"]', '文字模板');
  await want('文字模板', '字模子页 hero');
  await want('还没有字模', '字模空态提示');
  await want('截图框一个字存字模', '截图按钮（granted 形态）');
  const t0 = await evalOf(() => (window.__ttxts || []).length);
  if (t0 !== 0) errs.push('开场 __ttxts 应为空，实际 ' + t0);
  await shot('01-ttpls-empty');

  // 2. 框选存字模全流程
  await clickSel('[data-act="shotTpl"]', '截图框一个字存字模');
  await wait(600);                       // 等 loadShot 把 mock 截图喂进画布
  await want('框一个字存成文字模板', '截图面板标题（ttpl 分支）');
  await pickOnCanvas();
  // 修复断言：S.pick.mode 没被覆盖丢掉 → 弹的是「存成文字模板」不是「存成模板图」
  await want('存成文字模板', '保存面板标题（isTT=true）');
  const ttBtn = await evalOf(() => !!document.querySelector('#sheet [data-act="ttplSaveGo"]'));
  if (!ttBtn) errs.push('保存面板没有 ttplSaveGo 按钮（mode 丢了会走 tplSaveGo）');
  await shot('02-ttpl-save-panel');
  await fill('#tplName', '签到');
  await clickSel('[data-act="ttplSaveGo"]', '保存');
  await want('签到', '保存后回到字模子页清单');
  const t1 = await evalOf(() => window.__ttxts);
  if (JSON.stringify(t1) !== JSON.stringify(['签到']))
    errs.push('__ttxts 应为 ["签到"]，实际 ' + JSON.stringify(t1));
  await shot('03-ttpl-list');

  // 3. 图色路径回归：mode=tpl 弹「存成模板图」（老路径不变形）
  await goMine();
  await clickSel('[data-act="mineGo"]', '设置');
  await clickSel('[data-act="goTpl"]', '模板图');
  await clickSel('[data-act="shotTpl"]', '截图框一块存模板');
  await wait(600);
  await pickOnCanvas();
  await want('存成模板图', '图色保存面板标题（isTT=false）');
  const tplBtn = await evalOf(() => !!document.querySelector('#sheet [data-act="tplSaveGo"]'));
  if (!tplBtn) errs.push('图色路径没有 tplSaveGo 按钮');
  await clickSel('[data-act="cancelAct"]', '取消');
  await shot('04-tpl-panel-unchanged');

  // 4. findText 动作：表单 + 摘要
  await goScripts();
  await clickSel('[data-act="edit"]', '跳广告');
  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '找文字(图)');
  await wait(400);
  const selOk = await evalOf(() => {
    const s = document.querySelector('#sheet [data-field="ttpl"]');
    return s ? [...s.options].map(o => o.value) : null;
  });
  if (!selOk || !selOk.includes('签到')) errs.push('findText 下拉没有「签到」：' + JSON.stringify(selOk));
  await want('管理文字模板', 'findText 表单的管理入口');
  await fill('#sheet [data-field="ttpl"]', '签到');
  await clickSel('#sheet .btn', '保存');
  await want('找字模「签到」像≥85%', 'findText 摘要');
  await shot('05-findtext-summary');

  // 5. 多任务四动作 + 插入变量 {{g.名字}}
  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '写共享变量');
  await fill('#sheet [data-field="v"]', '88');
  await clickSel('[data-act="insVar"]', '插入变量');
  await wait(300);
  // data-v 属性里才是 {{g.名字}}（innerText 显示的是「g.名字 · 描述」）
  const gv = await evalOf(() => {
    const m = document.getElementById('varmenu');
    return m ? [...m.querySelectorAll('[data-act="insVarGo"]')].map(b => b.dataset.v) : null;
  });
  if (!gv || !gv.includes('{{g.名字}}')) errs.push('插入变量菜单没有 {{g.名字}}：' + JSON.stringify(gv));
  await clickSel('[data-act="insVar"]', '插入变量');   // 收起菜单
  await clickSel('#sheet .btn', '保存');
  await want('共享变量 score = 88', 'globalSet 摘要');

  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '读共享变量');
  await clickSel('#sheet .btn', '保存');
  await want('共享变量 score → 本道 score', 'globalGet 摘要（to 空回退同名）');

  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '拿互斥锁');
  await fill('#sheet [data-field="name"]', '签到锁');
  await clickSel('#sheet .btn', '保存');
  await want('拿锁「签到锁」最多等 5000ms，拿到跳下一步 / 没拿到跳收工', 'lock 摘要');

  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '放互斥锁');
  await fill('#sheet [data-field="name"]', '签到锁');
  await clickSel('#sheet .btn', '保存');
  await want('放锁「签到锁」', 'unlock 摘要');
  await shot('06-multi-task-acts');

  // 6. 条件「屏幕上有字模」：新建 cond（CTYPES 按钮在条件判断表单里，「如果」是 if 不是 cond）
  //    → 加 → 改 → 选字模 → 确定
  await goScripts();
  await clickSel('[data-act="edit"]', '每天签到');
  await clickSel('[data-act="addAct"]', '加动作');
  await clickSel('#sheet .tile', '条件判断');
  await wait(400);
  await clickSel('.row .btn', '屏幕上有字模');     // 完整匹配——「屏幕上有字」不带「模」
  await wait(400);
  await want('有字模「未选」', 'ttext 默认摘要');
  await clickSel('.conditem .btn', '改');
  await wait(400);
  await want('文字模板', 'ttext 条件子页有字模下拉');
  await fill('#sheet [data-cfield="ttpl"]', '签到');
  await clickSel('#sheet .btn', '确定');
  await wait(400);
  await want('有字模「签到」', 'ttext 改后摘要');
  await shot('07-ttext-cond');
  await clickSel('#sheet .btn', '取消');

  // 7. 字模删除 → 空态 + findText 表单空态提示
  await goMine();
  await clickSel('[data-act="mineGo"]', '文字模板');
  await clickSel('[data-act="ttplDel"]', '删除');
  await want('还没有字模', '删除后空态回归');
  const t2 = await evalOf(() => window.__ttxts);
  if (JSON.stringify(t2) !== JSON.stringify([]))
    errs.push('删除后 __ttxts 应空，实际 ' + JSON.stringify(t2));
  await shot('08-ttpl-deleted');

  await goScripts();
  await clickSel('[data-act="edit"]', '跳广告');
  await clickSel('[data-act="editAct"]', '找文字(图)');
  await wait(400);
  await want('还没有字模，先去', 'findText 表单空态提示（OPTS.ttpls 已同步为空）');
  await clickSel('#sheet .btn', '取消');

  // 8. JS API 文档四条
  await goScripts();
  await clickSel('.item [data-act="edit"]', '循环签到');
  await clickSel('[data-act="jsApi"]', '能调什么');
  for (const f of ['gset(', 'gget(', 'glock(', 'gunlock(']) await want(f, 'JS API 文档');
  await shot('09-jsapi-shared');
  await clickSel('#sheet .btn', '关闭');

  // 9. 更新日志头条
  await goMine();
  await clickSel('[data-act="mineGo"]', '关于');
  await want('v3.1.0', '更新日志版本号');
  await want('伪 OCR + 多任务深化', '更新日志头条');
  await shot('10-changelog');

  // 10. runrow 回归抽查：v3.0 会话大卡不被本版破坏
  await goMine();
  await clickSel('[data-act="mineGo"]', '运行日志');
  await evalOf(rs => {
    window.__runs = JSON.parse(JSON.stringify(rs));
    delete window.__mockRunning; delete window.__mockPaused; delete window.__mockJs;
  }, RUNS2);
  await clickSel('[data-act="logRefresh"]', '刷新');
  await goScripts();
  const h10 = await evalOf(() => ({
    ht: (document.querySelector('.ht') || {}).textContent || '',
    n: document.querySelectorAll('.runrow').length
  }));
  if (!h10.ht.includes('2 条会话在跑')) errs.push('runrow 回归：大卡应「2 条会话在跑」，实际「' + h10.ht + '」');
  if (h10.n !== 2) errs.push('runrow 回归：应 2 条，实际 ' + h10.n);
  await shot('11-runrow-regression');

  await browser.close();
  if (errs.length) {
    console.log('❌ v3.1.0 冒烟失败：');
    errs.forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ v3.1.0 伪 OCR + 多任务深化冒烟通过（11 张截图）');
})();
