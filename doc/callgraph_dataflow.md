# 实现说明：CallGraph + DataFlow（LLM）分析与可视化

## 新增目标
在原有 **sink/source API** 分析的基础上，新增两类结果：

1. **函数调用图（CallGraph）**
   - 起点：source API（入口/生命周期函数）
   - 终点：sink API（SDK API 调用点）
   - 输出：`callgraph.json`
   - 前端：调用图可视化页面（节点 + 边）

2. **数据流（DataFlow）**
   - 从 CallGraph 中抽取多条 source→sink 路径
   - 使用 **LLM Agent** 基于 App 源码补充更多节点（尤其关注隐私/权限相关信息）
   - 输出：`dataflows.json`
   - 前端：数据流可视化页面（左图右详情）

> 注意：LLM 的 `api-key` **不会写入** `meta.json` 或其它输出文件，只用于服务端运行时请求。

---

## 首页输入项（CallGraph/DataFlow 相关）
首页与 CallGraph/DataFlow 相关的输入项为：
- **最大提取数据流条数**（默认 `5`，对应 `maxDataflowPaths`）
- **数据流分析的 LLM 配置**（对应 `llmProvider/llmApiKey/llmModel`）
  - `llmApiKey` 为空时：仍会生成 `callgraph.json`；`dataflows.json` 会以 `meta.skipped=true` 占位

首页还包含 UI 界面树与隐私声明报告的 LLM 配置（用于 `ui_tree.json`、Page/Feature 分层结果、隐私报告等），详见：
- `doc/ui_tree_pages_features.md`
- `doc/privacy_report.md`

---

## 输出目录与文件
沿用现有输出目录规则：

```
output/<appName>/<YYYYMMDD-HHmmss>/
  meta.json
  sinks.json
  sinks.csv
  sources.json
  sources.csv
  callgraph.json
  dataflows.json
  # 还会生成 ui_tree.json / privacy_report.* 等，见对应文档
```

---

## CallGraph 构建（服务端）
入口：`server/src/analyzer/callGraph/buildCallGraph.ts`

### 输入
- App 源码文件列表（`appFiles`）
- `sources.json`（source API 记录）
- `sinks.json`（sink API 记录）

### 节点（nodes）
每个节点至少包含：
- `filePath`（工作区相对路径）
- `line`（1-based）
- `code`（该行代码）

并包含额外字段用于可视化与路径抽取：
- `id`（稳定唯一）
- `type`：`source | function | sinkCall`
- `name?`：函数名或 sink API key（可能是多个，以逗号分隔）
- `description?`：中间函数节点的描述（若提供 `llmApiKey` 则会尽量补全，用于提升可读性；失败不会阻断分析）

### 边（edges）
- `calls`：函数调用边 `function -> function`
- `containsSink`：sink 调用包含边 `function -> sinkCall`

### 前向 + 后向裁剪
为了避免全量调用图过大，输出时仅保留能形成 source→sink 路径的节点/边：
- **前向可达**：从所有 source 出发可达的节点集合
- **后向可达**：能到达任一 sinkCall 的节点集合（在反向图中回溯）
- 取交集得到主图

---

## 路径抽取（多条）
入口：`server/src/analyzer/callGraph/extractPaths.ts`

- 从 CallGraph 中按 `maxDataflowPaths` 抽取多条 source→sinkCall 路径
- DFS + 环检测（visited set）+ 最大深度限制（默认 60）
- 用 “到任意 sink 的最短距离” 作为启发式排序，以更快找到有效路径

---

## DataFlow（LLM Agent）生成
入口：`server/src/analyzer/dataflow/buildDataflows.ts`

### 运行逻辑
- 若 `llmApiKey` 为空：写入 `dataflows.json`，标记 `meta.skipped=true`，并返回空 `flows`（不会报错阻断分析）。
- 若 `llmApiKey` 非空：
  1. 对每条路径构建提示词（包含锚点节点 + 源码上下文片段）
  2. 调用 OpenAI 兼容接口的 `chat/completions`
  3. 解析严格 JSON，落盘为 `dataflows.json`

### LLM Provider
默认支持：
- `Qwen` / `DashScope`：DashScope OpenAI-compatible endpoint（会在 CN/US endpoint 间自动 fallback）
- `Qwen-US` / `DashScope-US`：优先使用 US endpoint
- `OpenAI`

可通过环境变量覆盖 baseURL：
- `CX_OH_LLM_BASE_URL`

### DataFlow 节点字段
每个节点包含：
- `filePath`
- `line`
- `code`
- `description`（由 LLM 生成）
- `context`：选中行上下各 5 行（前端右侧展示）

并包含 `edges` 用于前端画图。

### 重点信息
LLM 提示词中强调对以下信息进行补充与总结：
- 数据项
- 收集频率
- 是否上传至云端
- 存储方式/是否加密
- 权限名称（如 `ohos.permission.*`）

---

## 前端可视化
### CallGraph 页面
路由：`/callgraph`
- 读取 `/api/results/callgraph`
- SVG 绘制节点/边（轻量分层布局）

### DataFlow 页面
路由：`/dataflows`
- 优先读取 Page 索引 `/api/results/pages`，再读取 `/api/results/pages/:pageId/features`，最后按功能点读取 `/api/results/pages/:pageId/features/:featureId/dataflows`
- 兼容读取 `/api/results/dataflows`（无分组信息时的回退路径）
- 左侧：SVG 图
- 右侧：选中节点详情（文件路径、行号、该行与附近代码、LLM 描述）
