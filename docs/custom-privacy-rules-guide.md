# 自定义隐私数据项和描述规则

本文说明如何通过 `input/csv/` 下的 CSV 文件，为 OH-Senstive-Flow 增加隐私数据项、调整数据项名称，并向隐私报告生成过程补充描述要求。最简单的方式是直接编辑 `privacy_rules.csv`，无需修改 TypeScript 代码。

所有命令默认在项目根目录执行。

## 1. 配置文件

与隐私识别和报告描述相关的文件如下：

| 文件 | 作用 |
| --- | --- |
| `input/csv/privacy_rules.csv` | 自定义隐私数据项关键词和隐私报告描述规则 |
| `input/csv/sdk_api_and_permission.csv` | API 的行为描述、权限和敏感数据映射 |
| `input/csv/sdk_api_permission_override.csv` | 补充 SDK/第三方 Kit API 的权限和数据项映射 |
| `input/csv/sdk_api_description_override.csv` | 补充缺少 SDK 注释的 API 描述 |
| `input/csv/risk_level.csv` | 风险分类数据；当前版本不会直接参与分析结果计算 |

如果只想添加一个源码变量对应的隐私数据项，只需要修改 `privacy_rules.csv`。

## 2. 自定义隐私数据项

### 2.1 CSV 格式

`privacy_rules.csv` 的表头必须保持为：

```csv
type,keywords,outputName,rule
```

新增一行 `type=data_item`：

```csv
data_item,employeeId|工号,员工编号,
```

字段含义：

- `type`：填写 `data_item`。
- `keywords`：源码或分析结果中用于匹配的关键词，多个关键词用英文竖线 `|` 分隔。
- `outputName`：匹配成功后在隐私报告和数据项列表中使用的名称。
- `rule`：当前数据项规则不使用此列，留空即可。

例如，若应用源码包含：

```ts
const employeeId = 'A001';
```

可以配置：

```csv
data_item,employeeId|工号,员工编号,
```

分析时会把该匹配归一为“员工编号”。

### 2.2 匹配方式和注意事项

- 匹配是简单的关键词包含匹配，不是完整的正则表达式。
- 匹配不区分英文字母大小写。
- `keywords` 中的 `|` 只表示“多个候选关键词”，不要写成正则表达式语法。
- 关键词可以是英文变量名、中文注释、字符串片段或 API/类型名称。
- `outputName` 应使用稳定、简短、面向用户的中文名称，因为它会直接进入报告。
- 同一个 `outputName` 可以被多个规则匹配；结果中通常只保留一个数据项。
- 规则文件使用 UTF-8 编码，建议保留 UTF-8 BOM 兼容中文表格软件导出的文件。

更多示例：

```csv
data_item,healthRecord|健康记录,健康数据,
data_item,deviceSerial|设备序列号,设备序列号,
data_item,avatarUrl|头像地址|头像,头像图片,
data_item,chatText|聊天内容,聊天内容,
```

### 2.3 数据项规则的作用范围

规则会用于扫描应用源码中的 `.ets`、`.ts`、`.js` 和 `.json`/`.json5` 文件，也会用于整理数据流或模型输出中的数据项名称。被匹配到的数据项可以进入功能点隐私事实和最终隐私报告。

因此，添加规则后必须重新运行分析；修改 CSV 不会自动更新已有的 `output/<app>/<timestamp>/` 结果。

## 3. 自定义描述规则

在同一个 `privacy_rules.csv` 中增加 `type=description_rule` 的行：

```csv
description_rule,,,业务场景必须描述用户正在使用的具体功能
description_rule,,,处理方式使用“收集”“读取”“存储”“上传”或“共享”等明确动词
description_rule,,,没有更具体证据时，处理主体统一写为“本应用”
```

描述规则使用 `rule` 列，`keywords` 和 `outputName` 留空。项目会把这些文本附加到隐私报告 LLM 的提示词中。例如：

```csv
type,keywords,outputName,rule
description_rule,,,业务场景必须结合页面名称和功能名称描述
description_rule,,,处理目的必须说明为什么需要该数据
description_rule,,,不要使用“相关功能”“相关页面”等空泛表述
```

### 3.1 描述规则的性质

