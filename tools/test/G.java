// 动作分组引擎单测：把 ScriptRunner 里 v2.1.0 新增的分组逻辑原样搬过来，
// 只把「屏幕手势」换成桩，验证四种跑法（顺序 / 同时 / 打乱 / 随机一个）的语义。
//
// 跟 C.java 一样：改 ScriptRunner#execGroup 之后要同步改这里。
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class G {
    // ---- 桩：记录引擎干了什么 ----
    static List<String> trace = new ArrayList<>();      // 子动作执行轨迹
    static List<Integer> strokeCounts = new ArrayList<>(); // 每次「同时派发」发了几条
    static List<Long> strokeMs = new ArrayList<>();
    static List<String> logs = new ArrayList<>();
    static boolean running = true;
    static Random rnd = new Random(42);
    static int maxStrokes = 10;                          // 假装这台机器上限 10 条

    static final int JUMP_END = -1, JUMP_LOOP = -2;
    static final int G_SEQ = 0, G_ALL = 1, G_SHUFFLE = 2, G_ANY = 3;

    static int pass = 0, fail = 0;
    static void t(String n, boolean ok) {
        System.out.println((ok ? "  ✓ " : "  ✗ ") + n);
        if (ok) pass++; else fail++;
    }
    static void log(String s) { logs.add(s); }

    // ---- 被测：分组执行 ----
    static int execGroup(JSONObject a) {
        JSONArray acts = a.optJSONArray("acts");
        if (acts == null || acts.length() == 0) {
            log("这个分组是空的，跳过");
            return 0;
        }
        int mode = a.optInt("mode", G_SEQ);
        String name = a.optString("name", "");
        String tag = name.isEmpty() ? "" : "「" + name + "」";
        switch (mode) {
            case G_ALL: return execGroupTogether(acts);
            case G_SHUFFLE: return execGroupSeq(shuffled(acts));
            case G_ANY: {
                int k = rnd.nextInt(acts.length());
                JSONObject one = acts.optJSONObject(k);
                return one == null ? 0 : runSub(one);
            }
            default: return execGroupSeq(acts);
        }
    }

    static int execGroupSeq(JSONArray acts) {
        for (int i = 0; i < acts.length(); i++) {
            if (!running) return 0;
            int j = runSub(acts.optJSONObject(i));
            if (j == JUMP_END || j == JUMP_LOOP) return j;
        }
        return 0;
    }

    static int execGroupTogether(JSONArray acts) {
        List<String> paths = new ArrayList<>();
        for (int i = 0; i < acts.length(); i++) {
            if (!running) return 0;
            JSONObject sub = acts.optJSONObject(i);
            if (sub == null) continue;
            String p = pathOf(sub);
            if (p != null) { paths.add(p); continue; }
            int j = runSub(sub);
            if (j == JUMP_END || j == JUMP_LOOP) return j;
        }
        if (paths.isEmpty()) return 0;
        int max = maxStrokes;
        if (paths.size() > max) {
            log("同时派的手势有 " + paths.size() + " 条，超过系统上限 " + max + " 条，只发前 " + max + " 条");
            paths = paths.subList(0, max);
        }
        long ms = 0;
        for (int i = 0; i < acts.length(); i++) {
            JSONObject o = acts.optJSONObject(i);
            long d = o == null ? 0 : o.optLong("ms", 0);
            if (d > ms) ms = d;
        }
        strokeCounts.add(paths.size());
        strokeMs.add(ms < 60 ? 80 : ms);
        trace.add("STROKES x" + paths.size());
        return 0;
    }

    /** 桩：只有手势类动作能转成路径 */
    static String pathOf(JSONObject a) {
        if (a == null) return null;
        String t = a.optString("t", "");
        if ("click".equals(t) || "long".equals(t) || "random".equals(t)) return "tap";
        if ("swipe".equals(t)) return "swipe";
        return null;
    }

    /** 桩：跑一个子动作，记录轨迹；返回它要求的跳转 */
    static int runSub(JSONObject sub) {
        if (sub == null) return 0;
        String t = sub.optString("t", "?");
        trace.add(t);
        return sub.optInt("__jump", 0);   // 测试里用 __jump 模拟「收工 / 重来一轮」
    }

    static JSONArray shuffled(JSONArray src) {
        JSONArray out = new JSONArray();
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < src.length(); i++) list.add(src.optJSONObject(i));
        for (int i = list.size() - 1; i > 0; i--) {
            int j = rnd.nextInt(i + 1);
            JSONObject tmp = list.get(i); list.set(i, list.get(j)); list.set(j, tmp);
        }
        for (JSONObject o : list) out.put(o);
        return out;
    }

    // ---- 造数据 ----
    static JSONObject act(String t) {
        JSONObject o = new JSONObject();
        try { o.put("t", t); } catch (Exception ignored) {}
        return o;
    }
    static JSONObject group(int mode, JSONObject... subs) {
        JSONObject g = new JSONObject();
        JSONArray a = new JSONArray();
        for (JSONObject s : subs) a.put(s);
        try { g.put("t", "group"); g.put("mode", mode); g.put("acts", a); } catch (Exception ignored) {}
        return g;
    }
    static void reset() {
        trace.clear(); strokeCounts.clear(); strokeMs.clear(); logs.clear();
        running = true;
    }

    public static void main(String[] args) {
        System.out.println("=== v2.1.0 动作分组 ===");

        // ---- 1. 顺序：一个个来 ----
        System.out.println("\n[1] 按顺序跑");
        reset();
        execGroup(group(G_SEQ, act("click"), act("wait"), act("swipe")));
        t("三个动作按原顺序执行", trace.toString().equals("[click, wait, swipe]"));
        t("没有派发过同时手势", strokeCounts.isEmpty());

        // ---- 2. 同时：手势合成一次派发 ----
        System.out.println("\n[2] 同时来（多指）");
        reset();
        execGroup(group(G_ALL, act("click"), act("swipe"), act("click")));
        t("三条手势合成一次派发", strokeCounts.size() == 1 && strokeCounts.get(0) == 3);
        t("派发时长取组里最大的 ms", strokeMs.get(0) == 80);
        t("非手势动作不混进手势里", trace.contains("STROKES x3"));

        reset();
        execGroup(group(G_ALL, act("click"), act("wait"), act("swipe")));
        t("同时模式里非手势动照常跑", trace.contains("wait") && trace.contains("STROKES x2"));

        // 只有非手势动作时不该派发空手势
        reset();
        execGroup(group(G_ALL, act("wait"), act("wait")));
        t("全是非手势时不派空手势", strokeCounts.isEmpty() && trace.contains("wait"));

        // ---- 3. 超过系统上限要截断 ----
        System.out.println("\n[3] 手势条数上限");
        reset();
        maxStrokes = 3;
        execGroup(group(G_ALL, act("click"), act("click"), act("click"), act("click"), act("click")));
        t("超过上限只派上限条数（5 条 → 3 条）", strokeCounts.size() == 1 && strokeCounts.get(0) == 3);
        t("截断时给人话日志", logs.stream().anyMatch(s -> s.contains("超过系统上限")));
        maxStrokes = 10;

        // ---- 4. 打乱顺序：元素不丢，顺序不一定原样 ----
        System.out.println("\n[4] 打乱顺序");
        reset();
        JSONObject g4 = group(G_SHUFFLE, act("a"), act("b"), act("c"), act("d"), act("e"));
        execGroup(g4);
        t("五个动作一个不少", trace.size() == 5);
        t("五个动作没有重复", new java.util.HashSet<>(trace).size() == 5);
        // 多次打乱，至少有一次顺序跟原来不同（不然就是没打乱）
        boolean diff = false;
        for (int i = 0; i < 20; i++) {
            reset();
            execGroup(g4);
            if (!trace.toString().equals("[a, b, c, d, e]")) { diff = true; break; }
        }
        t("多次执行中至少有一次顺序被打乱", diff);

        // ---- 5. 随机挑一个：每次只跑一个 ----
        System.out.println("\n[5] 随机挑一个");
        reset();
        JSONObject g5 = group(G_ANY, act("a"), act("b"), act("c"));
        execGroup(g5);
        t("每次只跑一个动作", trace.size() == 1);
        t("跑的是组里的某一个", "[a, b, c]".contains(trace.get(0)));
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < 200; i++) { reset(); execGroup(g5); seen.addAll(trace); }
        t("跑多次能覆盖到全部三个（不是永远挑同一个）", seen.size() == 3);

        // ---- 6. 空分组不崩 ----
        System.out.println("\n[6] 空分组");
        reset();
        t("空分组返回 0 不崩", execGroup(group(G_SEQ)) == 0);
        t("空分组给提示", logs.stream().anyMatch(s -> s.contains("空的")));
        JSONObject noActs = new JSONObject();
        try { noActs.put("t", "group"); } catch (Exception ignored) {}
        reset();
        t("连 acts 字段都没有也不崩", execGroup(noActs) == 0);

        // ---- 7. 子动作的跳转：只有收工/重来往上传 ----
        System.out.println("\n[7] 子动作跳转语义");
        reset();
        JSONObject endSub = act("click");
        try { endSub.put("__jump", JUMP_END); } catch (Exception ignored) {}
        t("子动作喊收工，整组立刻结束", execGroup(group(G_SEQ, endSub, act("never"))) == JUMP_END);
        t("收工后面那个动作没跑", !trace.contains("never"));

        reset();
        JSONObject loopSub = act("click");
        try { loopSub.put("__jump", JUMP_LOOP); } catch (Exception ignored) {}
        t("子动作喊重来一轮，也往上传", execGroup(group(G_SEQ, loopSub)) == JUMP_LOOP);

        reset();
        JSONObject goSub = act("click");
        try { goSub.put("__jump", 3); } catch (Exception ignored) {}   // 普通步号跳转
        t("子动作里的普通步号跳转被忽略（分组内没有步号概念）",
            execGroup(group(G_SEQ, goSub, act("after"))) == 0 && trace.contains("after"));

        // ---- 8. 停止要能中断 ----
        System.out.println("\n[8] 停止中断");
        reset();
        running = false;
        execGroup(group(G_SEQ, act("a"), act("b")));
        t("已停止时一个子动作都不跑", trace.isEmpty());
        reset();
        running = false;
        execGroup(group(G_ALL, act("click"), act("click")));
        t("已停止时也不派手势", strokeCounts.isEmpty());

        // ---- 9. 同时模式的时长取最大值 ----
        System.out.println("\n[9] 同时模式的时长");
        reset();
        JSONObject s1 = act("swipe"); JSONObject s2 = act("click");
        try { s1.put("ms", 500); s2.put("ms", 200); } catch (Exception ignored) {}
        execGroup(group(G_ALL, s1, s2));
        t("时长取组里最大的（500，不是 200）", strokeMs.get(0) == 500);
        reset();
        execGroup(group(G_ALL, act("click")));   // 没写 ms
        t("没写 ms 时给个下限不至于 0", strokeMs.get(0) == 80);

        System.out.println("\n===== 通过 " + pass + " / 失败 " + fail + " =====");
        if (fail > 0) System.exit(1);
    }
}
