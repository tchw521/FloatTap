import java.util.LinkedHashMap;

/**
 * 共享变量表单测（v3.1.0）：GlobalVars 是零 Android 依赖的真源码（剥 package 直接编译），
 * 钉死单例语义、空值处理、快照隔离与并发写安全。
 */
public class GlobalVarsTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("共享变量表单测（v3.1.0）");

        // ---------- A. 基本读写 ----------
        System.out.println("[A] 基本读写");
        GlobalVars g = GlobalVars.get();
        g.clear();
        g.put("score", "100");
        ok("100".equals(g.get("score")), "put/get 往返");
        g.put("score", "200");
        ok("200".equals(g.get("score")), "同名覆盖");
        ok(g.get("none") == null, "未定义返回 null（表达式里当 0）");

        // ---------- B. 空值守卫 ----------
        System.out.println("[B] 空值守卫");
        g.put("", "x");
        g.put(null, "x");
        ok(g.snapshot().size() == 1, "空名字忽略");
        g.put("nul", null);
        ok("".equals(g.get("nul")), "null 值记成空串");
        g.del("nul");
        ok(g.get("nul") == null, "del 删除");
        g.del(null);
        g.del("nul");
        ok(true, "del 空参数不炸");

        // ---------- C. 快照隔离 ----------
        System.out.println("[C] 快照隔离");
        g.put("k1", "v1");
        LinkedHashMap<String, String> snap = g.snapshot();
        snap.put("k1", "changed");
        snap.put("ghost", "1");
        ok("v1".equals(g.get("k1")) && g.get("ghost") == null,
                "改快照不影响原表");
        g.clear();
        ok(g.snapshot().isEmpty(), "clear 清空");

        // ---------- D. 并发写 ----------
        System.out.println("[D] 并发写（synchronized）");
        g.clear();
        Thread t1 = new Thread(() -> { for (int i = 0; i < 500; i++) g.put("a" + i, "1"); });
        Thread t2 = new Thread(() -> { for (int i = 0; i < 500; i++) g.put("b" + i, "2"); });
        t1.start(); t2.start();
        t1.join(); t2.join();
        ok(g.snapshot().size() == 1000, "双线程各写 500 键 → 总数 1000，实得 " + g.snapshot().size());
        ok("1".equals(g.get("a0")) && "2".equals(g.get("b499")), "两线程的值都完整可读");

        // ---------- E. 单例 ----------
        System.out.println("[E] 单例");
        ok(GlobalVars.get() == GlobalVars.get(), "get() 返回同一实例（跨脚本共享的前提）");

        System.out.println();
        System.out.println("通过 " + pass + " / 失败 " + fail);
        if (fail > 0) System.exit(1);
    }
}
