# 验收使用指南

本文用于在一台新机器上完成 OH-Senstive-Flow 的环境准备、CPG 构建、单应用分析、批量分析和结果评估。所有命令默认在主仓库根目录执行。

一次完整验收包括：准备 App 源码、OpenHarmony ETS SDK 和 CSV 规则，构建 CPG 与本项目，配置三组模型服务，运行分析并生成权限和个人信息评估 CSV。

分析器直接读取 ArkTS 源码，不要求先用 DevEco Studio 编译待分析 App。本文中的“构建”主要指 CPG 工具和 OH-Senstive-Flow 本身。

## 1. 环境

推荐使用 Linux。WSL2 也可以使用，但 App、SDK 和仓库最好放在 Linux 文件系统中，避免跨文件系统扫描过慢。

需要准备：

- Git、Node.js 22、npm、Python 3.10 或更新版本，以及 JDK 21；
- 可访问 GitHub、OpenHarmony SDK 下载站点和模型服务；
- 建议预留至少 10 GB 可用磁盘空间。

检查版本：

```bash
git --version
node --version
npm --version
python3 --version
java -version
```

`java -version` 必须显示 Java 21。CPG 的 Gradle 构建和运行都依赖该版本。

获取主仓库后准备输入目录：

```bash
git clone https://github.com/IoTAccessControl/OH-Senstive-Flow
cd OH-Senstive-Flow
mkdir -p input/app input/sdk/default/openharmony input/csv
```

## 2. 下载 App 源码

将每个待分析的 ArkTS App 放到：

```text
input/app/<应用名>/
```

例如：

```bash
git clone <APP_REPOSITORY_URL> input/app/<应用名>
```

分析器读取源码，不要求先用 DevEco Studio 编译 App。

检查 App 中是否存在可分析源码：

```bash
find input/app/<应用名> -type f \( -name '*.ets' -o -name '*.ts' \) | head
```

如果没有输出，应先检查 App 是否下载完整以及目录层级是否正确。

## 3. 下载 OpenHarmony SDK

SDK 必须包含 `.d.ts`、`.d.ets` 等 ETS/ArkTS 声明文件，仅安装模拟器或编译工具不足以完成分析。

官方入口：

- OpenHarmony 官网：https://www.openharmony.cn/
- DevEco Studio：https://developer.huawei.com/consumer/cn/deveco-studio/

推荐通过 DevEco Studio 下载：

1. 安装并启动 DevEco Studio；
2. 打开 SDK Manager，不同版本入口可能显示为 `Settings > SDK`、`Configure > SDK Manager` 或欢迎页中的 SDK 管理入口；
3. 选择 OpenHarmony SDK 和 API 22；
4. 勾选 ETS/ArkTS 相关组件并执行下载；
5. 在 SDK Manager 中查看 SDK 安装目录。

从安装目录找到包含 `oh-uni-package.json`、`component/` 和大量声明文件的 `ets` 目录，然后复制到本项目：

```bash
cp -a <OPENHARMONY_SDK_ROOT>/ets input/sdk/default/openharmony/
```

如果下载的是 SDK 压缩包，解压后同样将其中的 `ets` 目录放到：

```text
input/sdk/default/openharmony/ets/
```

确认目录可读：

```bash
find input/sdk/default/openharmony/ets -type f \( -name '*.d.ts' -o -name '*.d.ets' \) | head
node -e "const p=require('./input/sdk/default/openharmony/ets/oh-uni-package.json'); console.log(p.apiVersion)"
```

第二条命令应输出 `22`。使用其他 API 版本时，必须保证 `--sdkPath` 指向对应版本的 `ets` 根目录。

## 4. 准备 CSV

确认以下文件存在于 `input/csv/`：

```text
privacy_rules.csv
risk_level.csv
sdk_api_and_permission.csv
sdk_api_description_override.csv
sdk_api_permission_override.csv
```

可以一次检查全部文件：

```bash
for file in privacy_rules.csv risk_level.csv sdk_api_and_permission.csv sdk_api_description_override.csv sdk_api_permission_override.csv; do
  test -f "input/csv/$file" || echo "缺少 input/csv/$file"
done
```

没有任何“缺少”输出才继续。

## 5. 构建 CPG

项目通过 `lib/cpg/cpg-neo4j` 中的 Gradle 工程生成 CPG。CPG 源码位于独立仓库，主仓库会忽略 `lib/`，因此新环境必须单独下载：

```bash
git clone https://github.com/cuefe/cpg.git lib/cpg
```

当前已验收的 CPG 提交为：

```text
d251e29bea84fac892134549a1d0fef0f8de25e1
```

需要复现当前环境时执行：

```bash
git -C lib/cpg checkout d251e29bea84fac892134549a1d0fef0f8de25e1
```

如果 `lib/cpg` 已存在，不要重复克隆，改为：

