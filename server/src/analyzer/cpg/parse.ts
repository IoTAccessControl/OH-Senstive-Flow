import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonFile, toWorkspaceRelativePath } from '../../utils/accessWorkspace.js';

type RawCpgNode = {
  id?: unknown;
  labels?: unknown;
  properties?: unknown;
};

type RawCpgEdge = {
  type?: unknown;
  startNode?: unknown;
  endNode?: unknown;
};

type RawCpgJson = {
  nodes?: unknown;
  edges?: unknown;
};

type RawProperties = Record<string, unknown>;

export type ParsedCpgNode = {
  id: number;
  labels: string[];
  filePath: string;
  line: number;
  endLine: number;
  code: string;
  name: string;
  localName: string;
  fullName: string;
};

export type ParsedCpgEdgeType = 'AST' | 'INVOKES' | 'EOG' | 'DFG' | 'PDG';

export type ParsedCpgEdge = {
  type: ParsedCpgEdgeType;
  startNode: number;
  endNode: number;
};

export type ParsedCpg = {
  nodesById: Map<number, ParsedCpgNode>;
  nodesByFile: Map<string, ParsedCpgNode[]>;
  functionNodes: ParsedCpgNode[];
  functionNodesByFile: Map<string, ParsedCpgNode[]>;
  callNodesByFile: Map<string, ParsedCpgNode[]>;
  edgesByType: Map<ParsedCpgEdgeType, ParsedCpgEdge[]>;
  adjacency: Map<number, ParsedCpgEdge[]>;
};

type ParseCpgJsonOptions = {
  repoRoot: string;
  appFiles: string[];
  cpgJsonPath: string;
};

const ALLOWED_EDGE_TYPES: ParsedCpgEdgeType[] = ['AST', 'INVOKES', 'EOG', 'DFG', 'PDG'];

function asRecord(value: unknown): RawProperties {
  return value && typeof value === 'object' ? (value as RawProperties) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function isWithinRoot(rootAbs: string, targetAbs: string): boolean {
  const rel = path.relative(rootAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseArtifactToAbsolutePath(artifact: string): string {
  const trimmed = artifact.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('file:')) {
    try {
      return fileURLToPath(new URL(trimmed));
    } catch {
      return trimmed.replace(/^file:(?:\/\/)?/u, '/');
    }
  }
  return path.resolve(trimmed);
}

function normalizeLocalName(properties: RawProperties): string {
  const localName = asString(properties.localName).trim();
  if (localName) return localName;
  const name = asString(properties.name).trim();
  if (!name) return '';
  const parts = name.split('.');
  return parts[parts.length - 1] ?? name;
}

function normalizeCode(properties: RawProperties): string {
  const code = asString(properties.code).trim();
  if (!code) return '';
  const line = code.split(/\r?\n/u)[0] ?? '';
  return line.trim();
}

function hasAnyLabel(labels: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => labels.includes(candidate));
}

function isProblemNode(labels: string[]): boolean {
  return hasAnyLabel(labels, ['ProblemDeclaration', 'ProblemExpression']);
}

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function sortNodesByLine(nodesByFile: Map<string, ParsedCpgNode[]>): void {
  for (const [filePath, nodes] of nodesByFile) {
    nodes.sort((a, b) => a.line - b.line || a.endLine - b.endLine || a.id - b.id);
    nodesByFile.set(filePath, nodes);
  }
}

export async function parseCpgJson(options: ParseCpgJsonOptions): Promise<ParsedCpg> {
  const raw = (await readJsonFile(options.cpgJsonPath)) as RawCpgJson;
  const rawNodes = Array.isArray(raw?.nodes) ? (raw.nodes as RawCpgNode[]) : [];
  const rawEdges = Array.isArray(raw?.edges) ? (raw.edges as RawCpgEdge[]) : [];

  const appFileSet = new Set(options.appFiles.map((fileAbs) => toWorkspaceRelativePath(options.repoRoot, fileAbs)));
  const nodesById = new Map<number, ParsedCpgNode>();
  const nodesByFile = new Map<string, ParsedCpgNode[]>();
  const functionNodes: ParsedCpgNode[] = [];
  const functionNodesByFile = new Map<string, ParsedCpgNode[]>();
  const callNodesByFile = new Map<string, ParsedCpgNode[]>();

  for (const rawNode of rawNodes) {
    const id = asNumber(rawNode.id);
    if (!Number.isFinite(id)) continue;

    const labels = Array.isArray(rawNode.labels) ? rawNode.labels.filter((item): item is string => typeof item === 'string') : [];
    if (labels.length === 0 || isProblemNode(labels)) continue;

    const properties = asRecord(rawNode.properties);
    const artifactAbs = parseArtifactToAbsolutePath(asString(properties.artifact));
    if (!artifactAbs || !isWithinRoot(options.repoRoot, artifactAbs)) continue;

    const filePath = toWorkspaceRelativePath(options.repoRoot, artifactAbs);
    if (!appFileSet.has(filePath)) continue;

    const lineRaw = asNumber(properties.startLine);
    if (!Number.isFinite(lineRaw) || lineRaw < 1) continue;
    const line = Math.floor(lineRaw);
    const endLineRaw = asNumber(properties.endLine);
    const endLine = Number.isFinite(endLineRaw) && endLineRaw >= line ? Math.floor(endLineRaw) : line;

    const node: ParsedCpgNode = {
      id: Math.floor(id),
      labels,
      filePath,
      line,
      endLine,
      code: normalizeCode(properties),
      name: asString(properties.name).trim(),
      localName: normalizeLocalName(properties),
      fullName: asString(properties.fullName).trim(),
    };

    nodesById.set(node.id, node);
    pushToMapArray(nodesByFile, filePath, node);

    if (labels.includes('Function')) {
      functionNodes.push(node);
      pushToMapArray(functionNodesByFile, filePath, node);
    }
    if (labels.includes('Call')) pushToMapArray(callNodesByFile, filePath, node);
  }

  sortNodesByLine(nodesByFile);
  sortNodesByLine(functionNodesByFile);
  sortNodesByLine(callNodesByFile);

  const allowedEdgeTypeSet = new Set<string>(ALLOWED_EDGE_TYPES);
  const edgesByType = new Map<ParsedCpgEdgeType, ParsedCpgEdge[]>();
  const adjacency = new Map<number, ParsedCpgEdge[]>();

  for (const rawEdge of rawEdges) {
    if (!allowedEdgeTypeSet.has(asString(rawEdge.type))) continue;

    const type = rawEdge.type as ParsedCpgEdgeType;
    const startNode = asNumber(rawEdge.startNode);
    const endNode = asNumber(rawEdge.endNode);
    if (!Number.isFinite(startNode) || !Number.isFinite(endNode)) continue;
    if (!nodesById.has(startNode) || !nodesById.has(endNode)) continue;

    const edge: ParsedCpgEdge = { type, startNode: Math.floor(startNode), endNode: Math.floor(endNode) };
    pushToMapArray(edgesByType, type, edge);
    pushToMapArray(adjacency, edge.startNode, edge);
  }

  return {
    nodesById,
    nodesByFile,
    functionNodes,
    functionNodesByFile,
    callNodesByFile,
    edgesByType,
    adjacency,
  };
}
