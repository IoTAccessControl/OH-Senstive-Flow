import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildSdkModuleIndex } from '../analyzer/extract/sdk.js';
import { scanAppArkTsFiles } from '../analyzer/extract/app.js';
import { analyzeSinks } from '../analyzer/extract/sinks.js';
import { analyzeSources } from '../analyzer/extract/sources.js';
import { loadCsvApiDescriptions, loadCsvApiPermissions, loadOverrideDescriptions } from '../analyzer/extract/csv.js';
import { buildCallGraph } from '../analyzer/callgraph/build.js';
import { extractPaths } from '../analyzer/dataflow/paths.js';
import { buildDataflows } from '../analyzer/dataflow/build.js';
import { buildUiTree } from '../analyzer/feature/ui.js';
import { groupDataflowsByPageFeature } from '../analyzer/feature/group.js';
import { generatePrivacyReportArtifacts } from '../analyzer/privacy/report.js';
import {
  assertReadableDirectory,
  ensureDir,
  ensureTrailingSlash,
  readJsonFile,
  resolveWorkspacePath,
  writeCsvFile,
  writeJsonFile,
} from '../utils/accessWorkspace.js';

export type AnalyzeRequest = {
  appPath?: string;
  sdkPath?: string;
  csvDir?: string;
  maxDataflowPaths?: number | null;
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

export type AnalyzeProgress = {
  stage: string;
  percent: number;
};

export type RunAnalysisOptions = {
  onProgress?: (p: AnalyzeProgress) => void;
};

export type RunRegistryEntry = {
  runId: string;
  outputDir: string;
};

export type ReadResultJsonArgs = {
  repoRoot: string;
  outputDir?: string;
  runId?: string;
  pathSegments: string[];
};

export type PermissionSetEvaluation = {
  counts: {
    gt: number;
    pred: number;
    tp: number;
    fp: number;
    fn: number;
  };
  recall: number;
  falsePositiveRate: number;
  missing: string[];
  extra: string[];
};

export const DEFAULT_APP_PATH = 'input/app/Wechat_HarmonyOS/';
export const DEFAULT_SDK_PATH = 'input/sdk/default/openharmony/ets/';
export const DEFAULT_CSV_DIR = 'input/csv/';

const ANALYZE_STAGES = [
  '校验输入路径',
  '准备输出目录',
  '构建 SDK 索引',
  '扫描 App ArkTS 文件',
  '加载 CSV 补充描述',
  '分析 sinks',
  '分析 sources',
  '构建调用图',
  '生成数据流（LLM）',
  '生成 UI 树（启发式/LLM）',
  '页面/功能点聚合',
  '写入结果文件',
  '生成隐私声明报告（LLM）',
  '写入 runId 注册表',
  '完成',
] as const;

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

function registryDir(repoRoot: string): string {
  return path.join(repoRoot, 'output', '_runs');
}

function asFsErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
}

function extractPermissionNamesFromText(text: string): string[] {
  const matches = text.match(/ohos\.permission\.[A-Z0-9_]+/gu) ?? [];
  return [...new Set(matches.map((item) => item.trim()).filter(Boolean))].sort();
}

