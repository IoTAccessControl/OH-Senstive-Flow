import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { scanFunctionBlocks, type FunctionBlock } from '../callGraph/functionBlocks.js';
import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { SourceRecord } from '../types.js';
import type { UiTreeNode, UiTreeResult } from '../uiTree/types.js';

import type { FeatureInfo, PageFeaturesIndex, PageInfo, PagesIndex } from './types.js';

type BuiltPage = {
  pageId: string;
  rootId: string;
  entry: {
    filePath: string;
    structName?: string;
    line?: number;
    description?: string;
  };
  uiNodes: UiTreeNode[];
  uiNodeByLine: Map<number, UiTreeNode[]>;
  uiLinesSorted: number[];
  pageRangeStartLine: number;
  pageRangeEndLine: number;
  buildRangeStartLine: number;
  buildRangeEndLine: number;
};

type BuiltFeature = {
  feature: Omit<FeatureInfo, 'counts'>;
  flows: Dataflow[];
};

export type GroupedPageFeatures = {
  pagesIndex: PagesIndex;
  pages: Array<{
    page: PageInfo;
    uiTree: UiTreeResult | null;
    featuresIndex: PageFeaturesIndex;
    features: Array<{ feature: FeatureInfo; dataflows: DataflowsResult }>;
  }>;
};

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function sanitizeId(text: string): string {
  const raw = text.replaceAll(/[^\w-]+/gu, '_').replaceAll(/^_+|_+$/gu, '').replaceAll(/_+/gu, '_');
  return raw;
}

function pathBaseName(filePath: string): string {
  const parts = filePath.split('/');
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/\.[^.]+$/u, '');
}

function buildPageId(args: { structName?: string; filePath: string; used: Set<string> }): string {
  const baseName = args.structName?.trim() ? args.structName.trim() : pathBaseName(args.filePath) || 'page';
  const base = sanitizeId(baseName) || 'page';
  if (!args.used.has(base)) {
    args.used.add(base);
    return base;
  }
  const suffix = sha1(args.filePath).slice(0, 8);
  const full = `${base}_${suffix}`;
  args.used.add(full);
  return full;
}

