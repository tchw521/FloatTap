package com.lazytap.clicker;

import android.graphics.Bitmap;

/**
 * 图色识别：找色 / 比色 / 找图 / 找字。
 * 全部纯 Java 实现，不引第三方、不引模型，代价是几十毫秒级的搜索耗时，够用。
 * v3.1.0：模板匹配的算法核心抽进了零依赖的 Match（能进单测），本类只做 Bitmap 门面——
 * 转像素平面、转发匹配、多档缩放入口。
 */
public final class Img {

    private Img() {
    }

    /** 两个颜色的相似度：100 = 一模一样（实现在 Match，这里留着旧签名） */
    public static int colorSim(int a, int b) {
        return Match.colorSim(a, b);
    }

    public static int colorSim(int a, int r, int g, int b) {
        return Match.colorSim(a, r, g, b);
    }

    /** "#RRGGBB" / "#AARRGGBB" → 0xRRGGBB */
    public static int parseColor(String s) {
        if (s == null) return 0;
        String v = s.trim();
        if (v.startsWith("#")) v = v.substring(1);
        try {
            if (v.length() == 6) return 0xFF000000 | (int) (Long.parseLong(v, 16) & 0xFFFFFFL);
            if (v.length() == 8) return (int) Long.parseLong(v, 16);
            return (int) Long.parseLong(v, 16);
        } catch (Exception e) {
            return 0;
        }
    }

    /** 单点比色：某点的颜色与目标色相似度是否达标 */
    public static boolean cmpColor(Bitmap bmp, int x, int y, int color, int sim) {
        if (bmp == null) return false;
        if (x < 0 || y < 0 || x >= bmp.getWidth() || y >= bmp.getHeight()) return false;
        return colorSim(bmp.getPixel(x, y), color) >= sim;
    }

    /** 在区域里找颜色，返回命中的 {x, y, sim}，没找到返回 null */
    public static int[] findColor(Bitmap bmp, int color, int sim, int x0, int y0, int x1, int y1, int step) {
        if (bmp == null) return null;
        int w = bmp.getWidth(), h = bmp.getHeight();
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        x1 = x1 <= 0 ? w - 1 : Math.min(w - 1, x1);
        y1 = y1 <= 0 ? h - 1 : Math.min(h - 1, y1);
        int st = step < 1 ? 1 : step;
        int bestX = -1, bestY = -1, bestS = -1;
        for (int y = y0; y <= y1; y += st) {
            for (int x = x0; x <= x1; x += st) {
                int s = colorSim(bmp.getPixel(x, y), color);
                if (s >= sim) {
                    if (s > bestS) { bestS = s; bestX = x; bestY = y; }
                    if (bestS >= 99) return new int[]{bestX, bestY, bestS};
                }
            }
        }
        return bestX < 0 ? null : new int[]{bestX, bestY, bestS};
    }

    /**
     * 找图：先 1/4 缩略粗搜，再逐层细化，返回 {中心x, 中心y, 相似度}
     * sim 是"像素达标比例"，90 表示 90% 的采样点颜色对得上
     */
    public static int[] findImage(Bitmap big, Bitmap small, int sim) {
        return findImage(big, small, sim, 0, 0, 0, 0);
    }

    public static int[] findImage(Bitmap big, Bitmap small, int sim, int x0, int y0, int x1, int y1) {
        if (big == null || small == null) return null;
        return Match.find(plane(big), plane(small), sim, x0, y0, x1, y1);
    }

    /**
     * 找图（v3.1.0 多档缩放入口）：zoom 非 0 时模板按 0.8 / 1.0 / 1.25 三档各试一遍，
     * 解决「屏幕上的字/图比截的模板大一号小一号」的失配；zoom 为 0 等价老接口，零额外开销。
     * box 是 {x0,y0,x1,y1}，全 0 = 全图。
     */
    public static int[] findImage(Bitmap big, Bitmap small, int sim, int[] box, float zoom) {
        if (big == null || small == null) return null;
        return Match.findZoom(plane(big), plane(small), sim,
                box != null && (box[0] != 0 || box[1] != 0 || box[2] != 0 || box[3] != 0) ? box : null,
                zoom != 0 ? Match.ZOOMS_DEFAULT : null);
    }

    /** Bitmap → 零依赖像素平面（android.graphics 的调用到此为止，匹配都在 Match） */
    private static Match.Plane plane(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] p = new int[w * h];
        b.getPixels(p, 0, w, 0, 0, w, h);
        return new Match.Plane(p, w, h);
    }

    /** 裁剪 */
    public static Bitmap crop(Bitmap b, int x, int y, int w, int h) {
        if (b == null) return null;
        int bw = b.getWidth(), bh = b.getHeight();
        x = Math.max(0, Math.min(x, bw - 1));
        y = Math.max(0, Math.min(y, bh - 1));
        w = Math.max(1, Math.min(w, bw - x));
        h = Math.max(1, Math.min(h, bh - y));
        return Bitmap.createBitmap(b, x, y, w, h);
    }
}
