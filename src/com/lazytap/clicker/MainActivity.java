package com.lazytap.clicker;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 壳子很薄：一个 WebView + JS 桥，界面全在 assets/www 里用 JS 写 */
public class MainActivity extends Activity {

    static final int REQ_CAP = 101;

    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Prefs.init(this);
        ScriptStore.init(this);
        TplStore.init(this);
        Trigger.scheduleAll(this);
        setContentView(R.layout.main);
        web = findViewById(R.id.web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new JsApi(this), "app");
        web.loadUrl("file:///android_asset/www/index.html");

        Bus.setSink((type, data) -> push(type, data));
        ScriptRunner.get().setListener((type, data) -> {
            push(type, data);
            if (FloatService.get() != null) FloatService.get().refresh();
        });
    }

    /** 把内核事件推给页面里的 window.__on(type, data) */
    private void push(String type, String data) {
        if (web == null) return;
        final String js = "javascript:(function(){try{window.__on&&window.__on("
                + q(type) + "," + q(data) + ")}catch(e){}})()";
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 19) {
                    web.evaluateJavascript(js, null);
                } else {
                    web.loadUrl(js);
                }
            } catch (Throwable ignored) {
            }
        });
    }

    private static String q(String s) {
        if (s == null) s = "";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else sb.append(c);
        }
        return sb.append('"').toString();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_CAP) {
            if (res == RESULT_OK && data != null) {
                Capture.setResult(res, data);
                CaptureService.start(this);   // Android 14 起必须挂前台服务
                push("cap", "ok");
            } else {
                push("cap", "no");
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        push("resume", "");
        if (Prefs.getBool("ballVisible", false) && FloatService.get() == null
                && (Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(this))) {
            FloatService.show(this);
        }
    }

    @Override
    public void onBackPressed() {
        // 页面用 window.__backHandled = true 表示自己处理了返回（比如关闭弹窗）
        web.evaluateJavascript("(function(){try{return (window.__back&&window.__back())?1:0}catch(e){return 0}})()",
                v -> {
                    if (!"1".equals(v)) moveTaskToBack(true);
                });
    }

    @Override
    protected void onDestroy() {
        Bus.setSink(null);
        if (web != null) {
            ((ViewGroup) web.getParent()).removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
