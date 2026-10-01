package com.lazytap.clicker;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;
import android.widget.Toast;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** 内核服务：手势注入 + 操作录制 */
public class TapService extends AccessibilityService {

    private static volatile TapService instance;
    private int sw, sh;
    // 无障碍回调线程写、脚本引擎线程读，不加 volatile 可能一直读到旧包名
    private volatile String topPkg = "";
    private BroadcastReceiver sysRec;

    public static TapService get() {
        return instance;
    }

    /** 当前前台应用包名（供「如果当前是某 App」判断用） */
    public String topPkg() {
        return topPkg;
    }

    public static boolean alive() {
        return instance != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Prefs.init(this);
        ScriptStore.init(this);
        TplStore.init(this);
        measure();
        listenSystem();
    }

    /** 系统广播（插电 / 解锁）不走静态注册，跟着服务活着最稳 */
    private void listenSystem() {
        try {
            sysRec = new BroadcastReceiver() {
                @Override
                public void onReceive(android.content.Context c, Intent i) {
                    String a = i == null ? null : i.getAction();
                    if (a == null) return;
                    if (Intent.ACTION_POWER_CONNECTED.equals(a)) Trigger.fire(c, "power", "", "");
                    else if (Intent.ACTION_USER_PRESENT.equals(a)) Trigger.fire(c, "unlock", "", "");
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(Intent.ACTION_POWER_CONNECTED);
            f.addAction(Intent.ACTION_USER_PRESENT);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(sysRec, f, android.content.Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(sysRec, f);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        measure();
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags |= AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
            info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            // v2.2.0：音量键急停。要能收到按键必须带这个 flag，
            // 而且 accessibility_config.xml 里的 android:canRequestFilterKeyEvents 得是 true；
            // 少任何一个 onKeyEvent 一次都不会被调用 —— 不报错，纯粹静默失效，很难查。
            // （API 34 起 AccessibilityServiceInfo.canRequestFilterKeyEvents 字段已移除，只能走 XML）
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            // v2.4.0：想拿到 getViewIdResourceName()（控件 id）必须带这个 flag。
            // 不带它 id 恒为 null —— 不报错、不崩溃，就是按 id 找永远找不到，
            // 和上面音量键那次是同一类静默失效。（API 18 起就有，minSdk 24 不用做版本判断）
            info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            setServiceInfo(info);
        }
        // v2.7.0：多播注册。TapService 是常驻的权威消费者：把引擎事件转发进 Bus
        //（界面 / 浮层各自从 Bus 拿，不再由这里捎带刷新）。
        // 注意旧版靠「单 listener 后注册覆盖前注册」才没把事件双推给 WebView——
        // 多播后 MainActivity 不许再注册 ScriptRunner listener，只走 Bus 一条路。
        ScriptRunner.get().addListener((type, data) -> {
            Bus.emit(type, data);
            boolean running = false;
            try {
                running = "running".equals(new JSONObject(data).optString("state"));
            } catch (Throwable ignored) {
            }
            // v2.2.0：脚本一开跑就把运行浮层拉起来（不显示球），
            // 起不来（后台启动受限 / 没悬浮窗权限）就当没这功能，不影响跑脚本
            if (running && FloatService.get() == null && Prefs.getBool("runOverlay", true)) {
                FloatService.startRun(this);
            }
        });
        Bus.emit("service", "on");
        Trigger.scheduleAll(this); // 服务活了，把定时触发器排上
        resumeRecord();            // 之前在录制的话接着录
        if (FloatService.get() != null) FloatService.get().refresh();
    }

    @Override
    public void onDestroy() {
        if (sysRec != null) {
            try {
                unregisterReceiver(sysRec);
            } catch (Throwable ignored) {
            }
            sysRec = null;
        }
        instance = null;
        Bus.emit("service", "off");
        super.onDestroy();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    /**
     * v2.2.0：音量键当急停键 —— 手忙脚乱时不用满屏幕找停止按钮。
     *
     * <p>「有东西在跑」这条判断不能省：不然用户只是想调个音量，脚本就没了，
     * 还以为手机坏了。开关默认关着，设置里打开才生效。
     *
     * <p>返回 true 表示这一下按键被我们吃了，系统不会跟着调音量；
     * 其余情况一律交给 super，绝不多拦。
     */
    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        // v2.5.0 三态：引擎忙（跑着或暂停）→ 短按切暂停/恢复、长按急停；
        // 只有 JS 在跑 → 按一下急停；都没跑 → 放行，音量归系统管。
        String act = HotKey.action(event.getKeyCode(), HotKey.isDown(event.getAction()),
                event.getRepeatCount(), Prefs.getBool("volStop", false),
                ScriptRunner.get().isBusy(), JsEngine.get().isBusy());
        if (HotKey.TOGGLE.equals(act)) {
            ScriptRunner.get().togglePause();
            if (FloatService.get() != null) FloatService.get().refresh();
            return true;
        }
        if (HotKey.STOP.equals(act)) {
            ScriptRunner.get().stop();
            JsEngine.get().stop();
            ScriptRunner.get().note("按了" + HotKey.name(event.getKeyCode())
                    + (event.getRepeatCount() >= HotKey.LONG_AT ? "（长按）" : "") + "，急停");
            Bus.emit("status", "{\"state\":\"stopped\",\"extra\":\"vol\"}");   // v2.7.0：状态统一 JSON
            if (FloatService.get() != null) FloatService.get().refresh();
            return true;
        }
        return super.onKeyEvent(event);
    }

    private void measure() {
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            DisplayMetrics m = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(m);
            sw = m.widthPixels;
            sh = m.heightPixels;
        } catch (Throwable t) {
            sw = 1080;
            sh = 1920;
        }
    }

    public int screenW() {
        if (sw <= 0) measure();
        return sw;
    }

    public int screenH() {
        if (sh <= 0) measure();
        return sh;
    }

    // ---------- 手势 ----------

    public void tap(float x, float y, long dur) {
        Path p = new Path();
        p.moveTo(x, y);
        gesture(p, dur < 1 ? 1 : dur);
    }

    public void swipe(float x1, float y1, float x2, float y2, long ms) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        gesture(p, ms < 50 ? 50 : ms);
    }

    /** 多指手势：捏合 / 张开 / 双指齐点 / 双指按住 */
    public void multi(String mode, float cx, float cy, float r, long ms) {
        long d = ms < 60 ? 60 : ms;
        try {
            GestureDescription.Builder b = new GestureDescription.Builder();
            if ("pinch".equals(mode)) {
                b.addStroke(stroke(path(cx - r, cy, cx, cy), d));
                b.addStroke(stroke(path(cx + r, cy, cx, cy), d));
            } else if ("spread".equals(mode)) {
                b.addStroke(stroke(path(cx, cy, cx - r, cy), d));
                b.addStroke(stroke(path(cx, cy, cx + r, cy), d));
            } else if ("twoLong".equals(mode)) {
                b.addStroke(stroke(path(cx - r, cy, cx - r, cy), d));
                b.addStroke(stroke(path(cx + r, cy, cx + r, cy), d));
            } else {
                b.addStroke(stroke(path(cx - r, cy, cx - r, cy), 60));
                b.addStroke(stroke(path(cx + r, cy, cx + r, cy), 60));
            }
            dispatchGesture(b.build(), null, null);
        } catch (Throwable t) {
            Bus.emit("log", "多指手势失败：" + t.getMessage());
        }
    }

    /**
     * 把一批路径当成「多指」一次性派发出去，用于分组的「同时」模式。
     * 返回派发了几条；系统对手势条数有上限（多数机型 10 条），超了会被拒，所以调用前要自己夹。
     */
    public int strokes(List<Path> ps, long ms) {
        if (ps == null || ps.isEmpty()) return 0;
        long d = ms < 60 ? 60 : ms;
        try {
            GestureDescription.Builder b = new GestureDescription.Builder();
            for (Path p : ps) {
                if (p == null) continue;
                b.addStroke(new GestureDescription.StrokeDescription(p, 0, d));
            }
            return dispatchGesture(b.build(), null, null) ? ps.size() : 0;
        } catch (Throwable t) {
            Bus.emit("log", "多指手势失败：" + t.getMessage());
            return 0;
        }
    }

    /** 这台机器一次最多能派发几条手势（超出会被系统拒绝） */
    public static int maxStrokes() {
        return GestureDescription.getMaxStrokeCount();
    }

    private static Path path(float x1, float y1, float x2, float y2) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        return p;
    }

