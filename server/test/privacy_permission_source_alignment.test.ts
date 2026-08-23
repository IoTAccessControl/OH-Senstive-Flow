import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { collectPredictedPermissionsFromRun } from '../src/app/run.js';

const mockExtractFeaturePrivacyFacts = vi.fn();
vi.mock('../src/analyzer/privacy/facts.js', () => ({
  extractFeaturePrivacyFacts: (...args: unknown[]) => mockExtractFeaturePrivacyFacts(...args),
}));

import { generatePrivacyReportArtifacts } from '../src/analyzer/privacy/report.js';

function reportDraftContent(input: { collectionAndUse?: string[]; permissions?: string[] }): string {
  return JSON.stringify({
    collectionAndUse: input.collectionAndUse ?? [],
    permissions: input.permissions ?? [],
  });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeMinimalFeatureRun(args: {
  repoRoot: string;
  appName?: string;
  runId?: string;
  featureId?: string;
  featureTitle?: string;
  appPermissions: string[];
  sinkApiKey?: string;
  sinkDescription?: string;
  dataflowNodeCode?: string;
  metaAppPathAbs?: string;
}): Promise<{ outputDirAbs: string; appDirAbs: string; featureDirAbs: string }> {
  const appName = args.appName ?? 'App';
  const runId = args.runId ?? 'App_run1';
  const featureId = args.featureId ?? 'ui_P1_feature';
  const featureTitle = args.featureTitle ?? '测试功能';
  const outputDirAbs = path.join(args.repoRoot, 'output', appName, 'run1');
  const csvDirAbs = path.join(args.repoRoot, 'input', 'csv');
  const appDirAbs = args.metaAppPathAbs ?? path.join(args.repoRoot, 'input', 'app', appName);
  const featureDirAbs = path.join(outputDirAbs, 'pages', 'P1', 'features', featureId);

  await fs.mkdir(featureDirAbs, { recursive: true });
  await fs.mkdir(csvDirAbs, { recursive: true });
  await fs.mkdir(path.join(appDirAbs, 'entry', 'src', 'main'), { recursive: true });

  await fs.writeFile(
    path.join(appDirAbs, 'entry', 'src', 'main', 'module.json5'),
    `${JSON.stringify({ requestPermissions: args.appPermissions }, null, 2)}\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(csvDirAbs, 'sdk_api_and_permission.csv'),
    [
      '敏感行为,行为子项,相关API,相关权限,敏感数据项,敏感数据子项',
      args.sinkApiKey
        ? `页面跳转,跳转页面,\"${args.sinkApiKey}(options: any): void\",ohos.permission.INTERNET,,`
        : '',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeJson(path.join(outputDirAbs, 'meta.json'), {
    runId,
    input: { csvDir: csvDirAbs, appPath: appDirAbs },
  });

  await writeJson(
    path.join(outputDirAbs, 'sinks.json'),
    args.sinkApiKey
      ? [
          {
            App源码文件路径: 'app/main.ets',
            导入行号: 1,
            导入代码: "import router from '@ohos.router';",
            调用行号: 10,
            调用代码: args.dataflowNodeCode ?? "router.pushUrl({ url: 'pages/a' });",
            API功能描述: args.sinkDescription ?? '页面跳转 / 跳转页面; 权限: ohos.permission.INTERNET',
            __apiKey: args.sinkApiKey,
            __module: '@ohos.router',
          },
        ]
      : [],
  );

  await writeJson(path.join(outputDirAbs, 'sources.json'), []);

  await writeJson(path.join(outputDirAbs, 'pages', 'index.json'), {
    meta: { runId, generatedAt: new Date().toISOString(), counts: { pages: 1, features: 1, flows: 1, unassignedFlows: 0 } },
    pages: [
      {
        pageId: 'P1',
        entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' },
        counts: { features: 1, flows: 1 },
      },
    ],
  });

  await writeJson(path.join(outputDirAbs, 'pages', 'P1', 'features', 'index.json'), {
    meta: { runId, generatedAt: new Date().toISOString(), pageId: 'P1', counts: { features: 1, flows: 1 } },
    page: { pageId: 'P1', entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' } },
    features: [
      {
        featureId,
        title: featureTitle,
        kind: 'ui',
        anchor: { filePath: 'app/main.ets', line: 10, uiNodeId: 'ui:1' },
        counts: { flows: 1, nodes: 1, edges: 0 },
      },
    ],
  });

  await writeJson(path.join(featureDirAbs, 'dataflows.json'), {
    meta: {
      runId,
      generatedAt: new Date().toISOString(),
      counts: { flows: 1, nodes: 1, edges: 0 },
      page: { pageId: 'P1', entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' } },
      feature: { featureId, kind: 'ui', title: featureTitle },
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
            code: args.dataflowNodeCode ?? "router.pushUrl({ url: 'pages/a' });",
            description: '测试调用',
            context: { startLine: 9, lines: ['// dummy'] },
          },
        ],
        edges: [],
        summary: {},
      },
    ],
  });

  return { outputDirAbs, appDirAbs, featureDirAbs };
}

describe('privacy permission alignment with app source', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockExtractFeaturePrivacyFacts.mockReset();
    mockExtractFeaturePrivacyFacts.mockResolvedValue({
      content: { dataPractices: [], permissionPractices: [] },
      warnings: [],
    });
  });

  it('supplements permissions found in app source so predicted coverage reaches the full app set', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET', 'ohos.permission.CAMERA'],
      sinkApiKey: '@ohos.router.pushUrl',
    });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
    });

    const predicted = await collectPredictedPermissionsFromRun(outputDirAbs);
    expect([...predicted].sort()).toEqual(['ohos.permission.CAMERA', 'ohos.permission.INTERNET']);

    const featureFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'pages', 'P1', 'features', 'ui_P1_feature', 'privacy_facts.json'), 'utf8')) as any;
    expect(featureFacts.permissionPractices).toEqual([]);

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.permissionPractices.map((item: any) => item.permissionName)).toEqual([
      'ohos.permission.CAMERA',
      'ohos.permission.INTERNET',
    ]);
    expect(syntheticFacts.permissionPractices[0]?.authorizationMode).toBe('preauthorized');
    expect(syntheticFacts.permissionPractices[1]?.authorizationMode).toBe('preauthorized');

    const report = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'privacy_report.json'), 'utf8')) as any;
    const appPermissionSection = report.sections.permissions.find((section: any) => section.featureId === '__app_permissions');
    expect(appPermissionSection).toBeTruthy();
    expect(appPermissionSection.tokens.length).toBeGreaterThan(0);
    expect((report.meta.warnings ?? []).some((item: string) => item.includes('权限段落缺少有效跳转引用'))).toBe(false);
  });

  it('marks runtime requested permissions as dynamic and other permissions as preauthorized', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, appDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET'],
      sinkApiKey: '@ohos.router.pushUrl',
    });

    await fs.mkdir(path.join(appDirAbs, 'entry', 'src', 'main', 'ets', 'pages'), { recursive: true });
    await fs.writeFile(
      path.join(appDirAbs, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'),
      `
import { abilityAccessCtrl } from '@kit.AbilityKit';

const mediaPermissions = ['ohos.permission.READ_MEDIA'];

export function requestAll(context: UIContext) {
  const atManager = abilityAccessCtrl.createAtManager();
  atManager.requestPermissionsFromUser(context, ['ohos.permission.CAMERA']);
  atManager.requestPermissionsFromUser(context, mediaPermissions);
}
`,
      'utf8',
    );

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
    });

    const featureFacts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(featureFacts.permissionPractices).toEqual([]);

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.permissionPractices).toEqual([
      expect.objectContaining({ permissionName: 'ohos.permission.CAMERA', authorizationMode: 'dynamic' }),
      expect.objectContaining({ permissionName: 'ohos.permission.INTERNET', authorizationMode: 'preauthorized' }),
      expect.objectContaining({ permissionName: 'ohos.permission.READ_MEDIA', authorizationMode: 'dynamic' }),
    ]);

    const reportText = await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8');
    expect(reportText).toContain('网络访问权限（预授权）');
    expect(reportText).toContain('相机权限（动态授权）');
  });

  it('keeps permission refs deterministic and lets report llm write the final paragraph', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET'],
      sinkApiKey: '@ohos.router.pushUrl',
      sinkDescription: '页面跳转 / 打开目标页面',
      dataflowNodeCode: "router.pushUrl({ url: 'pages/detail' });",
      featureTitle: '页面构建入口',
    });

    mockExtractFeaturePrivacyFacts.mockResolvedValueOnce({
      content: {
        dataPractices: [],
        permissionPractices: [
          {
            permissionName: 'ohos.permission.INTERNET',
            businessScenario: '',
            permissionPurpose: '',
            denyImpact: '',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
        ],
      },
      warnings: [],
    });
    mockChat.mockResolvedValueOnce({
      content: reportDraftContent({
        permissions: ['在“用户打开详情页时”，我们会申请 ohos.permission.INTERNET，用于连接网络并打开目标页面。若您拒绝授权，无法加载并打开目标页面。'],
      }),
      raw: {},
    });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.permissionPractices[0]?.authorizationMode).toBe('preauthorized');
    expect(facts.permissionPractices[0]?.permissionName).toBe('ohos.permission.INTERNET');
    expect(facts.permissionPractices[0]?.businessScenario).toBe('');
    expect(facts.permissionPractices[0]?.permissionPurpose).toBe('');
    expect(facts.permissionPractices[0]?.denyImpact).toBe('');
    expect(facts.permissionPractices[0]?.refs).toEqual([{ flowId: 'flow:p1', nodeId: 'p1:n1' }]);

    const reportText = await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8');
    expect(reportText).toContain('网络访问权限（预授权）');
    expect(reportText).toContain('用户打开详情页时');
    expect(reportText).toContain('用于连接网络并打开目标页面');
    expect(reportText).toContain('无法加载并打开目标页面');
    expect(reportText).not.toContain('使用相关系统能力（由 SDK API 权限映射确定）');
  });

  it('filters hallucinated permissions that are absent from app source', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET'],
      sinkApiKey: '',
      dataflowNodeCode: "console.log('hello');",
    });

    mockExtractFeaturePrivacyFacts.mockResolvedValue({
      content: {
        dataPractices: [],
        permissionPractices: [
          {
            permissionName: 'ohos.permission.READ_CONTACTS',
            businessScenario: '读取联系人',
            permissionPurpose: '用于读取联系人',
            denyImpact: '无法读取联系人',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
          {
            permissionName: 'ohos.permission.INTERNET',
            businessScenario: '网络访问',
            permissionPurpose: '用于联网',
            denyImpact: '无法联网',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
        ],
      },
      warnings: [],
    });
    mockChat.mockResolvedValueOnce({
      content: reportDraftContent({
        permissions: ['在“网络访问”场景中，我们会申请 ohos.permission.INTERNET，用于联网。若您拒绝授权，无法联网。'],
      }),
      raw: {},
    });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.permissionPractices.map((item: any) => item.permissionName)).toEqual(['ohos.permission.INTERNET']);

    const predicted = await collectPredictedPermissionsFromRun(outputDirAbs);
    expect([...predicted]).toEqual(['ohos.permission.INTERNET']);
  });

  it('keeps same-name permission fields when other standard fields are missing', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET'],
      sinkApiKey: '@ohos.router.pushUrl',
    });

    mockExtractFeaturePrivacyFacts.mockResolvedValue({
      content: {
        dataPractices: [],
        permissionPractices: [
          {
            permissionName: 'ohos.permission.INTERNET',
            businessScenario: '',
            permissionPurpose: '',
            denyImpact: '',
            refs: [],
          },
        ],
      },
      warnings: [],
    });
    mockChat.mockResolvedValue({ content: reportDraftContent({}), raw: {} });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'base-model' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.permissionPractices).toEqual([
      {
        permissionName: 'ohos.permission.INTERNET',
        authorizationMode: 'preauthorized',
        businessScenario: '',
        permissionPurpose: '',
        denyImpact: '',
        refs: [],
      },
    ]);

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.permissionPractices.map((item: any) => item.permissionName)).toEqual(['ohos.permission.INTERNET']);
  });

  it('drops all hallucinated permissions when the app has no known permissions', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: [],
      sinkApiKey: '',
      dataflowNodeCode: "console.log('hello');",
    });

    mockExtractFeaturePrivacyFacts.mockResolvedValue({
      content: {
        dataPractices: [],
        permissionPractices: [
          {
            permissionName: '系统权限',
            businessScenario: '页面展示',
            permissionPurpose: '运行应用',
            denyImpact: '应用不可用',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
          {
            permissionName: 'ohos.permission.CAMERA',
            businessScenario: '页面展示',
            permissionPurpose: '拍照',
            denyImpact: '无法拍照',
            refs: [{ flowId: 'flow:p1', nodeId: 'p1:n1' }],
          },
        ],
      },
      warnings: [],
    });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.permissionPractices).toEqual([]);
    const reportText = await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8');
    expect(reportText).not.toContain('系统权限');
    expect(reportText).not.toContain('相机权限');
  });

  it('groups source-matched login data into one readable fallback statement', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, appDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: [],
      sinkApiKey: '',
    });
    const csvDirAbs = path.join(repoRoot, 'input', 'csv');
    await fs.writeFile(
      path.join(csvDirAbs, 'privacy_rules.csv'),
      [
        'type,keywords,outputName,rule',
        "data_item,placeholder: '账号',登录账号,",
        "data_item,placeholder: '密码',登录密码,",
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.join(appDirAbs, 'entry', 'src', 'main', 'ets', 'pages'), { recursive: true });
    await fs.writeFile(
      path.join(appDirAbs, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'),
      "TextInput({ placeholder: '账号' });\nTextInput({ placeholder: '密码' });\n",
      'utf8',
    );

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
    });

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.dataPractices).toHaveLength(1);
    expect(syntheticFacts.dataPractices[0]?.dataItems.map((item: any) => item.name).sort()).toEqual(['登录密码', '登录账号']);
    const syntheticDataflows = JSON.parse(
      await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'dataflows.json'), 'utf8'),
    ) as any;
    const dataNodes = syntheticDataflows.flows[0]?.nodes.filter((node: any) => node.id.startsWith('data:')) ?? [];
    expect(dataNodes).toHaveLength(2);
    expect(new Set(dataNodes.map((node: any) => node.id)).size).toBe(2);
    const dataItems = syntheticFacts.dataPractices[0]?.dataItems ?? [];
    expect(new Set(dataItems.flatMap((item: any) => item.refs.map((ref: any) => ref.nodeId))).size).toBe(2);
    const report = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'privacy_report.json'), 'utf8')) as any;
    const collectionSection = report.sections.collectionAndUse.find(
      (section: any) => section.featureId === '__app_permissions',
    );
    const jumpNodeIds = collectionSection.tokens
      .map((token: any) => token.jumpTo?.nodeId)
      .filter((nodeId: unknown): nodeId is string => typeof nodeId === 'string');
    expect(new Set(jumpNodeIds).size).toBe(2);
    const reportText = await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8');
    expect(reportText).toContain('用户登录或验证账号时');
    expect(reportText).toContain('登录密码、登录账号');
    expect(reportText).not.toContain('用于用于');
    expect(reportText).not.toContain('用户输入或系统 API');
  });

  it('moves english-only permission hints to app-level fallback when feature extraction is skipped', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-perm-'));
    const { outputDirAbs, featureDirAbs } = await writeMinimalFeatureRun({
      repoRoot,
      appPermissions: ['ohos.permission.INTERNET'],
      sinkApiKey: '@ohos.net.connection.hasDefaultNetSync',
      sinkDescription: 'Checks whether the default data network is activated.',
      dataflowNodeCode: 'const hasNet: boolean = connection.hasDefaultNetSync();',
      featureTitle: '功能入口',
    });

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.permissionPractices).toEqual([]);

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.permissionPractices).toHaveLength(1);
    expect(syntheticFacts.permissionPractices[0]?.permissionName).toBe('ohos.permission.INTERNET');

    const reportText = await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8');
    expect(reportText).not.toContain('测试页检查网络连接状态时');
    expect(reportText).not.toContain('Checks whether the default data network is activated.');
  });
});
