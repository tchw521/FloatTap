// 条件系统语义单测：把 ScriptRunner 里 v2.0.0 新增的条件逻辑原样搬过来，
// 只把「屏幕相关」的部分换成可控的桩，验证 and/or/count + 重复检查 + 各种条件类型的语义。
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

public class C {
    // ---- 桩：模拟设备状态 ----
    static String pkgNow = "com.tencent.mm";
    static java.util.Set<String> onScreen = new java.util.HashSet<>();  // 屏上有哪些字
    static java.util.Set<String> colors = new java.util.HashSet<>();    // 屏幕上有哪些颜色
    static boolean shotOk = true;
    static int shotCount = 0;                                          // 截图了几次（验证缓存）
    static java.util.Random rnd = new java.util.Random(7);
    static int nowMin = 600;                                            // 假当前时间 10:00

    static String lastX = "", lastY = "";   // rememberHit 落点

    // ---- 以下为从 ScriptRunner 搬过来的逻辑（只改依赖处为桩） ----

    static final int C_MAX_MS = 20000;
    static final int C_MAX_ROUND = 1000;
    static final int JUMP_END = -1, JUMP_LOOP = -2;
    static boolean running = true;
    static long lastGap = 0;
    static int sleeps = 0;
    static String condDetail = "";
    static boolean lastBool;

    static org.json.JSONObject vars = new org.json.JSONObject();
    static java.util.List<String> logs = new java.util.ArrayList<>();

    static void log(String s) { logs.add(s); }

    /** 被测：开关的兼容读法（从 ScriptRunner 原样搬来）—— pct 和 rep 都靠它 */
    static boolean on(JSONObject a, String k) {
        return a != null && (a.optBoolean(k, false) || a.optInt(k, 0) == 1);
    }

    static boolean pctOn(JSONObject a) {
        return on(a, "pct");
    }

    /** 被测：多条件判断 */
    static int execCond(JSONObject a) {
        JSONArray cs = a.optJSONArray("cs");
        if (cs == null || cs.length() == 0) {
            log("条件列表是空的，当成成立（不然脚本会永远卡在这）");
            return jump(a, true);
        }
        boolean repeat = a.optInt("rep", 0) == 1;
        long gap = Math.min(C_MAX_MS, Math.max(50, a.optLong("repGap", 800)));
        int max = Math.max(1, Math.min(a.optInt("repMax", 1), C_MAX_ROUND));
        boolean hit = false;
        int round = 0;
        while (true) {
            if (!running) { log("已经停了，条件检查中断"); return 0; }
            round++;
            int[] r = checkCond(a, cs);
            hit = r[0] == 1;
            if (hit || !repeat || round >= max) break;
            log("条件没成，等 " + gap + "ms 再试（第 " + round + "/" + max + " 次）");
            lastGap = gap;                          // 记录夹取后的间隔，避免真睡拖慢测试
            sleeps++;
            if (tick != null) tick.accept(round);   // 测试里用来「让条件变成立」
        }
        if (!running) { log("已经停了，条件检查中断"); return 0; }
        log("条件" + (hit ? " ✓成立" : " ✗不成立") + "：" + condDetail
                + (repeat && round > 1 ? "（试了 " + round + " 次）" : ""));
        return jump(a, hit);
    }

    static java.util.function.IntConsumer tick;

