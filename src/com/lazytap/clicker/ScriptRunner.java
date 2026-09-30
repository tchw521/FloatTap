package com.lazytap.clicker;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 脚本执行引擎：串行、可中断、零反射。
 * 所有手势都走 AccessibilityService#dispatchGesture，不注入事件、不 root，
 * 因此只占用一个后台线程 + 少量对象，内存开销可以忽略。
 */
public final class ScriptRunner {

    public interface Listener {
        void on(String type, String data);
    }

    private static volatile ScriptRunner instance;

    private final HandlerThread thread = new HandlerThread("lazytap-run");
    private Handler h;
    private final Random rnd = new Random();
    // 引擎线程在写（log），界面/WebView 桥线程在读（JsApi 拼状态 JSON）——
    // 用并发容器，否则遍历时增删会 ConcurrentModificationException，
    // 异常被上层吞掉后整个状态面板会缺一块
    private final List<LogLine> logs = new CopyOnWriteArrayList<>();

    /** v2.5.0：运行三态（停止/运行/暂停）。以前是 volatile boolean running，暂停做不了 */
    private final RunState rs = new RunState();
    private volatile String currentId = "";
    /** v2.2.0：运行浮层与日志面板要显示「第几步 / 共几步」，这两个值给外部读 */
    private volatile int progCur, progTotal;
    /** JS 模式用的循环设置：-1=一直跑，其余为轮数；jsDelayMs 是开跑前的等待 */
    private volatile int jsLoops = 1, jsDelayMs;
    private volatile long runStartAt;
    private boolean jitter;
    private int repeatLeft;
    private volatile int loopLeft;
    private JSONArray actions;
    private int index;
    private JSONObject script;
    private Listener listener;
    private long loopStart;
    private final java.util.HashMap<String, Integer> counters = new java.util.HashMap<>();
    /** 最近一次图色命中的坐标，形如 "x,y"，供后续动作引用 */
    private final java.util.HashMap<String, String> hits = new java.util.HashMap<>();
    /** 脚本变量：每次开跑从脚本初值重置，任何动作字段都能写 {{变量}} */
    private final Vars vars = new Vars();
    /** v2.0.0 多条件系统：同一轮里多个图色条件共用一张截图 */
    private Bitmap shotBmp;
    private long shotAt;

    ScriptRunner() {
        thread.start();
        h = new Handler(thread.getLooper());
    }

    public static ScriptRunner get() {
        if (instance == null) {
            synchronized (ScriptRunner.class) {
                if (instance == null) instance = new ScriptRunner();
            }
        }
        return instance;
    }

    public void setListener(Listener l) {
        this.listener = l;
    }

    public boolean isRunning() {
        return rs.isRunning();
    }

    /** v2.5.0：暂停中。暂停时悬浮球、日志面板、磁贴都要能看出来 */
    public boolean isPaused() {
        return rs.isPaused();
    }

    /** v2.5.0：有事在做（跑着或暂停都算）。外部「要不要停/要不要显示」一律用它 */
    public boolean isBusy() {
        return rs.isBusy();
    }

    public String currentId() {
        return currentId;
    }

    public List<LogLine> logs() {
        return logs;
    }

    /** 面板展示用：只取最后 n 行，转成 JSON 对象（带时间戳和级别） */
    public JSONArray logsJson(int n) {
        JSONArray a = new JSONArray();
        int start = Math.max(0, logs.size() - Math.max(1, n));
        for (int i = start; i < logs.size(); i++) a.put(logs.get(i).json());
        return a;
    }

    /** 日志面板的「清空」按钮 */
    public void clearLogs() {
        logs.clear();
        if (listener != null) listener.on("log", "");
    }

    private void log(String s) {
        log(s, LogLine.INFO);
    }

    private void logW(String s) {
        log(s, LogLine.WARN);
    }

    private void logE(String s) {
        log(s, LogLine.ERR);
    }

    private void log(String s, int lv) {
        if (s == null) return;
        logs.add(new LogLine(s, lv));
        while (logs.size() > LogLine.CAP) logs.remove(0);
        if (listener != null) listener.on("log", s);
    }

    /** 给外部（服务 / 悬浮球）往日志页里写一句话 */
    public void note(String s) {
        log(s);
    }

    /** 给外部写一句警示（日志面板标黄） */
    public void warn(String s) {
        logW(s);
    }

    private void status(String s, String extra) {
        if (listener != null) listener.on("status", s + "|" + currentId + "|" + extra);
    }

    // ---------- v2.2.0：运行浮层要读的进度 ----------

    /** JS 脚本该跑几轮（-1 = 一直跑） */
    public int jsLoops() {
        return jsLoops;
    }

    /** JS 脚本开跑前该等多少毫秒 */
    public int jsDelayMs() {
        return jsDelayMs;
    }

    public boolean hasProgress() {
        return progTotal > 0;
    }

    public int progressCur() {
        return progCur;
    }

    public int progressTotal() {
        return progTotal;
    }

    /** 这一轮跑了多少毫秒，浮层上显示「已跑 12s」 */
    public long elapsed() {
        return runStartAt <= 0 ? 0 : System.currentTimeMillis() - runStartAt;
    }

    public String currentName() {
        return script == null ? "" : script.optString("name", "未命名");
    }

    public boolean start(JSONObject sc) {
        if (sc == null) return false;
        AccessibilityService svc = TapService.get();
        if (svc == null) {
            logE("无障碍服务没开，跑不动");
            return false;
        }
        stop();
        script = sc;
        currentId = sc.optString("id");
        actions = sc.optJSONArray("actions");
        if (actions == null || actions.length() == 0) {
            logE("脚本是空的，加两步再来");
            return false;
        }
        jitter = on(sc, "jitter", false);
        int loops = sc.optInt("loopCount", 1);
        boolean forever = on(sc, "loop", false);
        loopLeft = forever ? -1 : Math.max(1, loops);
        rs.start();
        index = 0;
        repeatLeft = 0;
        counters.clear();
        hits.clear();
        vars.load(sc.optJSONArray("vars"));   // 变量每次开跑都从脚本里的初值开始
        vars.loop = 1;                        // {{loop}} 从第一轮开始数
        vars.cnt = counters;                  // 让 {{cnt.名字}} 能读到计数器的值
        vars.hit = hits;                  // 让 {{hit.colorX}} {{hit.imageY}} 能分别引用找色/找图的落点
        TapService ts = TapService.get();
        vars.screenW = ts != null ? ts.screenW() : 0;
        vars.screenH = ts != null ? ts.screenH() : 0;
        ScriptStore.touchRun(sc);
        Prefs.put("lastScript", currentId);
        log("开跑：" + sc.optString("name", "未命名"));
        status("running", sc.optString("name", ""));
        loopStart = System.currentTimeMillis();
        runStartAt = loopStart;
        progTotal = actions.length();
        progCur = 0;
        int delay = sc.optInt("startDelay", 0); // 开始前先等几秒，方便切到目标 App
        if (delay > 0) {
            log("先等 " + delay + " 秒，你快切过去");
            h.postDelayed(this::step, delay * 1000L);
        } else {
            h.post(this::step);
        }
        return true;
    }

