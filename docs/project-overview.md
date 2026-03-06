# 项目功能、处理流程与产出说明

## 1. 项目是做什么的

这个项目是一套面向 **OpenHarmony ArkTS 应用** 的“**隐私声明报告生成工具**”。

它的目标不是只做代码扫描，而是把一段 App 源码逐步转成一组更容易给产品、合规、审计人员理解的结果：

1. 找出 App 里调用了哪些 OpenHarmony SDK API（尤其是可能涉及隐私、权限、系统能力的调用点）；
2. 找出哪些函数可以作为分析入口（例如 `build()`、`aboutToAppear()`、`onPageShow()` 等）；
3. 从入口走到 SDK 调用点，构建调用图与若干条重点数据流；
4. 识别页面、控件、页面间跳转关系，并把数据流归并到“页面 -> 功能点”；
5. 为每个功能点抽取隐私要素，最后生成可浏览、可跳转的隐私声明报告。

从工程结构看，它是一个前后端分离项目：

- `server/`：Express + TypeScript 的分析后端，负责扫描源码、调用 LLM、写出结果文件；
- `web/`：React + Vite 的前端，负责配置输入、启动分析、展示表格/图/报告页面。

## 2. 它解决的核心问题

如果直接阅读 ArkTS 源码，往往很难快速回答下面这些问题：

- 这个 App 到底调用了哪些系统 API？
- 哪些页面和功能点涉及输入、权限、文件、媒体、窗口、路由等能力？
- 用户数据是从哪里进入的，又是如何一路流到某个调用点的？
- 最后能不能落成一份可读、可追溯、可点击回溯源码的隐私声明草案？

这个项目就是把这些问题串成一条自动化流水线。

## 3. 输入是什么

分析时，前端首页会让用户配置三类主要输入，以及三组 LLM 参数：

### 3.1 目录输入

- `appPath`：待分析 App 源码目录；
- `sdkPath`：OpenHarmony SDK 声明文件目录；
- `csvDir`：CSV 补充信息目录。

默认值在 `server/src/analyzer/defaults.ts` 中：

- `input/app/Wechat_HarmonyOS/`
- `input/sdk/default/openharmony/ets/`
- `input/csv/`

### 3.2 LLM 输入

前端会分别配置三组模型参数：

- **数据流 LLM**：用于从调用路径扩展出更完整的数据流；
- **UI LLM**：用于给页面节点、控件节点生成更自然的人类可读标题；
- **报告 LLM**：用于抽取每个功能点的隐私事实。

要注意一个实现细节：

- 最终 `privacy_report.json` / `privacy_report.txt` 的段落拼装本身是**确定性代码生成**；
- 但每个功能点的 `privacy_facts.json` 里很多隐私要素，是先通过 LLM 抽取，再汇总成最终报告。

### 3.3 CSV 输入目前主要承担什么作用

代码里当前主流程实际会读取两类 CSV 信息：

1. **带 `相关API` 列的 CSV**，用于补充 API 描述和 API -> 权限映射；
2. `sdk_api_description_override.csv`，用于手工覆盖 SDK 注释缺失时的 API 描述。

也就是说，`csvDir` 不是一个“纯展示目录”，而是会直接影响 sink 描述、权限映射、隐私报告内容。

## 4. 用一个贯穿全文的例子来理解：`Wechat_HarmonyOS` 的 `SearchPage`

下面我用仓库里已经存在的一次实际运行结果来串起整个流程。

这次运行的 `runId` 是：

- `Wechat_HarmonyOS_20260305-171612`

对应输出目录是：

- `output/Wechat_HarmonyOS/20260305-171612`

这次运行的总体统计写在 `output/Wechat_HarmonyOS/20260305-171612/meta.json`：

- 扫描 App 文件数：31
- 识别到 sink：46
- 识别到 source：29
- 调用图节点：53
- 调用图边：44
- 数据流：10
- UI 树节点：37
- 页面数：3
- 页面功能点数：3

贯穿全文的例子选用：

- 页面源码：`input/app/Wechat_HarmonyOS/entry/src/main/ets/pages/search/SearchPage.ets`
- 页面：`SearchPage`
- 其中一个功能点：`搜索输入框`
- 对应 featureId：`ui_SearchPage_a32b61eb8a`

