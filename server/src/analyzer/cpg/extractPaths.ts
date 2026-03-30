import type { CallGraph, CallGraphEdge, CallGraphNode, CallGraphPath } from '../callgraph/types.js';
import type { SinkRecord, SourceRecord } from '../extract/types.js';

import type { ParsedCpg, ParsedCpgEdge, ParsedCpgNode } from './parse.js';

type BuildCallGraphAndPathsFromParsedCpgOptions = {
  runId: string;
  cpg: ParsedCpg;
  sinks: SinkRecord[];
  sources: SourceRecord[];
  maxPaths: number | null;
};

type PathMatch = {
  source: SourceRecord;
  sinkRecords: SinkRecord[];
  sourceAnchor: ParsedCpgNode;
  sinkAnchor: ParsedCpgNode;
  cpgNodeIds: number[];
};

type SearchEdgeType = ParsedCpgEdge['type'] | 'LOCAL_INVOKES';

type SearchEdge = {
  type: SearchEdgeType;
  startNode: number;
  endNode: number;
};

const EDGE_PRIORITY: Record<SearchEdgeType, number> = {
  DFG: 0,
  PDG: 1,
  EOG: 2,
  INVOKES: 3,
  LOCAL_INVOKES: 3,
  AST: 4,
};

function buildSinkCallNodeId(filePath: string, line: number): string {
  return `sink:${filePath}:${line}`;
}

function buildSourceNodeId(filePath: string, line: number, name: string): string {
  return `source:${filePath}:${line}:${name}`;
}

function buildCpgNodeId(nodeId: number): string {
  return `cpg:${nodeId}`;
}

function nodeDisplayName(node: ParsedCpgNode): string {
  return node.localName || node.name || node.fullName || '';
}

function hasLabel(node: ParsedCpgNode, label: string): boolean {
  return node.labels.includes(label);
}

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function pushUniqueEdge(edgeSet: Set<string>, edges: CallGraphEdge[], edge: CallGraphEdge): void {
  const key = `${edge.from}|${edge.to}|${edge.kind}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push(edge);
}

function groupSinkRecordsByCallsite(sinks: SinkRecord[]): Map<string, SinkRecord[]> {
  const map = new Map<string, SinkRecord[]>();
  for (const sink of sinks) {
    const key = `${sink['App源码文件路径']}:${sink['调用行号']}`;
    const list = map.get(key) ?? [];
    list.push(sink);
    map.set(key, list);
  }
  return map;
}

function nodeKindRank(node: ParsedCpgNode): number {
  if (hasLabel(node, 'Function')) return 0;
  if (hasLabel(node, 'Block')) return 1;
  if (hasLabel(node, 'Call')) return 2;
  if (hasLabel(node, 'Reference')) return 3;
  if (hasLabel(node, 'Lambda')) return 4;
  if (hasLabel(node, 'TranslationUnit')) return 9;
  return 5;
}

function sortNodesByAnchorScore(nodes: ParsedCpgNode[], targetLine: number, preferredName?: string): ParsedCpgNode[] {
  return nodes.slice().sort((a, b) => {
    const aNamePenalty = preferredName && nodeDisplayName(a) === preferredName ? 0 : 100;
    const bNamePenalty = preferredName && nodeDisplayName(b) === preferredName ? 0 : 100;
    const aScore = aNamePenalty + Math.abs(a.line - targetLine) * 2 + nodeKindRank(a);
    const bScore = bNamePenalty + Math.abs(b.line - targetLine) * 2 + nodeKindRank(b);
    if (aScore !== bScore) return aScore - bScore;
    return a.id - b.id;
  });
}

function dedupeNodes(nodes: ParsedCpgNode[]): ParsedCpgNode[] {
  const seen = new Set<number>();
  const out: ParsedCpgNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function detectCallTargetKind(code: string, localName: string): { kind: 'this' | 'qualified' | 'bare'; qualifier?: string } | null {
  if (!code || !localName) return null;
  const escaped = escapeRegExp(localName);

  if (new RegExp(`\\bthis\\.${escaped}\\s*\\(`, 'u').test(code)) return { kind: 'this' };

  const qualifiedMatch = code.match(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\.${escaped}\\s*\\(`, 'u'));
  if (qualifiedMatch?.[1]) return { kind: 'qualified', qualifier: qualifiedMatch[1] };

  if (new RegExp(`(?:^|[^.\\w$])${escaped}\\s*\\(`, 'u').test(code)) return { kind: 'bare' };
  return null;
}

