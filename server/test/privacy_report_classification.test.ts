import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { associatePrivacyReportLinks } from '../src/analyzer/privacy/reportLinks.js';
import type { Dataflow, DataflowsResult } from '../src/analyzer/dataflow/types.js';
import type { PrivacyReportFile } from '../src/analyzer/privacy/types.js';

const node = (id: string, line: number, code = 'read()', filePath = 'app/pages/Hardware.ets') => ({ id, filePath, line, code, description: id });
const graph = (flows: Dataflow[]): DataflowsResult => ({ meta: { runId: 'run', generatedAt: '', counts: { flows: flows.length, nodes: 0, edges: 0 } }, flows });
const original: Dataflow = { flowId: 'flow:p1', pathId: 'p1', nodes: [node('entry', 2, 'onPageShow() {'), node('sink', 3)], edges: [{ from: 'entry', to: 'sink' }] };
const evidence: Dataflow = { ...original, flowId: 'flow:app_evidence_ip', nodes: [original.nodes[0]!, { ...original.nodes[1]!, id: 'data:ip' }], edges: [{ from: 'entry', to: 'data:ip' }] };

async function fixture(features: { pageId: string; featureId: string; anchorLine?: number; flows: Dataflow[] }[], flow = evidence) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-classification-'));
  const outputDirAbs = path.join(repoRoot, 'output');
  const write = async (file: string, data: unknown) => {
    const abs = path.join(outputDirAbs, file); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, JSON.stringify(data));
  };
  await fs.mkdir(path.join(repoRoot, 'app/pages'), { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'app/pages/Hardware.ets'), 'struct Hardware {\n  onPageShow() {\n    read()\n  }\n  unrelated() {\n    read()\n  }\n}');
  const pages = [];
  for (const feature of features) {
    const entry = { filePath: 'app/pages/Hardware.ets', structName: 'Hardware', line: 1, description: feature.pageId };
    pages.push({ pageId: feature.pageId, entry, counts: { features: 1, flows: feature.flows.length } });
    await write(`pages/${feature.pageId}/features/index.json`, { meta: { counts: { features: 1, flows: feature.flows.length } }, page: { pageId: feature.pageId, entry }, features: [{ featureId: feature.featureId, kind: 'source', title: feature.featureId, anchor: { filePath: entry.filePath, line: feature.anchorLine ?? 2 }, counts: { flows: feature.flows.length, nodes: 0, edges: 0 } }] });
    await write(`pages/${feature.pageId}/features/${feature.featureId}/dataflows.json`, graph(feature.flows));
  }
  await write('pages/index.json', { meta: { counts: { pages: pages.length, features: features.length, flows: features.length, unassignedFlows: 0 } }, pages });
  await write('app_permissions/dataflows.json', graph([flow]));
  const report: PrivacyReportFile = { meta: { runId: 'run', generatedAt: '', counts: { features: 1 } }, sections: { collectionAndUse: [{ featureId: '__app_permissions', tokens: [{ text: '收集' }, { text: 'IP地址', jumpTo: { featureId: '__app_permissions', flowId: flow.flowId, nodeId: flow.nodes.at(-1)!.id } }] }], permissions: [] } };
  return { repoRoot, outputDirAbs, report };
}

