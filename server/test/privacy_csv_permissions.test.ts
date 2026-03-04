import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { generatePrivacyReportArtifacts } from '../src/analyzer/privacyReport/generatePrivacyReportArtifacts.js';

describe('privacy facts - deterministic permissions from CSV', () => {
  it('injects CSV-mapped permissions into privacy_facts.json and privacy_report.json', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-repo-'));
    const outputDirAbs = path.join(repoRoot, 'output', 'App', 'run1');
    const csvDirAbs = path.join(repoRoot, 'input', 'csv');
    await fs.mkdir(path.join(outputDirAbs, 'pages', 'P1', 'features', 'ui_P1_feature'), { recursive: true });
    await fs.mkdir(csvDirAbs, { recursive: true });

    await fs.writeFile(
      path.join(csvDirAbs, 'sdk_api_and_permission.csv'),
      [
        '敏感行为,行为子项,相关API,相关权限,敏感数据项,敏感数据子项',
        '页面跳转,跳转页面,"@ohos.router.pushUrl(options: any): void",ohos.permission.INTERNET,,',
        '',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(outputDirAbs, 'meta.json'),
      JSON.stringify(
        {
          runId: 'App_run1',
          input: { csvDir: csvDirAbs },
        },
        null,
        2,
      ),
      'utf8',
    );

    await fs.writeFile(
      path.join(outputDirAbs, 'sinks.json'),
      JSON.stringify(
        [
          {
            App源码文件路径: 'app/main.ets',
            导入行号: 1,
            导入代码: "import router from '@ohos.router';",
            调用行号: 10,
            调用代码: "router.pushUrl({ url: 'pages/a' });",
            API功能描述: '页面跳转 / 跳转页面; 权限: ohos.permission.INTERNET',
            __apiKey: '@ohos.router.pushUrl',
            __module: '@ohos.router',
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    await fs.writeFile(path.join(outputDirAbs, 'sources.json'), JSON.stringify([], null, 2), 'utf8');

    await fs.writeFile(
      path.join(outputDirAbs, 'pages', 'index.json'),
      JSON.stringify(
        {
          meta: { runId: 'App_run1', generatedAt: new Date().toISOString(), counts: { pages: 1, features: 1, flows: 1, unassignedFlows: 0 } },
          pages: [
            {
              pageId: 'P1',
              entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' },
              counts: { features: 1, flows: 1 },
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await fs.writeFile(
      path.join(outputDirAbs, 'pages', 'P1', 'features', 'index.json'),
      JSON.stringify(
        {
          meta: { runId: 'App_run1', generatedAt: new Date().toISOString(), pageId: 'P1', counts: { features: 1, flows: 1 } },
          page: { pageId: 'P1', entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' } },
          features: [
            {
              featureId: 'ui_P1_feature',
              title: '跳转页面',
              kind: 'ui',
              anchor: { filePath: 'app/main.ets', line: 10, uiNodeId: 'ui:1' },
              counts: { flows: 1, nodes: 1, edges: 0 },
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await fs.writeFile(
      path.join(outputDirAbs, 'pages', 'P1', 'features', 'ui_P1_feature', 'dataflows.json'),
      JSON.stringify(
        {
          meta: {
            runId: 'App_run1',
            generatedAt: new Date().toISOString(),
            counts: { flows: 1, nodes: 1, edges: 0 },
            page: { pageId: 'P1', entry: { filePath: 'app/main.ets', structName: 'Index', line: 1, description: '测试页' } },
            feature: { featureId: 'ui_P1_feature', kind: 'ui', title: '跳转页面' },
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
                  code: "router.pushUrl({ url: 'pages/a' });",
                  description: '页面跳转',
                  context: { startLine: 9, lines: ['// dummy'] },
                },
              ],
              edges: [],
              summary: {},
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await generatePrivacyReportArtifacts({
      repoRoot,
      runId: 'App_run1',
      appName: 'App',
      outputDirAbs,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
    });

    const factsPath = path.join(outputDirAbs, 'pages', 'P1', 'features', 'ui_P1_feature', 'privacy_facts.json');
    const reportPath = path.join(outputDirAbs, 'privacy_report.json');
    const facts = JSON.parse(await fs.readFile(factsPath, 'utf8')) as any;
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as any;

    const permPractices = facts?.facts?.permissionPractices ?? [];
    expect(Array.isArray(permPractices)).toBe(true);
    expect(permPractices.some((p: any) => p.permissionName === 'ohos.permission.INTERNET')).toBe(true);

    const permissionSection = (report?.sections?.permissions ?? []).find((s: any) => s.featureId === 'ui_P1_feature');
    const tokens = permissionSection?.tokens ?? [];
    const internetToken = tokens.find((t: any) => t.text === 'ohos.permission.INTERNET');
    expect(internetToken).toBeTruthy();
    expect(internetToken.jumpTo).toEqual({ featureId: 'ui_P1_feature', flowId: 'flow:p1', nodeId: 'p1:n1' });
  });
});

