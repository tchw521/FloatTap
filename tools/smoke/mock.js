const MOCK_SRC = `() => {
  const scripts = [
    { id: 'a1', name: '每天签到', desc: '9 点自动', icon: '🎁', tone: 3, loop: false, loopCount: 1, runs: 12,
      startDelay: 3, jitter: true, stopOnFail: true,
      vars: [{ k: 'n', v: '0' }, { k: 'gap', v: '800' }],
      actions: [
        { t: 'launch', p: 'com.tencent.mm', d: 2500 },
        { t: 'find', s: '签到', click: true, contains: true, timeout: 5000, index: 1, d: 900 },
        { t: 'if', m: 'text', s: '领取成功', contains: true, go: 0, els: -1, d: 100 },
        { t: 'count', k: 'n', mode: 'add', v: 1, times: 3, go: -2, resetAfter: true, d: 100 },
        { t: 'set', k: 'note', v: '第 {{n}} 次', d: 100 },
        { t: 'math', k: 'gap', e: 'n*100+800', d: 100 },
        { t: 'click', x: '{{lastX}}', y: '{{lastY+20}}', d: '{{gap}}' },
        { t: 'cmpVar', l: 'n', op: '>=', r: '3', go: -1, els: 0, d: 100 },
        { t: 'multi', m: 'pinch', x: 50, y: 50, r: 90, ms: 500, pct: 1, d: 400 }
      ] },
    { id: 'a2', name: '连点器', desc: '按住别停', icon: '🔨', tone: 1, loop: true, runs: 88,
      actions: [{ t: 'click', x: 50, y: 62, pct: 1, d: 130, repeat: 50 }] },
    { id: 'a3', name: '刷视频', icon: '📺', tone: 4, loop: true, jitter: true,
      actions: [{ t: 'swipe', x1: 50, y1: 78, x2: 50, y2: 24, pct: 1, ms: 320, d: 2200 }] },
    { id: 'a4', name: '跳广告', icon: '⏭', tone: 5, loop: true,
      actions: [
        { t: 'findColor', c: '#ff3b30', sim: 92, click: true, timeout: 3000, d: 400 },
        // 注意：比色的跳转字段是 go/els，不是 hit/miss —— v2.3.0 以前这里写错了，
        // 冒烟渲染看着正常，真机上跳转其实是失效的
        { t: 'cmpColor', x: 540, y: 1180, c: '#12c46a', sim: 90, go: 0, els: -1, d: 100 },
        { t: 'findImage', tpl: '跳过广告', sim: 88, click: true, timeout: 3000, d: 400 }
      ] },
    { id: 'a5', name: '循环签到', desc: 'JS 写的', icon: '📜', tone: 6, kind: 'js',
      actions: [], vars: [],
      code: 'await sleep(2000);\\nfor (var i = 0; i < 5; i++) {\\n'
        + "  var p = await findColor('#FF6B35', { sim: 92 });\\n"
        + '  if (p) await click(p.x, p.y);\\n}\\n' },
    // v2.6.0：子脚本冒烟用的两块料——母本调子流程，传参 JSON 落盘必须是字符串
    { id: 'a6', name: '带子脚本的母本', icon: '📦', tone: 2,
      actions: [
        { t: 'runSub', name: '签到子流程', args: '{"n":3}', d: 300 },
        { t: 'click', x: 100, y: 200, d: 200 }
      ] },
    { id: 'a7', name: '签到子流程', icon: '🧩', tone: 3,
      actions: [
        { t: 'wait', ms: 500, d: 0 },
        { t: 'set', k: 'ret', v: 'ok-{{n}}', d: 100 }
      ] }
  ];
  const triggers = [
    { id: 't1', kind: 'time', script: 'a1', on: true, hh: 9, mm: 0 },
    { id: 't2', kind: 'notify', script: 'a4', on: true, text: '到账', pkg: '' },
    { id: 't3', kind: 'unlock', script: 'a2', on: false }
  ];
  // v2.7.0：日志带运行归属——r>0 渲染 #r 徽标，r=0 系统行无徽标；
  // 末尾留一条纯字符串（老格式兼容路径也要有人看着）。lv 与内核 LogLine 对齐。
  const logs = [
    { r: 0, m: '已连上无障碍服务', lv: 0 },
    { r: 1, m: '开跑：每天签到', lv: 0 },
    { r: 1, m: '先等 3 秒，你快切过去', lv: 0 },
    { r: 1, m: '打开 com.tencent.mm', lv: 0 },
    { r: 2, m: '找到「签到」@540,1180', lv: 0 },
    { r: 2, m: '✓ 有「领取成功」', lv: 0 },
    { r: 0, m: '音量键急停（长按）', lv: 1 },
    { r: 2, m: '计数 n = 1', lv: 0 },
    { r: 2, m: '找色 #ff3b30 → 命中 @720,310', lv: 0 },
    '比色 #12c46a → 命中',
    { r: 3, m: '找图 跳过广告 → 命中 @980,160', lv: 0 }
  ];
  window.__tpls = ['签到按钮', '跳过广告'];
  // v3.1.0：字模库桩——形状与 TextTplStore 对齐（names 就是字符串数组），
  // listTextTpls/saveTextTpl/delTextTpl 都从这仨走
  window.__ttxts = [];
  window.app = {
    scripts: () => JSON.stringify(window.__scripts || scripts),
    saveScripts: j => { try { window.__scripts = JSON.parse(j); } catch (e) {} return 'ok'; },
    triggers: () => JSON.stringify(triggers),
    saveTriggers: () => 'ok',
    fireTrigger: () => 'ok',
    togglePause: () => 'paused',   // v2.5.0：暂停⇄恢复，前端点了不能炸
    curApp: () => 'com.tencent.mm',
    // v3.0.0：status 全面模拟真内核的多会话形状——
    // runs 由 window.__runs 驱动（RunSlot.snapshot 形状 {runId,state,id,name,prog,total,elapsed,js}），
    // legacy 字段（running/paused/current/runName/prog）从 runs 降级派生（与真内核同规则）：
    // 不设 __runs 时行为与 v2.7 桩完全一致（__mockRunning 显式开关优先），旧冒烟零回归。
    // varsList 按会话分组；js 由 __mockJs 开关；__mockFull 打开后 run/runJs 返回满员错误。
    status: () => {
      const runs = window.__runs || [];
      const first = runs[0];
      const running = window.__mockRunning !== undefined
        ? !!window.__mockRunning
        : runs.some(r => r.state === 'running');
      const paused = window.__mockPaused !== undefined
        ? !!window.__mockPaused
        : (runs.length > 0 && runs.every(r => r.state === 'paused'));
      const vl = runs.map(r => ({ runId: r.runId, name: r.name,
        vars: [{ k: 'n', v: '2' }, { k: 'gap', v: '1000' }] }));
      // v3.2.0：acc/overlay/linked/manufacturer 可开关驱动（不设开关 = 全开 + 真 linked，
      // 与旧冒烟零回归）；linked 假死态 = acc 开但服务实例没连上
      const acc = window.__mockAcc !== undefined ? !!window.__mockAcc : true;
      return JSON.stringify({
        running: running, paused: paused,
        current: first ? first.id : (window.__mockRunning ? 'a1' : ''),
        runName: first ? first.name : (window.__mockRunning ? '每天签到' : ''),
        prog: first && first.total > 0 ? (first.prog + '/' + first.total) : '',
        acc: acc, overlay: window.__mockOverlay !== undefined ? !!window.__mockOverlay : true,
        linked: window.__mockLinked !== undefined ? !!window.__mockLinked : acc,
        manufacturer: window.__mockBrand || 'generic',
        recording: true, touch: true, ball: true, log: logs, screen: { w: 1080, h: 1920 },
        vars: [{ k: 'n', v: '2' }, { k: 'gap', v: '1000' }],
        varsList: vl, js: !!window.__mockJs,
        runs: runs
      });
    },
    // v3.2.0：prefs/savePrefs 真合并——savePrefs 存进 __mockPrefsObj，prefs 回读，
    // 冒烟里能验证「guideShown 存了 → reload 后引导不二弹」的完整闭环
    prefs: () => JSON.stringify(Object.assign({ ballSize: 54, ballAlpha: 0.88, speed: 1, mode: 'normal',
      vibrate: true, boot: false, theme: 'orange', lastScript: 'a1',
      autoRecordDelay: true, touchRecord: true, recordingOn: true }, window.__mockPrefsObj || {})),
    savePrefs: j => {
      window.__lastPrefs = j;
      try { window.__mockPrefsObj = Object.assign(window.__mockPrefsObj || {}, JSON.parse(j)); } catch (e) {}
      return 'ok';
    },
    info: () => JSON.stringify({ version: '1.6.0', code: 8, sdk: 34, abi: 'arm64-v8a' }),
    recording: () => JSON.stringify([
      { t: 'click', x: 540, y: 1180, d: 420, note: '触点' },
      { t: 'swipe', x1: 500, y1: 1600, x2: 500, y2: 1300, ms: 180, d: 300, note: '触点' },
      { t: 'long', x: 300, y: 400, ms: 800, d: 300, note: '触点' }
    ]),
    clearRecording: () => 'ok', saveRecording: () => 'ok',
    // v3.0.0：run/runJs 支持 __mockFull（模拟池满员，startScript 的错误文案原样返回，
    // 前端 err: 前缀会 toast）；stop=停全部（清 __runs，等价 JsEngine.stopAll）；
    // stopRun/togglePauseRun 记参数并从 __runs 里摘掉那条（等价单会话收工）
    run: () => { if (window.__mockFull) return 'err:会话已满（2 个动作 + 1 个 JS），先停一个再跑'; return 'ok'; },
    runJs: () => { if (window.__mockFull) return 'err:JS 脚本已经在跑了，先停掉再换'; return 'ok'; },
    stop: () => { window.__runs = []; window.__mockRunning = false; return 'ok'; },
    stopRun: id => {
      window.__lastStopArg = id;
      window.__runs = (window.__runs || []).filter(r => String(r.runId) !== String(id));
      return 'ok';
    },
    togglePauseRun: id => { window.__lastPauseArg = id; return 'ok'; },
    testAction: () => 'ok', stopJs: () => 'ok',
    openAcc: () => 'ok', openOverlay: () => 'ok', showBall: () => 'ok', hideBall: () => 'ok',
    recStart: () => 'ok', recStop: () => 'ok', toast: () => 'ok', toBall: () => 'ok',
    // v1.5.0 图色识别
    capStatus: () => JSON.stringify({ granted: true, running: true, w: 1080, h: 1920, tpls: window.__tpls }),
    reqCap: () => 'ok', capStop: () => 'ok',
    shot: () => {
      if (window.__fakeShot) return window.__fakeShot;
      const c = document.createElement('canvas');
      c.setAttribute('data-probe','1');
      c.width = 1080; c.height = 1920;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, 1920);
      grd.addColorStop(0, '#1b2430'); grd.addColorStop(1, '#0d1117');
      g.fillStyle = grd; g.fillRect(0, 0, 1080, 1920);
      g.fillStyle = '#ff3b30'; g.fillRect(700, 280, 120, 120);   // 找色目标
      g.fillStyle = '#12c46a'; g.fillRect(520, 1160, 60, 60);    // 比色目标
      g.fillStyle = '#ffffff'; g.font = '48px sans-serif';
      g.fillText('签到', 120, 320); g.fillText('跳过广告', 120, 520);
      window.__fakeShot = c.toDataURL('image/png');
      return window.__fakeShot;
    },
    colorAt: () => '#ff3b30',
    builtinVars: () => JSON.stringify([
      { k: 'lastX', d: '最近一次找色/找图命中的横坐标' },
      { k: 'lastY', d: '最近一次找色/找图命中的纵坐标' },
      { k: 'loop', d: '当前第几轮' },
      { k: 'screenW', d: '屏幕宽度' },
      { k: 'rand', d: '随机数' },
      // v3.1.0：与真内核 Vars.BUILTIN 对齐——插入变量菜单里要能翻到 {{g.名字}}
      { k: 'g.名字', d: '跨脚本共享变量（v3.1.0）：globalSet 写，任何脚本任何字段里直接读' }
    ]),
    tryExpr: e => { try { return String(eval(e.replace(/rand\([^)]*\)/g, '42'))); } catch (x) { return 'err:读不懂'; } },
    saveTpl: j => { try { window.__tpls.push(JSON.parse(j).name); } catch (e) {} return 'ok'; },
    delTpl: n => { window.__tpls = window.__tpls.filter(x => x !== n); return 'ok'; },
    // v3.1.0 伪 OCR：字模库三件套（跟图色模板 saveTpl/delTpl 分开管）
    listTextTpls: () => JSON.stringify(window.__ttxts || []),
    saveTextTpl: j => { try { window.__ttxts.push(JSON.parse(j).name); } catch (e) {} return 'ok'; },
    delTextTpl: n => { window.__ttxts = (window.__ttxts || []).filter(x => x !== n); return 'ok'; },
    // v1.8.0 分享码：这里按真实格式伪造一段，界面只当字符串处理；
    // 编解码正确性由 /tmp/sharetest/S.java 的 21 项单测保证
    shareCode: id => {
      const s = (window.__scripts || scripts).find(x => x.id === id);
      return s ? ('LT1.Z' + btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')) : 'err:脚本不存在';
    },
    shareAll: () => 'LT1.Z' + btoa(unescape(encodeURIComponent('[all]'))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''),
    importCode: code => {
      window.__lastImport = code;
      if (!/^LT1\./.test(code)) return 'err:这不像懒人点击器的分享码（应该以 LT1. 开头）';
      const cur = JSON.parse(JSON.stringify(window.__scripts || scripts));
      const one = { id: 'imp' + Date.now(), name: '导入的脚本', icon: '📜', tone: 2,
        kind: '', code: '', actions: [{ t: 'click', x: 10, y: 20, d: 300 }], vars: [] };
      cur.unshift(one);
      window.__scripts = cur;
      return 'ok:1';
    },
    copy: () => 'ok',
    // v2.7.0：日志复制走 copyText——记下内容让冒烟能断言「复制的是纯文本，不带徽标」
    copyText: t => { window.__lastCopy = t; return 'ok'; }
  };
}`;
const MOCK_IIFE = '(' + MOCK_SRC + ')();';
module.exports = { MOCK_SRC, MOCK_IIFE };
