import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchDataflows, fetchModuleDataflows, fetchModules } from '../api';
import { FilePathWithEditorLink } from '../components/EditorLink';
import { GraphView, type GraphEdge, type GraphNode } from '../components/GraphView';
import { useRepoRoot } from '../hooks/useRepoRoot';

type DataflowNode = {
  id: string;
  filePath: string;
  line: number;
  code: string;
  description: string;
  context?: { startLine: number; lines: string[] };
};

type DataflowEdge = { from: string; to: string };

type Dataflow = {
  flowId: string;
  pathId: string;
  nodes: DataflowNode[];
  edges: DataflowEdge[];
  summary?: Record<string, unknown>;
};

type DataflowsResult = {
  meta?: { skipped?: boolean; skipReason?: string; counts?: Record<string, unknown> };
  flows: Dataflow[];
};

type ModuleInfo = {
  moduleId: string;
  entry?: { filePath?: string; structName?: string };
};

type ModulesIndex = {
  meta?: { counts?: { unassignedFlows?: number } };
  modules: ModuleInfo[];
};

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: DataflowsResult };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

function isModuleInfo(v: unknown): v is ModuleInfo {
  if (!isRecord(v)) return false;
  if (typeof v.moduleId !== 'string') return false;
  return true;
}

function asModulesIndex(raw: unknown): ModulesIndex {
  if (!isRecord(raw)) return { modules: [] };
  const modulesRaw = raw.modules;
  const modules = Array.isArray(modulesRaw) ? modulesRaw.filter(isModuleInfo) : [];
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  return { meta: meta as ModulesIndex['meta'], modules };
}

function isDataflowNode(v: unknown): v is DataflowNode {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.filePath === 'string' &&
    typeof v.line === 'number' &&
    typeof v.code === 'string' &&
    typeof v.description === 'string'
  );
}

function isDataflowEdge(v: unknown): v is DataflowEdge {
  if (!isRecord(v)) return false;
  return typeof v.from === 'string' && typeof v.to === 'string';
}

function isDataflow(v: unknown): v is Dataflow {
  if (!isRecord(v)) return false;
  if (typeof v.flowId !== 'string' || typeof v.pathId !== 'string') return false;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return false;
  return v.nodes.every(isDataflowNode) && v.edges.every(isDataflowEdge);
}

function asDataflows(raw: unknown): DataflowsResult {
  if (!isRecord(raw)) return { flows: [] };
  const flowsRaw = raw.flows;
  const flows = Array.isArray(flowsRaw) ? flowsRaw.filter(isDataflow) : [];
  const meta = isRecord(raw.meta) ? (raw.meta as DataflowsResult['meta']) : undefined;
  return { meta, flows };
}

function fileName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}

function formatContext(node: DataflowNode): string {
  const ctx = node.context;
  if (!ctx || !Array.isArray(ctx.lines) || typeof ctx.startLine !== 'number') return node.code ?? '';
  const out: string[] = [];
  for (let i = 0; i < ctx.lines.length; i += 1) {
    const ln = ctx.startLine + i;
    const prefix = ln === node.line ? '>' : ' ';
    out.push(`${prefix} ${String(ln).padStart(5, ' ')}: ${ctx.lines[i] ?? ''}`);
  }
  return out.join('\n');
}

