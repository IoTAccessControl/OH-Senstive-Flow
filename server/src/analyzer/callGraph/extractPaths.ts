import type { CallGraph, CallGraphPath } from './types.js';

type ExtractPathsOptions = {
  callGraph: CallGraph;
  maxPaths: number;
  maxDepth?: number;
};

function buildAdj(edges: CallGraph['edges']): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  return adj;
}

function buildReverseAdj(edges: CallGraph['edges']): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.to) ?? [];
    list.push(e.from);
    adj.set(e.to, list);
  }
  return adj;
}

function computeDistanceToAnySink(callGraph: CallGraph, sinkIds: string[]): Map<string, number> {
  const radj = buildReverseAdj(callGraph.edges);
  const dist = new Map<string, number>();
  const queue: string[] = [];

  for (const s of sinkIds) {
    dist.set(s, 0);
    queue.push(s);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const d = dist.get(cur);
    if (d === undefined) continue;
    const prev = radj.get(cur);
    if (!prev) continue;
    for (const p of prev) {
      if (dist.has(p)) continue;
      dist.set(p, d + 1);
      queue.push(p);
    }
  }

  return dist;
}

export function extractPaths(options: ExtractPathsOptions): CallGraphPath[] {
  const maxDepth = options.maxDepth ?? 60;
  const maxPaths = Math.max(1, Math.floor(options.maxPaths));

  const sources = options.callGraph.nodes.filter((n) => n.type === 'source').map((n) => n.id);
  const sinks = options.callGraph.nodes.filter((n) => n.type === 'sinkCall').map((n) => n.id);
  const sinkSet = new Set(sinks);

  const distToSink = computeDistanceToAnySink(options.callGraph, sinks);
  const adj = buildAdj(options.callGraph.edges);

  const paths: CallGraphPath[] = [];
  let pathSeq = 0;

  function dfs(cur: string, visited: Set<string>, stack: string[], sourceId: string): void {
    if (paths.length >= maxPaths) return;
    if (stack.length > maxDepth) return;

    if (sinkSet.has(cur)) {
      pathSeq += 1;
      paths.push({
        pathId: `p${pathSeq}`,
        nodeIds: [...stack],
        sourceId,
        sinkCallId: cur,
      });
      return;
    }

    const next = (adj.get(cur) ?? [])
      .filter((n) => distToSink.has(n))
      .sort((a, b) => (distToSink.get(a)! - distToSink.get(b)!));

    for (const n of next) {
      if (paths.length >= maxPaths) return;
      if (visited.has(n)) continue;
      visited.add(n);
      stack.push(n);
      dfs(n, visited, stack, sourceId);
      stack.pop();
      visited.delete(n);
    }
  }

  for (const s of sources) {
    if (paths.length >= maxPaths) break;
    if (!distToSink.has(s)) continue;
    const visited = new Set<string>([s]);
    dfs(s, visited, [s], s);
  }

  return paths;
}
