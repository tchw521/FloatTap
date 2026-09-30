package com.lazytap.clicker;

import org.json.JSONObject;

import java.util.Random;

/**
 * 时间相关的纯计算：动作间隔、等待时长、轮询截止时刻。
 *
 * 单独拎成一个不带 Android 依赖的类，是为了能在纯 JDK 下直接单测
 * （ScriptRunner 依赖 AccessibilityService / Bitmap，JDK 下编不了）。
 * 这一块的 bug 全是「静默失效」——界面上写着等 5 秒，实际等了 0.3 秒，
 * 既不报错也不崩，靠肉眼看代码很难发现，只能靠测试盯着。
 */
public final class Timing {

    /** 找东西（文字/颜色/图）的轮询间隔：太密白费 CPU，太疏会错过刚弹出来的按钮 */
    public static final long FIND_SLICE = 250;

    /** 单次找东西最多等多久：表单里手滑填个 999999 也不至于把脚本钉死 */
    public static final long FIND_CAP = 60000;

    /**
     * 分组里的同步等待上限。
     * 分组没有「动作间隔」那一步，等待只能在子动作里睡；睡的是无障碍回调线程，
     * 太久会被系统当成服务无响应，所以卡在 5 秒。
     */
    public static final long GROUP_WAIT_CAP = 5000;

    private Timing() {
    }

    /** 速度倍率：允许加速，但别快到变成疯狂连点 */
    public static float speed(float raw) {
        return raw <= 0.05f ? 0.05f : raw;
    }

    /**
     * 一个动作跑完，隔多久再跑下一个。
     *
     * wait 是特例：它自己没有等待逻辑（只打一行日志），真正撑时间的是这个间隔。
     * 以前这里直接读 d（默认 300ms），于是「等 5 秒」实际只等了 0.3 秒 ——
     * 界面上填 5000，跑起来一闪而过，用户只会以为脚本坏了。现在把 ms 也算进来取大的。
     */
    public static long delayAfter(JSONObject a, float rawSpeed, boolean jitter, Random rnd) {
        long d = a == null ? 300 : a.optLong("d", 300);
        if (a != null && "wait".equals(a.optString("t", ""))) {
            long ms = a.optLong("ms", 0);
            if (ms > d) d = ms;
        }
        if (jitter && d > 0 && rnd != null) {
            d = Math.round(d * (0.75 + rnd.nextDouble() * 0.5));   // ±25%，更像人手
        }
        return (long) (d * speed(rawSpeed));
    }

    /** 轮询截止时刻（绝对时间），顺手把离谱的超时夹到上限内 */
    public static long deadline(long timeout) {
        return System.currentTimeMillis() + Math.min(Math.max(0, timeout), FIND_CAP);
    }

    /** 用户填的超时会不会被夹短（用来决定要不要提示一句） */
    public static boolean clamped(long timeout) {
        return timeout > FIND_CAP;
    }

    /** 分组内的同步等待时长（已夹上限）；返回值 >0 才需要真的去睡 */
    public static long groupWait(JSONObject a, float rawSpeed) {
        long ms = a == null ? 1000 : a.optLong("ms", 1000);
        long v = (long) (ms * speed(rawSpeed));
        if (v <= 0) return 0;
        return Math.min(v, GROUP_WAIT_CAP);
    }

    /** 分组等待是不是被夹短了 */
    public static boolean groupClamped(JSONObject a, float rawSpeed) {
        long ms = a == null ? 1000 : a.optLong("ms", 1000);
        return (long) (ms * speed(rawSpeed)) > GROUP_WAIT_CAP;
    }
}
