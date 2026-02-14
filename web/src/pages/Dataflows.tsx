import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  fetchDataflows,
  fetchPageFeatureDataflows,
  fetchPageFeatures,
  fetchPages,
} from '../api';
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

type PageInfo = {
  pageId: string;
  entry?: { filePath?: string; structName?: string; line?: number; description?: string };
};

type PagesIndex = {
  meta?: { counts?: { unassignedFlows?: number } };
  pages: PageInfo[];
};

type FeatureInfo = {
  featureId: string;
  title: string;
  kind: 'ui' | 'source';
};

type PageFeaturesIndex = {
  meta?: { counts?: { flows?: number } };
  page?: { pageId?: string; entry?: { filePath?: string; structName?: string; line?: number } };
  features: FeatureInfo[];
};

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: DataflowsResult };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

function isPageInfo(v: unknown): v is PageInfo {
  if (!isRecord(v)) return false;
  if (typeof v.pageId !== 'string') return false;
  return true;
}

function asPagesIndex(raw: unknown): PagesIndex {
  if (!isRecord(raw)) return { pages: [] };
  const pagesRaw = raw.pages;
  const pages = Array.isArray(pagesRaw) ? pagesRaw.filter(isPageInfo) : [];
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  return { meta: meta as PagesIndex['meta'], pages };
}

function isFeatureInfo(v: unknown): v is FeatureInfo {
  if (!isRecord(v)) return false;
  if (typeof v.featureId !== 'string') return false;
  if (typeof v.title !== 'string') return false;
  if (v.kind !== 'ui' && v.kind !== 'source') return false;
  return true;
}

