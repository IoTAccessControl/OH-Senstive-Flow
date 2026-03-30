import fs from 'node:fs/promises';
import path from 'node:path';

import type { CallGraph, CallGraphNode, CallGraphPath } from '../callgraph/types.js';
import type { SinkRecord, SourceRecord } from '../extract/types.js';
import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';

import type { Dataflow, DataflowsResult } from './types.js';

type BuildDataflowsOptions = {
  repoRoot: string;
  runId: string;
  appFiles: string[]; // absolute paths
  callGraph: CallGraph;
  paths: CallGraphPath[];
  sinks: SinkRecord[];
  sources: SourceRecord[];
  llm: {
    provider: string;
    apiKey: string;
    model: string;
  };
  contextRadiusLines?: number; // default 5
};

type LlmEdge = { from: number; to: number };
type LlmNode = { filePath: string; line: number; description: string; code?: string };
type LlmResult = {
  summary?: {
    dataItems?: string[];
    collectionFrequency?: string[];
    cloudUpload?: string[];
    storageAndEncryption?: string[];
    permissions?: string[];
  };
  nodes: LlmNode[];
  edges?: LlmEdge[];
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

function isWithinRepo(repoRoot: string, targetAbs: string): boolean {
  const rel = path.relative(repoRoot, targetAbs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function readFileLines(repoRoot: string, filePath: string): Promise<string[] | null> {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  if (path.isAbsolute(filePath) && !abs.startsWith(repoRoot)) return null;
  if (!path.isAbsolute(filePath) && !isWithinRepo(repoRoot, abs)) return null;
  try {
    const text = await fs.readFile(abs, 'utf8');
    return text.split(/\r?\n/u);
  } catch {
    return null;
  }
}

function getLineText(lines: string[], line1Based: number): string {
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return '';
  return (lines[idx] ?? '').trim();
}

function buildContext(lines: string[], line1Based: number, radius: number): { startLine: number; lines: string[] } {
  const start = Math.max(1, line1Based - radius);
  const end = Math.min(lines.length, line1Based + radius);
  return {
    startLine: start,
    lines: lines.slice(start - 1, end),
  };
}

function normalizeWorkspacePath(repoRoot: string, filePath: string): string {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) {
    const rel = path.relative(repoRoot, filePath);
    return rel.split(path.sep).join('/');
  }
  return filePath.split(path.sep).join('/');
}

function nodeKey(n: { filePath: string; line: number }): string {
  return `${n.filePath}:${n.line}`;
}

function groupSinkRecordsByCallsite(sinks: SinkRecord[]): Map<string, SinkRecord[]> {
  const map = new Map<string, SinkRecord[]>();
  for (const s of sinks) {
    const key = `${s['App源码文件路径']}:${s['调用行号']}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

function groupSourceRecordsByKey(sources: SourceRecord[]): Map<string, SourceRecord> {
  const map = new Map<string, SourceRecord>();
  for (const s of sources) {
    const key = `${s['App源码文件路径']}:${s['行号']}:${s['函数名称']}`;
    map.set(key, s);
  }
  return map;
}

function buildPathAnchors(callGraph: CallGraph, path: CallGraphPath): CallGraphNode[] {
  const byId = new Map(callGraph.nodes.map((n) => [n.id, n] as const));
  return path.nodeIds.map((id) => byId.get(id)).filter((n): n is CallGraphNode => Boolean(n));
}

function normalizeAnchors(anchors: CallGraphNode[]): CallGraphNode[] {
  const out: CallGraphNode[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const key = nodeKey(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor);
  }
  return out;
}

function formatAnchorsForPrompt(anchors: CallGraphNode[]): string {
  return anchors
    .map((a, idx) => {
      const label = `${idx + 1}. (${a.type}) ${a.filePath}:${a.line}`;
      const code = a.code ? `    ${a.code}` : '';
      return [label, code].filter(Boolean).join('\n');
    })
    .join('\n');
}

function formatSinkDetailsForPrompt(sinkRecords: SinkRecord[]): string {
  return sinkRecords
    .map((s, idx) => {
      const api = s.__apiKey ? `api=${s.__apiKey}` : 'api=(unknown)';
      const desc = s['API功能描述'] ? s['API功能描述'] : '';
      return `${idx + 1}. ${api} 描述=${desc}`;
    })
    .join('\n');
}

function buildLlmPrompt(args: {
  anchors: CallGraphNode[];
  sinkDetails: string;
  sourceDetails: string;
  codeSnippets: string;
}): { system: string; user: string } {
  const system = [
    '你是一个静态分析与隐私合规分析助手，擅长分析 OpenHarmony ArkTS 应用中的数据流。',
    '你需要从源码角度解释每一步节点在做什么，并尽量找出与隐私/权限相关的数据项。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const user = [
    '请基于下面的“锚点路径（CallGraph Path）”与“源码片段”，构建一条更完整的数据流（DataFlow）。',
    '',
    '重点关注并尽量覆盖这些信息：',
    '- 数据项（例如位置、设备标识、联系人等）',
    '- 收集频率（例如一次性、周期性、事件触发）',
    '- 处理方式（是否上传至云端/网络发送）',
    '- 存储方式（是否本地存储、是否加密）',
    '- 权限名称（例如 ohos.permission.*）',
    '',
    '硬性要求：',
    '1) 你的输出 JSON 中 nodes 必须包含所有锚点（同 filePath + line）。可以在锚点之间插入更多节点。',
    '2) 每个 node 必须有：filePath（工作区相对路径）、line（1-based）、description（中文，说明该行在数据流中的作用）。',
    '3) edges 用数组表示，元素为 {from,to}，from/to 为 nodes 数组下标（0-based）。如果你无法确定，可按 nodes 顺序连成链。',
    '4) 禁止跨到当前锚点路径之外的其他 source/生命周期函数；不要把 onPageShow、onPageHide、onCreate 等不同入口拼成同一条数据流。',
    '5) 最终 sink 锚点必须出现在 nodes 中，且它必须是最后一个节点；不要越过当前 sink 锚点继续扩展后续判断或分支。',
    '',
    '输出 JSON 结构：',
    '{',
    '  "summary": {',
    '    "dataItems": string[],',
    '    "collectionFrequency": string[],',
    '    "cloudUpload": string[],',
    '    "storageAndEncryption": string[],',
    '    "permissions": string[]',
    '  },',
    '  "nodes": [ { "filePath": "...", "line": 123, "description": "..." } ],',
    '  "edges": [ { "from": 0, "to": 1 } ]',
    '}',
    '',
    '锚点路径：',
    formatAnchorsForPrompt(args.anchors),
    '',
    args.sourceDetails ? `source 说明：\n${args.sourceDetails}` : '',
    args.sinkDetails ? `sink 说明：\n${args.sinkDetails}` : '',
    '',
    '源码片段（含行号）：',
    args.codeSnippets,
  ]
    .filter((x) => x.trim().length > 0)
    .join('\n');

  return { system, user };
}

async function buildCodeSnippetsForAnchors(repoRoot: string, anchors: CallGraphNode[]): Promise<string> {
  const perFile = new Map<string, Set<number>>();
  for (const a of anchors) {
    const set = perFile.get(a.filePath) ?? new Set<number>();
    set.add(a.line);
    perFile.set(a.filePath, set);
  }

  const parts: string[] = [];
  for (const [filePath, lineSet] of perFile) {
    const lines = await readFileLines(repoRoot, filePath);
    if (!lines) continue;
    const sorted = Array.from(lineSet).sort((a, b) => a - b);
    parts.push(`--- ${filePath} ---`);
    for (const line of sorted) {
      const start = Math.max(1, line - 8);
      const end = Math.min(lines.length, line + 8);
      for (let ln = start; ln <= end; ln += 1) {
        const prefix = ln === line ? '>' : ' ';
        parts.push(`${prefix} ${String(ln).padStart(5, ' ')}: ${lines[ln - 1] ?? ''}`);
      }
      parts.push('');
    }
  }
  return parts.join('\n');
}

function validateLlmResult(raw: unknown): LlmResult {
  if (!raw || typeof raw !== 'object') throw new Error('LLM JSON 不是对象');
  const nodes = (raw as any).nodes;
  if (!Array.isArray(nodes)) throw new Error('LLM JSON 缺少 nodes[]');
  const edges = (raw as any).edges;

  const cleanedNodes: LlmNode[] = [];
  for (const n of nodes) {
    const filePath = typeof n?.filePath === 'string' ? n.filePath : '';
    const line = typeof n?.line === 'number' ? n.line : Number(n?.line);
    const description = typeof n?.description === 'string' ? n.description : '';
    const code = typeof n?.code === 'string' ? n.code : undefined;
    if (!filePath || !Number.isFinite(line) || !description) continue;
    cleanedNodes.push({ filePath, line: Math.floor(line), description, code });
  }

  const cleanedEdges: LlmEdge[] = [];
  if (Array.isArray(edges)) {
    for (const e of edges) {
      const from = typeof e?.from === 'number' ? e.from : Number(e?.from);
      const to = typeof e?.to === 'number' ? e.to : Number(e?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      cleanedEdges.push({ from: Math.floor(from), to: Math.floor(to) });
    }
  }

  const summaryRaw = (raw as any).summary;
  const summary = summaryRaw && typeof summaryRaw === 'object'
    ? {
        dataItems: Array.isArray(summaryRaw.dataItems) ? summaryRaw.dataItems.map(String) : undefined,
        collectionFrequency: Array.isArray(summaryRaw.collectionFrequency)
          ? summaryRaw.collectionFrequency.map(String)
          : undefined,
        cloudUpload: Array.isArray(summaryRaw.cloudUpload) ? summaryRaw.cloudUpload.map(String) : undefined,
        storageAndEncryption: Array.isArray(summaryRaw.storageAndEncryption)
          ? summaryRaw.storageAndEncryption.map(String)
          : undefined,
        permissions: Array.isArray(summaryRaw.permissions) ? summaryRaw.permissions.map(String) : undefined,
      }
    : undefined;

  return { nodes: cleanedNodes, edges: cleanedEdges.length > 0 ? cleanedEdges : undefined, summary };
}

function asErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryLlmError(error: unknown): boolean {
  if (error instanceof LlmNetworkError) return true;
  if (error instanceof LlmHttpError) return error.status === 429 || error.status >= 500;
  const message = asErrorMessage(error);
  return /(?:LLM 返回无法解析为 JSON|LLM 返回非 JSON|缺少 message\.content|LLM JSON 不是对象|LLM JSON 缺少 nodes\[\]|LLM JSON nodes 为空)/u.test(
    message,
  );
}

async function requestDataflowLlm(args: {
  baseUrls: string[];
  apiKey: string;
  model: string;
  system: string;
  user: string;
}): Promise<LlmResult> {
  const retryDelaysMs = [300, 800];
  const maxAttempts = retryDelaysMs.length + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (let i = 0; i < args.baseUrls.length; i += 1) {
      const baseUrl = args.baseUrls[i]!;
      try {
        const llmRes = await openAiCompatibleChat({
          baseUrl,
          apiKey: args.apiKey,
          model: args.model,
          messages: [
            { role: 'system', content: args.system },
            { role: 'user', content: args.user },
          ],
          temperature: 0.2,
          jsonMode: true,
        });
        const parsed = safeJsonParse(llmRes.content);
        const llmResult = validateLlmResult(parsed);
        if (llmResult.nodes.length === 0) throw new Error('LLM JSON nodes 为空');
        return llmResult;
      } catch (error) {
        lastError = error;
        const hasMoreBaseUrls = i < args.baseUrls.length - 1;
        const canTryAnotherBaseUrl =
          hasMoreBaseUrls &&
          (shouldRetryLlmError(error) ||
            (error instanceof LlmHttpError && (error.status === 401 || error.status === 404)));
        if (canTryAnotherBaseUrl) continue;

        const retriable = shouldRetryLlmError(error);
        if (!retriable || attempt >= maxAttempts - 1) {
          throw error;
        }
        break;
      }
    }

    if (!shouldRetryLlmError(lastError) || attempt >= retryDelaysMs.length) break;
    await sleep(retryDelaysMs[attempt]!);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function buildFlowFromLlmResult(args: {
  repoRoot: string;
  radius: number;
  path: CallGraphPath;
  anchors: CallGraphNode[];
  llmResult: LlmResult;
}): Promise<Dataflow> {
  const nodes: Dataflow['nodes'] = [];
  for (let i = 0; i < args.llmResult.nodes.length; i += 1) {
    const n = args.llmResult.nodes[i]!;
    const filePath = normalizeWorkspacePath(args.repoRoot, n.filePath);
    const line = Math.max(1, Math.floor(n.line));
    const lines = await readFileLines(args.repoRoot, filePath);
    const code = lines ? getLineText(lines, line) : (n.code ?? '');
    const context = lines ? buildContext(lines, line, args.radius) : { startLine: line, lines: [code] };

    nodes.push({
      id: `${args.path.pathId}:n${i + 1}`,
      filePath,
      line,
      code,
      description: n.description,
      context,
    });
  }

  const edges: Dataflow['edges'] = [];
  if (args.llmResult.edges && args.llmResult.edges.length > 0) {
    for (const e of args.llmResult.edges) {
      const from = nodes[e.from]?.id;
      const to = nodes[e.to]?.id;
      if (!from || !to) continue;
      edges.push({ from, to });
    }
  }
  if (edges.length === 0) {
    for (let i = 0; i < nodes.length - 1; i += 1) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }

  const existing = new Set(nodes.map((n) => nodeKey(n)));
  for (const a of args.anchors) {
    const key = nodeKey({ filePath: a.filePath, line: a.line });
    if (existing.has(key)) continue;
    const lines = await readFileLines(args.repoRoot, a.filePath);
    const code = lines ? getLineText(lines, a.line) : a.code;
    const context = lines ? buildContext(lines, a.line, args.radius) : { startLine: a.line, lines: [code] };
    nodes.unshift({
      id: `${args.path.pathId}:anchor:${a.filePath}:${a.line}`,
      filePath: a.filePath,
      line: a.line,
      code,
      description: '（占位）该锚点节点在 LLM 输出中缺失；请检查 LLM 输出或扩大提示上下文。',
      context,
    });
    existing.add(key);
  }

  return {
    flowId: `flow:${args.path.pathId}`,
    pathId: args.path.pathId,
    nodes,
    edges,
    summary: args.llmResult.summary,
  };
}

function buildSourceLineKeySet(sources: SourceRecord[]): Set<string> {
  const set = new Set<string>();
  for (const source of sources) {
    set.add(`${source['App源码文件路径']}:${source['行号']}`);
  }
  return set;
}

function findLastSinkAnchor(anchors: CallGraphNode[]): CallGraphNode | null {
  for (let i = anchors.length - 1; i >= 0; i -= 1) {
    if (anchors[i]!.type === 'sinkCall') return anchors[i]!;
  }
  return null;
}

function validateLlmResultAgainstAnchors(args: {
  repoRoot: string;
  anchors: CallGraphNode[];
  llmResult: LlmResult;
  sourceLineKeys: Set<string>;
}): string | null {
  const llmKeys = args.llmResult.nodes.map((node) =>
    nodeKey({
      filePath: normalizeWorkspacePath(args.repoRoot, node.filePath),
      line: Math.max(1, Math.floor(node.line)),
    }),
  );

  const anchorKeys = args.anchors.map((anchor) => nodeKey(anchor));
  let previousAnchorIndex = -1;
  for (const anchorKey of anchorKeys) {
    const idx = llmKeys.findIndex((key, index) => index > previousAnchorIndex && key === anchorKey);
    if (idx < 0) return `LLM 输出缺少锚点节点 ${anchorKey}`;
    if (idx <= previousAnchorIndex) return `LLM 输出中的锚点顺序异常：${anchorKey}`;
    previousAnchorIndex = idx;
  }

  const anchorSourceKeys = new Set(args.anchors.filter((anchor) => anchor.type === 'source').map((anchor) => nodeKey(anchor)));
  for (const key of llmKeys) {
    if (args.sourceLineKeys.has(key) && !anchorSourceKeys.has(key)) {
      return `LLM 输出跨入了当前路径之外的 source：${key}`;
    }
  }

  const sinkAnchor = findLastSinkAnchor(args.anchors);
  if (!sinkAnchor) return null;
  const sinkIndex = llmKeys.indexOf(nodeKey(sinkAnchor));
  if (sinkIndex >= 0 && sinkIndex !== llmKeys.length - 1) {
    return `LLM 输出在最终 sink 锚点 ${sinkAnchor.filePath}:${sinkAnchor.line} 之后继续扩展`;
  }

  return null;
}

function fallbackDescriptionForAnchor(anchor: CallGraphNode): string {
  const suffix = '（LLM 失败，使用锚点回退）';
  const detail = anchor.description?.trim();
  if (detail) return `${detail}${suffix}`;
  const label = anchor.name?.trim() || anchor.code?.trim() || `${anchor.filePath}:${anchor.line}`;
  if (anchor.type === 'source') return `数据流起点：${label}${suffix}`;
  if (anchor.type === 'sinkCall') return `潜在敏感调用：${label}${suffix}`;
  return `中间调用节点：${label}${suffix}`;
}

async function buildFallbackFlow(args: {
  repoRoot: string;
  radius: number;
  path: CallGraphPath;
  anchors: CallGraphNode[];
  warning: string;
}): Promise<Dataflow> {
  const nodes: Dataflow['nodes'] = [];
  for (let i = 0; i < args.anchors.length; i += 1) {
    const anchor = args.anchors[i]!;
    const filePath = normalizeWorkspacePath(args.repoRoot, anchor.filePath);
    const line = Math.max(1, Math.floor(anchor.line));
    const lines = await readFileLines(args.repoRoot, filePath);
    const code = lines ? getLineText(lines, line) : anchor.code;
    const context = lines ? buildContext(lines, line, args.radius) : { startLine: line, lines: [code] };
    nodes.push({
      id: `${args.path.pathId}:n${i + 1}`,
      filePath,
      line,
      code,
      description: fallbackDescriptionForAnchor(anchor),
      context,
    });
  }

  const edges: Dataflow['edges'] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }

  return {
    flowId: `flow:${args.path.pathId}`,
    pathId: args.path.pathId,
    nodes,
    edges,
    meta: {
      fallback: true,
      warnings: [args.warning],
    },
  };
}

export async function buildDataflows(options: BuildDataflowsOptions): Promise<DataflowsResult> {
  const radius = options.contextRadiusLines ?? 5;
  const apiKey = typeof options.llm.apiKey === 'string' ? options.llm.apiKey.trim() : '';

  if (!apiKey) {
    return {
      meta: {
        runId: options.runId,
        generatedAt: new Date().toISOString(),
        skipped: true,
        skipReason: 'LLM api-key 为空，跳过数据流分析（仍会生成调用图）',
        llm: { provider: options.llm.provider, model: options.llm.model },
        counts: { flows: 0, nodes: 0, edges: 0, failedPaths: 0, fallbackFlows: 0 },
      },
      flows: [],
    };
  }

  const baseUrls = resolveLlmBaseUrls(options.llm.provider);
  const sinkMap = groupSinkRecordsByCallsite(options.sinks);
  const sourceMap = groupSourceRecordsByKey(options.sources);
  const sourceLineKeys = buildSourceLineKeySet(options.sources);

  const flows: Dataflow[] = [];
  const warnings: string[] = [];
  let totalNodes = 0;
  let totalEdges = 0;
  let failedPaths = 0;
  let fallbackFlows = 0;

  for (const p of options.paths) {
    const anchors = normalizeAnchors(buildPathAnchors(options.callGraph, p));
    if (anchors.length === 0) continue;

    let sinkAnchor = anchors[anchors.length - 1]!;
    for (let i = anchors.length - 1; i >= 0; i -= 1) {
      if (anchors[i]!.type === 'sinkCall') {
        sinkAnchor = anchors[i]!;
        break;
      }
    }
    const sinkKey = `${sinkAnchor.filePath}:${sinkAnchor.line}`;
    const sinkRecords = sinkMap.get(sinkKey) ?? [];

    const sourceAnchor = anchors.find((a) => a.type === 'source') ?? anchors[0];
    const sourceKey = `${sourceAnchor.filePath}:${sourceAnchor.line}:${sourceAnchor.name ?? ''}`;
    const sourceRecord = sourceMap.get(sourceKey);
    const sourceDetails = sourceRecord ? `${sourceRecord['函数名称']}：${sourceRecord['描述']}` : '';
    const sinkDetails = sinkRecords.length > 0 ? formatSinkDetailsForPrompt(sinkRecords) : '';

    const codeSnippets = await buildCodeSnippetsForAnchors(options.repoRoot, anchors);
    const prompt = buildLlmPrompt({ anchors, sinkDetails, sourceDetails, codeSnippets });

    try {
      const llmResult = await requestDataflowLlm({
        baseUrls,
        apiKey,
        model: options.llm.model,
        system: prompt.system,
        user: prompt.user,
      });
      const invalidReason = validateLlmResultAgainstAnchors({
        repoRoot: options.repoRoot,
        anchors,
        llmResult,
        sourceLineKeys,
      });
      if (invalidReason) throw new Error(invalidReason);
      const flow = await buildFlowFromLlmResult({
        repoRoot: options.repoRoot,
        radius,
        path: p,
        anchors,
        llmResult,
      });
      flows.push(flow);
      totalNodes += flow.nodes.length;
      totalEdges += flow.edges.length;
    } catch (error) {
      const warning = `数据流 ${p.pathId} LLM 分析失败，已回退到锚点数据流：${asErrorMessage(error)}`;
      warnings.push(warning);
      const flow = await buildFallbackFlow({
        repoRoot: options.repoRoot,
        radius,
        path: p,
        anchors,
        warning,
      });
      flows.push(flow);
      totalNodes += flow.nodes.length;
      totalEdges += flow.edges.length;
      failedPaths += 1;
      fallbackFlows += 1;
    }
  }

  return {
    meta: {
      runId: options.runId,
      generatedAt: new Date().toISOString(),
      llm: { provider: options.llm.provider, model: options.llm.model },
      warnings: warnings.length > 0 ? warnings : undefined,
      counts: {
        flows: flows.length,
        nodes: totalNodes,
        edges: totalEdges,
        failedPaths,
        fallbackFlows,
      },
    },
    flows,
  };
}
