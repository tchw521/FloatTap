// Timing 单测：测的是 src 里的真源码（run-tests.sh 剥掉 package 后编译过来）。
// 它不带任何 Android 依赖，所以能在纯 JDK 下跑。
//
// 这里盯的是 v2.3.0 扫出来的那批「静默失效」——不报错、不崩溃，只是悄悄不生效：
//   · 「等待 5 秒」实际只等 0.3 秒
//   · 「最多等 10 秒」被硬夹成 2 秒
//   · 分组里的等待干脆不算数
// 光读代码很难发现，只能靠断言钉住。
import org.json.JSONObject;

import java.util.Random;

public class W {

    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }

    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    static JSONObject a(Object... kv) {
        JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            String k = String.valueOf(kv[i]);
            Object v = kv[i + 1];
            if (v instanceof Integer) o.put(k, ((Integer) v).intValue());
            else o.put(k, String.valueOf(v));
        }
        return o;
    }

    public static void main(String[] x) {
        System.out.println("Timing 单测（等待 / 超时 / 分组）");

        // ---- 速度倍率 ----
        ok("1 倍速就是原样", Timing.speed(1f) == 1f);
        ok("2 倍速", Timing.speed(2f) == 2f);
        ok("0 会被夹到 0.05（别快成疯狂连点）", Timing.speed(0f) == 0.05f);
        ok("负数也夹", Timing.speed(-3f) == 0.05f);

        // ---- wait：等待时长以 ms 为准 ----
        long d1 = Timing.delayAfter(a("t", "wait", "ms", 5000, "d", 300), 1f, false, null);
        ok("「等 5 秒」真的等 5 秒（以前只等 300ms）", d1 == 5000, d1 + "ms");
        long d2 = Timing.delayAfter(a("t", "wait", "ms", 1000), 1f, false, null);
        ok("wait 没写 d 时按 ms 算（不是默认的 300）", d2 == 1000, d2 + "ms");
        long d3 = Timing.delayAfter(a("t", "wait", "ms", 2000, "d", 300), 1f, false, null);
        ok("录制条那种 {ms:2000,d:300} 是 2 秒不是 2.3 秒", d3 == 2000, d3 + "ms");
        long d4 = Timing.delayAfter(a("t", "wait", "ms", 500, "d", 900), 1f, false, null);
        ok("d 比 ms 大时取 d", d4 == 900, d4 + "ms");
        long d5 = Timing.delayAfter(a("t", "wait", "ms", 0, "d", 0), 1f, false, null);
        ok("wait 写 0 就是不等", d5 == 0, d5 + "ms");

        // ---- 别的动作不受影响 ----
        long c1 = Timing.delayAfter(a("t", "click", "ms", 5000, "d", 300), 1f, false, null);
        ok("click 的 ms 不会被当成等待（那是长按时长）", c1 == 300, c1 + "ms");
        long c2 = Timing.delayAfter(a("t", "click", "d", 800), 1f, false, null);
        ok("普通动作看 d", c2 == 800, c2 + "ms");
        long c3 = Timing.delayAfter(a("t", "click"), 1f, false, null);
        ok("啥都没写就用默认 300", c3 == 300, c3 + "ms");

        // ---- 节奏倍率真的作用到等待上 ----
        // 界面上叫「节奏倍率」，乘在间隔上：2x 是慢一倍（间隔翻倍），0.5x 是快一倍
        ok("2x 时 5 秒变 10 秒", Timing.delayAfter(a("t", "wait", "ms", 5000), 2f, false, null) == 10000);
        ok("0.5x 时 1 秒变 500ms", Timing.delayAfter(a("t", "wait", "ms", 1000), 0.5f, false, null) == 500);

        // ---- 抖动 ----
        Random r = new Random(42);
        boolean inRange = true;
        for (int i = 0; i < 200; i++) {
            long v = Timing.delayAfter(a("t", "wait", "ms", 1000), 1f, true, r);
            if (v < 750 || v > 1250) inRange = false;
        }
        ok("开抖动后在 750~1250 之间（±25%）", inRange);
        long j1 = Timing.delayAfter(a("t", "wait", "ms", 1000), 1f, true, new Random(1));
        long j2 = Timing.delayAfter(a("t", "wait", "ms", 1000), 1f, true, new Random(1));
        ok("同一个种子结果稳定（可复现）", j1 == j2);
        ok("抖动关掉时精确", Timing.delayAfter(a("t", "wait", "ms", 1000), 1f, false, r) == 1000);

        // ---- 超时不再被夹成 2 秒 ----
        long now = System.currentTimeMillis();
        long dl = Timing.deadline(10000);
        ok("填 10 秒就是 10 秒（以前被硬夹成 2 秒）", dl - now >= 9900, (dl - now) + "ms");
        ok("填 3 秒是 3 秒", Timing.deadline(3000) - now >= 2900);
        ok("填 0 就是不等", Timing.deadline(0) - now <= 50);
        ok("负数也不会变成等到天荒地老", Timing.deadline(-5) - now <= 50);
        ok("999999 被夹到 60 秒", Timing.clamped(999999));
        ok("60 秒以内不算被夹", !Timing.clamped(60000));
        ok("夹完确实不超过 60 秒", Timing.deadline(999999) - now <= 60100);

        // ---- 分组内的等待 ----
        ok("分组里等 2 秒", Timing.groupWait(a("t", "wait", "ms", 2000), 1f) == 2000);
        ok("分组里等 0 就是不睡", Timing.groupWait(a("t", "wait", "ms", 0), 1f) == 0);
        ok("分组里等 30 秒会被夹到 5 秒", Timing.groupWait(a("t", "wait", "ms", 30000), 1f) == Timing.GROUP_WAIT_CAP);
        ok("被夹了要能查出来（好提示用户）", Timing.groupClamped(a("t", "wait", "ms", 30000), 1f));
        ok("没被夹就别瞎提示", !Timing.groupClamped(a("t", "wait", "ms", 2000), 1f));
        ok("分组等待也吃节奏倍率", Timing.groupWait(a("t", "wait", "ms", 1000), 2f) == 2000);

        // ---- 常量本身 ----
        ok("轮询间隔 250ms（密到浪费、疏到漏掉之间）", Timing.FIND_SLICE == 250);
        ok("单次上限 60 秒", Timing.FIND_CAP == 60000);
        ok("分组上限 5 秒", Timing.GROUP_WAIT_CAP == 5000);

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }
}
