import type { LlmChatRequest, LlmChatResponse } from './types.js';

function joinUrl(baseUrl: string, pathname: string): string {
  const b = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${b}${p}`;
}

function shouldDisableThinking(baseUrl: string): boolean {
  // DashScope (Qwen) OpenAI-compatible endpoint requires enable_thinking=false for non-streaming calls.
  // Keep this heuristic conservative to avoid sending unknown parameters to other providers (e.g., OpenAI).
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();
    return host.startsWith('dashscope') && host.endsWith('aliyuncs.com');
  } catch {
    return false;
  }
}

function asErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.CX_OH_LLM_TIMEOUT_MS ?? 300000);
  if (!Number.isFinite(raw) || raw <= 0) return 300000;
  return Math.max(1000, Math.floor(raw));
}

export class LlmNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmNetworkError';
  }
}

export class LlmHttpError extends Error {
  status: number;
  responseText: string;

  constructor(status: number, responseText: string) {
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

  let res: Response;
  let text = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      throw new LlmNetworkError(`LLM 请求失败（超时 ${timeoutMs}ms）`);
    }
    throw new LlmNetworkError(`LLM 请求失败（网络错误）：${asErrorText(e)}`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    throw new LlmHttpError(res.status, text);
  }

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`LLM 返回非 JSON：${text.slice(0, 2000)}`);
  }

  const content =
    typeof (json as any)?.choices?.[0]?.message?.content === 'string'
      ? ((json as any).choices[0].message.content as string)
      : '';
  if (!content) {
    throw new Error(`LLM 返回缺少 message.content：${text.slice(0, 2000)}`);
  }

  return { content, raw: json };
}
