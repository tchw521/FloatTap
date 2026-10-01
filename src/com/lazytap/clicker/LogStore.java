package com.lazytap.clicker;

import org.json.JSONArray;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 进程级运行日志仓（v3.0.0 多任务并行）。
 *
 * <p>以前日志挂在 ScriptRunner 单例的实例字段里——单例时代一个池就是一份日志，
 * 自然没问题；现在 2 条引擎道 + 1 条 JS 道各自写各自的行，日志面板要的是
 * 全池合并视图（谁写的靠 v2.7.0 的 #runId 徽标区分），所以把存储上收到这里。
 *
 * <p>裁剪与序列化规则复用 LogLine 的（CAP=200 裁头部、r=0 不输出徽标），
 * 不碰任何 Android API，纯 JDK 可单测（tools/test/PoolTest.java H 节）。
 * 写入方：各 ScriptRunner 实例的 log()（带自己的 runId）与系统消息（r=0）。
 */
public final class LogStore {

    private static final LogStore STORE = new LogStore();

    public static LogStore get() {
        return STORE;
    }

    private final List<LogLine> lines = new CopyOnWriteArrayList<>();

    private LogStore() {
    }

    /** 全部日志（index 0 最老）——调试/备份用；面板展示走 json(n) */
    public List<LogLine> all() {
        return lines;
    }

    /** 写入一行，超 LogLine.CAP 裁头部（与单例时代同规则） */
    public void add(LogLine l) {
        if (l == null) return;
        lines.add(l);
        while (lines.size() > LogLine.CAP) lines.remove(0);
    }

    public int size() {
        return lines.size();
    }

    /** 面板展示用：只取最后 n 行的 JSON 数组（与原 logsJson(n) 同形状） */
    public JSONArray json(int n) {
        JSONArray a = new JSONArray();
        int start = Math.max(0, lines.size() - Math.max(1, n));
        for (int i = start; i < lines.size(); i++) a.put(lines.get(i).json());
        return a;
    }

    /** 日志面板的「清空」按钮 */
    public void clear() {
        lines.clear();
    }
}
