package com.lazytap.clicker;

import android.graphics.Bitmap;

/**
 * 图色识别：找色 / 比色 / 找图。
 * 全部纯 Java 实现，不引第三方、不引模型，代价是几十毫秒级的搜索耗时，够用。
 */
public final class Img {

    private Img() {
    }

    /** 两个颜色的相似度：100 = 一模一样 */
    public static int colorSim(int a, int b) {
        int dr = Math.abs(((a >> 16) & 255) - ((b >> 16) & 255));
        int dg = Math.abs(((a >> 8) & 255) - ((b >> 8) & 255));
        int db = Math.abs((a & 255) - (b & 255));
        return 100 - (dr + dg + db) * 100 / 765;
    }

    public static int colorSim(int a, int r, int g, int b) {
        int dr = Math.abs(((a >> 16) & 255) - r);
        int dg = Math.abs(((a >> 8) & 255) - g);
        int db = Math.abs((a & 255) - b);
        return 100 - (dr + dg + db) * 100 / 765;
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
        int bw = big.getWidth(), bh = big.getHeight();
        int sw = small.getWidth(), sh = small.getHeight();
        if (sw <= 0 || sh <= 0 || sw > bw || sh > bh) return null;
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        x1 = x1 <= 0 ? bw - 1 : Math.min(bw - 1, x1);
        y1 = y1 <= 0 ? bh - 1 : Math.min(bh - 1, y1);
        if (x1 - x0 < sw || y1 - y0 < sh) return null;

        int[] bp = pixels(big);
        int[] sp = pixels(small);

        // 三层金字塔：1/4 粗搜 → 1/2 精修 → 原图定准。
        // 越靠前的层越稀疏，粗搜只做「排除」，不做「定案」，所以采样少点没关系。
        int f = 4;
        int[] bl = shrink(bp, bw, bh, f);
        int[] sl = shrink(sp, sw, sh, f);
        int lw = bw / f, lh = bh / f;
        int lsw = Math.max(1, sw / f), lsh = Math.max(1, sh / f);
        int bx = -1, by = -1;
        float bs = -1;
        int maxLx = Math.min(lw - lsw, x1 / f), maxLy = Math.min(lh - lsh, y1 / f);
        // 粗搜步长：最多扫 160×160 个位置，保证耗时可控（真机 1080p 实测 < 60ms）
        int stride = Math.max(1, Math.max(maxLx - x0 / f, maxLy - y0 / f) / 160);
        for (int ly = y0 / f; ly <= maxLy; ly += stride) {
            for (int lx = x0 / f; lx <= maxLx; lx += stride) {
                float m = ratio(bl, lw, lx, ly, sl, lsw, lsh, sim, 2);
                if (m > bs) { bs = m; bx = lx * f; by = ly * f; }
            }
        }
        if (bx < 0) return null;
        // 第二层：在候选点 ±(f*2) 范围内按原图 2 像素步长精修
        float best = -1;
        int rx = bx, ry = by;
        int r = f * 2;
        for (int y = Math.max(y0, by - r); y <= Math.min(y1 - sh, by + r); y += 2) {
            for (int x = Math.max(x0, bx - r); x <= Math.min(x1 - sw, bx + r); x += 2) {
                float m = ratio(bp, bw, x, y, sp, sw, sh, sim, 2);
                if (m > best) { best = m; rx = x; ry = y; }
            }
        }
        // 第三层：在第二层最优解 ±3 像素里按 1 像素步长定准
        for (int y = Math.max(y0, ry - 3); y <= Math.min(y1 - sh, ry + 3); y++) {
            for (int x = Math.max(x0, rx - 3); x <= Math.min(x1 - sw, rx + 3); x++) {
                float m = ratio(bp, bw, x, y, sp, sw, sh, sim, 2);
                if (m > best) { best = m; rx = x; ry = y; }
            }
        }
        if (best < 0) return null;
        if (best * 100 < sim) return null;
        return new int[]{rx + sw / 2, ry + sh / 2, Math.round(best * 100)};
    }

    /** 达标像素比例 0~1：采样步长为 step，比较 small 的每个采样点 */
    private static float ratio(int[] big, int bw, int bx, int by,
                               int[] small, int sw, int sh, int sim, int step) {
        int hit = 0, tot = 0;
        for (int j = 0; j < sh; j += step) {
            int bi = (by + j) * bw + bx;
            int si = j * sw;
            for (int i = 0; i < sw; i += step) {
                tot++;
                if (colorSim(big[bi + i], small[si + i]) >= sim) hit++;
            }
        }
        return tot == 0 ? 0 : (float) hit / tot;
    }

    private static int[] pixels(Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] p = new int[w * h];
        b.getPixels(p, 0, w, 0, 0, w, h);
        return p;
    }

    /** 最近邻缩到 1/f */
    private static int[] shrink(int[] src, int w, int h, int f) {
        int nw = Math.max(1, w / f), nh = Math.max(1, h / f);
        int[] out = new int[nw * nh];
        for (int y = 0; y < nh; y++) {
            int sy = y * f;
            for (int x = 0; x < nw; x++) {
                out[y * nw + x] = src[sy * w + x * f];
            }
        }
        return out;
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
