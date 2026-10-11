import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

import { readJsonFile, writeJsonFile } from '../../utils/accessWorkspace.js';
import { scanFunctionBlocks, type FunctionBlock } from '../callgraph/functionBlocks.js';
import { buildLineStarts, findMatchingDelimiter, lineNumberAt } from '../../utils/scanSourceText.js';
import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { FeatureInfo, PageFeaturesIndex, PageInfo, PagesIndex } from '../feature/types.js';
import type { PrivacyReportFile, PrivacyReportJumpTo } from './types.js';

const FALLBACK_PAGE = '_app_permissions';
const FALLBACK_FEATURE = '__app_permissions';
const isEvidenceFlow = (flow: Dataflow) => flow.flowId.startsWith('flow:app_evidence_');
const site = (node: Dataflow['nodes'][number]) => `${node.filePath.replaceAll('\\', '/')}:${node.line}:${node.code.trim()}`;

type Owner = { page: PageInfo; index: PageFeaturesIndex; feature: FeatureInfo; dataflows: DataflowsResult; dir: string };

async function readOptional<T>(file: string): Promise<T | undefined> {
  try { return await readJsonFile(file) as T; } catch { return undefined; }
}

/** Resolve application-wide privacy evidence back to its verified page/function owner.
 * Extraction can be batched at app level; this must not erase the graph's UI ownership.
 */
