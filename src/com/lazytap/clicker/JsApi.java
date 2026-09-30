package com.lazytap.clicker;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
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
        JsEngine.get().stop();
        return "ok";
    }

    // ---------- JS 脚本模式（v1.7.0） ----------

    /** 跑一个 JS 脚本（脚本对象里带 code 字段） */
    @JavascriptInterface
    public String runJs(String id) {
        JSONObject sc = ScriptStore.findScript(id);
        if (sc == null) return "err:脚本不存在";
        if (!TapService.alive()) return "err:无障碍没开";
        if (JsEngine.get().isBusy()) return "err:上一个 JS 脚本还在跑，先停掉";
        return JsEngine.startScript(sc, (type, data) -> Bus.emit("js", type + "|" + data))
                ? "ok" : "err:脚本是空的，先写两行";
    }

    @JavascriptInterface
    public String stopJs() {
        JsEngine.get().stop();
        return "ok";
    }

    // ---------- 分享码（v1.8.0） ----------

    /** 生成单个脚本的分享码 */
    @JavascriptInterface
    public String shareCode(String id) {
        JSONObject sc = ScriptStore.findScript(id);
        if (sc == null) return "err:脚本不存在";
        String code = Share.one(sc);
        return code.isEmpty() ? "err:没生成出来" : code;
    }

    /** 把全部脚本打成一个分享码（换手机时用） */
    @JavascriptInterface
    public String shareAll() {
        JSONArray arr = ScriptStore.scripts();
        if (arr == null || arr.length() == 0) return "err:还没有脚本可导出";
        String code = Share.all(arr);
        return code.isEmpty() ? "err:没生成出来" : code;
    }

    /** 导入一段分享码。重名会自动改名，id 重新生成，不会覆盖已有脚本 */
    @JavascriptInterface
    public String importCode(String code) {
        JSONObject r = Share.decode(code);
        if (r.has("err")) return "err:" + r.optString("err");
        JSONArray all = ScriptStore.scripts();
        if (all == null) all = new JSONArray();
        int n = 0;
        if ("all".equals(r.optString("kind"))) {
            JSONArray list = r.optJSONArray("scripts");
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject s = list.optJSONObject(i);
                    if (s != null) {
                        all.put(fresh(s, all));
                        n++;
                    }
                }
            }
        } else {
            JSONObject s = r.optJSONObject("script");
            if (s == null) return "err:分享码里没有脚本";
            all.put(fresh(s, all));
            n = 1;
        }
        if (n == 0) return "err:分享码里没有脚本";
        ScriptStore.saveScripts(all);
        Bus.emit("scripts", "");
        if (FloatService.get() != null) FloatService.get().refresh();
        return "ok:" + n;
    }

    /** 换个 id，名字撞了就加个后缀（别把用户已有的脚本盖掉） */
    private static JSONObject fresh(JSONObject s, JSONArray all) {
        try {
            s.put("id", "s" + System.currentTimeMillis() + (int) (Math.random() * 100000));
            s.put("runs", 0);
            String name = s.optString("name", "导入的脚本");
            int k = 2;
            String base = name;
            for (; ; ) {
                boolean dup = false;
                for (int i = 0; i < all.length(); i++) {
                    if (name.equals(all.optJSONObject(i).optString("name"))) {
                        dup = true;
                        break;
                    }
                }
                if (!dup) break;
                name = base + " " + k++;
            }
            s.put("name", name);
        } catch (Exception ignored) {
        }
        return s;
    }

    /** 复制到系统剪贴板 */
    @SuppressWarnings("deprecation")
    @JavascriptInterface
    public String copy(String text) {
        try {
            android.content.ClipboardManager cm =
                    (android.content.ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return "err:拿不到剪贴板";
            cm.setPrimaryClip(android.content.ClipData.newPlainText("lazytap", text));
            return "ok";
        } catch (Throwable t) {
            return "err:" + t.getMessage();
        }
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
            o.put("vars", ScriptRunner.get().varSnapshot());   // 运行时变量值，调试用
            o.put("js", JsEngine.get().isBusy());              // JS 脚本在不在跑
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** 内置变量清单，界面「插入变量」下拉用 */
    @JavascriptInterface
    public String builtinVars() {
        JSONArray a = new JSONArray();
        String[][] b = Vars.BUILTIN;
        for (int i = 0; i < b.length; i++) {
            JSONObject o = new JSONObject();
            try {
                o.put("k", b[i][0]);
                o.put("d", b[i][1]);
            } catch (Exception ignored) {
            }
            a.put(o);
        }
        return a.toString();
    }

    /** 试算一段表达式（不含 {{}}），用当前变量值算，界面上即时看结果 */
    @JavascriptInterface
    public String tryExpr(String e) {
        String r = ScriptRunner.get().tryEval(e);
        return r == null ? "err:读不懂" : r;
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

    // ---------- 图色识别 ----------

    @JavascriptInterface
    public String capStatus() {
        JSONObject o = new JSONObject();
        try {
            o.put("granted", Capture.granted());
            o.put("running", Capture.running());
            o.put("w", Capture.width());
            o.put("h", Capture.height());
            JSONArray t = new JSONArray();
            for (String n : TplStore.names()) t.put(n);
            o.put("tpls", t);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** 拉起系统截屏授权弹窗，结果由 MainActivity 回调 */
    @JavascriptInterface
    public String reqCap() {
        try {
            Intent i = Capture.requestIntent(c);
            if (i == null) return "err:这台设备不支持截屏";
            if (c instanceof Activity) {
                ((Activity) c).startActivityForResult(i, MainActivity.REQ_CAP);
                return "ok";
            }
            return "err:没法拉起授权弹窗";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String capStop() {
        CaptureService.stop(c);
        Capture.stop();
        return "ok";
    }

    /** 给界面用的缩略截图（base64 PNG），只用来取点 / 取色 */
    @JavascriptInterface
    public String shot() {
        Bitmap bmp = Capture.shot(c, 2500);
        if (bmp == null) return "err:没截到屏，先授权截屏";
        int maxW = 420;
        int w = bmp.getWidth(), h = bmp.getHeight();
        int tw = Math.min(maxW, w), th = Math.max(1, h * tw / w);
        Bitmap small = Bitmap.createScaledBitmap(bmp, tw, th, true);
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.PNG, 80, bos);
        String b64 = android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.DEFAULT);
        return "data:image/png;base64," + b64.replace("\n", "");
    }

    /** 真实屏幕坐标处的颜色 */
    @JavascriptInterface
    public String colorAt(String xy) {
        Bitmap bmp = Capture.last();
        if (bmp == null) return "err:还没有截图";
        try {
            int i = xy.indexOf(',');
            int x = Integer.parseInt(xy.substring(0, i).trim());
            int y = Integer.parseInt(xy.substring(i + 1).trim());
            int bw = bmp.getWidth(), bh = bmp.getHeight();
            float sx = (float) bw / (Capture.width() > 0 ? Capture.width() : bw);
            float sy = (float) bh / (Capture.height() > 0 ? Capture.height() : bh);
            int px = Math.min(bw - 1, Math.max(0, Math.round(x * sx)));
            int py = Math.min(bh - 1, Math.max(0, Math.round(y * sy)));
            int c = bmp.getPixel(px, py);
            return String.format("#%06X", c & 0xFFFFFF);
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    /** 把屏幕上的一块区域存成模板图（找图用） */
    @JavascriptInterface
    public String saveTpl(String json) {
        Bitmap bmp = Capture.last();
        if (bmp == null) return "err:还没有截图";
        try {
            JSONObject o = new JSONObject(json);
            String name = o.optString("name", "").trim();
            if (name.isEmpty()) return "err:给模板起个名字";
            int bw = bmp.getWidth(), bh = bmp.getHeight();
            float sx = (float) bw / (Capture.width() > 0 ? Capture.width() : bw);
            float sy = (float) bh / (Capture.height() > 0 ? Capture.height() : bh);
            int x = Math.round(o.optInt("x", 0) * sx);
            int y = Math.round(o.optInt("y", 0) * sy);
            int w = Math.round(o.optInt("w", 60) * sx);
            int h = Math.round(o.optInt("h", 60) * sy);
            Bitmap crop = Img.crop(bmp, x, y, w, h);
            if (crop == null) return "err:裁剪失败";
            boolean ok = TplStore.save(name, crop);
            return ok ? "ok" : "err:保存失败";
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    @JavascriptInterface
    public String delTpl(String name) {
        return TplStore.del(name) ? "ok" : "err:删不掉";
    }

    @JavascriptInterface
    public String toast(String msg) {
        // @JavascriptInterface 跑在 WebView 的 JavaBridge 线程上，那个线程没有 Looper，
        // 直接 Toast 会抛 RuntimeException（不是 Exception，catch(Exception) 接不住），
        // 异常会一路冒回 JS，让调用方的 Promise 直接失败。必须回主线程发。
        try {
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                try {
                    Toast.makeText(c, msg, Toast.LENGTH_SHORT).show();
                } catch (Throwable ignored) {
                }
            });
        } catch (Throwable ignored) {
        }
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
