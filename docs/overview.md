# 项目功能与处理流程（OH-Senstive-Flow）

本仓库是一个「隐私声明报告生成工具」：对 OpenHarmony / ArkTS 应用做静态分析，识别与隐私/权限相关的 **sources（入口）**、**sinks（敏感 API 调用点）**，构建 **调用图（CallGraph）** 与 **数据流（DataFlows）**，并在此基础上生成可点击跳转的 **隐私声明报告**，同时提供 Web 可视化界面用于检索与定位证据链。

> 文档依据当前仓库实现整理，主要参考：`server/src/analyzer/runAnalysis.ts`（核心流水线）、`server/src/index.ts`（API）、`web/src/pages/*`（前端页面）。

---

## 1. 仓库组成与总体架构

该仓库是一个 Node.js monorepo（workspace）：

- `server/`：后端服务（Express + TypeScript）
  - 提供分析入口 `POST /api/analyze` 与任务制入口 `POST /api/analyze/jobs`（带 SSE 进度）
  - 读取/写入 `output/` 下的分析产物，并通过 `GET /api/results/*` 暴露给前端
- `web/`：前端工程（React + Vite + TypeScript）
  - 配置输入路径与 LLM 参数，触发后端分析
  - 可视化 sinks / sources / 调用图 / 数据流
  - 展示隐私声明报告，并支持从报告 token 跳转到数据流节点
- `input/`：分析输入的默认目录（建议把待分析工程/SDK/CSV 放这里）
  - `input/app/`：待分析的 App 工程（ArkTS）
  - `input/sdk/`：OpenHarmony SDK 源码（用于解析 `@ohos.*` / `@kit.*` 导入与 API）
  - `input/csv/`：SDK API 补充信息 CSV（用于给 sink API 补上权限/数据项/行为描述等）
- `output/`：分析结果输出目录（每次运行一个独立 run，写入一组 JSON/CSV + 报告）
  - `output/_runs/`：runId 注册表（历史 runs + latest）

---

## 2. 输入是什么（会被如何读取）

分析请求的核心输入来自 `POST /api/analyze`（或 jobs 版本）。参数结构见：

- 后端：`server/src/analyzer/types.ts`（`AnalyzeRequest`）
- 前端：`web/src/api.ts`（`AnalyzeParams`）

### 2.1 路径类输入

- `appPath`：App 源码路径（目录）
  - 既可传 **绝对路径**，也可传 **相对仓库根目录**的路径
  - 后端会只扫描 `entry/src/main/ets`（见 `server/src/analyzer/appScanner.ts`），并且只读 `.ets` 与 `.ts`
- `sdkPath`：OpenHarmony SDK 源码路径（目录）
  - 用于识别 `import ... from '@ohos.xxx' / '@kit.xxx'` 的绑定关系与 API 定位
- `csvDir`：CSV 目录（目录）
  - 用于补全 sink API 的“敏感行为/权限/数据项”等描述信息

默认值（后端 `server/src/analyzer/defaults.ts`）：

- `appPath`: `input/app/Wechat_HarmonyOS/`
- `sdkPath`: `input/sdk/default/openharmony/ets/`
- `csvDir`: `input/csv/`

> 后端会对 `appPath/sdKPath/csvDir` 做存在性与可访问性校验（`runAnalysis()` 的 “校验输入路径” 阶段）。

### 2.2 分析参数（LLM 与路径数量）

- `maxDataflowPaths`：从调用图中抽取的 “source → sink” 路径数量上限
  - 越大代表会让 LLM 分析更多路径（更慢、成本更高）