```bash
git -C lib/cpg fetch --all
git -C lib/cpg checkout d251e29bea84fac892134549a1d0fef0f8de25e1
```

准备 Gradle 配置并启用 TypeScript 前端：

```bash
cd lib/cpg
cp gradle.properties.example gradle.properties
```

编辑 `lib/cpg/gradle.properties`，至少确认：

```properties
enableTypeScriptFrontend=true
```

为了缩短构建时间，可以将 Java、CXX、Go、Python、LLVM、Ruby、JVM、INI 和 MCP 等本项目不使用的前端设为 `false`，但必须保留 TypeScript 前端。

构建并安装 CPG 命令：

```bash
cd lib/cpg/cpg-neo4j
../gradlew installDist
cd ../../..
```

第一次构建需要下载 Gradle 依赖，耗时取决于网络。分析器以 `--no-neo4j` 模式导出 JSON，因此本项目验收不需要安装或启动 Neo4j。

验证产物：

```bash
test -d lib/cpg/cpg-neo4j/build/install/cpg-neo4j/lib
```

该目录存在即满足条件。分析器直接调用
`java -classpath <install>/lib/* de.fraunhofer.aisec.cpg_vis_neo4j.ApplicationKt`
（`java` 优先取 `JAVA_HOME/bin`，否则取 PATH，版本前置见第 1 节）。

也可以做一次功能冒烟，应打印 `List of passes:` 并以退出码 `0` 结束：

```bash
java -classpath "lib/cpg/cpg-neo4j/build/install/cpg-neo4j/lib/*" \
  de.fraunhofer.aisec.cpg_vis_neo4j.ApplicationKt --list-passes
```

不要只运行 `gradle build`，必须运行 `installDist`。

## 6. 构建本项目

```bash
npm ci
npm run build
```

如果没有 `package-lock.json`，才改用 `npm install`。正式分析前建议执行完整检查：

```bash
npm run check
```

该命令会执行服务端和前端构建、前端 lint 以及服务端测试。

复制示例配置并填写模型服务信息：

```bash
cp .env.example .env
```

填写三组 OpenAI 兼容模型配置：

```env
LLM_PROVIDER=Qwen
LLM_API_KEY=<API_KEY>
LLM_MODEL=<MODEL_NAME>
LLM_BASE_URL=<OPENAI_COMPATIBLE_BASE_URL>

UI_LLM_PROVIDER=Qwen
UI_LLM_API_KEY=<API_KEY>
UI_LLM_MODEL=<MODEL_NAME>
UI_LLM_BASE_URL=<OPENAI_COMPATIBLE_BASE_URL>

PRIVACY_REPORT_LLM_PROVIDER=Qwen
PRIVACY_REPORT_LLM_API_KEY=<API_KEY>
PRIVACY_REPORT_LLM_MODEL=<MODEL_NAME>
PRIVACY_REPORT_LLM_BASE_URL=<OPENAI_COMPATIBLE_BASE_URL>

LLM_TIMEOUT_MS=300000
```

配置用途：

- `LLM_*` 用于数据流等主分析任务；
- `UI_LLM_*` 用于页面和功能描述；
- `PRIVACY_REPORT_LLM_*` 用于隐私事实抽取和自然语言隐私声明。

`BASE_URL` 应包含模型服务要求的 `/v1` 路径。不要把包含真实密钥的 `.env` 提交到 Git。

## 7. 分析一个 App

先设置待分析应用的目录名：

```bash
APP_NAME=Wechat_HarmonyOS
```

运行分析：

```bash
npm run analyze -- \
  --appPath "input/app/$APP_NAME/" \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/ \
  --graphBackend cpg
```

成功时命令返回 `ok: true`，结果目录为：

```text
output/<应用名>/<时间戳>/
```

终端还会返回本次 `runId` 和 `outputDir`。最低确认命令：

```bash
find "output/$APP_NAME" -mindepth 1 -maxdepth 1 -type d | sort | tail -1
```

## 8. 批量分析 App

批量脚本不会自动遍历 `input/app/`。它按 `groundtruth/permission/*.txt` 中的文件名确定应用清单，再读取 `input/app/<应用名>/`。

运行前检查所有应用目录是否齐全：

```bash
for gt in groundtruth/permission/*.txt; do
  app=$(basename "$gt" .txt)
  test -d "input/app/$app" || echo "缺少 input/app/$app"
done
```

没有任何“缺少”输出后开始分析：

```bash
MAX_PARALLEL=3 bash scripts/analyze_all_apps.sh
```

`MAX_PARALLEL` 控制并发数。模型服务或机器资源有限时使用 `1`，常规验收建议使用 `3`，资源充足时再提高。

任一应用失败时，批量脚本会返回非零退出码。修复后可以单独重跑失败应用，也可以重新运行批量脚本；新结果会写入新的时间戳目录，不会覆盖旧运行目录。

## 9. 启动页面

