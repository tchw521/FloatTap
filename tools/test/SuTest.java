import org.json.JSONArray;
import org.json.JSONObject;

/** 子脚本调用（SubCall）语义单测（v2.6.0）：传参解析 / 平铺 / 深度守卫 / 回值组装 */
public class SuTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) {
        System.out.println("子脚本调用语义单测（v2.6.0）");

        // ---------- A. 传参解析 parse ----------
        System.out.println("[A] 传参解析");
        ok(SubCall.parse(null) != null, "null 传参 = 无参（空对象），不是错误");
        ok(SubCall.parse("") != null && SubCall.parse("  ") != null, "空串 / 纯空白 = 无参");
        ok(SubCall.parse("{}").length() == 0, "空对象 = 无参");
        JSONObject p1 = SubCall.parse("{\"n\":1,\"go\":true,\"s\":\"点这里\"}");
        ok(p1 != null && "1".equals(p1.optString("n")) && p1.optInt("n") == 1, "数字参数原样可读");
        ok(p1 != null && p1.optBoolean("go"), "布尔参数原样可读");
        ok(p1 != null && "点这里".equals(p1.optString("s")), "中文参数不坏");
        ok(SubCall.parse("{\"n\":1}  ") != null, "前后带空白也认");
        ok(SubCall.parse("{\"n\":") == null, "写坏的 JSON 整条拒绝（不跑半个参数）");
        ok(SubCall.parse("这不是JSON") == null, "纯文本拒绝");
        ok(SubCall.parse("[1,2]") == null, "数组拒绝 —— 传参必须是 k/v 对象");
        ok(SubCall.parse("\"hi\"") == null, "裸字符串拒绝");

        // ---------- B. 平铺 flat ----------
        System.out.println("[B] 传参平铺");
        JSONObject src = new JSONObject();
        try {
            src.put("n", 3);
            src.put("msg", "你好");
            src.put("flag", false);
            src.put("obj", new JSONObject("{\"a\":1}"));
            src.put("arr", new JSONArray("[1,2]"));
            src.put("empty", JSONObject.NULL);
            src.put("  ", "空白键");
            src.put("", "空键");
        } catch (Exception e) { ok(false, "构造传参对象异常 " + e); }
        java.util.LinkedHashMap<String, String> f = SubCall.flat(src);
        ok("3".equals(f.get("n")), "数字转字符串（变量表本来就是字符串）");
        ok("你好".equals(f.get("msg")), "中文原样");
        ok("false".equals(f.get("flag")), "布尔转字符串");
        ok("{\"a\":1}".equals(f.get("obj")), "对象值转 JSON 文本");
        ok("[1,2]".equals(f.get("arr")), "数组值转 JSON 文本");
        ok("".equals(f.get("empty")), "null 值平铺成空串");
        ok(!f.containsKey("") && !f.containsKey("  "), "空白 / 空键名丢弃");
        ok(f.size() == 6, "键数对得上（8 减 2 个废键）");
        ok(SubCall.flat(null).isEmpty(), "null 对象平铺 = 空表不抛");

        // ---------- C. 深度守卫 ----------
        System.out.println("[C] 套娃深度守卫");
        SubCall d = new SubCall();
        boolean allIn = true;
        for (int i = 0; i < SubCall.MAX_DEPTH; i++) if (!d.enter()) allIn = false;
        ok(allIn && d.depth() == SubCall.MAX_DEPTH, "正常嵌到 " + SubCall.MAX_DEPTH + " 层都放行");
        ok(!d.enter(), "第 " + (SubCall.MAX_DEPTH + 1) + " 层被拒 —— A 调 B、B 调 A 的死循环进不来");
        d.exit();
        ok(d.enter(), "退一层后又能进（合法的深层嵌套不受牵连）");
        ok(d.depth() == SubCall.MAX_DEPTH, "深度回到上限值");
        for (int i = 0; i < SubCall.MAX_DEPTH + 3; i++) d.exit();
        ok(d.depth() == 0, "多退不穿仓（finally 重复调 exit 也安全）");

        // ---------- D. 回值组装 ----------
        System.out.println("[D] 回值组装");
        JSONObject r1 = SubCall.result(true, 7);
        ok(r1.optInt("ok") == 1 && r1.optInt("steps") == 7, "成功回值 ok=1 steps=7");
        JSONObject r2 = SubCall.result(false, 0);
        ok(r2.optInt("ok") == 0 && r2.optInt("steps") == 0, "失败回值 ok=0 steps=0");
        JSONObject r3 = SubCall.result(true, -3);
        ok(r3.optInt("steps") == 0, "负步数夹成 0（别往回传怪数）");

        // ---------- E. 子循环跳转语义（复刻 execSubScript 的循环骨架） ----------
        // 改 ScriptRunner 的子循环时要同步这里 —— 和 EngineTest 是同一个约定
        System.out.println("[E] 子循环跳转语义（仿真）");
        // 模拟 5 步：第 2 步跳到第 4 步；跳转按「子脚本自己的步号」（1 起）解释
        int[] jumpAt = { -1, 4, -1, -1, -1 };   // -1 = 顺延
        int i = 0, steps = 0, ran = 0;
        boolean end = false;
        while (i < 5 && !end) {
            ran++;
            int j = jumpAt[i];
            steps++;
            if (j == -1) i++;                    // 0 = 顺延（这里用 -1 表示没跳）
            else if (j > 0) i = j - 1;           // 子脚本自己的第 N 步
            else end = true;                     // JUMP_END / JUMP_LOOP = 子脚本收工
        }
        ok(ran == 4, "跳转落在子脚本内部：5 步里实跑 4 步（跳过第 3 步），不串到父脚本步号");
        // 收工上传：子脚本里遇 JUMP_END(-1) / JUMP_LOOP(-2) 只结束子脚本
        int[] jumpEnd = { -2, -1, -1 };          // 第 1 步就「收工」
        i = 0; steps = 0; end = false;
        while (i < 3 && !end) {
            int j = jumpEnd[i];
            steps++;
            if (j == -1) i++;
            else if (j > 0) i = j - 1;
            else end = true;
        }
        ok(end && steps == 1 && i == 0, "子脚本「收工 / 重来」只收子脚本，i 不越界父脚本");

        System.out.println(pass + " 项断言，" + (fail == 0 ? "全通过" : fail + " 项失败"));
        if (fail > 0) System.exit(1);
    }
}
