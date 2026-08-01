# 个人信息 Ground Truth 与评估方法

个人信息 Ground Truth 位于 `groundtruth/personal_info.csv`，评估单位是“应用使用的个人信息数据项”。

## 标注方法

逐个检查应用源码并合并两类证据：

1. 敏感 API 的输入、输出数据，例如位置、运动健康数据、设备标识和支付参数。
2. `TextInput`、`TextArea`、`Search` 等组件接收的用户输入，例如账号、密码、姓名和搜索关键词。

每条标注记录应用、规范数据项名称、证据类型和源码/API证据。日志、生命周期状态、页面加载状态、普通业务内容不作为个人信息 Ground Truth。

## 评估方法

预测集合来自最新运行目录下全部 `privacy_facts.json` 的 `dataPractices[].dataItems[].name`。常见同义名称先归一化，再与 Ground Truth 按数据项集合比较：

- 信息感知数：TP
- 信息总数：GT
- 覆盖率：TP / GT
- 信息误报数：FP
- 信息预测数：Pred
- 误报率：FP / Pred

要素完整度针对每个 Ground Truth 数据项检查四项：业务场景、数据操作、操作主体、隐私数据项。具体内容计 1 分，证据不足的模板化内容计 0.5 分，缺失或“未识别”计 0 分；未感知的数据项四项均记为缺失。
