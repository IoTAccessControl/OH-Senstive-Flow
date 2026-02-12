import { createContext, useContext } from 'react';

import type { AnalyzeResponse } from './api';

export type AnalysisSnapshot = {
  appPath: string;
  sdkPath: string;
  csvDir: string;
  maxDataflowPaths: number;
  llmProvider: string;
  llmModel: string;
  uiLlmProvider: string;
  uiLlmModel: string;
  privacyReportLlmProvider: string;
  privacyReportLlmModel: string;
  result: AnalyzeResponse;
};

export type AnalysisContextValue = {
  snapshot: AnalysisSnapshot | null;
  setSnapshot: (next: AnalysisSnapshot | null) => void;
};

export const AnalysisContext = createContext<AnalysisContextValue | undefined>(undefined);

export function useAnalysisSnapshot(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysisSnapshot must be used within <AnalysisProvider>');
  return ctx;
}
