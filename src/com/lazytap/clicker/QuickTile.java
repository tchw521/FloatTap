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
        // v2.5.0：暂停也算在跑——磁贴要能看出来，点了要能停。
        // v3.0.0：状态看聚合（任何会话活着都算忙），不再问单例
        String busy = RunSlot.busyOf(RunSlot.ACTIVE);
        boolean active = !"idle".equals(busy);
        boolean paused = "paused".equals(busy);
        t.setState(active ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        String last = Prefs.getString("lastScript", "");
        JSONObject sc = last.isEmpty() ? null : ScriptStore.findScript(last);
        t.setLabel(paused ? "已暂停·点继续" : (active ? "停止脚本" : (sc == null ? "懒人点击器" : "跑：" + sc.optString("name", ""))));
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Prefs.init(this);
        ScriptStore.init(this);
        String busy = RunSlot.busyOf(RunSlot.ACTIVE);
        if ("paused".equals(busy)) {
            // 暂停中的磁贴点一下：先恢复（误触代价小），再点一下才是停止。v3.0.0：恢复全部
            JsEngine.resumeAll();
        } else if (!"idle".equals(busy)) {
            JsEngine.stopAll();   // v3.0.0：停全部
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
