import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';
import { readJsonFile, walkFiles, writeJsonFile } from '../../utils/accessWorkspace.js';
import { loadCsvApiPermissions, loadPrivacyRules, type PrivacyRules } from '../extract/csv.js';
import { collectPermissionsFromApp, extractPermissionNames, normalizePermissionToken } from '../extract/app.js';
import type { Dataflow, DataflowsResult } from '../dataflow/types.js';
import type { PageFeaturesIndex, PagesIndex, PageEntryInfo, UiTreeResult } from '../feature/types.js';
import type { SinkRecord, SourceRecord } from '../extract/types.js';

import { sourceRecordToRef, type SourceRef } from '../extract/sources.js';

import { extractFeaturePrivacyFacts, type PrivacyFactsPermissionHint } from './facts.js';
import { analysisLog } from '../../utils/analysisLog.js';
import { getPermissionDisplayName } from './permissionDisplay.js';
import type {
  DataflowNodeRef,
  FeaturePrivacyFactsContent,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyReportFile,
  PrivacyReportSection,
  PrivacyReportToken,
} from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string; baseUrl?: string };
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
  outputText?: string;
  jumpTo: { featureId: string; flowId: string; nodeId: string };
};

type PrivacyReportDraft = {
  collectionAndUse: string[];
  permissions: string[];
};

type PermissionOccurrence = {
  permissionName: string;
  filePath: string;
  line: number;
  code: string;
};

type DataItemOccurrence = {
  dataItem: string;
  filePath: string;
  line: number;
  code: string;
};

type SyntheticPermissionFlowBuild = {
  dataflows: DataflowsResult;
  refsByPermission: Map<string, DataflowNodeRef[]>;
  refsByDataItem: Map<string, DataflowNodeRef[]>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll(/\s+/gu, ' ').trim();
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

function dataItemNodeId(dataItem: string): string {
  const normalized = cleanText(dataItem);
  const readable = sanitizeIdFragment(normalized);
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10);
  return `data:${readable}_${hash}`;
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
  dataItems: string[];
  dataItemOccurrences: DataItemOccurrence[];
}): SyntheticPermissionFlowBuild {
  const refsByPermission = new Map<string, DataflowNodeRef[]>();
  const refsByDataItem = new Map<string, DataflowNodeRef[]>();
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

  for (const dataItem of args.dataItems) {
    const occurrence = args.dataItemOccurrences.find((item) => item.dataItem === dataItem);
    if (!occurrence) continue;
    const nodeId = dataItemNodeId(dataItem);
    if (nodes.some((node) => node.id === nodeId)) {
      throw new Error(`合成数据流节点 ID 重复：${nodeId}`);
    }
    nodes.push({
      id: nodeId,
      filePath: occurrence.filePath,
      line: occurrence.line,
      code: occurrence.code || dataItem,
      description: `应用源码中包含${dataItem}的处理证据`,
      context: { startLine: occurrence.line, lines: [occurrence.code || dataItem] },
    });
    refsByDataItem.set(dataItem, [{ flowId, nodeId }]);
  }

  return {
    refsByPermission,
    refsByDataItem,
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
                  dataItems: args.dataItems.slice(),
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

        for (const permNameRaw of perms) {
          const permissionName = normalizePermissionName(permNameRaw);
          if (!permissionName) continue;
          const cur = byName.get(permissionName) ?? {
            permissionName,
            refs: [],
            apiDescriptions: new Set<string>(),
          };
          cur.refs.push({ flowId, nodeId });
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
    out.push({
      permissionName: item.permissionName,
      refs,
      apiDescriptions: Array.from(item.apiDescriptions).sort((a, b) => a.localeCompare(b)),
    });
  }

  return out.sort((a, b) => a.permissionName.localeCompare(b.permissionName));
}

function filterPermissionPracticesByKnownPermissions(args: {
  practices: PrivacyPermissionPractice[];
  knownPermissions: Set<string>;
}): { practices: PrivacyPermissionPractice[]; dropped: string[] } {
  const kept: PrivacyPermissionPractice[] = [];
  const dropped: string[] = [];
  for (const practice of args.practices ?? []) {
    const normalized = normalizePermissionToken(practice.permissionName);
    if (!normalized || !/^ohos\.permission\.[A-Za-z0-9_]+$/u.test(normalized)) {
      if (normalized) dropped.push(normalized);
      continue;
    }
    if (!args.knownPermissions.has(normalized)) {
      dropped.push(normalized);
      continue;
    }
    kept.push({ ...practice, permissionName: normalized });
  }
  return { practices: kept, dropped: Array.from(new Set(dropped)).sort((a, b) => a.localeCompare(b)) };
}

function filterDataPracticesByKnownDataItems(
  practices: PrivacyDataPractice[],
  knownDataItems: Set<string>,
): PrivacyDataPractice[] {
  return (practices ?? [])
    .map((practice) => ({
      ...practice,
      dataItems: (practice.dataItems ?? []).filter((item) => knownDataItems.has(cleanText(item.name))),
    }))
    .filter((practice) => practice.dataItems.length > 0);
}

function permissionAuthorizationMode(permissionName: string, dynamicPermissions: Set<string>): PermissionAuthorizationMode {
  return dynamicPermissions.has(normalizePermissionToken(permissionName)) ? 'dynamic' : 'preauthorized';
}

function completePermissionDescriptions(
  practices: PrivacyPermissionPractice[],
  model: string,
): PrivacyPermissionPractice[] {
  if (!model.toLowerCase().includes('privacy-two-stage')) return practices;
  return practices.map((practice) => {
    const permissionName = normalizePermissionToken(practice.permissionName);
    const displayName = cleanText(getPermissionDisplayName(permissionName)) || permissionName;
    const fallback = permissionFallbackDescription(permissionName, displayName);
    return {
      ...practice,
      businessScenario: cleanText(practice.businessScenario) || fallback.businessScenario,
      permissionPurpose: cleanText(practice.permissionPurpose) || fallback.permissionPurpose,
      denyImpact: cleanText(practice.denyImpact) || fallback.denyImpact,
    };
  });
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
    permissionPractices: permissions.map((permissionName) => {
      const displayName = cleanText(getPermissionDisplayName(permissionName)) || permissionName;
      const description = permissionFallbackDescription(permissionName, displayName);
      return {
        permissionName,
        authorizationMode: permissionAuthorizationMode(permissionName, dynamicPermissions),
        businessScenario: description.businessScenario,
        permissionPurpose: description.permissionPurpose,
        denyImpact: description.denyImpact,
        refs: refsByPermission.get(permissionName) ?? [],
      };
    }),
  };
}

