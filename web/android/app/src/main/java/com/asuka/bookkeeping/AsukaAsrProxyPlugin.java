package com.asuka.bookkeeping;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Asuka 自定义 Capacitor 插件 — 通用 HTTP 代理（绕过 WebView CORS 限制）。
 *
 * 背景：语音识别直连阿里云百炼 DashScope（dashscope.aliyuncs.com）时，
 * WebView 的 fetch 被 CORS 策略拦截（DashScope 不返回 Access-Control-Allow-Origin）
 * → 表现为 "Failed to fetch"。原生 HttpURLConnection 不受 CORS 限制，
 * 由本插件代理请求，把 status + body 原样回传 JS。
 *
 * 支持：
 *   - GET / POST（JSON body）
 *   - multipart/form-data 上传（OSS 凭证上传 WAV 用）
 *   网络请求在后台线程执行，不阻塞 UI。
 */
@CapacitorPlugin(name = "AsukaAsrProxy")
public class AsukaAsrProxyPlugin extends Plugin {

    private static final String TAG = "AsukaAsrProxy";
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    /**
     * 通用请求代理。
     * call 参数：
     *   url: string          必填
     *   method: string       默认 GET
     *   headers: object      请求头（如 Authorization）
     *   body: string         JSON 等纯文本请求体（POST 时）
     *   form: object         multipart 表单：{ fields: {k:v}, file: { name, mime, base64 } }
     * 返回：{ status: number, body: string }
     */
    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = (call.getString("method") != null ? call.getString("method") : "GET").toUpperCase();
        final JSObject headers = call.getObject("headers");
        final String body = call.getString("body");
        final JSObject form = call.getObject("form");

        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }

        EXECUTOR.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(90000);
                conn.setInstanceFollowRedirects(true);

                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        Object v = headers.get(k);
                        if (v != null) conn.setRequestProperty(k, String.valueOf(v));
                    }
                }

                if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
                    conn.setDoOutput(true);
                    if (form != null) {
                        byte[] payload = buildMultipart(form, "----AsukaBoundary7MA4YWxkTrZu0gW");
                        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=----AsukaBoundary7MA4YWxkTrZu0gW");
                        writeAll(conn, payload);
                    } else if (body != null) {
                        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                        if (conn.getRequestProperty("Content-Type") == null) {
                            conn.setRequestProperty("Content-Type", "application/json");
                        }
                        writeAll(conn, payload);
                    }
                }

                int status = conn.getResponseCode();
                String respBody = readBody(conn, status);

                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("body", respBody);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("proxy request failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /** 拼接 multipart/form-data：fields（文本）+ 单个 file（base64 → 二进制） */
    private static byte[] buildMultipart(JSObject form, String boundary) throws JSONException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(512 * 1024);
        String b = "--" + boundary;
        byte[] CRLF = "\r\n".getBytes(StandardCharsets.UTF_8);

        JSObject fields = form.getJSObject("fields");
        if (fields != null) {
            Iterator<String> keys = fields.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                Object v = fields.get(k);
                write(out, (b + "\r\n").getBytes(StandardCharsets.UTF_8));
                write(out, ("Content-Disposition: form-data; name=\"" + k + "\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                write(out, String.valueOf(v).getBytes(StandardCharsets.UTF_8));
                write(out, CRLF);
            }
        }

        JSONObject file = form.getJSONObject("file");
        if (file != null) {
            String name = file.optString("name", "upload.wav");
            String mime = file.optString("mime", "application/octet-stream");
            String base64 = file.optString("base64", "");
            write(out, (b + "\r\n").getBytes(StandardCharsets.UTF_8));
            write(out, ("Content-Disposition: form-data; name=\"file\"; filename=\"" + name + "\"\r\n").getBytes(StandardCharsets.UTF_8));
            write(out, ("Content-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            byte[] bin = Base64.decode(base64, Base64.DEFAULT);
            write(out, bin);
            write(out, CRLF);
        }

        write(out, (b + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    private static void write(ByteArrayOutputStream out, byte[] data) {
        out.write(data, 0, data.length);
    }

    private static void writeAll(HttpURLConnection conn, byte[] payload) throws IOException {
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload);
            os.flush();
        }
    }

    private static String readBody(HttpURLConnection conn, int status) throws IOException {
        InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "";
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
