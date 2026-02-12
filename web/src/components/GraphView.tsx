import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { FilePathWithEditorLink } from './EditorLink';

export type GraphNode = {
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
  openInEditor?: { filePath: string; line?: number; column?: number; wslDistroName?: string; label?: string };
};

export type GraphEdge = {
  from: string;
  to: string;
};

type PositionedNode = GraphNode & { x: number; y: number };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const BUTTON_ZOOM_STEP = 0.1;
const DEFAULT_FONT_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const ELLIPSIS = '…';

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function normalizeText(s: string): string {
  if (!s) return '';
  return s.replace(/\s+/gu, ' ').trim();
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

function truncateToWidth(args: { text: string; maxWidth: number; fontSize: number; fontWeight?: number }): string {
  const t = normalizeText(args.text);
  if (!t) return '';

  const ctx = getMeasureCtx();
  if (!ctx) {
    // Fallback heuristic when canvas is unavailable.
    const approxChars = Math.max(1, Math.floor(args.maxWidth / (args.fontSize * 0.6)));
    if (t.length <= approxChars) return t;
    return `${t.slice(0, Math.max(0, approxChars - 1))}${ELLIPSIS}`;
  }

  const fontWeight = args.fontWeight ?? 400;
  ctx.font = `${fontWeight} ${args.fontSize}px ${DEFAULT_FONT_FAMILY}`;

  if (ctx.measureText(t).width <= args.maxWidth) return t;

  // Binary search the longest prefix that fits with ellipsis.
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = `${t.slice(0, mid)}${ELLIPSIS}`;
    if (ctx.measureText(candidate).width <= args.maxWidth) lo = mid;
    else hi = mid - 1;
  }

  if (lo <= 0) return ELLIPSIS;
  return `${t.slice(0, lo)}${ELLIPSIS}`;
}

function sanitizeDomId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/gu, '_');
}

function buildAdj(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  return adj;
}

function buildIndegree(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  return indeg;
}

function computeLevels(nodes: GraphNode[], edges: GraphEdge[], preferredStartIds?: string[]): Map<string, number> {
  const adj = buildAdj(edges);
  const indeg = buildIndegree(nodes, edges);
  const level = new Map<string, number>();

  const starts =
    preferredStartIds && preferredStartIds.length > 0
      ? preferredStartIds.filter((id) => indeg.has(id))
      : nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);

  const queue: string[] = [];
  for (const s of starts) {
    level.set(s, 0);
    queue.push(s);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const curLevel = level.get(cur) ?? 0;
    const next = adj.get(cur) ?? [];
    for (const n of next) {
      const proposed = curLevel + 1;
      const existing = level.get(n);
      if (existing === undefined || proposed < existing) {
        level.set(n, proposed);
        queue.push(n);
      }
    }
  }

  // Unreachable nodes go to the last column.
  const max = Math.max(0, ...Array.from(level.values()));
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, max + 1);
  }

  return level;
}

