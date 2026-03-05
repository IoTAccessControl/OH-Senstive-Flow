import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';
import type { DataflowsResult } from '../dataflow/types.js';

import type {
  FeaturePrivacyFactsContent,
  PrivacyDataPractice,
  PrivacyPermissionPractice,
  PrivacyReportFile,
  PrivacyReportSection,
  PrivacyReportToken,
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
  return v.replaceAll(/\r?\n/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
}

function isUnknownText(v: unknown): boolean {
  const t = cleanText(v);
  return !t || t === '未识别';
}

function knownText(v: unknown): string {
  const t = cleanText(v);
  return !t || t === '未识别' ? '' : t;
}

function trimPunctuationEdges(text: string): string {
  return text
    .replaceAll(/^[\s，,。！？!？；;:：、]+/gu, '')
    .replaceAll(/[\s，,。！？!？；;:：、]+$/gu, '')
    .trim();
}

function clauseText(v: unknown): string {
  const t = knownText(v);
  return t ? trimPunctuationEdges(t) : '';
}

function purposeClauseText(v: unknown): string {
  const t = clauseText(v);
  if (!t) return '';
  return t.replace(/^用于/gu, '').trim();
}

function normalizePermissionName(v: unknown): string {
  const t = cleanText(v);
  if (!t) return '';
  // Remove optional hints like "（可选）" to keep tokens stable.
  return t.replaceAll(/（[^）]*）/gu, '').trim();
}

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of arr) {
    if (!a) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
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

function asPermissionPractices(facts: FeaturePrivacyFactsContent): PrivacyPermissionPractice[] {
  return Array.isArray(facts.permissionPractices) ? (facts.permissionPractices as PrivacyPermissionPractice[]) : [];
}

function asDataPractices(facts: FeaturePrivacyFactsContent): PrivacyDataPractice[] {
  return Array.isArray((facts as any).dataPractices) ? ((facts as any).dataPractices as PrivacyDataPractice[]) : [];
}

function pickValidRef(
  refs: Array<{ flowId: string; nodeId: string }> | undefined,
  perFlowIndex: Map<string, Set<string>> | undefined,
): { flowId: string; nodeId: string } | null {
  if (!perFlowIndex) return null;
  if (!Array.isArray(refs)) return null;
  for (const r of refs) {
    const flowId = cleanText((r as any).flowId);
    const nodeId = cleanText((r as any).nodeId);
    if (!flowId || !nodeId) continue;
    const set = perFlowIndex.get(flowId);
    if (!set || !set.has(nodeId)) continue;
    return { flowId, nodeId };
  }
  return null;
}

function deterministicPermissionSentenceTokens(args: {
  featureId: string;
  practice: PrivacyPermissionPractice;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): PrivacyReportToken[] {
  const permissionName = normalizePermissionName(args.practice.permissionName);
  if (!permissionName) return [];

  const picked = pickValidRef(args.practice.refs as any, args.perFlowIndex);
  if (!picked) return [];
  const jumpTo = { featureId: args.featureId, flowId: picked.flowId, nodeId: picked.nodeId };

  const scenario = clauseText(args.practice.businessScenario);
  const purpose = purposeClauseText(args.practice.permissionPurpose);
  const denyImpact = clauseText(args.practice.denyImpact);

  const prefix = scenario ? `在“${scenario}”场景中，我们会调用` : '我们会调用';
  const purposeSuffix = purpose ? `权限，用于${purpose}。` : '权限。';

  return [
    { text: prefix },
    { text: permissionName, jumpTo },
    { text: purposeSuffix },
    ...(denyImpact ? [{ text: `若您拒绝授权，${denyImpact}。` }] : []),
  ];
}

function ensurePermissionsSectionTokens(args: {
  featureId: string;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
  existingTokens: PrivacyReportToken[];
}): PrivacyReportToken[] {
  const practices = asPermissionPractices(args.facts)
    .map((p) => ({
      ...p,
      permissionName: normalizePermissionName(p.permissionName),
      businessScenario: cleanText(p.businessScenario) || '未识别',
      permissionPurpose: cleanText(p.permissionPurpose) || '未识别',
      denyImpact: cleanText(p.denyImpact) || '未识别',
      refs: Array.isArray(p.refs) ? p.refs : [],
    }))
    .filter((p) => Boolean(p.permissionName));

  // Do not emit "no permission involved" style paragraphs: absence is not evidence.
  if (practices.length === 0) return [];

  const out: PrivacyReportToken[] = args.existingTokens.slice();
  const byName = new Map<string, { practice: PrivacyPermissionPractice; jumpTo?: { featureId: string; flowId: string; nodeId: string } }>();
  for (const p of practices) {
    const picked = pickValidRef(p.refs as any, args.perFlowIndex);
    const jumpTo = picked ? { featureId: args.featureId, flowId: picked.flowId, nodeId: picked.nodeId } : undefined;
    byName.set(p.permissionName, { practice: p, jumpTo });
  }

  const existingNameToIdx = new Map<string, number[]>();
  for (let i = 0; i < out.length; i += 1) {
    const text = normalizePermissionName(out[i]?.text);
    if (!text) continue;
    if (!byName.has(text)) continue;
    const list = existingNameToIdx.get(text) ?? [];
    list.push(i);
    existingNameToIdx.set(text, list);
  }

  // If LLM emitted a permission token without jumpTo, upgrade it when we have a valid ref.
  for (const [name, idxs] of existingNameToIdx) {
    const desired = byName.get(name);
    if (!desired?.jumpTo) continue;
    for (const idx of idxs) {
      if (!out[idx]) continue;
      if (out[idx]!.jumpTo) continue;
      out[idx] = { ...out[idx]!, jumpTo: desired.jumpTo };
    }
  }

  // Append missing permissions (deterministic sentences).
  const missing = Array.from(byName.keys()).filter((name) => !existingNameToIdx.has(name));
  if (missing.length === 0) return out;

  // If the paragraph is a placeholder, prefer replacing it with deterministic content.
  const isPlaceholder =
    out.length === 1 && typeof out[0]?.text === 'string' && (out[0]!.text.includes('未生成') || out[0]!.text.includes('未生成（原因'));
  const base = isPlaceholder ? [] : out;
  const merged = base.slice();
  for (const name of missing) {
    const item = byName.get(name);
    if (!item) continue;
    const tokens = deterministicPermissionSentenceTokens({
      featureId: args.featureId,
      practice: item.practice,
      perFlowIndex: args.perFlowIndex,
    });
    if (tokens.length === 0) continue;
    if (merged.length > 0) merged.push({ text: '此外，' });
    for (const t of tokens) merged.push(t);
  }
  return merged.length > 0 ? merged : out;
}

function summarizeFeatureFacts(featureId: string, appName: string, facts: FeaturePrivacyFactsContent): Record<string, unknown> {
  const dataPractices = Array.isArray(facts.dataPractices) ? facts.dataPractices : [];
  const permPractices = Array.isArray(facts.permissionPractices) ? facts.permissionPractices : [];

  const businessScenarios = uniq([
    ...dataPractices.map((p) => cleanText(p.businessScenario)),
    ...permPractices.map((p) => cleanText(p.businessScenario)),
  ]);

  const dataSources = uniq(dataPractices.flatMap((p) => (Array.isArray(p.dataSources) ? p.dataSources.map(cleanText) : [])));

  const dataItems = new Map<string, { name: string; refs: Array<{ flowId: string; nodeId: string }> }>();
  for (const p of dataPractices) {
    for (const di of p.dataItems ?? []) {
      const name = cleanText(di?.name);
      if (!name) continue;
      const cur = dataItems.get(name) ?? { name, refs: [] };
      for (const r of di?.refs ?? []) {
        const flowId = cleanText(r?.flowId);
        const nodeId = cleanText(r?.nodeId);
        if (!flowId || !nodeId) continue;
        cur.refs.push({ flowId, nodeId });
      }
      dataItems.set(name, cur);
    }
  }

  const processingMethods = uniq(dataPractices.map((p) => cleanText(p.processingMethod)).filter(Boolean));
  const storageMethods = uniq(dataPractices.map((p) => cleanText(p.storageMethod)).filter(Boolean));
  const recipients = uniq(
    dataPractices
      .flatMap((p) => p.dataRecipients ?? [])
      .map((r) => cleanText(r?.name))
      .filter(Boolean),
  );
  const purposes = uniq(dataPractices.map((p) => cleanText(p.processingPurpose)).filter(Boolean));
  const toggleWhere = uniq(
    dataPractices
      .map((p) => cleanText(p.privacyToggleUi?.where))
      .filter((t) => t && t !== '未识别'),
  )[0];

  const permissions = permPractices.map((p) => ({
    permissionName: normalizePermissionName(p.permissionName) || '未识别',
    businessScenario: cleanText(p.businessScenario) || '未识别',
    permissionPurpose: cleanText(p.permissionPurpose) || '未识别',
    denyImpact: cleanText(p.denyImpact) || '未识别',
    refs: Array.isArray(p.refs)
      ? p.refs
          .map((r) => ({ flowId: cleanText(r.flowId), nodeId: cleanText(r.nodeId) }))
          .filter((r) => r.flowId && r.nodeId)
      : [],
  }));

  return {
    featureId,
    businessScenarios,
    dataSources,
    dataItems: Array.from(dataItems.values())
      .slice(0, 20)
      .map((x) => ({ name: x.name, refs: x.refs.slice(0, 5) })),
    processingMethods,
    storageMethods,
    dataRecipients: recipients,
    processingPurposes: purposes,
    privacyToggleWhere: toggleWhere || '未识别',
    permissions: permissions.slice(0, 30),
  };
}

function pushEntityListTokens(out: PrivacyReportToken[], entities: PrivacyReportToken[]): void {
  for (let i = 0; i < entities.length; i += 1) {
    out.push(entities[i]!);
    if (i === entities.length - 1) continue;
    if (entities.length === 2) {
      out.push({ text: '和' });
    } else if (i === entities.length - 2) {
      out.push({ text: '和' });
    } else {
      out.push({ text: '、' });
    }
  }
}

function deterministicCollectionAndUseTokens(args: {
  featureId: string;
  facts: FeaturePrivacyFactsContent;
  perFlowIndex: Map<string, Set<string>> | undefined;
}): PrivacyReportToken[] {
  const practices = asDataPractices(args.facts);
  if (practices.length === 0) return [];

  const out: PrivacyReportToken[] = [];

  for (const p of practices) {
    const scenario = clauseText(p.businessScenario);

    const dataSources = uniq((Array.isArray(p.dataSources) ? p.dataSources : []).map(clauseText).filter(Boolean));

    const entityTokens: PrivacyReportToken[] = [];
    for (const di of p.dataItems ?? []) {
      const name = clauseText((di as any)?.name);
      if (!name) continue;
      const picked = pickValidRef((di as any)?.refs as any, args.perFlowIndex);
      if (!picked) continue;
      entityTokens.push({ text: name, jumpTo: { featureId: args.featureId, flowId: picked.flowId, nodeId: picked.nodeId } });
    }
    if (entityTokens.length === 0) continue;

    const processingPurpose = purposeClauseText((p as any).processingPurpose);

    if (out.length > 0) out.push({ text: '此外，' });
    if (scenario) out.push({ text: `在“${scenario}”场景中，` });
    out.push({ text: dataSources.length > 0 ? `我们会从${dataSources.join('、')}收集` : '我们会收集' });
    pushEntityListTokens(out, entityTokens);
    out.push({ text: processingPurpose ? `，用于${processingPurpose}。` : '。' });
  }

  return out;
}

function buildPrompt(args: {
  appName: string;
  features: Array<{ featureId: string; facts: FeaturePrivacyFactsContent }>;
}): { system: string; user: string } {
  const system = [
    '你是隐私合规文案撰写助手。',
    '你将基于结构化证据，为每个页面功能点（Feature）生成隐私声明中的段落。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const featureSummaries = args.features.map((f) => summarizeFeatureFacts(f.featureId, args.appName, f.facts));

  const user = [
    '请为下面每个页面功能点（Feature）分别生成两段文字（每段是一个自然段，不要列表、不换行）：',
    'A) 用于章节「我们如何收集和使用您的个人信息」的段落（只描述“有证据支撑”的要素：业务场景、数据来源、数据项、处理方式、存储方式、数据接收方、数据处理目的、隐私功能开关位置）。',
    'B) 用于章节「设备权限调用」的段落（只描述“有证据支撑”的要素：权限名称、业务场景、权限使用目的、拒绝授权的影响）。',
    '',
    '注意：不要在文案中直接点名应用名称；不要输出“未识别/不涉及/未申请/未发现/不存在”等缺乏证据的句子，缺失要素请直接省略。',
    '',
    '输出 JSON 结构如下（字段名必须一致）：',
    '{',
    '  "collectionAndUse": [',
    '    {',
    '      "featureId": string,',
    '      "tokens": [ { "text": string, "jumpTo"?: { "featureId": string, "flowId": string, "nodeId": string } } ]',
    '    }',
    '  ],',
    '  "permissions": [',
    '    {',
    '      "featureId": string,',
    '      "tokens": [ { "text": string, "jumpTo"?: { "featureId": string, "flowId": string, "nodeId": string } } ]',
    '    }',
    '  ]',
    '}',
    '',
    '硬性要求：',
    '1) 禁止输出无序列表或有序列表（不要出现 "-", "*", "1." 这种列表标记），每个功能点输出必须是一个连续段落。',
    '2) 不要生成章节标题，不要生成额外章节。',
    '3) 当你在段落中提到某个“数据项 name”（来自 dataItems[].name），必须把该数据项单独作为一个 token（text 仅包含该 name），并在该 token 上设置 jumpTo，jumpTo 必须使用该 name 对应 refs 中的一个 {flowId,nodeId}。',
    '4) 当你在段落中提到某个“权限名称 permissionName”，必须把该权限名称单独作为一个 token，并设置 jumpTo（同样来自 refs）。',
    '5) 如果某功能点没有可用 refs（例如 name=未识别 或 refs 为空），则不要设置 jumpTo，只写普通 text。',
    '6) 每个 token.text 禁止包含换行符。',
    '',
    '功能点证据（JSON，已去重/截断）：',
    JSON.stringify(featureSummaries),
  ].join('\n');

  return { system, user };
}

async function chatJsonWithRetries(args: { llm: LlmConfig; system: string; user: string }): Promise<unknown> {
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

function normalizeTokenText(text: unknown): string {
  let t = cleanText(text);
  // Defensive: strip common list markers if the model accidentally emits them.
  t = t.replace(/^[-*•]\s+/u, '');
  t = t.replace(/^\d+[.、]\s*/u, '');
  return t || '';
}

function validateSections(
  raw: unknown,
  featureIds: Set<string>,
  flowIndexes: Map<string, Map<string, Set<string>>>,
): { collectionAndUse: PrivacyReportSection[]; permissions: PrivacyReportSection[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new Error('LLM JSON 不是对象');

  function validateTokens(featureId: string, tokensRaw: unknown): PrivacyReportToken[] {
    if (!Array.isArray(tokensRaw)) return [];
    const out: PrivacyReportToken[] = [];
    for (const t of tokensRaw) {
      if (!isRecord(t)) continue;
      const text = normalizeTokenText(t.text);
      if (!text) continue;
      const jumpToRaw = t.jumpTo;
      if (!jumpToRaw) {
        out.push({ text });
        continue;
      }
      if (!isRecord(jumpToRaw)) {
        out.push({ text });
        continue;
      }
      const jtFeatureId = cleanText((jumpToRaw as any).featureId) || featureId;
      const flowId = cleanText((jumpToRaw as any).flowId);
      const nodeId = cleanText((jumpToRaw as any).nodeId);
      if (!flowId || !nodeId) {
        out.push({ text });
        continue;
      }
      const idx = flowIndexes.get(jtFeatureId);
      const set = idx?.get(flowId);
      if (!idx || !set || !set.has(nodeId)) {
        warnings.push(`报告 token 的 jumpTo 无效：${jtFeatureId}/${flowId}/${nodeId}（已移除跳转）`);
        out.push({ text });
        continue;
      }
      out.push({ text, jumpTo: { featureId: jtFeatureId, flowId, nodeId } });
    }
    return out;
  }

  function validateSectionArray(rawArr: unknown, kind: string): PrivacyReportSection[] {
    if (!Array.isArray(rawArr)) return [];
    const out: PrivacyReportSection[] = [];
    for (const s of rawArr) {
      if (!isRecord(s)) continue;
      const featureId = cleanText((s as any).featureId);
      if (!featureId || !featureIds.has(featureId)) continue;
      const tokens = validateTokens(featureId, (s as any).tokens);
      if (tokens.length === 0) {
        out.push({ featureId, tokens: [{ text: `${featureId}：未生成${kind}段落` }] });
      } else {
        out.push({ featureId, tokens });
      }
    }
    return out;
  }

  const collectionAndUse = validateSectionArray((raw as any).collectionAndUse, '个人信息收集使用');
  const permissions = validateSectionArray((raw as any).permissions, '权限调用');
  return { collectionAndUse, permissions, warnings };
}

export async function buildPrivacyReport(args: {
  runId: string;
  appName: string;
  llm: LlmConfig;
  features: Array<{ featureId: string; facts: FeaturePrivacyFactsContent; dataflows: DataflowsResult }>;
}): Promise<{ report: PrivacyReportFile; text: string; warnings: string[] }> {
  const generatedAt = new Date().toISOString();
  const flowIndexes = new Map<string, Map<string, Set<string>>>();
  for (const f of args.features) {
    const perFlow = buildFlowNodeIndex(f.dataflows);
    flowIndexes.set(f.featureId, perFlow);
  }

  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';

  const collectionAndUse: PrivacyReportSection[] = args.features.map((f) => ({
    featureId: f.featureId,
    tokens: deterministicCollectionAndUseTokens({ featureId: f.featureId, facts: f.facts, perFlowIndex: flowIndexes.get(f.featureId) }),
  }));

  const permissions: PrivacyReportSection[] = args.features.map((f) => ({
    featureId: f.featureId,
    tokens: ensurePermissionsSectionTokens({
      featureId: f.featureId,
      facts: f.facts,
      perFlowIndex: flowIndexes.get(f.featureId),
      existingTokens: [],
    }),
  }));

  const report: PrivacyReportFile = {
    meta: {
      runId: args.runId,
      generatedAt,
      llm: { provider: args.llm.provider, model: args.llm.model },
      skipped: !apiKey,
      skipReason: !apiKey ? '隐私声明报告文案 LLM api-key 为空：未使用 LLM 文案生成' : undefined,
      counts: { features: args.features.length },
    },
    sections: {
      collectionAndUse,
      permissions,
    },
  };

  const text = renderPrivacyReportText(report);
  return { report, text, warnings: [] };
}

function sectionParagraph(tokens: PrivacyReportToken[]): string {
  return tokens.map((t) => (typeof t.text === 'string' ? t.text : '')).join('');
}

export function renderPrivacyReportText(report: PrivacyReportFile): string {
  const lines: string[] = [];
  lines.push('1 我们如何收集和使用您的个人信息');
  for (const p of report.sections.collectionAndUse) {
    const text = sectionParagraph(p.tokens).trim();
    if (!text) continue;
    lines.push(text);
  }
  lines.push('2 设备权限调用');
  for (const p of report.sections.permissions) {
    const text = sectionParagraph(p.tokens).trim();
    if (!text) continue;
    lines.push(text);
  }
  return lines.join('\n\n').trimEnd() + '\n';
}
