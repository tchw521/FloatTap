package com.lazytap.clicker;

/**
 * 音量键当急停键。
 *
 * <p>判定逻辑单独拎出来、不碰 Android API，好在纯 JDK 下直接单测（tools/test/K.java）。
 * KeyEvent.KEYCODE_VOLUME_UP / DOWN 的值写成常量，避免这里引入 import 导致测不了。
 */
public final class HotKey {

    public static final int VOL_UP = 24;    // KeyEvent.KEYCODE_VOLUME_UP
    public static final int VOL_DOWN = 25;  // KeyEvent.KEYCODE_VOLUME_DOWN

    private HotKey() {
    }

    public static boolean isVolume(int keyCode) {
        return keyCode == VOL_UP || keyCode == VOL_DOWN;
    }

    /**
     * 这一下按键要不要当成「刹车」。
     *
     * <p>四个条件缺一不可：开关开着、确实有东西在跑、是按下而不是抬起、按的是音量键。
     * 尤其「有东西在跑」这条不能省 —— 否则用户调个音量就把脚本停了，会以为是手机坏了。
     */
    public static boolean wantStop(int keyCode, boolean down, boolean enabled, boolean busy) {
        return enabled && busy && down && isVolume(keyCode);
    }

    /** 只拦按下那一下；抬起放行，不然一次按下能停两回 */
    public static boolean isDown(int action) {
        return action == 0; // KeyEvent.ACTION_DOWN
    }

    // ---- v2.5.0 三态：短按=暂停/恢复，长按=停止，JS 脚本只能急停 ----

    /** 长按判定：无障碍里按住不放约每 50ms 补一次 ACTION_DOWN，第 3 下 ≈ 按住 150ms+ */
    public static final int LONG_AT = 3;

    public static final String TOGGLE = "toggle";   // 暂停⇄恢复
    public static final String STOP = "stop";       // 急停
    public static final String NONE = "";           // 不拦，归系统

    /**
     * 三态判定。runnerBusy 传「引擎忙」（跑着或暂停都算，即 isBusy()）；
     * jsBusy 是 JS 脚本在跑。返回 {@link #TOGGLE} / {@link #STOP} / {@link #NONE}。
     *
     * <p>规则：引擎忙 → 短按切换暂停、按住到第 {@link #LONG_AT} 下急停；
     * 只有 JS 在跑 → 短按直接急停（JS 的节奏在 WebView 的 await 链里，v2.5.0 不做暂停）；
     * 都没跑 → 放行，音量归系统管。停止态不启动脚本，免得口袋里蹭一下就开跑。
     */
    public static String action(int keyCode, boolean down, int repeatCount,
                                boolean enabled, boolean runnerBusy, boolean jsBusy) {
        if (!enabled || !down || !isVolume(keyCode)) return NONE;
        if (runnerBusy) {
            if (repeatCount == 0) return TOGGLE;
            if (repeatCount == LONG_AT) return STOP;
            return NONE;   // 按住不放的后续 repeat 别再触发
        }
        if (jsBusy) return repeatCount == 0 && wantStop(keyCode, down, enabled, true) ? STOP : NONE;
        return NONE;
    }

    public static String name(int keyCode) {
        if (keyCode == VOL_UP) return "音量+";
        if (keyCode == VOL_DOWN) return "音量-";
        return "按键" + keyCode;
    }
}
