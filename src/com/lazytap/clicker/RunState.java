package com.lazytap.clicker;

/**
 * 运行三态：停止 / 运行 / 暂停。
 *
 * <p>以前只有 {@code volatile boolean running} 一个标志，暂停做不了——
 * 「停」是唯一出口。这版把状态收进一个类，好处有三：
 * <ul>
 *   <li>非法迁移进不去：没跑就「恢复」、暂停里再「暂停」，都安静地无效，调用方不用各自防呆；</li>
 *   <li>{@link #gate()} 让引擎线程在暂停时挂起：跑到哪一步，恢复就从哪一步继续，不丢进度；</li>
 *   <li>{@link #sleep(long)} 让「等待中」也能立刻暂停，且暂停期间不吃时长——
 *       以前分组里的同步睡最多 5 秒不查状态，急停要干等（v2.3.0 就知道的痛点）。</li>
 * </ul>
 *
 * <p>判定逻辑不碰 Android API，纯 JDK 可单测（tools/test/R.java）。
 * 引擎跑在专用 HandlerThread（lazytap-run）上，gate 阻塞它不影响主线程的悬浮球刷新。
 */
public final class RunState {

    public static final int STOPPED = 0;
    public static final int RUNNING = 1;
    public static final int PAUSED = 2;

    private volatile int st = STOPPED;
    private final Object lock = new Object();

    public boolean isRunning() { return st == RUNNING; }
    public boolean isPaused() { return st == PAUSED; }
    public boolean isStopped() { return st == STOPPED; }

    /** 悬浮球 / 音量键判定用的「有事在做」：跑着和暂停都算——暂停中的脚本也能急停 */
    public boolean isBusy() { return st != STOPPED; }

    public int state() { return st; }

    /** 启动或恢复。从 PAUSED 直接拉回 RUNNING 时要叫醒 gate 里的等待者 */
    public synchronized boolean start() {
        if (st == RUNNING) return false;
        st = RUNNING;
        wake();
        return true;
    }

    /** 只能从 RUNNING 暂停；没在跑就「暂停」是无操作 */
    public synchronized boolean pause() {
        if (st != RUNNING) return false;
        st = PAUSED;
        return true;
    }

    /** 只能从 PAUSED 恢复；叫醒 gate */
    public synchronized boolean resume() {
        if (st != PAUSED) return false;
        st = RUNNING;
        wake();
        return true;
    }

    /** 任何态都能停（暂停里长按音量键就是急停），停了要叫醒所有挂着的 gate/sleep */
    public synchronized boolean stop() {
        if (st == STOPPED) return false;
        st = STOPPED;
        wake();
        return true;
    }

    /**
     * 暂停闸口：暂停就挂到恢复为止，恢复后从断点继续；没暂停直接过。
     * 只在引擎线程调——主线程调它会卡住悬浮球。
     */
    public void gate() {
        if (st != PAUSED) return;
        synchronized (lock) {
            while (st == PAUSED) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    /**
     * 可暂停的睡。暂停期间不吃时长（等 5 秒暂停 10 秒，恢复后剩多少睡多少）；
     * 停止立即返回 false，调用方据此收工。正常睡完返回 true。
     */
    public boolean sleep(long ms) {
        if (ms <= 0) return st != STOPPED;
        long remain = ms;
        while (remain > 0) {
            if (st == STOPPED) return false;
            if (st == PAUSED) {
                gate();
                continue;   // 恢复（或已停止）后回到循环头：停止就退出，恢复继续睡剩余
            }
            long slice = Math.min(100, remain);
            try {
                Thread.sleep(slice);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
            remain -= slice;
        }
        return true;
    }

    private void wake() {
        synchronized (lock) {
            lock.notifyAll();
        }
    }
}
