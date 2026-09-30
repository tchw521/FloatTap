import org.json.*;

/** Share.java 单测：这个类是零 Android 依赖的，所以能直接在 JDK 下跑 */
public class S {
    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }
    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    static JSONObject script(String name) {
        JSONObject s = new JSONObject();
        try {
            s.put("id", "x1");
            s.put("name", name);
            s.put("desc", "每天早上点一下");
            s.put("icon", "🎁");
            s.put("kind", "js");
            JSONArray acts = new JSONArray();
            JSONObject a = new JSONObject();
            a.put("t", "click");
            a.put("x", 540);
            a.put("y", 1180);
            a.put("pct", 0);
            a.put("d", 300);
            acts.put(a);
            JSONObject b = new JSONObject();
            b.put("t", "find");
            b.put("s", "签到");
            b.put("contains", true);
            acts.put(b);
            s.put("actions", acts);
            JSONArray vars = new JSONArray();
            JSONObject v = new JSONObject();
            v.put("k", "n");
            v.put("v", "0");
            vars.put(v);
            s.put("vars", vars);
            s.put("code", "await clickP(50, 50);\n// 中文注释 + emoji 🎁\n");
        } catch (Exception ignored) {
        }
        return s;
    }

    public static void main(String[] args) {
        System.out.println("=== v1.8.0 分享码 ===");

        // 1. 往返：单个脚本
        JSONObject a = script("每天签到");
        String code = Share.one(a);
        ok("生成出来的码带 LT1. 前缀", code.startsWith("LT1."), code.substring(0, Math.min(30, code.length())) + "...");
        JSONObject back = Share.decode(code);
        ok("解码认出是单个脚本", "one".equals(back.optString("kind")), back.optString("err"));
        JSONObject got = back.optJSONObject("script");
        ok("名字还原", got != null && "每天签到".equals(got.optString("name")), got == null ? "null" : got.optString("name"));
        ok("备注还原", got != null && "每天早上点一下".equals(got.optString("desc")));
        ok("emoji 图标还原", got != null && "🎁".equals(got.optString("icon")));
        ok("JS 代码（含中文与换行）原样还原",
            got != null && got.optString("code").equals(a.optString("code")));
        ok("动作条数还原", got != null && got.optJSONArray("actions").length() == 2);
        ok("变量还原", got != null && got.optJSONArray("vars").length() == 1
            && "n".equals(got.optJSONArray("vars").optJSONObject(0).optString("k")));

        // 2. 往返：全部导出
        JSONArray arr = new JSONArray();
        arr.put(script("a 脚本"));
        arr.put(script("b 脚本"));
        String code2 = Share.all(arr);
        JSONObject back2 = Share.decode(code2);
        ok("解码认出是批量", "all".equals(back2.optString("kind")), back2.optString("err"));
        ok("批量里有两个脚本", back2.optJSONArray("scripts") != null
            && back2.optJSONArray("scripts").length() == 2);

        // 3. 微信复制过来常见的脏数据：换行、空格
        String dirty = code.replace("", "\n").replace("", " ");
        String dirty2 = code.substring(0, 20) + "\n   " + code.substring(20);
        ok("带换行和空格也能解出来", Share.decode(dirty2).optString("kind").equals("one"),
            Share.decode(dirty2).optString("err"));

        // 4. 坏码要给人话，不能崩
        ok("空码给提示", Share.decode("").has("err"), Share.decode("").optString("err"));
        ok("null 给提示", Share.decode(null).has("err"));
        ok("不是分享码给提示", Share.decode("hello world").has("err"), Share.decode("hello world").optString("err"));
        ok("前缀对但内容坏给提示", Share.decode("LT1.@@@@").has("err"), Share.decode("LT1.@@@@").optString("err"));
        ok("被截掉一截给提示", Share.decode(code.substring(0, code.length() / 2)).has("err"),
            Share.decode(code.substring(0, code.length() / 2)).optString("err"));

        // 5. 压缩率：小脚本压不动（base64 那 33% 膨胀吃掉了收益），大脚本必须明显变短。
        //    这里如实记录，不为了好看改断言。
        String raw = a.toString();
        ok("小脚本的码不超过原文的 1.5 倍", code.length() <= raw.length() * 1.5,
            raw.length() + " B → " + code.length() + " B（+" + (code.length() * 100 / raw.length() - 100) + "%）");

        // 6. 大脚本：50 个动作，码还应该在能粘贴的范围
        JSONObject big = script("大脚本");
        JSONArray many = new JSONArray();
        for (int i = 0; i < 50; i++) {
            JSONObject o = new JSONObject();
            try {
                o.put("t", "click");
                o.put("x", 100 + i);
                o.put("y", 200 + i);
                o.put("d", 300);
            } catch (Exception ignored) {
            }
            many.put(o);
        }
        big.put("actions", many);
        String bigCode = Share.one(big);
        JSONObject bigBack = Share.decode(bigCode);
        boolean bigOk = bigBack.optJSONObject("script") != null
            && bigBack.optJSONObject("script").optJSONArray("actions").length() == 50;
        ok("50 步的脚本往返正常", bigOk);
        int bigRaw = big.toString().length();
        int pct = bigCode.length() * 100 / bigRaw;
        ok("50 步的脚本码长压到原文的 30% 以内（实际 " + pct + "%）", pct <= 30,
            bigRaw + " B → " + bigCode.length() + " 字符");

        // 7. base64 里的 + 和 / 换成标准字符也要认（有人会顺手改）
        String std = code.replace('-', '+').replace('_', '/');
        ok("URL 安全字符被换成标准字符也能解", Share.decode(std).optString("kind").equals("one"),
            Share.decode(std).optString("err"));

        // 8. 中文脚本名
        JSONObject cn = script("🎯 抢红包 · 勿扰模式");
        ok("中文+emoji 名字往返正常",
            "🎯 抢红包 · 勿扰模式".equals(Share.decode(Share.one(cn)).optJSONObject("script").optString("name")));

        // 9. v2.0.0 新增的「条件判断」动作：字段里带嵌套数组 cs，分享码必须原样带过去
        System.out.println("\n=== v2.0.0 新结构 ===");
        JSONArray cs = new JSONArray();
        try {
            JSONObject c1 = new JSONObject();
            c1.put("k", "text"); c1.put("s", "签到"); c1.put("contains", true);
            JSONObject c2 = new JSONObject();
            c2.put("k", "color"); c2.put("c", "#FF6B35"); c2.put("sim", 95);
            c2.put("rx", 0); c2.put("ry", 0); c2.put("rw", 100); c2.put("rh", 100); c2.put("pct", 1);
            JSONObject c3 = new JSONObject();
            c3.put("k", "expr"); c3.put("v", "{{n}}>2");
            cs.put(c1); cs.put(c2); cs.put(c3);
        } catch (Exception ignored) {
        }
        JSONObject cond = new JSONObject();
        try {
            cond.put("t", "cond");
            cond.put("mode", 2);        // 满足指定个数
            cond.put("n", 2);
            cond.put("cs", cs);
            cond.put("go", 5);
            cond.put("els", 9);
            cond.put("rep", 1);
            cond.put("repGap", 1500);
            cond.put("repMax", 20);
        } catch (Exception ignored) {
        }
        JSONObject withCond = script("带条件的脚本");
        withCond.put("actions", new JSONArray().put(cond));
        JSONObject cb = Share.decode(Share.one(withCond)).optJSONObject("script");
        JSONObject gotCond = cb == null ? null : cb.optJSONArray("actions").optJSONObject(0);
        ok("cond 动作导过去还是 cond", gotCond != null && "cond".equals(gotCond.optString("t")));
        ok("cond 的 cs 嵌套数组条数不丢", gotCond != null && gotCond.optJSONArray("cs").length() == 3,
            gotCond == null ? "null" : "" + gotCond.optJSONArray("cs").length());
        ok("cs 里第二条的颜色参数完整", gotCond != null
            && "#FF6B35".equals(gotCond.optJSONArray("cs").optJSONObject(1).optString("c"))
            && gotCond.optJSONArray("cs").optJSONObject(1).optInt("rw") == 100);
        ok("cs 里的表达式（含 {{}}）不被改动", gotCond != null
            && "{{n}}>2".equals(gotCond.optJSONArray("cs").optJSONObject(2).optString("v")));
        ok("cond 的满足模式与个数都在", gotCond != null && gotCond.optInt("mode") == 2 && gotCond.optInt("n") == 2);
        ok("cond 的重复检查参数都在", gotCond != null && gotCond.optInt("repGap") == 1500 && gotCond.optInt("repMax") == 20);

        // 10. 脚本级开关：UI 存布尔，内置模板/老数据可能存数字 1 —— 分享码两边都得认
        JSONObject lb = script("布尔循环"); lb.put("loop", true); lb.put("jitter", true); lb.put("stopOnFail", true);
        JSONObject lbBack = Share.decode(Share.one(lb)).optJSONObject("script");
        ok("loop 存布尔时分享后还是开", lbBack.optBoolean("loop", false),
            "实际 " + lbBack.opt("loop"));
        ok("jitter 存布尔时分享后还是开", lbBack.optBoolean("jitter", false), "实际 " + lbBack.opt("jitter"));
        ok("stopOnFail 存布尔时分享后还是开", lbBack.optBoolean("stopOnFail", false), "实际 " + lbBack.opt("stopOnFail"));

        JSONObject ln = script("数字循环"); ln.put("loop", 1); ln.put("jitter", 1); ln.put("stopOnFail", 1);
        JSONObject lnBack = Share.decode(Share.one(ln)).optJSONObject("script");
        ok("loop 存数字 1 时分享后还是开", lnBack.optBoolean("loop", false),
            "实际 " + lnBack.opt("loop") + "（pack 里是 optBoolean，读不到数字就会静默变关）");
        ok("jitter 存数字 1 时分享后还是开", lnBack.optBoolean("jitter", false), "实际 " + lnBack.opt("jitter"));

        // 11. 动作里的 pct：UI 存布尔、模板存数字，分享码是原样搬运，两种都不能变
        JSONObject pb = script("布尔 pct");
        pb.put("actions", new JSONArray().put(new JSONObject().put("t", "click").put("x", 50).put("y", 50).put("pct", true)));
        Object pbb = Share.decode(Share.one(pb)).optJSONObject("script")
            .optJSONArray("actions").optJSONObject(0).opt("pct");
        ok("动作 pct 布尔形态分享后不变", Boolean.TRUE.equals(pbb), "实际 " + pbb);
        JSONObject pn = script("数字 pct");
        pn.put("actions", new JSONArray().put(new JSONObject().put("t", "click").put("x", 50).put("y", 50).put("pct", 1)));
        Object pnn = Share.decode(Share.one(pn)).optJSONObject("script")
            .optJSONArray("actions").optJSONObject(0).opt("pct");
        ok("动作 pct 数字形态分享后不变", Integer.valueOf(1).equals(pnn), "实际 " + pnn);

        System.out.println(fails == 0 ? "\n✅ 分享码全部通过" : "\n❌ 有 " + fails + " 项失败");
        if (fails > 0) System.exit(1);
    }
}
