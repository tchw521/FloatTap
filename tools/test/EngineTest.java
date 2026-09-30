import org.json.*;
import java.util.*;

/**
 * 引擎语义仿真：复刻 ScriptRunner 的 step() 主循环与 exec* 跳转逻辑，
 * 用假的「点击/找色」记录执行轨迹，验证变量与跳转真的按预期走。
 * 这里刻意逐行对齐 ScriptRunner，改引擎时要同步改这里，否则测的就不是真代码。
 */
public class EngineTest {
    static final int END = -1, LOOP = -2;

    // ---- 被仿真的执行状态 ----
    Vars vars = new Vars();
    Map<String,Integer> counters = new HashMap<>();
    JSONArray actions;
    int index = 0, loopLeft = 1, repeatLeft = 0, loop = 1;
    boolean running = true;
    List<String> trace = new ArrayList<>();
    List<Integer> clicked = new ArrayList<>();

    // 假屏幕：返回预设的找色/找图结果
    int[] colorHit = null;

    void run(JSONObject script) {
        actions = script.optJSONArray("actions");
        vars.load(script.optJSONArray("vars"));
        vars.loop = 1;
        vars.cnt = counters;
        vars.screenW = 1080; vars.screenH = 1920;
        loopLeft = script.optBoolean("loop", false) ? -1 : Math.max(1, script.optInt("loopCount", 1));
        index = 0;
        int guard = 0;
        while (running && guard++ < 500) step();
    }

    void step() {
        if (!running) return;
        if (index >= actions.length()) {
            if (loopLeft == -1 || loopLeft > 1) {
                if (loopLeft > 1) loopLeft--;
                index = 0; loop++; vars.loop = loop;
                trace.add("LOOP");
                return;
            }
            running = false;
            trace.add("END");
            return;
        }
        JSONObject raw = actions.optJSONObject(index);
        if (raw == null) { index++; return; }
        vars.step = index + 1;
        JSONObject a = vars.bind(raw);
        int rep = Math.max(1, a.optInt("repeat", 1));
        if (repeatLeft <= 0) repeatLeft = rep;
        repeatLeft--;
        index++;
        if (repeatLeft > 0) index--;
        int jump = exec(a);
        if (jump == END) { running = false; trace.add("END"); return; }
        if (jump == LOOP) { index = 0; repeatLeft = 0; if (loopLeft > 1) loopLeft--; loop++; vars.loop = loop; trace.add("LOOP"); return; }
        if (jump > 0) index = jump - 1;
        if (index < 0) index = 0;
    }

    int exec(JSONObject a) {
        switch (a.optString("t","")) {
            case "set": {
                String k = a.optString("k","").trim();
                if (k.isEmpty()) return 0;
                vars.put(k, a.optString("v",""));
                trace.add("set " + k + "=" + a.optString("v",""));
                return 0;
            }
            case "math": {
                String k = a.optString("k","").trim(), e = a.optString("e","").trim();
                if (k.isEmpty() || e.isEmpty()) return 0;
                String r = vars.eval(e);
                if (r == null) { vars.put(k, e); trace.add("math! " + k + "=" + e); return 0; }
                vars.put(k, r);
                trace.add("math " + k + "=" + e + "→" + r);
                return 0;
            }
            case "cmpVar": {
                boolean hit = cmp(a.optString("l",""), a.optString("op","=="), a.optString("r",""));
                trace.add("cmp " + a.optString("l") + a.optString("op") + a.optString("r") + (hit?" ✓":" ✗"));
                return jump(a, hit);
            }
            case "count": {
                String k = a.optString("k","main");
                int cur = counters.containsKey(k) ? counters.get(k) : 0;
                if ("reset".equals(a.optString("mode","add"))) cur = 0; else cur += a.optInt("v",1);
                counters.put(k, cur);
                int times = a.optInt("times",0);
                trace.add("count " + k + "=" + cur);
                if (times > 0 && cur >= times) {
                    if (a.optBoolean("resetAfter", true)) counters.put(k, 0);
                    int go = a.optInt("go",0);
                    if (go == -1) return END;
                    if (go == -2) return LOOP;
                    return go;
                }
                return 0;
            }
            case "findColor": {
                if (colorHit != null) {
                    vars.put("lastX", String.valueOf(colorHit[0]));
                    vars.put("lastY", String.valueOf(colorHit[1]));
                    vars.put("lastSim", String.valueOf(colorHit[2]));
                    trace.add("findColor hit @" + colorHit[0] + "," + colorHit[1]);
                    if (a.optBoolean("click", true)) clicked.add(colorHit[0]*10000 + colorHit[1]);
                    return jump(a, true);
                }
                trace.add("findColor miss");
                return jump(a, false);
            }
            case "click": {
                int x = (int) a.optDouble("x", 0), y = (int) a.optDouble("y", 0);
                clicked.add(x*10000 + y);
                trace.add("click (" + x + "," + y + ")");
                return 0;
            }
            default:
                trace.add("?" + a.optString("t"));
                return 0;
        }
    }

