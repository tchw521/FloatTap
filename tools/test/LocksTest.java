/**
 * 互斥锁单测（v3.1.0）：Locks 是零 Android 依赖的真源码（剥 package 直接编译），
 * 钉死互斥语义、可重入计数、归属校验、releaseAll 兜底与 runId 守卫——
 * 尤其 runId<=0 拒绝：JS 桥在无会话时调 glock 不能把锁记到 0 号名下（releaseAll(0) 救不回来）。
 */
public class LocksTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("互斥锁单测（v3.1.0）");

        // ---------- A. 拿锁与互斥 ----------
        System.out.println("[A] 拿锁与互斥");
        Locks L = Locks.get();
        ok(L.tryAcquire("door", 101), "首次拿锁成功");
        ok(!L.tryAcquire("door", 202), "别人拿同一把 → 拒绝");
        ok(L.tryAcquire("door", 101), "同 runId 可重入（计数+1）");
        ok(L.heldBy("door", 101) && !L.heldBy("door", 202), "heldBy 归属正确");

        // ---------- B. 放锁 ----------
        System.out.println("[B] 放锁");
        ok(L.release("door", 101), "重入后放一次：仍持有");
        ok(L.heldBy("door", 101), "计数 1 → 还没放掉");
        ok(L.release("door", 101), "再放一次：归零真释放");
        ok(!L.heldBy("door", 101), "释放后不再持有");
        ok(L.tryAcquire("door", 202), "释放后别人能拿到");
        ok(!L.release("door", 101), "非持有者放不掉");
        ok(L.release("door", 202), "持有者放掉");
        ok(!L.release("door", 202), "重复放 → false");

        // ---------- C. releaseAll 兜底 ----------
        System.out.println("[C] releaseAll");
        ok(L.tryAcquire("a", 301) && L.tryAcquire("b", 301) && L.tryAcquire("c", 302),
                "预备：301 拿 a/b，302 拿 c");
        int n = L.releaseAll(301);
        ok(n == 2, "releaseAll(301) 放掉 2 把，实得 " + n);
        ok(!L.heldBy("a", 301) && !L.heldBy("b", 301) && L.heldBy("c", 302),
                "301 的全放光、302 的不受影响");
        ok(L.releaseAll(301) == 0 && L.releaseAll(0) == 0 && L.releaseAll(-5) == 0,
                "无锁/非法 runId → 0");
        L.releaseAll(302);

        // ---------- D. 非法入参 ----------
        System.out.println("[D] 非法入参");
        ok(!L.tryAcquire("", 101), "空锁名拒绝");
        ok(!L.tryAcquire(null, 101), "null 锁名拒绝");
        ok(!L.tryAcquire("x", 0), "runId=0 拒绝（无会话的调用没有归属）");
        ok(!L.tryAcquire("x", -1), "负 runId 拒绝");
        ok(!L.release("x", 0), "release 同样守 runId");

        // ---------- E. 并发互斥 ----------
        System.out.println("[E] 并发");
        final boolean[] got = new boolean[2];
        Thread t1 = new Thread(() -> got[0] = L.tryAcquire("race", 901));
        Thread t2 = new Thread(() -> got[1] = L.tryAcquire("race", 902));
        t1.start(); t2.start();
        t1.join(); t2.join();
        ok(got[0] ^ got[1], "两线程抢同一把锁 → 恰一方成功（" + got[0] + "/" + got[1] + "）");
        L.releaseAll(901);
        L.releaseAll(902);

        System.out.println();
        System.out.println("通过 " + pass + " / 失败 " + fail);
        if (fail > 0) System.exit(1);
    }
}