    private static GestureDescription.StrokeDescription stroke(Path p, long ms) {
        return new GestureDescription.StrokeDescription(p, 0, ms);
    }

    private void gesture(Path p, long ms) {
        try {
            ScriptRunner.gesture(this, p, ms);
        } catch (Throwable t) {
            Bus.emit("log", "手势失败：" + t.getMessage());
        }
    }

    /**
     * @return 是否真的做成了。v2.3.0 以前返回 void，调用方一律 log("按了 xxx")，
     *         于是「锁屏」在 Android 9 以下（GLOBAL_ACTION_LOCK_SCREEN 是 API 28 才有的）
     *         什么都没干，日志却写着「按了 lock」——按日志排查的人会怀疑人生。
     */
    public boolean globalAction(String k) {
        switch (k) {
            case "back":
                return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home":
                return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents":
                return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notif":
                return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quick":
                return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            case "lock":
                if (Build.VERSION.SDK_INT < 28) return false;
                return performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
            case "power":
                return performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
            case "split":
                if (Build.VERSION.SDK_INT < 24) return false;
                return performGlobalAction(GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN);
            default:
                return performGlobalAction(GLOBAL_ACTION_BACK);
        }
    }

    /** 按键没生效时给人话原因，别只甩一句「失败」 */
    public static String keyHint(String k) {
        if ("lock".equals(k)) return "锁屏要 Android 9 以上";
        if ("split".equals(k)) return "分屏要 Android 7 以上";
        if ("power".equals(k)) return "电源菜单被系统拦了";
        return "系统没接这个键";
    }

