import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchSources } from '../api';
import { FilePathWithEditorLink } from '../components/EditorLink';
import { useRepoRoot } from '../hooks/useRepoRoot';

type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; rows: Array<Record<string, unknown>> };

function asPositiveInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  if (i <= 0) return undefined;
  return i;
}

export function SourcesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('runId') || undefined;

  const repoRootState = useRepoRoot();
  const repoRoot = repoRootState.state === 'ready' ? repoRootState.repoRoot : undefined;
  const wslDistroName = repoRootState.state === 'ready' ? repoRootState.wslDistroName : undefined;

  const [state, setState] = useState<LoadState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ state: 'loading' });
        const data = await fetchSources({ runId });
        const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
        if (!cancelled) setState({ state: 'ready', rows });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const columns = useMemo(() => {
    return ['App源码文件路径', '行号', '函数名称', '描述'];
  }, []);

  return (
    <div className="page">
      <h1 className="title">source API 可视化</h1>
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
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((c) => (
                    <td key={c}>
                      {c === 'App源码文件路径' ? (
                        <FilePathWithEditorLink
                          repoRoot={repoRoot}
                          wslDistroName={wslDistroName}
                          filePath={String(row[c] ?? '')}
                          line={asPositiveInt(row['行号'])}
                        />
                      ) : (
                        String(row[c] ?? '')
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
