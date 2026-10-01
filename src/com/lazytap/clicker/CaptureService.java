package com.lazytap.clicker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

/**
 * 截屏前台服务：Android 14 起 MediaProjection 必须在带 mediaProjection 类型的前台服务里跑。
 * 单独一个服务，这样改它不会影响悬浮球那条链路。
 */
public class CaptureService extends Service {

    private static final int ID = 9;

    public static void start(Context c) {
        Intent i = new Intent(c, CaptureService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable t) {
            try {
                c.startService(i);
            } catch (Throwable ignored) {
            }
        }
    }

    public static void stop(Context c) {
        try {
            c.stopService(new Intent(c, CaptureService.class));
        } catch (Throwable ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startInForeground();
        String err = Capture.start(this);
        if (err != null) ScriptRunner.sysNote(err);
        return START_STICKY;
    }

    private void startInForeground() {
        String chId = "lazytap";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(chId, getString(R.string.notify_channel),
                    NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        int pf = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(this, 5,
                new Intent(this, MainActivity.class), pf | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, chId)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("正在截屏（找色 / 找图用）")
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE);
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE);
            } else {
                startForeground(ID, n);
            }
        } catch (Throwable t) {
            try {
                startForeground(ID, n);
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onDestroy() {
        Capture.stop();
        super.onDestroy();
    }

    @Override
    public android.os.IBinder onBind(Intent intent) {
        return null;
    }
}