这个例子很合适，因为它同时覆盖了：

- `build()` 入口识别；
- `TextInput` 输入控件识别；
- `prompt.showToast()` 这类 SDK sink 调用；
- `POPUPWINDOW` 权限；
- 最终隐私报告中的“用户输入的搜索文本”。

## 5. 输入经过了哪些处理流程

这一节按后端的真实执行顺序来讲，对应 `server/src/analyzer/runAnalysis.ts` 中的主流程。

### 5.1 第一步：校验输入路径

后端先把 `appPath`、`sdkPath`、`csvDir` 解析成绝对路径，然后检查这些目录是否可访问。

如果目录本身不可读，流程会直接报错，不会进入分析阶段。

### 5.2 第二步：创建 `runId` 与输出目录

后端会根据 App 目录名推断 `appName`，再拼接时间戳生成：

- `runId = <appName>_<timestamp>`

例如这次样例运行生成的是：

- `Wechat_HarmonyOS_20260305-171612`

然后建立目录：

- `output/Wechat_HarmonyOS/20260305-171612/`

从这一步开始，本次运行的所有产物都会落到这个目录下。

### 5.3 第三步：构建 SDK 索引

后端会遍历 `sdkPath` 下的 `.d.ts` / `.d.ets` 文件，把文件名形如 `@ohos.xxx`、`@kit.xxx` 的声明文件索引起来。

这一步的目的是建立：

- `模块名 -> SDK 声明文件`

后续在识别 sink 时，就能把业务代码里的 import 绑定回 SDK 模块，再进一步拿到：

- API 名称；
- SDK 注释；
- CSV 补充描述；
- 权限映射。

### 5.4 第四步：扫描 App ArkTS 文件

App 扫描不是全仓库无差别扫描，而是默认只扫：

- `entry/src/main/ets`

并只看：

- `.ets`
- `.ts`

这意味着它的定位很明确：主要分析 ArkTS 主体源码，而不是把构建产物、依赖目录、临时目录混进来。

### 5.5 第五步：加载 CSV 补充描述与覆盖描述

后端会从 `csvDir` 中加载两类信息：

1. **API 描述补充**：把 CSV 中的“敏感行为 / 行为子项 / 相关权限 / 敏感数据项”等信息拼成说明文本；
2. **API 描述覆盖**：如果 SDK 注释拿不到，优先回退到 `sdk_api_description_override.csv`。

因此，sink 的“API功能描述”不是只依赖 SDK 原始注释，而是有多层回退：

1. SDK 注释；
2. CSV 描述；
3. override CSV；
4. 如果都没有，则输出“请在 override CSV 补充描述”。

### 5.6 第六步：分析 sink（敏感/关键 SDK 调用点）

这是后端最核心的一步之一，对应 `server/src/analyzer/sinkAnalyzer.ts`。

它的做法是：

1. 先解析 ArkTS 文件中的 SDK import；
2. 建立 `localName -> import binding` 映射；
3. 用 token 扫描去找三类调用：
   - `LocalName(...)`
   - `LocalName.method(...)`
   - `new LocalName(...)`
4. 再把调用点回溯到具体 SDK API；
5. 给每条 sink 记录补上文件、行号、调用代码、API 描述、内部 `__apiKey` 等信息。

输出结果会写成：

- `sinks.json`
- `sinks.csv`

#### 贯穿例子怎么落在这一步

在 `SearchPage.ets` 里，页面使用了：

- `prompt.showToast(...)`
- `window.getLastWindow(...)`
- `router.back()`

这些都会被当作 SDK 相关调用点候选；如果成功关联到 SDK 声明和补充描述，就会形成 sink 记录。

更典型的样例可见 `output/Wechat_HarmonyOS/20260305-171612/sinks.json`，其中包含类似：

- `@ohos.file.fs.openSync`
- `@ohos.multimedia.audio.createAudioCapturer`
- `@ohos.abilityAccessCtrl.createAtManager`

这说明 sink 层面对“系统能力调用”是有统一建模的。

### 5.7 第七步：分析 source（入口函数 / 生命周期）

source 分析对应 `server/src/analyzer/sourceAnalyzer.ts`，规则相对明确：

- 扫描函数定义行；
- 只匹配一批预设的入口函数名。

