import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockChat } = vi.hoisted(() => ({
  mockChat: vi.fn(),
}));

vi.mock('../src/llm/client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/llm/client.js')>('../src/llm/client.js');
  return {
    ...actual,
    openAiCompatibleChat: mockChat,
  };
});

import { buildPrivacyReport } from '../src/analyzer/privacy/report.js';

describe('privacy report evidence rules', () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it('drops collection paragraphs when the llm output does not keep exact data item names', async () => {
    mockChat.mockResolvedValueOnce({
      content: '在“用户点击头像”场景中，我们会从系统相册收集头像，用于展示头像。相关数据仅在本地处理。',
      raw: {},
    });

    const result = await buildPrivacyReport({
      runId: 'run1',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_avatar',
          facts: {
            dataPractices: [
              {
                appName: 'App',
                businessScenario: '用户点击头像',
                dataSources: ['系统相册'],
                dataItems: [{ name: '头像图片', refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }] }],
                processingMethod: '复制并展示图片',
                storageMethod: '本地缓存',
                dataRecipients: [],
                processingPurpose: '展示头像',
              },
            ],
            permissionPractices: [
              {
                permissionName: 'ohos.permission.READ_MEDIA',
                businessScenario: '用户点击头像',
                permissionPurpose: '读取图片',
                denyImpact: '无法选择图片',
                refs: [],
              },
            ],
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
                    code: 'Image(this.avatar)',
                    description: '展示头像',
                    context: { startLine: 9, lines: ['Image(this.avatar)'] },
                  },
                ],
                edges: [],
              },
            ],
          },
        },
      ],
    });

    const collectionSection = result.report.sections.collectionAndUse[0];
    const permissionSection = result.report.sections.permissions[0];

    expect(collectionSection?.tokens ?? []).toEqual([]);
    expect(permissionSection?.tokens ?? []).toEqual([]);
    expect(result.text).not.toContain('头像图片');
    expect(result.text).not.toContain('ohos.permission.READ_MEDIA');
    expect(result.warnings).toEqual([]);
  });

  it('renders upload-to-server paragraphs and keeps jump targets on exact data item names', async () => {
    mockChat.mockResolvedValueOnce({
      content: '在“用户更新头像”场景中，我们会从系统相册收集头像图片，用于更新用户头像。相关数据会上传至应用服务端。',
      raw: {},
    });

    const result = await buildPrivacyReport({
      runId: 'run1b',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_avatar_upload',
          facts: {
            dataPractices: [
              {
                appName: 'App',
                businessScenario: '用户更新头像',
                dataSources: ['系统相册'],
                dataItems: [{ name: '头像图片', refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }] }],
                processingMethod: '读取并上传图片',
                storageMethod: '未识别',
                dataRecipients: [],
                processingPurpose: '更新用户头像',
              },
            ],
            permissionPractices: [],
          },
          dataflows: {
            meta: {
              runId: 'run1b',
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
                    code: 'uploadAvatar(file)',
                    description: '上传头像图片',
                    context: { startLine: 10, lines: ['uploadAvatar(file)'] },
                  },
                ],
                edges: [],
                summary: {
                  cloudUpload: ['将头像图片上传至应用服务端以更新用户资料'],
                },
              },
            ],
          },
        },
      ],
    });

    const avatarToken = result.report.sections.collectionAndUse[0]?.tokens.find((token) => token.text === '头像图片');
    expect(result.text).toContain('头像图片');
    expect(result.text).toContain('相关数据会上传至应用服务端。');
    expect(avatarToken?.jumpTo).toEqual({ featureId: 'feature_avatar_upload', flowId: 'flow:p1', nodeId: 'p1:n1' });
  });

  it('omits non-personal practices when the report llm returns SKIP', async () => {
    mockChat
      .mockResolvedValueOnce({ content: 'SKIP', raw: {} })
      .mockResolvedValueOnce({
        content: '在“搜索联系人”场景中，我们会收集用户搜索关键词，用于搜索联系人。相关数据仅在本地处理。',
        raw: {},
      });

    const result = await buildPrivacyReport({
      runId: 'run1c',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_mixed_items',
          facts: {
            dataPractices: [
              {
                appName: 'App',
                businessScenario: '页面返回时',
                dataSources: ['页面状态'],
                dataItems: [
                  { name: '路由栈长度', refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }] },
                  { name: '键盘高度状态', refs: [{ flowId: 'flow:p1', nodeId: 'p1:n2' }] },
                ],
                processingMethod: '内存判断',
                storageMethod: '无持久化存储',
                dataRecipients: [],
                processingPurpose: '控制页面返回逻辑',
              },
              {
                appName: 'App',
                businessScenario: '搜索联系人',
                dataSources: ['用户输入'],
                dataItems: [
                  { name: '用户搜索关键词', refs: [{ flowId: 'flow:p2', nodeId: 'p2:n1' }] },
                ],
                processingMethod: '本地匹配',
                storageMethod: '无持久化存储',
                dataRecipients: [],
                processingPurpose: '搜索联系人',
              },
            ],
            permissionPractices: [],
          },
          dataflows: {
            meta: {
              runId: 'run1c',
              generatedAt: new Date().toISOString(),
              counts: { flows: 2, nodes: 5, edges: 0 },
            },
            flows: [
              {
                flowId: 'flow:p1',
                pathId: 'p1',
                nodes: [
                  {
                    id: 'p1:n1',
                    filePath: 'app/page.ets',
                    line: 20,
                    code: 'router.getLength()',
                    description: '读取路由栈长度',
                    context: { startLine: 20, lines: ['router.getLength()'] },
                  },
                  {
                    id: 'p1:n2',
                    filePath: 'app/page.ets',
                    line: 21,
                    code: 'keyboardHeight',
                    description: '读取键盘高度',
                    context: { startLine: 21, lines: ['keyboardHeight'] },
                  },
                ],
                edges: [],
              },
              {
                flowId: 'flow:p2',
                pathId: 'p2',
                nodes: [
                  {
                    id: 'p2:n1',
                    filePath: 'app/search.ets',
                    line: 30,
                    code: 'this.searchKeyword',
                    description: '读取用户搜索关键词',
                    context: { startLine: 30, lines: ['this.searchKeyword'] },
                  },
                ],
                edges: [],
              },
            ],
          },
        },
      ],
    });

    const collectionText = result.report.sections.collectionAndUse[0]?.tokens.map((token) => token.text).join('') ?? '';
    expect(collectionText).toContain('用户搜索关键词');
    expect(result.text).not.toContain('路由栈长度');
    expect(result.text).not.toContain('键盘高度状态');
    expect(result.text).toContain('用户搜索关键词');
  });

  it('renders a non-empty fallback sentence for synthetic app-level permissions without refs', async () => {
    const result = await buildPrivacyReport({
      runId: 'run2',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      features: [
        {
          featureId: '__app_permissions',
          facts: {
            dataPractices: [],
            permissionPractices: [
              {
                permissionName: 'ohos.permission.INTERNET',
                authorizationMode: 'preauthorized',
                businessScenario: '应用源码/配置声明或 SDK API 使用推断的权限',
                permissionPurpose: '当前已在应用源码/配置扫描或 SDK API→权限映射中识别到该权限，但尚未定位到具体功能点数据流。',
                denyImpact: '当前未从已识别的数据流中定位到具体拒绝授权影响。',
                refs: [],
              },
            ],
          },
          dataflows: {
            meta: {
              runId: 'run2',
              generatedAt: new Date().toISOString(),
              counts: { flows: 0, nodes: 0, edges: 0 },
            },
            flows: [],
          },
        },
      ],
    });

    const permissionSection = result.report.sections.permissions[0];
    expect(permissionSection?.tokens.length).toBeGreaterThan(0);
    expect(permissionSection?.tokens[0]?.text).toContain('网络访问权限（预授权）');
    expect(result.text).toContain('尚未定位到可回溯的功能点数据流');
  });

  it('renders authorization labels in permission sentences with valid refs', async () => {
    const result = await buildPrivacyReport({
      runId: 'run2b',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_camera',
          facts: {
            dataPractices: [],
            permissionPractices: [
              {
                permissionName: 'ohos.permission.CAMERA',
                authorizationMode: 'dynamic',
                businessScenario: '用户点击拍照',
                permissionPurpose: '用于拍照',
                denyImpact: '无法拍照',
                refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
              },
            ],
          },
          dataflows: {
            meta: {
              runId: 'run2b',
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
                    code: 'camera.capture()',
                    description: '拍照',
                    context: { startLine: 10, lines: ['camera.capture()'] },
                  },
                ],
                edges: [],
              },
            ],
          },
        },
      ],
    });

    expect(result.text).toContain('相机权限（动态授权）');
    expect(result.text).toContain('若您拒绝授权，无法拍照。');
  });

  it('rewrites english scenarios to chinese context before rendering the report', async () => {
    mockChat.mockResolvedValueOnce({
      content: '在“快速登录页相关功能处理时”场景中，我们会从网络服务收集网络连接状态，用于展示当前网络状态。相关数据仅在本地处理。',
      raw: {},
    });

    const result = await buildPrivacyReport({
      runId: 'run3',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_network',
          featureTitle: '功能入口',
          pageTitle: '快速登录页',
          facts: {
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
                authorizationMode: 'preauthorized',
                businessScenario: 'Checks whether the default data network is activated.',
                permissionPurpose: '用于检查网络状态',
                denyImpact: '无法判断是否联网',
                refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
              },
            ],
          },
          dataflows: {
            meta: {
              runId: 'run3',
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
        },
      ],
    });

    const request = mockChat.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> } | undefined;
    const userMessage = request?.messages?.find((message) => message.role === 'user')?.content ?? '';

    expect(result.text).toContain('快速登录页相关功能处理时');
    expect(result.text).not.toContain('Checks whether the default data network is activated.');
    expect(userMessage).toContain('"businessScenario": "快速登录页相关功能处理时"');
  });
});
