import fs from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_APP_PATH, DEFAULT_CSV_DIR, DEFAULT_SDK_PATH } from './defaults.js';
import type { AnalyzeRequest, AnalyzeResponse } from './types.js';
import { ensureTrailingSlash } from './pathUtils.js';
import { formatTimestampForDir } from './time.js';
import { buildSdkModuleIndex } from './sdkIndexer.js';
import { scanAppArkTsFiles } from './appScanner.js';
import { analyzeSinks } from './sinkAnalyzer.js';
import { analyzeSources } from './sourceAnalyzer.js';
import { ensureDir, writeCsvFile, writeJsonFile } from './io.js';
import { loadCsvApiDescriptions } from './csvSupplement.js';
import { loadOverrideDescriptions } from './overrideCsv.js';
import { writeRunRegistry } from './runRegistry.js';
import { buildCallGraph } from './callGraph/buildCallGraph.js';
import { extractPaths } from './callGraph/extractPaths.js';
import { buildDataflows } from './dataflow/buildDataflows.js';
import { buildUiTree } from './uiTree/buildUiTree.js';
import { buildModulesFromUiTree, groupDataflowsByModule } from './modules/buildModules.js';
import { generatePrivacyReportArtifacts } from './privacyReport/generatePrivacyReportArtifacts.js';

function toAbs(repoRoot: string, maybeRelativePath: string): string {
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.resolve(repoRoot, maybeRelativePath);
}

function inferAppName(appPath: string): string {
  const normalized = appPath.replace(/[\\\/]+$/u, '');
  const base = path.basename(normalized);
  return base || 'app';
}

async function assertReadableDir(dirPath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) throw new Error(`${label} 不是目录: ${dirPath}`);
  } catch {
    throw new Error(`${label} 不存在或无法访问: ${dirPath}`);
  }
}