function extractThisReferencedFunctionNames(code: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern = /\bthis\.([A-Za-z_$][\w$]*)\b/gu;
  for (const match of code.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function findSourceAnchorCandidates(cpg: ParsedCpg, source: SourceRecord): ParsedCpgNode[] {
  const fileFunctions = cpg.functionNodesByFile.get(source['App源码文件路径']) ?? [];
  const namedFunctions = fileFunctions.filter((node) => nodeDisplayName(node) === source['函数名称']);

  const exactMatches = sortNodesByAnchorScore(
    namedFunctions.filter((node) => node.line === source['行号']),
    source['行号'],
    source['函数名称'],
  );
  const nearbyFunctions = sortNodesByAnchorScore(
    namedFunctions.filter((node) => Math.abs(node.line - source['行号']) <= 3),
    source['行号'],
    source['函数名称'],
  );

  const fileNodes = cpg.nodesByFile.get(source['App源码文件路径']) ?? [];
  const localNodes = sortNodesByAnchorScore(
    fileNodes.filter((node) => node.line >= source['行号'] - 2 && node.line <= source['行号'] + 40),
    source['行号'],
    source['函数名称'],
  );
  const nearestNodes = sortNodesByAnchorScore(fileNodes.slice(0, 200), source['行号'], source['函数名称']);

  return dedupeNodes([...exactMatches, ...nearbyFunctions, ...localNodes, ...nearestNodes]).slice(0, 6);
}

function findSinkAnchorCandidates(cpg: ParsedCpg, sinkRecords: SinkRecord[]): ParsedCpgNode[] {
  const first = sinkRecords[0];
  if (!first) return [];
  const fileCalls = cpg.callNodesByFile.get(first['App源码文件路径']) ?? [];
  const exactCalls = fileCalls.filter((node) => node.line === first['调用行号']);
  const nearbyCalls = fileCalls.filter((node) => Math.abs(node.line - first['调用行号']) <= 3);
  const fileFunctions = cpg.functionNodesByFile.get(first['App源码文件路径']) ?? [];
  const enclosingFunctions = fileFunctions.filter((node) => node.line <= first['调用行号'] && node.endLine >= first['调用行号']);
  const fileNodes = cpg.nodesByFile.get(first['App源码文件路径']) ?? [];
  const nearbyNodes = fileNodes.filter((node) => Math.abs(node.line - first['调用行号']) <= 3);
  return dedupeNodes([
    ...sortNodesByAnchorScore(exactCalls, first['调用行号']),
    ...sortNodesByAnchorScore(nearbyCalls, first['调用行号']),
    ...sortNodesByAnchorScore(enclosingFunctions, first['调用行号']),
    ...sortNodesByAnchorScore(nearbyNodes, first['调用行号']),
  ]).slice(0, 6);
}

function reconstructPath(parents: Map<number, number | null>, endNodeId: number): number[] {
  const path: number[] = [];
  let current: number | null | undefined = endNodeId;
  while (current !== null && current !== undefined) {
    path.push(current);
    current = parents.get(current);
  }
  path.reverse();
  return path;
}

function buildLocalInvocationAdjacency(cpg: ParsedCpg): Map<number, SearchEdge[]> {
  const adjacency = new Map<number, SearchEdge[]>();
  const functionsByLocalName = new Map<string, ParsedCpgNode[]>();

  for (const functionNode of cpg.functionNodes) {
    const localName = nodeDisplayName(functionNode);
    if (!localName) continue;
    pushToMapArray(functionsByLocalName, localName, functionNode);
  }

  for (const [filePath, callNodes] of cpg.callNodesByFile) {
    for (const callNode of callNodes) {
      const callName = nodeDisplayName(callNode);
      if (!callName) continue;

      const targetById = new Map<number, ParsedCpgNode>();
      const directTargetKind = detectCallTargetKind(callNode.code, callName);
      const sameNamedFunctions = functionsByLocalName.get(callName) ?? [];

      if (directTargetKind?.kind === 'this' || directTargetKind?.kind === 'bare') {
        for (const node of sameNamedFunctions) {
          if (node.id === callNode.id || node.filePath !== filePath) continue;
          targetById.set(node.id, node);
        }
      } else if (directTargetKind?.kind === 'qualified' && directTargetKind.qualifier) {
        const targetSignature = `${directTargetKind.qualifier}.${callName}`;
        for (const node of sameNamedFunctions) {
          if (node.id === callNode.id) continue;
          const qualifiedText = [node.name, node.fullName].filter(Boolean).join(' ');
          if (!qualifiedText.includes(targetSignature)) continue;
          targetById.set(node.id, node);
        }
      }

      for (const referencedName of extractThisReferencedFunctionNames(callNode.code)) {
        for (const node of functionsByLocalName.get(referencedName) ?? []) {
          if (node.id === callNode.id || node.filePath !== filePath) continue;
          targetById.set(node.id, node);
        }
      }

      const candidates = Array.from(targetById.values())
        .sort((a, b) => {
          const aSameFile = a.filePath === filePath ? 0 : 1;
          const bSameFile = b.filePath === filePath ? 0 : 1;
          if (aSameFile !== bSameFile) return aSameFile - bSameFile;
          return Math.abs(a.line - callNode.line) - Math.abs(b.line - callNode.line) || a.id - b.id;
        })
        .slice(0, 6);

      for (const target of candidates) {
        const edge: SearchEdge = {
          type: 'LOCAL_INVOKES',
          startNode: callNode.id,
          endNode: target.id,
        };
        pushToMapArray(adjacency, callNode.id, edge);
      }
    }
  }

  return adjacency;
}

function findCpgPath(
  cpg: ParsedCpg,
  localInvocationAdjacency: Map<number, SearchEdge[]>,
  startNodeId: number,
  targetNodeId: number,
  maxDepth = 120,
): number[] | null {
  const queue: Array<{ nodeId: number; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];
  const parents = new Map<number, number | null>([[startNodeId, null]]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.nodeId === targetNodeId) return reconstructPath(parents, targetNodeId);
    if (current.depth >= maxDepth) continue;

    const nextEdges = [...(cpg.adjacency.get(current.nodeId) ?? []), ...(localInvocationAdjacency.get(current.nodeId) ?? [])].sort(
      (a, b) => EDGE_PRIORITY[a.type] - EDGE_PRIORITY[b.type],
    );
    for (const edge of nextEdges) {
      if (parents.has(edge.endNode)) continue;
      parents.set(edge.endNode, current.nodeId);
      queue.push({ nodeId: edge.endNode, depth: current.depth + 1 });
    }
  }

  return null;
}

function chooseBestPath(candidates: PathMatch[]): PathMatch | null {
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.cpgNodeIds.length - b.cpgNodeIds.length)[0] ?? null;
}