    int jump(JSONObject a, boolean hit) {
        int v = hit ? a.optInt("go",0) : a.optInt("els",0);
        if (v == -1) return END;
        if (v == -2) return LOOP;
        return v;
    }

    boolean cmp(String l, String op, String r) {
        String lv = val(l), rv = val(r);
        boolean num = isNum(lv) && isNum(rv);
        if ("==".equals(op)) return num ? d(lv)==d(rv) : lv.equals(rv);
        if ("!=".equals(op)) return num ? d(lv)!=d(rv) : !lv.equals(rv);
        double x = d(lv), y = d(rv);
        if (">".equals(op)) return x>y;
        if (">=".equals(op)) return x>=y;
        if ("<".equals(op)) return x<y;
        return x<=y;
    }
    String val(String s) { if (s==null||s.isEmpty()) return ""; String e = vars.eval(s); return e==null?s:e; }
    static boolean isNum(String s){ if(s==null||s.trim().isEmpty()) return false; try{Double.parseDouble(s.trim());return true;}catch(Exception e){return false;} }
    static double d(String s){ try{return Double.parseDouble(s.trim());}catch(Exception e){return 0;} }

    // ---------------- 断言 ----------------
    static int fails = 0;
    static void ok(String n, boolean b, String extra) {
        System.out.println((b?"  PASS  ":"  FAIL  ")+n+(extra.isEmpty()?"":"   "+extra));
        if (!b) fails++;
    }

    static JSONObject A(String s) { return new JSONObject(s); }

