function normalizeProviderName(provider: string): string {
  return provider.trim().toLowerCase();
}

export function resolveLlmBaseUrls(provider: string): string[] {
  const override = process.env.CX_OH_LLM_BASE_URL?.trim();
  if (override) return [override];

  const p = normalizeProviderName(provider);
  if (p === 'qwen' || p === 'dashscope') {
    // DashScope OpenAI-compatible endpoints. Some API keys are region-scoped; try CN first, then US.
    return [
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    ];
  }
  if (p === 'qwen-us' || p === 'dashscope-us') {
    return [
      'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ];
  }
  if (p === 'openai') return ['https://api.openai.com/v1'];

  throw new Error(
    `不支持的 LLM provider=${provider}；请使用 Qwen/OpenAI，或通过环境变量 CX_OH_LLM_BASE_URL 指定 OpenAI 兼容 baseURL`,
  );
}

export function resolveLlmBaseUrl(provider: string): string {
  const urls = resolveLlmBaseUrls(provider);
  if (urls.length === 0) throw new Error(`无法解析 LLM baseURL（provider=${provider}）`);
  return urls[0]!;
}
