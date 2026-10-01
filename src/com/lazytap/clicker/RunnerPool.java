package com.lazytap.clicker;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 运行会话池（v3.0.0 多任务并行）：2 条引擎道 + 1 条 JS 道，最多同时 3 条会话。
 *
 * <p>以前「跑脚本」只有 ScriptRunner 单例一条道，第二个脚本来了只能把第一个
 * 杀掉（抢占三连：isBusy? → stop → start）。现在脚本先向池「领道」，领到才开跑：
 * 同 id 已在跑 → 把那道还给调用方去重启（重跑比拒绝合理）；
 * 有空道 → 低位优先占一条；满员 → -1 + 一条系统日志，调用方自己出提示。
 *
 * <p>池不认识 ScriptRunner：道只暴露 Lane 接口（零依赖），测试用假道就能把
 * 记账规则全部钉死（tools/test/PoolTest.java）；ScriptRunner 实现 Lane 是
 * 装配（Lanes）的事。
 *
 * <p>记账（seatBusy/seatSid）全部 synchronized：领道在主线程、自然收工的归还
 * 在引擎线程，两边并发改账不锁就会看走眼（TOCTOU）。
 */
public final class RunnerPool {

    /** 池规模：0/1 是引擎动作道，2 是 JS 道（单 WebView）——对齐浮层 MAX_BARS=3 */
    public static final int LANES = 3;
    public static final int JS_LANE = 2;

    /** 一条运行道的最小接口：池只靠这几个问题认识一条道 */
    public interface Lane {
        boolean isBusy();

        boolean isRunning();

        boolean isPaused();

        /** 本道当前会话的运行 id（没在跑 = RunSlot.NO_RUN） */
        long runId();

        /** 本道当前脚本 id（没在跑 = ""） */
        String scriptId();

        /** 开跑（实现方自己先收掉旧会话）。false = 没跑起来（无障碍没开 / 脚本空） */
        boolean start(JSONObject sc);

        void stop();

        void pause();

        void resume();

        /** 本道会话变量表快照（没在跑返回 null） */
        JSONArray varSnapshot();

        /** 试求值一个表达式（结果文本；不支持/没在跑返回 null） */
        String tryEval(String expr);
    }

    private static final RunnerPool POOL = new RunnerPool();

    public static RunnerPool get() {
        return POOL;
    }

    private final Lane[] seats = new Lane[LANES];
    private final boolean[] seatBusy = new boolean[LANES];
    private final String[] seatSid = new String[LANES];

    /** 生产一律走 get()；构造器留给测试同包直接 new 干净池 */
    RunnerPool() {
    }

    /** 装配（Lanes 启动时挂真道；测试挂假道）。幂等：null 位不清掉已装好的道 */
    public synchronized void attach(Lane[] lanes) {
        if (lanes == null) return;
        for (int i = 0; i < LANES && i < lanes.length; i++) {
            if (lanes[i] != null) seats[i] = lanes[i];
        }
    }

    /** 第 i 条道（越界返回 null） */
    public synchronized Lane lane(int i) {
        return i >= 0 && i < LANES ? seats[i] : null;
    }

    /**
     * 领道：返回道号；-1 = 满员（已落一条 r=0 系统日志并 Bus 广播，调用方出提示）。
     * js=true 只在 JS 道（[JS_LANE, LANES)）里找，引擎脚本只在 [0, JS_LANE)——
     * 两种道互不侵占，同 id 重启也只认同类型的道。
     */
    public synchronized int acquire(String scriptId, boolean js) {
        String sid = scriptId == null ? "" : scriptId;
        int lo = js ? JS_LANE : 0;
        int hi = js ? LANES : JS_LANE;
        // 同 id 已在跑：把那道还给调用方去重启（优先于空道，更优先于满员拒绝）
        for (int i = lo; i < hi; i++) {
            if (seatBusy[i] && seats[i] != null && seats[i].isBusy() && sid.equals(seatSid[i])) return i;
        }
        // 空位低位优先
        for (int i = lo; i < hi; i++) {
            if (!seatBusy[i]) {
                seatBusy[i] = true;
                seatSid[i] = sid;
                return i;
            }
        }
        String msg = js ? "JS 会话已满，先停掉正在跑的 JS 脚本再试"
                : "会话已满（2 个动作 + 1 个 JS），先停一个再跑";
        LogStore.get().add(LogLine.of(RunSlot.NO_RUN, msg, LogLine.INFO));
        Bus.emit("log", msg);
        return -1;
    }

    /** 归还（幂等）：stop/自然收工（retireSlot）后调用，不还的道永远算被占着 */
    public synchronized void release(int lane) {
        if (lane < 0 || lane >= LANES) return;
        seatBusy[lane] = false;
        seatSid[lane] = "";
    }

    /** 按 runId 找在跑的那条道 */
    public synchronized Lane findByRunId(long runId) {
        if (runId <= RunSlot.NO_RUN) return null;
        for (int i = 0; i < LANES; i++) {
            Lane l = seats[i];
            if (l != null && seatBusy[i] && l.runId() == runId) return l;
        }
        return null;
    }

    /** 按脚本 id 找在跑的那条道 */
    public synchronized Lane findByScriptId(String scriptId) {
        String sid = scriptId == null ? "" : scriptId;
        if (sid.isEmpty()) return null;
        for (int i = 0; i < LANES; i++) {
            Lane l = seats[i];
            if (l != null && seatBusy[i] && sid.equals(l.scriptId())) return l;
        }
        return null;
    }

    /** 引擎道是否全被占 */
    public synchronized boolean engineFull() {
        for (int i = 0; i < JS_LANE; i++) {
            if (!seatBusy[i]) return false;
        }
        return true;
    }

    /** JS 道是否被占 */
    public synchronized boolean jsFull() {
        return seatBusy[JS_LANE];
    }
}
