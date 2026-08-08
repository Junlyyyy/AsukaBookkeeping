// 千问语音识别大模型客户端 — 阿里云百炼（DashScope / Model Studio）Paraformer 录音文件转写（HTTP 异步）
// 模型：paraformer-v2（中文识别行业领先，自带标点/ITN 数字还原）
// 流程：获取上传凭证 → OSS 上传本地 WAV → 提交转写任务(X-DashScope-Async) → 轮询任务 → 下载转录结果
// 免费额度：36,000 秒（10 小时）/ 阿里云账号 / 月；超出后 0.00008 元/秒
// 配置：环境变量 DASHSCOPE_API_KEY（必选，阿里云百炼 API Key）
//       环境变量 QWEN_ASR_MODEL（可选，默认 paraformer-v2）

const BASE = 'https://dashscope.aliyuncs.com';
const ASR_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const ASR_MODEL = process.env.QWEN_ASR_MODEL || 'paraformer-v2';
const POLL_TIMEOUT = 90000;   // 转写任务最长等待
const POLL_INTERVAL = 2000;

/** 千问语音识别是否已配置（有 API Key 即视为可用） */
export function isQwenAsrConfigured() {
  return Boolean(ASR_API_KEY);
}

/** 1. 获取 OSS 上传凭证 */
async function getUploadPolicy() {
  const res = await fetch(`${BASE}/api/v1/uploads?action=getPolicy&model=${ASR_MODEL}`, {
    headers: { 'Authorization': `Bearer ${ASR_API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[qwen-asr] getPolicy HTTP ${res.status}: ${body.slice(0, 300)}`);
    throw new Error(`获取上传凭证失败：HTTP ${res.status}`);
  }
  const d = await res.json();
  if (!d.data) throw new Error(`获取上传凭证失败：${JSON.stringify(d).slice(0, 200)}`);
  return d.data;
}

/** 2. 上传 WAV 到临时 OSS，返回 oss:// URL */
async function uploadToOss(policy, wavBuffer) {
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
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), fileName);
  const res = await fetch(policy.upload_host, { method: 'POST', body: form });
  const upBody = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`[qwen-asr] oss upload HTTP ${res.status}: ${upBody.slice(0, 300)}`);
    throw new Error(`OSS 上传失败：HTTP ${res.status}`);
  }
  console.log(`[qwen-asr] upload ok ${res.status} | key=${key}`);
  return `oss://${key}`;
}

/** 3. 提交异步转写任务，返回 task_id */
async function submitTask(ossUrl) {
  const res = await fetch(`${BASE}/api/v1/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ASR_API_KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body: JSON.stringify({
      model: ASR_MODEL,
      input: { file_urls: [ossUrl] },
      parameters: { channel_id: [0] },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[qwen-asr] submit HTTP ${res.status}: ${body.slice(0, 300)}`);
    throw new Error(`提交转写任务失败：HTTP ${res.status}`);
  }
  const d = await res.json();
  if (!d.output?.task_id) throw new Error(`提交转写任务失败：${JSON.stringify(d).slice(0, 200)}`);
  return d.output.task_id;
}

/** 4. 轮询任务直到完成，返回识别文本 */
async function pollTask(taskId) {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const res = await fetch(`${BASE}/api/v1/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${ASR_API_KEY}`, 'X-DashScope-OssResourceResolve': 'enable' },
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
            const text = (j.transcripts || []).map((t) => t.text || '').join('').trim();
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
 * 调用千问（百炼 Paraformer 录音文件转写）将 WAV 转写为文本
 * @param {Buffer} wavBuffer 16kHz 单声道 WAV
 * @returns {Promise<{text: string, engine: 'qwen-asr'}>}
 */
export async function transcribeWavQwen(wavBuffer) {
  if (!ASR_API_KEY) {
    const e = new Error('未配置千问语音识别（DASHSCOPE_API_KEY）');
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  const policy = await getUploadPolicy();
  const ossUrl = await uploadToOss(policy, wavBuffer);
  console.log(`[qwen-asr] ossUrl=${ossUrl} | wav=${wavBuffer.length}B | upload_dir=${policy.upload_dir}`);
  const taskId = await submitTask(ossUrl);
  const text = await pollTask(taskId);
  if (!text) throw new Error('千问语音识别未返回内容');
  return { text, engine: 'qwen-asr' };
}
