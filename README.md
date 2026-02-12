# 隐私声明报告生成工具

本项目用于从 OpenHarmony ArkTS 源码中提取隐私相关调用链，并生成可读的隐私声明报告。它提供：
- 一个前端页面：输入路径 + 一键分析
- 一个后端分析服务：扫描 SDK 源码与 App 源码，输出
  - **sink API**：App 调用到的 OpenHarmony SDK API
  - **source API**：App 的入口函数/生命周期函数（如 `build()`、`aboutToAppear()` 等）
  - **CallGraph（调用图）**：以 source 为起点、sink 调用点为终点的函数调用图
  - **DataFlow（数据流）**：从调用图路径出发，使用 LLM Agent 为每条路径补充更细的数据流节点与描述（可选）

分析结果默认保存到 `output/` 并可在前端表格中查看。

## 目录结构
- `web/`：React + Vite + TypeScript（前端）
- `server/`：Express + TypeScript（分析与 API）
- `input/`：示例输入
  - `input/app/<appName>/`：待分析 App
  - `input/sdk/default/openharmony/ets/`：OpenHarmony SDK（ets）
  - `input/csv/`：补充 CSV（含 override）
- `output/`：运行时输出（自动生成，不需要手动创建）
- `doc/`：实现细节说明（见文末“文档”）

## 安装
需要 Node.js（建议 18+；本仓库开发环境为 Node 24）。

```bash
npm install
```

## 启动（开发模式）
同时启动后端（3001）与前端（Vite 默认 5173）：

```bash
npm run dev
```

然后在浏览器打开 Vite 提示的地址。

> 前端已配置代理：`/api/*` -> `http://localhost:3001`，无需额外设置 CORS。

## 使用步骤
1. 在首页填写/确认输入：
   - App 源码路径（默认示例：`input/app/Wechat_HarmonyOS/`）
   - SDK 源码路径（默认：`input/sdk/default/openharmony/ets/`）
   - CSV 目录（默认：`input/csv/`）
   - 最大提取数据流条数（默认 `5`）
   - LLM 提供商（默认 `Qwen`）
   - LLM api-key（默认空；为空时会跳过数据流分析）
   - LLM 模型名称（默认 `qwen3-coder-plus`）
   - 描述UI的 LLM 提供商名称（默认 `Qwen`）
   - 描述UI的 LLM api-key（默认空；为空时会导致分析失败）
   - 描述UI的模型名称（默认 `qwen3-32b`）
   - 生成隐私声明报告的 LLM 提供商名称（默认 `Qwen`）
   - 生成隐私声明报告的 LLM api-key（默认空；为空时会跳过隐私声明报告生成）
   - 生成隐私声明报告的模型名称（默认 `qwen3-32b`）
2. 点击「开始分析」
3. 点击跳转按钮查看结果：
   - sink/source API 可视化
   - 调用图可视化
   - 数据流可视化
   - 隐私声明报告（可点击数据项/权限名称跳转到对应数据流节点）

> 安全说明：服务端不会把 `api-key` 写入 `meta.json` 或其它输出文件。

## 输出文件
每次分析会生成一个时间戳目录：

```
output/<appName>/<YYYYMMDD-HHmmss>/
  sinks.json
  sinks.csv
  sources.json
  sources.csv
  meta.json
  callgraph.json
  dataflows.json
  ui_tree.json
  privacy_report.json
  privacy_report.txt
  modules/
    index.json
    <moduleId>/
      dataflows.json
      ui_tree.json
      privacy_facts.json
    _unassigned/            # 可选：当存在未归类的数据流时生成
      dataflows.json
      privacy_facts.json
output/_runs/
  latest.json
  <runId>.json
```

## 描述补全（保证每条 sink 都有描述）
`API功能描述` 的来源优先级：
1. SDK 声明文件 JSDoc（`.d.ts/.d.ets`）
2. `input/csv/` 下的补充 CSV（例如 `sdk_api_and_permission.csv`）
3. 预定义 override：`input/csv/sdk_api_description_override.csv`
4. 兜底提示文案（提醒你去 override CSV 补充）

## 文档
实现细节见：
- `doc/implementation.md`（sink/source 分析）
- `doc/callgraph_dataflow.md`（CallGraph/DataFlow + 可视化）
- `doc/ui_tree_modules.md`（UI 界面树 + 功能模块 + 模块化 DataFlow）
- `doc/privacy_report.md`（模块隐私要素抽取 + 隐私声明报告 + 前端点击跳转）
