# 权限标注（groundtruth/permission）完整方法与脚本

本仓库的权限 groundtruth 位于 `groundtruth/permission/<app>.txt`，用于评估“App 权限使用识别”的覆盖率与误报率。

由于仅靠正则扫描 `ohos.permission.*` 字符串可能遗漏（例如权限字符串被间接引用、或权限来自 SDK API 的隐式要求），这里采用“**多证据合并（union）**”的方法，尽可能全面地标注每个 App 的权限使用集合。

## 1.方法设计：多证据合并（union）

对每个 App，最终权限集合定义为：

> **Permissions(App) = Declared(App) ∪ InferredFromSdkUsage(App)**

### 1.1 Declared(App)：从 App 源码/配置中收集权限字符串

从 `input/app/<app>/` 全量扫描以下文件类型：

- 代码：`.ets` / `.ts` / `.js`
- 配置：`.json` / `.json5`（尤其是 `module.json5` 中的 `requestPermissions`）

提取规则：

- 通过正则提取所有 `ohos.permission.[A-Za-z0-9_]+` token
- 过滤测试目录（如 `src/ohosTest/`）与构建目录（如 `hvigor/`）

实现入口：

- `server/src/analyzer/permissions.ts` 的 `collectPermissionsFromApp`

### 1.2 InferredFromSdkUsage(App)：从 SDK API 使用推断权限

思路：如果 App 源码中调用了某些 SDK API，而 CSV 或 SDK 文档明确该 API 需要某权限，则可推断该 App 使用了对应权限。

数据来源（两条链路并行，取并集）：

1) **CSV 映射**：`input/csv/sdk_api_and_permission.csv`
- 将 “相关API” 归一化为 apiKey（如 `@ohos.net.http.HttpRequest.request`）
- 读取 “相关权限” 列中的权限 token（支持一格多权限、换行等情况）

2) **SDK 注释 `@permission`**：`input/sdk/.../ets/`
- 对应 API 的 JSDoc 中若存在 `@permission ohos.permission.X`，则直接提取

关键实现点：

- `server/src/analyzer/sinkAnalyzer.ts`：从 ArkTS AST 识别 SDK API 调用（sinks），并为每个 sink 绑定 `__apiKey` 与 `__permissions`
  - 支持**直接调用**（如 `router.pushUrl(...)`）
  - 支持**实例方法**（如 `const req = http.createHttp(); req.request(...)`，以及链式 `http.createHttp().request(...)`）
  - 支持 kit re-export 解析（`@kit.*` → `@ohos.*`）
- `server/src/analyzer/sdkDocStore.ts`：从 SDK 源码提取 `@permission`，并支持“工厂函数返回类型 → 实例类型”的推断（用于实例方法 sink）
- `server/src/analyzer/csvSupplement.ts`：增强 CSV apiKey 归一化，减少因格式差异导致的对不上号

## 2.脚本：生成 groundtruth/permission

推荐使用 Python 脚本（内部调用 Node/TS 的权限推断 CLI）：

```bash
python3 scripts/gen_permission_groundtruth.py
```

常用参数：

- 仅查看不写文件：
  - `python3 scripts/gen_permission_groundtruth.py --dry-run`
- 只生成单个 App：
  - `python3 scripts/gen_permission_groundtruth.py --app Wechat_HarmonyOS`
- 模式选择：
  - `--mode union`（默认，推荐）：Declared ∪ Inferred
  - `--mode declared`：仅字符串扫描
  - `--mode inferred`：仅 SDK API 推断
  - `--mode intersection`：两者交集（更保守）

如需在 Node/TS 侧复用 run 产物的权限评估逻辑，可直接从 `server/src/app/run.ts` 导入 `collectPredictedPermissionsFromRun` 和 `evaluatePermissionSets`。groundtruth 生成命令行当前建议使用上面的 Python 脚本。

## 3.项目逻辑更新：确保评估覆盖率 100%，误报率 < 5%

本仓库的“评估口径”是：从一次 run 产物目录中收集所有 `privacy_facts.json` 的 `permissionPractices[].permissionName` 作为预测集合 Pred，与 `groundtruth/permission/<app>.txt` 的集合 GT 对比。

为了让 Pred 覆盖 “Declared ∪ Inferred” 的完整 groundtruth：

- `server/src/analyzer/privacy/report.ts` 中的 `generatePrivacyReportArtifacts(...)` 会将：
  - App 源码/配置扫描出的权限
  - sinks 推断出的权限（`sinks.json` 中的 `__permissions` + CSV fallback）
  合并为 “knownAppPermissions”
- 然后对每个功能点的权限识别结果做过滤（降低幻觉误报）
- 并在 run 目录下生成一个 synthetic 功能点 `__app_permissions`，兜底补齐“已知但未被任何功能点数据流覆盖”的权限，确保评估覆盖率不受 LLM/数据流为空等情况影响

## 4.脚本：评估（Recall 与误报率）

Python 评估脚本：

```bash
python3 scripts/eval_permissions.py --app Wechat_HarmonyOS --run-id Wechat_HarmonyOS_20260306-212407 --details
```

指标：

- 覆盖率（Recall）= TP / |GT|
- 误报率（False Positive Rate）= FP / |Pred|
