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
        { t: 'cmpColor', x: 540, y: 1180, c: '#12c46a', sim: 90, hit: 0, miss: -1, d: 100 },
        { t: 'findImage', tpl: '跳过广告', sim: 88, click: true, timeout: 3000, d: 400 }
      ] },
    { id: 'a5', name: '循环签到', desc: 'JS 写的', icon: '📜', tone: 6, kind: 'js',
      actions: [], vars: [],
      code: 'await sleep(2000);\\nfor (var i = 0; i < 5; i++) {\\n'
        + "  var p = await findColor('#FF6B35', { sim: 92 });\\n"
        + '  if (p) await click(p.x, p.y);\\n}\\n' }
  ];
  const triggers = [
    { id: 't1', kind: 'time', script: 'a1', on: true, hh: 9, mm: 0 },
    { id: 't2', kind: 'notify', script: 'a4', on: true, text: '到账', pkg: '' },
    { id: 't3', kind: 'unlock', script: 'a2', on: false }
  ];
  const logs = ['开跑：每天签到', '先等 3 秒，你快切过去', '打开 com.tencent.mm',
    '找到「签到」@540,1180', '✓ 有「领取成功」', '计数 n = 1', '多指 双指捏合',
    '找色 #ff3b30 → 命中 @720,310', '比色 #12c46a → 命中', '找图 跳过广告 → 命中 @980,160'];
  window.__tpls = ['签到按钮', '跳过广告'];
  window.app = {
    scripts: () => JSON.stringify(window.__scripts || scripts),
    saveScripts: j => { try { window.__scripts = JSON.parse(j); } catch (e) {} return 'ok'; },
    triggers: () => JSON.stringify(triggers),
    saveTriggers: () => 'ok',
    fireTrigger: () => 'ok',
    curApp: () => 'com.tencent.mm',
    status: () => JSON.stringify({ running: false, current: '', acc: true, overlay: true,
      recording: true, touch: true, ball: true, log: logs, screen: { w: 1080, h: 1920 },
      vars: [{ k: 'n', v: '2' }, { k: 'gap', v: '1000' }], js: false }),
    prefs: () => JSON.stringify({ ballSize: 54, ballAlpha: 0.88, speed: 1, mode: 'normal',
      vibrate: true, boot: false, theme: 'orange', lastScript: 'a1',
      autoRecordDelay: true, touchRecord: true, recordingOn: true }),
    savePrefs: () => 'ok',
    info: () => JSON.stringify({ version: '1.6.0', code: 8, sdk: 34, abi: 'arm64-v8a' }),
    recording: () => JSON.stringify([
      { t: 'click', x: 540, y: 1180, d: 420, note: '触点' },
      { t: 'swipe', x1: 500, y1: 1600, x2: 500, y2: 1300, ms: 180, d: 300, note: '触点' },
      { t: 'long', x: 300, y: 400, ms: 800, d: 300, note: '触点' }
    ]),
    clearRecording: () => 'ok', saveRecording: () => 'ok',
    run: () => 'ok', stop: () => 'ok', testAction: () => 'ok',
    runJs: () => 'ok', stopJs: () => 'ok',
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
      { k: 'rand', d: '随机数' }
    ]),
    tryExpr: e => { try { return String(eval(e.replace(/rand\([^)]*\)/g, '42'))); } catch (x) { return 'err:读不懂'; } },
    saveTpl: j => { try { window.__tpls.push(JSON.parse(j).name); } catch (e) {} return 'ok'; },
    delTpl: n => { window.__tpls = window.__tpls.filter(x => x !== n); return 'ok'; },
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
    copy: () => 'ok'
  };
}`;
const MOCK_IIFE = '(' + MOCK_SRC + ')();';
module.exports = { MOCK_SRC, MOCK_IIFE };