function permissionFallbackDescription(
  permissionName: string,
  displayName: string,
): Pick<PrivacyPermissionPractice, 'businessScenario' | 'permissionPurpose' | 'denyImpact'> {
  const token = permissionName.toUpperCase();
  const capability = displayName.replace(/权限$/u, '');
  if (/(INTERNET|NETWORK|WIFI)/u.test(token)) {
    return {
      businessScenario: '应用加载在线内容或检查网络连接时',
      permissionPurpose: '访问网络并确认当前连接状态',
      denyImpact: '在线内容将无法加载，依赖网络的操作也无法完成',
    };
  }
  if (/LOCATION/u.test(token)) {
    return {
      businessScenario: '用户使用定位、地图或位置相关服务时',
      permissionPurpose: '获取设备位置并提供位置服务',
      denyImpact: '应用将无法获取位置或持续提供位置服务',
    };
  }
  if (/(CAMERA|MEDIA|IMAGE|PHOTO)/u.test(token)) {
    return {
      businessScenario: '用户拍摄、选择或保存图片和媒体内容时',
      permissionPurpose: '访问相机或媒体文件以完成用户选择的操作',
      denyImpact: '拍摄、选择或保存媒体内容的操作将无法完成',
    };
  }
  if (/(MICROPHONE|AUDIO)/u.test(token)) {
    return {
      businessScenario: '用户使用录音或语音功能时',
      permissionPurpose: '采集音频以完成录音或语音操作',
      denyImpact: '录音和语音输入功能将无法使用',
    };
  }
  if (/(HEALTH|ACTIVITY|ACCELEROMETER|SENSOR)/u.test(token)) {
    return {
      businessScenario: '用户使用运动或健康服务时',
      permissionPurpose: '读取或记录运动健康数据',
      denyImpact: '运动或健康数据将无法读取、记录或更新',
    };
  }
  if (/(BLUETOOTH|DISTRIBUTED|DEVICE|CERT)/u.test(token)) {
    return {
      businessScenario: '应用识别设备或连接设备服务时',
      permissionPurpose: '识别当前设备并完成设备连接或安全校验',
      denyImpact: '设备识别、连接或安全校验操作将无法完成',
    };
  }
  if (/(SMS|PHONE|CONTACT)/u.test(token)) {
    return {
      businessScenario: '用户使用手机号码、短信或联系人服务时',
      permissionPurpose: '完成号码验证、短信接收或联系人操作',
      denyImpact: '号码验证、短信接收或联系人操作将无法完成',
    };
  }
  if (/VIBRATE/u.test(token)) {
    return {
      businessScenario: '应用通过振动向用户提供操作反馈时',
      permissionPurpose: '触发设备振动以提示操作状态',
      denyImpact: '应用将无法通过振动提供操作反馈',
    };
  }
  return {
    businessScenario: `应用执行需要${capability}的操作时`,
    permissionPurpose: `调用${capability}以完成用户选择的操作`,
    denyImpact: `依赖${capability}的操作将无法完成`,
  };
}

async function collectConfiguredDataItemsFromApp(
  repoRoot: string,
  appDirAbs: string,
  rules: PrivacyRules,
): Promise<{ names: Set<string>; occurrences: DataItemOccurrence[] }> {
  const files = await walkFiles(appDirAbs, {
    extensions: ['.ets', '.ts', '.js', '.json', '.json5'],
    ignoreDirNames: ['node_modules', '.git', 'output', 'dist', 'build', 'ohosTest', 'hvigor'],
  });
  const names = new Set<string>();
  const occurrences: DataItemOccurrence[] = [];
  for (const filePath of files) {
    const text = await fs.readFile(filePath, 'utf8').catch(() => '');
    const lower = text.toLowerCase();
    for (const rule of rules.dataItems) {
      if (names.has(rule.outputName)) continue;
      const keyword = rule.keywords.find((candidate) => lower.includes(candidate.toLowerCase()));
      if (!keyword) continue;
      const index = lower.indexOf(keyword.toLowerCase());
      const line = text.slice(0, index).split(/\r?\n/u).length;
      const code = text.split(/\r?\n/u)[line - 1]?.trim() ?? keyword;
      names.add(rule.outputName);
      occurrences.push({
        dataItem: rule.outputName,
        filePath: path.relative(repoRoot, filePath).split(path.sep).join('/'),
        line,
        code,
      });
    }
  }
  return { names, occurrences };
}

