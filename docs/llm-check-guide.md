# LLM 可用性检测

项目提供轻量检测命令，不会启动应用分析或生成 CPG：

```bash
npm run llm:check
```

命令读取根目录 `.env`，默认检查数据流、UI 描述和隐私报告三组 LLM 配置。检测失败时命令退出码为非零，输出会说明配置缺失、认证失败、模型不存在、限流、网络错误或超时。

只检查一组配置：

```bash
npm run llm:check -- --target dataflow
npm run llm:check -- --target ui
npm run llm:check -- --target privacy-report
```

设置检测超时，单位为毫秒：

```bash
npm run llm:check -- --timeoutMs 30000
```
