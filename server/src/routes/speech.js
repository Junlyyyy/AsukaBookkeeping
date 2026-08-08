// 语音识别代理 — 联网大模型方式：千问（阿里云百炼 Paraformer）语音识别
// 前端录音（16k 单声道 WAV）→ 本接口 → 千问百炼一句话识别（HTTP 同步）→ {text}
// 免费额度：36,000 秒/月（阿里云账号）；需配置 DASHSCOPE_API_KEY；未配置返回 503，前端给出明确提示

import { Router } from 'express';
import express from 'express';
import { transcribeWavQwen, isQwenAsrConfigured } from '../ai/qwenAsr.js';

export const speechRouter = Router();

/** GET /speech/health — 千问语音识别是否已配置（前端据此启用语音入口） */
speechRouter.get('/speech/health', (_req, res) => {
  const ok = isQwenAsrConfigured();
  res.json({ ok, engine: ok ? 'qwen-asr' : null });
});

/** POST /speech/transcribe — 接收 WAV 字节 → 千问语音识别 → { text, engine, duration_ms } */
speechRouter.post(
  '/speech/transcribe',
  express.raw({ type: ['audio/wav', 'audio/webm', 'audio/ogg', 'application/octet-stream'], limit: '10mb' }),
  async (req, res) => {
    if (!isQwenAsrConfigured()) {
      return res.status(503).json({
        error: '未配置千问语音识别（DASHSCOPE_API_KEY）。请设置环境变量后重启：\nset DASHSCOPE_API_KEY=你的阿里云百炼API Key',
      });
    }
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'empty audio body' });
    }
    const t0 = Date.now();
    try {
      const r = await transcribeWavQwen(Buffer.from(req.body));
      res.json({ ...r, duration_ms: Date.now() - t0 });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  },
);
