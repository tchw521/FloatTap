package com.lazytap.clicker;

import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * 节点查询条件：文字 / 描述 / 控件 id / 正则 四路，没填的不约束，填了的取「且」。
 *
 * 零 Android 依赖（连 org.json 都不碰），所以 tools/test/N.java 能剥掉 package
 * 直接编真源码来测 —— 这是本项目在没有模拟器的情况下唯一能验引擎逻辑的办法。
 *
 * desc 的语义是这套规则里唯一绕的地方，写在这里别以后看不懂：
 *   desc 留空时，文字组是「nodeText 命中 或 nodeDesc 命中」的联合面 —— v2.3.0 就这行为，
 *   老脚本填「设置」能命中描述是「设置」的图标按钮，必须原样保留；
 *   desc 填了，说明用户想要精确控制，这时文字归文字、描述归描述，两组都要满足。
 */
public final class NodeMatch {

    /** 命中收集上限：攒够这么多就收手，别把整棵树都拷一遍 */
    public static final int HIT_CAP = 200;
    /** 正则长度上限：再长就当非法，免得用户粘一大坨进来把匹配拖死 */
    public static final int RE_MAX = 200;

    public final String text, desc, id, re;
    public final boolean contains;
    /** re 合法且非空时非 null；没填或写错时是 null */
    private final Pattern pat;

    private NodeMatch(String text, String desc, String id, String re, boolean contains) {
        this.text = text == null ? "" : text;
        this.desc = desc == null ? "" : desc;
        this.id = id == null ? "" : id;
        this.re = re == null ? "" : re;
        this.contains = contains;
        Pattern p = null;
        if (!this.re.isEmpty() && this.re.length() <= RE_MAX) {
            try {
                // 只在这里编一次。放进 matches() 会每个节点编一遍，
                // 250ms 一片的轮询 × 上千节点，直接卡成狗。
                p = Pattern.compile(this.re);
            } catch (PatternSyntaxException ignored) {
                // 用户写错了（比如只填了个左括号）：宁可找不到，也不抛异常把动作崩掉，
                // 更不能假装「全部命中」——那比崩掉还难查。
                p = null;
            }
        }
        this.pat = p;
    }

    /** 老签名：只按文字找，行为与 v2.3.0 完全一致 */
    public static NodeMatch of(String text, boolean contains) {
        return new NodeMatch(text, "", "", "", contains);
    }

    public static NodeMatch of(String text, String desc, String id, String re, boolean contains) {
        return new NodeMatch(text, desc, id, re, contains);
    }

    /**
     * 这一轮该收多少个命中。
     * 以前 collect 里写死 40，index 填 50 就永远拿不到 —— 不报错、不说原因，
     * 就是第 41 个往后一个都找不到，典型的静默失效。
     */
    public static int capFor(int nth) {
        return nth > HIT_CAP ? nth : HIT_CAP;
    }

    /** 四个条件全空 = 不筛选 */
    public boolean empty() {
        return text.isEmpty() && desc.isEmpty() && id.isEmpty() && re.isEmpty();
    }

    /** 填了正则但语法非法（或太长）：让调用方有机会提示用户一句 */
    public boolean badRe() {
        return !re.isEmpty() && pat == null;
    }

    /**
     * nodeId 传的是 getViewIdResourceName()。
     * 没开 FLAG_REPORT_VIEW_IDS 时它恒为 null —— 那时只要填了 id 就一定不命中，
     * 不报错也不崩溃。那个 flag 是本版头号静默失效点，注释写在 TapService 里了。
     */
    public boolean matches(CharSequence nodeText, CharSequence nodeDesc, CharSequence nodeId) {
        if (!textOk(nodeText, nodeDesc)) return false;
        if (!reOk(nodeText, nodeDesc)) return false;
        if (!desc.isEmpty() && !plain(nodeDesc, desc)) return false;
        if (!id.isEmpty() && !idOk(nodeId)) return false;
        return true;
    }

    /** 给人看的描述，进运行日志 */
    public String describe() {
        StringBuilder sb = new StringBuilder();
        if (!text.isEmpty()) sb.append("文字「").append(text).append("」");
        if (!desc.isEmpty()) sep(sb).append("描述「").append(desc).append("」");
        if (!id.isEmpty()) sep(sb).append("id「").append(id).append("」");
        if (!re.isEmpty()) sep(sb).append("正则「").append(re).append("」");
        return sb.length() == 0 ? "任意节点" : sb.toString();
    }

    private static StringBuilder sep(StringBuilder sb) {
        return sb.length() > 0 ? sb.append("+") : sb;
    }

    // 文字组：desc 留空时把 nodeDesc 也算进来，这是 v2.3.0 的老样子，不许退化
    private boolean textOk(CharSequence nt, CharSequence nd) {
        return text.isEmpty() || face(nt, nd, text);
    }

    /** 那个「联合面」：先看文字，desc 没填时再退到描述 */
    private boolean face(CharSequence nt, CharSequence nd, String s) {
        if (plain(nt, s)) return true;
        return desc.isEmpty() && plain(nd, s);
    }

    // 正则组跟文字组走同一个面：desc 留空时也扫描述
    private boolean reOk(CharSequence nt, CharSequence nd) {
        if (pat == null) return re.isEmpty();
        if (hit(nt)) return true;
        return desc.isEmpty() && hit(nd);
    }

    private boolean hit(CharSequence cs) {
        // find() 是子串语义：节点文本常是「点确定(2)」这种整句，
        // 用 matches() 要求整串对上，用户写「确定」反而找不到。
        return cs != null && pat.matcher(cs.toString()).find();
    }

    private boolean plain(CharSequence cs, String s) {
        if (cs == null) return false;
        String v = cs.toString();
        return contains ? v.contains(s) : v.equals(s);
    }

    private boolean idOk(CharSequence nodeId) {
        if (nodeId == null) return false;
        String raw = nodeId.toString();
        if (raw.isEmpty()) return false;
        String n = normId(raw), q = normId(id);
        // 原串比一次、规范化后再比一次：
        // 「ok」和「com.x:id/ok」用户觉得是一个东西，就得能互通
        return contains ? (raw.contains(id) || n.contains(q)) : (raw.equals(id) || n.equals(q));
    }

    /** com.xxx:id/foo → foo；:id/foo → foo；纯 id 原样；null → "" */
    static String normId(String s) {
        if (s == null) return "";
        String v = s.trim();
        int i = v.lastIndexOf('/');
        return i >= 0 ? v.substring(i + 1) : v;
    }
}
