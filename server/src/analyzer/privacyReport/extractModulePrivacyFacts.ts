import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { UiModulesIndex } from '../modules/types.js';
import type { UiTreeResult } from '../uiTree/types.js';

import type {
  DataflowNodeRef,
  ModulePrivacyFactsContent,
  PrivacyDataItem,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyRecipient,
  PrivacyToggleUi,
  UiNodeRef,
} from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string };

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      return JSON.parse(slice) as unknown;
    }
    throw new Error('LLM 返回无法解析为 JSON');
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll(/\s+/gu, ' ').trim();
}

function cleanTextOrUnknown(v: unknown): string {
  const t = cleanText(v);
  return t || '未识别';
}

function cleanStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const t = cleanText(it);
    if (t) out.push(t);
  }
  return out;
}

function buildFlowNodeIndex(dataflows: DataflowsResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const f of dataflows.flows ?? []) {
    const set = new Set<string>();
    for (const n of f.nodes ?? []) set.add(String(n.id ?? ''));
    map.set(String(f.flowId ?? ''), set);
  }
  return map;
}

function buildUiNodeIndex(uiTree: UiTreeResult | null): Set<string> {
  if (!uiTree) return new Set();
  return new Set(Object.keys(uiTree.nodes ?? {}));
}

function filterValidRefs(
  raw: unknown,
  flowNodeIndex: Map<string, Set<string>>,
  warnings: string[],
  label: string,
): DataflowNodeRef[] {
  if (!Array.isArray(raw)) return [];
  const out: DataflowNodeRef[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const flowId = cleanText(r.flowId);
    const nodeId = cleanText(r.nodeId);
    if (!flowId || !nodeId) continue;
    const set = flowNodeIndex.get(flowId);
    if (!set || !set.has(nodeId)) {
      warnings.push(`${label} 的 refs 包含无效引用：${flowId}/${nodeId}`);
      continue;
    }
    out.push({ flowId, nodeId });
  }
  return out;
}

function filterValidUiRefs(raw: unknown, uiNodeIndex: Set<string>): UiNodeRef[] {
  if (!Array.isArray(raw)) return [];
  const out: UiNodeRef[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const uiNodeId = cleanText(r.uiNodeId);
    if (!uiNodeId) continue;
    if (!uiNodeIndex.has(uiNodeId)) continue;
    out.push({ uiNodeId });
  }
  return out;
}