function fallbackDataProfile(
  name: string,
  occurrence?: DataItemOccurrence,
): Omit<PrivacyDataPractice, 'dataItems' | 'dataRecipients'> {
  const evidence = `${occurrence?.filePath ?? ''} ${occurrence?.code ?? ''}`.toLowerCase();
  const userProfileItems = new Set([
    '姓名', '昵称', '性别', '年龄', '年龄段', '出生日期', '年级', '国家', '民族', '工作信息', '收入状况',
    '房屋数据', '身高', '体重', '婚姻状况', '家庭成员信息', '教育背景',
  ]);
  if (userProfileItems.has(name) && !(name === '昵称' && /(class\s+mediainfo|this\.data\.nickname|viewmodel)/u.test(evidence))) {
    return {
      businessScenario: '用户填写或提交个人资料时',
      processingSubject: '本应用',
      dataSources: ['用户主动输入'],
      processingMethod: '收集并校验用户填写的资料',
      storageMethod: '在用户提交资料及页面展示期间处理',
      processingPurpose: '完成个人资料登记和展示',
    };
  }
  if (name === '登录账号' || name === '登录密码' || name === '手机号码' || name === '授权码') {
    return {
      businessScenario: '用户登录或验证账号时',
      processingSubject: '本应用',
      dataSources: name === '授权码' ? ['账号服务返回'] : ['用户主动输入或授权'],
      processingMethod: '收集并校验登录凭据',
      storageMethod: '仅在完成本次登录验证所需期间处理',
      processingPurpose: '完成账号登录和身份验证',
    };
  }
  if (name === '搜索关键词' || name === '用户输入内容' || name === '聊天内容') {
    return {
      businessScenario: name === '聊天内容' ? '用户编辑或发送聊天消息时' : '用户输入并提交内容时',
      processingSubject: '本应用',
      dataSources: ['用户主动输入'],
      processingMethod: '接收并处理用户提交的内容',
      storageMethod: '在完成本次输入、搜索或发送操作所需期间处理',
      processingPurpose: name === '聊天内容' ? '发送和展示聊天消息' : '响应用户输入并返回对应结果',
    };
  }
  if (['商户号', '预支付交易会话标识', '授权标识', '预签约编号'].includes(name)) {
    return {
      businessScenario: '用户发起支付、授权或签约操作时',
      processingSubject: '本应用',
      dataSources: ['支付或签约服务返回'],
      processingMethod: '读取并提交交易所需参数',
      storageMethod: '仅在完成本次支付、授权或签约操作期间处理',
      processingPurpose: '完成支付、授权或签约请求',
    };
  }
  if (name === '位置信息' || name === '步数数据' || name === '运动健康数据') {
    return {
      businessScenario: name === '位置信息' ? '用户使用定位或地图服务时' : '用户使用运动健康服务时',
      processingSubject: '本应用',
      dataSources: ['设备传感器或系统服务'],
      processingMethod: '读取并计算设备提供的数据',
      storageMethod: '在提供本次位置或运动健康服务期间处理',
      processingPurpose: name === '位置信息' ? '提供定位和位置展示服务' : '统计并展示运动健康结果',
    };
  }
  if (['设备标识信息', '匿名设备标识符', '设备信息', 'IP地址', '应用唯一标识符'].includes(name)) {
    return {
      businessScenario: '应用识别当前设备并建立服务连接时',
      processingSubject: '本应用',
      dataSources: name === '应用唯一标识符' ? ['应用本地生成'] : ['设备或系统服务返回'],
      processingMethod: '读取并用于设备识别或连接校验',
      storageMethod: '在设备识别和服务连接所需期间处理',
      processingPurpose: '识别设备并保障服务正常连接',
    };
  }
  if (name === 'Cookie') {
    return {
      businessScenario: '应用访问网络服务并维持登录会话时',
      processingSubject: '本应用',
      dataSources: ['网络服务返回'],
      processingMethod: '读取、写入并随网络请求发送会话信息',
      storageMethod: '按照网络会话有效期保存和更新',
      processingPurpose: '维持登录状态和网络会话',
    };
  }
  if (name === '昵称' && /(class\s+mediainfo|this\.data\.nickname|viewmodel)/u.test(evidence)) {
    const fromNetwork = /(class\s+mediainfo|viewmodel)/u.test(evidence);
    return {
      businessScenario: fromNetwork ? '应用展示内容作者信息时' : '应用展示已有用户资料时',
      processingSubject: '本应用',
      dataSources: [fromNetwork ? '网络服务返回' : '应用业务数据'],
      processingMethod: '读取并展示已有昵称',
      storageMethod: '在页面展示所需期间处理',
      processingPurpose: '展示内容作者或用户昵称',
    };
  }
  if (name === '头像图片' || name === '通讯录信息' || name === '用户身份信息') {
    const networkAvatar = name === '头像图片' && /avatar_url/u.test(evidence);
    return {
      businessScenario: networkAvatar
        ? '应用展示内容作者头像时'
        : name === '头像图片' ? '用户查看或设置头像时' : '用户查看身份或联系人信息时',
      processingSubject: '本应用',
      dataSources: networkAvatar ? ['网络服务返回'] : name === '头像图片' ? ['用户选择或业务服务返回'] : ['应用业务数据'],
      processingMethod: '读取并展示用户选择或业务已有的信息',
      storageMethod: '在页面展示或用户操作所需期间处理',
      processingPurpose: networkAvatar ? '展示内容作者头像' : name === '头像图片' ? '展示或更新用户头像' : '展示身份或联系人信息',
    };
  }
  return {
    businessScenario: `应用提供${name}所对应的服务时`,
    processingSubject: '本应用',
    dataSources: ['应用业务数据'],
    processingMethod: `读取并处理${name}`,
    storageMethod: '仅在完成用户操作所需期间处理',
    processingPurpose: `完成用户选择的${name}操作`,
  };
}

function buildFallbackDataPractices(
  dataItems: string[],
  refsByDataItem: Map<string, DataflowNodeRef[]>,
  dataItemOccurrences: DataItemOccurrence[],
): PrivacyDataPractice[] {
  const grouped = new Map<string, PrivacyDataPractice>();
  for (const name of dataItems) {
    const occurrence = dataItemOccurrences.find((item) => item.dataItem === name);
    const profile = fallbackDataProfile(name, occurrence);
    const key = JSON.stringify(profile);
    const existing = grouped.get(key);
    if (existing) {
      existing.dataItems.push({ name, refs: refsByDataItem.get(name) ?? [] });
      continue;
    }
    grouped.set(key, {
      ...profile,
      dataItems: [{ name, refs: refsByDataItem.get(name) ?? [] }],
      dataRecipients: [],
    });
  }
  return Array.from(grouped.values());
}

