// LogLine 单测：测的是 src 里的真源码（run-tests.sh 剥掉 package 后编译过来）。
// 它不带任何 Android 依赖，所以能在纯 JDK 下跑。
import java.util.regex.Pattern;

public class L {
    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }
    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    public static void main(String[] a) {
        System.out.println("LogLine 单测");

        // ---- 级别 ----
        ok("默认是普通级", new LogLine("戳 (10,20)", 0).lv == LogLine.INFO);
        ok("提醒级", new LogLine("没找到「确定」", 1).lv == LogLine.WARN);
        ok("出错级", new LogLine("动作出错：xxx", 2).lv == LogLine.ERR);
        ok("级别越界往上夹到 ERR", new LogLine("x", 9).lv == LogLine.ERR);
        ok("级别为负夹回 INFO", new LogLine("x", -3).lv == LogLine.INFO);
        ok("文本为 null 变空串", "".equals(new LogLine(null, 0).m));

        // ---- 关键词兜底分级（老日志 / 没带级别的场景）----
        ok("「出错」算错", LogLine.guess("动作出错：炸了") == LogLine.ERR);
        ok("「失败」算错", LogLine.guess("截图失败") == LogLine.ERR);
        ok("「不跑了」只是提醒", LogLine.guess("还是没找到「A」，不跑了") == LogLine.WARN);
        ok("「没找到」只是提醒", LogLine.guess("没找到颜色 #ff0000") == LogLine.WARN);
        ok("「跳过」只是提醒", LogLine.guess("没找到「A」，跳过") == LogLine.WARN);
        ok("普通日志就是普通", LogLine.guess("开跑：签到") == LogLine.INFO);
        ok("空串不算错", LogLine.guess("") == LogLine.INFO);
        ok("null 不算错", LogLine.guess(null) == LogLine.INFO);
        // 「没找到」这种等待在循环脚本里每轮都来一次，标成错会满屏红
        ok("等待类不算错（否则循环脚本满屏红）",
                LogLine.guess("没找到「确定」，再等等") != LogLine.ERR);

        // ---- 旧格式还原 ----
        ok("legacy 带上猜出来的级别", LogLine.legacy("未知动作 clickX").lv == LogLine.ERR);
        ok("legacy 普通仍是普通", LogLine.legacy("戳 (1,2)").lv == LogLine.INFO);

        // ---- 时间戳 ----
        LogLine at = new LogLine(1700000000000L, "x", 0);
        String c = at.clock();
        ok("时钟格式 HH:MM:SS", Pattern.matches("\\d{2}:\\d{2}:\\d{2}", c), c);
        ok("时钟三位一组", c.split(":").length == 3);
        ok("个位补零", new LogLine(0L, "x", 0).clock().matches("\\d{2}:\\d{2}:\\d{2}"));

        // ---- 序列化给界面 ----
        org.json.JSONObject j = new LogLine(1700000000000L, "戳 (1,2)", 2).json();
        ok("json 带文本", "戳 (1,2)".equals(j.optString("m")));
        ok("json 带级别", j.optInt("lv") == 2);
        ok("json 带毫秒时间戳", j.optLong("t") == 1700000000000L);
        ok("json 带格式化时钟", j.optString("c").matches("\\d{2}:\\d{2}:\\d{2}"));
        ok("json 的时钟和 clock() 一致", j.optString("c").equals(
                new LogLine(1700000000000L, "戳 (1,2)", 2).clock()));
        // XSS：日志里可能含动作名（用户自己起的），直接拼 innerHTML 会被打穿
        LogLine xss = new LogLine("<img src=x onerror=alert(1)>", 0);
        ok("恶意文本原样存、不在这里转义（转义交给前端 esc）",
                xss.m.contains("onerror"));

        // ---- 容量 ----
        ok("容量常量够用也不浪费", LogLine.CAP == 200);

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }
}