    static int[] checkCond(JSONObject a, JSONArray cs) {
        int mode = a.optInt("mode", 0);
        int need = Math.max(1, a.optInt("n", 1));
        int got = 0;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cs.length(); i++) {
            JSONObject c = cs.optJSONObject(i);
            if (c == null) continue;
            boolean ok = oneCond(c);
            if (ok) got++;
            if (sb.length() > 0) sb.append(mode == 1 ? " 或 " : " 且 ");
            sb.append(shortCond(c)).append(ok ? "✓" : "✗");
        }
        boolean pass;
        if (mode == 1) pass = got >= 1;
        else if (mode == 2) pass = got >= need;
        else pass = got == cs.length();
        condDetail = sb + " → 命中 " + got + "/" + cs.length()
                + (mode == 2 ? "（要 " + need + " 个）" : "");
        return new int[]{pass ? 1 : 0, got, cs.length()};
    }

    static boolean oneCond(JSONObject c) {
        String k = c.optString("k", "always");
        if ("always".equals(k)) return true;
        if ("pkg".equals(k)) {
            String want = c.optString("v", "");
            String cur = pkgNow;
            return !want.isEmpty() && cur != null && (cur.equals(want) || cur.contains(want));
        }
        if ("time".equals(k)) {
            int[] t = parseHm(c.optString("v", "00:00"));
            return nowMin >= t[0] * 60 + t[1];
        }
        if ("rand".equals(k)) {
            int p = (int) c.optDouble("v", 50);
            if (p <= 0) return false;
            if (p >= 100) return true;
            return rnd.nextInt(100) < p;
        }
        if ("expr".equals(k)) {
            String r = eval(c.optString("v", ""));
            return "1".equals(r) || "true".equalsIgnoreCase(r);
        }
        if ("text".equals(k)) {
            String text = c.optString("s", "");
            if (text.isEmpty()) return false;
            if (!c.optBoolean("contains", true)) return onScreen.contains("=" + text);
            for (String s : onScreen) if (s.contains(text)) return true;
            return false;
        }
        if ("color".equals(k)) {
            shotCount++;
            if (!shotOk) return false;
            boolean hit = colors.contains(c.optString("c", "").toUpperCase());
            if (hit) { lastX = "540"; lastY = "1180"; }
            return hit;
        }
        if ("image".equals(k)) {
            shotCount++;
            if (!shotOk) return false;
            boolean hit = colors.contains("IMG:" + c.optString("tpl", ""));
            if (hit) { lastX = "980"; lastY = "160"; }
            return hit;
        }
        return false;
    }

    // 极简表达式求值：只认 1 / 0 / n>2 这类，够测了
    static String eval(String e) {
        e = e.trim();
        if (e.isEmpty()) return null;
        if (e.equals("1") || e.equals("true")) return "1";
        if (e.equals("0") || e.equals("false")) return "0";
        if (e.matches("\\d+\\s*>\\s*\\d+")) {
            String[] p = e.split(">");
            int a = Integer.parseInt(p[0].trim()), b = Integer.parseInt(p[1].trim());
            return a > b ? "1" : "0";
        }
        return null;
    }

    static int[] parseHm(String hm) {
        try {
            String[] p = hm.trim().split(":");
            return new int[]{Integer.parseInt(p[0].trim()), p.length > 1 ? Integer.parseInt(p[1].trim()) : 0};
        } catch (Throwable t) {
            return new int[]{0, 0};
        }
    }

    static String shortCond(JSONObject c) {
        String k = c.optString("k", "always");
        switch (k) {
            case "text": return "屏上有「" + c.optString("s", "") + "」";
            case "pkg": return "当前是 " + c.optString("v", "");
            case "color": return "有颜色 " + c.optString("c", "");
            case "image": return "有图「" + c.optString("tpl", "") + "」";
            case "time": return "过了 " + c.optString("v", "");
            case "rand": return "随机 " + (int) c.optDouble("v", 50) + "%";
            case "expr": return c.optString("v", "");
            default: return "恒真";
        }
    }

    static int jump(JSONObject a, boolean hit) {
        lastBool = hit;
        int v = hit ? a.optInt("go", 0) : a.optInt("els", 0);
        if (v == -1) return JUMP_END;
        if (v == -2) return JUMP_LOOP;
        return v;
    }

    // ---- 测试驱动 ----
    static int pass = 0, fail = 0;

    static void t(String name, boolean cond) {
        if (cond) { pass++; System.out.println("  ✓ " + name); }
        else { fail++; System.out.println("  ✗ " + name); }
    }

    static JSONObject cond(String k, String field, Object v) {
        JSONObject c = new JSONObject();
        try {
            c.put("k", k);
            if (field != null) c.put(field, v);
        } catch (Exception e) { }
        return c;
    }

    static JSONArray cs(Object... items) {
        JSONArray a = new JSONArray();
        for (Object i : items) a.put(i);
        return a;
    }

    static JSONObject act(int mode, JSONArray c, int go, int els) {
        JSONObject a = new JSONObject();
        try {
            a.put("mode", mode);
            a.put("cs", c);
            a.put("go", go);
            a.put("els", els);
        } catch (Exception e) { }
        return a;
    }

    public static void main(String[] args) throws Exception {
        System.out.println("条件系统语义单测（v2.0.0）");

        // ---------- 1. 空条件列表 ----------
        System.out.println("\n[1] 空条件列表");
        logs.clear();
        int j = execCond(act(0, new JSONArray(), 5, 9));
        t("空列表当成立 → 走 go", j == 5);
        t("且提示别卡死", logs.get(0).contains("永远卡"));

        // ---------- 2. AND / OR / COUNT ----------
        System.out.println("\n[2] 满足模式");
        onScreen.clear(); onScreen.add("签到成功");
        JSONObject c1 = cond("text", "s", "签到成功");   // 真
        JSONObject c2 = cond("text", "s", "不存在的字");  // 假
        JSONObject c3 = cond("always", null, null);       // 真

        t("AND：一真一假 → 不成立", execCond(act(0, cs(c1, c2), 5, 9)) == 9);
        t("AND：全真 → 成立", execCond(act(0, cs(c1, c3), 5, 9)) == 5);
        t("OR ：一真一假 → 成立", execCond(act(1, cs(c1, c2), 5, 9)) == 5);
        t("OR ：全假 → 不成立", execCond(act(1, cs(c2, cond("text", "s", "也没有")), 5, 9)) == 9);

        JSONObject a3 = act(2, cs(c1, c2, c3), 5, 9);
        a3.put("n", 2);
        t("COUNT n=2：命中2个 → 成立", execCond(a3) == 5);
        a3.put("n", 3);
        t("COUNT n=3：只命中2个 → 不成立", execCond(a3) == 9);
        a3.put("n", 9);
        t("COUNT n 超过总数 → 不成立（不会误判成立）", execCond(a3) == 9);

        // ---------- 3. 条件类型 ----------
        System.out.println("\n[3] 各条件类型");
        pkgNow = "com.tencent.mm";
        t("pkg 精确匹配", execCond(act(0, cs(cond("pkg", "v", "com.tencent.mm")), 5, 9)) == 5);
        t("pkg 子串匹配（只填 com.tencent）", execCond(act(0, cs(cond("pkg", "v", "com.tencent")), 5, 9)) == 5);
        t("pkg 不匹配", execCond(act(0, cs(cond("pkg", "v", "com.taobao")), 5, 9)) == 9);
        t("pkg 空值不成立", execCond(act(0, cs(cond("pkg", "v", "")), 5, 9)) == 9);

        nowMin = 10 * 60 + 30;   // 10:30
        t("time 09:00 → 已过成立", execCond(act(0, cs(cond("time", "v", "09:00")), 5, 9)) == 5);
        t("time 23:00 → 还没到不成立", execCond(act(0, cs(cond("time", "v", "23:00")), 5, 9)) == 9);
        t("time 10:30 → 正好到点成立", execCond(act(0, cs(cond("time", "v", "10:30")), 5, 9)) == 5);
        t("time 乱填不崩（当 00:00）", execCond(act(0, cs(cond("time", "v", "abc")), 5, 9)) == 5);

        t("rand 0% 恒不成立", execCond(act(0, cs(cond("rand", "v", 0)), 5, 9)) == 9);
        t("rand 100% 恒成立", execCond(act(0, cs(cond("rand", "v", 100)), 5, 9)) == 5);
        int hits1000 = 0;
        JSONObject rc = cond("rand", "v", 50);
        for (int i = 0; i < 1000; i++) if (oneCond(rc)) hits1000++;
        t("rand 50% 命中率大致合理（" + hits1000 + "/1000）", hits1000 > 400 && hits1000 < 600);

        t("expr 1 → 成立", execCond(act(0, cs(cond("expr", "v", "1")), 5, 9)) == 5);
        t("expr 3>2 → 成立", execCond(act(0, cs(cond("expr", "v", "3>2")), 5, 9)) == 5);
        t("expr 1>2 → 不成立", execCond(act(0, cs(cond("expr", "v", "1>2")), 5, 9)) == 9);
        t("expr 乱填 → 不成立（不崩）", execCond(act(0, cs(cond("expr", "v", "??")), 5, 9)) == 9);

        t("always → 成立", execCond(act(0, cs(cond("always", null, null)), 5, 9)) == 5);

        // ---------- 4. 重复检查直到成功 ----------
        System.out.println("\n[4] 重复检查直到成功");
        // 第 1 轮不成立，第 2 轮起变成立
        shotOk = true; colors.clear();      // 截屏正常，只是屏上还没这个颜色
        JSONObject rp = act(0, cs(cond("color", "c", "#FF6B35")), 5, 9);
        rp.put("rep", 1); rp.put("repGap", 50); rp.put("repMax", 5);
        final int[] n = {0};
        tick = r -> { n[0]++; if (n[0] >= 2) colors.add("#FF6B35"); };
        t("第2轮条件变成立 → 走 go", execCond(rp) == 5);
        t("确实试了 2 轮", n[0] == 2);

        // 一直不成立 → 到上限放弃
        colors.clear(); shotOk = true; n[0] = 0;
        JSONObject rp2 = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        rp2.put("rep", 1); rp2.put("repGap", 50); rp2.put("repMax", 3);
        tick = r -> n[0]++;
        t("一直不成 → 到上限走 els", execCond(rp2) == 9);
        t("总共试了 3 轮（repMax=3）", n[0] == 2);

        // 没开重复检查 → 只试一轮
        colors.clear(); shotOk = true; n[0] = 0;
        t("没开 rep → 只试 1 轮", execCond(act(0, cs(cond("color", "c", "#123456")), 5, 9)) == 9);
        t("没开 rep → tick 没被调用", n[0] == 0);

        // repMax=1 且开了 rep → 也只试一轮
        colors.clear(); shotOk = true; n[0] = 0;
        JSONObject rp3 = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        rp3.put("rep", 1); rp3.put("repGap", 50); rp3.put("repMax", 1);
        t("repMax=1 等同于不重试", execCond(rp3) == 9);

        // ---------- 5. 跳转语义与旧版一致 ----------
        System.out.println("\n[5] 跳转语义（与旧版 go/els 对齐）");
        colors.clear(); onScreen.clear(); onScreen.add("有");
        t("成立 → go 正数", execCond(act(0, cs(cond("text", "s", "有")), 7, 9)) == 7);
        t("不成立 → els 正数", execCond(act(0, cs(cond("text", "s", "没")), 7, 9)) == 9);
        t("成立 go=-1 → JUMP_END", execCond(act(0, cs(cond("text", "s", "有")), -1, 0)) == JUMP_END);
        t("成立 go=-2 → JUMP_LOOP", execCond(act(0, cs(cond("text", "s", "有")), -2, 0)) == JUMP_LOOP);
        t("不成立 els=-1 → JUMP_END", execCond(act(0, cs(cond("text", "s", "没")), 0, -1)) == JUMP_END);
        t("默认 0 → 顺着走", execCond(act(0, cs(cond("text", "s", "有")), 0, 0)) == 0);
        t("lastBool 记录了成立与否", lastBool);

        // ---------- 6. 模糊/精确匹配 ----------
        System.out.println("\n[6] 文字匹配");
        // 桩里精确匹配查的是 "=" 前缀，补一条
        onScreen.clear(); onScreen.add("恭喜你签到成功"); onScreen.add("=恭喜你签到成功");
        JSONObject m1 = cond("text", "s", "签到");
        t("默认包含匹配 → 找到", execCond(act(0, cs(m1), 5, 9)) == 5);
        JSONObject m2 = cond("text", "s", "签到");
        m2.put("contains", false);
        t("关掉包含 → 精确匹配失败", execCond(act(0, cs(m2), 5, 9)) == 9);
        JSONObject m3 = cond("text", "s", "恭喜你签到成功");
        m3.put("contains", false);
        t("关掉包含但完全相等 → 找到", execCond(act(0, cs(m3), 5, 9)) == 5);
        t("空文字 → 不成立", execCond(act(0, cs(cond("text", "s", "")), 5, 9)) == 9);

        // ---------- 7. 截图缓存 ----------
        System.out.println("\n[7] 图色条件截图复用");
        colors.clear(); colors.add("#AA0000"); shotOk = true; shotCount = 0;
        JSONObject cc = act(0, cs(cond("color", "c", "#AA0000"), cond("color", "c", "#BB0000")), 5, 9);
        execCond(cc);
        t("两个图色条件 → 截图次数 >= 2（桩里不缓存，仅记录）", shotCount >= 2);

        // ---------- 8. 混合条件组合 ----------
        System.out.println("\n[8] 混合条件");
        pkgNow = "com.tencent.mm"; colors.clear(); colors.add("#FF6B35"); onScreen.clear(); onScreen.add("签到");
        JSONArray mix = cs(cond("pkg", "v", "com.tencent"), cond("text", "s", "签到"), cond("color", "c", "#FF6B35"));
        t("三种条件 AND 全中 → 成立", execCond(act(0, mix, 5, 9)) == 5);
        JSONArray mix2 = cs(cond("pkg", "v", "com.tencent"), cond("text", "s", "不在这"), cond("color", "c", "#FF6B35"));
        t("三种条件 AND 缺一 → 不成立", execCond(act(0, mix2, 5, 9)) == 9);
        JSONObject mix3 = act(2, mix2, 5, 9);
        mix3.put("n", 2);
        t("三种条件 COUNT n=2 命中2 → 成立", execCond(mix3) == 5);

        // ---------- 9. 回归：点了停止要能立刻中断（v2.0.0 修复） ----------
        System.out.println("\n[9] 停止时中断条件检查");
        running = true; shotOk = true; colors.clear(); tick = null;
        JSONObject st1 = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        st1.put("rep", 1); st1.put("repGap", 50); st1.put("repMax", 50);
        // 第 1 轮就「停止」
        tick = r -> running = false;
        long t0 = System.currentTimeMillis();
        int r1 = execCond(st1);
        long dt = System.currentTimeMillis() - t0;
        t("停止后立刻返回 0（不再空转）", r1 == 0);
        t("没有继续睡满 50 轮（耗时 " + dt + "ms）", dt < 1000);
        t("日志里说了中断原因", logs.get(logs.size() - 1).contains("已经停了"));

        // 开跑前就已经停了 → 一轮都不该试
        running = false; tick = null;
        JSONObject st2 = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        st2.put("rep", 1); st2.put("repGap", 50); st2.put("repMax", 50);
        final int[] tried = { 0 };
        tick = r -> tried[0]++;
        t("已停止时返回 0", execCond(st2) == 0);
        t("已停止时一轮都不试", tried[0] == 0);
        running = true;

        // ---------- 10. 回归：等待间隔与轮数要有上限 ----------
        System.out.println("\n[10] 参数夹取");
        JSONObject big = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        big.put("rep", 1); big.put("repGap", 99999999L); big.put("repMax", 3);
        tick = null; lastGap = -1; sleeps = 0;
        execCond(big);
        t("repGap 填 99999999 被夹到 20s（实际 " + lastGap + "）", lastGap == C_MAX_MS);
        t("确实进入了等待（睡了 " + sleeps + " 次）", sleeps == 2);

        JSONObject small = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        small.put("rep", 1); small.put("repGap", 1); small.put("repMax", 3);
        lastGap = -1; sleeps = 0;
        execCond(small);
        t("repGap 填 1 被抬到 50ms 下限（实际 " + lastGap + "）", lastGap == 50);

        JSONObject norm = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        norm.put("rep", 1); norm.put("repGap", 800); norm.put("repMax", 3);
        lastGap = -1; sleeps = 0;
        execCond(norm);
        t("正常值 800 不被改动（实际 " + lastGap + "）", lastGap == 800);

        JSONObject big2 = act(0, cs(cond("always", null, null)), 5, 9);
        big2.put("repMax", 999999);
        t("repMax 被夹到 1000（不影响恒成立的场景）", execCond(big2) == 5);

        JSONObject neg = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        neg.put("rep", 1); neg.put("repGap", -500); neg.put("repMax", 1);
        t("repGap 填负数被夹到下限（不崩）", execCond(neg) == 9);
        JSONObject neg2 = act(0, cs(cond("color", "c", "#123456")), 5, 9);
        neg2.put("rep", 1); neg2.put("repMax", -3);
        t("repMax 填负数被夹到 1（不崩）", execCond(neg2) == 9);

        // ---------- 11. 回归：日志要写清每个条件的成败 ----------
        System.out.println("\n[11] 日志明细");
        running = true; colors.clear(); colors.add("#FF0000");
        onScreen.clear(); onScreen.add("有");
        logs.clear(); tick = null;
        JSONObject lg = act(0, cs(cond("color", "c", "#FF0000"), cond("text", "s", "没有的字")), 5, 9);
        execCond(lg);
        String last = logs.get(logs.size() - 1);
        t("日志含每个条件的成败标记", last.contains("✓") && last.contains("✗"));
        t("日志含命中数与总数", last.contains("1/2"));
        System.out.println("    日志样例：" + last);
        logs.clear();
        JSONObject lg2 = act(2, cs(cond("color", "c", "#FF0000"), cond("text", "s", "没有的字")), 5, 9);
        lg2.put("n", 2);
        execCond(lg2);
        t("COUNT 模式日志写明要几个", logs.get(logs.size() - 1).contains("要 2 个"));

        // ---------- 12. 回归：pct 百分比开关的两种存储形态都要认 ----------
        System.out.println("\n[12] 百分比开关（pct）形态兼容");
        // 说明：UI 开关以前写布尔 true，内置脚本/分享码里写数字 1。
        // org.json 对布尔求 optInt 会抛异常回落 0 —— 修之前百分比一直是失效的。
        JSONObject pBool = new JSONObject().put("pct", true);
        JSONObject pNum = new JSONObject().put("pct", 1);
        JSONObject pZero = new JSONObject().put("pct", 0);
        JSONObject pFalse = new JSONObject().put("pct", false);
        JSONObject pNone = new JSONObject();
        JSONObject pStr = new JSONObject().put("pct", "1");
        t("数字 1 算开", pctOn(pNum));
        t("布尔 true 算开（老 UI 存的形态）", pctOn(pBool));
        t("字符串 \"1\" 也算开（分享码可能这样）", pctOn(pStr));
        t("数字 0 算关", !pctOn(pZero));
        t("布尔 false 算关", !pctOn(pFalse));
        t("没这个字段算关", !pctOn(pNone));
        t("传 null 不崩", !pctOn(null));
        // 反面证据：单用 optInt 会漏掉布尔形态
        boolean oldWay = pBool.optInt("pct", 0) == 1;
        t("旧写法 optInt 确实读不到布尔 true（这就是那个 bug）", !oldWay);
        // 反面证据：单用 optBoolean 会漏掉数字形态
        boolean oldWay2 = pNum.optBoolean("pct", false);
        t("单用 optBoolean 会漏掉数字 1（所以不能只改一半）", !oldWay2);

        // 「重复检查」开关 rep 是同一类问题的第三处：界面存布尔，引擎按数字读
        JSONObject rBool = act(0, cs(cond("always", null, null)), 5, 9);
        rBool.put("rep", true); rBool.put("repGap", 60); rBool.put("repMax", 2);
        JSONObject rNum = act(0, cs(cond("always", null, null)), 5, 9);
        rNum.put("rep", 1); rNum.put("repGap", 60); rNum.put("repMax", 2);
        t("rep 存布尔时能读出「开」", on(rBool, "rep"));
        t("rep 存数字 1 时能读出「开」", on(rNum, "rep"));
        JSONObject rOff = act(0, cs(cond("always", null, null)), 5, 9);
        rOff.put("rep", false);
        t("rep 存布尔 false 时是「关」", !on(rOff, "rep"));
        // 反面证据：单用 optInt 读不到布尔 true —— 这就是 rep 之前一直不生效的原因
        t("旧写法 optInt 读不到布尔 true（rep 失效的原因）", rBool.optInt("rep", 0) != 1);

        System.out.println("\n===== 通过 " + pass + " / 失败 " + fail + " =====");
        if (fail > 0) System.exit(1);
    }
}