describe('privacy report page/function ownership', () => {
  it('shows only unassigned graphs in the fallback bucket, while retaining canonical evidence for repair', async () => {
    const args = await fixture([{ pageId: 'Hardware', featureId: 'show', flows: [original] }]);
    try {
      const declaration: Dataflow = { flowId: 'flow:app_evidence_permission', pathId: 'declaration', nodes: [node('perm', 3, 'ohos.permission.INTERNET', 'app/module.json5')], edges: [] };
      await fs.writeFile(path.join(args.outputDirAbs, 'app_permissions/dataflows.json'), JSON.stringify(graph([evidence, declaration])));
      const pagesFile = path.join(args.outputDirAbs, 'pages/index.json');
      const pages = JSON.parse(await fs.readFile(pagesFile, 'utf8'));
      const entry = { filePath: 'app_permissions', description: '应用权限兜底' };
      pages.pages.push({ pageId: '_app_permissions', entry, counts: { features: 1, flows: 2 } });
      await fs.writeFile(pagesFile, JSON.stringify(pages));
      const dir = path.join(args.outputDirAbs, 'pages/_app_permissions/features');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ page: { entry }, meta: { counts: { features: 1, flows: 2 } }, features: [{ featureId: '__app_permissions', counts: { flows: 2, nodes: 3, edges: 1 } }] }));
      args.report.sections.permissions.push({ featureId: '__app_permissions', tokens: [{ text: '网络访问权限', jumpTo: { featureId: '__app_permissions', flowId: declaration.flowId, nodeId: 'perm' } }] });
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 1, fallback: 1 });
      const visible = JSON.parse(await fs.readFile(path.join(dir, '__app_permissions/dataflows.json'), 'utf8'));
      expect(visible.flows.map((flow: Dataflow) => flow.flowId)).toEqual([declaration.flowId]);
      expect(visible.meta.counts).toEqual({ flows: 1, nodes: 1, edges: 0 });
      const canonical = JSON.parse(await fs.readFile(path.join(args.outputDirAbs, 'app_permissions/dataflows.json'), 'utf8'));
      expect(canonical.flows).toHaveLength(2);
      const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
      expect(index.page.entry.description).toBe('应用级隐私证据');
      expect(index.features[0].title).toBe('未归属页面/功能的证据');
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('associates a reused chain with its original feature, preserving selected node, prose and idempotent graph counts', async () => {
    const args = await fixture([{ pageId: 'Hardware', featureId: 'show', flows: [original] }]);
    try {
      for (let i = 0; i < 2; i += 1) {
        expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 1, fallback: 0 });
        expect(args.report.sections.collectionAndUse[0]!.tokens[1]!.jumpTo).toEqual({ pageId: 'Hardware', featureId: 'show', flowId: evidence.flowId, nodeId: 'data:ip' });
        const result = JSON.parse(await fs.readFile(path.join(args.outputDirAbs, 'pages/Hardware/features/show/dataflows.json'), 'utf8'));
        expect(result.flows).toHaveLength(2);
        expect(result.meta.counts).toEqual({ flows: 2, nodes: 4, edges: 2 });
        expect(result.flows[1].edges[0].to).toBe('data:ip');
        expect(args.report.sections.collectionAndUse[0]!.tokens.map((token) => token.text).join('')).toBe('收集IP地址');
      }
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('attaches recovered local references only to the enclosing source function', async () => {
    const args = await fixture([
      { pageId: 'Hardware', featureId: 'show', flows: [] },
    ], { ...evidence, pathId: 'evidence:data:ip' });
    try {
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 1, fallback: 0 });
      expect(args.report.sections.collectionAndUse[0]!.tokens[1]!.jumpTo?.featureId).toBe('show');
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('does not assign an unrelated function merely because it is in the same file', async () => {
    const args = await fixture([{ pageId: 'Hardware', featureId: 'unrelated', anchorLine: 5, flows: [] }], { ...evidence, pathId: 'evidence:data:ip' });
    try {
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 1, fallback: 0 });
      expect(args.report.sections.collectionAndUse[0]!.tokens[1]!.jumpTo?.featureId).toMatch(/^src_privacy_/u);
      const index = JSON.parse(await fs.readFile(path.join(args.outputDirAbs, 'pages/Hardware/features/index.json'), 'utf8'));
      expect(index.features[1].anchor).toEqual({ filePath: 'app/pages/Hardware.ets', line: 2, functionName: 'onPageShow' });
      expect(index.meta.counts.features).toBe(2);
      await associatePrivacyReportLinks(args);
      const repaired = JSON.parse(await fs.readFile(path.join(args.outputDirAbs, 'pages/Hardware/features/index.json'), 'utf8'));
      expect(repaired.features).toHaveLength(2);
      expect(repaired.meta.counts.flows).toBe(1);
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('keeps ambiguous shared paths in the app bucket rather than picking the first page', async () => {
    const args = await fixture([{ pageId: 'CallerA', featureId: 'a', flows: [original] }, { pageId: 'CallerB', featureId: 'b', flows: [original] }]);
    try {
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 0, fallback: 1 });
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('keeps declaration-only permission evidence in the app bucket', async () => {
    const args = await fixture([{ pageId: 'Hardware', featureId: 'show', flows: [original] }], { flowId: 'flow:app_evidence_permission', pathId: 'evidence:permission', nodes: [node('perm', 3, 'ohos.permission.INTERNET', 'app/module.json5')], edges: [] });
    try {
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 0, fallback: 1 });
      expect(args.report.sections.collectionAndUse[0]!.tokens[1]!.jumpTo?.pageId).toBe('_app_permissions');
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });

  it('does not create a feature under a different struct in the same source file', async () => {
    const args = await fixture([{ pageId: 'Other', featureId: 'unrelated', anchorLine: 5, flows: [] }], { ...evidence, pathId: 'evidence:data:ip' });
    try {
      const file = path.join(args.outputDirAbs, 'pages/index.json');
      const pages = JSON.parse(await fs.readFile(file, 'utf8'));
      pages.pages[0].entry.structName = 'Other';
      await fs.writeFile(file, JSON.stringify(pages));
      expect(await associatePrivacyReportLinks(args)).toEqual({ assigned: 0, fallback: 1 });
    } finally { await fs.rm(args.repoRoot, { recursive: true, force: true }); }
  });
});
