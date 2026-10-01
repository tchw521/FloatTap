package com.lazytap.clicker;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 文字模板（v3.1.0 伪 OCR）：截屏框一个字存成字模，存在内部目录 ttxt/ 下。
 * 与图色模板（tpl/）分开管——「找图」下拉只列图色模板，「找文字(图)」只列文字模板，
 * 互不串扰。文件名即字模名，没有元数据，跟 TplStore 一个思路。
 */
public final class TextTplStore {

    private static File dir;

    public static void init(Context c) {
        dir = new File(c.getFilesDir(), "ttxt");
        if (!dir.exists()) dir.mkdirs();
    }

    private static File f(String name) {
        return new File(dir, safe(name) + ".png");
    }

    private static String safe(String n) {
        if (n == null) return "";
        return n.replaceAll("[^\\w\\u4e00-\\u9fa5.-]", "_");
    }

    public static boolean save(String name, Bitmap bmp) {
        if (dir == null || bmp == null) return false;
        try (FileOutputStream out = new FileOutputStream(f(name))) {
            return bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        } catch (Exception e) {
            return false;
        }
    }

    public static Bitmap get(String name) {
        if (dir == null || name == null || name.isEmpty()) return null;
        File file = f(name);
        if (!file.exists()) return null;
        try {
            return BitmapFactory.decodeFile(file.getAbsolutePath());
        } catch (Throwable t) {
            return null;
        }
    }

    public static List<String> names() {
        List<String> out = new ArrayList<>();
        if (dir == null) return out;
        File[] fs = dir.listFiles();
        if (fs == null) return out;
        for (File file : fs) {
            if (file.isFile() && file.getName().endsWith(".png")) {
                out.add(file.getName().substring(0, file.getName().length() - 4));
            }
        }
        java.util.Collections.sort(out);
        return out;
    }

    public static boolean del(String name) {
        if (dir == null) return false;
        try {
            return f(name).delete();
        } catch (Throwable t) {
            return false;
        }
    }
}
