# web（前端）

本目录是「隐私声明报告生成工具」的前端工程，基于 React + Vite + TypeScript，负责：
- 配置分析输入（App/SDK/CSV 路径与 LLM 参数）
- 触发后端分析（`POST /api/analyze`）
- 可视化 sinks/sources/callgraph/dataflows
- 展示隐私声明报告，并支持点击关键要素跳转到数据流节点定位

## 启动
推荐在仓库根目录启动（会同时启动 `server/` + `web/`）：

```bash
npm run dev
```

也可以只启动前端：

```bash
npm -w web run dev
```

Vite 默认端口为 5173（若端口被占用会自动选择其它端口）。

## API 代理（开发模式）
`web/vite.config.ts` 已配置代理：`/api/*` -> `http://localhost:3001`。

## 主要页面与路由
- `/`：首页（配置与启动分析；选择历史 `runId`）
  - 相关 API：`GET /api/runs`、`GET /api/fs/roots`、`GET /api/fs/dirs`、`POST /api/analyze`
- `/sinks`：sink API 表格
  - 相关 API：`GET /api/results/sinks`
- `/sources`：source API 表格
  - 相关 API：`GET /api/results/sources`
- `/callgraph`：调用图可视化
  - 相关 API：`GET /api/results/callgraph`
- `/dataflows`：数据流可视化（按「页面 -> 功能点」筛选，或平铺列表）
  - 相关 API：`GET /api/results/dataflows`、`GET /api/results/pages`、`GET /api/results/pages/:pageId/features`、`GET /api/results/pages/:pageId/features/:featureId/dataflows`
- `/privacy-report`：隐私声明报告（token 可点击跳转）
  - 相关 API：`GET /api/results/privacy_report`

## 代码结构（简要）
- `web/src/pages/`：页面实现（`Home`/`Sinks`/`Sources`/`CallGraph`/`Dataflows`/`PrivacyReport`）
- `web/src/api.ts`：后端 API 调用封装与类型
- `web/src/components/`：可复用组件（图渲染、链接到编辑器等）
