// Asuka 自定义 Capacitor 插件的 JS 桥 — 把 SMS 读 / 通知监听 暴露给前端
// 原生实现在 android/app/src/main/java/com/asuka/bookkeeping/AsukaCapturePlugin.java
// 类型定义见同目录 asuka-capture.d.ts

import { registerPlugin } from '@capacitor/core';
import type {
  AsukaCapturePlugin as AsukaCapturePluginType,
  NotificationPayload,
} from './asuka-capture.d';

const AsukaCapture = registerPlugin<AsukaCapturePluginType>('AsukaCapture', {
  // 通知事件由 Service 直接 notifyListeners 派发；这里给个空监听占位
  // 真实订阅在 useAsukaCapture hook 里
});

export default AsukaCapture;
export type { NotificationPayload };