function mergeSyntheticModelFacts(
  seed: FeaturePrivacyFactsContent,
  modelFacts: FeaturePrivacyFactsContent,
  model: string,
): FeaturePrivacyFactsContent {
  const preserveSeed = model.toLowerCase().includes('privacy-two-stage');
  const permissionsByName = new Map(
    (modelFacts.permissionPractices ?? []).map((practice) => [normalizePermissionToken(practice.permissionName), practice]),
  );
  const modelDataPractices = modelFacts.dataPractices ?? [];

  return {
    permissionPractices: seed.permissionPractices.map((practice) => {
      const model = permissionsByName.get(normalizePermissionToken(practice.permissionName));
      return {
        ...practice,
        businessScenario: cleanText(model?.businessScenario) || (preserveSeed ? practice.businessScenario : ''),
        permissionPurpose: cleanText(model?.permissionPurpose) || (preserveSeed ? practice.permissionPurpose : ''),
        denyImpact: cleanText(model?.denyImpact) || (preserveSeed ? practice.denyImpact : ''),
      };
    }),
    dataPractices: seed.dataPractices.flatMap((practice) => {
      const groups = new Map<PrivacyDataPractice | undefined, PrivacyDataPractice['dataItems']>();
      for (const dataItem of practice.dataItems) {
        const seedRefs = new Set(dataItem.refs.map((ref) => `${ref.flowId}\u0000${ref.nodeId}`));
        const model =
          modelDataPractices.find((candidate) =>
            candidate.dataItems.some(
            (item) =>
              cleanText(item.name) === cleanText(dataItem.name) ||
              item.refs.some((ref) => seedRefs.has(`${ref.flowId}\u0000${ref.nodeId}`)),
            ),
          ) ?? (modelDataPractices.length === 1 ? modelDataPractices[0] : undefined);
        groups.set(model, [...(groups.get(model) ?? []), dataItem]);
      }
      return Array.from(groups.entries()).map(([model, dataItems]) => ({
        businessScenario: cleanText(model?.businessScenario) || (preserveSeed ? practice.businessScenario : ''),
        processingSubject: cleanText(model?.processingSubject) || (preserveSeed ? practice.processingSubject : ''),
        dataSources:
          Array.isArray(model?.dataSources) && model.dataSources.length > 0
            ? model.dataSources
            : preserveSeed
              ? practice.dataSources
              : [],
        dataItems,
        processingMethod: cleanText(model?.processingMethod) || (preserveSeed ? practice.processingMethod : ''),
        storageMethod: cleanText(model?.storageMethod) || (preserveSeed ? practice.storageMethod : ''),
        dataRecipients: model?.dataRecipients ?? [],
        processingPurpose: cleanText(model?.processingPurpose) || (preserveSeed ? practice.processingPurpose : ''),
      }));
    }),
  };
}

