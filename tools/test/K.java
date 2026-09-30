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

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }
}