例如：

- `build`
- `aboutToAppear`
- `aboutToDisappear`
- `onPageShow`
- `onBackPress`
- `onCreate`
- `onWindowStageCreate`

输出结果会写成：

- `sources.json`
- `sources.csv`

#### 贯穿例子怎么落在这一步

对 `SearchPage.ets` 来说，至少会识别到：

- `aboutToAppear()`：页面即将显示时触发；
- `onBackPress()`：返回键回调；
- `build()`：ArkUI UI 构建入口。

在样例输出 `sources.json` 里，能看到：

- `SearchPage.ets:16 aboutToAppear`
- `SearchPage.ets:24 onBackPress`
- `SearchPage.ets:28 build`

这一步的意义是：后续调用图、路径提取、数据流扩展都会从这些 source 出发。

### 5.8 第八步：构建调用图（Call Graph）

调用图构建对应 `server/src/analyzer/callGraph/buildCallGraph.ts`。

它大致做了这些事情：

1. 扫描文件里的函数块；
2. 为函数建立 `function` 节点；
3. 为 source 打上 `source` 类型；
4. 为 sink 调用点建立 `sinkCall` 节点；
5. 识别函数间调用边 `calls`；
6. 识别“函数包含某个 sink 调用”的边 `containsSink`；
7. 最后只保留“位于某条 source -> sink 路径上的节点和边”。

输出结果写成：

- `callgraph.json`

并在前端展示为调用图页面。

#### 贯穿例子怎么落在这一步

在样例 `callgraph.json` 中，`SearchPage.ets:28 build` 被标记为 `source` 节点。后续图上只保留那些真正能通到 sink 的路径相关节点。

这样做的好处是：

- 图不会无限膨胀；
- 用户看到的不是“全项目所有函数”，而是“和 source -> sink 分析真正有关的子图”。

另外，如果提供了数据流 LLM 的 API Key，系统还会尝试给中间函数补一句简短说明，提升图的可读性。

### 5.9 第九步：从调用图中提取若干条重点路径

不是每一条 source -> sink 路径都拿去做后续数据流扩展。

后端会根据 `maxDataflowPaths` 从调用图中抽取若干条代表性路径；现在默认是**不限制条数**，也可以手动填写一个正整数来收敛分析范围。

也就是说，调用图是“较完整的结构视图”，而数据流是“沿这些路径做进一步语义展开”；如果不填写限制，则会尽量覆盖所有可达路径。

### 5.10 第十步：生成数据流（DataFlow）

这一步对应 `server/src/analyzer/dataflow/buildDataflows.ts`，也是整个系统里最“语义化”的一步。

对每一条调用路径，后端会把以下证据打包给 LLM：

- 调用图锚点路径；
- source 描述；
- sink 详情；
- 锚点周围的源码片段。

然后要求 LLM 返回：

- 更细的节点序列；
- 节点间边；
- 数据流摘要（如数据项、频率、云上传、存储加密、权限）。

这里有两个很重要的保护措施：

1. **LLM 输出必须包含所有锚点**；
2. 如果 LLM 漏掉锚点，系统会自动插入占位节点，保证路径不丢证据。

输出结果写成：

- `dataflows.json`

#### 贯穿例子怎么落在这一步

在样例文件 `output/Wechat_HarmonyOS/20260305-171612/pages/SearchPage/features/ui_SearchPage_a32b61eb8a/dataflows.json` 中，功能点“搜索输入框”下有 5 条数据流。

其中 `flow:p2` 很典型，节点大致包括：

1. `build()` 入口；
2. `TextInput({ text: this.searchText, ... })`；
3. `.onKeyEvent((event: KeyEvent) => { ... })`；
4. `prompt.showToast({ ... })`。

这条流把“界面输入 -> 事件处理 -> SDK 调用”连接起来了。

如果数据流 LLM 的 API Key 为空，这一步会被跳过，但调用图仍然会生成；`dataflows.json` 会带上 `skipped` 和 `skipReason`。

### 5.11 第十一步：生成 UI 树（UI Tree）

这一步对应 `server/src/analyzer/uiTree/buildUiTree.ts`。

它不是简单做 AST dump，而是把 ArkUI 结构整理成可视化友好的树：

