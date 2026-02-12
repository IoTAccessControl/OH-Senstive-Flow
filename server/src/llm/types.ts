export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmJsonMode = { type: 'json_object' };

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