function validateContent(raw: unknown, flowNodeIndex: Map<string, Set<string>>, uiNodeIndex: Set<string>): {
  content: ModulePrivacyFactsContent;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new Error('LLM JSON 不是对象');

  const dataPracticesRaw = (raw as any).dataPractices;
  const permPracticesRaw = (raw as any).permissionPractices;

  const dataPractices: PrivacyDataPractice[] = [];
  if (Array.isArray(dataPracticesRaw)) {
    for (const p of dataPracticesRaw) {
      if (!isRecord(p)) continue;

      const dataItemsRaw = (p as any).dataItems;
      const dataItems: PrivacyDataItem[] = [];
      if (Array.isArray(dataItemsRaw)) {
        for (const di of dataItemsRaw) {
          if (!isRecord(di)) continue;
          const name = cleanTextOrUnknown(di.name);
          const refs = filterValidRefs(di.refs, flowNodeIndex, warnings, `dataItems(${name})`);
          dataItems.push({ name, refs });
        }
      }

      const recipientsRaw = (p as any).dataRecipients;
      const recipients: PrivacyRecipient[] = [];
      if (Array.isArray(recipientsRaw)) {
        for (const r of recipientsRaw) {
          if (!isRecord(r)) continue;
          const name = cleanTextOrUnknown(r.name);
          const inferred = typeof r.inferred === 'boolean' ? r.inferred : undefined;
          const refs = filterValidRefs(r.refs, flowNodeIndex, warnings, `dataRecipients(${name})`);
          recipients.push({ name, inferred, refs: refs.length > 0 ? refs : undefined });
        }
      }

      const toggleRaw = (p as any).privacyToggleUi;
      let privacyToggleUi: PrivacyToggleUi | undefined;
      if (isRecord(toggleRaw)) {
        const where = cleanTextOrUnknown(toggleRaw.where);
        const refs = filterValidUiRefs(toggleRaw.refs, uiNodeIndex);
        privacyToggleUi = { where, refs: refs.length > 0 ? refs : undefined };
      }

      dataPractices.push({
        appName: cleanTextOrUnknown(p.appName),
        businessScenario: cleanTextOrUnknown(p.businessScenario),
        dataSources: cleanStringArray(p.dataSources),
        dataItems,
        processingMethod: cleanTextOrUnknown(p.processingMethod),
        storageMethod: cleanTextOrUnknown(p.storageMethod),
        dataRecipients: recipients,
        processingPurpose: cleanTextOrUnknown(p.processingPurpose),
        privacyToggleUi,
      });
    }
  }

  const permissionPractices: PrivacyPermissionPractice[] = [];
  if (Array.isArray(permPracticesRaw)) {
    for (const p of permPracticesRaw) {
      if (!isRecord(p)) continue;
      const permissionName = cleanTextOrUnknown(p.permissionName);
      const refs = filterValidRefs(p.refs, flowNodeIndex, warnings, `permissionPractices(${permissionName})`);
      permissionPractices.push({
        permissionName,
        businessScenario: cleanTextOrUnknown(p.businessScenario),
        permissionPurpose: cleanTextOrUnknown(p.permissionPurpose),
        denyImpact: cleanTextOrUnknown(p.denyImpact),
        refs,
      });
    }
  }

  return { content: { dataPractices, permissionPractices }, warnings };
}

function limitArray<T>(arr: T[], max: number): { items: T[]; truncated: boolean } {
  if (arr.length <= max) return { items: arr, truncated: false };
  return { items: arr.slice(0, max), truncated: true };
}