export async function associatePrivacyReportLinks(args: {
  repoRoot: string; outputDirAbs: string; report: PrivacyReportFile;
}): Promise<{ assigned: number; fallback: number }> {
  const pagesPath = path.join(args.outputDirAbs, 'pages/index.json');
  const pages = await readOptional<PagesIndex>(pagesPath);
  const evidence = await readOptional<DataflowsResult>(path.join(args.outputDirAbs, 'app_permissions/dataflows.json'));
  if (!pages || !evidence) return { assigned: 0, fallback: 0 };
  const byFlow = new Map(evidence.flows.map((flow) => [flow.flowId, flow]));
  const fallbackPage = pages.pages.find((page) => page.pageId === FALLBACK_PAGE);
  let fallbackIndex: PageFeaturesIndex | undefined;
  if (fallbackPage) {
    fallbackPage.entry ??= { filePath: 'app_permissions' };
    fallbackPage.entry.description = '应用级隐私证据';
    const file = path.join(args.outputDirAbs, 'pages', FALLBACK_PAGE, 'features/index.json');
    const index = await readOptional<PageFeaturesIndex>(file);
    fallbackIndex = index;
    if (index) {
      index.page ??= { pageId: FALLBACK_PAGE, entry: { filePath: 'app_permissions' } };
      index.page.entry ??= { filePath: 'app_permissions' };
      index.page.entry.description = '应用级隐私证据';
      const feature = index.features.find((item) => item.featureId === FALLBACK_FEATURE);
      if (feature) feature.title = '未归属页面/功能的证据';
      await writeJsonFile(file, index);
    }
  }
  const owners: Owner[] = [];
  const indexes = new Map<string, PageFeaturesIndex>();
  const changed = new Set<Owner>();
  for (const page of pages.pages) {
    if (page.pageId === FALLBACK_PAGE) continue;
    const index = await readOptional<PageFeaturesIndex>(path.join(args.outputDirAbs, 'pages', page.pageId, 'features/index.json'));
    if (!index) continue;
    indexes.set(page.pageId, index);
    for (const feature of index.features) {
      const dir = path.join(args.outputDirAbs, 'pages', page.pageId, 'features', feature.featureId);
      const dataflows = await readOptional<DataflowsResult>(path.join(dir, 'dataflows.json'));
      if (!dataflows) continue;
      const owner = { page, index, feature, dataflows, dir };
      // Remove prior copied evidence before matching, so a second repair uses the
      // original graph/function evidence rather than its own previous assignment.
      if (dataflows.flows.some(isEvidenceFlow)) {
        dataflows.flows = dataflows.flows.filter((flow) => !isEvidenceFlow(flow));
        changed.add(owner);
      }
      owners.push(owner);
    }
  }
  const blocksCache = new Map<string, FunctionBlock[]>();
  const textCache = new Map<string, string>();
  const blocksFor = async (filePath: string) => {
    let blocks = blocksCache.get(filePath);
    if (!blocks) {
      const abs = path.resolve(args.repoRoot, filePath);
      const relative = path.relative(args.repoRoot, abs);
      const text = relative.startsWith('..') || path.isAbsolute(relative) ? '' : await fs.readFile(abs, 'utf8').catch(() => '');
      blocks = scanFunctionBlocks(text, ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
      textCache.set(filePath, text);
      blocksCache.set(filePath, blocks);
    }
    return blocks;
  };
  const pickOwner = async (flow: Dataflow): Promise<Owner | undefined> => {
    if (flow.nodes.length < 2 || flow.edges.length === 0) return undefined;
    const sites = new Set(flow.nodes.map(site));
    let candidates = owners.filter((owner) => owner.dataflows.flows.some((original) => {
      if (isEvidenceFlow(original)) return false;
      if (original.pathId !== flow.pathId) return false;
      const originalSites = new Set(original.nodes.map(site));
      return [...sites].every((key) => originalSites.has(key));
    }));
    if (candidates.length === 0) {
      // A recovered local path can be attached only to an existing feature whose
      // actual function body encloses its source lines. File-name similarity alone
      // is not sufficient, especially with multiple structs in the same file.
      const entry = flow.nodes[0]!;
      if (!flow.nodes.every((node) => node.filePath === entry.filePath)) return undefined;
      const blocks = await blocksFor(entry.filePath);
      const scoped = owners.flatMap((owner) => {
        if (owner.feature.anchor.filePath !== entry.filePath) return [];
        const block = blocks.find((item) => item.startLine === owner.feature.anchor.line
          && flow.nodes.every((node) => node.line >= item.startLine && node.line <= item.endLine));
        return block ? [{ owner, size: block.endLine - block.startLine }] : [];
      });
      if (scoped.length > 0) {
        const smallest = Math.min(...scoped.map((item) => item.size));
        candidates = scoped.filter((item) => item.size === smallest).map((item) => item.owner);
      }
      if (candidates.length === 0) {
        const text = textCache.get(entry.filePath) ?? '';
        const starts = buildLineStarts(text);
        const classRanges = [...text.matchAll(/\b(?:class|struct)\s+([\w]+)[^\n{]*\{/gu)].flatMap((match) => {
          const open = (match.index ?? 0) + match[0].length - 1;
          const close = findMatchingDelimiter(text, open, '{', '}');
          return close === null ? [] : [{ name: match[1], start: lineNumberAt(starts, open), end: lineNumberAt(starts, close) }];
        });
        const matchingPages = pages.pages.filter((page) => page.pageId !== FALLBACK_PAGE && page.entry.filePath === entry.filePath
          && classRanges.some((range) => range.name === page.entry.structName && flow.nodes.every((node) => node.line >= range.start && node.line <= range.end)));
        const lines = text.split(/\r?\n/u);
        const methods = blocks.filter((block) => flow.nodes.every((node) => node.line >= block.startLine && node.line <= block.endLine)
          && (/^[a-z_$]/u.test(block.name) || /^\s*(?:export|function|async|private|public|protected|@Builder)\b/u.test(lines[block.startLine - 1] ?? '')
            || /^\s*@Builder\b/u.test(lines[block.startLine - 2] ?? '')))
          .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
        const block = methods[0];
        if (matchingPages.length === 1 && block) {
          // Some functions have no SDK sink and therefore no pre-existing feature.
          // Create a source feature anchored to the verified method in the real
          // page/struct, instead of treating its fields as app-level permissions.
          const page = matchingPages[0]!;
          const index = indexes.get(page.pageId);
          if (index) {
            const existing = owners.find((owner) => owner.page.pageId === page.pageId && owner.feature.anchor.filePath === entry.filePath && owner.feature.anchor.line === block.startLine);
            if (existing) candidates = [existing];
            else {
              const hash = crypto.createHash('sha1').update(`${page.pageId}:${entry.filePath}:${block.startLine}:${block.name}`).digest('hex').slice(0, 12);
              const feature: FeatureInfo = {
                featureId: `src_privacy_${hash}`, kind: 'source',
                title: block.name === 'build' ? `${page.entry.description ?? page.pageId}展示与交互` : `${page.entry.description ?? page.pageId}逻辑：${block.name}`,
                anchor: { filePath: entry.filePath, line: block.startLine, functionName: block.name },
                counts: { flows: 0, nodes: 0, edges: 0 },
              };
              const owner: Owner = { page, index, feature, dir: path.join(args.outputDirAbs, 'pages', page.pageId, 'features', feature.featureId),
                dataflows: { meta: { runId: args.report.meta.runId, generatedAt: new Date().toISOString(), counts: { flows: 0, nodes: 0, edges: 0 } }, flows: [] } };
              index.features.push(feature); owners.push(owner); candidates = [owner]; changed.add(owner);
            }
          }
        }
      }
    }
    if (candidates.length === 0) return undefined;
    const entry = flow.nodes[0]!;
    const directPage = candidates.filter((owner) => owner.page.entry.filePath === entry.filePath);
    if (directPage.length > 0) candidates = directPage;
    // Keep ambiguous callers in the app-level bucket rather than guessing a page.
    if (new Set(candidates.map((owner) => owner.page.pageId)).size !== 1) return undefined;
    const exactEntry = candidates.filter((owner) => owner.feature.anchor.filePath === entry.filePath && owner.feature.anchor.line === entry.line);
    if (exactEntry.length > 0) candidates = exactEntry;
    const ui = candidates.filter((owner) => owner.feature.kind === 'ui');
    if (ui.length > 0) candidates = ui;
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const destinations = new Map<string, { owner?: Owner; jump: PrivacyReportJumpTo }>();
  const assignments: { text: string; pageId: string; featureId: string; flowId: string; nodeId: string }[] = [];
  let assigned = 0;
  let fallback = 0;
  for (const section of [...args.report.sections.collectionAndUse, ...args.report.sections.permissions]) {
    for (const token of section.tokens) {
      if (!token.jumpTo) continue;
      const flow = byFlow.get(token.jumpTo.flowId);
      if (!flow || !flow.nodes.some((node) => node.id === token.jumpTo!.nodeId)) continue;
      let destination = destinations.get(flow.flowId);
      if (!destination) {
        const owner = await pickOwner(flow);
        destination = { owner, jump: {
          pageId: owner?.page.pageId ?? FALLBACK_PAGE,
          featureId: owner?.feature.featureId ?? FALLBACK_FEATURE,
          flowId: flow.flowId, nodeId: token.jumpTo.nodeId,
        } };
        if (owner) { owner.dataflows.flows.push(flow); changed.add(owner); }
        destinations.set(flow.flowId, destination);
      }
      token.jumpTo = { ...destination.jump, nodeId: token.jumpTo.nodeId };
      if (destination.owner) assigned += 1; else fallback += 1;
      assignments.push({ text: token.text, ...token.jumpTo, pageId: token.jumpTo.pageId! });
    }
  }
  if (fallbackPage && fallbackIndex) {
    // Keep the complete app evidence artifact for repeatable repair, but only
    // expose unassigned graphs in the visible unassigned page/function bucket.
    const flows = evidence.flows.filter((flow) => !destinations.get(flow.flowId)?.owner);
    const counts = { flows: flows.length, nodes: flows.reduce((sum, flow) => sum + flow.nodes.length, 0), edges: flows.reduce((sum, flow) => sum + flow.edges.length, 0) };
    const dir = path.join(args.outputDirAbs, 'pages', FALLBACK_PAGE, 'features', FALLBACK_FEATURE);
    await writeJsonFile(path.join(dir, 'dataflows.json'), { ...evidence, flows, meta: { ...evidence.meta, counts } });
    const feature = fallbackIndex.features.find((item) => item.featureId === FALLBACK_FEATURE);
    if (feature) feature.counts = counts;
    fallbackIndex.meta.counts.flows = flows.length;
    fallbackPage.counts.flows = flows.length;
    await writeJsonFile(path.join(args.outputDirAbs, 'pages', FALLBACK_PAGE, 'features/index.json'), fallbackIndex);
  }
  for (const owner of changed) {
    const flows = owner.dataflows.flows;
    const counts = { flows: flows.length, nodes: flows.reduce((sum, flow) => sum + flow.nodes.length, 0), edges: flows.reduce((sum, flow) => sum + flow.edges.length, 0) };
    owner.feature.counts = counts;
    owner.dataflows.meta.counts = counts;
    await writeJsonFile(path.join(owner.dir, 'dataflows.json'), owner.dataflows);
  }
  for (const [pageId, index] of indexes) {
    index.meta.counts.flows = index.features.reduce((sum, feature) => sum + feature.counts.flows, 0);
    index.meta.counts.features = index.features.length;
    const page = pages.pages.find((item) => item.pageId === pageId)!;
    page.counts.flows = index.meta.counts.flows;
    page.counts.features = index.features.length;
    await writeJsonFile(path.join(args.outputDirAbs, 'pages', pageId, 'features/index.json'), index);
  }
  pages.meta.counts.flows = pages.pages.reduce((sum, page) => sum + page.counts.flows, 0);
  pages.meta.counts.features = pages.pages.reduce((sum, page) => sum + page.counts.features, 0);
  await writeJsonFile(pagesPath, pages);
  await writeJsonFile(path.join(args.outputDirAbs, 'privacy_link_assignments.json'), { assigned, fallback, links: assignments });
  return { assigned, fallback };
}

export async function repairPrivacyReportClassification(args: { repoRoot: string; outputDirAbs: string }) {
  const file = path.join(args.outputDirAbs, 'privacy_report.json');
  const report = await readJsonFile(file) as PrivacyReportFile;
  const result = await associatePrivacyReportLinks({ ...args, report });
  await writeJsonFile(file, report);
  return result;
}
