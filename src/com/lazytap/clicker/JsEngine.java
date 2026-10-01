package com.lazytap.clicker;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * JS 脚本引擎（v1.7.0）：借 WebView 自带的 V8 跑用户脚本。
 *
 * 之所以不编 QuickJS 进来：那要 NDK 和一个几 MB 的 so，与「零第三方、百 KB 级」的目标冲突。
 * V8 本来就在系统 WebView 里，白拿，还支持比 QuickJS 更新的语法。
 *
 * 线程怎么走的：
 *   用户 JS        —— 跑在 WebView 主线程（所以脚本里不能写死循环，会把界面卡死）
 *   动作           —— 经 app.call 投递到 ScriptRunner 的后台线程，逐个串行执行
 *   结果回传       —— 动作跑完回到主线程调 __cb(id, 结果)，JS 的 await 就继续往下走
 *
 * 动作实现全部复用 ScriptRunner#exec()，所以 JS 脚本和动作脚本共用同一批能力，
 * 包括 {{}} 插值、变量、找色找图。加新动作不用改这里。
 */
public final class JsEngine {

    public interface Sink {
        /** type: log / done / err */
        void on(String type, String data);
    }

    private static volatile JsEngine instance;

    public static JsEngine get() {
        if (instance == null) {
            synchronized (JsEngine.class) {
                if (instance == null) instance = new JsEngine();
            }
        }
        return instance;
    }

    private Context ctx;
    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean busy;
    private Sink sink;
    private String code;
    private JSONObject script;

    public static void init(Context c) {
        get().ctx = c.getApplicationContext();
    }

    public boolean isBusy() {
        return busy;
    }

    // ---------------- 跑脚本 ----------------

    /** JS 道的 ScriptRunner（池里 2 号道）。JS 的一切运行时状态都在这条道上 */
    private static final ScriptRunner jsLane = Lanes.get(2);

    /**
     * v3.0.0：唯一池入口。返回 null = 已开跑；非 null = 用户可读的失败文案
     * （JsApi 层 err: 前缀自动 toast）。悬浮球、磁贴、触发器、界面都从这里进，
     * 「能不能跑」由 RunnerPool 记账，这里不再有「先杀引擎」的抢占。
     */
    public static String startScript(JSONObject sc, Sink sk) {
        if (sc == null) return "脚本不存在";
        boolean js = "js".equals(sc.optString("kind", ""));
        String sid = sc.optString("id", "");
        RunnerPool pool = RunnerPool.get();
        int i = pool.acquire(sid, js);
        if (i < 0) {
            // 池已落一条系统日志；这里给界面一个能弹出来的文案
            return js ? "JS 脚本已经在跑了，先停掉再换"
                    : "会话已满（2 个动作 + 1 个 JS），先停一个再跑";
        }
        ScriptRunner lane = Lanes.get(i);
        if (js) {
            String code = sc.optString("code", "");
            if (code.trim().isEmpty()) {
                pool.release(i);
                return "JS 脚本还没有代码";
            }
            // 同 id 重启：JS 道必须先经 JsEngine.stop() 清 busy / 释放 WebView，
            // 纯 lane.stop() 只停 ScriptRunner 侧，busy 挂着下一个脚本会被闸掉
            if (get().isBusy()) get().stop();
            if (lane.isBusy()) lane.stop();   // 再收 ScriptRunner 侧（rs / 槽 / 道）
            i = pool.acquire(sid, true);      // 重新领道（stop 已还道，低位优先必回 JS 道）
            if (i < 0) return "JS 脚本已经在跑了，先停掉再换";
            lane = Lanes.get(i);
            get().run(code, sc, sk);          // busy 置位 + WebView 异步起；收尾由 done/fail/stop 还道
            return null;
        }
        if (!lane.start(sc)) {
            pool.release(i);                  // 没跑起来道得还，不然这条道永远算被占着
            return "没跑起来，看看无障碍服务开了没";
        }
        return null;
    }

    public void run(String userCode, JSONObject sc, Sink sk) {
        if (ctx == null) {
            if (sk != null) sk.on("err", "引擎还没初始化");
            return;
        }
        if (busy) {
            if (sk != null) sk.on("err", "上一个 JS 脚本还在跑，先停掉");
            return;
        }
        busy = true;
        sink = sk;
        code = userCode == null ? "" : userCode;
        script = sc;
        ui.post(this::boot);
    }