function asPageFeaturesIndex(raw: unknown): PageFeaturesIndex {
  if (!isRecord(raw)) return { features: [] };
  const featuresRaw = raw.features;
  const features = Array.isArray(featuresRaw) ? featuresRaw.filter(isFeatureInfo) : [];
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  const page = isRecord(raw.page) ? (raw.page as PageFeaturesIndex['page']) : undefined;
  return { meta: meta as PageFeaturesIndex['meta'], page, features };
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
  const pageIdFromUrl = searchParams.get('pageId') || undefined;
  const featureIdFromUrl = searchParams.get('featureId') || undefined;
  const flowIdFromUrl = searchParams.get('flowId') || undefined;
  const nodeIdFromUrl = searchParams.get('nodeId') || undefined;
  const featureIdHint = featureIdFromUrl;

  const repoRootState = useRepoRoot();
  const repoRoot = repoRootState.state === 'ready' ? repoRootState.repoRoot : undefined;
  const wslDistroName = repoRootState.state === 'ready' ? repoRootState.wslDistroName : undefined;

  const [mode, setMode] = useState<'pageFeature' | 'flat'>('flat');
  const [indexHint, setIndexHint] = useState<string | undefined>(undefined);

  const [pagesIndex, setPagesIndex] = useState<PagesIndex | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>(undefined);
  const [pageFeaturesIndex, setPageFeaturesIndex] = useState<PageFeaturesIndex | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | undefined>(undefined);

  const [state, setState] = useState<LoadState>({ state: 'loading' });
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMode('flat');
      setIndexHint(undefined);
      setPagesIndex(null);
      setSelectedPageId(undefined);
      setPageFeaturesIndex(null);
      setSelectedFeatureId(undefined);
      setSelectedFlowId(undefined);
      setSelectedNodeId(undefined);

      try {
        const raw = await fetchPages({ runId });
        const idx = asPagesIndex(raw);
        if (cancelled) return;
        setMode('pageFeature');
        setPagesIndex(idx);
        return;
      } catch {
        // fall through to flat view
      }

      if (!cancelled) {
        setMode('flat');
        setIndexHint('提示：该 run 未生成 Page→Feature 分层索引，已回退到全量 DataFlow。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode !== 'pageFeature') return;
      const pages = pagesIndex?.pages ?? [];
      if (pages.length === 0) {
        if (!cancelled) setSelectedPageId(undefined);
        return;
      }

      const pageIds = new Set(pages.map((p) => p.pageId));
      if (pageIdFromUrl && pageIds.has(pageIdFromUrl)) {
        if (!cancelled) setSelectedPageId(pageIdFromUrl);
        return;
      }

      if (featureIdHint) {
        for (const p of pages) {
          if (cancelled) return;
          try {
            const raw = await fetchPageFeatures({ pageId: p.pageId, runId });
            const idx = asPageFeaturesIndex(raw);
            if (idx.features.some((f) => f.featureId === featureIdHint)) {
              if (!cancelled) setSelectedPageId(p.pageId);
              return;
            }
          } catch {
            // ignore and continue
          }
        }
      }

      if (!cancelled) setSelectedPageId((prev) => (prev && pageIds.has(prev) ? prev : pages[0]!.pageId));
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, pagesIndex, runId, pageIdFromUrl, featureIdHint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode !== 'pageFeature') return;
      if (!selectedPageId) {
        if (!cancelled) {
          setPageFeaturesIndex(null);
          setSelectedFeatureId(undefined);
        }
        return;
      }

      try {
        const raw = await fetchPageFeatures({ pageId: selectedPageId, runId });
        const idx = asPageFeaturesIndex(raw);
        if (cancelled) return;
        setPageFeaturesIndex(idx);

        const desired =
          featureIdHint && idx.features.some((f) => f.featureId === featureIdHint) ? featureIdHint : undefined;

        setSelectedFeatureId((prev) => {
          if (desired) return desired;
          if (prev && idx.features.some((f) => f.featureId === prev)) return prev;
          return idx.features[0]?.featureId;
        });

        if (desired) {
          setSelectedFlowId(undefined);
          setSelectedNodeId(undefined);
        }
      } catch {
        if (!cancelled) {
          setPageFeaturesIndex(null);
          setSelectedFeatureId(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, runId, selectedPageId, featureIdHint]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ state: 'loading' });

        let raw: unknown;
        if (mode === 'pageFeature') {
          if (!selectedPageId || !selectedFeatureId) {
            if (!cancelled) {
              setState({ state: 'ready', data: { flows: [] } });
              setSelectedFlowId(undefined);
              setSelectedNodeId(undefined);
            }
            return;
          }
          raw = await fetchPageFeatureDataflows({ pageId: selectedPageId, featureId: selectedFeatureId, runId });
        } else {
          raw = await fetchDataflows({ runId });
        }

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
              const prevNodeOk = prevNodeId && flow.nodes.some((n) => n.id === prevNodeId) ? prevNodeId : undefined;
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
  }, [runId, mode, selectedPageId, selectedFeatureId, flowIdFromUrl, nodeIdFromUrl]);

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
  const currentGroupLabel = useMemo(() => {
    if (mode !== 'pageFeature') return '';
    if (!pagesIndex || !selectedPageId || !pageFeaturesIndex || !selectedFeatureId) return '';

    const page = pagesIndex.pages.find((p) => p.pageId === selectedPageId);
    const feature = pageFeaturesIndex.features.find((f) => f.featureId === selectedFeatureId);
    if (!page || !feature) return '';

    const pageTitle = page.pageId === '_unassigned' ? '未归类' : page.entry?.description?.trim() || page.entry?.structName || page.pageId;
    const pageCode = page.entry?.structName || page.pageId;
    const pageLabel = pageTitle && pageCode && pageTitle !== pageCode ? `${pageTitle}（${pageCode}）` : pageTitle || pageCode || '';
    const featureLabel = feature.title?.trim() || feature.featureId;
    if (!pageLabel || !featureLabel) return '';
    return `当前分类：${pageLabel} -> ${featureLabel}`;
  }, [mode, pagesIndex, selectedPageId, pageFeaturesIndex, selectedFeatureId]);

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
          {indexHint && <div className="status">{indexHint}</div>}

          {mode === 'pageFeature' && pagesIndex && pagesIndex.pages.length > 0 && (
            <label className="field">
              <div className="label">选择页面</div>
              <select
                className="input"
                value={selectedPageId ?? ''}
                onChange={(e) => {
                  setSelectedPageId(e.target.value);
                  setSelectedFeatureId(undefined);
                  setSelectedFlowId(undefined);
                  setSelectedNodeId(undefined);
                }}
              >
                {pagesIndex.pages.map((p) => {
                  const title = p.pageId === '_unassigned' ? '未归类' : p.entry?.description?.trim() || p.entry?.structName || p.pageId;
                  const codeName = p.entry?.structName || p.pageId;
                  const name = title && codeName && title !== codeName ? `${title}（${codeName}）` : title || codeName;
                  return (
                    <option key={p.pageId} value={p.pageId}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {mode === 'pageFeature' && pageFeaturesIndex && pageFeaturesIndex.features.length > 0 && (
            <label className="field">
              <div className="label">选择页面功能</div>
              <select
                className="input"
                value={selectedFeatureId ?? ''}
                onChange={(e) => {
                  setSelectedFeatureId(e.target.value);
                  setSelectedFlowId(undefined);
                  setSelectedNodeId(undefined);
                }}
              >
                {pageFeaturesIndex.features.map((f) => {
                  return (
                    <option key={f.featureId} value={f.featureId}>
                      {f.title}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {currentGroupLabel && <div className="status">{currentGroupLabel}</div>}

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
