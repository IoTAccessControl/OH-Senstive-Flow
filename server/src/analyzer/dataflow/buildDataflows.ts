import fs from 'node:fs/promises';
import path from 'node:path';

import type { CallGraph, CallGraphNode, CallGraphPath } from '../callGraph/types.js';
import type { SinkRecord, SourceRecord } from '../types.js';
import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';

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
        counts: { flows: 0, nodes: 0, edges: 0 },
      },
      flows: [],
    };
  }

  const baseUrls = resolveLlmBaseUrls(options.llm.provider);
  const sinkMap = groupSinkRecordsByCallsite(options.sinks);
  const sourceMap = groupSourceRecordsByKey(options.sources);

  const flows: Dataflow[] = [];
  let totalNodes = 0;
  let totalEdges = 0;

  for (const p of options.paths) {
    const anchors = buildPathAnchors(options.callGraph, p);
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

    let llmRes: { content: string; raw: unknown } | null = null;
    let lastError: unknown = null;

    for (const baseUrl of baseUrls) {
      try {
        llmRes = await openAiCompatibleChat({
          baseUrl,
          apiKey,
          model: options.llm.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: 0.2,
          jsonMode: true,
        });
        break;
      } catch (e) {
        lastError = e;

        const canRetry =
          baseUrls.length > 1 &&
          (e instanceof LlmNetworkError ||
            (e instanceof LlmHttpError && (e.status === 401 || e.status === 404 || e.status >= 500)));
        if (!canRetry) throw e;
      }
    }

    if (!llmRes) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    const parsed = safeJsonParse(llmRes.content);
    const llmResult = validateLlmResult(parsed);

    const nodes: Dataflow['nodes'] = [];
    for (let i = 0; i < llmResult.nodes.length; i += 1) {
      const n = llmResult.nodes[i]!;
      const filePath = normalizeWorkspacePath(options.repoRoot, n.filePath);
      const line = Math.max(1, Math.floor(n.line));
      const lines = await readFileLines(options.repoRoot, filePath);
      const code = lines ? getLineText(lines, line) : (n.code ?? '');
      const context = lines ? buildContext(lines, line, radius) : { startLine: line, lines: [code] };

      nodes.push({
        id: `${p.pathId}:n${i + 1}`,
        filePath,
        line,
        code,
        description: n.description,
        context,
      });
    }

    const edges: Dataflow['edges'] = [];
    if (llmResult.edges && llmResult.edges.length > 0) {
      for (const e of llmResult.edges) {
        const from = nodes[e.from]?.id;
        const to = nodes[e.to]?.id;
        if (!from || !to) continue;
        edges.push({ from, to });
      }
    }
    if (edges.length === 0) {
      for (let i = 0; i < nodes.length - 1; i += 1) edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
    }

    // Ensure all anchors exist at least once; add placeholder nodes if missing.
    const existing = new Set(nodes.map((n) => nodeKey(n)));
    for (const a of anchors) {
      const key = nodeKey({ filePath: a.filePath, line: a.line });
      if (existing.has(key)) continue;
      const lines = await readFileLines(options.repoRoot, a.filePath);
      const code = lines ? getLineText(lines, a.line) : a.code;
      const context = lines ? buildContext(lines, a.line, radius) : { startLine: a.line, lines: [code] };
      nodes.unshift({
        id: `${p.pathId}:anchor:${a.filePath}:${a.line}`,
        filePath: a.filePath,
        line: a.line,
        code,
        description: '（占位）该锚点节点在 LLM 输出中缺失；请检查 LLM 输出或扩大提示上下文。',
        context,
      });
      existing.add(key);
    }

    const flow: Dataflow = {
      flowId: `flow:${p.pathId}`,
      pathId: p.pathId,
      nodes,
      edges,
      summary: llmResult.summary,
    };

    flows.push(flow);
    totalNodes += nodes.length;
    totalEdges += edges.length;
  }

  return {
    meta: {
      runId: options.runId,
      generatedAt: new Date().toISOString(),
      llm: { provider: options.llm.provider, model: options.llm.model },
      counts: {
        flows: flows.length,
        nodes: totalNodes,
        edges: totalEdges,
      },
    },
    flows,
  };
}
