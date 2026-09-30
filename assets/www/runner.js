/* 懒人点击器 · JS 脚本 API（v1.7.0）
 *
 * 这份文件跑在 WebView 自带的 V8 里，动作一律经 app.call 交给原生引擎执行，
 * 所以 JS 脚本和「一步步拼动作」的脚本共用同一批动作实现。
 *
 * 每个函数都返回 Promise，用 await 串着写就行：
 *
 *   await launch('com.example.app');
 *   await sleep(3000);
 *   for (var i = 0; i < 5; i++) {
 *     var p = await findColor('#FF6B35');
 *     if (p) await click(p.x, p.y);
 *     await sleep(800);
 *   }
 *
 * 注意：脚本跑在 WebView 主线程，别写不带 await 的死循环，会把界面卡死。
 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var seq = 0;
  var waits = {};

  // 原生那边把一个动作跑完了，就回调这里
  G.__cb = function (id, res) {
    var f = waits[id];
    if (f) {
      delete waits[id];
      f(res || {});
    }
  };

  function call(a) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      waits[id] = function (r) {
        if (r && r.err) {
          // 被用户叫停：静默收尾，别再抛出去吓人
          if (r.err.indexOf('停') >= 0) {
            try { app.done(''); } catch (e) {}
            resolve({});
            return;
          }
          reject(new Error(r.err));
          return;
        }
        resolve(r || {});
      };
      try {
        app.call(String(id), JSON.stringify(a));
      } catch (e) {
        delete waits[id];
        reject(e);
      }
    });
  }

  function sys(q) {
    try { return JSON.parse(app.sys(JSON.stringify(q))); }
    catch (e) { return { err: String(e) }; }
  }

  function n(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }
  // 第三个参数既可以传等待毫秒，也可以传 {pct:1, d:...} 这类选项
  function o(o3) { return typeof o3 === 'number' ? { d: o3 } : (o3 || {}); }

  // ---------------- 基础操作 ----------------

  /** 等一会儿（毫秒） */
  function sleep(ms) {
    ms = n(ms, 1000);
    return call({ t: 'wait', ms: ms, d: ms });
  }

  /** 点一下。click(x, y) 像素坐标；click(x, y, {pct:1}) 按百分比 */
  function click(x, y, opt) {
    opt = o(opt);
    return call({ t: 'click', x: n(x, 0), y: n(y, 0), pct: opt.pct ? 1 : 0, d: opt.d == null ? 300 : opt.d });
  }

  /** 按屏幕百分比点（0~100），换机型不跑偏 */
  function clickP(xp, yp, opt) {
    opt = o(opt);
    return call({ t: 'click', x: n(xp, 0), y: n(yp, 0), pct: 1, d: opt.d == null ? 300 : opt.d });
  }

  function doubleClick(x, y, opt) {
    opt = o(opt);
    return call({ t: 'double', x: n(x, 0), y: n(y, 0), pct: opt.pct ? 1 : 0, d: opt.d == null ? 400 : opt.d });
  }

  function longClick(x, y, ms, opt) {
    opt = o(opt);
    return call({ t: 'long', x: n(x, 0), y: n(y, 0), ms: n(ms, 800), pct: opt.pct ? 1 : 0, d: opt.d == null ? 300 : opt.d });
  }

  /** 滑一下：swipe(x1, y1, x2, y2, 时长ms) */
  function swipe(x1, y1, x2, y2, ms, opt) {
    opt = o(opt);
    return call({ t: 'swipe', x1: n(x1, 0), y1: n(y1, 0), x2: n(x2, 0), y2: n(y2, 0),
      ms: n(ms, 400), pct: opt.pct ? 1 : 0, d: opt.d == null ? 300 : opt.d });
  }

  /** 带抖动的点击，别太像机器人 */
  function randomClick(x, y, r, opt) {
    opt = o(opt);
    return call({ t: 'random', x: n(x, 0), y: n(y, 0), r: n(r, 10), pct: opt.pct ? 1 : 0, d: opt.d == null ? 300 : opt.d });
  }

  /** 双指手势：twoTap（齐点）/ twoLong（按住）/ pinch（捏合）/ spread（张开） */
  function multi(mode, x, y, ms, r) {
    return call({ t: 'multi', m: mode || 'twoTap', x: n(x, 0), y: n(y, 0), ms: n(ms, 400), r: n(r, 80), d: 300 });
  }

  /** 全局按键：back / home / recents / notifications / quickSettings / lock / power / split */
  function key(name) {
    return call({ t: 'key', k: name || 'back', d: 300 });
  }

  /** 往当前输入框里打字 */
  function input(text) {
    return call({ t: 'text', s: text == null ? '' : String(text), d: 300 });
  }

  /** 打开某个 App（包名） */
  function launch(pkg) {
    return call({ t: 'launch', p: pkg || '', d: 1000 });
  }

  // ---------------- 找文字 ----------------

  /** 找文字并点它。opt: {id, desc, re, contains, index, timeout, click, clickable}
   *  v2.6.0：id / desc / re 与「找文字」动作表单同款 —— id 填 ok 或 com.x:id/ok，
   *  re 是在文字里搜的正则（不用加 ^$），desc 是内容描述。都留空＝老样子 */
  function tapText(text, opt) {
    opt = opt || {};
    return call({ t: 'find', s: String(text == null ? '' : text),
      id: String(opt.id || ''), desc: String(opt.desc || ''), re: String(opt.re || ''),
      contains: opt.contains !== false, click: opt.click !== false,
      clickable: !!opt.clickable, index: n(opt.index, 1),
      timeout: opt.timeout == null ? 3000 : opt.timeout,
      d: opt.d == null ? 300 : opt.d });
  }

  /** 屏幕上有没有这段字。opt: {id, desc, re, contains, index, clickable} */
  function hasText(text, opt) {
    opt = opt || {};
    return call({ t: 'if', m: 'text', s: String(text == null ? '' : text),
      id: String(opt.id || ''), desc: String(opt.desc || ''), re: String(opt.re || ''),
      contains: opt.contains !== false, clickable: !!opt.clickable, index: n(opt.index, 1),
      p: '', d: 0 })
      .then(function (r) { return !!r.ok; });
  }

  /** 找文字但不点，立刻返回：命中给 {x, y}，没有给 null。opt 同 tapText 的查找部分 */
  function findText(text, opt) {
    opt = opt || {};
    return call({ t: 'find', s: String(text == null ? '' : text),
      id: String(opt.id || ''), desc: String(opt.desc || ''), re: String(opt.re || ''),
      contains: opt.contains !== false, click: false,
      clickable: !!opt.clickable, index: n(opt.index, 1),
      timeout: 0, d: 0 })
      .then(function (r) { return r.ok ? { x: r.x, y: r.y } : null; });
  }

  /** 等文字出现（超时前反复找）：命中给 {x, y}，超时给 null。opt: {timeout(默认 10 秒), ...同 findText} */
  function waitText(text, opt) {
    opt = opt || {};
    return call({ t: 'find', s: String(text == null ? '' : text),
      id: String(opt.id || ''), desc: String(opt.desc || ''), re: String(opt.re || ''),
      contains: opt.contains !== false, click: false,
      clickable: !!opt.clickable, index: n(opt.index, 1),
      timeout: opt.timeout == null ? 10000 : opt.timeout, d: 0 })
      .then(function (r) { return r.ok ? { x: r.x, y: r.y } : null; });
  }

  /** 当前前台是不是这个 App */
  function hasApp(pkg) {
    return call({ t: 'if', m: 'pkg', p: pkg || '', s: '', d: 0 })
      .then(function (r) { return !!r.ok; });
  }

  /** 跑另一个脚本（按名字），等它跑完才继续。args 传对象，子脚本里用 {{名字}} 读；
   *  子脚本往变量里写的值父脚本接着用（这就是回值）。返回 {ok, steps, x, y} */
  function runSub(name, args) {
    return call({ t: 'runSub', name: String(name == null ? '' : name),
      args: args == null ? '' : JSON.stringify(args), d: 0 })
      .then(function (r) {
        return { ok: !!r.ok, steps: r.steps || 0,
          x: (r.x == null ? null : r.x), y: (r.y == null ? null : r.y) };
      });
  }

  // ---------------- 图色 ----------------

  /** 找颜色，返回 {x, y, sim}；没找到返回 null。opt: {sim, x, y, w, h, pct, click} */
  function findColor(color, opt) {
    opt = opt || {};
    return call({ t: 'findColor', c: color || '#000000', sim: n(opt.sim, 95),
      rx: n(opt.x, 0), ry: n(opt.y, 0), rw: n(opt.w, 0), rh: n(opt.h, 0),
      pct: opt.pct ? 1 : 0, click: opt.click ? 1 : 0, step: n(opt.step, 2),
      d: opt.d == null ? 0 : opt.d })
      .then(function (r) { return r.ok ? { x: r.x, y: r.y, sim: r.sim } : null; });
  }

  /** 找模板图（名字在「模板图」里存过），返回 {x, y, sim} 或 null */
  function findImage(name, opt) {
    opt = opt || {};
    return call({ t: 'findImage', tpl: name || '', sim: n(opt.sim, 90),
      rx: n(opt.x, 0), ry: n(opt.y, 0), rw: n(opt.w, 0), rh: n(opt.h, 0),
      pct: opt.pct ? 1 : 0, click: opt.click ? 1 : 0,
      d: opt.d == null ? 0 : opt.d })
      .then(function (r) { return r.ok ? { x: r.x, y: r.y, sim: r.sim } : null; });
  }

  /** 某个坐标的颜色对不对 */
  function cmpColor(x, y, color, sim, opt) {
    opt = opt || {};
    return call({ t: 'cmpColor', x: n(x, 0), y: n(y, 0), c: color || '#000000',
      sim: n(sim, 95), pct: opt.pct ? 1 : 0, d: 0 })
      .then(function (r) { return !!r.ok; });
  }

  // ---------------- 变量与计数 ----------------

  /** 变量赋值（值会自动当成字符串存，取出来自己转数字） */
  function setVar(k, v) {
    sys({ m: 'setVar', k: String(k == null ? '' : k), v: v == null ? '' : String(v) });
    return getVar(k);
  }

  function getVar(k) {
    var r = sys({ m: 'getVar', k: String(k == null ? '' : k) });
    return r.v == null ? '' : r.v;
  }

  /** 计数器：count('main') 加一；count('main', {reset:true}) 清零。返回当前值 */
  function count(name, opt) {
    opt = opt || {};
    var k = name || 'main';
    return call({ t: 'count', k: k, mode: opt.reset ? 'reset' : 'add',
      v: n(opt.v, 1), times: n(opt.times, 0), go: 0,
      resetAfter: opt.resetAfter !== false, d: 0 })
      .then(function () { return parseInt(getVar('cnt.' + k), 10) || 0; });
  }

  // ---------------- 随手工具 ----------------

  /** 随机数：rand(10) 得 0~9，rand(5, 8) 得 5~8 */
  function rand(a, b) {
    a = n(a, 0);
    if (b == null) { b = a - 1; a = 0; } else { b = n(b, 0); }
    var r = sys({ m: 'rand', a: a, b: b });
    return r.v || 0;
  }

  /** 当前时间戳（毫秒） */
  function now() {
    return sys({ m: 'now' }).v || 0;
  }

  /** 屏幕尺寸 {w, h}（会换算成当前分辨率下的像素） */
  function screen() {
    var r = sys({ m: 'screen' });
    return { w: r.w || 0, h: r.h || 0 };
  }

  /** 写一行到运行日志 */
  function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      parts.push(typeof a === 'object' ? JSON.stringify(a) : String(a));
    }
    sys({ m: 'log', a: parts.join(' ') });
    return parts.join(' ');
  }

  /** 屏幕下方弹一句话 */
  function toast(msg) {
    sys({ m: 'toast', a: msg == null ? '' : String(msg) });
    return msg;
  }

  /** 主动结束脚本 */
  function stop() {
    sys({ m: 'stop' });
    return true;
  }

  /** 脚本还在跑吗（自己写循环时用它当刹车条件） */
  function running() {
    return !!sys({ m: 'running' }).v;
  }

  // console.log 也接进日志页，免得脚本里打的东西看不到。
  // 只在浏览器里接管：Node 下跑测试时不能把 console 吞掉。
  if (typeof window !== 'undefined' && G.console) {
    G.console.log = function () { return log.apply(null, arguments); };
  }

  // 挂到全局，用户脚本里直接写 click(...) 就行
  var api = {
    sleep: sleep, click: click, clickP: clickP, doubleClick: doubleClick,
    longClick: longClick, swipe: swipe, randomClick: randomClick, multi: multi,
    key: key, input: input, launch: launch,
    tapText: tapText, hasText: hasText, hasApp: hasApp,
    findText: findText, waitText: waitText, runSub: runSub,
    findColor: findColor, findImage: findImage, cmpColor: cmpColor,
    setVar: setVar, getVar: getVar, count: count,
    rand: rand, now: now, screen: screen, log: log, toast: toast, stop: stop,
    running: running
  };
  for (var k in api) G[k] = api[k];
  G.__api = api;
})();
