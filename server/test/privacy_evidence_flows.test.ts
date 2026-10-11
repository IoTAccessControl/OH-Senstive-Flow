import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildPrivacyEvidenceFlows } from '../src/analyzer/privacy/evidenceFlows.js';
import { buildSyntheticPermissionFlows, repairPrivacyReportEvidence } from '../src/analyzer/privacy/report.js';
import { scanAppArkTsFiles } from '../src/analyzer/extract/app.js';
import type { DataflowNode } from '../src/analyzer/dataflow/types.js';

function node(id: string, line: number, code: string, filePath = 'app/page.ets'): DataflowNode {
  return { id, filePath, line, code, description: id, context: { startLine: line, lines: [code] } };
}

describe('privacy report evidence paths', () => {
  it('keeps the entire analyzed path and rewrites both edge endpoints for the report anchor', async () => {
    const original = {
      flowId: 'flow:p1', pathId: 'p1',
      nodes: [node('entry', 1, 'build() {'), node('use', 4, 'send(this.keyword)'), node('sink', 5, 'save()')],
      edges: [{ from: 'entry', to: 'use' }, { from: 'use', to: 'sink' }],
    };
    const result = await buildPrivacyEvidenceFlows({
      repoRoot: '/missing', runId: 'run1', existingFlows: [original],
      evidence: [{ node: node('data:keyword', 4, 'send(this.keyword)'), occurrences: [original.nodes[1]!], summary: { dataItems: ['搜索关键词'] } }],
    });
    expect(result.flows[0]?.nodes.map((item) => item.id)).toEqual(['entry', 'data:keyword', 'sink']);
    expect(result.flows[0]?.edges).toEqual([{ from: 'entry', to: 'data:keyword' }, { from: 'data:keyword', to: 'sink' }]);
    expect(original.edges[0]?.to).toBe('use');
    expect(result.meta.counts).toEqual({ flows: 1, nodes: 3, edges: 2 });
  });

  it('recovers a third-party API path from symbol uses in one function, without mixing lifecycle entries', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-evidence-'));
    try {
      await fs.mkdir(path.join(repoRoot, 'app'));
      await fs.writeFile(path.join(repoRoot, 'app', 'page.ets'), [
        'class Page {', '  async requestSearch() {', "    let cookies = 'session';", '    return client.search(cookies);', '  }',
        '  onDisappear() {', '    client.clear(cookies);', '  }', '}',
      ].join('\n'));
      const evidence = node('data:Cookie', 3, "let cookies = 'session';");
      const result = await buildPrivacyEvidenceFlows({ repoRoot, runId: 'run1', existingFlows: [], evidence: [
        { node: evidence, occurrences: [evidence], summary: { dataItems: ['Cookie'] } },
        { node: node('perm:INTERNET', 1, 'ohos.permission.INTERNET', 'app/module.json5'), occurrences: [], summary: { permissions: ['ohos.permission.INTERNET'] } },
      ] });
      expect(result.flows).toHaveLength(2);
      expect(result.flows[0]?.nodes.map((item) => item.line)).toEqual([2, 3, 4]);
      expect(result.flows[0]?.edges).toHaveLength(2);
      expect(result.flows[1]?.nodes).toHaveLength(1);
      expect(result.flows[1]?.edges).toEqual([]);
      expect(result.flows[1]?.meta?.warnings?.[0]).toContain('尚未识别出调用路径');
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it.each(['export function', 'export default async function'])('recovers a Cookie path inside an %s declaration', async (declaration) => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-export-'));
    try {
      await fs.mkdir(path.join(repoRoot, 'app'));
      await fs.writeFile(path.join(repoRoot, 'app/request.ets'), [
        `${declaration} requestHtml(url: string) {`,
        '  return request(url).then((value) => {',
        "    serverData.msg = value.header['set-cookie'];",
        '    return serverData;', '  });', '}',
      ].join('\n'));
      const evidence = node('data:Cookie', 3, "serverData.msg = value.header['set-cookie'];", 'app/request.ets');
      const result = await buildPrivacyEvidenceFlows({ repoRoot, runId: 'run1', existingFlows: [], evidence: [
        { node: evidence, occurrences: [evidence], summary: { dataItems: ['Cookie'] } },
      ] });
      expect(result.flows[0]?.nodes.map((item) => item.line)).toEqual([1, 3]);
      expect(result.flows[0]?.edges).toHaveLength(1);
      expect(result.flows[0]?.nodes[1]?.id).toBe('data:Cookie');
    } finally { await fs.rm(repoRoot, { recursive: true, force: true }); }
  });

  it('follows a declared state field to its input and write within an inline @Builder, excluding other components and string mentions', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-field-'));
    try {
      await fs.mkdir(path.join(repoRoot, 'app'));
      await fs.writeFile(path.join(repoRoot, 'app', 'page.ets'), [
        'struct Form {', "  @State name: string = ''; // 姓名", '  @Builder Input() {',
        '    TextInput({text: this.name})', '      .onChange((value) => {', '        this.name = value;', '      })',
        "    Text('this.name');", '  }', '}', 'struct Other {', '  build() {', '    send(this.name);', '  }', '}',
      ].join('\n'));
      const evidence = node('data:name', 2, "@State name: string = ''; // 姓名");
      const result = await buildPrivacyEvidenceFlows({ repoRoot, runId: 'run1', existingFlows: [], evidence: [
        { node: evidence, occurrences: [evidence], summary: { dataItems: ['姓名'] } },
      ] });
      expect(result.flows[0]?.nodes.map((item) => item.line)).toEqual([3, 4, 6]);
      expect(result.flows[0]?.edges).toHaveLength(2);
      expect(result.flows[0]?.nodes.find((item) => item.id === 'data:name')?.line).toBe(6);
    } finally { await fs.rm(repoRoot, { recursive: true, force: true }); }
  });

  it('selects only the component connected to the report anchor when an analyzed flow contains orphan nodes', async () => {
    const target = node('target', 2, 'send(this.keyword)');
    const result = await buildPrivacyEvidenceFlows({ repoRoot: '/missing', runId: 'run1', evidence: [
      { node: node('data:keyword', 2, target.code), occurrences: [target], summary: { dataItems: ['搜索关键词'] } },
    ], existingFlows: [{ flowId: 'flow:p1', pathId: 'p1', nodes: [node('entry', 1, 'build() {'), target, node('unrelated', 20, 'other()')],
      edges: [{ from: 'entry', to: 'target' }, { from: 'target', to: 'missing' }] }] });
    expect(result.flows[0]?.nodes.map((item) => item.id)).toEqual(['entry', 'data:keyword']);
    expect(result.flows[0]?.edges).toEqual([{ from: 'entry', to: 'data:keyword' }]);
  });

  it('keeps finding field uses after interpolated template strings', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-template-'));
    try {
      await fs.mkdir(path.join(repoRoot, 'app'));
      await fs.writeFile(path.join(repoRoot, 'app/page.ets'), [
        'struct Form {', "  @State houseData: string = ''; // 房屋数据", '  build() {',
        '    Text(`hello ${this.name}`)', '    Select(options).value(this.houseData)',
        '      .onSelect((value) => { this.houseData = value; })', '  }', '}',
      ].join('\n'));
      const evidence = node('data:house', 2, "@State houseData: string = ''; // 房屋数据");
      const result = await buildPrivacyEvidenceFlows({ repoRoot, runId: 'run1', existingFlows: [], evidence: [
        { node: evidence, occurrences: [evidence], summary: { dataItems: ['房屋数据'] } },
      ] });
      expect(result.flows[0]?.nodes.map((item) => item.line)).toEqual([3, 5, 6]);
      expect(result.flows[0]?.edges).toHaveLength(2);
    } finally { await fs.rm(repoRoot, { recursive: true, force: true }); }
  });

  it('scans original application sources instead of .preview and oh_modules copies', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-source-'));
    try {
      for (const dir of ['entry/src/main/ets/pages', 'entry/.preview/default/src/main/ets/pages', 'oh_modules/library/src/main/ets/pages']) {
        await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
        await fs.writeFile(path.join(repoRoot, dir, 'Index.ets'), 'struct Page { build() {} }');
      }
      expect(await scanAppArkTsFiles(repoRoot)).toEqual([path.join(repoRoot, 'entry/src/main/ets/pages/Index.ets')]);
    } finally { await fs.rm(repoRoot, { recursive: true, force: true }); }
  });

  it('resolves a permission to the API path before falling back to a configuration declaration', async () => {
    const sink = node('sink', 4, 'connection.hasDefaultNetSync();');
    const built = await buildSyntheticPermissionFlows({
      repoRoot: '/missing', runId: 'run1', featureId: '__app_permissions',
      permissions: ['ohos.permission.GET_NETWORK_INFO'], dataItems: [], dataItemOccurrences: [],
      occurrences: [{ permissionName: 'ohos.permission.GET_NETWORK_INFO', filePath: 'app/module.json5', line: 3, code: 'ohos.permission.GET_NETWORK_INFO' }],
      sinks: [{ 'App源码文件路径': sink.filePath, '调用行号': sink.line, '调用代码': sink.code, __apiKey: '@ohos.net.connection.hasDefaultNetSync' } as any],
      csvPermissions: new Map([['@ohos.net.connection.hasDefaultNetSync', ['ohos.permission.GET_NETWORK_INFO']]]),
      existingFlows: [{ flowId: 'flow:p1', pathId: 'p1', nodes: [node('entry', 1, 'aboutToAppear() {'), sink], edges: [{ from: 'entry', to: 'sink' }] }],
    });
    const ref = built.refsByPermission.get('ohos.permission.GET_NETWORK_INFO')?.[0];
    const flow = built.dataflows.flows.find((item) => item.flowId === ref?.flowId);
    expect(flow?.nodes.find((item) => item.id === ref?.nodeId)?.filePath).toBe('app/page.ets');
    expect(flow?.edges).toHaveLength(1);
  });

  it('repairs legacy report links and indexes without rewriting paragraphs, and remains safe to run twice', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-repair-'));
    const outputDirAbs = path.join(repoRoot, 'output', 'App', 'run1');
    const write = async (file: string, value: unknown) => {
      const target = path.join(outputDirAbs, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify(value));
    };
    try {
      await fs.mkdir(path.join(repoRoot, 'input', 'csv'), { recursive: true });
      await fs.writeFile(path.join(repoRoot, 'input', 'csv', 'privacy_rules.csv'), 'type,keywords,outputName,rule\ndata_item,let cookies =,Cookie,\ndata_item,let account =,登录账号,\n');
      await fs.mkdir(path.join(repoRoot, 'app'));
      await fs.writeFile(path.join(repoRoot, 'app', 'page.ets'), "class Page {\n  search() {\n    let cookies = 'session';\n    let account = 'user';\n    client.search(cookies, account);\n  }\n}");
      const oldRef = { flowId: 'flow:app_permissions', nodeId: 'data:old' };
      await write('meta.json', { runId: 'App_run1', input: { appPath: 'app', csvDir: 'input/csv' } });
      await write('app_permissions/dataflows.json', { meta: { counts: { flows: 1, nodes: 1, edges: 0 } }, flows: [
        { ...oldRef, pathId: 'old', nodes: [node('data:old', 3, "let cookies = 'session';")], edges: [], summary: { dataItems: ['Cookie'] } },
      ] });
      await write('app_permissions/privacy_facts.json', { permissionPractices: [], dataPractices: [{ dataItems: [{ name: 'Cookie', refs: [oldRef] }, { name: '登录账号', refs: [oldRef] }] }] });
      const paragraph = { featureId: '__app_permissions', tokens: [{ text: '收集' }, { text: 'Cookie', jumpTo: { featureId: '__app_permissions', ...oldRef } }, { text: '和' }, { text: '登录账号', jumpTo: { featureId: '__app_permissions', ...oldRef } }, { text: '以维持会话。' }] };
      await write('privacy_report.json', { meta: {}, sections: { collectionAndUse: [paragraph], permissions: [] } });
      await write('pages/_app_permissions/features/index.json', { meta: { counts: { flows: 1 } }, features: [{ featureId: '__app_permissions', counts: { flows: 1, nodes: 1, edges: 0 } }] });
      await write('pages/index.json', { meta: { counts: { flows: 1 } }, pages: [{ pageId: '_app_permissions', counts: { flows: 1 } }] });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const repaired = await repairPrivacyReportEvidence({ repoRoot, outputDirAbs });
        const report = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'privacy_report.json'), 'utf8'));
        const tokens = report.sections.collectionAndUse[0].tokens;
        expect(tokens.map((token: any) => token.text).join('')).toBe('收集Cookie和登录账号以维持会话。');
        const jump = tokens[1].jumpTo;
        const flow = repaired.flows.find((item) => item.flowId === jump.flowId);
        expect(flow?.nodes.some((item) => item.id === jump.nodeId)).toBe(true);
        expect(flow?.edges).toHaveLength(2);
        expect(flow?.summary?.dataItems).toEqual(['Cookie']);
        const accountFlow = repaired.flows.find((item) => item.flowId === tokens[3].jumpTo.flowId);
        expect(accountFlow?.summary?.dataItems).toEqual(['登录账号']);
        expect(tokens[1].jumpTo.nodeId).not.toBe(tokens[3].jumpTo.nodeId);
        const index = JSON.parse(await fs.readFile(path.join(outputDirAbs, 'pages/_app_permissions/features/index.json'), 'utf8'));
        expect(index.features[0].counts).toEqual({ flows: 2, nodes: 6, edges: 4 });
      }
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
