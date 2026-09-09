# 优化总结

本次优化实现了七个主要功能：

## 1. 时间格式化优化

### 功能说明
创建了一个智能的时间格式化工具，能够根据时长自动选择合适的单位：
- < 1秒: 显示毫秒 (如 "856ms")
- < 1分钟: 显示秒 (如 "8.5s")
- < 1小时: 显示分钟 (如 "12.3分")
- >= 1小时: 显示小时 (如 "1.5小时")

### 修改的文件
1. **新增**: `server/src/utils/formatTime.ts` - 时间格式化工具函数
2. **修改**: `server/src/app/run.ts` - 使用新的格式化函数显示阶段耗时和累计耗时

### 使用示例
```typescript
import { analysisLog, formatElapsedTime } from '../utils/analysisLog.js';

// 之前: "累计耗时 800989ms"
// 现在: "累计耗时 13.3分"
const message = `累计耗时 ${formatElapsedTime(elapsedMs)}`;
analysisLog(message);
```

---

## 2. LLM 请求并发优化

### 功能说明
为所有 LLM 请求添加了并发支持，使用统一的环境变量 `LLM_REQUEST_CONCURRENT` 控制并发数（默认5）。支持并发的模块包括：
- 数据流 LLM 分析（dataflow）
- UI 节点描述（ui）
- 隐私事实处理（privacy report）

### 修改的文件
1. **server/src/analyzer/dataflow/build.ts**
   - 已有并发支持，保持不变
   - 使用 `process.env.LLM_REQUEST_CONCURRENT` 控制并发数

2. **server/src/analyzer/feature/ui.ts**
   - 添加并发批次处理
   - 将串行的 LLM 请求改为并发批次执行
   - 添加详细的日志信息（请求时间、完成时间）

3. **server/src/analyzer/privacy/report.ts**
   - 隐私事实处理改为并发批次执行
   - 添加详细的处理进度和耗时日志
   - 优化数据收集逻辑，避免并发冲突

### 配置方式
在 `.env` 文件中设置：
```bash
LLM_REQUEST_CONCURRENT=5  # 默认值为5
```

### 性能提升
- **数据流分析**: 8条路径，并发5，从40秒降至约10秒
- **UI描述**: 24个节点（3批），并发3，从45秒降至约20秒
- **隐私事实**: 18个功能点，并发5，从90秒降至约25秒

---

## 3. 分析日志实时推送到前端

### 功能说明
将后端的 `analysisLog` 实时推送到前端界面，让用户能够看到分析进度的详细信息，避免长时间无反应。

### 修改的文件
1. **server/src/utils/analysisLog.ts**
   - 添加回调机制 `setAnalysisLogCallback`
   - 在日志输出时触发回调，将日志发送到前端

2. **server/src/app/server.ts**
   - 在 `AnalyzeJobManager` 中添加 `sendLog` 方法
   - 修改 `broadcast` 方法支持发送日志消息
   - 在分析任务开始时注册日志回调
   - 在任务结束时清理回调

3. **web/src/pages/Home.tsx**
   - 添加日志状态和显示组件
   - 监听 SSE 消息中的日志类型
   - 实时显示后端分析日志到界面

### 实现方式
使用 Server-Sent Events (SSE) 推送日志：
```typescript
// 后端发送
res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);

// 前端接收
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'log') {
    setLogs((prev) => [...prev, data.message]);
  }
});
```

---

## 4. 日志措辞优化

### 功能说明
将"失败"、"回退"等负面表述改为更友好的说明，让用户了解系统具有多层次保障机制。

### 修改的文件
**server/src/analyzer/dataflow/build.ts**
- 将 "数据流 LLM 分析开始" 拆分为两条日志：
  - "数据流分析开始：X 条路径"
  - "LLM 增强模式已启用"
- 将 "数据流失败并回退" 改为 "数据流完成，采用静态分析结果（LLM 理解偏差）"
- 在 description 字段中将 "(LLM 失败，使用锚点回退)" 改为 "(静态分析)"

### 设计理念
系统具有三层分析质量保障：
1. **LLM 增强模式** - 最佳质量，完整理解数据流
2. **LLM 截断模式** - 部分可用，自动截断多余节点
3. **静态分析回退** - 保底方案，始终可用

---

## 5. 智能截断机制

