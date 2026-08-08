# JUST TRACK — Nike 风格本地记账

> 基于 [BeeCount-Website](https://github.com/TNT-Likely/BeeCount-Website) 重构：**保留后端接口设计不变**（对齐 BeeCount Cloud MCP 的 18 个工具），**前端 UI 完全重写为 Nike 品牌风格**（黑白色调 / 锐利斜切 / 运动设计语言），全新本地记账 Web 应用。

<div align="center">

**JUST DO IT.** — 本地存储 · 完全离线 · 前后端分离

</div>

## ✨ 特性

- 🏗️ **前后端分离架构**：`server/`（Express + SQLite）与 `web/`（Vite + React + TS）独立目录
- 🔌 **接口设计不变**：18 个 API 与 BeeCount 的 MCP 工具一一对应（账本/交易/分类/账户/标签/预算/统计/搜索），见下方映射表
- ⚡ **一句话记账**：自然语言解析「昨天星巴克咖啡 38 块」直接入账（本地规则引擎，无需外部 AI）
- 💾 **本地数据存储**：SQLite（`server/data/beecount.db`），零云依赖，断网可用
- 🖤 **Nike 设计语言**：纯黑白高对比、巨型粗体排版、斜切角（notched）元素、SWOOSH 勾形、运动感标语
- 🚀 **一键运行**：`npm run start` 单命令启动，后端同时托管前端构建产物

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
| `parse_and_create_from_text` | `POST /api/v1/transactions/parse` | 自然语言记账 |
| —（扩展） | `PUT /api/v1/ledgers/:id/active` 等 | 账本切换/增删辅助 |

**数据模型**：`ledgers` / `accounts` / `categories` / `tags` / `transactions` / `transaction_tags` / `budgets`，金额一律以**分**（整数）存储，API 输入输出为元。

## 📁 目录结构

```
BeeCount-Website/
├── server/                  # 后端（Express + node:sqlite，接口对齐 BeeCount MCP）
│   ├── src/
│   │   ├── index.js         # 入口：API + 托管前端产物
│   │   ├── db.js            # SQLite 初始化 + 数据模型
│   │   ├── seed.js          # 演示数据
│   │   ├── reset.js         # 重置数据库
│   │   └── routes/
│   │       ├── ledgers.js   # 账本/账户/分类/标签 + stats
│   │       ├── transactions.js # 交易 CRUD + 批量 + 二次确认删除 + 解析
│   │       └── misc.js      # 预算/统计/搜索
│   └── data/beecount.db     # 本地数据库（运行时生成）
├── web/                     # 前端（Vite + React + TS，Nike 风格重写）
│   └── src/
│       ├── pages/           # 仪表盘/流水/分析/预算/分类/账户/设置
│       ├── components/      # Swoosh/图表(自绘SVG)/Shell/UI
│       └── styles/          # Nike 设计系统
├── start.js                 # 一键启动（自动安装依赖+构建+运行）
├── docs/                    # 保留的原站文档（接口设计来源 docs/mcp/intro.md）
└── README.md
```

> 说明：顶层其余文件（`docusaurus.config.ts` / `i18n/` / `src/` / `static/` / `scripts/` / `data/` / `sidebars.ts` 等）为原仓库 Docusaurus 官网/文档站部分，**原样保留作为项目基础**；本应用的运行与它们无关，仅使用 `server/` + `web/` + `docs/`。

## 📖 关于「保留后端接口设计」

原仓库 `BeeCount-Website` 是官网/文档站（纯 Docusaurus 静态站），业务后端实现在独立的 `BeeCount-Cloud` 仓库。其**接口设计**完整定义于 `docs/mcp/intro.md`（18 个 MCP 工具）。本应用据此重新实现了本地后端：**数据模型、工具语义、筛选参数、二次确认删除、scope 划分等接口契约全部对齐**，但存储从云端服务切换为本地 SQLite，从而实现离线可用。

## 📄 License

MIT © 原项目 TNT-Likely · 本重构版用于学习与个人记账
