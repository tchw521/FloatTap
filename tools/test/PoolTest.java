import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 运行会话池单测（v3.0.0）：装配 / 引擎道领道 / 同 id 重启优先 / 满员系统日志 /
 * JS 单实例道 / 满员判定 / 查找 / 归还幂等 / 与真 RunSlot 联动 / LogStore 裁剪。
 *
 * <p>RunnerPool / LogStore 是零 Android 依赖的真源码（剥 package 后直接编译）；
 * Lane 用假实现钉死池的记账语义——ScriptRunner 实现 Lane 是装配（Lanes）的事，
 * 池的规则不依赖任何具体道。
 */
public class PoolTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    /** 假道：状态手工拨，池的记账断言全靠它 */
    static final class FakeLane implements RunnerPool.Lane {
        boolean busy, running, paused;
        long rid;
        String sid = "";
        int starts, stops;

        public boolean isBusy() { return busy; }

        public boolean isRunning() { return running; }

        public boolean isPaused() { return paused; }

        public long runId() { return rid; }

        public String scriptId() { return sid; }

        public boolean start(JSONObject sc) { starts++; busy = true; running = true; paused = false; return true; }

        public void stop() { stops++; busy = false; running = false; paused = false; }

        public void pause() { paused = true; running = false; }

        public void resume() { paused = false; running = true; }

        public JSONArray varSnapshot() { return new JSONArray(); }

        public String tryEval(String expr) { return null; }
    }

    public static void main(String[] args) {
        System.out.println("运行会话池单测（v3.0.0）");

        // ---------- A. 装配 ----------
        System.out.println("[A] 装配");
        RunnerPool pool = new RunnerPool();
        FakeLane l0 = new FakeLane(), l1 = new FakeLane(), l2 = new FakeLane();
        pool.attach(new RunnerPool.Lane[]{l0, l1, l2});
        ok(pool.lane(0) == l0 && pool.lane(1) == l1 && pool.lane(2) == l2, "三条道各就各位");
        ok(pool.lane(-1) == null && pool.lane(3) == null, "越界道号返回 null 不抛");
        pool.attach(new RunnerPool.Lane[]{null, null, null});
        ok(pool.lane(0) == l0, "attach 幂等：null 位不清掉已装好的道");

        // ---------- B. 引擎道领道与同 id 重启 ----------
        // 领道（acquire）只记池的账；「道真的开跑」是 ScriptRunner.start 的事（测试手工拨）。
        System.out.println("[B] 引擎道领道与同 id 重启");
        ok(pool.acquire("s1", false) == 0, "首条领道 0（低位优先）");
        l0.busy = true; l0.sid = "s1"; l0.rid = 101;
        ok(pool.acquire("s2", false) == 1, "第二条领道 1");
        l1.busy = true; l1.sid = "s2"; l1.rid = 102;
        ok(pool.acquire("s1", false) == 0, "同 id 再领 = 重启原道，不另开新道");
        Bus.setSink(null);                      // 清场：满员日志的断言不能吃别的 sink
        final List<String> busLog = new ArrayList<>();
        Bus.addSink((t, d) -> { if ("log".equals(t)) busLog.add(d); });
        LogStore.get().clear();
        ok(pool.acquire("s3", false) == -1, "两条引擎道占满后领不到");
        ok(busLog.size() == 1 && busLog.get(0).contains("满"), "满员时 Bus 广播系统文案（含「满」）");
        JSONArray js10 = LogStore.get().json(10);
        ok(LogStore.get().size() == 1 && js10.optJSONObject(0).optLong("r") == 0
                        && js10.optJSONObject(0).optString("m").contains("满"),
                "满员日志进 LogStore 且 r=0（无徽标系统行）");
        pool.release(0);
        ok(pool.acquire("s3", false) == 0, "归还后低位复用");

        // ---------- C. JS 道（单实例） ----------
        System.out.println("[C] JS 道单实例");
        ok(pool.acquire("j1", true) == 2, "JS 领道固定是 2");
        l2.busy = true; l2.sid = "j1"; l2.rid = 201;
        ok(pool.acquire("j1", true) == 2, "JS 同 id 再领 = 重启（不拒绝自己）");
        ok(pool.acquire("j2", true) == -1, "JS 异 id 领不到（单 WebView）");
        pool.release(1);
        ok(pool.acquire("s9", false) == 1, "JS 占用不妨碍引擎道正常领道（互不侵占）");
        pool.release(2);
        ok(pool.acquire("j2", true) == 2, "JS 道归还后异 id 能领");

        // ---------- D. 满员判定 ----------
        System.out.println("[D] 满员判定");
        RunnerPool p2 = new RunnerPool();
        p2.attach(new RunnerPool.Lane[]{new FakeLane(), new FakeLane(), new FakeLane()});
        ok(!p2.engineFull() && !p2.jsFull(), "全空：引擎 / JS 都不满");
        p2.acquire("a", false);
        p2.acquire("b", false);
        ok(p2.engineFull() && !p2.jsFull(), "两条引擎道记账满 = engineFull，JS 不受牵连");
        p2.acquire("c", true);
        ok(p2.jsFull(), "JS 道记账 = jsFull");

        // ---------- E. 查找 ----------
        System.out.println("[E] 查找");
        FakeLane la = (FakeLane) p2.lane(0);
        la.sid = "a"; la.rid = 301;
        ok(p2.findByScriptId("a") == la && p2.findByRunId(301) == la, "按脚本 id / runId 找到在跑的道");
        ok(p2.findByRunId(0) == null && p2.findByRunId(999) == null, "runId=0 与不存在的 runId 都找不到");
        ok(p2.findByScriptId("") == null && p2.findByScriptId(null) == null && p2.findByScriptId("zz") == null,
                "空 / null / 陌生脚本 id 都找不到");

        // ---------- F. 归还幂等 ----------
        System.out.println("[F] 归还幂等");
        p2.release(0);
        p2.release(0);                          // 连还两次
        ok(!p2.engineFull(), "重复归还无害（accounting 不为负不抛）");
        ok(p2.acquire("x", false) == 0, "归还的道可再领");
        p2.release(-1);
        p2.release(9);
        p2.release(RunnerPool.JS_LANE);
        ok(p2.lane(0) != null && p2.lane(2) != null, "越界归还与 JS 道归还都不炸、装配还在");

        // ---------- G. 与真 RunSlot 联动 ----------
        // 池记「哪条道被领了」，RunSlot.ACTIVE 记「哪些会话活着」——两边各管各的账，
        // 对得上号（runId 一致）但不互为真相源。
        System.out.println("[G] 与真 RunSlot 联动");
        RunSlot.ACTIVE.clear();
        RunnerPool p3 = new RunnerPool();
        FakeLane g0 = new FakeLane(), g1 = new FakeLane(), g2 = new FakeLane();
        p3.attach(new RunnerPool.Lane[]{g0, g1, g2});
        p3.acquire("g1", false);
        RunSlot gs = new RunSlot(RunSlot.nextId(), false);
        gs.setMeta("g1", "自动比价");
        gs.register();
        g0.busy = true; g0.sid = "g1"; g0.rid = gs.runId;
        ok(p3.findByRunId(gs.runId) == g0 && RunSlot.busyOf(RunSlot.ACTIVE).equals("running"),
                "池按 runId 找到的道与 ACTIVE 槽对应，聚合 running");
        ok(p3.acquire("g1", false) == 0, "ACTIVE 有槽时同 id 仍领回原道（重启优先不变）");
        gs.unregister();
        p3.release(0);
        ok(RunSlot.busyOf(RunSlot.ACTIVE).equals("idle") && p3.findByRunId(gs.runId) == null,
                "槽注销 + 池归还后两边各自归位");

        // ---------- H. LogStore 裁剪与多写者 ----------
        System.out.println("[H] LogStore 裁剪与多写者");
        LogStore.get().clear();
        for (int i = 1; i <= LogLine.CAP + 5; i++) {
            LogStore.get().add(LogLine.of(i, "行" + i, LogLine.INFO));   // 多个会话交错写（归属各不相同）
        }
        LogStore.get().add(LogLine.of(RunSlot.NO_RUN, "系统一行", LogLine.INFO));
        ok(LogStore.get().size() == LogLine.CAP, "超 CAP 裁头部：始终只留 " + LogLine.CAP + " 行");
        ok(LogStore.get().all().get(0).m.equals("行7"), "裁掉的是最老的（行 1~6 没了，行 7 在队头）");
        JSONArray tail = LogStore.get().json(3);
        ok(tail.length() == 3 && tail.optJSONObject(2).optString("m").equals("系统一行")
                        && !tail.optJSONObject(2).has("r") && tail.optJSONObject(1).optLong("r") == LogLine.CAP + 5,
                "json(n) 取尾部 n 条：r=" + (LogLine.CAP + 5) + " 带徽标、系统行不输出 r");

        System.out.println(pass + " 项断言，" + (fail == 0 ? "全通过" : fail + " 项失败"));
        if (fail > 0) System.exit(1);
    }
}
