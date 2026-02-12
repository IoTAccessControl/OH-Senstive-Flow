import { useEffect, useMemo, useState } from 'react';

import { AnalysisContext, type AnalysisContextValue, type AnalysisSnapshot } from './analysisContext';

const STORAGE_KEY = 'cx-oh:last-analysis-snapshot';

function readFromSessionStorage(): AnalysisSnapshot | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AnalysisSnapshot;
  } catch {
    return null;
  }
}

function writeToSessionStorage(snapshot: AnalysisSnapshot | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (!snapshot) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage failures
  }
}

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(() => readFromSessionStorage());

  useEffect(() => {
    writeToSessionStorage(snapshot);
  }, [snapshot]);

  const value = useMemo<AnalysisContextValue>(() => ({ snapshot, setSnapshot }), [snapshot]);
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

