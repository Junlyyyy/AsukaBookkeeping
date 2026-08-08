// 千问语音识别直连客户端（浏览器版）— 阿里云百炼（DashScope）Paraformer 录音文件转写（HTTP 异步）
// 模型：paraformer-v2（中文识别行业领先，自带标点/ITN 数字还原）
// 流程：获取上传凭证 → OSS 上传 WAV → 提交转写任务(X-DashScope-Async) → 轮询 → 下载转录结果
// 用途：APK/离线场景下「只有语音识别时联网」，API Key 在设置页配置（存 localStorage，不硬编码）

const BASE = 'https://dashscope.aliyuncs.com';
const POLL_TIMEOUT = 90000;   // 转写任务最长等待
const POLL_INTERVAL = 2000;

/** 1. 获取 OSS 上传凭证 */
async function getUploadPolicy(apiKey: string, model: string) {
  const res = await fetch(`${BASE}/api/v1/uploads?action=getPolicy&model=${model}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`获取上传凭证失败：HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const d = await res.json();
  if (!d.data) throw new Error(`获取上传凭证失败：${JSON.stringify(d).slice(0, 200)}`);
  return d.data;
}

/** 2. 上传 WAV 到临时 OSS，返回 oss:// URL */
async function uploadToOss(policy: any, wavBlob: Blob) {
  const fileName = `asuka-${Date.now()}.wav`;
  const key = `${policy.upload_dir}/${fileName}`;
  const form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id);
  form.append('policy', policy.policy);
  form.append('Signature', policy.signature);
  form.append('key', key);
  form.append('x-oss-object-acl', policy.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.append('success_action_status', '200');
  form.append('file', new Blob([wavBlob], { type: 'audio/wav' }), fileName);
  const res = await fetch(policy.upload_host, { method: 'POST', body: form });
  const upBody = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`OSS 上传失败：HTTP ${res.status} ${upBody.slice(0, 200)}`);
  return `oss://${key}`;
}

/** 3. 提交异步转写任务，返回 task_id */
async function submitTask(apiKey: string, ossUrl: string, model: string) {
  const res = await fetch(`${BASE}/api/v1/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body: JSON.stringify({
      model,
      input: { file_urls: [ossUrl] },
      parameters: { channel_id: [0] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`提交转写任务失败：HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const d = await res.json();
  if (!d.output?.task_id) throw new Error(`提交转写任务失败：${JSON.stringify(d).slice(0, 200)}`);
  return d.output.task_id;
}

/** 4. 轮询任务直到完成，返回识别文本 */
async function pollTask(apiKey: string, taskId: string): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const res = await fetch(`${BASE}/api/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'X-DashScope-OssResourceResolve': 'enable' },
    });
    if (!res.ok) continue;
    const d = await res.json();
    const status = d.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = d.output?.results?.[0]?.transcription_url;
      if (url) {
        try {
          const r2 = await fetch(url);
          if (r2.ok) {
            const j = await r2.json();
            const text = (j.transcripts || []).map((t: any) => t.text || '').join('').trim();
            if (text) return text;
          }
        } catch { /* fallthrough */ }
      }
      return null;
    }
    if (status === 'FAILED') {
      throw new Error(`转写任务失败：${d.output?.task_metrics || JSON.stringify(d.output).slice(0, 200)}`);
    }
  }
  throw new Error('转写任务超时（90s）');
}

/**
 * 前端直连千问（百炼 Paraformer 录音文件转写）
 * @param wavBlob 16kHz 单声道 WAV
 * @param apiKey 用户配置的 DASHSCOPE_API_KEY
 * @param model 模型（默认 paraformer-v2）
 */
export async function transcribeQwenDirect(wavBlob: Blob, apiKey: string, model = 'paraformer-v2'): Promise<string> {
  const policy = await getUploadPolicy(apiKey, model);
  const ossUrl = await uploadToOss(policy, wavBlob);
  const taskId = await submitTask(apiKey, ossUrl, model);
  const text = await pollTask(apiKey, taskId);
  if (!text) throw new Error('千问语音识别未返回内容');
  return text;
}

/** 读取设置页保存的千问 Key（localStorage） */
export function getDashScopeKey(): string {
  try { return (localStorage.getItem('asuka_dashscope_key') || '').trim(); } catch { return ''; }
}

/** 保存千问 Key */
export function setDashScopeKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem('asuka_dashscope_key', key.trim());
    else localStorage.removeItem('asuka_dashscope_key');
  } catch { /* ignore */ }
}
