# OH-Senstive-Flow

一个面向 OpenHarmony / HarmonyOS ArkTS 应用的隐私分析与可视化工具。

它会读取应用源码、OpenHarmony SDK 源码和补充 CSV 数据，分析 `source`、`sink`、调用图、数据流，并生成可查看的隐私报告结果。

## 目录说明

- `input/app/`：待分析的 ArkTS 应用样例
- `input/sdk/default/openharmony/ets/`：OpenHarmony ETS SDK
- `input/csv/`：API 描述与权限映射 CSV
- `output/`：每次分析生成的结果
- `server/`：后端分析服务
- `web/`：前端可视化页面

## 快速开始

推荐在仓库根目录执行：

```bash
npm install
npm run dev
```

启动后：

- 后端默认运行在 `http://localhost:3001`
- 前端默认运行在 `http://localhost:5173`

如果 `5173` 被占用，Vite 会自动切换到其它端口。

### Docker / WSL 中访问 Web

Web 开发服务和预览服务监听 `0.0.0.0`，允许从宿主机访问。Docker 容器需要发布前端端口（例如 `-p 5173:5173`），然后在宿主机打开 `http://localhost:5173`。`npm run dev` 必须在容器中保持运行；仅构建前端不会启动 Web 服务。

前端和后端在同一个容器中运行时，前端的 `/api` 请求默认代理到该容器的 `localhost:3001`，无需单独发布后端端口。若后端在另一个容器，启动前端前设置 `API_URL=http://<后端服务名>:3001`。

固定映射到 `5173` 时，可使用 `npm -w web run dev -- --strictPort`，使端口被占用时直接报错，避免服务自动换端口而宿主机仍访问旧端口。`npm -w web run preview` 默认使用 `4173`，需要对应发布预览端口。

## `.env` 配置

在仓库根目录创建 `.env`：

```bash
cp .env.example .env
```

配置项：

```env
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=

UI_LLM_PROVIDER=
UI_LLM_API_KEY=
UI_LLM_MODEL=
UI_LLM_BASE_URL=

PRIVACY_REPORT_LLM_PROVIDER=
PRIVACY_REPORT_LLM_API_KEY=
PRIVACY_REPORT_LLM_MODEL=
PRIVACY_REPORT_LLM_BASE_URL=

LLM_TIMEOUT_MS=
```

优先级：

- CLI：`命令行参数 > .env > 默认值`
- 页面：`表单非空值 > .env > 默认值`

## 页面使用方式

1. 打开前端页面。
2. 在首页填写或选择以下输入目录：

```text
appPath: input/app/Wechat_HarmonyOS/
sdkPath: input/sdk/default/openharmony/ets/
csvDir: input/csv/
```

3. 按需填写 `maxDataflowPaths`。
4. 填写三组 LLM 配置；留空则使用 `.env`。
5. 点击开始分析，等待任务完成。
6. 在页面中查看 sinks、sources、callgraph、dataflows 和 privacy report。

## CLI 使用

查看帮助：

```bash
npm run analyze -- --help
```

基础示例：

```bash
npm run analyze -- \
  --appPath input/app/Wechat_HarmonyOS/ \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/
```

带 LLM 参数的示例：

```bash
npm run analyze -- \
  --appPath input/app/Wechat_HarmonyOS/ \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/ \
  --llmProvider Qwen \
  --llmApiKey your-qwen-api-key \
  --llmModel qwen3.5-397b-a17b \
  --uiLlmProvider Qwen \
  --uiLlmApiKey your-qwen-api-key \
  --uiLlmModel qwen3.5-27b \
  --privacyReportLlmProvider Qwen \
  --privacyReportLlmApiKey your-qwen-api-key \
  --privacyReportLlmModel qwen3.5-27b
```

## 输出结果位置

每次分析完成后，结果会写到：

```text
output/<appName>/<timestamp>/
```

常见产物包括：

- `meta.json`：本次运行的输入参数、统计信息和结构化耗时（`timing`，含 LLM 双口径耗时与截断计数）
- `sinks.json` / `sinks.csv`
- `sources.json` / `sources.csv`
- `callgraph.json`
- `dataflows.json`
- `ui_tree.json`
- `pages/index.json`
- `privacy_report.json`
- `privacy_report.txt`

旧报告的隐私链接若跳转到包含多个孤立证据节点的兜底路径，可修复指定 run：

```bash
npm -w server run repair:privacy-links -- ohbili_20261010-163249
```

该命令使用当前应用源码和已有分析路径更新链接、证据路径及索引，不调用 LLM，也不改写报告正文。只有声明证据的项目会保留单节点并提示缺少调用路径。

若隐私报告的链接统一落在应用级兜底分类，可只修复页面/功能归属：

```bash
npm -w server run repair:privacy-classification -- Wechat_HarmonyOS_20261011-160944
```

新报告会自动执行同一归属逻辑。已有路径优先沿用真实页面/功能；局部源码恢复路径通过函数范围和页面所属 struct 核对，必要时补建真实源码方法的功能分类。无法确认页面归属的声明或共享路径保留在“应用级隐私证据”。链接携带 pageId、featureId、flowId、nodeId，保留完整路径和目标节点；归属明细写入 `privacy_link_assignments.json`。此命令不重新调用 CPG 或 LLM，不改写报告正文。

修复生成逻辑后，应重新运行应用分析，并检查最新报告中每个蓝色链接的目标功能、路径、节点、连线及源码位置：

```bash
python3 scripts/audit_privacy_links.py
```

检查器会将单节点证据单独计数，遇到失效链接、孤立节点、无效连线或生成缓存源码时返回非零退出码。可用 `--output <file.json>` 保存明细。

## 评估与验收脚本

基础评估：

```bash
python3 scripts/eval_all.py
```

评估结果写入：

- `output/evaluation/permission_evaluation.csv`
- `output/evaluation/personal_info_evaluation.csv`

生成可视化验收报告：

```bash
python3 scripts/generate_html_report.py
```

执行后会生成独立的可视化 HTML 报告，可在浏览器中直接查看全指标达成与各应用要素明细：

- `output/evaluation/acceptance_report.html`
