import fs from 'node:fs/promises';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../io.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { UiModulesIndex, UiModuleInfo } from '../modules/types.js';
import type { UiTreeResult } from '../uiTree/types.js';

import { extractModulePrivacyFacts } from './extractModulePrivacyFacts.js';
import { buildPrivacyReport, renderPrivacyReportText } from './buildPrivacyReport.js';
import type { ModulePrivacyFactsFile, ModulePrivacyFactsContent, PrivacyReportFile } from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function asModulesIndex(raw: unknown): UiModulesIndex {
  if (!isRecord(raw)) throw new Error('modules/index.json 不是对象');
  const modules = Array.isArray((raw as any).modules) ? ((raw as any).modules as UiModuleInfo[]) : [];
  const meta = isRecord((raw as any).meta) ? ((raw as any).meta as UiModulesIndex['meta']) : ({} as any);
  return { meta, modules };
}

async function tryReadJson<T>(filePath: string): Promise<T | null> {
  try {
    return (await readJsonFile(filePath)) as T;
  } catch {
    return null;
  }
}

function toModuleDir(outputDirAbs: string, moduleId: string): string {
  return path.join(outputDirAbs, 'modules', moduleId);
}

function moduleFactsFile(args: { runId: string; moduleId: string; llm: LlmConfig; skipped?: boolean; skipReason?: string; warnings?: string[]; facts: ModulePrivacyFactsContent }): ModulePrivacyFactsFile {
  return {
    meta: {
      runId: args.runId,
      moduleId: args.moduleId,
      generatedAt: new Date().toISOString(),
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: args.skipped,
      skipReason: args.skipReason,
      warnings: args.warnings,
    },
    facts: args.facts,
  };
}

function placeholderReport(args: { runId: string; llm: LlmConfig; modules: string[]; skipReason: string }): PrivacyReportFile {
  const generatedAt = new Date().toISOString();
  return {
    meta: {
      runId: args.runId,
      generatedAt,
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: true,
      skipReason: args.skipReason,
      counts: { modules: args.modules.length },
    },
    sections: {
      collectionAndUse: args.modules.map((moduleId) => ({
        moduleId,
        tokens: [{ text: `在【${moduleId}】模块中：隐私声明报告未生成（原因：${args.skipReason}）。` }],
      })),
      permissions: args.modules.map((moduleId) => ({
        moduleId,
        tokens: [{ text: `在【${moduleId}】模块中：隐私声明报告未生成（原因：${args.skipReason}）。` }],
      })),
    },
  };
}

export async function generatePrivacyReportArtifacts(args: {
  repoRoot: string;
  runId: string;
  appName: string;
  outputDirAbs: string;
  llm: LlmConfig;
}): Promise<void> {
  const reportPath = path.join(args.outputDirAbs, 'privacy_report.json');
  const reportTextPath = path.join(args.outputDirAbs, 'privacy_report.txt');

  try {
    const modulesIndexPath = path.join(args.outputDirAbs, 'modules', 'index.json');
    const indexRaw = await readJsonFile(modulesIndexPath);
    const index = asModulesIndex(indexRaw);

    const moduleIds: string[] = [];
    for (const m of index.modules) moduleIds.push(m.moduleId);

    // Include _unassigned only if its dataflows file exists.
    const unassignedDataflowsPath = path.join(args.outputDirAbs, 'modules', '_unassigned', 'dataflows.json');
    const unassignedExists = (await tryReadJson<DataflowsResult>(unassignedDataflowsPath)) !== null;
    if (unassignedExists) moduleIds.push('_unassigned');

    const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';

    const modulesForReport: Array<{ moduleId: string; facts: ModulePrivacyFactsContent; dataflows: DataflowsResult }> = [];

    for (const moduleId of moduleIds) {
      const dirAbs = toModuleDir(args.outputDirAbs, moduleId);
      const dataflowsPath = path.join(dirAbs, 'dataflows.json');
      const uiTreePath = path.join(dirAbs, 'ui_tree.json');

      const dataflows =
        (await tryReadJson<DataflowsResult>(dataflowsPath)) ??
        ({ meta: { runId: args.runId, generatedAt: new Date().toISOString(), counts: { flows: 0, nodes: 0, edges: 0 } }, flows: [] } as any);
      const uiTree = await tryReadJson<UiTreeResult>(uiTreePath);

      const moduleInfo =
        moduleId === '_unassigned'
          ? ({
              moduleId: '_unassigned',
              entry: { filePath: '', structName: '_unassigned' },
              uiTreeRootId: '',
              files: [],
              sources: [],
            } satisfies UiModulesIndex['modules'][number])
          : index.modules.find((m) => m.moduleId === moduleId) ?? null;

      let facts: ModulePrivacyFactsContent = { dataPractices: [], permissionPractices: [] };
      let skipped = false;
      let skipReason: string | undefined;
      let warnings: string[] = [];

      if (!apiKey) {
        skipped = true;
        skipReason = '隐私声明报告 LLM api-key 为空，跳过模块隐私要素抽取';
      } else if (!Array.isArray(dataflows.flows) || dataflows.flows.length === 0) {
        skipped = true;
        skipReason = '模块数据流为空，跳过模块隐私要素抽取';
      } else {
        try {
          const extracted = await extractModulePrivacyFacts({
            runId: args.runId,
            appName: args.appName,
            module: moduleInfo,
            dataflows,
            uiTree,
            llm: { provider: args.llm.provider, apiKey, model: args.llm.model },
          });
          facts = extracted.content;
          warnings = extracted.warnings;
        } catch (e) {
          skipped = true;
          skipReason = `模块隐私要素抽取失败：${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const outFile = moduleFactsFile({
        runId: args.runId,
        moduleId,
        llm: args.llm,
        skipped,
        skipReason,
        warnings: warnings.length > 0 ? warnings : undefined,
        facts,
      });

      await writeJsonFile(path.join(dirAbs, 'privacy_facts.json'), outFile);
      modulesForReport.push({ moduleId, facts, dataflows });
    }

    try {
      const built = await buildPrivacyReport({
        runId: args.runId,
        appName: args.appName,
        llm: { provider: args.llm.provider, apiKey: apiKey, model: args.llm.model },
        modules: modulesForReport,
      });
      await writeJsonFile(reportPath, built.report);
      await fs.writeFile(reportTextPath, built.text, 'utf8');

      if (built.warnings.length > 0) {
        // Preserve warnings in JSON report meta without adding extra files.
        await writeJsonFile(reportPath, {
          ...built.report,
          meta: { ...built.report.meta, warnings: built.warnings },
        });
      }
    } catch (e) {
      const skipReason = `隐私声明报告生成失败：${e instanceof Error ? e.message : String(e)}`;
      const report = placeholderReport({ runId: args.runId, llm: args.llm, modules: moduleIds, skipReason });
      await writeJsonFile(reportPath, report);
      await fs.writeFile(reportTextPath, renderPrivacyReportText(report), 'utf8');
    }
  } catch (e) {
    const skipReason = `隐私声明报告生成异常：${e instanceof Error ? e.message : String(e)}`;
    const report = placeholderReport({ runId: args.runId, llm: args.llm, modules: [], skipReason });
    await writeJsonFile(reportPath, report);
    await fs.writeFile(reportTextPath, renderPrivacyReportText(report), 'utf8');
  }
}