- LLM 配置分为 **三套**（互相独立）：
  1. `llmProvider / llmApiKey / llmModel`
     - 用于 **数据流（DataFlows）** 生成（强依赖）
     - 也会被用于 **调用图中中间函数节点的描述补全**（可选、best-effort）
  2. `uiLlmProvider / uiLlmApiKey / uiLlmModel`
     - 用于 **UI 树节点的“面向用户标题”生成**（可选；没 key 会用启发式标题/兜底描述）
  3. `privacyReportLlmProvider / privacyReportLlmApiKey / privacyReportLlmModel`
     - 用于 **功能点隐私要素抽取** 与 **隐私声明报告生成**（缺 key 会跳过并输出占位报告）

> 该项目的 LLM 调用是 “OpenAI-compatible” 风格（见 `server/src/llm/openaiCompatible.ts`），provider 对应的 baseUrl 列表由 `server/src/llm/provider.ts` 解析。

### 2.3 CSV 文件格式（用于补全 sink 描述）

后端会遍历 `csvDir` 下所有 `.csv`，仅对 **包含 `相关API` 列**的 CSV 生效（见 `server/src/analyzer/csvSupplement.ts`）。

当前仓库 `input/csv/` 的典型文件：

- `sdk_api_and_permission.csv`
  - 关键列：`敏感行为`、`行为子项`、`相关API`、`相关权限`、`敏感数据项`、`敏感数据子项`
  - 会把这些字段拼成 `API功能描述`，例如：`敏感行为 / 子项; 权限: ...; 数据: ...`
- `sdk_api_description_override.csv`
  - 覆盖表（见 `server/src/analyzer/overrideCsv.ts`）
  - 列：`api, description`，用于对指定 API 直接覆盖描述（优先级高）
- `risk_level.csv`
  - 当前代码中 **未直接读取**（仓库可能用于后续扩展），不会影响本次分析结果

---

## 3. 输入经过哪些处理流程（runAnalysis 阶段说明）

分析主入口：`server/src/analyzer/runAnalysis.ts`，其内部按阶段推进（`ANALYZE_STAGES`）：

### 阶段 1：校验输入路径

- 将 `appPath/sdKPath/csvDir` 统一处理为带尾 `/` 的路径
- 相对路径会按 `repoRoot`（仓库根）转成绝对路径
- 校验三者均为可访问目录（否则直接报错）

### 阶段 2：准备输出目录（runId 与输出目录命名）

- `runId = <AppName>_<YYYYMMDD-HHMMSS>`（时间戳格式见 `server/src/analyzer/time.ts`）
- 输出目录：`output/<AppName>/<YYYYMMDD-HHMMSS>/`

同一个 AppName 的不同 run 会落在不同时间戳目录下，不会互相覆盖。

### 阶段 3：构建 SDK 索引

- 读取 SDK 源码，构建可检索的 module/index（`server/src/analyzer/sdkIndexer.ts`）
- 用于后续 sink 分析中解析 import 绑定、kit re-export 等

### 阶段 4：扫描 App ArkTS 文件

- 扫描范围：`<appPath>/entry/src/main/ets/`（见 `DEFAULT_APP_SCAN_SUBDIR`）
- 文件类型：`.ets` 与 `.ts`
- 忽略目录：`node_modules/.git/build/dist/out`

实现见：`server/src/analyzer/appScanner.ts` + `server/src/analyzer/walk.ts`

### 阶段 5：加载 CSV 补充描述

- 从 `csvDir` 解析 `相关API → 描述` 的映射（`csvSupplement.ts`）
- 加载覆盖表 `sdk_api_description_override.csv`（`overrideCsv.ts`）

### 阶段 6：分析 sinks（敏感 API 调用点）

实现：`server/src/analyzer/sinkAnalyzer.ts`

核心逻辑（概念级）：

1. 使用 TypeScript AST 解析每个 App 文件
2. 提取 `@ohos.* / @kit.*` 的 import 绑定（`imports.ts`）
3. 在源码中寻找对应绑定的调用点（direct/method/new 等）
4. 解析 re-export（`kitResolver.ts`），得到更稳定的 API key（如 `@ohos.xxx.yyy`）
5. 结合 CSV/override 补齐 `API功能描述`

输出的每一条 sink 记录包含：

