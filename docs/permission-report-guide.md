# 敏感权限声明自动生成研究报告与使用指导

## 1.项目概述

本模块面向 OpenHarmony / HarmonyOS ArkTS 应用，目标是从应用源码中自动识别敏感权限使用与相关隐私处理行为，生成带证据回溯能力的隐私声明结果。

模块的核心流程是：输入应用源码、OpenHarmony SDK 源码和补充 CSV 后，系统先识别 source 和 sink，构建调用图与数据流，再按页面和功能点聚合，抽取隐私事实，最后生成隐私声明报告与可视化结果。

以当前样例 `Wechat_HarmonyOS_20260306-212407` 为例，系统共扫描 31 个 App 文件，识别 46 个 sink、29 个 source，构建 26 条数据流，聚合出 10 个页面和 13 个功能点，并生成最终隐私声明报告。

## 2.使用指导

本模块推荐在仓库根目录下使用。

**基本步骤**

1. 启动系统：`npm run dev`
2. 在首页填写或选择分析参数：`appPath`、`sdkPath`、`csvDir`
3. 填写三组 LLM 配置：数据流分析、UI 描述、隐私报告
4. 点击开始分析，等待任务完成

**推荐输入示例**

- `appPath`: `input/app/Wechat_HarmonyOS/`
- `sdkPath`: `input/sdk/default/openharmony/ets/`
- `csvDir`: `input/csv/`

**结果查看方式**

- 首页：查看任务状态与历史运行记录
- Dataflows 页面：查看功能点级数据流和节点详情
- Privacy Report 页面：查看最终隐私声明结果
- 输出目录：查看 JSON、CSV、TXT 等原始产物

**评估命令示例**

当前仓库保留了 Python 评估脚本，指标口径与后端运行器中的权限评估辅助函数一致：

```bash
python3 scripts/eval_permissions.py \
  --app Wechat_HarmonyOS \
  --run-id Wechat_HarmonyOS_20260306-212407 \
  --details
```

**使用注意事项**

- `appPath` 应指向应用根目录，而不是直接指向 `ets` 子目录。
- `sdkPath` 应指向 OpenHarmony ETS SDK 根目录。
- 最终隐私声明报告中的权限句子只展示“有跳转证据”的结果；没有证据的权限不会展示在最终报告中。

## 3.数据集

本模块当前仓库内可直接使用的数据集包括 5 个 ArkTS 应用样例、1 套 OpenHarmony SDK 源码，以及 1 套 CSV 补充信息和 1 组权限 groundtruth。

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| App 数据集 | `input/app/` | 待分析 ArkTS 应用源码 |
| SDK 数据集 | `input/sdk/default/openharmony/ets/` | OpenHarmony ETS SDK 源码 |
| CSV 补充信息 | `input/csv/` | API 描述、权限映射、补充规则 |
| 权限 groundtruth | `groundtruth/permission/` | 每个 App 一份权限标注文件 |

groundtruth 的生成方法与脚本（包含“源码/配置扫描 + SDK API 权限推断”）详见：

- `docs/permission-groundtruth-method.md`

当前 App 数据集包括：

- `ArkTS-wphui1.0`
- `TodayNews_harmony`
- `Wechat_HarmonyOS`
- `ohbili`
- `open_neteasy_cloud`

对应的权限 groundtruth 文件包括：

- `groundtruth/permission/ArkTS-wphui1.0.txt`
- `groundtruth/permission/TodayNews_harmony.txt`
- `groundtruth/permission/Wechat_HarmonyOS.txt`
- `groundtruth/permission/ohbili.txt`
- `groundtruth/permission/open_neteasy_cloud.txt`

样例应用 `Wechat_HarmonyOS` 的一次实际运行结果显示：

- App 文件数：31
- sink 数：46
- source 数：29
- 调用图节点数：53
- 调用图边数：44
- 数据流数：26
- 页面数：10
- 功能点数：13

## 4.期望输入

模块期望输入由目录路径和可选参数组成。

