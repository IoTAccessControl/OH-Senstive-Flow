import path from 'node:path';

import { buildCallGraph } from './callgraph/build.js';
import type { CallGraph } from './callgraph/types.js';
import { buildCallGraphAndPathsFromCpg } from './cpg/pipeline.js';
import { buildDataflows } from './dataflow/build.js';
import { extractPathsWithStats } from './dataflow/paths.js';
import type { DataflowsResult } from './dataflow/types.js';
import { scanAppArkTsFiles } from './extract/app.js';
import { loadCsvApiDescriptions, loadCsvApiPermissions, loadOverrideDescriptions } from './extract/csv.js';
import { analyzeSinks } from './extract/sinks.js';
import { analyzeSources } from './extract/sources.js';
import { buildSdkModuleIndex } from './extract/sdk.js';
import type { SinkRecord, SourceRecord } from './extract/types.js';
import { groupDataflowsByPageFeature, type GroupedPageFeatures } from './feature/group.js';
import type { UiTreeResult } from './feature/types.js';
import { buildUiTree } from './feature/ui.js';
import { generatePrivacyReportArtifacts } from './privacy/report.js';
import { DefaultLlmUsageCollector, withLlmUsageCollector, type LlmUsageStats } from '../llm/client.js';
import {
  assertReadableDirectory,
  ensureDir,
  ensureTrailingSlash,
  resolveWorkspacePath,
  writeCsvFile,
  writeJsonFile,
} from '../utils/accessWorkspace.js';

type LlmConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

type AnalyzePipelineRequest = {
  repoRoot: string;
  runId: string;
  appRootAbs: string;
  sdkRootAbs: string;
  csvDirAbs: string;
  outputDirAbs: string;
  maxDataflowPaths: number | null;
  graphBackend: GraphBackend;
  llm: LlmConfig;
  uiLlm: LlmConfig;
};

export type AnalysisTimingStages = {
  scan: number;
  sourceSink: number;
  callgraph: number;
  cpgGenerate: number;
  cpgParse: number;
  dataflow: number;
  ui: number;
  report: number;
};

export type AnalysisTimingLlm = LlmUsageStats;

export type AnalysisTimingTruncation = {
  pathBranches: number;
  depthBranches: number;
};

export type AnalysisTiming = {
  totalMs: number;
  stages: AnalysisTimingStages;
  llm: AnalysisTimingLlm;
  truncation: AnalysisTimingTruncation;
};

export type MetaJson = {
  runId: string;
  input: {
    appPath: string;
    sdkPath: string;
    csvDir: string;
    maxDataflowPaths: number | null;
    graphBackend: GraphBackend;
    llmProvider: string;
    llmModel: string;
    uiLlmProvider: string;
    uiLlmModel: string;
    privacyReportLlmProvider: string;
    privacyReportLlmModel: string;
  };
  scan: {
    appFiles: number;
  };
  counts: {
    sinks: number;
    sources: number;
    callGraphNodes: number;
    callGraphEdges: number;
    dataflows: number;
    dataflowNodes: number;
    dataflowEdges: number;
    dataflowFailedPaths: number;
    dataflowFallbackFlows: number;
    dataflowSkipped: boolean;
    uiTreeNodes: number;
    uiTreeEdges: number;
    pageCount: number;
    pageFeatureCount: number;
    pageFeatureUnassignedFlows: number;
  };
  timing?: AnalysisTiming;
};

type AnalyzeArtifacts = {
  appFiles: string[];
  sinks: SinkRecord[];
  sources: SourceRecord[];
  callGraph: CallGraph;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult;
  groupedPages: GroupedPageFeatures;
  stages: Omit<AnalysisTimingStages, 'report'>;
  truncation: AnalysisTimingTruncation;
};

export type AnalyzeRequest = {
  appPath?: string;
  sdkPath?: string;
  csvDir?: string;
  maxDataflowPaths?: number | null;
  llmConcurrency?: number;
  graphBackend?: GraphBackend;
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
  timing?: AnalysisTiming;
};

export type AnalyzeProgress = {
  stage: string;
  percent: number;
};

export type RunAnalysisOptions = {
  onProgress?: (p: AnalyzeProgress) => void;
};

export type GraphBackend = 'heuristic' | 'cpg';

export const DEFAULT_APP_PATH = 'input/app/Wechat_HarmonyOS/';
export const DEFAULT_SDK_PATH = 'input/sdk/default/openharmony/ets/';
export const DEFAULT_CSV_DIR = 'input/csv/';