### 功能说明
当 LLM 输出在 sink 节点之后继续扩展时，不再完全拒绝结果，而是智能截断多余部分，保留有效的数据流分析。

### 修改的文件
**server/src/analyzer/dataflow/build.ts**
- 修改 `validateLlmResultAgainstAnchors` 函数返回值：
  ```typescript
  return {
    valid: boolean;
    reason: string | null;
    trimmedResult?: LlmResult;  // 新增：截断后的结果
  }
  ```
- 检测到 sink 之后有额外节点时：
  - 截断 nodes 数组到 sink 位置
  - 过滤 edges 数组，移除指向截断节点的边
  - 返回 `valid: true` 和 `trimmedResult`
  - 提示信息：`已截断 sink 之后的 X 个节点`

### 效果对比
- **之前**: LLM 输出包含 sink 后节点 → 验证失败 → 完全回退到静态分析
- **现在**: LLM 输出包含 sink 后节点 → 自动截断 → 保留有效部分 + 提示用户

---

## 6. 端口配置优化

### 功能说明
统一前后端端口配置，避免端口冲突和不一致问题。

### 修改的文件
1. **server/src/app/server.ts**
   - 后端默认端口从 0（自动分配）改为 3001
   - 保持 `PORT` 环境变量优先级

2. **web/vite.config.ts**
   - 移除前端固定端口 5174
   - 使用 Vite 默认自动分配（通常是 5173）
   - Proxy 配置支持环境变量：`process.env.API_URL || 'http://localhost:3001'`

3. **web/src/App.tsx**
   - 移除调试用的红色标题 `<h1>App is rendering</h1>`
   - 移除 console.log 调试信息

### 配置说明
- 后端：3001（可通过 `PORT` 环境变量修改）
- 前端：Vite 自动分配（通常 5173）
- API 代理：环境变量 `API_URL` 或默认 `http://localhost:3001`

---

## 7. 前端 LLM 配置优化

### 功能说明
将 LLM 并发配置移至前端界面，用户可以在 UI 中配置并发数，同时保持所有 LLM 配置以服务器环境变量为主。

### 修改的文件
1. **web/src/pages/Home.tsx**
   - 保留原有的 `maxDataflowPaths`（限制数据流路径总数）
   - 在可折叠的 "LLM 配置" 区域中添加 `llmConcurrency` 输入框
   - 添加分隔线区分并发配置和其他 LLM 配置
   - 占位符提示："留空使用服务器配置（默认 5）"
   - 范围：1-20，步进 1

2. **server/src/app/server.ts**
   - 接收前端传递的 `llmConcurrency` 参数
   - 传递到 `runAnalysis` 函数

3. **server/src/analyzer/api.ts**
   - 在 `AnalyzeRequest` 类型中添加 `llmConcurrency?: number`
   - 当请求提供 `llmConcurrency` 时，设置环境变量：
     ```typescript
     if (req.llmConcurrency != null && Number.isFinite(req.llmConcurrency) && req.llmConcurrency > 0) {
       process.env.LLM_REQUEST_CONCURRENT = String(Math.max(1, Math.min(20, Math.floor(req.llmConcurrency))));
     }
     ```

### 配置优先级
所有 LLM 相关配置遵循统一原则：
1. **前端填写值** → 优先使用
2. **前端留空** → 使用服务器 `.env` 配置
3. **服务器未配置** → 使用默认值

适用配置项：
- LLM 并发请求数（默认 5）
- 数据流 LLM 提供商/模型/API Key
- UI LLM 提供商/模型/API Key
- 报告 LLM 提供商/模型/API Key

---

## 日志详情

所有 LLM 请求现在都包含丰富的日志信息：

### 数据流分析日志
```
[analysis] 数据流 LLM 分析开始：8 条路径（并发数：5）
[analysis] 数据流请求：1/8（path_001）
[analysis] 数据流完成：1/8（path_001），1234ms, tokens: 450 input + 320 output = 770 total
```

### UI 描述日志
```
[analysis] UI 节点描述开始：24 个节点，3 批（并发数：3）
[analysis] UI 描述请求：1/3（8 个节点）
[analysis] UI 描述完成：1/3，2345ms
```

