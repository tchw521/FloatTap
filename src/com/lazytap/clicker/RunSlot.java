package com.lazytap.clicker;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 一次运行会话的状态槽（v2.7.0 多任务基建）。
 *
 * <p>以前「正在跑什么」散在 ScriptRunner 的几个字段里（currentId / progCur /
 * runStartAt…），谁想知道都只能去问单例——这套形状撑不起 v3.0.0 的多任务并行。
 * 本版把「一次运行」收进一个槽：引擎动作脚本、JS 脚本各占一个，状态变化时更新，
 * 结束就注销。聚合（aggregate）把一堆槽压成一个总状态，形状按「可能同时有多个」设计，
 * 只是单例时代实际最多一条。
 *
 * <p>一个 Android API 都不碰，纯 JDK 就能单测（tools/test/SlotTest.java）——
 * 聚合的「最忙优先」和日志归属是本版验收（两脚本交替跑不串日志）的核心逻辑，
 * 必须落在可测的地方。
 */
public final class RunSlot {

    /** 0 保留给「不属于任何一次运行」——系统消息、老日志。真 runId 从 1 起 */
    public static final long NO_RUN = 0L;

    private static final AtomicLong SEQ = new AtomicLong(NO_RUN);

    /** 分配下一个运行会话 id：递增、不重复，引擎动作脚本和 JS 脚本共用一个序列 */
    public static long nextId() {
        return SEQ.incrementAndGet();
    }

    /**
     * 全部活着的运行槽（引擎 + JS 都在这）。聚合、浮层、状态面板都吃它。
     * v3.0.0 实例池接管前，单例时代实际最多两条（引擎一个 + JS 一个）。
     */
    public static final List<RunSlot> ACTIVE = new CopyOnWriteArrayList<>();

    /** 开跑时把自己挂进注册表 */
    public void register() {
        if (!ACTIVE.contains(this)) ACTIVE.add(this);
    }

    /** 结束（停了 / 跑完 / JS 收尾）时注销 —— 注销即从聚合里消失 */
    public void unregister() {
        ACTIVE.remove(this);
    }

    public final long runId;
    /** JS 脚本的槽（引擎动作脚本是 false）——聚合时 JS 在跑也算 running */
    public final boolean js;

    private volatile String state = "running";   // running / paused（槽存在就是在做东西，停止即注销）
    private volatile String scriptId = "";
    private volatile String scriptName = "";
    private volatile int progCur, progTotal;
    private final long startAt = System.currentTimeMillis();

    public RunSlot(long runId, boolean js) {
        this.runId = runId;
        this.js = js;
    }

    /** 开跑时挂上脚本信息 */
    public void setMeta(String scriptId, String scriptName) {
        this.scriptId = scriptId == null ? "" : scriptId;
        this.scriptName = scriptName == null ? "" : scriptName;
    }

    /** running / paused，别的值不收（槽的注销靠从注册表移除，不是改 state） */
    public void setState(String state) {
        if ("running".equals(state) || "paused".equals(state)) this.state = state;
    }

    /** 进度：第 progCur / 共 progTotal 步 */
    public void setProg(int cur, int total) {
        this.progCur = Math.max(0, cur);
        this.progTotal = Math.max(0, total);
    }

    public String state() { return state; }
    public String scriptId() { return scriptId; }
    public String scriptName() { return scriptName; }
    public int progCur() { return progCur; }
    public int progTotal() { return progTotal; }

    /** 这一轮跑了多少毫秒（浮层上显示「已跑 12s」） */
    public long elapsed() {
        long e = System.currentTimeMillis() - startAt;
        return e < 0 ? 0 : e;
    }

    /** 单槽快照：状态面板 / 浮层 / JsApi 都吃这个形状 */
    public JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            o.put("runId", runId);
            o.put("state", state);
            o.put("id", scriptId);
            o.put("name", scriptName);
            o.put("prog", progCur);
            o.put("total", progTotal);
            o.put("elapsed", elapsed());
            o.put("js", js);
        } catch (JSONException ignored) {
        }
        return o;
    }

    /**
     * 总状态 = 最忙优先：任一 running 就是 running（JS 在跑也算），
     * 否则任一 paused 就是 paused，一个槽都没有才是 idle。
     * 以前这个判断散在 FloatService（引擎忙 ∥ JS 忙）和 QuickTile（isBusy/isPaused），
     * 现在只有一个真相源。
     */
    public static String busyOf(Collection<RunSlot> slots) {
        if (slots != null) {
            boolean paused = false;
            for (RunSlot s : slots) {
                if (s == null) continue;
                if ("running".equals(s.state)) return "running";
                if ("paused".equals(s.state)) paused = true;
            }
            if (paused) return "paused";
        }
        return "idle";
    }

    /** 聚合快照：{runs: [每槽 snapshot], busy: 最忙优先总状态}——JsApi 与浮层吃这个 */
    public static JSONObject aggregate(Collection<RunSlot> slots) {
        JSONObject o = new JSONObject();
        JSONArray runs = new JSONArray();
        try {
            if (slots != null) for (RunSlot s : slots) if (s != null) runs.put(s.snapshot());
            o.put("runs", runs);
            o.put("busy", busyOf(slots));
        } catch (JSONException ignored) {
        }
        return o;
    }
}
