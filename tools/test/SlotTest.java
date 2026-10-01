import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 运行会话与多播单测（v2.7.0）：runId 分配 / 状态槽 / 最忙优先聚合 /
 * 交替跑不串日志仿真 / LogLine 归属 / Bus 多播。
 *
 * <p>RunSlot / Bus / LogLine 全是零 Android 依赖的真源码（剥 package 后直接编译）。
 * E 节复刻 ScriptRunner 的日志归属行为——改 ScriptRunner 的 log() 时要同步这里，
 * 和 EngineTest 是同一个约定。
 */
public class SlotTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) {
        System.out.println("运行会话与多播单测（v2.7.0）");

        // ---------- A. runId 分配 ----------
        System.out.println("[A] runId 分配");
        long a1 = RunSlot.nextId(), a2 = RunSlot.nextId(), a3 = RunSlot.nextId();
        ok(a1 > 0, "runId 从 1 起（0 保留给无归属）");
        ok(a2 == a1 + 1 && a3 == a2 + 1, "分配严格递增");
        ok(a1 != a2 && a2 != a3, "不会分到重复 id");

        // ---------- B. 状态槽与快照 ----------
        System.out.println("[B] 状态槽与快照");
        RunSlot s = new RunSlot(7, false);
        ok("running".equals(s.state()), "新槽默认就是 running（存在即在做东西）");
        s.setMeta("sc01", "每天签到");
        s.setProg(3, 10);
        JSONObject j = s.snapshot();
        ok(j.optLong("runId") == 7 && j.optString("state").equals("running"), "快照带 runId 与 state");
        ok("sc01".equals(j.optString("id")) && "每天签到".equals(j.optString("name")), "快照带脚本 id 与名字");
        ok(j.optInt("prog") == 3 && j.optInt("total") == 10, "快照带进度");
        ok(!j.optBoolean("js"), "引擎动作脚本的槽 js=false");
        ok(j.optLong("elapsed") >= 0, "elapsed 不为负");
        s.setState("paused");
        ok("paused".equals(s.snapshot().optString("state")), "暂停后快照跟着变");
        s.setState("stopped");
        ok("paused".equals(s.state()), "stopped 不是合法槽状态（停止=注销槽，不改 state）");
        s.setProg(-2, -5);
        ok(s.progCur() == 0 && s.progTotal() == 0, "负进度夹成 0");
        RunSlot sjs = new RunSlot(8, true);
        ok(sjs.snapshot().optBoolean("js"), "JS 脚本的槽 js=true");

        // ---------- C. 最忙优先聚合 ----------
        System.out.println("[C] 最忙优先聚合");
        List<RunSlot> slots = new ArrayList<>();
        ok(RunSlot.busyOf(slots).equals("idle"), "空表 = idle");
        ok(RunSlot.busyOf(null).equals("idle"), "null 集合 = idle 不抛");
        RunSlot r1 = new RunSlot(1, false);
        RunSlot r2 = new RunSlot(2, false);
        slots.add(r1);
        ok(RunSlot.busyOf(slots).equals("running"), "一个 running 就是 running");
        slots.add(r2);
        r2.setState("paused");
        ok(RunSlot.busyOf(slots).equals("running"), "running + paused = running（最忙优先）");
        r1.setState("paused");
        ok(RunSlot.busyOf(slots).equals("paused"), "全 paused = paused");
        RunSlot rj = new RunSlot(3, true);
        slots.add(rj);
        ok(RunSlot.busyOf(slots).equals("running"), "JS 槽在跑也是 running");
        JSONObject agg = RunSlot.aggregate(slots);
        ok(agg.optJSONArray("runs") != null && agg.optJSONArray("runs").length() == 3, "聚合带全部槽的快照");
        ok("running".equals(agg.optString("busy")), "聚合的 busy 与 busyOf 一致");

        // ---------- D. 注销 ----------
        System.out.println("[D] 会话结束注销");
        slots.remove(r1);
        JSONObject after = RunSlot.aggregate(slots);
        boolean gone = true;
        JSONArray rr = after.optJSONArray("runs");
        for (int i = 0; i < rr.length(); i++) if (rr.optJSONObject(i).optLong("runId") == 1) gone = false;
        ok(gone, "注销的会话不再出现在聚合里");
        ok(after.optJSONArray("runs").length() == 2, "聚合条数跟着减");
        slots.clear();
        ok(RunSlot.busyOf(slots).equals("idle"), "全注销后回到 idle");