- 页面节点：`Page`
- 按钮类节点：`Button`
- 输入类节点：`Input`
- 展示类节点：`Display`
- 其它组件节点：`Component`

同时，它还会：

- 识别 `@Entry` / 页面 struct；
- 在 `build()` 中扫描组件声明；
- 尝试识别 `router.pushUrl` / `router.replaceUrl` / `router.back` 一类导航；
- 通过规则 + LLM，为节点生成更自然的中文标题。

输出结果写成：

- `ui_tree.json`

以及页面切片后的：

- `pages/<pageId>/ui_tree.json`

#### 贯穿例子怎么落在这一步

样例 `pages/SearchPage/ui_tree.json` 中，可以看到：

- 页面节点 `SearchPage` 被描述为“搜索页面”；
- `TextInput` 被识别成 `Input`，标题是“搜索输入框”；
- `Text("取消")` 被识别成 `Button`，标题是“取消”；
- 多个 `Text` / `Image` 组件被归为展示或交互节点。

这一步非常关键，因为后面的“页面 -> 功能点”分层，就是建立在 UI 树之上的。

### 5.12 第十二步：把数据流聚合成“页面 -> 功能点”

这一步对应 `server/src/analyzer/pages/buildPageFeatureGroups.ts`。

系统会把全量数据流进一步归类为：

- 某个页面下的某个功能点；
- 或者少数无法归类的未分配流。

功能点可能来自两类锚点：

- **UI 功能点**：例如某个输入框、按钮、页面区域；
- **source 功能点**：如果 UI 锚点不明显，则退回到 source 入口函数。

输出结果会写成：

- `pages/index.json`
- `pages/<pageId>/features/index.json`
- `pages/<pageId>/features/<featureId>/dataflows.json`

#### 贯穿例子怎么落在这一步

在样例 `pages/SearchPage/features/index.json` 中，`SearchPage` 被拆成两个功能点：

1. `搜索页面`
2. `搜索输入框`

其中“搜索输入框”就是：

- `featureId = ui_SearchPage_a32b61eb8a`

这说明系统没有把整页所有逻辑混成一团，而是继续收敛到更细粒度的“页面功能”。

### 5.13 第十三步：抽取每个功能点的隐私事实

这一步对应 `server/src/analyzer/privacyReport/extractFeaturePrivacyFacts.ts` 与 `generatePrivacyReportArtifacts.ts`。

对每个功能点，系统会综合：

- 该功能点的数据流；
- 页面 UI 树；
- 对应 source 入口；
- CSV 中 API -> 权限映射；

生成一个中间文件：

- `pages/<pageId>/features/<featureId>/privacy_facts.json`

其中包含两类结构化事实：

- `dataPractices`：数据来源、数据项、处理方式、处理目的、存储方式等；
- `permissionPractices`：权限名、用途、拒绝后影响等。

#### 贯穿例子怎么落在这一步

样例文件：

- `output/Wechat_HarmonyOS/20260305-171612/pages/SearchPage/features/ui_SearchPage_a32b61eb8a/privacy_facts.json`

其中已经抽取出：

- 数据项：`用户输入的搜索文本`
- 数据来源：`用户键盘输入`
- 处理目的：`响应用户搜索请求，提供搜索内容提示及交互反馈`
- 权限：`ohos.permission.POPUPWINDOW`

这已经非常接近一份隐私声明里的业务语言了。

另外，这一步还会把 CSV 中能确定映射出的权限补进来，因此权限部分并不完全依赖 LLM。

### 5.14 第十四步：生成最终隐私声明报告

最后一步会汇总所有功能点，生成两份最终报告：

- `privacy_report.json`
- `privacy_report.txt`

其中：

- `privacy_report.json` 是前端可交互版本；
- `privacy_report.txt` 是纯文本版，适合导出或人工再编辑。

JSON 版最大的特点是：

- 段落被拆成 token；
- 某些 token 带 `jumpTo`，能够跳回具体的 `featureId / flowId / nodeId`。

#### 贯穿例子怎么落在这一步

在样例 `privacy_report.json` 中，关于“搜索输入框”功能点，可以看到类似表述：

- 会从“用户键盘输入”收集“用户输入的搜索文本”；
- 用于响应用户搜索请求、提供提示和反馈；
- 涉及 `ohos.permission.POPUPWINDOW` 权限。