const ANALYZE_PIPELINE_STAGES = [
  '构建 SDK 索引',
  '扫描 App ArkTS 文件',
  '加载 CSV 补充描述',
  '分析 sinks',
  '分析 sources',
  '构建调用图',
  '生成数据流（LLM）',
  '生成 UI 树（启发式/LLM）',
  '页面/功能点聚合',
] as const;

const RUN_ANALYSIS_STAGES = [
  '校验输入路径',
  '准备输出目录',
  ...ANALYZE_PIPELINE_STAGES,
  '写入结果文件',
  '生成隐私声明报告（LLM）',
  '写入 runId 注册表',
  '完成',
] as const;

const RUN_ANALYSIS_STAGE_TO_INDEX = new Map<string, number>(RUN_ANALYSIS_STAGES.map((stage, index) => [stage, index] as const));

function emitProgress(stages: readonly string[], stageIndex: number, onProgress?: (p: AnalyzeProgress) => void): void {
  if (!onProgress) return;
  const clampedIndex = Math.max(0, Math.min(stages.length - 1, Math.floor(stageIndex)));
  const stage = stages[clampedIndex] ?? '分析中';
  const denom = Math.max(1, stages.length - 1);
  const percent = Math.round((clampedIndex / denom) * 100);
  onProgress({ stage, percent });
}