function groupSourcesByFileLine(sources: SourceRecord[]): Map<string, SourceRecord[]> {
  const map = new Map<string, SourceRecord[]>();
  for (const s of sources) {
    const key = `${s['App源码文件路径']}:${s['行号']}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

function pickSourceForFlow(flow: Dataflow, sourcesByFileLine: Map<string, SourceRecord[]>): SourceRecord | null {
  for (const n of flow.nodes) {
    const key = `${n.filePath}:${n.line}`;
    const hits = sourcesByFileLine.get(key);
    if (!hits || hits.length === 0) continue;
    return hits.find((s) => s['函数名称'] === 'build') ?? hits[0] ?? null;
  }
  return null;
}

function buildUiNodeIndex(uiNodes: UiTreeNode[]): { byLine: Map<number, UiTreeNode[]>; linesSorted: number[] } {
  const byLine = new Map<number, UiTreeNode[]>();
  const lines: number[] = [];
  for (const n of uiNodes) {
    const ln = typeof n.line === 'number' ? n.line : null;
    if (!ln || ln <= 0) continue;
    const list = byLine.get(ln) ?? [];
    list.push(n);
    byLine.set(ln, list);
    lines.push(ln);
  }
  const uniq = Array.from(new Set(lines)).sort((a, b) => a - b);
  return { byLine, linesSorted: uniq };
}

function upperBound(arr: number[], x: number): number {
  // returns first index i where arr[i] > x
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearestLineAtOrBefore(sortedLines: number[], x: number): number | null {
  if (sortedLines.length === 0) return null;
  const idx = upperBound(sortedLines, x) - 1;
  if (idx < 0) return null;
  return sortedLines[idx] ?? null;
}

function buildUiFeatureId(pageId: string, uiNode: UiTreeNode): string {
  const short = String(uiNode.id ?? '').includes(':') ? String(uiNode.id).split(':')[1] : sha1(String(uiNode.id ?? '')).slice(0, 12);
  const base = sanitizeId(`${uiNode.name ?? uiNode.category}_${uiNode.line ?? 0}`) || 'ui';
  return sanitizeId(`ui_${pageId}_${base}_${short}`) || `ui_${short}`;
}

function buildSourceFeatureId(pageId: string, source: SourceRecord): string {
  const fn = String(source['函数名称'] ?? 'source');
  const ln = Number(source['行号'] ?? 0) || 0;
  const base = sanitizeId(`${fn}_${ln}`) || 'source';
  const suffix = sha1(`${source['App源码文件路径']}:${ln}:${fn}`).slice(0, 8);
  return sanitizeId(`src_${pageId}_${base}_${suffix}`) || `src_${suffix}`;
}

function buildUnknownFeatureId(pageId: string, flow: Dataflow): string {
  const suffix = sha1(`${pageId}:${flow.flowId}:${flow.pathId}`).slice(0, 10);
  return sanitizeId(`unknown_${pageId}_${suffix}`) || `unknown_${suffix}`;
}

function choosePageForSource(pagesInFile: BuiltPage[], sourceLine: number): BuiltPage | null {
  if (!pagesInFile || pagesInFile.length === 0) return null;
  const candidates = pagesInFile
    .slice()
    .sort((a, b) => (Number(a.entry.line ?? 0) || 0) - (Number(b.entry.line ?? 0) || 0));

  const usable = candidates.filter((p) => (Number(p.entry.line ?? 0) || 0) <= sourceLine);
  if (usable.length > 0) return usable[usable.length - 1] ?? null;
  return candidates[0] ?? null;
}

function sliceUiTreeForPage(args: { page: BuiltPage; uiTree: UiTreeResult }): UiTreeResult {
  const pageNode = args.uiTree.nodes[args.page.rootId];
  const nodes: Record<string, UiTreeNode> = {};
  const included = new Set<string>();

  if (pageNode) {
    nodes[args.page.rootId] = pageNode;
    included.add(args.page.rootId);
  }

  for (const n of args.page.uiNodes) {
    nodes[n.id] = n;
    included.add(n.id);
  }

  const edges = (args.uiTree.edges ?? []).filter((e) => included.has(e.from) && included.has(e.to));
  const pages = Object.values(nodes).filter((n) => n.category === 'Page').length;
  const elements = Object.values(nodes).filter((n) => n.category !== 'Page').length;

  return {
    meta: {
      runId: args.uiTree.meta.runId,
      generatedAt: new Date().toISOString(),
      llm: args.uiTree.meta.llm,
      counts: {
        nodes: Object.keys(nodes).length,
        edges: edges.length,
        pages,
        elements,
      },
    },
    roots: pageNode ? [args.page.rootId] : [],
    nodes,
    edges,
  };
}

function countDataflows(flows: Dataflow[]): { flows: number; nodes: number; edges: number } {
  let nodes = 0;
  let edges = 0;
  for (const f of flows) {
    nodes += f.nodes.length;
    edges += f.edges.length;
  }
  return { flows: flows.length, nodes, edges };
}

export async function groupDataflowsByPageFeature(args: {
  runId: string;
  repoRoot: string;
  uiTree: UiTreeResult;
  sources: SourceRecord[];
  dataflows: DataflowsResult;
  maxUiDistanceLines?: number;
}): Promise<GroupedPageFeatures> {
  const MAX_UI_DISTANCE_STRICT_DEFAULT = 80;
  const MAX_UI_DISTANCE_FALLBACK_DEFAULT = 160;
  const maxUiDistanceLinesStrict = Number.isFinite(args.maxUiDistanceLines)
    ? Math.max(1, Math.floor(args.maxUiDistanceLines ?? MAX_UI_DISTANCE_STRICT_DEFAULT))
    : MAX_UI_DISTANCE_STRICT_DEFAULT;
  const maxUiDistanceLinesFallback = Math.max(maxUiDistanceLinesStrict, MAX_UI_DISTANCE_FALLBACK_DEFAULT);
  const generatedAt = new Date().toISOString();

  const usedPageIds = new Set<string>();
  const builtPages: BuiltPage[] = [];

  for (const rootId of args.uiTree.roots ?? []) {
    const rootNode = args.uiTree.nodes[rootId];
    if (!rootNode || rootNode.category !== 'Page') continue;
    const filePath = rootNode.filePath ?? '';
    const structName = rootNode.name;
    const pageId = buildPageId({ structName, filePath, used: usedPageIds });
    builtPages.push({
      pageId,
      rootId,
      entry: {
        filePath,
        structName,
        line: rootNode.line,
        description: rootNode.description,
      },
      uiNodes: [],
      uiNodeByLine: new Map(),
      uiLinesSorted: [],
      pageRangeStartLine: Number(rootNode.line ?? 1) || 1,
      pageRangeEndLine: Number.POSITIVE_INFINITY,
      buildRangeStartLine: 0,
      buildRangeEndLine: 0,
    });
  }

  const pagesByFile = new Map<string, BuiltPage[]>();
  for (const p of builtPages) {
    const key = p.entry.filePath;
    if (!key) continue;
    const list = pagesByFile.get(key) ?? [];
    list.push(p);
    pagesByFile.set(key, list);
  }

  const uiNodesByFile = new Map<string, UiTreeNode[]>();
  for (const n of Object.values(args.uiTree.nodes ?? {})) {
    if (!n || n.category === 'Page') continue;
    if (!n.filePath || typeof n.line !== 'number') continue;
    const list = uiNodesByFile.get(n.filePath) ?? [];
    list.push(n);
    uiNodesByFile.set(n.filePath, list);
  }
  for (const [file, list] of uiNodesByFile) list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || String(a.id).localeCompare(String(b.id)));

  const fileTextCache = new Map<string, string | null>();
  const fileLinesCache = new Map<string, string[] | null>();
  const functionBlocksCache = new Map<string, FunctionBlock[]>();

  function toAbsWithinRepo(repoRoot: string, filePath: string): string | null {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
    const rel = path.relative(repoRoot, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return abs;
  }

  async function getFileText(filePath: string): Promise<string | null> {
    if (fileTextCache.has(filePath)) return fileTextCache.get(filePath) ?? null;
    const abs = toAbsWithinRepo(args.repoRoot, filePath);
    if (!abs) {
      fileTextCache.set(filePath, null);
      return null;
    }
    try {
      const text = await fs.readFile(abs, 'utf8');
      fileTextCache.set(filePath, text);
      return text;
    } catch {
      fileTextCache.set(filePath, null);
      return null;
    }
  }

  async function getFileLines(filePath: string): Promise<string[] | null> {
    if (fileLinesCache.has(filePath)) return fileLinesCache.get(filePath) ?? null;
    const text = await getFileText(filePath);
    if (!text) {
      fileLinesCache.set(filePath, null);
      return null;
    }
    const lines = text.split(/\r?\n/u);
    fileLinesCache.set(filePath, lines);
    return lines;
  }

  async function getFunctionBlocks(filePath: string): Promise<FunctionBlock[]> {
    if (functionBlocksCache.has(filePath)) return functionBlocksCache.get(filePath) ?? [];
    const text = await getFileText(filePath);
    if (!text) {
      functionBlocksCache.set(filePath, []);
      return [];
    }
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const blocks = scanFunctionBlocks(text, sf);
    functionBlocksCache.set(filePath, blocks);
    return blocks;
  }

  // Assign UI nodes to pages (handles multiple @Entry structs in one file).
  for (const [filePath, pages] of pagesByFile) {
    const pagesSorted = pages
      .slice()
      .sort((a, b) => (Number(a.entry.line ?? 0) || 0) - (Number(b.entry.line ?? 0) || 0) || a.pageId.localeCompare(b.pageId));

    const uiNodes = uiNodesByFile.get(filePath) ?? [];
    const fileLines = await getFileLines(filePath);
    const fileEndLine = fileLines ? fileLines.length : Number.POSITIVE_INFINITY;
    const functionBlocks = await getFunctionBlocks(filePath);

    for (let i = 0; i < pagesSorted.length; i += 1) {
      const cur = pagesSorted[i]!;
      const start = Number(cur.entry.line ?? 1) || 1;
      const next = pagesSorted[i + 1];
      const end = next ? (Number(next.entry.line ?? 0) || 0) - 1 : fileEndLine;

      cur.pageRangeStartLine = start;
      cur.pageRangeEndLine = end;

      cur.uiNodes = uiNodes.filter((n) => {
        const ln = Number(n.line ?? 0) || 0;
        return ln >= start && ln <= end;
      });
      const idx = buildUiNodeIndex(cur.uiNodes);
      cur.uiNodeByLine = idx.byLine;
      cur.uiLinesSorted = idx.linesSorted;

      const buildBlock =
        functionBlocks
          .filter((b) => b.name === 'build' && b.startLine >= start && b.startLine <= end)
          .sort((a, b) => a.startLine - b.startLine)[0] ?? null;
      if (buildBlock) {
        cur.buildRangeStartLine = Math.max(1, buildBlock.startLine);
        cur.buildRangeEndLine = Math.max(cur.buildRangeStartLine, buildBlock.endLine);
      } else {
        cur.buildRangeStartLine = 0;
        cur.buildRangeEndLine = 0;
      }
    }
  }

  const sourcesByFileLine = groupSourcesByFileLine(args.sources);
  const featuresByPage = new Map<string, Map<string, BuiltFeature>>();
  const unassignedFlows: Dataflow[] = [];

  function escapeRegExp(text: string): string {
    return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }

  function uiCategoryPenalty(category: UiTreeNode['category']): number {
    if (category === 'Button') return 0;
    if (category === 'Input') return 2;
    if (category === 'Component') return 4;
    if (category === 'Display') return 6;
    return 8;
  }

  function pickBestUiFromEvidence(args: {
    page: BuiltPage;
    evidenceLines: number[];
    maxDistance: number;
  }): UiTreeNode | null {
    const evidenceLines = Array.from(new Set(args.evidenceLines.filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
    if (evidenceLines.length === 0) return null;
    if (args.page.uiLinesSorted.length === 0) return null;

    let best: { score: number; distance: number; penalty: number; node: UiTreeNode } | null = null;

    for (const evidenceLine of evidenceLines) {
      const uiLine = nearestLineAtOrBefore(args.page.uiLinesSorted, evidenceLine);
      if (uiLine === null) continue;
      const distance = evidenceLine - uiLine;
      if (distance < 0 || distance > args.maxDistance) continue;

      const nodesAtLine = args.page.uiNodeByLine.get(uiLine) ?? [];
      for (const node of nodesAtLine) {
        const penalty = uiCategoryPenalty(node.category);
        const score = distance + penalty;
        if (
          !best ||
          score < best.score ||
          (score === best.score && distance < best.distance) ||
          (score === best.score && distance === best.distance && penalty < best.penalty)
        ) {
          best = { score, distance, penalty, node };
        }
      }
    }

    return best?.node ?? null;
  }

  function pickContainingBlock(blocks: FunctionBlock[], line: number): FunctionBlock | null {
    const containing = blocks.filter((b) => b.startLine <= line && line <= b.endLine);
    if (containing.length === 0) return null;
    return (
      containing
        .slice()
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine) || a.startLine - b.startLine)[0] ?? null
    );
  }

  async function pickUiHitForFlow(args2: { flow: Dataflow; page: BuiltPage }): Promise<UiTreeNode | null> {
    const filePath = args2.page.entry.filePath;
    if (!filePath) return null;
    if (args2.page.uiLinesSorted.length === 0) return null;

    const buildStart = Number(args2.page.buildRangeStartLine ?? 0) || 0;
    const buildEnd = Number(args2.page.buildRangeEndLine ?? 0) || 0;
    const hasBuildRange = buildStart > 0 && buildEnd >= buildStart;

    const fileLines = hasBuildRange ? await getFileLines(filePath) : null;
    const blocks = hasBuildRange ? await getFunctionBlocks(filePath) : [];

    // Strategy S1: evidence lines inside build() from existing flow nodes.
    if (hasBuildRange) {
      const evidence: number[] = [];
      for (const n of args2.flow.nodes ?? []) {
        if (n.filePath !== filePath) continue;
        if (n.line < buildStart || n.line > buildEnd) continue;
        evidence.push(n.line);
      }
      const picked = pickBestUiFromEvidence({ page: args2.page, evidenceLines: evidence, maxDistance: maxUiDistanceLinesStrict });
      if (picked) return picked;
    }

    // Strategy S2: infer handler function name from flow nodes, then find references inside build().
    if (hasBuildRange && fileLines && blocks.length > 0) {
      const handlerNames = new Set<string>();
      for (const n of args2.flow.nodes ?? []) {
        if (n.filePath !== filePath) continue;
        if (n.line < args2.page.pageRangeStartLine || n.line > args2.page.pageRangeEndLine) continue;
        if (n.line >= buildStart && n.line <= buildEnd) continue;
        const blk = pickContainingBlock(blocks, n.line);
        const name = blk?.name?.trim() ?? '';
        if (!name || name === 'build' || name === 'constructor') continue;
        handlerNames.add(name);
      }

      if (handlerNames.size > 0) {
        const evidence: number[] = [];
        for (const name of handlerNames) {
          const reThis = new RegExp(String.raw`\bthis\s*\.\s*${escapeRegExp(name)}\b`, 'u');
          const reCall = new RegExp(String.raw`\b${escapeRegExp(name)}\s*\(`, 'u');

          for (let ln = buildStart; ln <= Math.min(buildEnd, fileLines.length); ln += 1) {
            const text = fileLines[ln - 1] ?? '';
            if (!text) continue;
            if (reThis.test(text) || reCall.test(text)) evidence.push(ln);
          }
        }
        const picked = pickBestUiFromEvidence({ page: args2.page, evidenceLines: evidence, maxDistance: maxUiDistanceLinesStrict });
        if (picked) return picked;
      }
    }

    // Strategy S3: permission strings in flow.summary -> locate in build() and map to nearest UI node.
    if (hasBuildRange && fileLines) {
      const permissions = Array.isArray(args2.flow.summary?.permissions) ? args2.flow.summary!.permissions.map(String) : [];
      const needles = permissions.filter((p) => p && p.trim().length > 0);
      if (needles.length > 0) {
        const evidence: number[] = [];
        for (let ln = buildStart; ln <= Math.min(buildEnd, fileLines.length); ln += 1) {
          const text = fileLines[ln - 1] ?? '';
          if (!text) continue;
          if (needles.some((p) => text.includes(p))) evidence.push(ln);
        }
        const picked = pickBestUiFromEvidence({ page: args2.page, evidenceLines: evidence, maxDistance: maxUiDistanceLinesStrict });
        if (picked) return picked;
      }
    }

    // Strategy S4: fallback - clamp the closest flow node line into build() range and use a larger distance.
    if (hasBuildRange && args2.page.uiLinesSorted.length > 0) {
      const candidateLines = (args2.flow.nodes ?? [])
        .filter((n) => n.filePath === filePath && Number.isFinite(n.line))
        .map((n) => n.line)
        .filter((ln) => ln > 0);

      if (candidateLines.length > 0) {
        let bestLine = candidateLines[0]!;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const ln of candidateLines) {
          const dist = ln < buildStart ? buildStart - ln : ln > buildEnd ? ln - buildEnd : 0;
          if (dist < bestDist) {
            bestDist = dist;
            bestLine = ln;
          }
        }
        const evidenceLine = Math.min(buildEnd, Math.max(buildStart, bestLine));
        const picked = pickBestUiFromEvidence({ page: args2.page, evidenceLines: [evidenceLine], maxDistance: maxUiDistanceLinesFallback });
        if (picked) return picked;
      }
    }

    return null;
  }

  for (const flow of args.dataflows.flows ?? []) {
    const source = pickSourceForFlow(flow, sourcesByFileLine);
    const srcFile = source?.['App源码文件路径'] ?? '';
    const srcLine = Number(source?.['行号'] ?? 0) || 0;
    const page = srcFile ? choosePageForSource(pagesByFile.get(srcFile) ?? [], srcLine) : null;

    if (!page) {
      unassignedFlows.push(flow);
      continue;
    }

    const uiHit = await pickUiHitForFlow({ flow, page });

    let featureId = '';
    let title = '';
    let kind: FeatureInfo['kind'] = 'source';
    let anchor: FeatureInfo['anchor'] = { filePath: page.entry.filePath || srcFile, line: srcLine || 1 };

    if (uiHit) {
      kind = 'ui';
      featureId = buildUiFeatureId(page.pageId, uiHit);
      title = uiHit.description?.trim() ? uiHit.description.trim() : `${uiHit.category}:${uiHit.name ?? ''}`.trim();
      anchor = { filePath: uiHit.filePath ?? page.entry.filePath, line: Number(uiHit.line ?? 1) || 1, uiNodeId: uiHit.id };
    } else if (source) {
      kind = 'source';
      featureId = buildSourceFeatureId(page.pageId, source);
      const desc = String(source['描述'] ?? '').trim();
      const fn = String(source['函数名称'] ?? '').trim();
      title = desc ? (fn ? `${desc}（${fn}）` : desc) : fn ? `入口：${fn}` : '入口/生命周期函数';
      anchor = {
        filePath: source['App源码文件路径'] ?? page.entry.filePath,
        line: Number(source['行号'] ?? 1) || 1,
        functionName: fn || undefined,
      };
    } else {
      featureId = buildUnknownFeatureId(page.pageId, flow);
      title = '未识别功能';
      const first = flow.nodes?.[0];
      anchor = { filePath: first?.filePath ?? page.entry.filePath, line: Number(first?.line ?? 1) || 1 };
    }

    const pageFeatures = featuresByPage.get(page.pageId) ?? new Map<string, BuiltFeature>();
    const existing = pageFeatures.get(featureId);
    if (existing) {
      existing.flows.push(flow);
    } else {
      pageFeatures.set(featureId, {
        feature: { featureId, title, kind, anchor },
        flows: [flow],
      });
    }
    featuresByPage.set(page.pageId, pageFeatures);
  }

  // Create _unassigned pseudo-page if needed.
  let unassignedPage: BuiltPage | null = null;
  if (unassignedFlows.length > 0) {
    const page: BuiltPage = {
      pageId: '_unassigned',
      rootId: '',
      entry: { filePath: '', structName: '_unassigned', line: 0, description: '未归类页面（未能匹配到任何 @Entry 页面）' },
      uiNodes: [],
      uiNodeByLine: new Map<number, UiTreeNode[]>(),
      uiLinesSorted: [],
      pageRangeStartLine: 0,
      pageRangeEndLine: 0,
      buildRangeStartLine: 0,
      buildRangeEndLine: 0,
    };
    unassignedPage = page;
    const pageFeatures = new Map<string, BuiltFeature>();
    for (const flow of unassignedFlows) {
      const source = pickSourceForFlow(flow, sourcesByFileLine);
      const featureId = source ? buildSourceFeatureId('_unassigned', source) : buildUnknownFeatureId('_unassigned', flow);
      const desc = source ? String(source['描述'] ?? '').trim() : '';
      const fn = source ? String(source['函数名称'] ?? '').trim() : '';
      const title = source ? (desc ? (fn ? `${desc}（${fn}）` : desc) : fn ? `入口：${fn}` : '入口/生命周期函数') : '未识别功能';
      const anchor = source
        ? ({
            filePath: source['App源码文件路径'] ?? '',
            line: Number(source['行号'] ?? 1) || 1,
            functionName: fn || undefined,
          } satisfies FeatureInfo['anchor'])
        : ({
            filePath: flow.nodes?.[0]?.filePath ?? '',
            line: Number(flow.nodes?.[0]?.line ?? 1) || 1,
          } satisfies FeatureInfo['anchor']);

      const existing = pageFeatures.get(featureId);
      if (existing) existing.flows.push(flow);
      else pageFeatures.set(featureId, { feature: { featureId, title, kind: 'source', anchor }, flows: [flow] });
    }
    featuresByPage.set(page.pageId, pageFeatures);
  }

  const allPages: BuiltPage[] = builtPages.slice();
  if (unassignedPage) allPages.push(unassignedPage);

  const pagesOut: GroupedPageFeatures['pages'] = [];
  let totalFeatures = 0;
  let totalFlows = 0;

  for (const page of allPages.sort((a, b) => a.pageId.localeCompare(b.pageId))) {
    const featureMap = featuresByPage.get(page.pageId) ?? new Map<string, BuiltFeature>();
    const featuresBuilt = Array.from(featureMap.values()).sort((a, b) => {
      const ak = `${a.feature.kind}:${a.feature.anchor.line}:${a.feature.title}`;
      const bk = `${b.feature.kind}:${b.feature.anchor.line}:${b.feature.title}`;
      return ak.localeCompare(bk, 'zh-Hans-CN');
    });

    const features: Array<{ feature: FeatureInfo; dataflows: DataflowsResult }> = [];
    for (const bf of featuresBuilt) {
      const counts = countDataflows(bf.flows);
      const feature: FeatureInfo = {
        ...bf.feature,
        counts,
      };
      features.push({
        feature,
        dataflows: {
          meta: {
            runId: args.runId,
            generatedAt,
            llm: args.dataflows.meta.llm,
            counts,
            page: { pageId: page.pageId, entry: page.entry },
            feature: { featureId: bf.feature.featureId, kind: bf.feature.kind, title: bf.feature.title },
          } as any,
          flows: bf.flows,
        },
      });
      totalFlows += counts.flows;
    }

    totalFeatures += features.length;

    const pageInfo: PageInfo = {
      pageId: page.pageId,
      entry: page.entry,
      counts: {
        features: features.length,
        flows: features.reduce((acc, f) => acc + f.feature.counts.flows, 0),
      },
    };

    const featuresIndex: PageFeaturesIndex = {
      meta: {
        runId: args.runId,
        generatedAt,
        pageId: page.pageId,
        counts: {
          features: features.length,
          flows: pageInfo.counts.flows,
        },
      },
      page: { pageId: page.pageId, entry: page.entry },
      features: features.map((f) => f.feature),
    };

    const uiTreeSlice = page.pageId === '_unassigned' || !page.rootId ? null : sliceUiTreeForPage({ page, uiTree: args.uiTree });

    pagesOut.push({
      page: pageInfo,
      uiTree: uiTreeSlice,
      featuresIndex,
      features,
    });
  }

  const pagesIndex: PagesIndex = {
    meta: {
      runId: args.runId,
      generatedAt,
      counts: {
        pages: pagesOut.length,
        features: totalFeatures,
        flows: totalFlows,
        unassignedFlows: unassignedFlows.length,
      },
    },
    pages: pagesOut.map((p) => p.page),
  };

  return { pagesIndex, pages: pagesOut };
}