描述规则属于提示约束，不是严格的模板替换：

- 它会影响隐私报告生成内容和措辞；
- 它不能保证每次 LLM 输出完全一致；
- 需要实际启用隐私报告 LLM 时才会体现效果；
- 规则应写成清晰、可执行的一句话，避免互相矛盾。

项目自身仍会执行 JSON 格式、数据流引用和部分字段完整性校验。自定义描述规则不能绕过这些校验。

## 4. 自定义 API 描述、权限和数据项

如果隐私数据项来自某个 SDK API，而源码关键词不足以识别，可以同时配置 API 映射。

### 4.1 API 描述

编辑 `sdk_api_description_override.csv`：

```csv
api,description
@ohos.example.service.read,读取用户的员工编号信息
@kit.ExampleKit.service.submit,提交用户填写的业务资料
```

API 名称应使用分析器识别到的规范形式，例如 `@ohos.xxx` 或 `@kit.xxx`。该文件主要用于补充 SDK 中没有注释的 API 描述。

当前描述来源优先级大致为：SDK 注释，其次是 `sdk_api_and_permission.csv`，最后是 `sdk_api_description_override.csv`。因此，override 文件不一定覆盖 SDK 自带描述。

### 4.2 API 权限和数据项

编辑 `sdk_api_permission_override.csv`：

```csv
相关API,相关权限,敏感数据项,敏感数据子项
@kit.ExampleKit.service.read,ohos.permission.INTERNET,员工编号,员工信息
@kit.ExampleKit.service.upload,ohos.permission.INTERNET,业务资料,用户提交内容
```

对于 OpenHarmony SDK API，也可以在 `sdk_api_and_permission.csv` 中增加对应行：

```csv
敏感行为,行为子项,相关API,相关权限,敏感数据项,敏感数据子项
业务资料上传,提交资料,@ohos.example.service.upload,ohos.permission.INTERNET,业务资料,用户提交内容
```

权限名称应使用完整的 `ohos.permission.*` 形式。多个权限可以按现有文件格式写在同一个单元格中。

## 5. 运行和检查配置

修改规则后，用一个小应用先验证：

```bash
npm run analyze -- \
  --appPath input/app/Test_user_info/ \
  --sdkPath input/sdk/default/openharmony/ets/ \
  --csvDir input/csv/ \
  --graphBackend heuristic \
  --maxDataflowPaths 2
```

需要验证 CPG 时，将后端改为：

```bash
--graphBackend cpg
```

分析完成后检查最新输出目录：

```bash
run=$(find output/Test_user_info -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
cat "$run/meta.json"
cat "$run/privacy_report.json"
```

可以重点搜索自定义名称：

```bash
rg '员工编号|健康数据|业务资料' "$run"
```

如果需要重新评估所有应用：

```bash
python3 scripts/eval_all.py
```

评估结果写入：

```text
output/evaluation/permission_evaluation.csv
output/evaluation/personal_info_evaluation.csv
```

## 6. 常见问题

### 修改后结果没有变化

确认运行命令中的 `--csvDir` 指向包含修改文件的目录，并且运行的是新的时间戳目录。已有输出不会自动重算。

### 关键词没有被识别

关键词必须实际出现在应用源码或数据流证据中。可以先在应用目录搜索：

```bash
rg -n 'employeeId|工号' input/app/Test_user_info
```

关键词包含标点或空格时，建议同时添加更短、更稳定的变量名作为候选关键词。

### 描述规则没有完全遵守

这是预期行为：描述规则是提供给 LLM 的约束，不是确定性规则引擎。可以把要求写得更具体，或在生成结果后人工检查 `privacy_report.json`。

### `risk_level.csv` 修改没有影响报告

当前版本不会直接读取该文件参与分析或报告生成。它不能单独改变数据项的识别、风险级别或评估指标。

## 7. 最小配置模板

如果只需要新增一个数据项和两条描述要求，可以把以下内容追加到 `input/csv/privacy_rules.csv`：

```csv
data_item,employeeId|工号,员工编号,
description_rule,,,业务场景必须描述用户正在使用的具体功能
description_rule,,,处理目的必须说明为什么需要该数据
```

保存后重新运行分析即可生效。
