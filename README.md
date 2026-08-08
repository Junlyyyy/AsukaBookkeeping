# Asuka记账 — 明日香主题本地记账

> 基于 [BeeCount-Website](https://github.com/TNT-Likely/BeeCount-Website) 重构：**保留后端接口设计**（对齐 BeeCount Cloud MCP 的 18 个工具），**UI 全面重写为 EVA-02 明日香主题**（Bento 布局 × 二号机红橙配色 × NERV 元素），支持**语音记账**（千问大模型识别 + DeepSeek 解析）与**自动抓取消费记录**，数据完全离线本地存储。

<div align="center">

**惣流・アスカ・ラングレー · EVA-02 PILOT** — 本地存储 · 完全离线 · 语音记账

</div>

## ✨ 特性

- 🎨 **明日香主题 UI**：EVA-02 官方红橙配色（`#d3290f` / `#e6770b`）、NERV 黄黑警示斜纹、红色发带装饰、PILOT 徽章、AT 力场等 EVA 元素；Bento 模块化网格布局；白底明日香大头像图标（rembg AI 抠图）
- 🎙️ **语音记账**：点击「记一笔」说话即可——**千问（阿里云百炼 Paraformer）联网识别**声音 → **DeepSeek / 豆包 / 规则引擎**解析金额/分类/时间 → 自动入账
- 📥 **自动抓取消费记录**：粘贴微信/支付宝支付短信、银行交易详情（可多行），自动识别金额/商家/时间/分类，确认后批量入账
- ⚡ **一句话记账**：自然语言解析「昨天星巴克咖啡 38 块」直接入账（DeepSeek 大模型优先，规则引擎兜底）
- 💾 **本地数据存储**：SQLite（`server/data/beecount.db`），零云依赖，断网可用；APK 内自动降级 localStorage
- 📱 **多端适配**：桌面 / 手机 / 小米15 竖屏横屏自适应，安全区（挖孔+虚拟按键）处理
- 🔍 **流水筛选二级页**：首屏紧凑，完整筛选（类型/分类/账户/标签/日期/金额/关键词）收纳进 Modal
- 🏗️ **前后端分离架构**：`server/`（Express + SQLite）与 `web/`（Vite + React + TS）独立目录

## 🚀 快速开始

要求：Node.js **≥ 22.5**（使用内置 `node:sqlite`，无需任何原生编译依赖）

```bash
# 1. 安装后端依赖
cd server && npm install && cd ..

# 2. 安装前端依赖并构建
cd web && npm install && npm run build && cd ..

# 3. 启动（后端 :3001，同时托管前端）
cd server && npm start
```

打开 **http://localhost:3001** 即可使用。首次启动自动写入演示数据（2 个账本、17 个分类、6 个账户、近 90 天交易、预算）。

### 开发模式（前后端分离热更新）

```bash
# 终端 1：后端 API
cd server && npm run dev        # → http://localhost:3001/api/v1

# 终端 2：前端 dev server（Vite 代理 /api → 3001）
cd web && npm run dev           # → http://localhost:5173
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `cd server && npm start` | 启动后端 + 托管前端（生产） |
| `cd server && npm run dev` | 后端热重载 |
| `cd server && npm run reset` | 重置数据库（删除后重启自动重建演示数据） |
| `cd web && npm run dev` | 前端开发服务器 |
| `cd web && npm run build` | 前端构建 → `web/dist/` |

## 🎙️ 语音与大模型配置

语音记账分两段：**识别（声音→文字）** + **解析（文字→记账结构）**。

### 语音识别：千问（阿里云百炼 Paraformer）

每月 **10 小时免费额度**，中文识别行业领先，内置数字还原（「三十八块」→「38块」）。

```bash
set DASHSCOPE_API_KEY=你的阿里云百炼API Key
set QWEN_ASR_MODEL=paraformer-v2   # 录音文件转写模型（默认）
cd server && node src/index.js
```

- 申请：https://bailian.console.aliyun.com → 创建 API Key
- 启动日志显示 `语音识别: 千问语音识别大模型 ✓` 即启用
- 未配置时语音 Modal 显示红色错误提示（语音记账暂不可用，其余功能正常）

### 解析引擎：DeepSeek（推荐）→ 豆包 → 规则引擎

```bash
set DEEPSEEK_API_KEY=你的DeepSeek开放平台API Key   # 首选，识别最准
set DEEPSEEK_MODEL=deepseek-chat                    # 或 deepseek-v4-flash / deepseek-v4-pro

# 备用（可选）：
# set ARK_API_KEY=你的火山方舟API Key
# set ARK_MODEL=doubao-pro-32k
```

- 未配置任何大模型时自动降级**本地规则引擎**（正则解析，无需外部依赖），功能不中断
- 接口响应 `parsed.engine` 标识 `deepseek` / `doubao` / `rule`

## 🔌 接口设计（保留自 BeeCount MCP，18 工具）

| BeeCount MCP 工具 | 本应用 REST API | 说明 |
|---|---|---|
| `list_ledgers` / `get_active_ledger` | `GET /api/v1/ledgers` / `GET /api/v1/ledgers/active` | 账本列表 / 当前账本 |
| `list_transactions` | `GET /api/v1/transactions` | 筛选：日期/分类/账户/关键词/金额区间/类型/标签 |
| `get_transaction` | `GET /api/v1/transactions/:id` | 单笔详情 |
| `list_categories` | `GET /api/v1/categories?type=` | 分类（expense/income 筛选） |
| `list_accounts` | `GET /api/v1/accounts?type=` | 账户（现金/银行卡/信用卡等） |
| `list_tags` | `GET /api/v1/tags` | 标签 |
| `list_budgets` | `GET /api/v1/budgets` | 预算 + **当月已用进度** |
| `get_ledger_stats` | `GET /api/v1/ledgers/:id/stats` | 账本统计 |
| `get_analytics_summary` | `GET /api/v1/analytics?scope=month\|year\|all` | 收支/Top 分类/每日趋势 |
| `search` | `GET /api/v1/search?q=` | 模糊搜备注/分类/账户 |
| `create_transaction` | `POST /api/v1/transactions` | 新建交易 |
| `create_transactions` | `POST /api/v1/transactions/batch` | 批量新建 |
| `update_transaction` | `PATCH /api/v1/transactions/:id` | 只改传入字段 |
| `delete_transaction` | `DELETE /api/v1/transactions/:id` | **二次确认**：首次返回待确认，带 `?confirm=1` 真删 |
| `create_category` | `POST /api/v1/categories` | 新建分类 |
| `update_budget` | `PATCH /api/v1/budgets/:id` | 改预算金额 |
| `parse_and_create_from_text` | `POST /api/v1/transactions/parse` | 自然语言/语音文本记账 |
| —（扩展） | `POST /api/v1/transactions/fetch` | **自动抓取**：解析支付短信候选（不落库） |
| —（扩展） | `POST /api/v1/speech/transcribe` | **语音识别**：WAV → 千问 → 文字 |
| —（扩展） | `PUT /api/v1/ledgers/:id/active` 等 | 账本切换/增删辅助 |

**数据模型**：`ledgers` / `accounts` / `categories` / `tags` / `transactions` / `transaction_tags` / `budgets`，金额一律以**分**（整数）存储，API 输入输出为元。

## 📁 目录结构

```
BeeCount-Website/
├── server/                  # 后端（Express + node:sqlite）
│   ├── src/
│   │   ├── index.js         # 入口：API + 托管前端产物 + 引擎状态日志
│   │   ├── db.js            # SQLite 初始化 + 数据模型
│   │   ├── seed.js          # 演示数据
│   │   ├── reset.js         # 重置数据库
│   │   ├── ai/
│   │   │   ├── deepseek.js  # DeepSeek 文本解析（首选）
│   │   │   ├── doubao.js    # 豆包文本解析（备用）
│   │   │   └── qwenAsr.js   # 千问语音识别（上传→转写→轮询）
│   │   └── routes/
│   │       ├── ledgers.js   # 账本/账户/分类/标签 + stats
│   │       ├── transactions.js # 交易 CRUD + 批量 + 二次确认删除 + 解析 + 自动抓取
│   │       ├── speech.js    # 语音识别代理（千问）
│   │       └── misc.js      # 预算/统计/搜索
│   ├── .env                 # 本地环境变量（API Key，不入库）
│   └── data/beecount.db     # 本地数据库（运行时生成）
├── web/                     # 前端（Vite + React + TS，明日香主题）
│   └── src/
│       ├── pages/           # 仪表盘/流水/分析/预算/分类/账户/设置
│       ├── components/      # Swoosh 图标/NERVBadge/图表(自绘SVG)/Shell/VoiceRecorder
│       ├── lib/voice.ts     # 语音采集（AudioContext 16k PCM → WAV 上传）
│       └── styles/          # 明日香设计系统（EVA 色板/NERV 元素）
├── web/android/             # Capacitor Android 壳（cap sync + gradlew 编译 APK）
├── start.js                 # 一键启动（自动安装依赖+构建+运行）
├── docs/                    # 原站文档（接口设计来源 docs/mcp/intro.md）
└── README.md
```

> 说明：顶层其余文件（`docusaurus.config.ts` / `i18n/` / `src/` / `static/` / `scripts/` / `data/` / `sidebars.ts` 等）为原仓库 Docusaurus 官网/文档站部分，**原样保留作为项目基础**；本应用的运行与它们无关，仅使用 `server/` + `web/` + `docs/`。

## 📦 编译 APK（Android）

前置：node ≥ 22、JDK 17+、Android SDK（ANDROID_HOME 已配置）

```bash
cd web
npm run build                 # 1. 构建前端 → dist/
npx cap sync android          # 2. 同步到 Android 工程
cd android
./gradlew assembleDebug       # 3. 编译 Debug APK（Windows 用 gradlew.bat）
# 产物：web/android/app/build/outputs/apk/debug/app-debug.apk
```

- 包名 `com.asuka.bookkeeping`、应用名 `Asuka记账`（`web/capacitor.config.ts`）
- APK 内无后端 → 前端**自动降级 localStorage** 本地数据层，离线记账与自动抓取均可用
- 语音识别需联网（千问），APK 内通过后端配置 `DASHSCOPE_API_KEY` 启用

## 📖 关于「保留后端接口设计」

原仓库 `BeeCount-Website` 是官网/文档站（纯 Docusaurus 静态站），业务后端实现在独立的 `BeeCount-Cloud` 仓库。其**接口设计**完整定义于 `docs/mcp/intro.md`（18 个 MCP 工具）。本应用据此重新实现了本地后端：**数据模型、工具语义、筛选参数、二次确认删除、scope 划分等接口契约全部对齐**，但存储从云端服务切换为本地 SQLite，实现完全离线可用。

## 📄 License

MIT — 本重构版用于个人学习与记账（明日香形象为《新世纪福音战士》版权角色，仅限个人非商用）。
