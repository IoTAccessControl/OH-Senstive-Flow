import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockOpenAiCompatibleChat = vi.fn();

vi.mock('../src/llm/client.js', () => {
  class LlmHttpError extends Error {
    public readonly status: number;
    public readonly responseText: string;

    public constructor(status: number, responseText: string) {
      super(responseText);
      this.status = status;
      this.responseText = responseText;
    }
  }

  class LlmNetworkError extends Error {}

  return {
    resolveLlmBaseUrls: () => ['mock://llm'],
    openAiCompatibleChat: (...args: unknown[]) => mockOpenAiCompatibleChat(...args),
    LlmHttpError,
    LlmNetworkError,
  };
});

import { extractFeaturePrivacyFacts } from '../src/analyzer/privacy/facts.js';

describe('privacy facts scenario language normalization', () => {
  beforeEach(() => {
    mockOpenAiCompatibleChat.mockReset();
  });

  it('falls back to chinese feature context when the LLM returns english business scenarios', async () => {
    mockOpenAiCompatibleChat.mockResolvedValue({
      content: JSON.stringify({
        dataPractices: [
          {
            appName: 'App',
            businessScenario: 'Checks whether the default data network is activated.',
            dataSources: ['网络服务'],
            dataItems: [{ name: '网络连接状态', refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }] }],
            processingMethod: '读取网络状态',
            storageMethod: '内存暂存',
            dataRecipients: [],
            processingPurpose: '展示当前网络状态',
          },
        ],
        permissionPractices: [
          {
            permissionName: 'ohos.permission.GET_NETWORK_INFO',
            businessScenario: 'Checks whether the default data network is activated.',
            permissionPurpose: 'Get network info',
            denyImpact: 'Cannot check network state',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
        ],
      }),
      raw: {},
    });

    const result = await extractFeaturePrivacyFacts({
      runId: 'run1',
      appName: 'App',
      feature: {
        featureId: 'feature_network',
        title: '功能入口',
        kind: 'ui',
        anchor: { filePath: 'app/main.ets', line: 10 },
        page: {
          pageId: 'QuickLoginPage',
          entry: { filePath: 'app/main.ets', structName: 'QuickLoginPage', line: 1, description: '快速登录页' },
        },
        sources: [{ filePath: 'app/main.ets', line: 1, functionName: 'build', description: '页面展示与交互' }],
      },
      dataflows: {
        meta: {
          runId: 'run1',
          generatedAt: new Date().toISOString(),
          counts: { flows: 1, nodes: 1, edges: 0 },
        },
        flows: [
          {
            flowId: 'flow:p1',
            pathId: 'p1',
            nodes: [
              {
                id: 'p1:n1',
                filePath: 'app/main.ets',
                line: 10,
                code: 'const hasNet = connection.hasDefaultNetSync();',
                description: '检查网络状态',
                context: { startLine: 10, lines: ['const hasNet = connection.hasDefaultNetSync();'] },
              },
            ],
            edges: [],
          },
        ],
      },
      uiTree: null,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
    });

    expect(result.content.dataPractices[0]?.businessScenario).toBe('快速登录页展示与交互');
    expect(result.content.permissionPractices[0]?.businessScenario).toBe('快速登录页展示与交互');
  });
});
