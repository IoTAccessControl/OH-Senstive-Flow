import {
  LlmHttpError,
  LlmNetworkError,
  openAiCompatibleChat,
  resolveLlmBaseUrl,
} from './client.js';

export type LlmCheckConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type LlmCheckResult = {
  available: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  errorType?: 'missing_config' | 'unsupported_provider' | 'network' | 'timeout' | 'authentication' | 'model_not_found' | 'rate_limited' | 'invalid_response' | 'unknown';
  message: string;
};

function classifyHttpError(status: number): LlmCheckResult['errorType'] {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  return 'unknown';
}

function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) return '认证失败，请检查 API Key 和模型权限';
  if (status === 404) return '接口或模型不存在，请检查 Base URL 和模型名称';
  if (status === 429) return '请求被限流，请稍后重试';
  return `LLM 请求失败（HTTP ${status}）`;
}

export async function checkLlmAvailability(config: LlmCheckConfig, timeoutMs = 15_000): Promise<LlmCheckResult> {
  const provider = config.provider.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const startedAt = Date.now();
  const failure = (errorType: LlmCheckResult['errorType'], message: string): LlmCheckResult => ({
    available: false,
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    errorType,
    message,
  });

  if (!provider || !apiKey || !model) {
    return failure('missing_config', '缺少 provider、API Key 或 model');
  }

  let baseUrl: string;
  try {
    baseUrl = resolveLlmBaseUrl(provider, config.baseUrl);
  } catch (error) {
    return failure('unsupported_provider', error instanceof Error ? error.message : String(error));
  }

  try {
    await openAiCompatibleChat({
      baseUrl,
      apiKey,
      model,
      messages: [{ role: 'user', content: '请只回复：连接成功' }],
      temperature: 0,
      maxTokens: 16,
      enableThinking: false,
      timeoutMs,
    });
    return {
      available: true,
      provider,
      model,
      latencyMs: Date.now() - startedAt,
      message: '可用',
    };
  } catch (error) {
    if (error instanceof LlmHttpError) return failure(classifyHttpError(error.status), httpErrorMessage(error.status));
    if (error instanceof LlmNetworkError) {
      const timedOut = error.message.includes('超时');
      return failure(timedOut ? 'timeout' : 'network', timedOut ? `请求超时（${timeoutMs}ms）` : '网络连接失败');
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('返回非 JSON') || message.includes('缺少 message.content')) {
      return failure('invalid_response', 'LLM 返回格式无效');
    }
    return failure('unknown', message);
  }
}
