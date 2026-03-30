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

import { extractFeaturePrivacyFacts, rewritePermissionPracticeTexts } from './facts.js';
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

const DETERMINISTIC_PERMISSION_PURPOSE = '使用相关系统能力（由 SDK API 权限映射确定）';
const DETERMINISTIC_PERMISSION_DENY_IMPACT = '拒绝授权可能导致对应功能无法正常使用。';

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll(/\s+/gu, ' ').trim();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    }
    throw new Error('LLM 返回无法解析为 JSON');
  }
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
  pageTitle?: string;
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
      permissionPurpose: DETERMINISTIC_PERMISSION_PURPOSE,
      denyImpact: DETERMINISTIC_PERMISSION_DENY_IMPACT,
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
    if (shouldReplaceScenario(existing.businessScenario, p.businessScenario)) existing.businessScenario = cleanText(p.businessScenario);
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
): FeaturePrivacyFactsContent {
  return {
    dataPractices: [],
    permissionPractices: permissions.map((permissionName) => ({
      permissionName,
      authorizationMode: permissionAuthorizationMode(permissionName, dynamicPermissions),
      businessScenario: '应用源码/配置声明或 SDK API 使用推断的权限',
      permissionPurpose: '当前已在应用源码/配置扫描或 SDK API→权限映射中识别到该权限，但尚未定位到具体功能点数据流。',
      denyImpact: '当前未从已识别的数据流中定位到具体拒绝授权影响。',
      refs: [],
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

function needsPermissionTextRewrite(practice: PrivacyPermissionPractice): boolean {
  return (
    cleanText(practice.permissionPurpose) === DETERMINISTIC_PERMISSION_PURPOSE ||
    cleanText(practice.denyImpact) === DETERMINISTIC_PERMISSION_DENY_IMPACT
  );
}

async function maybeRewritePlaceholderPermissionTexts(args: {
  appName: string;
  llm: LlmConfig;
  feature: {
    featureId: string;
    title: string;
    kind: 'ui' | 'source';
    anchor: { filePath: string; line: number; uiNodeId?: string; functionName?: string };
    page: { pageId: string; entry: PageEntryInfo };
    sources: SourceRef[];
  };
  facts: FeaturePrivacyFactsContent;
  dataflows: DataflowsResult;
  sinksByCallsite: Map<string, SinkRecord[]>;
}): Promise<{ practices: PrivacyPermissionPractice[]; warnings: string[] }> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  const practices = asPermissionPractices(args.facts);
  if (!apiKey || practices.length === 0) return { practices, warnings: [] };

  const nodeLookup = buildFlowNodeLookup(args.dataflows);
  const relatedDataPractices = asDataPractices(args.facts).slice(0, 3).map((practice) => ({
    businessScenario: cleanText(practice.businessScenario),
    processingPurpose: cleanText(practice.processingPurpose),
    dataItems: uniq((practice.dataItems ?? []).map((item) => cleanText(item?.name)).filter(Boolean)),
  }));

  const permissions = practices
    .filter((practice) => needsPermissionTextRewrite(practice))
    .map((practice) => {
      const refs = uniqRefs(Array.isArray(practice.refs) ? practice.refs : []).slice(0, 6);
      const evidence = refs
        .map((ref) => {
          const node = nodeLookup.get(cleanText(ref.flowId))?.get(cleanText(ref.nodeId));
          if (!node) return null;
          const sink = args.sinksByCallsite.get(`${cleanText(node.filePath)}:${Number(node.line ?? 0) || 0}`)?.[0];
          return {
            flowId: cleanText(ref.flowId),
            nodeId: cleanText(ref.nodeId),
            description: cleanText(node.description),
            code: cleanText(node.code),
            contextLines: (node.context?.lines ?? []).map((line) => cleanText(line)).filter(Boolean).slice(0, 6),
            apiKey: cleanText((sink as any)?.__apiKey),
            apiDescription: cleanText((sink as any)?.['API功能描述']),
            callCode: cleanText((sink as any)?.['调用代码']),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => item.description || item.code || item.apiDescription);

      if (evidence.length === 0) return null;
      return {
        permissionName: normalizePermissionName(practice.permissionName),
        authorizationMode: practice.authorizationMode,
        businessScenario: cleanText(practice.businessScenario),
        permissionPurpose: cleanText(practice.permissionPurpose),
        denyImpact: cleanText(practice.denyImpact),
        refs,
        evidence,
        relatedDataPractices,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (permissions.length === 0) return { practices, warnings: [] };

  try {
    const rewritten = await rewritePermissionPracticeTexts({
      appName: args.appName,
      feature: args.feature,
      llm: args.llm,
      permissions,
    });
    const rewritesByName = new Map(
      rewritten.rewrites.map((item) => [normalizePermissionName(item.permissionName), item] as const),
    );
    return {
      practices: practices.map((practice) => {
        const rewrite = rewritesByName.get(normalizePermissionName(practice.permissionName));
        if (!rewrite) return practice;
        return {
          ...practice,
          businessScenario: cleanText(rewrite.businessScenario) || practice.businessScenario,
          permissionPurpose: cleanText(rewrite.permissionPurpose) || practice.permissionPurpose,
          denyImpact: cleanText(rewrite.denyImpact) || practice.denyImpact,
        };
      }),
      warnings: rewritten.warnings,
    };
  } catch (e) {
    return {
      practices,
      warnings: [`功能点 ${args.feature.featureId} 的权限文案补全失败：${e instanceof Error ? e.message : String(e)}`],
    };
  }
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
        pageTitle: cleanText(item.pageEntry.description),
        dataflows,
        sinksByCallsite,
        csvPermissions,
      });
      const mergedPermissionPractices = mergePermissionPractices(facts.permissionPractices, deterministicPerms);
      const filtered = filterPermissionPracticesByKnownPermissions({
        practices: mergedPermissionPractices,
        knownPermissions: knownAppPermissions,
      });
      facts.permissionPractices = applyPermissionAuthorizationModes(filtered.practices, dynamicAppPermissions);
      const rewrittenPermissionTexts = await maybeRewritePlaceholderPermissionTexts({
        appName: args.appName,
        llm: { provider: args.llm.provider, apiKey, model: args.llm.model },
        feature: featureContext,
        facts,
        dataflows,
        sinksByCallsite,
      });
      facts.permissionPractices = rewrittenPermissionTexts.practices;
      warnings.push(...rewrittenPermissionTexts.warnings);
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
      featuresForReport.push({
        featureId,
        featureTitle: feature.title,
        pageTitle: cleanText(item.pageEntry.description),
        facts,
        dataflows,
      });
    }

    const unmatchedPermissions = Array.from(knownAppPermissions)
      .filter((permission) => !emittedPermissions.has(permission))
      .sort((a, b) => a.localeCompare(b));

    if (unmatchedPermissions.length > 0) {
      const featureId = '__app_permissions';
      const syntheticFacts = buildAppDeclaredPermissionFacts(unmatchedPermissions, dynamicAppPermissions);
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

async function decideHandlingSentenceWithReportLlm(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  practice: PrivacyDataPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): Promise<string> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey) return REPORT_LOCAL_HANDLING_SENTENCE;

  const referencedFlowIds = collectPracticeFlowIds(args.practice, args.perFlowIndex);
  const candidateFlowIds =
    referencedFlowIds.length > 0
      ? new Set(referencedFlowIds)
      : (args.feature.dataflows.flows?.length ?? 0) === 1
      ? new Set([cleanText(args.feature.dataflows.flows[0]?.flowId)])
        : new Set<string>();

  const relatedFlows =
    candidateFlowIds.size === 0
      ? []
      : args.feature.dataflows.flows
          .filter((flow) => {
            const flowId = cleanText(flow?.flowId);
            return flowId && candidateFlowIds.has(flowId);
          })
          .map((flow) => ({
            flowId: cleanText(flow.flowId),
            pathId: cleanText(flow.pathId),
            summary: {
              dataItems: Array.isArray(flow.summary?.dataItems) ? flow.summary?.dataItems.map(cleanText).filter(Boolean) : [],
              collectionFrequency: Array.isArray(flow.summary?.collectionFrequency)
                ? flow.summary?.collectionFrequency.map(cleanText).filter(Boolean)
                : [],
              cloudUpload: Array.isArray(flow.summary?.cloudUpload) ? flow.summary?.cloudUpload.map(cleanText).filter(Boolean) : [],
              storageAndEncryption: Array.isArray(flow.summary?.storageAndEncryption)
                ? flow.summary?.storageAndEncryption.map(cleanText).filter(Boolean)
                : [],
              permissions: Array.isArray(flow.summary?.permissions) ? flow.summary?.permissions.map(cleanText).filter(Boolean) : [],
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

  const system = [
    '你是隐私合规报告助手。',
    '你只做一个二选一判断：相关数据是否会上传至应用服务端。',
    '你必须严格基于提供的证据判断。',
    '只要证据没有明确指向上传至应用服务端，就输出“相关数据仅在本地处理。”',
    '输出必须是严格 JSON，且 sentence 只能是以下两句之一：',
    `1) ${REPORT_SERVER_HANDLING_SENTENCE}`,
    `2) ${REPORT_LOCAL_HANDLING_SENTENCE}`,
  ].join('\n');

  const user = [
    `featureId: ${cleanText(args.feature.featureId)}`,
    `featureTitle: ${cleanText(args.feature.featureTitle) || '未识别'}`,
    `pageTitle: ${cleanText(args.feature.pageTitle) || '未识别'}`,
    '当前数据实践证据：',
    JSON.stringify(
      {
        businessScenario: cleanText(args.practice.businessScenario),
        dataSources: uniq((args.practice.dataSources ?? []).map(clauseText).filter(Boolean)),
        dataItems: uniq((args.practice.dataItems ?? []).map((item) => clauseText(item?.name)).filter(Boolean)),
        processingMethod: cleanText(args.practice.processingMethod),
        storageMethod: cleanText(args.practice.storageMethod),
        dataRecipients: (args.practice.dataRecipients ?? []).map((recipient) => ({
          name: cleanText(recipient?.name),
          inferred: Boolean(recipient?.inferred),
        })),
        processingPurpose: cleanText(args.practice.processingPurpose),
        relatedFlows,
      },
      null,
      2,
    ),
    '',
    '判断规则：',
    `- 只有在证据明确显示数据会发送、提交、同步到应用自己的服务端/后端时，才能输出“${REPORT_SERVER_HANDLING_SENTENCE}”`,
    `- 只要证据是本地日志、本地存储、系统能力调用、权限申请、监听回调，或者证据不足，都输出“${REPORT_LOCAL_HANDLING_SENTENCE}”`,
    '',
    '请输出：{"sentence":"..."}',
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
        jsonMode: true,
      });
      const parsed = safeJsonParse(res.content);
      const sentence = cleanText((parsed as any)?.sentence);
      return sentence === REPORT_SERVER_HANDLING_SENTENCE ? REPORT_SERVER_HANDLING_SENTENCE : REPORT_LOCAL_HANDLING_SENTENCE;
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
  return REPORT_LOCAL_HANDLING_SENTENCE;
}

async function handlingSentenceForPractice(args: {
  llm: LlmConfig;
  feature: ReportFeatureInput;
  practice: PrivacyDataPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): Promise<string> {
  return decideHandlingSentenceWithReportLlm(args);
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

function deterministicPermissionSentenceTokens(args: {
  feature: ReportFeatureInput;
  practice: PrivacyPermissionPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): PrivacyReportToken[] {
  const permissionName = normalizePermissionName(args.practice.permissionName);
  if (!permissionName) return [];

  const picked = pickValidRef(args.practice.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
  if (!picked) return [];
  const jumpTo = { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId };

  const scenario = clauseText(
    normalizeScenarioForReport(args.practice.businessScenario, {
      featureId: args.feature.featureId,
      featureTitle: args.feature.featureTitle,
      pageTitle: args.feature.pageTitle,
    }),
  );
  const purpose = purposeClauseText(args.practice.permissionPurpose);
  const denyImpact = clauseText(args.practice.denyImpact);
  const prefix = scenario ? `在“${scenario}”场景中，我们会调用` : '我们会调用';
  const permissionText = permissionReportLabel(permissionName, args.practice.authorizationMode);
  const suffix = purpose ? `，用于${purpose}。` : '。';

  return [
    { text: prefix },
    { text: permissionText, jumpTo },
    { text: suffix },
    ...(denyImpact ? [{ text: `若您拒绝授权，${denyImpact}。` }] : []),
  ];
}

function ensurePermissionsSectionTokens(args: {
  feature: ReportFeatureInput;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): PrivacyReportToken[] {
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
    const tokens = deterministicPermissionSentenceTokens({
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
    });
    if (tokens.length === 0) continue;
    if (merged.length > 0) merged.push({ text: '此外，' });
    for (const token of tokens) merged.push(token);
  }

  if (merged.length === 0 && args.feature.featureId === '__app_permissions') {
    const names = uniq(
      practices
        .map((practice) => permissionReportLabel(practice.permissionName, practice.authorizationMode))
        .filter(Boolean)
    );
    if (names.length > 0) {
      return [
        {
          text: `当前已在应用源码/配置扫描或 SDK API 权限映射中识别到以下权限：${names.join('、')}；但尚未定位到可回溯的功能点数据流，因此本章节暂不生成具体权限声明。`,
        },
      ];
    }
  }

  return merged;
}

function pushEntityListTokens(out: PrivacyReportToken[], entities: PrivacyReportToken[]): void {
  for (let i = 0; i < entities.length; i += 1) {
    out.push(entities[i]!);
    if (i === entities.length - 1) continue;
    if (entities.length === 2 || i === entities.length - 2) out.push({ text: '和' });
    else out.push({ text: '、' });
  }
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
    const dataSources = uniq((Array.isArray(practice.dataSources) ? practice.dataSources : []).map(clauseText).filter(Boolean));

    const entityTokens: PrivacyReportToken[] = [];
    for (const dataItem of practice.dataItems ?? []) {
      const name = clauseText(dataItem?.name);
      if (!name) continue;
      const picked = pickValidRef(dataItem?.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
      if (picked) {
        entityTokens.push({
          text: name,
          jumpTo: { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId },
        });
      } else {
        entityTokens.push({ text: name });
      }
    }
    if (entityTokens.length === 0) continue;

    const processingPurpose = purposeClauseText(practice.processingPurpose);
    if (out.length > 0) out.push({ text: '此外，' });
    const scenario = clauseText(
      normalizeScenarioForReport(practice.businessScenario, {
        featureId: args.feature.featureId,
        featureTitle: args.feature.featureTitle,
        pageTitle: args.feature.pageTitle,
      }),
    );
    if (scenario) out.push({ text: `在“${scenario}”场景中，` });
    out.push({ text: dataSources.length > 0 ? `我们会从${dataSources.join('、')}收集` : '我们会收集' });
    pushEntityListTokens(out, entityTokens);
    out.push({ text: processingPurpose ? `，用于${processingPurpose}。` : '。' });
    const handlingSentence = await handlingSentenceForPractice({
      llm: args.llm,
      feature: args.feature,
      practice,
      perFlowIndex: args.perFlowIndex,
    });
    out.push({
      text: handlingSentence,
    });
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

  const permissions: PrivacyReportSection[] = args.features.map((feature) => ({
    featureId: feature.featureId,
    tokens: ensurePermissionsSectionTokens({
      feature,
      facts: feature.facts,
      perFlowIndex: flowIndexes.get(feature.featureId),
    }),
  }));

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
