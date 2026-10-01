package com.lazytap.clicker;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 脚本互斥锁（v3.1.0）：同名锁全局互斥，按 runId 记归属，可重入（同 runId 计数 +1，
 * 主脚本 lock A 后子脚本再 lock A 不会自己把自己锁死）。
 * 只提供「立即成败」的 tryAcquire，不做等待——等待由 ScriptRunner 用 pollUntil 轮询实现，
 * 急停/暂停能即时打断，比 wait/notify 把引擎线程挂死在锁上干净得多。
 * 脚本收尾 retireSlot() 统一 releaseAll(runId)，忘了解锁也不会坑死下一个脚本。
 */
public final class Locks {

    private static final Locks ME = new Locks();

    private static final class Owner {
        final long runId;
        int count;

        /** 首次拿锁即持有 1 次，重入在此基础上 +1 */
        Owner(long runId) {
            this.runId = runId;
            this.count = 1;
        }
    }

    private final HashMap<String, Owner> locks = new HashMap<>();

    private Locks() {
    }

    public static Locks get() {
        return ME;
    }

    /**
     * 拿锁：成功 true。runId<=0 或锁名为空一律 false——
     * 没有会话的调用没有归属，收尾时 releaseAll 救不回来，干脆不许拿。
     */
    public synchronized boolean tryAcquire(String name, long runId) {
        if (name == null || name.isEmpty() || runId <= 0) return false;
        Owner o = locks.get(name);
        if (o == null) {
            locks.put(name, new Owner(runId));
            return true;
        }
        if (o.runId == runId) {
            o.count++;
            return true;
        }
        return false;
    }

    /** 放锁：计数归零才真释放。不是自己的锁放不掉，返回 false */
    public synchronized boolean release(String name, long runId) {
        if (name == null || name.isEmpty() || runId <= 0) return false;
        Owner o = locks.get(name);
        if (o == null || o.runId != runId) return false;
        if (--o.count <= 0) locks.remove(name);
        return true;
    }

    /** 释放某会话持有的全部锁（脚本收尾兜底用），返回放掉的把数 */
    public synchronized int releaseAll(long runId) {
        if (runId <= 0) return 0;
        int n = 0;
        Iterator<Map.Entry<String, Owner>> it = locks.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue().runId == runId) {
                it.remove();
                n++;
            }
        }
        return n;
    }

    /** 锁是否被某会话持有（调试与测试用） */
    public synchronized boolean heldBy(String name, long runId) {
        Owner o = name == null ? null : locks.get(name);
        return o != null && o.runId == runId;
    }
}