function buildPrompt(args: {
  appName: string;
  module: UiModulesIndex['modules'][number] | null;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult | null;
}): { system: string; user: string } {
  const system = [
    '你是一个静态分析与隐私合规分析助手。',
    '你将收到一个功能模块的 UI 信息、source 入口信息、以及该模块下的数据流节点。',
    '请严格基于证据抽取隐私声明所需的结构化要素。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const moduleId = args.module?.moduleId ?? 'unknown';
  const entry = args.module?.entry ?? {};
  const sources = Array.isArray(args.module?.sources) ? args.module!.sources : [];

  const flows = Array.isArray(args.dataflows.flows) ? args.dataflows.flows : [];
  const flowSummaries = flows.map((f) => ({
    flowId: f.flowId,
    pathId: f.pathId,
    summary: f.summary ?? {},
    nodes: (f.nodes ?? []).map((n) => ({
      id: n.id,
      filePath: n.filePath,
      line: n.line,
      code: n.code,
      description: n.description,
    })),
  }));

  const uiNodes = args.uiTree
    ? Object.entries(args.uiTree.nodes ?? {}).map(([id, n]) => ({
        id,
        category: n.category,
        name: n.name,
        description: n.description,
        filePath: n.filePath,
        line: n.line,
      }))
    : [];

  const { items: limitedFlows, truncated: flowsTruncated } = limitArray(flowSummaries, 12);
  const limitedFlowsWithLimitedNodes = limitedFlows.map((f) => {
    const { items: limitedNodes, truncated: nodesTruncated } = limitArray(f.nodes, 80);
    return { ...f, nodes: limitedNodes, nodesTruncated };
  });

  const { items: limitedUiNodes, truncated: uiTruncated } = limitArray(uiNodes, 120);

  const user = [
    `应用名称(appName)：${args.appName}`,
    `功能模块(moduleId)：${moduleId}`,
    '',
    '模块入口(entry)：',
    JSON.stringify(entry),
    '',
    'source 入口与业务说明（可用于推断业务场景，必须基于证据）：',
    JSON.stringify(sources),
    '',
    '模块 UI 节点（用于定位“隐私功能在哪个界面开关”；如无法确定请输出“未识别”）：',
    JSON.stringify({ truncated: uiTruncated, nodes: limitedUiNodes }),
    '',
    '模块数据流（每个 flowId 下的 nodes[] 都包含 nodeId；你在输出 refs 时必须使用这些 nodeId）：',
    JSON.stringify({ truncated: flowsTruncated, flows: limitedFlowsWithLimitedNodes }),
    '',
    '请输出 JSON，结构如下（字段名必须一致）：',
    '{',
    '  "dataPractices": [',
    '    {',
    '      "appName": string,',
    '      "businessScenario": string,',
    '      "dataSources": string[],',
    '      "dataItems": [ { "name": string, "refs": [ { "flowId": string, "nodeId": string } ] } ],',
    '      "processingMethod": string,',
    '      "storageMethod": string,',
    '      "dataRecipients": [ { "name": string, "inferred": boolean?, "refs": [ { "flowId": string, "nodeId": string } ]? } ],',
    '      "processingPurpose": string,',
    '      "privacyToggleUi": { "where": string, "refs": [ { "uiNodeId": string } ]? }?',
    '    }',
    '  ],',
    '  "permissionPractices": [',
    '    {',
    '      "permissionName": string,',
    '      "businessScenario": string,',
    '      "permissionPurpose": string,',
    '      "denyImpact": string,',
    '      "refs": [ { "flowId": string, "nodeId": string } ]',
    '    }',
    '  ]',
    '}',
    '',
    '硬性要求：',
    '1) dataItems[].refs 与 permissionPractices[].refs 必须引用上面数据流中真实存在的 {flowId,nodeId}；如果无法找到证据，请将 name/permissionName 设为“未识别”，并使用空 refs 数组。',
    '2) 禁止凭空编造接收方/权限/数据项；允许对“处理方式/存储方式/处理目的/拒绝影响”等做弱推断，但必须与提供的证据一致。',
    '3) 输出必须是严格 JSON（不要多余文本）。',
  ].join('\n');

  return { system, user };
}

async function chatJsonWithRetries(args: {
  llm: LlmConfig;
  system: string;
  user: string;
}): Promise<unknown> {
  const baseUrls = resolveLlmBaseUrls(args.llm.provider);
  let lastError: unknown = null;

  for (const baseUrl of baseUrls) {
    try {
      const res = await openAiCompatibleChat({
        baseUrl,
        apiKey: args.llm.apiKey,
        model: args.llm.model,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
        temperature: 0.2,
        jsonMode: true,
      });
      return safeJsonParse(res.content);
    } catch (e) {
      lastError = e;
      const canRetry =
        baseUrls.length > 1 &&
        (e instanceof LlmNetworkError || (e instanceof LlmHttpError && (e.status === 401 || e.status === 404 || e.status >= 500)));
      if (!canRetry) throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function extractModulePrivacyFacts(args: {
  runId: string;
  appName: string;
  module: UiModulesIndex['modules'][number] | null;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult | null;
  llm: LlmConfig;
}): Promise<{ content: ModulePrivacyFactsContent; warnings: string[] }> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey) {
    return {
      content: { dataPractices: [], permissionPractices: [] },
      warnings: ['LLM api-key 为空，跳过模块隐私要素抽取'],
    };
  }

  if (!Array.isArray(args.dataflows.flows) || args.dataflows.flows.length === 0) {
    return {
      content: { dataPractices: [], permissionPractices: [] },
      warnings: ['模块数据流为空，跳过模块隐私要素抽取'],
    };
  }

  const flowNodeIndex = buildFlowNodeIndex(args.dataflows);
  const uiNodeIndex = buildUiNodeIndex(args.uiTree);

  const prompt = buildPrompt({
    appName: args.appName,
    module: args.module,
    dataflows: args.dataflows,
    uiTree: args.uiTree,
  });

  const raw = await chatJsonWithRetries({ llm: { ...args.llm, apiKey }, system: prompt.system, user: prompt.user });
  return validateContent(raw, flowNodeIndex, uiNodeIndex);
}