function describeCpgNode(node: ParsedCpgNode): string | undefined {
  const pieces = [nodeDisplayName(node), node.labels.filter((label) => label !== 'Node' && label !== 'AstNode').slice(0, 2).join('/')].filter(Boolean);
  const text = pieces.join(' ');
  return text || undefined;
}

function buildCallGraphMeta(runId: string, nodes: CallGraphNode[], edges: CallGraphEdge[]): CallGraph['meta'] {
  return {
    runId,
    generatedAt: new Date().toISOString(),
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      sources: nodes.filter((node) => node.type === 'source').length,
      sinkCalls: nodes.filter((node) => node.type === 'sinkCall').length,
      functions: nodes.filter((node) => node.type === 'function').length,
    },
  };
}

function ensureSourceNode(nodeById: Map<string, CallGraphNode>, source: SourceRecord, anchor: ParsedCpgNode): CallGraphNode {
  const id = buildSourceNodeId(source['App源码文件路径'], source['行号'], source['函数名称']);
  const existing = nodeById.get(id);
  if (existing) return existing;

  const node: CallGraphNode = {
    id,
    type: 'source',
    filePath: source['App源码文件路径'],
    line: source['行号'],
    code: anchor.code || source['函数名称'],
    name: source['函数名称'],
    description: source['描述'],
  };
  nodeById.set(id, node);
  return node;
}