- `App源码文件路径`、`导入行号/导入代码`、`调用行号/调用代码`、`API功能描述`

### 阶段 7：分析 sources（入口/生命周期函数）

实现：`server/src/analyzer/sourceAnalyzer.ts` + `server/src/analyzer/defaults.ts`

当前 sources 主要覆盖：

- ArkUI `build()`
- 组件/页面生命周期（`aboutToAppear/onPageShow/...`）
- UIAbility 生命周期（`onCreate/onForeground/...`）

这些 source 会作为调用图的起点，用于寻找 “从 UI/生命周期触发到敏感 API 的路径”。

### 阶段 8：构建调用图（CallGraph）

实现：`server/src/analyzer/callGraph/buildCallGraph.ts`

主要产物：

- 节点类型：`source` / `function` / `sinkCall`
- 边类型：`calls` / `containsSink`

构图思路（概念级）：

- 从 App 文件中扫描函数块（`functionBlocks.ts`），并用 token 扫描识别调用关系
- sinkCall 节点来自上一阶段 sinks 的 “调用行号”
- source 节点来自上一阶段 sources 的 “函数定义行”
- 最后会做一次裁剪：只保留处于某条 “source → sinkCall 可达路径” 上的节点与边

LLM 的使用方式：

- 若 `llmApiKey` 非空，会 **best-effort** 补全中间函数节点的中文描述（不影响图结构；失败会自动忽略）

### 阶段 9：抽取 source→sink 路径集合

实现：`server/src/analyzer/callGraph/extractPaths.ts`

- 从调用图中抽取有限条路径（上限由 `maxDataflowPaths` 控制）
- 每条路径后续会作为 LLM 数据流分析的锚点输入

### 阶段 10：生成数据流（DataFlows，LLM）

实现：`server/src/analyzer/dataflow/buildDataflows.ts`

输入：

- 调用图路径锚点（CallGraph Path）
- sink 详细信息（API key + 描述）
- source 说明
- 相关源码片段（按锚点行号截取上下文）

输出（每条 flow）：

- `nodes[]`：数据流节点（每个节点包含文件、行号、代码、中文描述、上下文）
- `edges[]`：节点之间的流转关系
- `summary`：LLM 归纳的隐私要素（数据项、权限、是否上云、存储/加密、收集频率等）

容错：

- 若 LLM 调用失败，后端会返回一个 `meta.skipped=true` 的空结果，并带 `skipReason`（见 `runAnalysis.ts` 的 try/catch）

### 阶段 11：生成 UI 树（启发式/LLM）

实现：`server/src/analyzer/uiTree/buildUiTree.ts`

主要做两件事：

1. **页面识别**：以 `@Entry` struct 作为根页面；根据 `router.pushUrl/replaceUrl` 推出可达页面
2. **UI 元素抽取**：在页面 `build()` 内扫描组件起始行，抽取 Button/Input/Display/Component 等节点

描述生成（可选）：

- 若 `uiLlmApiKey` 非空，则分批调用 LLM 生成更“面向用户”的短标题
- 若无 key，则走启发式标题与兜底描述，不会跳过整个 UI 树生成

### 阶段 12：页面/功能点聚合（Page → Feature）

实现：`server/src/analyzer/pages/buildPageFeatureGroups.ts`

目标：把 DataFlows 尽可能归到 “页面 + 功能点” 维度，便于报告与可视化筛选。

聚合输出：

- `pages/index.json`：页面索引（每页 feature 数、flow 数、未分配 flow 数等）
- `pages/<pageId>/features/index.json`：该页面的 feature 列表
- `pages/<pageId>/features/<featureId>/dataflows.json`：该 feature 下的 flow 子集
- feature 类型：
  - `ui`：由 UI 节点标题派生的功能点（featureId 形如 `ui_<pageId>_<hash>`）
  - `source`：由 source 函数派生的功能点（featureId 形如 `src_<pageId>_...`）
  - `unknown`：无法归类时的兜底 feature