function pickNonEmptyText(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeGraphBackend(value: unknown): GraphBackend {
  return value === 'cpg' ? 'cpg' : 'heuristic';
}

function formatTimestampForDir(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const min = `${date.getMinutes()}`.padStart(2, '0');
  const ss = `${date.getSeconds()}`.padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function inferAppName(appPath: string): string {
  const normalized = appPath.replace(/[\\\/]+$/u, '');
  const base = path.basename(normalized);
  return base || 'app';
}

async function analyzeProject(req: AnalyzePipelineRequest, options: RunAnalysisOptions = {}): Promise<AnalyzeArtifacts> {
  const scanStart = Date.now();
  emitProgress(ANALYZE_PIPELINE_STAGES, 0, options.onProgress);

  const sdkIndex = await buildSdkModuleIndex(req.sdkRootAbs);

  emitProgress(ANALYZE_PIPELINE_STAGES, 1, options.onProgress);

  const appFiles = await scanAppArkTsFiles(req.appRootAbs);

  emitProgress(ANALYZE_PIPELINE_STAGES, 2, options.onProgress);

  const csvDescriptions = await loadCsvApiDescriptions(req.csvDirAbs);
  const csvPermissions = await loadCsvApiPermissions(req.csvDirAbs);
  const overrideDescriptions = await loadOverrideDescriptions(req.csvDirAbs);
  const scanMs = Math.max(0, Date.now() - scanStart);

  emitProgress(ANALYZE_PIPELINE_STAGES, 3, options.onProgress);

  const sourceSinkStart = Date.now();
  const sinks = await analyzeSinks({
    repoRoot: req.repoRoot,
    appFiles,
    sdkIndex,
    csvDescriptions,
    csvPermissions,
    overrideDescriptions,
  });

  emitProgress(ANALYZE_PIPELINE_STAGES, 4, options.onProgress);

  const sources = await analyzeSources(req.repoRoot, appFiles);
  const sourceSinkMs = Math.max(0, Date.now() - sourceSinkStart);

  emitProgress(ANALYZE_PIPELINE_STAGES, 5, options.onProgress);

  let callgraphMs = 0;
  let cpgGenerateMs = 0;
  let cpgParseMs = 0;
  let truncation: AnalysisTimingTruncation = { pathBranches: 0, depthBranches: 0 };

  const { callGraph, paths } = await (async () => {
    if (req.graphBackend === 'cpg') {
      const cpgResult = await buildCallGraphAndPathsFromCpg({
        repoRoot: req.repoRoot,
        runId: req.runId,
        appRootAbs: req.appRootAbs,
        appFiles,
        sinks,
        sources,
        maxPaths: req.maxDataflowPaths,
        outputDirAbs: req.outputDirAbs,
      });
      cpgGenerateMs = cpgResult.cpgGenerateMs;
      cpgParseMs = cpgResult.cpgParseMs;
      callgraphMs = cpgResult.callgraphMs;
      truncation = cpgResult.truncation;
      return { callGraph: cpgResult.callGraph, paths: cpgResult.paths };
    }

    const cgStart = Date.now();
    const callGraph = await buildCallGraph({
      repoRoot: req.repoRoot,
      runId: req.runId,
      appFiles,
      sinks,
      sources,
      llm: req.llm,
    });
    const pathResult = extractPathsWithStats({ callGraph, maxPaths: req.maxDataflowPaths });
    callgraphMs = Math.max(0, Date.now() - cgStart);
    truncation = pathResult.truncation;
    return { callGraph, paths: pathResult.paths };
  })();

  emitProgress(ANALYZE_PIPELINE_STAGES, 6, options.onProgress);

  const dataflowStart = Date.now();
  const dataflows = await (async () => {
    try {
      return await buildDataflows({
        repoRoot: req.repoRoot,
        runId: req.runId,
        appFiles,
        callGraph,
        paths,
        sinks,
        sources,
        llm: req.llm,
        contextRadiusLines: 5,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        meta: {
          runId: req.runId,
          generatedAt: new Date().toISOString(),
          skipped: true,
          skipReason: `LLM 数据流分析失败：${message}`,
          llm: { provider: req.llm.provider, model: req.llm.model },
          counts: { flows: 0, nodes: 0, edges: 0 },
        },
        flows: [],
      };
    }
  })();
  const dataflowMs = Math.max(0, Date.now() - dataflowStart);

  emitProgress(ANALYZE_PIPELINE_STAGES, 7, options.onProgress);

  const uiStart = Date.now();
  const uiTree = await buildUiTree({
    repoRoot: req.repoRoot,
    runId: req.runId,
    appRootAbs: req.appRootAbs,
    appFiles,
    llm: req.uiLlm,
    contextRadiusLines: 5,
    maxNodesPerLlmBatch: 15,
  });

  emitProgress(ANALYZE_PIPELINE_STAGES, 8, options.onProgress);

  const groupedPages = await groupDataflowsByPageFeature({
    runId: req.runId,
    repoRoot: req.repoRoot,
    uiTree,
    sources,
    dataflows,
  });
  const uiMs = Math.max(0, Date.now() - uiStart);

  return {
    appFiles,
    sinks,
    sources,
    callGraph,
    dataflows,
    uiTree,
    groupedPages,
    stages: {
      scan: scanMs,
      sourceSink: sourceSinkMs,
      callgraph: callgraphMs,
      cpgGenerate: cpgGenerateMs,
      cpgParse: cpgParseMs,
      dataflow: dataflowMs,
      ui: uiMs,
    },
    truncation,
  };
}

export async function runAnalysis(req: AnalyzeRequest, options: RunAnalysisOptions = {}): Promise<AnalyzeResponse> {
  const collector = new DefaultLlmUsageCollector();
  return withLlmUsageCollector(collector, async () => {
    const overallStartTime = Date.now();
    emitProgress(RUN_ANALYSIS_STAGES, 0, options.onProgress);

    const repoRoot = req.repoRoot;
    const appPath = ensureTrailingSlash(req.appPath ?? DEFAULT_APP_PATH);
    const sdkPath = ensureTrailingSlash(req.sdkPath ?? DEFAULT_SDK_PATH);
    const csvDir = ensureTrailingSlash(req.csvDir ?? DEFAULT_CSV_DIR);
    const maxDataflowPaths = Number.isFinite(req.maxDataflowPaths)
      ? Math.max(1, Math.floor(req.maxDataflowPaths as number))
      : null;
    const graphBackend = normalizeGraphBackend(req.graphBackend);

    // Set LLM concurrency from request or environment variable
    if (req.llmConcurrency != null && Number.isFinite(req.llmConcurrency) && req.llmConcurrency > 0) {
      process.env.LLM_REQUEST_CONCURRENT = String(Math.max(1, Math.min(20, Math.floor(req.llmConcurrency))));
    }

    const llmProvider = pickNonEmptyText(req.llmProvider, process.env.LLM_PROVIDER) ?? 'Qwen';
    const llmModel = pickNonEmptyText(req.llmModel, process.env.LLM_MODEL) ?? 'qwen3.5-397b-a17b';
    const llmApiKey = pickNonEmptyText(req.llmApiKey, process.env.LLM_API_KEY) ?? '';
    const llmBaseUrl = pickNonEmptyText(process.env.LLM_BASE_URL);
    const uiLlmProvider = pickNonEmptyText(req.uiLlmProvider, process.env.UI_LLM_PROVIDER, process.env.LLM_PROVIDER) ?? 'Qwen';
    const uiLlmModel = pickNonEmptyText(req.uiLlmModel, process.env.UI_LLM_MODEL, process.env.LLM_MODEL) ?? 'qwen3.5-27b';
    const uiLlmApiKey = pickNonEmptyText(req.uiLlmApiKey, process.env.UI_LLM_API_KEY, process.env.LLM_API_KEY) ?? '';
    const uiLlmBaseUrl = pickNonEmptyText(process.env.UI_LLM_BASE_URL);
    const privacyReportLlmProvider =
      pickNonEmptyText(req.privacyReportLlmProvider, process.env.PRIVACY_REPORT_LLM_PROVIDER, process.env.LLM_PROVIDER) ?? 'Qwen';
    const privacyReportLlmModel =
      pickNonEmptyText(req.privacyReportLlmModel, process.env.PRIVACY_REPORT_LLM_MODEL, process.env.LLM_MODEL) ?? 'qwen3.5-27b';
    const privacyReportLlmApiKey =
      pickNonEmptyText(req.privacyReportLlmApiKey, process.env.PRIVACY_REPORT_LLM_API_KEY, process.env.LLM_API_KEY) ?? '';
    const privacyReportLlmBaseUrl = pickNonEmptyText(process.env.PRIVACY_REPORT_LLM_BASE_URL);

    const appAbs = resolveWorkspacePath(repoRoot, appPath);
    const sdkAbs = resolveWorkspacePath(repoRoot, sdkPath);
    const csvAbs = resolveWorkspacePath(repoRoot, csvDir);

    await assertReadableDirectory(appAbs, 'App源码路径');
    await assertReadableDirectory(sdkAbs, 'OpenHarmony SDK源码路径');
    await assertReadableDirectory(csvAbs, 'SDK API补充信息csv路径');

    emitProgress(RUN_ANALYSIS_STAGES, 1, options.onProgress);

    const appName = inferAppName(appAbs);
    const timestamp = formatTimestampForDir(new Date());
    const runId = `${appName}_${timestamp}`;
    const outputDirRel = path.join('output', appName, timestamp);
    const outputDirAbs = path.join(repoRoot, outputDirRel);
    await ensureDir(outputDirAbs);

    const analysisRequest: AnalyzePipelineRequest = {
      repoRoot,
      runId,
      appRootAbs: appAbs,
      sdkRootAbs: sdkAbs,
      csvDirAbs: csvAbs,
      outputDirAbs,
      maxDataflowPaths,
      graphBackend,
      llm: { provider: llmProvider, apiKey: llmApiKey, model: llmModel, baseUrl: llmBaseUrl },
      uiLlm: { provider: uiLlmProvider, apiKey: uiLlmApiKey, model: uiLlmModel, baseUrl: uiLlmBaseUrl },
    };

    const { appFiles, sinks, sources, callGraph, dataflows, uiTree, groupedPages, stages, truncation } = await analyzeProject(analysisRequest, {
      onProgress: (progress) => {
        const stageIndex = RUN_ANALYSIS_STAGE_TO_INDEX.get(progress.stage);
        if (stageIndex === undefined) return;
        emitProgress(RUN_ANALYSIS_STAGES, stageIndex, options.onProgress);
      },
    });

    emitProgress(RUN_ANALYSIS_STAGES, 11, options.onProgress);

    const metaInput = {
      appPath,
      sdkPath,
      csvDir,
      maxDataflowPaths,
      graphBackend,
      llmProvider,
      llmModel,
      uiLlmProvider,
      uiLlmModel,
      privacyReportLlmProvider,
      privacyReportLlmModel,
    };

    const metaCounts = {
      sinks: sinks.length,
      sources: sources.length,
      callGraphNodes: callGraph.meta.counts.nodes,
      callGraphEdges: callGraph.meta.counts.edges,
      dataflows: dataflows.meta.counts.flows,
      dataflowNodes: dataflows.meta.counts.nodes,
      dataflowEdges: dataflows.meta.counts.edges,
      dataflowFailedPaths: dataflows.meta.counts.failedPaths ?? 0,
      dataflowFallbackFlows: dataflows.meta.counts.fallbackFlows ?? 0,
      dataflowSkipped: Boolean(dataflows.meta.skipped),
      uiTreeNodes: uiTree.meta.counts.nodes,
      uiTreeEdges: uiTree.meta.counts.edges,
      pageCount: groupedPages.pagesIndex.meta.counts.pages,
      pageFeatureCount: groupedPages.pagesIndex.meta.counts.features,
      pageFeatureUnassignedFlows: groupedPages.pagesIndex.meta.counts.unassignedFlows,
    };

    const initialTiming: AnalysisTiming = {
      totalMs: Math.max(0, Date.now() - overallStartTime),
      stages: {
        ...stages,
        report: 0,
      },
      llm: collector.getStats(),
      truncation,
    };

    await writeJsonFile(path.join(outputDirAbs, 'meta.json'), {
      runId,
      input: metaInput,
      scan: { appFiles: appFiles.length },
      counts: metaCounts,
      timing: initialTiming,
    });

    await writeJsonFile(path.join(outputDirAbs, 'sinks.json'), sinks);
    await writeCsvFile(
      path.join(outputDirAbs, 'sinks.csv'),
      ['App源码文件路径', '导入行号', '导入代码', '调用行号', '调用代码', 'API功能描述'],
      sinks,
    );

    await writeJsonFile(path.join(outputDirAbs, 'sources.json'), sources);
    await writeCsvFile(path.join(outputDirAbs, 'sources.csv'), ['App源码文件路径', '行号', '函数名称', '描述'], sources);

    await writeJsonFile(path.join(outputDirAbs, 'callgraph.json'), callGraph);
    await writeJsonFile(path.join(outputDirAbs, 'dataflows.json'), dataflows);
    await writeJsonFile(path.join(outputDirAbs, 'ui_tree.json'), uiTree);

    const pagesRootAbs = path.join(outputDirAbs, 'pages');
    await ensureDir(pagesRootAbs);
    await writeJsonFile(path.join(pagesRootAbs, 'index.json'), groupedPages.pagesIndex);

    for (const p of groupedPages.pages) {
      const pageDirAbs = path.join(pagesRootAbs, p.page.pageId);
      await ensureDir(pageDirAbs);
      if (p.uiTree) await writeJsonFile(path.join(pageDirAbs, 'ui_tree.json'), p.uiTree);

      const featuresRootAbs = path.join(pageDirAbs, 'features');
      await ensureDir(featuresRootAbs);
      await writeJsonFile(path.join(featuresRootAbs, 'index.json'), p.featuresIndex);

      for (const f of p.features) {
        const featureDirAbs = path.join(featuresRootAbs, f.feature.featureId);
        await ensureDir(featureDirAbs);
        await writeJsonFile(path.join(featureDirAbs, 'dataflows.json'), f.dataflows);
      }
    }

    emitProgress(RUN_ANALYSIS_STAGES, 12, options.onProgress);

    let reportMs = 0;
    const reportStartTime = Date.now();
    try {
      await generatePrivacyReportArtifacts({
        repoRoot,
        runId,
        appName,
        outputDirAbs,
        llm: {
          provider: privacyReportLlmProvider,
          apiKey: privacyReportLlmApiKey,
          model: privacyReportLlmModel,
          baseUrl: privacyReportLlmBaseUrl,
        },
      });
      reportMs = Math.max(0, Date.now() - reportStartTime);
    } finally {
      reportMs = Math.max(0, Date.now() - reportStartTime);
      const finalTiming: AnalysisTiming = {
        totalMs: Math.max(0, Date.now() - overallStartTime),
        stages: {
          ...stages,
          report: reportMs,
        },
        llm: collector.getStats(),
        truncation,
      };

      const finalMeta: MetaJson = {
        runId,
        input: metaInput,
        scan: { appFiles: appFiles.length },
        counts: metaCounts,
        timing: finalTiming,
      };

      await writeJsonFile(path.join(outputDirAbs, 'meta.json'), finalMeta);
    }

    emitProgress(RUN_ANALYSIS_STAGES, 13, options.onProgress);

    const runRegistryDirAbs = path.join(repoRoot, 'output', '_runs');
    await ensureDir(runRegistryDirAbs);
    await writeJsonFile(path.join(runRegistryDirAbs, `${runId}.json`), { runId, outputDir: outputDirRel });
    await writeJsonFile(path.join(runRegistryDirAbs, 'latest.json'), { runId, outputDir: outputDirRel });

    emitProgress(RUN_ANALYSIS_STAGES, 14, options.onProgress);

    const finalTiming: AnalysisTiming = {
      totalMs: Math.max(0, Date.now() - overallStartTime),
      stages: {
        ...stages,
        report: reportMs,
      },
      llm: collector.getStats(),
      truncation,
    };

    return {
      runId,
      outputDir: outputDirRel.replaceAll(path.sep, '/'),
      counts: {
        filesScanned: appFiles.length,
        sinks: sinks.length,
        sources: sources.length,
      },
      timing: finalTiming,
    };
  });
}
