import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { collectPredictedPermissionsFromRun } from '../src/eval/permissionGroundtruthEval.js';

const mockExtractFeaturePrivacyFacts = vi.fn();

vi.mock('../src/analyzer/privacyReport/extractFeaturePrivacyFacts.js', () => ({
  extractFeaturePrivacyFacts: (...args: unknown[]) => mockExtractFeaturePrivacyFacts(...args),
}));

import { generatePrivacyReportArtifacts } from '../src/analyzer/privacyReport/generatePrivacyReportArtifacts.js';

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

    const syntheticFacts = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions', 'privacy_facts.json'), 'utf8')) as any;
    expect(syntheticFacts.facts.permissionPractices.map((item: any) => item.permissionName)).toEqual(['ohos.permission.CAMERA']);

    const report = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'privacy_report.json'), 'utf8')) as any;
    const appPermissionSection = report.sections.permissions.find((section: any) => section.featureId === '__app_permissions');
    expect(appPermissionSection).toBeTruthy();
    expect(appPermissionSection.tokens?.length ?? 0).toBeGreaterThan(0);
    expect(appPermissionSection.tokens[0]?.text ?? '').toContain('ohos.permission.CAMERA');
    expect(appPermissionSection.tokens.some((token: any) => token.jumpTo)).toBe(false);
    expect((report.meta.warnings ?? []).some((item: string) => item.includes('权限段落缺少有效跳转引用'))).toBe(false);
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

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: 'test-key', model: 'qwen3-32b' },
    });

    const facts = JSON.parse(await fs.readFile(path.join(featureDirAbs, 'privacy_facts.json'), 'utf8')) as any;
    expect(facts.facts.permissionPractices.map((item: any) => item.permissionName)).toEqual(['ohos.permission.INTERNET']);
    expect(facts.meta.warnings.some((item: string) => item.includes('ohos.permission.READ_CONTACTS'))).toBe(true);

    const predicted = await collectPredictedPermissionsFromRun(outputDirAbs);
    expect([...predicted]).toEqual(['ohos.permission.INTERNET']);
  });
});
