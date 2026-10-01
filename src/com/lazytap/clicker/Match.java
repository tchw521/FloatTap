package com.lazytap.clicker;

/**
 * 模板匹配核心（v3.1.0）：把找图/找字的匹配算法从 Img 抽出来，只认 int[] 像素平面，
 * 不碰 android.graphics —— 这样 run-tests.sh 能剥掉 package 直接编译本类做单测。
 * 算法与 v1.5 起的三层金字塔完全一致（1/4 粗搜 → 1/2 精修 → 原样定准），
 * v3.1.0 新增多档缩放 zoom：字模按 0.8 / 1.0 / 1.25 三档各试一遍，
 * 解决「屏幕上的字比截的字模大一号/小一号」这类失配。
 */
public final class Match {

    /** 单个像素的容差：隔了缩放和压缩，指望每个像素都一样不现实 */
    static final int PIXEL_SIM = 65;

    /** 多档缩放的默认档位：先原尺寸，不行再缩到 0.8、放大到 1.25 各试一遍 */
    public static final float[] ZOOMS_DEFAULT = {0.8f, 1.0f, 1.25f};

    /** 一张像素平面：RGBA 打平的像素数组 + 宽高 */
    public static final class Plane {
        public final int[] px;
        public final int w, h;

        public Plane(int[] px, int w, int h) {
            this.px = px;
            this.w = w;
            this.h = h;
        }
    }

    private Match() {
    }

    /** 两个颜色的相似度：100 = 一模一样（自 Img 迁入，Img 反向调这里） */
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

    /**
     * 单尺度匹配：先 1/4 缩略粗搜，再逐层细化，返回 {中心x, 中心y, 相似度 0~100}。
     * sim 是「像素达标比例」，90 表示 90% 的采样点颜色对得上。没找到返回 null。
     * 算法自 Img.findImage 逐行原搬（v3.1.0），行为零变化。
     */
    public static int[] find(Plane big, Plane tpl, int sim, int x0, int y0, int x1, int y1) {
        if (big == null || tpl == null) return null;
        int bw = big.w, bh = big.h, sw = tpl.w, sh = tpl.h;
        if (sw <= 0 || sh <= 0 || sw > bw || sh > bh) return null;
        x0 = Math.max(0, x0);
        y0 = Math.max(0, y0);
        x1 = x1 <= 0 ? bw - 1 : Math.min(bw - 1, x1);
        y1 = y1 <= 0 ? bh - 1 : Math.min(bh - 1, y1);
        if (x1 - x0 < sw || y1 - y0 < sh) return null;

        int[] bp = big.px, sp = tpl.px;

        // 三层金字塔：1/4 粗搜 → 1/2 精修 → 原图定准。
        // 越靠前的层越稀疏，粗搜只做「排除」，不做「定案」，所以采样少点没关系。
        int f = 4;
        Plane bl = shrink(big, f);
        Plane sl = shrink(tpl, f);
        int lw = bl.w, lh = bl.h, lsw = sl.w, lsh = sl.h;
        int bx = -1, by = -1;
        float bs = -1;
        int maxLx = Math.min(lw - lsw, x1 / f), maxLy = Math.min(lh - lsh, y1 / f);
        // 粗搜步长：最多扫 160×160 个位置，保证耗时可控（真机 1080p 实测 < 60ms）
        int stride = Math.max(1, Math.max(maxLx - x0 / f, maxLy - y0 / f) / 160);
        for (int ly = y0 / f; ly <= maxLy; ly += stride) {
            for (int lx = x0 / f; lx <= maxLx; lx += stride) {
                float m = ratio(bl.px, lw, lx, ly, sl.px, lsw, lsh, PIXEL_SIM, 2);
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
                float m = ratio(bp, bw, x, y, sp, sw, sh, PIXEL_SIM, 2);
                if (m > best) { best = m; rx = x; ry = y; }
            }
        }
        // 第三层：在第二层最优解 ±3 像素里按 1 像素步长定准
        for (int y = Math.max(y0, ry - 3); y <= Math.min(y1 - sh, ry + 3); y++) {
            for (int x = Math.max(x0, rx - 3); x <= Math.min(x1 - sw, rx + 3); x++) {
                float m = ratio(bp, bw, x, y, sp, sw, sh, PIXEL_SIM, 2);
                if (m > best) { best = m; rx = x; ry = y; }
            }
        }
        if (best < 0) return null;
        if (best * 100 < sim) return null;
        return new int[]{rx + sw / 2, ry + sh / 2, Math.round(best * 100)};
    }