        // ---------- E. 交替跑不串日志（仿真 ScriptRunner 的归属行为） ----------
        // 改 ScriptRunner 的 log() 时同步这里 —— 和 EngineTest 是同一个约定：
        // 当前会话的 runId 是多少，写出的行就归属多少；停止后归 0（系统消息）。
        System.out.println("[E] 交替跑不串日志（仿真）");
        List<LogLine> logs = new ArrayList<>();
        long cur = RunSlot.NO_RUN;
        cur = RunSlot.nextId();                                    // 会话 A 开跑
        long runA = cur;
        logs.add(LogLine.of(cur, "开跑：A", LogLine.INFO));
        logs.add(LogLine.of(cur, "没找到 x，再等等", LogLine.WARN));
        logs.add(LogLine.of(cur, "第 2 步出错：boom", LogLine.ERR));
        cur = RunSlot.NO_RUN;                                      // A 停了
        logs.add(LogLine.of(cur, "停下了", LogLine.INFO));         // 停止后的日志归系统
        cur = RunSlot.nextId();                                    // 会话 B 开跑
        long runB = cur;
        logs.add(LogLine.of(cur, "开跑：B", LogLine.INFO));
        logs.add(LogLine.of(cur, "完成了", LogLine.INFO));
        ok(runA != runB && runA > 0 && runB > 0, "两次运行拿到不同 runId");
        ok(logs.get(0).r == runA && logs.get(1).r == runA && logs.get(2).r == runA,
                "会话 A 的三行全归 A");
        ok(logs.get(3).r == RunSlot.NO_RUN, "停止后的日志归系统（r=0），不挂给刚结束的会话");
        ok(logs.get(4).r == runB && logs.get(5).r == runB, "会话 B 的行全归 B，不吃 A 的账");
        int nA = 0, nB = 0, nSys = 0;
        for (LogLine l : logs) {
            if (l.r == runA) nA++;
            else if (l.r == runB) nB++;
            else nSys++;
        }
        ok(nA == 3 && nB == 2 && nSys == 1, "按归属分组：A 3 行 / B 2 行 / 系统 1 行");
        ok("第 2 步出错：boom".equals(logs.get(2).json().optString("m"))
                && logs.get(2).json().optLong("r") == runA, "JSON 序列化后归属原样保留");

        // ---------- F. LogLine 兼容 ----------
        System.out.println("[F] LogLine 兼容");
        LogLine old = new LogLine("系统消息", LogLine.INFO);
        ok(old.r == RunSlot.NO_RUN, "老构造器（消息, 级别）的行 r=0");
        ok(!old.json().has("r"), "r=0 不进 JSON（老数据没徽标）");
        LogLine timed = new LogLine(1000L, "定时写的一行", LogLine.WARN);
        ok(timed.r == RunSlot.NO_RUN && timed.lv == LogLine.WARN, "老构造器（时间, 消息, 级别）不受影响");
        LogLine legacy = LogLine.legacy("没找到按钮");
        ok(legacy.r == RunSlot.NO_RUN && legacy.lv == LogLine.WARN, "legacy 还原老格式照旧 r=0 且能分级");
        LogLine tagged = LogLine.of(5, "带归属的一行", LogLine.ERR);
        ok(tagged.json().optLong("r") == 5 && tagged.lv == LogLine.ERR, "带归属的行 JSON 带 r，级别不变");
        ok(LogLine.of(-1, "负归属", LogLine.INFO).r == RunSlot.NO_RUN, "负 runId 夹回 0");

        // ---------- G. Bus 多播 ----------
        System.out.println("[G] Bus 多播");
        Bus.setSink(null);                       // 清场：别的用例别串进来
        final List<String> got1 = new ArrayList<>(), got2 = new ArrayList<>();
        Bus.Sink s1 = (t, d) -> { throw new RuntimeException("故意的：一个 sink 崩不能影响别人"); };
        Bus.Sink s2 = (t, d) -> got2.add(t + "|" + d);
        Bus.addSink(s1);
        Bus.addSink(s2);
        Bus.emit("status", "running");
        ok(got2.size() == 1 && "status|running".equals(got2.get(0)), "一个 sink 抛异常，其余照常收到");
        Bus.addSink(null);
        Bus.emit("log");
        ok(got2.size() == 2 && "log|".equals(got2.get(1)), "emit(type) 重载也通、addSink(null) 不炸");
        Bus.removeSink(s2);
        Bus.emit("record", "start");
        ok(got2.size() == 2, "removeSink 后不再收");
        Bus.addSink(s2);
        Bus.addSink(s2);
        Bus.emit("x", "1");
        ok(got2.size() == 3, "重复 addSink 只算一个（不重复派发）");
        Bus.setSink(s1);                          // 兼容写法：清掉重加
        final List<String> got3 = new ArrayList<>();
        Bus.addSink((t, d) -> got3.add(t));
        Bus.emit("y", "2");
        ok(got2.size() == 3 && got3.size() == 1, "setSink 清空旧列表（兼容旧单 sink 语义）");

        System.out.println(pass + " 项断言，" + (fail == 0 ? "全通过" : fail + " 项失败"));
        if (fail > 0) System.exit(1);
    }
}
