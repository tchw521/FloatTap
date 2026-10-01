package com.lazytap.clicker;

/**
 * 运行道装配点（v3.0.0 多任务并行）：静态初始化建 3 条真道并挂进池。
 *
 * <p>类初始化由 JVM 保证线程安全且懒触发——磁贴 / 触发器 / 开机路径
 * 不经过 MainActivity 也能用；第一次 {@link #get(int)} 或 {@link #boot()} 就装配完成。
 * 池（RunnerPool）不认识 ScriptRunner，这里是把「真道」接进「池」的唯一位置。
 */
final class Lanes {

    /** 0/1 引擎动作道 + 2 JS 道（对齐 RunnerPool.LANES / 浮层 MAX_BARS=3） */
    private static final ScriptRunner[] ALL = {
            new ScriptRunner(0), new ScriptRunner(1), new ScriptRunner(2)
    };

    static {
        RunnerPool.Lane[] lanes = new RunnerPool.Lane[RunnerPool.LANES];
        for (int i = 0; i < lanes.length; i++) lanes[i] = ALL[i];
        RunnerPool.get().attach(lanes);
    }

    private Lanes() {
    }

    /** 第 i 条真道（0/1 引擎动作道、2 JS 道）；越界回落道 0，不让调用方拿 null 起步 */
    static ScriptRunner get(int i) {
        return i >= 0 && i < ALL.length ? ALL[i] : ALL[0];
    }

    /** 确保已装配（类初始化即挂池）——给「只想装、还不急着用」的启动路径 */
    static void boot() {
    }
}
