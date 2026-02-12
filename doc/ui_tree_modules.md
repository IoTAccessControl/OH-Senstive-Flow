# 实现说明：UI 界面树（交互树）+ 功能模块 + 模块化 DataFlow

本文档描述本仓库在原有 sink/source、CallGraph、DataFlow 的基础上，新增的：
- **UI 界面树（交互树）**：从 ArkTS App 源码抽取 UI 元素与跳转关系，并用 LLM 生成“用途描述”
- **功能模块**：以 `@Entry` 页面为模块根，对界面树进行切分；并把 `dataflows.json` 按模块归类保存
- **前端 DataFlow 页面**：按模块选择查看对应的 DataFlow

> 安全：所有 LLM `api-key` 仅用于服务端运行时请求，不会写入 `meta.json` / `ui_tree.json` / `modules/*` 等任何输出文件。

---

## 1. 前端新增输入项（首页）
在首页新增 3 个输入（用于“描述 UI 元素/页面”的 LLM）：
- 描述UI的 LLM 提供商名称（默认 `Qwen`）
- 描述UI的 LLM 提供商 api-key（默认空）
- 描述UI的模型名称（默认 `qwen3-32b`）

说明：
- 这组 UI-LMM 配置 **与 DataFlow 的 LLM 配置独立**，互不影响。
- 当前实现：`uiLlmApiKey` 为空时，`POST /api/analyze` **直接失败**（因为 UI 描述要求必须由 LLM 生成）。

---

## 2. UI 界面树（交互树）生成
输出文件：
- `output/<appName>/<YYYYMMDD-HHmmss>/ui_tree.json`

### 2.1 “界面树”的语义（交互树）
本实现将 UI 视为一个**交互驱动的树/图**：
- 页面（Page）包含其 build() 中抽取到的 UI 元素（contains 边）
- 当某个 UI 元素触发 `router.pushUrl/replaceUrl` 跳转到另一个页面时：
  - 记录一条 `navigatesTo` 边：`触发元素 -> 目标页面`

因此，你的理解“按钮1跳转到按钮2/输入框/显示框，则按钮1是后面三者的父节点”在本实现中的落地方式是：
- **按钮1 是目标页面的父节点（navigatesTo）**
- 目标页面再包含其内部元素（contains）

也就是说：按钮1 是这些后续元素的**祖先节点**（不是强制“直接父节点”），同时保留明确的跳转语义，避免把导航关系当成纯布局关系。

### 2.2 抽取范围与代码切片
扫描范围沿用现有规则：仅扫描 App 下 `entry/src/main/ets/` 的 `.ets/.ts` 文件。

在每个可达页面的 `build()` 中抽取 UI 元素节点（优先覆盖你要求的类别）：
- Button（按钮/可点击元素）
- TextInput / TextArea / Search（输入框）
- Text / Image（显示元素）

每个节点保存 `filePath/line/code`，并附带 `context`（命中行上下固定行数的切片）。

### 2.3 跳转关系识别
在 `build()` 代码切片内识别：
- `router.pushUrl(...)`
- `router.replaceUrl(...)`

并从参数中解析 `url: 'pages/xxx/YYY'`，再映射到真实源码文件（例如 `pages/chat/ChatPage` -> `pages/chat/ChatPage.ets`）。

### 2.4 节点描述（LLM Agent）
对 `ui_tree.json` 中的 Page/Element 节点，统一调用 OpenAI-compatible `chat/completions` 生成 `description` 字段：
- 输入：节点类别 + 命中行 + 上下文切片 +（如有）跳转目标信息
- 输出：严格 JSON，格式为 `{ "descriptions": [ { "id": "...", "description": "..." } ] }`

---

## 3. 功能模块生成与 DataFlow 归类
输出目录：
- `output/<appName>/<YYYYMMDD-HHmmss>/modules/`

其中：
- `modules/index.json`：模块索引
- `modules/<moduleId>/ui_tree.json`：该模块的界面树切片（子树/子图）
- `modules/<moduleId>/dataflows.json`：该模块下的 DataFlow（由 source API 归类得到）
- `modules/_unassigned/dataflows.json`：无法归类的 DataFlow（若存在）

### 3.1 模块切分规则（按 @Entry 页面）
- 每个 `@Entry` 页面作为一个模块根（module root）
- 从根节点出发，沿 `contains` 与 `navigatesTo` 边做遍历收集节点（带最大深度限制，避免循环跳转导致无限展开）

### 3.2 DataFlow 归类规则（按 source API）
把 `dataflows.json` 中每条 flow 归类到模块时：
1) 先在 flow.nodes 中查找能命中 `sources.json`（同 `filePath + line`）的节点，得到该 flow 的 source
2) 按 source 所在文件归入包含该文件的模块（优先匹配模块 entry 文件）
3) 若找不到匹配模块，则归入 `_unassigned`

前端 `/dataflows` 页面会先加载 `modules/index.json`，然后按模块加载对应 `modules/<moduleId>/dataflows.json`。