```bash
npm run dev
```

访问：

```text
前端：http://localhost:5173
后端：http://localhost:3001
```

如果端口被占用，应先结束占用进程，或根据启动日志中显示的新端口访问。

## 10. 运行评估

批量分析完成后执行：

```bash
python3 scripts/eval_all.py
```

评估结果写入：

```text
output/evaluation/permission_evaluation.csv
output/evaluation/personal_info_evaluation.csv
```

脚本默认读取每个应用最新的有效时间戳目录。每次评估都会覆盖 `output/evaluation/` 下的同名 CSV；如果要分别保留不同模型的结果，应在下一次评估前复制到独立目录：

```bash
mkdir -p evaluation_results/tuned
cp output/evaluation/*.csv evaluation_results/tuned/
```

`N/A` 的判断规则：groundtruth 总数为 0 时显示 `N/A` 是正常情况；groundtruth 非空但完整度为 `N/A` 时，需要检查对应应用的最新运行目录。

此外，如果需要更直观地查看指标达成情况与各应用要素明细，可以运行可视化验收脚本：

```bash
python3 scripts/generate_html_report.py
```

执行后会输出终端判定结论，并在以下路径生成独立的可视化 HTML 验收报告：

```text
output/evaluation/acceptance_report.html
```

直接使用浏览器打开该文件即可查看权限一致性、流向分析与合规要素生成的图表及明细抽屉。

### HTML 报告生成规则

报告由纯 Python 规则计算生成，全程不调用 LLM。数据来源：

- 应用清单：`groundtruth/permission/*.txt` 的文件名；
- Ground truth：`groundtruth/permission/<应用名>.txt`（权限集合）与 `groundtruth/personal_info.csv`（`应用/数据项`，经同义归一化）；`groundtruth/completeness.csv` 是人工标注存档，当前不参与自动评分；
- 运行目录：设置环境变量 `EVAL_RUN_INFO` 指向某个 `run-info.txt` 时，按其钉定的时间戳目录读取；否则取每个应用最新的有效运行目录；
- 运行产物：各 run 的全部 `privacy_facts.json`（预测数据项与要素文本）、同级 `dataflows.json`（校验证据引用的 `flowId/nodeId` 是否真实存在）、`privacy_report.json` / `privacy_report.txt` 与 `sources.csv`（合规要素与明细展示）。

四项 KPI 口径：

1. 代码感知覆盖率：GT 数据项被 facts 预测命中的比例（含 fallback 通道）；
2. 代码感知误报率：预测中超出 GT 的比例；
3. 四类合规要素生成：每个应用是否齐备生成权限类型、调用功能场景、数据类型、使用目的四类要素；
4. 报告内容完整度：对每个 GT 数据项的要素做无参照 rubric 打分——具体内容 1 分，模板化或含糊 0.5 分（模板话术封顶 0.89），缺失或“未识别” 0 分；证据引用必须指向该 run `dataflows.json` 中真实存在的 `flowId/nodeId`，否则不计分。

注意事项：

- 可用 `--output` 指定输出路径；归档某批评测时，应把 HTML 报告与两张 CSV、`run-info.txt` 一起放入 `evaluation_results/<标签>/`；
- 脚本执行时会同时重写 `output/evaluation/personal_info_evaluation.csv`（不重写 permission CSV）；
- 报告生成依赖 run 产物目录：如果只保留了 CSV 归档而 run 目录已不存在（例如在其他机器上运行的历史批次），无法事后补生成 HTML。

验收时确认：

- 分析命令或批量脚本成功结束；
- 每个 App 都有 `output/<应用名>/<时间戳>/`；
- `output/evaluation/` 下生成两张 CSV；
- 可选打开 `output/evaluation/acceptance_report.html` 查看可视化验收报告；
- groundtruth 非空的应用没有异常 `N/A`；
- 覆盖率、误报率和要素完整度达到项目要求。

## 11. 常见问题

### 未找到 CPG 工具

确认执行的是 `../gradlew installDist`，并检查产物目录：

```bash
test -d lib/cpg/cpg-neo4j/build/install/cpg-neo4j/lib
```

### 未找到 ArkTS 文件

检查 `--appPath` 是否指向真实 App 根目录，以及目录中是否存在 `.ets` 或 `.ts` 文件。

### SDK 路径不可读或识别不到 SDK API

`--sdkPath` 必须直接指向 `ets` 根目录，而不是 SDK 上一级目录。目录内应存在 `oh-uni-package.json` 和大量声明文件。

### 模型请求超时

依次确认模型 URL、模型名、API Key 和网络可达性。批量分析时可把 `MAX_PARALLEL` 降为 `1`，避免模型服务排队。

### 批量脚本遗漏应用

确认下面两个路径同时存在，并且 `<应用名>` 完全一致：

```text
groundtruth/permission/<应用名>.txt
input/app/<应用名>/
```
