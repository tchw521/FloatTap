import java.util.Random;

/**
 * v4.1.0 防检测计算层（Rnd）单测。
 *
 * 这些数字直接决定「点击落在哪」：偏移出界 = 点到别的按钮上；
 * 区间颠倒不纠正 = 每次都等同一个值（防检测形同虚设）。
 * 全部边界都用真采样验证，不只看公式。
 */
public class RndT {

    // ===== 断言小工具 =====
    static int fails = 0;

    static void ok(String name, boolean cond) {
        ok(name, cond, null);
    }

    static void ok(String name, boolean cond, Object detail) {
        if (cond) {
            System.out.println("  PASS  " + name + (detail == null ? "" : "   " + detail));
        } else {
            fails++;
            System.out.println("  FAIL  " + name + "   " + detail);
        }
    }

    public static void main(String[] args) {
        Random r = new Random(20261001);

        // ===== offset：[-max, max] 闭区间 =====
        int min = Integer.MAX_VALUE, max = Integer.MIN_VALUE;
        boolean inRange = true;
        for (int i = 0; i < 20000; i++) {
            int v = Rnd.offset(5, r);
            if (v < -5 || v > 5) inRange = false;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        ok("offset ±5 两万次采样全部在界内", inRange, null);
        ok("offset 采样覆盖到两端（min<0 且 max>0）", min <= -4 && max >= 4, "min=" + min + " max=" + max);
        ok("offset 含 0（±5 共 11 个可能值，2 万次必命中）",
                sampleHasZero(r));

        ok("offset max=0 恒 0（关掉防检测必须分毫不差）", Rnd.offset(0, r) == 0);
        ok("offset max<0 恒 0（负数输入兜底）", Rnd.offset(-3, r) == 0);
        ok("offset rnd=null 恒 0（确定性兜底）", Rnd.offset(5, null) == 0);

        // ===== between：[min, max] 闭区间 =====
        long lo = Long.MAX_VALUE, hi = Long.MIN_VALUE;
        boolean bIn = true;
        for (int i = 0; i < 20000; i++) {
            long v = Rnd.between(20, 70, r);
            if (v < 20 || v > 70) bIn = false;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
        }
        ok("between 20~70 两万次采样全部在界内", bIn, null);
        ok("between 覆盖到两端（20 和 70 都出现）", lo == 20 && hi == 70, "lo=" + lo + " hi=" + hi);

        ok("between 区间颠倒自动纠正（70~20 等价 20~70）",
                Rnd.between(70, 20, r) >= 20 && Rnd.between(70, 20, r) <= 70);
        ok("between min==max 直接返回", Rnd.between(42, 42, r) == 42);
        ok("between 负下限夹到 0（-5~10 → 0~10）",
                Rnd.between(-5, 10, r) >= 0 && Rnd.between(-5, 10, r) <= 10);
        ok("between 全负夹成 0（-9~-2 → 0）", Rnd.between(-9, -2, r) == 0);
        ok("between rnd=null 取下限", Rnd.between(20, 70, null) == 20);

        // 大区间也别溢出：毫秒级区间乘次数多，long 够用，但 min+(nextDouble*(跨度+1))
        // 在 min=0,max=Long.MAX_VALUE 时会溢出吗？—— 用实际大数验一下不越界
        long big = Rnd.between(0, Long.MAX_VALUE / 2, r);
        ok("between 大区间不越界", big >= 0 && big <= Long.MAX_VALUE / 2);

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }

    static boolean sampleHasZero(Random r) {
        for (int i = 0; i < 20000; i++) if (Rnd.offset(5, r) == 0) return true;
        return false;
    }
}
