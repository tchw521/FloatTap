public class VarsTest {
    static int fails = 0;
    static void eq(String name, String got, String want) {
        boolean ok = want == null ? got == null : want.equals(got);
        System.out.println((ok?"  PASS  ":"  FAIL  ")+name+"  =>  "+got+(ok?"":"   （期望 "+want+"）"));
        if (!ok) fails++;
    }
    public static void main(String[] a) throws Exception {
        Vars v = new Vars();
        org.json.JSONArray defs = new org.json.JSONArray();
        defs.put(new org.json.JSONObject().put("k","n").put("v","3"));
        defs.put(new org.json.JSONObject().put("k","name").put("v","签到"));
        v.load(defs);
        v.screenW = 1080; v.screenH = 1920; v.loop = 2; v.step = 4;

        System.out.println("=== 文本插值 ===");
        eq("整段替换", v.text("{{n+1}}"), "4");
        eq("局部替换（前后保留）", v.text("第 {{n}} 次"), "第 3 次");
        eq("多个插值", v.text("{{n}} / {{n+1}}"), "3 / 4");
        eq("字符串变量", v.text("{{name}}"), "签到");
        eq("拼接", v.text("{{name}}成功"), "签到成功");
        eq("无插值原样", v.text("540"), "540");
        eq("写了半个括号", v.text("{{n"), "{{n");
        eq("内置 screenW", v.text("{{screenW/2}}"), "540");
        eq("内置 loop", v.text("{{loop}}"), "2");
        eq("内置 step", v.text("{{step}}"), "4");
        eq("关系式", v.text("{{n>=3}}"), "1");
        eq("未定义变量", v.text("{{nothing}}"), "0");
        eq("语法错保留原文", v.text("{{1+}}"), "{{1+}}");

        System.out.println("=== 绑定到动作对象 ===");
        org.json.JSONObject act = new org.json.JSONObject()
            .put("t","click").put("x","{{n}}").put("y","{{screenH-300}}")
            .put("d","{{rand(100,200)}}").put("pct",0).put("click",true);
        org.json.JSONObject b = v.bind(act);
        eq("x 插值后能当数字用", String.valueOf(b.optInt("x")), "3");
        eq("y 算出具体像素", String.valueOf(b.optInt("y")), "1620");
        eq("d 随机数是整数", String.valueOf(b.optInt("d")), String.valueOf(b.optInt("d")));
        boolean dInt = !b.optString("d").contains(".");
        System.out.println((dInt?"  PASS  ":"  FAIL  ")+"d 插值结果是不带小数点的整数："+b.optString("d"));
        if (!dInt) fails++;
        eq("布尔字段不受影响", String.valueOf(b.optBoolean("click")), "true");
        eq("数字字段不受影响", String.valueOf(b.optInt("pct")), "0");
        eq("原对象没被改动", act.optString("x"), "{{n}}");

        System.out.println("=== 嵌套对象与数组 ===");
        org.json.JSONObject deep = new org.json.JSONObject()
            .put("sub", new org.json.JSONObject().put("s","{{name}}"))
            .put("arr", new org.json.JSONArray().put("{{n}}").put("{{n+1}}"));
        org.json.JSONObject d2 = v.bind(deep);
        eq("嵌套对象递归插值", d2.optJSONObject("sub").optString("s"), "签到");
        eq("数组第一项", d2.optJSONArray("arr").optString(0), "3");
        eq("数组第二项", d2.optJSONArray("arr").optString(1), "4");

        System.out.println("=== 快照与内置清单 ===");
        org.json.JSONArray snap = v.snapshot();
        eq("快照含两个变量", String.valueOf(snap.length()), "2");
        eq("快照第一项名", snap.optJSONObject(0).optString("k"), "n");
        eq("内置变量清单非空", String.valueOf(Vars.BUILTIN.length > 5), "true");
        System.out.println("  内置变量：" + Vars.BUILTIN.length + " 个 —— " + Vars.BUILTIN[0][0] + "（" + Vars.BUILTIN[0][1] + "）");

        System.out.println("=== 跨脚本共享变量（v3.1.0 g. 前缀） ===");
        GlobalVars.get().clear();
        GlobalVars.get().put("score", "777");
        eq("g. 前缀直读共享表", v.text("{{g.score}}"), "777");
        eq("g. 前缀参与运算", v.text("{{g.score+1}}"), "778");
        eq("g. 未定义当 0", v.text("{{g.nothing}}"), "0");
        GlobalVars.get().put("score", "888");
        eq("实时共享（同实例）", v.text("{{g.score}}"), "888");
        eq("本道变量不受影响", v.text("{{n}}"), "3");
        Vars v2 = new Vars(); v2.screenW = 1; v2.screenH = 1;
        eq("另一个 Vars 实例读同一个共享表", v2.text("{{g.score}}"), "888");

        System.out.println("=== hasVar ===");
        eq("有变量", String.valueOf(Vars.hasVar("{{n}}")), "true");
        eq("没变量", String.valueOf(Vars.hasVar("540")), "false");
        eq("半截不算", String.valueOf(Vars.hasVar("{{n")), "false");
        eq("null 安全", String.valueOf(Vars.hasVar(null)), "false");

        System.out.println(fails==0 ? "\n✅ Vars 全部通过" : "\n❌ 有 "+fails+" 项失败");
        if (fails>0) System.exit(1);
    }
}
