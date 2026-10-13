import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat, executeWithRetry } from '../../llm/client.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { SourceRef } from '../extract/sources.js';
import type { UiTreeResult } from '../feature/types.js';
import type { PrivacyRules } from '../extract/csv.js';
import { usablePrivacyFactText } from './factText.js';
import { supportsPrivacyOperations, supportsPrivacySource } from './factEvidence.js';

import type {
  DataflowNodeRef,
  FeaturePrivacyFactsContent,
  PrivacyDataItem,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyRecipient,
} from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string; baseUrl?: string };

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
  keepUnmatchedDataItems = false,
): FeaturePrivacyFactsContent {
  const allowedDataItems = new Set(rules.dataItems.map((rule) => rule.outputName));
  return {
    dataPractices: (content.dataPractices ?? [])
      .map((p) => ({
        ...p,
        businessScenario: p.businessScenario ? normalizeBusinessScenario(p.businessScenario, feature) : '',
        processingSubject: cleanText(p.processingSubject) || '本应用',
        dataSources: normalizeUserFacingTextArray(p.dataSources),
        dataItems: (p.dataItems ?? [])
          .map((item) => ({
            ...item,
            name: applyDataItemRule(normalizeUserFacingText(item.name) || item.name, rules),
          }))
          .filter((item) => keepUnmatchedDataItems || allowedDataItems.size === 0 || allowedDataItems.has(item.name)),
        storageMethod: normalizeUserFacingText(p.storageMethod) || p.storageMethod,
        dataRecipients: (p.dataRecipients ?? []).map((recipient) => ({
          ...recipient,
          name: normalizeUserFacingText(recipient.name) || recipient.name,
        })),
      })),
    permissionPractices: (content.permissionPractices ?? []).map((p) => ({
      ...p,
      businessScenario: p.businessScenario ? normalizeBusinessScenario(p.businessScenario, feature) : '',
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

function validateContent(raw: unknown, flowNodeIndex: Map<string, Set<string>>, evidenceByFlow: Map<string, string>): {
  content: FeaturePrivacyFactsContent;
  warnings: string[];
  compatibilityAliasUsed: boolean;
} {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new Error('LLM JSON 不是对象');

  let dataPracticesRaw = raw.dataPractices;
  let compatibilityAliasUsed = false;
  const hasCanonical = Object.prototype.hasOwnProperty.call(raw, 'dataPractices');
  if (!hasCanonical) {
    const alias = raw.collectionAndUse;
    if (Array.isArray(alias) && alias.every((entry) => isRecord(entry) && Array.isArray(entry.dataItems))) {
      dataPracticesRaw = alias;
      compatibilityAliasUsed = true;
    } else {
      warnings.push('缺少 dataPractices；collectionAndUse 仅兼容含 dataItems 的事实对象数组，文案或混合数组已拒绝，使用证据兜底');
    }
  } else if (!Array.isArray(dataPracticesRaw)) {
    warnings.push('dataPractices 不是数组，已拒绝；不使用 collectionAndUse 覆盖规范字段');
  }
  const permPracticesRaw = (raw as any).permissionPractices;
  const checkedText = (value: unknown, label: string): string => {
    const text = usablePrivacyFactText(value);
    if (!text) warnings.push(`${label} 缺失、类型错误或包含占位词，已拒绝并使用证据兜底`);
    return text;
  };
  const checkedArray = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value)) {
      warnings.push(`${label} 不是数组，已拒绝并使用证据兜底`);
      return [];
    }
    return value.map((item) => checkedText(item, label)).filter(Boolean);
  };

  const dataPractices: PrivacyDataPractice[] = [];
  if (Array.isArray(dataPracticesRaw)) {
    for (const p of dataPracticesRaw) {
      if (!isRecord(p)) { warnings.push('dataPractices 包含非事实对象，已拒绝'); continue; }

      const dataItemsRaw = (p as any).dataItems;
      const dataItems: PrivacyDataItem[] = [];
      if (Array.isArray(dataItemsRaw)) {
        for (const di of dataItemsRaw) {
          if (!isRecord(di)) continue;
          const name = checkedText(di.name, 'dataItems.name');
          if (!name) continue;
          if (di.refs !== undefined && !Array.isArray(di.refs)) {
            warnings.push(`dataItems(${name}) 的 refs 不是数组，已拒绝该数据项`);
            continue;
          }
          const refs = filterValidRefs(di.refs, flowNodeIndex, warnings, `dataItems(${name})`);
          if (Array.isArray(di.refs) && di.refs.length > 0 && refs.length === 0) {
            warnings.push(`dataItems(${name}) 没有有效引用，已拒绝该数据项并使用证据兜底`);
            continue;
          }
          dataItems.push({ name, refs });
        }
      }

      const recipientsRaw = (p as any).dataRecipients;
      const recipients: PrivacyRecipient[] = [];
      if (Array.isArray(recipientsRaw)) {
        for (const r of recipientsRaw) {
          if (!isRecord(r)) continue;
          const name = checkedText(r.name, 'dataRecipients.name');
          if (!name) continue;
          if (r.refs !== undefined && !Array.isArray(r.refs)) { warnings.push('dataRecipients.refs 不是数组，已拒绝'); continue; }
          const refs = filterValidRefs(r.refs, flowNodeIndex, warnings, `dataRecipients(${name})`);
          if (refs.length === 0) { warnings.push(`接收方 ${name} 没有有效引用，已拒绝并使用证据兜底`); continue; }
          recipients.push({ name, refs: refs.length > 0 ? refs : undefined });
        }
      }

      if (dataItems.length === 0) { warnings.push('数据事实没有有效数据项，已拒绝并使用证据兜底'); continue; }
      const evidence = dataItems.flatMap((item) => item.refs.map((ref) => evidenceByFlow.get(ref.flowId) ?? '')).join('\n');
      const checkedDescription = (value: unknown, label: string): string => {
        const text = checkedText(value, label);
        if (!text) return '';
        if ((label === 'storageMethod' && /^(?:本地状态|页面状态|本地处理|本地)$/u.test(text)) ||
            (label === 'processingPurpose' && !/(展示|显示|搜索|登录|验证|支付|签约|发送|提交|维护|维持|识别|连接|统计|计算|更新|编辑|保存|记录|选择|读取|获取|登记|响应)/u.test(text))) {
          warnings.push(`${label} 仅描述数据或状态，缺少实际处理目的或保存方式，已拒绝并使用证据兜底`);
          return '';
        }
        if (/(用户(?:主动)?(?:填写|输入|选择)|收集用户.*(?:状况|资料))/u.test(text) && !supportsPrivacySource('用户输入', evidence)) {
          warnings.push(`${label} 的用户输入断言缺少源码证据，已拒绝并使用证据兜底`);
          return '';
        }
        if ((label === 'businessScenario' && (/(个人信息处理|权限使用|调用源码|相关模块执行|状态变量)/u.test(text) || dataItems.some((item) => text === item.name))) ||
            /(?:源码|状态变量|逻辑校验)/u.test(text)) {
          warnings.push(`${label} 是分析标题或代码结构描述，已拒绝并使用证据兜底`);
          return '';
        }
        if (!supportsPrivacyOperations(text, evidence)) { warnings.push(`${label} 的操作或保存断言缺少源码证据，已拒绝并使用证据兜底`); return ''; }
        return text;
      };
      const dataSources = checkedArray(p.dataSources, 'dataSources').filter((source) => {
        if (/(本地处理|读取并|收集并|上传|不存储|源码检查|代码检查|逻辑校验)/u.test(source)) { warnings.push('dataSources 混入处理方式，已拒绝并使用证据兜底'); return false; }
        if (!supportsPrivacySource(source, evidence)) { warnings.push(`dataSources 的取数来源缺少源码证据（${source}），已拒绝并使用证据兜底`); return false; }
        return true;
      });
      dataPractices.push({
        businessScenario: checkedDescription(p.businessScenario, 'businessScenario'),
        processingSubject: checkedText(p.processingSubject, 'processingSubject') || '本应用',
        dataSources,
        dataItems,
        processingMethod: checkedDescription(p.processingMethod, 'processingMethod'),
        storageMethod: checkedDescription(p.storageMethod, 'storageMethod'),
        dataRecipients: recipients,
        processingPurpose: checkedDescription(p.processingPurpose, 'processingPurpose'),
      });
    }
  }

  const permissionPractices: PrivacyPermissionPractice[] = [];
  if (Array.isArray(permPracticesRaw)) {
    for (const p of permPracticesRaw) {
      if (!isRecord(p)) continue;
      const permissionName = checkedText(p.permissionName, 'permissionName');
      if (!/^ohos\.permission\.[A-Za-z0-9_]+$/u.test(permissionName)) { warnings.push('权限名称无效，已拒绝并使用证据兜底'); continue; }
      if (p.refs !== undefined && !Array.isArray(p.refs)) { warnings.push(`权限 ${permissionName} 的 refs 不是数组，已拒绝并使用证据兜底`); continue; }
      const refs = filterValidRefs(p.refs, flowNodeIndex, warnings, `permissionPractices(${permissionName})`);
      if (Array.isArray(p.refs) && p.refs.length > 0 && refs.length === 0) { warnings.push(`权限 ${permissionName} 没有有效引用，已拒绝并使用证据兜底`); continue; }
      const authorizationMode = p.authorizationMode === 'preauthorized' || p.authorizationMode === 'dynamic' ? p.authorizationMode : undefined;
      permissionPractices.push({
        permissionName,
        authorizationMode,
        businessScenario: checkedText(p.businessScenario, 'permission businessScenario'),
        permissionPurpose: checkedText(p.permissionPurpose, 'permissionPurpose'),
        denyImpact: checkedText(p.denyImpact, 'denyImpact'),
        refs,
      });
    }
  }

  return { content: { dataPractices, permissionPractices }, warnings, compatibilityAliasUsed };
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

  if (args.feature?.featureId === '__app_permissions' && permissionHints.length > 0) {
    const user = [
      '根据输入中的权限清单和代码证据，补充每项权限的中文用途说明。',
      JSON.stringify(inputPayload),
      '只输出以下 JSON 结构，权限名和 refs 必须原样保留：',
      JSON.stringify({ dataPractices: [], permissionPractices: permissionHints.map((hint) => ({
        permissionName: hint.permissionName, businessScenario: '', permissionPurpose: '', denyImpact: '', refs: hint.refs,
      })) }),
      '上面的空字符串只表示待填写字段；基于代码填写实际场景、用途和拒绝影响，证据不足时保留空字符串，不要使用占位描述。',
      'permissionHints 中每个权限都必须输出一次；不要输出 collectionAndUse 或 permissions。',
    ].join('\n');
    return { system, user };
  }

  if (args.feature?.featureId === '__app_permissions' && featureTitle.startsWith('个人信息处理：')) {
    const names = featureTitle.slice('个人信息处理：'.length).split('、');
    const definitions = (args.privacyRules?.dataItems ?? []).filter((rule) => names.includes(rule.outputName))
      .map((rule) => ({ name: rule.outputName, keywords: rule.keywords, definition: rule.definition ?? '' }));
    const user = [
      '根据输入中的源码证据，补充标题所列个人信息的中文处理说明。',
      JSON.stringify({ featureTitle, dataItemDefinitions: definitions, dataflows: inputPayload.dataflows }),
      '只输出以下 JSON 结构，数据项名称和 refs 必须使用输入原值：',
      JSON.stringify({ dataPractices: names.map((name) => ({ businessScenario: '', processingSubject: '本应用', dataSources: [],
        dataItems: [{ name, refs: [] }], processingMethod: '', storageMethod: '', dataRecipients: [], processingPurpose: '' })), permissionPractices: [] }),
      '输出名称仅用于展示，不代表数据语义。请结合定义、关键词和源码判断实际数据含义，不要根据数字或自定义名称猜测用途。',
      'featureTitle 是分析标题，不能作为 businessScenario。不要将变量名、状态变量或源码模块名称当作业务场景。',
      'dataSources 必须有取数代码依据；状态初始化不等于用户输入，应用联系人列表不等于系统通讯录。本地存储必须有写入存储接口的证据，内存状态不能写成持久存储。规则关键词和定义只解释数据类型，不证明来源或操作。',
      '上面的空字段只表示待填写结构；有证据才填写真实处理方式、来源和目的，证据不足时保留空字段，禁止复制示例占位词。refs 只能复制输入中真实存在的 flowId/nodeId。',
      '标题中的每个数据项都必须输出一次；不要输出 collectionAndUse 或 permissions。',
    ].join('\n');
    return { system, user };
  }

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

export async function chatJsonWithRetries(args: {
  llm: LlmConfig;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const baseUrls = resolveLlmBaseUrls(args.llm.provider, args.llm.baseUrl);

  return executeWithRetry(
    async () => {
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
            temperature: 0,
            maxTokens: args.maxTokens ?? 512,
            jsonMode: true,
            enableThinking: false,
            timeoutMs: args.timeoutMs ?? 20_000,
          });
          return safeJsonParse(res.content);
        } catch (e) {
          lastError = e;
          const canRetry =
            baseUrls.length > 1 &&
            (e instanceof LlmNetworkError || (e instanceof LlmHttpError && (e.status === 401 || e.status === 404 || e.status >= 500)));
          if (!canRetry) break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    {
      retryDelaysMs: [300, 800],
    },
  );
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
  keepUnmatchedDataItems?: boolean;
}): Promise<{ content: FeaturePrivacyFactsContent; warnings: string[]; compatibilityAliasUsed?: boolean }> {
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
  const evidenceByFlow = new Map(args.dataflows.flows.map((flow) => [flow.flowId, flow.nodes.map((node) => node.code).join('\n')]));
  const validated = validateContent(raw, flowNodeIndex, evidenceByFlow);
  const content = normalizeExtractedContent(validated.content, args.feature, privacyRules, args.keepUnmatchedDataItems ?? false);
  for (const practice of content.dataPractices) {
    const purpose = normalizeScenarioKey(practice.processingPurpose ?? '').replace(/^(?:用于)?(?:获取|收集|使用|处理|读取)/u, '');
    if (purpose && privacyRules.dataItems.some((rule) => rule.definition &&
      practice.dataItems.some((item) => item.name === rule.outputName) && purpose === normalizeScenarioKey(rule.definition))) {
      practice.processingPurpose = '';
      validated.warnings.push('processingPurpose 仅复述数据定义，未说明使用目的，已拒绝并使用证据兜底');
    }
  }
  const syntheticDataTitle = args.feature?.featureId === '__app_permissions' && args.feature.title.startsWith('个人信息处理：')
    ? args.feature.title.slice('个人信息处理：'.length) : '';
  if (syntheticDataTitle) {
    const expectedNames = new Set(syntheticDataTitle.split('、'));
    for (const practice of content.dataPractices) {
      practice.dataItems = practice.dataItems.filter((item) => {
        if (expectedNames.has(item.name)) return true;
        validated.warnings.push(`数据项 ${item.name} 不属于当前抽取批次，已拒绝并使用证据兜底`);
        return false;
      });
    }
  }
  content.dataPractices = content.dataPractices.filter((practice) => {
    if (practice.dataItems.length > 0) return true;
    validated.warnings.push('数据项不属于配置清单，已拒绝该事实并使用证据兜底');
    return false;
  });
  return { ...validated, content };
}