    public static void main(String[] args) throws Exception {
        System.out.println("=== v1.6.0 引擎：变量 + 跳转语义 ===");

        // 1. 赋值 → 运算 → 点击引用变量
        EngineTest e1 = new EngineTest();
        e1.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"0\"},{\"k\":\"gap\",\"v\":\"\"}]," +
          "\"actions\":[" +
          "{\"t\":\"set\",\"k\":\"n\",\"v\":\"5\"}," +
          "{\"t\":\"math\",\"k\":\"n\",\"e\":\"n*2\"}," +
          "{\"t\":\"click\",\"x\":\"{{n}}\",\"y\":\"{{n+10}}\"}]}"));
        ok("赋值/运算/引用变量后点击正确", e1.clicked.size()==1 && e1.clicked.get(0)==10*10000+20,
           "轨迹 " + e1.trace + " 点击 " + e1.clicked);

        // 2. 找色命中 → lastX/lastY → 后续点它右边 20px
        EngineTest e2 = new EngineTest();
        e2.colorHit = new int[]{720, 310, 98};
        e2.run(A("{\"actions\":[" +
          "{\"t\":\"findColor\",\"c\":\"#ff0000\",\"click\":false,\"go\":0,\"els\":-1}," +
          "{\"t\":\"click\",\"x\":\"{{lastX+20}}\",\"y\":\"{{lastY}}\"}]}"));
        ok("findColor 命中后 lastX/lastY 可被引用", e2.clicked.size()==1 && e2.clicked.get(0)==740*10000+310,
           "点击 " + e2.clicked);

        // 3. 找色没命中 → 走 els，收工
        EngineTest e3 = new EngineTest();
        e3.colorHit = null;
        e3.run(A("{\"actions\":[" +
          "{\"t\":\"findColor\",\"c\":\"#ff0000\",\"click\":false,\"go\":0,\"els\":-1}," +
          "{\"t\":\"click\",\"x\":\"10\",\"y\":\"10\"}]}"));
        ok("没命中走 els=-1 直接收工（不点后面那颗）", e3.clicked.isEmpty() && e3.trace.contains("END"),
           "轨迹 " + e3.trace);

        // 4. 比变量跳转：go/els 填的是「第几步」，1 起算，cmpVar 自己算第 1 步
        //    步号：1=cmpVar 2=点111 3=点222 4=点333
        //    所以 go=4 才是「跳过前两颗只点 333」，go=3 是「从第 3 步接着走 → 点 222、333」
        EngineTest e4 = new EngineTest();
        e4.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"5\"}],\"actions\":[" +
          "{\"t\":\"cmpVar\",\"l\":\"n\",\"op\":\">=\",\"r\":\"3\",\"go\":4,\"els\":0}," +
          "{\"t\":\"click\",\"x\":\"111\",\"y\":\"111\"}," +
          "{\"t\":\"click\",\"x\":\"222\",\"y\":\"222\"}," +
          "{\"t\":\"click\",\"x\":\"333\",\"y\":\"333\"}]}"));
        ok("成立 go=4 → 跳到第 4 步，只点 333",
           e4.clicked.size()==1 && e4.clicked.get(0)==333*10000+333, "点击 " + e4.clicked);

        EngineTest e4b = new EngineTest();
        e4b.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"5\"}],\"actions\":[" +
          "{\"t\":\"cmpVar\",\"l\":\"n\",\"op\":\">=\",\"r\":\"3\",\"go\":3,\"els\":0}," +
          "{\"t\":\"click\",\"x\":\"111\",\"y\":\"111\"}," +
          "{\"t\":\"click\",\"x\":\"222\",\"y\":\"222\"}," +
          "{\"t\":\"click\",\"x\":\"333\",\"y\":\"333\"}]}"));
        ok("成立 go=3 → 从第 3 步接着走，点 222 和 333",
           e4b.clicked.size()==2 && e4b.clicked.get(0)==222*10000+222 && e4b.clicked.get(1)==333*10000+333,
           "点击 " + e4b.clicked);

        EngineTest e5 = new EngineTest();
        e5.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"5\"}],\"actions\":[" +
          "{\"t\":\"cmpVar\",\"l\":\"n\",\"op\":\"<\",\"r\":\"3\",\"go\":4,\"els\":0}," +
          "{\"t\":\"click\",\"x\":\"111\",\"y\":\"111\"}," +
          "{\"t\":\"click\",\"x\":\"222\",\"y\":\"222\"}," +
          "{\"t\":\"click\",\"x\":\"333\",\"y\":\"333\"}]}"));
        ok("不成立 els=0 → 顺着走，三颗全点",
           e5.clicked.size()==3 && e5.clicked.get(0)==111*10000+111 && e5.clicked.get(2)==333*10000+333,
           "点击 " + e5.clicked);

        EngineTest e5b = new EngineTest();
        e5b.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"5\"}],\"actions\":[" +
          "{\"t\":\"cmpVar\",\"l\":\"n\",\"op\":\"<\",\"r\":\"3\",\"go\":4,\"els\":-1}," +
          "{\"t\":\"click\",\"x\":\"111\",\"y\":\"111\"}," +
          "{\"t\":\"click\",\"x\":\"222\",\"y\":\"222\"}]}"));
        ok("不成立 els=-1 → 立刻收工，一颗都不点",
           e5b.clicked.isEmpty() && e5b.trace.contains("END"), "轨迹 " + e5b.trace);

        // 4c. 跳到不存在的步号不能越界，应当自然收工
        EngineTest e4c = new EngineTest();
        e4c.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"5\"}],\"actions\":[" +
          "{\"t\":\"cmpVar\",\"l\":\"n\",\"op\":\">=\",\"r\":\"3\",\"go\":99,\"els\":0}," +
          "{\"t\":\"click\",\"x\":\"111\",\"y\":\"111\"}]}"));
        ok("go 越界不崩，直接收工",
           e4c.clicked.isEmpty() && e4c.trace.contains("END"), "轨迹 " + e4c.trace);

        // 5. 循环：count 到 3 次重来一轮，变量在轮次间保留（设计如此）
        EngineTest e6 = new EngineTest();
        e6.run(A("{\"loop\":true,\"vars\":[{\"k\":\"n\",\"v\":\"0\"}],\"actions\":[" +
          "{\"t\":\"math\",\"k\":\"n\",\"e\":\"n+1\"}," +
          "{\"t\":\"count\",\"k\":\"c\",\"mode\":\"add\",\"v\":1,\"times\":3,\"go\":-1,\"resetAfter\":true}]}"));
        String nFinal = e6.vars.get("n");
        ok("循环里变量能累加，count 到 3 次收工", "3".equals(nFinal) && e6.trace.contains("END"),
           "n=" + nFinal + " 轨迹尾部 " + tail(e6.trace, 5));

        // 6. {{rand}} 每次执行都重算（不是开跑算一次就固定）
        EngineTest e7 = new EngineTest();
        e7.run(A("{\"actions\":[" +
          "{\"t\":\"math\",\"k\":\"a\",\"e\":\"rand(100000,999999)\"}," +
          "{\"t\":\"math\",\"k\":\"b\",\"e\":\"rand(100000,999999)\"}]}"));
        // 两次随机撞上的概率是百万分之一，撞上说明没重算
        ok("每次执行都重新取随机数", !e7.vars.get("a").equals(e7.vars.get("b")),
           "a=" + e7.vars.get("a") + " b=" + e7.vars.get("b"));

        // 7. 算式写错不炸，原样存进去
        EngineTest e8 = new EngineTest();
        e8.run(A("{\"actions\":[{\"t\":\"math\",\"k\":\"bad\",\"e\":\"1+*2\"}]}"));
        ok("算式写错不崩，原样留着", "1+*2".equals(e8.vars.get("bad")), "bad=" + e8.vars.get("bad"));

        // 8. {{cnt.名字}} 能读到计数器的值
        EngineTest e9 = new EngineTest();
        e9.run(A("{\"vars\":[{\"k\":\"shown\",\"v\":\"\"}],\"actions\":[" +
          "{\"t\":\"count\",\"k\":\"c\",\"mode\":\"add\",\"v\":1,\"times\":0}," +
          "{\"t\":\"count\",\"k\":\"c\",\"mode\":\"add\",\"v\":1,\"times\":0}," +
          "{\"t\":\"set\",\"k\":\"shown\",\"v\":\"{{cnt.c}}\"}," +
          "{\"t\":\"click\",\"x\":\"{{shown}}\",\"y\":\"0\"}]}"));
        ok("{{cnt.名字}} 读到计数器当前值 2",
           e9.clicked.size()==1 && e9.clicked.get(0)==2*10000, "点击 " + e9.clicked);

        // 9. 一轮结束后 {{loop}} 递增
        EngineTest e10 = new EngineTest();
        e10.run(A("{\"loop\":true,\"actions\":[" +
          "{\"t\":\"count\",\"k\":\"c\",\"mode\":\"add\",\"v\":1,\"times\":2,\"go\":-1}]}"));
        ok("两轮后收工，loop 递增过", e10.trace.contains("END") && e10.trace.contains("LOOP"),
           "轨迹 " + e10.trace);

        // 10. 文本字段里的插值（输入文字）
        EngineTest e11 = new EngineTest();
        e11.run(A("{\"vars\":[{\"k\":\"n\",\"v\":\"7\"}],\"actions\":[" +
          "{\"t\":\"set\",\"k\":\"msg\",\"v\":\"第 {{n}} 次签到\"}]}"));
        ok("文本里局部插值正确", "第 7 次签到".equals(e11.vars.get("msg")), "msg=" + e11.vars.get("msg"));

        System.out.println(fails==0 ? "\n✅ 引擎语义全部通过（10 组场景）" : "\n❌ 有 "+fails+" 项失败");
        if (fails>0) System.exit(1);
    }

    static List<String> tail(List<String> l, int n) {
        return l.subList(Math.max(0, l.size()-n), l.size());
    }
}
