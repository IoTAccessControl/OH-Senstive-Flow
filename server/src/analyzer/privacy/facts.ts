import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { SourceRef } from '../extract/sources.js';
import type { UiTreeResult } from '../feature/types.js';

import type {
  DataflowNodeRef,
  FeaturePrivacyFactsContent,
  PrivacyDataItem,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyRecipient,
  PrivacyToggleUi,
  UiNodeRef,
} from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string };

export type PrivacyFactsFeatureContext = {
  featureId: string;
  title: string;
  kind: 'ui' | 'source';
  anchor: { filePath: string; line: number; uiNodeId?: string; functionName?: string };
  page: { pageId: string; entry: { filePath: string; structName?: string; line?: number; description?: string } };
  sources: SourceRef[];
};

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

function isFrameworkishScenario(text: string): boolean {
  return /(ArkUI|UIAbility|WindowStage|生命周期函数|\bbuild\b|\bonDestroy\b|\bonForeground\b|\bonBackground\b|\bonWindowStage)/u.test(text);
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

function pickScenarioFunctionName(feature: PrivacyFactsFeatureContext | null): string {
  const direct = cleanText(feature?.anchor?.functionName);
  if (direct) return direct;

  const sourceFunctions = Array.isArray(feature?.sources)
    ? feature!.sources.map((item) => cleanText(item.functionName)).filter(Boolean)
    : [];
  return sourceFunctions.find((name) => name === 'build') ?? sourceFunctions[0] ?? '';
}

function fallbackScenario(feature: PrivacyFactsFeatureContext | null): string {
  const title = cleanText(feature?.title);
  if (title && !isLowQualityScenario(title)) return title;

  const pageTitle = cleanText(feature?.page?.entry?.description);
  const fn = pickScenarioFunctionName(feature);

  switch (fn) {
    case 'build':
      return pageTitle ? `${pageTitle}展示与交互` : '页面展示与交互';
    case 'aboutToAppear':
      return pageTitle ? `${pageTitle}进入时` : '页面进入时';
    case 'aboutToDisappear':
      return pageTitle ? `${pageTitle}离开前` : '页面离开前';
    case 'onPageShow':
      return pageTitle ? `${pageTitle}显示时` : '页面显示时';
    case 'onPageHide':
      return pageTitle ? `${pageTitle}隐藏时` : '页面隐藏时';
    case 'onBackPress':
      return pageTitle ? `${pageTitle}返回处理` : '返回处理';
    case 'onCreate':
      return '应用创建时';
    case 'onDestroy':
      return '应用退出时';
    case 'onForeground':
      return '应用切到前台时';
    case 'onBackground':
      return '应用切到后台时';
    case 'onWindowStageCreate':
      return '主窗口创建时';
    case 'onWindowStageDestroy':
      return '主窗口销毁时';
    default:
      return pageTitle ? `${pageTitle}相关功能处理时` : '相关功能处理过程中';
  }
}

function normalizeBusinessScenario(raw: unknown, feature: PrivacyFactsFeatureContext | null): string {
  const scenario = cleanText(raw);
  if (scenario && !isLowQualityScenario(scenario)) return scenario;
  return fallbackScenario(feature);
}

const USER_FACING_IDENTIFIER_LABELS: Record<string, string> = {
  currentlocation: '当前位置',
  startposition: '起始位置',
  isstart: '计步状态',
  stepgoal: '步数目标',
  build: '页面构建入口',
  foreground: '前台状态',
  background: '后台状态',
};

function normalizeUserFacingIdentifier(text: string): string {
  const compact = text.replaceAll(/\s+/gu, '').trim().toLowerCase();
  if (!compact) return '';
  const strippedThis = compact.startsWith('this.') ? compact.slice(5) : compact;
  return USER_FACING_IDENTIFIER_LABELS[strippedThis] ?? '';
}

function normalizeUserFacingText(raw: unknown): string {
  const text = cleanText(raw);
  if (!text || text === '未识别') return text;

  const mappedWhole = normalizeUserFacingIdentifier(text);
  if (mappedWhole) return mappedWhole;

  const identifierWithChineseHint = /^([A-Za-z_$][\w$.]*)\s*[（(]\s*([^()（）]*[\u4e00-\u9fff][^()（）]*)\s*[）)]$/u.exec(text);
  if (identifierWithChineseHint) {
    const hinted = cleanText(identifierWithChineseHint[2]);
    if (hinted) return hinted;
  }

  let normalized = text;
  if (hasCjk(normalized)) {
    normalized = normalized.replace(/\s*[（(]\s*[^()（）]*[A-Za-z][^()（）]*\s*[）)]/gu, '');
  }
  normalized = cleanText(normalized);

  const mappedNormalized = normalizeUserFacingIdentifier(normalized);
  return mappedNormalized || normalized || text;
}

function normalizeUserFacingTextArray(values: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeUserFacingText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeExtractedContent(content: FeaturePrivacyFactsContent, feature: PrivacyFactsFeatureContext | null): FeaturePrivacyFactsContent {
  return {
    dataPractices: (content.dataPractices ?? []).map((p) => ({
      ...p,
      businessScenario: normalizeBusinessScenario(p.businessScenario, feature),
      dataSources: normalizeUserFacingTextArray(p.dataSources),
      dataItems: (p.dataItems ?? []).map((item) => ({
        ...item,
        name: normalizeUserFacingText(item.name) || item.name,
      })),
      storageMethod: normalizeUserFacingText(p.storageMethod) || p.storageMethod,
      dataRecipients: (p.dataRecipients ?? []).map((recipient) => ({
        ...recipient,
        name: normalizeUserFacingText(recipient.name) || recipient.name,
      })),
      privacyToggleUi: p.privacyToggleUi
        ? {
            ...p.privacyToggleUi,
            where: normalizeUserFacingText(p.privacyToggleUi.where) || p.privacyToggleUi.where,
          }
        : undefined,
    })),
    permissionPractices: (content.permissionPractices ?? []).map((p) => ({
      ...p,
      businessScenario: normalizeBusinessScenario(p.businessScenario, feature),
    })),
  };
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
  content: FeaturePrivacyFactsContent;
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
  feature: PrivacyFactsFeatureContext | null;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult | null;
}): { system: string; user: string } {
  const system = [
    '你是一个静态分析与隐私合规分析助手。',
    '你将收到一个页面功能点（Feature）的 UI 信息、source 入口信息、以及该功能点下的数据流节点。',
    '请严格基于证据抽取隐私声明所需的结构化要素。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const featureId = args.feature?.featureId ?? 'unknown';
  const featureTitle = args.feature?.title ?? '';
  const featureKind = args.feature?.kind ?? 'source';
  const featureAnchor = args.feature?.anchor ?? {};
  const page = args.feature?.page ?? null;
  const sources = Array.isArray(args.feature?.sources) ? args.feature!.sources : [];

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
    `页面功能点(featureId)：${featureId}`,
    `功能点标题(title)：${featureTitle || '未识别'}`,
    `功能点类型(kind)：${featureKind}`,
    '',
    '所属页面(page)：',
    JSON.stringify(page ?? {}),
    '',
    '功能点锚点(anchor)：',
    JSON.stringify(featureAnchor ?? {}),
    '',
    'source 入口与业务说明（可用于推断业务场景，必须基于证据）：',
    JSON.stringify(sources),
    '',
    '页面 UI 节点（用于定位“隐私功能在哪个界面开关”；如无法确定请输出“未识别”）：',
    JSON.stringify({ truncated: uiTruncated, nodes: limitedUiNodes }),
    '',
    '功能点数据流（每个 flowId 下的 nodes[] 都包含 nodeId；你在输出 refs 时必须使用这些 nodeId）：',
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
    '4) businessScenario 必须写成用户或应用可理解的业务场景，禁止直接输出“build”“onForeground”“onBackground”“onDestroy”“生命周期函数”“UIAbility”“WindowStage”等框架术语；若只能判断到框架阶段，请改写为“页面展示时”“应用切到前台时”“应用退出时”等自然表述。',
    '5) businessScenario、dataSources、dataItems[].name、dataRecipients[].name、storageMethod、privacyToggleUi.where 必须优先使用面向用户的简体中文；即使证据文本是英文，也必须翻译或改写成中文。',
    '6) 禁止直接输出 currentLocation、startPosition、isStart、stepGoal、build、Foreground、Background 等代码变量名或框架术语；若证据里同时出现“英文标识（中文解释）”，应优先保留中文解释。',
  ].join('\n');

  return { system, user };
}

function validatePermissionTextRewrites(
  raw: unknown,
  feature: PrivacyFactsFeatureContext | null,
  allowedPermissionNames: Set<string>,
): {
  rewrites: Array<{
    permissionName: string;
    businessScenario: string;
    permissionPurpose: string;
    denyImpact: string;
  }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new Error('LLM JSON 不是对象');

  const rewritesRaw = (raw as any).rewrites;
  const rewrites: Array<{
    permissionName: string;
    businessScenario: string;
    permissionPurpose: string;
    denyImpact: string;
  }> = [];

  if (!Array.isArray(rewritesRaw)) return { rewrites, warnings };

  for (const item of rewritesRaw) {
    if (!isRecord(item)) continue;
    const permissionName = cleanText(item.permissionName);
    if (!permissionName || !allowedPermissionNames.has(permissionName)) {
      if (permissionName) warnings.push(`权限文案补全返回了未请求的 permissionName：${permissionName}`);
      continue;
    }
    rewrites.push({
      permissionName,
      businessScenario: normalizeBusinessScenario(item.businessScenario, feature),
      permissionPurpose: cleanTextOrUnknown(item.permissionPurpose),
      denyImpact: cleanTextOrUnknown(item.denyImpact),
    });
  }

  return { rewrites, warnings };
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

export async function rewritePermissionPracticeTexts(args: {
  appName: string;
  feature: PrivacyFactsFeatureContext | null;
  llm: LlmConfig;
  permissions: Array<{
    permissionName: string;
    authorizationMode?: PrivacyPermissionPractice['authorizationMode'];
    businessScenario: string;
    permissionPurpose: string;
    denyImpact: string;
    refs: DataflowNodeRef[];
    evidence: Array<{
      flowId: string;
      nodeId: string;
      description?: string;
      code?: string;
      contextLines?: string[];
      apiKey?: string;
      apiDescription?: string;
      callCode?: string;
    }>;
    relatedDataPractices?: Array<{
      businessScenario: string;
      processingPurpose: string;
      dataItems: string[];
    }>;
  }>;
}): Promise<{
  rewrites: Array<{
    permissionName: string;
    businessScenario: string;
    permissionPurpose: string;
    denyImpact: string;
  }>;
  warnings: string[];
}> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey || args.permissions.length === 0) return { rewrites: [], warnings: [] };

  const system = [
    '你是一个隐私声明报告撰写助手。',
    '你将收到某个功能点下若干权限条目的局部证据。',
    '你的任务不是识别权限，而是仅基于给定证据，把权限相关文案改写得更自然、更具体。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const user = [
    `应用名称(appName)：${args.appName}`,
    `页面功能点(featureId)：${args.feature?.featureId ?? 'unknown'}`,
    `功能点标题(title)：${cleanText(args.feature?.title) || '未识别'}`,
    `所属页面标题(pageTitle)：${cleanText(args.feature?.page?.entry?.description) || '未识别'}`,
    '',
    '待补全的权限条目（只能改写 businessScenario / permissionPurpose / denyImpact，禁止改 permissionName / authorizationMode / refs）：',
    JSON.stringify(args.permissions),
    '',
    '请输出 JSON，结构如下：',
    '{',
    '  "rewrites": [',
    '    {',
    '      "permissionName": string,',
    '      "businessScenario": string,',
    '      "permissionPurpose": string,',
    '      "denyImpact": string',
    '    }',
    '  ]',
    '}',
    '',
    '硬性要求：',
    '1) permissionName 必须与输入中的权限完全一致，不允许新增或删除权限。',
    '2) businessScenario、permissionPurpose、denyImpact 必须使用简体中文。',
    '3) 必须严格基于 evidence / relatedDataPractices 中的证据改写，禁止编造新的业务功能、数据项、权限用途或拒绝后果。',
    '4) permissionPurpose 要写成用户能理解的话，优先明确“为了什么功能而申请该权限”，避免“使用相关系统能力”这类空话。',
    '5) denyImpact 要写成用户拒绝授权后的实际影响；如果证据不足，可保守描述，但不要夸大。',
    '6) 如果证据仍不足以改好某条文案，可以保留原有意思，但必须尽量比输入更自然。',
    '7) 输出必须是严格 JSON（不要多余文本）。',
  ].join('\n');

  const raw = await chatJsonWithRetries({ llm: { ...args.llm, apiKey }, system, user });
  return validatePermissionTextRewrites(
    raw,
    args.feature,
    new Set(args.permissions.map((item) => cleanText(item.permissionName)).filter(Boolean)),
  );
}

