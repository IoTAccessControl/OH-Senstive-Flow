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

## 页面使用方式

1. 打开前端页面。
2. 在首页填写或选择以下输入目录：

```text
appPath: input/app/Wechat_HarmonyOS/
sdkPath: input/sdk/default/openharmony/ets/
csvDir: input/csv/
```

3. 按需填写 `maxDataflowPaths`。
4. 填写三组 LLM 配置：
   - 数据流分析 LLM
   - UI 描述 LLM
   - 隐私报告 LLM
5. 点击开始分析，等待任务完成。
6. 在页面中查看 sinks、sources、callgraph、dataflows 和 privacy report。

## 输出结果位置

每次分析完成后，结果会写到：

```text
output/<appName>/<timestamp>/
```

常见产物包括：

- `meta.json`：本次运行的输入参数和统计信息
- `sinks.json` / `sinks.csv`
- `sources.json` / `sources.csv`
- `callgraph.json`
- `dataflows.json`
- `ui_tree.json`
- `pages/index.json`
- `privacy_report.json`
- `privacy_report.txt`

## 评估脚本

```bash
python3 scripts/eval_permissions.py
python3 scripts/eval_sinks.py
```
