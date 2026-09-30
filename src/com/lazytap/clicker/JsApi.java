package com.lazytap.clicker;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** 给 WebView 里的 JS 用的桥：方法返回值全部为字符串，方便 JS 直接 JSON.parse */
public final class JsApi {

    private final Context c;

    JsApi(Context c) {
        this.c = c;
    }

    private String ok(String s) {
        return s;
    }

    @JavascriptInterface
    public String scripts() {
        return ok(ScriptStore.scripts().toString());
    }

    @JavascriptInterface
    public String saveScripts(String json) {
        try {
            JSONArray arr = new JSONArray(json);
            ScriptStore.saveScripts(arr);
            Bus.emit("scripts", "");
            if (FloatService.get() != null) FloatService.get().refresh();
            return "ok";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String run(String id) {
        JSONObject sc = ScriptStore.findScript(id);
        if (sc == null) return "err:脚本不存在";
        if (!TapService.alive()) return "err:无障碍没开";
        if (ScriptRunner.get().isRunning()) ScriptRunner.get().stop();
        return ScriptRunner.get().start(sc) ? "ok" : "err:启动失败";
    }

    @JavascriptInterface
    public String stop() {
        ScriptRunner.get().stop();
        return "ok";
    }

    @JavascriptInterface
    public String status() {
        JSONObject o = new JSONObject();
        try {
            o.put("running", ScriptRunner.get().isRunning());
            o.put("current", ScriptRunner.get().currentId());
            o.put("acc", TapService.enabled(c));
            o.put("overlay", overlayOk());
            TapService svc = TapService.get();
            o.put("recording", (svc != null && svc.isRecording())
                    || Prefs.getBool("recordingOn", false));
            o.put("touch", svc != null && svc.touchOn());
            o.put("ball", FloatService.get() != null && FloatService.get().ballShown());
            JSONArray lg = new JSONArray();
            java.util.List<String> ls = ScriptRunner.get().logs();
            int start = Math.max(0, ls.size() - 60);
            for (int i = start; i < ls.size(); i++) lg.put(ls.get(i));
            o.put("log", lg);
            o.put("screen", screenInfo());
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private JSONObject screenInfo() {
        JSONObject o = new JSONObject();
        try {
            if (TapService.get() != null) {
                o.put("w", TapService.get().screenW());
                o.put("h", TapService.get().screenH());
            } else {
                o.put("w", c.getResources().getDisplayMetrics().widthPixels);
                o.put("h", c.getResources().getDisplayMetrics().heightPixels);
            }
        } catch (Exception ignored) {
        }
        return o;
    }

    private boolean overlayOk() {
        if (Build.VERSION.SDK_INT < 23) return true;
        return Settings.canDrawOverlays(c);
    }

    @JavascriptInterface
    public String openAcc() {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
        return "ok";
    }

    @JavascriptInterface
    public String openOverlay() {
        if (Build.VERSION.SDK_INT >= 23) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                c.startActivity(i);
            } catch (Exception e) {
                return "err:" + e.getMessage();
            }
        }
        return "ok";
    }

    @JavascriptInterface
    public String showBall() {
        if (!overlayOk()) return "err:overlay";
        FloatService.show(c);
        return "ok";
    }

    @JavascriptInterface
    public String hideBall() {
        FloatService.hide(c);
        return "ok";
    }

    @JavascriptInterface
    public String recStart() {
        if (!TapService.alive()) return "err:无障碍服务没开，先去开启";
        TapService.get().startRecord();
        return "ok";
    }

    @JavascriptInterface
    public String recStop() {
        if (!TapService.alive()) return "err:无障碍服务没开";
        TapService.get().stopRecord();
        return "ok";
    }

    @JavascriptInterface
    public String recording() {
        return ScriptStore.recording().toString();
    }

    @JavascriptInterface
    public String saveRecording(String json) {
        try {
            ScriptStore.saveRecording(new JSONArray(json));
            return "ok";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String clearRecording() {
        ScriptStore.clearRecording();
        return "ok";
    }

    @JavascriptInterface
    public String prefs() {
        return Prefs.get().toString();
    }

    @JavascriptInterface
    public String savePrefs(String json) {
        try {
            Prefs.merge(new JSONObject(json));
            if (FloatService.get() != null) FloatService.get().refresh();
            return "ok";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            android.content.pm.PackageInfo pi =
                    c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            o.put("version", pi.versionName);
            o.put("code", pi.versionCode);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "?");
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    // ---------- 自动化触发器 ----------

    @JavascriptInterface
    public String triggers() {
        return Trigger.all().toString();
    }

    @JavascriptInterface
    public String saveTriggers(String json) {
        try {
            Trigger.save(new JSONArray(json));
            Trigger.scheduleAll(c);
            return "ok";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    /** 手动试一下某个触发器 */
    @JavascriptInterface
    public String fireTrigger(String id) {
        JSONObject t = Trigger.find(id);
        if (t == null) return "err:没这个触发器";
        Trigger.runById(c, t);
        return "ok";
    }

    /** 当前前台应用包名，写「如果是某 App」判断时用得上 */
    @JavascriptInterface
    public String curApp() {
        TapService svc = TapService.get();
        return svc == null ? "" : svc.topPkg();
    }

    @JavascriptInterface
    public String toast(String msg) {
        Toast.makeText(c, msg, Toast.LENGTH_SHORT).show();
        return "ok";
    }

    /** 悬浮球模式：收起界面，只留球 */
    @JavascriptInterface
    public String toBall() {
        if (!overlayOk()) return "err:overlay";
        FloatService.show(c);
        if (c instanceof Activity) ((Activity) c).finish();
        return "ok";
    }

    /** 单步试运行，编辑器里点“试一下”用 */
    @JavascriptInterface
    public String testAction(String json) {
        if (!TapService.alive()) return "err:无障碍没开";
        try {
            JSONObject a = new JSONObject(json);
            JSONArray arr = new JSONArray();
            arr.put(a);
            JSONObject sc = new JSONObject();
            sc.put("id", "__test__");
            sc.put("name", "试一下");
            sc.put("actions", arr);
            sc.put("loop", false);
            sc.put("loopCount", 1);
            ScriptRunner.get().stop();
            return ScriptRunner.get().start(sc) ? "ok" : "err:失败";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }
}
