/**
 * 模板匹配单测（v3.1.0）：Match 是从 Img 抽出来的零依赖核心（只认 int[] 像素平面），
 * 这里用程序生成的像素图钉死算法行为——金字塔命中、相似度门槛、单像素容差、
 * 区域裁剪、多档缩放（zoom）。改 Match 时要跑这里；改算法本身先想清楚老脚本会不会失效。
 */
public class MatchTest {
    static int pass = 0, fail = 0;

    static void ok(boolean c, String name) {
        if (c) { pass++; System.out.println("  PASS  " + name); }
        else { fail++; System.out.println("  FAIL  " + name); }
    }

    static final int BLACK = 0xFF000000, WHITE = 0xFFFFFFFF;

    /** 造一张纯色平面 */
    static Match.Plane solid(int w, int h, int color) {
        int[] px = new int[w * h];
        java.util.Arrays.fill(px, color);
        return new Match.Plane(px, w, h);
    }

    /** 把 src 贴到 big 的 (x,y)（假定不越界） */
    static Match.Plane paste(Match.Plane big, Match.Plane src, int x, int y) {
        for (int j = 0; j < src.h; j++)
            System.arraycopy(src.px, j * src.w, big.px, (y + j) * big.w + x, src.w);
        return big;
    }

    public static void main(String[] args) {
        System.out.println("模板匹配单测（v3.1.0）");

        // ---------- A. 金字塔命中 ----------
        System.out.println("[A] 单尺度命中");
        Match.Plane big = solid(40, 40, BLACK);
        paste(big, solid(8, 8, WHITE), 16, 24);
        Match.Plane tpl = solid(8, 8, WHITE);
        int[] r = Match.find(big, tpl, 90, 0, 0, 0, 0);
        ok(r != null && r[0] == 20 && r[1] == 28 && r[2] == 100,
                "黑白对比精确命中：白块(16,24) 中心=(20,28) sim=100，实得 " + (r == null ? "null" : r[0] + "," + r[1] + "," + r[2]));

        Match.Plane bg2 = solid(30, 30, 0xFF404040);
        int[] r2 = Match.find(bg2, solid(6, 6, 0xFF404040), 100, 0, 0, 0, 0);
        ok(r2 != null && r2[2] == 100, "同色图 sim=100 必中");

        // ---------- B. 相似度门槛 ----------
        System.out.println("[B] 相似度门槛");
        Match.Plane bg3 = solid(20, 20, WHITE);
        int[] tp = new int[64];
        java.util.Arrays.fill(tp, WHITE);
        // 采样网格（step=2）共 16 点，涂黑 4 个采样点 → 失配 25% → sim=75
        for (int p : new int[]{0, 4, 32, 36}) tp[p] = BLACK;
        Match.Plane tplDirty = new Match.Plane(tp, 8, 8);
        int[] r3 = Match.find(bg3, tplDirty, 70, 0, 0, 0, 0);
        ok(r3 != null && r3[2] == 75, "25% 像素失配 → sim=75（门槛 70 达标），实得 " + (r3 == null ? "null" : String.valueOf(r3[2])));
        int[] r4 = Match.find(bg3, tplDirty, 90, 0, 0, 0, 0);
        ok(r4 == null, "同模板门槛 90 不达标 → null");

        // ---------- C. 单像素容差 ----------
        System.out.println("[C] 单像素容差 PIXEL_SIM=65");
        Match.Plane gray = solid(16, 16, 0xFF808080);          // 灰 128
        int[] r5 = Match.find(gray, solid(6, 6, 0xFF303030), 100, 0, 0, 0, 0);   // 灰 48，差 80 → 68 分 ≥65
        ok(r5 != null && r5[2] == 100, "差 80 灰度每点仍达标 → 整图 sim=100");
        int[] r6 = Match.find(gray, solid(6, 6, 0xFF1E1E1E), 50, 0, 0, 0, 0);    // 灰 30，差 98 → 62 分 <65
        ok(r6 == null, "差 98 灰度每点失配 → null");

        // ---------- D. 区域裁剪 ----------
        System.out.println("[D] 区域与守卫");
        Match.Plane big7 = solid(40, 40, BLACK);
        paste(big7, solid(8, 8, WHITE), 30, 30);
        ok(Match.find(big7, tpl, 90, 0, 0, 9, 9) == null, "白块在区域外 → null");
        ok(Match.find(solid(5, 5, BLACK), tpl, 90, 0, 0, 4, 4) == null, "模板大于搜索区 → null");
        ok(Match.find(big7, tpl, 90, 25, 25, 39, 39) != null, "区域罩住白块 → 命中");

        // ---------- E. 金字塔大图 ----------
        System.out.println("[E] 大图金字塔");
        Match.Plane big8 = solid(1200, 800, BLACK);
        paste(big8, solid(64, 64, WHITE), 500, 300);
        int[] r8 = Match.find(big8, solid(64, 64, WHITE), 90, 0, 0, 0, 0);
        ok(r8 != null && Math.abs(r8[0] - 532) <= 3 && Math.abs(r8[1] - 332) <= 3,
                "1200×800 找 64×64 白块：中心误差 ≤3px，实得 " + (r8 == null ? "null" : r8[0] + "," + r8[1]));

        // ---------- F. resize 最近邻 ----------
        System.out.println("[F] resize");
        int[] rowMark = new int[64];
        for (int y = 0; y < 8; y++) java.util.Arrays.fill(rowMark, y * 8, y * 8 + 8, 0xFF000000 | (y << 4));
        Match.Plane p8 = new Match.Plane(rowMark.clone(), 8, 8);
        Match.Plane down = Match.resize(p8, 0.8f);
        ok(down.w == 6 && down.h == 6, "resize 0.8：8→6");
        ok(down.px[0] == (0xFF000000 | (0 << 4)) && down.px[1 * 6] == (0xFF000000 | (1 << 4))
                && down.px[2 * 6] == (0xFF000000 | (2 << 4)) && down.px[3 * 6] == (0xFF000000 | (3 << 4))
                && down.px[4 * 6] == (0xFF000000 | (5 << 4)) && down.px[5 * 6] == (0xFF000000 | (6 << 4)),
                "resize 0.8 行取样最近邻：源行 0,1,2,3,5,6");
        Match.Plane up = Match.resize(new Match.Plane(new int[]{
                0, 1, 2, 3, 0x10, 0x11, 0x12, 0x13, 0x20, 0x21, 0x22, 0x23, 0x30, 0x31, 0x32, 0x33}, 4, 4), 1.25f);
        ok(up.w == 5 && up.h == 5, "resize 1.25：4→5");
        // 行/列取样：out(y,x) = src((int)(y/1.25), (int)(x/1.25)) → 源行列都是 0,0,1,2,3
        ok(up.px[0] == 0 && up.px[1] == 0 && up.px[2] == 1 && up.px[4] == 3
                && up.px[10] == 0x10 && up.px[15] == 0x20 && up.px[20] == 0x30,
                "resize 1.25 最近邻：行 0,0,1,2,3、行首 0/0x10/0x20/0x30");
        ok(Match.resize(p8, 1.0f) == p8, "resize 1.0 原样返回（零拷贝）");

        // ---------- G. 多档缩放 zoom ----------
        System.out.println("[G] 多档缩放");
        // 场景：大图里只有「缩小版」字模 → 原尺寸档 miss、0.8 档命中
        Match.Plane big9 = solid(40, 40, BLACK);
        Match.Plane small = Match.resize(tpl, 0.8f);           // 6×6 全白
        paste(big9, small, 16, 24);
        int[] r9 = Match.findZoom(big9, tpl, 90, null, Match.ZOOMS_DEFAULT);
        ok(r9 != null && r9[0] == 19 && r9[1] == 27 && r9[2] == 100,
                "只有 0.8 缩小版：0.8 档命中中心(19,27)，实得 " + (r9 == null ? "null" : r9[0] + "," + r9[1] + "," + r9[2]));

        // 场景：原尺寸也存在 → 1.0 档先中（不白跑其他档），返回原尺寸位置。
        // 注：把缩小版用搜索区挡在外面——粗搜层在多目标下的扫序取舍是算法固有行为，
        // 区域限定才是用户控制「找哪一块」的正道。
        Match.Plane big10 = solid(40, 40, BLACK);
        paste(big10, solid(8, 8, WHITE), 16, 24);
        paste(big10, small, 2, 2);
        int[] r10 = Match.findZoom(big10, tpl, 90, new int[]{10, 10, 39, 39}, Match.ZOOMS_DEFAULT);
        ok(r10 != null && r10[0] == 20 && r10[1] == 28,
                "原尺寸优先：区域内命中(20,28)，实得 " + (r10 == null ? "null" : r10[0] + "," + r10[1]));
        Match.Plane big12 = solid(40, 40, BLACK);
        paste(big12, solid(8, 8, WHITE), 16, 24);
        int[] r12 = Match.findZoom(big12, tpl, 90, null, Match.ZOOMS_DEFAULT);
        ok(r12 != null && r12[0] == 20 && r12[1] == 28,
                "只有原尺寸对象：1.0 档直接命中(20,28)，实得 " + (r12 == null ? "null" : r12[0] + "," + r12[1]));

        // 场景：zoom 关（null 档）且只有缩小版 → 找不到
        ok(Match.findZoom(big9, tpl, 90, null, null) == null, "zoom 关且只有缩小版 → null");

        // 场景：区域限定照样生效
        Match.Plane big11 = solid(40, 40, BLACK);
        paste(big11, small, 16, 24);
        ok(Match.findZoom(big11, tpl, 90, new int[]{0, 0, 10, 10}, Match.ZOOMS_DEFAULT) == null,
                "zoom 开但区域罩不住 → null");
        ok(Match.findZoom(big11, tpl, 90, new int[]{10, 18, 30, 38}, Match.ZOOMS_DEFAULT) != null,
                "zoom 开且区域罩得住 → 命中");

        System.out.println();
        System.out.println("通过 " + pass + " / 失败 " + fail);
        if (fail > 0) System.exit(1);
    }
}
