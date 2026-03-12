import fs from 'node:fs/promises';
import path from 'node:path';

import { readJsonFile, writeJsonFile } from '../io.js';
import { loadCsvApiPermissions } from '../csvSupplement.js';
import { collectPermissionsFromApp, normalizePermissionToken } from '../permissions.js';
import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { PageFeaturesIndex, PagesIndex, PageEntryInfo } from '../pages/types.js';
import type { SinkRecord, SourceRecord } from '../types.js';
import type { UiTreeResult } from '../uiTree/types.js';

import { sourceRecordToRef, type SourceRef } from '../shared/sourceRefs.js';

import { extractFeaturePrivacyFacts } from './extractFeaturePrivacyFacts.js';
import { buildPrivacyReport, renderPrivacyReportText } from './buildPrivacyReport.js';
import type { DataflowNodeRef, FeaturePrivacyFactsFile, FeaturePrivacyFactsContent, PrivacyPermissionPractice, PrivacyReportFile } from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll(/\s+/gu, ' ').trim();
}

function isUnknownText(v: unknown): boolean {
  const t = cleanText(v);
  return !t || t === '未识别';
}

function asPagesIndex(raw: unknown): PagesIndex {
  if (!isRecord(raw)) throw new Error('pages/index.json 不是对象');
  const pages = Array.isArray((raw as any).pages) ? ((raw as any).pages as PagesIndex['pages']) : [];
  const meta = isRecord((raw as any).meta) ? ((raw as any).meta as PagesIndex['meta']) : ({} as any);
  return { meta, pages };
}

function asPageFeaturesIndex(raw: unknown): PageFeaturesIndex {
  if (!isRecord(raw)) throw new Error('pages/<pageId>/features/index.json 不是对象');
  const features = Array.isArray((raw as any).features) ? ((raw as any).features as PageFeaturesIndex['features']) : [];
  const meta = isRecord((raw as any).meta) ? ((raw as any).meta as PageFeaturesIndex['meta']) : ({} as any);
  const page = isRecord((raw as any).page) ? ((raw as any).page as PageFeaturesIndex['page']) : ({} as any);
  return { meta, page, features };
}

function asSourceRecords(raw: unknown): SourceRecord[] {
  return Array.isArray(raw) ? (raw as SourceRecord[]) : [];
}

function asSinkRecords(raw: unknown): SinkRecord[] {
  return Array.isArray(raw) ? (raw as SinkRecord[]) : [];
}

async function tryReadJson<T>(filePath: string): Promise<T | null> {
  try {
    return (await readJsonFile(filePath)) as T;
  } catch {
    return null;
  }
}

