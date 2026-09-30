package com.lazytap.clicker;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 子脚本调用（v2.6.0）：传参、深度、回值这三样纯逻辑收在这里，
 * 一个 Android 类型都不碰，纯 JDK 就能单测（tools/test/SuTest.java）。
 *
 * 执行本身在 ScriptRunner#execSubScript：同一根引擎线程里把子脚本的
 * 动作逐条阻塞跑完，所以暂停闸口、停止检查在子脚本里全部自然生效。
 * JS 脚本当不了子脚本——它要占 WebView 主线程，而引擎线程正阻塞着等它，
 * 互相等死。这是本版明确不做的（CHANGELOG 有记录）。
 */
public final class SubCall {

    /** 套娃上限：正常没人嵌到 5 层，到了多半是 A 调 B、B 又调 A 的死循环 */
    public static final int MAX_DEPTH = 5;

    private int depth;

    /** 进一层。返回 false 表示已经顶到上限，调用方要拒绝这次 runSub */
    public boolean enter() {
        if (depth >= MAX_DEPTH) return false;
        depth++;
        return true;
    }

    /** 出一层（调用方要放 finally 里，异常路径也不能漏） */
    public void exit() {
        if (depth > 0) depth--;
    }

    public int depth() {
        return depth;
    }

    /**
     * 解析传参 JSON。空串 / 空对象都算合法（等于无参）；
     * 写坏了的返回 null —— 宁可整条拒绝也别带着半个参数跑，
     * 用户在日志里看到「传参 JSON 写错了」立刻就能改。
     * 传数组也拒收：传参必须是 k/v 对象，[1,2] 这种没有名字可读。
     */
    public static JSONObject parse(String argsJson) {
        if (argsJson == null) return new JSONObject();
        String s = argsJson.trim();
        if (s.isEmpty()) return new JSONObject();
        try {
            Object o = new JSONTokener(s).nextValue();
            if (!(o instanceof JSONObject)) return null;
            return (JSONObject) o;
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * 把传参对象平铺成 k/v 字符串表。值是对象 / 数组就转 JSON 文本，
     * 数字 / 布尔转字符串——变量表本来就是字符串的（见 Vars）。
     * 空白键名丢弃（{{}} 里读不到没名字的参数）。
     */
    public static LinkedHashMap<String, String> flat(JSONObject args) {
        LinkedHashMap<String, String> m = new LinkedHashMap<>();
        if (args == null) return m;
        java.util.Iterator<String> it = args.keys();
        while (it.hasNext()) {
            String k = it.next();
            if (k == null || k.trim().isEmpty()) continue;
            Object v = args.opt(k);
            // 注意 JSONObject.NULL 哨兵：opt() 对 {"n":null} 返回它而不是 Java null，
            // 不判的话 {"n":null} 会平铺成字符串 "null"，子脚本里 {{n}} 读出一串假值
            if (v == null || v == JSONObject.NULL) m.put(k.trim(), "");
            else if (v instanceof String) m.put(k.trim(), (String) v);
            else if (v instanceof JSONObject || v instanceof JSONArray) m.put(k.trim(), v.toString());
            else m.put(k.trim(), String.valueOf(v));
        }
        return m;
    }

    /** 传参回传给 JS 侧用：steps 告诉父脚本子脚本实际跑了几步 */
    public static JSONObject result(boolean ok, int steps) {
        JSONObject r = new JSONObject();
        try {
            r.put("ok", ok ? 1 : 0);
            r.put("steps", Math.max(0, steps));
        } catch (Exception ignored) {
        }
        return r;
    }
}
