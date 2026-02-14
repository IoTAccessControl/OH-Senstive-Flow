# 实现说明：UI 界面树（交互树）+ Page/Feature 分层 + 分层 DataFlow

本文档描述本仓库在原有 sink/source、CallGraph、DataFlow 的基础上，新增并演进的能力：

- **UI 界面树（交互树）**：从 ArkTS App 源码抽取页面与关键 UI 元素，并识别页面跳转关系；可选使用 LLM 生成节点“用途描述”。
- **DataFlow 分层归类**：将 `dataflows.json` 的每条 flow 归类到 **App → Page → Feature**：
  - Page：`@Entry` 页面（来自 `ui_tree.json` 的 roots）。
  - Feature：Page 下的具体功能点，优先映射到 UI 控件（输入框/按钮/显示元素），映射失败时回退到 source/lifecycle 函数（`aboutToAppear/build/...`）。
- **前端 DataFlow 页面**：支持按 Page、Feature 选择查看对应的数据流可视化。

> 安全：所有 LLM `api-key` 仅用于服务端运行时请求，不会写入 `meta.json` / `ui_tree.json` / `pages/*` / `privacy_report.*` 等任何输出文件。

---

## 1. 首页输入项（UI 界面树描述）
首页包含 3 个输入（用于“描述 UI 元素/页面”的 LLM）：

- 描述UI的 LLM 提供商名称（默认 `Qwen`）
- 描述UI的 LLM 提供商 api-key（默认空）
- 描述UI的模型名称（默认 `qwen3-32b`)

说明：
- 这组 UI-LLM 配置 **与 DataFlow 的 LLM 配置独立**，互不影响。
- `uiLlmApiKey` 不能为空：用于生成 UI Tree 节点的中文“短标题”（页面名/功能名）。为空会导致分析失败。

---

## 2. UI 界面树（交互树）生成
输出文件：

- `output/<appName>/<YYYYMMDD-HHmmss>/ui_tree.json`

### 2.1 “界面树”的语义（交互树）
本实现将 UI 视为一个**交互驱动的树/图**：

- 页面（Page）包含其 build() 中抽取到的 UI 元素（`contains` 边）
- 当某个 UI 元素触发 `router.pushUrl/replaceUrl` 跳转到另一个页面时：
  - 记录一条 `navigatesTo` 边：`触发元素 -> 目标页面`

因此，“按钮1跳转到另一个页面，页面里还有输入框/显示框”在本实现中的表达是：

- 按钮1 通过 `navigatesTo` 指向目标页面
- 目标页面再通过 `contains` 包含其内部元素

### 2.2 抽取范围与代码切片
扫描范围沿用现有规则：仅扫描 App 下 `entry/src/main/ets/` 的 `.ets/.ts` 文件。

在每个可达页面的 `build()` 中抽取 UI 元素节点（优先覆盖这些类别）：

- Button（按钮/可点击元素）
- TextInput / TextArea / Search（输入框）
- Text / Image（显示元素）
- 其它自定义组件（会过滤常见布局容器组件，避免噪声过大）

每个节点保存 `filePath/line/code`，并附带 `context`（命中行上下固定行数的切片）。

### 2.3 跳转关系识别
在 `build()` 代码切片内识别：

- `router.pushUrl(...)`
- `router.replaceUrl(...)`

并从参数中解析 `url: 'pages/xxx/YYY'`，再映射到真实源码文件（例如 `pages/chat/ChatPage` -> `pages/chat/ChatPage.ets`）。

### 2.4 节点描述（LLM Agent，可选）
若提供 UI LLM api-key，会对 `ui_tree.json` 中的 Page/Element 节点调用 OpenAI-compatible `chat/completions` 生成 `description` 字段（更偏“短标题”，用于分类展示）：

- 输入：节点类别 + 命中行 + 上下文切片 +（如有）跳转目标信息
- 输出：严格 JSON，格式为 `{ "descriptions": [ { "id": "...", "description": "..." } ] }`

---

## 3. Page/Feature 分层输出与 DataFlow 归类
输出目录：

- `output/<appName>/<YYYYMMDD-HHmmss>/pages/`

其中：

- `pages/index.json`：Page 索引（@Entry 页面列表 + 计数）
- `pages/<pageId>/ui_tree.json`：该 Page 的界面树切片（用于隐私要素抽取提示词）
- `pages/<pageId>/features/index.json`：该 Page 下 Feature 列表
- `pages/<pageId>/features/<featureId>/dataflows.json`：该 Feature 下的数据流（最终归类结果）
- `pages/<pageId>/features/<featureId>/privacy_facts.json`：该 Feature 的隐私要素抽取（Step2 输出）

### 3.1 Page 切分规则（按 @Entry 页面）

- Page 的来源：`ui_tree.json` 的 `roots[]`（由 `@Entry` 页面解析得到）
- 每个 root 对应一个 Page（`pageId` 由 structName/filePath 生成，冲突时附加 hash 保证唯一）

### 3.2 DataFlow 归类到 Page（按 source API）
对 `dataflows.json` 中每条 flow：

1) 在 `flow.nodes` 中查找能命中 `sources.json` 的节点（同 `filePath + line`），得到该 flow 的 source（优先选择 `build()`）
2) 按 source 的 `filePath` 归入同文件的 Page
3) 若找不到匹配 Page，则归入 `pages/_unassigned`

### 3.3 DataFlow 归类到 Feature（UI 优先 + 回退）
在已归属的 Page 内，对每条 flow 选择一个 Feature：

1) **UI 命中（优先，激进启发式）**：
   - 先基于源码计算该 Page 的 `build()` 行号范围；
   - 优先使用 flow 在 `build()` 内的节点行号作为证据行，映射到“最近前置 UI 节点”；
   - 若 flow 主要发生在 handler/回调函数中，会尝试：
     - 从 flow 节点反推出包含它的函数名（例如 `onPressTalk`）；
     - 在 `build()` 中搜索 `this.onPressTalk` / `onPressTalk(` 等引用行作为证据，再映射到“最近前置 UI 节点”；
   - 若 flow.summary.permissions 包含权限字符串（如 `ohos.permission.MICROPHONE`），会在 `build()` 中定位包含该权限的行作为证据；
   - 当证据不足时，允许将“最靠近 build() 的 flow 节点行号”夹逼到 build() 范围内，再做一次更宽松的 UI 映射。
2) **回退到 source/lifecycle Feature（兜底）**：
   - 若仍无法映射到 UI 控件，则以 `sources.json` 命中的 source 函数（`aboutToAppear/build/...`）作为 Feature。

---

## 4. 前端 DataFlow 页面
路由：`/dataflows`

加载逻辑：

1) 优先读取 `pages/index.json`（`GET /api/results/pages`）
2) 选择 Page 后读取 `pages/<pageId>/features/index.json`（`GET /api/results/pages/:pageId/features`）
3) 选择 Feature 后读取 `pages/<pageId>/features/<featureId>/dataflows.json`（`GET /api/results/pages/:pageId/features/:featureId/dataflows`）

兼容：

- 当历史 run 不包含 `pages/` 输出时，前端会回退到全量 `dataflows.json` 视图。
