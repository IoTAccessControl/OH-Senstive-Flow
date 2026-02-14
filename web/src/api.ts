export type AnalyzeResponse = {
  runId: string;
  outputDir: string;
  counts: { filesScanned: number; sinks: number; sources: number };
};

export type AnalyzeParams = {
  appPath: string;
  sdkPath: string;
  csvDir: string;
  maxDataflowPaths: number;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  uiLlmProvider: string;
  uiLlmApiKey: string;
  uiLlmModel: string;
  privacyReportLlmProvider: string;
  privacyReportLlmApiKey: string;
  privacyReportLlmModel: string;
};

export type RunRegistryEntry = {
  runId: string;
  outputDir: string;
};

export type FsBase = 'app' | 'sdk' | 'csv';

export type FsDirEntry = {
  name: string;
  relPath: string;
};

export type FsRoots = {
  repoRoot: string;
  roots: Record<FsBase, string>;
  wslDistroName?: string;
};

export async function fetchFsRoots(): Promise<FsRoots> {
  const res = await fetch('/api/fs/roots');
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') throw new Error('fs/roots 返回格式错误');
  if (!('ok' in data) || (data as { ok?: unknown }).ok !== true) {
    const message = (data as { error?: unknown }).error;
    throw new Error(typeof message === 'string' ? message : 'fs/roots 请求失败');
  }

  const cast = data as { repoRoot?: unknown; roots?: unknown };
  const repoRoot = typeof cast.repoRoot === 'string' ? cast.repoRoot : '';
  const roots = cast.roots && typeof cast.roots === 'object' ? (cast.roots as Record<string, unknown>) : {};
  const wslDistroNameRaw = (data as { wslDistroName?: unknown }).wslDistroName;
  const wslDistroName = typeof wslDistroNameRaw === 'string' ? wslDistroNameRaw.trim() : '';
  return {
    repoRoot,
    roots: {
      app: typeof roots.app === 'string' ? roots.app : '',
      sdk: typeof roots.sdk === 'string' ? roots.sdk : '',
      csv: typeof roots.csv === 'string' ? roots.csv : '',
    },
    wslDistroName: wslDistroName || undefined,
  };
}

export async function fetchFsDirs(params: { base: FsBase; path?: string }): Promise<{ base: FsBase; cwd: string; entries: FsDirEntry[] }> {
  const qs = new URLSearchParams();
  qs.set('base', params.base);
  if (params.path) qs.set('path', params.path);
  const url = `/api/fs/dirs${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') throw new Error('fs/dirs 返回格式错误');
  if (!('ok' in data) || (data as { ok?: unknown }).ok !== true) {
    const message = (data as { error?: unknown }).error;
    throw new Error(typeof message === 'string' ? message : 'fs/dirs 请求失败');
  }
  const cast = data as { base?: unknown; cwd?: unknown; entries?: unknown };
  return {
    base: cast.base as FsBase,
    cwd: typeof cast.cwd === 'string' ? cast.cwd : '',
    entries: Array.isArray(cast.entries) ? (cast.entries as FsDirEntry[]) : [],
  };
}

export async function startAnalyze(params: AnalyzeParams): Promise<AnalyzeResponse> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as AnalyzeResponse;
}

export async function fetchRuns(): Promise<RunRegistryEntry[]> {
  const res = await fetch('/api/runs');
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as RunRegistryEntry[]) : [];
}

export async function fetchSinks(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/sinks${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchSources(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/sources${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchCallGraph(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/callgraph${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchDataflows(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/dataflows${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchPages(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/pages${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchPageFeatures(params: {
  pageId: string;
  runId?: string;
  outputDir?: string;
}): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/pages/${encodeURIComponent(params.pageId)}/features${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchPageFeatureDataflows(params: {
  pageId: string;
  featureId: string;
  runId?: string;
  outputDir?: string;
}): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/pages/${encodeURIComponent(params.pageId)}/features/${encodeURIComponent(params.featureId)}/dataflows${
    qs.toString() ? `?${qs.toString()}` : ''
  }`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}

export async function fetchPrivacyReport(params: { runId?: string; outputDir?: string }): Promise<unknown> {
  const qs = new URLSearchParams();
  if (params.runId) qs.set('runId', params.runId);
  if (params.outputDir) qs.set('outputDir', params.outputDir);
  const url = `/api/results/privacy_report${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as unknown;
}
