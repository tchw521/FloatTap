package com.lazytap.clicker;

/** 极简进程内事件总线：内核 → UI（WebView）/ 悬浮球 */
public final class Bus {

    public interface Sink {
        void on(String type, String data);
    }

    private static Sink sink;

    public static void setSink(Sink s) {
        sink = s;
    }

    public static void emit(String type, String data) {
        if (sink != null) {
            try {
                sink.on(type, data);
            } catch (Throwable ignored) {
            }
        }
    }

    public static void emit(String type) {
        emit(type, "");
    }
}