| 输入项 | 是否必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| `appPath` | 是 | 待分析 ArkTS 应用源码根目录 | `input/app/Wechat_HarmonyOS/` |
| `sdkPath` | 是 | OpenHarmony ETS SDK 根目录 | `input/sdk/default/openharmony/ets/` |
| `csvDir` | 是 | CSV 补充信息目录 | `input/csv/` |
| `maxDataflowPaths` | 否 | 最大数据流路径数，留空表示不限制 | `20` |
| `llmProvider / llmApiKey / llmModel` | 是 | 数据流分析使用的 LLM 配置 | `Qwen / <key> / qwen3.5-397b-a17b` |
| `uiLlmProvider / uiLlmApiKey / uiLlmModel` | 是 | UI 描述使用的 LLM 配置 | `Qwen / <key> / qwen3.5-27b` |
| `privacyReportLlmProvider / privacyReportLlmApiKey / privacyReportLlmModel` | 是 | 隐私报告使用的 LLM 配置 | `Qwen / <key> / qwen3.5-27b` |

输入目录至少应满足以下条件：

- 应用目录下能找到 `entry/src/main/ets/` 或等价主业务代码目录
- SDK 目录下包含 `@ohos.*`、`@kit.*` 等 ETS 声明文件
- CSV 目录中包含 API 功能描述与权限映射信息

## 5.预期输出

分析完成后，结果会写入 `output/<appName>/<timestamp>/`。以样例为例，输出目录为 `output/Wechat_HarmonyOS/20260306-212407/`。

**关键输出文件**

| 文件 | 作用 |
| --- | --- |
| `meta.json` | 记录输入参数与整体统计信息 |
| `sinks.json` / `sinks.csv` | 系统能力与 SDK API 调用识别结果 |
| `sources.json` / `sources.csv` | source 识别结果 |
| `callgraph.json` | 调用图结果 |
| `dataflows.json` | 全局数据流结果 |
| `ui_tree.json` | UI 树结果 |
| `pages/index.json` | 页面与功能点聚合索引 |
| `pages/<pageId>/features/<featureId>/privacy_facts.json` | 功能点级隐私事实 |
| `privacy_report.json` | 最终结构化隐私声明报告 |
| `privacy_report.txt` | 最终纯文本隐私声明报告 |

**预期展示结果**

- 系统能识别页面、功能点、数据流节点及其来源
- 能生成“我们如何收集和使用您的个人信息”与“设备权限调用”两部分报告
- 在隐私声明报告页面，展示出的权限句子必须带有可点击跳转证据
- 没有跳转证据的权限，不进入最终隐私声明报告展示

样例 `privacy_report.txt` 中，系统已经生成了通讯录、首页搜索、头像更换等场景的隐私说明；其中“我的页面更换头像”功能识别出了 `ohos.permission.READ_MEDIA` 和 `ohos.permission.WRITE_MEDIA`，并可在页面中跳转回对应数据流节点进行核查。

## 6.评估

本模块当前主要评估“权限使用识别”效果，评估方式是：

- 预测结果：从本次运行产生的全部 `privacy_facts.json` 中收集权限
- 标准答案：从 `groundtruth/permission/<app>.txt` 读取权限集合
- 指标：覆盖率 `Recall = TP / GT`，误报率 `False Positive Rate = FP / Pred`

样例 `Wechat_HarmonyOS_20260306-212407` 的评估结果如下：

| 指标 | 结果 |
| --- | --- |
| GT | 7 |
| Pred | 7 |
| TP | 7 |
| FP | 0 |
| FN | 0 |
| Recall | 100.00% |
| False Positive Rate | 0.00% |

结果说明如下：

- 在当前样例上，权限识别覆盖率达到 100%，说明 groundtruth 中定义的 7 个权限都被识别到了。
- 误报率为 0%，说明识别结果中没有额外引入 groundtruth 之外的权限。
- 需要注意的是，底层权限识别结果与最终报告展示结果并不完全等价：底层识别关注“是否识别到权限”，最终报告展示还要求“是否具备可点击跳转证据”。
- 因此，评估结果反映的是模块底层识别能力；而最终页面展示遵循更严格的证据约束，只展示可回溯的权限声明句子。
