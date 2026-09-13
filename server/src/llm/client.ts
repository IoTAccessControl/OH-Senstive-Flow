import { AsyncLocalStorage } from 'node:async_hooks';
import { analysisLog } from '../utils/analysisLog.js';

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
  enableThinking?: boolean;
  timeoutMs?: number;
};

export type LlmChatResponse = {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw: unknown;
};

export type LlmUsageStats = {
  requestCount: number;
  failedRequests: number;
  totalMs: number;
  requestMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export interface LlmUsageCollector {
  startRequest?(): void;
  recordSuccess(durationMs: number, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void;
  recordFailure(durationMs: number): void;
  getStats(): LlmUsageStats;
}

export class DefaultLlmUsageCollector implements LlmUsageCollector {
  private requestCount = 0;
  private failedRequests = 0;
  private totalMs = 0;
  private requestMs = 0;
  private activeRequests = 0;
  private activeSince = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;

  public startRequest(): void {
    if (this.activeRequests === 0) this.activeSince = Date.now();
    this.activeRequests += 1;
  }

  private finishRequest(durationMs: number): void {
    const elapsed = Math.max(0, Math.round(durationMs));
    this.requestMs += elapsed;
    if (this.activeRequests > 0) {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) {
        this.totalMs += Math.max(0, Date.now() - this.activeSince);
        this.activeSince = 0;
      }
    } else {
      this.totalMs += elapsed;
    }
  }

  public recordSuccess(durationMs: number, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void {
    this.requestCount += 1;
    this.finishRequest(durationMs);
    const prompt = usage?.promptTokens;
    const completion = usage?.completionTokens;
    const total = usage?.totalTokens;

    const p = typeof prompt === 'number' && Number.isFinite(prompt) ? Math.max(0, Math.round(prompt)) : 0;
    const c = typeof completion === 'number' && Number.isFinite(completion) ? Math.max(0, Math.round(completion)) : 0;
    const t = typeof total === 'number' && Number.isFinite(total) ? Math.max(0, Math.round(total)) : (p + c);

    this.inputTokens += p;
    this.outputTokens += c;
    this.totalTokens += t;
  }

  public recordFailure(durationMs: number): void {
    this.requestCount += 1;
    this.failedRequests += 1;
    this.finishRequest(durationMs);
  }

  public getStats(): LlmUsageStats {
    return {
      requestCount: this.requestCount,
      failedRequests: this.failedRequests,
      totalMs: this.totalMs,
      requestMs: this.requestMs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
    };
  }
}

export const llmUsageStorage = new AsyncLocalStorage<LlmUsageCollector>();

export function withLlmUsageCollector<T>(collector: LlmUsageCollector, fn: () => Promise<T>): Promise<T> {
  return llmUsageStorage.run(collector, fn);
}

function normalizeProviderName(provider: string): string {
  return provider.trim().toLowerCase();
}

export function resolveLlmBaseUrls(provider: string, baseUrl?: string): string[] {
  const override = baseUrl?.trim();
  if (override) return [override];

  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === 'qwen' || normalizedProvider === 'dashscope') {
    return ['https://dashscope.aliyuncs.com/compatible-mode/v1'];
  }
  if (normalizedProvider === 'openai') return ['https://api.openai.com/v1'];

  throw new Error(`不支持的 LLM provider=${provider}；请使用 Qwen/OpenAI，或为该 LLM 配置 OpenAI 兼容 baseURL`);
}

export function resolveLlmBaseUrl(provider: string, baseUrl?: string): string {
  const urls = resolveLlmBaseUrls(provider, baseUrl);
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

export function stripLeadingThinkBlock(content: string): string {
  return content.replace(/^\s*<think\b[^>]*>[\s\S]*?<\/think>\s*/iu, '');
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.LLM_TIMEOUT_MS ?? 300000);
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

async function executeOpenAiCompatibleChat(request: LlmChatRequest, requestStartTime: number): Promise<LlmChatResponse> {
  const url = joinUrl(request.baseUrl, '/chat/completions');
  const timeoutMs = request.timeoutMs ?? resolveTimeoutMs();

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.2,
  };
  if (typeof request.maxTokens === 'number') body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: 'json_object' };
  if (typeof request.enableThinking === 'boolean') body.enable_thinking = request.enableThinking;
  if (shouldDisableThinking(request.baseUrl)) body.enable_thinking = false;

  let response: Response;
  let text = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let fetchStartTime = 0;
  let fetchEndTime = 0;
  let parseStartTime = 0;

  try {
    fetchStartTime = Date.now();
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    fetchEndTime = Date.now();
    const networkTime = fetchEndTime - fetchStartTime;
    analysisLog(`LLM 网络响应：${networkTime}ms, status: ${response.status}`);

    parseStartTime = Date.now();
    text = await response.text();
    const parseTime = Date.now() - parseStartTime;
    analysisLog(`LLM 响应体读取：${parseTime}ms, size: ${text.length} bytes`);
  } catch (error) {
    const elapsedTime = Date.now() - requestStartTime;
    if ((error as { name?: string })?.name === 'AbortError') {
      analysisLog(`LLM 请求超时：${elapsedTime}ms（配置超时 ${timeoutMs}ms）`);
      throw new LlmNetworkError(`LLM 请求失败（超时 ${timeoutMs}ms）`);
    }
    analysisLog(`LLM 网络错误：${elapsedTime}ms, error: ${asErrorText(error)}`);
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

  const rawContent =
    typeof (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content === 'string'
      ? (((json as { choices: Array<{ message: { content: string } }> }).choices[0]!.message.content as string) ?? '')
      : '';
  const content = stripLeadingThinkBlock(rawContent);
  if (!content) throw new Error(`LLM 返回缺少 message.content：${text.slice(0, 2000)}`);

  const usage = (json as { usage?: unknown })?.usage;
  const usageData =
    usage && typeof usage === 'object'
      ? {
          promptTokens: typeof (usage as { prompt_tokens?: unknown }).prompt_tokens === 'number' ? (usage as { prompt_tokens: number }).prompt_tokens : undefined,
          completionTokens: typeof (usage as { completion_tokens?: unknown }).completion_tokens === 'number' ? (usage as { completion_tokens: number }).completion_tokens : undefined,
          totalTokens: typeof (usage as { total_tokens?: unknown }).total_tokens === 'number' ? (usage as { total_tokens: number }).total_tokens : undefined,
        }
      : undefined;

  return { content, usage: usageData, raw: json };
}

export async function openAiCompatibleChat(request: LlmChatRequest): Promise<LlmChatResponse> {
  const collector = llmUsageStorage.getStore();
  const requestStartTime = Date.now();
  collector?.startRequest?.();
  try {
    const response = await executeOpenAiCompatibleChat(request, requestStartTime);
    collector?.recordSuccess(Date.now() - requestStartTime, response.usage);
    return response;
  } catch (error) {
    collector?.recordFailure(Date.now() - requestStartTime);
    throw error;
  }
}
