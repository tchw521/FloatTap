package com.lazytap.clicker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本变量：一张字符串表 + 字段插值。
 *
 * 任何动作字段里都能写 {{表达式}}，执行前会被替换成求值结果，
 * 所以「点在第 {{n}} 步算出来的位置」「等 {{rand(800,1200)}} 毫秒」这类写法都能用。
 * 内置变量（lastX / loop / screenW ...）在同一次运行里自动可用。
 */
public final class Vars {

    /** 内置变量说明，界面「插入变量」下拉直接读这个 */
    public static final String[][] BUILTIN = {
            {"lastX", "最近一次找色/找图命中的横坐标"},
            {"lastY", "最近一次找色/找图命中的纵坐标"},
            {"lastSim", "最近一次命中的相似度（0~100）"},
            {"hit.colorX", "最近一次「找色」命中的 X（跟找图分开记）"},
            {"hit.colorY", "最近一次「找色」命中的 Y"},
            {"hit.imageX", "最近一次「找图」命中的 X"},
            {"hit.imageY", "最近一次「找图」命中的 Y"},
            {"loop", "当前第几轮（从 1 开始）"},
            {"step", "当前第几步（从 1 开始）"},
            {"screenW", "屏幕宽度（像素）"},
            {"screenH", "屏幕高度（像素）"},
            {"time", "当前时间戳（秒）"},
            {"date", "今天日期，形如 2026-09-30"},
            {"hour", "现在几点（0~23）"},
            {"rand", "随机数，rand(10) 得 0~9，rand(5,8) 得 5~8"},
    };

    private final Map<String, String> map = new LinkedHashMap<>();

    Vars() {
    }

    /** 用脚本里存的初始值重置（每次开跑都从初值开始，跑完不写回脚本） */
    void load(JSONArray defs) {
        map.clear();
        if (defs == null) return;
        for (int i = 0; i < defs.length(); i++) {
            JSONObject o = defs.optJSONObject(i);
            if (o == null) continue;
            String k = o.optString("k", "").trim();
            if (k.isEmpty()) continue;
            map.put(k, o.optString("v", ""));
        }
    }

    String get(String k) {
        return k == null ? null : map.get(k);
    }

    void put(String k, String v) {
        if (k != null && !k.isEmpty()) map.put(k, v == null ? "" : v);
    }

    /** 当前变量快照，给界面看运行时状态用 */
    JSONArray snapshot() {
        JSONArray a = new JSONArray();
        for (Map.Entry<String, String> e : map.entrySet()) {
            JSONObject o = new JSONObject();
            try {
                o.put("k", e.getKey());
                o.put("v", e.getValue());
            } catch (Exception ignored) {
            }
            a.put(o);
        }
        return a;
    }

    List<String> names() {
        return new ArrayList<>(map.keySet());
    }

    // ---------- 求值作用域：内置变量优先于同名用户变量之外的部分 ----------
    private final Expr.Scope scope = new Expr.Scope() {
        @Override
        public String get(String name) {
            if (name == null) return null;
            switch (name) {
                case "loop":
                    return String.valueOf(loop);
                case "step":
                    return String.valueOf(step);
                case "screenW":
                    return String.valueOf(screenW);
                case "screenH":
                    return String.valueOf(screenH);
                case "time":
                    return String.valueOf(System.currentTimeMillis() / 1000);
                case "date":
                    return DATE();
                case "hour":
                    return String.valueOf(java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY));
                default:
                    break;
            }
            if (name.startsWith("cnt.") && cnt != null) {
                Integer c = cnt.get(name.substring(4));
                return c == null ? "0" : String.valueOf(c);
            }
            // 找色/找图各自最后一次命中的坐标（v2.3.0：以前引擎记了但没人能读到）
            if (name.startsWith("hit.") && hit != null) {
                String v = hit.get(name.substring(4));
                return v == null ? "0" : v;
            }
            String v = map.get(name);
            return v;   // 没定义就返回 null，Expr 会当 0
        }
    };

    // 运行时上下文，由引擎每次执行前写入
    int loop = 1;
    int step = 1;
    int screenW;
    int screenH;
    /** 引擎的计数器表，让 {{cnt.名字}} 能用上「计数」动作的结果 */
    Map<String, Integer> cnt;
    /** 引擎的图色命中表，让 {{hit.colorX}} {{hit.imageY}} 能分别引用找色/找图的落点 */
    Map<String, String> hit;

    private static String DATE() {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
        return f.format(new java.util.Date());
    }

    /** 求值一段 {{}} 里的内容 */
    String eval(String body) {
        return Expr.eval(body, scope);
    }

    // ---------- 插值 ----------

    /**
     * 把对象里所有字符串字段的 {{...}} 替换掉，返回新对象（不改原脚本）。
     * 没有 {{}} 的字段原样保留，所以老脚本性能不受影响。
     */
    JSONObject bind(JSONObject src) {
        if (src == null) return null;
        try {
            return (JSONObject) walk(src);
        } catch (Throwable t) {
            return src;
        }
    }

    private Object walk(Object o) {
        if (o instanceof JSONObject) {
            JSONObject in = (JSONObject) o;
            JSONObject out = new JSONObject();
            java.util.Iterator<String> it = in.keys();
            while (it.hasNext()) {
                String k = it.next();
                Object v = in.opt(k);
                try {
                    out.put(k, walk(v));
                } catch (Exception ignored) {
                }
            }
            return out;
        }
        if (o instanceof JSONArray) {
            JSONArray in = (JSONArray) o;
            JSONArray out = new JSONArray();
            for (int i = 0; i < in.length(); i++) {
                out.put(walk(in.opt(i)));
            }
            return out;
        }
        if (o instanceof String) return text((String) o);
        return o;
    }

    /**
     * 替换一段文本里的所有 {{...}}。
     * 如果整段就是一个 {{}}，则整段替换成结果（这样数字字段能直接当数字用）；
     * 否则只替换里面的部分，保留前后文字。
     */
    String text(String s) {
        if (s == null) return s;
        if (s.indexOf("{{") < 0) return s;
        // 一次线性扫描替换所有 {{}}。
        // 不用递归：表达式写错时我们要把原文原样留着，递归会把它当成新的 {{}} 又扫一遍，死循环。
        StringBuilder sb = new StringBuilder();
        int i = 0;
        for (; ; ) {
            int a = s.indexOf("{{", i);
            if (a < 0) {
                sb.append(s.substring(i));
                break;
            }
            int b = s.indexOf("}}", a + 2);
            if (b < 0) {                       // 括号没写全，剩下的整段原样保留
                sb.append(s.substring(i));
                break;
            }
            sb.append(s, i, a);
            String body = s.substring(a + 2, b);
            String r = eval(body);
            sb.append(r == null ? s.substring(a, b + 2) : r);   // 算不出来就保留原文，界面上一眼能看出哪写错了
            i = b + 2;
        }
        return sb.toString();
    }

    /** 文本里是否含待替换的插值 */
    static boolean hasVar(String s) {
        return s != null && s.indexOf("{{") >= 0 && s.indexOf("}}", s.indexOf("{{") + 2) > 0;
    }
}
