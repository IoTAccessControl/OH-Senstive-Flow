import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';
import { readJsonFile, walkFiles, writeJsonFile } from '../../utils/accessWorkspace.js';
import { loadCsvApiPermissions } from '../extract/csv.js';
import { collectPermissionsFromApp, extractPermissionNames, normalizePermissionToken } from '../extract/app.js';
import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { PageFeaturesIndex, PagesIndex, PageEntryInfo, UiTreeResult } from '../feature/types.js';
import type { SinkRecord, SourceRecord } from '../extract/types.js';

import { sourceRecordToRef, type SourceRef } from '../extract/sources.js';

import { extractFeaturePrivacyFacts, type PrivacyFactsPermissionHint } from './facts.js';
import { getPermissionDisplayName } from './permissionDisplay.js';
import type {
  DataflowNodeRef,
  FeaturePrivacyFactsFile,
  FeaturePrivacyFactsContent,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyReportFile,
  PrivacyReportSection,
  PrivacyReportToken,
} from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string };
type PermissionAuthorizationMode = NonNullable<PrivacyPermissionPractice['authorizationMode']>;
type ReportFeatureInput = {
  featureId: string;
  featureTitle?: string;
  pageTitle?: string;
  facts: FeaturePrivacyFactsContent;
  dataflows: DataflowsResult;
};

type ParagraphAnchor = {
  name: string;
  jumpTo: { featureId: string; flowId: string; nodeId: string };
};

type PermissionOccurrence = {
  permissionName: string;
  filePath: string;
  line: number;
  code: string;
};