而且这些文本中的“用户输入的搜索文本”或权限名，不只是静态文案，它们还带有 `jumpTo`，前端点击后会自动定位到对应的数据流节点。

## 6. 最终会输出哪些文件

先看一眼一次运行的主要目录结构（以 `Wechat_HarmonyOS_20260305-171612` 为例）：

```text
output/
├── _runs/
│   ├── latest.json
│   └── Wechat_HarmonyOS_20260305-171612.json
└── Wechat_HarmonyOS/
    └── 20260305-171612/
        ├── meta.json
        ├── sinks.json
        ├── sinks.csv
        ├── sources.json
        ├── sources.csv
        ├── callgraph.json
        ├── dataflows.json
        ├── ui_tree.json
        ├── privacy_report.json
        ├── privacy_report.txt
        └── pages/
            ├── index.json
            ├── SearchPage/
            │   ├── ui_tree.json
            │   └── features/
            │       ├── index.json
            │       ├── ui_SearchPage_4d8a2d1c8d/
            │       │   ├── dataflows.json
            │       │   └── privacy_facts.json
            │       └── ui_SearchPage_a32b61eb8a/
            │           ├── dataflows.json
            │           └── privacy_facts.json
            └── ...
```

下面逐个解释这些文件。

### 6.1 运行索引文件

- `output/_runs/latest.json`：记录最近一次运行；
- `output/_runs/<runId>.json`：记录某次运行对应的输出目录。

前端首页的 runId 下拉框，和“未指定 runId 时读取 latest”的逻辑，都依赖这些注册文件。

### 6.2 总览文件

- `meta.json`

里面记录：

- 本次输入路径；
- 使用的模型名；
- 扫描文件数；
- sink/source/调用图/数据流/UI 树/页面/功能点数量。

这是判断一次分析是否成功、规模大概多大的最快入口。

### 6.3 sink / source 文件

- `sinks.json`、`sinks.csv`
- `sources.json`、`sources.csv`

适合做表格展示和人工审阅。

其中：

- sink 更像“系统能力调用清单”；
- source 更像“可作为分析入口的页面/生命周期清单”。

### 6.4 图结构文件

- `callgraph.json`
- `dataflows.json`
- `ui_tree.json`

它们分别对应：

- 调用图；
- 全局重点数据流；
- 全局 UI 树。

### 6.5 页面与功能点分层文件

- `pages/index.json`
- `pages/<pageId>/ui_tree.json`
- `pages/<pageId>/features/index.json`
- `pages/<pageId>/features/<featureId>/dataflows.json`

这些文件把“全局结果”切成了“页面局部结果”和“功能点局部结果”，非常适合前端 drill-down 展示。

### 6.6 隐私事实与最终报告文件

- `pages/<pageId>/features/<featureId>/privacy_facts.json`
- `privacy_report.json`
- `privacy_report.txt`

三者关系可以理解为：

1. `privacy_facts.json`：功能点级的结构化隐私事实；
2. `privacy_report.json`：把多个功能点编织成可点击跳转的报告；
3. `privacy_report.txt`：纯文本落地版本。

## 7. 前端会展示哪些可视化界面

前端路由定义在 `web/src/App.tsx`，共有 6 个核心页面。

### 7.1 首页 `/`

首页是整个系统的控制台，主要功能有：

- 配置 `App 源码路径 / SDK 路径 / CSV 目录`；
- 配置三组 LLM 参数；
- 选择历史 `runId`；
- 点击“开始分析”；
- 查看分析进度条和当前阶段；
- 跳转到其它结果页。

它相当于“任务提交 + 结果导航”的入口页。

### 7.2 sink 页面 `/sinks`

这是一个表格页，用来展示 `sinks.json` 内容，重点列包括：

- App 源码文件路径；
- 导入行号、导入代码；
- 调用行号、调用代码；
- API 功能描述。

适合快速回答“项目到底调用了哪些系统 API”。

### 7.3 source 页面 `/sources`

这也是一个表格页，展示 `sources.json` 内容，重点列包括：

- 文件路径；
- 行号；
- 函数名；
- 描述。

适合快速回答“分析是从哪些函数开始展开的”。

### 7.4 调用图页面 `/callgraph`

