package com.lazytap.clicker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** 开机（设置里打开后）自动把悬浮球叫起来 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? null : i.getAction();
        if (a == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(a)) {
            return;
        }
        Prefs.init(c);
        ScriptStore.init(c);
        Trigger.scheduleAll(c); // 重启后把定时触发器重新排上
        if (!Prefs.getBool("boot", false)) return;
        if (Build.VERSION.SDK_INT >= 23 && !android.provider.Settings.canDrawOverlays(c)) return;
        FloatService.show(c);
    }
}
