import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';
import type { DataflowsResult } from '../dataflow/types.js';

import type {
  ModulePrivacyFactsContent,
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

function summarizeModuleFacts(moduleId: string, appName: string, facts: ModulePrivacyFactsContent): Record<string, unknown> {
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
    permissionName: cleanText(p.permissionName) || '未识别',
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
    moduleId,
    appName,
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

function buildPrompt(args: {
  appName: string;
  modules: Array<{ moduleId: string; facts: ModulePrivacyFactsContent }>;
}): { system: string; user: string } {
  const system = [
    '你是隐私合规文案撰写助手。',
    '你将基于结构化证据，为每个功能模块生成隐私声明中的段落。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const moduleSummaries = args.modules.map((m) => summarizeModuleFacts(m.moduleId, args.appName, m.facts));

  const user = [
    '请为下面每个功能模块分别生成两段文字（每段是一个自然段，不要列表、不换行）：',
    'A) 用于章节「我们如何收集和使用您的个人信息」的段落（必须包含要素：应用名称、业务场景、数据来源、数据项、处理方式、存储方式、数据接收方、数据处理目的、隐私功能在哪个界面开关）。',
    'B) 用于章节「设备权限调用」的段落（必须包含要素：权限名称、业务场景、权限使用目的、拒绝授权的影响）。',
    '',
    '输出 JSON 结构如下（字段名必须一致）：',
    '{',
    '  "collectionAndUse": [',
    '    {',
    '      "moduleId": string,',
    '      "tokens": [ { "text": string, "jumpTo"?: { "moduleId": string, "flowId": string, "nodeId": string } } ]',
    '    }',
    '  ],',
    '  "permissions": [',
    '    {',
    '      "moduleId": string,',
    '      "tokens": [ { "text": string, "jumpTo"?: { "moduleId": string, "flowId": string, "nodeId": string } } ]',
    '    }',
    '  ]',
    '}',
    '',
    '硬性要求：',
    '1) 禁止输出无序列表或有序列表（不要出现 "-", "*", "1." 这种列表标记），每个模块输出必须是一个连续段落。',
    '2) 不要生成章节标题，不要生成额外章节。',
    '3) 当你在段落中提到某个“数据项 name”（来自 dataItems[].name），必须把该数据项单独作为一个 token（text 仅包含该 name），并在该 token 上设置 jumpTo，jumpTo 必须使用该 name 对应 refs 中的一个 {flowId,nodeId}。',
    '4) 当你在段落中提到某个“权限名称 permissionName”，必须把该权限名称单独作为一个 token，并设置 jumpTo（同样来自 refs）。',
    '5) 如果某模块没有可用 refs（例如 name=未识别 或 refs 为空），则不要设置 jumpTo，只写普通 text。',
    '6) 每个 token.text 禁止包含换行符。',
    '',
    '模块证据（JSON，已去重/截断）：',
    JSON.stringify(moduleSummaries),
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
  moduleIds: Set<string>,
  flowIndexes: Map<string, Map<string, Set<string>>>,
): { collectionAndUse: PrivacyReportSection[]; permissions: PrivacyReportSection[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new Error('LLM JSON 不是对象');

  function validateTokens(moduleId: string, tokensRaw: unknown): PrivacyReportToken[] {
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
      const jtModuleId = cleanText((jumpToRaw as any).moduleId) || moduleId;
      const flowId = cleanText((jumpToRaw as any).flowId);
      const nodeId = cleanText((jumpToRaw as any).nodeId);
      if (!flowId || !nodeId) {
        out.push({ text });
        continue;
      }
      const idx = flowIndexes.get(jtModuleId);
      const set = idx?.get(flowId);
      if (!idx || !set || !set.has(nodeId)) {
        warnings.push(`报告 token 的 jumpTo 无效：${jtModuleId}/${flowId}/${nodeId}（已移除跳转）`);
        out.push({ text });
        continue;
      }
      out.push({ text, jumpTo: { moduleId: jtModuleId, flowId, nodeId } });
    }
    return out;
  }

  function validateSectionArray(rawArr: unknown, kind: string): PrivacyReportSection[] {
    if (!Array.isArray(rawArr)) return [];
    const out: PrivacyReportSection[] = [];
    for (const s of rawArr) {
      if (!isRecord(s)) continue;
      const moduleId = cleanText(s.moduleId);
      if (!moduleId || !moduleIds.has(moduleId)) continue;
      const tokens = validateTokens(moduleId, s.tokens);
      if (tokens.length === 0) {
        out.push({ moduleId, tokens: [{ text: `${moduleId}：未生成${kind}段落` }] });
      } else {
        out.push({ moduleId, tokens });
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
  modules: Array<{ moduleId: string; facts: ModulePrivacyFactsContent; dataflows: DataflowsResult }>;
}): Promise<{ report: PrivacyReportFile; text: string; warnings: string[] }> {
  const generatedAt = new Date().toISOString();
  const moduleIds = new Set(args.modules.map((m) => m.moduleId));
  const flowIndexes = new Map<string, Map<string, Set<string>>>();
  for (const m of args.modules) {
    const perFlow = buildFlowNodeIndex(m.dataflows);
    flowIndexes.set(m.moduleId, perFlow);
  }

  const apiKey = typeof args.llm.apiKey === 'string' ? args.llm.apiKey.trim() : '';
  if (!apiKey) {
    const report: PrivacyReportFile = {
      meta: {
        runId: args.runId,
        generatedAt,
        llm: { provider: args.llm.provider, model: args.llm.model },
        skipped: true,
        skipReason: '隐私声明报告 LLM api-key 为空，跳过生成',
        counts: { modules: args.modules.length },
      },
      sections: {
        collectionAndUse: args.modules.map((m) => ({
          moduleId: m.moduleId,
          tokens: [{ text: `在【${m.moduleId}】模块中：隐私声明报告未生成（原因：LLM api-key 为空）。` }],
        })),
        permissions: args.modules.map((m) => ({
          moduleId: m.moduleId,
          tokens: [{ text: `在【${m.moduleId}】模块中：隐私声明报告未生成（原因：LLM api-key 为空）。` }],
        })),
      },
    };
    const text = renderPrivacyReportText(report);
    return { report, text, warnings: [] };
  }

  const prompt = buildPrompt({
    appName: args.appName,
    modules: args.modules.map((m) => ({ moduleId: m.moduleId, facts: m.facts })),
  });

  const raw = await chatJsonWithRetries({ llm: { ...args.llm, apiKey }, system: prompt.system, user: prompt.user });
  const validated = validateSections(raw, moduleIds, flowIndexes);

  const report: PrivacyReportFile = {
    meta: {
      runId: args.runId,
      generatedAt,
      llm: { provider: args.llm.provider, model: args.llm.model },
      counts: { modules: args.modules.length },
    },
    sections: {
      collectionAndUse: validated.collectionAndUse,
      permissions: validated.permissions,
    },
  };

  const text = renderPrivacyReportText(report);
  return { report, text, warnings: validated.warnings };
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
