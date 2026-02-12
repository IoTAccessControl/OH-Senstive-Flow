export type SinkRecord = {
  App源码文件路径: string;
  导入行号: number;
  导入代码: string;
  调用行号: number;
  调用代码: string;
  API功能描述: string;

  __apiKey?: string;
  __module?: string;
};

export type SourceRecord = {
  App源码文件路径: string;
  行号: number;
  函数名称: string;
  描述: string;
};

export type AnalyzeRequest = {
  appPath?: string;
  sdkPath?: string;
  csvDir?: string;
  maxDataflowPaths?: number;
  llmProvider?: string;
  llmApiKey?: string;
  llmModel?: string;
  uiLlmProvider?: string;
  uiLlmApiKey?: string;
  uiLlmModel?: string;
  privacyReportLlmProvider?: string;
  privacyReportLlmApiKey?: string;
  privacyReportLlmModel?: string;
  repoRoot: string;
};

export type AnalyzeResponse = {
  runId: string;
  outputDir: string;
  counts: {
    filesScanned: number;
    sinks: number;
    sources: number;
  };
};

export type ImportBindingKind = 'default' | 'named' | 'namespace';

export type ImportBinding = {
  module: string;
  importKind: ImportBindingKind;
  importedName: string; // "default" | "*" | exported name
  localName: string;
  importLine: number;
  importCode: string;
};

export type ResolvedBinding = ImportBinding & {
  resolvedFromKit?: string;
};
