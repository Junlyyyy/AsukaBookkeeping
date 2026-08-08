// BEECOUNT 本地记账后端 — 入口（对接开源 bee 记账数据源 · 本地 SQLite）
// 前端/后端分离：本服务提供 REST API（端口 3001），并托管 web/ 构建产物（同端口访问）
// 接口设计对齐 BeeCount Cloud MCP（docs/mcp/intro.md 中的 18 个 tool）

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { ledgerRouter } from './routes/ledgers.js';
import { txRouter } from './routes/transactions.js';
import { miscRouter } from './routes/misc.js';
import { speechRouter } from './routes/speech.js';
import { isQwenAsrConfigured } from './ai/qwenAsr.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

// ---- 初始化 ----
initSchema();
seedIfEmpty();

import { isDoubaoConfigured } from './ai/doubao.js';
import { isDeepSeekConfigured } from './ai/deepseek.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 请求日志（开发友好）
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${req.method} ${req.path}`);
  }
  next();
});

// ---- API v1 ----
app.get('/api/v1/health', (_req, res) => res.json({ ok: true, name: 'Asuka Bookkeeping Server', time: new Date().toISOString() }));
app.use('/api/v1', ledgerRouter);
app.use('/api/v1', txRouter);
app.use('/api/v1', miscRouter);
app.use('/api/v1', speechRouter);

// 404 for unknown API
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// ---- 静态托管前端构建产物（离线单端口运行）----
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
  console.log(`[static] 前端构建产物已挂载: ${WEB_DIST}`);
} else {
  console.log('[static] web/dist 不存在 —— 仅提供 API。请先在 web/ 目录执行 npm run build（或开发时在 web/ 执行 npm run dev 使用 5173 端口）');
}

app.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`  Asuka记账 本地后端已启动（Bento × EVA-02 明日香）`);
  console.log(`  API:   http://localhost:${PORT}/api/v1`);
  console.log(`  健康:  http://localhost:${PORT}/api/v1/health`);
  console.log(`  语言模型: ${isDeepSeekConfigured() ? 'DeepSeek 大模型（DeepSeek API）✓' : isDoubaoConfigured() ? '豆包大模型（火山方舟 ARK）✓' : '规则解析（未配置 DEEPSEEK_API_KEY/ARK_API_KEY）'}`);
  console.log(`  语音识别: ${isQwenAsrConfigured() ? '千问语音识别大模型 ✓ (Paraformer, 免费10h/月)' : '未配置 DASHSCOPE_API_KEY —— 语音记账暂不可用（见 TESTING_AND_BUILD.md）'}`);
  if (existsSync(WEB_DIST)) console.log(`  应用:  http://localhost:${PORT}`);
  else console.log(`  前端:  npm --prefix web run dev  → http://localhost:5173`);
  console.log('──────────────────────────────────────────────');
});

process.on('SIGINT', () => { db.close(); process.exit(0); });
