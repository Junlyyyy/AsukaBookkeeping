# Asuka记账（Bento × EVA-02 明日香主题 + 语音记账版）测试与编译步骤

## 一、webview / 浏览器测试（当前阶段）

后端已在运行（localhost:3001），前端构建产物已挂载。直接打开：

> **http://localhost:3001**  （或 web/ 下 `npm run dev` 走 5173 开发热更新）

### 手动测试清单
| # | 测试项 | 预期 |
|---|--------|------|
| 1 | 仪表盘 7 页切换（Shell 导航） | 机体感悬浮条 + NERV 黄黑警示斜纹、bento 大小块卡片、EVA 红胶囊按钮 |
| 2 | 记账 CRUD | 流水页「+ 记一笔」新增 / 改 / 二次确认删除 |
| 3 | 一句话记账 | ⚡ 按钮 → 「昨天星巴克 38 块」自动识别分类与金额 |
| 4 | **自动抓取消费记录** | 📥 按钮 → 粘贴多条支付短信 → 解析候选 → 全部确认入账 |
| 5 | 预算 / 分类 / 账户管理 | 新增、编辑、进度环渲染 |
| 6 | 分析页 scope 切换（月/年/全部） | 趋势图、Top 排行正常 |
| 7 | 账本切换（顶部 📓 下拉） | 切换后数据联动 |
| 8 | 本地降级 | 停掉 server 后刷新，自动切 localStorage 模式仍可用 |

### 自动抓取示例文本
```
【微信支付】你于08月06日08:32在星巴克(北京朝阳店)消费38.00元
【支付宝】08月05日12:10 滴滴出行支付25.5元
【招商银行】08月04日 收到 工资转账 15000元
打车25块
```

## 二、编译 APK（用户确认 webview 效果后执行）

前置：node ≥ 22（server 用 node:sqlite）、JDK 17+、Android SDK（ANDROID_HOME 已配置）。

```bash
cd <项目根目录>/web   # 例：D:/your-projects/AsukaBookkeeping/web
npm run build                 # 1. 构建前端 → dist/
npx cap sync android          # 2. 同步到 Android 工程（拷贝 dist 至 assets/public）
cd android
./gradlew assembleDebug       # 3. 编译 Debug APK（Windows 用 gradlew.bat）
# 产物：web/android/app/build/outputs/apk/debug/app-debug.apk
```

### Release（可选，需签名）
```bash
cd web/android
./gradlew assembleRelease     # 需配置 signingConfig，或使用 Android Studio 签名
```

### 配置速查
- 包名/应用名：`web/capacitor.config.ts` → appId `com.justtrack.app`、appName `BEECOUNT`
- minSdk 24 / targetSdk 36：`web/android/variables.gradle`
- APK 内无后端 → 前端自动降级 localStorage 本地数据层（apiLocal.ts）

## 三、架构说明（本次改动）
- **UI**：Nike 风格 → Neumorphism（`web/src/styles/global.css` 全量重写 + 7 页 + Shell/ui/charts）
- **数据源**：后端对接开源 bee 记账领域模型（SQLite `server/data/beecount.db`，金额以分存储，REST `/api/v1` 对齐 BeeCount Cloud MCP 18 tool）
- **新增自动抓取**：`POST /api/v1/transactions/fetch`（解析候选不落库）+ 前端「📥 自动抓取」确认入账；本地层同步实现（apiLocal.ts）
- **移除云同步**：删除 docs/cloud-sync/ 目录、shared-ledger.md、sidebars 引用；运行时本无云同步代码

## 四、豆包大模型配置（语音 / 一句话记账解析引擎）

默认使用**本地规则解析**（无外部依赖）。要启用**豆包大模型**（识别更准、支持任意自然语言表达），在启动后端前设置环境变量：

```bash
# Windows CMD
set ARK_API_KEY=你的火山方舟APIKey
set ARK_MODEL=doubao-pro-32k    # 或你的推理接入点ID ep-xxxx
node src/index.js

# PowerShell
$env:ARK_API_KEY="你的火山方舟APIKey"
$env:ARK_MODEL="doubao-pro-32k"
node src/index.js
```

- 获取 Key：火山引擎控制台 → 方舟（ARK）→ API Key 管理（https://console.volcengine.com/ark）
- 模型：默认 `doubao-pro-32k`，也可用推理接入点 ID（ep-...）
- 启用后启动日志显示：`语言模型: 豆包大模型（火山方舟 ARK）✓`
- **未配置时自动降级规则解析**，功能不中断；接口响应 `parsed.engine` 标识 `doubao` / `rule`
- 语音记账 Modal 标题与徽章会显示「DOUBAO LLM · 火山方舟」


## 四、大模型配置（解析 + 语音识别）

### 4.1 解析引擎：DeepSeek（推荐，用你的 Key）

**DeepSeek 只做「文本 → 记账结构」解析，不能做语音识别（纯文本模型）**。设置环境变量后，一句话/语音记账解析将优先使用 DeepSeek：



启动日志显示「语言模型: DeepSeek 大模型（DeepSeek API）✓」。未配置或调用失败自动降级豆包/规则引擎，功能不中断。

### 4.2 语音识别：千问（阿里云百炼 Paraformer）

**语音识别（声音→文字）只支持联网大模型方式：千问语音识别大模型**（阿里云百炼 / Model Studio，Paraformer 系列，中文识别行业领先）。

**免费额度**：每月 **36,000 秒（10 小时）/ 阿里云账号**，每月 1 号自动刷新；超出后 **0.00008 元/秒**（约 0.29 元/小时）。

**接入方式**：Paraformer 录音文件转写（HTTP 异步）：上传凭证 → OSS 上传 → 提交任务 → 轮询 → 下载结果；已实测通过。

**配置步骤**：

1. 阿里云控制台开通「百炼 / Model Studio」服务（[bailian.console.aliyun.com](https://bailian.console.aliyun.com)）→ 创建 API Key
2. 后端启动前设置环境变量：



3. 启动日志显示「语音识别: 千问语音识别大模型 ✓ (Paraformer, 免费10h/月)」→ 前端语音 Modal 启用

**未配置时**：语音 Modal 显示红色错误提示「语音识别未启用：需在后端配置千问语音识别大模型（环境变量 DASHSCOPE_API_KEY）」——「记一笔」按钮不可用，需配置后重启。

**为何选千问而非豆包**：阿里云账号直接开通，每月 10 小时免费额度明确；千问 Paraformer 在中文识别准确率与稳定性上行业领先，是目前最实用的中文 ASR 方案。
