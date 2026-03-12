export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmChatRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

export type LlmChatResponse = {
  content: string;
  raw: unknown;
};

function normalizeProviderName(provider: string): string {
  return provider.trim().toLowerCase();
}

export function resolveLlmBaseUrls(provider: string): string[] {
  const override = process.env.CX_OH_LLM_BASE_URL?.trim();
  if (override) return [override];

  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === 'qwen' || normalizedProvider === 'dashscope') {
    return [
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    ];
  }
  if (normalizedProvider === 'qwen-us' || normalizedProvider === 'dashscope-us') {
    return [
      'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ];
  }
  if (normalizedProvider === 'openai') return ['https://api.openai.com/v1'];

  throw new Error(
    `不支持的 LLM provider=${provider}；请使用 Qwen/OpenAI，或通过环境变量 CX_OH_LLM_BASE_URL 指定 OpenAI 兼容 baseURL`,
  );
}

export function resolveLlmBaseUrl(provider: string): string {
  const urls = resolveLlmBaseUrls(provider);
  if (urls.length === 0) throw new Error(`无法解析 LLM baseURL（provider=${provider}）`);
  return urls[0]!;
}

function joinUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

function shouldDisableThinking(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return host.startsWith('dashscope') && host.endsWith('aliyuncs.com');
  } catch {
    return false;
  }
}

function asErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.CX_OH_LLM_TIMEOUT_MS ?? 300000);
  if (!Number.isFinite(raw) || raw <= 0) return 300000;
  return Math.max(1000, Math.floor(raw));
}

export class LlmNetworkError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LlmNetworkError';
  }
}

export class LlmHttpError extends Error {
  public readonly status: number;
  public readonly responseText: string;

  public constructor(status: number, responseText: string) {
    super(`LLM 请求失败（HTTP ${status}）：${responseText}`);
    this.name = 'LlmHttpError';
    this.status = status;
    this.responseText = responseText;
  }
}

export async function openAiCompatibleChat(request: LlmChatRequest): Promise<LlmChatResponse> {
  const url = joinUrl(request.baseUrl, '/chat/completions');
  const timeoutMs = resolveTimeoutMs();

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
  };
  if (typeof request.maxTokens === 'number') body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: 'json_object' };
  if (shouldDisableThinking(request.baseUrl)) body.enable_thinking = false;

  let response: Response;
  let text = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new LlmNetworkError(`LLM 请求失败（超时 ${timeoutMs}ms）`);
    }
    throw new LlmNetworkError(`LLM 请求失败（网络错误）：${asErrorText(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) throw new LlmHttpError(response.status, text);

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`LLM 返回非 JSON：${text.slice(0, 2000)}`);
  }

  const content =
    typeof (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content === 'string'
      ? (((json as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content as string) ?? '')
      : '';
  if (!content) throw new Error(`LLM 返回缺少 message.content：${text.slice(0, 2000)}`);

  return { content, raw: json };
}