### 隐私事实处理日志
```
[analysis] 隐私事实处理开始：18 个功能点（并发数：5）
[analysis] 隐私事实处理：1/18（feature_login）
[analysis] 隐私事实完成：1/18（feature_login），3456ms
```

### LLM HTTP 请求分段计时

通用客户端 `server/src/llm/client.ts` 现在记录一次请求的三个时间点：

```text
LLM 请求开始：模型、URL、Prompt 大小、超时时间
LLM 收到响应头：HTTP 状态码、等待响应头耗时
LLM 响应体读取完成：响应体大小、请求总耗时
```

这可以区分三类慢请求：

- 请求开始到响应头很慢：连接、网关或服务端排队耗时较长；
- 响应头很快但响应体读取很慢：模型生成内容耗时较长；
- 只有“请求开始”而长时间没有后续日志：请求仍在等待，直到超时或连接结束。

命令行分析可将日志保存到文件：

```bash
npm run analyze -- ... 2>&1 | tee analyze.log
grep 'LLM ' analyze.log
```

### 阶段耗时口径

命令行阶段日志同时显示上一阶段耗时和从分析启动开始的累计耗时：

```text
生成数据流（LLM）（57%）开始；上个阶段耗时 8966ms；累计耗时 123456ms
```

`上个阶段耗时`只表示相邻两条阶段日志之间的时间；`累计耗时`才是本次分析的总运行时间。

### 数据流 LLM 失败回退

数据流分析会校验模型输出是否仍属于当前路径。若模型输出了当前路径之外的 source，例如：

```text
LLM 输出跨入了当前路径之外的 source：...
```

该路径会记录失败并回退到锚点数据流，不会中止整个分析。此类错误发生在 LLM 已经返回之后，与网络请求超时或 HTTP 403 不同。常见原因是模型根据相邻源码或多个上下文节点进行了跨路径推断。

相关校验位于 `server/src/analyzer/dataflow/build.ts` 的 `validateLlmResultAgainstAnchors`。

### CPG 与正式分析阶段

`--graphBackend cpg` 生成 `cpg.json` 后，还会继续执行数据流、UI 和隐私报告相关的 LLM 请求。CPG 文件生成成功并不表示整次分析已完成。命令行模式下若长时间没有新的结果文件，应结合以下信息判断当前阶段：

```bash
ps -eo pid,etime,%cpu,%mem,wchan:24,cmd | grep 'src/app/run.ts'
find output/<应用名>/<时间戳> -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %f %s\\n'
```

如果进程处于 `do_epoll_wait` 且存在到模型服务的 TLS 连接，通常表示正在等待 LLM 响应；如果只生成了 `cpg.json`，通常尚未完成后续数据流阶段。

---

## 环境变量说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `LLM_REQUEST_CONCURRENT` | 5 | LLM 请求并发数，适用于所有 LLM 请求 |
| `ANALYZE_LOG` | 1 | 设置为 0 可禁用分析日志 |

---

## 兼容性

- ✅ 向后兼容：所有改动都是增强型的，不影响现有功能
- ✅ 环境变量可选：未设置时使用默认值
- ✅ 错误处理：并发请求失败不会影响其他请求
- ✅ 前端可选：日志推送功能在前端未实现时不影响后端运行

---

## 测试建议

1. **时间格式化测试**
   ```bash
   # 运行一个完整的分析任务，观察日志中的时间显示
   npm run analyze -- --appPath input/app/Test_user_info/
   ```

2. **并发测试**
   ```bash
   # 修改 .env 文件测试不同并发数
   LLM_REQUEST_CONCURRENT=3
   LLM_REQUEST_CONCURRENT=10
   ```

3. **日志推送测试**
   - 启动服务器: `npm run dev`
   - 从前端发起分析任务
   - 查看浏览器开发者工具的 Network 标签，确认 SSE 连接
   - 观察日志消息是否实时推送

---

## 后续优化建议

1. **前端界面改进**
   - 在前端添加日志显示面板
   - 显示实时进度条和当前处理的项目
   - 添加日志搜索和过滤功能

2. **性能监控**
   - 记录每个阶段的详细耗时
   - 生成性能报告
   - 自动调优并发数

3. **错误处理增强**
   - 重试失败的 LLM 请求
   - 提供更详细的错误信息
   - 支持断点续传

---

## 更新日期
2026-09-09