### 阶段 13：写入结果文件

将本次 run 的所有核心产物写入 `output/<AppName>/<timestamp>/`（见下一节“输出产物”）。

### 阶段 14：生成隐私声明报告（隐私要素抽取 + 确定性报告拼装）

实现入口：`server/src/analyzer/privacyReport/generatePrivacyReportArtifacts.ts`

该阶段会：

1. 针对每个 feature 生成 `privacy_facts.json`
   - 基于 LLM 从 dataflows/ui/source 证据中抽取隐私要素（dataPractices / permissionPractices）
   - 同时会把 CSV 中「SDK API → 相关权限」的映射结果**确定性注入**到 `permissionPractices[].permissionName`（并绑定到对应数据流节点 refs，便于报告跳转）
2. 汇总所有 feature，生成 `privacy_report.json` 与 `privacy_report.txt`（**确定性拼装**）
   - 报告正文**不包含应用名称**（避免在文案中直接点名 App）
   - 仅输出“有证据支撑”的描述：每个句子至少包含一个可跳转 token（dataItem / permission），避免输出“未申请权限 / 未识别 / 不涉及 / 未发现开关”等“无证据句子”
   - 权限段落的 permission token 一定来自 `privacy_facts.json`（包含 CSV 注入的权限），并携带 jumpTo（若无有效 ref 则不会输出该句）

容错：

- 若 `privacyReportLlmApiKey` 为空，会跳过 feature 级隐私要素抽取（因此 collectionAndUse 段落可能为空）；但仍可基于 dataflows+sinks+CSV 生成权限段落中的可跳转 token（不依赖 LLM 文案生成）
- 若 feature 没有 dataflows，也会跳过该 feature 的要素抽取（数据项/权限 refs 不完整时，对应句子会被自然省略）

### 阶段 15：写入 runId 注册表

实现：`server/src/analyzer/runRegistry.ts`

写入：

- `output/_runs/<runId>.json`：记录 `runId -> outputDir`
- `output/_runs/latest.json`：记录最近一次运行（前端不传 `runId` 时默认读取 latest）

---

## 4. 会输出哪些文件（output 目录结构）

### 4.1 顶层结构

每次分析会产生一个输出目录：

```
output/<AppName>/<YYYYMMDD-HHMMSS>/
```

其下主要文件如下：

- `meta.json`：本次 run 的元信息与统计
  - 包含输入参数（路径、模型、maxDataflowPaths 等）与各阶段产物数量统计
- `sinks.json` / `sinks.csv`：sink 列表（JSON + 表格版 CSV）
- `sources.json` / `sources.csv`：source 列表（JSON + 表格版 CSV）
- `callgraph.json`：调用图（nodes + edges）
- `dataflows.json`：数据流集合（可能为空；查看 `meta.skipped/skipReason`）
- `ui_tree.json`：全局 UI 树（页面与 UI 元素节点）
- `privacy_report.json`：隐私声明报告（token 化，可点击跳转）
- `privacy_report.txt`：隐私声明报告纯文本渲染版

### 4.2 pages/ 分层结构（页面与功能点聚合产物）

```
output/<AppName>/<timestamp>/pages/
  index.json
  <pageId>/
    ui_tree.json
    features/
      index.json
      <featureId>/
        dataflows.json
        privacy_facts.json
```

说明：

- `pages/index.json`：有哪些 page，以及每个 page 的入口位置与统计
- `pages/<pageId>/ui_tree.json`：只切出该页面相关的 UI 子树（便于局部理解）
- `pages/<pageId>/features/index.json`：该页面下的功能点列表（featureId、标题、锚点位置、统计）
- `pages/<pageId>/features/<featureId>/dataflows.json`：功能点对应的数据流子集
- `pages/<pageId>/features/<featureId>/privacy_facts.json`：功能点级的隐私要素抽取结果（用于报告生成）

