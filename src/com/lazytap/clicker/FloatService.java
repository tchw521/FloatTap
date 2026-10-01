package com.lazytap.clicker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.LinearGradient;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** 悬浮球服务：常驻前台，负责单击/双击/三击/长按与脚本面板 */
public class FloatService extends Service {

    public static final String A_SHOW = "show";
    public static final String A_HIDE = "hide";
    public static final String A_STOP = "stop";
    public static final String A_TOUCH = "touch";
    public static final String A_RUN = "run";   // v2.2.0：只为运行浮层而活

    private static volatile FloatService instance;

    public static FloatService get() {
        return instance;
    }

    private WindowManager wm;
    private BallView ball;
    private WindowManager.LayoutParams ballParams;
    private View panel;
    private View bar;
    private View touchView;   // 1×1 抓触点的小窗
    private boolean touchOnly; // 只为录制而活着
    private boolean runOnly;   // v2.2.0：只为运行浮层而活着
    private TextView barCount;
    private final Handler h = new Handler(Looper.getMainLooper());
    private int clicks;
    private long lastTap;
    private Runnable tapRun;

    // ---------- v2.2.0 运行浮层（v2.7.0 起支持多条：每个运行会话一根） ----------
    /** 活着的状态条，key = 运行会话 runId。上限 MAX_BARS，超过的不显示 */
    private final java.util.HashMap<Long, RunBarBox> runBars = new java.util.HashMap<>();
    /** 浮层最多同时显示几根（v3.0.0 并行前的形状预留） */
    private static final int MAX_BARS = 3;
    private boolean runDismissed;   // 本次运行里手动收起了，下次开跑再出来
    private boolean lastBusy;
    /** v2.7.0：Bus 订阅句柄（状态变化刷新自己），onDestroy 反注册 */
    private Bus.Sink busSink;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        Prefs.init(this);
        ScriptStore.init(this);
        TplStore.init(this);
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        startInForeground();
        // v2.7.0：浮层自己订阅 Bus（状态一变刷自己），不再靠 MainActivity 捎带
        busSink = (type, data) -> refresh();
        Bus.addSink(busSink);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? A_SHOW : intent.getAction();
        if (A_TOUCH.equals(a)) {
            // 只为录制抓触点而起来，不显示球；录完自己收工
            if (ball == null) touchOnly = true;
            startTouchCapture();
        } else if (A_HIDE.equals(a)) hideBall();
        else if (A_STOP.equals(a)) {
            JsEngine.stopAll();   // v3.0.0：通知栏急停=停全部（含 JS 道清 busy）
            toast("已刹车");
            refresh();
        } else if (A_RUN.equals(a)) {
            // v2.2.0：只为运行浮层起来，不显示球；脚本停了自己收工
            if (ball == null) runOnly = true;
            refresh();
        } else showBall();
        return START_STICKY;
    }

    /** 运行浮层自己拉起服务（不显示球）。起不来就算了，浮层只是锦上添花 */
    public static void startRun(Context c) {
        if (instance != null) {
            instance.refresh();
            return;
        }
        if (Build.VERSION.SDK_INT >= 23 && !android.provider.Settings.canDrawOverlays(c)) return;
        Intent i = new Intent(c, FloatService.class);
        i.setAction(A_RUN);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable ignored) {
        }
    }

    public static void show(Context c) {
        Intent i = new Intent(c, FloatService.class);
        i.setAction(A_SHOW);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    public static void hide(Context c) {
        Intent i = new Intent(c, FloatService.class);
        i.setAction(A_HIDE);
        c.startService(i);
    }

    /** 录制用：只为抓触点起服务。必须在前台（用户刚点按钮）时调用 */
    public static void startTouch(Context c) {
        Intent i = new Intent(c, FloatService.class);
        i.setAction(A_TOUCH);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable t) {
            try {
                c.startService(i);
            } catch (Throwable ignored) {
            }
        }
    }

    private void startInForeground() {
        String chId = "lazytap";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(chId, getString(R.string.notify_channel),
                    NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Intent it = new Intent(this, MainActivity.class);
        int pf = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(this, 2, it, pf | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, chId);
        } else {
            b = new Notification.Builder(this);
        }
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.notify_text))
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE);
        Intent stopIt = new Intent(this, FloatService.class).setAction(A_STOP);
        PendingIntent psi = PendingIntent.getService(this, 3, stopIt, pf | PendingIntent.FLAG_UPDATE_CURRENT);
        b.addAction(new Notification.Action.Builder(R.drawable.ic_stat, "停止", psi).build());
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE);
            } else {
                startForeground(7, n);
            }
        } catch (Throwable t) {
            startForeground(7, n);
        }
    }

    public void showBall() {
        Prefs.put("ballVisible", true);
        if (ball != null) {
            refresh();
            return;
        }
        ball = new BallView(this);
        int size = dp(Prefs.getInt("ballSize", 54));
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        ballParams = new WindowManager.LayoutParams(size, size, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        ballParams.gravity = Gravity.TOP | Gravity.LEFT;
        int x = Prefs.getInt("ballX", -1);
        int y = Prefs.getInt("ballY", -1);
        int sw = getResources().getDisplayMetrics().widthPixels;
        int sh = getResources().getDisplayMetrics().heightPixels;
        ballParams.x = x < 0 ? sw - size - dp(8) : Math.min(x, sw - size);
        ballParams.y = y < 0 ? (int) (sh * 0.45) : Math.min(y, sh - size - dp(8));
        try {
            wm.addView(ball, ballParams);
            refresh();
        } catch (Throwable t) {
            Toast.makeText(this, R.string.need_overlay, Toast.LENGTH_LONG).show();
            ball = null;
        }
    }

    public void hideBall() {
        Prefs.put("ballVisible", false);
        closePanel();
        if (ball != null) {
            try {
                wm.removeView(ball);
            } catch (Throwable ignored) {
            }
            ball = null;
        }
    }

    /**
     * 刷新悬浮球与录制条的显示。
     * 脚本引擎的日志/状态回调是从它自己的线程（lazytap-run）发出来的，
     * 而这里会 new View 并 add 到 WindowManager —— 在后台线程加了 View，
     * 之后主线程 removeView 时会抛「Only the original thread that created a view hierarchy
     * can touch its views」直接崩。所以不在主线程就扔回主线程再做。
     */
    public void refresh() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            doRefresh();
        } else {
            h.post(this::doRefresh);
        }
    }

    private void doRefresh() {
        if (ball != null) ball.invalidate();
        syncRecordBar();
        syncRunBar();
        maybeRetire();
    }

    /**
     * 只为某个临时任务（录制抓点 / 运行浮层）而起来的服务，任务一结束就该走人，
     * 别在通知栏里赖着。判断条件是「一个 View 都不剩」，而不是只看某个标志位。
     */
    private void maybeRetire() {
        if (ball != null || bar != null || !runBars.isEmpty() || touchView != null) return;
        if (!runOnly && !touchOnly) return;
        runOnly = false;
        touchOnly = false;
        try {
            stopSelf();
        } catch (Throwable ignored) {
        }
    }

    // ---------- 录制悬浮条 ----------

    private void syncRecordBar() {
        boolean rec = TapService.get() != null && TapService.get().isRecording();
        if (rec && bar == null) showRecordBar();
        else if (!rec && bar != null) hideRecordBar();
        if (rec && barCount != null) {
            barCount.setText("● " + ScriptStore.recording().length() + " 步");
        }
    }

    private void showRecordBar() {
        if (bar != null) return;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setBackground(new RoundBg(dp(14), Color.parseColor("#EEFFFFFF")));
        root.setPadding(dp(8), dp(5), dp(8), dp(5));
        barCount = new TextView(this);
        barCount.setText("● 0 步");
        barCount.setTextColor(Color.parseColor("#E74C3C"));
        barCount.setTextSize(13);
        barCount.setPadding(dp(6), dp(4), dp(8), dp(4));
        root.addView(barCount);
        root.addView(barBtn("⏹ 停止", () -> {
            if (TapService.get() != null) TapService.get().stopRecord();
        }));
        root.addView(barBtn("⏱ +2s", () -> {
            try {
                JSONObject a = new JSONObject();
                a.put("t", "wait");
                a.put("ms", 2000);
                a.put("d", 0);      // 等待时长以 ms 为准，引擎取 max(ms, d)；写 300 会让「+2s」变成 2.3s
                a.put("note", "手动等待");
                ScriptStore.addRecordAction(a);
                Bus.emit("recordAction", a.toString());
                refresh();
            } catch (Exception ignored) {
            }
        }));
        root.addView(barBtn("↩ 撤销", () -> {
            ScriptStore.removeLastRecordAction();
            Bus.emit("recordAction", "");
            refresh();
        }));

        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.y = dp(6);
        bar = root;
        try {
            wm.addView(bar, lp);
        } catch (Throwable t) {
            bar = null;
        }
    }

    private TextView barBtn(String text, Runnable r) {
        return barBtn(text, "#E74C3C", r);
    }

    private TextView barBtn(String text, String color, Runnable r) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTextSize(12.5f);
        t.setPadding(dp(9), dp(6), dp(9), dp(6));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(color));
        g.setCornerRadius(dp(10));
        t.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(3), 0, dp(3), 0);
        t.setLayoutParams(lp);
        t.setOnClickListener(v -> r.run());
        return t;
    }

    // ---------- 触点捕获（录制通道 B） ----------

    public boolean touchOnly() {
        return touchOnly && ball == null;
    }

    /** 1×1 透明窗 + WATCH_OUTSIDE_TOUCH：不挡操作，却能拿到屏幕触点的绝对坐标 */
    public void startTouchCapture() {
        if (touchView != null) {
            if (TapService.get() != null) TapService.get().setTouchActive(true);
            return;
        }
        if (Build.VERSION.SDK_INT >= 23 && !android.provider.Settings.canDrawOverlays(this)) {
            if (TapService.get() != null) TapService.get().setTouchActive(false);
            return;
        }
        View v = new View(this);
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(1, 1, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSPARENT);
        lp.gravity = Gravity.TOP | Gravity.LEFT;
        lp.x = 0;
        lp.y = 0;
        v.setOnTouchListener((vv, ev) -> {
            if (ev.getAction() == MotionEvent.ACTION_OUTSIDE) {
                TapService.onTouchSample(ev.getRawX(), ev.getRawY(), ev.getEventTime());
            }
            return false;
        });
        try {
            wm.addView(v, lp);
            touchView = v;
            if (TapService.get() != null) TapService.get().setTouchActive(true);
        } catch (Throwable t) {
            touchView = null;
            if (TapService.get() != null) TapService.get().setTouchActive(false);
        }
    }

    public void stopTouchCapture() {
        if (touchView != null) {
            try {
                wm.removeView(touchView);
            } catch (Throwable ignored) {
            }
            touchView = null;
        }
        if (TapService.get() != null) TapService.get().setTouchActive(false);
    }

    private void hideRecordBar() {
        if (bar != null) {
            try {
                wm.removeView(bar);
            } catch (Throwable ignored) {
            }
            bar = null;
            barCount = null;
        }
    }

    // ---------- v2.2.0 运行浮层 ----------

    /**
     * 脚本跑起来时贴一根可拖拽的状态条：脚本名 + 第几步 + 已跑多久 + 停止。
     * 和悬浮球是两回事 —— 球负责「叫人干活」，这条负责「告诉你活干到哪了」，
     * 所以它能拖到任意位置，也能单独收起。
     */
    private void syncRunBar() {
        boolean busy = !RunSlot.ACTIVE.isEmpty();
        if (busy && !lastBusy) runDismissed = false;  // 新一轮开始，上一次的「收起」作废
        lastBusy = busy;
        boolean want = busy && !runDismissed && Prefs.getBool("runOverlay", true);
        if (!want) {
            hideRunBar();
            return;
        }
        // v2.7.0：按注册表快照对齐——结束的会话收条，新会话各建一条（最多 MAX_BARS）
        java.util.ArrayList<RunSlot> slots = new java.util.ArrayList<>(RunSlot.ACTIVE);
        for (Long id : new java.util.ArrayList<>(runBars.keySet())) {
            boolean alive = false;
            for (RunSlot s : slots) if (s.runId == id) { alive = true; break; }
            if (!alive) {
                RunBarBox b = runBars.remove(id);
                if (b != null) b.remove();
            }
        }
        int shown = 0;
        for (RunSlot s : slots) {
            if (shown >= MAX_BARS) break;
            RunBarBox b = runBars.get(s.runId);
            if (b == null) {
                b = new RunBarBox(s.runId, shown);
                runBars.put(s.runId, b);
                b.add();
            }
            b.update(s);
            shown++;
        }
        if (!runBars.isEmpty()) {
            h.removeCallbacks(runTick);
            h.postDelayed(runTick, 500);   // 时长与进度自己走，不用每次动作都刷新
        }
    }

    /**
     * 一条状态条：视图、窗口参数、文本引用、拖拽状态全在一起，
     * 生命周期跟一个运行会话（RunSlot）绑定——会话结束条就收。
     * 拖拽与位置记忆沿用旧版：第 1 条记住位置（runX/runY），其余条纵向错开。
     */
    private class RunBarBox {
        final long runId;
        final LinearLayout root;
        final TextView name, prog, pauseBtn;
        final WindowManager.LayoutParams params;
        final int baseX, baseY;          // 未拖拽时的初始位置（第 1 条来自记忆）
        final boolean js;                // JS 会话没有暂停键（v2.5.0 起的约定）
        int idx;                         // 第几根（0 起）
        volatile RunSlot slot;           // 正在显示的槽（tick 刷新用）
        private float sx, sy;            // 拖拽起点
        private int px, py;              // 拖拽前的窗口位置
        private boolean moved;

        RunBarBox(long runId, int idx) {
            this.runId = runId;
            this.idx = idx;
            RunSlot s = findSlot(runId);
            this.js = s != null && s.js;

            root = new LinearLayout(FloatService.this);
            root.setOrientation(LinearLayout.HORIZONTAL);
            root.setBackground(new RoundBg(dp(16), Color.parseColor("#F0161418"),
                    Color.parseColor("#55FFFFFF")));
            root.setPadding(dp(4), dp(4), dp(6), dp(4));

            // 左边这一块是拖拽区：里面的 TextView 不可点，不会跟拖拽抢事件
            LinearLayout zone = new LinearLayout(this.root.getContext());
            zone.setOrientation(LinearLayout.VERTICAL);
            zone.setPadding(dp(10), dp(5), dp(8), dp(5));
            name = new TextView(FloatService.this);
            name.setTextColor(Color.WHITE);
            name.setTypeface(Typeface.DEFAULT_BOLD);
            name.setTextSize(13f);
            name.setSingleLine(true);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            prog = new TextView(FloatService.this);
            prog.setTextColor(Color.parseColor("#C8FFFFFF"));
            prog.setTextSize(11.5f);
            zone.addView(name);
            zone.addView(prog);
            root.addView(zone);
            // v2.5.0：暂停⇄恢复。JS 脚本跑着时这个按钮会被藏起来（JS 暂不支持暂停）
            pauseBtn = barBtn("⏸ 暂停", "#F39C12", () -> {
                JsEngine.togglePauseRun(runId);   // v3.0.0：暂停的是自己这条会话
                refresh();
            });
            root.addView(pauseBtn);
            root.addView(barBtn("■ 停止", () -> {
                // v3.0.0：停自己这条会话（JS 道内部会经 JsEngine 清 busy）
                JsEngine.stopRun(runId);
                toast("已刹车");
                refresh();
            }));
            root.addView(barBtn("✕", "#55FFFFFF", () -> {
                runDismissed = true;
                hideRunBar();
                toast("状态条收起了，下一轮会自己回来");
            }));

            // 窗口参数先于拖拽 listener 初始化——final 字段没赋值前，lambda 捕获它编译不过
            int type = Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;
            params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.LEFT;
            int sw = getResources().getDisplayMetrics().widthPixels;
            int sh = getResources().getDisplayMetrics().heightPixels;
            int rx = Prefs.getInt("runX", -1);
            int ry = Prefs.getInt("runY", -1);
            baseX = rx < 0 ? dp(14) : Math.min(rx, Math.max(0, sw - dp(90)));
            baseY = ry < 0 ? (int) (sh * 0.20) : ry;
            params.x = baseX;
            params.y = baseY + idx * dp(52);   // 多条纵向错开，别叠在一起

            zone.setOnTouchListener((v, ev) -> {
                switch (ev.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = ev.getRawX();
                        sy = ev.getRawY();
                        px = params.x;
                        py = params.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = ev.getRawX() - sx, dy = ev.getRawY() - sy;
                        if (!moved && Math.abs(dx) + Math.abs(dy) > dp(6)) moved = true;
                        if (moved) {
                            params.x = (int) (px + dx);
                            params.y = (int) (py + dy);
                            try {
                                wm.updateViewLayout(root, params);
                            } catch (Throwable ignored) {
                            }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        if (moved) {
                            clamp();
                            return true;
                        }
                        // 没拖动就当点了状态条：把界面叫回来
                        startActivity(new Intent(FloatService.this, MainActivity.class)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                        | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                        return true;
                }
                return false;
            });
        }

        void add() {
            try {
                wm.addView(root, params);
            } catch (Throwable t) {
                runBars.remove(runId);
            }
        }

        void remove() {
            try {
                wm.removeView(root);
            } catch (Throwable ignored) {
            }
        }

        /** 按槽刷文案：状态与进度都从槽来（旧版读单例散字段，JS 只能显示「JS 脚本」） */
        void update(RunSlot s) {
            slot = s;
            String nm = s.scriptName().isEmpty() ? "脚本" : s.scriptName();
            String pr;
            if ("paused".equals(s.state())) {
                // v2.5.0：暂停要一眼看出来，别让用户以为脚本还在跑
                nm = "⏸ " + nm;
                pr = "已暂停 · 点「▶ 恢复」或音量键短按继续";
            } else if (!s.js) {
                nm = "🏃 " + nm;
                pr = s.progTotal() > 0 ? ("第 " + s.progCur() + "/" + s.progTotal() + " 步") : "刚起步";
            } else {
                nm = "🏃 " + nm;
                pr = "运行中";
            }
            long sec = s.elapsed() / 1000;
            pr += " · 已跑 " + (sec >= 60 ? (sec / 60) + "分" + (sec % 60) + "秒" : sec + "秒");
            name.setText(nm);
            prog.setText(pr);
            if (pauseBtn != null) {
                // 引擎槽才显示暂停键；JS 会话藏起来——v2.5.0 不暂停 JS
                pauseBtn.setVisibility(js ? View.GONE : View.VISIBLE);
                pauseBtn.setText("paused".equals(s.state()) ? "▶ 恢复" : "⏸ 暂停");
            }
        }

        /** 拖完夹回屏幕内；只有第 1 条记忆位置 */
        private void clamp() {
            int sw = getResources().getDisplayMetrics().widthPixels;
            int sh = getResources().getDisplayMetrics().heightPixels;
            int w = root.getWidth(), hh = root.getHeight();
            params.x = Math.max(0, Math.min(params.x, Math.max(0, sw - w)));
            params.y = Math.max(0, Math.min(params.y, Math.max(0, sh - hh)));
            if (idx == 0) {
                Prefs.put("runX", params.x);
                Prefs.put("runY", params.y);
            }
            try {
                wm.updateViewLayout(root, params);
            } catch (Throwable ignored) {
            }
        }
    }

    private RunSlot findSlot(long runId) {
        for (RunSlot s : RunSlot.ACTIVE) if (s.runId == runId) return s;
        return null;
    }

    /** 收掉全部状态条（「✕ 收起」与服务销毁用） */
    private void hideRunBar() {
        h.removeCallbacks(runTick);
        for (RunBarBox b : runBars.values()) b.remove();
        runBars.clear();
    }

    /** 半秒刷一次「第几步 / 已跑多久」 */
    private final Runnable runTick = new Runnable() {
        @Override
        public void run() {
            if (runBars.isEmpty()) return;
            for (RunBarBox b : runBars.values()) if (b.slot != null) b.update(b.slot);
            h.postDelayed(this, 500);
        }
    };

    public boolean ballShown() {
        return ball != null;
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    private float dpf(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    private void buzz() {
        if (!Prefs.getBool("vibrate", true)) return;
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(28, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(28);
            }
        } catch (Throwable ignored) {
        }
    }

    // ---------- 手势分发 ----------

    void onBallGesture(int n) {
        String key = n >= 3 ? "gTriple" : (n == 2 ? "gDouble" : "gTap");
        String id = Prefs.getString(key, "");
        if (!id.isEmpty() && ScriptStore.findScript(id) != null) {
            runScript(id);
            return;
        }
        if (n == 1) {
            String last = Prefs.getString("lastScript", "");
            if (!last.isEmpty() && ScriptStore.findScript(last) != null) {
                runScript(last);
            } else {
                showPanel();
            }
        } else if (n == 2) {
            JsEngine.stopAll();   // v3.0.0：球双击=停全部
            toast("已刹车");
            refresh();
        } else {
            if (TapService.get() != null) TapService.get().toggleRecord();
            else toast(getString(R.string.need_accessibility));
        }
    }

    void onBallLongPress() {
        String id = Prefs.getString("gLong", "");
        if (!id.isEmpty() && ScriptStore.findScript(id) != null) {
            runScript(id);
            return;
        }
        showPanel();
    }

    private void runScript(String id) {
        JSONObject sc = ScriptStore.findScript(id);
        if (sc == null) return;
        if (!TapService.alive()) {
            toast(getString(R.string.need_accessibility));
            return;
        }
        buzz();
        // v3.0.0：领道开跑。同 id=重启（不打扰）；满员/失败 toast startScript 的文案
        String err = JsEngine.startScript(sc, null);
        if (err != null) toast(err);
        refresh();
        closePanel();
    }

    private void toast(String s) {
        try {
            Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
        }
    }

    // ---------- 脚本面板 ----------

    void showPanel() {
        if (panel != null) {
            closePanel();
            return;
        }
        buzz();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackground(new RoundBg(dp(20), Color.parseColor("#F0161418"),
                Color.parseColor("#33FFFFFF")));

        TextView title = new TextView(this);
        title.setText("选个脚本");
        title.setTextColor(Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextSize(16);
        title.setPadding(dp(14), dp(12), dp(14), dp(6));
        root.addView(title);

        final JSONArray arr = ScriptStore.scripts();
        final java.util.List<String> names = new java.util.ArrayList<>();
        final java.util.List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            // v2.3.0：JS 脚本没有 actions 字段，以前直接 .length() 会 NPE——
            // 悬浮球一弹「选个脚本」就崩，而且只在有 JS 脚本时才犯，很难复现
            JSONArray acts = o.optJSONArray("actions");
            String tail = "js".equals(o.optString("kind", "")) ? "JS 脚本"
                    : (acts == null ? 0 : acts.length()) + " 步";
            names.add((i + 1) + ". " + o.optString("name", "未命名") + "  (" + tail + ")");
            ids.add(o.optString("id"));
        }
        if (names.isEmpty()) names.add("还没有脚本，进 App 加一个");

        ListView lv = new ListView(this);
        lv.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, names));
        lv.setBackgroundColor(Color.TRANSPARENT);
        lv.setDividerHeight(1);
        lv.setLayoutParams(new LinearLayout.LayoutParams(dp(260), Math.min(dp(320), dp(56) * Math.max(1, names.size()))));
        lv.setOnItemClickListener((AdapterView<?> p, View v, int pos, long id) -> {
            if (ids.isEmpty()) {
                closePanel();
                startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
            runScript(ids.get(pos));
        });
        root.addView(lv);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(10), dp(6), dp(10), dp(10));
        row.addView(btn("停止", "#E74C3C", v -> {
            JsEngine.stopAll();   // v3.0.0：面板停止=停全部
            toast("已刹车");
            closePanel();
        }));
        row.addView(btn("录制", "#FF6B35", v -> {
            if (TapService.get() != null) TapService.get().toggleRecord();
            else toast(getString(R.string.need_accessibility));
            closePanel();
        }));
        row.addView(btn("关闭", "#33FFFFFF", v -> closePanel()));
        root.addView(row);

        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.CENTER;
        lp.width = dp(300);
        panel = root;
        panel.setOnTouchListener((v, ev) -> {
            if (ev.getAction() == MotionEvent.ACTION_OUTSIDE) closePanel();
            return false;
        });
        try {
            wm.addView(panel, lp);
            refresh();
        } catch (Throwable t) {
            panel = null;
            toast("面板弹不出来：" + t.getMessage());
        }
    }

    private TextView btn(String text, String color, View.OnClickListener l) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setGravity(Gravity.CENTER);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextSize(13);
        t.setPadding(dp(8), dp(9), dp(8), dp(9));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(color));
        g.setCornerRadius(dp(12));
        t.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(dp(4), 0, dp(4), 0);
        t.setLayoutParams(lp);
        t.setOnClickListener(l);
        return t;
    }

    void closePanel() {
        if (panel != null) {
            try {
                wm.removeView(panel);
            } catch (Throwable ignored) {
            }
            panel = null;
        }
    }

    @Override
    public void onDestroy() {
        Bus.removeSink(busSink);
        stopTouchCapture();
        hideRunBar();
        hideBall();
        instance = null;
        super.onDestroy();
    }

    @Override
    public android.os.IBinder onBind(Intent intent) {
        return null;
    }

    // ---------- 小球本体 ----------

    private final class BallView extends View {

        private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int lastColor;
        private float lastR = -1f;
        private boolean pressed;
        private float startX, startY, startPx, startPy;
        private boolean moved;
        private long downAt;
        private boolean faded;
        private float alpha = Prefs.getFloat("ballAlpha", 0.88f);
        private final Runnable fadeRun = () -> { faded = true; invalidate(); };

        BallView(Context c) {
            super(c);
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), hh = getHeight();
            if (w <= 0 || hh <= 0) return;
            String state = "点";
            int color = idleColor();
            String busy = RunSlot.busyOf(RunSlot.ACTIVE);   // v3.0.0：聚合真相源（onDraw 热路径也是它）
            if (!"idle".equals(busy)) {
                // v2.5.0：暂停单独一态，别让用户以为还在跑
                boolean paused = "paused".equals(busy);
                state = paused ? "暂" : "跑";
                color = paused
                        ? Color.parseColor("#F39C12") : Color.parseColor("#2ECC71");
            } else if (TapService.get() != null && TapService.get().isRecording()) {
                state = "录";
                color = Color.parseColor("#E74C3C");
            }
            alpha = Prefs.getFloat("ballAlpha", 0.88f);
            float a = alpha * (faded ? 0.42f : 1f) * (pressed ? 0.84f : 1f);
            float cx = w / 2f, cy = hh / 2f;
            float r = Math.min(w, hh) / 2f - dp(3);
            if (color != lastColor || Math.abs(r - lastR) > 0.5f) buildShaders(color, r, cx, cy);

            glow.setAlpha((int) (255 * a));
            c.drawCircle(cx, cy, r * 1.18f, glow);              // 外光晕
            body.setAlpha((int) (255 * a));
            body.setShadowLayer(dp(5), 0, dp(2), Color.argb((int) (70 * a), 0, 0, 0));
            c.drawCircle(cx, cy, r, body);                       // 渐变球体
            body.clearShadowLayer();
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(dpf(1.6f));
            ring.setColor(Color.WHITE);
            ring.setAlpha((int) (150 * a));
            c.drawCircle(cx, cy, r - dpf(3.5f), ring);            // 玻璃内环
            if (!"idle".equals(busy)) {                          // 运行时外圈弧
                ring.setStrokeWidth(dpf(2.4f));
                ring.setAlpha((int) (240 * a));
                c.drawArc(cx - r - dp(2), cy - r - dp(2), cx + r + dp(2), cy + r + dp(2),
                        -90, 300, false, ring);
            }
            text.setShader(null);
            text.setColor(Color.WHITE);
            text.setAlpha((int) (255 * a));
            text.setTypeface(Typeface.DEFAULT_BOLD);
            text.setTextAlign(Paint.Align.CENTER);
            text.setTextSize(r * 0.95f);
            c.drawText(state, cx, cy + text.getTextSize() * 0.35f, text);
        }

        /** 渐变只在颜色或尺寸变化时重建，避免每帧 new 对象 */
        private void buildShaders(int color, float r, float cx, float cy) {
            int r0 = Color.red(color), g0 = Color.green(color), b0 = Color.blue(color);
            glow.setShader(new RadialGradient(cx, cy, r * 1.18f,
                    Color.argb(85, r0, g0, b0), Color.TRANSPARENT, Shader.TileMode.CLAMP));
            body.setShader(new LinearGradient(cx - r, cy - r, cx + r, cy + r,
                    Color.rgb(Math.min(255, r0 + 48), Math.min(255, g0 + 42), Math.min(255, b0 + 38)),
                    color, Shader.TileMode.CLAMP));
            lastColor = color;
            lastR = r;
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            switch (e.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    downAt = System.currentTimeMillis();
                    startX = e.getRawX();
                    startY = e.getRawY();
                    startPx = ballParams.x;
                    startPy = ballParams.y;
                    moved = false;
                    pressed = true;
                    invalidate();
                    h.removeCallbacks(longRun);
                    h.removeCallbacks(fadeRun);
                    if (faded) { faded = false; invalidate(); }
                    h.postDelayed(longRun, 500);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - startX, dy = e.getRawY() - startY;
                    if (!moved && Math.abs(dx) + Math.abs(dy) > dp(8)) {
                        moved = true;
                        h.removeCallbacks(longRun);
                        if (tapRun != null) h.removeCallbacks(tapRun);
                    }
                    if (moved) {
                        ballParams.x = (int) (startPx + dx);
                        ballParams.y = (int) (startPy + dy);
                        try {
                            wm.updateViewLayout(this, ballParams);
                        } catch (Throwable ignored) {
                        }
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    pressed = false;
                    invalidate();
                    h.removeCallbacks(longRun);
                    h.postDelayed(fadeRun, 5000); // 静止五秒自己躲起来
                    if (moved) {
                        snap();
                        return true;
                    }
                    if (System.currentTimeMillis() - downAt >= 480) return true;
                    long now = System.currentTimeMillis();
                    clicks = (now - lastTap < 320) ? clicks + 1 : 1;
                    lastTap = now;
                    if (tapRun != null) h.removeCallbacks(tapRun);
                    final int n = clicks;
                    tapRun = () -> {
                        onBallGesture(n);
                        clicks = 0;
                    };
                    h.postDelayed(tapRun, 330);
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    pressed = false;
                    invalidate();
                    h.removeCallbacks(longRun);
                    h.postDelayed(fadeRun, 5000);
                    return true;
            }
            return super.onTouchEvent(e);
        }

        private final Runnable longRun = () -> {
            clicks = 0;
            onBallLongPress();
        };

        private void snap() {
            int sw = getResources().getDisplayMetrics().widthPixels;
            int sh = getResources().getDisplayMetrics().heightPixels;
            int mid = ballParams.x + getWidth() / 2;
            ballParams.x = mid > sw / 2 ? sw - getWidth() : 0;
            ballParams.y = Math.max(0, Math.min(ballParams.y, sh - getHeight()));
            Prefs.put("ballX", ballParams.x);
            Prefs.put("ballY", ballParams.y);
            try {
                wm.updateViewLayout(this, ballParams);
            } catch (Throwable ignored) {
            }
        }
    }

    /** 悬浮球主色跟着界面配色走 */
    private static int idleColor() {
        String th = Prefs.getString("theme", "orange");
        if ("teal".equals(th)) return Color.parseColor("#0D9488");
        if ("violet".equals(th)) return Color.parseColor("#7C3AED");
        if ("blue".equals(th)) return Color.parseColor("#2563EB");
        if ("green".equals(th)) return Color.parseColor("#16A34A");
        if ("pink".equals(th)) return Color.parseColor("#DB2777");
        return Color.parseColor("#FF6B35");
    }

    private static final class RoundBg extends GradientDrawable {
        RoundBg(int r, int color) {
            this(r, color, Color.parseColor("#33000000"));
        }

        RoundBg(int r, int color, int stroke) {
            setColor(color);
            setCornerRadius(r);
            setStroke(1, stroke);
        }
    }
}
