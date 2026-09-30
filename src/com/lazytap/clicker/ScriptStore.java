package com.lazytap.clicker;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** 脚本仓库：脚本与录制结果都存成 JSON 文件，无数据库，内存占用几乎为零 */
public final class ScriptStore {

    private static File dir;
    private static JSONArray scripts = new JSONArray();
    private static JSONArray recording = new JSONArray();
    private static JSONObject logs = null;

    public static boolean ready() {
        return dir != null;
    }

    public static void init(Context c) {
        dir = c.getFilesDir();
        scripts = read("scripts.json").optJSONArray("scripts");
        if (scripts == null) scripts = new JSONArray();
        recording = read("record.json").optJSONArray("actions");
        if (recording == null) recording = new JSONArray();
    }

    // 读文件不用 java.nio.file.Files：那是 API 26 才有的，而这个 App 最低支持到 API 24，
    // 在 Android 7.0/7.1 上会抛 NoClassDefFoundError（是 Error 不是 Exception，catch 接不住，直接崩）。
    private static JSONObject read(String name) {
        File f = new File(dir, name);
        if (!f.exists()) return new JSONObject();
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new JSONObject(new String(bo.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            // 文件坏了不能直接当空处理——那样下一次保存就会把用户的脚本全冲掉。
            // 留一份 .bad 让数据还有救。
            try {
                File bad = new File(dir, name + ".bad");
                if (f.exists()) {
                    FileInputStream in2 = new FileInputStream(f);
                    FileOutputStream out2 = new FileOutputStream(bad);
                    byte[] buf2 = new byte[8192];
                    int n2;
                    while ((n2 = in2.read(buf2)) > 0) out2.write(buf2, 0, n2);
                    in2.close();
                    out2.close();
                }
            } catch (Throwable ignored) {
            }
            return new JSONObject();
        }
    }

    /** 写入：先写临时文件再替换，避免写一半崩了把原文也弄没。全程同步，防多线程写串 */
    private static synchronized void write(String name, String content) {
        File f = new File(dir, name);
        // 临时文件名带线程号，避免跑脚本的线程和界面的线程抢同一个 tmp
        File tmp = new File(dir, name + "." + Thread.currentThread().getId() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();          // 真正落盘，别留在页缓存里
        } catch (Exception e) {
            tmp.delete();
            return;
        }
        if (!tmp.renameTo(f)) {
            // 改名失败的话，原文件还在，宁可这次没存上也别把旧的删了
            tmp.delete();
        }
    }

    public static JSONArray scripts() {
        return scripts;
    }

    public static void saveScripts(JSONArray arr) {
        scripts = arr == null ? new JSONArray() : arr;
        JSONObject root = new JSONObject();
        try {
            root.put("scripts", scripts);
        } catch (Exception ignored) {
        }
        write("scripts.json", root.toString());
    }

    /** 记录这个脚本跑过一次（用于列表里的统计展示） */
    public static void touchRun(JSONObject sc) {
        try {
            sc.put("runs", sc.optInt("runs", 0) + 1);
            sc.put("lastRun", System.currentTimeMillis());
        } catch (Exception ignored) {
        }
        JSONObject root = new JSONObject();
        try {
            root.put("scripts", scripts);
        } catch (Exception ignored) {
        }
        write("scripts.json", root.toString());
    }

    public static JSONObject findScript(String id) {
        for (int i = 0; i < scripts.length(); i++) {
            JSONObject o = scripts.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    public static JSONArray recording() {
        return recording;
    }

    public static void clearRecording() {
        recording = new JSONArray();
        write("record.json", "{\"actions\":[]}");
    }

    /** JS 侧编辑录制结果后整体覆盖 */
    public static void saveRecording(JSONArray arr) {
        recording = arr == null ? new JSONArray() : arr;
        JSONObject root = new JSONObject();
        try {
            root.put("actions", recording);
        } catch (Exception ignored) {
        }
        write("record.json", root.toString());
    }

    /** 录制条上的“撤销上一步” */
    public static boolean removeLastRecordAction() {
        if (recording.length() == 0) return false;
        recording.remove(recording.length() - 1);
        JSONObject root = new JSONObject();
        try {
            root.put("actions", recording);
        } catch (Exception ignored) {
        }
        write("record.json", root.toString());
        return true;
    }

    public static void addRecordAction(JSONObject a) {
        recording.put(a);
        JSONObject root = new JSONObject();
        try {
            root.put("actions", recording);
        } catch (Exception ignored) {
        }
        write("record.json", root.toString());
    }

    public static String newId() {
        return Long.toString(System.currentTimeMillis(), 36) + Integer.toString((int) (Math.random() * 1296), 36);
    }
}
