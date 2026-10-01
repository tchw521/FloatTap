package com.lazytap.clicker;

import java.util.Random;

/**
 * v4.1.0 防检测的纯计算层：落点随机偏移与区间随机。
 *
 * 和 Timing 一个思路：ScriptRunner 依赖无障碍服务编不进纯 JDK 测试，
 * 所以「每次点击偏多少、随机区间怎么取」这类会被用户拿去防封号的数字
 * 单独拎出来，让单测盯住边界——偏移出界、区间颠倒、负数输入这些
 * 错误要是悄悄跑出去，坏的是用户的账号，比界面 bug 严重得多。
 */
public final class Rnd {

    /**
     * 在 [-max, max] 里取一个整数偏移。
     * max<=0 或 rnd 为空一律返回 0 —— 防检测关掉时落点必须分毫不差，
     * 绝不能出现「关了还偷偷偏」的行为（那是另一种静默失效）。
     */
    public static int offset(int max, Random rnd) {
        if (max <= 0 || rnd == null) return 0;
        return rnd.nextInt(max * 2 + 1) - max;
    }

    /**
     * [min, max] 闭区间随机取整。
     * 输入颠倒自动纠正（竞品允许 150~100 这种手滑填法，我们也兜住）；
     * 负数下限夹到 0；min==max 直接返回；rnd 为空取 min（确定性兜底）。
     */
    public static long between(long min, long max, Random rnd) {
        if (max < min) {
            long t = min;
            min = max;
            max = t;
        }
        if (min < 0) min = 0;
        if (max <= min) return Math.max(0, min);
        if (rnd == null) return min;
        return min + (long) (rnd.nextDouble() * (max - min + 1));
    }

    private Rnd() {
    }
}
