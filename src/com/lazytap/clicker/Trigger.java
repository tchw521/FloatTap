package com.lazytap.clicker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * 自动化触发器：定时 / 周期 / 通知 / 插电 / 解锁。
 * 定时与周期走 AlarmManager（setWindow，不需要精确闹钟权限），
 * 通知走无障碍事件，插电与解锁走系统广播，全部零第三方依赖。
 */
public final class Trigger {

    public static final String ACT = "com.lazytap.clicker.TRIG";

    /** 同一个触发器的冷却时间，免得一条通知刷出一串脚本 */
    private static final long COOLDOWN = 8000L;
    private static final Map<String, Long> lastFire = new HashMap<>();

    private Trigger() {
    }

    // ---------- 存储：直接塞在 Prefs 的 JSON 里 ----------

    public static JSONArray all() {
        String s = Prefs.getString("triggers", "");
        if (s == null || s.length() == 0) return new JSONArray();
        try {
            return new JSONArray(s);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static void save(JSONArray arr) {
        Prefs.put("triggers", arr == null ? "" : arr.toString());
    }

    public static JSONObject find(String id) {
        JSONArray arr = all();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && id != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    // ---------- 通知触发 ----------

    public static void onNotify(Context c, AccessibilityEvent e) {
        CharSequence pn = e.getPackageName();
        String pkg = pn == null ? "" : pn.toString();
        if (pkg.contains("com.lazytap.clicker")) return; // 自己的通知不算
        StringBuilder sb = new StringBuilder();
        if (e.getText() != null) {
            for (CharSequence cs : e.getText()) {
                if (cs != null) sb.append(cs).append(' ');
            }
        }
        CharSequence desc = e.getContentDescription();
        if (desc != null) sb.append(desc);
        fire(c, "notify", pkg, sb.toString().trim());
    }

    // ---------- 触发 ----------

    public static void fire(Context c, String kind, String pkg, String text) {
        JSONArray arr = all();
        if (arr.length() == 0) return;
        long now = System.currentTimeMillis();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject t = arr.optJSONObject(i);
            if (t == null || !t.optBoolean("on", true)) continue;
            if (!kind.equals(t.optString("kind"))) continue;
            if ("notify".equals(kind)) {
                String want = t.optString("text", "").trim();
                String wantPkg = t.optString("pkg", "").trim();
                if (wantPkg.length() > 0 && !(pkg != null && pkg.contains(wantPkg))) continue;
                if (want.length() > 0) {
                    String hay = (text == null ? "" : text) + " " + (pkg == null ? "" : pkg);
                    if (!hay.contains(want)) continue;
                }
            }
            String id = t.optString("id", "");
            Long last = lastFire.get(id);
            if (last != null && now - last < COOLDOWN) continue;
            lastFire.put(id, now);
            run(c, t.optString("script", ""), kind);
        }
    }

    public static void runById(Context c, JSONObject t) {
        if (t == null) return;
        run(c, t.optString("script", ""), t.optString("kind", ""));
    }

    private static void run(Context c, String scriptId, String kind) {
        if (c == null || scriptId == null || scriptId.length() == 0) return;
        if (!Prefs.ready()) Prefs.init(c);
        if (!ScriptStore.ready()) ScriptStore.init(c);
        JSONObject sc = ScriptStore.findScript(scriptId);
        if (sc == null) return;
        if (!TapService.alive()) {
            Bus.emit("log", "⏰ 到点了，但无障碍没开，跑不动");
            return;
        }
        ScriptRunner r = ScriptRunner.get();
        if (r.isRunning()) r.stop();
        if (JsEngine.startScript(sc, null)) {
            Bus.emit("log", "⏰ " + why(kind) + "，开跑：" + sc.optString("name", "脚本"));
            if (FloatService.get() != null) FloatService.get().refresh();
        }
    }

    private static String why(String kind) {
        if ("time".equals(kind)) return "到点";
        if ("repeat".equals(kind)) return "周期到";
        if ("notify".equals(kind)) return "收到通知";
        if ("power".equals(kind)) return "插上电";
        if ("unlock".equals(kind)) return "解锁了";
        return "被触发";
    }

    // ---------- 排程 ----------

    public static void scheduleAll(Context c) {
        if (c == null) return;
        if (!Prefs.ready()) Prefs.init(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        JSONArray arr = all();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject t = arr.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id", "");
            String kind = t.optString("kind", "");
            if (!t.optBoolean("on", true) || t.optString("script", "").length() == 0) {
                cancel(c, am, id);
                continue;
            }
            long at, period;
            if ("time".equals(kind)) {
                at = nextClock(t.optInt("hh", 8), t.optInt("mm", 0));
                period = 24 * 3600 * 1000L;
            } else if ("repeat".equals(kind)) {
                period = Math.max(1, t.optInt("mins", 60)) * 60000L;
                at = System.currentTimeMillis() + period;
            } else {
                continue; // 通知 / 插电 / 解锁 不用排程
            }
            try {
                am.setWindow(AlarmManager.RTC_WAKEUP, at, Math.min(period - 1000, 60000L), pi(c, id));
            } catch (Throwable ignored) {
            }
        }
    }

    private static void cancel(Context c, AlarmManager am, String id) {
        try {
            am.cancel(pi(c, id));
        } catch (Throwable ignored) {
        }
    }

    private static long nextClock(int hh, int mm) {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, Math.max(0, Math.min(23, hh)));
        cal.set(Calendar.MINUTE, Math.max(0, Math.min(59, mm)));
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        long t = cal.getTimeInMillis();
        if (t <= System.currentTimeMillis() + 5000) t += 24 * 3600 * 1000L;
        return t;
    }

    private static PendingIntent pi(Context c, String id) {
        Intent i = new Intent(c, TriggerReceiver.class).setAction(ACT).putExtra("id", id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, req(id), i, flags);
    }

    private static int req(String id) {
        int h = id == null ? 7 : id.hashCode();
        return Math.abs(h % 50000) + 1000;
    }
}
