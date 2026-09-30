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
        // v2.5.0：暂停也算在跑——磁贴要能看出来，点了要能停
        boolean busy = ScriptRunner.get().isBusy();
        boolean paused = ScriptRunner.get().isPaused();
        t.setState(busy ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        String last = Prefs.getString("lastScript", "");
        JSONObject sc = last.isEmpty() ? null : ScriptStore.findScript(last);
        t.setLabel(paused ? "已暂停·点继续" : (busy ? "停止脚本" : (sc == null ? "懒人点击器" : "跑：" + sc.optString("name", ""))));
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Prefs.init(this);
        ScriptStore.init(this);
        if (ScriptRunner.get().isPaused()) {
            // 暂停中的磁贴点一下：先恢复（误触代价小），再点一下才是停止
            ScriptRunner.get().resume();
        } else if (ScriptRunner.get().isBusy()) {
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