function ensureSinkNode(nodeById: Map<string, CallGraphNode>, sinkRecords: SinkRecord[], anchor: ParsedCpgNode): CallGraphNode {
  const first = sinkRecords[0]!;
  const id = buildSinkCallNodeId(first['App源码文件路径'], first['调用行号']);
  const existing = nodeById.get(id);
  if (existing) return existing;

  const apiNames = Array.from(
    new Set(sinkRecords.map((record) => record.__apiKey).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );
  const descriptions = Array.from(
    new Set(sinkRecords.map((record) => record['API功能描述']).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );

  const node: CallGraphNode = {
    id,
    type: 'sinkCall',
    filePath: first['App源码文件路径'],
    line: first['调用行号'],
    code: first['调用代码'] || anchor.code,
    name: apiNames.length > 0 ? apiNames.join(',') : undefined,
    description: descriptions.length > 0 ? descriptions.join('；') : undefined,
  };
  nodeById.set(id, node);
  return node;
}

function ensureIntermediateNode(nodeById: Map<string, CallGraphNode>, cpgNode: ParsedCpgNode): CallGraphNode {
  const id = buildCpgNodeId(cpgNode.id);
  const existing = nodeById.get(id);
  if (existing) return existing;

  const node: CallGraphNode = {
    id,
    type: 'function',
    filePath: cpgNode.filePath,
    line: cpgNode.line,
    code: cpgNode.code,
    name: nodeDisplayName(cpgNode) || undefined,
    description: describeCpgNode(cpgNode),
  };
  nodeById.set(id, node);
  return node;
}

function buildPathMatches(cpg: ParsedCpg, sources: SourceRecord[], groupedSinks: Array<SinkRecord[]>, maxPaths: number): PathMatch[] {
  const matches: PathMatch[] = [];
  const localInvocationAdjacency = buildLocalInvocationAdjacency(cpg);

  for (const source of sources) {
    if (matches.length >= maxPaths) break;
    const sourceAnchors = findSourceAnchorCandidates(cpg, source);
    if (sourceAnchors.length === 0) continue;

    for (const sinkRecords of groupedSinks) {
      if (matches.length >= maxPaths) break;
      const sinkAnchors = findSinkAnchorCandidates(cpg, sinkRecords);
      if (sinkAnchors.length === 0) continue;

      const pathCandidates: PathMatch[] = [];
      for (const sourceAnchor of sourceAnchors) {
        for (const sinkAnchor of sinkAnchors) {
          const cpgNodeIds = findCpgPath(cpg, localInvocationAdjacency, sourceAnchor.id, sinkAnchor.id);
          if (!cpgNodeIds || cpgNodeIds.length === 0) continue;
          pathCandidates.push({ source, sinkRecords, sourceAnchor, sinkAnchor, cpgNodeIds });
        }
      }

      const best = chooseBestPath(pathCandidates);
      if (best) matches.push(best);
    }
  }

  return matches;
}

export function buildCallGraphAndPathsFromParsedCpg(
  options: BuildCallGraphAndPathsFromParsedCpgOptions,
): { callGraph: CallGraph; paths: CallGraphPath[] } {
  const maxPaths = Number.isFinite(options.maxPaths) ? Math.max(1, Math.floor(options.maxPaths as number)) : Number.POSITIVE_INFINITY;
  const groupedSinks = Array.from(groupSinkRecordsByCallsite(options.sinks).values());
  const matches = buildPathMatches(options.cpg, options.sources, groupedSinks, maxPaths);

  const nodeById = new Map<string, CallGraphNode>();
  const edgeSet = new Set<string>();
  const edges: CallGraphEdge[] = [];
  const paths: CallGraphPath[] = [];
  const pathSet = new Set<string>();
  let pathSeq = 0;

  for (const match of matches) {
    const sourceNode = ensureSourceNode(nodeById, match.source, match.sourceAnchor);
    const sinkNode = ensureSinkNode(nodeById, match.sinkRecords, match.sinkAnchor);

    const projectedNodeIds: string[] = [sourceNode.id];
    for (const cpgNodeId of match.cpgNodeIds.slice(1, -1)) {
      const cpgNode = options.cpg.nodesById.get(cpgNodeId);
      if (!cpgNode) continue;
      projectedNodeIds.push(ensureIntermediateNode(nodeById, cpgNode).id);
    }
    projectedNodeIds.push(sinkNode.id);

    const pathKey = projectedNodeIds.join('>');
    if (pathSet.has(pathKey)) continue;
    pathSet.add(pathKey);

    for (let i = 0; i < projectedNodeIds.length - 1; i += 1) {
      const from = projectedNodeIds[i]!;
      const to = projectedNodeIds[i + 1]!;
      pushUniqueEdge(edgeSet, edges, { from, to, kind: to === sinkNode.id ? 'containsSink' : 'calls' });
    }

    pathSeq += 1;
    paths.push({
      pathId: `p${pathSeq}`,
      nodeIds: projectedNodeIds,
      sourceId: sourceNode.id,
      sinkCallId: sinkNode.id,
    });
  }

  const nodes = Array.from(nodeById.values());
  const callGraph: CallGraph = {
    meta: buildCallGraphMeta(options.runId, nodes, edges),
    nodes,
    edges,
  };

  return { callGraph, paths };
}