    /**
     * 多档缩放匹配（v3.1.0）：逐档把模板 resize 后各跑一遍 find，取相似度最高的一档。
     * 原尺寸（1.0）档优先且命中即止——多数场景就是原尺寸，不为试档白跑。
     * zooms 传 null 等价单尺度（只跑原尺寸）。box 是 {x0,y0,x1,y1}，全 0 或 null = 全图。
     */
    public static int[] findZoom(Plane big, Plane tpl, int sim, int[] box, float[] zooms) {
        if (big == null || tpl == null || tpl.w <= 0 || tpl.h <= 0) return null;
        int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        if (box != null && box.length >= 4) {
            x0 = box[0];
            y0 = box[1];
            x1 = box[2];
            y1 = box[3];
        }
        if (zooms == null) return find(big, tpl, sim, x0, y0, x1, y1);
        // 第一轮：原尺寸档，命中直接回
        for (float z : zooms) {
            if (z == 1.0f) {
                int[] r = find(big, tpl, sim, x0, y0, x1, y1);
                if (r != null) return r;
            }
        }
        // 第二轮：其余档各试一遍，取相似度最高的
        int[] best = null;
        for (float z : zooms) {
            if (z == 1.0f || z <= 0) continue;
            Plane t2 = resize(tpl, z);
            if (t2.w > big.w || t2.h > big.h) continue;
            int[] r = find(big, t2, sim, x0, y0, x1, y1);
            if (r != null && (best == null || r[2] > best[2])) best = r;
        }
        return best;
    }

    /**
     * 最近邻缩放（v3.1.0）：按浮点比例采样，Img.shrink 只支持整数分频所以在这里重写。
     * 缩放后尺寸 = round(原尺寸 × 比例)，最小保 1。
     */
    public static Plane resize(Plane src, float scale) {
        if (src == null || scale <= 0 || scale == 1.0f) return src;
        int nw = Math.max(1, Math.round(src.w * scale)), nh = Math.max(1, Math.round(src.h * scale));
        int[] out = new int[nw * nh];
        for (int y = 0; y < nh; y++) {
            int sy = (int) (y / scale);
            if (sy >= src.h) sy = src.h - 1;
            for (int x = 0; x < nw; x++) {
                int sx = (int) (x / scale);
                if (sx >= src.w) sx = src.w - 1;
                out[y * nw + x] = src.px[sy * src.w + sx];
            }
        }
        return new Plane(out, nw, nh);
    }

    /**
     * 达标像素比例 0~1：采样步长为 step，比较 small 的每个采样点。
     * 注意 pixelSim 是「单个像素允许差多少」的容差，跟 find 的 sim（整体要多大比例达标）
     * 是两回事——把 sim 同时当这两个门槛用的话，填 90 就要求每个点都几乎一模一样且 90% 达标，
     * 结果就是永远找不到。
     */
    private static float ratio(int[] big, int bw, int bx, int by,
                               int[] small, int sw, int sh, int pixelSim, int step) {
        int hit = 0, tot = 0;
        for (int j = 0; j < sh; j += step) {
            int bi = (by + j) * bw + bx;
            int si = j * sw;
            for (int i = 0; i < sw; i += step) {
                tot++;
                if (colorSim(big[bi + i], small[si + i]) >= pixelSim) hit++;
            }
        }
        return tot == 0 ? 0 : (float) hit / tot;
    }

    /** 最近邻缩到 1/f（金字塔粗搜用，自 Img 迁入） */
    private static Plane shrink(Plane src, int f) {
        int nw = Math.max(1, src.w / f), nh = Math.max(1, src.h / f);
        int[] out = new int[nw * nh];
        for (int y = 0; y < nh; y++) {
            int sy = y * f;
            for (int x = 0; x < nw; x++) {
                out[y * nw + x] = src.px[sy * src.w + x * f];
            }
        }
        return new Plane(out, nw, nh);
    }
}
