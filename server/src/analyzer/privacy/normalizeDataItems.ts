import { chatJsonWithRetries } from './facts.js';
import { analysisLog } from '../../utils/analysisLog.js';
import type { DataflowsResult } from '../dataflow/types.js';
import type { FeaturePrivacyFactsContent } from './types.js';

type LlmConfig = { provider: string; apiKey: string; model: string; baseUrl?: string };

export type DataItemDecision = {
  name: string;
  canonical: string | null;
  reason: string;
};

export type DataItemNormalization = {
  decisions: DataItemDecision[];
  mapping: Map<string, string>;
};

export type DataItemCandidate = {
  name: string;
  scenario: string;
  evidence: string[];
};

export type DataItemVocabularyEntry = {
  name: string;
  definition?: string;
};

export type NormalizationSourceEntry = {
  facts: FeaturePrivacyFactsContent;
  dataflows: DataflowsResult;
};

const SYSTEM_PROMPT =
  '你是隐私数据项名称归一器。基于候选名称附带的真实代码证据，判断它与规范数据项是否指代同一隐私概念，只输出严格 JSON。';

const MAX_EVIDENCE_PER_CANDIDATE = 2;
const MAX_EVIDENCE_CODE_CHARS = 120;

export function collectUnmatchedDataItemCandidates(
  entries: NormalizationSourceEntry[],
  canonicalNames: Set<string>,
): DataItemCandidate[] {
  const byName = new Map<string, DataItemCandidate>();

  for (const entry of entries) {
    const nodeIndex = new Map<string, Map<string, { filePath?: unknown; line?: unknown; code?: unknown }>>();
    for (const flow of entry.dataflows?.flows ?? []) {
      const nodes = new Map<string, { filePath?: unknown; line?: unknown; code?: unknown }>();
      for (const node of (flow as { nodes?: Array<Record<string, unknown>> }).nodes ?? []) {
        nodes.set(String(node?.id ?? ''), node);
      }
      nodeIndex.set(String((flow as { flowId?: unknown }).flowId ?? ''), nodes);
    }

    for (const practice of entry.facts?.dataPractices ?? []) {
      const scenario = String(practice?.businessScenario ?? '').trim();
      for (const item of practice?.dataItems ?? []) {
        const name = String(item?.name ?? '').trim();
        if (!name || canonicalNames.has(name)) continue;

        let candidate = byName.get(name);
        if (!candidate) {
          candidate = { name, scenario, evidence: [] };
          byName.set(name, candidate);
        }
        if (!candidate.scenario && scenario) candidate.scenario = scenario;
        if (candidate.evidence.length >= MAX_EVIDENCE_PER_CANDIDATE) continue;

        for (const ref of item?.refs ?? []) {
          const node = nodeIndex.get(String(ref?.flowId ?? ''))?.get(String(ref?.nodeId ?? ''));
          if (!node) continue;
          const filePath = String(node.filePath ?? '').trim();
          const line = String(node.line ?? '').trim();
          const code = String(node.code ?? '').trim().slice(0, MAX_EVIDENCE_CODE_CHARS);
          const text = `${filePath}${line ? `:${line}` : ''} ${code}`.trim();
          if (text && !candidate.evidence.includes(text)) {
            candidate.evidence.push(text);
          }
          if (candidate.evidence.length >= MAX_EVIDENCE_PER_CANDIDATE) break;
        }
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildNormalizationPrompt(
  appName: string,
  vocabulary: DataItemVocabularyEntry[],
  candidates: DataItemCandidate[],
): string {
  const vocabularyLines = vocabulary.map((entry, index) =>
    entry.definition ? `${index + 1}. ${entry.name}：${entry.definition}` : `${index + 1}. ${entry.name}`,
  );
  const candidatePayload = candidates.map((candidate) => ({
    name: candidate.name,
    scenario: candidate.scenario,
    evidence: candidate.evidence,
  }));

  return [
    `应用：${appName}`,
    '',
    '规范数据项清单（canonical 字段只能取清单中的名称或 null；冒号后为定义）：',
    vocabularyLines.join('\n'),
    '',
    '候选名称及其证据（证据来自该应用真实数据流的代码位置，可能为空）：',
    JSON.stringify(candidatePayload, null, 1),
    '',
    '对每个候选名称判断：结合证据，它是否与清单中某个规范数据项指代同一个东西。',
    '只输出严格 JSON：{"decisions":[{"name":"候选原名","canonical":"清单中的规范名或null","reason":"一句中文理由"}]}',
    '硬性要求：',
    '1) decisions 必须覆盖全部候选，name 与候选原文完全一致；',
    '2) canonical 只能是清单中的名称原文之一或 null；',
    '3) 必须基于证据判定“同指”：候选与规范项指同一个具体数据才映射；仅“属于其子类或一种实例”的泛化关系（如“屏幕显示参数”之于“设备信息”、“按键输入信息”之于“用户输入内容”）必须 null；',
    '4) 候选名是用“与/及/和/、”连接多个概念的复合名时必须 null（应先拆分再归一）；',
    '5) 按钮文案、操作行为、UI 组件名等非数据项一律 null；',
    '6) 清单中存在含义相近的兄弟项（如“授权码”与“授权标识”）时，必须依据证据中的代码与定义唯一确定其一；证据不足以区分时 null，并在 reason 说明缺少什么证据；',
    '7) 不要输出多余文本。',
  ].join('\n');
}

export function parseNormalizationDecisions(
  raw: unknown,
  candidates: string[],
  canonicalNames: Set<string>,
): DataItemDecision[] {
  const container = raw as { decisions?: unknown } | null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(container?.decisions)
      ? (container!.decisions as unknown[])
      : [];

  const byName = new Map<string, DataItemDecision>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || byName.has(name)) continue;
    const canonicalRaw = typeof record.canonical === 'string' ? record.canonical.trim() : '';
    const canonical = canonicalRaw && canonicalNames.has(canonicalRaw) ? canonicalRaw : null;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
    byName.set(name, { name, canonical, reason });
  }

  return candidates.map(
    (candidate) => byName.get(candidate) ?? { name: candidate, canonical: null, reason: '模型未返回该候选的判定' },
  );
}

export async function normalizeDataItemNames(args: {
  appName: string;
  candidates: DataItemCandidate[];
  vocabulary: DataItemVocabularyEntry[];
  llm: LlmConfig;
}): Promise<DataItemNormalization> {
  const { appName, candidates, vocabulary, llm } = args;
  if (candidates.length === 0 || vocabulary.length === 0) {
    return { decisions: [], mapping: new Map() };
  }

  const candidateNames = candidates.map((candidate) => candidate.name);
  const canonicalNames = new Set(vocabulary.map((entry) => entry.name));
  let decisions: DataItemDecision[];
  try {
    const raw = await chatJsonWithRetries({
      llm,
      system: SYSTEM_PROMPT,
      user: buildNormalizationPrompt(appName, vocabulary, candidates),
      maxTokens: 3072,
      timeoutMs: 60_000,
    });
    decisions = parseNormalizationDecisions(raw, candidateNames, canonicalNames);
  } catch (error) {
    analysisLog(`数据项归一请求失败，全部保留原名：${(error as Error).message}`);
    decisions = candidateNames.map((name) => ({ name, canonical: null, reason: '归一请求失败' }));
  }

  const mapping = new Map<string, string>();
  for (const decision of decisions) {
    if (decision.canonical && decision.canonical !== decision.name) {
      mapping.set(decision.name, decision.canonical);
    }
  }
  return { decisions, mapping };
}

export function applyDataItemNormalization(
  facts: FeaturePrivacyFactsContent,
  mapping: Map<string, string>,
): FeaturePrivacyFactsContent {
  if (mapping.size === 0) return facts;
  return {
    ...facts,
    dataPractices: (facts.dataPractices ?? []).map((practice) => ({
      ...practice,
      dataItems: (practice.dataItems ?? []).map((item) => {
        const name = String(item?.name ?? '').trim();
        const canonical = mapping.get(name);
        return canonical ? { ...item, name: canonical } : item;
      }),
    })),
  };
}

export function buildNormalizationArtifact(args: {
  model: string;
  canonicalCount: number;
  normalization: DataItemNormalization;
}): Record<string, unknown> {
  const { decisions } = args.normalization;
  const applied = decisions.filter((decision) => decision.canonical !== null).length;
  return {
    model: args.model,
    canonicalCount: args.canonicalCount,
    candidateCount: decisions.length,
    appliedCount: applied,
    rejectedCount: decisions.length - applied,
    decisions,
  };
}
