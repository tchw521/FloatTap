import java.lang.Thread;

// 这里盯的是 v2.5.0 新抽的运行三态（RunState）。最容易翻车的是三条：
//   · 非法迁移必须进不去：没跑就「恢复」、没跑就「暂停」，都得安静无效——
//     否则音量键误触一下就把状态搅乱
//   · gate 必须真的挂起、恢复/停止必须真的叫醒：这要开真线程测，
//     只测状态位等于没测（挂死的话 CI 卡住，立刻能发现）
//   · sleep 暂停不吃时长：等 5 秒暂停 10 秒，恢复后剩多少睡多少——
//     「暂停吃掉等待时长」这种 bug 用户感知不到但脚本节奏全乱
public class R {
    static int fails = 0;
    static int total = 0;

    static void ok(String n, boolean b) {
        total++;
        if (b) System.out.println("  PASS  " + n);
        else { fails++; System.out.println("  FAIL  " + n); }
    }

    static void ok(String n, boolean b, String extra) {
        ok(n + (extra == null ? "" : "（" + extra + "）"), b);
    }

    public static void main(String[] x) throws Exception {
        transitions();
        gateAndWake();
        sleepBehavior();
        System.out.println(total + " 项断言，" + (fails == 0 ? "全通过" : "失败 " + fails + " 项"));
        System.out.println(fails == 0 ? "  —— 全通过" : "  —— 失败 " + fails + " 项");
        if (fails > 0) System.exit(1);
    }

    // ---- A. 状态迁移合法性 -------------------------------------------------
    static void transitions() {
        System.out.println("A. 状态迁移");
        RunState rs = new RunState();
        ok("初始是停止态", rs.isStopped() && !rs.isRunning() && !rs.isPaused());
        ok("停止态不算忙", !rs.isBusy());
        ok("没跑不能暂停", !rs.pause());
        ok("没跑不能恢复", !rs.resume());
        ok("没跑谈不上停止", !rs.stop());

        ok("启动成功", rs.start());
        ok("启动后在跑", rs.isRunning() && rs.isBusy() && !rs.isStopped());
        ok("跑着再 start 是无操作", !rs.start());

        ok("暂停成功", rs.pause());
        ok("暂停后不在跑但在忙", rs.isPaused() && rs.isBusy() && !rs.isRunning());
        ok("暂停里再暂停是无操作", !rs.pause());
        ok("暂停里 start 也能拉起来（相当于恢复）", rs.start() && rs.isRunning());

        ok("再暂停 → 停止", rs.pause() && rs.stop());
        ok("暂停里急停成功", rs.isStopped() && !rs.isBusy());
        ok("停了再停是无操作", !rs.stop());

        ok("跑着直接停", rs.start() && rs.stop() && rs.isStopped());
        ok("三态数值别乱动（日志/存储可能依赖）",
                RunState.STOPPED == 0 && RunState.RUNNING == 1 && RunState.PAUSED == 2);
    }

    // ---- B. gate 挂起与唤醒（真线程） --------------------------------------
    static void gateAndWake() throws Exception {
        System.out.println("B. 暂停闸口 gate");

        // B1. 没暂停时 gate 必须直接过：起线程调 gate，100ms 内必须结束
        RunState rs = new RunState();
        Thread t1 = new Thread(rs::gate, "gate-free");
        t1.start();
        t1.join(200);
        ok("没暂停时 gate 直接放行", !t1.isAlive());

        // B2. 暂停时 gate 挂起，恢复放行
        RunState rs2 = new RunState();
        rs2.start();
        rs2.pause();
        Thread t2 = new Thread(rs2::gate, "gate-pause");
        t2.start();
        Thread.sleep(150);
        ok("暂停时 gate 挂着不返回", t2.isAlive());
        rs2.resume();
        t2.join(500);
        ok("恢复后 gate 放行", !t2.isAlive());

        // B3. 暂停时停止也必须叫醒（长按急停不能把线程永远吊住）
        RunState rs3 = new RunState();
        rs3.start();
        rs3.pause();
        Thread t3 = new Thread(rs3::gate, "gate-stop");
        t3.start();
        Thread.sleep(150);
        ok("暂停时 gate 挂着（等急停）", t3.isAlive());
        rs3.stop();
        t3.join(500);
        ok("停止叫醒 gate，线程退出", !t3.isAlive());

        // B4. gate 里被中断要能退出来，不能挂死
        RunState rs4 = new RunState();
        rs4.start();
        rs4.pause();
        Thread t4 = new Thread(rs4::gate, "gate-intr");
        t4.start();
        Thread.sleep(150);
        t4.interrupt();
        t4.join(500);
        ok("gate 被中断能退出", !t4.isAlive());

        // B5. sleep 里挂着的 gate 同理被停止叫醒（合并进 C 组的停止测试）
    }

