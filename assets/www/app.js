/* 懒人点击器 · 界面层（纯 JS，无框架）
   目标：小、快、不卡。所有数据经 window.app.* 与原生内核交换。
   v1.3：玻璃质感 UI、渲染 rAF 节流、焦点保持、脚本图标与搜索、延迟启动 */
(function () {
  'use strict';

  var S = {
    tab: 'scripts',
    sub: null,        // 「我的」里的子页：log / trig / settings / about
    condSub: null,    // 正在改第几个条件（null=在动作主表单）
    // 进动作编辑器时的快照，用于「取消」真正撤销。
    // 因为 saveScripts 是把整个 S.scripts 全量写回的，
    // 光靠「编辑期间不落盘」挡不住——之后任何一次落盘都会把内存里的改动一起带走。
    editBackup: null,
    scripts: [],
    rec: [],
    st: {},
    prefs: {},
    editId: null,     // 正在编辑的脚本 id
    editAct: -1,      // 正在编辑的动作下标
    groupIdx: null,   // 正在编辑第几个分组里的内容（null=在脚本根层的动作列表）
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
  /** 配色只认 1~6，别把脚本里带的数字原样拼进 class（导入的脚本可能夹带引号把标签撑开） */
  function toneCls(t) {
    var n = parseInt(t, 10);
    return (n >= 1 && n <= 6) ? n : 1;
  }
  /** 图标同理：市场脚本和分享码里的 icon 是别人给的，一律转义后再拼 */
  function iconOf(i) {
    var s = String(i == null ? '' : i);
    return s ? esc(s.slice(0, 8)) : '📜';
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
  /** 简单深拷贝：默认值里的数组/对象不能直接共用，否则改一个动全身 */
  function clone(v) {
    if (v == null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  /**
   * 开关值：默认存布尔，但 pct / rep 是例外——Java 端按数字读（历史脚本里也是 1/0），
   * 存布尔会被 org.json 当成关。Java 那边现在是布尔数字都认（ScriptRunner#on），
   * 这里也统一存 1/0，省得一份数据两种形态。
   */
  function swVal(k, on) { return (k === 'pct' || k === 'rep') ? (on ? 1 : 0) : on; }

  // ---------- 动作定义 ----------
  var TYPES = {
    click: { n: '点击', e: '👆', c: 1, f: [['x', 'X 坐标'], ['y', 'Y 坐标'], ['d', '之后等待 ms']], def: { x: 50, y: 50, d: 300 } },
    // v2.3.0：这三个以前 def 里没写 x/y，新建出来是 (0,0)——屏幕左上角，
    // 用户以为「没反应」，其实是点在状态栏上了。补上和 click 一样的默认值
    double: { n: '双击', e: '✌️', c: 1, f: [['x', 'X'], ['y', 'Y'], ['d', '之后等待 ms']], def: { x: 50, y: 50, d: 300 } },
    long: { n: '长按', e: '👇', c: 1, f: [['x', 'X'], ['y', 'Y'], ['ms', '按住时长 ms'], ['d', '之后等待 ms']], def: { x: 50, y: 50, ms: 800, d: 300 } },
    swipe: { n: '滑动', e: '💫', c: 1, f: [['x1', '起点 X'], ['y1', '起点 Y'], ['x2', '终点 X'], ['y2', '终点 Y'], ['ms', '滑动时长 ms'], ['d', '之后等待 ms']], def: { x1: 50, y1: 70, x2: 50, y2: 30, ms: 400, d: 300 } },
    random: { n: '随机点', e: '🎲', c: 1, f: [['x', '中心 X'], ['y', '中心 Y'], ['r', '随机半径 px'], ['d', '之后等待 ms']], def: { x: 50, y: 50, r: 12, d: 300 } },
    // d 写 0：等待时长以 ms 为准（引擎取 max(ms,d)），别让默认的 300 混进来
    wait: { n: '等待', e: '⏳', f: [['ms', '等待 ms']], def: { ms: 1000, d: 0 } },
    key: { n: '按键', e: '🔘', f: [['k', '按键', 'key'], ['d', '之后等待 ms']], def: { k: 'back', d: 300 } },
    text: { n: '输入', e: '⌨️', f: [['s', '要输入的文字', 'text'], ['d', '之后等待 ms']], def: { s: '', d: 300 } },
    launch: { n: '开应用', e: '📱', f: [['p', '包名，如 com.tencent.mm', 'text'], ['d', '之后等待 ms']], def: { p: '', d: 1500 } },
    // v2.3.0：clickable 引擎一直在读（只找能点的控件），但表单里没入口，等于躺了三个版本
    // v2.4.0：补上 id / desc / re 三个条件。desc 留空＝老样子（文字或描述任一命中），
    // 填了才是「文字归文字、描述归描述」两边都要满足 —— 这条语义写在标签里，不然用户猜不到
    find: { n: '找文字', e: '🔍', f: [['s', '屏幕上的文字', 'text'], ['desc', '内容描述（留空＝按老样子，文字或描述任一命中）', 'text'], ['id', '控件 id（ok 或 com.x:id/ok 都行）', 'text'], ['re', '正则（额外收窄，不填不生效）', 'text'], ['click', '找到就点它', 'switch'], ['contains', '模糊匹配', 'switch'], ['clickable', '只看能点的按钮', 'switch'], ['timeout', '最多等 ms'], ['index', '第几个(1起)'], ['d', '之后等待 ms']], def: { s: '', desc: '', id: '', re: '', click: true, contains: true, clickable: false, timeout: 3000, index: 1, d: 300 } },
    if: { n: '如果', e: '🔀', f: [['m', '判断什么', 'sel:ifmode'], ['s', '屏幕上的文字', 'text'], ['desc', '内容描述（留空＝按老样子）', 'text'], ['id', '控件 id', 'text'], ['re', '正则', 'text'], ['p', '应用包名（判断 App 时用）', 'text'], ['contains', '模糊匹配', 'switch'], ['clickable', '只看能点的按钮', 'switch'], ['index', '第几个(1起)'], ['go', '成立 → 跳到第几步'], ['els', '不成立 → 跳到第几步'], ['d', '之后等待 ms']], def: { m: 'text', s: '', desc: '', id: '', re: '', p: '', contains: true, clickable: false, index: 1, go: 0, els: 0, d: 100 } },
    count: { n: '计数', e: '🔢', f: [['k', '计数器名字', 'text'], ['mode', '动作', 'sel:cntmode'], ['v', '每次加多少'], ['times', '涨到几次就跳（0=不管）'], ['go', '跳到第几步'], ['resetAfter', '跳完就清零', 'switch'], ['d', '之后等待 ms']], def: { k: 'main', mode: 'add', v: 1, times: 0, go: 0, resetAfter: true, d: 100 } },
    multi: { n: '多指', e: '🖐', c: 1, f: [['m', '手势', 'sel:multi'], ['x', '中心 X'], ['y', '中心 Y'], ['r', '两指间距半径'], ['ms', '动作时长 ms'], ['d', '之后等待 ms']], def: { m: 'twoTap', x: 50, y: 50, r: 80, ms: 400, d: 400 } },
    // step：每隔几个像素采一次样，越大越快越糙（最小 2）。以前表单没这个入口，
    // 全屏找色只能按默认的 2 一步步扫，在大屏上慢得像卡住
    findColor: { n: '找色', e: '🎨', c: 1, f: [['c', '目标颜色', 'color'], ['sim', '相似度 %'], ['step', '采样间隔(越大越快,≥2)'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高'], ['click', '找到就点它', 'switch'], ['timeout', '没找到就再等 ms（0=不等）'], ['go', '找到 → 跳到第几步'], ['els', '没找到 → 跳到第几步'], ['d', '之后等待 ms']], def: { c: '#FF6B35', sim: 95, step: 2, timeout: 0, rx: 0, ry: 0, rw: 100, rh: 100, click: true, go: 0, els: 0, d: 300, pct: 1 }, pct: ['rx', 'ry', 'rw', 'rh'] },
    cmpColor: { n: '比色', e: '🌈', f: [['x', 'X 坐标'], ['y', 'Y 坐标'], ['c', '期望颜色', 'color'], ['sim', '相似度 %'], ['go', '颜色对 → 跳到第几步'], ['els', '不对 → 跳到第几步'], ['d', '之后等待 ms']], def: { x: 50, y: 50, c: '#FFFFFF', sim: 95, go: 0, els: 0, d: 200 } },
    findImage: { n: '找图', e: '🖼', c: 1, f: [['tpl', '模板图', 'sel:tpls'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高'], ['click', '找到就点它', 'switch'], ['timeout', '没找到就再等 ms（0=不等）'], ['go', '找到 → 跳到第几步'], ['els', '没找到 → 跳到第几步'], ['d', '之后等待 ms']], def: { tpl: '', sim: 90, timeout: 0, rx: 0, ry: 0, rw: 100, rh: 100, click: true, go: 0, els: 0, d: 300, pct: 1 }, pct: ['rx', 'ry', 'rw', 'rh'] },
    // v3.1.0 伪 OCR：找文字(图)。模板选「文字模板」（跟找图的模板图分开管）。
    // 注意：JS 脚本里的 findText() 函数是按控件文字找节点（t:'find'），跟这个动作不同体系
    findText: { n: '找文字(图)', e: '🔠', c: 1, f: [['ttpl', '文字模板', 'sel:ttpls'], ['sim', '相似度 %'], ['zoom', '多尺度(0=关,1=三档缩放)'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高'], ['click', '找到就点它', 'switch'], ['timeout', '没找到就再等 ms（0=不等）'], ['go', '找到 → 跳到第几步'], ['els', '没找到 → 跳到第几步'], ['d', '之后等待 ms']], def: { ttpl: '', sim: 85, zoom: 0, rx: 0, ry: 0, rw: 100, rh: 100, click: true, timeout: 0, go: 0, els: 0, d: 300, pct: 1 }, pct: ['rx', 'ry', 'rw', 'rh'] },
    set: { n: '赋值', e: '📝', f: [['k', '变量名', 'text'], ['v', '值（可写 {{变量}}）', 'var'], ['d', '之后等待 ms']], def: { k: 'n', v: '', d: 100 } },
    math: { n: '运算', e: '🧮', f: [['k', '存到哪个变量', 'text'], ['e', '算式（不用加 {{}}）', 'expr'], ['d', '之后等待 ms']], def: { k: 'n', e: 'n+1', d: 100 } },
    cmpVar: { n: '比变量', e: '⚖️', f: [['l', '左边', 'var'], ['op', '怎么比', 'sel:cmpop'], ['r', '右边', 'var'], ['go', '成立 → 跳到第几步'], ['els', '不成立 → 跳到第几步'], ['d', '之后等待 ms']], def: { l: 'n', op: '>=', r: '3', go: 0, els: 0, d: 100 } },
    // v3.1.0 多任务深化：跨脚本共享变量 + 互斥锁。
    // 共享变量的读不用专门指令——任何字段里直接写 {{g.名字}}；
    // 互斥锁收尾自动释放（脚本停了锁就没了），不怕死锁
    globalSet: { n: '写共享变量', e: '🌐', f: [['k', '名字（不用写 g. 前缀）', 'text'], ['v', '值（可写 {{变量}}）', 'var'], ['d', '之后等待 ms']], def: { k: 'score', v: '', d: 100 } },
    globalGet: { n: '读共享变量', e: '📥', f: [['k', '名字（不用写 g. 前缀）', 'text'], ['to', '存到本道变量（不填=同名）', 'text'], ['d', '之后等待 ms']], def: { k: 'score', to: '', d: 100 } },
    lock: { n: '拿互斥锁', e: '🔒', f: [['name', '锁名（同名互斥）', 'text'], ['timeout', '最多等 ms（0=不等）'], ['go', '拿到 → 跳到第几步'], ['els', '没拿到 → 跳到第几步（不填=收工）'], ['d', '之后等待 ms']], def: { name: '', timeout: 5000, go: 0, els: -1, d: 100 } },
    unlock: { n: '放互斥锁', e: '🔓', f: [['name', '锁名', 'text'], ['d', '之后等待 ms']], def: { name: '', d: 100 } },
    cond: { n: '条件判断', e: '🧠', f: [['go', '全部/满足 → 跳到第几步'], ['els', '不满足 → 跳到第几步'], ['d', '之后等待 ms']], def: { mode: 0, n: 1, cs: [], rep: 0, repGap: 800, repMax: 10, go: 0, els: 0, d: 100 } },
    // 分组：把一批动作装一起，指定怎么跑。子动作不走步号跳转，但「收工」「重来一轮」会往上传
    group: { n: '动作分组', e: '🗂', f: [['name', '分组名（给自己看的）', 'text'], ['mode', '怎么跑', 'sel:gmode'], ['d', '之后等待 ms']], def: { name: '', mode: 0, acts: [], d: 100 } },
    // v2.6.0：跑另一个脚本并等它跑完。传参写 JSON 对象，子脚本里 {{名字}} 直接读；
    // 子脚本往变量里写的值父脚本接着用。name 的下拉在表单渲染里特判 sel:scripts（动态脚本清单）
    runSub: { n: '子脚本', e: '📦', f: [['name', '要跑的脚本', 'sel:scripts'], ['args', '传参 JSON，如 {"n":1}（可留空）', 'text'], ['d', '之后等待 ms']], def: { name: '', args: '', d: 300 } }
  };
  var CMP_OP = { '==': '等于', '!=': '不等于', '>': '大于', '>=': '大于等于', '<': '小于', '<=': '小于等于' };
  // 条件类型（v2.0.0）：跟自动精灵一样按「条件」组织，不是一个动作只挂一个判断
  var CTYPES = {
    // v2.4.0：f 和 def 两边都要加。字段对账器的条件侧有点不对称——
    // 「能填但不读」看的是 f，「在读但没入口」看的却是 def，少加一边就会被判失效
    text: { n: '屏幕上有字', e: '🔤', f: [['s', '要找的字', 'text'], ['desc', '内容描述（留空＝文字或描述任一命中）', 'text'], ['id', '控件 id', 'text'], ['re', '正则', 'text'], ['contains', '模糊匹配', 'switch'], ['clickable', '只看能点的按钮', 'switch'], ['index', '第几个(1起)']], def: { s: '', desc: '', id: '', re: '', contains: true, clickable: false, index: 1 }, sum: function (c) { return '有' + (c.s ? '「' + c.s + '」' : '') + (c.desc ? '描述「' + c.desc + '」' : '') + (c.id ? 'id「' + c.id + '」' : '') + (c.re ? '正则「' + c.re + '」' : '') + ((c.s || c.desc || c.id || c.re) ? '' : '（没填＝任意节点）'); } },
    pkg: { n: '当前是某 App', e: '📱', f: [['v', '包名，如 com.tencent.mm', 'text']], def: { v: '' }, sum: function (c) { return '在 ' + (c.v || '?'); } },
    // pct 默认开：区域字段 0/0/100/100 本来就是百分比（全屏），
    // 关掉的话会被当成 100×100 像素，找色只在左上角一小块里搜，看着像「永远找不到」
    color: { n: '屏幕上有颜色', e: '🎨', f: [['c', '颜色', 'color'], ['sim', '相似度 %'], ['step', '采样间隔(越大越快,≥2)'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高']], def: { c: '#FF6B35', sim: 95, step: 2, rx: 0, ry: 0, rw: 100, rh: 100, pct: 1 }, pct: 1, sum: function (c) { return '有 ' + (c.c || ''); } },
    image: { n: '屏幕上有图', e: '🖼', f: [['tpl', '模板图', 'sel:tpls'], ['sim', '相似度 %'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高']], def: { tpl: '', sim: 90, rx: 0, ry: 0, rw: 100, rh: 100, pct: 1 }, pct: 1, sum: function (c) { return '有图「' + (c.tpl || '未选') + '」'; } },
    // v3.1.0 伪 OCR：屏上有这个字模。键名 ttext——"text" 已被控件找字占用
    ttext: { n: '屏幕上有字模', e: '🔠', f: [['ttpl', '文字模板', 'sel:ttpls'], ['sim', '相似度 %'], ['zoom', '多尺度(0=关,1=三档缩放)'], ['rx', '区域左上 X'], ['ry', '区域左上 Y'], ['rw', '区域宽'], ['rh', '区域高']], def: { ttpl: '', sim: 85, zoom: 0, rx: 0, ry: 0, rw: 100, rh: 100, pct: 1 }, pct: 1, sum: function (c) { return '有字模「' + (c.ttpl || '未选') + '」'; } },
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
    cmode: CMODE,
    // 分组的四种跑法
    gmode: [['0', '👉 按顺序跑'], ['1', '⚡ 同时来（多指）'], ['2', '🔀 打乱顺序'], ['3', '🎲 随机挑一个']]
  };
  var GMODE_N = ['按顺序', '同时来', '打乱顺序', '随机挑一个'];
  var MULTI_N = { twoTap: '双指齐点', twoLong: '双指按住', pinch: '捏合', spread: '张开' };
  var TG = {
    time: { n: '每天定时', e: '⏰', d: '到点自动跑一次' },
    repeat: { n: '每隔一段', e: '🔁', d: '按分钟周期重复' },
    notify: { n: '收到通知', e: '🔔', d: '通知含指定文字就跑' },
    power: { n: '插上电源', e: '🔌', d: '充电时自动跑' },
    unlock: { n: '解锁屏幕', e: '🔓', d: '亮屏解锁就跑' }
  };
  var ICONS = ['📜', '⚡', '🎮', '📺', '🎁', '⏭', '🔨', '🫧', '💰', '🎯', '🍚', '🚀', '❤️', '🧹', '📲', '⏰'];

  /** v2.4.0：找节点的附加条件（描述 / id / 正则），find 和 if 的摘要都用它 */
  function actTail(a) {
    return (a.desc ? '·描述「' + a.desc + '」' : '') + (a.id ? '·id「' + a.id + '」' : '')
      + (a.re ? '·正则「' + a.re + '」' : '');
  }

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
      // v2.4.0：把 id / desc / re 也带进摘要，不然列表里看着还是个「找「」」，分不清按什么找的
      case 'find': return '找「' + (a.s || '') + '」' + actTail(a) + (a.click ? ' 并点击' : '') + ' 第' + (a.index || 1) + '个';
      case 'if': return a.m === 'pkg'
        ? '若当前是 ' + (a.p || '?') + ' → 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els)
        : '若有「' + (a.s || '') + '」' + actTail(a) + '→ 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els);
      case 'count': return '计数 ' + (a.k || 'main') + (a.mode === 'reset' ? ' 清零' : ' +' + (a.v || 1))
        + (a.times ? '，够 ' + a.times + ' 次跳' + jumpTxt(a.go) : '');
      case 'multi': return (MULTI_N[a.m] || a.m) + ' @' + p + ' (' + a.x + ',' + a.y + ')';
      case 'findColor': return '找 ' + (a.c || '') + ' 像≥' + (a.sim || 95) + '%'
        + (a.click ? ' 并点击' : '') + '，找到跳' + jumpTxt(a.go) + ' / 没找到跳' + jumpTxt(a.els);
      case 'cmpColor': return '比 (' + a.x + ',' + a.y + ')=' + (a.c || '') + ' ≥' + (a.sim || 95)
        + '%，对跳' + jumpTxt(a.go) + ' / 不对跳' + jumpTxt(a.els);
      case 'findImage': return '找图「' + (a.tpl || '未选') + '」像≥' + (a.sim || 90) + '%'
        + (a.click ? ' 并点击' : '') + '，找到跳' + jumpTxt(a.go) + ' / 没找到跳' + jumpTxt(a.els);
      case 'findText': return '找字模「' + (a.ttpl || '未选') + '」像≥' + (a.sim || 85) + '%'
        + (a.zoom ? ' ·多尺度' : '') + (a.click ? ' 并点击' : '')
        + '，找到跳' + jumpTxt(a.go) + ' / 没找到跳' + jumpTxt(a.els);
      case 'globalSet': return '共享变量 ' + (a.k || '?') + ' = ' + (a.v === '' ? '（空）' : a.v);
      case 'globalGet': return '共享变量 ' + (a.k || '?') + ' → 本道 ' + (a.to || a.k || '?');
      case 'lock': return '拿锁「' + (a.name || '?') + '」最多等 ' + (a.timeout || 0)
        + 'ms，拿到跳' + jumpTxt(a.go) + ' / 没拿到跳' + jumpTxt(a.els);
      case 'unlock': return '放锁「' + (a.name || '?') + '」';
      case 'set': return (a.k || '?') + ' = ' + (a.v === '' ? '（空）' : a.v);
      case 'math': return (a.k || '?') + ' = ' + (a.e || '');
      case 'cmpVar': return '若 ' + (a.l || '0') + ' ' + (CMP_OP[a.op] || a.op) + ' ' + (a.r || '0')
        + ' → 跳' + jumpTxt(a.go) + '，否则跳' + jumpTxt(a.els);
      case 'group': {
        var n = (a.acts || []).length;
        var gm = GMODE_N[a.mode|0] || '按顺序';
        return (a.name ? '「' + a.name + '」' : '') + n + ' 个动作 · ' + gm;
      }
      // v2.6.0：子脚本摘要把传参也露出来，列表里一眼看出给子脚本塞了什么
      case 'runSub': return '跑子脚本「' + (a.name || '未选') + '」' + (a.args ? ' · 传参 ' + a.args : '');
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

  /**
   * 当前正在编辑的动作数组：可能在脚本根层，也可能在某个分组里。
   * 返回的是引用，push/splice 会直接改到原对象上（重新赋值不行）。
   */
  function curActs() {
    var s = findScript(S.editId);
    if (!s) return null;
    if (S.groupIdx != null) {
      var g = s.actions[S.groupIdx];
      if (!g || g.t !== 'group') { S.groupIdx = null; return s.actions; }
      if (!g.acts) g.acts = [];
      return g.acts;
    }
    return s.actions;
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
        log: viewLog, trig: viewTriggers, ttpl: viewTextTpls, settings: viewSettings, about: viewAbout
      })[S.sub];
      page.innerHTML = (S.sub ? subBar() : '') + (sub ? sub() : viewMine());
    } else {
      page.innerHTML = ({
        scripts: viewScripts, market: viewMarket, record: viewRecord
      })[S.tab]();
    }
    if (swapped) { page.classList.remove('swap'); void page.offsetWidth; page.classList.add('swap'); }
    bindDrag();
    // 日志页每次重绘都滚到最新一条，不然新日志全在下面看不见
    if (S.tab === 'mine' && S.sub === 'log') {
      var lbox = $('.log');
      if (lbox) lbox.scrollTop = lbox.scrollHeight;
    }

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
    if (st.paused) h += '<span class="badge paused">已暂停</span>';
    else if (st.running) h += '<span class="badge brand">运行中</span>';
    $('#badges').innerHTML = h;
  }

  // ---------- 顶部状态大卡 ----------
  function dot(v, label, act) {
    return '<span class="dot ' + (v ? 'ok' : 'no') + '"'
      + (act && !v ? ' data-act="' + act + '"' : '') + '><b></b>' + label + (v ? ' 已开' : ' 未开') + '</span>';
  }

  // v3.0.0：会话时长，浮层同款格式（12s / 1m03s）
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000));
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
  }

  // v3.0.0：多会话逐条渲染——名字 + #runId 徽标 + 进度/时长 + 单独的暂停与停止。
  // JS 会话没有暂停键（v2.5 起的约定），停止照有。
  function runRows(runs) {
    var h = '<div class="runs">';
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      h += '<div class="runrow" data-runid="' + r.runId + '">'
        + '<span class="rt">' + (r.state === 'paused' ? '⏸' : '▶') + ' ' + esc(r.name || '未命名')
        + '<span class="lrb">#' + r.runId + '</span></span>'
        + '<span class="rs">' + (r.total > 0 ? r.prog + '/' + r.total : fmtElapsed(r.elapsed)) + '</span>'
        + (r.js ? '' : '<button class="btn sm" data-act="pauseRun" data-runid="' + r.runId + '">'
          + (r.state === 'paused' ? '▶' : '⏸') + '</button>')
        + '<button class="btn sm warn" data-act="stopRun" data-runid="' + r.runId + '">■</button>'
        + '</div>';
    }
    return h + '</div>';
  }

  // ---------- v3.2.0 权限强引导 ----------
  // 六家 ROM 的「自启动 / 后台弹出 / 电池优化」藏的位置都不一样，不给路径，
  // 权限给了一半照样跑不动（MIUI 不给「后台弹出界面」，运行浮层永远拉不起来）。
  // 按 Build.MANUFACTURER 小写后包含匹配，都没中走通用提示
  var BRAND_HINTS = [
    ['xiaomi|redmi|小米|红米|poco', '小米/红米/POCO：安全中心 → 应用管理 → 懒人点击器 → 打开「自启动」；再到 权限管理 里开「显示悬浮窗」和「后台弹出界面」——不开后者，跑起来浮层也拉不出来'],
    ['huawei|honor|华为|荣耀', '华为/荣耀：设置 → 应用 → 应用启动管理 → 懒人点击器 → 关掉「自动管理」，手动管理三个开关（自启动/关联启动/后台活动）全打开'],
    ['oppo|oneplus|realme|一加', 'OPPO/一加/realme：设置 → 电池 → 更多设置 → 优化电池使用 里关掉本应用；应用权限里开「悬浮窗」和「自启动」'],
    ['vivo|iqoo', 'vivo/iQOO：设置 → 电池 → 后台高耗电 里允许本应用；自启动和悬浮窗权限在 设置 → 应用 → 权限管理 里开'],
    ['samsung|三星', '三星：设置 → 电池 → 后台使用限制，把懒人点击器从「深度睡眠应用」里移出来；悬浮窗权限记得开'],
    ['meizu|魅族', '魅族：手机管家 → 权限管理 → 自启动允许；悬浮窗在 应用管理 → 权限管理 里开']
  ];
  var BRAND_DEFAULT_HINT = '其他手机：把本应用加入电池优化白名单（忽略电池优化）并允许自启动，悬浮窗权限记得开——不然服务会被杀、浮层显示不出来';

  function brandHint(mfr) {
    mfr = String(mfr || '').toLowerCase();
    for (var i = 0; i < BRAND_HINTS.length; i++) {
      var keys = BRAND_HINTS[i][0].split('|');
      for (var j = 0; j < keys.length; j++) {
        if (mfr.indexOf(keys[j]) >= 0) return BRAND_HINTS[i][1];
      }
    }
    return BRAND_DEFAULT_HINT;
  }

  /** 主卡下方的常驻引导卡：权限没给齐（或无障碍假死）就一直显示，给齐自动消失 */
  function permGuide(st) {
    st = st || {};
    var rows = [];
    if (!st.acc) rows.push('<div class="kv"><span>① 无障碍服务——点击的引擎，不开跑不了</span>'
      + '<button class="btn sm ok" data-act="acc">去开启</button></div>');
    if (!st.overlay) rows.push('<div class="kv"><span>② 悬浮窗权限——悬浮球和运行浮层全靠它</span>'
      + '<button class="btn sm ok" data-act="overlay">去授权</button></div>');
    // 假死：系统设置里开关是开的（acc），但服务实例没连上（linked）——有的手机会这样，关了重开就好。
    // linked 字段 v3.2.0 才有，旧数据/旧桩没有这个字段时（undefined）不误报
    if (st.acc && st.linked === false) rows.push('<div class="kv"><span>⚠️ 无障碍开关是开的，但服务没连上（有的手机会假死）——去系统无障碍把它关掉再开一次</span>'
      + '<button class="btn sm ok" data-act="acc">去重开</button></div>');
    if (!rows.length) return '';
    return '<div class="card" style="margin-top:10px"><div class="sec">🔑 先把权限给齐，脚本才跑得动</div>'
      + rows.join('')
      + '<div class="tiny" style="margin-top:8px">' + esc(brandHint(st.manufacturer)) + '</div></div>';
  }

  /** 首启自动弹的引导层（只弹一次，之后靠主卡常驻引导） */
  function permGuideSheet() {
    var st = S.st || {};
    var h = '<h3>🔑 开工前，先给两个权限</h3>'
      + '<div class="tiny">懒人点击器靠「无障碍服务」看屏幕、点屏幕，靠「悬浮窗」显示悬浮球和运行浮层。'
      + '这两个都是系统级权限，只能你亲手去开——点下面按钮直达。</div>';
    if (!st.acc) h += '<div class="row" style="margin-top:10px"><button class="btn ok grow" data-act="acc">① 开无障碍服务</button></div>'
      + '<div class="tiny" style="margin-top:6px">跳到系统无障碍列表 → 找到「懒人点击器」→ 打开开关</div>';
    if (st.acc && st.linked === false) h += '<div class="tiny" style="margin-top:8px">⚠️ 无障碍开着但服务没连上：去系统无障碍把它关掉再开一次</div>';
    if (!st.overlay) h += '<div class="row" style="margin-top:10px"><button class="btn ok grow" data-act="overlay">② 授权悬浮窗</button></div>'
      + '<div class="tiny" style="margin-top:6px">在系统页里允许「显示在其他应用上层」</div>';
    h += '<div class="tiny" style="margin-top:8px">' + esc(brandHint(st.manufacturer)) + '</div>';
    return h + '<div class="row" style="margin-top:12px"><button class="btn ghost grow" data-act="guideDone">我知道了，去开</button></div>';
  }

  function heroCard() {
    var st = S.st || {};
    var runs = st.runs || [];
    var running = !!st.running;
    var paused = !!st.paused;
    var cur = (running || paused) ? findScript(st.current) : null;
    var h = '<div class="hero">'
      + '<div class="hi">' + (paused ? '中场休息' : running ? '手指已下班' : '今天也要少动手指') + '</div>'
      + '<div class="ht">' + (runs.length > 1 ? runs.length + ' 条会话在跑'
        : paused ? '已暂停 · ' + esc(cur ? cur.name : '运行中')
        : running ? esc(cur ? cur.name : '运行中') : '一切就绪') + '</div>'
      + '<div class="hs">'
      + dot(st.acc, '无障碍', 'acc')
      + dot(st.overlay, '悬浮窗', 'overlay')
      + (st.ball ? '<span class="dot ok"><b></b>悬浮球在岗</span>' : '')
      + (paused ? '<span class="dot paused"><b></b>已暂停</span>' : '')
      + (running ? '<span class="dot run"><b></b>运行中</span>' : '')
      + (st.recording ? '<span class="dot run"><b></b>录制中</span>' : '')
      + '</div>';
    if (runs.length) h += runRows(runs);
    h += '<div class="row">';
    if (runs.length > 1) {
      h += '<button class="btn warn grow" data-act="stop">■ 停全部</button>';
    } else if (running || paused) {
      h += '<button class="btn grow" data-act="togglePause">' + (paused ? '▶ 继续跑' : '⏸ 暂停') + '</button>'
        + '<button class="btn warn grow" data-act="stop">■ 立刻刹车</button>';
    } else if (S.scripts.length) {
      h += '<button class="btn grow" data-act="runLast">▶ 跑上次那个</button>';
    }
    h += '<button class="btn ghost" data-act="ball">' + (st.ball ? '收起悬浮球' : '呼出悬浮球') + '</button>';
    // v3.2.0：权限没给齐时主卡下方常驻引导卡（比小字 hint 醒目得多），给齐自动消失
    return h + '</div></div>' + permGuide(st);
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
      // v3.0.0：高亮按「这条脚本在哪个会话跑」匹配（runs 快照的 id 字段 = 脚本 id）
      var running = (S.st && S.st.runs || []).some(function (r) { return r.id === s.id; });
      h += '<div class="item' + (running ? ' run' : '') + '" data-id="' + s.id + '">'
        + (q ? '' : '<div class="grip" data-drag="' + S.scripts.indexOf(s) + '" data-list="scripts">⋮⋮</div>')
        + '<div class="ic g' + toneCls(s.tone) + '" data-act="pickIcon" data-id="' + s.id + '">' + iconOf(s.icon) + '</div>'
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
    { k: 'ttpl', e: '🔠', n: '文字模板', d: '伪 OCR：截屏框个字存字模，「找文字(图)」认它', tone: 6 },
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
        ? S.scripts.length + ' 个脚本待命' + (st.paused ? ' · 已暂停' : st.running ? ' · 正在跑' : '')
        : '一个脚本都还没有') + '</div>'
      + '<div class="hs">' + dot(st.acc, '无障碍', 'acc') + dot(st.overlay, '悬浮窗', 'overlay')
      + (st.ball ? '<span class="dot ok"><b></b>悬浮球在岗</span>' : '')
      + (st.paused ? '<span class="dot paused"><b></b>已暂停</span>' : '')
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

  // 日志级别：0 普通 / 1 提醒 / 2 出错（和内核 LogLine 里的常量对齐）
  function logLvOf(l) {
    if (l && typeof l.lv === 'number') return l.lv;
    // 老格式（纯字符串）按关键词猜一个，升级后不至于全变白
    var m = (typeof l === 'string' ? l : (l && l.m) || '');
    if (/出错|失败|崩|异常|未知/.test(m)) return 2;
    if (/没开|没找到|找不到|跳过|中断|没有|超时|不跑了/.test(m)) return 1;
    return 0;
  }
  function logText(l) {
    return (typeof l === 'string') ? l : ((l && l.m) || '');
  }
  // v2.7.0：运行归属徽标（#<runId>）。r>0 才显示；r=0 是系统消息/老数据，无徽标。
  // 只在渲染层加，统计（logLvOf）与复制（logCopy 走纯文本）都不经过这里。
  function logBadge(l) {
    var r = (l && typeof l.r === 'number') ? l.r : 0;
    return (r > 0) ? '<span class="lrb">#' + r + '</span>' : '';
  }

  function viewLog() {
    var st = S.st || {};
    var logs = st.log || [];
    var min = S.logMin || 0;                 // 0 全部 / 1 只看提醒和出错
    var shown = logs.filter(function (l) { return logLvOf(l) >= min; });
    var nErr = 0, nWarn = 0;
    for (var i = 0; i < logs.length; i++) {
      var lv = logLvOf(logs[i]);
      if (lv === 2) nErr++; else if (lv === 1) nWarn++;
    }

    var many = (st.runs || []).length > 1;   // v3.0.0：多会话时大卡变概览
    var h = '<div class="hero"><div class="hi">运行状态</div>'
      + '<div class="ht">' + (many ? '🏃 ' + (st.runs || []).length + ' 条会话在跑'
        : st.paused ? '⏸ 已暂停 · ' + esc(st.runName || '')
        + (st.prog ? ' · 第 ' + esc(st.prog) + ' 步' : '')
        : st.running ? '🏃 正在跑 · ' + esc(st.runName || '')
        + (st.prog ? ' · 第 ' + esc(st.prog) + ' 步' : '')
        : st.js ? '⚡ JS 脚本运行中'   // v2.5.0：以前 JS 在跑这里显示「空闲中」，瞎话
        : '💤 空闲中') + '</div>'
      + '<div class="row">'
      + (many
        ? '<button class="btn warn grow" data-act="stop">■ 停全部</button>'
        : ((st.running || st.paused) ? '<button class="btn grow" data-act="togglePause">'
          + (st.paused ? '▶ 恢复' : '⏸ 暂停') + '</button>'
          + '<button class="btn warn grow" data-act="stop">■ 停止</button>' : ''))
      + '<button class="btn ghost" data-act="logRefresh">刷新</button></div>'
      + '<div class="row" style="margin-top:8px">'
      + '<button class="btn sm ghost grow" data-act="logFilter">' + (min ? '✓ 只看提醒' : '全部') + '</button>'
      + '<button class="btn sm ghost grow" data-act="logCopy">复制</button>'
      + '<button class="btn sm ghost grow" data-act="logClear">清空</button></div>'
      + (logs.length ? '<div class="tiny" style="margin-top:8px">共 ' + logs.length + ' 条'
        + (nErr ? ' · <b style="color:var(--warn)">' + nErr + ' 条出错</b>' : '')
        + (nWarn ? ' · ' + nWarn + ' 条提醒' : '') + '</div>' : '')
      + '</div>';

    h += '<div class="card"><div class="sec">最近输出</div><div class="log">';
    if (!shown.length) {
      h += '<div class="lg empty">' + (logs.length ? '（这一档没有，切回「全部」看看）' : '（暂无日志，跑一次就有了）') + '</div>';
    } else {
      h += shown.map(function (l) {
        var lv = logLvOf(l);
        var c = (l && l.c) || '';
        return '<div class="lg lv' + lv + '">' + (c ? '<span class="lt">' + esc(c) + '</span>' : '')
          + logBadge(l) + esc(logText(l)) + '</div>';
      }).join('');
    }
    h += '</div></div>';
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

    h += '<div class="card"><div class="sec">运行中的小帮手</div>'
      + '<div class="kv"><span>运行浮层</span>' + sw('runOverlay', p.runOverlay !== false) + '</div>'
      + '<div class="kv"><span>音量键急停</span>' + sw('volStop', !!p.volStop) + '</div>'
      + '<div class="tiny" style="margin-top:8px">'
      + '<b>运行浮层</b>：脚本一跑起来就贴一根状态条，写着脚本名、跑到第几步、已经跑了多久；'
      + '能拖到任意位置（位置会记住），点一下把界面叫回来，✕ 临时收起、下一轮自己回来。'
      + '<br><b>音量键急停</b>：脚本跑着的时候按音量 + / − 直接刹车，'
      + '这一下不会去调音量。默认关着，免得你只是想调个音量却把脚本停了。'
      + '</div></div>';

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

  // v2.3.0：这份列表以前停更在 v1.4.0——后面发了七个版本，用户点「关于」看到的还是一年前的日志。
  // F.java 里有一条断言盯着第一条是不是当前版本，忘了同步会让单测变红。
  var CHANGELOG = [
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v3.2.0</div><b>权限强引导 + 主流手机适配</b>。有用户反馈「第一次打开没人提醒要开权限」——确实：提醒以前是两行小字，一晃就过去了。现在<b>第一次打开自动弹引导</b>（一步一按钮直达系统设置），主卡下也常驻<b>权限引导卡</b>，没给齐一直显示、给齐自动消失；按手机品牌给出对应的<b>白名单路径</b>（小米要开「后台弹出界面」、华为要改「应用启动管理」、OPPO/vivo 要放电池限制——不开放着权限浮层也拉不出来）。顺手修两处：部分手机回收无障碍服务后界面还挂着假「已开」；悬浮窗没授权时脚本跑了但浮层没影、也不说原因——现在会落一条日志明说。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v3.1.0</div><b>伪 OCR + 多任务深化</b>。新增「我的 → <b>文字模板</b>」：截屏框一个字存成字模，动作「<b>找文字(图)</b>」和条件「屏幕上有字模」就能认出屏幕上的这个字并点它——无障碍找不到的字（图片里的、游戏里的）也有办法了；支持<b>多尺度</b>（屏幕上的字大一号小一号也能认）、区域限定与超时轮询，命中坐标照常记进 {{lastX}}/{{lastY}}。新增<b>共享变量</b>：globalSet／globalGet 读写，任何脚本任何字段里直接写 {{g.名字}} 就能互传消息；新增<b>互斥锁</b>：lock／unlock 同名锁全局互斥，「同一时刻只许一个脚本动这个界面」一条动作搞定，锁可重入、带超时，脚本停了锁自动释放。JS 脚本同步支持 gset／gget／glock／gunlock。顺手修：「设置 → 图色识别 → 模板图」里的「截图框一块存模板」按钮因事件撞名一直点不动，本版修复。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v3.0.0</div><b>真·多任务并行</b>来了：最多同时跑 <b>3 条脚本</b>（2 条动作 + 1 条 JS），互不抢场、日志各记各的（#编号 徽标分清是谁写的）。跑第二个脚本不再把第一个踢掉——会话满了会明说「先停一个再跑」；定时触发器撞上满员会跳过这一轮并记条日志，不再抢占。运行大卡升级成<b>会话列表</b>：每条会话带 #编号，单独暂停／停止（JS 会话不支持暂停，老约定）；脚本列表里谁在跑一眼全亮；变量页按会话分组看数。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.7.0</div>多任务基建（还不是真并行，为下版打底）：日志每行带上<b>#编号</b>，标出是第几次跑写的——两脚本交替跑也不串；悬浮条最多能同屏 <b>3 条</b>，各自显示进度和暂停键，JS 脚本也显示真实脚本名了；音量键急停、状态面板改走结构化消息。界面看着变化不大，底下把「正在跑什么」从单例字段换成了可多开的「运行会话」记账。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.6.0</div>动作列表新增<b>子脚本</b>：把常用流程单独存成一个脚本，别的脚本里一条动作就能调它，还能<b>传参</b>（填 JSON，如 {"n":1}，子脚本里用 {{n}} 引用）；子脚本里写的变量跑完还在，父脚本接着就能读，算它的回值。子脚本里的「收工／重来」只结束子脚本、不带走父脚本；套娃最多 5 层，A 调 B、B 调 A 的死循环进不来。JS 脚本也补齐了查找：<b>tapText／hasText</b> 支持控件 id、内容描述、正则选项，新增 <b>findText</b>（只找不点，立刻回坐标）、<b>waitText</b>（等文字出现再往下走）、<b>runSub</b>（JS 里也能调子脚本）。找文字／找色／找图命中后坐标都会记进 {{lastX}}／{{lastY}}。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.5.0</div>运行能<b>暂停</b>了：悬浮条多了「⏸ 暂停 / ▶ 恢复」按钮，暂停后跑到哪一步记住哪一步，恢复从断点继续、不丢进度；等待中的动作也能立刻暂停，暂停期间不吃等待时长。音量键升级三态：<b>短按</b>切换暂停/恢复、<b>长按</b>才是急停，没跑脚本时音量归系统管。磁贴、悬浮球、日志面板都能看出暂停态。JS 脚本模式暂不支持暂停（短按就是急停），下版再补。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.4.0</div>找节点补上三个新条件：<b>控件 id</b>（填 ok 或 com.xxx:id/ok 都行）、<b>正则</b>（按正则在文字里搜，不用加 ^$）、<b>内容描述</b>（desc）。多个条件全部满足才算命中；描述留空时沿用老样子（文字或描述任一命中），填了才改成「文字归文字、描述归描述」。顺手修掉两个老毛病：只填 id 不填文字以前会被当成「没填」直接判不成立；一屏里第 41 个往后永远取不到（「第几个」填大了就静默失效）。新增 52 条节点匹配单测。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.3.0</div>静默失效大扫除：「等待」动作真的会等了（以前写 5 秒只等 0.3 秒）；「找文字／找色／找图」的超时改成真轮询，不再被硬夹成 2 秒；表单补上「只看能点的按钮」「采样间隔」「超时」等一批引擎一直在读却没入口的开关；双击/长按/随机点新建时不再默认点 (0,0)；按键在低版本上按不动时会明说原因；JS 脚本开始认「开始前等几秒」和「循环几次」。新增字段对账测试，以后表单和引擎对不上会立刻变红。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.2.0</div>运行浮层（可拖拽、位置记住、跑起来自动冒出）、音量键急停、运行日志面板重做（按等级着色＋只看提醒＋复制／清空）。顺手修了进子页不刷新、以及编译失败照样打包出缺类 APK 这两个真问题。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.1.0</div>动作分组 + 四种跑法（顺序／同时／打乱／随机挑一个），手势类分组会合成一次多指手势派出去。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.0.1</div>体检版：把界面存什么、引擎读什么做了一次全字段交叉对账，修掉 7 个 bug，构建搬到 GitHub Actions 云端。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v2.0.0</div>界面与交互范式全面对齐自动精灵：底部四大页签、脚本卡片、多条件判断（全部满足／满足一个／凑够 N 个）、条件可重复检查到成功为止。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.8.0</div>脚本市场与分享码：一条码带走整个脚本，扫码导入，内置模板库。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.7.0</div>JS 脚本模式：用 await 写脚本，跟动作脚本共用同一批动作实现。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.6.0</div>变量与表达式：任何字段都能写 {{变量}}，里面还能算。',
    '<div class="tiny" style="margin:8px 0 2px;font-weight:700">v1.5.0</div>图色识别：找色、比色、找图（模板匹配），命中坐标能接着用。',
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
    ['tapText(文字, 选项)', '找文字并点它；选项可带 {id, desc, re, index, timeout}'],
    ['hasText(文字, 选项)', '屏幕上有没有这段字 → true/false（选项同上）'],
    ['findText(文字, 选项)', '只找不点，立刻返回 → {x,y} 或 null'],
    ['waitText(文字, 选项)', '等文字出现（默认最多 10 秒）→ {x,y} 或 null'],
    ['hasApp(包名)', '当前是不是这个 App → true/false'],
    ['runSub(脚本名, 参数)', '跑另一个脚本并等它跑完 → {ok, steps}；参数是对象，子脚本里 {{名字}} 读，子脚本写的变量父脚本接着用'],
    ['findColor(颜色)', '找颜色 → {x,y,sim} 或 null'],
    ['findImage(名字)', '找模板图 → {x,y,sim} 或 null'],
    ['cmpColor(x,y,颜色)', '某点颜色对不对 → true/false'],
    ['setVar(名, 值)', '存变量'],
    ['getVar(名)', '取变量'],
    ['gset(名, 值)', '写共享变量（v3.1.0）：别的脚本用 gget 或 {{g.名字}} 读'],
    ['gget(名)', '读共享变量'],
    ['glock(锁名, 最多等ms)', '拿互斥锁 → true/false；同名锁全局互斥，脚本结束自动放'],
    ['gunlock(锁名)', '放互斥锁'],
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
      + '<div class="ic g' + toneCls(s.tone) + '" data-act="pickIcon" data-id="' + s.id
      + '" style="width:34px;height:34px;flex:0 0 34px;font-size:16px">' + iconOf(s.icon) + '</div>'
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

  /** 分组内页：跟脚本编辑器长得像，但操作的是分组里的子动作 */
  function viewGroup(s, gi) {
    var g = s.actions[gi];
    if (!g || g.t !== 'group') { S.groupIdx = null; return viewEditor(s); }
    var acts = g.acts || [];
    var h = '<div class="card"><div class="row">'
      + '<button class="btn sm ghost" data-act="back">‹ 返回</button>'
      + '<div class="ic g' + ((gi % 6) + 1) + '" style="width:34px;height:34px;flex:0 0 34px;font-size:16px">🗂</div>'
      + '<div class="grow"><input id="gname" value="' + esc(g.name || '') + '" placeholder="分组名（给自己看的）"></div>'
      + '<button class="btn sm ok" data-act="saveGroup">保存</button></div>'
      + '<label class="f" style="margin-top:10px"><span>这一组怎么跑</span>'
      + '<select id="gmode">' + gmodeOpts(g.mode | 0) + '</select></label>'
      + '<div class="tiny muted" id="gmodetip" style="margin-top:6px">' + gmodeTip(g.mode | 0) + '</div>'
      + '<label class="f" style="margin-top:8px"><span>整组跑完等待 ms</span><input id="gd" type="number" value="' + (g.d == null ? 100 : g.d) + '"></label>'
      + '</div>';

    h += '<div class="row" style="margin:0 2px 10px"><div class="grow muted">' + acts.length + ' 个子动作'
      + '<div class="tiny" style="margin-top:2px">分组里的动作不参与步号跳转；但里面的「收工 / 重来一轮」照样管用</div></div>'
      + '<button class="btn sm ghost" data-act="addAct">＋ 加动作</button></div>';
    if (!acts.length) {
      h += '<div class="empty"><span class="e">🗂</span>这组分到还没装东西<br>'
        + '<span class="tiny">点「＋ 加动作」往里塞</span></div>';
      return h;
    }
    h += '<div class="list' + (window.innerWidth >= 720 ? ' two' : '') + '">';
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i], t = TYPES[a.t] || { n: a.t, e: '❔' };
      h += '<div class="item"><div class="grip" data-drag="' + i + '" data-list="acts">⋮⋮</div>'
        + '<div class="ic g' + ((i % 6) + 1) + '">' + t.e + '</div>'
        + '<div class="grow" data-act="editAct" data-id="' + s.id + '" data-i="' + i + '">'
        + '<div class="t">' + (i + 1) + '. ' + t.n + (a.repeat > 1 ? '<span class="chip">×' + a.repeat + '</span>' : '') + '</div>'
        + '<div class="d">' + esc(actSummary(a)) + '</div></div>'
        + '<div class="acts">'
        + '<button class="btn sm ghost" data-act="mvUp" data-i="' + i + '">↑</button>'
        + '<button class="btn sm ghost" data-act="mvDn" data-i="' + i + '">↓</button>'
        + '<button class="btn sm ghost" data-act="dupAct" data-i="' + i + '">⧉</button>'
        + '<button class="btn sm ghost" data-act="delAct" data-i="' + i + '">✕</button>'
        + '</div></div>';
    }
    return h + '</div>';
  }

  function gmodeOpts(cur) {
    var o = OPTS.gmode || [], h = '';
    for (var i = 0; i < o.length; i++) {
      h += '<option value="' + esc(o[i][0]) + '"'
        + (String(cur) === String(o[i][0]) ? ' selected' : '') + '>' + esc(o[i][1]) + '</option>';
    }
    return h;
  }

  function gmodeTip(m) {
    if (m === 1) return '⚡ 同时来：能变成手势的（点击 / 长按 / 滑动 / 随机点）会合成一次多指手势一起按下去，'
      + '找色、等待这类没法并行的照常按顺序先跑完。超过系统上限（多数机型 10 个）只发前 10 个。';
    if (m === 2) return '🔀 打乱顺序：每跑一次顺序都不一样，适合刷视频、随机逛这类不希望轨迹太固定的场景。';
    if (m === 3) return '🎲 随机挑一个：每次只跑里面随机一个动作。';
    return '👉 按顺序跑：跟平时一样，从上到下一个个来。';
  }

  function viewEditor(s) {
    if (s.kind === 'js') return viewJsEditor(s);
    S.editId = s.id;                       // 进编辑器就认准这个脚本，动作行上的按钮都靠它定位
    if (S.groupIdx != null) return viewGroup(s, S.groupIdx);
    var acts = s.actions || [];
    var h = '<div class="card"><div class="row">'
      + '<button class="btn sm ghost" data-act="back">‹ 返回</button>'
      + '<div class="ic g' + toneCls(s.tone) + '" data-act="pickIcon" data-id="' + s.id + '" style="width:34px;height:34px;flex:0 0 34px;font-size:16px">' + iconOf(s.icon) + '</div>'
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
      // 分组点进去是「进分组里编辑」，不是弹一个普通表单
      var openAct = a.t === 'group' ? 'editGroup' : 'editAct';
      h += '<div class="item' + (a.t === 'group' ? ' grouped' : '') + '"><div class="grip" data-drag="' + i + '" data-list="acts">⋮⋮</div>'
        + '<div class="ic g' + ((i % 6) + 1) + '">' + t.e + '</div>'
        + '<div class="grow" data-act="' + openAct + '" data-id="' + s.id + '" data-i="' + i + '">'
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
    if (!s) { closeSheet(); return ''; }   // 编辑状态丢了就干脆别开弹层，免得改到别的脚本上去
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
        // v2.6.0：sel:scripts 是动态清单——从脚本列表现取。
        // 排除自己（自调用死循环）和 JS 脚本（当不了子脚本，引擎会拒）
        var opts = optKey === 'scripts'
          ? (S.scripts || []).filter(function (x) { return x.id !== S.editId && x.kind !== 'js'; })
              .map(function (x) { return [x.name, x.name]; })
          : (OPTS[optKey] || []);
        h += '<label class="f"><span>' + label + '</span><select data-field="' + key + '">'
          + '<option value=""' + (!a[key] ? ' selected' : '') + '>（选一个）</option>';
        for (var z = 0; z < opts.length; z++) {
          h += '<option value="' + esc(opts[z][0]) + '"' + (String(a[key]) === String(opts[z][0]) ? ' selected' : '') + '>' + esc(opts[z][1]) + '</option>';
        }
        h += '</select></label>';
        if (optKey === 'tpls') {
          if (!opts.length) h += '<div class="tiny" style="margin:-4px 0 6px">还没有模板图，先去「设置 → 图色模板」截一张存起来。</div>';
          else h += '<button class="btn ghost wide" style="margin:0 0 4px" data-act="goTpl">🖼 管理模板图</button>';
        }
        if (optKey === 'ttpls') {
          if (!opts.length || !opts[0][0]) h += '<div class="tiny" style="margin:-4px 0 6px">还没有字模，先去「我的 → 文字模板」截图框一个字存起来。</div>';
          else h += '<button class="btn ghost wide" style="margin:0 0 4px" data-act="mineGo" data-k="ttpl">🔠 管理文字模板</button>';
        }
        if (optKey === 'scripts' && !opts.length) {
          h += '<div class="tiny" style="margin:-4px 0 6px">还没有别的动作脚本（JS 脚本当不了子脚本），先回脚本页新建一个。</div>';
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
        if (optKey === 'ttpls' && (!opts.length || !opts[0][0])) {
          h += '<div class="tiny" style="margin:-4px 0 6px">还没有字模，先去「我的 → 文字模板」截图框一个字存起来。</div>';
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
    // 运行时变量值（如果脚本正在跑）。v3.0.0：多会话按会话分组（varsList），
    // 单会话 / 老内核走 legacy vars 降级
    var vls = S.st && S.st.varsList;
    if (vls && vls.length > 1) {
      for (var g = 0; g < vls.length; g++) {
        var grp = vls[g];
        var gv = grp.vars || [];
        h += '<div class="sec" style="margin-top:12px">会话 #' + grp.runId + ' · ' + esc(grp.name || '') + '</div>'
          + '<div class="wrap" style="gap:5px">';
        for (var x = 0; x < gv.length; x++) {
          h += '<span class="chip">' + esc(gv[x].k) + ' = ' + esc(gv[x].v === '' ? '空' : gv[x].v) + '</span>';
        }
        h += '</div>';
      }
    } else if (S.st && S.st.vars && S.st.vars.length) {
      var rv = S.st.vars;
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

  /** 主表单用 data-field，条件子页用 data-cfield，两个都得认 */
  function fieldEl(field) {
    return document.querySelector('#sheet [data-field="' + field + '"]')
      || document.querySelector('#sheet [data-cfield="' + field + '"]');
  }

  /** 把 {{...}} 插到输入框当前光标处，不重渲染表单（重渲染会丢掉别的字段改动） */
  function insertVar(field, txt) {
    var inp = fieldEl(field);
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
    var inp = fieldEl(field);
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
    var isBox = mode === 'tpl' || mode === 'ttpl';
    return '<h3>' + (mode === 'ttpl' ? '🔠 框一个字存成文字模板' : isBox ? '🖼 框一块区域存成模板图' : '🎨 点一下取这个点的颜色') + '</h3>'
      + (S.shot ? '' : '<div class="tiny">还没拿到截图</div>')
      + '<div class="pick"><canvas id="sc" width="' + (sc.w || 1080) + '" height="' + (sc.h || 1920) + '"></canvas></div>'
      + '<div class="row" style="margin-top:8px"><div class="grow muted" id="sv">'
      + (isBox ? '点第一下定左上角，再点一下定右下角' : '还没取色') + '</div></div>'
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
      if (mode === 'tpl' || mode === 'ttpl') {
        if (!rect || (rect.x1 != null)) { rect = { x0: x, y0: y, x1: null, y1: null }; }
        else { rect.x1 = x; rect.y1 = y; }
        draw();
        if (rect.x1 != null) {
          var w = rect.x1 - rect.x0, h2 = rect.y1 - rect.y0;
          if (w > 4 && h2 > 4) {
            // v3.1.0 修复：mode 必须带回去——case 'shotTpl' 预先存进 S.pick 的 mode
            // 会在这里被整个覆盖，ttpl 框完弹的是「存成模板图」面板、保存进图色库
            S.pick = { mode: mode, x: rect.x0, y: rect.y0, w: w, h: h2 };
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
      // 从条件子页发起的取色，得回到条件子页而不是动作主表单
      // sub 是条件序号，第一个条件是 0 —— 这里必须用 != null，写成 S.pick.sub 的话 0 是假值会跳回主表单
      sheet(S.pick && S.pick.sub != null ? sheetCondEdit(S.pick.sub) : sheetEditAct(S.editAct));
      var inp = fieldEl(field);
      if (inp) inp.value = c;
      var sw = document.querySelector('#sheet [data-swatch="' + field + '"]');
      if (sw) sw.style.background = c;
      toast('已填入 ' + c + '，记得点保存');
    };
  }

  function sheetTplSave() {
    var p = S.pick || {};
    var isTT = p.mode === 'ttpl';
    return '<h3>' + (isTT ? '存成文字模板' : '存成模板图') + '</h3>'
      + '<label class="f"><span>名字</span><input id="tplName" type="text" placeholder="' + (isTT ? '比如 确认按钮' : '比如 跳过按钮') + '"></label>'
      + '<div class="tiny">区域：' + p.x + ',' + p.y + ' 尺寸 ' + p.w + '×' + p.h + '</div>'
      + '<div class="row" style="margin-top:12px">'
      + '<button class="btn ghost grow" data-act="cancelAct">取消</button>'
      + '<button class="btn ok grow" data-act="' + (isTT ? 'ttplSaveGo' : 'tplSaveGo') + '">保存</button></div>';
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
    // v3.1.0：act 从 pickTpl 改成 shotTpl——原来叫 pickTpl 会撞上模板库入口的事件分发，
    // 「截图框一块存模板」按钮点了走的是 useTemplate，功能实际是坏的
    h += '<button class="btn wide ok" style="margin-top:10px" data-act="shotTpl" data-mode="tpl">' + (S.cap && S.cap.granted ? '📷 截图框一块存模板' : '🔑 先授权截屏') + '</button>';
    return h + '<button class="btn ghost wide" style="margin-top:9px" data-act="cancelAct">关闭</button></div>';
  }

  /** 文字模板库（v3.1.0 伪 OCR）：截图框一个字存成字模，「找文字(图)」动作认它 */
  function loadTextTpls() {
    var arr = [];
    try { arr = JSON.parse(call('listTextTpls') || '[]') || []; } catch (e) { arr = []; }
    OPTS.ttpls = arr.map(function (n) { return [n, n]; });
    if (!OPTS.ttpls.length) OPTS.ttpls = [['', '（还没有文字模板）']];
  }

  function viewTextTpls() {
    loadTextTpls();
    var names = OPTS.ttpls[0][0] ? OPTS.ttpls.map(function (x) { return x[0]; }) : [];
    var h = '<div class="hero"><div class="hi">🔠 文字模板</div>'
      + '<div class="ht">截屏框一个字存下来，脚本里「找文字(图)」就能认屏幕上的这个字</div></div>';
    h += '<div class="card"><div class="sec">字模清单</div>';
    if (!names.length) {
      h += '<div class="muted">还没有字模。点下面截个屏，框住屏幕上的一个字（比如「签到」按钮上的字）存下来。</div>';
    } else {
      for (var i = 0; i < names.length; i++) {
        h += '<div class="kv"><span>🔠 ' + esc(names[i]) + '</span>'
          + '<button class="btn sm ghost" data-act="ttplDel" data-v="' + esc(names[i]) + '">删除</button></div>';
      }
    }
    h += '<button class="btn wide ok" style="margin-top:10px" data-act="shotTpl" data-mode="ttpl">' + (S.cap && S.cap.granted ? '📷 截图框一个字存字模' : '🔑 先授权截屏') + '</button>';
    return h + '<div class="tiny" style="margin-top:10px">字模跟图色模板是分开的两套：「找图」用图色模板，「找文字(图)」和条件「屏幕上有字模」用这里的。多尺度开关打开后，屏幕上的字大一号小一号也能认出来。</div></div>';
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
      // v3.2.0：首启引导层的「我知道了」——只关弹层（guideShown 在弹的当下已记）
      case 'guideDone': closeSheet(); break;
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
      case 'togglePause': ok(call('togglePause')); setTimeout(refreshAll, 200); break;   // v2.5.0 暂停⇄恢复
      // v3.0.0：单会话控制（大卡 runrow 上的按钮）
      case 'pauseRun':
        ok(call('togglePauseRun', String(el.dataset.runid || '')));
        setTimeout(refreshAll, 200);
        break;
      case 'stopRun':
        ok(call('stopRun', String(el.dataset.runid || '')));
        setTimeout(refreshAll, 200);
        break;
      case 'edit': openEditor(id); break;
      case 'back':
        // 在分组里就先退回脚本层，不在才退回脚本列表
        if (S.groupIdx != null) { S.groupIdx = null; render(); break; }
        S.editId = null; render();
        break;
      case 'saveGroup': {
        s = findScript(S.editId);
        var gg = s && s.actions[S.groupIdx];
        if (gg && gg.t === 'group') {
          var nm = document.getElementById('gname');
          var md = document.getElementById('gmode');
          var gd = document.getElementById('gd');
          if (nm) gg.name = nm.value;
          if (md) gg.mode = +md.value;
          if (gd) gg.d = num(gd.value, 100);
          saveScripts();
          toast('分组改好了');
        }
        render();
        break;
      }
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
      // 进子页就顺手拉一次数据：不然日志页要等下一次 1.2s 轮询才更新，
      // 刚切进来那一下看到的是上一次的旧日志
      case 'mineGo': S.tab = 'mine'; S.sub = el.dataset.k; refreshAll(); break;
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
        // 必须深拷贝：def 里的 cs 是数组，浅拷贝会让所有动作共用同一个数组，
        // 于是往里加条件就污染了默认值，下一个新建的动作会带着上一个的条件
        for (var k in TYPES[t].def) na[k] = clone(TYPES[t].def[k]);
        var list = curActs();
        list.push(na);
        saveScripts();
        S.editBackup = { i: list.length - 1, json: null };   // null=新建的，取消就删掉
        sheet(sheetEditAct(list.length - 1));
        break;
      case 'editGroup':
        S.editId = el.dataset.id || S.editId;
        S.groupIdx = +el.dataset.i;      // 进分组里编辑子动作
        render();
        break;
      case 'editAct':
        S.editId = el.dataset.id || S.editId;   // 用按钮上带的脚本 id，别依赖上一次的编辑状态
        S.editBackup = { i: +el.dataset.i, json: JSON.stringify((curActs() || [])[+el.dataset.i] || {}) };
        sheet(sheetEditAct(+el.dataset.i));
        break;
      case 'testAct': ok(call('testAction', JSON.stringify((curActs() || [])[+el.dataset.i]))); break;
      case 'mvUp': {
        var L1 = curActs(); var i1 = +el.dataset.i;
        if (L1 && i1 > 0) { var tmp = L1[i1 - 1]; L1[i1 - 1] = L1[i1]; L1[i1] = tmp; saveScripts(); render(); }
        break;
      }
      case 'mvDn': {
        var L2 = curActs(); var i2 = +el.dataset.i;
        if (L2 && i2 < L2.length - 1) { var t2 = L2[i2 + 1]; L2[i2 + 1] = L2[i2]; L2[i2] = t2; saveScripts(); render(); }
        break;
      }
      case 'dupAct': {
        var L3 = curActs(); var i3 = +el.dataset.i;
        if (L3) { L3.splice(i3 + 1, 0, JSON.parse(JSON.stringify(L3[i3]))); saveScripts(); render(); }
        break;
      }
      case 'delAct': {
        var L4 = curActs();
        if (L4) { L4.splice(+el.dataset.i, 1); saveScripts(); render(); }
        break;
      }
      case 'saveAct': S.editBackup = null; saveAct(+el.dataset.i); break;
      case 'cancelAct':
        // 只有「动作编辑器」的取消才回滚；换图标/分享码这类弹层的取消不动数据
        if (S.editAct != null && S.editBackup) { revertAct(); render(); }
        S.editBackup = null;
        S.editAct = null; S.pick = null; S.condSub = null; closeSheet();
        break;
      case 'pickPoint': picked = null; sheet(sheetPickPoint(+el.dataset.i)); bindCanvas(); break;
      case 'usePoint':
        if (!picked) { toast('先在图上点一下'); return; }
        var a2 = (curActs() || [])[+el.dataset.i] || {};
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
      case 'saveCond': S.editBackup = null; saveCond(+el.dataset.i); break;
      case 'pickColor':
        // 条件子页里发起的取色要记下标，取完回到子页（否则会跳回动作主表单）
        S.pick = {
          field: el.dataset.fieldFor, mode: 'color',
          sub: S.condSub == null ? null : S.condSub
        };
        if (!S.shot && !loadShot()) break;
        sheet(shotPanel('color')); bindShotCanvas('color');
        break;
      // v3.1.0：原 case 'pickTpl' 改名 shotTpl——它跟模板库入口的 pickTpl（useTemplate）
      // 在同一个 switch 里撞名，这个分支从来执行不到，「截图框一块存模板」一直是坏的
      case 'shotTpl':
        var shotMode = el.dataset.mode === 'ttpl' ? 'ttpl' : 'tpl';
        S.pick = { mode: shotMode };
        if (!loadShot()) break;
        sheet(shotPanel(shotMode)); bindShotCanvas(shotMode);
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
      case 'ttplSaveGo':
        var tnm = (document.getElementById('tplName') || {}).value || '';
        tnm = tnm.trim();
        if (!tnm) { toast('起个名字'); break; }
        var tpr = S.pick || {};
        ok(call('saveTextTpl', JSON.stringify({ name: tnm, x: tpr.x, y: tpr.y, w: tpr.w, h: tpr.h })));
        closeSheet(); refreshAll();
        S.sub = 'ttpl'; render();   // 回到字模子页，列表要是新的
        break;
      case 'ttplDel':
        ok(call('delTextTpl', el.dataset.v));
        refreshAll();
        S.sub = 'ttpl'; render();   // 字模库是「我的」子页，删完留在本页
        break;
      case 'tplDel': ok(call('delTpl', el.dataset.v)); refreshAll(); sheet(viewTpls()); break;
      case 'logRefresh': refreshAll(); break;
      case 'logFilter':
        S.logMin = (S.logMin || 0) ? 0 : 1;
        render();
        break;
      case 'logClear':
        ok(call('clearLogs'));
        refreshAll();
        toast('日志已清空');
        break;
      case 'logCopy': {
        var ls = (S.st && S.st.log) || [];
        if (!ls.length) { toast('还没有日志可复制'); break; }
        var txt = ls.map(function (l) {
          return ((l && l.c) ? l.c + '  ' : '') + logText(l);
        }).join('\n');
        ok(call('copyText', txt));
        toast('日志已复制（' + ls.length + ' 条）');
        break;
      }
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
      case 'goTrig': S.tab = 'mine'; S.sub = 'trig'; refreshAll(); break;
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
    // 分组内页选跑法时，下面的说明要跟着换
    if (el.id === 'gmode') {
      var tip = document.getElementById('gmodetip');
      if (tip) tip.textContent = gmodeTip(+el.value);
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
    // v2.4.0：id / desc / re 一律按文本存。上面 kind 标了 'text' 其实已经接住了，
    // 这里再补一道是防以后有人手滑删掉 kind —— 被当成数字的话 desc 填 3.0 会存成 3
    // v2.6.0：args（子脚本传参 JSON）同理，{"n":1} 不能被转成别的
    return key === 's' || key === 'p' || key === 'id' || key === 'desc' || key === 're' || key === 'args';
  }

  function saveAct(i) {
    var list = curActs();
    if (!list) return;
    var a = list[i];
    var fields = document.querySelectorAll('#sheet [data-field]');
    for (var q = 0; q < fields.length; q++) {
      var f = fields[q], k = f.dataset.field;
      if (f.classList.contains('switch')) { a[k] = swVal(k, f.classList.contains('on')); continue; }
      if (f.tagName === 'SELECT') { a[k] = (k === 'mode') ? +f.value : f.value; continue; }  // 跑法是数字
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

  /**
   * 取消动作编辑：还原成进编辑器之前的样子。
   * 新建的动作直接删掉；编辑已有的用快照覆盖回去。
   */
  function revertAct() {
    var b = S.editBackup;
    S.editBackup = null;
    if (!b) return;
    var s = findScript(S.editId);
    if (!s || !s.actions) return;
    if (b.json == null) {                       // 新建的
      if (b.i >= 0 && b.i < s.actions.length) s.actions.splice(b.i, 1);
    } else {                                    // 编辑已有的
      if (b.i >= 0 && b.i < s.actions.length) s.actions[b.i] = JSON.parse(b.json);
    }
    saveScripts();
  }

  // ---------- 条件动作的增删改（v2.0.0） ----------

  /** 把主表单上的改动收进动作 a（只收 data-field 里的那几个） */
  function syncCondAct(a) {
    var fs = document.querySelectorAll('#sheet [data-field]');
    for (var q = 0; q < fs.length; q++) {
      var f = fs[q], k = f.dataset.field;
      if (f.classList.contains('switch')) { a[k] = swVal(k, f.classList.contains('on')); continue; }
      if (k === 'mode') { a.mode = +f.value; continue; }
      var n = num(f.value, NaN);
      a[k] = isNaN(n) ? f.value : n;
    }
  }

  /**
   * 加一个条件：把主表单改动先收好，再往清单里塞一个新的。
   * 注意这里**不落盘**——中间步骤一落盘，用户点「取消」就撤不回来了，
   * 只有最后点「保存」（saveCond）才真正写进脚本。
   */
  function condAdd(k) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a) return;
    syncCondAct(a);
    if (!a.cs) a.cs = [];
    var ct = CTYPES[k] || CTYPES.always;
    var c = { k: k };
    for (var key in ct.def) if (Object.prototype.hasOwnProperty.call(ct.def, key)) c[key] = clone(ct.def[key]);
    a.cs.push(c);
    sheet(sheetEditAct(S.editAct));   // 就地重画，回到主表单
    toast('加了一个条件：' + ct.n + '（别忘了点保存）');
  }

  function condDel(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a || !a.cs) return;
    syncCondAct(a);
    a.cs.splice(j, 1);
    sheet(sheetEditAct(S.editAct));
  }

  function condEdit(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a) return;
    syncCondAct(a);          // 先收主表单，否则从子页返回时改动会丢
    S.condSub = j;
    var h = sheetCondEdit(j);
    if (h) sheet(h);
  }

  function condEditBack() {
    S.condSub = null;
    sheet(sheetEditAct(S.editAct));
  }

  /** 子页里点「确定」：把 data-cfield 收进 a.cs[j]，同样不落盘 */
  function condEditSave(j) {
    var s = findScript(S.editId);
    var a = s && s.actions[S.editAct];
    if (!a || !a.cs || !a.cs[j]) return;
    var c = a.cs[j];
    var fs = document.querySelectorAll('#sheet [data-cfield]');
    for (var q = 0; q < fs.length; q++) {
      var f = fs[q], k = f.dataset.cfield;
      if (f.classList.contains('switch')) { c[k] = swVal(k, f.classList.contains('on')); continue; }
      var raw = f.value;
      // v2.4.0：id / desc / re 必须在这个白名单里，不能靠下面 isNaN → raw 那条兜底。
      // id 填 2131427456 会被 num() 转成数字，java 侧 optString 再读回来就串了味
      if (k === 'v' || k === 's' || k === 'c' || k === 'tpl' || k === 'id' || k === 'desc' || k === 're') { c[k] = raw; continue; }   // 可能填 {{变量}}
      var n = num(raw, NaN);
      c[k] = isNaN(n) ? raw : n;
    }
    S.condSub = null;
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
    loadTextTpls();   // v3.1.0：文字模板下拉同批就绪，findText/ttext 表单要用
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
    else if (type === 'log' && S.tab === 'mine' && S.sub === 'log') refreshAll();
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
    // v3.2.0：首启强引导——权限没给齐（含无障碍假死）且没弹过，自动弹一次。
    // 弹的当下就记 guideShown（点遮罩关掉也不会每次启动都打扰），之后靠主卡常驻引导兜底
    var st = S.st || {};
    var broken = !st.acc || !st.overlay || (st.acc && st.linked === false);
    if (S.st && S.prefs && !S.prefs.guideShown && broken) {
      call('savePrefs', JSON.stringify({ guideShown: true }));
      sheet(permGuideSheet());
    }
    setInterval(function () {
      if (S.tab === 'mine' && S.sub === 'log') refreshAll();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
