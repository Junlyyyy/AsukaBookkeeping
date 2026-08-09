package com.asuka.bookkeeping;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.os.Bundle;

import com.getcapacitor.JSObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Asuka 通知监听 — 拿到系统通知栏的新通知（微信支付/支付宝/银行 App），
 * 过滤出「支付/消费/转账」相关的，转 JSON 经 Capacitor Plugin 派发给 JS。
 *
 * 必须在 Manifest 中声明：
 *   <service
 *     android:name=".AsukaNotificationListener"
 *     android:label="@string/app_name"
 *     android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
 *     <intent-filter>
 *       <action android:name="android.service.notification.NotificationListenerService" />
 *     </intent-filter>
 *   </service>
 *
 * 用户需在 Settings → 特殊权限 → 通知使用权 中手动勾选本 App，本 Service 才会被系统调用。
 *
 * 监听范围（package 白名单）：
 *   - com.tencent.mm                 (微信)
 *   - com.eg.android.AlipayGphone    (支付宝)
 *   - com.unionpay                   (云闪付)
 *   - icbc / boc / ccb / abc / cmb   (各银行 App 学名)
 *
 * 通知内容抓取：
 *   - 标题 + 文本 → 拼为 body
 *   - extras 中 BIG_PICTURE / TEXT 等可能更准确，本实现用 extras 优先。
 */
public class AsukaNotificationListener extends NotificationListenerService {

    /** 派发给前端的桥：插件启动时把自身注入进来 */
    private static AsukaCapturePlugin plugin;

    public static void setPlugin(AsukaCapturePlugin p) { plugin = p; }
    public static void clearPlugin(AsukaCapturePlugin p) {
        if (plugin == p) plugin = null;
    }

    private static final Set<String> PKG_WHITELIST = new HashSet<>(Arrays.asList(
        "com.tencent.mm",
        "com.eg.android.AlipayGphone",
        "com.unionpay",
        "com.icbc", "icbc",            // 工行
        "com.boc.bocsoft", "boc",      // 中行
        "com.ccb", "ccb",              // 建行
        "com.abc", "abc",              // 农行
        "cmb", "com.cmbchina"          // 招行
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getPackageName() == null) return;
        String pkg = sbn.getPackageName();
        // 只处理白名单里的 App
        if (!PKG_WHITELIST.contains(pkg)) return;
        // 排除自己
        if (pkg.equals(getPackageName())) return;

        android.app.Notification n = sbn.getNotification();
        if (n == null) return;

        String title = "";
        String text = "";
        if (n.extras != null) {
            CharSequence t = n.extras.getCharSequence(android.app.Notification.EXTRA_TITLE);
            CharSequence x = n.extras.getCharSequence(android.app.Notification.EXTRA_TEXT);
            if (t != null) title = t.toString();
            if (x != null) text = x.toString();

            // 微信支付消息通常在 BIG_TEXT 里
            if (text.isEmpty()) {
                CharSequence bt = n.extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT);
                if (bt != null) text = bt.toString();
            }
        }

        String body = (title + " " + text).trim();
        if (body.isEmpty()) return;

        JSObject payload = new JSObject();
        payload.put("packageName", pkg);
        payload.put("title", title);
        payload.put("text", text);
        payload.put("body", body);
        payload.put("postedAt", System.currentTimeMillis());
        payload.put("key", sbn.getKey());

        if (plugin != null) {
            // notifyListeners 在 Plugin 是 protected，用 public 包装
            plugin.fireNotificationEvent(payload);
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // 不处理
    }
}
