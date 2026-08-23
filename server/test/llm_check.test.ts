import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkLlmAvailability } from '../src/llm/check.js';

afterEach(() => vi.unstubAllGlobals());

const config = { provider: 'OpenAI', apiKey: 'secret-key', model: 'test-model' };

describe('checkLlmAvailability', () => {
  it('reports an available model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '连接成功' } }],
    }), { status: 200 })));

    const result = await checkLlmAvailability(config);
    expect(result.available).toBe(true);
    expect(result.message).toBe('可用');
  });

  it('reports missing configuration without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await checkLlmAvailability({ ...config, apiKey: '' });
    expect(result).toMatchObject({ available: false, errorType: 'missing_config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies authentication failures without exposing the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized secret-key', { status: 401 })));
    const result = await checkLlmAvailability(config);
    expect(result).toMatchObject({ available: false, errorType: 'authentication' });
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it('classifies invalid response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    const result = await checkLlmAvailability(config);
    expect(result).toMatchObject({ available: false, errorType: 'invalid_response' });
  });
});