    private void boot() {
        try {
            releaseWeb();
            web = new WebView(ctx);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setAllowFileAccess(true);
            s.setAllowContentAccess(false);
            s.setAllowFileAccessFromFileURLs(true);   // 只跑自己的本地文件
            s.setDomStorageEnabled(false);
            s.setCacheMode(WebSettings.LOAD_NO_CACHE);
            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    inject();
                }
            });
            web.addJavascriptInterface(new Bridge(), "app");
            web.loadUrl("file:///android_asset/www/jsrunner.html");
        } catch (Throwable t) {
            busy = false;
            emit("err", "WebView 起不来：" + t.getMessage());
        }
    }

    /** runner.js 从 assets 读出来注入，既是唯一一份源码，也绕开 file:// 的子资源限制 */
    private void inject() {
        String runner = readAsset("www/runner.js");
        if (runner == null) {
            fail("runner.js 读不到");
            return;
        }
        try {
            web.evaluateJavascript(runner, null);
        } catch (Throwable t) {
            fail("runner.js 注入失败：" + t.getMessage());
            return;
        }
        if (!jsLane.startJs(script)) {
            fail("无障碍服务没开，跑不动");
            return;
        }
        // 用户脚本包成 async IIFE，顶层才能直接写 await。
        // v2.3.0：外面再套一层循环和开跑前的等待，把脚本设置里的
        // 「开始前先等几秒」「循环几次」真正用起来（以前这两项对 JS 脚本完全无效）。
        int loops = jsLane.jsLoops();
        int delay = jsLane.jsDelayMs();
        StringBuilder w = new StringBuilder("(async function(){\n");
        w.append("var __i=0, __n=").append(loops).append(";\n");
        if (delay > 0) w.append("await sleep(").append(delay).append(");\n");
        w.append("while (true) {\n");
        w.append("if (__i > 0) log('JS 第 ' + (__i + 1) + ' 轮');\n");
        w.append("__i++;\n");
        w.append(code).append("\n");
        // 先问「还跑着吗」再决定要不要来下一轮：用户按了停止/音量键就能真停下
        w.append("if (!running()) break;\n");
        w.append("if (__n > 0 && __i >= __n) break;\n");
        w.append("}\n");
        String js = w.append("})().then(function(v){app.done(v==null?'':String(v));})"
                + ".catch(function(e){app.fail((e&&e.message)?e.message:String(e));});").toString();
        try {
            web.evaluateJavascript(js, null);
        } catch (Throwable t) {
            fail("脚本起不来：" + t.getMessage());
        }
    }

    private void done(String msg) {
        if (!busy) return;          // 已经收过尾了（比如用户刚叫停），别重复报
        jsLane.stop();              // JS 道收尾：rs/槽/道一起清（runId 清零，下面的日志归系统）
        busy = false;
        if (msg != null && !msg.isEmpty()) jsLane.note("JS 返回：" + msg);
        jsLane.note("JS 脚本跑完");
        emit("done", msg == null ? "" : msg);
        ui.post(this::releaseWeb);
    }

    private void fail(String msg) {
        if (!busy) return;
        jsLane.stop();              // startJs 失败（无障碍没开）也走这：retireSlot 会把道还池
        jsLane.note("JS 出错：" + msg);
        busy = false;
        emit("err", msg);
        ui.post(this::releaseWeb);
    }

    /**
     * 用户中途叫停：脚本还在 await 里也能立刻断掉。
     *
     * 这里刻意不立刻销毁 WebView：正在等的那个 app.call 回来时若页面已经没了，
     * 回调就发不出去，runner.js 里的 Promise 会永远悬着。所以先把 busy 清零
     * （ScriptRunner 侧已停，后续动作直接回「已经停了」），让脚本自己顺着
     * await 链跑完，页面由 done() 收尾释放。
     */
    public void stop() {
        if (!busy) return;
        busy = false;
        jsLane.stop();
        emit("done", "被叫停");
        ui.postDelayed(() -> {
            if (!busy) releaseWeb();   // 期间又开了新脚本就别把新页面拆了
        }, STOP_GRACE);
    }

    /** 叫停后留给脚本善终的时间 */
    private static final long STOP_GRACE = 800;

    private void releaseWeb() {
        if (web != null) {
            try {
                web.stopLoading();
                web.destroy();
            } catch (Throwable ignored) {
            }
            web = null;
        }
    }

    private void emit(String type, String data) {
        if (sink != null) sink.on(type, data);
    }

    private String readAsset(String path) {
        InputStream in = null;
        try {
            in = ctx.getAssets().open(path);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toString("UTF-8");
        } catch (Throwable t) {
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    // ---------------- 给 JS 的桥 ----------------

    private final class Bridge {

        /** 执行一个动作。参数直接就是动作 JSON，动作类型由 runner.js 决定 */
        @JavascriptInterface
        public void call(String id, String actionJson) {
            if (id == null || !id.matches("\\d+")) return;   // 只认数字 id，防拼进 JS 里出问题
            JSONObject a;
            try {
                a = new JSONObject(actionJson);
            } catch (Throwable t) {
                reply(id, "{\"err\":\"参数不是合法 JSON\"}");
                return;
            }
            jsLane.runOne(a, res -> reply(id, res));
        }

        /** 同步小能力：log / toast / screen / 变量 / 随机数 / 时间戳 / 叫停 */
        @JavascriptInterface
        public String sys(String reqJson) {
            JSONObject r = new JSONObject();
            try {
                JSONObject q = new JSONObject(reqJson);
                String m = q.optString("m", "");
                switch (m) {
                    case "log":
                        jsLane.note(q.optString("a", ""));
                        break;
                    case "toast":
                        final String t = q.optString("a", "");
                        ui.post(() -> {
                            try {
                                Toast.makeText(ctx, t, Toast.LENGTH_SHORT).show();
                            } catch (Throwable ignored) {
                            }
                        });
                        break;
                    case "screen": {
                        TapService ts = TapService.get();
                        r.put("w", ts != null ? ts.screenW() : 0);
                        r.put("h", ts != null ? ts.screenH() : 0);
                        break;
                    }
                    case "setVar":
                        jsLane.setVar(q.optString("k", ""), q.optString("v", ""));
                        break;
                    case "getVar":
                        r.put("v", jsLane.getVar(q.optString("k", "")));
                        break;
                    // v3.1.0：共享变量与互斥锁（动作脚本的 globalSet/globalGet/lock/unlock 同一套表）
                    case "gset":
                        GlobalVars.get().put(q.optString("k", ""), q.optString("v", ""));
                        break;
                    case "gget":
                        r.put("v", GlobalVars.get().get(q.optString("k", "")));
                        break;
                    case "glock":
                        // 只试不等——JavaBridge 线程挂死会把 WebView 拖下水，等待由 JS 侧轮询
                        long jrid = jsLane.runId();
                        r.put("v", jrid > RunSlot.NO_RUN
                                && Locks.get().tryAcquire(q.optString("k", ""), jrid) ? 1 : 0);
                        break;
                    case "gunlock":
                        long urid = jsLane.runId();
                        if (urid > RunSlot.NO_RUN) {
                            Locks.get().release(q.optString("k", ""), urid);
                        }
                        break;
                    case "stop":
                        r.put("v", "ok");
                        stop();
                        break;
                    case "rand": {
                        int lo = q.optInt("a", 0), hi = q.optInt("b", 100);
                        if (hi < lo) {
                            int tmp = lo;
                            lo = hi;
                            hi = tmp;
                        }
                        r.put("v", lo + (int) (Math.random() * (hi - lo + 1)));
                        break;
                    }
                    case "now":
                        r.put("v", System.currentTimeMillis());
                        break;
                    // v2.3.0：JS 脚本要能问「还在跑吗」，不然外层循环停不下来
                    case "running":
                        r.put("v", jsLane.isRunning() ? 1 : 0);
                        break;
                    default:
                        r.put("err", "不认识的方法 " + m);
                        break;
                }
            } catch (Throwable t) {
                try {
                    r.put("err", String.valueOf(t.getMessage()));
                } catch (Exception ignored) {
                }
            }
            return r.toString();
        }

        @JavascriptInterface
        public void done(String v) {
            JsEngine.this.done(v);
        }

        @JavascriptInterface
        public void fail(String e) {
            JsEngine.this.fail(e == null ? "未知错误" : e);
        }
    }

    private void reply(String id, String resultJson) {
        ui.post(() -> {
            if (web == null) return;
            try {
                web.evaluateJavascript("window.__cb&&window.__cb(" + id + "," + resultJson + ")", null);
            } catch (Throwable ignored) {
            }
        });
    }

    // ---------------- v3.0.0：全局操作（音量键 / 磁贴 / 悬浮球 / 通知栏） ----------------

    /**
     * 停全部：音量键长按、磁贴、悬浮球双击、通知栏停止都指这。
     * JS 道必须经 JsEngine.stop() 清 busy 释放 WebView，所以不能只遍历 Lane.stop()。
     */
    public static void stopAll() {
        get().stop();
        for (int i = 0; i < RunnerPool.JS_LANE; i++) {
            ScriptRunner l = Lanes.get(i);
            if (l.isBusy()) l.stop();
        }
    }

    /** 暂停全部（JS 道不参与暂停，v2.5 起的约定） */
    public static void pauseAll() {
        for (int i = 0; i < RunnerPool.JS_LANE; i++) Lanes.get(i).pause();
    }

    /** 恢复全部 */
    public static void resumeAll() {
        for (int i = 0; i < RunnerPool.JS_LANE; i++) Lanes.get(i).resume();
    }

    /** 停某一条会话（浮层条目上的停止键）；找不到（已收工）就算了 */
    public static void stopRun(long runId) {
        RunnerPool.Lane l = RunnerPool.get().findByRunId(runId);
        if (l == null) return;
        if (l instanceof ScriptRunner) {
            ScriptRunner sr = (ScriptRunner) l;
            if (sr == jsLane && get().isBusy()) get().stop();   // JS 道经 JsEngine 清 busy
            else sr.stop();
        }
    }

    /** 暂停⇄恢复某一条会话（浮层条目上的暂停键） */
    public static void togglePauseRun(long runId) {
        RunnerPool.Lane l = RunnerPool.get().findByRunId(runId);
        if (l instanceof ScriptRunner) ((ScriptRunner) l).togglePause();
    }
}
