import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchCallGraph } from '../api';
import { GraphView, type GraphEdge, type GraphNode } from '../components/GraphView';
import { useRepoRoot } from '../hooks/useRepoRoot';
import { resolveToAbsoluteFilePath } from '../utils/editor';

type CallGraphNode = {
  id: string;
  type: 'source' | 'function' | 'sinkCall';
  filePath: string;
  line: number;
  code: string;
  name?: string;
  description?: string;
};

type CallGraphEdge = {
  from: string;
  to: string;
  kind: string;
};

type CallGraph = {
  meta?: unknown;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
};

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: CallGraph };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

function isCallGraphNode(v: unknown): v is CallGraphNode {
  if (!isRecord(v)) return false;
  const type = v.type;
  return (
    typeof v.id === 'string' &&
    (type === 'source' || type === 'function' || type === 'sinkCall') &&
    typeof v.filePath === 'string' &&
    typeof v.line === 'number' &&
    typeof v.code === 'string' &&
    (v.description === undefined || typeof v.description === 'string')
  );
}

function isCallGraphEdge(v: unknown): v is CallGraphEdge {
  if (!isRecord(v)) return false;
  return typeof v.from === 'string' && typeof v.to === 'string' && typeof v.kind === 'string';
}

function asCallGraph(raw: unknown): CallGraph {
  if (!isRecord(raw)) return { nodes: [], edges: [] };
  const nodesRaw = raw.nodes;
  const edgesRaw = raw.edges;
  const nodes = Array.isArray(nodesRaw) ? nodesRaw.filter(isCallGraphNode) : [];
  const edges = Array.isArray(edgesRaw) ? edgesRaw.filter(isCallGraphEdge) : [];
  return { meta: raw.meta, nodes, edges };
}

export function CallGraphPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') || undefined;

  const repoRootState = useRepoRoot();
  const repoRoot = repoRootState.state === 'ready' ? repoRootState.repoRoot : undefined;
  const wslDistroName = repoRootState.state === 'ready' ? repoRootState.wslDistroName : undefined;

  const [state, setState] = useState<LoadState>({ state: 'loading' });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ state: 'loading' });
        const raw = await fetchCallGraph({ runId });
        const data = asCallGraph(raw);
        if (!cancelled) setState({ state: 'ready', data });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const view = useMemo(() => {
    if (state.state !== 'ready') return null;
    const data = state.data;

    const gNodes: GraphNode[] = data.nodes.map((n) => {
      const kind = n.type === 'sinkCall' ? 'sink' : n.type === 'source' ? 'source' : 'fn';
      const title = n.name ? `${kind}: ${n.name}` : kind;
      const absoluteFilePath = resolveToAbsoluteFilePath(repoRoot, n.filePath);
      return {
        id: n.id,
        title,
        subtitle: `${n.filePath}:${n.line}`,
        detail: n.description ?? n.code,
        openInEditor: absoluteFilePath ? { filePath: absoluteFilePath, line: n.line, wslDistroName } : undefined,
      };
    });

    const gEdges: GraphEdge[] = data.edges.map((e) => ({ from: e.from, to: e.to }));
    const preferredStartIds = data.nodes.filter((n) => n.type === 'source').map((n) => n.id);

    return { gNodes, gEdges, preferredStartIds };
  }, [state, repoRoot, wslDistroName]);

  return (
    <div className="page">
      <h1 className="title">调用图可视化</h1>
      <div className="subtitle">runId：{runId ?? '（未指定，读取 latest）'}</div>
      <div className="actions">
        <button
          className="button"
          type="button"
          onClick={() => navigate(runId ? `/?runId=${encodeURIComponent(runId)}` : '/')}
        >
          返回首页
        </button>
      </div>

      {state.state === 'loading' && <div className="status">加载中…</div>}
      {state.state === 'error' && <div className="status error">加载失败：{state.message}</div>}

      {state.state === 'ready' && view && (
        <GraphView
          nodes={view.gNodes}
          edges={view.gEdges}
          preferredStartIds={view.preferredStartIds}
          selectedId={selectedId}
          onSelect={setSelectedId}
          showNodePopover
        />
      )}
    </div>
  );
}
