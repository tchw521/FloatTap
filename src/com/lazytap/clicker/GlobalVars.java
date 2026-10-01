package com.lazytap.clicker;

import java.util.LinkedHashMap;

/**
 * 跨脚本共享变量表（v3.1.0）：进程级单例，所有运行中的脚本共用一张表。
 * 写走 globalSet 动作或 JS 的 gset()，读可以在任何动作字段里直接写 {{g.名字}}。
 * 内存版：进程死了就没了，不落盘——共享变量的语义是「运行时传话」，
 * 每个脚本自己的初值仍由脚本里的 vars 提供，两边互不干扰。
 */
public final class GlobalVars {

    private static final GlobalVars ME = new GlobalVars();

    private final LinkedHashMap<String, String> map = new LinkedHashMap<>();

    private GlobalVars() {
    }

    public static GlobalVars get() {
        return ME;
    }

    /** 写共享变量：名字为空忽略，值为 null 记成空串 */
    public synchronized void put(String k, String v) {
        if (k == null || k.isEmpty()) return;
        map.put(k, v == null ? "" : v);
    }

    /** 读共享变量：没定义返回 null（表达式里当 0 处理） */
    public synchronized String get(String k) {
        return k == null ? null : map.get(k);
    }

    public synchronized void del(String k) {
        if (k != null) map.remove(k);
    }

    /** 快照（拷贝）：给变量面板展示用，改快照不影响原表 */
    public synchronized LinkedHashMap<String, String> snapshot() {
        return new LinkedHashMap<>(map);
    }

    public synchronized void clear() {
        map.clear();
    }
}