export function DataflowsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') || undefined;
  const moduleIdFromUrl = searchParams.get('moduleId') || undefined;
  const flowIdFromUrl = searchParams.get('flowId') || undefined;
  const nodeIdFromUrl = searchParams.get('nodeId') || undefined;

  const repoRootState = useRepoRoot();
  const repoRoot = repoRootState.state === 'ready' ? repoRootState.repoRoot : undefined;
  const wslDistroName = repoRootState.state === 'ready' ? repoRootState.wslDistroName : undefined;

  const [modulesIndex, setModulesIndex] = useState<ModulesIndex | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>(undefined);
  const [state, setState] = useState<LoadState>({ state: 'loading' });
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await fetchModules({ runId });
        const idx = asModulesIndex(raw);
        if (cancelled) return;
        setModulesIndex(idx);
        const unassignedFlows = idx.meta?.counts?.unassignedFlows ?? 0;
        const desired =
          moduleIdFromUrl === '_unassigned'
            ? unassignedFlows > 0
              ? '_unassigned'
              : undefined
            : moduleIdFromUrl && idx.modules.some((m) => m.moduleId === moduleIdFromUrl)
              ? moduleIdFromUrl
              : undefined;
        if (idx.modules.length > 0) setSelectedModuleId((prev) => desired ?? prev ?? idx.modules[0]!.moduleId);
        if (desired) {
          setSelectedFlowId(undefined);
          setSelectedNodeId(undefined);
        }
      } catch {
        if (!cancelled) setModulesIndex(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, moduleIdFromUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ state: 'loading' });
        const raw =
          selectedModuleId
            ? await fetchModuleDataflows({ moduleId: selectedModuleId, runId })
            : await fetchDataflows({ runId });
        const data = asDataflows(raw);
        if (cancelled) return;
        setState({ state: 'ready', data });
        if (data.flows.length > 0) {
          const desiredFlow =
            flowIdFromUrl && data.flows.some((f) => f.flowId === flowIdFromUrl) ? flowIdFromUrl : undefined;
          setSelectedFlowId((prevFlowId) => {
            const nextFlowId = desiredFlow ?? prevFlowId ?? data.flows[0]!.flowId;
            const flow = data.flows.find((f) => f.flowId === nextFlowId) ?? data.flows[0]!;

            setSelectedNodeId((prevNodeId) => {
              const desiredNode =
                nodeIdFromUrl && flow.nodes.some((n) => n.id === nodeIdFromUrl) ? nodeIdFromUrl : undefined;
              const prevNodeOk =
                prevNodeId && flow.nodes.some((n) => n.id === prevNodeId) ? prevNodeId : undefined;
              return desiredNode ?? prevNodeOk ?? flow.nodes[0]?.id;
            });

            return nextFlowId;
          });
        } else {
          setSelectedFlowId(undefined);
          setSelectedNodeId(undefined);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, selectedModuleId, flowIdFromUrl, nodeIdFromUrl]);

  const current = useMemo(() => {
    if (state.state !== 'ready') return null;
    const flow = state.data.flows.find((f) => f.flowId === selectedFlowId) ?? state.data.flows[0];
    if (!flow) return { flow: null, selected: null, gNodes: [], gEdges: [] };

    const gNodes: GraphNode[] = flow.nodes.map((n) => ({
      id: n.id,
      title: `${fileName(n.filePath)}:${n.line}`,
      subtitle: n.code,
      detail: n.description,
    }));
    const gEdges: GraphEdge[] = flow.edges.map((e) => ({ from: e.from, to: e.to }));

    const selected = selectedNodeId ? flow.nodes.find((n) => n.id === selectedNodeId) ?? null : null;
    return { flow, selected, gNodes, gEdges };
  }, [state, selectedFlowId, selectedNodeId]);

  const skipReason = state.state === 'ready' && state.data.meta?.skipped ? state.data.meta.skipReason : undefined;
  const unassignedFlows = modulesIndex?.meta?.counts?.unassignedFlows ?? 0;

  return (
    <div className="page">
      <h1 className="title">数据流可视化</h1>
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

      {state.state === 'ready' && (
        <>
          {modulesIndex && modulesIndex.modules.length > 0 && (
            <label className="field">
              <div className="label">选择功能模块</div>
              <select
                className="input"
                value={selectedModuleId ?? ''}
                onChange={(e) => {
                  setSelectedModuleId(e.target.value);
                  setSelectedFlowId(undefined);
                  setSelectedNodeId(undefined);
                }}
              >
                {modulesIndex.modules.map((m) => {
                  const name = m.entry?.structName ? `${m.entry.structName}（${m.moduleId}）` : m.moduleId;
                  return (
                    <option key={m.moduleId} value={m.moduleId}>
                      {name}
                    </option>
                  );
                })}
                {unassignedFlows > 0 && (
                  <option key="_unassigned" value="_unassigned">
                    未归类（_unassigned）
                  </option>
                )}
              </select>
            </label>
          )}

          {skipReason && <div className="status">提示：{skipReason}</div>}

          {state.data.flows.length > 0 && (
            <label className="field">
              <div className="label">选择数据流路径</div>
              <select className="input" value={selectedFlowId ?? ''} onChange={(e) => setSelectedFlowId(e.target.value)}>
                {state.data.flows.map((f, idx) => (
                  <option key={f.flowId} value={f.flowId}>
                    {`路径 ${idx + 1}（${f.pathId}）`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {current?.flow && (
            <div className="split">
              <div className="left">
                <GraphView
                  nodes={current.gNodes}
                  edges={current.gEdges}
                  direction="vertical"
                  selectedId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                />
              </div>
              <div className="right">
                <div className="form">
                  <div className="subtitle" style={{ marginBottom: 10 }}>
                    当前节点
                  </div>
                  {!current.selected && <div className="status">（未选择节点）</div>}
                  {current.selected && (
                    <>
                      <div className="kv">
                        <div className="k">文件路径</div>
                        <div className="v">
                          <FilePathWithEditorLink
                            repoRoot={repoRoot}
                            wslDistroName={wslDistroName}
                            filePath={current.selected.filePath}
                            line={current.selected.line}
                          />
                        </div>
                      </div>
                      <div className="kv">
                        <div className="k">行号</div>
                        <div className="v">{current.selected.line}</div>
                      </div>
                      <div className="kv">
                        <div className="k">代码</div>
                        <div className="v mono">{current.selected.code}</div>
                      </div>
                      <div className="kv">
                        <div className="k">附近代码</div>
                        <div className="v">
                          <pre className="code">{formatContext(current.selected)}</pre>
                        </div>
                      </div>
                      <div className="kv">
                        <div className="k">描述</div>
                        <div className="v">{current.selected.description}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.data.flows.length === 0 && !skipReason && <div className="status">暂无数据流结果</div>}
        </>
      )}
    </div>
  );
}
