# 简明使用指南

OH-Senstive-Flow 用于分析 OpenHarmony 应用中的敏感 API、权限、个人信息、调用关系和数据流，并生成自然语言隐私声明报告。

## 1. 环境准备

在仓库根目录安装依赖：

```bash
npm install
```

确认以下输入目录存在：

```text
input/app/                         待分析应用
input/sdk/                         OpenHarmony SDK
input/csv/                         API、权限和隐私规则
```

## 2. 配置 LLM

从示例创建本地配置：

```bash
cp .env.example .env
```

至少填写所使用服务的 API Key。三组配置分别用于数据流、UI 描述和隐私报告：

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

## 3. 分析一个应用

以 `Wechat_HarmonyOS` 为例：

```bash
npm run analyze -- \
  --appPath input/app/Wechat_HarmonyOS/ \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/ \
  --graphBackend cpg
```

分析完成后，结果位于：

```text
output/Wechat_HarmonyOS/<时间戳>/
```

## 4. 使用可视化页面

启动后端和前端：

```bash
npm run dev
```

默认访问：

```text
前端：http://localhost:5173
后端：http://localhost:3001
```

在首页填写应用、SDK 和 CSV 目录，点击开始分析。分析完成后可查看 sinks、sources、调用图、数据流、页面功能点和隐私声明报告。

## 5. 批量分析样例应用

```bash
MAX_PARALLEL=3 bash scripts/analyze_all_apps.sh
```

## 6. 运行评估

批量分析完成后执行：

```bash
python3 scripts/eval_all.py
```

生成：

```text
output/evaluation/permission_evaluation.csv
output/evaluation/personal_info_evaluation.csv
```

CSV 中包含覆盖率、误报率和要素完整度。应用的 ground truth 为空时，对应指标显示为 `N/A`。

## 7. 查看主要产物

每次运行目录中的主要文件：

| 文件 | 用途 |
|---|---|
| `meta.json` | 输入参数、模型和分析规模统计 |
| `sinks.json` / `sinks.csv` | 敏感 API 调用 |
| `sources.json` / `sources.csv` | 数据流入口和页面入口 |
| `cpg.json` | CPG 代码图 |
| `callgraph.json` | 函数调用图 |
| `dataflows.json` | 全应用数据流 |
| `ui_tree.json` | 全应用 UI 结构 |
| `pages/index.json` | 页面与功能点索引 |
| `privacy_report.json` | 结构化隐私声明 |
| `privacy_report.txt` | 可直接阅读的隐私声明文本 |
