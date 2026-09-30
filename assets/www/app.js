/* 懒人点击器 · 界面层（纯 JS，无框架）
   目标：小、快、不卡。所有数据经 window.app.* 与原生内核交换。
   v1.3：玻璃质感 UI、渲染 rAF 节流、焦点保持、脚本图标与搜索、延迟启动 */
(function () {
  'use strict';

  var S = {
    tab: 'scripts',
    sub: null,        // 「我的」里的子页：log / trig / settings / about
    scripts: [],
    rec: [],
    st: {},
    prefs: {},
    editId: null,     // 正在编辑的脚本 id
    editAct: -1,      // 正在编辑的动作下标
    q: '',            // 脚本搜索词
    cap: {},          // 截图/图色状态
    shot: '',         // 最新截图 dataURL
    shotImg: null,    // 截图的 Image 对象
    pick: null        // 取色/取图临时状态
  };

  // ---------- 原生桥 ----------
  function call(name, arg) {
    try {
      if (!window.app || typeof window.app[name] !== 'function') return 'err:无原生桥';
      return arg === undefined ? window.app[name]() : window.app[name](arg);
    } catch (e) {
      return 'err:' + e.message;
    }
  }
  function jcall(name, arg) {
    var r = call(name, arg);
    if (typeof r === 'string' && r.indexOf('err:') === 0) {
      toast(r.slice(4));
      return null;
    }
    try { return JSON.parse(r); } catch (e) { return null; }
  }
  function ok(r) {
    if (typeof r === 'string' && r.indexOf('err:') === 0) { toast(r.slice(4)); return false; }
    return true;
  }

  // ---------- 小工具 ----------
  function $(s, root) { return (root || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }
  function uid() { return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

  // ---------- 动作定义 ----------
  var TYPES = {
    click: { n: '点击', e: '👆', c: 1, f: [['x', 'X 坐标'], ['y', 'Y 坐标'], ['d', '之后等待 ms']], def: { d: 300 } },
    double: { n: '双击', e: '✌️', c: 1, f: [['x', 'X'], ['y', 'Y'], ['d', '之后等待 ms']], def: { d: 300 } },
    long: { n: '长按', e: '👇', c: 1, f: [['x', 'X'], ['y', 'Y'], ['ms', '按住时长 ms'], ['d', '之后等待 ms']], def: { ms: 800, d: 300 } },
    swipe: { n: '滑动', e: '💫', c: 1, f: [['x1', '起点 X'], ['y1', '起点 Y'], ['x2', '终点 X'], ['y2', '终点 Y'], ['ms', '滑动时长 ms'], ['d', '之后等待 ms']], def: { ms: 400, d: 300 } },
    random: { n: '随机点', e: '🎲', c: 1, f: [['x', '中心 X'], ['y', '中心 Y'], ['r', '随机半径 px'], ['d', '之后等待 ms']], def: { r: 12, d: 300 } },
    wait: { n: '等待', e: '⏳', f: [['ms', '等待 ms']], def: { ms: 1000 } },
    key: { n: '按键', e: '🔘', f: [['k', '按键', 'key'], ['d', '之后等待 ms']], def: { k: 'back', d: 300 } },
    text: { n: '输入', e: '⌨️', f: [['s', '要输入的文字', 'text'], ['d', '之后等待 ms']], def: { s: '', d: 300 } },
    launch: { n: '开应用', e: '📱', f: [['p', '包名，如 com.tencent.mm', 'text'], ['d', '之后等待 ms']], def: { p: '', d: 1500 } },
    find: { n: '找文字', e: '🔍', f: [['s', '屏幕上的文字', 'text'], ['click', '找到就点它', 'switch'], ['contains', '模糊匹配', 'switch'], ['timeout', '最多等 ms'], ['index', '第几个(1起)'], ['d', '之后等待 ms']], def: { click: true, contains: true, timeout: 3000, index: 1, d: 300 } },
    if: { n: '如果', e: '🔀', f: [['m', '判断什么', 'sel:ifmode'], ['s', '屏幕上的文字', 'text'], ['p', '应用包名（判断 App 时用）', 'text'], ['contains', '模糊匹配', 'switch'], ['go', '成立 → 跳到第几步'], ['els', '不成立 → 跳到第几步'], ['d', '之后等待 ms']], def: { m: 'text', s: '', p: '', contains: true, go: 0, els: 0, d: 100 } },
    count: { n: '计数', e: '🔢', f: [['k', '计数器名字', 'text'], ['mode', '动作', 'sel:cntmode'], ['v', '每次加多少'], ['times', '涨到几次就跳（0=不管）'], ['go', '跳到第几步'], ['resetAfter', '跳完就清零', 'switch'], ['d', '之后等待 ms']], def: { k: 'main', mode: 'add', v: 1, times: 0, go: 0, resetAfter: true, d: 100 } },
    multi: { n: '多指', e: '🖐', c: 1, f: [['m', '手势', 'sel:multi'], ['x', '中心 X'], ['y', '中心 Y'], ['r', '两指间距半径'], ['ms', '动作时长 ms'], ['d', '之后等待 ms']], def: { m: 'twoTap', x: 50, y: 50, r: 80, ms: 400, d: 400 } },
    findColor: { n: '找色', e: '🎨', c: 1, f: [['c', '目标颜色', 'color'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高'], ['click', '找到就点它', 'switch'], ['go', '找到 → 跳到第几步'], ['els', '没找到 → 跳到第几步'], ['d', '之后等待 ms']], def: { c: '#FF6B35', sim: 95, rx: 0, ry: 0, rw: 100, rh: 100, click: true, go: 0, els: 0, d: 300 }, pct: ['rx', 'ry', 'rw', 'rh'] },
    cmpColor: { n: '比色', e: '🌈', f: [['x', 'X 坐标'], ['y', 'Y 坐标'], ['c', '期望颜色', 'color'], ['sim', '相似度 %'], ['go', '颜色对 → 跳到第几步'], ['els', '不对 → 跳到第几步'], ['d', '之后等待 ms']], def: { x: 50, y: 50, c: '#FFFFFF', sim: 95, go: 0, els: 0, d: 200 } },
    findImage: { n: '找图', e: '🖼', c: 1, f: [['tpl', '模板图', 'sel:tpls'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高'], ['click', '找到就点它', 'switch'], ['go', '找到 → 跳到第几步'], ['els', '没找到 → 跳到第几步'], ['d', '之后等待 ms']], def: { tpl: '', sim: 90, rx: 0, ry: 0, rw: 100, rh: 100, click: true, go: 0, els: 0, d: 300 }, pct: ['rx', 'ry', 'rw', 'rh'] },
    set: { n: '赋值', e: '📝', f: [['k', '变量名', 'text'], ['v', '值（可写 {{变量}}）', 'var'], ['d', '之后等待 ms']], def: { k: 'n', v: '', d: 100 } },
    math: { n: '运算', e: '🧮', f: [['k', '存到哪个变量', 'text'], ['e', '算式（不用加 {{}}）', 'expr'], ['d', '之后等待 ms']], def: { k: 'n', e: 'n+1', d: 100 } },
    cmpVar: { n: '比变量', e: '⚖️', f: [['l', '左边', 'var'], ['op', '怎么比', 'sel:cmpop'], ['r', '右边', 'var'], ['go', '成立 → 跳到第几步'], ['els', '不成立 → 跳到第几步'], ['d', '之后等待 ms']], def: { l: 'n', op: '>=', r: '3', go: 0, els: 0, d: 100 } },
    cond: { n: '条件判断', e: '🧠', f: [['go', '全部/满足 → 跳到第几步'], ['els', '不满足 → 跳到第几步'], ['d', '之后等待 ms']], def: { mode: 0, n: 1, cs: [], rep: 0, repGap: 800, repMax: 10, go: 0, els: 0, d: 100 } }
  };
  var CMP_OP = { '==': '等于', '!=': '不等于', '>': '大于', '>=': '大于等于', '<': '小于', '<=': '小于等于' };
  // 条件类型（v2.0.0）：跟自动精灵一样按「条件」组织，不是一个动作只挂一个判断
  var CTYPES = {
    text: { n: '屏幕上有字', e: '🔤', f: [['s', '要找的字', 'text'], ['contains', '模糊匹配', 'switch'], ['index', '第几个(1起)']], def: { s: '', contains: true, index: 1 }, sum: function (c) { return '有「' + (c.s || '') + '」'; } },
    pkg: { n: '当前是某 App', e: '📱', f: [['v', '包名，如 com.tencent.mm', 'text']], def: { v: '' }, sum: function (c) { return '在 ' + (c.v || '?'); } },
    color: { n: '屏幕上有颜色', e: '🎨', f: [['c', '颜色', 'color'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高']], def: { c: '#FF6B35', sim: 95, rx: 0, ry: 0, rw: 100, rh: 100 }, pct: 1, sum: function (c) { return '有 ' + (c.c || ''); } },
    image: { n: '屏幕上有图', e: '🖼', f: [['tpl', '模板图', 'sel:tpls'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高']], def: { tpl: '', sim: 90, rx: 0, ry: 0, rw: 100, rh: 100 }, pct: 1, sum: function (c) { return '有图「' + (c.tpl || '未选') + '」'; } },
    time: { n: '到了某个时间', e: '⏰', f: [['v', '时间点，如 09:00', 'text']], def: { v: '09:00' }, sum: function (c) { return '过了 ' + (c.v || ''); } },
    rand: { n: '随机概率', e: '🎲', f: [['v', '成立的概率 %']], def: { v: 50 }, sum: function (c) { return '随机 ' + (c.v || 0) + '%'; } },
    expr: { n: '表达式成立', e: '🧮', f: [['v', '算式，算出来是 1 就算成立', 'expr']], def: { v: 'n>2' }, sum: function (c) { return c.v || ''; } },
    always: { n: '总是成立', e: '✅', f: [], def: {}, sum: function () { return '恒真'; } }
  };
  var CMODE = [['全部满足', '全部满足'], ['满足一个', '至少一个满足'], ['满足指定个数', '凑够 N 个才算成立']];
  var KEYS = ['back:返回', 'home:桌面', 'recents:最近任务', 'notif:通知栏', 'quick:快捷设置', 'lock:锁屏', 'power:电源菜单', 'split:分屏'];
  var OPTS = {
    ifmode: [['text', '屏幕上有这个字'], ['pkg', '当前是这个 App']],
    cntmode: [['add', '往上加'], ['reset', '清零']],
    multi: [['twoTap', '双指齐点'], ['twoLong', '双指按住'], ['pinch', '双指捏合'], ['spread', '双指张开']],
    cmpop: [['==', '等于'], ['!=', '不等于'], ['>', '大于'], ['>=', '大于等于'], ['<', '小于'], ['<=', '小于等于']],
    cmode: CMODE
  };
  var MULTI_N = { twoTap: '双指齐点', twoLong: '双指按住', pinch: '捏合', spread: '张开' };
  var TG = {
    time: { n: '每天定时', e: '⏰', d: '到点自动跑一次' },
    repeat: { n: '每隔一段', e: '🔁', d: '按分钟周期重复' },
    notify: { n: '收到通知', e: '🔔', d: '通知含指定文字就跑' },
    power: { n: '插上电源', e: '🔌', d: '充电时自动跑' },
    unlock: { n: '解锁屏幕', e: '🔓', d: '亮屏解锁就跑' }
  };
  var ICONS = ['📜', '⚡', '🎮', '📺', '🎁', '⏭', '🔨', '🫧', '💰', '🎯', '🍚', '🚀', '❤️', '🧹', '📲', '⏰'];

  function actSummary(a) {
    var t = TYPES[a.t];
    if (!t) return '未知动作';
    var rp = a.repeat > 1 ? ' ×' + a.repeat : '';
    var p = a.pct ? '%' : 'px';
    switch (a.t) {
      case 'click': return p + ' (' + a.x + ',' + a.y + ') · 等 ' + (a.d || 0) + 'ms' + rp;
      case 'double': return p + ' (' + a.x + ',' + a.y + ') · 等 ' + (a.d || 0) + 'ms' + rp;
      case 'long': return p + ' (' + a.x + ',' + a.y + ') · 按住 ' + (a.ms || 800) + 'ms' + rp;
      case 'random': return p + ' (' + a.x + ',' + a.y + ') ±' + (a.r || 12) + 'px' + rp;
      case 'swipe': return p + ' (' + a.x1 + ',' + a.y1 + ')→(' + a.x2 + ',' + a.y2 + ') ' + (a.ms || 400) + 'ms' + rp;
      case 'wait': return '发呆 ' + (a.ms || 0) + 'ms';
      case 'key': return '按 ' + (a.k || 'back');
      case 'text': return '输入「' + (a.s || '') + '」';
      case 'launch': return '打开 ' + (a.p || '');
      case 'find': return '找「' + (a.s || '') + '」' + (a.click ? ' 并点击' : '') + ' 第' + (a.index || 1) + '个';
      case 'if': return a.m === 'pkg'
        ? '若当前是 ' + (a.p || '?') + ' → 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els)
        : '若有「' + (a.s || '') + '」→ 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els);
      case 'count': return '计数 ' + (a.k || 'main') + (a.mode === 'reset' ? ' 清零' : ' +' + (a.v || 1))
        + (a.times ? '，够 ' + a.times + ' 次跳' + jumpTxt(a.go) : '');
      case 'multi': return (MULTI_N[a.m] || a.m) + ' @' + p + ' (' + a.x + ',' + a.y + ')';
      case 'findColor': return '找 ' + (a.c || '') + ' 像≥' + (a.sim || 95) + '%'
        + (a.click ? ' 并点击' : '') + '，找到跳' + jumpTxt(a.go) + ' / 没找到跳' + jumpTxt(a.els);
      case 'cmpColor': return '比 (' + a.x + ',' + a.y + ')=' + (a.c || '') + ' ≥' + (a.sim || 95)
        + '%，对跳' + jumpTxt(a.go) + ' / 不对跳' + jumpTxt(a.els);
      case 'findImage': return '找图「' + (a.tpl || '未选') + '」像≥' + (a.sim || 90) + '%'
        + (a.click ? ' 并点击' : '') + '，找到跳' + jumpTxt(a.go) + ' / 没找到跳' + jumpTxt(a.els);
      case 'set': return (a.k || '?') + ' = ' + (a.v === '' ? '（空）' : a.v);
      case 'math': return (a.k || '?') + ' = ' + (a.e || '');
      case 'cmpVar': return '若 ' + (a.l || '0') + ' ' + (CMP_OP[a.op] || a.op) + ' ' + (a.r || '0')
        + ' → 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els);
    }
    return '';
  }
  function jumpTxt(v) {
    v = +v || 0;
    return v === 0 ? '下一步' : (v === -1 ? '收工' : (v === -2 ? '重来一轮' : '第 ' + v + ' 步'));
  }

  // ---------- 数据 ----------
  function refreshAll() {
    var s = jcall('scripts'); if (s) S.scripts = s;
    var st = jcall('status'); if (st) S.st = st;
    var p = jcall('prefs'); if (p) S.prefs = p;
    var t = jcall('triggers'); if (t) S.triggers = t;
    var b = jcall('builtinVars'); if (b) S.builtin = b;
    loadCap();
    loadRec();          // 回到前台时把录制结果一起拉回来，不然会显示“还没录到”
    applyTheme();
    render();
  }
  var THEMES = { orange: '橙', teal: '青', violet: '紫', blue: '蓝', green: '绿', pink: '粉' };
  var THEME_C = { orange: '#ff6b35', teal: '#0d9488', violet: '#8b5cf6', blue: '#3b82f6', green: '#22c55e', pink: '#ec4899' };
  function applyTheme() {
    var t = (S.prefs && S.prefs.theme) || 'orange';
    if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
  }
  function saveScripts() {
    ok(call('saveScripts', JSON.stringify(S.scripts)));
  }
  function findScript(id) {
    for (var i = 0; i < S.scripts.length; i++) if (S.scripts[i].id === id) return S.scripts[i];
    return null;
  }

  // ---------- 渲染（rAF 节流，连续刷新只画一帧） ----------
  var rafId = 0;
  function render() {
    if (rafId) return;
    rafId = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      rafId = 0;
      doRender();
    });
  }

  function doRender() {
    renderBadges();
    var tabs = document.querySelectorAll('#tabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', !S.editId && tabs[i].dataset.tab === S.tab);
    }
    // 重绘会丢焦点：记住正在输入的框，画完放回去
    var ae = document.activeElement;
    var keep = (ae && ae.id && ae.tagName === 'INPUT')
      ? { id: ae.id, pos: (ae.value || '').length } : null;

    var page = $('#page');
    var key = S.tab + '/' + (S.editId || '');
    var swapped = key !== S.lastKey;
    S.lastKey = key;
    if (S.editId && S.tab === 'scripts') {
      var s = findScript(S.editId);
      page.innerHTML = s ? viewEditor(s) : '';
    } else if (S.tab === 'mine') {
      var sub = S.sub && ({
        log: viewLog, trig: viewTriggers, settings: viewSettings, about: viewAbout
      })[S.sub];
      page.innerHTML = (S.sub ? subBar() : '') + (sub ? sub() : viewMine());
    } else {
      page.innerHTML = ({
        scripts: viewScripts, market: viewMarket, record: viewRecord
      })[S.tab]();
    }
    if (swapped) { page.classList.remove('swap'); void page.offsetWidth; page.classList.add('swap'); }
    bindDrag();

    if (keep) {
      var n = document.getElementById(keep.id);
      if (n) {
        n.focus();
        try { n.setSelectionRange(keep.pos, keep.pos); } catch (e) { }
      }
    }

    var fab = $('.fab');
    if (!S.editId && S.tab === 'scripts' && !fab) {
      var f = document.createElement('div');
      f.className = 'fab'; f.textContent = '＋';
      f.onclick = newScript;
      document.body.appendChild(f);
    } else if (fab && (S.editId || S.tab !== 'scripts')) {
      fab.remove();
    }
  }

  function renderBadges() {
    var st = S.st || {};
    var h = '';
    h += '<span class="badge ' + (st.acc ? 'on' : 'off') + '">无障碍' + (st.acc ? '已开' : '未开') + '</span>';
    h += '<span class="badge ' + (st.overlay ? 'on' : 'off') + '">悬浮窗' + (st.overlay ? 'OK' : '未授权') + '</span>';
    if (st.recording) h += '<span class="badge off">录制中</span>';
    if (st.running) h += '<span class="badge brand">运行中</span>';
    $('#badges').innerHTML = h;
  }

  // ---------- 顶部状态大卡 ----------
  function dot(v, label, act) {
    return '<span class="dot ' + (v ? 'ok' : 'no') + '"'
      + (act && !v ? ' data-act="' + act + '"' : '') + '><b></b>' + label + (v ? ' 已开' : ' 未开') + '</span>';
  }

  function heroCard() {
    var st = S.st || {};
    var running = !!st.running;
    var cur = running ? findScript(st.current) : null;
    var h = '<div class="hero">'
      + '<div class="hi">' + (running ? '手指已下班' : '今天也要少动手指') + '</div>'
      + '<div class="ht">' + (running ? esc(cur ? cur.name : '运行中') : '一切就绪') + '</div>'
      + '<div class="hs">'
      + dot(st.acc, '无障碍', 'acc')
      + dot(st.overlay, '悬浮窗', 'overlay')
      + (st.ball ? '<span class="dot ok"><b></b>悬浮球在岗</span>' : '')
      + (running ? '<span class="dot run"><b></b>运行中</span>' : '')
      + (st.recording ? '<span class="dot run"><b></b>录制中</span>' : '')
      + '</div><div class="row">';
    if (running) {
      h += '<button class="btn warn grow" data-act="stop">■ 立刻刹车</button>';
    } else if (S.scripts.length) {
      h += '<button class="btn grow" data-act="runLast">▶ 跑上次那个</button>';
    }
    h += '<button class="btn ghost" data-act="ball">' + (st.ball ? '收起悬浮球' : '呼出悬浮球') + '</button>';
    return h + '</div></div>';
  }

  function hintBox() {
    if (S.st && S.st.acc && S.st.overlay) return '';
    return '<div class="hint">⚠️ 还差一步：'
      + (!S.st || !S.st.acc ? '<a href="#" data-act="acc">开启无障碍</a> ' : '')
      + (!S.st || !S.st.overlay ? '<a href="#" data-act="overlay">授权悬浮窗</a>' : '')
      + '，不然我只能干瞪眼。</div>';
  }

  // ---------- 脚本列表 ----------
  function viewScripts() {
    if (!S.scripts.length) {
      return heroCard()
        + '<div class="empty"><span class="e">🫠</span>这里空空如也，像我的钱包<br>'
        + '<span class="tiny">点右下角 ＋ 挑个模板，或去「录制」偷一段操作</span></div>'
        + hintBox();
    }
    var q = (S.q || '').trim();
    var list = S.scripts;
    if (q) {
      list = [];
      for (var k = 0; k < S.scripts.length; k++) {
        var sc = S.scripts[k];
        if ((sc.name || '').indexOf(q) >= 0 || (sc.desc || '').indexOf(q) >= 0) list.push(sc);
      }
    }
    var h = heroCard();
    if (S.scripts.length > 4 || q) {
      h += '<div class="search"><span class="si">🔍</span>'
        + '<input id="q" value="' + esc(S.q || '') + '" placeholder="搜脚本名或备注"></div>';
    }
    if (!list.length) {
      return h + '<div class="empty"><span class="e">🔍</span>没找到「' + esc(q) + '」<br>'
        + '<span class="tiny">换个词试试，或者干脆新建一个</span></div>';
    }
    h += hintBox() + '<div class="list">';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var acts = s.actions || [];
      var running = S.st.running && S.st.current === s.id;
      h += '<div class="item' + (running ? ' run' : '') + '" data-id="' + s.id + '">'
        + (q ? '' : '<div class="grip" data-drag="' + S.scripts.indexOf(s) + '" data-list="scripts">⋮⋮</div>')
        + '<div class="ic g' + (s.tone || 1) + '" data-act="pickIcon" data-id="' + s.id + '">' + (s.icon || '📜') + '</div>'
        + '<div class="grow" data-act="edit" data-id="' + s.id + '">'
        + '<div class="t">' + esc(s.name) + (s.kind === 'js' ? '<span class="chip">JS</span>' : '')
        + (s.loop ? '<span class="chip b">∞ 循环</span>' : '') + '</div>'
        + '<div class="d">' + (s.desc ? esc(s.desc) + ' · ' : '')
        + (s.kind === 'js' ? 'JS 脚本' : acts.length + ' 步'
          + (s.loop ? '' : ' · 跑 ' + (s.loopCount || 1) + ' 遍'))
        + (s.runs ? ' · 已跑 ' + s.runs + ' 次' : '') + '</div></div>'
        + '<div class="acts">'
        + (running
          ? '<button class="btn sm warn" data-act="stop">■</button>'
          : '<button class="btn sm ok" data-act="run" data-id="' + s.id + '">▶</button>')
        + '<button class="btn sm ghost" data-act="more" data-id="' + s.id + '">⋯</button>'
        + '</div></div>';
    }
    return h + '</div><div class="row" style="margin:12px 2px 0">'
      + '<button class="btn sm ghost grow" data-tab="market">🏪 脚本市场</button>'
      + '<button class="btn sm ghost grow" data-act="import">📥 导入 JSON</button></div>';
  }

  // ---------- 自动化触发器 ----------
  function tgsw(id, on) {
    return '<div class="switch ' + (on ? 'on' : '') + '" data-tgsw="' + id + '"><i></i></div>';
  }
  function pad2(n) { n = +n || 0; return (n < 10 ? '0' : '') + n; }
  function tgDesc(t) {
    if (t.kind === 'time') return '每天 ' + pad2(t.hh) + ':' + pad2(t.mm);
    if (t.kind === 'repeat') return '每 ' + (t.mins || 60) + ' 分钟';
    if (t.kind === 'notify') return '通知含「' + (t.text || '任意') + '」' + (t.pkg ? ' · ' + t.pkg : '');
    if (t.kind === 'power') return '插上充电器';
    if (t.kind === 'unlock') return '解锁屏幕时';
    return t.kind;
  }
  function viewTriggers() {
    var tg = S.triggers || [];
    var h = '<div class="hero"><div class="hi">自动化触发器</div>'
      + '<div class="ht">' + (tg.length ? tg.length + ' 条规则在盯着' : '让手机自己动起来') + '</div>'
      + '<div class="muted">到点 / 周期 / 收到通知 / 插上电 / 解锁屏，条件一满足就自动跑脚本。定时走系统闹钟，通知与解锁靠无障碍服务，App 不在前台也照样干活。</div>'
      + '<div class="row" style="margin-top:10px"><button class="btn grow" data-act="tgAdd">＋ 加一条规则</button></div></div>';
    if (!S.scripts.length) {
      h += '<div class="hint">⚠️ 先去「脚本」页建一个脚本，触发器才有东西可跑。</div>';
    }
    if (!tg.length) {
      return h + '<div class="empty"><span class="e">⚡</span>还没有规则<br>'
        + '<span class="tiny">比如「每天 9:00 跑签到」——设一次，长期躺平</span></div>';
    }
    h += '<div class="list">';
    for (var i = 0; i < tg.length; i++) {
      var t = tg[i], k = TG[t.kind] || { n: t.kind, e: '❔' };
      var sc = findScript(t.script);
      h += '<div class="item"><div class="ic g' + ((i % 6) + 1) + '">' + k.e + '</div>'
        + '<div class="grow"><div class="t">' + k.n + (sc ? '' : '<span class="chip">脚本没了</span>') + '</div>'
        + '<div class="d">' + esc(tgDesc(t)) + ' → ' + esc(sc ? sc.name : '未选脚本') + '</div></div>'
        + '<div class="acts">'
        + ((t.kind === 'time' || t.kind === 'repeat') ? '<button class="btn sm ghost" data-act="tgTest" data-id="' + t.id + '">▶</button>' : '')
        + '<button class="btn sm ghost" data-act="tgEdit" data-id="' + t.id + '">✎</button>'
        + tgsw(t.id, t.on !== false) + '</div></div>';
    }
    return h + '</div>';
  }

  function sheetTgAdd() {
    var h = '<h3>挑一种触发方式</h3><div class="grid">';
    for (var k in TG) {
      h += '<div class="tile" data-act="tgNew" data-k="' + k + '"><div class="e">' + TG[k].e
        + '</div><div class="n">' + TG[k].n + '</div><div class="s">' + TG[k].d + '</div></div>';
    }
    return h + '</div><button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">取消</button>';
  }

  function sheetTgEdit(t) {
    var k = TG[t.kind] || { n: t.kind, e: '❔' };
    var h = '<h3>' + k.e + ' ' + k.n + '</h3>';
    if (!S.scripts.length) {
      return h + '<div class="empty"><span class="e">🫠</span>还没有脚本<br><span class="tiny">先去建一个吧</span></div>'
        + '<button class="btn wide" data-act="cancelAct">关闭</button>';
    }
    var opts = '';
    for (var i = 0; i < S.scripts.length; i++) {
      opts += '<option value="' + S.scripts[i].id + '"'
        + (S.scripts[i].id === t.script ? ' selected' : '') + '>' + esc(S.scripts[i].name) + '</option>';
    }
    h += '<label class="f"><span>要跑哪个脚本</span><select id="tgs">' + opts + '</select></label>';
    if (t.kind === 'time') {
      h += '<label class="f"><span>几点跑（24 小时制）</span><div class="row">'
        + '<input id="tghh" type="number" value="' + (t.hh == null ? 8 : t.hh) + '">'
        + '<input id="tgmm" type="number" value="' + (t.mm == null ? 0 : t.mm) + '"></div></label>';
    } else if (t.kind === 'repeat') {
      h += '<label class="f"><span>每隔多少分钟（最小 1）</span><input id="tgm" type="number" value="' + (t.mins || 60) + '"></label>';
    } else if (t.kind === 'notify') {
      h += '<label class="f"><span>通知里要包含的文字（留空 = 任何通知都算）</span><input id="tgt" value="' + esc(t.text || '') + '"></label>';
      h += '<label class="f"><span>只看哪个 App 的通知（留空 = 不限）</span><input id="tgp" value="' + esc(t.pkg || '') + '" placeholder="如 com.tencent.mm"></label>';
      h += '<div class="row"><button class="btn sm ghost grow" data-act="fillApp">用当前前台 App 填包名</button></div>';
    } else {
      h += '<div class="muted">这条只要条件满足就跑，没有别的参数。</div>';
    }
    h += '<div class="kv"><span>启用</span>' + tgsw(t.id, t.on !== false) + '</div>';
    h += '<div class="row" style="margin-top:14px"><button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="tgSave" data-id="' + t.id + '">保存</button></div>'
      + '<button class="btn warn wide" style="margin-top:9px" data-act="tgDel" data-id="' + t.id + '">🗑 删掉这条</button>';
    return h;
  }

  function tgFind(id) {
    var tg = S.triggers || [];
    for (var i = 0; i < tg.length; i++) if (tg[i].id === id) return tg[i];
    return null;
  }
  function saveTriggers() { ok(call('saveTriggers', JSON.stringify(S.triggers || []))); }

  function tgSave(id) {
    var t = tgFind(id);
    if (!t) return;
    var sel = document.getElementById('tgs');
    if (sel) t.script = sel.value;
    if (t.kind === 'time') {
      var hh = document.getElementById('tghh'), mm = document.getElementById('tgmm');
      if (hh) t.hh = Math.max(0, Math.min(23, parseInt(hh.value, 10) || 0));
      if (mm) t.mm = Math.max(0, Math.min(59, parseInt(mm.value, 10) || 0));
    } else if (t.kind === 'repeat') {
      var m = document.getElementById('tgm');
      if (m) t.mins = Math.max(1, parseInt(m.value, 10) || 60);
    } else if (t.kind === 'notify') {
      var tx = document.getElementById('tgt'), pk = document.getElementById('tgp');
      if (tx) t.text = tx.value.trim();
      if (pk) t.pkg = pk.value.trim();
    }
    var tgSw = document.querySelector('#sheet [data-tgsw]');
    if (tgSw) t.on = tgSw.classList.contains('on');
    saveTriggers();
    closeSheet();
    render();
    toast('规则存好了');
  }

  // ---------- 录制 ----------
  function viewRecord() {
    var on = S.st && S.st.recording;
    var st = S.st || {};
    var h = '<div class="hero"><div class="hi">操作录制</div>'
      + '<div class="ht">' + (on ? '🔴 正在录制…' : '让我看看你怎么点的') + '</div>'
      + '<div class="muted">开启后去别的 App 随便点，屏幕顶部会出现录制条（停止 / 加 2 秒等待 / 撤销上一步）。</div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn grow ' + (on ? 'warn' : 'ok') + '" data-act="rec">' + (on ? '⏹ 停止录制' : '⏺ 开始录制') + '</button>'
      + '<button class="btn ghost" data-act="recRefresh">刷新</button></div></div>';
    // 开工前把必要条件摆出来，省得录了半天一场空
    if (!st.acc) {
      h += '<div class="card warn"><b>无障碍没开</b><br><span class="tiny">录制和点击都靠它。</span>'
        + '<div class="row" style="margin-top:8px"><button class="btn sm ok" data-act="acc">去开启</button></div></div>';
    }
    if (!st.overlay) {
      h += '<div class="card warn"><b>悬浮窗权限没开</b><br><span class="tiny">开了它才能抓屏幕触点，游戏、自绘界面这类不给节点的 App 也录得上。</span>'
        + '<div class="row" style="margin-top:8px"><button class="btn sm ok" data-act="overlay">去开启</button></div></div>';
    }
    if (on) {
      h += '<div class="card"><b>录制中</b><br><span class="tiny">'
        + (st.touch ? '触点捕获：✅ 已开启，任意界面都能录坐标。' : '触点捕获：⚠️ 没开，只能录有节点的界面（很多 App / 游戏录不到）。')
        + '</span></div>';
    }
    var rec = S.rec || [];
    if (!rec.length) {
      return h + '<div class="empty"><span class="e">🎬</span>还没有录到动作<br>'
        + '<span class="tiny">' + (on ? '去别的 App 点几下，回来就有' : '点上面的红按钮，然后去别的 App 表演') + '</span></div>';
    }
    h += '<div class="row" style="margin:0 2px 10px"><div class="grow muted">共 ' + rec.length + ' 步</div>'
      + '<button class="btn sm ok" data-act="recSave">存为脚本</button>'
      + '<button class="btn sm ghost" data-act="recClear">清空</button></div><div class="list">';
    for (var i = 0; i < rec.length; i++) {
      var a = rec[i];
      var t = TYPES[a.t] || { n: a.t, e: '❔' };
      h += '<div class="item"><div class="ic g' + ((i % 6) + 1) + '">' + t.e + '</div><div class="grow">'
        + '<div class="t">' + (i + 1) + '. ' + t.n + '</div>'
        + '<div class="d">' + esc(actSummary(a)) + '</div></div>'
        + '<div class="acts"><button class="btn sm ghost" data-act="recDel" data-i="' + i + '">✕</button></div></div>';
    }
    return h + '</div>';
  }

  // ---------- 日志 ----------
  // ---------- 我的：日志/自动化/设置/关于 的入口 ----------
  var MINE = [
    { k: 'log', e: '🧾', n: '运行日志', d: '看看刚才到底干了啥', tone: 5 },
    { k: 'trig', e: '⚡', n: '自动触发', d: '定时、通知、插电、解锁时自动跑', tone: 1 },
    { k: 'settings', e: '⚙️', n: '设置', d: '悬浮球、主题、循环与防检测抖动', tone: 4 },
    { k: 'about', e: '💡', n: '关于', d: '版本说明与更新日志', tone: 3 }
  ];
  function subBar() {
    var m = null;
    for (var i = 0; i < MINE.length; i++) if (MINE[i].k === S.sub) m = MINE[i];
    return '<div class="subbar"><button class="btn sm ghost" data-act="mineBack">‹ 我的</button>'
      + '<span class="sbt">' + esc(m ? m.n : '') + '</span></div>';
  }
  function viewMine() {
    var st = S.st || {};
    var h = '<div class="hero"><div class="hi">我的</div>'
      + '<div class="ht">' + (S.scripts.length
        ? S.scripts.length + ' 个脚本待命' + (st.running ? ' · 正在跑' : '')
        : '一个脚本都还没有') + '</div>'
      + '<div class="hs">' + dot(st.acc, '无障碍', 'acc') + dot(st.overlay, '悬浮窗', 'overlay')
      + (st.ball ? '<span class="dot ok"><b></b>悬浮球在岗</span>' : '')
      + (st.running ? '<span class="dot run"><b></b>运行中</span>' : '') + '</div></div>';
    h += hintBox() + '<div class="list">';
    for (var i = 0; i < MINE.length; i++) {
      var m = MINE[i];
      h += '<div class="item" data-act="mineGo" data-k="' + m.k + '">'
        + '<div class="ic g' + m.tone + '">' + m.e + '</div>'
        + '<div class="grow"><div class="t">' + esc(m.n) + '</div><div class="d">' + esc(m.d) + '</div></div>'
        + '<div class="acts"><span class="tiny">›</span></div></div>';
    }
    return h + '</div>';
  }

  // ---------- 脚本市场（整页） ----------
  function viewMarket() {
    var h = '<div class="hero"><div class="hi">🏪 脚本市场</div>'
      + '<div class="ht">挑一个装进「脚本」，装完随便改</div></div><div class="list">';
    for (var i = 0; i < MARKET.length; i++) {
      var m = MARKET[i];
      h += '<div class="item"><div class="ic g' + m.tone + '">' + m.icon + '</div>'
        + '<div class="grow"><div class="t">' + esc(m.n)
        + (m.mk().kind === 'js' ? '<span class="chip">JS</span>' : '') + '</div>'
        + '<div class="d">' + esc(m.d) + '</div></div>'
        + '<div class="acts"><button class="btn sm ok" data-act="mktGet" data-i="' + i + '">装</button></div></div>';
    }
    return h + '</div><div class="card"><div class="tiny">都是本地内置的，不联网、不上传。'
      + '想装别人做的脚本，用下面的「导入分享码」。</div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn ghost grow" data-act="importCode">📥 导入分享码</button>'
      + '<button class="btn ghost grow" data-act="exportAll">📤 导出全部</button></div></div>';
  }

  function viewLog() {
    var st = S.st || {};
    var logs = st.log || [];
    var h = '<div class="hero"><div class="hi">运行状态</div>'
      + '<div class="ht">' + (st.running ? '🏃 正在跑' : '💤 空闲中') + '</div>'
      + '<div class="row"><button class="btn warn grow" data-act="stop">■ 停止</button>'
      + '<button class="btn ghost" data-act="logRefresh">刷新</button></div></div>';
    h += '<div class="card"><div class="sec">最近输出</div>'
      + '<div class="log">' + (logs.length ? logs.map(esc).join('\n') : '（暂无日志，跑一次就有了）') + '</div></div>';
    return h;
  }

  // ---------- 设置 ----------
  function viewSettings() {
    var st = S.st || {}, p = S.prefs || {};
    var opts = '<option value="">— 默认行为 —</option>';
    for (var i = 0; i < S.scripts.length; i++) {
      opts += '<option value="' + S.scripts[i].id + '">' + esc(S.scripts[i].name) + '</option>';
    }
    function sel(k) {
      return '<select data-pref="' + k + '">'
        + opts.replace('value="' + (p[k] || '') + '"', 'value="' + (p[k] || '') + '" selected') + '</select>';
    }
    function slider(k, label, min, max, val, txt) {
      return '<div class="kv"><span style="width:78px;flex:0 0 78px">' + label + '</span>'
        + '<div class="grow"><input type="range" min="' + min + '" max="' + max + '" value="' + val
        + '" data-pref="' + k + '"></div><span class="tiny" style="width:46px;text-align:right">' + txt + '</span></div>';
    }

    var h = '';
    h += '<div class="card"><div class="sec">权限</div>'
      + '<div class="kv"><span>无障碍服务</span><button class="btn sm ' + (st.acc ? 'ghost' : 'ok') + '" data-act="acc">' + (st.acc ? '去设置' : '去开启') + '</button></div>'
      + '<div class="kv"><span>悬浮窗权限</span><button class="btn sm ' + (st.overlay ? 'ghost' : 'ok') + '" data-act="overlay">' + (st.overlay ? '去设置' : '去授权') + '</button></div>'
      + '<div class="kv"><span>悬浮球</span><button class="btn sm ' + (st.ball ? 'warn' : 'ok') + '" data-act="ball">' + (st.ball ? '隐藏' : '显示') + '</button></div>'
      + '</div>';

    h += '<div class="card"><div class="sec">悬浮球手势</div>'
      + '<div class="kv"><span style="width:60px;flex:0 0 60px">单击</span><div class="grow">' + sel('gTap') + '</div></div>'
      + '<div class="kv"><span style="width:60px;flex:0 0 60px">双击</span><div class="grow">' + sel('gDouble') + '</div></div>'
      + '<div class="kv"><span style="width:60px;flex:0 0 60px">三击</span><div class="grow">' + sel('gTriple') + '</div></div>'
      + '<div class="kv"><span style="width:60px;flex:0 0 60px">长按</span><div class="grow">' + sel('gLong') + '</div></div>'
      + '<div class="tiny" style="margin-top:8px">默认值：单击=跑上次脚本，双击=急刹车，三击=开始/停止录制，长按=弹脚本列表。</div>'
      + '</div>';

    h += '<div class="card"><div class="sec">手感</div>'
      + slider('ballSize', '球大小', 36, 80, (p.ballSize || 54), (p.ballSize || 54) + 'dp')
      + slider('ballAlpha', '透明度', 30, 100, Math.round((p.ballAlpha || 0.88) * 100), Math.round((p.ballAlpha || 0.88) * 100) + '%')
      + slider('speed', '节奏倍率', 30, 250, Math.round((p.speed || 1) * 100), (p.speed || 1).toFixed(2) + 'x')
      + '<div class="kv"><span>震动反馈</span>' + sw('vibrate', p.vibrate !== false) + '</div>'
      + '<div class="kv"><span>开机自启悬浮球</span>' + sw('boot', !!p.boot) + '</div>'
      + '<div class="kv"><span>录制时记录真实间隔</span>' + sw('autoRecordDelay', p.autoRecordDelay !== false) + '</div>'
      + '<div class="kv"><span>触点录制（抓屏幕坐标）</span>' + sw('touchRecord', p.touchRecord !== false) + '</div>'
      + '<div class="tiny" style="margin-top:6px">触点录制不依赖界面节点，游戏、自绘界面也录得上；需要悬浮窗权限。关掉后只走无障碍事件。</div>'
      + '</div>';

    h += '<div class="card"><div class="sec">配色</div><div class="themes">';
    for (var tk in THEMES) {
      h += '<button class="sw2' + ((p.theme || 'orange') === tk ? ' on' : '') + '" data-act="theme" data-v="'
        + tk + '" style="--c:' + THEME_C[tk] + '"><i></i><span>' + THEMES[tk] + '</span></button>';
    }
    h += '</div><div class="tiny" style="margin-top:8px">换主色，界面和悬浮球一起变。</div></div>';

    var cap = S.cap || {};
    h += '<div class="card"><div class="sec">图色识别（找色 / 比色 / 找图）</div>'
      + '<div class="kv"><span>截屏授权</span><span class="tiny">'
      + (cap.granted ? (cap.running ? '✅ 已授权，截屏中' : '✅ 已授权') : '❌ 未授权') + '</span></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn sm ' + (cap.granted ? 'ghost' : 'ok') + ' grow" data-act="reqCap">' + (cap.granted ? '重新授权' : '去授权截屏') + '</button>'
      + '<button class="btn sm ghost grow" data-act="goTpl">🖼 模板图</button></div>'
      + '<div class="tiny" style="margin-top:6px">授权后才能在屏幕上找颜色、找图片。找色和找图都不依赖界面节点，游戏里也能用。</div></div>';

    h += '<div class="card"><div class="sec">自动化</div>'
      + '<div class="muted">到点 / 周期 / 通知 / 插电 / 解锁自动跑脚本，在「⚡ 自动」页里配。</div>'
      + '<button class="btn wide ghost" style="margin-top:10px" data-act="goTrig">⚡ 去配触发器</button></div>';

    h += '<div class="card"><div class="sec">模式</div>'
      + '<div class="seg" style="margin-bottom:10px">'
      + '<button class="' + (p.mode !== 'ball' ? 'on' : '') + '" data-act="mode" data-v="normal">正常模式</button>'
      + '<button class="' + (p.mode === 'ball' ? 'on' : '') + '" data-act="mode" data-v="ball">悬浮球模式</button></div>'
      + '<div class="muted">悬浮球模式：收起界面只留一个球，靠手势干活。最省事，也最容易被朋友以为你在摸鱼。</div>'
      + '<button class="btn wide ghost" style="margin-top:11px" data-act="toBall">收起界面，只留悬浮球</button>'
      + '</div>';
    return h;
  }

  function sw(k, v) {
    return '<div class="switch ' + (v ? 'on' : '') + '" data-toggle="' + k + '"><i></i></div>';
  }

  // ---------- 关于 ----------
  function viewAbout() {
    var info = jcall('info') || {};
    return '<div class="hero"><div class="hi">关于</div>'
      + '<div class="ht">懒人点击器 v' + esc(info.version || '1.0.0') + '</div>'
      + '<div class="muted">一个靠无障碍服务替你点屏幕的小工具。不联网、不上传、不读隐私，只负责让你的手指少受点罪。</div>'
      + '<div class="tiny" style="margin-top:8px">Android ' + (info.sdk || '?') + ' · ' + esc(info.abi || '') + ' · build ' + (info.code || 1) + '</div></div>'
      + '<div class="card"><div class="sec">更新日志</div>' + CHANGELOG + '</div>'
      + '<div class="card"><div class="sec">小贴士</div><div class="muted">'
      + '· 坐标搞不准？用「录制」自动抓点，比手填准多了。<br>'
      + '· 换机型怕跑偏？动作里打开「百分比坐标」。<br>'
      + '· 想假装是人手在点？用「随机点」带点抖动，再开等待抖动。<br>'
      + '· 跑疯了怎么办？双击悬浮球，或者下拉通知栏点停止。</div></div>'
      + '<div class="card"><div class="sec">变量怎么用</div><div class="muted">'
      + '在编辑页先加变量，然后<b>任何字段</b>里都能写 <code>{{变量名}}</code>，跑的时候会换成当时的值。<br>'
      + '· <code>{{gap}}</code> —— 换成变量的值，前后还能带字，比如「第 {{n}} 次」。<br>'
      + '· <code>{{n+1}}</code>、<code>{{lastX-20}}</code> —— 里面能算，加减乘除取余都行。<br>'
      + '· <code>{{rand(800,1200)}}</code> —— 随机等 0.8~1.2 秒，每次都不一样。<br>'
      + '· <code>{{lastX}}</code>、<code>{{lastY}}</code> —— 上一次找色/找图点中的位置，可以接着操作。<br>'
      + '· <code>{{loop}}</code>、<code>{{step}}</code>、<code>{{screenW}}</code>、<code>{{cnt.名字}}</code> —— 内置变量。<br>'
      + '算式写错了不会崩，会原样留在那儿，日志里也看得出来。</div></div>';
  }

  var CHANGELOG = [
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.4.0</div>新增自动化触发器（每天定时／每隔 N 分钟／收到指定通知／插上电源／解锁屏幕）、「如果…就跳步」条件判断、计数器、多指手势（齐点·按住·捏合·张开）；动作与脚本支持按住 ⋮⋮ 拖拽排序，新增六种配色、转场动画与横屏平板适配；修复「脚本只会重复第一个动作」的重大缺陷。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.3.0</div>界面换成通透玻璃质感（毛玻璃卡片＋光晕背景＋浮动导航），渲染走帧节流，脚本支持图标、备注与搜索，新增「开始前先等几秒」，滑动条不再被打断。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.2.0</div>模板脚本库（连点器／刷视频／签到／跳广告／挂机）、运行次数统计、找字失败即停、磁贴一键跑。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.1.0</div>新增找文字点击、导入导出、录制悬浮条、贴边淡出、动作重复次数、等待抖动。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.0.0</div>首发：无障碍内核、脚本编辑、录制回放、悬浮球手势。'
  ].join('');

  // ---------- 弹层 ----------
  function sheet(html) {
    $('#sheet').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function closeSheet() { $('#modal').classList.add('hidden'); }
  window.__back = function () {
    if (!$('#modal').classList.contains('hidden')) { closeSheet(); return true; }
    if (S.tab === 'scripts' && S.editId) { S.editId = null; render(); return true; }
    if (S.tab === 'mine' && S.sub) { S.sub = null; render(); return true; }
    if (S.tab !== 'scripts') { S.tab = 'scripts'; render(); return true; }
    return false;
  };

  // ---------- 模板库 ----------
  var TEMPLATES = [
    { n: '🔨 连点器', d: '对同一个点疯狂输出', icon: '🔨', tone: 1, mk: function () {
        return { name: '连点器', desc: '按住别停', loop: true, actions: [{ t: 'click', x: 50, y: 62, pct: 1, d: 130, repeat: 50 }] }; } },
    { n: '📺 刷视频', d: '上滑 + 随机点赞', icon: '📺', tone: 4, mk: function () {
        return { name: '刷视频', desc: '假装有人在看', loop: true, jitter: true, actions: [
          { t: 'swipe', x1: 50, y1: 78, x2: 50, y2: 24, pct: 1, ms: 320, d: 2200 },
          { t: 'random', x: 88, y: 62, r: 22, pct: 1, d: 800 }] }; } },
    { n: '🎁 自动签到', d: '开 App 找「签到」点掉', icon: '🎁', tone: 3, mk: function () {
        return { name: '自动签到', desc: '白嫖积分', loop: false, actions: [
          { t: 'launch', p: 'com.tencent.mm', d: 2500 },
          { t: 'find', s: '签到', click: true, contains: true, timeout: 5000, index: 1, d: 900 },
          { t: 'key', k: 'back', d: 500 }] }; } },
    { n: '⏭ 跳过广告', d: '盯着「跳过」一直点', icon: '⏭', tone: 5, mk: function () {
        return { name: '跳过广告', desc: '广告克星', loop: true, actions: [
          { t: 'find', s: '跳过', click: true, contains: true, timeout: 1500, index: 1, d: 400 },
          { t: 'wait', ms: 600 }] }; } },
    { n: '🎮 游戏挂机', d: '点两下等一等，循环', icon: '🎮', tone: 2, mk: function () {
        return { name: '游戏挂机', desc: '手酸终结者', loop: true, jitter: true, actions: [
          { t: 'click', x: 30, y: 72, pct: 1, d: 600 },
          { t: 'click', x: 70, y: 72, pct: 1, d: 600 },
          { t: 'wait', ms: 3000 }] }; } },
    { n: '🫧 空白脚本', d: '从零开始自己拼', icon: '🫧', tone: 6, mk: function () {
        return { name: '新脚本 ' + (S.scripts.length + 1), desc: '', loop: false, loopCount: 1, actions: [] }; } }
  ];

  // ---------- 脚本 CRUD ----------
  function newScript() {
    sheet('<h3>挑个模板</h3><div class="grid">'
      + TEMPLATES.map(function (t, i) {
        return '<div class="tile" data-act="pickTpl" data-i="' + i + '"><div class="e">' + t.n.split(' ')[0]
          + '</div><div class="n">' + t.n.split(' ').slice(1).join(' ') + '</div>'
          + '<div class="s">' + t.d + '</div></div>';
      }).join('')
      + '<div class="tile" data-act="newJs"><div class="e">📜</div><div class="n">JS 脚本</div>'
      + '<div class="s">直接写代码，循环判断随你写</div></div>'
      + '</div><div class="tiny" style="margin-top:10px">模板坐标用百分比，换机型也不跑偏，进去再微调即可。</div>'
      + '<button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">取消</button>');
  }

  // ---------- 脚本市场（v1.8.0，本地内置，不联网） ----------
  // 每个都是能直接跑的完整脚本，装完还能自己改
  var MARKET = [
    { n: '每日签到', d: '开 App → 找「签到」→ 记一笔 → 收工。带计数和变量，能看第几次',
      icon: '🎁', tone: 3, mk: function () {
        return { name: '每日签到', desc: '每天点一下，积分到手', kind: '', loop: false, loopCount: 1, startDelay: 3,
          vars: [{ k: 'n', v: '0' }],
          actions: [
            { t: 'launch', p: 'com.tencent.mm', d: 2500 },
            { t: 'find', s: '签到', click: true, contains: true, timeout: 5000, index: 1, d: 900 },
            { t: 'if', m: 'text', s: '领取成功', contains: true, go: 0, els: -1, d: 200 },
            { t: 'math', k: 'n', e: 'n+1', d: 100 },
            { t: 'key', k: 'back', d: 500 }] }; } },
    { n: '连点器', d: '对一个点疯狂输出，次数、节奏都能调',
      icon: '🔨', tone: 1, mk: function () {
        return { name: '连点器', desc: '手指终结者', kind: '', loop: true, jitter: true,
          actions: [{ t: 'click', x: 50, y: 62, pct: 1, d: 130, repeat: 50 }] }; } },
    { n: '刷短视频', d: '上滑 + 随机点赞，带抖动，节奏不像机器人',
      icon: '📺', tone: 4, mk: function () {
        return { name: '刷短视频', desc: '假装有人在看', kind: '', loop: true, jitter: true,
          actions: [
            { t: 'swipe', x1: 50, y1: 78, x2: 50, y2: 24, pct: 1, ms: 320, d: 2200 },
            { t: 'random', x: 88, y: 62, r: 22, pct: 1, d: 800 }] }; } },
    { n: '跳过广告', d: '盯着「跳过」一直点，找不到就等下一轮',
      icon: '⏭', tone: 5, mk: function () {
        return { name: '跳过广告', desc: '广告克星', kind: '', loop: true,
          actions: [
            { t: 'find', s: '跳过', click: true, contains: true, timeout: 1500, index: 1, d: 400 },
            { t: 'wait', ms: 600 }] }; } },
    { n: '游戏挂机', d: '点两下等三秒，循环，适合收菜类',
      icon: '🎮', tone: 2, mk: function () {
        return { name: '游戏挂机', desc: '手酸bye bye', kind: '', loop: true, jitter: true,
          actions: [
            { t: 'click', x: 30, y: 72, pct: 1, d: 600 },
            { t: 'click', x: 70, y: 72, pct: 1, d: 600 },
            { t: 'wait', ms: 3000 }] }; } },
    { n: '找色点击（JS）', d: 'JS 写的：循环找橙色按钮，找到就点，最多 5 次',
      icon: '📜', tone: 6, mk: function () {
        return { name: '找色点击', desc: 'JS 脚本示例', kind: 'js', loop: false, loopCount: 1,
          actions: [], vars: [],
          code: '// 循环找橙色按钮，找到就点，最多 5 次\nawait sleep(2000);\n\n'
            + "for (var i = 0; i < 5; i++) {\n"
            + "  var p = await findColor('#FF6B35', { sim: 92 });\n"
            + "  if (!p) { log('第 ' + (i + 1) + ' 轮没找到'); break; }\n"
            + "  log('点 (' + p.x + ',' + p.y + ') 像 ' + p.sim + '%');\n"
            + '  await click(p.x, p.y);\n'
            + '  await sleep(800 + rand(0, 400));\n'
            + "}\ntoast('收工');\n" }; } }
  ];

  function mktGet(i) {
    var m = MARKET[i];
    if (!m) return;
    var s = m.mk();
    s.id = uid();
    s.runs = 0;
    S.scripts.unshift(s);
    saveScripts();
    closeSheet();
    S.tab = 'scripts';              // 装完带到「脚本」页，不然用户看不见装哪了
    render();
    toast('装好了：' + m.n);
  }

  function sheetShare(id) {
    var code = call('shareCode', id);
    if (code.indexOf('err:') === 0) { toast(code.slice(4)); return; }
    sheet('<h3>分享码</h3>'
      + '<div class="muted">复制这段发给别人；对方在「🏪 脚本市场」里点「导入分享码」贴进去就能用。</div>'
      + '<textarea id="shr" class="code" rows="5" style="min-height:110px;margin-top:10px">' + esc(code) + '</textarea>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn ok grow" data-act="copyCode">📋 复制</button>'
      + '<button class="btn ghost" data-act="cancelAct">关闭</button></div>');
  }

  function sheetImportCode() {
    sheet('<h3>导入分享码</h3>'
      + '<div class="muted">把别人给你的那串 <code>LT1.</code> 开头的东西粘进来。</div>'
      + '<textarea id="impc" class="code" rows="5" style="min-height:110px;margin-top:10px"'
      + ' placeholder="LT1.…"></textarea>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn ok grow" data-act="importCodeGo">📥 导入</button>'
      + '<button class="btn ghost" data-act="cancelAct">取消</button></div>');
  }

  function importCodeGo() {
    var v = ((document.getElementById('impc') || {}).value || '').trim();
    if (!v) { toast('先粘贴一段分享码'); return; }
    var r = call('importCode', v);
    if (r.indexOf('err:') === 0) { toast(r.slice(4)); return; }
    var n = parseInt(r.slice(3), 10) || 1;
    closeSheet();
    refreshAll();
    toast('导入了 ' + n + ' 个脚本');
  }

  function sheetExportAll() {
    var code = call('shareAll');
    if (code.indexOf('err:') === 0) { toast(code.slice(4)); return; }
    sheet('<h3>导出全部</h3>'
      + '<div class="muted">这一串里装着你全部 ' + S.scripts.length + ' 个脚本，换手机时粘过去就行。</div>'
      + '<textarea id="shr" class="code" rows="5" style="min-height:110px;margin-top:10px">' + esc(code) + '</textarea>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn ok grow" data-act="copyCode">📋 复制</button>'
      + '<button class="btn ghost" data-act="cancelAct">关闭</button></div>');
  }

  function newJsScript() {
    var s = {
      id: uid(), name: '新 JS 脚本', desc: '', icon: '📜', tone: 1,
      kind: 'js', actions: [], vars: [],
      code: '// 每个动作前面都要写 await\nawait sleep(2000);\nawait clickP(50, 50);\n'
    };
    S.scripts.unshift(s);
    saveScripts();
    closeSheet();
    openEditor(s.id);
    toast('建好了，写代码吧');
  }

  function useTemplate(i) {
    var t = TEMPLATES[i];
    var s = t.mk();
    s.id = uid();
    s.icon = t.icon;
    s.tone = t.tone;
    s.loop = !!s.loop;
    s.loopCount = s.loopCount || 1;
    S.scripts.unshift(s);
    saveScripts();
    closeSheet();
    openEditor(s.id);
    toast('模板已生成，改改就能跑');
  }

  function openEditor(id) {
    S.editId = id;
    S.tab = 'scripts';
    render();
  }

  // 改开关前先把输入框里的东西收回来，免得重绘弄丢
  function syncEditorInputs() {
    var s = findScript(S.editId);
    if (!s) return;
    var n = document.getElementById('sname');
    if (n) s.name = n.value.trim() || '未命名脚本';
    var d = document.getElementById('sdesc');
    if (d) s.desc = d.value.trim();
    var c = document.getElementById('scount');
    if (c) s.loopCount = Math.max(1, parseInt(c.value || '1', 10) || 1);
    var w = document.getElementById('sdelay');
    if (w) s.startDelay = Math.max(0, parseInt(w.value || '0', 10) || 0);
    var code = document.getElementById('scode');
    if (code) s.code = code.value;      // JS 脚本的代码也在输入框里，别被重绘冲掉
    syncVars(s);
  }

  // ---------- JS 脚本编辑器（v1.7.0） ----------

  var JS_DEMO = [
    '// 循环签到：找到橙色按钮就点，最多点 5 次',
    "await launch('com.example.app');",
    'await sleep(3000);',
    '',
    'for (var i = 0; i < 5; i++) {',
    "  var p = await findColor('#FF6B35', { sim: 92 });",
    "  if (!p) { log('第 ' + (i + 1) + ' 轮没找到按钮'); break; }",
    "  log('点 (' + p.x + ',' + p.y + ') 像 ' + p.sim + '%');",
    '  await click(p.x, p.y);',
    '  await sleep(800 + rand(0, 400));',
    '}',
    "toast('收工');"
  ].join('\n');

  var JS_API_DOC = [
    ['sleep(ms)', '等一会儿'],
    ['click(x, y)', '点一下（像素坐标）'],
    ['clickP(x%, y%)', '按屏幕百分比点，换机型不跑偏'],
    ['doubleClick(x, y)', '双击'],
    ['longClick(x, y, ms)', '长按'],
    ['swipe(x1,y1,x2,y2,ms)', '滑动'],
    ['randomClick(x, y, r)', '带抖动的点击'],
    ['multi(手势, x, y, ms)', 'twoTap/twoLong/pinch/spread'],
    ['key(名字)', 'back / home / recents / lock ...'],
    ['input(文字)', '往当前输入框打字'],
    ['launch(包名)', '打开某个 App'],
    ['tapText(文字)', '找文字并点它'],
    ['hasText(文字)', '屏幕上有没有这段字 → true/false'],
    ['hasApp(包名)', '当前是不是这个 App → true/false'],
    ['findColor(颜色)', '找颜色 → {x,y,sim} 或 null'],
    ['findImage(名字)', '找模板图 → {x,y,sim} 或 null'],
    ['cmpColor(x,y,颜色)', '某点颜色对不对 → true/false'],
    ['setVar(名, 值)', '存变量'],
    ['getVar(名)', '取变量'],
    ['count(名)', '计数器加一，返回当前值'],
    ['rand(a, b)', '随机数'],
    ['screen()', '屏幕尺寸 {w, h}'],
    ['log(...)', '写进运行日志'],
    ['toast(话)', '屏幕下方弹一句'],
    ['stop()', '主动结束脚本']
  ];

  function viewJsEditor(s) {
    var busy = !!(S.st && S.st.js);
    var h = '<div class="card"><div class="row">'
      + '<button class="btn sm ghost" data-act="back">‹ 返回</button>'
      + '<div class="ic g' + (s.tone || 1) + '" data-act="pickIcon" data-id="' + s.id
      + '" style="width:34px;height:34px;flex:0 0 34px;font-size:16px">' + (s.icon || '📜') + '</div>'
      + '<div class="grow"><input id="sname" value="' + esc(s.name) + '" placeholder="脚本名"></div>'
      + '<button class="btn sm ok" data-act="save">保存</button></div>'
      + '<label class="f" style="margin-top:10px"><span>备注（给自己看的，可留空）</span>'
      + '<input id="sdesc" value="' + esc(s.desc || '') + '" placeholder="比如：每天 9 点签到"></label>'
      + '</div>';

    h += '<div class="card"><div class="sec">跑一下</div><div class="row">'
      + (busy
        ? '<button class="btn warn grow" data-act="stopJs">■ 停止</button>'
        : '<button class="btn ok grow" data-act="runJs" data-id="' + s.id + '">▶ 跑脚本</button>')
      + '<button class="btn ghost" data-act="jsApi">📖 能调什么</button></div>'
      + '<div class="tiny" style="margin-top:8px">'
      + (busy ? '正在跑。脚本里的 <code>log()</code> 会写进「📋 日志」页。'
        : '每个动作都要写 <code>await</code>，脚本跑在界面线程，别写不带 await 的死循环。')
      + '</div></div>';

    h += '<div class="card"><div class="sec">代码</div>'
      + '<textarea id="scode" class="code" spellcheck="false" rows="14"'
      + ' placeholder="// 在这里写 JS，比如：&#10;await click(540, 1200);">' + esc(s.code || '') + '</textarea>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn sm ghost grow" data-act="jsDemo">📄 放个例子</button>'
      + '<button class="btn sm ghost grow" data-act="jsClear">🧹 清空</button></div>'
      + '<div class="tiny" style="margin-top:6px">写完记得点右上角「保存」，代码存在脚本里，导出 JSON 一并带走。</div></div>';
    return h;
  }

  function sheetJsApi() {
    var h = '<h3>脚本里能调什么</h3><div class="card" style="box-shadow:none;padding:0">';
    for (var i = 0; i < JS_API_DOC.length; i++) {
      h += '<div class="kv"><code>' + esc(JS_API_DOC[i][0]) + '</code>'
        + '<span class="tiny" style="flex:0 0 auto;margin-left:10px">' + esc(JS_API_DOC[i][1]) + '</span></div>';
    }
    h += '</div><div class="tiny" style="margin-top:10px">写出来的就是标准 JS，'
      + 'if / for / 函数都能用；只是每个动作要加 <code>await</code>。</div>'
      + '<button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">关闭</button>';
    return h;
  }

  function viewEditor(s) {
    if (s.kind === 'js') return viewJsEditor(s);
    var acts = s.actions || [];
    var h = '<div class="card"><div class="row">'
      + '<button class="btn sm ghost" data-act="back">‹ 返回</button>'
      + '<div class="ic g' + (s.tone || 1) + '" data-act="pickIcon" data-id="' + s.id + '" style="width:34px;height:34px;flex:0 0 34px;font-size:16px">' + (s.icon || '📜') + '</div>'
      + '<div class="grow"><input id="sname" value="' + esc(s.name) + '" placeholder="脚本名"></div>'
      + '<button class="btn sm ok" data-act="save">保存</button></div>'
      + '<label class="f" style="margin-top:10px"><span>备注（给自己看的，可留空）</span>'
      + '<input id="sdesc" value="' + esc(s.desc || '') + '" placeholder="比如：每天 9 点签到"></label>'
      + '<div class="kv"><span>循环播放</span>' + sw('loop', !!s.loop) + '</div>'
      + (s.loop ? '' : '<label class="f"><span>跑几遍</span><input id="scount" type="number" value="' + (s.loopCount || 1) + '"></label>')
      + '<label class="f"><span>开始前先等几秒（留时间切到别的 App）</span><input id="sdelay" type="number" value="' + (s.startDelay || 0) + '"></label>'
      + '<div class="kv"><span>等待时间加抖动（±25%，更像人手）</span>' + sw('jitter', !!s.jitter) + '</div>'
      + '<div class="kv"><span>找文字找不到就停下</span>' + sw('stopOnFail', !!s.stopOnFail) + '</div>'
      + '</div>';

    h += varsCard(s);

    h += '<div class="row" style="margin:0 2px 10px"><div class="grow muted">' + acts.length + ' 个动作'
      + '<div class="tiny" style="margin-top:2px">跳转填第几步（就是左边那个序号）：0=下一步，−1=收工，−2=重来一轮</div></div>'
      + '<button class="btn sm ok" data-act="run" data-id="' + s.id + '">▶ 试跑</button>'
      + '<button class="btn sm ghost" data-act="addAct">＋ 加动作</button></div>';

    if (!acts.length) {
      h += '<div class="empty"><span class="e">🧩</span>一个动作都没有<br><span class="tiny">点「＋ 加动作」一步步拼出你的流程</span></div>';
      return h;
    }
    h += '<div class="list' + (window.innerWidth >= 720 ? ' two' : '') + '">';
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i], t = TYPES[a.t] || { n: a.t, e: '❔' };
      h += '<div class="item"><div class="grip" data-drag="' + i + '" data-list="acts">⋮⋮</div>'
        + '<div class="ic g' + ((i % 6) + 1) + '">' + t.e + '</div>'
        + '<div class="grow" data-act="editAct" data-i="' + i + '">'
        + '<div class="t">' + (i + 1) + '. ' + t.n + (a.repeat > 1 ? '<span class="chip">×' + a.repeat + '</span>' : '') + '</div>'
        + '<div class="d">' + esc(actSummary(a)) + '</div></div>'
        + '<div class="acts">'
        + '<button class="btn sm ghost" data-act="testAct" data-i="' + i + '">▶</button>'
        + '<button class="btn sm ghost" data-act="mvUp" data-i="' + i + '">↑</button>'
        + '<button class="btn sm ghost" data-act="mvDn" data-i="' + i + '">↓</button>'
        + '<button class="btn sm ghost" data-act="dupAct" data-i="' + i + '">⧉</button>'
        + '<button class="btn sm ghost" data-act="delAct" data-i="' + i + '">✕</button>'
        + '</div></div>';
    }
    return h + '</div>';
  }

  // ---------- 动作编辑 ----------
  function sheetAddAct() {
    var h = '<h3>加一个动作</h3><div class="grid">';
    for (var k in TYPES) {
      h += '<div class="tile" data-act="pickType" data-t="' + k + '"><div class="e">' + TYPES[k].e
        + '</div><div class="n">' + TYPES[k].n + '</div></div>';
    }
    return h + '</div><button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">取消</button>';
  }

  function sheetEditAct(i) {
    var s = findScript(S.editId);
    var a = s.actions[i];
    if (!a) { closeSheet(); return ''; }
    S.editAct = i;
    var t = TYPES[a.t] || { n: a.t, e: '❔', f: [] };
    if (a.t === 'cond') return condActForm(a, i);   // 条件动作有专门的表单
    var h = '<h3>' + t.e + ' ' + t.n + '</h3>';
    for (var j = 0; j < t.f.length; j++) {
      var key = t.f[j][0], label = t.f[j][1], kind = t.f[j][2];
      if (kind === 'switch') {
        h += '<div class="kv"><span>' + label + '</span>' + '<div class="switch ' + (a[key] ? 'on' : '') + '" data-field="' + key + '"><i></i></div></div>';
      } else if (kind === 'color') {
        h += '<label class="f"><span>' + label + '</span>'
          + '<span class="row" style="gap:8px"><span class="swatch" style="background:' + esc(a[key] || '#000') + '" data-swatch="' + key + '"></span>'
          + '<input data-field="' + key + '" type="text" value="' + esc(a[key] == null ? '' : a[key]) + '" class="grow"></span></label>'
          + '<button class="btn ghost wide" style="margin:0 0 4px" data-act="pickColor" data-field-for="' + key + '">🎨 截图取色</button>';
      } else if (kind === 'var' || kind === 'expr') {
        h += '<label class="f"><span>' + label + '</span>'
          + '<input data-field="' + key + '" type="text" value="' + esc(a[key] == null ? '' : a[key]) + '"></label>'
          + '<div class="row" style="margin:-4px 0 6px;gap:6px">'
          + '<button class="btn sm ghost" data-act="insVar" data-field-for="' + key + '">🧩 插入变量</button>'
          + (kind === 'expr' ? '<button class="btn sm ghost" data-act="tryExpr" data-field-for="' + key + '">= 试算</button>' : '')
          + '</div>';
      } else if (kind && kind.indexOf('sel:') === 0) {
        var optKey = kind.slice(4);
        var opts = OPTS[optKey] || [];
        h += '<label class="f"><span>' + label + '</span><select data-field="' + key + '">';
        for (var z = 0; z < opts.length; z++) {
          h += '<option value="' + esc(opts[z][0]) + '"' + (String(a[key]) === String(opts[z][0]) ? ' selected' : '') + '>' + esc(opts[z][1]) + '</option>';
        }
        h += '</select></label>';
        if (optKey === 'tpls') {
          if (!opts.length) h += '<div class="tiny" style="margin:-4px 0 6px">还没有模板图，先去「设置 → 图色模板」截一张存起来。</div>';
          else h += '<button class="btn ghost wide" style="margin:0 0 4px" data-act="goTpl">🖼 管理模板图</button>';
        }
      } else if (kind === 'key') {
        h += '<label class="f"><span>' + label + '</span><select data-field="' + key + '">';
        for (var q = 0; q < KEYS.length; q++) {
          var kv = KEYS[q].split(':');
          h += '<option value="' + kv[0] + '"' + (a[key] === kv[0] ? ' selected' : '') + '>' + kv[1] + '</option>';
        }
        h += '</select></label>';
      } else {
        h += '<label class="f"><span>' + label + '</span><input data-field="' + key + '" type="' + (kind === 'text' ? 'text' : 'number') + '" value="' + esc(a[key] == null ? '' : a[key]) + '"></label>';
      }
    }
    h += '<label class="f"><span>这个动作重复几次（省得复制粘贴）</span><input data-field="repeat" type="number" value="' + (a.repeat || 1) + '"></label>';
    if (t.c) {
      h += '<div class="kv"><span>用百分比坐标（换机型不跑偏）</span><div class="switch ' + (a.pct ? 'on' : '') + '" data-field="pct"><i></i></div></div>';
      h += '<button class="btn ghost wide" style="margin-top:10px" data-act="pickPoint" data-i="' + i + '">🎯 在屏幕图上取点</button>';
    }
    h += '<div class="row" style="margin-top:14px">'
      + '<button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="saveAct" data-i="' + i + '">保存</button></div>';
    return h;
  }

  // ---------- 条件判断动作的表单（v2.0.0） ----------

  /** 条件动作的主表单：满足模式 + 条件清单（就地增删，不跳层） */
  function condActForm(a, i) {
    if (!a.cs) a.cs = [];
    var h = '<h3>' + '🧠 条件判断</h3>'
      + '<div class="muted">把几个条件凑在一起判断，成立走一条路，不成立走另一条。'
      + '跟老的「如果 / 找色 / 比变量」那套步号跳转并存，随便混用。</div>';

    h += '<div class="cond"><div class="ch">满足模式</div>'
      + '<label class="f"><span>这几个条件要怎么才算成立</span><select data-field="mode">';
    for (var m = 0; m < CMODE.length; m++) {
      h += '<option value="' + m + '"' + ((a.mode || 0) === m ? ' selected' : '') + '>' + esc(CMODE[m][1]) + '</option>';
    }
    h += '</select></label>'
      + '<label class="f" id="nwrap"' + ((a.mode || 0) === 2 ? '' : ' style="display:none"')
      + '><span>凑够几个</span><input data-field="n" type="number" value="' + (a.n || 1) + '"></label></div>';

    h += '<div class="cond"><div class="ch">条件清单'
      + '<span class="tiny" style="font-weight:400;margin-left:auto">' + a.cs.length + ' 个</span></div>';
    if (!a.cs.length) {
      h += '<div class="tiny" style="padding:6px 0">还没加条件。下面挑一个加上，'
        + '比如「屏幕上有『签到』」。</div>';
    }
    for (var j = 0; j < a.cs.length; j++) {
      h += condRow(a.cs[j], j);
    }
    h += '</div>'
      + '<div class="row" style="gap:6px;flex-wrap:wrap">';
    var keys = Object.keys(CTYPES);
    for (var k = 0; k < keys.length; k++) {
      h += '<button class="btn sm ghost" data-act="condAdd" data-k="' + keys[k] + '">＋ '
        + CTYPES[keys[k]].e + CTYPES[keys[k]].n + '</button>';
    }
    h += '</div>';

    h += '<div class="cond"><div class="ch">重复检查</div>'
      + '<div class="kv"><span>不成立就反复试，直到成立</span>'
      + '<div class="switch ' + (a.rep ? 'on' : '') + '" data-field="rep"><i></i></div></div>'
      + '<label class="f"><span>每次间隔 ms</span><input data-field="repGap" type="number" value="' + (a.repGap || 800) + '"></label>'
      + '<label class="f"><span>最多试几次</span><input data-field="repMax" type="number" value="' + (a.repMax || 10) + '"></label>'
      + '<div class="tiny">试满还是不成，就走「不满足」那条路。填 10 就是最多等 10 × 间隔。</div></div>';

    h += '<label class="f"><span>成立 → 跳到第几步（0=往下走）</span><input data-field="go" type="number" value="' + (a.go || 0) + '"></label>'
      + '<label class="f"><span>不满足 → 跳到第几步（0=往下走，-1=收工）</span><input data-field="els" type="number" value="' + (a.els || 0) + '"></label>'
      + '<label class="f"><span>之后等待 ms</span><input data-field="d" type="number" value="' + (a.d == null ? 100 : a.d) + '"></label>'
      + '<div class="row" style="margin-top:14px">'
      + '<button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="saveCond" data-i="' + i + '">保存</button></div>';
    return h;
  }

  /** 单个条件在清单里的一行 */
  function condRow(c, j) {
    var ct = CTYPES[c.k] || CTYPES.always;
    var d = ct.sum(c);
    return '<div class="conditem">'
      + '<div class="ct"><div>' + ct.e + ' ' + esc(ct.n) + '</div>'
      + '<div class="cd">' + esc(d) + '</div></div>'
      + '<button class="btn sm ghost" data-act="condEdit" data-i="' + j + '">改</button>'
      + '<button class="btn sm ghost" data-act="condDel" data-i="' + j + '">✕</button></div>';
  }

  /** 改单个条件：就地展开成一个小弹层，改完塞回 a.cs[j] */
  function sheetCondEdit(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a || !a.cs || !a.cs[j]) return '';
    var c = a.cs[j];
    var ct = CTYPES[c.k] || CTYPES.always;
    var h = '<h3>' + ct.e + ' ' + ct.n + '</h3>';
    for (var q = 0; q < ct.f.length; q++) {
      var key = ct.f[q][0], label = ct.f[q][1], kind = ct.f[q][2];
      if (kind === 'switch') {
        h += '<div class="kv"><span>' + label + '</span><div class="switch ' + (c[key] ? 'on' : '') + '" data-cfield="' + key + '"><i></i></div></div>';
      } else if (kind === 'color') {
        h += '<label class="f"><span>' + label + '</span>'
          + '<span class="row" style="gap:8px"><span class="swatch" style="background:' + esc(c[key] || '#000') + '" data-swatch="' + key + '"></span>'
          + '<input data-cfield="' + key + '" type="text" value="' + esc(c[key] == null ? '' : c[key]) + '" class="grow"></span></label>'
          + '<button class="btn ghost wide" style="margin:0 0 4px" data-act="pickColor" data-field-for="' + key + '">🎨 截图取色</button>';
      } else if (kind === 'var' || kind === 'expr') {
        h += '<label class="f"><span>' + label + '</span>'
          + '<input data-cfield="' + key + '" type="text" value="' + esc(c[key] == null ? '' : c[key]) + '"></label>'
          + '<div class="row" style="margin:-4px 0 6px;gap:6px">'
          + '<button class="btn sm ghost" data-act="insVar" data-field-for="' + key + '">🧩 插入变量</button>'
          + (kind === 'expr' ? '<button class="btn sm ghost" data-act="tryExpr" data-field-for="' + key + '">= 试算</button>' : '')
          + '</div>';
      } else if (kind && kind.indexOf('sel:') === 0) {
        var optKey = kind.slice(4), opts = OPTS[optKey] || [];
        h += '<label class="f"><span>' + label + '</span><select data-cfield="' + key + '">';
        for (var z = 0; z < opts.length; z++) {
          h += '<option value="' + esc(opts[z][0]) + '"' + (String(c[key]) === String(opts[z][0]) ? ' selected' : '') + '>' + esc(opts[z][1]) + '</option>';
        }
        h += '</select></label>';
        if (optKey === 'tpls') {
          if (!opts.length) h += '<div class="tiny" style="margin:-4px 0 6px">还没有模板图，先去「设置 → 图色模板」截一张存起来。</div>';
          else h += '<button class="btn ghost wide" style="margin:0 0 4px" data-act="goTpl">🖼 管理模板图</button>';
        }
      } else {
        h += '<label class="f"><span>' + label + '</span><input data-cfield="' + key + '" type="' + (kind === 'text' ? 'text' : 'number') + '" value="' + esc(c[key] == null ? '' : c[key]) + '"></label>';
      }
    }
    if (ct.pct) {
      h += '<div class="kv"><span>上面四个数按百分比算</span><div class="switch ' + (c.pct ? 'on' : '') + '" data-cfield="pct"><i></i></div></div>';
    }
    h += '<div class="row" style="margin-top:14px">'
      + '<button class="btn ghost grow" data-act="condEditBack">返回</button>'
      + '<button class="btn ok grow" data-act="condEditSave" data-i="' + j + '">确定</button></div>';
    return h;
  }

  // ---------- 脚本变量 ----------
  function addVar() {
    var s = findScript(S.editId);
    if (!s) return;
    if (!s.vars) s.vars = [];
    s.vars.push({ k: 'v' + (s.vars.length + 1), v: '0' });
    saveScripts();
    render();
  }

  function delVar(i) {
    var s = findScript(S.editId);
    if (!s || !s.vars) return;
    s.vars.splice(i, 1);
    saveScripts();
    render();
  }

  /** 变量卡片：脚本一开始的初值，跑起来之后改的是运行时的副本，不写回脚本 */
  function varsCard(s) {
    var vs = s.vars || [];
    var h = '<div class="card"><div class="sec">变量（初值）'
      + '<span class="tiny" style="font-weight:400;margin-left:6px">任何字段都能写 {{变量名}}</span></div>';
    if (!vs.length) {
      h += '<div class="muted">还没有变量。加了变量，坐标、等待时间这些就能算出来，'
        + '比如「等 {{gap}} 毫秒」「点 ({{lastX}}, {{lastY}})」。</div>';
    }
    for (var i = 0; i < vs.length; i++) {
      h += '<div class="row" style="gap:6px;margin-bottom:6px">'
        + '<input class="grow" data-var-k="' + i + '" value="' + esc(vs[i].k) + '" placeholder="变量名" style="flex:0 0 38%">'
        + '<input class="grow" data-var-v="' + i + '" value="' + esc(vs[i].v) + '" placeholder="初始值">'
        + '<button class="btn sm ghost" data-act="delVar" data-i="' + i + '">✕</button></div>';
    }
    h += '<button class="btn wide ghost" style="margin-top:2px" data-act="addVar">＋ 加个变量</button>';
    // 运行时变量值（如果脚本正在跑）
    var rv = S.st && S.st.vars;
    if (rv && rv.length) {
      h += '<div class="sec" style="margin-top:12px">脚本跑起来后，现在这几个变量的值</div>'
        + '<div class="tiny" style="margin:-4px 0 6px">跟上面的初值不一样是正常的：上面的只有点「保存」才会写进脚本。</div>'
        + '<div class="wrap" style="gap:5px">';
      for (var j = 0; j < rv.length; j++) {
        h += '<span class="chip">' + esc(rv[j].k) + ' = ' + esc(rv[j].v === '' ? '空' : rv[j].v) + '</span>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  /** 把变量卡里的输入收进脚本 */
  function syncVars(s) {
    var ks = document.querySelectorAll('[data-var-k]');
    var vs = document.querySelectorAll('[data-var-v]');
    if (!ks.length) return;
    var out = [];
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i].value.trim();
      if (!k) continue;
      out.push({ k: k, v: vs[i] ? vs[i].value : '' });
    }
    s.vars = out;
  }

  // ---------- 插入变量 ----------
  /** 在当前动作表单里就地展开变量列表（不用弹层，免得关掉时把表单也带走） */
  function toggleVarMenu(btn, field) {
    var old = document.getElementById('varmenu');
    if (old) { old.parentNode.removeChild(old); return; }
    var s = findScript(S.editId);
    var list = [];
    var vs = (s && s.vars) || [];
    for (var i = 0; i < vs.length; i++) {
      if (!vs[i].k) continue;
      list.push(['{{' + vs[i].k + '}}', vs[i].k + ' = ' + (vs[i].v === '' ? '空' : vs[i].v), '我的变量']);
    }
    var bi = S.builtin || [];
    for (var j = 0; j < bi.length; j++) list.push(['{{' + bi[j].k + '}}', bi[j].k + ' · ' + bi[j].d, '内置']);
    var h = '<div class="varmenu" id="varmenu">';
    if (!list.length) {
      h += '<div class="tiny">还没有变量。去编辑器上面的「变量」卡加一个，内置变量要等 App 起来才能读到。</div>';
    }
    for (var k = 0; k < list.length; k++) {
      h += '<button class="btn sm ghost wide" style="text-align:left;margin-bottom:4px" data-act="insVarGo"'
        + ' data-f="' + esc(field) + '" data-v="' + esc(list[k][0]) + '">'
        + '<span class="chip">' + esc(list[k][2]) + '</span> ' + esc(list[k][1]) + '</button>';
    }
    h += '</div>';
    btn.insertAdjacentHTML('afterend', h);
  }

  /** 把 {{...}} 插到输入框当前光标处，不重渲染表单（重渲染会丢掉别的字段改动） */
  function insertVar(field, txt) {
    var inp = document.querySelector('#sheet [data-field="' + field + '"]');
    var menu = document.getElementById('varmenu');
    if (menu) menu.parentNode.removeChild(menu);
    if (!inp) return;
    var v = inp.value || '', p = inp.selectionStart;
    if (p == null) p = v.length;
    inp.value = v.slice(0, p) + txt + v.slice(p);
    inp.focus();
    try { inp.setSelectionRange(p + txt.length, p + txt.length); } catch (e) { }
  }

  function tryExpr(field) {
    var inp = document.querySelector('#sheet [data-field="' + field + '"]');
    if (!inp) return;
    var e = (inp.value || '').trim();
    if (!e) { toast('先写个算式'); return; }
    var r = call('tryExpr', e);
    if (r.indexOf('err:') === 0) { toast(r.slice(4)); return; }
    toast('算出来是 ' + r);
  }

  function sheetPickIcon(id) {
    var h = '<h3>换个图标</h3><div class="grid">';
    for (var i = 0; i < ICONS.length; i++) {
      h += '<div class="tile" data-act="setIcon" data-id="' + id + '" data-i="' + i + '">'
        + '<div class="e">' + ICONS[i] + '</div></div>';
    }
    return h + '</div><button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">取消</button>';
  }

  function sheetPickPoint(i) {
    var st = S.st || {}, sc = (st.screen || {});
    var w = sc.w || 1080, hgt = sc.h || 1920;
    return '<h3>🎯 点一下屏幕图取坐标</h3>'
      + (S.shot ? '' : '<div class="tiny" style="margin-bottom:6px">没有截图，显示的是空白网格；想对着真实画面取点，先去「设置」授权截屏。</div>')
      + '<div class="pick"><canvas id="cv" width="' + w + '" height="' + hgt + '"></canvas></div>'
      + '<div class="row" style="margin-top:10px"><div class="grow muted" id="pv">还没取点</div></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="usePoint" data-i="' + i + '">用这个点</button></div>';
  }

  var picked = null;
  function bindCanvas() {
    var cv = document.getElementById('cv');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var draw = function (x, y) {
      if (S.shotImg && S.shotImg.complete) { ctx.drawImage(S.shotImg, 0, 0, cv.width, cv.height); }
      else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, cv.width - 12, cv.height - 12);
      if (x != null) {
        ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke();
        ctx.fillStyle = '#ff6b35'; ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.3); ctx.fill();
      }
    };
    draw(null);
    window.__redrawPick = function () { var p = window.__picked; if (p) draw(p.x, p.y); else draw(null); };
    cv.onclick = function (e) {
      var r = cv.getBoundingClientRect();
      picked = {
        x: Math.round((e.clientX - r.left) / r.width * cv.width),
        y: Math.round((e.clientY - r.top) / r.height * cv.height)
      };
      window.__picked = picked;
      draw(picked.x, picked.y);
      document.getElementById('pv').textContent = '选中：' + picked.x + ' , ' + picked.y;
    };
  }

  // ---------- 拖拽排序（按住 ⋮⋮ 拖） ----------
  var drag = null;
  function bindDrag() {
    var grips = document.querySelectorAll('#page .grip');
    for (var i = 0; i < grips.length; i++) grips[i].addEventListener('pointerdown', startDrag);
  }
  function startDrag(e) {
    if (drag) return;
    var grip = e.currentTarget;
    var item = grip.parentNode, list = item.parentNode;
    if (!item || !list) return;
    var items = [].slice.call(list.children);
    var i = +grip.dataset.drag;
    drag = {
      i: i, to: i, kind: grip.dataset.list, el: item, items: items,
      y0: e.clientY, h: item.getBoundingClientRect().height + 10
    };
    item.classList.add('drag');
    document.addEventListener('pointermove', onDrag);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    e.preventDefault();
  }
  function onDrag(e) {
    if (!drag) return;
    var dy = e.clientY - drag.y0;
    drag.el.style.transform = 'translateY(' + dy + 'px)';
    var to = Math.max(0, Math.min(drag.items.length - 1, drag.i + Math.round(dy / drag.h)));
    if (to === drag.to) return;
    drag.to = to;
    for (var i = 0; i < drag.items.length; i++) {
      var it = drag.items[i];
      if (it === drag.el) continue;
      var shift = 0;
      if (drag.i < to && i > drag.i && i <= to) shift = -drag.h;
      else if (drag.i > to && i >= to && i < drag.i) shift = drag.h;
      it.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    }
  }
  function endDrag() {
    if (!drag) return;
    document.removeEventListener('pointermove', onDrag);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    var d = drag;
    drag = null;
    if (d.i !== d.to) {
      if (d.kind === 'scripts') {
        var mv = S.scripts.splice(d.i, 1)[0];
        S.scripts.splice(d.to, 0, mv);
      } else {
        var s = findScript(S.editId);
        if (s && s.actions) {
          var m2 = s.actions.splice(d.i, 1)[0];
          s.actions.splice(d.to, 0, m2);
        }
      }
      saveScripts();
    }
    render();
  }

  // ---------- 截图取色 / 取图 ----------
  function shotPanel(mode) {
    var st = S.st || {}, sc = st.screen || {};
    return '<h3>' + (mode === 'tpl' ? '🖼 框一块区域存成模板图' : '🎨 点一下取这个点的颜色') + '</h3>'
      + (S.shot ? '' : '<div class="tiny">还没拿到截图</div>')
      + '<div class="pick"><canvas id="sc" width="' + (sc.w || 1080) + '" height="' + (sc.h || 1920) + '"></canvas></div>'
      + '<div class="row" style="margin-top:8px"><div class="grow muted" id="sv">'
      + (mode === 'tpl' ? '点第一下定左上角，再点一下定右下角' : '还没取色') + '</div></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn ghost grow" data-act="shotRefresh">重新截图</button>'
      + '<button class="btn ghost grow" data-act="cancelAct">关闭</button></div>';
  }

  function bindShotCanvas(mode) {
    var cv = document.getElementById('sc');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var rect = null;
    var draw = function () {
      if (S.shotImg && S.shotImg.complete) ctx.drawImage(S.shotImg, 0, 0, cv.width, cv.height);
      else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height); }
      if (rect) {
        ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 3;
        ctx.strokeRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      }
    };
    draw();
    window.__redrawShot = draw;
    cv.onclick = function (e) {
      var r = cv.getBoundingClientRect();
      var x = Math.round((e.clientX - r.left) / r.width * cv.width);
      var y = Math.round((e.clientY - r.top) / r.height * cv.height);
      if (mode === 'tpl') {
        if (!rect || (rect.x1 != null)) { rect = { x0: x, y0: y, x1: null, y1: null }; }
        else { rect.x1 = x; rect.y1 = y; }
        draw();
        if (rect.x1 != null) {
          var w = rect.x1 - rect.x0, h2 = rect.y1 - rect.y0;
          if (w > 4 && h2 > 4) {
            S.pick = { x: rect.x0, y: rect.y0, w: w, h: h2 };
            sheet(sheetTplSave());
          } else { toast('框太小了，再来一次'); rect = null; draw(); }
        }
        return;
      }
      var c = call('colorAt', x + ',' + y);
      if (typeof c === 'string' && c.indexOf('err:') === 0) { toast(c.slice(4)); return; }
      var sv = document.getElementById('sv');
      if (sv) sv.textContent = '取到颜色 ' + c;
      var field = S.pick && S.pick.field;
      sheet(sheetEditAct(S.editAct));
      var inp = document.querySelector('#sheet [data-field="' + field + '"]');
      if (inp) inp.value = c;
      var sw = document.querySelector('#sheet [data-swatch="' + field + '"]');
      if (sw) sw.style.background = c;
      toast('已填入 ' + c + '，记得点保存');
    };
  }

  function sheetTplSave() {
    var p = S.pick || {};
    return '<h3>存成模板图</h3>'
      + '<label class="f"><span>名字</span><input id="tplName" type="text" placeholder="比如 跳过按钮"></label>'
      + '<div class="tiny">区域：' + p.x + ',' + p.y + ' 尺寸 ' + p.w + '×' + p.h + '</div>'
      + '<div class="row" style="margin-top:12px">'
      + '<button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="tplSaveGo">保存</button></div>';
  }

  function viewTpls() {
    var names = (S.cap && S.cap.tpls) || [];
    var h = '<div class="card"><div class="sec">图色模板</div>';
    if (!names.length) {
      h += '<div class="muted">还没有模板图。去截图框一块区域存下来，「找图」动作就能认它了。</div>';
    } else {
      for (var i = 0; i < names.length; i++) {
        h += '<div class="kv"><span>🖼 ' + esc(names[i]) + '</span>'
          + '<button class="btn sm ghost" data-act="tplDel" data-v="' + esc(names[i]) + '">删除</button></div>';
      }
    }
    h += '<button class="btn wide ok" style="margin-top:10px" data-act="pickTpl">' + (S.cap && S.cap.granted ? '📷 截图框一块存模板' : '🔑 先授权截屏') + '</button>';
    return h + '<button class="btn ghost wide" style="margin-top:9px" data-act="cancelAct">关闭</button></div>';
  }

  // ---------- 事件 ----------
  document.addEventListener('click', function (e) {
    // 点遮罩空白处收起弹层
    if (e.target && e.target.id === 'modal') {
      S.editAct = null; S.pick = null; closeSheet(); return;
    }
    var el = e.target.closest('[data-act],[data-toggle],[data-tab],.switch,#tabs button');
    if (!el) return;
    var act = el.dataset.act;

    // 底部 tab
    if (el.dataset.tab) { S.tab = el.dataset.tab; S.editId = null; S.sub = null; render(); return; }

    // 开关（设置项 / 弹层字段）
    if (el.classList.contains('switch')) {
      if (el.dataset.tgsw) { // 触发器启用开关
        var onT = !el.classList.contains('on');
        el.classList.toggle('on', onT);
        var tg = tgFind(el.dataset.tgsw);
        if (tg) { tg.on = onT; saveTriggers(); }
        return;
      }
      var on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      if (el.dataset.field) return; // 弹层里的字段开关，保存时统一读
      var key = el.dataset.toggle;
      if (key === 'loop') {
        syncEditorInputs();
        findScript(S.editId).loop = on;
        render();
        return;
      }
      if (key === 'jitter' || key === 'stopOnFail') {
        syncEditorInputs();
        findScript(S.editId)[key] = on;
        saveScripts();
        render();
        return;
      }
      var np = {}; np[key] = on;
      ok(call('savePrefs', JSON.stringify(np)));
      S.prefs[key] = on;
      render();
      return;
    }

    if (!act) return;
    var s, id = el.dataset.id;

    switch (act) {
      case 'acc': ok(call('openAcc')); break;
      case 'overlay': ok(call('openOverlay')); break;
      case 'ball':
        S.st.ball ? ok(call('hideBall')) : ok(call('showBall'));
        setTimeout(refreshAll, 400);
        break;
      case 'run': {
        var rs = findScript(id);
        ok(call(rs && rs.kind === 'js' ? 'runJs' : 'run', id));
        setTimeout(refreshAll, 300);
        break;
      }
      case 'runLast': {
        var last = S.prefs.lastScript && findScript(S.prefs.lastScript);
        var ls = last || S.scripts[0];
        ok(call(ls && ls.kind === 'js' ? 'runJs' : 'run', ls.id));
        setTimeout(refreshAll, 300);
        break;
      }
      case 'stop': ok(call('stop')); setTimeout(refreshAll, 200); break;
      case 'edit': openEditor(id); break;
      case 'back': S.editId = null; render(); break;
      case 'save': saveCurrent(); break;
      case 'more': sheetMore(id); break;
      case 'del': s = findScript(id); S.scripts.splice(S.scripts.indexOf(s), 1); saveScripts(); closeSheet(); S.editId = null; render(); break;
      case 'dup':
        s = findScript(id);
        var c = JSON.parse(JSON.stringify(s));
        c.id = uid(); c.name = s.name + ' 副本';
        S.scripts.unshift(c); saveScripts(); closeSheet(); render();
        break;
      case 'addAct': sheet(sheetAddAct()); break;
      case 'pickTpl': useTemplate(+el.dataset.i); break;
      case 'newJs': newJsScript(); break;
      case 'market': S.tab = 'market'; S.editId = null; render(); break;
      case 'mineGo': S.tab = 'mine'; S.sub = el.dataset.k; render(); break;
      case 'mineBack': S.sub = null; render(); break;
      case 'mktGet': mktGet(+el.dataset.i); break;
      case 'share': sheetShare(id); break;
      case 'exportAll': sheetExportAll(); break;
      case 'importCode': sheetImportCode(); break;   // 它自己会开弹层，别再套一层 sheet()
      case 'importCodeGo': importCodeGo(); break;
      case 'copyCode': {
        var ta = document.getElementById('shr');
        if (!ta) { toast('没找到分享码'); break; }
        if (ok(call('copy', ta.value))) toast('复制好了，去粘贴吧');
        break;
      }
      case 'runJs': ok(call('runJs', id)); setTimeout(refreshAll, 400); break;
      case 'stopJs': ok(call('stopJs')); setTimeout(refreshAll, 300); break;
      case 'jsApi': sheet(sheetJsApi()); break;
      case 'jsDemo': {
        var ta = document.getElementById('scode');
        if (ta) { ta.value = JS_DEMO; toast('例子放好了，改成你自己的'); }
        break;
      }
      case 'jsClear': {
        var tc = document.getElementById('scode');
        if (tc) { tc.value = ''; toast('清空了'); }
        break;
      }
      case 'pickIcon': sheet(sheetPickIcon(id)); break;
      case 'setIcon':
        var sc2 = findScript(id);
        sc2.icon = ICONS[+el.dataset.i];
        sc2.tone = (+el.dataset.i % 6) + 1;
        saveScripts(); closeSheet(); render();
        break;
      case 'pickType':
        s = findScript(S.editId);
        var t = el.dataset.t;
        var na = { t: t };
        for (var k in TYPES[t].def) na[k] = TYPES[t].def[k];
        s.actions.push(na);
        saveScripts();
        sheet(sheetEditAct(s.actions.length - 1));
        break;
      case 'editAct': sheet(sheetEditAct(+el.dataset.i)); break;
      case 'testAct': ok(call('testAction', JSON.stringify(findScript(S.editId).actions[+el.dataset.i]))); break;
      case 'mvUp':
        s = findScript(S.editId); var i1 = +el.dataset.i;
        if (i1 > 0) { var tmp = s.actions[i1 - 1]; s.actions[i1 - 1] = s.actions[i1]; s.actions[i1] = tmp; saveScripts(); render(); }
        break;
      case 'mvDn':
        s = findScript(S.editId); var i2 = +el.dataset.i;
        if (i2 < s.actions.length - 1) { var t2 = s.actions[i2 + 1]; s.actions[i2 + 1] = s.actions[i2]; s.actions[i2] = t2; saveScripts(); render(); }
        break;
      case 'dupAct':
        s = findScript(S.editId); var i3 = +el.dataset.i;
        s.actions.splice(i3 + 1, 0, JSON.parse(JSON.stringify(s.actions[i3])));
        saveScripts(); render();
        break;
      case 'delAct':
        s = findScript(S.editId); s.actions.splice(+el.dataset.i, 1); saveScripts(); render();
        break;
      case 'saveAct': saveAct(+el.dataset.i); break;
      case 'cancelAct': S.editAct = null; S.pick = null; closeSheet(); break;
      case 'pickPoint': picked = null; sheet(sheetPickPoint(+el.dataset.i)); bindCanvas(); break;
      case 'usePoint':
        if (!picked) { toast('先在图上点一下'); return; }
        s = findScript(S.editId); var a2 = s.actions[+el.dataset.i] || {};
        var pctMode = !!a2.pct;
        sheet(sheetEditAct(+el.dataset.i));
        var ins = document.querySelectorAll('#sheet [data-field]');
        for (var q2 = 0; q2 < ins.length; q2++) {
          var f = ins[q2];
          if (f.tagName !== 'INPUT') continue;
          if (f.dataset.field === 'x' || f.dataset.field === 'x1' || f.dataset.field === 'x2') {
            f.value = pctMode ? Math.round(picked.x / (S.st.screen.w || 1080) * 1000) / 10 : picked.x;
          }
          if (f.dataset.field === 'y' || f.dataset.field === 'y1' || f.dataset.field === 'y2') {
            f.value = pctMode ? Math.round(picked.y / (S.st.screen.h || 1920) * 1000) / 10 : picked.y;
          }
        }
        toast('已填入，记得点保存');
        break;
      case 'rec':
        ok(call((S.st.recording ? 'recStop' : 'recStart')));
        setTimeout(function () { refreshAll(); loadRec(); }, 400);
        break;
      case 'recRefresh': loadRec(); break;
      case 'recClear': ok(call('clearRecording')); loadRec(); break;
      case 'recDel':
        var arr = S.rec.slice(); arr.splice(+el.dataset.i, 1);
        ok(call('saveRecording', JSON.stringify(arr)));
        loadRec();
        break;
      case 'recSave': saveRecAsScript(); break;
      case 'reqCap': ok(call('reqCap')); break;
      case 'capStop': ok(call('capStop')); setTimeout(refreshAll, 300); break;
      case 'shotRefresh': if (loadShot()) { sheet(shotPanel(S.pick && S.pick.mode)); bindShotCanvas(S.pick && S.pick.mode); } break;
      case 'insVar': toggleVarMenu(el, el.dataset.fieldFor); break;
      case 'insVarGo': insertVar(el.dataset.f, el.dataset.v); break;
      case 'tryExpr': tryExpr(el.dataset.fieldFor); break;
      case 'addVar': addVar(); break;
      case 'delVar': delVar(+el.dataset.i); break;
      // ---- 条件判断（v2.0.0）----
      case 'condAdd': condAdd(el.dataset.k); break;
      case 'condDel': condDel(+el.dataset.i); break;
      case 'condEdit': condEdit(+el.dataset.i); break;
      case 'condEditBack': condEditBack(); break;
      case 'condEditSave': condEditSave(+el.dataset.i); break;
      case 'saveCond': saveCond(+el.dataset.i); break;
      case 'pickColor':
        S.pick = { field: el.dataset.fieldFor, mode: 'color' };
        if (!S.shot && !loadShot()) break;
        sheet(shotPanel('color')); bindShotCanvas('color');
        break;
      case 'pickTpl':
        S.pick = { mode: 'tpl' };
        if (!loadShot()) break;
        sheet(shotPanel('tpl')); bindShotCanvas('tpl');
        break;
      case 'goTpl': sheet(viewTpls()); break;
      case 'tplSaveGo':
        var nm = (document.getElementById('tplName') || {}).value || '';
        nm = nm.trim();
        if (!nm) { toast('起个名字'); break; }
        var pr = S.pick || {};
        ok(call('saveTpl', JSON.stringify({ name: nm, x: pr.x, y: pr.y, w: pr.w, h: pr.h })));
        closeSheet(); refreshAll(); sheet(viewTpls());
        break;
      case 'tplDel': ok(call('delTpl', el.dataset.v)); refreshAll(); sheet(viewTpls()); break;
      case 'logRefresh': refreshAll(); break;
      case 'mode':
        ok(call('savePrefs', JSON.stringify({ mode: el.dataset.v })));
        S.prefs.mode = el.dataset.v;
        if (el.dataset.v === 'ball') ok(call('toBall'));
        render();
        break;
      case 'toBall': ok(call('toBall')); break;
      case 'export': doExport(id); break;
      case 'import': doImport(); break;
      case 'doImportGo': doImportGo(); break;
      // 触发器
      case 'tgAdd': sheet(sheetTgAdd()); break;
      case 'tgNew':
        S.tgEdit = {
          id: uid(), kind: el.dataset.k, on: true,
          script: (S.scripts[0] || {}).id || '', hh: 8, mm: 0, mins: 60, text: '', pkg: ''
        };
        sheet(sheetTgEdit(S.tgEdit));
        break;
      case 'tgEdit': S.tgEdit = tgFind(id); if (S.tgEdit) sheet(sheetTgEdit(S.tgEdit)); break;
      case 'tgSave': tgSave(id); break;
      case 'tgDel':
        var tt = tgFind(id);
        if (tt) S.triggers.splice(S.triggers.indexOf(tt), 1);
        saveTriggers(); closeSheet(); render();
        break;
      case 'tgTest':
        ok(call('fireTrigger', id));
        toast('已手动触发，去看日志');
        setTimeout(refreshAll, 400);
        break;
      case 'fillApp':
        var ca = call('curApp') || '';
        var pk2 = document.getElementById('tgp');
        if (pk2 && ca) { pk2.value = ca.replace(/^"|"$/g, ''); toast('填上了：' + ca); }
        else toast('没读到前台应用');
        break;
      case 'goTrig': S.tab = 'mine'; S.sub = 'trig'; render(); break;
      case 'theme':
        ok(call('savePrefs', JSON.stringify({ theme: el.dataset.v })));
        S.prefs.theme = el.dataset.v;
        applyTheme();
        render();
        break;
    }
  });

  // 设置里的下拉 / 滑块：改完就地更新，不整体重绘（否则手一抖滑块就飞了）
  document.addEventListener('change', function (e) {
    var el = e.target;
    // 条件判断：选「满足指定个数」才需要填 N
    if (el.dataset.field === 'mode') {
      var w = document.getElementById('nwrap');
      if (w) w.style.display = (+el.value === 2 ? '' : 'none');
      return;
    }
    if (!el.dataset.pref) return;
    var v = el.value;
    if (el.type === 'range') {
      v = num(v, 0);
      if (el.dataset.pref === 'ballAlpha') v = v / 100;
      if (el.dataset.pref === 'speed') v = v / 100;
    }
    var o = {}; o[el.dataset.pref] = v;
    ok(call('savePrefs', JSON.stringify(o)));
    S.prefs[el.dataset.pref] = v;
    if (el.type === 'range') return; // 滑块不动界面，避免打断拖动
    refreshAll();
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'q') { S.q = el.value; render(); return; }
    if (el.dataset.pref && el.type === 'range') {
      var box = el.parentNode.parentNode;
      var label = box ? box.querySelector('.tiny') : null;
      if (label) {
        label.textContent = el.dataset.pref === 'ballAlpha'
          ? el.value + '%'
          : (el.dataset.pref === 'speed' ? (el.value / 100).toFixed(2) + 'x' : el.value + 'dp');
      }
    }
  });

  function saveCurrent() {
    syncEditorInputs();
    saveScripts();
    toast('保存好了');
    S.editId = null;
    render();
  }

  /** 这个字段该当文本存还是当数字存（按动作定义里的类型来定，别一律转数字） */
  function fieldIsText(t, key) {
    var fs = (TYPES[t] && TYPES[t].f) || [];
    var kind = '';
    for (var i = 0; i < fs.length; i++) if (fs[i][0] === key) kind = fs[i][2] || '';
    if (kind === 'text' || kind === 'var' || kind === 'expr' || kind === 'color' || kind === 'key') return true;
    if (kind.indexOf('sel:') === 0) return true;
    return key === 's' || key === 'p';   // 文案与包名一律按文本
  }

  function saveAct(i) {
    var s = findScript(S.editId);
    var a = s.actions[i];
    var fields = document.querySelectorAll('#sheet [data-field]');
    for (var q = 0; q < fields.length; q++) {
      var f = fields[q], k = f.dataset.field;
      if (f.classList.contains('switch')) { a[k] = f.classList.contains('on'); continue; }
      if (f.tagName === 'SELECT') { a[k] = f.value; continue; }
      var raw = f.value;
      if (fieldIsText(a.t, k)) { a[k] = raw; continue; }
      // 数字字段：能转就转，转不了（比如填的是 {{lastX}}）就原样留着
      var n = num(raw, NaN);
      a[k] = isNaN(n) ? raw : n;
    }
    saveScripts();
    closeSheet();
    render();
  }

  // ---------- 条件动作的增删改（v2.0.0） ----------

  /** 把主表单上的改动收进动作 a（只收 data-field 里的那几个） */
  function syncCondAct(a) {
    var fs = document.querySelectorAll('#sheet [data-field]');
    for (var q = 0; q < fs.length; q++) {
      var f = fs[q], k = f.dataset.field;
      if (f.classList.contains('switch')) { a[k] = f.classList.contains('on'); continue; }
      if (k === 'mode') { a.mode = +f.value; continue; }
      var n = num(f.value, NaN);
      a[k] = isNaN(n) ? f.value : n;
    }
  }

  /** 加一个条件：把主表单改动先收好，再往清单里塞一个新的 */
  function condAdd(k) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a) return;
    syncCondAct(a);
    if (!a.cs) a.cs = [];
    var ct = CTYPES[k] || CTYPES.always;
    var c = { k: k };
    for (var key in ct.def) if (Object.prototype.hasOwnProperty.call(ct.def, key)) c[key] = ct.def[key];
    a.cs.push(c);
    saveScripts();
    sheet(sheetEditAct(S.editAct));   // 就地重画，回到主表单
    toast('加了一个条件：' + ct.n);
  }

  function condDel(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a || !a.cs) return;
    syncCondAct(a);
    a.cs.splice(j, 1);
    saveScripts();
    sheet(sheetEditAct(S.editAct));
  }

  function condEdit(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a) return;
    syncCondAct(a);          // 先存主表单，否则从子页返回时改动会丢
    saveScripts();
    var h = sheetCondEdit(j);
    if (h) sheet(h);
  }

  function condEditBack() {
    sheet(sheetEditAct(S.editAct));
  }

  /** 子页里点「确定」：把 data-cfield 收进 a.cs[j] */
  function condEditSave(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a || !a.cs || !a.cs[j]) return;
    var c = a.cs[j];
    var fs = document.querySelectorAll('#sheet [data-cfield]');
    for (var q = 0; q < fs.length; q++) {
      var f = fs[q], k = f.dataset.cfield;
      if (f.classList.contains('switch')) { c[k] = f.classList.contains('on'); continue; }
      var raw = f.value;
      if (k === 'v' || k === 's' || k === 'c' || k === 'tpl') { c[k] = raw; continue; }   // 可能填 {{变量}}
      var n = num(raw, NaN);
      c[k] = isNaN(n) ? raw : n;
    }
    saveScripts();
    sheet(sheetEditAct(S.editAct));   // 回主表单，能立刻看到这条的说明变了
    toast('条件改好了');
  }

  /** 条件动作整体保存：主表单收一遍就够，条件清单是就地存的 */
  function saveCond(i) {
    var s = findScript(S.editId);
    var a = s && s.actions[i];
    if (!a) return;
    syncCondAct(a);
    saveScripts();
    closeSheet();
    render();
    toast('条件判断存好了');
  }

  function sheetMore(id) {    var s = findScript(id);
    sheet('<h3>' + esc(s.name) + '</h3>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="edit" data-id="' + id + '">✎ 编辑动作</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="dup" data-id="' + id + '">⧉ 复制一份</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="export" data-id="' + id + '">📤 导出 JSON</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="share" data-id="' + id + '">🔗 生成分享码</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="pickIcon" data-id="' + id + '">🎨 换个图标</button>'
      + '<button class="btn warn wide" style="margin-bottom:9px" data-act="del" data-id="' + id + '">🗑 删除</button>'
      + '<button class="btn wide" data-act="cancelAct">关闭</button>');
  }

  function doExport(id) {
    var s = findScript(id);
    var txt = JSON.stringify(s);
    sheet('<h3>导出</h3><div class="muted">复制这段 JSON，换手机时用「导入」贴回去。</div>'
      + '<textarea rows="8" style="margin-top:10px">' + esc(txt) + '</textarea>'
      + '<button class="btn wide" style="margin-top:12px" data-act="cancelAct">关闭</button>');
  }

  function doImportGo() {
    var v = (document.getElementById('imp') || {}).value || '';
    v = v.trim();
    if (!v) { toast('先粘贴点东西进来'); return; }
    try {
      var o = JSON.parse(v);
      var arr = Array.isArray(o) ? o : [o];
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i];
        if (!s || !s.actions) continue;
        s.id = uid();
        S.scripts.unshift(s);
        n++;
      }
      if (!n) { toast('没找到可用的脚本'); return; }
      saveScripts();
      closeSheet();
      render();
      toast('导入了 ' + n + ' 个脚本');
    } catch (err) {
      toast('JSON 不对劲：' + err.message);
    }
  }

  function doImport() {
    sheet('<h3>导入脚本</h3>'
      + '<textarea id="imp" rows="7" placeholder=\'粘贴 {"id":"...","name":"...","actions":[...]} 或一个脚本数组\'></textarea>'
      + '<div class="row" style="margin-top:12px"><button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="doImportGo">导入</button></div>');
  }

  function loadCap() {
    var c = jcall('capStatus');
    if (!c) return;
    S.cap = c;
    OPTS.tpls = (c.tpls || []).map(function (n) { return [n, n]; });
    if (!OPTS.tpls.length) OPTS.tpls = [['', '（还没有模板图）']];
  }

  function loadShot() {
    var r = call('shot');
    if (typeof r === 'string' && r.indexOf('data:image') === 0) {
      S.shot = r;
      S.shotImg = new Image();
      S.shotImg.src = r;
      // 解码完把弹层里的画布补画一次
      S.shotImg.onload = function () {
        if (window.__redrawShot) window.__redrawShot();
        if (window.__redrawPick) window.__redrawPick();
      };
      return true;
    }
    ok(r);
    return false;
  }

  function loadRec() {
    var r = jcall('recording');
    S.rec = r || [];
    render();
  }

  function saveRecAsScript() {
    if (!S.rec || !S.rec.length) { toast('还没录到东西'); return; }
    var s = {
      id: uid(), name: '录制脚本 ' + new Date().toLocaleTimeString(), desc: '刚录的',
      icon: '🎬', tone: 2, loop: false, loopCount: 1, actions: S.rec.slice()
    };
    S.scripts.unshift(s);
    saveScripts();
    ok(call('clearRecording'));
    S.rec = [];
    toast('已存为脚本，去改改就能用');
    S.tab = 'scripts';
    openEditor(s.id);
  }

  // ---------- 内核事件 ----------
  window.__on = function (type, data) {
    if (type === 'recordAction') loadRec();
    else if (type === 'record') loadRec();
    else if (type === 'status' || type === 'resume') refreshAll();
    else if (type === 'scripts') refreshAll();
    else if (type === 'cap') { refreshAll(); toast(data === 'ok' ? '截屏已授权' : '没拿到截屏授权'); }
    else if (type === 'js') {
      refreshAll();
      var p = String(data || '').split('|');
      if (p[0] === 'err') toast('JS 出错：' + (p[1] || ''));
      else if (p[0] === 'done') toast(p[1] ? 'JS 跑完了：' + p[1] : 'JS 跑完了');
    }
  };

  // ---------- 启动 ----------
  function boot() {
    refreshAll();
    loadRec();
    setInterval(function () {
      if (S.tab === 'mine' && S.sub === 'log') refreshAll();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