    public void stop() {
        boolean was = rs.isBusy();   // 暂停里也能急停，都算「有东西在跑」
        rs.stop();                   // 停了要叫醒挂着的 gate/sleep，不然线程吊死
        repeatLeft = 0;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (was) log("停下了");   // 手动刹车也要留痕，不然日志里看不出是自己停的还是跑完的
        if (listener != null && !currentId.isEmpty()) status("stopped", "");
        currentId = "";
        progCur = 0;
        progTotal = 0;
        runStartAt = 0;
        // 截图缓存别跨脚本留着：那是一整张屏幕的 Bitmap（十几 MB），
        // 这里只丢引用不 recycle —— 它可能正是 Capture.last()，界面预览还在用
        shotBmp = null;
        shotAt = 0;
    }

    /** v2.5.0：暂停。跑到哪一步记住哪一步，恢复从断点继续；JS 模式不做暂停 */
    public void pause() {
        if (jsMode) {
            log("JS 脚本暂不支持暂停，要停就按停止");
            return;
        }
        if (rs.pause()) {
            log("暂停了（音量键短按或点「▶ 恢复」继续）");
            status("paused", "");
        }
    }

    /** v2.5.0：恢复。把 step 循环从挂起里放出来 */
    public void resume() {
        if (rs.resume()) {
            log("继续跑");
            status("running", "resume");
        }
    }

    /** v2.5.0：暂停⇄恢复一键切换（音量键短按和浮层按钮都走这里） */
    public void togglePause() {
        if (rs.isPaused()) resume();
        else pause();
    }

    private float speed() {
        return Timing.speed(Prefs.getFloat("speed", 1f));
    }

    private long delayAfter(JSONObject a) {
        return Timing.delayAfter(a, speed(), jitter, rnd);   // 计算挪到 Timing，好单测
    }

    private void step() {
        // v2.5.0：只有真停了才收工。暂停不能在这里 return——那是把循环掐死，
        // 恢复就没人接了；要挂在这等，恢复后从当前这步原样继续。
        if (rs.isStopped()) return;
        rs.gate();
        progTotal = actions.length();
        if (index >= actions.length()) {
            if (loopLeft == -1 || loopLeft > 1) {
                if (loopLeft > 1) loopLeft--;
                index = 0;
                progCur = 0;
                vars.loop++;                 // {{loop}} 跟着轮次走
                log("第 " + ((System.currentTimeMillis() - loopStart) / 1000 + 1) + " 秒：再来一轮");
                h.postDelayed(this::step, Math.max(50, (long) (300 * speed())));
                return;
            }
            rs.stop();
            progCur = progTotal;
            log("跑完收工，手指保住了");
            status("stopped", "done");
            return;
        }
        progCur = Math.min(index + 1, progTotal);   // 运行浮层读它显示「第几步」
        JSONObject raw = actions.optJSONObject(index);
        if (raw == null) {
            index++;
            h.post(this::step);
            return;
        }
        vars.step = index + 1;       // {{step}} 从 1 开始
        JSONObject a = vars.bind(raw);   // 把字段里的 {{}} 换成求值结果
        int rep = Math.max(1, a.optInt("repeat", 1));
        if (repeatLeft <= 0) repeatLeft = rep;
        repeatLeft--;
        index++;                     // 先前进，跳转按“第几步”算更直观
        if (repeatLeft > 0) index--; // 还没重复完，退回原地再来一次
        long wait = delayAfter(a);
        int jump = 0;
        try {
            jump = exec(a);
        } catch (Throwable t) {
            logE("动作出错：" + t.getMessage());
        }
        if (jump == JUMP_END) {          // 直接收工
            rs.stop();
            log("按剧本收工");
            status("stopped", "done");
            return;
        }
        if (jump == JUMP_LOOP) {         // 立刻重来一轮
            index = 0;
            repeatLeft = 0;
            if (loopLeft > 1) loopLeft--;
            h.postDelayed(this::step, Math.max(50, (long) (300 * speed())));
            return;
        }
        if (jump > 0) {
            index = jump - 1;            // 跳到第 N 步（1 起）
            repeatLeft = 0;              // 跳走就把上一步没做完的重复次数清掉，否则目标步会被莫名重复
        }
        if (index < 0) index = 0;
        h.postDelayed(this::step, Math.max(16, wait));
    }

    // ---------- 动作分组 ----------
    // 分组把一批动作装到一起，可以指定怎么跑：顺序 / 同时 / 乱序 / 随机挑一个。
    // 子动作里的跳转（go/els）只在分组内没意义，直接忽略；但「收工」「重来一轮」
    // 这两种是要往上传的，不然分组里的停止条件就失效了。

    private static final int G_SEQ = 0, G_ALL = 1, G_SHUFFLE = 2, G_ANY = 3;

    private int execGroup(TapService svc, JSONObject a) {
        JSONArray acts = a.optJSONArray("acts");
        if (acts == null || acts.length() == 0) {
            logW("这个分组是空的，跳过");
            return 0;
        }
        int mode = a.optInt("mode", G_SEQ);
        String name = a.optString("name", "");
        String tag = name.isEmpty() ? "" : "「" + name + "」";

        switch (mode) {
            case G_ALL:
                log("分组" + tag + "：同时来（" + acts.length() + " 个）");
                return execGroupTogether(svc, acts);
            case G_SHUFFLE:
                log("分组" + tag + "：打乱顺序跑（" + acts.length() + " 个）");
                return execGroupSeq(svc, shuffled(acts));
            case G_ANY: {
                int k = rnd.nextInt(acts.length());
                JSONObject one = acts.optJSONObject(k);
                log("分组" + tag + "：随机挑了第 " + (k + 1) + " 个来跑");
                return one == null ? 0 : runSub(svc, one);
            }
            default:
                log("分组" + tag + "：按顺序跑（" + acts.length() + " 个）");
                return execGroupSeq(svc, acts);
        }
    }

    private int execGroupSeq(TapService svc, JSONArray acts) {
        for (int i = 0; i < acts.length(); i++) {
            rs.gate();                                  // 暂停挂起，恢复从当前子步继续
            if (!rs.isRunning()) return 0;
            JSONObject sub = acts.optJSONObject(i);
            int j = runSub(svc, sub);
            if (j == JUMP_END || j == JUMP_LOOP) return j;   // 只有这两种要往上传
        }
        return 0;
    }

