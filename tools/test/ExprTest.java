import java.util.HashMap;
import java.util.Map;

public class ExprTest {
    static Map<String,String> env = new HashMap<>();
    static Expr.Scope SC = new Expr.Scope() {
        public String get(String n) { return env.get(n); }
    };
    static int fails = 0;
    static void eq(String expr, String want) {
        String got = Expr.eval(expr, SC);
        boolean ok = want == null ? got == null : want.equals(got);
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + expr + "  =>  " + got + (ok ? "" : "   （期望 " + want + "）"));
        if (!ok) fails++;
    }
    public static void main(String[] a) {
        env.put("n", "3");
        env.put("x", "540");
        env.put("s", "你好");
        env.put("zero", "0");

        System.out.println("=== 常量与算术 ===");
        eq("1+2", "3");
        eq("10-4", "6");
        eq("6*7", "42");
        eq("7/2", "3.5");
        eq("7%3", "1");
        eq("2+3*4", "14");          // 优先级
        eq("(2+3)*4", "20");        // 括号
        eq("-5+2", "-3");           // 负号
        eq("1.5+1.5", "3");         // 整数结果不带小数点
        eq("1/3", "0.333333");      // 小数保留 6 位

        System.out.println("=== 变量 ===");
        eq("n", "3");
        eq("n+1", "4");
        eq("x-40", "500");
        eq("s", "你好");
        eq("s+'啊'", "你好啊");       // 字符串拼接
        eq("未定义变量", "0");         // 未定义当 0，不报错
        eq("未定义变量+5", "5");

        System.out.println("=== 比较与逻辑 ===");
        eq("n>2", "1");
        eq("n>5", "0");
        eq("n>=3", "1");
        eq("n<=2", "0");
        eq("n==3", "1");
        eq("n!=3", "0");
        eq("s=='你好'", "1");          // 字符串相等
        eq("s=='别的'", "0");
        eq("n>2 && n<5", "1");
        eq("n>2 || n>9", "1");
        eq("n>5 || n>9", "0");
        eq("!(n>5)", "1");
        eq("x=='540'", "1");          // 数字字符串按数值比

        System.out.println("=== 函数 ===");
        eq("abs(-7)", "7");
        eq("min(3,5)", "3");
        eq("max(3,5)", "5");
        eq("round(3.6)", "4");
        eq("int(3.9)", "3");
        eq("len('abcd')", "4");
        eq("len(s)", "2");

        // rand：跑多次验证范围与类型
        boolean randOk = true;
        for (int i = 0; i < 300; i++) {
            long v = Long.parseLong(Expr.eval("rand(10)", SC));
            if (v < 0 || v > 9) { randOk = false; break; }
        }
        System.out.println((randOk ? "  PASS  " : "  FAIL  ") + "rand(10) 300 次都在 0..9");
        if (!randOk) fails++;
        boolean rand2Ok = true;
        for (int i = 0; i < 300; i++) {
            long v = Long.parseLong(Expr.eval("rand(5,8)", SC));
            if (v < 5 || v > 8) { rand2Ok = false; break; }
        }
        System.out.println((rand2Ok ? "  PASS  " : "  FAIL  ") + "rand(5,8) 300 次都在 5..8");
        if (!rand2Ok) fails++;
        boolean randDef = true;
        for (int i = 0; i < 300; i++) {
            long v = Long.parseLong(Expr.eval("rand()", SC));
            if (v < 0 || v > 99) { randDef = false; break; }
        }
        System.out.println((randDef ? "  PASS  " : "  FAIL  ") + "rand() 300 次都在 0..99");
        if (!randDef) fails++;
        // 随机数必须是整数（不能带小数点，塞进「第几步」才不会炸）
        boolean intOk = !Expr.eval("rand(100)", SC).contains(".");
        System.out.println((intOk ? "  PASS  " : "  FAIL  ") + "rand 结果是整数（可直接当步号）");
        if (!intOk) fails++;

        System.out.println("=== 容错 ===");
        eq("1+", null);           // 缺操作数
        eq("(1+2", null);         // 括号没配对
        eq("", null);             // 空
        eq("   ", null);          // 全空白
        eq("1 2", null);          // 多余字符
        eq("nosuchfunc(1)", null);// 没这个函数
        eq("1/0", "0");           // 除零给 0，不崩
        eq("1%0", "0");
        eq("null", "0");          // 未定义
        eq(null, null);           // null 输入

        System.out.println("=== 真实脚本场景 ===");
        env.put("lastX", "720");
        env.put("lastY", "310");
        env.put("cnt.main", "2");
        eq("lastX+20", "740");                 // 命中点右边 20px
        eq("lastY-lastX", "-410");
        eq("cnt.main>=2", "1");                // 计数器判断
        String r = Expr.eval("rand(80,120)", SC);
        boolean inRange = r != null && !r.contains(".");
        System.out.println((inRange ? "  PASS  " : "  FAIL  ") + "rand(80,120) 返回整数 " + r);
        if (!inRange) fails++;
        eq("screenW/2", "0");                  // 未定义内置变量时按 0 处理

        env.put("screenW", "1080");
        eq("screenW/2", "540");
        eq("screenW*0.5", "540");

        // rand 的边界：以前要求「第二个参数比第一个大」才走区间分支，
        // 于是 rand(5,5) 退化成 rand(5) 给出 0..4、rand(10,5) 给出 0..9，都是错的
        eq("rand(5,5)", "5");                 // 两个参数一样时就是那个数，不该退化成 0..4
        boolean revOk = true;
        for (int i = 0; i < 300; i++) {
            long v = Long.parseLong(Expr.eval("rand(10,5)", SC));   // 写反了也该按 5..10 算
            if (v < 5 || v > 10) { revOk = false; break; }
        }
        System.out.println((revOk ? "  PASS  " : "  FAIL  ") + "rand(10,5) 写反参数也在 5..10");
        if (!revOk) fails++;
        eq("rand(0)", "0");                   // 不该退化成 0..99
        boolean oneOk = true;
        for (int i = 0; i < 200; i++) {
            long v = Long.parseLong(Expr.eval("rand()", SC));
            if (v < 0 || v > 99) { oneOk = false; break; }
        }
        System.out.println((oneOk ? "  PASS  " : "  FAIL  ") + "rand() 不带参仍在 0..99");
        if (!oneOk) fails++;

        System.out.println(fails == 0 ? "\n✅ Expr 全部通过" : "\n❌ 有 " + fails + " 项失败");
        if (fails > 0) System.exit(1);
    }
}