function toAbs(repoRoot: string, maybeRelativePath: string): string {
  const p = typeof maybeRelativePath === 'string' ? maybeRelativePath : '';
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

function featureFactsFile(args: {
  runId: string;
  featureId: string;
  llm: LlmConfig;
  skipped?: boolean;
  skipReason?: string;
  warnings?: string[];
  facts: FeaturePrivacyFactsContent;
}): FeaturePrivacyFactsFile {
  return {
    meta: {
      runId: args.runId,
      featureId: args.featureId,
      generatedAt: new Date().toISOString(),
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: args.skipped,
      skipReason: args.skipReason,
      warnings: args.warnings,
    },
    facts: args.facts,
  };
}

function placeholderReport(args: { runId: string; llm: LlmConfig; features: string[]; skipReason: string }): PrivacyReportFile {
  const generatedAt = new Date().toISOString();
  const featureIds = args.features.length > 0 ? args.features : ['__analysis_status'];
  return {
    meta: {
      runId: args.runId,
      generatedAt,
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: true,
      skipReason: args.skipReason,
      counts: { features: args.features.length },
    },
    sections: {
      collectionAndUse: featureIds.map((featureId) => ({
        featureId,
        tokens: [
          {
            text:
              featureId === '__analysis_status'
                ? `当前未识别到可用于生成“我们如何收集和使用您的个人信息”章节的页面功能或数据流证据（原因：${args.skipReason}）。`
                : `在【${featureId}】功能点中：隐私声明报告未生成（原因：${args.skipReason}）。`,
          },
        ],
      })),
      permissions: featureIds.map((featureId) => ({
        featureId,
        tokens: [
          {
            text:
              featureId === '__analysis_status'
                ? `当前未识别到可用于生成“设备权限调用”章节的权限证据（原因：${args.skipReason}）。`
                : `在【${featureId}】功能点中：隐私声明报告未生成（原因：${args.skipReason}）。`,
          },
        ],
      })),
    },
  };
}

function groupSourcesByFileLine(sources: SourceRecord[]): Map<string, SourceRecord[]> {
  const map = new Map<string, SourceRecord[]>();
  for (const s of sources) {
    const key = `${s['App源码文件路径']}:${s['行号']}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

function pickSourceForFlow(flow: Dataflow, sourcesByFileLine: Map<string, SourceRecord[]>): SourceRecord | null {
  for (const n of flow.nodes) {
    const key = `${n.filePath}:${n.line}`;
    const hits = sourcesByFileLine.get(key);
    if (!hits || hits.length === 0) continue;
    return hits.find((s) => s['函数名称'] === 'build') ?? hits[0] ?? null;
  }
  return null;
}

function sourcesForFeature(args: { dataflows: DataflowsResult; sourcesByFileLine: Map<string, SourceRecord[]> }): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const f of args.dataflows.flows ?? []) {
    const s = pickSourceForFlow(f, args.sourcesByFileLine);
    if (!s) continue;
    const ref = sourceRecordToRef(s);
    const key = `${ref.filePath}:${ref.line}:${ref.functionName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out.sort((a, b) => `${a.filePath}:${a.line}:${a.functionName}`.localeCompare(`${b.filePath}:${b.line}:${b.functionName}`));
}

function toPageDir(outputDirAbs: string, pageId: string): string {
  return path.join(outputDirAbs, 'pages', pageId);
}

function toFeatureDir(outputDirAbs: string, pageId: string, featureId: string): string {
  return path.join(outputDirAbs, 'pages', pageId, 'features', featureId);
}

function groupSinksByCallsite(sinks: SinkRecord[]): Map<string, SinkRecord[]> {
  const map = new Map<string, SinkRecord[]>();
  for (const s of sinks) {
    const filePath = String((s as any)['App源码文件路径'] ?? '');
    const line = Number((s as any)['调用行号'] ?? 0) || 0;
    if (!filePath || line <= 0) continue;
    const key = `${filePath}:${line}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

function normalizePermissionName(v: unknown): string {
  const t = cleanText(v);
  if (!t) return '';
  return t.replaceAll(/（[^）]*）/gu, '').trim();
}

function uniqRefs(refs: DataflowNodeRef[]): DataflowNodeRef[] {
  const out: DataflowNodeRef[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    const flowId = cleanText(r.flowId);
    const nodeId = cleanText(r.nodeId);
    if (!flowId || !nodeId) continue;
    const key = `${flowId}/${nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ flowId, nodeId });
  }
  return out;
}

function inferBusinessScenarioFromSinkDescription(desc: string): string {
  const t = cleanText(desc);
  if (!t) return '';
  const parts = t.split(';').map((x) => cleanText(x));
  const first = parts[0] ?? '';
  if (!first) return '';
  if (first.startsWith('权限:')) return '';
  if (first.startsWith('数据:')) return '';
  // E.g. "本地录音 / 本地录音" or similar.
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

function derivePermissionPracticesFromCsv(args: {
  featureId: string;
  featureTitle: string;
  dataflows: DataflowsResult;
  sinksByCallsite: Map<string, SinkRecord[]>;
  csvPermissions: Map<string, string[]>;
}): PrivacyPermissionPractice[] {
  type DerivedPermissionPractice = {
    permissionName: string;
    refs: DataflowNodeRef[];
    scenarios: Set<string>;
    apiKeys: Set<string>;
  };

  const byName = new Map<string, DerivedPermissionPractice>();

  for (const f of args.dataflows.flows ?? []) {
    const flowId = String(f.flowId ?? '');
    if (!flowId) continue;
    for (const n of f.nodes ?? []) {
      const filePath = cleanText(n.filePath);
      const line = Number(n.line ?? 0) || 0;
      const nodeId = cleanText(n.id);
      if (!filePath || line <= 0 || !nodeId) continue;

      const sinkRecords = args.sinksByCallsite.get(`${filePath}:${line}`) ?? [];
      if (sinkRecords.length === 0) continue;

      for (const s of sinkRecords) {
        const apiKey = cleanText((s as any).__apiKey);
        if (!apiKey) continue;
        const fromSink = Array.isArray((s as any).__permissions) ? (s as any).__permissions.map(String) : [];
        const fromCsv = args.csvPermissions.get(apiKey) ?? [];
        const perms = Array.from(new Set([...fromSink, ...fromCsv].map(cleanText))).filter(Boolean);
        if (perms.length === 0) continue;

        const desc = cleanText((s as any)['API功能描述']);
        const scenario = inferBusinessScenarioFromSinkDescription(desc);

        for (const permNameRaw of perms) {
          const permissionName = normalizePermissionName(permNameRaw);
          if (!permissionName) continue;
          const cur = byName.get(permissionName) ?? {
            permissionName,
            refs: [],
            scenarios: new Set<string>(),
            apiKeys: new Set<string>(),
          };
          cur.refs.push({ flowId, nodeId });
          if (scenario) cur.scenarios.add(scenario);
          cur.apiKeys.add(apiKey);
          byName.set(permissionName, cur);
        }
      }
    }
  }

  const out: PrivacyPermissionPractice[] = [];
  for (const item of byName.values()) {
    const refs = uniqRefs(item.refs);
    if (refs.length === 0) continue;

    const scenario = Array.from(item.scenarios)[0] ?? '';
    const businessScenario = scenario || args.featureTitle || args.featureId;
    out.push({
      permissionName: item.permissionName,
      businessScenario,
      permissionPurpose: '使用相关系统能力（由 SDK API 权限映射确定）',
      denyImpact: '拒绝授权可能导致对应功能无法正常使用。',
      refs,
    });
  }

  return out.sort((a, b) => a.permissionName.localeCompare(b.permissionName));
}

function mergePermissionPractices(base: PrivacyPermissionPractice[], extra: PrivacyPermissionPractice[]): PrivacyPermissionPractice[] {
  const byName = new Map<string, PrivacyPermissionPractice>();

  for (const p of base ?? []) {
    const name = normalizePermissionName(p.permissionName);
    if (!name) continue;
    byName.set(name, {
      permissionName: name,
      businessScenario: cleanText(p.businessScenario) || '未识别',
      permissionPurpose: cleanText(p.permissionPurpose) || '未识别',
      denyImpact: cleanText(p.denyImpact) || '未识别',
      refs: uniqRefs(Array.isArray(p.refs) ? p.refs : []),
    });
  }

  for (const p of extra ?? []) {
    const name = normalizePermissionName(p.permissionName);
    if (!name) continue;
    const existing = byName.get(name);
    const refs = uniqRefs(Array.isArray(p.refs) ? p.refs : []);
    if (!existing) {
      byName.set(name, {
        permissionName: name,
        businessScenario: cleanText(p.businessScenario) || '未识别',
        permissionPurpose: cleanText(p.permissionPurpose) || '未识别',
        denyImpact: cleanText(p.denyImpact) || '未识别',
        refs,
      });
      continue;
    }

    existing.refs = uniqRefs([...(existing.refs ?? []), ...refs]);
    if (isUnknownText(existing.businessScenario) && !isUnknownText(p.businessScenario)) existing.businessScenario = cleanText(p.businessScenario);
    if (isUnknownText(existing.permissionPurpose) && !isUnknownText(p.permissionPurpose)) existing.permissionPurpose = cleanText(p.permissionPurpose);
    if (isUnknownText(existing.denyImpact) && !isUnknownText(p.denyImpact)) existing.denyImpact = cleanText(p.denyImpact);
    byName.set(name, existing);
  }

  return Array.from(byName.values()).sort((a, b) => a.permissionName.localeCompare(b.permissionName));
}

function filterPermissionPracticesByKnownPermissions(args: {
  practices: PrivacyPermissionPractice[];
  knownPermissions: Set<string>;
}): { practices: PrivacyPermissionPractice[]; dropped: string[] } {
  if (args.knownPermissions.size === 0) return { practices: args.practices ?? [], dropped: [] };
  const kept: PrivacyPermissionPractice[] = [];
  const dropped: string[] = [];
  for (const practice of args.practices ?? []) {
    const normalized = normalizePermissionToken(practice.permissionName);
    if (!normalized) continue;
    if (!args.knownPermissions.has(normalized)) {
      dropped.push(normalized);
      continue;
    }
    kept.push({ ...practice, permissionName: normalized });
  }
  return { practices: kept, dropped: Array.from(new Set(dropped)).sort((a, b) => a.localeCompare(b)) };
}

function buildAppDeclaredPermissionFacts(permissions: string[]): FeaturePrivacyFactsContent {
  return {
    dataPractices: [],
    permissionPractices: permissions.map((permissionName) => ({
      permissionName,
      businessScenario: '应用源码/配置声明或 SDK API 使用推断的权限',
      permissionPurpose: '当前已在应用源码/配置扫描或 SDK API→权限映射中识别到该权限，但尚未定位到具体功能点数据流。',
      denyImpact: '当前未从已识别的数据流中定位到具体拒绝授权影响。',
      refs: [],
    })),
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
    const metaRaw = await tryReadJson<any>(path.join(args.outputDirAbs, 'meta.json'));
    const csvDirFromMeta = cleanText(metaRaw?.input?.csvDir);
    const csvDirAbs = csvDirFromMeta ? toAbs(args.repoRoot, csvDirFromMeta) : path.join(args.repoRoot, 'input', 'csv');
    const csvPermissions = await loadCsvApiPermissions(csvDirAbs);

    const sinksRaw = await tryReadJson<unknown>(path.join(args.outputDirAbs, 'sinks.json'));
    const sinks = asSinkRecords(sinksRaw);
    const sinksByCallsite = groupSinksByCallsite(sinks);

    const pagesIndexPath = path.join(args.outputDirAbs, 'pages', 'index.json');
    const pagesIndexRaw = await readJsonFile(pagesIndexPath);
    const pagesIndex = asPagesIndex(pagesIndexRaw);

    const sourcesRaw = await tryReadJson<unknown>(path.join(args.outputDirAbs, 'sources.json'));
    const sources = asSourceRecords(sourcesRaw);
    const sourcesByFileLine = groupSourcesByFileLine(sources);

    const featureList: Array<{
      pageId: string;
      pageEntry: PageEntryInfo;
      feature: PageFeaturesIndex['features'][number];
    }> = [];

    for (const p of pagesIndex.pages ?? []) {
      const pageId = p.pageId;
      const pageEntry = p.entry;
      const featuresIndexPath = path.join(toPageDir(args.outputDirAbs, pageId), 'features', 'index.json');
      const featuresIndexRaw = await readJsonFile(featuresIndexPath);
      const featuresIndex = asPageFeaturesIndex(featuresIndexRaw);
      for (const f of featuresIndex.features ?? []) {
        featureList.push({ pageId, pageEntry, feature: f });
      }
    }

    const featureIds = featureList.map((x) => x.feature.featureId);
    const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';

    const appPathFromMeta = cleanText(metaRaw?.input?.appPath);
    const appDirAbs = appPathFromMeta ? toAbs(args.repoRoot, appPathFromMeta) : path.join(args.repoRoot, 'input', 'app', args.appName);
    const declaredAppPermissions = await collectPermissionsFromApp(appDirAbs).catch(() => new Set<string>());
    const inferredAppPermissions = new Set<string>();
    for (const s of sinks) {
      const sinkApiKey = cleanText((s as any).__apiKey);
      const fromSink = Array.isArray((s as any).__permissions) ? (s as any).__permissions.map(String) : [];
      const fromCsv = sinkApiKey ? (csvPermissions.get(sinkApiKey) ?? []) : [];
      for (const raw of [...fromSink, ...fromCsv]) {
        const normalized = normalizePermissionToken(raw);
        if (normalized && normalized.startsWith('ohos.permission.')) inferredAppPermissions.add(normalized);
      }
    }
    const knownAppPermissions = new Set<string>([...declaredAppPermissions, ...inferredAppPermissions]);
    const emittedPermissions = new Set<string>();

    const featuresForReport: Array<{ featureId: string; facts: FeaturePrivacyFactsContent; dataflows: DataflowsResult }> = [];

    for (const item of featureList) {
      const pageId = item.pageId;
      const feature = item.feature;
      const featureId = feature.featureId;
      const dirAbs = toFeatureDir(args.outputDirAbs, pageId, featureId);

      const dataflowsPath = path.join(dirAbs, 'dataflows.json');
      const uiTreePath = path.join(toPageDir(args.outputDirAbs, pageId), 'ui_tree.json');

      const dataflows =
        (await tryReadJson<DataflowsResult>(dataflowsPath)) ??
        ({ meta: { runId: args.runId, generatedAt: new Date().toISOString(), counts: { flows: 0, nodes: 0, edges: 0 } }, flows: [] } as any);
      const uiTree = await tryReadJson<UiTreeResult>(uiTreePath);

      const featureSources = sourcesForFeature({ dataflows, sourcesByFileLine });

      let facts: FeaturePrivacyFactsContent = { dataPractices: [], permissionPractices: [] };
      let skipped = false;
      let skipReason: string | undefined;
      let warnings: string[] = [];

      if (!apiKey) {
        skipped = true;
        skipReason = '隐私声明报告 LLM api-key 为空，跳过功能点隐私要素抽取';
      } else if (!Array.isArray(dataflows.flows) || dataflows.flows.length === 0) {
        skipped = true;
        skipReason = '功能点数据流为空，跳过隐私要素抽取';
      } else {
        try {
          const extracted = await extractFeaturePrivacyFacts({
            runId: args.runId,
            appName: args.appName,
            feature: {
              featureId,
              title: feature.title,
              kind: feature.kind,
              anchor: feature.anchor,
              page: { pageId, entry: item.pageEntry },
              sources: featureSources,
            },
            dataflows,
            uiTree,
            llm: { provider: args.llm.provider, apiKey, model: args.llm.model },
          });
          facts = extracted.content;
          warnings = extracted.warnings;
        } catch (e) {
          skipped = true;
          skipReason = `功能点隐私要素抽取失败：${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const deterministicPerms = derivePermissionPracticesFromCsv({
        featureId,
        featureTitle: feature.title,
        dataflows,
        sinksByCallsite,
        csvPermissions,
      });
      const mergedPermissionPractices = mergePermissionPractices(facts.permissionPractices, deterministicPerms);
      const filtered = filterPermissionPracticesByKnownPermissions({
        practices: mergedPermissionPractices,
        knownPermissions: knownAppPermissions,
      });
      facts.permissionPractices = filtered.practices;
      for (const permission of filtered.dropped) {
        warnings.push(`权限 ${permission} 未在应用源码/配置扫描或 SDK API 权限映射中出现，已从识别结果中过滤。`);
      }
      for (const practice of facts.permissionPractices) {
        const permissionName = normalizePermissionToken(practice.permissionName);
        if (permissionName) emittedPermissions.add(permissionName);
      }

      const outFile = featureFactsFile({
        runId: args.runId,
        featureId,
        llm: args.llm,
        skipped,
        skipReason,
        warnings: warnings.length > 0 ? warnings : undefined,
        facts,
      });

      await writeJsonFile(path.join(dirAbs, 'privacy_facts.json'), outFile);
      featuresForReport.push({ featureId, facts, dataflows });
    }

    const unmatchedPermissions = Array.from(knownAppPermissions)
      .filter((permission) => !emittedPermissions.has(permission))
      .sort((a, b) => a.localeCompare(b));

    if (unmatchedPermissions.length > 0) {
      const featureId = '__app_permissions';
      const syntheticFacts = buildAppDeclaredPermissionFacts(unmatchedPermissions);
      const syntheticWarnings = [
        `以下权限来自应用源码/配置扫描或 SDK API 权限映射，当前未定位到具体功能点数据流：${unmatchedPermissions.join(', ')}`,
      ];
      const syntheticDataflows: DataflowsResult = {
        meta: {
          runId: args.runId,
          generatedAt: new Date().toISOString(),
          warnings: syntheticWarnings,
          counts: { flows: 0, nodes: 0, edges: 0 },
        },
        flows: [],
      };
      const syntheticDirAbs = path.join(args.outputDirAbs, 'app_permissions');
      const outFile = featureFactsFile({
        runId: args.runId,
        featureId,
        llm: args.llm,
        warnings: syntheticWarnings,
        facts: syntheticFacts,
      });
      await writeJsonFile(path.join(syntheticDirAbs, 'privacy_facts.json'), outFile);
      featuresForReport.push({ featureId, facts: syntheticFacts, dataflows: syntheticDataflows });
      featureIds.push(featureId);
    }

    try {
      if (featuresForReport.length === 0) {
        const skipReason = '未找到可用于隐私报告的页面功能（features 为空）';
        const report = placeholderReport({ runId: args.runId, llm: args.llm, features: [], skipReason });
        await writeJsonFile(reportPath, report);
        await fs.writeFile(reportTextPath, renderPrivacyReportText(report), 'utf8');
        return;
      }

      const built = await buildPrivacyReport({
        runId: args.runId,
        appName: args.appName,
        llm: { provider: args.llm.provider, apiKey: apiKey, model: args.llm.model },
        features: featuresForReport,
      });
      await writeJsonFile(reportPath, built.report);
      await fs.writeFile(reportTextPath, built.text, 'utf8');

      if (built.warnings.length > 0) {
        await writeJsonFile(reportPath, {
          ...built.report,
          meta: { ...built.report.meta, warnings: built.warnings },
        });
      }
    } catch (e) {
      const skipReason = `隐私声明报告生成失败：${e instanceof Error ? e.message : String(e)}`;
      const report = placeholderReport({ runId: args.runId, llm: args.llm, features: featureIds, skipReason });
      await writeJsonFile(reportPath, report);
      await fs.writeFile(reportTextPath, renderPrivacyReportText(report), 'utf8');
    }
  } catch (e) {
    const skipReason = `隐私声明报告生成异常：${e instanceof Error ? e.message : String(e)}`;
    const report = placeholderReport({ runId: args.runId, llm: args.llm, features: [], skipReason });
    await writeJsonFile(reportPath, report);
    await fs.writeFile(reportTextPath, renderPrivacyReportText(report), 'utf8');
  }
}