    /**
     * 「同时」：手势类的动作合成一次多指手势派出去，其余（找色、等待、赋值…）
     * 按原顺序先跑完——它们本来就没法并行。
     */
    private int execGroupTogether(TapService svc, JSONArray acts) {
        List<Path> paths = new ArrayList<>();
        for (int i = 0; i < acts.length(); i++) {
            rs.gate();
            if (!rs.isRunning()) return 0;
            JSONObject sub = acts.optJSONObject(i);
            if (sub == null) continue;
            Path p = pathOf(svc, sub);
            if (p != null) {
                paths.add(p);
                continue;
            }
            int j = runSub(svc, sub);          // 不是手势，照常跑
            if (j == JUMP_END || j == JUMP_LOOP) return j;
        }
        if (paths.isEmpty()) return 0;
        int max = TapService.maxStrokes();
        if (paths.size() > max) {
            logW("同时派的手势有 " + paths.size() + " 条，超过系统上限 " + max + " 条，只发前 " + max + " 条");
            paths = paths.subList(0, max);
        }
        long ms = 0;
        for (int i = 0; i < acts.length(); i++) {
            long d = acts.optJSONObject(i) == null ? 0 : acts.optJSONObject(i).optLong("ms", 0);
            if (d > ms) ms = d;
        }
        int n = svc.strokes(paths, ms < 60 ? 80 : ms);
        log("同时派发 " + n + " 条手势");
        return 0;
    }

    /** 跑一个子动作，把异常兜住——分组里一个动作出错不该把整条脚本带走 */
    private int runSub(TapService svc, JSONObject sub) {
        if (sub == null) return 0;
        try {
            JSONObject b = vars.bind(sub);
            // 分组里没有 step() 那一步「动作间隔」，等待得自己来，否则 wait 在分组内等于没写
            if ("wait".equals(b.optString("t", ""))) {
                groupWait(b);
                return 0;
            }
            return exec(b);
        } catch (Throwable t) {
            logE("分组里的动作出错：" + t.getMessage());
            return 0;
        }
    }

    /**
     * 分组内的等待：只能同步睡，因为子动作是串行循环跑的。
     * 这里卡上限 5 秒——睡在无障碍回调线程上，太久会被系统当成服务无响应。
     * v2.5.0：换成 rs.sleep，暂停能立刻挂起（时长不吃掉）、急停 100ms 内响应，
     * 不再是 v2.3.0 注释里那个「点停止要等睡醒」的坑。
     */
    private void groupWait(JSONObject a) {
        if (Timing.groupClamped(a, speed())) {
            logW("分组里的等待最长 " + Timing.GROUP_WAIT_CAP + "ms，你要的被缩短了");
        }
        long ms = Timing.groupWait(a, speed());
        if (ms <= 0) return;
        log("在分组里等 " + ms + "ms");
        rs.sleep(ms);   // 返回 false（被急停）也无所谓，下一个检查点自然退出
    }

    /** 手势类动作能不能转成一条路径；不能（比如找色、等待）就返回 null */
    private Path pathOf(TapService svc, JSONObject a) {
        if (a == null) return null;
        String t = a.optString("t", "");
        boolean pct = pctOn(a);
        float w = svc.screenW(), h = svc.screenH();
        Path p = new Path();
        if ("click".equals(t) || "long".equals(t) || "random".equals(t)) {
            float x = (float) a.optDouble("x", 0), y = (float) a.optDouble("y", 0);
            if (pct) { x = x / 100f * w; y = y / 100f * h; }
            if ("random".equals(t)) {
                float r = (float) a.optDouble("r", 10);
                if (pct) r = r / 100f * w;
                x += (rnd.nextFloat() * 2 - 1) * r;
                y += (rnd.nextFloat() * 2 - 1) * r;
            }
            p.moveTo(x, y);
            return p;
        }
        if ("swipe".equals(t)) {
            float x1 = (float) a.optDouble("x1", 0), y1 = (float) a.optDouble("y1", 0);
            float x2 = (float) a.optDouble("x2", 0), y2 = (float) a.optDouble("y2", 0);
            if (pct) {
                x1 = x1 / 100f * w; y1 = y1 / 100f * h;
                x2 = x2 / 100f * w; y2 = y2 / 100f * h;
            }
            p.moveTo(x1, y1);
            p.lineTo(x2, y2);
            return p;
        }
        return null;
    }