type SyntheticPermissionFlowBuild = {
  dataflows: DataflowsResult;
  refsByPermission: Map<string, DataflowNodeRef[]>;
};

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

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function sanitizeIdFragment(text: string): string {
  const normalized = cleanText(text).replaceAll(/[^\w-]+/gu, '_').replaceAll(/^_+|_+$/gu, '');
  return normalized || 'item';
}

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function normalizeScenarioKey(text: string): string {
  return cleanText(text).replaceAll(/[“”"'`、，,。.!！？?；;：:\-_\s]+/gu, '').toLowerCase();
}

function isGenericScenarioText(text: string): boolean {
  const key = normalizeScenarioKey(text);
  if (!key) return true;
  return new Set([
    '功能入口',
    '页面构建入口',
    '页面主布局容器',
    '页面展示与交互',
    '组件展示与交互',
    '页面展示时',
    '组件展示时',
    '相关功能处理过程中',
    '相关功能处理时',
    '相关操作时',
  ]).has(key);
}

function isFrameworkishScenario(text: string): boolean {
  return /(ArkUI|UIAbility|WindowStage|生命周期函数|\bbuild\b|\bonDestroy\b|\bonForeground\b|\bonBackground\b|\bonWindowStage)/u.test(text);
}

function isEnglishLikeScenario(text: string): boolean {
  const cleaned = cleanText(text);
  if (!cleaned) return false;
  if (!hasCjk(cleaned) && /[A-Za-z]/u.test(cleaned)) return true;

  const englishWords = cleaned.match(/[A-Za-z][A-Za-z0-9-]*/gu) ?? [];
  const cjkChars = cleaned.match(/[\u4e00-\u9fff]/gu) ?? [];
  return englishWords.length >= 4 && cjkChars.length <= 2;
}

function isLowQualityScenario(text: string): boolean {
  const cleaned = cleanText(text);
  if (!cleaned) return true;
  if (isFrameworkishScenario(cleaned)) return true;
  if (isGenericScenarioText(cleaned)) return true;
  if (isEnglishLikeScenario(cleaned)) return true;
  return false;
}

function inferChineseActionFromApi(args: { apiKey?: string; description?: string }): string {
  const apiKey = cleanText(args.apiKey).toLowerCase();
  const desc = cleanText(args.description).toLowerCase();

  if (apiKey.includes('hasdefaultnet') || desc.includes('default data network')) return '检查网络连接状态';
  if (apiKey.includes('startbackgroundrunning') || desc.includes('start running in background')) return '请求后台持续运行';
  if (apiKey.includes('stopbackgroundrunning') || desc.includes('stop running in background')) return '停止后台持续运行';
  if (apiKey.includes('requestpermissionsfromuser') || desc.includes('permissions from the user')) return '请求系统权限';
  if (desc.includes('location changed')) return '监听位置变化';
  if (apiKey.includes('@ohos.sensor.on') || desc.includes('accelerometer') || desc.includes('sensor data')) return '监听传感器数据';
  if (apiKey.includes('pushurl') || apiKey.includes('replaceurl') || desc.includes('页面跳转') || desc.includes('jump page'))
    return '页面跳转';
  if (desc.includes('location')) return '获取或监听位置信息';
  if (desc.includes('network')) return '检查网络状态';
  if (/^subscribe\b/u.test(desc)) return '订阅系统事件';
  if (/^unsubscribe\b/u.test(desc)) return '取消订阅系统事件';
  if (/^check(?:s)?\b/u.test(desc)) return '检查系统状态';
  if (/^load(?:s)?\b/u.test(desc)) return '加载相关内容';
  if (/^start(?:s)?\b/u.test(desc)) return '启动相关功能';
  if (/^stop(?:s)?\b/u.test(desc)) return '停止相关功能';
  return '';
}

function buildChineseScenarioFromContext(args: {
  featureId: string;
  featureTitle?: string;
  pageTitle?: string;
  apiKey?: string;
  description?: string;
}): string {
  const featureTitle = cleanText(args.featureTitle);
  if (featureTitle && !isLowQualityScenario(featureTitle)) return featureTitle;

  const pageTitle = cleanText(args.pageTitle);
  const action = inferChineseActionFromApi({ apiKey: args.apiKey, description: args.description });

  if (pageTitle && !isLowQualityScenario(pageTitle)) {
    if (action) return `${pageTitle}${action}时`;
    return `${pageTitle}相关功能处理时`;
  }
  if (action) return `${action}时`;
  return '相关功能处理过程中';
}

function normalizeScenarioForReport(raw: unknown, feature: { featureId: string; featureTitle?: string; pageTitle?: string }): string {
  const scenario = cleanText(raw);
  if (scenario && !isLowQualityScenario(scenario)) return scenario;
  return buildChineseScenarioFromContext(feature);
}

function shouldReplaceScenario(current: unknown, next: unknown): boolean {
  const currentText = cleanText(current);
  const nextText = cleanText(next);
  if (!nextText || isUnknownText(nextText)) return false;
  if (!currentText || isUnknownText(currentText)) return true;
  return isLowQualityScenario(currentText) && !isLowQualityScenario(nextText);
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

async function collectPermissionOccurrencesFromApp(repoRoot: string, appDirAbs: string): Promise<PermissionOccurrence[]> {
  const files = await walkFiles(appDirAbs, {
    extensions: ['ets', 'ts', 'js', 'json', 'json5'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });

  const out: PermissionOccurrence[] = [];
  for (const filePath of files) {
    const normalized = filePath.split(path.sep).join('/');
    if (normalized.includes('/src/ohosTest/')) continue;

    let text = '';
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const permissions = extractPermissionNames(line);
      if (permissions.length === 0) continue;
      for (const permissionName of permissions) {
        out.push({
          permissionName: normalizePermissionToken(permissionName),
          filePath: path.relative(repoRoot, filePath).split(path.sep).join('/'),
          line: index + 1,
          code: line.trim(),
        });
      }
    }
  }

  return out;
}

function buildSyntheticPermissionFlows(args: {
  runId: string;
  featureId: string;
  permissions: string[];
  occurrences: PermissionOccurrence[];
  sinks: SinkRecord[];
  csvPermissions: Map<string, string[]>;
}): SyntheticPermissionFlowBuild {
  const refsByPermission = new Map<string, DataflowNodeRef[]>();
  const flowId = `flow:${sanitizeIdFragment(args.featureId)}`;
  const nodes: Array<{
    id: string;
    filePath: string;
    line: number;
    code: string;
    description: string;
    context: { startLine: number; lines: string[] };
  }> = [];

  for (const permissionName of args.permissions) {
    const occurrence = args.occurrences.find((item) => item.permissionName === permissionName);
    if (occurrence) {
      const nodeId = `perm:${sanitizeIdFragment(permissionName)}`;
      nodes.push({
        id: nodeId,
        filePath: occurrence.filePath,
        line: occurrence.line,
        code: occurrence.code || permissionName,
        description: `应用源码/配置中声明或引用了 ${permissionName}`,
        context: { startLine: occurrence.line, lines: [occurrence.code || permissionName] },
      });
      refsByPermission.set(permissionName, [{ flowId, nodeId }]);
      continue;
    }

    const sink = args.sinks.find((item) => {
      const sinkApiKey = cleanText((item as any).__apiKey);
      if (!sinkApiKey) return false;
      const fromSink = Array.isArray((item as any).__permissions) ? (item as any).__permissions.map(String) : [];
      const fromCsv = args.csvPermissions.get(sinkApiKey) ?? [];
      return [...fromSink, ...fromCsv].some((value) => normalizePermissionToken(value) === permissionName);
    });
    if (!sink) continue;

    const nodeId = `sink:${sanitizeIdFragment(permissionName)}`;
    nodes.push({
      id: nodeId,
      filePath: cleanText((sink as any)['App源码文件路径']),
      line: Number((sink as any)['调用行号'] ?? 0) || 1,
      code: cleanText((sink as any)['调用代码']) || permissionName,
      description: cleanText((sink as any)['API功能描述']) || `SDK API 权限映射推断出 ${permissionName}`,
      context: { startLine: Number((sink as any)['调用行号'] ?? 0) || 1, lines: [cleanText((sink as any)['调用代码']) || permissionName] },
    });
    refsByPermission.set(permissionName, [{ flowId, nodeId }]);
  }

  return {
    refsByPermission,
    dataflows: {
      meta: {
        runId: args.runId,
        generatedAt: new Date().toISOString(),
        counts: { flows: nodes.length > 0 ? 1 : 0, nodes: nodes.length, edges: 0 },
      },
      flows:
        nodes.length > 0
          ? [
              {
                flowId,
                pathId: flowId,
                nodes,
                edges: [],
                summary: {
                  permissions: args.permissions.slice(),
                },
              },
            ]
          : [],
    },
  };
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

function derivePermissionHintsFromCsv(args: {
  featureId: string;
  featureTitle: string;
  pageTitle?: string;
  dataflows: DataflowsResult;
  sinksByCallsite: Map<string, SinkRecord[]>;
  csvPermissions: Map<string, string[]>;
}): PrivacyFactsPermissionHint[] {
  type DerivedPermissionHint = {
    permissionName: string;
    refs: DataflowNodeRef[];
    scenarios: Set<string>;
    apiKeys: Set<string>;
    apiDescriptions: Set<string>;
  };

  const byName = new Map<string, DerivedPermissionHint>();

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
        const rawScenario = inferBusinessScenarioFromSinkDescription(desc);
        const scenario = buildChineseScenarioFromContext({
          featureId: args.featureId,
          featureTitle: args.featureTitle,
          pageTitle: args.pageTitle,
          apiKey,
          description: rawScenario || desc,
        });

        for (const permNameRaw of perms) {
          const permissionName = normalizePermissionName(permNameRaw);
          if (!permissionName) continue;
          const cur = byName.get(permissionName) ?? {
            permissionName,
            refs: [],
            scenarios: new Set<string>(),
            apiKeys: new Set<string>(),
            apiDescriptions: new Set<string>(),
          };
          cur.refs.push({ flowId, nodeId });
          if (scenario) cur.scenarios.add(scenario);
          cur.apiKeys.add(apiKey);
          if (desc) cur.apiDescriptions.add(desc);
          byName.set(permissionName, cur);
        }
      }
    }
  }

  const out: PrivacyFactsPermissionHint[] = [];
  for (const item of byName.values()) {
    const refs = uniqRefs(item.refs);
    if (refs.length === 0) continue;

    const scenario = Array.from(item.scenarios)[0] ?? '';
    const businessScenario =
      scenario ||
      buildChineseScenarioFromContext({
        featureId: args.featureId,
        featureTitle: args.featureTitle,
        pageTitle: args.pageTitle,
      });
    out.push({
      permissionName: item.permissionName,
      businessScenario,
      refs,
      apiKeys: Array.from(item.apiKeys).sort((a, b) => a.localeCompare(b)),
      apiDescriptions: Array.from(item.apiDescriptions).sort((a, b) => a.localeCompare(b)),
    });
  }

  return out.sort((a, b) => a.permissionName.localeCompare(b.permissionName));
}

function derivePermissionPracticesFromHints(hints: PrivacyFactsPermissionHint[]): PrivacyPermissionPractice[] {
  return (hints ?? [])
    .map((hint) => {
      const permissionName = normalizePermissionName(hint.permissionName);
      if (!permissionName) return null;
      return {
        permissionName,
        businessScenario: '',
        permissionPurpose: '',
        denyImpact: '',
        refs: uniqRefs(Array.isArray(hint.refs) ? hint.refs : []),
      };
    })
    .filter((item): item is PrivacyPermissionPractice => Boolean(item))
    .sort((a, b) => a.permissionName.localeCompare(b.permissionName));
}

function mergePermissionPractices(base: PrivacyPermissionPractice[], extra: PrivacyPermissionPractice[]): PrivacyPermissionPractice[] {
  const byName = new Map<string, PrivacyPermissionPractice>();

  for (const p of base ?? []) {
    const name = normalizePermissionName(p.permissionName);
    if (!name) continue;
    byName.set(name, {
      permissionName: name,
      businessScenario: cleanText(p.businessScenario),
      permissionPurpose: cleanText(p.permissionPurpose),
      denyImpact: cleanText(p.denyImpact),
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
        businessScenario: cleanText(p.businessScenario),
        permissionPurpose: cleanText(p.permissionPurpose),
        denyImpact: cleanText(p.denyImpact),
        refs,
      });
      continue;
    }

    existing.refs = uniqRefs([...(existing.refs ?? []), ...refs]);
    if (!cleanText(existing.businessScenario) && cleanText(p.businessScenario)) existing.businessScenario = cleanText(p.businessScenario);
    if (!cleanText(existing.permissionPurpose) && cleanText(p.permissionPurpose)) existing.permissionPurpose = cleanText(p.permissionPurpose);
    if (!cleanText(existing.denyImpact) && cleanText(p.denyImpact)) existing.denyImpact = cleanText(p.denyImpact);
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

function permissionAuthorizationMode(permissionName: string, dynamicPermissions: Set<string>): PermissionAuthorizationMode {
  return dynamicPermissions.has(normalizePermissionToken(permissionName)) ? 'dynamic' : 'preauthorized';
}

function permissionAuthorizationLabel(mode: PrivacyPermissionPractice['authorizationMode']): string {
  return mode === 'dynamic' ? '动态授权' : '预授权';
}

function escapeRegex(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function simpleIdentifierRef(text: string): string {
  const value = cleanText(text);
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(value) ? value : '';
}

function resolvePermissionRef(ref: string, texts: string[]): string[] {
  const exact = simpleIdentifierRef(ref);
  if (!exact) return [];
  const candidates = uniq([exact, exact.split('.').pop() ?? '']).filter(Boolean);
  for (const candidate of candidates) {
    const pattern = new RegExp(`\\b${escapeRegex(candidate)}\\b[^=\\n]{0,160}=\\s*([\\s\\S]{0,400})`, 'gu');
    for (const text of texts) {
      for (const match of text.matchAll(pattern)) {
        const permissions = extractPermissionNames(match[1] ?? '');
        if (permissions.length > 0) return permissions;
      }
    }
  }
  return [];
}

async function collectRuntimeRequestedPermissions(appDirAbs: string): Promise<Set<string>> {
  const files = await walkFiles(appDirAbs, {
    extensions: ['ets', 'ts', 'js'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const normalized = filePath.split(path.sep).join('/');
      if (normalized.includes('/src/ohosTest/')) return { filePath, text: '' };
      try {
        return { filePath, text: await fs.readFile(filePath, 'utf8') };
      } catch {
        return { filePath, text: '' };
      }
    }),
  );

  const requested = new Set<string>();
  const allTexts = entries.map((entry) => entry.text);
  const patterns: Array<{ regex: RegExp; refIndex: number }> = [
    { regex: /\b(?:[\w$.]+\.)?requestPermissionsFromUser\s*\(([\s\S]{0,400}?)\)/gu, refIndex: 1 },
    { regex: /\b[\w$]+\.(?:request|requestPermission)\s*\(([\s\S]{0,300}?)\)/gu, refIndex: 0 },
  ];

  for (const entry of entries) {
    for (const { regex, refIndex } of patterns) {
      for (const match of entry.text.matchAll(regex)) {
        const callArgs = match[1] ?? '';
        const directPermissions = extractPermissionNames(callArgs);
        for (const permission of directPermissions) requested.add(normalizePermissionToken(permission));
        if (directPermissions.length > 0) continue;
        const parts = callArgs.split(',').map((part) => cleanText(part));
        const ref = simpleIdentifierRef(parts[refIndex] ?? '');
        if (!ref) continue;
        for (const permission of resolvePermissionRef(ref, [entry.text, ...allTexts])) {
          requested.add(normalizePermissionToken(permission));
        }
      }
    }
  }

  return requested;
}

function applyPermissionAuthorizationModes(
  practices: PrivacyPermissionPractice[],
  dynamicPermissions: Set<string>,
): PrivacyPermissionPractice[] {
  return (practices ?? []).map((practice) => ({
    ...practice,
    permissionName: normalizePermissionToken(practice.permissionName),
    authorizationMode: permissionAuthorizationMode(practice.permissionName, dynamicPermissions),
  }));
}

function buildAppDeclaredPermissionFacts(
  permissions: string[],
  dynamicPermissions: Set<string>,
  refsByPermission: Map<string, DataflowNodeRef[]>,
): FeaturePrivacyFactsContent {
  return {
    dataPractices: [],
    permissionPractices: permissions.map((permissionName) => ({
      permissionName,
      authorizationMode: permissionAuthorizationMode(permissionName, dynamicPermissions),
      businessScenario: '应用源码/配置声明或 SDK API 使用推断的权限',
      permissionPurpose: '当前已在应用源码/配置扫描或 SDK API→权限映射中识别到该权限，但尚未定位到具体功能点数据流。',
      denyImpact: '当前未从已识别的数据流中定位到具体拒绝授权影响。',
      refs: refsByPermission.get(permissionName) ?? [],
    })),
  };
}

function buildFlowNodeLookup(dataflows: DataflowsResult): Map<string, Map<string, Dataflow['nodes'][number]>> {
  const out = new Map<string, Map<string, Dataflow['nodes'][number]>>();
  for (const flow of dataflows.flows ?? []) {
    const nodes = new Map<string, Dataflow['nodes'][number]>();
    for (const node of flow.nodes ?? []) {
      const nodeId = cleanText(node.id);
      if (!nodeId) continue;
      nodes.set(nodeId, node);
    }
    out.set(cleanText(flow.flowId), nodes);
  }
  return out;
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
    const permissionOccurrences = await collectPermissionOccurrencesFromApp(args.repoRoot, appDirAbs).catch(() => []);
    const declaredAppPermissions = await collectPermissionsFromApp(appDirAbs).catch(() => new Set<string>());
    const dynamicAppPermissions = await collectRuntimeRequestedPermissions(appDirAbs).catch(() => new Set<string>());
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
    const orphanPermissionNames = new Set<string>();

    const featuresForReport: ReportFeatureInput[] = [];

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
      const featureContext = {
        featureId,
        title: feature.title,
        kind: feature.kind,
        anchor: feature.anchor,
        page: { pageId, entry: item.pageEntry },
        sources: featureSources,
      };

      let facts: FeaturePrivacyFactsContent = { dataPractices: [], permissionPractices: [] };
      let skipped = false;
      let skipReason: string | undefined;
      let warnings: string[] = [];

      const permissionHints = derivePermissionHintsFromCsv({
        featureId,
        featureTitle: feature.title,
        pageTitle: cleanText(item.pageEntry.description),
        dataflows,
        sinksByCallsite,
        csvPermissions,
      });

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
            feature: featureContext,
            dataflows,
            uiTree,
            llm: { provider: args.llm.provider, apiKey, model: args.llm.model },
            permissionHints,
          });
          facts = extracted.content;
          warnings = extracted.warnings;
        } catch (e) {
          skipped = true;
          skipReason = `功能点隐私要素抽取失败：${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const mergedPermissionPractices = mergePermissionPractices(
        facts.permissionPractices,
        derivePermissionPracticesFromHints(permissionHints),
      );
      const filtered = filterPermissionPracticesByKnownPermissions({
        practices: mergedPermissionPractices,
        knownPermissions: knownAppPermissions,
      });
      facts.permissionPractices = applyPermissionAuthorizationModes(filtered.practices, dynamicAppPermissions);
      for (const permission of filtered.dropped) {
        warnings.push(`权限 ${permission} 未在应用源码/配置扫描或 SDK API 权限映射中出现，已从识别结果中过滤。`);
      }
      const flowIndex = buildFlowNodeIndex(dataflows);
      const anchoredPractices: PrivacyPermissionPractice[] = [];
      for (const practice of facts.permissionPractices) {
        const permissionName = normalizePermissionToken(practice.permissionName);
        if (!permissionName) continue;
        const picked = pickValidRef(Array.isArray(practice.refs) ? practice.refs : [], flowIndex);
        if (!picked) {
          orphanPermissionNames.add(permissionName);
          warnings.push(`权限 ${permissionName} 在当前功能点未定位到有效跳转证据，已转移到应用权限兜底。`);
          continue;
        }
        anchoredPractices.push({
          ...practice,
          permissionName,
          refs: uniqRefs(Array.isArray(practice.refs) ? practice.refs : []),
        });
        emittedPermissions.add(permissionName);
      }
      facts.permissionPractices = anchoredPractices;

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
      featuresForReport.push({
        featureId,
        featureTitle: feature.title,
        pageTitle: cleanText(item.pageEntry.description),
        facts,
        dataflows,
      });
    }

    const unmatchedPermissions = Array.from(knownAppPermissions)
      .filter((permission) => !emittedPermissions.has(permission) || orphanPermissionNames.has(permission))
      .sort((a, b) => a.localeCompare(b));

    if (unmatchedPermissions.length > 0) {
      const pageId = '_app_permissions';
      const featureId = '__app_permissions';
      const syntheticFlowBuild = buildSyntheticPermissionFlows({
        runId: args.runId,
        featureId,
        permissions: unmatchedPermissions,
        occurrences: permissionOccurrences,
        sinks,
        csvPermissions,
      });
      const syntheticFacts = buildAppDeclaredPermissionFacts(
        unmatchedPermissions,
        dynamicAppPermissions,
        syntheticFlowBuild.refsByPermission,
      );
      const syntheticWarnings = [
        `以下权限来自应用源码/配置扫描或 SDK API 权限映射，当前未定位到具体功能点数据流：${unmatchedPermissions.join(', ')}`,
      ];
      const syntheticDataflows: DataflowsResult = {
        ...syntheticFlowBuild.dataflows,
        meta: {
          ...syntheticFlowBuild.dataflows.meta,
          warnings: syntheticWarnings,
        },
      };
      const syntheticDirAbs = path.join(args.outputDirAbs, 'app_permissions');
      const syntheticPageDirAbs = toPageDir(args.outputDirAbs, pageId);
      const syntheticFeatureDirAbs = toFeatureDir(args.outputDirAbs, pageId, featureId);
      const outFile = featureFactsFile({
        runId: args.runId,
        featureId,
        llm: args.llm,
        warnings: syntheticWarnings,
        facts: syntheticFacts,
      });
      await fs.mkdir(path.join(syntheticPageDirAbs, 'features'), { recursive: true });
      await fs.mkdir(syntheticFeatureDirAbs, { recursive: true });
      await writeJsonFile(path.join(syntheticDirAbs, 'dataflows.json'), syntheticDataflows);
      await writeJsonFile(path.join(syntheticDirAbs, 'privacy_facts.json'), outFile);
      await writeJsonFile(path.join(syntheticFeatureDirAbs, 'dataflows.json'), syntheticDataflows);
      await writeJsonFile(path.join(syntheticFeatureDirAbs, 'privacy_facts.json'), outFile);
      await writeJsonFile(path.join(syntheticPageDirAbs, 'features', 'index.json'), {
        meta: {
          runId: args.runId,
          generatedAt: new Date().toISOString(),
          pageId,
          counts: {
            features: 1,
            flows: syntheticDataflows.meta.counts.flows,
          },
        },
        page: {
          pageId,
          entry: {
            filePath: 'app_permissions',
            structName: 'AppPermissions',
            line: 1,
            description: '应用权限兜底',
          },
        },
        features: [
          {
            featureId,
            title: '应用权限兜底',
            kind: 'source',
            anchor: { filePath: 'app_permissions', line: 1, functionName: 'permissions' },
            counts: {
              flows: syntheticDataflows.meta.counts.flows,
              nodes: syntheticDataflows.meta.counts.nodes,
              edges: syntheticDataflows.meta.counts.edges,
            },
          },
        ],
      });
      pagesIndex.pages.push({
        pageId,
        entry: {
          filePath: 'app_permissions',
          structName: 'AppPermissions',
          line: 1,
          description: '应用权限兜底',
        },
        counts: {
          features: 1,
          flows: syntheticDataflows.meta.counts.flows,
        },
      });
      pagesIndex.meta.counts.pages += 1;
      pagesIndex.meta.counts.features += 1;
      pagesIndex.meta.counts.flows += syntheticDataflows.meta.counts.flows;
      await writeJsonFile(pagesIndexPath, pagesIndex);
      featuresForReport.push({
        featureId,
        featureTitle: '应用权限兜底',
        pageTitle: '',
        facts: syntheticFacts,
        dataflows: syntheticDataflows,
      });
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

function isOmissibleEvidenceText(v: unknown): boolean {
  const text = cleanText(v);
  if (!text || text === '未识别') return true;
  return [
    '未定位',
    '未发现',
    '不涉及',
    '未申请',
    '不存在',
    '尚未定位到具体',
    '当前未从已识别的数据流中定位到具体',
    '当前已在应用源码或配置中检测到该权限字符串',
  ].some((pattern) => text.includes(pattern));
}

function knownText(v: unknown): string {
  const text = cleanText(v);
  return isOmissibleEvidenceText(text) ? '' : text;
}

function trimPunctuationEdges(text: string): string {
  return text
    .replaceAll(/^[\s，,。！？!？；;:：、]+/gu, '')
    .replaceAll(/[\s，,。！？!？；;:：、]+$/gu, '')
    .trim();
}

function clauseText(v: unknown): string {
  const text = knownText(v);
  return text ? trimPunctuationEdges(text) : '';
}

function purposeClauseText(v: unknown): string {
  const text = clauseText(v);
  if (!text) return '';
  return text.replace(/^用于/gu, '').trim();
}

function permissionPurposeText(v: unknown): string {
  const text = cleanText(v);
  if (!text || text === '未识别') return '';
  return trimPunctuationEdges(text).replace(/^用于/gu, '').trim();
}

function permissionDenyImpactText(v: unknown): string {
  const text = cleanText(v);
  if (!text || text === '未识别') return '';
  return trimPunctuationEdges(text);
}

function buildFlowNodeIndex(dataflows: DataflowsResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const flow of dataflows.flows ?? []) {
    const set = new Set<string>();
    for (const node of flow.nodes ?? []) set.add(String(node.id ?? ''));
    map.set(String(flow.flowId ?? ''), set);
  }
  return map;
}

function asPermissionPractices(facts: FeaturePrivacyFactsContent): PrivacyPermissionPractice[] {
  return Array.isArray(facts.permissionPractices) ? (facts.permissionPractices as PrivacyPermissionPractice[]) : [];
}

function asDataPractices(facts: FeaturePrivacyFactsContent): PrivacyDataPractice[] {
  return Array.isArray(facts.dataPractices) ? (facts.dataPractices as PrivacyDataPractice[]) : [];
}

function pickValidRef(
  refs: Array<{ flowId: string; nodeId: string }> | undefined,
  perFlowIndex: Map<string, Set<string>> | undefined,
): { flowId: string; nodeId: string } | null {
  if (!perFlowIndex || !Array.isArray(refs)) return null;
  for (const ref of refs) {
    const flowId = cleanText(ref?.flowId);
    const nodeId = cleanText(ref?.nodeId);
    if (!flowId || !nodeId) continue;
    const set = perFlowIndex.get(flowId);
    if (!set || !set.has(nodeId)) continue;
    return { flowId, nodeId };
  }
  return null;
}

const REPORT_LOCAL_HANDLING_SENTENCE = '相关数据仅在本地处理。';
const REPORT_SERVER_HANDLING_SENTENCE = '相关数据会上传至应用服务端。';

function collectPracticeFlowIds(
  practice: PrivacyDataPractice,
  perFlowIndex: Map<string, Set<string>> | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of practice.dataItems ?? []) {
    for (const ref of Array.isArray(item?.refs) ? item.refs : []) {
      const flowId = cleanText(ref?.flowId);
      const nodeId = cleanText(ref?.nodeId);
      if (!flowId) continue;
      const nodes = perFlowIndex?.get(flowId);
      if (nodes && nodeId && !nodes.has(nodeId)) continue;
      if (seen.has(flowId)) continue;
      seen.add(flowId);
      out.push(flowId);
    }
  }
  return out;
}

function relatedFlowsForPractice(args: {
  feature: ReportFeatureInput;
  practice: PrivacyDataPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): Array<{
  flowId: string;
  pathId: string;
  summary: {
    dataItems: string[];
    collectionFrequency: string[];
    cloudUpload: string[];
    storageAndEncryption: string[];
    permissions: string[];
  };
  evidenceNodes: Array<{ filePath: string; line: number; code: string; description: string }>;
}> {
  const referencedFlowIds = collectPracticeFlowIds(args.practice, args.perFlowIndex);
  const candidateFlowIds =
    referencedFlowIds.length > 0
      ? new Set(referencedFlowIds)
      : (args.feature.dataflows.flows?.length ?? 0) === 1
        ? new Set([cleanText(args.feature.dataflows.flows[0]?.flowId)])
        : new Set<string>();

  if (candidateFlowIds.size === 0) return [];

  return args.feature.dataflows.flows
    .filter((flow) => {
      const flowId = cleanText(flow?.flowId);
      return flowId && candidateFlowIds.has(flowId);
    })
    .map((flow) => ({
      flowId: cleanText(flow.flowId),
      pathId: cleanText(flow.pathId),
      summary: {
        dataItems: Array.isArray(flow.summary?.dataItems) ? flow.summary.dataItems.map(cleanText).filter(Boolean) : [],
        collectionFrequency: Array.isArray(flow.summary?.collectionFrequency)
          ? flow.summary.collectionFrequency.map(cleanText).filter(Boolean)
          : [],
        cloudUpload: Array.isArray(flow.summary?.cloudUpload) ? flow.summary.cloudUpload.map(cleanText).filter(Boolean) : [],
        storageAndEncryption: Array.isArray(flow.summary?.storageAndEncryption)
          ? flow.summary.storageAndEncryption.map(cleanText).filter(Boolean)
          : [],
        permissions: Array.isArray(flow.summary?.permissions) ? flow.summary.permissions.map(cleanText).filter(Boolean) : [],
      },
      evidenceNodes: (flow.nodes ?? [])
        .slice(0, 10)
        .map((node) => ({
          filePath: cleanText(node.filePath),
          line: Number(node.line ?? 0) || 0,
          code: cleanText(node.code),
          description: cleanText(node.description),
        }))
        .filter((node) => node.filePath && node.line > 0 && (node.code || node.description)),
    }));
}

function collectionParagraphAnchors(args: {
  feature: ReportFeatureInput;
  practice: PrivacyDataPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): ParagraphAnchor[] {
  const out: ParagraphAnchor[] = [];
  const seen = new Set<string>();
  for (const dataItem of args.practice.dataItems ?? []) {
    const name = clauseText(dataItem?.name);
    if (!name || seen.has(name)) continue;
    const picked = pickValidRef(dataItem?.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
    if (!picked) continue;
    seen.add(name);
    out.push({
      name,
      jumpTo: { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId },
    });
  }
  return out;
}

function normalizeCollectionParagraphResponse(text: string): string {
  let normalized = typeof text === 'string' ? text.trim() : '';
  normalized = normalized.replace(/^```[\w-]*\s*/u, '').replace(/\s*```$/u, '').trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'")) ||
    (normalized.startsWith('“') && normalized.endsWith('”'))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replaceAll(/\s+/gu, ' ').trim();
}

function userFacingMethodText(text: unknown): string {
  const value = cleanText(text);
  if (!value) return '';
  if (/未检测到显式加密|未检测到加密/u.test(value)) return '相关数据保存在设备本地，未发现加密存储证据';
  if (/未检测到持久化存储/u.test(value)) return '相关数据仅在本地处理';
  if (/组件实例变量|本地内存|回调函数/u.test(value)) return '相关数据仅在本地处理';
  return value;
}

function isNonDisclosableCollectionDataItem(text: string): boolean {
  const value = cleanText(text);
  if (!value) return true;
  return /(日志|log\b|错误堆栈|stack\b|调试|debug\b|上下文|context\b|内部状态|状态标识|配置参数|生命周期)/iu.test(value);
}

async function collectionParagraphForPractice(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  practice: PrivacyDataPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
  anchors: ParagraphAnchor[];
}): Promise<string> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  const filteredAnchors = args.anchors.filter((anchor) => !isNonDisclosableCollectionDataItem(anchor.name));
  if (!apiKey || filteredAnchors.length === 0) return 'SKIP';

  const scenario = clauseText(
    normalizeScenarioForReport(args.practice.businessScenario, {
      featureId: args.feature.featureId,
      featureTitle: args.feature.featureTitle,
      pageTitle: args.feature.pageTitle,
    }),
  );
  const dataSources = uniq((args.practice.dataSources ?? []).map(clauseText).filter(Boolean));
  const allDataItems = uniq(
    (args.practice.dataItems ?? [])
      .map((item) => clauseText(item?.name))
      .filter((name) => Boolean(name) && !isNonDisclosableCollectionDataItem(name)),
  );
  const processingPurpose = purposeClauseText(args.practice.processingPurpose);
  const relatedFlows = relatedFlowsForPractice(args);

  const system = [
    '你是隐私声明报告助手。',
    '你的任务是为“我们如何收集和使用您的个人信息”判断并生成一段正式中文。',
    '如果当前数据实践不涉及应披露的个人信息/隐私数据，必须只输出 SKIP。',
    '如果生成正文，必须只输出一段中文，不要输出 JSON、标题、解释或 Markdown。',
    '如果正文提到数据项，必须直接使用候选数据项名称中的原文，不得改写、翻译、拆分、合并或新增名称。',
    '日志、生命周期状态、页面控制状态、路由参数、权限状态、设备参数、索引、内部状态变量等，不应写入个人信息段。',
    `关于数据处理位置，请严格基于证据表述；若证据不足或未明确上传服务端，应表述为“${REPORT_LOCAL_HANDLING_SENTENCE}”；只有证据明确指向应用服务端上传时，才能表述为“${REPORT_SERVER_HANDLING_SENTENCE}”`,
  ].join('\n');

  const user = [
    '请基于以下证据生成隐私声明段落，或输出 SKIP：',
    JSON.stringify(
      {
        featureId: cleanText(args.feature.featureId),
        featureTitle: cleanText(args.feature.featureTitle),
        pageTitle: cleanText(args.feature.pageTitle),
        businessScenario: scenario || '未识别',
        dataSources,
        candidateDataItems: filteredAnchors.map((anchor) => anchor.name),
        allRecognizedDataItems: allDataItems,
        processingMethod: userFacingMethodText(args.practice.processingMethod),
        storageMethod: userFacingMethodText(args.practice.storageMethod),
        dataRecipients: (args.practice.dataRecipients ?? []).map((recipient) => ({
          name: cleanText(recipient?.name),
          inferred: Boolean(recipient?.inferred),
        })),
        processingPurpose,
        relatedFlows,
      },
      null,
      2,
    ),
    '',
    '写作要求：',
    '- 如果没有合适的候选数据项可以写入个人信息段，输出 SKIP',
    '- 如果生成正文，至少提到一个 candidateDataItems 中的原始名称',
    '- 正文应自然、正式、通顺，可直接放入隐私声明',
    '- 不要写源码术语、路径、函数名、变量名、日志信息或技术调试细节',
    '- 不要直接复述“未检测到显式加密”“组件实例变量”“本地内存回调函数”等静态分析术语，请改写成用户能理解的表述',
  ].join('\n');

  const baseUrls = resolveLlmBaseUrls(args.llm.provider);
  let lastError: unknown = null;
  for (const baseUrl of baseUrls) {
    try {
      const res = await openAiCompatibleChat({
        baseUrl,
        apiKey,
        model: args.llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
      });
      const paragraph = normalizeCollectionParagraphResponse(res.content);
      if (!paragraph) return 'SKIP';
      return /^SKIP[。.!！?？]*$/iu.test(paragraph) ? 'SKIP' : paragraph;
    } catch (error) {
      lastError = error;
      const canRetry =
        baseUrls.length > 1 &&
        (error instanceof LlmNetworkError ||
          (error instanceof LlmHttpError && (error.status === 401 || error.status === 404 || error.status >= 500)));
      if (!canRetry) break;
    }
  }

  void lastError;
  return 'SKIP';
}

function paragraphTokens(args: {
  paragraph: string;
  anchors: ParagraphAnchor[];
}): PrivacyReportToken[] {
  const normalizedParagraph = normalizeCollectionParagraphResponse(args.paragraph);
  if (!normalizedParagraph || /^SKIP[。.!！?？]*$/iu.test(normalizedParagraph)) return [];

  const anchors = [...args.anchors].sort((a, b) => b.name.length - a.name.length);
  const out: PrivacyReportToken[] = [];
  let buffer = '';
  let cursor = 0;
  let anchored = false;

  while (cursor < normalizedParagraph.length) {
    const matched = anchors.find((anchor) => normalizedParagraph.startsWith(anchor.name, cursor));
    if (!matched) {
      buffer += normalizedParagraph[cursor];
      cursor += 1;
      continue;
    }
    if (buffer) {
      out.push({ text: buffer });
      buffer = '';
    }
    out.push({ text: matched.name, jumpTo: matched.jumpTo });
    anchored = true;
    cursor += matched.name.length;
  }

  if (buffer) out.push({ text: buffer });
  return anchored ? out : [];
}

function permissionDisplayName(permissionName: string): string {
  const normalized = normalizePermissionName(permissionName);
  if (!normalized) return '';
  return cleanText(getPermissionDisplayName(normalized)) || normalized;
}

function permissionReportLabel(permissionName: string, mode: PrivacyPermissionPractice['authorizationMode']): string {
  const display = permissionDisplayName(permissionName);
  const base = display.endsWith('权限') ? display : `${display}权限`;
  return `${base}（${permissionAuthorizationLabel(mode)}）`;
}

function permissionParagraphAnchors(args: {
  feature: ReportFeatureInput;
  practice: PrivacyPermissionPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): ParagraphAnchor[] {
  const permissionName = normalizePermissionName(args.practice.permissionName);
  if (!permissionName) return [];

  const picked = pickValidRef(args.practice.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
  if (!picked) return [];

  return [
    {
      name: permissionReportLabel(permissionName, args.practice.authorizationMode),
      jumpTo: { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId },
    },
  ];
}

async function permissionParagraphForPractice(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  practice: PrivacyPermissionPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
  anchors: ParagraphAnchor[];
}): Promise<string> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';

  const scenario = clauseText(
    normalizeScenarioForReport(args.practice.businessScenario, {
      featureId: args.feature.featureId,
      featureTitle: args.feature.featureTitle,
      pageTitle: args.feature.pageTitle,
    }),
  );
  const purpose = permissionPurposeText(args.practice.permissionPurpose);
  const denyImpact = permissionDenyImpactText(args.practice.denyImpact);

  if (args.anchors.length === 0) return 'SKIP';
  if (!apiKey) return 'SKIP';

  const system = [
    '你是隐私声明报告助手。',
    '你的任务是为“设备权限调用”生成一段正式中文。',
    '如果当前权限实践不适合写入隐私声明，必须只输出 SKIP。',
    '如果生成正文，必须只输出一段中文，不要输出 JSON、标题、解释或 Markdown。',
    '如果正文提到权限，必须直接使用候选权限名称中的原文，不得改写、翻译、拆分、合并或新增名称。',
  ].join('\n');

  const payload = JSON.stringify(
    {
      featureId: cleanText(args.feature.featureId),
      featureTitle: cleanText(args.feature.featureTitle),
      pageTitle: cleanText(args.feature.pageTitle),
      businessScenario: scenario || '未识别',
      candidatePermissions: args.anchors.map((anchor) => anchor.name),
      permissionPurpose: purpose,
      denyImpact,
    },
    null,
    2,
  );

  const generateParagraph = async (strictAnchorRetry: boolean): Promise<string> => {
    const user = [
      strictAnchorRetry ? '你上一次输出未保留候选权限名称原文或段落不完整，请严格重写。' : '请基于以下证据生成权限声明段落，或输出 SKIP：',
      payload,
      '',
      '写作要求：',
      '- 如果生成正文，至少提到一个 candidatePermissions 中的原始名称',
      strictAnchorRetry ? '- 必须逐字保留一个 candidatePermissions 中的原始名称，否则只输出 SKIP' : '',
      strictAnchorRetry ? '- 请优先写完整的业务场景、权限用途和拒绝影响，不要只输出残句' : '',
      '- 正文应自然、正式、通顺，可直接放入隐私声明',
      '- 不要写源码术语、路径、函数名、变量名、日志信息或技术调试细节',
    ]
      .filter(Boolean)
      .join('\n');

    const baseUrls = resolveLlmBaseUrls(args.llm.provider);
    let lastError: unknown = null;
    for (const baseUrl of baseUrls) {
      try {
        const res = await openAiCompatibleChat({
          baseUrl,
          apiKey,
          model: args.llm.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
        });
        const paragraph = normalizeCollectionParagraphResponse(res.content);
        if (!paragraph) return 'SKIP';
        return /^SKIP[。.!！?？]*$/iu.test(paragraph) ? 'SKIP' : paragraph;
      } catch (error) {
        lastError = error;
        const canRetry =
          baseUrls.length > 1 &&
          (error instanceof LlmNetworkError ||
            (error instanceof LlmHttpError && (error.status === 401 || error.status === 404 || error.status >= 500)));
        if (!canRetry) break;
      }
    }

    void lastError;
    return 'SKIP';
  };

  const paragraph = await generateParagraph(false);
  if (paragraphTokens({ paragraph, anchors: args.anchors }).length > 0) return paragraph;
  const retriedParagraph = await generateParagraph(true);
  return paragraphTokens({ paragraph: retriedParagraph, anchors: args.anchors }).length > 0 ? retriedParagraph : 'SKIP';
}

async function permissionSectionTokens(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): Promise<PrivacyReportToken[]> {
  const practices = asPermissionPractices(args.facts)
    .map((practice) => ({
      ...practice,
      permissionName: normalizePermissionName(practice.permissionName),
      businessScenario: normalizeScenarioForReport(practice.businessScenario, {
        featureId: args.feature.featureId,
        featureTitle: args.feature.featureTitle,
        pageTitle: args.feature.pageTitle,
      }),
      permissionPurpose: cleanText(practice.permissionPurpose) || '未识别',
      denyImpact: cleanText(practice.denyImpact) || '未识别',
      refs: Array.isArray(practice.refs) ? practice.refs : [],
    }))
    .filter((practice) => Boolean(practice.permissionName));

  if (practices.length === 0) return [];

  const merged: PrivacyReportToken[] = [];
  for (const practice of practices) {
    const anchors = permissionParagraphAnchors({
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
    });
    const paragraph = await permissionParagraphForPractice({
      llm: args.llm,
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
      anchors,
    });
    const tokens = anchors.length > 0 ? paragraphTokens({ paragraph, anchors }) : [];
    if (tokens.length === 0) continue;
    for (const token of tokens) merged.push(token);
  }

  return merged;
}

async function deterministicCollectionAndUseTokens(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): Promise<PrivacyReportToken[]> {
  const practices = asDataPractices(args.facts);
  if (practices.length === 0) return [];

  const out: PrivacyReportToken[] = [];
  for (const practice of practices) {
    const anchors = collectionParagraphAnchors({
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
    });
    if (anchors.length === 0) continue;

    const paragraph = await collectionParagraphForPractice({
      llm: args.llm,
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
      anchors,
    });
    const tokens = paragraphTokens({
      paragraph,
      anchors: anchors.filter((anchor) => !isNonDisclosableCollectionDataItem(anchor.name)),
    });
    if (tokens.length === 0) continue;
    for (const token of tokens) out.push(token);
  }

  return out;
}

export async function buildPrivacyReport(args: {
  runId: string;
  appName: string;
  llm: LlmConfig;
  features: ReportFeatureInput[];
}): Promise<{ report: PrivacyReportFile; text: string; warnings: string[] }> {
  const generatedAt = new Date().toISOString();
  const flowIndexes = new Map<string, Map<string, Set<string>>>();
  for (const feature of args.features) flowIndexes.set(feature.featureId, buildFlowNodeIndex(feature.dataflows));

  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';

  const collectionAndUse: PrivacyReportSection[] = await Promise.all(
    args.features.map(async (feature) => ({
      featureId: feature.featureId,
      tokens: await deterministicCollectionAndUseTokens({
        llm: args.llm,
        feature,
        facts: feature.facts,
        perFlowIndex: flowIndexes.get(feature.featureId),
      }),
    })),
  );

  const permissions: PrivacyReportSection[] = await Promise.all(
    args.features.map(async (feature) => ({
      featureId: feature.featureId,
      tokens: await permissionSectionTokens({
        llm: args.llm,
        feature,
        facts: feature.facts,
        perFlowIndex: flowIndexes.get(feature.featureId),
      }),
    })),
  );

  const warnings = uniq(
    args.features.flatMap((feature) => {
      const out: string[] = [];
      const collectionTokens = collectionAndUse.find((section) => section.featureId === feature.featureId)?.tokens ?? [];
      if (asDataPractices(feature.facts).length > 0 && collectionTokens.length > 0 && collectionTokens.every((token) => !token.jumpTo)) {
        out.push(`功能点 ${feature.featureId} 的个人信息段落缺少有效跳转引用，已降级为纯文本。`);
      }
      return out;
    }),
  );

  const report: PrivacyReportFile = {
    meta: {
      runId: args.runId,
      generatedAt,
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: !apiKey,
      skipReason: !apiKey ? '隐私声明报告文案 LLM api-key 为空：未使用 LLM 文案生成' : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      counts: { features: args.features.length },
    },
    sections: { collectionAndUse, permissions },
  };

  return { report, text: renderPrivacyReportText(report), warnings };
}

function sectionParagraph(tokens: PrivacyReportToken[]): string {
  return tokens.map((token) => (typeof token.text === 'string' ? token.text : '')).join('');
}

export function renderPrivacyReportText(report: PrivacyReportFile): string {
  const lines: string[] = [];
  lines.push('1 我们如何收集和使用您的个人信息');
  for (const paragraph of report.sections.collectionAndUse) {
    const text = sectionParagraph(paragraph.tokens).trim();
    if (!text) continue;
    lines.push(text);
  }
  lines.push('2 设备权限调用');
  for (const paragraph of report.sections.permissions) {
    const text = sectionParagraph(paragraph.tokens).trim();
    if (!text) continue;
    lines.push(text);
  }
  return `${lines.join('\n\n').trimEnd()}\n`;
}
