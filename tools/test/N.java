// NodeMatch 单测：测的是 src 里的真源码（run-tests.sh 剥掉 package 后编译过来）。
// 它不带任何 Android 依赖，连 org.json 都不碰，所以能在纯 JDK 下跑。
//
// 这里盯的是 v2.4.0 新加的四个查找条件（控件 id / 正则 / 内容描述 / 文字），
// 以及它们组合出来的「且」语义。最容易翻车的是这两条：
//   · desc 留空时必须还是老样子（文字或描述任一命中），一动就退化老脚本
//   · 正则写错（比如只填个左括号）必须安静地「找不到」，不能崩、更不能假装全命中

public class N {

    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }

    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    /** desc / id / re 都不填，只按文字找（v2.3.0 的老路径） */
    static NodeMatch q0(String text, boolean contains) {
        return NodeMatch.of(text, contains);
    }

    static NodeMatch q(String text, String desc, String id, String re, boolean contains) {
        return NodeMatch.of(text, desc, id, re, contains);
    }

    public static void main(String[] x) {
        System.out.println("NodeMatch 单测（id / 正则 / 描述 / 且语义）");

        // ---- A. id 规范化：com.x:id/ok 和 ok 用户觉得是一个东西 ----
        ok("null id 规范成空串", NodeMatch.normId(null).isEmpty());
        ok("空串还是空串", NodeMatch.normId("").isEmpty());
        ok("纯 id 原样", "ok".equals(NodeMatch.normId("ok")));
        ok("com.tencent.mm:id/ok → ok", "ok".equals(NodeMatch.normId("com.tencent.mm:id/ok")));
        ok(":id/ok → ok", "ok".equals(NodeMatch.normId(":id/ok")));
        ok("android:id/content → content", "content".equals(NodeMatch.normId("android:id/content")));
        ok("带空格会 trim", "ok".equals(NodeMatch.normId("  com.x:id/ok  ")));

        // ---- B. id 命中 ----
        ok("id 全等命中", q("", "", "com.x:id/ok", "", false).matches("任意", "任意", "com.x:id/ok"));
        ok("填 ok 也能命中 com.x:id/ok", q("", "", "ok", "", false).matches("任意", "任意", "com.x:id/ok"));
        ok("两边包名不同也算同一个 id", q("", "", "com.a:id/ok", "", false).matches("", "", "com.b:id/ok"));
        ok("模糊匹配时 ok 子串命中 ok_btn", q("", "", "ok", "", true).matches("", "", "com.x:id/ok_btn"));
        ok("id 不同就不命中", !q("", "", "cancel", "", false).matches("", "", "com.x:id/ok"));
        // 没开 FLAG_REPORT_VIEW_IDS 时 getViewIdResourceName() 恒为 null，就是这个下场
        ok("节点 id 是 null 时不命中（没开 flag 的样子）",
                !q("", "", "ok", "", false).matches("任意", "任意", null));

        // ---- C. contains / 全等 ----
        ok("模糊匹配：确定 命中 点确定(2)", q0("确定", true).matches("点确定(2)", "", ""));
        ok("模糊匹配：也算命中描述里的字", q0("设置", true).matches("", "设置", ""));
        ok("全等时 确定 不命中 点确定(2)", !q0("确定", false).matches("点确定(2)", "", ""));
        ok("全等命中", q0("确定", false).matches("确定", "", ""));
        ok("大小写敏感", !q0("OK", true).matches("ok", "", ""));

        // ---- D. 正则 ----
        ok("正则 ^\\\\d{4}$ 命中 1234", q("", "", "", "^\\d{4}$", true).matches("1234", "", ""));
        ok("正则是子串语义（写成 确定 就能命中 点确定(2)）",
                q("", "", "", "确定", true).matches("点确定(2)", "", ""));
        ok("正则不匹配就不命中", !q("", "", "", "^\\d{4}$", true).matches("123", "", ""));
        // 用户手滑填了个左括号：不许崩，也不许「全命中」，就当找不到
        ok("非法正则不抛异常且判不命中", !q("", "", "", "(", true).matches("任意", "", ""));
        ok("非法正则能被 badRe 查出来", q("", "", "", "(", true).badRe());
        ok("没填正则不算非法", !q("", "", "", "", true).badRe());
        ok("合法正则 badRe 是 false", !q("", "", "", "^a$", true).badRe());
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i < 201; i++) tooLong.append('a');
        ok("超长正则当成非法（不拿去拖死匹配）", q("", "", "", tooLong.toString(), true).badRe());
        ok("超长正则也不命中", !q("", "", "", tooLong.toString(), true).matches("aaaa", "", ""));
        // desc 留空时正则作用在「文字+描述」联合面上
        ok("desc 留空时正则也扫描述", q("", "", "", "^\\d{4}$", true).matches("", "1234", ""));

        // ---- E. 且语义：填了的都要满足 ----
        ok("文字中 + id 中 → 命中", q("确定", "", "ok", "", true).matches("确定", "", "com.x:id/ok"));
        ok("文字中 + id 不中 → 不命中", !q("确定", "", "ok", "", true).matches("确定", "", "com.x:id/cancel"));
        ok("文字不中 + id 中 → 不命中", !q("取消", "", "ok", "", true).matches("确定", "", "com.x:id/ok"));
        ok("desc 填了就各自为证：文字中但描述不对 → 不命中",
                !q("确定", "确认页", "", "", true).matches("确定", "别的描述", ""));
        ok("desc 填了且都对 → 命中", q("确定", "确认页", "", "", true).matches("确定", "确认页", ""));
        // 这条是「不许退化老脚本」的护栏
        ok("desc 留空时还是老样子：文字命中描述就算命中",
                q0("设置", true).matches("", "设置", ""));
        ok("只填 desc：文字对但描述不对时不算（desc 独立生效）",
                !q("", "齿轮", "", "", true).matches("设置", "别的", ""));
        ok("只填 id（文字描述全空）→ 能命中", q("", "", "ok", "", true).matches("任意文字", "任意描述", "com.x:id/ok"));
        ok("文字和正则都填 → 两个都要满足",
                q("确定", "", "", "^确", true).matches("确定退出", "", ""));
        // 「退出」在「退出_对话框」里能找到，但 ^确 对不上开头 —— 两个都填就得两个都满足
        ok("文字对但正则对不上 → 不命中",
                !q("退出", "", "", "^确", true).matches("退出_对话框", "", ""));

        // ---- F. 空查询 / 向后兼容 ----
        NodeMatch blank = q("", "", "", "", true);
        ok("四个条件全空 = 不筛选", blank.empty());
        ok("全空时任意节点都命中（v2.3.0 老行为）", blank.matches("随便什么", "随便", "com.x:id/any"));
        ok("只填文字就不是空查询", !q0("确定", true).empty());
        ok("describe 全空时说「任意节点」", "任意节点".equals(blank.describe()));
        String all = q("确定", "描述", "ok", "^确", true).describe();
        ok("describe 把四个条件都列出来",
                all.contains("文字「确定」") && all.contains("描述「描述」")
                        && all.contains("id「ok」") && all.contains("正则"),
                all);
        // 老签名必须等价于 v2.3.0：文字或描述任一命中
        ok("老签名仍等价于 v2.3.0（文字命中）", q0("设置", true).matches("设置", "", ""));
        ok("老签名仍等价于 v2.3.0（描述命中）", q0("设置", true).matches("", "设置", ""));

        // ---- G. 容错 / 边界 ----
        ok("三个 CharSequence 全为 null 也不 NPE", blank.matches(null, null, null));
        NodeMatch nulls = NodeMatch.of(null, null, null, null, true);
        ok("全 null 构造不 NPE 且是空查询", nulls.empty());
        ok("capFor(1) 是收集上限", NodeMatch.capFor(1) == NodeMatch.HIT_CAP);
        ok("capFor 会给足 nth 个（第 300 个也拿得到）", NodeMatch.capFor(300) == 300);
        ok("capFor(0) 不会退化成 0", NodeMatch.capFor(0) == NodeMatch.HIT_CAP);
        ok("capFor(负数) 也不会退化", NodeMatch.capFor(-5) == NodeMatch.HIT_CAP);
        ok("收集上限常量是 200", NodeMatch.HIT_CAP == 200);

        // 最后一道：确认 IllegalArgument 之外的东西没溜进来
        // （非法正则如果在构造时抛出来，上面的 of() 就已经炸了，走不到这里）
        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }
}
