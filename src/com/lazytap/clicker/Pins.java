package com.lazytap.clicker;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * v4.1.0 坐标指示器：脚本执行点击类动作时，在屏幕落点上画一个序号准星。
 *
 * 设计要点（对齐设计规范「坐标指示器 Pin」）：
 *  · 形状语义：圆 = 点击/双击/随机点，圆角方框(琥珀) = 长按，紫连线+两端点 = 滑动
 *  · 全屏透明浮层 + 自绘视图，FLAG_NOT_TOUCHABLE —— 指示器只「看」不「挡」，
 *    用户手指和脚本手势都照常落到下面的 App
 *  · Prefs.pinOn 关掉时 show() 直接返回，绝不 addView
 *  · 没有悬浮窗权限时静默放弃：指示器是锦上添花，不能因为它把脚本搞挂
 */
public final class Pins {

    public static final int SHAPE_TAP = 0;   // 圆：点击 / 双击 / 随机点
    public static final int SHAPE_HOLD = 1;  // 圆角方框：长按
    public static final int SHAPE_SWIPE = 2; // 连线：滑动

    private static WindowManager wm;
    private static View view;
    private static final Object LOCK = new Object();

    /** 显示一个点位指示器（约 pinMs 毫秒自动收起；连续调用会刷新位置与序号） */
    public static void show(TapService svc, float x, float y, int shape, int no) {
        showRaw(svc, new float[]{x, y, shape, no, -1, -1});
    }

    /** 滑动：起点→终点连线 + 两端圆点 */
    public static void showSwipe(TapService svc, float x1, float y1, float x2, float y2, int no) {
        showRaw(svc, new float[]{x1, y1, SHAPE_SWIPE, no, x2, y2});
    }

    private static void showRaw(TapService svc, float[] tag) {
        if (svc == null || !Prefs.getBool("pinOn", true)) return;
        synchronized (LOCK) {
            try {
                if (wm == null) wm = (WindowManager) svc.getSystemService(Context.WINDOW_SERVICE);
                if (wm == null) return;
                if (view == null) {
                    int type = Build.VERSION.SDK_INT >= 26
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE;
                    WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                            WindowManager.LayoutParams.MATCH_PARENT,
                            WindowManager.LayoutParams.MATCH_PARENT, type,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                            PixelFormat.TRANSLUCENT);
                    view = new PinView(svc);
                    view.setLayoutParams(lp);
                    wm.addView(view, lp);
                }
                view.setTag(tag);
                view.invalidate();
                view.removeCallbacks(Pins::hide);
                view.postDelayed(Pins::hide, Prefs.getInt("pinMs", 800));
            } catch (Throwable t) {
                view = null;   // 权限没给 / 窗口被系统拒：静默放弃
            }
        }
    }

    /** 收掉指示器（脚本停止 / 超时都会走到，必须幂等） */
    public static void hide() {
        synchronized (LOCK) {
            if (view != null && wm != null) {
                try {
                    wm.removeView(view);
                } catch (Throwable ignored) {
                }
            }
            view = null;
        }
    }

    /**
     * 自绘准星。贯穿的十字线画在外层（PinView 直接画），芯是不透明色块盖住线的中段，
     * 视觉上等价于设计稿的「wrapper 画线 + 圆芯遮中段」。
     */
    private static final class PinView extends View {
        private final float den;
        private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint txt = new Paint(Paint.ANTI_ALIAS_FLAG);

        PinView(Context c) {
            super(c);
            den = c.getResources().getDisplayMetrics().density;
            line.setStrokeWidth(1.6f * den);
            txt.setColor(0xFF05242B);
            txt.setTextSize(12.5f * den);
            txt.setFakeBoldText(true);
            txt.setTextAlign(Paint.Align.CENTER);
        }

        @Override
        protected void onDraw(Canvas cv) {
            Object o = getTag();
            if (!(o instanceof float[])) return;
            float[] t = (float[]) o;
            int shape = (int) t[2];
            if (shape == SHAPE_SWIPE) {
                line.setColor(0xD9A855F7);
                line.setStrokeWidth(3f * den);
                line.setStrokeCap(Paint.Cap.ROUND);
                cv.drawLine(t[0], t[1], t[4], t[5], line);
                chip(cv, t[0], t[1], 0xFFE9D5FF, 0xFFA855F7, 0xFF7E22CE, "·");
                chip(cv, t[4], t[5], 0xFFE9D5FF, 0xFFA855F7, 0xFF7E22CE, "▶");
                return;
            }
            cross(cv, t[0], t[1]);
            float r = 17f * den;
            boolean hold = shape == SHAPE_HOLD;
            fill.setColor(hold ? 0xFFFBBF24 : 0xFF2DD4BF);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(2f * den);
            ring.setColor(0xFFFFFFFF);
            if (hold) {
                cv.drawRoundRect(t[0] - r, t[1] - r, t[0] + r, t[1] + r, 11f * den, 11f * den, fill);
                cv.drawRoundRect(t[0] - r, t[1] - r, t[0] + r, t[1] + r, 11f * den, 11f * den, ring);
            } else {
                cv.drawCircle(t[0], t[1], r, fill);
                cv.drawCircle(t[0], t[1], r, ring);
            }
            txt.setColor(hold ? 0xFF451A03 : 0xFF05242B);
            cv.drawText(String.valueOf((int) t[3]), t[0], t[1] + 4.5f * den, txt);
        }

        /** 四向贯穿准星线：从中心向外画满整段，中段随后被不透明芯盖住 */
        private void cross(Canvas cv, float x, float y) {
            line.setColor(0x99A5F3FC);
            line.setStrokeCap(Paint.Cap.BUTT);
            line.setStrokeWidth(1.6f * den);
            float out = 15f * den;
            cv.drawLine(x, y - out, x, y + out, line);
            cv.drawLine(x - out, y, x + out, y, line);
        }

        /** 滑动端点的小圆芯 */
        private void chip(Canvas cv, float x, float y, int fillC, int ringC, int txtC, String s) {
            float r = 11f * den;
            fill.setColor(fillC);
            cv.drawCircle(x, y, r, fill);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(2f * den);
            ring.setColor(0xFFFFFFFF);
            cv.drawCircle(x, y, r, ring);
            txt.setColor(txtC);
            txt.setTextSize(10f * den);
            cv.drawText(s, x, y + 3.5f * den, txt);
            txt.setTextSize(12.5f * den);
        }
    }
}