这个页面把 `callgraph.json` 画成图。

图上的节点分成三类：

- `source`
- `function`
- `sinkCall`

用户可以：

- 点击节点查看说明；
- 查看该节点对应的源码路径与行号；
- 在支持的环境里通过链接打开本地编辑器定位源码。

它解决的是“结构上怎么连起来”的问题。

### 7.5 数据流页面 `/dataflows`

这个页面展示 `dataflows.json` 或某个 feature 的 `dataflows.json`，是整个系统里最有“解释力”的页面。

它的特点是：

- 如果当前 run 有 `pages/index.json`，页面会自动进入“页面 -> 功能点”模式；
- 否则会回退到全量 DataFlow 平铺模式；
- 用户可以选择页面、功能点、具体路径；
- 左侧显示图，右侧显示当前节点的详细信息。

右侧明细包含：

- 文件路径；
- 行号；
- 当前代码；
- 附近代码上下文；
- 节点描述。

#### 贯穿例子在这个页面怎么体现

如果选择：

- 页面：`SearchPage`
- 功能点：`搜索输入框`

就能看到该功能点下的 5 条路径，并选中某一条路径中的某个节点，例如：

- `TextInput(...)`
- `.onKeyEvent(...)`
- `prompt.showToast(...)`

这时右侧会同步显示该节点附近源码与说明，非常适合审阅“这段文案到底是从哪段代码推出来的”。

### 7.6 隐私声明报告页面 `/privacy-report`

这个页面展示 `privacy_report.json`，最终效果是“接近成品文档”的阅读界面。

报告被分成两个部分：

1. 我们如何收集和使用您的个人信息；
2. 设备权限调用。

它的最大亮点是：

- 报告中的关键 token 可以点击；
- 点击后直接跳到 `/dataflows` 对应的 feature / flow / node；
- 等于把“合规文案”与“代码证据”连起来了。

#### 贯穿例子在这个页面怎么体现

在“搜索输入框”这个功能点里，报告里会出现：

- “用户输入的搜索文本”
- `ohos.permission.POPUPWINDOW`

点击这些文字，页面会跳到具体数据流节点，而不是只给一段无法追溯的报告文本。

## 8. 可以把整个项目理解成一条什么样的流水线

如果用一句话总结，这个项目的流水线是：

**App 源码 + SDK 声明 + CSV 补充 -> source/sink -> 调用图 -> 数据流 -> UI 树 -> 页面/功能点 -> 隐私事实 -> 可跳转的隐私声明报告**

换成更业务化的表达，就是：

1. 先从代码里找证据；
2. 再把证据组织成结构；
3. 再把结构转成页面和功能；
4. 最后把页面和功能翻译成隐私报告语言。

## 9. 这个项目的几个重要特点

### 9.1 它不是只做“API grep”

它并不是简单搜一遍 `@ohos` 字符串，而是把：

- import 绑定；
- SDK 声明索引；
- 调用位置；
- source 入口；
- 页面 UI；
- 功能点分层；
- 报告 token 跳转；

这些串在了一起。

### 9.2 它同时产出“中间结果”和“最终结果”

很多分析项目只给一个最终报告，但这个项目把中间层都保留下来了：

- sink/source 表；
- 调用图；
- 数据流；
- UI 树；
- feature 级 privacy facts。

这让使用者可以逐层排查，而不是只能“相信最终答案”。

### 9.3 它对 LLM 依赖是分层的

不是所有步骤都完全依赖 LLM。

- 路径校验、文件扫描、source/sink 识别、调用图骨架、页面分层、权限 CSV 补充，都是确定性逻辑；
- 数据流扩展、UI 标题润色、功能点隐私事实抽取，才是主要依赖 LLM 的部分。

这使得项目即使在 LLM 能力受限时，也能输出一部分稳定结果。

## 10. 用一句收尾

如果把这套系统比作一名“自动化隐私分析助手”，那么它做的事情可以概括为：

- **先看懂代码，**
- **再看懂页面和功能，**
- **最后把代码证据转成可审阅、可追溯的隐私声明。**

而 `SearchPage -> 搜索输入框 -> 用户输入的搜索文本 -> POPUPWINDOW 权限 -> 报告中的可点击文案`，正好就是这条链路在仓库里的一个完整缩影。
