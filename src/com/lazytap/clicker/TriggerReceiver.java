package com.lazytap.clicker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** 只负责接定时 / 周期闹钟，接到就跑脚本，然后排下一次 */
public class TriggerReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? null : i.getAction();
        if (!Trigger.ACT.equals(a)) return;
        if (!Prefs.ready()) Prefs.init(c);
        if (!ScriptStore.ready()) ScriptStore.init(c);
        String id = i.getStringExtra("id");
        JSONObject t = Trigger.find(id);
        if (t != null && t.optBoolean("on", true)) Trigger.runById(c, t);
        Trigger.scheduleAll(c); // 排下一次（每天的会顺延一天）
    }
}
