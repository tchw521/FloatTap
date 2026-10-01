// v2.6.0 冒烟：JS 查找补齐 + 子脚本传参
//   A.（node 侧）把真 runner.js 塞进 vm 跑一遍：新函数都在，
//      tapText/hasText 真的把 id/desc/re 透传进动作 JSON，runSub 链路能通
//   B.（浏览器）a6 的 runSub 摘要、表单（sel:scripts 下拉排除自己）、
//      传参 JSON 落盘还是字符串、JS API 文档有新函数
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { MOCK_IIFE } = require('./mock.js');
const OUT = path.join(__dirname, '..', '..', 'docs', 'screens');
fs.mkdirSync(OUT, { recursive: true });

const errs = [];

// ---------- A. 真源码：runner.js 在 node 的 vm 里跑 ----------
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'www', 'runner.js'), 'utf8');
const sb = { console: { log: () => {} }, JSON, Promise, Error, parseFloat, isNaN, String };
vm.createContext(sb);
vm.runInContext(src, sb);   // runner.js 挂 window 存在时用 window，否则 globalThis —— 这里落到 sandbox 本身
const api = sb.__api;
if (!api) { errs.push('runner.js 跑完没挂出 __api'); }
else {
  for (const f of ['tapText', 'hasText', 'findText', 'waitText', 'runSub']) {
    if (typeof api[f] !== 'function') errs.push('runner.js 缺函数: ' + f);
  }
  // 抓动作 JSON 的桩：call(id, json) 记下 json 再同步回 ok
  sb.app = {
    call: (id, json) => { sb.__last = json; sb.__cb(id, { ok: 1, steps: 4, x: 11, y: 22 }); },
    sys: () => '{}'
  };
  const check = async (expr, name) => {
    const v = await vm.runInContext(expr, sb);
    if (!v) errs.push(name);
  };
  (async () => {
    await check(`(async()=>{
      await tapText('签到', { id: 'com.x:id/ok', desc: '按钮', re: '确定' });
      const a = JSON.parse(globalThis.__last);
      return a.t === 'find' && a.id === 'com.x:id/ok' && a.desc === '按钮' && a.re === '确定' && a.click === true;
    })()`, 'tapText 没把 id/desc/re 透传进 find 动作');
    await check(`(async()=>{
      await hasText('签到', { id: 'ok', desc: 'd', re: 'r' });
      const a = JSON.parse(globalThis.__last);
      return a.t === 'if' && a.id === 'ok' && a.desc === 'd' && a.re === 'r';
    })()`, 'hasText 没把 id/desc/re 透传进 if 动作');
    await check(`(async()=>{
      await tapText('签到'); const a = JSON.parse(globalThis.__last);
      return a.id === '' && a.desc === '' && a.re === '';
    })()`, '不带选项的 tapText 该把 id/desc/re 留空（向后兼容）');
    await check(`(async()=>{
      await findText('签到'); const a = JSON.parse(globalThis.__last);
      return a.t === 'find' && a.click === false && a.timeout === 0;
    })()`, 'findText 该是只找不点、不等');
    await check(`(async()=>{
      await waitText('签到'); const a = JSON.parse(globalThis.__last);
      return a.click === false && a.timeout === 10000;
    })()`, 'waitText 该默认等 10 秒');
    const r1 = await vm.runInContext(`(async()=>{
      const r = await runSub('签到子流程', { n: 3 });
      return JSON.stringify({ r: r, act: JSON.parse(globalThis.__last) });
    })()`, sb);
    const r = JSON.parse(r1);
    if (r.act.t !== 'runSub' || r.act.name !== '签到子流程' || r.act.args !== '{"n":3}')
      errs.push('runSub 传参没进动作 JSON：' + JSON.stringify(r.act));
    if (!r.r.ok || r.r.steps !== 4 || r.r.x !== 11 || r.r.y !== 22)
      errs.push('runSub 回值不对：' + JSON.stringify(r.r));
    if (errs.length) {
      console.log('❌ runner.js 源码验证失败：');
      errs.forEach(e => console.log('   - ' + e));
      process.exit(1);
    }
    console.log('runner.js 源码验证通过（透传 / 回值 / 向后兼容）');

    // ---------- B. 浏览器：表单与文档 ----------
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
    const shot = n => page.screenshot({ path: `${OUT}/v26-${n}.png` });
    const want = async (txt, at) => {
      const ok = await page.evaluate(t => document.body.innerText.includes(t), txt);
      if (!ok) errs.push(at + ' 里找不到「' + txt + '」');
    };
    const clickText = async (sel, txt) => {
      // 找不到先等 500ms 再试一次——列表是 rAF 节流渲染的，第一次常扑空
      const tryOnce = () => page.evaluate((sel, txt) => {
        const els = [...document.querySelectorAll(sel)];
        const e = els.find(x => (x.textContent || '').includes(txt));
        if (e) { e.click(); return true; }
        return false;
      }, sel, txt);
      let ok = await tryOnce();
      if (!ok) { await wait(500); ok = await tryOnce(); }
      if (!ok) {
        const dbg = await page.evaluate(sel => ({
          items: [...document.querySelectorAll('.item')].map(x => (x.textContent || '').replace(/\s+/g, ' ').slice(0, 60)),
          edits: [...document.querySelectorAll(sel)].map(x => (x.textContent || '').replace(/\s+/g, ' ').slice(0, 60)),
          sheetOpen: !!document.querySelector('#sheet'),
        }), sel);
        errs.push('找不到可点击元素: ' + sel + ' / ' + txt + ' | DOM=' + JSON.stringify(dbg));
      }
      await wait(420);
    };

    await wait(1000);

    // 1. 进 a6 编辑器：动作列表摘要一眼看出要跑谁、传什么
    await clickText('.item [data-act="edit"]', '带子脚本的母本');
    await want('跑子脚本「签到子流程」', '编辑器动作摘要');
    await want('传参 {"n":3}', '摘要里露出传参');
    await shot('01-editor-summary');

    // 2. 已在 a6 编辑器里，直接打开 runSub 表单
    await clickText('[data-act="editAct"]', '跑子脚本');
    const sel = await page.evaluate(() => {
      const s = document.querySelector('#sheet select[data-field="name"]');
      return s ? [...s.options].map(o => o.textContent) : null;
    });
    if (!sel) errs.push('runSub 表单没有脚本下拉');
    else {
      if (!sel.includes('每天签到')) errs.push('下拉里没有别的脚本（每天签到）');
      if (sel.includes('带子脚本的母本')) errs.push('下拉不该出现自己（自调用会死循环）');
      if (sel.includes('循环签到')) errs.push('下拉不该列 JS 脚本（当不了子脚本）');
    }
    const argsInput = await page.evaluate(() => {
      const i = document.querySelector('#sheet [data-field="args"]');
      return i ? i.value : null;
    });
    if (argsInput !== '{"n":3}') errs.push('表单没回填传参 JSON：' + JSON.stringify(argsInput));
    await shot('02-runsub-form');

    // 3. 改选择与传参，保存后落盘必须是字符串（JSON 不能被 num() 转掉）
    await page.evaluate(() => {
      const s = document.querySelector('#sheet select[data-field="name"]');
      if (s) {
        const opt = [...s.options].find(o => o.textContent === '连点器');
        if (opt) { s.value = opt.value; }
      }
    });
    await page.evaluate(() => {
      const i = document.querySelector('#sheet [data-field="args"]');
      if (i) i.value = '{"n":9,"tag":"A1"}';
    });
    await clickText('[data-act="saveAct"]', '保存');
    const saved = await page.evaluate(() => {
      const s = JSON.parse(window.app.scripts()).find(x => x.id === 'a6');
      const a = s.actions[0];
      return { name: a.name, args: a.args };
    });
    if (saved.name !== '连点器') errs.push('保存后脚本名不对：' + JSON.stringify(saved.name));
    if (saved.args !== '{"n":9,"tag":"A1"}') errs.push('传参 JSON 落盘被改：' + JSON.stringify(saved.args));
    await shot('03-saved');

    // 4. 新动作入口：加动作的类型列表里有「子脚本」
    await clickText('[data-act="addAct"]', '加动作');
    await want('子脚本', '加动作类型列表');
    await shot('04-add-types');
    await clickText('[data-act="cancelAct"]', '取消');

    // 5. JS API 文档：三个新函数 + tapText 说明升级
    await clickText('[data-act="back"]', '‹');
    await clickText('.item [data-act="edit"]', '循环签到');
    await clickText('[data-act="jsApi"]', '能调什么');
    for (const f of ['findText', 'waitText', 'runSub']) await want(f, 'JS API 文档');
    await want('找文字并点它；选项可带', 'tapText 文档说明该提到选项');
    await shot('05-js-api-doc');

    // 6. 空选择兜底：新加一个子脚本动作不选名字，摘要显示「未选」
    await clickText('[data-act="cancelAct"]', '关闭');
    await clickText('[data-act="back"]', '‹');
    await clickText('.item [data-act="edit"]', '连点器');
    await clickText('[data-act="addAct"]', '加动作');
    await clickText('[data-act="pickType"]', '子脚本');
    await wait(300);
    await clickText('[data-act="saveAct"]', '保存');
    await want('跑子脚本「未选」', '空名字的摘要兜底');
    await shot('06-unset-summary');

    await browser.close();
    if (errs.length) {
      console.log('❌ v2.6.0 冒烟失败：');
      errs.forEach(e => console.log('   - ' + e));
      process.exit(1);
    }
    console.log('✅ v2.6.0 子脚本与 JS 补齐冒烟通过（6 张截图）');
  })();
}
