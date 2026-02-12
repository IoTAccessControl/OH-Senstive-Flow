# 实现说明：OpenHarmony ArkTS Sink/Source API 分析与可视化

## 目标
输入：
- 待分析的 ArkTS App 源码路径（默认 `input/app/<appName>/`）
- OpenHarmony SDK 源码路径（默认 `input/sdk/default/openharmony/ets/`）
- SDK API 补充信息 CSV 目录（默认 `input/csv/`）

输出：
- **sink API**：App 源码中调用到的 OpenHarmony SDK API
- **source API**：App 源码中的入口函数/生命周期函数（如 `build()`、`aboutToAppear()` 等）

这些结果会作为后续 CallGraph/DataFlow、UI 界面树/功能模块，以及隐私声明报告生成的基础证据。

本仓库同时提供一个前端页面，用于一键分析并查看结果。

## 架构
- `server/`：Node + Express，负责执行分析与输出落盘
- `web/`：React + Vite + TypeScript，负责输入路径、触发分析、可视化结果

接口：
- `POST /api/analyze`：执行分析并写入 `output/`（返回 `runId` 与 `outputDir`）
- `GET /api/runs`：列出历史运行记录（来自 `output/_runs/`）
- `GET /api/fs/roots`：返回仓库根目录与默认输入根目录（用于前端目录选择器）
- `GET /api/fs/dirs?base=app|sdk|csv&path=<rel>`：列出输入根目录下的子目录
- `GET /api/results/*`：读取并返回指定结果（支持 `runId`；不传则读取 `latest`）
  - `GET /api/results/sinks`：`sinks.json`
  - `GET /api/results/sources`：`sources.json`
  - `GET /api/results/callgraph`：`callgraph.json`
  - `GET /api/results/dataflows`：`dataflows.json`
  - `GET /api/results/ui_tree`：`ui_tree.json`
  - `GET /api/results/modules`：`modules/index.json`
  - `GET /api/results/modules/:moduleId/dataflows`：`modules/<moduleId>/dataflows.json`
  - `GET /api/results/privacy_report`：`privacy_report.json`

## 输出目录与文件
结果固定保存到仓库根目录的 `output/` 下，按 appName 与时间戳分目录：

```
output/<appName>/<YYYYMMDD-HHmmss>/
  meta.json
  sinks.json
  sinks.csv
  sources.json
  sources.csv
  callgraph.json
  dataflows.json
  ui_tree.json
  privacy_report.json
  privacy_report.txt
  modules/
    index.json
    <moduleId>/
      ui_tree.json
      dataflows.json
      privacy_facts.json
    _unassigned/            # 可选：当存在未归类的数据流时生成
      dataflows.json
      privacy_facts.json
output/_runs/
  latest.json
  <runId>.json
```

其中：
- `runId` 格式：`<appName>_<YYYYMMDD-HHmmss>`
- `_runs/latest.json` 用于“未指定 runId 时读取最近一次结果”

## sink API 分析（SDK API 使用点）
### 1) SDK 扫描（索引）
服务端会扫描 `sdkPath` 下所有声明文件：
- `@ohos.*.d.ts` / `@ohos.*.d.ets`
- `@kit.*.d.ts` / `@kit.*.d.ets`

建立映射：`moduleName -> 声明文件路径`，用于后续：
- 解析 kit 的 re-export（把 `@kit.X` 解析成实际 `@ohos.Y`）
- 从声明文件的 JSDoc 中提取 API 功能描述

### 2) App 扫描（import + 调用点）
默认只扫描：`<appPath>/entry/src/main/ets/` 内的 `.ets/.ts` 文件。

提取 import：
- 使用 TypeScript AST 解析 `import ... from '@ohos.*'` / `import ... from '@kit.*'`
- 记录每个绑定的 `[导入行号, 导入代码, localName, importedName, module]`

识别调用点：
- **不依赖完整 AST**（ArkTS UI DSL 语法并非标准 TS/JS），改用 TypeScript 的 **scanner** 做词法级识别：
  - `new LocalName(...)`
  - `LocalName(...)`
  - `LocalName.method(...)`（支持 `?.`）
- 记录调用点 `[调用行号, 调用代码]`

### 3) API 描述获取（保证非空）
每条 sink 记录必须包含 `API功能描述`，获取优先级为：
1. **SDK 声明文件 JSDoc**（优先）  
2. **补充 CSV**（扫描 `csvDir` 下所有 `.csv`，解析含 `相关API` 列的文件，例如 `sdk_api_and_permission.csv`）
3. **预定义 override CSV**：`input/csv/sdk_api_description_override.csv`
4. 兜底文案：提示用户在 override CSV 中补充

> 备注：`@kit.*` 的 named export 会尝试解析到对应的 `@ohos.*` 模块，以提升 JSDoc 命中率。

### 4) sink 记录字段
写入 `sinks.json` 与 `sinks.csv`，字段固定为：
- `App源码文件路径`
- `导入行号`
- `导入代码`
- `调用行号`
- `调用代码`
- `API功能描述`

## source API 分析（入口/生命周期函数）
在 App 文件中按行扫描函数定义，匹配：
- ArkUI 组件：`build`、`aboutToAppear`、`aboutToDisappear`、`onPageShow`、`onPageHide`、`onBackPress`
- UIAbility：`onCreate`、`onDestroy`、`onForeground`、`onBackground`、`onWindowStageCreate`、`onWindowStageDestroy`、`onWindowStageActive`、`onWindowStageInactive`、`onNewWant`、`onConfigurationUpdate`

输出 `sources.json` 与 `sources.csv`，字段固定为：
- `App源码文件路径`
- `行号`
- `函数名称`
- `描述`

## 可扩展点
- 增加/调整 source 生命周期清单：`server/src/analyzer/defaults.ts` 中 `SOURCE_FUNCTION_DESCRIPTIONS`
- 补充 sink 描述：编辑 `input/csv/sdk_api_description_override.csv`
- 调整 App 扫描范围：`server/src/analyzer/appScanner.ts`（默认 `entry/src/main/ets`）