### 4.3 run 注册表（用于历史 run 列表与 latest）

```
output/_runs/
  <runId>.json
  latest.json
```

---

## 5. 会显示哪些可视化界面（web 路由与页面能力）

前端路由定义：`web/src/App.tsx`；页面实现：`web/src/pages/*`。

### 5.1 首页 `/`

页面：`web/src/pages/Home.tsx`

功能：

- 配置分析输入：`appPath / sdkPath / csvDir / maxDataflowPaths`
- 配置三套 LLM 参数（DataFlows / UI Tree / Privacy Report）
- 触发分析任务：
  - 同步接口：`POST /api/analyze`
  - 任务接口（推荐，带进度）：`POST /api/analyze/jobs` + `GET /api/analyze/jobs/:jobId/events`（SSE）
- 管理与切换历史 run：`GET /api/runs`

### 5.2 sinks 页面 `/sinks`

页面：`web/src/pages/Sinks.tsx`，API：`GET /api/results/sinks`

- 表格展示每个 sink 调用点
- 支持点击文件路径跳转到源码位置（依赖 `EditorLink` 相关逻辑）

### 5.3 sources 页面 `/sources`

页面：`web/src/pages/Sources.tsx`，API：`GET /api/results/sources`

- 表格展示入口/生命周期函数
- 支持点击文件路径跳转到源码位置

### 5.4 调用图页面 `/callgraph`

页面：`web/src/pages/CallGraph.tsx`，API：`GET /api/results/callgraph`

- 图可视化（`web/src/components/GraphView.tsx`）：支持缩放、选择节点、查看详情
- 节点详情可包含代码/描述，并支持跳转到对应文件行

### 5.5 数据流页面 `/dataflows`

页面：`web/src/pages/Dataflows.tsx`

支持两种模式：

1. Page → Feature 分层模式（优先）
   - `GET /api/results/pages`
   - `GET /api/results/pages/:pageId/features`
   - `GET /api/results/pages/:pageId/features/:featureId/dataflows`
2. Flat 全量模式（兜底）
   - 若 Page/Feature 索引不存在或读取失败，则回退到 `GET /api/results/dataflows`

能力：

- 选择 flow 与节点，查看节点上下文（含行号窗口）
- 图可视化展示 nodes/edges
- 从 URL query（`featureId/flowId/nodeId`）进行定位（给“报告跳转”用）

### 5.6 隐私声明报告页面 `/privacy-report`

页面：`web/src/pages/PrivacyReport.tsx`，API：`GET /api/results/privacy_report`

- 展示两大章节：
  1. 我们如何收集和使用您的个人信息
  2. 设备权限调用
- 报告以 token 数组形式渲染：
  - 普通文本 token：直接展示
  - 可跳转 token：点击后跳到 `/dataflows?featureId=...&flowId=...&nodeId=...`

---

## 6. 一次完整运行会发生什么（端到端串联）

1. 准备输入（推荐放仓库 `input/` 下）
   - App：`input/app/<YourApp>/`
   - SDK：`input/sdk/default/openharmony/ets/`（或自行指定）
   - CSV：`input/csv/`（至少包含 `sdk_api_and_permission.csv` 或其它带 `相关API` 列的表）
2. 启动开发模式（仓库根目录）：
   - `npm run dev`
   - 后端默认端口：`3001`（`server/src/index.ts`）
   - 前端 Vite 默认端口：`5173`（见 `web/README.md`），并通过代理把 `/api/*` 转发到 `3001`
3. 打开 Web 首页 `/`，配置路径与 LLM Key，启动分析任务
4. 分析完成后：
   - `output/<AppName>/<timestamp>/` 会落盘一整套 JSON/CSV/报告
   - `output/_runs/latest.json` 会更新到最新 run
5. 在 Web 中切换到 `/sinks`、`/sources`、`/callgraph`、`/dataflows`、`/privacy-report` 浏览与定位结果
