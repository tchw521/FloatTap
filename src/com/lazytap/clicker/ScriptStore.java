package com.lazytap.clicker;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

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

    private static JSONObject read(String name) {
        try {
            File f = new File(dir, name);
            if (!f.exists()) return new JSONObject();
            byte[] b = Files.readAllBytes(f.toPath());
            return new JSONObject(new String(b, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static void write(String name, String content) {
        try {
            File f = new File(dir, name);
            File tmp = new File(dir, name + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            if (f.exists()) f.delete();
            tmp.renameTo(f);
        } catch (Exception ignored) {
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
