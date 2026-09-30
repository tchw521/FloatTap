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
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** 内核服务：手势注入 + 操作录制 */
public class TapService extends AccessibilityService {

    private static volatile TapService instance;
    private int sw, sh;
    private String topPkg = "";
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
            setServiceInfo(info);
        }
        ScriptRunner.get().setListener((type, data) -> {
            Bus.emit(type, data);
            if (FloatService.get() != null) FloatService.get().refresh();
        });
        Bus.emit("service", "on");
        Trigger.scheduleAll(this); // 服务活了，把定时触发器排上
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

    public void globalAction(String k) {
        switch (k) {
            case "back":
                performGlobalAction(GLOBAL_ACTION_BACK);
                break;
            case "home":
                performGlobalAction(GLOBAL_ACTION_HOME);
                break;
            case "recents":
                performGlobalAction(GLOBAL_ACTION_RECENTS);
                break;
            case "notif":
                performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
                break;
            case "quick":
                performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
                break;
            case "lock":
                if (Build.VERSION.SDK_INT >= 28) performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
                break;
            case "power":
                performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
                break;
            case "split":
                if (Build.VERSION.SDK_INT >= 24) performGlobalAction(GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN);
                break;
            default:
                performGlobalAction(GLOBAL_ACTION_BACK);
        }
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

    /** 按文本 / 描述查找节点，nth 从 1 开始 */
    public AccessibilityNodeInfo findNode(String text, boolean contains, boolean clickableOnly, int nth) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        List<AccessibilityNodeInfo> hits = new ArrayList<>();
        collect(root, text, contains, clickableOnly, hits, 0);
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

    private void collect(AccessibilityNodeInfo node, String text, boolean contains,
                         boolean clickableOnly, List<AccessibilityNodeInfo> hits, int depth) {
        if (node == null || depth > 22 || hits.size() > 40) return;
        CharSequence cs = node.getText();
        CharSequence cd = node.getContentDescription();
        boolean match = false;
        if (contains) {
            match = (cs != null && cs.toString().contains(text)) || (cd != null && cd.toString().contains(text));
        } else {
            match = (cs != null && cs.toString().equals(text)) || (cd != null && cd.toString().equals(text));
        }
        if (match && (!clickableOnly || node.isClickable())) {
            hits.add(AccessibilityNodeInfo.obtain(node));
        }
        int n = node.getChildCount();
        for (int i = 0; i < n; i++) {
            AccessibilityNodeInfo c = node.getChild(i);
            collect(c, text, contains, clickableOnly, hits, depth + 1);
            if (c != null) c.recycle();
        }
    }

    // ---------- 录制 ----------

    private boolean recording;
    private long lastEventTime;
    private String lastPkg = "";
    private String lastSig = "";

    public boolean isRecording() {
        return recording;
    }

    public void startRecord() {
        ScriptStore.clearRecording();
        recording = true;
        lastEventTime = System.currentTimeMillis();
        lastPkg = "";
        lastSig = "";
        Bus.emit("record", "start");
        if (FloatService.get() != null) FloatService.get().refresh();
        toast("开始录制，随便点，我看着呢");
    }

    public void stopRecord() {
        recording = false;
        Bus.emit("record", "stop");
        if (FloatService.get() != null) FloatService.get().refresh();
        toast("录完了，共 " + ScriptStore.recording().length() + " 步");
    }

    public void toggleRecord() {
        if (recording) stopRecord();
        else startRecord();
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
            AccessibilityNodeInfo src = event.getSource();
            if (src == null) return;
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
