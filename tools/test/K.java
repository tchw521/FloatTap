// HotKey 单测：测的是 src 里的真源码（run-tests.sh 剥掉 package 后编译过来）。
// 音量键急停的判定逻辑就这几行，但判断错一次后果挺烦：
// 要么调个音量把脚本停了，要么真要急停时按了没反应。
public class K {
    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }
    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    public static void main(String[] a) {
        System.out.println("HotKey（音量键急停）单测");

        // ---- 认键 ----
        ok("音量+ 认得出来", HotKey.isVolume(HotKey.VOL_UP));
        ok("音量- 认得出来", HotKey.isVolume(HotKey.VOL_DOWN));
        ok("音量键常量和 KeyEvent 对齐", HotKey.VOL_UP == 24 && HotKey.VOL_DOWN == 25);
        ok("电源键不是音量键", !HotKey.isVolume(26));
        ok("返回键不是音量键", !HotKey.isVolume(4));
        ok("随便一个码不是音量键", !HotKey.isVolume(999));

        // ---- 按下 / 抬起 ----
        ok("ACTION_DOWN 是按下", HotKey.isDown(0));
        ok("ACTION_UP 不是按下", !HotKey.isDown(1));

        // ---- 四个条件缺一不可 ----
        ok("开关开 + 在跑 + 按下 → 停", HotKey.wantStop(HotKey.VOL_DOWN, true, true, true));
        ok("开关关着就不拦（默认关）", !HotKey.wantStop(HotKey.VOL_DOWN, true, false, true));
        ok("没在跑就不拦（调音量不该停脚本）",
                !HotKey.wantStop(HotKey.VOL_UP, true, true, false));
        ok("抬起那一下不拦（一次按下只停一回）",
                !HotKey.wantStop(HotKey.VOL_UP, false, true, true));
        ok("别的键不拦", !HotKey.wantStop(4, true, true, true));
        ok("音量+ 也能停", HotKey.wantStop(HotKey.VOL_UP, true, true, true));

        // ---- 组合矩阵：只在唯一正确组合下返回 true ----
        int hit = 0;
        boolean[] booleans = {false, true};
        int[] codes = {4, HotKey.VOL_UP, HotKey.VOL_DOWN};
        for (int code : codes) {
            for (boolean down : booleans) {
                for (boolean enabled : booleans) {
                    for (boolean busy : booleans) {
                        if (HotKey.wantStop(code, down, enabled, busy)) hit++;
                    }
                }
            }
        }
        // 2 个音量键 × 1(按下) × 1(开关开) × 1(在跑) = 2
        ok("全组合里只有 2 种情况会拦", hit == 2, "实际 " + hit);

        // ---- 名字 ----
        ok("音量+ 名字", "音量+".equals(HotKey.name(HotKey.VOL_UP)));
        ok("音量- 名字", "音量-".equals(HotKey.name(HotKey.VOL_DOWN)));
        ok("别的键也有名字", HotKey.name(4).startsWith("按键"));

        // ---- v2.5.0 三态映射：短按=暂停/恢复，长按=停止，JS 只能急停 ----
        System.out.println("三态映射（action）");
        boolean T = true, F = false;
        String R0 = HotKey.action(HotKey.VOL_DOWN, T, 0, T, T, F);
        ok("引擎在跑 + 短按 → 切暂停/恢复", HotKey.TOGGLE.equals(R0), R0);
        // 说明：runnerBusy 参数语义是「引擎忙（跑着或暂停都算）」，由调用方传 isBusy()。
        // 所以「暂停中短按恢复」在纯函数视角就是 runnerBusy=true → TOGGLE，无需单独测。
        ok("引擎忙 + 短按（rc=0）恒为 TOGGLE，另一个键也一样",
                HotKey.TOGGLE.equals(HotKey.action(HotKey.VOL_UP, T, 0, T, T, F)));
        ok("引擎在跑 + 长按（repeat≥3）→ 急停",
                HotKey.STOP.equals(HotKey.action(HotKey.VOL_DOWN, T, HotKey.LONG_AT, T, T, F)));
        ok("长按住不放（repeat 继续涨）不再重复触发",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, HotKey.LONG_AT + 1, T, T, F)));
        ok("长按前两下（repeat 1-2）还不算长按",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, 1, T, T, F))
                        && HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, 2, T, T, F)));
        ok("JS 在跑 + 短按 → 急停（JS 模式不支持暂停）",
                HotKey.STOP.equals(HotKey.action(HotKey.VOL_DOWN, T, 0, T, F, T)));
        ok("JS 长按不再触发（短按那下已经停了）",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, HotKey.LONG_AT, T, F, T)));
        ok("啥都没跑 → 无动作（调音量归系统）",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, 0, T, F, F)));
        ok("开关关 → 无动作",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, T, 0, F, T, T)));
        ok("抬起 → 无动作（一次按下只动一回）",
                HotKey.NONE.equals(HotKey.action(HotKey.VOL_DOWN, F, 0, T, T, T)));
        ok("不是音量键 → 无动作",
                HotKey.NONE.equals(HotKey.action(4, T, 0, T, T, T)));

        // 全组合矩阵：runner 忙时短按 2 个键 = TOGGLE、repeat=LONG_AT 2 个 = STOP，
        // js-only 时短按 2 个 = STOP，其余 0
        int nT = 0, nS = 0;
        int[] rcs = {0, 1, 2, HotKey.LONG_AT, HotKey.LONG_AT + 1};
        for (int code : codes) for (boolean down : booleans) for (boolean enabled : booleans)
            for (boolean rb : booleans) for (boolean jb : booleans) for (int rc : rcs) {
                String act = HotKey.action(code, down, rc, enabled, rb, jb);
                if (HotKey.TOGGLE.equals(act)) nT++;
                if (HotKey.STOP.equals(act)) nS++;
            }
        ok("全组合里 TOGGLE 只有 4 种（runner 忙 × 2 键 × 短按 × js 忙/闲两态）", nT == 4, "实际 " + nT);
        ok("全组合里 STOP 只有 6 种（runner 长按 4 + 仅 JS 短按 2）", nS == 6, "实际 " + nS);

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }
}
