// Asuka 自定义 Capacitor 插件的 JS 桥 — 通用 HTTP 代理（绕过 WebView CORS 限制）
// 原生实现在 android/app/src/main/java/com/asuka/bookkeeping/AsukaAsrProxyPlugin.java
// 用途：语音识别直连阿里云百炼 DashScope 时，WebView fetch 被 CORS 拦截
//      （DashScope 不返回 Access-Control-Allow-Origin）→ 由原生代理转发

import { registerPlugin } from '@capacitor/core';

export interface AsukaAsrProxyPlugin {
  /**
   * 通用请求代理
   * @param opts url/method/headers/body（JSON 文本）/ form（multipart: fields + file）
   * @returns { status: number, body: string }
   */
  request(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    form?: {
      fields?: Record<string, string>;
      file?: { name: string; mime: string; base64: string };
    };
  }): Promise<{ status: number; body: string }>;
}

const AsukaAsrProxy = registerPlugin<AsukaAsrProxyPlugin>('AsukaAsrProxy');

export default AsukaAsrProxy;
