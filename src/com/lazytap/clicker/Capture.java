package com.lazytap.clicker;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.nio.ByteBuffer;

/**
 * 屏幕截图内核：MediaProjection + ImageReader，免 root。
 * 用户授权一次（系统弹窗）后，这里就能持续拿到最新一帧，供找色 / 找图使用。
 */
public final class Capture {

    private static MediaProjection mp;
    private static VirtualDisplay vd;
    private static ImageReader ir;
    private static volatile Bitmap last;
    private static int resultCode;
    private static Intent resultData;
    private static int w, h, dpi;
    private static MediaProjection.Callback cb;

    private Capture() {
    }

    public static boolean granted() {
        return resultData != null;
    }

    public static boolean running() {
        return mp != null && vd != null;
    }

    public static void setResult(int code, Intent data) {
        resultCode = code;
        resultData = data == null ? null : data.cloneFilter();
    }

    /** 拉起系统授权弹窗（必须在 Activity 里调） */
    public static Intent requestIntent(Context c) {
        MediaProjectionManager m = (MediaProjectionManager) c.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (m == null) return null;
        return m.createScreenCaptureIntent();
    }

    public static void measure(Context c) {
        try {
            WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics m = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(m);
            w = m.widthPixels;
            h = m.heightPixels;
            dpi = m.densityDpi;
        } catch (Throwable t) {
            w = 1080;
            h = 1920;
            dpi = 320;
        }
    }

    /** 开始截屏。返回 null 表示成功，否则返回失败原因 */
    public static String start(Context c) {
        if (resultData == null) return "还没授权截屏";
        if (running()) return null;
        try {
            if (w <= 0) measure(c);
            MediaProjectionManager m =
                    (MediaProjectionManager) c.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (m == null) return "这台设备不支持截屏";
            mp = m.getMediaProjection(resultCode, resultData);
            if (mp == null) return "授权已失效，请重新授权";
            ir = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3);
            vd = mp.createVirtualDisplay("lazytap-cap", w, h, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, ir.getSurface(), null, null);
            if (Build.VERSION.SDK_INT >= 34) {
                cb = new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        stop();
                    }
                };
                mp.registerCallback(cb, null);
            }
            return null;
        } catch (Throwable t) {
            stop();
            return "截屏起不来：" + t.getMessage();
        }
    }

    public static void stop() {
        try {
            if (vd != null) vd.release();
        } catch (Throwable ignored) {
        }
        try {
            if (ir != null) ir.close();
        } catch (Throwable ignored) {
        }
        try {
            if (mp != null) mp.stop();
        } catch (Throwable ignored) {
        }
        vd = null;
        ir = null;
        mp = null;
        cb = null;
    }

    /** 拿最新一帧（最多等 timeoutMs），失败返回 null */
    public static Bitmap shot(Context c, long timeoutMs) {
        if (!running()) {
            String err = start(c);
            if (err != null) {
                ScriptRunner.sysNote("截图失败：" + err);
                return null;
            }
        }
        long end = System.currentTimeMillis() + Math.max(200, timeoutMs);
        Bitmap got = grab();
        while (got == null && System.currentTimeMillis() < end) {
            try {
                Thread.sleep(60);
            } catch (InterruptedException e) {
                break;
            }
            got = grab();
        }
        if (got != null) last = got;
        return got != null ? got : last;
    }

    private static Bitmap grab() {
        if (ir == null) return null;
        Image img = null;
        try {
            img = ir.acquireLatestImage();
            if (img == null) return null;
            Image.Plane[] planes = img.getPlanes();
            if (planes.length == 0) return null;
            ByteBuffer buf = planes[0].getBuffer();
            int ps = planes[0].getPixelStride();
            int rs = planes[0].getRowStride();
            int pad = rs - ps * w;
            int bw = w + (ps > 0 ? pad / ps : 0);
            Bitmap bmp = Bitmap.createBitmap(bw, h, Bitmap.Config.ARGB_8888);
            bmp.copyPixelsFromBuffer(buf);
            Bitmap out = (pad == 0) ? bmp : Bitmap.createBitmap(bmp, 0, 0, w, h);
            if (out != bmp) bmp.recycle();
            return out;
        } catch (Throwable t) {
            return null;
        } finally {
            if (img != null) {
                try {
                    img.close();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    public static Bitmap last() {
        return last;
    }

    public static int width() {
        return w;
    }

    public static int height() {
        return h;
    }
}