    public boolean inputText(String s) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        AccessibilityNodeInfo target = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (target == null || !target.isEditable()) {
            target = firstEditable(root);
        }
        boolean ok = false;
        if (target != null) {
            if (!target.isFocused()) target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            Bundle args = ScriptRunner.textBundle(s);
            ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            target.recycle();
        }
        root.recycle();
        return ok;
    }

    private AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isEditable()) return node;
        int n = node.getChildCount();
        for (int i = 0; i < n; i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            AccessibilityNodeInfo r = firstEditable(c);
            if (r != null) {
                if (c != null && r != c) c.recycle();
                return r;
            }
            if (c != null) c.recycle();
        }
        return null;
    }

    public boolean launch(String pkg) {
        if (TextUtils.isEmpty(pkg)) return false;
        try {
            Intent it = getPackageManager().getLaunchIntentForPackage(pkg);
            if (it == null) return false;
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(it);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 按文字 / 描述查找节点，nth 从 1 开始（v2.3.0 的老签名，行为不变） */
    public AccessibilityNodeInfo findNode(String text, boolean contains, boolean clickableOnly, int nth) {
        return findNode(NodeMatch.of(text, contains), clickableOnly, nth);
    }

    /**
     * 按一组条件查找节点，nth 从 1 开始。
     * 条件怎么算命中全在 NodeMatch 里（四路取「且」），这里只管遍历树和回收。
     */
    public AccessibilityNodeInfo findNode(NodeMatch q, boolean clickableOnly, int nth) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        List<AccessibilityNodeInfo> hits = new ArrayList<>();
        collect(root, q, clickableOnly, hits, 0, NodeMatch.capFor(nth));
        if (hits.size() >= nth && nth > 0) {
            AccessibilityNodeInfo want = hits.get(nth - 1);
            for (int i = 0; i < hits.size(); i++) {
                if (i != nth - 1) hits.get(i).recycle();
            }
            return want;
        }
        for (AccessibilityNodeInfo n : hits) n.recycle();
        return null;
    }

    private void collect(AccessibilityNodeInfo node, NodeMatch q, boolean clickableOnly,
                         List<AccessibilityNodeInfo> hits, int depth, int cap) {
        // cap 而不是写死的 40：以前一页里第 41 个往后永远取不到，
        // index 填大了就静默失效。capFor(nth) 保证要第几个就至少攒够几个。
        if (node == null || depth > 22 || hits.size() >= cap) return;
        boolean match = q.matches(node.getText(), node.getContentDescription(),
                node.getViewIdResourceName());
        if (match && (!clickableOnly || node.isClickable())) {
            hits.add(AccessibilityNodeInfo.obtain(node));
        }
        int n = node.getChildCount();
        for (int i = 0; i < n; i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            collect(c, q, clickableOnly, hits, depth + 1, cap);
            if (c != null) c.recycle();
        }
    }

    // ---------- 录制 ----------
    // 两条通道：
    //  A 无障碍事件 —— 能拿到界面节点时最准，但游戏 / 自绘 UI / WebView 常常不给节点；
    //  B 触点捕获   —— 用一个 1×1 的透明悬浮窗监听屏幕触点，不依赖节点，任何界面都录得上。
    //  B 生效时以 B 为准，A 只补充“开应用 / 输入文字”这类语义动作，避免重复。

    private volatile boolean recording;
    private volatile long lastEventTime;
    private volatile String lastPkg = "";
    private volatile String lastSig = "";
    private volatile boolean touchOn;      // 触点捕获是否真的生效
    private volatile boolean touchConfirmed; // 捕获窗是否真的挂上了
    private volatile long lastHint;        // 提示节流

    private static final long TOUCH_IDLE = 300;   // 手指静止多久算一次操作结束
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable flushRun = new Runnable() {
        @Override
        public void run() {
            flushTouch();
        }
    };
    private long touchStart, lastTouchT;
    private float tx0, ty0, tx1, ty1;
    private int touchN;
    private boolean touchMoved;

    public boolean isRecording() {
        return recording;
    }

    public boolean touchOn() {
        return touchOn;
    }

    public void startRecord() {
        ScriptStore.clearRecording();
        recording = true;
        Prefs.put("recordingOn", true);
        lastEventTime = System.currentTimeMillis();
        lastPkg = "";
        lastSig = "";
        resetTouch();
        boolean t = false;
        try {
            t = Prefs.getBool("touchRecord", true) && startTouch();
        } catch (Throwable ignored) {
        }
        touchOn = t;
        ScriptRunner.get().note(t
                ? "开始录制：触点捕获已开，任意界面都能录"
                : "开始录制：触点捕获没开（需悬浮窗权限），只能录有节点的界面");
        // 兜底：1.5 秒内捕获窗没真的挂上，就退回无障碍通道，绝不让两条通道同时哑火
        if (t) {
            touchConfirmed = false;
            ui.postDelayed(() -> {
                if (!recording) return;
                if (!touchConfirmed) {
                    touchOn = false;
                    ScriptRunner.get().note("触点捕获没挂上，退回无障碍通道（只能录有节点的界面）");
                    if (FloatService.get() != null) FloatService.get().refresh();
                }
            }, 1500);
        }
        Bus.emit("record", "start");
        if (FloatService.get() != null) FloatService.get().refresh();
        uiToast("开始录制，随便点，我看着呢");
    }

    public void stopRecord() {
        recording = false;
        Prefs.put("recordingOn", false);
        ui.removeCallbacks(flushRun);
        flushTouch();
        touchOn = false;
        FloatService fs = FloatService.get();
        if (fs != null) {
            fs.stopTouchCapture();
            if (fs.touchOnly()) {
                try {
                    fs.stopSelf();
                } catch (Throwable ignored) {
                }
            } else {
                fs.refresh();
            }
        }
        Bus.emit("record", "stop");
        ScriptRunner.get().note("录完了，共 " + ScriptStore.recording().length() + " 步");
        uiToast("录完了，共 " + ScriptStore.recording().length() + " 步");
    }

    public void toggleRecord() {
        if (recording) stopRecord();
        else startRecord();
    }

    /** 服务被系统重启后，接着录 */
    private void resumeRecord() {
        if (!Prefs.getBool("recordingOn", false)) return;
        recording = true;
        lastEventTime = System.currentTimeMillis();
        resetTouch();
        try {
            touchOn = Prefs.getBool("touchRecord", true) && startTouch();
        } catch (Throwable ignored) {
            touchOn = false;
        }
        ScriptRunner.get().note("录制被系统打断，已接着录");
        if (FloatService.get() != null) FloatService.get().refresh();
    }

    private boolean startTouch() {
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) return false;
        FloatService fs = FloatService.get();
        if (fs != null) {
            fs.startTouchCapture();
            return true;
        }
        FloatService.startTouch(this);
        return true;
    }

    /** 悬浮窗那边确认捕获窗真的加上了，才把通道 B 点亮 */
    void setTouchActive(boolean on) {
        if (on) touchConfirmed = true;
        touchOn = on && recording;
    }

    private void resetTouch() {
        touchN = 0;
        touchMoved = false;
        touchStart = 0;
        lastTouchT = 0;
        ui.removeCallbacks(flushRun);
    }

    /** 悬浮窗回调：屏幕上的一次触点（ACTION_OUTSIDE） */
    static void onTouchSample(float x, float y, long t) {
        TapService s = get();
        if (s != null) s.touchSample(x, y, t);
    }

    private void touchSample(float x, float y, long t) {
        if (!recording) return;
        long now = t > 0 ? t : System.currentTimeMillis();
        long dt = now - lastTouchT;
        float sx = x - tx1, sy = y - ty1;
        float step = (float) Math.sqrt(sx * sx + sy * sy);
        // 同一次操作的判据：① 采样很密（滑动连报）② 间隔不长且每步位移不大
        // ③ 手指按住不动（很多机型长按不再上报，用“原地 + 已经按住一会儿”续上）
        boolean keep = touchN > 0 && (dt <= 60
                || (dt <= TOUCH_IDLE && step <= 36)
                || (step < 20 && (lastTouchT - touchStart) >= 400 && dt <= 900));
        if (!keep) { // 新的一次操作
            flushTouch();
            tx0 = x;
            ty0 = y;
            touchStart = now;
            touchN = 1;
            touchMoved = false;
        } else {
            touchN++;
            if (Math.abs(x - tx0) > 36 || Math.abs(y - ty0) > 36) touchMoved = true;
        }
        tx1 = x;
        ty1 = y;
        lastTouchT = now;
        ui.removeCallbacks(flushRun);
        ui.postDelayed(flushRun, TOUCH_IDLE);
    }

    /** 手指离开（或静止够久）→ 判定这一步是点 / 长按 / 滑动 */
    private void flushTouch() {
        if (touchN == 0) return;
        touchN = 0;
        long dur = Math.max(0, lastTouchT - touchStart);
        float dx = tx1 - tx0, dy = ty1 - ty0;
        float dist = (float) Math.sqrt(dx * dx + dy * dy);
        JSONObject a = new JSONObject();
        try {
            long gap = System.currentTimeMillis() - lastEventTime;
            if (touchMoved && dist > 36) {
                a.put("t", "swipe");
                a.put("x1", Math.round(tx0));
                a.put("y1", Math.round(ty0));
                a.put("x2", Math.round(tx1));
                a.put("y2", Math.round(ty1));
                a.put("ms", Math.max(120, Math.min(3000, dur)));
            } else if (dur >= 600) {
                a.put("t", "long");
                a.put("x", Math.round(tx0));
                a.put("y", Math.round(ty0));
                a.put("ms", Math.max(600, Math.min(3000, dur)));
            } else {
                a.put("t", "click");
                a.put("x", Math.round(tx0));
                a.put("y", Math.round(ty0));
            }
            a.put("d", autoDelay(gap));
            a.put("note", "触点");
        } catch (Exception ignored) {
        }
        push(a);
    }

    private void uiToast(String s) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            toast(s);
        } else {
            ui.post(() -> toast(s));
        }
    }

    private void toast(String s) {
        try {
            Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            CharSequence pn = event.getPackageName();
            if (pn != null) topPkg = pn.toString();
        } else if (type == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            Trigger.onNotify(this, event);
        }
        if (!recording) return;
        if (type == AccessibilityEvent.TYPE_VIEW_CLICKED
                || type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) {
            boolean isLong = type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED;
            AccessibilityNodeInfo src = event.getSource();
            if (touchOn) {
                // 触点通道已经录下坐标，这里只借语义：把刚那一步改成长按
                if (isLong && src != null) {
                    Rect rl = new Rect();
                    src.getBoundsInScreen(rl);
                    src.recycle();
                    if (rl.width() > 0 && rl.height() > 0) markLong(rl.centerX(), rl.centerY());
                } else if (src != null) {
                    src.recycle();
                }
                return;
            }
            if (src == null) {
                hintNoNode();
                return;
            }
            Rect r = new Rect();
            src.getBoundsInScreen(r);
            src.recycle();
            if (r.width() <= 0 || r.height() <= 0) return;
            int cx = r.centerX(), cy = r.centerY();
            long gap = System.currentTimeMillis() - lastEventTime;
            String sig = type + ":" + cx + "," + cy;
            if (sig.equals(lastSig) && gap < 400) return; // 同一点的手抖，忽略
            lastSig = sig;
            JSONObject a = new JSONObject();
            try {
                a.put("t", type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED ? "long" : "click");
                a.put("x", cx);
                a.put("y", cy);
                if (type == AccessibilityEvent.TYPE_VIEW_LONG_CLICKED) a.put("ms", 800);
                a.put("d", autoDelay(gap));
                a.put("note", event.getPackageName());
            } catch (Exception ignored) {
            }
            push(a);
        } else if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            CharSequence pn = event.getPackageName();
            if (pn == null || pn.toString().equals(lastPkg)) return;
            lastPkg = pn.toString();
            if ("com.lazytap.clicker".equals(lastPkg)) return;
            JSONObject a = new JSONObject();
            try {
                a.put("t", "launch");
                a.put("p", lastPkg);
                a.put("d", autoDelay(System.currentTimeMillis() - lastEventTime));
                a.put("note", lastPkg);
            } catch (Exception ignored) {
            }
            push(a);
        } else if (type == AccessibilityEvent.TYPE_VIEW_SCROLLED && !touchOn) {
            // 触点通道不可用时的兜底：滚动事件只能知道方向与大致位置，记成一次滑动
            AccessibilityNodeInfo src = event.getSource();
            if (src == null) return;
            Rect r = new Rect();
            src.getBoundsInScreen(r);
            src.recycle();
            if (r.width() <= 0 || r.height() <= 0) return;
            int cx = r.centerX(), cy = r.centerY();
            int dx = event.getScrollX(), dy = event.getScrollY();
            if (dx == 0 && dy == 0) return;
            long gap = System.currentTimeMillis() - lastEventTime;
            JSONObject a = new JSONObject();
            try {
                a.put("t", "swipe");
                a.put("x1", cx + dx);
                a.put("y1", cy + dy);
                a.put("x2", cx);
                a.put("y2", cy);
                a.put("ms", 300);
                a.put("d", autoDelay(gap));
                a.put("note", "滚动");
            } catch (Exception ignored) {
            }
            push(a);
        } else if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            CharSequence txt = event.getText() == null || event.getText().isEmpty()
                    ? null : event.getText().get(0);
            if (txt == null || txt.length() == 0) return;
            JSONObject a = new JSONObject();
            try {
                a.put("t", "text");
                a.put("s", txt.toString());
                a.put("d", 300);
                a.put("note", "输入");
            } catch (Exception ignored) {
            }
            // 连续输入只保留最后一条，避免刷屏
            JSONArray arr = ScriptStore.recording();
            if (arr.length() > 0) {
                JSONObject last = arr.optJSONObject(arr.length() - 1);
                if (last != null && "text".equals(last.optString("t"))) {
                    arr.remove(arr.length() - 1);
                }
            }
            push(a);
        }
    }

    /** 无障碍通道确认这是一次长按：把触点通道刚记下的那一步改成长按 */
    private void markLong(int cx, int cy) {
        JSONArray arr = ScriptStore.recording();
        if (arr.length() == 0) return;
        JSONObject last = arr.optJSONObject(arr.length() - 1);
        if (last == null || !"click".equals(last.optString("t"))) return;
        if (Math.abs(last.optInt("x", -9999) - cx) > 60) return;
        if (Math.abs(last.optInt("y", -9999) - cy) > 60) return;
        try {
            last.put("t", "long");
            last.put("ms", 800);
        } catch (Exception ignored) {
        }
        ScriptStore.saveRecording(arr);
        Bus.emit("recordAction", last.toString());
        if (FloatService.get() != null) FloatService.get().refresh();
    }

    /** 拿不到节点时给个提示，别让用户以为录制坏了（4 秒最多一次） */
    private void hintNoNode() {
        long now = System.currentTimeMillis();
        if (now - lastHint < 4000) return;
        lastHint = now;
        ScriptRunner.get().note("这个界面不给节点，坐标抓不到；开悬浮窗权限可用触点录制");
    }

    /** 录制时把真实操作间隔记下来，回放才像人 */
    private long autoDelay(long gap) {
        if (!Prefs.getBool("autoRecordDelay", true)) return 500;
        long d = gap < 120 ? 200 : Math.min(gap, 5000);
        return d;
    }

    private void push(JSONObject a) {
        lastEventTime = System.currentTimeMillis();
        ScriptStore.addRecordAction(a);
        Bus.emit("recordAction", a.toString());
        if (FloatService.get() != null) FloatService.get().refresh();
    }

    @Override
    public void onInterrupt() {
    }

    /** 判断是否已在系统设置里开启（用于 UI 提示，不依赖服务自身实例） */
    public static boolean enabled(android.content.Context c) {
        try {
            int ok = Settings.Secure.getInt(c.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED);
            if (ok != 1) return false;
            String list = Settings.Secure.getString(c.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (list == null) return false;
            ComponentName me = new ComponentName(c, TapService.class);
            return list.contains(me.flattenToString()) || list.contains(me.flattenToShortString());
        } catch (Throwable t) {
            return false;
        }
    }
}
