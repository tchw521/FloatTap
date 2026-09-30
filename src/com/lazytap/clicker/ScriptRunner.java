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
    private final List<String> logs = new ArrayList<>();

    private volatile boolean running;
    private volatile String currentId = "";
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
        return running;
    }

    public String currentId() {
        return currentId;
    }

    public List<String> logs() {
        return logs;
    }

    private void log(String s) {
        logs.add(s);
        if (logs.size() > 200) logs.remove(0);
        if (listener != null) listener.on("log", s);
    }

    /** 给外部（服务 / 悬浮球）往日志页里写一句话 */
    public void note(String s) {
        log(s);
    }

    private void status(String s, String extra) {
        if (listener != null) listener.on("status", s + "|" + currentId + "|" + extra);
    }

    public boolean start(JSONObject sc) {
        if (sc == null) return false;
        AccessibilityService svc = TapService.get();
        if (svc == null) {
            log("无障碍服务没开，跑不动");
            return false;
        }
        stop();
        script = sc;
        currentId = sc.optString("id");
        actions = sc.optJSONArray("actions");
        if (actions == null || actions.length() == 0) {
            log("脚本是空的，加两步再来");
            return false;
        }
        jitter = sc.optBoolean("jitter", false);
        int loops = sc.optInt("loopCount", 1);
        boolean forever = sc.optBoolean("loop", false);
        loopLeft = forever ? -1 : Math.max(1, loops);
        running = true;
        index = 0;
        repeatLeft = 0;
        counters.clear();
        hits.clear();
        vars.load(sc.optJSONArray("vars"));   // 变量每次开跑都从脚本里的初值开始
        vars.loop = 1;                        // {{loop}} 从第一轮开始数
        vars.cnt = counters;                  // 让 {{cnt.名字}} 能读到计数器的值
        TapService ts = TapService.get();
        vars.screenW = ts != null ? ts.screenW() : 0;
        vars.screenH = ts != null ? ts.screenH() : 0;
        ScriptStore.touchRun(sc);
        Prefs.put("lastScript", currentId);
        log("开跑：" + sc.optString("name", "未命名"));
        status("running", sc.optString("name", ""));
        loopStart = System.currentTimeMillis();
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
        running = false;
        repeatLeft = 0;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (listener != null && !currentId.isEmpty()) status("stopped", "");
        currentId = "";
    }

    private float speed() {
        float s = Prefs.getFloat("speed", 1f);
        return s <= 0.05f ? 0.05f : s;
    }

    private long delayAfter(JSONObject a) {
        long d = a.optLong("d", 300);
        if (jitter && d > 0) d = Math.round(d * (0.75 + rnd.nextDouble() * 0.5)); // ±25%，更像人手
        return (long) (d * speed());
    }

    private void step() {
        if (!running) return;
        if (index >= actions.length()) {
            if (loopLeft == -1 || loopLeft > 1) {
                if (loopLeft > 1) loopLeft--;
                index = 0;
                vars.loop++;                 // {{loop}} 跟着轮次走
                log("第 " + ((System.currentTimeMillis() - loopStart) / 1000 + 1) + " 秒：再来一轮");
                h.postDelayed(this::step, Math.max(50, (long) (300 * speed())));
                return;
            }
            running = false;
            log("跑完收工，手指保住了");
            status("stopped", "done");
            return;
        }
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
            log("动作出错：" + t.getMessage());
        }
        if (jump == JUMP_END) {          // 直接收工
            running = false;
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
        if (jump > 0) index = jump - 1;  // 跳到第 N 步（1 起）
        if (index < 0) index = 0;
        h.postDelayed(this::step, Math.max(16, wait));
    }

    /** 返回值：0 继续下一步；>0 跳到第 N 步；-1 结束；-2 立刻重来一轮 */
    private static final int JUMP_END = -1;
    private static final int JUMP_LOOP = -2;

    private int exec(JSONObject a) {
        TapService svc = TapService.get();
        if (svc == null) {
            running = false;
            return JUMP_END;
        }
        String t = a.optString("t", "click");
        switch (t) {
            case "if":
                return execIf(svc, a);
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
                if (a.optInt("pct", 0) == 1) {
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
                if (a.optInt("pct", 0) == 1) { // 百分比坐标，换机型不跑偏
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
                        if (!running) return;
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
                if (a.optInt("pct", 0) == 1) {
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
                log("发呆 " + a.optLong("ms", 1000) + "ms");
                return 0;
            }
            case "key": {
                String k = a.optString("k", "back");
                svc.globalAction(k);
                log("按了 " + k);
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
                boolean contains = a.optBoolean("contains", true);
                boolean clickableOnly = a.optBoolean("clickable", false);
                boolean doClick = a.optBoolean("click", true);
                boolean pctIndex = false;
                int nth = a.optInt("index", 1);
                long timeout = a.optLong("timeout", 3000);
                AccessibilityNodeInfo node = svc.findNode(text, contains, clickableOnly, nth);
                if (node != null) {
                    Rect r = new Rect();
                    node.getBoundsInScreen(r);
                    log("找到「" + text + "」@" + r.centerX() + "," + r.centerY());
                    if (doClick) svc.tap(r.centerX(), r.centerY(), 60);
                    node.recycle();
                } else if (timeout > 0) {
                    log("没找到「" + text + "」，再等等");
                    h.postDelayed(() -> {
                        if (!running) return;
                        try {
                            TapService s2 = TapService.get();
                            if (s2 == null) {
                                running = false;
                                log("服务没了，不跑了");
                                status("stopped", "fail");
                                return;
                            }
                            AccessibilityNodeInfo n2 = s2.findNode(text, contains, clickableOnly, nth);
                            if (n2 != null) {
                                Rect r2 = new Rect();
                                n2.getBoundsInScreen(r2);
                                if (doClick) s2.tap(r2.centerX(), r2.centerY(), 60);
                                n2.recycle();
                                log("这回找到了「" + text + "」");
                            } else if (script != null && script.optBoolean("stopOnFail", false)) {
                                running = false;
                                log("还是没找到「" + text + "」，不跑了");
                                status("stopped", "fail");
                            } else {
                                log("还是没找到「" + text + "」，接着走");
                            }
                        } catch (Throwable t2) {
                            log("找文字出错：" + t2.getMessage());
                        }
                    }, Math.min(timeout, 2000));
                } else {
                    log("没找到「" + text + "」，跳过");
                    if (script != null && script.optBoolean("stopOnFail", false)) {
                        running = false;
                        status("stopped", "fail");
                        return JUMP_END;
                    }
                }
                return 0;
            }
            default:
                log("未知动作 " + t);
        }
        return 0;
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
            boolean contains = a.optBoolean("contains", true);
            boolean clickableOnly = a.optBoolean("clickable", false);
            int nth = a.optInt("index", 1);
            AccessibilityNodeInfo node = svc.findNode(text, contains, clickableOnly, nth);
            hit = node != null;
            if (node != null) node.recycle();
            log((hit ? "✓ 有" : "✗ 没") + "「" + text + "」");
        }
        int go = hit ? a.optInt("go", 0) : a.optInt("els", 0);
        if (go == -1) go = JUMP_END;
        else if (go == -2) go = JUMP_LOOP;
        return go;
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
        if (a.optInt("pct", 0) == 1) {
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
        int[] hit = Img.findColor(bmp, color, sim, r[0], r[1], r[2], r[3], a.optInt("step", 2));
        if (hit != null) {
            log("找到颜色 @(" + hit[0] + "," + hit[1] + ") 像 " + hit[2] + "%");
            hits.put("color", hit[0] + "," + hit[1]);
            rememberHit(hit[0], hit[1], hit[2]);
            if (a.optBoolean("click", true)) svc.tap(hit[0], hit[1], 60);
            return jump(a, true);
        }
        log("没找到颜色 " + a.optString("c", ""));
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
        if (hit != null) {
            log("找到图「" + name + "」@(" + hit[0] + "," + hit[1] + ") 像 " + hit[2] + "%");
            hits.put("image", hit[0] + "," + hit[1]);
            rememberHit(hit[0], hit[1], hit[2]);   // 记进 lastX/lastY，后面的动作能直接引用
            if (a.optBoolean("click", true)) svc.tap(hit[0], hit[1], 60);
            return jump(a, true);
        }
        log("没找到图「" + name + "」");
        return jump(a, false);
    }

    /** 动作里的区域字段（支持百分比） */
    private static int[] region(Bitmap bmp, JSONObject a) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        boolean p = a.optInt("pct", 0) == 1;
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
    }

    /** 命中走 go，没命中走 els，语义与“如果”一致 */
    private static int jump(JSONObject a, boolean hit) {
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
            if (a.optBoolean("resetAfter", true)) counters.put(k, 0);
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
