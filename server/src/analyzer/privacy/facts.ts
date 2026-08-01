import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { SourceRef } from '../extract/sources.js';
import type { UiTreeResult } from '../feature/types.js';
import type { PrivacyRules } from '../extract/csv.js';

import type {
  DataflowNodeRef,
  FeaturePrivacyFactsContent,
  PrivacyDataItem,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyRecipient,
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

export type PrivacyFactsPermissionHint = {
  permissionName: string;
  refs: DataflowNodeRef[];
  apiDescriptions?: string[];
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

function cleanOptionalText(v: unknown): string {
  return cleanText(v);
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

function applyDataItemRule(name: string, rules: PrivacyRules): string {
  const lower = name.toLowerCase();
  const matched = rules.dataItems.find((rule) => rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase())));
  return matched?.outputName ?? name;
}

function normalizeExtractedContent(
  content: FeaturePrivacyFactsContent,
  feature: PrivacyFactsFeatureContext | null,
  rules: PrivacyRules,
): FeaturePrivacyFactsContent {
  const allowedDataItems = new Set(rules.dataItems.map((rule) => rule.outputName));
  return {
    dataPractices: (content.dataPractices ?? [])
      .map((p) => ({
        ...p,
        businessScenario: normalizeBusinessScenario(p.businessScenario, feature),
        processingSubject: cleanText(p.processingSubject) || '本应用',
        dataSources: normalizeUserFacingTextArray(p.dataSources),
        dataItems: (p.dataItems ?? [])
          .map((item) => ({
            ...item,
            name: applyDataItemRule(normalizeUserFacingText(item.name) || item.name, rules),
          }))
          .filter((item) => allowedDataItems.size === 0 || allowedDataItems.has(item.name)),
        storageMethod: normalizeUserFacingText(p.storageMethod) || p.storageMethod,
        dataRecipients: (p.dataRecipients ?? []).map((recipient) => ({
          ...recipient,
          name: normalizeUserFacingText(recipient.name) || recipient.name,
        })),
      }))
      .filter((practice) => practice.dataItems.length > 0),
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

function validateContent(raw: unknown, flowNodeIndex: Map<string, Set<string>>): {
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
          const refs = filterValidRefs(r.refs, flowNodeIndex, warnings, `dataRecipients(${name})`);
          recipients.push({ name, refs: refs.length > 0 ? refs : undefined });
        }
      }

      dataPractices.push({
        businessScenario: cleanTextOrUnknown(p.businessScenario),
        processingSubject: cleanOptionalText(p.processingSubject) || '本应用',
        dataSources: cleanStringArray(p.dataSources),
        dataItems,
        processingMethod: cleanTextOrUnknown(p.processingMethod),
        storageMethod: cleanTextOrUnknown(p.storageMethod),
        dataRecipients: recipients,
        processingPurpose: cleanTextOrUnknown(p.processingPurpose),
      });
    }
  }

  const permissionPractices: PrivacyPermissionPractice[] = [];
  if (Array.isArray(permPracticesRaw)) {
    for (const p of permPracticesRaw) {
      if (!isRecord(p)) continue;
      const permissionName = cleanTextOrUnknown(p.permissionName);
      const refs = filterValidRefs(p.refs, flowNodeIndex, warnings, `permissionPractices(${permissionName})`);
      const authorizationMode = p.authorizationMode === 'preauthorized' || p.authorizationMode === 'dynamic' ? p.authorizationMode : undefined;
      permissionPractices.push({
        permissionName,
        authorizationMode,
        businessScenario: cleanOptionalText(p.businessScenario),
        permissionPurpose: cleanOptionalText(p.permissionPurpose),
        denyImpact: cleanOptionalText(p.denyImpact),
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
  feature: PrivacyFactsFeatureContext | null;
  dataflows: DataflowsResult;
  permissionHints?: PrivacyFactsPermissionHint[];
  privacyRules?: PrivacyRules;
}): { system: string; user: string } {
  const system = [
    '你是一个静态分析与隐私合规分析助手。',
    '你将收到一个页面标题、功能标题、精简后的数据流节点，以及权限提示。',
    '请严格基于输入证据抽取隐私声明所需的结构化要素。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const pageTitle = cleanText(args.feature?.page?.entry?.description);
  const featureTitle = cleanText(args.feature?.title);

  const flows = Array.isArray(args.dataflows.flows) ? args.dataflows.flows : [];
  const { items: limitedFlows } = limitArray(flows, 12);
  const promptFlows = limitedFlows.map((f) => ({
    flowId: cleanText(f.flowId),
    nodes: limitArray(
      (f.nodes ?? []).map((n) => ({
        nodeId: cleanText(n.id),
        description: cleanText(n.description),
        code: cleanText(n.code),
      })),
      80,
    ).items,
  }));

  const permissionHints = (Array.isArray(args.permissionHints) ? args.permissionHints : []).map((hint) => ({
    permissionName: cleanText(hint.permissionName),
    refs: Array.isArray(hint.refs) ? hint.refs : [],
    apiDescriptions: cleanStringArray(hint.apiDescriptions),
  }));

  const inputPayload = {
    pageTitle,
    featureTitle,
    dataflows: { flows: promptFlows },
    permissionHints,
  };

  const customRules = args.privacyRules?.descriptionRules ?? [];
  const user = [
    '输入 JSON：',
    JSON.stringify(inputPayload, null, 2),
    '',
    '请输出 JSON，结构如下（字段名必须一致）：',
    '{',
    '  "dataPractices": [',
    '    {',
    '      "businessScenario": string,',
    '      "processingSubject": string,',
    '      "dataSources": string[],',
    '      "dataItems": [ { "name": string, "refs": [ { "flowId": string, "nodeId": string } ] } ],',
    '      "processingMethod": string,',
    '      "storageMethod": string,',
    '      "dataRecipients": [ { "name": string, "refs": [ { "flowId": string, "nodeId": string } ]? } ],',
    '      "processingPurpose": string,',
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
    '1) 你只能基于输入 JSON 中的 4 个字段进行判断：pageTitle、featureTitle、dataflows、permissionHints。',
    '2) dataItems[].refs、dataRecipients[].refs 与 permissionPractices[].refs 必须引用上面 dataflows 中真实存在的 {flowId,nodeId}；如果无法找到证据，请使用空 refs 数组。',
    '3) 输出必须是严格 JSON（不要多余文本）。',
    '4) businessScenario 必须写成用户可理解的具体业务场景，优先结合 pageTitle 和 featureTitle 改写，禁止直接输出 build、onForeground、生命周期函数、UIAbility、WindowStage、页面构建入口、功能入口、页面展示与交互、组件展示与交互等框架或结构性标签。',
    '5) businessScenario、dataSources、dataItems[].name、dataRecipients[].name、processingMethod、storageMethod、processingPurpose、permissionPurpose、denyImpact 必须优先使用面向用户的简体中文；即使证据文本是英文，也必须翻译或改写成中文。',
    '6) 禁止直接输出 currentLocation、startPosition、isStart、stepGoal、build、Foreground、Background 等代码变量名或框架术语；若证据里同时出现“英文标识（中文解释）”，应优先保留中文解释。',
    '7) 禁止凭空编造数据项、接收方或权限；允许对 processingMethod、storageMethod、processingPurpose、permissionPurpose、denyImpact 做最保守的弱推断，但必须与输入证据一致。',
    '8) permissionHints 中出现的 permissionName、refs、apiDescriptions 是 permissionPractices 的必答清单；只要这些提示与当前功能点数据流一致，就必须为每个 hint 生成一条权限事实。',
    '9) permissionPractices[].denyImpact 必须写成用户拒绝授权后的具体影响，禁止输出“相关功能可能无法正常使用”“对应功能可能无法正常使用”这类空泛句子；若证据不足，也要明确说出无法完成的具体动作或用户可见结果。',
    '10) permissionPractices 中若保留了某个 permissionName，businessScenario、permissionPurpose、denyImpact 不应为空字符串；若证据不足，也应基于 pageTitle、featureTitle、apiDescriptions、processingPurpose 给出最保守但完整的中文描述。',
    '11) processingSubject 表示实施隐私数据操作的主体；没有更具体证据时填写“本应用”。',
    ...(customRules.length > 0 ? ['', '用户自定义描述规则：', ...customRules.map((rule, index) => `${index + 1}) ${rule}`)] : []),
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

export async function extractFeaturePrivacyFacts(args: {
  runId: string;
  appName: string;
  feature: PrivacyFactsFeatureContext | null;
  dataflows: DataflowsResult;
  uiTree: UiTreeResult | null;
  llm: LlmConfig;
  permissionHints?: PrivacyFactsPermissionHint[];
  privacyRules?: PrivacyRules;
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
  const privacyRules = args.privacyRules ?? { dataItems: [], descriptionRules: [] };
  const prompt = buildPrompt({
    feature: args.feature,
    dataflows: args.dataflows,
    permissionHints: args.permissionHints,
    privacyRules,
  });

  const raw = await chatJsonWithRetries({ llm: { ...args.llm, apiKey }, system: prompt.system, user: prompt.user });
  const validated = validateContent(raw, flowNodeIndex);
  return {
    ...validated,
    content: normalizeExtractedContent(validated.content, args.feature, privacyRules),
  };
}
