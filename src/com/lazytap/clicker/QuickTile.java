package com.lazytap.clicker;

import android.annotation.TargetApi;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import org.json.JSONObject;

/** 下拉快捷磁贴：点一下跑最近用过的脚本，再点一下停 */
@TargetApi(24)
public class QuickTile extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        update();
    }

    private void update() {
        Tile t = getQsTile();
        if (t == null) return;
        boolean running = ScriptRunner.get().isRunning();
        t.setState(running ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        String last = Prefs.getString("lastScript", "");
        JSONObject sc = last.isEmpty() ? null : ScriptStore.findScript(last);
        t.setLabel(running ? "停止脚本" : (sc == null ? "懒人点击器" : "跑：" + sc.optString("name", "")));
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Prefs.init(this);
        ScriptStore.init(this);
        if (ScriptRunner.get().isRunning()) {
            ScriptRunner.get().stop();
        } else {
            String last = Prefs.getString("lastScript", "");
            JSONObject sc = last.isEmpty() ? null : ScriptStore.findScript(last);
            if (sc != null && TapService.alive()) {
                JsEngine.startScript(sc, null);
            } else {
                startActivityAndCollapse(new android.content.Intent(this, MainActivity.class)
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }
        update();
    }
}
