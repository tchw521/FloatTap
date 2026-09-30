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

    public static String name(int keyCode) {
        if (keyCode == VOL_UP) return "音量+";
        if (keyCode == VOL_DOWN) return "音量-";
        return "按键" + keyCode;
    }
}
