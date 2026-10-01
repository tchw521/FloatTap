package com.lazytap.clicker;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 进程内事件总线：内核 → UI（WebView）/ 悬浮球 / 磁贴……
 *
 * <p>v2.7.0 从单 sink 改成多播：以前只有一个 MainActivity 在听，悬浮球刷新
 * 要靠它捎带；现在每个关心事件的组件自己注册自己，互不认识。
 * 一个 sink 抛异常不影响其余（emit 全程吞异常——事件系统不能把业务带崩）。
 */
public final class Bus {

    public interface Sink {
        void on(String type, String data);
    }

    private static final List<Sink> sinks = new CopyOnWriteArrayList<>();

    public static void addSink(Sink s) {
        if (s != null && !sinks.contains(s)) sinks.add(s);
    }

    public static void removeSink(Sink s) {
        sinks.remove(s);
    }

    /** 兼容旧的单 sink 写法（= 清掉重加一个）；新代码一律 addSink */
    public static void setSink(Sink s) {
        sinks.clear();
        addSink(s);
    }

    public static void emit(String type, String data) {
        for (Sink s : sinks) {
            try {
                s.on(type, data);
            } catch (Throwable ignored) {
            }
        }
    }

    public static void emit(String type) {
        emit(type, "");
    }
}