    // ---- C. 可暂停的睡 ------------------------------------------------------
    static void sleepBehavior() throws Exception {
        System.out.println("C. 可暂停的睡");

        // C1. 正常睡完：返回 true，时长差不多（sleep 只在 RUNNING 态被引擎调用，先启动）
        RunState rs = new RunState();
        rs.start();
        long t0 = System.currentTimeMillis();
        ok("正常睡完返回 true", rs.sleep(300));
        long took = System.currentTimeMillis() - t0;
        ok("睡的时长差不多", took >= 280 && took < 900, took + "ms");

        // C2. 0 和负数不睡
        ok("睡 0 毫秒直接过", rs.sleep(0));
        ok("负数也直接过", rs.sleep(-5));

        // C3. 暂停不吃时长：睡 800，中途暂停 400 再恢复，总耗时约 1200 而不是 800
        final long[] el = {0};
        final boolean[] okRet = {false};
        RunState rs3 = new RunState();
        rs3.start();
        Thread t3 = new Thread(() -> {
            long s = System.currentTimeMillis();
            okRet[0] = rs3.sleep(800);
            el[0] = System.currentTimeMillis() - s;
        }, "sleep-pause");
        t3.start();
        Thread.sleep(300);       // 先让它睡一会儿
        rs3.pause();             // 暂停 400ms
        Thread.sleep(400);
        rs3.resume();
        t3.join(4000);
        ok("暂停后恢复，sleep 正常收尾", okRet[0] && !t3.isAlive());
        ok("暂停期间不吃时长（≈1200ms 而不是 800）", el[0] >= 1100, "实际 " + el[0] + "ms");
        ok("也没多睡离谱", el[0] < 2500, "实际 " + el[0] + "ms");

        // C4. 睡到一半急停：立刻返回 false，不能把 5 秒睡完
        final long[] el4 = {0};
        final boolean[] ret4 = {true};
        RunState rs4 = new RunState();
        rs4.start();
        Thread t4 = new Thread(() -> {
            long s = System.currentTimeMillis();
            ret4[0] = rs4.sleep(5000);
            el4[0] = System.currentTimeMillis() - s;
        }, "sleep-stop");
        t4.start();
        Thread.sleep(300);
        rs4.stop();
        t4.join(2000);
        ok("睡到一半急停返回 false", !ret4[0] && !t4.isAlive());
        ok("急停是立刻醒而不是睡完", el4[0] < 1500, "实际 " + el4[0] + "ms");

        // C5. 暂停里急停（gate 挂着时停）同样立刻退出
        final long[] el5 = {0};
        final boolean[] ret5 = {true};
        RunState rs5 = new RunState();
        rs5.start();
        Thread t5 = new Thread(() -> {
            long s = System.currentTimeMillis();
            ret5[0] = rs5.sleep(5000);
            el5[0] = System.currentTimeMillis() - s;
        }, "sleep-pause-stop");
        t5.start();
        Thread.sleep(200);
        rs5.pause();             // 先挂起
        Thread.sleep(200);
        rs5.stop();              // 暂停里急停
        t5.join(2000);
        ok("暂停里急停，sleep 立刻退出且 false", !ret5[0] && !t5.isAlive() && el5[0] < 1500,
                "实际 " + el5[0] + "ms");

        // C6. 停止态下 sleep 直接 false（兜底：停了就别等了）
        RunState rs6 = new RunState();
        ok("停止态 sleep 返回 false", !rs6.sleep(100));
    }
}
