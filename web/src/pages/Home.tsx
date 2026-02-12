import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  fetchFsDirs,
  fetchFsRoots,
  fetchRuns,
  startAnalyze,
  type AnalyzeResponse,
  type FsBase,
  type FsDirEntry,
  type RunRegistryEntry,
} from '../api';
import { useAnalysisSnapshot } from '../analysisContext';

type StatusState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; result: AnalyzeResponse }
  | { state: 'error'; message: string };

type RunsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; runs: RunRegistryEntry[] }
  | { state: 'error'; message: string };

type DirPickerTarget = 'appPath' | 'sdkPath' | 'csvDir';

type DirPickerState = { open: false } | { open: true; base: FsBase; target: DirPickerTarget; cwd: string };

type DirPickerDirsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; entries: FsDirEntry[] }
  | { state: 'error'; message: string };

type FsRootsState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; repoRoot: string; roots: Record<FsBase, string> }
  | { state: 'error'; message: string };

const SELECTED_RUN_ID_KEY = 'cx-oh:selected-run-id';

const DIR_PICKER_REL_PREFIX: Record<FsBase, string> = {
  app: 'input/app/',
  sdk: 'input/sdk/',
  csv: 'input/csv/',
};

function readSelectedRunIdFromSessionStorage(): string {
  try {
    if (typeof window === 'undefined') return '';
    const raw = window.sessionStorage.getItem(SELECTED_RUN_ID_KEY);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

function writeSelectedRunIdToSessionStorage(runId: string): void {
  try {
    if (typeof window === 'undefined') return;
    if (!runId) {
      window.sessionStorage.removeItem(SELECTED_RUN_ID_KEY);
      return;
    }
    window.sessionStorage.setItem(SELECTED_RUN_ID_KEY, runId);
  } catch {
    // ignore storage failures
  }
}

function normalizePathSlashes(value: string): string {
  return value.replace(/\\/gu, '/');
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function isProbablyAbsolutePath(value: string): boolean {
  const normalized = normalizePathSlashes(value).trim();
  if (normalized.startsWith('/')) return true;
  if (/^[A-Za-z]:\//u.test(normalized)) return true;
  if (normalized.startsWith('//')) return true;
  return false;
}

function normalizePosixAbsolutePath(value: string): string {
  const normalized = normalizePathSlashes(value).trim();
  if (!normalized) return normalized;

  let prefix = '/';
  let rest = normalized;

  const driveMatch = /^[A-Za-z]:\//u.exec(normalized);
  if (driveMatch) {
    prefix = normalized.slice(0, 3);
    rest = normalized.slice(3);
  } else if (normalized.startsWith('//')) {
    prefix = '//';
    rest = normalized.slice(2);
  } else if (normalized.startsWith('/')) {
    prefix = '/';
    rest = normalized.slice(1);
  } else {
    prefix = '';
    rest = normalized;
  }

  const parts = rest.split('/').filter((p) => p.length > 0 && p !== '.');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(p);
  }

  if (prefix === '//') return `//${out.join('/')}`;
  if (prefix === '') return out.join('/');
  return `${prefix}${out.join('/')}`;
}

function resolveToAbsolutePath(repoRoot: string, maybeRelative: string): string {
  const trimmed = maybeRelative.trim();
  if (!trimmed) return trimmed;
  const normalizedRepoRoot = normalizePosixAbsolutePath(repoRoot);
  const normalized = normalizePathSlashes(trimmed);
  if (isProbablyAbsolutePath(normalized)) return ensureTrailingSlash(normalizePosixAbsolutePath(normalized));
  return ensureTrailingSlash(normalizePosixAbsolutePath(`${normalizedRepoRoot}/${normalized}`));
}

function joinPrefixAndCwd(prefix: string, cwd: string): string {
  const p = normalizePathSlashes(prefix).trim();
  const base = p.endsWith('/') ? p : `${p}/`;
  const rel = normalizePathSlashes(cwd).replace(/^\/+/u, '').replace(/\/+$/u, '');
  return rel ? `${base}${rel}/` : base;
}

function stripDirPickerPrefix(fullPath: string, prefix: string): string {
  const normalized = normalizePathSlashes(fullPath).trim();
  const normalizedPrefix = normalizePathSlashes(prefix);
  if (!normalized.startsWith(normalizedPrefix)) return '';
  const rest = normalized.slice(normalizedPrefix.length);
  return rest.replace(/^\/+/u, '').replace(/\/+$/u, '');
}

export function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { snapshot, setSnapshot } = useAnalysisSnapshot();
  const runIdFromQuery = searchParams.get('runId') ?? '';

  const [appPath, setAppPath] = useState(snapshot?.appPath ?? 'input/app/Wechat_HarmonyOS/');
  const [sdkPath, setSdkPath] = useState(snapshot?.sdkPath ?? 'input/sdk/default/openharmony/ets/');
  const [csvDir, setCsvDir] = useState(snapshot?.csvDir ?? 'input/csv/');
  const [maxDataflowPaths, setMaxDataflowPaths] = useState<number>(snapshot?.maxDataflowPaths ?? 5);
  const [llmProvider, setLlmProvider] = useState(snapshot?.llmProvider ?? 'Qwen');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState(snapshot?.llmModel ?? 'qwen3-coder-plus');
  const [uiLlmProvider, setUiLlmProvider] = useState(snapshot?.uiLlmProvider ?? 'Qwen');
  const [uiLlmApiKey, setUiLlmApiKey] = useState('');
  const [uiLlmModel, setUiLlmModel] = useState(snapshot?.uiLlmModel ?? 'qwen3-32b');
  const [privacyReportLlmProvider, setPrivacyReportLlmProvider] = useState(snapshot?.privacyReportLlmProvider ?? 'Qwen');
  const [privacyReportLlmApiKey, setPrivacyReportLlmApiKey] = useState('');
  const [privacyReportLlmModel, setPrivacyReportLlmModel] = useState(snapshot?.privacyReportLlmModel ?? 'qwen3-32b');
  const [status, setStatus] = useState<StatusState>({ state: 'idle' });
  const [dirPicker, setDirPicker] = useState<DirPickerState>({ open: false });
  const [dirPickerDirs, setDirPickerDirs] = useState<DirPickerDirsState>({ state: 'idle' });
  const [fsRoots, setFsRoots] = useState<FsRootsState>({ state: 'idle' });

  const [runs, setRuns] = useState<RunsState>({ state: 'idle' });
  const [selectedRunId, setSelectedRunId] = useState<string>(() => {
    return runIdFromQuery || readSelectedRunIdFromSessionStorage() || snapshot?.result.runId || '';
  });

  const canJump = Boolean(selectedRunId);
  const runId = selectedRunId || undefined;

  useEffect(() => {
    writeSelectedRunIdToSessionStorage(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setRuns({ state: 'loading' });
        const list = await fetchRuns();
        if (!cancelled) setRuns({ state: 'ready', runs: list });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setRuns({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setFsRoots({ state: 'loading' });
        const data = await fetchFsRoots();
        const normalizedRepoRoot = normalizePosixAbsolutePath(data.repoRoot);
        const normalizedRoots = {
          app: normalizePosixAbsolutePath(data.roots.app),
          sdk: normalizePosixAbsolutePath(data.roots.sdk),
          csv: normalizePosixAbsolutePath(data.roots.csv),
        };
        if (!cancelled) {
          setFsRoots({ state: 'ready', repoRoot: normalizedRepoRoot, roots: normalizedRoots });
          setAppPath((prev) => resolveToAbsolutePath(normalizedRepoRoot, prev));
          setSdkPath((prev) => resolveToAbsolutePath(normalizedRepoRoot, prev));
          setCsvDir((prev) => resolveToAbsolutePath(normalizedRepoRoot, prev));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setFsRoots({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function getDirPickerPrefix(base: FsBase): string {
    if (fsRoots.state === 'ready' && fsRoots.roots[base]) return ensureTrailingSlash(fsRoots.roots[base]);
    return DIR_PICKER_REL_PREFIX[base];
  }

  useEffect(() => {
    if (!dirPicker.open) return;
    let cancelled = false;
    (async () => {
      try {
        setDirPickerDirs({ state: 'loading' });
        const data = await fetchFsDirs({ base: dirPicker.base, path: dirPicker.cwd });
        if (!cancelled) setDirPickerDirs({ state: 'ready', entries: data.entries });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setDirPickerDirs({ state: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dirPicker]);

  useEffect(() => {
    if (!dirPicker.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDirPicker({ open: false });
        setDirPickerDirs({ state: 'idle' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dirPicker.open]);

  const statusText = useMemo(() => {
    if (status.state === 'running') return '状态：分析中…';
    if (status.state === 'error') return `状态：失败（${status.message}）`;
    if (fsRoots.state === 'error') return `状态：路径根目录加载失败（${fsRoots.message}）`;
    if (snapshot?.result && selectedRunId && selectedRunId !== snapshot.result.runId) {
      return `状态：完成（runId=${snapshot.result.runId}，输出目录=${snapshot.result.outputDir}），当前选择 runId=${selectedRunId}`;
    }
    if (snapshot?.result) return `状态：完成（runId=${snapshot.result.runId}，输出目录=${snapshot.result.outputDir}）`;
    if (selectedRunId) return `状态：已选择（runId=${selectedRunId}）`;
    return '状态：未开始';
  }, [fsRoots, selectedRunId, snapshot, status]);

  function openDirPicker(target: DirPickerTarget) {
    const base: FsBase = target === 'appPath' ? 'app' : target === 'sdkPath' ? 'sdk' : 'csv';
    const prefix = getDirPickerPrefix(base);
    const currentValue = target === 'appPath' ? appPath : target === 'sdkPath' ? sdkPath : csvDir;
    setDirPicker({
      open: true,
      base,
      target,
      cwd: stripDirPickerPrefix(currentValue, prefix),
    });
  }

  function closeDirPicker() {
    setDirPicker({ open: false });
    setDirPickerDirs({ state: 'idle' });
  }

  function confirmDirPicker() {
    if (!dirPicker.open) return;
    const prefix = getDirPickerPrefix(dirPicker.base);
    const nextValue = joinPrefixAndCwd(prefix, dirPicker.cwd);
    if (dirPicker.target === 'appPath') setAppPath(nextValue);
    if (dirPicker.target === 'sdkPath') setSdkPath(nextValue);
    if (dirPicker.target === 'csvDir') setCsvDir(nextValue);
    closeDirPicker();
  }

  async function onAnalyze() {
    try {
      setStatus({ state: 'running' });
      const safeMax = Number.isFinite(maxDataflowPaths) ? Math.max(1, Math.floor(maxDataflowPaths)) : 5;
      const result = await startAnalyze({
        appPath,
        sdkPath,
        csvDir,
        maxDataflowPaths: safeMax,
        llmProvider: llmProvider.trim() || 'Qwen',
        llmApiKey,
        llmModel: llmModel.trim() || 'qwen3-coder-plus',
        uiLlmProvider: uiLlmProvider.trim() || 'Qwen',
        uiLlmApiKey,
        uiLlmModel: uiLlmModel.trim() || 'qwen3-32b',
        privacyReportLlmProvider: privacyReportLlmProvider.trim() || 'Qwen',
        privacyReportLlmApiKey,
        privacyReportLlmModel: privacyReportLlmModel.trim() || 'qwen3-32b',
      });
      setSnapshot({
        appPath,
        sdkPath,
        csvDir,
        maxDataflowPaths: safeMax,
        llmProvider: llmProvider.trim() || 'Qwen',
        llmModel: llmModel.trim() || 'qwen3-coder-plus',
        uiLlmProvider: uiLlmProvider.trim() || 'Qwen',
        uiLlmModel: uiLlmModel.trim() || 'qwen3-32b',
        privacyReportLlmProvider: privacyReportLlmProvider.trim() || 'Qwen',
        privacyReportLlmModel: privacyReportLlmModel.trim() || 'qwen3-32b',
        result,
      });
      setSelectedRunId(result.runId);
      setStatus({ state: 'idle' });

      try {
        const list = await fetchRuns();
        setRuns({ state: 'ready', runs: list });
      } catch {
        // ignore refresh failures
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ state: 'error', message });
    }
  }

  return (
    <div className="page">
      <h1 className="title">隐私声明报告生成工具</h1>

      <div className="form">
        <label className="field">
          <div className="label" title="待分析的 ArkTS App 源码路径（默认 input/app/<appName>/）">
            App 源码路径
          </div>
          <div className="pathRow">
            <input className="input" value={appPath} onChange={(e) => setAppPath(e.target.value)} />
            <button className="button" type="button" onClick={() => openDirPicker('appPath')}>
              选择
            </button>
          </div>
        </label>

        <label className="field">
          <div className="label" title="OpenHarmony SDK 源码路径（默认 input/sdk/default/openharmony/ets/）">
            SDK 源码路径
          </div>
          <div className="pathRow">
            <input className="input" value={sdkPath} onChange={(e) => setSdkPath(e.target.value)} />
            <button className="button" type="button" onClick={() => openDirPicker('sdkPath')}>
              选择
            </button>
          </div>
        </label>

        <label className="field">
          <div className="label" title="SDK API 补充信息 CSV 文件路径（默认 input/csv/）">
            CSV 目录
          </div>
          <div className="pathRow">
            <input className="input" value={csvDir} onChange={(e) => setCsvDir(e.target.value)} />
            <button className="button" type="button" onClick={() => openDirPicker('csvDir')}>
              选择
            </button>
          </div>
        </label>

        <label className="field">
          <div className="label" title="最大提取数据流条数（默认 5，最小 1）">
            数据流条数
          </div>
          <input
            className="input"
            type="number"
            min={1}
            step={1}
            value={String(maxDataflowPaths)}
            onChange={(e) => setMaxDataflowPaths(Number(e.target.value))}
          />
        </label>

        <div className="llmGrid">
          <label className="field">
            <div className="label" title="数据流分析的 LLM 提供商名称（默认 Qwen）">
              数据流 LLM 提供商
            </div>
            <input className="input" value={llmProvider} onChange={(e) => setLlmProvider(e.target.value)} />
          </label>

          <label className="field">
            <div className="label" title="数据流分析的 LLM 提供商 API Key（默认空，不会写入输出文件）">
              数据流 LLM API Key
            </div>
            <input
              className="input"
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
            />
          </label>

          <label className="field">
            <div className="label" title="数据流分析的模型名称（默认 qwen3-coder-plus）">
              数据流 LLM 模型
            </div>
            <input className="input" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} />
          </label>

          <label className="field">
            <div className="label" title="描述 UI 的 LLM 提供商名称（默认 Qwen）">
              UI LLM 提供商
            </div>
            <input className="input" value={uiLlmProvider} onChange={(e) => setUiLlmProvider(e.target.value)} />
          </label>

          <label className="field">
            <div className="label" title="描述 UI 的 LLM 提供商 API Key（默认空，不会写入输出文件）">
              UI LLM API Key
            </div>
            <input
              className="input"
              type="password"
              value={uiLlmApiKey}
              onChange={(e) => setUiLlmApiKey(e.target.value)}
            />
          </label>

          <label className="field">
            <div className="label" title="描述 UI 的模型名称（默认 qwen3-32b）">
              UI LLM 模型
            </div>
            <input className="input" value={uiLlmModel} onChange={(e) => setUiLlmModel(e.target.value)} />
          </label>

          <label className="field">
            <div className="label" title="生成隐私声明报告的 LLM 提供商名称（默认 Qwen）">
              报告 LLM 提供商
            </div>
            <input
              className="input"
              value={privacyReportLlmProvider}
              onChange={(e) => setPrivacyReportLlmProvider(e.target.value)}
            />
          </label>

          <label className="field">
            <div className="label" title="生成隐私声明报告的 LLM 提供商 API Key（默认空，不会写入输出文件）">
              报告 LLM API Key
            </div>
            <input
              className="input"
              type="password"
              value={privacyReportLlmApiKey}
              onChange={(e) => setPrivacyReportLlmApiKey(e.target.value)}
            />
          </label>

          <label className="field">
            <div className="label" title="生成隐私声明报告的模型名称（默认 qwen3-32b）">
              报告 LLM 模型
            </div>
            <input
              className="input"
              value={privacyReportLlmModel}
              onChange={(e) => setPrivacyReportLlmModel(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <div className="label" title="选择要查看的 runId（选择后可跳转查看该 runId 的分析结果）">
            选择 runId
          </div>
          <select
            className="input"
            value={selectedRunId}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedRunId(next);
              writeSelectedRunIdToSessionStorage(next);
            }}
          >
            <option value="">（未选择）</option>
            {runs.state === 'ready' &&
              runs.runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.runId}
                </option>
              ))}
          </select>
          {runs.state === 'loading' && <div className="status">runId 列表加载中…</div>}
          {runs.state === 'error' && <div className="status error">runId 列表加载失败：{runs.message}</div>}
        </label>

        <div className="actions">
          <button className="button primary" type="button" onClick={onAnalyze} disabled={status.state === 'running'}>
            开始分析
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runId && navigate(`/privacy-report?runId=${encodeURIComponent(runId)}`)}
            disabled={!canJump}
          >
            隐私声明报告
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runId && navigate(`/sinks?runId=${encodeURIComponent(runId)}`)}
            disabled={!canJump}
          >
            sink API信息
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runId && navigate(`/sources?runId=${encodeURIComponent(runId)}`)}
            disabled={!canJump}
          >
            source API信息
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runId && navigate(`/callgraph?runId=${encodeURIComponent(runId)}`)}
            disabled={!canJump}
          >
            调用图可视化
          </button>
          <button
            className="button"
            type="button"
            onClick={() => runId && navigate(`/dataflows?runId=${encodeURIComponent(runId)}`)}
            disabled={!canJump}
          >
            数据流可视化
          </button>
        </div>

        <div className="status" aria-live="polite">
          {statusText}
        </div>
      </div>

      {dirPicker.open && (
        <div
          className="modalOverlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDirPicker();
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="选择目录">
            <div className="modalHeader">
              <div className="modalTitle">
                {dirPicker.target === 'appPath'
                  ? '选择 App 源码目录'
                  : dirPicker.target === 'sdkPath'
                    ? '选择 OpenHarmony SDK 目录'
                    : '选择 CSV 目录'}
              </div>
              <button className="button" type="button" onClick={closeDirPicker}>
                关闭
              </button>
            </div>

            <div className="modalBody">
              <div className="pickerBar">
                <button
                  className="button"
                  type="button"
                  disabled={!dirPicker.cwd}
                  onClick={() => {
                    const parts = dirPicker.cwd.split('/').filter(Boolean);
                    parts.pop();
                    setDirPicker({ ...dirPicker, cwd: parts.join('/') });
                  }}
                >
                  上一级
                </button>
                <div className="pickerPath" title={`${joinPrefixAndCwd(getDirPickerPrefix(dirPicker.base), dirPicker.cwd)}`}>
                  {joinPrefixAndCwd(getDirPickerPrefix(dirPicker.base), dirPicker.cwd)}
                </div>
              </div>

              {dirPickerDirs.state === 'loading' && <div className="status">目录加载中…</div>}
              {dirPickerDirs.state === 'error' && <div className="status error">目录加载失败：{dirPickerDirs.message}</div>}
              {dirPickerDirs.state === 'ready' && dirPickerDirs.entries.length === 0 && (
                <div className="status">（该目录下没有子目录）</div>
              )}

              {dirPickerDirs.state === 'ready' && dirPickerDirs.entries.length > 0 && (
                <div className="dirList">
                  {dirPickerDirs.entries.map((d) => (
                    <button
                      key={d.relPath}
                      className="dirItem"
                      type="button"
                      onClick={() => setDirPicker({ ...dirPicker, cwd: d.relPath })}
                      title={d.relPath}
                    >
                      {d.name}/
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="modalFooter">
              <button className="button primary" type="button" onClick={confirmDirPicker}>
                选择此目录
              </button>
              <button className="button" type="button" onClick={closeDirPicker}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
