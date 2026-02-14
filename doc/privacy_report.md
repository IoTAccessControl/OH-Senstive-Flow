# 隐私声明报告（Privacy Report）实现说明

本仓库在原有的 **sink/source/callgraph/dataflows + UI Tree + Page/Feature 分层** 分析结果基础上，新增了：

1. **功能点（Feature）级隐私要素抽取（Step2）**：对每个页面功能点的数据流进行结构化抽取，并把结果落盘到 Feature 目录；
2. **最终隐私声明报告生成（Step3）**：基于 Step2 的多个功能点抽取结果，使用 LLM 生成最终自然语言隐私声明报告（严格两章，段落组织，无列表）；
3. **前端跳转定位**：在隐私声明报告页面点击关键文字要素（数据项/权限名称）可跳转到数据流可视化并定位到具体节点。

> 安全：所有 api-key 都只在请求过程中使用，不会写入 `output/` 目录、也不会写入前端的 sessionStorage。

---

## 1. 首页输入项

文件：`web/src/pages/Home.tsx`

新增 3 个输入项：

- 生成隐私声明报告的 LLM 提供商名称（默认 `Qwen`）
- 生成隐私声明报告的 LLM 提供商 api-key（默认空；密码框；不会写入输出）
- 生成隐私声明报告的模型名称（默认 `qwen3-32b`）

这些参数会随 `/api/analyze` 一起提交给后端；其中 provider/model 会保存到前端 sessionStorage 的分析快照中（便于刷新后保留），api-key 不保存。

---

## 2. Step2：功能点（Feature）级隐私要素抽取（落盘文件）

后端入口：`server/src/analyzer/runAnalysis.ts`（调用 `privacyReport/generatePrivacyReportArtifacts.ts`）  
实现目录：`server/src/analyzer/privacyReport/`

### 2.1 输入证据

对每个 Feature（含 `_unassigned` 页面下的 Feature）读取：

- `output/<appName>/<timestamp>/pages/<pageId>/features/<featureId>/dataflows.json`
- `output/<appName>/<timestamp>/pages/<pageId>/ui_tree.json`（若存在，用于定位“隐私功能在哪个界面开关”）
- `output/<appName>/<timestamp>/pages/index.json` 与 `pages/<pageId>/features/index.json` 中的页面/功能点元信息

并构造精简 prompt（会对 flows/nodes 做截断，避免 prompt 过大）。

### 2.2 输出结构（每 Feature 一个文件）

写入：

`output/<appName>/<timestamp>/pages/<pageId>/features/<featureId>/privacy_facts.json`

其中：
- `facts.dataPractices[].dataItems[].refs`
- `facts.permissionPractices[].refs`

会尽量引用 **该 Feature dataflows 中真实存在的** `{flowId,nodeId}`，用于前端跳转定位。

如果缺少 api-key 或 Feature 数据流为空，则生成 `skipped=true` 的占位文件，并记录原因。

---

## 3. Step3：最终隐私声明报告生成（两章、段落组织、无列表）

写入：

- `output/<appName>/<timestamp>/privacy_report.json`：前端渲染 + token 可点击跳转（含 jumpTo refs）
- `output/<appName>/<timestamp>/privacy_report.txt`：纯文本版本（严格两章，段落用空行分隔）

报告大纲固定为：

```
1 我们如何收集和使用您的个人信息
（多个功能点段落）

2 设备权限调用
（多个功能点段落）
```

> 服务端固定写章节标题，LLM 只负责为每个功能点生成“段落 tokens”，从而避免产生额外章节。

---

## 4. 前端：报告页与点击跳转

### 4.1 报告页

文件：`web/src/pages/PrivacyReport.tsx`

路由：`/privacy-report?runId=<runId>`

页面会调用：

- `GET /api/results/privacy_report?runId=...`

并渲染两章段落内容。段落内部使用 `tokens[]` 顺序拼接成自然语言文本；当 token 含有 `jumpTo` 时，文本可点击。

### 4.2 跳转到数据流具体节点

点击 token 会跳转到：

`/dataflows?runId=<runId>&featureId=<featureId>&flowId=<flowId>&nodeId=<nodeId>`

数据流页面（`web/src/pages/Dataflows.tsx`）会读取这些 query 参数并自动选中：

- 对应页面功能（Feature；必要时会从索引中反查所属 Page）
- 对应路径（flowId）
- 对应节点（nodeId，高亮并自动滚动到可见区域）

---

## 5. API 与类型增量

- `web/src/api.ts`：`AnalyzeParams` 增加 `privacyReportLlmProvider/privacyReportLlmApiKey/privacyReportLlmModel`；新增 `fetchPrivacyReport()`
- `server/src/index.ts`：新增 `GET /api/results/privacy_report`
- `server/src/index.ts`：新增 `GET /api/results/pages`、`GET /api/results/pages/:pageId/features`、`GET /api/results/pages/:pageId/features/:featureId/dataflows`
- `server/src/analyzer/types.ts`：`AnalyzeRequest` 增加隐私报告 LLM 字段
