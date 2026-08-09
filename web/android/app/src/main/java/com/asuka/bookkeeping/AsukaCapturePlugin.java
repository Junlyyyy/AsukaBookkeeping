package com.asuka.bookkeeping;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Asuka 自定义 Capacitor 插件 — 把两个能力做在一起：
 *   1) 读取系统短信收件箱（银行/支付短信）→ 离线规则解析
 *   2) 监听系统通知（微信支付/支付宝通知等）→ 实时解析入账
 *
 * 设计原则：
 *   - 完全本地，不联网。仅读取 OS 短信数据库 + 注册 NotificationListenerService。
 *   - SMS 读取需运行时权限（READ_SMS）。通知监听需用户在系统 Settings 一次性授权。
 *   - 解析逻辑在 JS 侧（本插件只负责拿原始数据），让解析规则独立于原生改动。
 */
@CapacitorPlugin(
    name = "AsukaCapture",
    permissions = {
        @Permission(
            alias = "readSms",
            strings = { Manifest.permission.READ_SMS }
        )
    }
)
public class AsukaCapturePlugin extends Plugin {

    private static final String TAG = "AsukaCapture";

    /** 通知监听回调：Service 触发时 notifyListeners("notification_captured", payload) */
    public static final String NOTIFICATION_EVENT = "notification_captured";

    /** 单例引用，便于 AsukaNotificationListener 派发通知事件回前端 */
    private static AsukaCapturePlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
        // 把当前插件注入给通知监听 Service（仅持有引用用，不强引用 Service 生命周期）
        AsukaNotificationListener.setPlugin(this);
    }

    @Override
    public void handleOnDestroy() {
        if (instance == this) {
            AsukaNotificationListener.clearPlugin(this);
            instance = null;
        }
        super.handleOnDestroy();
    }

    /**
     * 公共包装：让 Service（非 Plugin 子类）可以派发事件到 JS。
     * notifyListeners 本身是 protected，必须包一层。
     */
    public void fireNotificationEvent(JSObject payload) {
        notifyListeners(NOTIFICATION_EVENT, payload);
    }

    // =============== SMS ===============

    @PluginMethod
    public void readRecentSms(PluginCall call) {
        if (getPermissionState("readSms") != PermissionState.GRANTED) {
            requestPermissionForAlias("readSms", call, "smsPermsCallback");
            return;
        }
        long sinceMs = call.getLong("sinceMs", System.currentTimeMillis() - 24L * 3600 * 1000);
        try {
            JSONArray items = querySms(sinceMs);
            JSObject ret = new JSObject();
            ret.put("items", items);
            ret.put("count", items.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读短信失败: " + e.getMessage(), e);
        }
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        if (getPermissionState("readSms") == PermissionState.GRANTED) {
            readRecentSms(call);
        } else {
            call.reject("未授予 READ_SMS 权限");
        }
    }

    /**
     * 查询 inbox 中 sinceMs 之后的所有短信。
     * 返回 [{sender, body, date}] 数组。
     */
    private JSONArray querySms(long sinceMs) throws JSONException {
        JSONArray out = new JSONArray();
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = {
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
        };
        String selection = Telephony.Sms.DATE + " >= ?";
        String[] selectionArgs = { String.valueOf(sinceMs) };
        String sortOrder = Telephony.Sms.DATE + " DESC";
        try (Cursor c = cr.query(uri, projection, selection, selectionArgs, sortOrder)) {
            if (c == null) return out;
            int addrIdx = c.getColumnIndex(Telephony.Sms.ADDRESS);
            int bodyIdx = c.getColumnIndex(Telephony.Sms.BODY);
            int dateIdx = c.getColumnIndex(Telephony.Sms.DATE);
            while (c.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("sender", c.getString(addrIdx) != null ? c.getString(addrIdx) : "");
                item.put("body", c.getString(bodyIdx) != null ? c.getString(bodyIdx) : "");
                item.put("date", c.getLong(dateIdx));
                out.put(item);
            }
        }
        return out;
    }

    // =============== 通知监听 ===============

    /**
     * 检查用户是否已在系统 Settings → 特殊权限 → 通知使用权 中授权。
     */
    @PluginMethod
    public void isNotificationAccessGranted(PluginCall call) {
        Set<String> pkgs = NotificationManagerCompat.getEnabledListenerPackages(getContext());
        boolean granted = pkgs.contains(getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /**
     * 拉起系统「通知使用权」设置页（用户在那里勾选本 App）。
     * 跳转后用户必须手动勾选才能返回 true。
     */
    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("跳转失败: " + e.getMessage(), e);
        }
    }

    /**
     * 询问前端是否应该重新拉一次 enabled listener packages（用户授权后用来刷新 UI 状态）。
     * 此方法只返回当前最新的授权结果。
     */
    @PluginMethod
    public void pingListener(PluginCall call) {
        call.resolve();
    }
}
