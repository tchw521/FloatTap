const puppeteer = require('puppeteer-core');
const fs = require('fs');
const OUT = require('path').join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const { MOCK_IIFE } = require('./mock.js');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const errs = [];
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(MOCK_IIFE);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///workspace/LazyTap/assets/www/index.html', { waitUntil: 'load' });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // v2.0.0 把「自动/设置/关于/日志」收进了「我的」，这里做一层兼容，
  // 让这份 v1.6~v1.8 的验证脚本继续可用（它验的功能点都还在）
  const OLD_TAB = { '自动': '自动触发', '设置': '设置', '关于': '关于', '日志': '运行日志' };
  const goTab = async name => {
    const sub = OLD_TAB[name];
    if (!sub) { await clickText('#tabs button', name); return; }
    await clickText('#tabs button', '我的');
    await clickText('.item', sub);
  };
  const shot = n => page.screenshot({ path: `${OUT}/v18-${n}.png` });
  const clickText = async (sel, txt) => {
    const ok = await page.evaluate((sel, txt) => {
      const els = [...document.querySelectorAll(sel)];
      const e = els.find(x => (x.textContent || '').includes(txt));
      if (e) { e.click(); return true; }
      return false;
    }, sel, txt);
    if (!ok) errs.push('找不到可点击元素: ' + sel + ' / ' + txt);
    await wait(420);
  };
  const has = async txt => page.evaluate(t => document.body.innerText.includes(t), txt);

  await wait(600);
  // mock 没注入的话，后面所有断言都是在空数据上「假通过」，先硬检查一次
  if (!(await page.evaluate(() => !!window.app))) {
    console.log('❌ 测试用的假桥没注入成功（window.app 不存在），后面的结果都不可信');
    if (errs.length) console.log('页面报错：\n' + errs.join('\n'));
    await browser.close();
    process.exit(1);
  }
  await shot('01-scripts');

  await goTab('自动');
  await shot('02-triggers');
  await clickText('[data-act]', '加一条规则');
  await shot('03-trigger-kinds');
  await clickText('[data-act="tgNew"]', '每天定时');
  await shot('04-trigger-form');
  await clickText('[data-act="cancelAct"]', '取消');

  await clickText('#tabs button', '脚本');
  await clickText('.item [data-act="edit"]', '每天签到');
  await shot('05-editor');
  await clickText('[data-act="editAct"]', '如果');
  await shot('06-action-if');
  await clickText('[data-act="cancelAct"]', '取消');
  await clickText('[data-act="addAct"]', '加动作');
  await shot('07-add-action-types');
  // 图色三个动作必须出现在类型列表里
  for (const t of ['找色', '比色', '找图']) if (!(await has(t))) errs.push('动作类型缺少: ' + t);
  await clickText('[data-act="pickType"]', '找色');
  await shot('08-action-findcolor');
  if (!(await has('截图取色'))) errs.push('找色表单缺少「截图取色」按钮');
  await clickText('[data-act="cancelAct"]', '取消');

  // ---------- v1.6.0：变量与表达式 ----------
  // 编辑器里应该有「变量」卡，列出脚本变量
  if (!(await has('变量'))) errs.push('编辑器缺少「变量」卡');
  if (!(await has('现在这几个变量的值'))) errs.push('变量卡没有显示运行时变量值');
  await shot('09-vars-card');
  // 加一个变量，再删掉，确保不报错
  const varCountBefore = await page.evaluate(() => document.querySelectorAll('[data-var-k]').length);
  await clickText('[data-act="addVar"]', '加个变量');
  const varCountAfter = await page.evaluate(() => document.querySelectorAll('[data-var-k]').length);
  if (varCountAfter !== varCountBefore + 1) errs.push('加变量没生效：' + varCountBefore + ' → ' + varCountAfter);
  const newName = await page.evaluate(() => {
    const all = document.querySelectorAll('[data-var-k]');
    return all.length ? all[all.length - 1].value : '';
  });
  if (!newName) errs.push('新变量没有默认名字');
  await clickText('[data-act="delVar"]', '✕');
  await shot('10-vars-after');

  // 新动作：赋值 / 运算 / 比变量
  await clickText('[data-act="addAct"]', '加动作');
  for (const t of ['赋值', '运算', '比变量']) if (!(await has(t))) errs.push('动作类型缺少: ' + t);
  await shot('11-add-action-vars');

  // 赋值表单：有「插入变量」按钮，展开后能看到变量
  await clickText('[data-act="pickType"]', '赋值');
  await shot('12-action-set');
  if (!(await has('插入变量'))) errs.push('赋值表单缺少「插入变量」按钮');
  await clickText('[data-act="insVar"]', '插入变量');
  await wait(300);
  if (!(await page.evaluate(() => !!document.getElementById('varmenu')))) errs.push('变量菜单没展开');
  await shot('13-varmenu');
  // 点一个变量，应该插进输入框且不关掉动作表单
  await clickText('#varmenu [data-act="insVarGo"]', 'n');
  await wait(300);
  const vAfter = await page.evaluate(() => {
    const i = document.querySelector('#sheet [data-field="v"]');
    return i ? i.value : null;
  });
  if (!vAfter || vAfter.indexOf('{{') < 0) errs.push('插入变量没写进输入框，值=' + vAfter);
  const sheetStillOpen = await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'));
  if (!sheetStillOpen) errs.push('插入变量后动作表单被关掉了（会丢掉其它字段）');
  await shot('14-after-insert');

  // 保存后值必须原样留住，不能被转成 0
  await clickText('[data-act="saveAct"]', '保存');
  await wait(300);
  const saved = await page.evaluate(() => {
    const s = JSON.parse(window.app.scripts()).find(x => x.id === 'a1');
    const a = s.actions[s.actions.length - 1];
    return a ? { t: a.t, k: a.k, v: a.v } : null;
  });
  if (!saved || saved.t !== 'set') errs.push('保存后没拿到新加的赋值动作');
  else {
    if (typeof saved.v !== 'string' || saved.v.indexOf('{{') < 0) errs.push('赋值的文本值被转成了 ' + JSON.stringify(saved.v));
    if (typeof saved.k !== 'string' || saved.k !== 'n') errs.push('变量名被转成了 ' + JSON.stringify(saved.k));
  }

  // 运算表单：试算按钮能给出结果
  await clickText('[data-act="editAct"]', '运算');
  await shot('15-action-math');
  if (!(await has('试算'))) errs.push('运算表单缺少「试算」按钮');
  await clickText('[data-act="tryExpr"]', '试算');
  await wait(300);
  await shot('16-tryexpr');

  // 坐标字段写变量：保存后也得留住字符串
  await clickText('[data-act="cancelAct"]', '取消');
  const coordAct = await page.evaluate(() => {
    const s = JSON.parse(window.app.scripts()).find(x => x.id === 'a1');
    return s.actions.filter(a => a.t === 'click' && String(a.x).indexOf('{{') === 0).length;
  });
  if (coordAct < 1) errs.push('坐标字段里的 {{}} 没保住');

  await clickText('#tabs button', '录制');
  await shot('17-record');
  await clickText('[data-act="recRefresh"]', '刷新');
  await clickText('[data-act="rec"]', '停止录制');

  await goTab('设置');
  await shot('18-settings');
  if (!(await has('图色识别'))) errs.push('设置页缺少「图色识别」卡');
  await clickText('[data-act="goTpl"]', '模板图');
  await shot('19-tpls');
  if (!(await has('跳过广告'))) errs.push('模板图列表为空');
  await clickText('[data-act="cancelAct"]', '关闭');

  // 截图取色面板
  await clickText('#tabs button', '脚本');
  await clickText('.item [data-act="edit"]', '跳广告');
  await shot('20-editor-graphics');
  await clickText('[data-act="editAct"]', '找色');
  await clickText('[data-act="pickColor"]', '截图取色');
  await wait(500);
  await shot('21-shot-pick');
  if (!(await page.evaluate(() => !!document.getElementById('sc')))) errs.push('截图取色画布没渲染');
  // 点一下画布取色
  await page.evaluate(() => {
    const cv = document.getElementById('sc');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width * 0.66, clientY: r.top + r.height * 0.16, bubbles: true }));
  });
  await wait(500);
  await shot('22-picked');
  await clickText('[data-act="cancelAct"]', '取消');
  await clickText('[data-act="back"]', '返回');

  await goTab('关于');
  await shot('23-about');

  // 深色模式
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await clickText('#tabs button', '脚本');
  await shot('24-dark-scripts');
  await goTab('设置');
  await shot('25-dark-settings');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // 平板 + 横屏
  await page.setViewport({ width: 900, height: 1100, deviceScaleFactor: 1 });
  await clickText('#tabs button', '脚本');
  await clickText('.item [data-act="edit"]', '跳广告');
  await shot('26-tablet-editor');
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1 });
  await clickText('[data-act="back"]', '返回');
  await shot('27-landscape-scripts');

  // ---------- v1.7.0：JS 脚本模式 ----------
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await clickText('#tabs button', '脚本');
  await page.evaluate(() => { const f = document.querySelector('.fab'); if (f) f.click(); });
  await wait(420);
  await shot('28-new-script');
  if (!(await has('JS 脚本'))) errs.push('新建里没有「JS 脚本」入口');

  await clickText('[data-act="newJs"]', 'JS 脚本');
  await wait(420);
  await shot('29-js-editor');
  if (!(await page.evaluate(() => !!document.getElementById('scode')))) errs.push('JS 编辑器没有代码框');
  if (!(await has('跑一下'))) errs.push('JS 编辑器缺少运行卡');

  await clickText('[data-act="jsDemo"]', '放个例子');
  await wait(320);
  const demo = await page.evaluate(() => document.getElementById('scode').value);
  if (demo.indexOf('findColor') < 0) errs.push('示例没放进代码框');
  await shot('30-js-demo');

  await page.evaluate(() => {
    document.getElementById('scode').value = 'await clickP(50, 50);\nawait sleep(500);';
  });
  await clickText('[data-act="save"]', '保存');
  await wait(420);
  const savedCode = await page.evaluate(() => {
    const s = JSON.parse(window.app.scripts()).find(x => x.kind === 'js' && String(x.code).indexOf('clickP') >= 0);
    return s ? s.code : null;
  });
  if (!savedCode) errs.push('JS 代码没存进脚本');
  await shot('31-js-list');
  if (!(await has('JS'))) errs.push('脚本列表没有 JS 标记');

  await clickText('.item [data-act="edit"]', '循环签到');
  await wait(420);
  await shot('32-js-open');
  const back = await page.evaluate(() => document.getElementById('scode').value);
  if (back.indexOf('findColor') < 0) errs.push('打开 JS 脚本时代码没回填');

  await clickText('[data-act="jsApi"]', '能调什么');
  await wait(420);
  await shot('33-js-api');
  for (const f of ['findColor', 'clickP', 'tapText', 'count']) {
    if (!(await has(f))) errs.push('API 文档缺少: ' + f);
  }
  await clickText('[data-act="cancelAct"]', '关闭');

  await clickText('[data-act="runJs"]', '跑脚本');
  await wait(420);
  await shot('34-js-run');
  await clickText('[data-act="back"]', '返回');

  // ---------- v1.8.0：分享码与脚本市场 ----------
  if (!(await has('脚本市场'))) errs.push('脚本页缺少「🏪 脚本市场」入口');
  await clickText('#tabs button', '市场');     // v2.0.0：市场成了独立 Tab
  await wait(420);
  await shot('35-market');
  for (const m of ['每日签到', '刷短视频', '找色点击']) {
    if (!(await has(m))) errs.push('市场里缺少: ' + m);
  }
  // 装一个进我的脚本
  const before = await page.evaluate(() => JSON.parse(window.app.scripts()).length);
  await clickText('[data-act="mktGet"]', '装');
  await wait(420);
  const after = await page.evaluate(() => JSON.parse(window.app.scripts()).length);
  if (after !== before + 1) errs.push('市场装脚本没生效：' + before + ' → ' + after);
  await shot('36-market-installed');

  // 分享码：生成 → 复制
  // 「⋯」按钮上只有 ⋯ 没有名字，得先定位到那一条再点
  const moreOk = await page.evaluate(() => {
    // 市场弹层虽然隐藏了但还在 DOM 里，里面也有「每日签到」，得排除掉
    const it = [...document.querySelectorAll('.item')]
      .filter(x => !x.closest('#modal'))
      .find(x => x.textContent.includes('每日签到'));
    const b = it && it.querySelector('[data-act="more"]');
    if (b) { b.click(); return true; }
    return false;
  });
  if (!moreOk) {
    const diag = await page.evaluate(() => ({
      items: [...document.querySelectorAll('.item')].filter(x => !x.closest('#modal'))
        .map(x => (x.textContent || '').replace(/\s+/g, ' ').slice(0, 40)),
      modal: document.getElementById('modal').classList.contains('hidden') ? 'hidden' : 'open',
      tab: (document.querySelector('#tabs .on') || {}).textContent || '?'
    }));
    errs.push('没找到「每日签到」的 ⋯ 菜单，列表=' + JSON.stringify(diag.items)
      + ' modal=' + diag.modal + ' 当前页=' + diag.tab);
  }
  await wait(400);
  await shot('37-more-menu');
  if (!(await has('生成分享码'))) errs.push('脚本菜单缺少「生成分享码」');
  await clickText('[data-act="share"]', '生成分享码');
  await wait(420);
  await shot('38-share-code');
  const shareVal = await page.evaluate(() => {
    const t = document.getElementById('shr');
    return t ? t.value : null;
  });
  if (!shareVal || shareVal.indexOf('LT1.') !== 0) errs.push('分享码没生成出来：' + String(shareVal).slice(0, 20));
  await clickText('[data-act="copyCode"]', '复制');
  await wait(300);

  // 导入：先试一段坏码，必须给提示而不是崩
  await clickText('[data-act="cancelAct"]', '关闭');
  await clickText('#tabs button', '市场');     // v2.0.0：市场成了独立 Tab
  await wait(320);
  await clickText('[data-act="importCode"]', '导入分享码');
  await wait(320);
  await shot('39-import-code');
  const impcOpen = await page.evaluate(() => {
    const m = document.getElementById('modal');
    return { ok: !!document.getElementById('impc'), txt: m ? m.innerText.slice(0, 100) : 'no modal' };
  });
  if (!impcOpen.ok) errs.push('导入弹层没打开，modal 里是：' + impcOpen.txt);
  await page.evaluate(() => { const e = document.getElementById('impc'); if (e) e.value = '这不是分享码'; });
  await clickText('[data-act="importCodeGo"]', '导入');
  await wait(420);
  await shot('40-import-bad');
  if (!(await has('这不像'))) errs.push('坏分享码没有给出提示');

  // 再导入一段对的
  await page.evaluate(() => { document.getElementById('impc').value = 'LT1.Zabcdef'; });
  await clickText('[data-act="importCodeGo"]', '导入');
  await wait(520);
  const imported = await page.evaluate(() => JSON.parse(window.app.scripts()).some(x => x.name === '导入的脚本'));
  if (!imported) errs.push('正确分享码没导入成功');
  await shot('41-import-ok');

  console.log(errs.length ? '❌ 错误:\n' + errs.join('\n') : '✅ 控制台零错误，共 41 张截图');
  await browser.close();
})();