export async function extractFeaturePrivacyFacts(args: {
  runId: string;
  appName: string;
  feature: PrivacyFactsFeatureContext | null;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult | null;
  llm: LlmConfig;
}): Promise<{ content: FeaturePrivacyFactsContent; warnings: string[] }> {
  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey) {
    return {
      content: { dataPractices: [], permissionPractices: [] },
      warnings: ['LLM api-key 为空，跳过功能点隐私要素抽取'],
    };
  }

  if (!Array.isArray(args.dataflows.flows) || args.dataflows.flows.length === 0) {
    return {
      content: { dataPractices: [], permissionPractices: [] },
      warnings: ['功能点数据流为空，跳过隐私要素抽取'],
    };
  }

  const flowNodeIndex = buildFlowNodeIndex(args.dataflows);
  const uiNodeIndex = buildUiNodeIndex(args.uiTree);

  const prompt = buildPrompt({
    appName: args.appName,
    feature: args.feature,
    dataflows: args.dataflows,
    uiTree: args.uiTree,
  });

  const raw = await chatJsonWithRetries({ llm: { ...args.llm, apiKey }, system: prompt.system, user: prompt.user });
  const validated = validateContent(raw, flowNodeIndex, uiNodeIndex);
  return {
    ...validated,
    content: normalizeExtractedContent(validated.content, args.feature),
  };
}