export async function runAnalysis(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  const repoRoot = req.repoRoot;
  const appPath = ensureTrailingSlash(req.appPath ?? DEFAULT_APP_PATH);
  const sdkPath = ensureTrailingSlash(req.sdkPath ?? DEFAULT_SDK_PATH);
  const csvDir = ensureTrailingSlash(req.csvDir ?? DEFAULT_CSV_DIR);
  const maxDataflowPaths = Number.isFinite(req.maxDataflowPaths) ? Math.max(1, Math.floor(req.maxDataflowPaths ?? 5)) : 5;
  const llmProvider = typeof req.llmProvider === 'string' && req.llmProvider.trim() ? req.llmProvider.trim() : 'Qwen';
  const llmModel = typeof req.llmModel === 'string' && req.llmModel.trim() ? req.llmModel.trim() : 'qwen3-coder-plus';
  const llmApiKey = typeof req.llmApiKey === 'string' ? req.llmApiKey : '';
  const uiLlmProvider = typeof req.uiLlmProvider === 'string' && req.uiLlmProvider.trim() ? req.uiLlmProvider.trim() : 'Qwen';
  const uiLlmModel = typeof req.uiLlmModel === 'string' && req.uiLlmModel.trim() ? req.uiLlmModel.trim() : 'qwen3-32b';
  const uiLlmApiKey = typeof req.uiLlmApiKey === 'string' ? req.uiLlmApiKey : '';
  const privacyReportLlmProvider =
    typeof req.privacyReportLlmProvider === 'string' && req.privacyReportLlmProvider.trim()
      ? req.privacyReportLlmProvider.trim()
      : 'Qwen';
  const privacyReportLlmModel =
    typeof req.privacyReportLlmModel === 'string' && req.privacyReportLlmModel.trim() ? req.privacyReportLlmModel.trim() : 'qwen3-32b';
  const privacyReportLlmApiKey = typeof req.privacyReportLlmApiKey === 'string' ? req.privacyReportLlmApiKey : '';
  if (!uiLlmApiKey.trim()) {
    throw new Error('UI LLM api-key 不能为空（用于界面树描述生成）');
  }

  const appAbs = toAbs(repoRoot, appPath);
  const sdkAbs = toAbs(repoRoot, sdkPath);
  const csvAbs = toAbs(repoRoot, csvDir);

  await assertReadableDir(appAbs, 'App源码路径');
  await assertReadableDir(sdkAbs, 'OpenHarmony SDK源码路径');
  await assertReadableDir(csvAbs, 'SDK API补充信息csv路径');

  const appName = inferAppName(appAbs);
  const timestamp = formatTimestampForDir(new Date());
  const runId = `${appName}_${timestamp}`;
  const outputDirRel = path.join('output', appName, timestamp);
  const outputDirAbs = path.join(repoRoot, outputDirRel);
  await ensureDir(outputDirAbs);

  const sdkIndex = await buildSdkModuleIndex(sdkAbs);
  const appFiles = await scanAppArkTsFiles(appAbs);

  const csvDescriptions = await loadCsvApiDescriptions(csvAbs);
  const overrideDescriptions = await loadOverrideDescriptions(csvAbs);

  const sinks = await analyzeSinks({
    repoRoot,
    appFiles,
    sdkIndex,
    csvDescriptions,
    overrideDescriptions,
  });

  const sources = await analyzeSources(repoRoot, appFiles);

  const callGraph = await buildCallGraph({
    repoRoot,
    runId,
    appFiles,
    sinks,
    sources,
    llm: { provider: llmProvider, apiKey: llmApiKey, model: llmModel },
  });
  const paths = extractPaths({ callGraph, maxPaths: maxDataflowPaths });
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

  const uiTree = await buildUiTree({
    repoRoot,
    runId,
    appRootAbs: appAbs,
    appFiles,
    llm: { provider: uiLlmProvider, apiKey: uiLlmApiKey, model: uiLlmModel },
    contextRadiusLines: 5,
    maxNodesPerLlmBatch: 15,
  });

  const builtModules = buildModulesFromUiTree({ uiTree, sources, maxDepth: 6 });
  const grouped = groupDataflowsByModule({ runId, dataflows, sources, modules: builtModules });

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
      dataflowSkipped: Boolean(dataflows.meta.skipped),
      uiTreeNodes: uiTree.meta.counts.nodes,
      uiTreeEdges: uiTree.meta.counts.edges,
      uiModules: grouped.index.meta.counts.modules,
      moduleAssignedFlows: grouped.index.meta.counts.assignedFlows,
      moduleUnassignedFlows: grouped.index.meta.counts.unassignedFlows,
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

  const modulesRootAbs = path.join(outputDirAbs, 'modules');
  await ensureDir(modulesRootAbs);
  await writeJsonFile(path.join(modulesRootAbs, 'index.json'), grouped.index);

  for (const m of builtModules) {
    const dirAbs = path.join(modulesRootAbs, m.moduleId);
    await ensureDir(dirAbs);

    const sliceNodeIds = m.nodeIds;
    const sliceNodes: Record<string, unknown> = {};
    for (const id of sliceNodeIds) {
      const n = uiTree.nodes[id];
      if (n) sliceNodes[id] = n;
    }
    const sliceEdges = uiTree.edges.filter((e) => sliceNodeIds.has(e.from) && sliceNodeIds.has(e.to));
    const slicePages = Object.values(sliceNodes).filter((n: any) => n?.category === 'Page').length;
    const sliceElements = Object.values(sliceNodes).filter((n: any) => n?.category !== 'Page').length;
    await writeJsonFile(path.join(dirAbs, 'ui_tree.json'), {
      meta: {
        runId,
        generatedAt: new Date().toISOString(),
        llm: uiTree.meta.llm,
        module: { moduleId: m.moduleId },
        counts: { nodes: Object.keys(sliceNodes).length, edges: sliceEdges.length, pages: slicePages, elements: sliceElements },
      },
      roots: [m.rootId],
      nodes: sliceNodes,
      edges: sliceEdges,
    });

    const df = grouped.moduleDataflows.get(m.moduleId);
    await writeJsonFile(path.join(dirAbs, 'dataflows.json'), df ?? { meta: dataflows.meta, flows: [] });
  }

  if (grouped.unassignedDataflows) {
    const dirAbs = path.join(modulesRootAbs, '_unassigned');
    await ensureDir(dirAbs);
    await writeJsonFile(path.join(dirAbs, 'dataflows.json'), grouped.unassignedDataflows);
  }

  await generatePrivacyReportArtifacts({
    repoRoot,
    runId,
    appName,
    outputDirAbs,
    llm: { provider: privacyReportLlmProvider, apiKey: privacyReportLlmApiKey, model: privacyReportLlmModel },
  });

  await writeRunRegistry(repoRoot, { runId, outputDir: outputDirRel });

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
