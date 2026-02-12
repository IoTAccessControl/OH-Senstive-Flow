import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchPrivacyReport } from '../api';

type JumpTo = { moduleId: string; flowId: string; nodeId: string };

type ReportToken = {
  text: string;
  jumpTo?: JumpTo;
};

type ReportSection = {
  moduleId: string;
  tokens: ReportToken[];
};

type PrivacyReport = {
  meta?: { skipped?: boolean; skipReason?: string };
  sections: {
    collectionAndUse: ReportSection[];
    permissions: ReportSection[];
  };
};

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; report: PrivacyReport };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isToken(v: unknown): v is ReportToken {
  if (!isRecord(v)) return false;
  if (typeof v.text !== 'string') return false;
  if (!('jumpTo' in v)) return true;
  const j = v.jumpTo;
  if (j === undefined) return true;
  if (!isRecord(j)) return false;
  return typeof j.moduleId === 'string' && typeof j.flowId === 'string' && typeof j.nodeId === 'string';
}

function isSection(v: unknown): v is ReportSection {
  if (!isRecord(v)) return false;
  if (typeof v.moduleId !== 'string') return false;
  if (!Array.isArray(v.tokens)) return false;
  return v.tokens.every(isToken);
}

function asReport(raw: unknown): PrivacyReport {
  if (!isRecord(raw)) {
    return { sections: { collectionAndUse: [], permissions: [] } };
  }
  const meta = isRecord(raw.meta) ? (raw.meta as PrivacyReport['meta']) : undefined;

  const sectionsRaw = raw.sections;
  const sections = isRecord(sectionsRaw) ? (sectionsRaw as Record<string, unknown>) : {};
  const cuRaw = sections['collectionAndUse'];
  const pRaw = sections['permissions'];

  const collectionAndUse = Array.isArray(cuRaw) ? cuRaw.filter(isSection) : [];
  const permissions = Array.isArray(pRaw) ? pRaw.filter(isSection) : [];
  return { meta, sections: { collectionAndUse, permissions } };
}

function buildDataflowsUrl(args: { runId?: string; jumpTo: JumpTo }): string {
  const qs = new URLSearchParams();
  if (args.runId) qs.set('runId', args.runId);
  qs.set('moduleId', args.jumpTo.moduleId);
  qs.set('flowId', args.jumpTo.flowId);
  qs.set('nodeId', args.jumpTo.nodeId);
  return `/dataflows?${qs.toString()}`;
}

export function PrivacyReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') || undefined;

  const [state, setState] = useState<LoadState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ state: 'loading' });
        const raw = await fetchPrivacyReport({ runId });
        const report = asReport(raw);
        if (cancelled) return;
        setState({ state: 'ready', report });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const skipReason = useMemo(() => {
    if (state.state !== 'ready') return undefined;
    return state.report.meta?.skipped ? state.report.meta?.skipReason : undefined;
  }, [state]);

  return (
    <div className="page">
      <h1 className="title">隐私声明报告</h1>
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
          {skipReason && <div className="status">提示：{skipReason}</div>}

          <div className="report">
            <div className="reportTitle">1 我们如何收集和使用您的个人信息</div>
            {state.report.sections.collectionAndUse.map((p) => (
              <p key={`cu:${p.moduleId}`} className="reportParagraph">
                {p.tokens.length === 0 ? (
                  <span>{p.moduleId}：暂无内容</span>
                ) : (
                  p.tokens.map((t, idx) => {
                    if (!t.jumpTo) return <span key={`${p.moduleId}:${idx}`}>{t.text}</span>;
                    const url = buildDataflowsUrl({ runId, jumpTo: t.jumpTo });
                    return (
                      <span
                        key={`${p.moduleId}:${idx}`}
                        className="tokenLink"
                        role="link"
                        tabIndex={0}
                        title="跳转到对应数据流节点"
                        onClick={() => navigate(url)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') navigate(url);
                        }}
                      >
                        {t.text}
                      </span>
                    );
                  })
                )}
              </p>
            ))}

            <div className="reportTitle">2 设备权限调用</div>
            {state.report.sections.permissions.map((p) => (
              <p key={`perm:${p.moduleId}`} className="reportParagraph">
                {p.tokens.length === 0 ? (
                  <span>{p.moduleId}：暂无内容</span>
                ) : (
                  p.tokens.map((t, idx) => {
                    if (!t.jumpTo) return <span key={`${p.moduleId}:${idx}`}>{t.text}</span>;
                    const url = buildDataflowsUrl({ runId, jumpTo: t.jumpTo });
                    return (
                      <span
                        key={`${p.moduleId}:${idx}`}
                        className="tokenLink"
                        role="link"
                        tabIndex={0}
                        title="跳转到对应数据流节点"
                        onClick={() => navigate(url)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') navigate(url);
                        }}
                      >
                        {t.text}
                      </span>
                    );
                  })
                )}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
