package com.lazytap.clicker;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/** 极简配置中心：所有设置用一个 JSON 存在 SharedPreferences 里，省代码省体积 */
public final class Prefs {

    private static final String P = "lazytap";
    private static final String KEY = "cfg";

    private static JSONObject cfg;
    private static SharedPreferences sp;

    private static JSONObject defaults() {
        JSONObject o = new JSONObject();
        try {
            o.put("ballSize", 54);      // dp
            o.put("ballAlpha", 0.88f);  // 0.3 ~ 1
            o.put("ballX", -1);
            o.put("ballY", -1);
            o.put("speed", 1.0f);       // 动作节奏倍率，越小越快
            o.put("mode", "normal");    // normal | ball
            o.put("ballVisible", false);
            o.put("boot", false);
            o.put("autoRecordDelay", true); // 录制时自动插入等待
            o.put("vibrate", true);
            o.put("gTap", "");          // 悬浮球单击绑定的脚本 id
            o.put("gDouble", "");
            o.put("gTriple", "");
            o.put("gLong", "");         // '' 表示弹脚本列表；否则直接运行
            o.put("lastScript", "");
            o.put("triggers", "");      // 自动化触发器数组（JSON 字符串）
            o.put("theme", "orange");   // 界面主色：orange|teal|violet|blue|green|pink
        } catch (JSONException ignored) {
        }
        return o;
    }

    public static boolean ready() {
        return cfg != null && sp != null;
    }

    public static void init(Context c) {
        sp = c.getSharedPreferences(P, Context.MODE_PRIVATE);
        String s = sp.getString(KEY, null);
        cfg = defaults();
        if (s != null) {
            try {
                JSONObject saved = new JSONObject(s);
                java.util.Iterator<String> it = saved.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    cfg.put(k, saved.get(k));
                }
            } catch (Exception ignored) {
            }
        }
    }

    public static JSONObject get() {
        return cfg;
    }

    public static String getString(String k, String def) {
        return cfg.optString(k, def);
    }

    public static int getInt(String k, int def) {
        return cfg.optInt(k, def);
    }

    public static float getFloat(String k, float def) {
        return (float) cfg.optDouble(k, def);
    }

    public static boolean getBool(String k, boolean def) {
        return cfg.optBoolean(k, def);
    }

    public static void put(String k, Object v) {
        try {
            cfg.put(k, v);
            sp.edit().putString(KEY, cfg.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** JS 侧整体覆盖保存 */
    public static void merge(JSONObject o) {
        try {
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                cfg.put(k, o.get(k));
            }
            sp.edit().putString(KEY, cfg.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
