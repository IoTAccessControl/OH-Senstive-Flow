import { afterEach, describe, expect, it } from 'vitest';

import { resolveLlmBaseUrls, stripLeadingThinkBlock } from '../src/llm/client.js';

const originalLlmBaseUrl = process.env.LLM_BASE_URL;

afterEach(() => {
  if (originalLlmBaseUrl === undefined) delete process.env.LLM_BASE_URL;
  else process.env.LLM_BASE_URL = originalLlmBaseUrl;
});

describe('resolveLlmBaseUrls', () => {
  it('uses the base URL passed with the current LLM config', () => {
    expect(resolveLlmBaseUrls('CustomProvider', ' https://custom.example/v1 ')).toEqual([
      'https://custom.example/v1',
    ]);
  });

  it('does not read the shared LLM_BASE_URL environment variable', () => {
    process.env.LLM_BASE_URL = 'https://shared.example/v1';

    expect(resolveLlmBaseUrls('OpenAI')).toEqual(['https://api.openai.com/v1']);
    expect(resolveLlmBaseUrls('Qwen')).toEqual(['https://dashscope.aliyuncs.com/compatible-mode/v1']);
  });
});

describe('stripLeadingThinkBlock', () => {
  it('removes a complete think block before the response content', () => {
    expect(stripLeadingThinkBlock('\n<think>\ninternal reasoning\n</think>\n{"ok":true}')).toBe('{"ok":true}');
  });

  it('handles tag casing and attributes', () => {
    expect(stripLeadingThinkBlock('<THINK data-mode="reasoning">hidden</THINK>OK')).toBe('OK');
  });

  it('preserves unclosed or non-leading think tags', () => {
    expect(stripLeadingThinkBlock('<think>unfinished')).toBe('<think>unfinished');
    expect(stripLeadingThinkBlock('answer <think>detail</think>')).toBe('answer <think>detail</think>');
  });
});
