import crypto from 'node:crypto';

import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { SourceRecord } from '../types.js';
import type { UiTreeResult } from '../uiTree/types.js';

import { sourceRecordToRef, type UiModuleInfo, type UiModulesIndex, type UiModuleSourceRef } from './types.js';

type BuiltModule = {
  moduleId: string;
  rootId: string;
  nodeIds: Set<string>;
  fileSet: Set<string>;
  entryFilePath: string;
  entryStructName?: string;
  entryLine?: number;
  sources: UiModuleSourceRef[];
};

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function sanitizeModuleId(text: string): string {
  const raw = text.replaceAll(/[^\w-]+/gu, '_').replaceAll(/^_+|_+$/gu, '');
  return raw.length > 80 ? raw.slice(0, 80) : raw;
}

function buildAdj(edges: UiTreeResult['edges']): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  return adj;
}

function collectReachableNodes(args: { rootId: string; adj: Map<string, string[]>; maxDepth: number }): Set<string> {
  const visited = new Set<string>([args.rootId]);
  const q: Array<{ id: string; depth: number }> = [{ id: args.rootId, depth: 0 }];

  while (q.length > 0) {
    const cur = q.shift()!;
    if (cur.depth >= args.maxDepth) continue;
    const next = args.adj.get(cur.id) ?? [];
    for (const to of next) {
      if (visited.has(to)) continue;
      visited.add(to);
      q.push({ id: to, depth: cur.depth + 1 });
    }
  }

  return visited;
}

function buildModuleId(args: { baseName: string; filePath: string; used: Set<string> }): string {
  const base = sanitizeModuleId(args.baseName) || 'module';
  if (!args.used.has(base)) {
    args.used.add(base);
    return base;
  }
  const suffix = sha1(args.filePath).slice(0, 8);
  const full = `${base}_${suffix}`;
  args.used.add(full);
  return full;
}

export function buildModulesFromUiTree(args: {
  uiTree: UiTreeResult;
  sources: SourceRecord[];
  maxDepth?: number;
}): BuiltModule[] {
  const maxDepth = args.maxDepth ?? 6;
  const adj = buildAdj(args.uiTree.edges);
  const usedIds = new Set<string>();

  const sourcesByFile = new Map<string, SourceRecord[]>();
  for (const s of args.sources) {
    const list = sourcesByFile.get(s['App源码文件路径']) ?? [];
    list.push(s);
    sourcesByFile.set(s['App源码文件路径'], list);
  }

  const modules: BuiltModule[] = [];
  for (const rootId of args.uiTree.roots) {
    const rootNode = args.uiTree.nodes[rootId];
    if (!rootNode) continue;

    const nodeIds = collectReachableNodes({ rootId, adj, maxDepth });
    const fileSet = new Set<string>();
    for (const id of nodeIds) {
      const n = args.uiTree.nodes[id];
      if (n?.filePath) fileSet.add(n.filePath);
    }

    const entryFilePath = rootNode.filePath ?? '';
    const entryStructName = rootNode.name;
    const entryLine = rootNode.line;
    const moduleId = buildModuleId({
      baseName: entryStructName || pathBaseName(entryFilePath) || 'module',
      filePath: entryFilePath || rootId,
      used: usedIds,
    });

    const moduleSources: UiModuleSourceRef[] = [];
    for (const [filePath, list] of sourcesByFile) {
      if (!fileSet.has(filePath)) continue;
      for (const s of list) moduleSources.push(sourceRecordToRef(s));
    }

    modules.push({
      moduleId,
      rootId,
      nodeIds,
      fileSet,
      entryFilePath,
      entryStructName,
      entryLine,
      sources: moduleSources,
    });
  }

  return modules;
}

function pathBaseName(filePath: string): string {
  const parts = filePath.split('/');
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/\.[^.]+$/u, '');
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

export function groupDataflowsByModule(args: {
  runId: string;
  dataflows: DataflowsResult;
  sources: SourceRecord[];
  modules: BuiltModule[];
}): {
  index: UiModulesIndex;
  moduleDataflows: Map<string, DataflowsResult>;
  unassignedDataflows: DataflowsResult | null;
} {
  const sourcesByFileLine = groupSourcesByFileLine(args.sources);
  const moduleByEntryFile = new Map<string, BuiltModule[]>();
  const moduleByFile = new Map<string, BuiltModule[]>();

  for (const m of args.modules) {
    if (m.entryFilePath) {
      const list = moduleByEntryFile.get(m.entryFilePath) ?? [];
      list.push(m);
      moduleByEntryFile.set(m.entryFilePath, list);
    }
    for (const file of m.fileSet) {
      const list = moduleByFile.get(file) ?? [];
      list.push(m);
      moduleByFile.set(file, list);
    }
  }

  const moduleFlows = new Map<string, Dataflow[]>();
  const unassigned: Dataflow[] = [];

  for (const flow of args.dataflows.flows) {
    const source = pickSourceForFlow(flow, sourcesByFileLine);
    if (!source) {
      unassigned.push(flow);
      continue;
    }

    const srcFile = source['App源码文件路径'];
    const byEntry = moduleByEntryFile.get(srcFile);
    const candidates = (byEntry && byEntry.length > 0 ? byEntry : moduleByFile.get(srcFile)) ?? [];
    if (candidates.length === 0) {
      unassigned.push(flow);
      continue;
    }

    const chosen = candidates.sort((a, b) => a.moduleId.localeCompare(b.moduleId))[0]!;
    const list = moduleFlows.get(chosen.moduleId) ?? [];
    list.push(flow);
    moduleFlows.set(chosen.moduleId, list);
  }

  const moduleDataflows = new Map<string, DataflowsResult>();
  for (const m of args.modules) {
    const flows = moduleFlows.get(m.moduleId) ?? [];
    const counts = countDataflows(flows);
    moduleDataflows.set(m.moduleId, {
      meta: {
        runId: args.runId,
        generatedAt: new Date().toISOString(),
        llm: args.dataflows.meta.llm,
        counts,
        module: { moduleId: m.moduleId },
        sourceGrouping: 'source-api',
      } as any,
      flows,
    });
  }

  const unassignedDataflows =
    unassigned.length > 0
      ? ({
          meta: {
            runId: args.runId,
            generatedAt: new Date().toISOString(),
            llm: args.dataflows.meta.llm,
            counts: countDataflows(unassigned),
            module: { moduleId: '_unassigned' },
            sourceGrouping: 'source-api',
          } as any,
          flows: unassigned,
        } satisfies DataflowsResult)
      : null;

  const index: UiModulesIndex = {
    meta: {
      runId: args.runId,
      generatedAt: new Date().toISOString(),
      counts: {
        modules: args.modules.length,
        assignedFlows: args.dataflows.flows.length - unassigned.length,
        unassignedFlows: unassigned.length,
      },
    },
    modules: args.modules.map((m) => ({
      moduleId: m.moduleId,
      entry: { filePath: m.entryFilePath, structName: m.entryStructName, line: m.entryLine },
      uiTreeRootId: m.rootId,
      files: Array.from(m.fileSet).sort(),
      sources: m.sources.sort((a, b) => `${a.filePath}:${a.line}:${a.functionName}`.localeCompare(`${b.filePath}:${b.line}:${b.functionName}`)),
    })),
  };

  return { index, moduleDataflows, unassignedDataflows };
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