    /** 打乱一个数组（Fisher-Yates），返回新数组，不动原来的 */
    private JSONArray shuffled(JSONArray src) {
        JSONArray out = new JSONArray();
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < src.length(); i++) list.add(src.optJSONObject(i));
        for (int i = list.size() - 1; i > 0; i--) {
            int j = rnd.nextInt(i + 1);
            JSONObject tmp = list.get(i);
            list.set(i, list.get(j));
            list.set(j, tmp);
        }
        for (JSONObject o : list) out.put(o);
        return out;
    }

    /** 返回值：0 继续下一步；>0 跳到第 N 步；-1 结束；-2 立刻重来一轮 */
    private static final int JUMP_END = -1;
    private static final int JUMP_LOOP = -2;

    private int exec(JSONObject a) {
        TapService svc = TapService.get();
        if (svc == null) {
            rs.stop();
            return JUMP_END;
        }
        String t = a.optString("t", "click");
        switch (t) {
            case "if":
                return execIf(svc, a);
            case "cond":
                return execCond(svc, a);
            case "group":
                return execGroup(svc, a);
            case "set":
                return execSet(a);
            case "math":
                return execMath(a);
            case "cmpVar":
                return execCmpVar(a);
            case "count":
                return execCount(a);
            case "cmpColor":
                return execCmpColor(svc, a);
            case "findColor":
                return execFindColor(svc, a);
            case "findImage":
                return execFindImage(svc, a);
            case "multi": {
                String mode = a.optString("m", "twoTap");
                float cx = (float) a.optDouble("x", 0);
                float cy = (float) a.optDouble("y", 0);
                float r = (float) a.optDouble("r", 80);
                if (pctOn(a)) {
                    cx = cx / 100f * svc.screenW();
                    cy = cy / 100f * svc.screenH();
                    r = r / 100f * svc.screenW();
                }
                svc.multi(mode, cx, cy, r, a.optLong("ms", 400));
                log("多指 " + MULTI_NAME(mode));
                break;
            }
            case "click":
            case "double":
            case "long":
            case "random": {
                float x = (float) a.optDouble("x", 0);
                float y = (float) a.optDouble("y", 0);
                if (pctOn(a)) { // 百分比坐标，换机型不跑偏
                    x = x / 100f * svc.screenW();
                    y = y / 100f * svc.screenH();
                }
                if (t.equals("random")) {
                    float r = (float) a.optDouble("r", 10);
                    x += (rnd.nextFloat() - 0.5f) * 2 * r;
                    y += (rnd.nextFloat() - 0.5f) * 2 * r;
                }
                if (t.equals("click") || t.equals("random")) {
                    svc.tap(x, y, 60);
                    log("戳 (" + (int) x + "," + (int) y + ")");
                } else if (t.equals("double")) {
                    final float fx = x, fy = y;
                    svc.tap(fx, fy, 60);
                    h.postDelayed(() -> {
                        rs.gate();               // 暂停卡在两击之间：恢复后把第二击补上
                        if (rs.isStopped()) return;
                        TapService s2 = TapService.get();
                        if (s2 != null) s2.tap(fx, fy, 60);
                    }, 110);
                    log("戳戳 (" + (int) x + "," + (int) y + ")");
                } else {
                    long ms = a.optLong("ms", 800);
                    svc.tap(x, y, ms);
                    log("按住不放 " + ms + "ms");
                }
                return 0;
            }
            case "swipe": {
                float x1 = (float) a.optDouble("x1", 0), y1 = (float) a.optDouble("y1", 0);
                float x2 = (float) a.optDouble("x2", 0), y2 = (float) a.optDouble("y2", 0);
                if (pctOn(a)) {
                    x1 = x1 / 100f * svc.screenW();
                    x2 = x2 / 100f * svc.screenW();
                    y1 = y1 / 100f * svc.screenH();
                    y2 = y2 / 100f * svc.screenH();
                }
                long ms = a.optLong("ms", 400);
                svc.swipe(x1, y1, x2, y2, ms);
                log("滑 (" + (int) x1 + "," + (int) y1 + ")→(" + (int) x2 + "," + (int) y2 + ")");
                return 0;
            }
            case "wait": {
                // 真正的时间由 step() 里的 delayAfter 撑着（见那里的 wait 特判）
                log("等 " + a.optLong("ms", 1000) + "ms");
                return 0;
            }
            case "key": {
                String k = a.optString("k", "back");
                if (svc.globalAction(k)) log("按了 " + k);
                else logW("按不了 " + k + "：" + TapService.keyHint(k));
                return 0;
            }
            case "text": {
                String s = a.optString("s", "");
                svc.inputText(s);
                log("输入：" + s);
                return 0;
            }
            case "launch": {
                svc.launch(a.optString("p", ""));
                log("打开 " + a.optString("p", ""));
                return 0;
            }
            case "find": {
                String text = a.optString("s", "");
                // v2.4.0：这三个新条件读出来交给 NodeMatch 组合（四路取「且」）。
                // 必须在这里用 a.optString 显式读 —— 把 JSONObject 整个传下去的话，
                // tools/test/F.java 的字段对账就扫不到，会当成「表单能填、引擎不读」。
                String desc = a.optString("desc", "");
                String id = a.optString("id", "");
                String re = a.optString("re", "");
                boolean contains = on(a, "contains", true);
                boolean clickableOnly = on(a, "clickable", false);
                boolean doClick = on(a, "click", true);
                int nth = a.optInt("index", 1);
                long timeout = a.optLong("timeout", 3000);
                NodeMatch q = NodeMatch.of(text, desc, id, re, contains);
                if (q.badRe()) logW("正则写错了：「" + re + "」，这一条按找不到处理");
                AccessibilityNodeInfo node = svc.findNode(q, clickableOnly, nth);
                if (node == null && timeout > 0) {
                    // v2.3.0：以前这里是「等 min(timeout,2000) 后再试一次」——
                    // 填 10 秒只等 2 秒，而且只试第二次就放弃了，典型的静默失效。
                    // 现在改成在 timeout 内真轮询，找到就收手。
                    logW("没找到 " + q.describe() + "，最多再等 " + timeout + "ms");
                    node = waitFind(svc, q, clickableOnly, nth, timeout);
                }
                if (node != null) {
                    Rect r = new Rect();
                    node.getBoundsInScreen(r);
                    log("找到 " + q.describe() + " @" + r.centerX() + "," + r.centerY());
                    if (doClick) svc.tap(r.centerX(), r.centerY(), 60);
                    node.recycle();
                } else {
                    logW("没找到 " + q.describe() + "，跳过");
                    if (script != null && on(script, "stopOnFail", false)) {
                        rs.stop();
                        logE("按剧本：找不到就收工");
                        status("stopped", "fail");
                        return JUMP_END;
                    }
                }
                return 0;
            }
            default:
                logE("未知动作 " + t);
        }
        return 0;
    }

    /**
     * 在 timeout 内反复找同一个节点，找到就返回（调用方负责点它和 recycle）。
     * 每片都过一次暂停闸口和停止检查，所以「暂停」「停止」最多延迟一片（250ms）生效——
     * 比原来那种 postDelayed 一次就不管了的做法可控得多。
     */
    private AccessibilityNodeInfo waitFind(TapService svc, NodeMatch q,
                                           boolean clickableOnly, int nth, long timeout) {
        return pollUntil(deadlineOf(timeout), "找节点", () -> svc.findNode(q, clickableOnly, nth));
    }

    /** 把「最多等多久」换算成绝对截止时刻，顺手夹一下上限 */
    private long deadlineOf(long timeout) {
        if (Timing.clamped(timeout)) {
            logW("最多等 60 秒就够了，你填的 " + timeout + "ms 被夹住了");
        }
        return Timing.deadline(timeout);
    }

    /** 一次探测；返回非 null 算命中 */
    private interface Probe<T> {
        T get() throws Throwable;
    }

    /**
     * 每隔 FIND_SLICE 探一次，直到命中或超时。每片开头都过一次暂停闸口和停止检查，
     * 所以「暂停」「停止」最多延迟一片（250ms）生效；探测抛异常就收手，免得日志刷屏。
     */
    private <T> T pollUntil(long deadline, String what, Probe<T> p) {
        while (true) {
            rs.gate();                       // 暂停挂起，恢复后接着探（deadline 是墙钟，暂停久了可能一恢复就超时）
            if (rs.isStopped()) return null;
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) return null;
            rs.sleep(Math.min(Timing.FIND_SLICE, left));   // 急停会在片内提前醒
            if (!rs.isRunning()) return null;
            try {
                T r = p.get();
                if (r != null) return r;
            } catch (Throwable t) {
                logE(what + "出错：" + t.getMessage());
                return null;
            }
        }
    }

    private static String MULTI_NAME(String m) {
        if ("pinch".equals(m)) return "双指捏合";
        if ("spread".equals(m)) return "双指张开";
        if ("twoLong".equals(m)) return "双指按住";
        return "双指齐点";
    }

    /** 条件判断：找到/没找到 各跳一步；0 表示顺着走 */
    private int execIf(TapService svc, JSONObject a) {
        String mode = a.optString("m", "text");
        boolean hit;
        if ("pkg".equals(mode)) {
            String want = a.optString("p", "");
            String cur = svc.topPkg();
            hit = !want.isEmpty() && cur != null && (cur.equals(want) || cur.contains(want));
            log("当前应用 " + cur + (hit ? " ✓对上" : " ✗不是"));
        } else {
            String text = a.optString("s", "");
            String desc = a.optString("desc", "");   // v2.4.0
            String id = a.optString("id", "");       // v2.4.0
            String re = a.optString("re", "");       // v2.4.0
            boolean contains = on(a, "contains", true);
            boolean clickableOnly = on(a, "clickable", false);
            int nth = a.optInt("index", 1);
            NodeMatch q = NodeMatch.of(text, desc, id, re, contains);
            if (q.badRe()) logW("正则写错了：「" + re + "」，这一条按找不到处理");
            AccessibilityNodeInfo node = svc.findNode(q, clickableOnly, nth);
            hit = node != null;
            if (node != null) node.recycle();
            log((hit ? "✓ 有" : "✗ 没") + q.describe());
        }
        int go = hit ? a.optInt("go", 0) : a.optInt("els", 0);
        if (go == -1) go = JUMP_END;
        else if (go == -2) go = JUMP_LOOP;
        return go;
    }

    // ---------- 多条件系统（v2.0.0） ----------
    //
    // 与旧版 go/els 绝对步号跳转并联共存：老脚本原样能跑。
    // 结构：{ t:"cond", mode:"and|or|count", n:N, cs:[ {k:...}, ... ],
    //         rep:0/1, repGap:ms, repMax:N, go:第几步, els:第几步, d:ms }
    // 条件 k 取值：text 屏上有字 / pkg 当前是某 App / color 有颜色 / image 有图 / time 在时间点之后 / rand 随机数 / expr 表达式 / always 恒真

    private static final int C_MAX_MS = 20000;   // 单次等待上限：写个 99999 也不至于睡死
    private static final int C_MAX_ROUND = 1000; // 重复检查的轮数上限

    /** 上一次条件检查的人话明细，供日志使用 */
    private String condDetail = "";

    /** 多条件判断：满足走 go，不满足走 els；开了「重复检查」就一直等到成功或超上限 */
    private int execCond(TapService svc, JSONObject a) {
        JSONArray cs = a.optJSONArray("cs");
        if (cs == null || cs.length() == 0) {
            log("条件列表是空的，当成成立（不然脚本会永远卡在这）");
            return jump(a, true);
        }
        // 又是「界面存布尔、引擎按数字读」那一类：换成跟 pct 一样的兼容读法
        boolean repeat = on(a, "rep");
        // 间隔夹在 50ms~20s：太小会把 CPU 打满，太大就变成「点了停止却停不下来」
        long gap = Math.min(C_MAX_MS, Math.max(50, a.optLong("repGap", 800)));
        int max = Math.max(1, Math.min(a.optInt("repMax", 1), C_MAX_ROUND));
        boolean hit = false;
        int round = 0;
        while (true) {
            // 每轮开头过闸口：暂停就挂起（恢复后接着验），急停立刻收手
            rs.gate();
            if (rs.isStopped()) {
                log("已经停了，条件检查中断");
                return 0;
            }
            round++;
            int[] r = checkCond(svc, a, cs);
            hit = r[0] == 1;
            if (hit || !repeat || round >= max) break;
            log("条件没成，等 " + gap + "ms 再试（第 " + round + "/" + max + " 次）");
            // v2.5.0：rs.sleep 自带 100ms 切片、暂停挂起、急停提前醒。
            // 以前是手写切片循环，暂停进不来，停止也要等下一片。
            if (!rs.sleep(gap)) {
                log("已经停了，条件检查中断");
                return 0;
            }
        }
        if (rs.isStopped()) {
            log("已经停了，条件检查中断");
            return 0;
        }
        log("条件" + (hit ? " ✓成立" : " ✗不成立") + "：" + condDetail
                + (repeat && round > 1 ? "（试了 " + round + " 次）" : ""));
        return jump(a, hit);
    }

    /** 返回 {是否成立(1/0), 命中了几个, 总数}，并把每个条件的成败拼成一句人话存进 condDetail */
    private int[] checkCond(TapService svc, JSONObject a, JSONArray cs) {
        int mode = a.optInt("mode", 0);       // 0=and 1=or 2=count
        int need = Math.max(1, a.optInt("n", 1));   // mode=count 时要凑够几个
        int got = 0;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c == null) continue;
            boolean ok = oneCond(svc, c);
            if (ok) got++;
            if (sb.length() > 0) sb.append(mode == 1 ? " 或 " : " 且 ");
            sb.append(shortCond(c)).append(ok ? "✓" : "✗");
        }
        boolean pass;
        if (mode == 1) pass = got >= 1;                      // 满足一个
        else if (mode == 2) pass = got >= need;              // 满足 N 个
        else pass = got == cs.length();                      // 全部满足
        condDetail = sb + " → 命中 " + got + "/" + cs.length()
                + (mode == 2 ? "（要 " + need + " 个）" : "");
        return new int[]{pass ? 1 : 0, got, cs.length()};
    }

    /** 单个条件求值 */
    private boolean oneCond(TapService svc, JSONObject c) {
        String k = c.optString("k", "always");
        if ("always".equals(k)) return true;
        if ("pkg".equals(k)) {
            String want = c.optString("v", "");
            String cur = svc.topPkg();
            return !want.isEmpty() && cur != null && (cur.equals(want) || cur.contains(want));
        }
        if ("time".equals(k)) {
            String hm = c.optString("v", "00:00");
            int[] t = parseHm(hm);
            java.util.Calendar cal = java.util.Calendar.getInstance();
            int now = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE);
            return now >= t[0] * 60 + t[1];
        }
        if ("rand".equals(k)) {
            int p = (int) c.optDouble("v", 50);
            if (p <= 0) return false;
            if (p >= 100) return true;
            return rnd.nextInt(100) < p;
        }
        if ("expr".equals(k)) {
            String r = vars.eval(c.optString("v", ""));
            return "1".equals(r) || "true".equalsIgnoreCase(r);
        }
        if ("text".equals(k)) {
            String text = c.optString("s", "");
            String desc = c.optString("desc", "");   // v2.4.0
            String id = c.optString("id", "");       // v2.4.0
            String re = c.optString("re", "");       // v2.4.0
            // 四个条件全空才当成「没填」。以前只判 text.isEmpty()，
            // 于是「只按 id 找」会被这里吃掉 —— 不报错、直接判不成立，标准的静默失效。
            if (text.isEmpty() && desc.isEmpty() && id.isEmpty() && re.isEmpty()) return false;
            NodeMatch q = NodeMatch.of(text, desc, id, re, on(c, "contains", true));
            // v2.4.0：clickable 以前这里写死 false，条件侧比动作侧少一个能力，
            // 现在跟 find 动作对齐
            AccessibilityNodeInfo node = svc.findNode(q, on(c, "clickable", false),
                    Math.max(1, c.optInt("index", 1)));
            if (node == null) return false;
            node.recycle();
            return true;
        }
        if ("color".equals(k)) {
            Bitmap bmp = shotCached(svc, c);
            if (bmp == null) return false;
            int[] box = region(bmp, c);
            int[] hit = Img.findColor(bmp, Img.parseColor(c.optString("c", "#000000")),
                    c.optInt("sim", 95), box[0], box[1], box[2], box[3], Math.max(2, c.optInt("step", 2)));
            if (hit != null) { rememberHit(hit[0], hit[1], hit[2]); noteHit("color", hit[0], hit[1]); }
            return hit != null;
        }
        if ("image".equals(k)) {
            Bitmap bmp = shotCached(svc, c);
            if (bmp == null) return false;
            String tpl = c.optString("tpl", "");
            if (tpl.isEmpty()) return false;
            Bitmap t = TplStore.get(tpl);
            if (t == null) return false;
            int[] box = region(bmp, c);
            int[] hit = Img.findImage(bmp, t, c.optInt("sim", 90), box[0], box[1], box[2], box[3]);
            if (hit != null) { rememberHit(hit[0], hit[1], hit[2]); noteHit("image", hit[0], hit[1]); }
            return hit != null;
        }
        return false;
    }

    /**
     * 同一轮里多个图色条件共用一张截图，省掉几十毫秒。
     * 缓存只在「一次判断」内有效（1.5 秒），下一轮重新截，
     * 否则「重复检查直到成功」会一直对着同一张旧图判断，永远等不到变化。
     */
    private Bitmap shotCached(TapService svc, JSONObject c) {
        long now = System.currentTimeMillis();
        if (shotBmp == null || now - shotAt > 1500) {
            Bitmap old = shotBmp;
            shotBmp = Capture.shot(svc, 1500);
            shotAt = now;
            // 整屏 Bitmap 一张就是十几 MB，循环脚本里每 1.5 秒换一张，不回收迟早 OOM。
            // 只回收「已经不是 Capture 当前那张」的旧图：那说明它被换下来了，
            // 界面预览和 JS API 用的都是 Capture.last()（新图），不会碰到它。
            if (old != null && old != shotBmp && old != Capture.last()) {
                try {
                    old.recycle();
                } catch (Throwable ignored) {
                }
            }
        }
        return shotBmp;
    }

    private int[] parseHm(String hm) {
        try {
            String[] p = hm.trim().split(":");
            return new int[]{Integer.parseInt(p[0].trim()), p.length > 1 ? Integer.parseInt(p[1].trim()) : 0};
        } catch (Throwable t) {
            return new int[]{0, 0};
        }
    }

    /** 条件的一句话说明，给日志用 */
    private String shortCond(JSONObject c) {
        String k = c.optString("k", "always");
        switch (k) {
            case "text": {
                // v2.4.0：条件可能是文字 / 描述 / id / 正则 四个里的任意几个，
                // 只把 s 打出来的话，按 id 设的条件在日志里看着像「屏上有「」」，没法排查
                StringBuilder sb = new StringBuilder("屏上有");
                String s = c.optString("s", ""), d = c.optString("desc", "");
                String id = c.optString("id", ""), re = c.optString("re", "");
                if (!s.isEmpty()) sb.append("字「").append(s).append("」");
                if (!d.isEmpty()) sb.append("描述「").append(d).append("」");
                if (!id.isEmpty()) sb.append("id「").append(id).append("」");
                if (!re.isEmpty()) sb.append("正则「").append(re).append("」");
                return sb.toString();
            }
            case "pkg": return "当前是 " + c.optString("v", "");
            case "color": return "有颜色 " + c.optString("c", "");
            case "image": return "有图「" + c.optString("tpl", "") + "」";
            case "time": return "过了 " + c.optString("v", "");
            case "rand": return "随机 " + (int) c.optDouble("v", 50) + "%";
            case "expr": return c.optString("v", "");
            default: return "恒真";
        }
    }

    // ---------- 图色识别 ----------
    /** 比色：某一点是不是目标颜色，是走 go，否则走 els */
    private int execCmpColor(TapService svc, JSONObject a) {
        Bitmap bmp = Capture.shot(svc, 1500);
        if (bmp == null) {
            log("没截到屏，比色跳过");
            return a.optInt("els", 0) == -1 ? JUMP_END : a.optInt("els", 0);
        }
        int x = a.optInt("x", 0), y = a.optInt("y", 0);
        if (pctOn(a)) {
            x = (int) (x / 100f * bmp.getWidth());
            y = (int) (y / 100f * bmp.getHeight());
        }
        int color = Img.parseColor(a.optString("c", "#000000"));
        int sim = a.optInt("sim", 95);
        boolean hit = Img.cmpColor(bmp, x, y, color, sim);
        log("比色 (" + x + "," + y + ") " + a.optString("c", "") + (hit ? " ✓像" : " ✗不像"));
        return jump(a, hit);
    }

    /** 找色：在区域里找目标颜色，找到记下坐标（可选点击） */
    private int execFindColor(TapService svc, JSONObject a) {
        Bitmap bmp = Capture.shot(svc, 1500);
        if (bmp == null) {
            log("没截到屏，找色跳过");
            return jump(a, false);
        }
        int color = Img.parseColor(a.optString("c", "#000000"));
        int sim = a.optInt("sim", 95);
        int[] r = region(bmp, a);
        int[] hit = Img.findColor(bmp, color, sim, r[0], r[1], r[2], r[3], Math.max(2, a.optInt("step", 2)));
        // v2.3.0：以前表单里根本没 timeout 这个入口，找色是「截一帧、没中就算没中」，
        // 于是「等红色按钮出现再点」这类活根本干不了。现在跟 find 一样真轮询。
        if (hit == null && a.optLong("timeout", 0) > 0) {
            logW("没找到颜色，最多再等 " + a.optLong("timeout", 0) + "ms");
            hit = pollUntil(deadlineOf(a.optLong("timeout", 0)), "找色", () -> {
                Bitmap b2 = Capture.shot(svc, 1500);
                if (b2 == null) return null;
                int[] r2 = region(b2, a);
                return Img.findColor(b2, color, sim, r2[0], r2[1], r2[2], r2[3], Math.max(2, a.optInt("step", 2)));
            });
        }
        if (hit != null) {
            log("找到颜色 @(" + hit[0] + "," + hit[1] + ") 像 " + hit[2] + "%");
            noteHit("color", hit[0], hit[1]);
            rememberHit(hit[0], hit[1], hit[2]);
            if (on(a, "click", true)) svc.tap(hit[0], hit[1], 60);
            return jump(a, true);
        }
        logW("没找到颜色 " + a.optString("c", ""));
        return jump(a, false);
    }

    /** 找图：在当前屏幕里找模板图，找到点击中心 */
    private int execFindImage(TapService svc, JSONObject a) {
        Bitmap bmp = Capture.shot(svc, 1500);
        if (bmp == null) {
            log("没截到屏，找图跳过");
            return jump(a, false);
        }
        String name = a.optString("tpl", "");
        Bitmap tpl = TplStore.get(name);
        if (tpl == null) {
            log("没有模板图「" + name + "」，先去截图存一张");
            return jump(a, false);
        }
        int sim = a.optInt("sim", 90);
        int[] r = region(bmp, a);
        int[] hit = Img.findImage(bmp, tpl, sim, r[0], r[1], r[2], r[3]);
        if (hit == null && a.optLong("timeout", 0) > 0) {
            logW("没找到图，最多再等 " + a.optLong("timeout", 0) + "ms");
            hit = pollUntil(deadlineOf(a.optLong("timeout", 0)), "找图", () -> {
                Bitmap b2 = Capture.shot(svc, 1500);
                if (b2 == null) return null;
                int[] r2 = region(b2, a);
                return Img.findImage(b2, tpl, sim, r2[0], r2[1], r2[2], r2[3]);
            });
        }
        if (hit != null) {
            log("找到图「" + name + "」@(" + hit[0] + "," + hit[1] + ") 像 " + hit[2] + "%");
            noteHit("image", hit[0], hit[1]);
            rememberHit(hit[0], hit[1], hit[2]);   // 记进 lastX/lastY，后面的动作能直接引用
            if (on(a, "click", true)) svc.tap(hit[0], hit[1], 60);
            return jump(a, true);
        }
        logW("没找到图「" + name + "」");
        return jump(a, false);
    }

    /**
     * 读一个开关字段：布尔和数字 1 都算开。
     * 界面开关写的是布尔，但内置脚本、分享码、手改过的 JSON 里可能是数字 1。
     * org.json 对布尔求 optInt、对数字求 optBoolean 都会抛异常并回落默认值，
     * 只认一种就会把「开」读成「关」——pct（百分比坐标）和 rep（重复检查）都栽在这上面。
     */
    private static boolean on(JSONObject a, String k) {
        return on(a, k, false);
    }

    /**
     * 带默认值的版本：默认值为 true 的开关（contains / click / resetAfter）也能用同一套兼容读法。
     * 不然「界面存 1、引擎 optBoolean(key,true)」这种组合会一路读到 true——
     * 你以为关了，其实一直开着，而且没有任何报错。
     */
    private static boolean on(JSONObject a, String k, boolean def) {
        if (a == null) return def;
        Object v = a.opt(k);
        if (v == null) return def;
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof Number) return ((Number) v).intValue() != 0;
        if (v instanceof String) {
            String s = ((String) v).trim().toLowerCase();
            if ("true".equals(s) || "1".equals(s) || "on".equals(s) || "yes".equals(s)) return true;
            if ("false".equals(s) || "0".equals(s) || "off".equals(s) || "no".equals(s) || s.isEmpty()) return false;
        }
        return def;
    }

    /** 坐标是不是按百分比算 */
    private static boolean pctOn(JSONObject a) {
        return on(a, "pct");
    }

    /** 动作里的区域字段（支持百分比） */
    private static int[] region(Bitmap bmp, JSONObject a) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        boolean p = pctOn(a);
        int x0 = a.optInt("rx", 0), y0 = a.optInt("ry", 0);
        int x1 = a.optInt("rw", 0), y1 = a.optInt("rh", 0);
        if (p) {
            x0 = (int) (x0 / 100f * w);
            y0 = (int) (y0 / 100f * h);
            x1 = (int) (x1 / 100f * w);
            y1 = (int) (y1 / 100f * h);
        } else {
            x1 = x0 + x1;
            y1 = y0 + y1; // 非百分比时 rw/rh 是宽高
        }
        if (x1 <= 0) x1 = w - 1;
        if (y1 <= 0) y1 = h - 1;
        return new int[]{x0, y0, x1, y1};
    }

    /** 把命中坐标写进变量，后续动作就能用 {{lastX}} {{lastY}} 接着操作 */
    private void rememberHit(int x, int y, int sim) {
        vars.put("lastX", String.valueOf(x));
        vars.put("lastY", String.valueOf(y));
        vars.put("lastSim", String.valueOf(sim));
        lastHit = new int[]{x, y, sim};
    }

    /**
     * 分别记下找色/找图各自的落点，给 {{hit.colorX}} {{hit.imageY}} 用。
     * lastX/lastY 只留最后一次（不管哪种），一个脚本里先找图再找色就串味了。
     */
    private void noteHit(String kind, int x, int y) {
        hits.put(kind + "X", String.valueOf(x));
        hits.put(kind + "Y", String.valueOf(y));
    }

    /** 命中走 go，没命中走 els，语义与“如果”一致 */
    private int jump(JSONObject a, boolean hit) {
        lastBool = hit;   // JS 脚本模式靠它拿到「判断成立没」
        int v = hit ? a.optInt("go", 0) : a.optInt("els", 0);
        if (v == -1) return JUMP_END;
        if (v == -2) return JUMP_LOOP;
        return v;
    }

    // ---------- 变量 ----------

    /** 赋值：值可以是常量、也可以是 {{另一个变量}} / {{内置变量}} */
    private int execSet(JSONObject a) {
        String k = a.optString("k", "").trim();
        if (k.isEmpty()) {
            log("赋值没填变量名，跳过");
            return 0;
        }
        String v = a.optString("v", "");   // {{}} 已在插值阶段算好
        vars.put(k, v);
        log("变量 " + k + " = " + (v.isEmpty() ? "（空）" : v));
        return 0;
    }

    /** 运算：表达式直接写，不用加 {{}}，比如 n+1、rand(1,10)、lastX-20 */
    private int execMath(JSONObject a) {
        String k = a.optString("k", "").trim();
        String e = a.optString("e", "").trim();
        if (k.isEmpty()) {
            log("运算没填变量名，跳过");
            return 0;
        }
        if (e.isEmpty()) {
            log("运算没写算式，跳过");
            return 0;
        }
        String r = vars.eval(e);
        if (r == null) {
            log("算式读不懂：" + e + "（当成原样存进去）");
            vars.put(k, e);
            return 0;
        }
        vars.put(k, r);
        log("算 " + k + " = " + e + " → " + r);
        return 0;
    }

    /** 比较变量：成立走 go，不成立走 els，与「如果」同一套跳转语义 */
    private int execCmpVar(JSONObject a) {
        String l = a.optString("l", "").trim();
        String r = a.optString("r", "").trim();
        String op = a.optString("op", "==");
        boolean hit = cmpVals(l, op, r);
        log("比较 " + l + " " + op + " " + r + (hit ? " ✓成立" : " ✗不成立"));
        return jump(a, hit);
    }

    /** 两边都能是表达式，看着像数字就按数值比，否则按字符串比 */
    private boolean cmpVals(String l, String op, String r) {
        String lv = valOf(l), rv = valOf(r);
        boolean num = isNum(lv) && isNum(rv);
        if ("==" .equals(op)) return num ? dbl(lv) == dbl(rv) : lv.equals(rv);
        if ("!=" .equals(op)) return num ? dbl(lv) != dbl(rv) : !lv.equals(rv);
        double x = dbl(lv), y = dbl(rv);
        if (">" .equals(op)) return x > y;
        if (">=" .equals(op)) return x >= y;
        if ("<" .equals(op)) return x < y;
        return x <= y;
    }

    /** 先当表达式算，算不出来就当普通文本 */
    private String valOf(String s) {
        if (s == null || s.isEmpty()) return "";
        String e = vars.eval(s);
        return e == null ? s : e;
    }

    private static boolean isNum(String s) {
        if (s == null || s.trim().isEmpty()) return false;
        try {
            Double.parseDouble(s.trim());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static double dbl(String s) {
        try {
            return Double.parseDouble(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    /** 给界面看运行时变量值（调试用） */
    public JSONArray varSnapshot() {
        return vars.snapshot();
    }

    /** 拿当前变量值试算一段表达式，界面上即时预览 */
    public String tryEval(String e) {
        return vars.eval(e);
    }

    // ==================== JS 脚本模式（v1.7.0） ====================
    // JS 只管调度，动作照样走 exec()，所以 JS 脚本和动作脚本共用同一批动作实现，
    // {{}} 插值、变量、找色找图全都白拿。
    // JS 跑在 WebView 主线程，动作跑在下面的 h 线程，两边用回调串起来：
    //   JS 调 app.call(id, ...) 立刻返回 → 动作在 h 线程跑完 → 主线程回 __cb(id, 结果)

    public interface OneDone {
        void on(String resultJson);
    }

    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private int[] lastHit;         // 最近一次图色命中的坐标
    private boolean lastBool;      // 最近一次判断类动作的结果
    private volatile boolean jsMode;

    public boolean isJsMode() {
        return jsMode && rs.isRunning();
    }

    /** JS 脚本开跑：把状态准备好，但不启动 step 循环——节奏交给 JS 自己控制 */
    public boolean startJs(JSONObject sc) {
        if (TapService.get() == null) {
            log("无障碍服务没开，跑不动");
            return false;
        }
        stop();
        script = sc == null ? new JSONObject() : sc;
        currentId = script.optString("id");
        actions = null;                 // JS 模式没有动作表
        jitter = on(script, "jitter", false);
        // v2.3.0：JS 脚本以前完全不认脚本设置里的「开始前等几秒」和「循环几次」，
        // 界面上有这两个输入框，填了却没反应。现在读出来交给 JsEngine 包在外层。
        jsDelayMs = Math.max(0, script.optInt("startDelay", 0)) * 1000;
        jsLoops = on(script, "loop", false) ? -1 : Math.max(1, script.optInt("loopCount", 1));
        loopLeft = 0;
        index = 0;
        repeatLeft = 0;
        counters.clear();
        hits.clear();
        lastHit = null;
        vars.load(script.optJSONArray("vars"));
        vars.loop = 1;
        vars.cnt = counters;
        vars.step = 0;
        TapService ts = TapService.get();
        vars.screenW = ts != null ? ts.screenW() : 0;
        vars.screenH = ts != null ? ts.screenH() : 0;
        ScriptStore.touchRun(script);
        Prefs.put("lastScript", currentId);
        jsMode = true;
        rs.start();
        String name = script.optString("name", "未命名");
        log("开跑（JS）：" + name);
        status("running", name);
        return true;
    }

    public void stopJs() {
        jsMode = false;
        rs.stop();
        repeatLeft = 0;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (listener != null && !currentId.isEmpty()) status("stopped", "");
        currentId = "";
    }

    /**
     * 执行单个动作（异步，结果回主线程）。结果 JSON 里可能有：
     *   ok / x / y / sim —— 找色、找图、比色、判断类动作的命中结果
     *   jump             —— 动作自带的跳转语义（-1 收工 / -2 重来一轮）
     *   err              —— 出错或被中途叫停
     * 动作跑完会按动作自带的等待（d）停一下再回调，JS 侧不用再额外 sleep。
     */
    public void runOne(JSONObject a, OneDone cb) {
        if (h == null) {
            if (cb != null) cb.on(errJson("引擎没起来"));
            return;
        }
        h.post(() -> {
            JSONObject r = new JSONObject();
            try {
                if (!rs.isRunning() || !jsMode) {
                    r.put("err", "已经停了");
                } else {
                    lastHit = null;
                    lastBool = false;
                    vars.step++;
                    JSONObject b = vars.bind(a);
                    int j = 0;
                    try {
                        j = exec(b);
                    } catch (Throwable t) {
                        r.put("err", String.valueOf(t.getMessage()));
                    }
                    r.put("jump", j);
                    r.put("ok", lastBool ? 1 : 0);
                    if (lastHit != null) {
                        r.put("x", lastHit[0]);
                        r.put("y", lastHit[1]);
                        r.put("sim", lastHit[2]);
                    }
                    long wait = delayAfter(b);
                    if (wait > 0 && rs.isRunning()) rs.sleep(Math.min(wait, 30000L));
                }
            } catch (Throwable t) {
                try {
                    r.put("err", String.valueOf(t.getMessage()));
                } catch (Exception ignored) {
                }
            }
            String s = r.toString();
            if (cb != null) main.post(() -> cb.on(s));
        });
    }

    private static String errJson(String m) {
        JSONObject r = new JSONObject();
        try {
            r.put("err", m);
        } catch (Exception ignored) {
        }
        return r.toString();
    }

    /** JS 侧 setVar/getVar 走这里 */
    public void setVar(String k, String v) {
        vars.put(k, v);
    }

    public String getVar(String k) {
        String v = vars.get(k);
        // 表里没有就当表达式求值，这样 JS 里 getVar('cnt.main') 也能读到计数器
        if (v == null && k != null && !k.isEmpty()) v = vars.eval(k);
        return v;
    }

    /** 计数器：加一 / 重置，达到次数就跳步或收工 */
    private int execCount(JSONObject a) {
        String k = a.optString("k", "main");
        int cur = counters.containsKey(k) ? counters.get(k) : 0;
        if ("reset".equals(a.optString("mode", "add"))) cur = 0;
        else cur += a.optInt("v", 1);
        counters.put(k, cur);
        int times = a.optInt("times", 0);
        log("计数 " + k + " = " + cur);
        if (times > 0 && cur >= times) {
            if (on(a, "resetAfter", true)) counters.put(k, 0);
            int go = a.optInt("go", 0);
            // 与全局一致：0=下一步，-1=收工，-2=重来一轮，>0=跳第 N 步
            if (go == -1) {
                log("够 " + times + " 次了，收工");
                return JUMP_END;
            }
            if (go == -2) {
                log("够 " + times + " 次了，重来一轮");
                return JUMP_LOOP;
            }
            if (go > 0) log("够 " + times + " 次了，跳第 " + go + " 步");
            else log("够 " + times + " 次了，继续往下");
            return go;
        }
        return 0;
    }

    /** 供外部（悬浮球 / 磁贴）直接跑一次手势的便捷方法 */
    static void gesture(AccessibilityService svc, Path path, long ms) {
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(path, 0, ms));
        svc.dispatchGesture(b.build(), null, null);
    }

    static Bundle textBundle(String s) {
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, s);
        return b;
    }
}
