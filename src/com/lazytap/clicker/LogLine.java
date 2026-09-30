package com.lazytap.clicker;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 一行运行日志。
 *
 * <p>单独拎成一个类、不碰任何 Android API，是因为这样能在纯 JDK 下直接单测
 * （见 tools/test/L.java）——这个项目的验证手段就靠纯 Java 单测 + 网页冒烟，
 * 塞进 ScriptRunner 里就没法测了。
 *
 * <p>级别只用来在日志面板上着色，别拿它当流程控制。
 */
public final class LogLine {

    public static final int INFO = 0;
    public static final int WARN = 1;
    public static final int ERR = 2;

    /** 日志最多留多少行。一条几十字节，200 条也就几 KB，够了 */
    public static final int CAP = 200;

    public final long t;
    public final int lv;
    public final String m;

    public LogLine(String m, int lv) {
        this(System.currentTimeMillis(), m, lv);
    }

    public LogLine(long t, String m, int lv) {
        this.t = t;
        this.m = m == null ? "" : m;
        this.lv = lv < INFO ? INFO : (lv > ERR ? ERR : lv);
    }

    /**
     * 给没有级别的老日志（纯字符串）补一个级别。
     * 「没找到」多数是正常等待，不算错；真正的报错都带「出错 / 失败 / 停」这类字眼。
     */
    public static int guess(String m) {
        if (m == null || m.isEmpty()) return INFO;
        if (m.contains("出错") || m.contains("失败") || m.contains("崩")
                || m.contains("异常") || m.contains("未知")) return ERR;
        if (m.contains("没开") || m.contains("没找到") || m.contains("找不到")
                || m.contains("跳过") || m.contains("中断") || m.contains("没有")
                || m.contains("超时") || m.contains("不跑了")) return WARN;
        return INFO;
    }

    /** 从旧格式（纯文本）还原成一行，方便升级后老数据也能显示 */
    public static LogLine legacy(String m) {
        return new LogLine(m, guess(m));
    }

    /** HH:MM:SS，日志面板左边那一列 */
    public String clock() {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(t);
        return p2(c.get(Calendar.HOUR_OF_DAY)) + ":" + p2(c.get(Calendar.MINUTE))
                + ":" + p2(c.get(Calendar.SECOND));
    }

    private static String p2(int v) {
        return v < 10 ? "0" + v : String.valueOf(v);
    }

    public JSONObject json() {
        JSONObject o = new JSONObject();
        try {
            o.put("t", t);
            o.put("lv", lv);
            o.put("m", m);
            o.put("c", clock());
        } catch (JSONException ignored) {
        }
        return o;
    }

    @Override
    public String toString() {
        return m;
    }
}
