import { useEffect, useState } from 'react';

import { fetchFsRoots } from '../api';

export const REPO_ROOT_STORAGE_KEY = 'cx-oh:repo-root';
export const WSL_DISTRO_STORAGE_KEY = 'cx-oh:wsl-distro-name';

let cachedRepoRoot: string | null = null;
let cachedWslDistroName: string | null = null;
let inflight: Promise<{ repoRoot: string; wslDistroName: string }> | null = null;

export function readRepoRootFromSessionStorage(): string {
  try {
    if (typeof window === 'undefined') return '';
    const raw = window.sessionStorage.getItem(REPO_ROOT_STORAGE_KEY);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
}

function readWslDistroNameFromSessionStorage(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(WSL_DISTRO_STORAGE_KEY);
    if (raw === null) return null;
    return raw;
  } catch {
    return null;
  }
}

export function setCachedRepoRoot(repoRoot: string): void {
  const trimmed = repoRoot.trim();
  cachedRepoRoot = trimmed || null;
  try {
    if (typeof window === 'undefined') return;
    if (!trimmed) {
      window.sessionStorage.removeItem(REPO_ROOT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(REPO_ROOT_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage failures
  }
}

function setCachedWslDistroName(wslDistroName: string): void {
  const trimmed = wslDistroName.trim();
  cachedWslDistroName = trimmed;
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(WSL_DISTRO_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage failures
  }
}

async function ensureRepoInfo(): Promise<{ repoRoot: string; wslDistroName: string }> {
  const existingRepoRoot = cachedRepoRoot ?? readRepoRootFromSessionStorage();
  const existingWsl = cachedWslDistroName ?? readWslDistroNameFromSessionStorage();
  if (existingRepoRoot && existingWsl !== null) {
    cachedRepoRoot = existingRepoRoot;
    cachedWslDistroName = existingWsl;
    return { repoRoot: existingRepoRoot, wslDistroName: existingWsl };
  }

  if (!inflight) {
    inflight = (async () => {
      const data = await fetchFsRoots();
      const repoRoot = typeof data.repoRoot === 'string' ? data.repoRoot.trim() : '';
      const wslDistroName = typeof data.wslDistroName === 'string' ? data.wslDistroName.trim() : '';
      if (repoRoot) setCachedRepoRoot(repoRoot);
      setCachedWslDistroName(wslDistroName);
      return { repoRoot, wslDistroName };
    })().finally(() => {
      inflight = null;
    });
  }

  return inflight;
}

export type RepoRootState =
  | { state: 'loading'; repoRoot: string; wslDistroName?: string }
  | { state: 'ready'; repoRoot: string; wslDistroName?: string }
  | { state: 'error'; repoRoot: string; wslDistroName?: string; message: string };

export function useRepoRoot(): RepoRootState {
  const [state, setState] = useState<RepoRootState>(() => {
    const existingRepoRoot = cachedRepoRoot ?? readRepoRootFromSessionStorage();
    const existingWsl = cachedWslDistroName ?? readWslDistroNameFromSessionStorage();
    if (existingRepoRoot) {
      cachedRepoRoot = existingRepoRoot;
      if (existingWsl !== null) {
        cachedWslDistroName = existingWsl;
        return { state: 'ready', repoRoot: existingRepoRoot, wslDistroName: existingWsl };
      }
      return { state: 'ready', repoRoot: existingRepoRoot };
    }
    return { state: 'loading', repoRoot: '' };
  });

  useEffect(() => {
    const needsFetch = state.state === 'loading' || (state.state === 'ready' && state.wslDistroName === undefined);
    if (!needsFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await ensureRepoInfo();
        if (cancelled) return;
        if (!info.repoRoot) {
          setState({ state: 'error', repoRoot: '', wslDistroName: info.wslDistroName, message: 'repoRoot 为空' });
          return;
        }
        setState({ state: 'ready', repoRoot: info.repoRoot, wslDistroName: info.wslDistroName });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState({ state: 'error', repoRoot: '', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.state, state.wslDistroName]);

  return state;
}
