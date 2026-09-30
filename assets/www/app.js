/* 懒人点击器 · 界面层（纯 JS，无框架）
   目标：小、快、不卡。所有数据经 window.app.* 与原生内核交换。
   v1.3：玻璃质感 UI、渲染 rAF 节流、焦点保持、脚本图标与搜索、延迟启动 */
(function () {
  'use strict';

  var S = {
    tab: 'scripts',
    scripts: [],
    rec: [],
    st: {},
    prefs: {},
    editId: null,     // 正在编辑的脚本 id
    editAct: -1,      // 正在编辑的动作下标
    q: ''             // 脚本搜索词
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
    launch: { n: '开应用', e: '📱', f: [['p', '包名，如 com.tencent.mm'], ['d', '之后等待 ms']], def: { p: '', d: 1500 } },
    find: { n: '找文字', e: '🔍', f: [['s', '屏幕上的文字'], ['click', '找到就点它', 'switch'], ['contains', '模糊匹配', 'switch'], ['timeout', '最多等 ms'], ['index', '第几个(1起)'], ['d', '之后等待 ms']], def: { click: true, contains: true, timeout: 3000, index: 1, d: 300 } },
    if: { n: '如果', e: '🔀', f: [['m', '判断什么', 'sel:ifmode'], ['s', '屏幕上的文字'], ['p', '应用包名（判断 App 时用）'], ['contains', '模糊匹配', 'switch'], ['go', '成立 → 跳到第几步'], ['els', '不成立 → 跳到第几步'], ['d', '之后等待 ms']], def: { m: 'text', s: '', p: '', contains: true, go: 0, els: 0, d: 100 } },
    count: { n: '计数', e: '🔢', f: [['k', '计数器名字'], ['mode', '动作', 'sel:cntmode'], ['v', '每次加多少'], ['times', '涨到几次就跳（0=不管）'], ['go', '跳到第几步'], ['resetAfter', '跳完就清零', 'switch'], ['d', '之后等待 ms']], def: { k: 'main', mode: 'add', v: 1, times: 0, go: 0, resetAfter: true, d: 100 } },
    multi: { n: '多指', e: '🖐', c: 1, f: [['m', '手势', 'sel:multi'], ['x', '中心 X'], ['y', '中心 Y'], ['r', '两指间距半径'], ['ms', '动作时长 ms'], ['d', '之后等待 ms']], def: { m: 'twoTap', x: 50, y: 50, r: 80, ms: 400, d: 400 } }
  };
  var KEYS = ['back:返回', 'home:桌面', 'recents:最近任务', 'notif:通知栏', 'quick:快捷设置', 'lock:锁屏', 'power:电源菜单', 'split:分屏'];
  var OPTS = {
    ifmode: [['text', '屏幕上有这个字'], ['pkg', '当前是这个 App']],
    cntmode: [['add', '往上加'], ['reset', '清零']],
    multi: [['twoTap', '双指齐点'], ['twoLong', '双指按住'], ['pinch', '双指捏合'], ['spread', '双指张开']]
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
    } else {
      page.innerHTML = ({
        scripts: viewScripts, record: viewRecord, log: viewLog, trig: viewTriggers,
        settings: viewSettings, about: viewAbout
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
        + '<div class="t">' + esc(s.name) + (s.loop ? '<span class="chip b">∞ 循环</span>' : '') + '</div>'
        + '<div class="d">' + (s.desc ? esc(s.desc) + ' · ' : '') + acts.length + ' 步'
        + (s.loop ? '' : ' · 跑 ' + (s.loopCount || 1) + ' 遍')
        + (s.runs ? ' · 已跑 ' + s.runs + ' 次' : '') + '</div></div>'
        + '<div class="acts">'
        + (running
          ? '<button class="btn sm warn" data-act="stop">■</button>'
          : '<button class="btn sm ok" data-act="run" data-id="' + s.id + '">▶</button>')
        + '<button class="btn sm ghost" data-act="more" data-id="' + s.id + '">⋯</button>'
        + '</div></div>';
    }
    return h + '</div><div class="row" style="margin:12px 2px 0">'
      + '<button class="btn sm ghost" data-act="import">📥 导入脚本 JSON</button></div>';
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
    var h = '<div class="hero"><div class="hi">操作录制</div>'
      + '<div class="ht">' + (on ? '🔴 正在录制…' : '让我看看你怎么点的') + '</div>'
      + '<div class="muted">开启后去别的 App 随便点，屏幕顶部会出现录制条（停止 / 加 2 秒等待 / 撤销上一步）。</div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn grow ' + (on ? 'warn' : 'ok') + '" data-act="rec">' + (on ? '⏹ 停止录制' : '⏺ 开始录制') + '</button>'
      + '<button class="btn ghost" data-act="recRefresh">刷新</button></div></div>';
    var rec = S.rec || [];
    if (!rec.length) {
      return h + '<div class="empty"><span class="e">🎬</span>还没有录到动作<br>'
        + '<span class="tiny">点上面的红按钮，然后去别的 App 表演</span></div>';
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
      + '</div>';

    h += '<div class="card"><div class="sec">配色</div><div class="themes">';
    for (var tk in THEMES) {
      h += '<button class="sw2' + ((p.theme || 'orange') === tk ? ' on' : '') + '" data-act="theme" data-v="'
        + tk + '" style="--c:' + THEME_C[tk] + '"><i></i><span>' + THEMES[tk] + '</span></button>';
    }
    h += '</div><div class="tiny" style="margin-top:8px">换主色，界面和悬浮球一起变。</div></div>';

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
      + '· 跑疯了怎么办？双击悬浮球，或者下拉通知栏点停止。</div></div>';
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
      + '</div><div class="tiny" style="margin-top:10px">模板坐标用百分比，换机型也不跑偏，进去再微调即可。</div>'
      + '<button class="btn ghost wide" style="margin-top:12px" data-act="cancelAct">取消</button>');
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
  }

  function viewEditor(s) {
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

    h += '<div class="row" style="margin:0 2px 10px"><div class="grow muted">' + acts.length + ' 个动作'
      + '<div class="tiny" style="margin-top:2px">跳转填第几步：0=下一步，−1=收工，−2=重来一轮</div></div>'
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
    var t = TYPES[a.t];
    var h = '<h3>' + t.e + ' ' + t.n + '</h3>';
    for (var j = 0; j < t.f.length; j++) {
      var key = t.f[j][0], label = t.f[j][1], kind = t.f[j][2];
      if (kind === 'switch') {
        h += '<div class="kv"><span>' + label + '</span>' + '<div class="switch ' + (a[key] ? 'on' : '') + '" data-field="' + key + '"><i></i></div></div>';
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
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height);
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
    cv.onclick = function (e) {
      var r = cv.getBoundingClientRect();
      picked = {
        x: Math.round((e.clientX - r.left) / r.width * cv.width),
        y: Math.round((e.clientY - r.top) / r.height * cv.height)
      };
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

  // ---------- 事件 ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act],[data-toggle],.switch,#tabs button');
    if (!el) return;
    var act = el.dataset.act;

    // 底部 tab
    if (el.dataset.tab) { S.tab = el.dataset.tab; S.editId = null; render(); return; }

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
      case 'run': ok(call('run', id)); setTimeout(refreshAll, 300); break;
      case 'runLast':
        var last = S.prefs.lastScript && findScript(S.prefs.lastScript);
        ok(call('run', (last || S.scripts[0]).id));
        setTimeout(refreshAll, 300);
        break;
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
      case 'cancelAct': closeSheet(); break;
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
      case 'goTrig': S.tab = 'trig'; render(); break;
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

  function saveAct(i) {
    var s = findScript(S.editId);
    var a = s.actions[i];
    var fields = document.querySelectorAll('#sheet [data-field]');
    for (var q = 0; q < fields.length; q++) {
      var f = fields[q], k = f.dataset.field;
      if (f.classList.contains('switch')) { a[k] = f.classList.contains('on'); continue; }
      if (f.tagName === 'SELECT') { a[k] = f.value; continue; }
      if (k === 's' || k === 'p') { a[k] = f.value; }
      else a[k] = num(f.value, 0);
    }
    saveScripts();
    closeSheet();
    render();
  }

  function sheetMore(id) {
    var s = findScript(id);
    sheet('<h3>' + esc(s.name) + '</h3>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="edit" data-id="' + id + '">✎ 编辑动作</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="dup" data-id="' + id + '">⧉ 复制一份</button>'
      + '<button class="btn ghost wide" style="margin-bottom:9px" data-act="export" data-id="' + id + '">📤 导出 JSON</button>'
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
  };

  // ---------- 启动 ----------
  function boot() {
    refreshAll();
    loadRec();
    setInterval(function () {
      if (S.tab === 'log') refreshAll();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