export function GraphView({
  nodes,
  edges,
  preferredStartIds,
  direction = 'horizontal',
  selectedId,
  onSelect,
  showNodePopover = false,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  preferredStartIds?: string[];
  direction?: 'horizontal' | 'vertical';
  selectedId?: string;
  onSelect?: (id?: string) => void;
  showNodePopover?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const targetZoomRef = useRef(zoom);
  const pendingAnchorRef = useRef<{ xGraph: number; yGraph: number; xClient: number; yClient: number } | null>(null);
  const pendingScrollTopLeftRef = useRef(false);
  const reactId = useId();
  const nodeClipId = useMemo(() => `nodeClip_${sanitizeDomId(reactId)}`, [reactId]);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);

  const layout = useMemo(() => {
    const pad = 16;
    const nodeW = 260;
    const nodeH = 64;
    const xGap = 320;
    const yGap = 86;

    const level = computeLevels(nodes, edges, preferredStartIds);
    const byLevel = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const l = level.get(n.id) ?? 0;
      const list = byLevel.get(l) ?? [];
      list.push(n);
      byLevel.set(l, list);
    }
    const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

    let maxRows = 0;
    const pos = new Map<string, { x: number; y: number }>();
    for (const l of levels) {
      const list = (byLevel.get(l) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
      maxRows = Math.max(maxRows, list.length);
      for (let i = 0; i < list.length; i += 1) {
        const n = list[i]!;
        const p =
          direction === 'vertical' ? { x: pad + i * xGap, y: pad + l * yGap } : { x: pad + l * xGap, y: pad + i * yGap };
        pos.set(n.id, p);
      }
    }

    const maxLevel = Math.max(0, ...levels);
    const minWidth = direction === 'vertical' ? 320 : 640;
    const contentWidth =
      direction === 'vertical'
        ? pad * 2 + Math.max(0, maxRows - 1) * xGap + nodeW
        : pad * 2 + (maxLevel + 1) * xGap + nodeW;
    const contentHeight =
      direction === 'vertical'
        ? pad * 2 + maxLevel * yGap + nodeH
        : pad * 2 + maxRows * yGap + nodeH;

    const width = Math.max(minWidth, contentWidth);
    const height = Math.max(320, contentHeight);

    const positioned: PositionedNode[] = nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? { x: pad, y: pad }) }));

    return { pad, nodeW, nodeH, width, height, positioned, pos };
  }, [nodes, edges, preferredStartIds, direction]);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return nodes.find((n) => n.id === selectedId) ?? null;
  }, [nodes, selectedId]);

  const updatePopoverPos = useCallback(() => {
    if (!showNodePopover || !selectedId || !selectedNode) {
      setPopoverPos(null);
      return;
    }
    const el = wrapRef.current;
    const card = popoverRef.current;
    if (!el || !card) {
      setPopoverPos(null);
      return;
    }

    const p = layout.pos.get(selectedId);
    if (!p) {
      setPopoverPos(null);
      return;
    }

    const cardW = Math.max(240, card.offsetWidth || 0);
    const cardH = Math.max(120, card.offsetHeight || 0);

    const nodeX = p.x * zoom;
    const nodeY = p.y * zoom;
    const nodeWpx = layout.nodeW * zoom;
    const nodeHpx = layout.nodeH * zoom;

    const margin = 10;
    const pad = 8;
    const scrollLeft = el.scrollLeft;
    const scrollTop = el.scrollTop;
    const viewW = el.clientWidth;
    const viewH = el.clientHeight;

    const nodeScreenY = nodeY - scrollTop;
    const spaceAbove = nodeScreenY;
    const spaceBelow = viewH - (nodeScreenY + nodeHpx);

    let top = nodeY - cardH - margin;
    if (spaceAbove < cardH + margin && spaceBelow >= cardH + margin) {
      top = nodeY + nodeHpx + margin;
    } else if (spaceAbove < cardH + margin && spaceBelow < cardH + margin) {
      top = spaceBelow >= spaceAbove ? nodeY + nodeHpx + margin : nodeY - cardH - margin;
    }

    let left = nodeX + nodeWpx / 2 - cardW / 2;

    const minLeft = scrollLeft + pad;
    const maxLeft = scrollLeft + Math.max(pad, viewW - pad - cardW);
    left = Math.min(Math.max(left, minLeft), maxLeft);

    const minTop = scrollTop + pad;
    const maxTop = scrollTop + Math.max(pad, viewH - pad - cardH);
    top = Math.min(Math.max(top, minTop), maxTop);

    setPopoverPos({ left, top });
  }, [showNodePopover, selectedId, selectedNode, layout.pos, layout.nodeW, layout.nodeH, zoom]);

  const schedulePopoverUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updatePopoverPos();
    });
  }, [updatePopoverPos]);

  useLayoutEffect(() => {
    schedulePopoverUpdate();
  }, [schedulePopoverUpdate]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!showNodePopover || !selectedId || !el) return;

    const onScroll = () => schedulePopoverUpdate();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [showNodePopover, selectedId, schedulePopoverUpdate]);

  const requestZoom = useCallback((nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
    const el = wrapRef.current;
    const oldZoom = zoomRef.current;
    const clamped = clampZoom(nextZoom);
    targetZoomRef.current = clamped;

    if (!el || oldZoom === 0 || clamped === oldZoom) {
      setZoom(clamped);
      return;
    }

    const clientX = anchor?.clientX ?? el.clientWidth / 2;
    const clientY = anchor?.clientY ?? el.clientHeight / 2;
    const xGraph = (el.scrollLeft + clientX) / oldZoom;
    const yGraph = (el.scrollTop + clientY) / oldZoom;
    pendingAnchorRef.current = { xGraph, yGraph, xClient: clientX, yClient: clientY };
    pendingScrollTopLeftRef.current = false;
    setZoom(clamped);
  }, []);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    const anchor = pendingAnchorRef.current;
    const pendingTopLeft = pendingScrollTopLeftRef.current;

    pendingAnchorRef.current = null;
    pendingScrollTopLeftRef.current = false;

    if (!el) {
      zoomRef.current = zoom;
      targetZoomRef.current = zoom;
      return;
    }

    if (pendingTopLeft) {
      el.scrollTo({ left: 0, top: 0 });
      zoomRef.current = zoom;
      targetZoomRef.current = zoom;
      return;
    }

    if (anchor) {
      const left = anchor.xGraph * zoom - anchor.xClient;
      const top = anchor.yGraph * zoom - anchor.yClient;
      el.scrollTo({ left: Math.max(0, left), top: Math.max(0, top) });
    }

    zoomRef.current = zoom;
    targetZoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !selectedId) return;
    const p = layout.pos.get(selectedId);
    if (!p) return;

    const z = zoomRef.current;
    const margin = 24;
    const left = Math.max(0, p.x * z - margin);
    const top = Math.max(0, p.y * z - margin);
    const right = (p.x + layout.nodeW) * z + margin;
    const bottom = (p.y + layout.nodeH) * z + margin;

    let targetLeft = el.scrollLeft;
    let targetTop = el.scrollTop;
    if (left < el.scrollLeft) targetLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) targetLeft = Math.max(0, right - el.clientWidth);
    if (top < el.scrollTop) targetTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) targetTop = Math.max(0, bottom - el.clientHeight);

    if (targetLeft !== el.scrollLeft || targetTop !== el.scrollTop) {
      el.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' });
    }
  }, [selectedId, layout]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel / trackpad pinch: zoom in/out inside the graph.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const scale = Math.exp(-e.deltaY * 0.001);
      const nextZoom = targetZoomRef.current * scale;
      requestZoom(nextZoom, { clientX, clientY });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [requestZoom]);

  const zoomPct = Math.round(zoom * 100);
  const canZoomOut = zoom > MIN_ZOOM + 1e-4;
  const canZoomIn = zoom < MAX_ZOOM - 1e-4;

  const zoomOut = useCallback(() => requestZoom(targetZoomRef.current - BUTTON_ZOOM_STEP), [requestZoom]);
  const zoomIn = useCallback(() => requestZoom(targetZoomRef.current + BUTTON_ZOOM_STEP), [requestZoom]);
  const resetZoom = useCallback(() => requestZoom(1), [requestZoom]);
  const fitToView = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const pad = 24;
    const w = Math.max(1, el.clientWidth - pad * 2);
    const h = Math.max(1, el.clientHeight - pad * 2);
    const z = clampZoom(Math.min(w / layout.width, h / layout.height));
    targetZoomRef.current = z;
    pendingScrollTopLeftRef.current = true;
    setZoom(z);
  }, [layout.width, layout.height]);

  return (
    <div className="graphShell">
      <div className="graphToolbarRow">
        <div className="graphToolbar" role="group" aria-label="缩放">
          <button className="graphToolButton" type="button" onClick={zoomOut} disabled={!canZoomOut} title="缩小">
            −
          </button>
          <button className="graphToolButton" type="button" onClick={zoomIn} disabled={!canZoomIn} title="放大">
            +
          </button>
          <button className="graphToolButton" type="button" onClick={fitToView} title="适配窗口">
            适配
          </button>
          <button className="graphToolButton" type="button" onClick={resetZoom} title="重置缩放">
            {zoomPct}%
          </button>
          <div className="graphHint" title="Ctrl+滚轮 / 触控板捏合缩放">
            Ctrl+滚轮
          </div>
        </div>
      </div>

      <div ref={wrapRef} className="graphWrap" role="img" aria-label="graph">
        <svg
          width={layout.width * zoom}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          onClick={() => onSelect?.(undefined)}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
            <clipPath id={nodeClipId} clipPathUnits="userSpaceOnUse">
              <rect x={0} y={0} width={layout.nodeW} height={layout.nodeH} rx={10} ry={10} />
            </clipPath>
          </defs>

          {edges.map((e, idx) => {
            const p1 = layout.pos.get(e.from);
            const p2 = layout.pos.get(e.to);
            if (!p1 || !p2) return null;

            const isVertical = direction === 'vertical';
            const x1 = isVertical ? p1.x + layout.nodeW / 2 : p1.x + layout.nodeW;
            const y1 = isVertical ? p1.y + layout.nodeH : p1.y + layout.nodeH / 2;
            const x2 = isVertical ? p2.x + layout.nodeW / 2 : p2.x;
            const y2 = isVertical ? p2.y : p2.y + layout.nodeH / 2;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const d = isVertical
              ? `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            return (
              <path key={idx} d={d} stroke="#94a3b8" strokeWidth="1.3" fill="none" markerEnd="url(#arrow)" />
            );
          })}

          {layout.positioned.map((n) => {
            const isSelected = selectedId === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!onSelect) return;
                  onSelect(selectedId === n.id ? undefined : n.id);
                }}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <rect
                  width={layout.nodeW}
                  height={layout.nodeH}
                  rx={10}
                  ry={10}
                  fill={isSelected ? '#eff6ff' : '#ffffff'}
                  stroke={isSelected ? '#2563eb' : '#e2e8f0'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <g clipPath={`url(#${nodeClipId})`}>
                  <text x={12} y={22} fontSize={13} fontWeight={600} fill="#0f172a">
                    {truncateToWidth({ text: n.title, maxWidth: layout.nodeW - 24, fontSize: 13, fontWeight: 600 })}
                  </text>
                  {n.subtitle && (
                    <text x={12} y={40} fontSize={12} fill="#475569">
                      {truncateToWidth({ text: n.subtitle, maxWidth: layout.nodeW - 24, fontSize: 12, fontWeight: 400 })}
                    </text>
                  )}
                  {n.detail && (
                    <text x={12} y={56} fontSize={12} fill="#475569">
                      {truncateToWidth({ text: n.detail, maxWidth: layout.nodeW - 24, fontSize: 12, fontWeight: 400 })}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </svg>

        {showNodePopover && selectedNode && selectedId && (
          <div
            ref={popoverRef}
            className="graphNodePopover"
            style={{
              left: popoverPos?.left ?? 0,
              top: popoverPos?.top ?? 0,
              visibility: popoverPos ? 'visible' : 'hidden',
              pointerEvents: popoverPos ? 'auto' : 'none',
            }}
          >
            <div className="graphNodePopoverHeader">
              <div className="graphNodePopoverTitle">{selectedNode.title}</div>
              <button className="graphNodePopoverClose" type="button" onClick={() => onSelect?.(undefined)} aria-label="关闭">
                ×
              </button>
            </div>
            {selectedNode.subtitle && (
              <div className="graphNodePopoverSubtitle">
                {selectedNode.openInEditor ? (
                  <FilePathWithEditorLink
                    filePath={selectedNode.openInEditor.filePath}
                    line={selectedNode.openInEditor.line}
                    column={selectedNode.openInEditor.column}
                    wslDistroName={selectedNode.openInEditor.wslDistroName}
                    label={selectedNode.subtitle}
                    title="在本地编辑器打开源码"
                  />
                ) : (
                  selectedNode.subtitle
                )}
              </div>
            )}
            {selectedNode.detail && <div className="graphNodePopoverDetail">{selectedNode.detail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