export async function listRunRegistry(repoRoot: string): Promise<RunRegistryEntry[]> {
  const dir = registryDir(repoRoot);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (asFsErrorCode(error) === 'ENOENT') return [];
    throw error;
  }

  const items: Array<{ entry: RunRegistryEntry; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'latest.json') continue;
    const filePath = path.join(dir, name);
    try {
      const [text, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const parsed = JSON.parse(text) as Partial<RunRegistryEntry>;
      const runId =
        typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId.trim() : name.slice(0, -'.json'.length);
      const outputDir = typeof parsed.outputDir === 'string' ? parsed.outputDir : '';
      items.push({ entry: { runId, outputDir }, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore broken registry entries
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map((item) => item.entry);
}

export async function writeRunRegistry(repoRoot: string, entry: RunRegistryEntry): Promise<void> {
  const dir = registryDir(repoRoot);
  await ensureDir(dir);
  await writeJsonFile(path.join(dir, `${entry.runId}.json`), entry);
  await writeJsonFile(path.join(dir, 'latest.json'), entry);
}

export async function resolveRunIdToOutputDir(repoRoot: string, runId?: string): Promise<string> {
  if (!runId) {
    const latestPath = path.join(registryDir(repoRoot), 'latest.json');
    const text = await fs.readFile(latestPath, 'utf8');
    const latest = JSON.parse(text) as RunRegistryEntry;
    return path.resolve(repoRoot, latest.outputDir);
  }

  const filePath = path.join(registryDir(repoRoot), `${runId}.json`);
  const text = await fs.readFile(filePath, 'utf8');
  const entry = JSON.parse(text) as RunRegistryEntry;
  return path.resolve(repoRoot, entry.outputDir);
}

export async function resolveResultOutputDir(args: { repoRoot: string; outputDir?: string; runId?: string }): Promise<string> {
  if (typeof args.outputDir === 'string' && args.outputDir.trim()) return path.resolve(args.repoRoot, args.outputDir);
  return resolveRunIdToOutputDir(args.repoRoot, args.runId);
}

export async function readResultJson(args: ReadResultJsonArgs): Promise<unknown> {
  const outputDir = await resolveResultOutputDir(args);
  return readJsonFile(path.join(outputDir, ...args.pathSegments));
}

export function evaluatePermissionSets(gt: Set<string>, pred: Set<string>): PermissionSetEvaluation {
  const missing = [...gt].filter((item) => !pred.has(item)).sort();
  const extra = [...pred].filter((item) => !gt.has(item)).sort();
  const tp = gt.size - missing.length;
  const fp = extra.length;
  const fn = missing.length;
  const recall = gt.size === 0 ? 1 : tp / gt.size;
  const falsePositiveRate = pred.size === 0 ? 0 : fp / pred.size;

  return {
    counts: { gt: gt.size, pred: pred.size, tp, fp, fn },
    recall,
    falsePositiveRate,
    missing,
    extra,
  };
}

export async function collectPredictedPermissionsFromRun(runDirAbs: string): Promise<Set<string>> {
  const predicted = new Set<string>();

  let files: string[] = [];
  try {
    files = await fs.readdir(path.join(runDirAbs, 'pages'));
  } catch {
    files = [];
  }

  const privacyFactsPaths: string[] = [];
  for (const pageId of files) {
    const featuresRoot = path.join(runDirAbs, 'pages', pageId, 'features');
    let featureIds: string[] = [];
    try {
      featureIds = await fs.readdir(featuresRoot);
    } catch {
      featureIds = [];
    }
    for (const featureId of featureIds) {
      privacyFactsPaths.push(path.join(featuresRoot, featureId, 'privacy_facts.json'));
    }
  }

  privacyFactsPaths.push(path.join(runDirAbs, 'app_permissions', 'privacy_facts.json'));

  for (const filePath of privacyFactsPaths) {
    try {
      const parsed = (await readJsonFile(filePath)) as {
        facts?: { permissionPractices?: Array<{ permissionName?: string }> };
      };
      const items = parsed?.facts?.permissionPractices ?? [];
      for (const item of items) {
        const value = typeof item.permissionName === 'string' ? item.permissionName : '';
        for (const permissionName of extractPermissionNamesFromText(value)) predicted.add(permissionName);
      }
    } catch {
      // ignore missing or invalid privacy facts
    }
  }

  return predicted;
}

export async function runAnalysis(req: AnalyzeRequest, options: RunAnalysisOptions = {}): Promise<AnalyzeResponse> {
  const report = (stageIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(ANALYZE_STAGES.length - 1, Math.floor(stageIndex)));
    const stage = ANALYZE_STAGES[clampedIndex] ?? '分析中';
    const denom = Math.max(1, ANALYZE_STAGES.length - 1);
    const percent = Math.round((clampedIndex / denom) * 100);
    options.onProgress?.({ stage, percent });
  };

  const repoRoot = req.repoRoot;
  const appPath = ensureTrailingSlash(req.appPath ?? DEFAULT_APP_PATH);
  const sdkPath = ensureTrailingSlash(req.sdkPath ?? DEFAULT_SDK_PATH);
  const csvDir = ensureTrailingSlash(req.csvDir ?? DEFAULT_CSV_DIR);
  const maxDataflowPaths = Number.isFinite(req.maxDataflowPaths)
    ? Math.max(1, Math.floor(req.maxDataflowPaths as number))
    : null;
  const llmProvider = typeof req.llmProvider === 'string' && req.llmProvider.trim() ? req.llmProvider.trim() : 'Qwen';
  const llmModel = typeof req.llmModel === 'string' && req.llmModel.trim() ? req.llmModel.trim() : 'qwen3.5-397b-a17b';
  const llmApiKey = typeof req.llmApiKey === 'string' ? req.llmApiKey : '';
  const uiLlmProvider = typeof req.uiLlmProvider === 'string' && req.uiLlmProvider.trim() ? req.uiLlmProvider.trim() : 'Qwen';
  const uiLlmModel = typeof req.uiLlmModel === 'string' && req.uiLlmModel.trim() ? req.uiLlmModel.trim() : 'qwen3.5-27b';
  const uiLlmApiKey = typeof req.uiLlmApiKey === 'string' ? req.uiLlmApiKey : '';
  const privacyReportLlmProvider =
    typeof req.privacyReportLlmProvider === 'string' && req.privacyReportLlmProvider.trim()
      ? req.privacyReportLlmProvider.trim()
      : 'Qwen';
  const privacyReportLlmModel =
    typeof req.privacyReportLlmModel === 'string' && req.privacyReportLlmModel.trim() ? req.privacyReportLlmModel.trim() : 'qwen3.5-27b';
  const privacyReportLlmApiKey = typeof req.privacyReportLlmApiKey === 'string' ? req.privacyReportLlmApiKey : '';

  report(0);

  const appAbs = resolveWorkspacePath(repoRoot, appPath);
  const sdkAbs = resolveWorkspacePath(repoRoot, sdkPath);
  const csvAbs = resolveWorkspacePath(repoRoot, csvDir);

  await assertReadableDirectory(appAbs, 'App源码路径');
  await assertReadableDirectory(sdkAbs, 'OpenHarmony SDK源码路径');
  await assertReadableDirectory(csvAbs, 'SDK API补充信息csv路径');

  report(1);

  const appName = inferAppName(appAbs);
  const timestamp = formatTimestampForDir(new Date());
  const runId = `${appName}_${timestamp}`;
  const outputDirRel = path.join('output', appName, timestamp);
  const outputDirAbs = path.join(repoRoot, outputDirRel);
  await ensureDir(outputDirAbs);

  report(2);

  const sdkIndex = await buildSdkModuleIndex(sdkAbs);
  report(3);
  const appFiles = await scanAppArkTsFiles(appAbs);

  report(4);

  const csvDescriptions = await loadCsvApiDescriptions(csvAbs);
  const csvPermissions = await loadCsvApiPermissions(csvAbs);
  const overrideDescriptions = await loadOverrideDescriptions(csvAbs);

  report(5);

  const sinks = await analyzeSinks({
    repoRoot,
    appFiles,
    sdkIndex,
    csvDescriptions,
    csvPermissions,
    overrideDescriptions,
  });

  report(6);

  const sources = await analyzeSources(repoRoot, appFiles);

  report(7);

  const callGraph = await buildCallGraph({
    repoRoot,
    runId,
    appFiles,
    sinks,
    sources,
    llm: { provider: llmProvider, apiKey: llmApiKey, model: llmModel },
  });
  const paths = extractPaths({ callGraph, maxPaths: maxDataflowPaths });

  report(8);

  const dataflows = await (async () => {
    try {
      return await buildDataflows({
        repoRoot,
        runId,
        appFiles,
        callGraph,
        paths,
        sinks,
        sources,
        llm: { provider: llmProvider, apiKey: llmApiKey, model: llmModel },
        contextRadiusLines: 5,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        meta: {
          runId,
          generatedAt: new Date().toISOString(),
          skipped: true,
          skipReason: `LLM 数据流分析失败：${message}`,
          llm: { provider: llmProvider, model: llmModel },
          counts: { flows: 0, nodes: 0, edges: 0 },
        },
        flows: [],
      };
    }
  })();

  report(9);

  const uiTree = await buildUiTree({
    repoRoot,
    runId,
    appRootAbs: appAbs,
    appFiles,
    llm: { provider: uiLlmProvider, apiKey: uiLlmApiKey, model: uiLlmModel },
    contextRadiusLines: 5,
    maxNodesPerLlmBatch: 15,
  });

  report(10);

  const groupedPages = await groupDataflowsByPageFeature({ runId, repoRoot, uiTree, sources, dataflows });

  report(11);

  await writeJsonFile(path.join(outputDirAbs, 'meta.json'), {
    runId,
    input: {
      appPath,
      sdkPath,
      csvDir,
      maxDataflowPaths,
      llmProvider,
      llmModel,
      uiLlmProvider,
      uiLlmModel,
      privacyReportLlmProvider,
      privacyReportLlmModel,
    },
    scan: { appFiles: appFiles.length },
    counts: {
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
    },
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

  report(12);

  await generatePrivacyReportArtifacts({
    repoRoot,
    runId,
    appName,
    outputDirAbs,
    llm: { provider: privacyReportLlmProvider, apiKey: privacyReportLlmApiKey, model: privacyReportLlmModel },
  });

  report(13);

  await writeRunRegistry(repoRoot, { runId, outputDir: outputDirRel });

  report(14);

  return {
    runId,
    outputDir: outputDirRel.replaceAll(path.sep, '/'),
    counts: {
      filesScanned: appFiles.length,
      sinks: sinks.length,
      sources: sources.length,
    },
  };
}

type DirectRunArgs = Partial<AnalyzeRequest> & {
  help?: boolean;
};

function usage(): string {
  return [
    'Run one app analysis end-to-end.',
    '',
    'Usage:',
    '  node --import tsx server/src/app/run.ts --appPath input/app/Test_user_info/ [--sdkPath ...] [--csvDir ...]',
    '',
    'Options:',
    '  --repoRoot <path>',
    '  --appPath <path>',
    '  --sdkPath <path>',
    '  --csvDir <path>',
    '  --maxDataflowPaths <n>',
    '  --llmProvider <name>',
    '  --llmApiKey <key>',
    '  --llmModel <name>',
    '  --uiLlmProvider <name>',
    '  --uiLlmApiKey <key>',
    '  --uiLlmModel <name>',
    '  --privacyReportLlmProvider <name>',
    '  --privacyReportLlmApiKey <key>',
    '  --privacyReportLlmModel <name>',
    '  -h, --help',
    '',
  ].join('\n');
}

function parseDirectRunArgs(argv: string[]): DirectRunArgs {
  const out: DirectRunArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? '';
    if (raw === '-h' || raw === '--help') {
      out.help = true;
      continue;
    }
    if (!raw.startsWith('--')) throw new Error(`Unknown arg: ${raw}`);

    const eq = raw.indexOf('=');
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const value = eq > 0 ? raw.slice(eq + 1) : (argv[i + 1] ?? '');
    if (eq <= 0) i += 1;
    if (!value) throw new Error(`Missing value for ${key}`);

    if (key === '--repoRoot') out.repoRoot = value;
    else if (key === '--appPath') out.appPath = value;
    else if (key === '--sdkPath') out.sdkPath = value;
    else if (key === '--csvDir') out.csvDir = value;
    else if (key === '--maxDataflowPaths') out.maxDataflowPaths = Number(value);
    else if (key === '--llmProvider') out.llmProvider = value;
    else if (key === '--llmApiKey') out.llmApiKey = value;
    else if (key === '--llmModel') out.llmModel = value;
    else if (key === '--uiLlmProvider') out.uiLlmProvider = value;
    else if (key === '--uiLlmApiKey') out.uiLlmApiKey = value;
    else if (key === '--uiLlmModel') out.uiLlmModel = value;
    else if (key === '--privacyReportLlmProvider') out.privacyReportLlmProvider = value;
    else if (key === '--privacyReportLlmApiKey') out.privacyReportLlmApiKey = value;
    else if (key === '--privacyReportLlmModel') out.privacyReportLlmModel = value;
    else throw new Error(`Unknown option: ${key}`);
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseDirectRunArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(path.dirname(thisFile), '..', '..', '..');
  const result = await runAnalysis({
    repoRoot,
    appPath: args.appPath,
    sdkPath: args.sdkPath,
    csvDir: args.csvDir,
    maxDataflowPaths: args.maxDataflowPaths,
    llmProvider: args.llmProvider,
    llmApiKey: args.llmApiKey,
    llmModel: args.llmModel,
    uiLlmProvider: args.uiLlmProvider,
    uiLlmApiKey: args.uiLlmApiKey,
    uiLlmModel: args.uiLlmModel,
    privacyReportLlmProvider: args.privacyReportLlmProvider,
    privacyReportLlmApiKey: args.privacyReportLlmApiKey,
    privacyReportLlmModel: args.privacyReportLlmModel,
  });

  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
}

const isDirectRun = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;

if (isDirectRun) {
  void main().catch((error) => {
    process.stderr.write(`${String((error as Error)?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