function selectDataflowRefs(dataflows: DataflowsResult, refs: DataflowNodeRef[]): DataflowsResult {
  const wanted = new Set(refs.map((ref) => `${ref.flowId}\u0000${ref.nodeId}`));
  const flows = (dataflows.flows ?? [])
    .map((flow) => ({
      ...flow,
      nodes: (flow.nodes ?? []).filter((node) => wanted.has(`${flow.flowId}\u0000${node.id}`)),
    }))
    .filter((flow) => flow.nodes.length > 0);
  return {
    ...dataflows,
    flows,
    meta: {
      ...dataflows.meta,
      counts: {
        ...dataflows.meta.counts,
        flows: flows.length,
        nodes: flows.reduce((sum, flow) => sum + flow.nodes.length, 0),
        edges: 0,
      },
    },
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
  analysisLog('隐私报告生成开始');
  const reportPath = path.join(args.outputDirAbs, 'privacy_report.json');
  const reportTextPath = path.join(args.outputDirAbs, 'privacy_report.txt');

  try {
    const metaRaw = await tryReadJson<any>(path.join(args.outputDirAbs, 'meta.json'));
    const csvDirFromMeta = cleanText(metaRaw?.input?.csvDir);
    const csvDirAbs = csvDirFromMeta ? toAbs(args.repoRoot, csvDirFromMeta) : path.join(args.repoRoot, 'input', 'csv');
    const csvPermissions = await loadCsvApiPermissions(csvDirAbs);
    const privacyRules = await loadPrivacyRules(csvDirAbs);

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

    pagesIndex.pages = (pagesIndex.pages ?? []).filter((page) => page.pageId !== '_app_permissions');
    pagesIndex.meta.counts.pages = pagesIndex.pages.length;
    pagesIndex.meta.counts.features = pagesIndex.pages.reduce((sum, page) => sum + page.counts.features, 0);
    pagesIndex.meta.counts.flows = pagesIndex.pages.reduce((sum, page) => sum + page.counts.flows, 0);

    for (const p of pagesIndex.pages) {
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
    analysisLog(`隐私事实抽取准备：${featureList.length} 个功能点，LLM=${apiKey ? '启用' : '未启用'}`);

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
    const configuredDataItems = await collectConfiguredDataItemsFromApp(args.repoRoot, appDirAbs, privacyRules).catch(() => ({
      names: new Set<string>(),
      occurrences: [] as DataItemOccurrence[],
    }));
    const knownAppDataItems = configuredDataItems.names;
    const emittedPermissions = new Set<string>();
    const emittedDataItems = new Set<string>();
    const orphanPermissionNames = new Set<string>();

    const featuresForReport: ReportFeatureInput[] = [];

    const concurrency = (() => {
      const raw = Number(process.env.LLM_REQUEST_CONCURRENT ?? 5);
      if (!Number.isFinite(raw) || raw <= 0) return 5;
      return Math.max(1, Math.floor(raw));
    })();

    analysisLog(`隐私事实处理开始：${featureList.length} 个功能点（并发数：${concurrency}）`);

    // 并发批次处理
    for (let batchStart = 0; batchStart < featureList.length; batchStart += concurrency) {
      const batchEnd = Math.min(batchStart + concurrency, featureList.length);
      const batch = featureList.slice(batchStart, batchEnd);

      const batchPromises = batch.map(async (item, batchIndex) => {
        const featureIndex = batchStart + batchIndex;
        const pageId = item.pageId;
        const feature = item.feature;
        const featureId = feature.featureId;
        const startTime = Date.now();
        analysisLog(`隐私事实处理：${featureIndex + 1}/${featureList.length}（${featureId}）`);
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
      const reuseExistingFacts = Boolean(process.env.PRIVACY_ONLY_SYNTHETIC);
      if (reuseExistingFacts) {
        facts =
          (await tryReadJson<FeaturePrivacyFactsContent>(path.join(dirAbs, 'privacy_facts.json'))) ??
          facts;
      }

      const permissionHints = derivePermissionHintsFromCsv({
        featureId,
        featureTitle: feature.title,
        pageTitle: cleanText(item.pageEntry.description),
        dataflows,
        sinksByCallsite,
        csvPermissions,
      });
      const useBatchedEvidenceExtraction = /(?:privacy-two-stage|qwen35-0\.8b-base)/iu.test(args.llm.model);

      if (
        !reuseExistingFacts &&
        apiKey &&
        pageId !== 'AppLifecycle' &&
        !useBatchedEvidenceExtraction &&
        Array.isArray(dataflows.flows) &&
        dataflows.flows.length > 0
      ) {
        try {
          const extracted = await extractFeaturePrivacyFacts({
            runId: args.runId,
            appName: args.appName,
            feature: featureContext,
            dataflows,
            uiTree,
            llm: { provider: args.llm.provider, apiKey, model: args.llm.model, baseUrl: args.llm.baseUrl },
            permissionHints,
            privacyRules,
          });
          facts = extracted.content;
        } catch (e) {
          void e;
        }
      }

      facts.dataPractices = filterDataPracticesByKnownDataItems(facts.dataPractices, knownAppDataItems);
      const filtered = filterPermissionPracticesByKnownPermissions({
        practices: facts.permissionPractices,
        knownPermissions: knownAppPermissions,
      });
      facts.permissionPractices = applyPermissionAuthorizationModes(
        completePermissionDescriptions(filtered.practices, args.llm.model),
        dynamicAppPermissions,
      );
      const flowIndex = buildFlowNodeIndex(dataflows);
      const anchoredPractices: PrivacyPermissionPractice[] = [];
      for (const practice of facts.permissionPractices) {
        const permissionName = normalizePermissionToken(practice.permissionName);
        if (!permissionName) continue;
        const picked = pickValidRef(Array.isArray(practice.refs) ? practice.refs : [], flowIndex);
        anchoredPractices.push({
          ...practice,
          permissionName,
          refs: uniqRefs(Array.isArray(practice.refs) ? practice.refs : []),
        });
        if (!picked) {
          orphanPermissionNames.add(permissionName);
          continue;
        }
        emittedPermissions.add(permissionName);
      }
      facts.permissionPractices = anchoredPractices;
      for (const practice of facts.dataPractices) {
        for (const dataItem of practice.dataItems ?? []) {
          const name = cleanText(dataItem.name);
          if (name) emittedDataItems.add(name);
        }
      }

        await writeJsonFile(path.join(dirAbs, 'privacy_facts.json'), facts);

        const elapsed = Date.now() - startTime;
        analysisLog(`隐私事实完成：${featureIndex + 1}/${featureList.length}（${featureId}），${elapsed}ms`);

        return {
          featureId,
          featureTitle: feature.title,
          pageTitle: cleanText(item.pageEntry.description),
          facts,
          dataflows,
          permissionNames: anchoredPractices.map(p => normalizePermissionToken(p.permissionName)).filter(Boolean),
          dataItems: facts.dataPractices.flatMap(practice =>
            (practice.dataItems ?? []).map(d => cleanText(d.name)).filter(Boolean)
          ),
          orphanPermissions: anchoredPractices
            .filter(p => {
              const permissionName = normalizePermissionToken(p.permissionName);
              if (!permissionName) return false;
              const picked = pickValidRef(Array.isArray(p.refs) ? p.refs : [], flowIndex);
              return !picked;
            })
            .map(p => normalizePermissionToken(p.permissionName))
            .filter(Boolean),
        };
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        featuresForReport.push({
          featureId: result.featureId,
          featureTitle: result.featureTitle,
          pageTitle: result.pageTitle,
          facts: result.facts,
          dataflows: result.dataflows,
        });

        for (const permissionName of result.permissionNames) {
          emittedPermissions.add(permissionName);
        }
        for (const orphan of result.orphanPermissions) {
          orphanPermissionNames.add(orphan);
        }
        for (const dataItem of result.dataItems) {
          emittedDataItems.add(dataItem);
        }
      }
    }

    const unmatchedPermissions = Array.from(knownAppPermissions)
      .filter((permission) => !emittedPermissions.has(permission) || orphanPermissionNames.has(permission))
      .sort((a, b) => a.localeCompare(b));
    const unmatchedDataItems = Array.from(knownAppDataItems)
      .filter((dataItem) => !emittedDataItems.has(dataItem))
      .sort((a, b) => a.localeCompare(b));

    if (unmatchedPermissions.length > 0 || unmatchedDataItems.length > 0) {
      const pageId = '_app_permissions';
      const featureId = '__app_permissions';
      const syntheticFlowBuild = buildSyntheticPermissionFlows({
        runId: args.runId,
        featureId,
        permissions: unmatchedPermissions,
        occurrences: permissionOccurrences,
        sinks,
        csvPermissions,
        dataItems: unmatchedDataItems,
        dataItemOccurrences: configuredDataItems.occurrences,
      });
      const seedSyntheticFacts = buildAppDeclaredPermissionFacts(
        unmatchedPermissions,
        dynamicAppPermissions,
        syntheticFlowBuild.refsByPermission,
      );
      seedSyntheticFacts.dataPractices = buildFallbackDataPractices(
        unmatchedDataItems,
        syntheticFlowBuild.refsByDataItem,
        configuredDataItems.occurrences,
      );
      const syntheticWarnings = [
        ...(unmatchedPermissions.length > 0
          ? [`以下权限来自应用源码/配置扫描或 SDK API 权限映射，当前未定位到具体功能点数据流：${unmatchedPermissions.join(', ')}`]
          : []),
        ...(unmatchedDataItems.length > 0
          ? [`以下个人信息数据项来自应用源码扫描，当前未定位到具体功能点数据流：${unmatchedDataItems.join(', ')}`]
          : []),
      ];
      const syntheticDataflows: DataflowsResult = {
        ...syntheticFlowBuild.dataflows,
        meta: {
          ...syntheticFlowBuild.dataflows.meta,
          warnings: syntheticWarnings,
        },
      };
      let modelSyntheticFacts: FeaturePrivacyFactsContent = { dataPractices: [], permissionPractices: [] };
      if (!process.env.PRIVACY_SKIP_SYNTHETIC_LLM && apiKey && syntheticDataflows.flows.length > 0) {
        const baseFeature = {
            featureId,
            title: '应用权限与个人信息处理',
            kind: 'source' as const,
            anchor: { filePath: 'app_permissions', line: 1, functionName: 'permissions' },
            page: {
              pageId,
              entry: {
                filePath: 'app_permissions',
                structName: 'AppPermissions',
                line: 1,
                description: '应用权限与个人信息处理',
              },
            },
            sources: [],
        };
        const permissionBatchSize = 2;
        for (let start = 0; start < unmatchedPermissions.length; start += permissionBatchSize) {
          const batch = unmatchedPermissions.slice(start, start + permissionBatchSize);
          const refs = batch.flatMap((permissionName) => syntheticFlowBuild.refsByPermission.get(permissionName) ?? []);
          if (refs.length === 0) continue;
          try {
            const permissionFacts = await extractFeaturePrivacyFacts({
              runId: args.runId,
              appName: args.appName,
              feature: { ...baseFeature, title: `权限使用：${batch.join('、')}` },
              dataflows: selectDataflowRefs(syntheticDataflows, refs),
              uiTree: null,
              llm: { provider: args.llm.provider, apiKey, model: args.llm.model, baseUrl: args.llm.baseUrl },
              permissionHints: batch.map((permissionName) => ({
              permissionName,
              refs: syntheticFlowBuild.refsByPermission.get(permissionName) ?? [],
              apiDescriptions: [],
              })),
              privacyRules,
            });
            modelSyntheticFacts.permissionPractices.push(...permissionFacts.content.permissionPractices);
          } catch {
            // Keep successful permission batches when one request fails.
          }
        }
        const batchSize = 3;
        for (let start = 0; start < unmatchedDataItems.length; start += batchSize) {
          const batch = unmatchedDataItems.slice(start, start + batchSize);
          const refs = batch.flatMap((name) => syntheticFlowBuild.refsByDataItem.get(name) ?? []);
          if (refs.length === 0) continue;
          try {
            const extracted = await extractFeaturePrivacyFacts({
              runId: args.runId,
              appName: args.appName,
              feature: { ...baseFeature, title: `个人信息处理：${batch.join('、')}` },
              dataflows: selectDataflowRefs(syntheticDataflows, refs),
              uiTree: null,
              llm: { provider: args.llm.provider, apiKey, model: args.llm.model, baseUrl: args.llm.baseUrl },
              privacyRules,
            });
            modelSyntheticFacts.dataPractices.push(...extracted.content.dataPractices);
          } catch {
            // Keep successful batches when one model request fails.
          }
        }
      }
      const syntheticFacts = mergeSyntheticModelFacts(seedSyntheticFacts, modelSyntheticFacts, args.llm.model);
      const syntheticDirAbs = path.join(args.outputDirAbs, 'app_permissions');
      const syntheticPageDirAbs = toPageDir(args.outputDirAbs, pageId);
      const syntheticFeatureDirAbs = toFeatureDir(args.outputDirAbs, pageId, featureId);
      await fs.mkdir(path.join(syntheticPageDirAbs, 'features'), { recursive: true });
      await fs.mkdir(syntheticFeatureDirAbs, { recursive: true });
      await writeJsonFile(path.join(syntheticDirAbs, 'dataflows.json'), syntheticDataflows);
      await writeJsonFile(path.join(syntheticDirAbs, 'privacy_facts.json'), syntheticFacts);
      await writeJsonFile(path.join(syntheticFeatureDirAbs, 'dataflows.json'), syntheticDataflows);
      await writeJsonFile(path.join(syntheticFeatureDirAbs, 'privacy_facts.json'), syntheticFacts);
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
        llm: {
          provider: args.llm.provider,
          apiKey: process.env.PRIVACY_SKIP_REPORT_LLM ? '' : apiKey,
          model: args.llm.model,
          baseUrl: args.llm.baseUrl,
        },
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

function collectionAnchorsForFacts(args: {
  feature: ReportFeatureInput;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): ParagraphAnchor[] {
  const out: ParagraphAnchor[] = [];
  const seen = new Set<string>();
  for (const practice of asDataPractices(args.facts)) {
    for (const dataItem of practice.dataItems ?? []) {
      const name = clauseText(dataItem?.name);
      if (!name || isNonDisclosableCollectionDataItem(name) || seen.has(name)) continue;
      const picked = pickValidRef(dataItem?.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
      if (!picked) continue;
      seen.add(name);
      out.push({
        name,
        jumpTo: { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId },
      });
    }
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

function isNonDisclosableCollectionDataItem(text: string): boolean {
  const value = cleanText(text);
  if (!value) return true;
  return /(日志|log\b|错误堆栈|stack\b|调试|debug\b|上下文|context\b|内部状态|状态标识|配置参数|生命周期)/iu.test(value);
}

async function reportDraftForPrivacyFacts(args: { llm: LlmConfig; facts: FeaturePrivacyFactsContent }): Promise<PrivacyReportDraft> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey) return { collectionAndUse: [], permissions: [] };
  const system = [
    '你是隐私声明报告助手。',
    '你将收到一个功能点的 privacy_facts.json；user 消息只包含该 JSON。',
    '请只基于输入 JSON 生成隐私声明报告段落，不得新增输入中不存在的数据项、权限、接收方、用途或业务场景。',
    '输出必须是严格 JSON，不要输出 Markdown、标题或解释。',
    '输出结构必须是：{"collectionAndUse": string[], "permissions": string[]}。',
    '如果没有适合写入的内容，对应数组必须为空数组。',
    '如果 collectionAndUse 段落提到数据项，必须直接使用 dataItems[].name 原文。',
    '如果 permissions 段落提到权限，必须直接使用 permissionPractices[].permissionName 原文，不要改写、翻译或追加后缀。',
    'permissions 是“设备权限调用”章节的完整声明段落数组，不是权限名称列表。',
    'permissions 的每个元素必须是完整中文句子，不能只包含 permissionPractices[].permissionName，也不能只是多个 permissionName 的拼接。',
    '如果无法写成完整权限声明段落，应跳过该权限，不要输出权限名列表。',
    '日志、生命周期状态、页面控制状态、路由参数、权限状态、设备参数、索引、内部状态变量等，不应写入个人信息段。',
  ].join('\n');

  const user = JSON.stringify(args.facts, null, 2);

  const baseUrls = resolveLlmBaseUrls(args.llm.provider, args.llm.baseUrl);
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
        maxTokens: 1024,
        jsonMode: true,
        enableThinking: false,
        timeoutMs: 20_000,
      });
      return parsePrivacyReportDraft(res.content);
    } catch (error) {
      lastError = error;
      const canRetry =
        baseUrls.length > 1 &&
        (error instanceof LlmNetworkError ||
          (error instanceof LlmHttpError && (error.status === 401 || error.status === 404 || error.status >= 500)));
      if (!canRetry) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
    out.push({ text: matched.outputText ?? matched.name, jumpTo: matched.jumpTo });
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

function readableReportText(value: unknown): string {
  const text = clauseText(value);
  if (!text || /^(无|空|未知|none|null)$/iu.test(text)) return '';
  if (/(?:[A-Za-z]+\s+){2,}[A-Za-z]+[.!]?/u.test(text)) return '';
  if (
    /(系统或框架接口|所选代码链|具体存储形态见代码链|本地处理或调用系统能力|相关模块执行|能力创建|权限\s*[:：]|数据\s*[:：]|Promise\s*方式|\s\/\s|Sink点|\bAPI\b|系统API|atomicService|getSystemInfo|deviceOrientation|宽度宽度|用户点击操作|为.+需要)/iu.test(
      text,
    )
  ) {
    return '';
  }
  return text;
}

function scenarioLead(value: string): string {
  const scenario = value.replace(/^在/u, '').trim();
  const broadOperation = scenario.match(/^所有涉及(.+?)的操作时?$/u);
  if (broadOperation) return `当用户进行${broadOperation[1]}时，`;
  if (scenario.startsWith('当')) return `${scenario}，`;
  if (scenario.startsWith('用户在')) return `当${scenario}，`;
  if (scenario.includes('时') && !scenario.endsWith('时')) return `当${scenario}，`;
  return scenario.endsWith('时') ? `在${scenario}，` : `在${scenario}时，`;
}

function reportPurposeText(value: unknown, fallback: string): string {
  const text = readableReportText(value).replace(/^用于/u, '');
  return text || fallback;
}

function draftNeedsFallback(paragraphs: string[]): boolean {
  return paragraphs.some((paragraph) =>
    /(用于用于|来自无|权限（(?:动态|预)授权）\s*权限|权限\s*[:：]|数据接收方为空|Promise\s*方式|数据\s*[:：]|\s\/\s|系统或框架接口|所选代码链|具体存储形态见代码链|本地处理或调用系统能力|相关模块执行|能力创建|在用户在|在所有涉及|Sink点|\bAPI\b|系统API|atomicService|getSystemInfo|deviceOrientation|宽度宽度|(?:[A-Za-z]+\s+){2,}[A-Za-z]+)/u.test(
      paragraph,
    ),
  );
}

function deterministicReportDraft(facts: FeaturePrivacyFactsContent): PrivacyReportDraft {
  const collectionAndUse = asDataPractices(facts).flatMap((practice) => {
    const names = uniq(
      (practice.dataItems ?? [])
        .map((item) => clauseText(item.name))
        .filter((name) => name && !isNonDisclosableCollectionDataItem(name)),
    );
    if (names.length === 0) return [];

    const profile = fallbackDataProfile(names[0] ?? '相关信息');
    const scenario = readableReportText(practice.businessScenario) || profile.businessScenario;
    const subject = readableReportText(practice.processingSubject) || '本应用';
    const sources = uniq((practice.dataSources ?? []).map(readableReportText).filter(Boolean));
    const resolvedSources = sources.length > 0 ? sources : profile.dataSources;
    const method = readableReportText(practice.processingMethod) || profile.processingMethod;
    const purpose = reportPurposeText(practice.processingPurpose, profile.processingPurpose);
    const storage = readableReportText(practice.storageMethod) || profile.storageMethod;
    const recipients = uniq((practice.dataRecipients ?? []).map((item) => readableReportText(item.name)).filter(Boolean));
    const sourceText = resolvedSources.length > 0 ? `，数据来源为${resolvedSources.join('、')}` : '';
    const storageText = storage ? `数据将按照“${storage}”方式处理。` : '';
    const recipientText = recipients.length > 0 ? `数据接收方为${recipients.join('、')}。` : '';
    const paragraphs: string[] = [];
    for (let index = 0; index < names.length; index += 8) {
      const chunk = names.slice(index, index + 8);
      paragraphs.push(
        `${scenarioLead(scenario)}${subject}会收集和使用${chunk.join('、')}${sourceText}，处理方式为${method}，用于${purpose}。${storageText}${recipientText}`,
      );
    }
    return paragraphs;
  });

  const permissions = asPermissionPractices(facts).flatMap((practice) => {
    const permissionName = normalizePermissionName(practice.permissionName);
    if (!/^ohos\.permission\.[A-Za-z0-9_]+$/u.test(permissionName)) return [];
    const displayName = cleanText(getPermissionDisplayName(permissionName)) || permissionName;
    const fallback = permissionFallbackDescription(permissionName, displayName);
    const scenario = readableReportText(practice.businessScenario) || fallback.businessScenario;
    const purpose = reportPurposeText(practice.permissionPurpose, fallback.permissionPurpose);
    const denyImpact = (readableReportText(practice.denyImpact) || fallback.denyImpact).replace(
      /^(?:拒绝授权后|缺少该权限后|未授权时)[，,]?/u,
      '',
    );
    return [`${scenarioLead(scenario)}本应用会申请 ${permissionName}，${purpose}；如果您拒绝授权，${denyImpact}。`];
  });

  return { collectionAndUse, permissions };
}

function permissionAnchorsForFacts(args: {
  feature: ReportFeatureInput;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): ParagraphAnchor[] {
  const out: ParagraphAnchor[] = [];
  const seen = new Set<string>();
  const practices = asPermissionPractices(args.facts)
    .map((practice) => ({
      ...practice,
      permissionName: normalizePermissionName(practice.permissionName),
      refs: Array.isArray(practice.refs) ? practice.refs : [],
    }))
    .filter((practice) => Boolean(practice.permissionName));

  for (const practice of practices) {
    const permissionName = practice.permissionName;
    if (seen.has(permissionName)) continue;
    const picked = pickValidRef(practice.refs as Array<{ flowId: string; nodeId: string }> | undefined, args.perFlowIndex);
    if (!picked) continue;
    seen.add(permissionName);
    out.push({
      name: permissionName,
      outputText: permissionReportLabel(permissionName, practice.authorizationMode),
      jumpTo: { featureId: args.feature.featureId, flowId: picked.flowId, nodeId: picked.nodeId },
    });
  }

  return out;
}

function tokensFromDraftParagraphs(paragraphs: string[], anchors: ParagraphAnchor[]): PrivacyReportToken[] {
  if (anchors.length === 0) {
    const normalized = paragraphs
      .map(normalizeCollectionParagraphResponse)
      .filter((paragraph) => paragraph && !/^SKIP[。.!！?？]*$/iu.test(paragraph));
    return normalized.flatMap((text, index) => (index > 0 ? [{ text: '\n\n' }, { text }] : [{ text }]));
  }
  const out: PrivacyReportToken[] = [];
  for (const paragraph of paragraphs) {
    const tokens = paragraphTokens({ paragraph, anchors });
    if (tokens.length === 0) continue;
    if (out.length > 0) out.push({ text: '\n\n' });
    for (const token of tokens) out.push(token);
  }

  return out;
}

function normalizePermissionOnlyText(text: string): string {
  return cleanText(text).replaceAll(/[\s，,。.!！？?；;：:、（）()\[\]【】"'“”‘’`]/gu, '').replaceAll(/权限/gu, '');
}

function isPermissionNameOnlyParagraph(paragraph: string, anchors: ParagraphAnchor[]): boolean {
  let remaining = normalizePermissionOnlyText(paragraph);
  let matched = false;
  for (const anchor of anchors) {
    const name = normalizePermissionOnlyText(anchor.name);
    if (!name || !remaining.includes(name)) continue;
    matched = true;
    remaining = remaining.replaceAll(name, '');
  }
  return matched && remaining.length === 0;
}

function permissionTokensFromDraftParagraphs(paragraphs: string[], anchors: ParagraphAnchor[]): PrivacyReportToken[] {
  if (anchors.length === 0) return tokensFromDraftParagraphs(paragraphs, anchors);
  const out: PrivacyReportToken[] = [];
  for (const paragraph of paragraphs) {
    if (isPermissionNameOnlyParagraph(paragraph, anchors)) continue;
    const tokens = paragraphTokens({ paragraph, anchors });
    if (tokens.length === 0) continue;
    if (out.length > 0) out.push({ text: '\n\n' });
    for (const token of tokens) out.push(token);
  }

  return out;
}

function parsePrivacyReportDraft(content: string): PrivacyReportDraft {
  const normalized = content.trim().replace(/^```[\w-]*\s*/u, '').replace(/\s*```$/u, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(normalized) as unknown;
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('隐私声明报告 LLM 输出无法解析为 JSON');
    raw = JSON.parse(normalized.slice(start, end + 1)) as unknown;
  }
  if (!isRecord(raw)) throw new Error('隐私声明报告 LLM 输出不是 JSON 对象');

  const collectionAndUse = parseDraftStringArray((raw as any).collectionAndUse, 'collectionAndUse');
  const permissions = parseDraftStringArray((raw as any).permissions, 'permissions');
  return { collectionAndUse, permissions };
}

function parseDraftStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) throw new Error(`隐私声明报告 LLM 输出缺少 ${fieldName} 数组`);
  return value.map(cleanText).filter(Boolean);
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

  const featureSections = await Promise.all(
    args.features.map(async (feature) => {
      const perFlowIndex = flowIndexes.get(feature.featureId);
      const collectionAnchors = collectionAnchorsForFacts({ feature, facts: feature.facts, perFlowIndex });
      const permissionAnchors = permissionAnchorsForFacts({ feature, facts: feature.facts, perFlowIndex });
      const fallbackDraft = deterministicReportDraft(feature.facts);
      let draft = fallbackDraft;
      let warning = '';
      if (apiKey && feature.featureId !== '__app_permissions' && (collectionAnchors.length > 0 || permissionAnchors.length > 0)) {
        try {
          draft = await reportDraftForPrivacyFacts({ llm: args.llm, facts: feature.facts });
        } catch (error) {
          warning = `功能点 ${feature.featureId} 的隐私声明文案生成失败，已使用确定性模板：${error instanceof Error ? error.message : String(error)}`;
        }
      }

      const collectionDraft =
        collectionAnchors.length === 0 || draftNeedsFallback(draft.collectionAndUse)
          ? fallbackDraft.collectionAndUse
          : draft.collectionAndUse;
      const permissionDraft =
        permissionAnchors.length === 0 || draftNeedsFallback(draft.permissions)
          ? fallbackDraft.permissions
          : draft.permissions;
      let collectionTokens = tokensFromDraftParagraphs(collectionDraft, collectionAnchors);
      if (collectionTokens.length === 0 && fallbackDraft.collectionAndUse.length > 0) {
        collectionTokens = tokensFromDraftParagraphs(fallbackDraft.collectionAndUse, collectionAnchors);
      }
      let permissionTokens = permissionTokensFromDraftParagraphs(permissionDraft, permissionAnchors);
      if (permissionTokens.length === 0 && fallbackDraft.permissions.length > 0) {
        permissionTokens = permissionTokensFromDraftParagraphs(fallbackDraft.permissions, permissionAnchors);
      }

      return {
        collectionAndUse: {
          featureId: feature.featureId,
          tokens: collectionTokens,
        },
        permissions: {
          featureId: feature.featureId,
          tokens: permissionTokens,
        },
        warning,
      };
    }),
  );

  const collectionAndUse: PrivacyReportSection[] = featureSections.map((section) => section.collectionAndUse);
  const permissions: PrivacyReportSection[] = featureSections.map((section) => section.permissions);
  if (collectionAndUse.length > 0 && collectionAndUse.every((section) => section.tokens.length === 0)) {
    collectionAndUse[0] = {
      ...collectionAndUse[0],
      tokens: [{ text: '本应用当前提供的功能不涉及个人信息的收集和使用。' }],
    };
  }
  if (permissions.length > 0 && permissions.every((section) => section.tokens.length === 0)) {
    permissions[0] = {
      ...permissions[0],
      tokens: [{ text: '本应用当前提供的功能无需申请设备权限。' }],
    };
  }

  const warnings = uniq(
    [
      ...featureSections.map((section) => section.warning),
      ...args.features.flatMap((feature) => {
      const out: string[] = [];
      const collectionTokens = collectionAndUse.find((section) => section.featureId === feature.featureId)?.tokens ?? [];
      if (asDataPractices(feature.facts).length > 0 && collectionTokens.length > 0 && collectionTokens.every((token) => !token.jumpTo)) {
        out.push(`功能点 ${feature.featureId} 的个人信息段落缺少有效跳转引用，已降级为纯文本。`);
      }
      return out;
      }),
    ],
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
