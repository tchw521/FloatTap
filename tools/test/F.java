// 字段对账：拿界面表单（app.js 的 TYPES / CTYPES）和引擎真正读的字段（ScriptRunner.java）
// 交叉比对，专门抓「静默失效」——
//   ① 表单里有这个输入框，引擎根本不读  → 用户填了没反应，还以为是自己写错了
//   ② 引擎在读这个字段，表单里没入口     → 功能躺在那没人能开（clickable / step 就是这么躺了三个版本）
// 它读的是两份源文件本身，所以以后谁再加字段忘了同步，这里会立刻变红。
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class F {

    static int fails = 0;

    static void ok(String n, boolean b) { ok(n, b, ""); }

    static void ok(String n, boolean b, String extra) {
        System.out.println((b ? "  PASS  " : "  FAIL  ") + n + (extra.isEmpty() ? "" : "   " + extra));
        if (!b) fails++;
    }

    // 界面上不直接暴露、但确实有用的字段：
    // t 是动作类型自己；d 是所有动作统一的「之后等待」（wait 表单只露 ms）；
    // pct 由界面上的百分比开关统一写，不在每个动作的 f 里列出来。
    static final Set<String> SKIP_FORM = set("t", "d", "pct");
    // 引擎读了、但界面上确实没有输入框也不该有：
    // t/k 是类型标识自己；acts/cs 是子列表，界面有专门的编辑器，不走 f 表单
    static final Set<String> SKIP_ENGINE = set("t", "k", "acts", "cs");
    // 条件对象的类型标识（k）同理，但动作里的 k 是计数器名，不能一起免掉，所以单独一份
    static final Set<String> SKIP_COND = set("k", "t");
    // 这些字段不在 f 表单里，但界面另有专门的编辑器（条件列表 / 子动作列表 / 重复检查），
    // 不算「没人能设」，别当成失效报出来
    static final Map<String, Set<String>> EXTRA_UI = new LinkedHashMap<>();

    static {
        EXTRA_UI.put("cond", set("mode", "n", "cs", "rep", "repGap", "repMax"));
        EXTRA_UI.put("group", set("acts"));
    }

    static boolean hasExtra(String type, String key) {
        Set<String> s = EXTRA_UI.get(type);
        return s != null && s.contains(key);
    }

    public static void main(String[] args) throws Exception {
        String root = args.length > 0 ? args[0] : "../..";
        String js = read(root + "/assets/www/app.js");
        String src = read(root + "/src/com/lazytap/clicker/ScriptRunner.java");

        Map<String, Set<String>> form = parseDefs(js, "TYPES");
        Map<String, Set<String>> fields = parseFields(js, "TYPES");
        Map<String, Set<String>> cform = parseDefs(js, "CTYPES");
        Map<String, Set<String>> cfields = parseFields(js, "CTYPES");
        Map<String, Set<String>> engine = parseEngine(src, fields);
        Set<String> cRead = parseCondReads(src);

        System.out.println("字段对账（表单 vs 引擎）");
        ok("解析到足够多的动作类型", form.size() >= 18, "共 " + form.size() + " 个");
        ok("解析到足够多的条件类型", cform.size() >= 8, "共 " + cform.size() + " 个");
        ok("解析到引擎读的动作字段", engine.size() >= 10, "共 " + engine.size() + " 个动作");

        // ① 表单能填、引擎不读 → 填了白填
        List<String> dead = new ArrayList<>();
        for (Map.Entry<String, Set<String>> e : fields.entrySet()) {
            Set<String> read = engine.get(e.getKey());
            if (read == null) continue;              // 没单独解析到的动作跳过，不误伤
            for (String k : e.getValue()) {
                if (SKIP_FORM.contains(k)) continue;
                if (!read.contains(k)) dead.add(e.getKey() + "." + k);
            }
        }
        ok("没有「表单能填、引擎不读」的字段", dead.isEmpty(), dead.toString());

        // ② 引擎在读、表单里没入口 → 功能没人能开
        List<String> hidden = new ArrayList<>();
        for (Map.Entry<String, Set<String>> e : engine.entrySet()) {
            Set<String> f = fields.get(e.getKey());
            if (f == null) continue;
            f = new LinkedHashSet<>(f);
            Set<String> grp = SHARED.get(e.getKey());
            if (grp != null) for (String g : grp) {
                Set<String> gf = fields.get(g);
                if (gf != null) f.addAll(gf);
            }
            for (String k : e.getValue()) {
                if (SKIP_ENGINE.contains(k) || SKIP_FORM.contains(k)) continue;
                if (!f.contains(k) && !hasExtra(e.getKey(), k)) hidden.add(e.getKey() + "." + k);
            }
        }
        ok("没有「引擎在读、表单没入口」的字段", hidden.isEmpty(), hidden.toString());

        // ③ def 里带的隐藏字段要么引擎在读，要么就该删掉（别存一堆没人用的死数据）
        List<String> deadDef = new ArrayList<>();
        for (Map.Entry<String, Set<String>> e : form.entrySet()) {
            Set<String> read = engine.get(e.getKey());
            Set<String> f = fields.get(e.getKey());
            if (read == null || f == null) continue;
            for (String k : e.getValue()) {
                if (f.contains(k) || read.contains(k) || SKIP_FORM.contains(k)
                        || hasExtra(e.getKey(), k)) continue;
                deadDef.add(e.getKey() + "." + k);
            }
        }
        ok("def 里没有既不显示也没人读的死字段", deadDef.isEmpty(), deadDef.toString());

        // ④ 条件系统同上：条件字段 vs 引擎 condOne/execCond 里读的
        List<String> cdead = new ArrayList<>();
        for (Map.Entry<String, Set<String>> e : cfields.entrySet()) {
            for (String k : e.getValue()) {
                if (SKIP_FORM.contains(k)) continue;
                if (!cRead.contains(k)) cdead.add(e.getKey() + "." + k);
            }
        }
        ok("条件里没有「能填但不读」的字段", cdead.isEmpty(), cdead.toString());

        List<String> chidden = new ArrayList<>();
            for (String k : cRead) {
                if (SKIP_COND.contains(k) || SKIP_ENGINE.contains(k) || SKIP_FORM.contains(k)) continue;
            boolean any = false;
            for (Set<String> s : cform.values()) if (s.contains(k)) { any = true; break; }
            if (!any) chidden.add(k);
        }
        ok("条件里没有「引擎在读但没入口」的字段", chidden.isEmpty(), chidden.toString());

        // ⑤ 几个 v2.3.0 修掉的老毛病，钉死别再退回去
        Set<String> findRead = engine.get("find");
        ok("find 读 clickable（以前表单没入口）", findRead != null && findRead.contains("clickable"));
        ok("find 读 index", findRead != null && findRead.contains("index"));
        ok("find 读 timeout（不再是摆设）", findRead != null && findRead.contains("timeout"));
        ok("find 读 id（v2.4.0 控件 id）", findRead != null && findRead.contains("id"));
        ok("find 读 desc（v2.4.0 内容描述）", findRead != null && findRead.contains("desc"));
        ok("find 读 re（v2.4.0 正则）", findRead != null && findRead.contains("re"));
        // v2.6.0：find 命中把坐标记进 lastX/lastY —— 只找不点的动作模式也能拿到 {{lastX}}
        // 只认行首的真调用：把调用注释掉（而不是删掉）也算丢，别让断言被注释糊弄过去
        String findCase = block(src, src.indexOf("case \"find\":"));
        ok("find 命中回填 lastX/lastY（rememberHit）",
                Pattern.compile("^\\s*rememberHit\\(", Pattern.MULTILINE).matcher(findCase).find());
        // v2.7.0：引擎写日志必须带运行归属（runId）——两脚本交替跑不串日志靠它，
        // 改回不带归属的老写法（new LogLine(s, lv)）这里要红
        String logM = methodBlock(src, "private void log(String s, int lv)");
        ok("引擎日志带运行归属（LogLine.of(runId)）", logM.contains("LogLine.of(runId"));
        ok("execIf 也认这三个新条件", has(engine, "if", "id") && has(engine, "if", "desc")
                && has(engine, "if", "re"));
        // 条件侧的检查两边不对称：「能填但不读」看 f，「在读但没入口」看 def，两边都得有
        ok("条件 text 在 f 里有 id / desc / re / clickable",
                has(cfields, "text", "id") && has(cfields, "text", "desc")
                        && has(cfields, "text", "re") && has(cfields, "text", "clickable"));
        ok("条件 text 在 def 里也有（不然会被判「在读但没入口」）",
                cform.get("text") != null && cform.get("text").contains("id")
                        && cform.get("text").contains("desc") && cform.get("text").contains("re"));
        ok("findColor 读 step（采样间隔）", has(engine, "findColor", "step"));
        ok("findColor 读 timeout（v2.3.0 起真轮询）", has(engine, "findColor", "timeout"));
        ok("findImage 读 timeout（v2.3.0 起真轮询）", has(engine, "findImage", "timeout"));
        ok("wait 读 ms", has(engine, "wait", "ms"));
        ok("double 默认带 x/y（新建不再点左上角）",
                form.get("double") != null && form.get("double").contains("x") && form.get("double").contains("y"));
        ok("long 默认带 x/y", form.get("long") != null && form.get("long").contains("x"));
        ok("random 默认带 x/y", form.get("random") != null && form.get("random").contains("x"));
        ok("wait 默认 d=0（等待时长以 ms 为准）",
                "0".equals(defOf(js, "wait", "d")), "d=" + defOf(js, "wait", "d"));

        // 应用内的「更新日志」曾经停更在 v1.4.0，后面七个版本用户都看不到。
        // 这里钉一条：发新版时必须同步 app.js 里的 CHANGELOG 第一条。
        String top = firstVer(js);
        ok("应用内更新日志的第一条就是当前版本", "3.2.0".equals(top), "现在是 " + top);

        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }

    /** CHANGELOG 数组里第一条的版本号 */
    static String firstVer(String js) {
        Matcher m = Pattern.compile(">v(\\d+\\.\\d+\\.\\d+)</div>").matcher(js);
        return m.find() ? m.group(1) : "(没找到)";
    }

    static boolean has(Map<String, Set<String>> m, String k, String f) {
        Set<String> s = m.get(k);
        return s != null && s.contains(f);
    }

    /** 取某个动作 def 里某字段的默认值文本 */
    static String defOf(String js, String type, String key) {
        int i = js.indexOf("    " + type + ": {");
        if (i < 0) return null;
        int di = js.indexOf("def: {", i);
        if (di < 0) return null;
        int de = js.indexOf("}", di);
        String def = js.substring(di, de < 0 ? js.length() : de);
        Matcher m = Pattern.compile("\\b" + key + ":\\s*([^,}]+)").matcher(def);
        return m.find() ? m.group(1).trim() : null;
    }

    // ---------- 解析 app.js ----------

    /** 取 def: { ... } 里的键 */
    static Map<String, Set<String>> parseDefs(String js, String varName) {
        Map<String, Set<String>> out = new LinkedHashMap<>();
        for (String ln : bodyOf(js, varName)) {
            String name = nameOf(ln);
            if (name == null) continue;
            Set<String> keys = new LinkedHashSet<>();
            int i = ln.indexOf("def: {");
            if (i >= 0) {
                int e = ln.indexOf("}", i);
                // 从 "def: {" 之后开始扫，不然会把 "def" 自己也当成一个字段
                Matcher m = Pattern.compile("([A-Za-z_]\\w*):")
                        .matcher(ln.substring(i + 6, e < 0 ? ln.length() : e));
                while (m.find()) keys.add(m.group(1));
            }
            out.put(name, keys);
        }
        return out;
    }

    /** 取 f: [ ['x','X 坐标'], ... ] 里的字段名 */
    static Map<String, Set<String>> parseFields(String js, String varName) {
        Map<String, Set<String>> out = new LinkedHashMap<>();
        for (String ln : bodyOf(js, varName)) {
            String name = nameOf(ln);
            if (name == null) continue;
            Set<String> keys = new LinkedHashSet<>();
            int i = ln.indexOf("f: [");
            if (i >= 0) {
                // 不能用 indexOf("]")：第一个字段的说明里就可能带 ']'。
                // f 数组后面只可能跟 def: 或 pct:，拿它当右边界。
                int e = ln.indexOf("], def", i);
                if (e < 0) e = ln.indexOf("], pct", i);
                Matcher m = Pattern.compile("\\['([A-Za-z_]\\w*)'")
                        .matcher(ln.substring(i, e < 0 ? ln.length() : e));
                while (m.find()) keys.add(m.group(1));
            }
            out.put(name, keys);
        }
        return out;
    }

    /** var XXX = { ... } 里的每一行（只取 4 空格缩进的顶层条目） */
    static List<String> bodyOf(String js, String varName) {
        List<String> out = new ArrayList<>();
        int i = js.indexOf("var " + varName + " = {");
        if (i < 0) return out;
        for (String ln : js.substring(i).split("\n")) {
            if (ln.startsWith("  };")) break;               // 对象结束
            out.add(ln);
        }
        return out;
    }

    static String nameOf(String ln) {
        Matcher m = Pattern.compile("^\\s{4}([A-Za-z_]\\w*):\\s*\\{").matcher(ln);
        return m.find() ? m.group(1) : null;
    }

    // ---------- 解析 ScriptRunner.java ----------

    /** 动作名 -> 引擎读的字段集合 */
    static Map<String, Set<String>> parseEngine(String src, Map<String, Set<String>> fieldsOf) {
        Map<String, Set<String>> out = new LinkedHashMap<>();
        int sw = src.indexOf("switch (t) {");
        if (sw >= 0) {
            // 多个 case 可能共用一个块（case "click": case "long": { ... }），
            // 得把这一串名字都指到同一个块上，否则字段会全算到最后一个头上
            Matcher m = Pattern.compile("case \"([a-zA-Z]+)\":").matcher(src);
            List<String> pending = new ArrayList<>();
            while (m.find()) {
                if (m.start() < sw) continue;
                pending.add(m.group(1));
                int j = m.end();
                while (j < src.length() && Character.isWhitespace(src.charAt(j))) j++;
                if (j < src.length() && src.charAt(j) == '{') {
                    Set<String> r = reads(block(src, j), 'a');
                    for (String name : pending) {
                        merge(out, name, r);
                        SHARED.put(name, new LinkedHashSet<>(pending));
                    }
                    pending.clear();
                } else if (!src.startsWith("case \"", j)) {
                    // 后面还是 case 就继续攒（click/double/long/random 共用一个块）；
                    // 若不是（比如 case "if": return execIf(...); 这种转发写法），
                    // 字段由下面 addMethod 从目标方法里收，别把它跟下一个块绑一起
                    pending.clear();
                }
            }
        }
        // 单独成方法的动作：case 里只做了个转发，字段在方法里读
        addMethod(out, src, "execFindColor", "findColor");
        addMethod(out, src, "execFindImage", "findImage");
        addMethod(out, src, "execIf", "if");
        addMethod(out, src, "execGroup", "group");
        addMethod(out, src, "execCond", "cond");
        addMethod(out, src, "execCount", "count");
        addMethod(out, src, "execCmpColor", "cmpColor");
        addMethod(out, src, "execSet", "set");
        addMethod(out, src, "execMath", "math");
        addMethod(out, src, "execCmpVar", "cmpVar");
        addMethod(out, src, "execSubScript", "runSub");
        addMethod(out, src, "checkCond", "cond");
        // region() 读的是区域字段（rx/ry/rw/rh/pct），所有「有区域」的动作都算读到
        Set<String> reg = reads(methodBlock(src, "int[] region("), 'a');
        for (String k : out.keySet()) if (has(fieldsOf, k, "rx")) merge(out, k, reg);
        return out;
    }

    static Map<String, Set<String>> fieldsOf;
    /** 共用同一个 case 块的动作：它们的字段是并集，别拿单个动作的表单去卡 */
    static final Map<String, Set<String>> SHARED = new LinkedHashMap<>();

    static void merge(Map<String, Set<String>> out, String k, Set<String> add) {
        Set<String> s = out.get(k);
        if (s == null) out.put(k, new LinkedHashSet<>(add));
        else s.addAll(add);
    }

    static void addMethod(Map<String, Set<String>> out, String src, String method, String type) {
        String b = methodBlock(src, "int " + method + "(");
        if (b.isEmpty()) return;
        merge(out, type, reads(b, 'a'));
        // jump(a, hit) 里读的是 go/els，不在本方法体内，补上免得误报「表单能填但不读」
        if (b.contains("jump(a")) {
            Set<String> j = new LinkedHashSet<>();
            j.add("go");
            j.add("els");
            merge(out, type, j);
        }
    }

    static String methodBlock(String src, String sig) {
        int i = src.indexOf(sig);
        return i < 0 ? "" : block(src, i);
    }

    /** 全文件收集 c.optXxx("k") —— c 在条件系统里恒指「当前条件对象」 */
    static Set<String> parseCondReads(String src) {
        Set<String> out = reads(src, 'c');
        // region() 的形参叫 a，但条件系统是把条件对象传进去的，区域字段也算条件读到的
        out.addAll(reads(methodBlock(src, "int[] region("), 'a'));
        return out;
    }

    /** 从一段 Java 里抽 obj.optXxx("k") 和 on(obj, "k" 的字段名 */
    static Set<String> reads(String code, char obj) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = Pattern.compile("\\b" + obj + "\\.opt(?:String|Int|Long|Double|Boolean|JSONArray|JSONObject)?\\(\"(\\w+)\"")
                .matcher(code);
        while (m.find()) out.add(m.group(1));
        Matcher n = Pattern.compile("on\\(\\s*" + obj + ",\\s*\"(\\w+)\"").matcher(code);
        while (n.find()) out.add(n.group(1));
        return out;
    }

    /** 从 from 起第一个 '{' 开始，按大括号配平取出整块（跳过字符串字面量） */
    static String block(String s, int from) {
        int i = s.indexOf('{', from);
        if (i < 0) return "";
        int depth = 0;
        boolean inStr = false;
        char q = 0;
        for (int j = i; j < s.length(); j++) {
            char c = s.charAt(j);
            if (inStr) {
                if (c == '\\') { j++; continue; }
                if (c == q) inStr = false;
                continue;
            }
            if (c == '"') { inStr = true; q = '"'; continue; }
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) return s.substring(i, j + 1);
            }
        }
        return s.substring(i);
    }

    static Set<String> set(String... v) {
        Set<String> s = new LinkedHashSet<>();
        for (String x : v) s.add(x);
        return s;
    }

    static String read(String p) throws Exception {
        return new String(Files.readAllBytes(Paths.get(p)), "UTF-8");
    }
}
