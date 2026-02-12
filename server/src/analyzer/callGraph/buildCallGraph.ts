import fs from 'node:fs/promises';
import ts from 'typescript';

import { toWorkspaceRelativePath } from '../pathUtils.js';
import { scanTokens } from '../tokenScanner.js';
import type { SinkRecord, SourceRecord } from '../types.js';
import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';

import { scanFunctionBlocks, type FunctionBlock } from './functionBlocks.js';
import type { CallGraph, CallGraphEdge, CallGraphNode } from './types.js';

type BuildCallGraphOptions = {
  repoRoot: string;
  runId: string;
  appFiles: string[]; // absolute paths
  sinks: SinkRecord[];
  sources: SourceRecord[];
  llm?: {
    provider: string;
    apiKey: string;
    model: string;
  };
};

type FunctionNodeInfo = {
  fileAbs: string;
  fileRel: string;
  block: FunctionBlock;
  node: CallGraphNode;
};

function getLineTextAt(sourceText: string, lineNumber1Based: number): string {
  const lines = sourceText.split(/\r?\n/u);
  const idx = lineNumber1Based - 1;
  if (idx < 0 || idx >= lines.length) return '';
  return lines[idx].trim();
}

function buildFunctionNodeId(fileRel: string, startLine: number, name: string): string {
  return `fn:${fileRel}:${startLine}:${name}`;
}

function buildSinkCallNodeId(fileRel: string, line: number): string {
  return `sink:${fileRel}:${line}`;
}

function buildSourceFallbackNodeId(fileRel: string, line: number, name: string): string {
  return `source:${fileRel}:${line}:${name}`;
}

function pickCalleeNode(
  caller: FunctionNodeInfo,
  calleeName: string,
  functionsByName: Map<string, FunctionNodeInfo[]>,
): FunctionNodeInfo | null {
  const candidates = functionsByName.get(calleeName);
  if (!candidates || candidates.length === 0) return null;

  const sameFile = candidates.filter((c) => c.fileRel === caller.fileRel);
  if (sameFile.length === 1) return sameFile[0]!;
  if (sameFile.length > 1) {
    // Prefer the closest definition (by line) in the same file.
    let best: FunctionNodeInfo | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of sameFile) {
      const dist = Math.abs(c.block.startLine - caller.block.startLine);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  }

  if (candidates.length === 1) return candidates[0]!;
  return null;
}

function lowerBoundTokenPos(tokens: { pos: number }[], pos: number): number {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (tokens[mid]!.pos < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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

function clampText(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildFunctionSnippet(args: { fileText: string; block: FunctionBlock; maxLines?: number }): string {
  const maxLines = args.maxLines ?? 80;
  const lines = args.fileText.split(/\r?\n/u);
  const start = Math.max(1, args.block.startLine);
  const end = Math.min(lines.length, Math.max(start, args.block.endLine));

  const slice = lines.slice(start - 1, end);
  const total = slice.length;

  const headCount = 56;
  const tailCount = 20;
  let picked: Array<{ line: number; text: string }> = [];

  if (total <= maxLines) {
    picked = slice.map((text, idx) => ({ line: start + idx, text }));
  } else {
    const head = slice.slice(0, Math.min(headCount, total));
    const tail = slice.slice(Math.max(0, total - tailCount));
    picked = [
      ...head.map((text, idx) => ({ line: start + idx, text })),
      { line: -1, text: `...（中间省略 ${Math.max(0, total - head.length - tail.length)} 行）...` },
      ...tail.map((text, idx) => ({ line: end - tail.length + 1 + idx, text })),
    ];
  }

  return picked
    .map((x) => {
      if (x.line < 0) return x.text;
      return `${String(x.line).padStart(5, ' ')}: ${x.text}`;
    })
    .join('\n');
}

function buildFunctionDescriptionPrompt(args: {
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  snippet: string;
}): { system: string; user: string } {
  const system = [
    '你是一个静态分析助手，擅长阅读 TypeScript/ArkTS（OpenHarmony）源码并总结函数/方法的功能。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const user = [
    '请根据下面的函数/方法代码，生成一句简洁的中文描述，概括该函数的主要职责。',
    '要求：',
    '- 直接描述“做了什么”，避免复述代码细节；',
    '- 尽量具体（例如：页面跳转、读取系统信息、发起网络请求、写入存储等）；',
    '- 1 句话为主，长度不超过 60 个汉字；',
    '- 若无法判断，给出最可能用途，并在末尾加上“（不确定）”。',
    '',
    '输出 JSON：',
    '{ "description": "..." }',
    '',
    `位置：${args.filePath}:${args.startLine}-${args.endLine}`,
    `函数名：${args.functionName}`,
    '',
    '代码片段（含行号）：',
    args.snippet,
  ].join('\n');

  return { system, user };
}

function extractDescriptionFromLlmJson(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const desc = (raw as any).description;
  return typeof desc === 'string' ? desc.trim() : '';
}

async function chatWithFallbackBaseUrls(args: {
  llm: { provider: string; apiKey: string; model: string };
  system: string;
  user: string;
}): Promise<string> {
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
        maxTokens: 200,
        jsonMode: true,
      });
      return res.content;
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

async function withConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function reachableForward(startIds: string[], edges: CallGraphEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const s of startIds) {
    if (seen.has(s)) continue;
    seen.add(s);
    queue.push(s);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const next = adj.get(cur);
    if (!next) continue;
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }

  return seen;
}

function reachableBackward(endIds: string[], edges: CallGraphEdge[]): Set<string> {
  const radj = new Map<string, string[]>();
  for (const e of edges) {
    const list = radj.get(e.to) ?? [];
    list.push(e.from);
    radj.set(e.to, list);
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const s of endIds) {
    if (seen.has(s)) continue;
    seen.add(s);
    queue.push(s);
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const next = radj.get(cur);
    if (!next) continue;
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }

  return seen;
}

export async function buildCallGraph(options: BuildCallGraphOptions): Promise<CallGraph> {
  const absByRel = new Map<string, string>();
  for (const abs of options.appFiles) {
    const rel = toWorkspaceRelativePath(options.repoRoot, abs);
    absByRel.set(rel, abs);
  }

  const fileTextByAbs = new Map<string, string>();
  const nodeById = new Map<string, CallGraphNode>();
  const functionInfos: FunctionNodeInfo[] = [];
  const functionInfoById = new Map<string, FunctionNodeInfo>();

  for (const fileAbs of options.appFiles) {
    const fileText = await fs.readFile(fileAbs, 'utf8');
    fileTextByAbs.set(fileAbs, fileText);
    const fileRel = toWorkspaceRelativePath(options.repoRoot, fileAbs);
    const sf = ts.createSourceFile(fileAbs, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const blocks = scanFunctionBlocks(fileText, sf);
    for (const block of blocks) {
      const id = buildFunctionNodeId(fileRel, block.startLine, block.name);
      const node: CallGraphNode = {
        id,
        type: 'function',
        filePath: fileRel,
        line: block.startLine,
        code: getLineTextAt(fileText, block.startLine),
        name: block.name,
      };
      nodeById.set(id, node);
      const info = { fileAbs, fileRel, block, node };
      functionInfos.push(info);
      functionInfoById.set(id, info);
    }
  }

  const functionsByName = new Map<string, FunctionNodeInfo[]>();
  for (const info of functionInfos) {
    const list = functionsByName.get(info.block.name) ?? [];
    list.push(info);
    functionsByName.set(info.block.name, list);
  }

  const edges: CallGraphEdge[] = [];

  // Build call edges between function nodes (best-effort).
  for (const info of functionInfos) {
    const fileText = fileTextByAbs.get(info.fileAbs) ?? (await fs.readFile(info.fileAbs, 'utf8'));
    const tokens = scanTokens(fileText);

    // Skip scanning nested function bodies to avoid attributing inner calls to outer functions.
    const nestedBlocks = functionInfos
      .filter(
        (other) =>
          other.fileAbs === info.fileAbs &&
          other.block.bodyStartPos > info.block.bodyStartPos &&
          other.block.bodyEndPos < info.block.bodyEndPos,
      )
      .map((n) => ({ start: n.block.bodyStartPos, end: n.block.bodyEndPos }))
      .sort((a, b) => a.start - b.start);

    let skipIdx = 0;
    let skip = nestedBlocks[skipIdx];

    const startIdx = lowerBoundTokenPos(tokens, info.block.bodyStartPos);
    const endIdx = lowerBoundTokenPos(tokens, info.block.bodyEndPos + 1);

    for (let i = startIdx; i < endIdx; i += 1) {
      const t = tokens[i];
      if (!t) continue;

      while (skip && t.pos > skip.end) {
        skipIdx += 1;
        skip = nestedBlocks[skipIdx];
      }
      if (skip && t.pos >= skip.start && t.pos <= skip.end) continue;

      // direct call: foo(...)
      if (t.kind === ts.SyntaxKind.Identifier && tokens[i + 1]?.kind === ts.SyntaxKind.OpenParenToken) {
        const calleeName = t.text;
        const callee = pickCalleeNode(info, calleeName, functionsByName);
        if (!callee) continue;
        edges.push({ from: info.node.id, to: callee.node.id, kind: 'calls' });
        continue;
      }

      // this.method(...)
      if (t.kind === ts.SyntaxKind.ThisKeyword) {
        const dot = tokens[i + 1];
        const name = tokens[i + 2];
        const paren = tokens[i + 3];
        if (!dot || !name || !paren) continue;
        if (dot.kind !== ts.SyntaxKind.DotToken && dot.kind !== ts.SyntaxKind.QuestionDotToken) continue;
        if (name.kind !== ts.SyntaxKind.Identifier) continue;
        if (paren.kind !== ts.SyntaxKind.OpenParenToken) continue;
        const callee = pickCalleeNode(info, name.text, functionsByName);
        if (!callee) continue;
        edges.push({ from: info.node.id, to: callee.node.id, kind: 'calls' });
      }
    }
  }

  // Build sinkCall nodes + containsSink edges.
  const sinkKeyToRecords = new Map<string, SinkRecord[]>();
  for (const s of options.sinks) {
    const fileRel = s['App源码文件路径'];
    const line = s['调用行号'];
    const key = `${fileRel}:${line}`;
    const list = sinkKeyToRecords.get(key) ?? [];
    list.push(s);
    sinkKeyToRecords.set(key, list);
  }

  for (const [key, sinkRecords] of sinkKeyToRecords) {
    const sep = key.lastIndexOf(':');
    const fileRel = sep >= 0 ? key.slice(0, sep) : key;
    const lineStr = sep >= 0 ? key.slice(sep + 1) : '';
    const line = Number(lineStr);
    const fileAbs = absByRel.get(fileRel);
    if (!fileAbs || !Number.isFinite(line)) continue;

    const fileText = fileTextByAbs.get(fileAbs) ?? (await fs.readFile(fileAbs, 'utf8'));
    const sinkId = buildSinkCallNodeId(fileRel, line);

    const apiKeys = Array.from(
      new Set(
        sinkRecords
          .map((r) => r.__apiKey)
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
      ),
    );
    const descriptions = Array.from(
      new Set(
        sinkRecords
          .map((r) => r['API功能描述'])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
      ),
    );
    const sinkDescription =
      sinkRecords.length <= 1
        ? (descriptions[0] ?? undefined)
        : Array.from(
            new Set(
              sinkRecords.map((r) => {
                const api = r.__apiKey ? r.__apiKey : '(unknown api)';
                const desc = r['API功能描述'] ? r['API功能描述'] : '';
                return desc ? `${api}：${desc}` : api;
              }),
            ),
          ).join('；');

    const node: CallGraphNode = {
      id: sinkId,
      type: 'sinkCall',
      filePath: fileRel,
      line,
      code: getLineTextAt(fileText, line),
      name: apiKeys.length > 0 ? apiKeys.join(',') : undefined,
      description: sinkDescription,
    };
    nodeById.set(sinkId, node);

    const candidates = functionInfos
      .filter((f) => f.fileRel === fileRel && f.block.startLine <= line && line <= f.block.endLine)
      .sort((a, b) => (a.block.endLine - a.block.startLine) - (b.block.endLine - b.block.startLine));
    const container = candidates[0];
    if (container) edges.push({ from: container.node.id, to: sinkId, kind: 'containsSink' });
  }

  // Mark sources.
  const sourceNodeIds: string[] = [];
  for (const s of options.sources) {
    const fileRel = s['App源码文件路径'];
    const line = s['行号'];
    const name = s['函数名称'];
    const description = s['描述'];

    const exactId = buildFunctionNodeId(fileRel, line, name);
    const exact = nodeById.get(exactId);
    if (exact) {
      exact.type = 'source';
      exact.description = description;
      nodeById.set(exact.id, exact);
      sourceNodeIds.push(exact.id);
      continue;
    }

    // Try a small window match if our scanner found a slightly different line.
    const window = functionInfos.filter((f) => f.fileRel === fileRel && f.block.name === name && Math.abs(f.block.startLine - line) <= 3);
    if (window.length > 0) {
      const best = window.sort((a, b) => Math.abs(a.block.startLine - line) - Math.abs(b.block.startLine - line))[0]!;
      best.node.type = 'source';
      best.node.description = description;
      nodeById.set(best.node.id, best.node);
      sourceNodeIds.push(best.node.id);
      continue;
    }

    // Fallback source node if we cannot match a block.
    const fileAbs = absByRel.get(fileRel);
    const fileText = fileAbs ? (fileTextByAbs.get(fileAbs) ?? (await fs.readFile(fileAbs, 'utf8'))) : '';
    const fallbackId = buildSourceFallbackNodeId(fileRel, line, name);
    nodeById.set(fallbackId, {
      id: fallbackId,
      type: 'source',
      filePath: fileRel,
      line,
      code: fileText ? getLineTextAt(fileText, line) : '',
      name,
      description,
    });
    sourceNodeIds.push(fallbackId);
  }

  // Trim graph: keep only nodes that are on some source -> sinkCall path.
  const sinkCallIds = Array.from(nodeById.values())
    .filter((n) => n.type === 'sinkCall')
    .map((n) => n.id);
  const sinkCallIdSet = new Set(sinkCallIds);
  const sourceIdSet = new Set(sourceNodeIds);

  const forward = reachableForward(sourceNodeIds, edges);
  const backward = reachableBackward(sinkCallIds, edges);

  const keep = new Set<string>();
  for (const id of nodeById.keys()) {
    if (sinkCallIdSet.has(id) && forward.has(id)) keep.add(id);
    else if (sourceIdSet.has(id) && backward.has(id)) keep.add(id);
    else if (forward.has(id) && backward.has(id)) keep.add(id);
  }

  const keptNodes = Array.from(nodeById.values()).filter((n) => keep.has(n.id));
  const keptEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));

  // Recompute counts.
  const sourcesCount = keptNodes.filter((n) => n.type === 'source').length;
  const sinkCallsCount = keptNodes.filter((n) => n.type === 'sinkCall').length;
  const functionsCount = keptNodes.filter((n) => n.type === 'function').length;

  // Best-effort: generate descriptions for intermediate function nodes using the same LLM config as dataflow analysis.
  const apiKey = typeof options.llm?.apiKey === 'string' ? options.llm.apiKey.trim() : '';
  if (options.llm && apiKey) {
    const llm = { provider: options.llm.provider, apiKey, model: options.llm.model };
    const targets = keptNodes.filter((n) => n.type === 'function' && !n.description);
    const uniqueTargets = new Map(targets.map((n) => [n.id, n] as const));
    let aborted = false;
    await withConcurrencyLimit(Array.from(uniqueTargets.values()), 3, async (n) => {
      if (aborted || n.description) return;
      const info = functionInfoById.get(n.id);
      if (!info) return;
      const fileText = fileTextByAbs.get(info.fileAbs);
      if (!fileText) return;

      const snippet = buildFunctionSnippet({ fileText, block: info.block, maxLines: 80 });
      const prompt = buildFunctionDescriptionPrompt({
        filePath: info.fileRel,
        functionName: info.block.name,
        startLine: info.block.startLine,
        endLine: info.block.endLine,
        snippet,
      });

      try {
        const content = await chatWithFallbackBaseUrls({ llm, system: prompt.system, user: prompt.user });
        const parsed = safeJsonParse(content);
        const desc = extractDescriptionFromLlmJson(parsed);
        if (desc) n.description = clampText(desc, 120);
      } catch (e) {
        // Abort quickly on auth errors to avoid spamming requests.
        if (e instanceof LlmHttpError && e.status === 401) aborted = true;
      }
    });
  }

  return {
    meta: {
      runId: options.runId,
      generatedAt: new Date().toISOString(),
      counts: {
        nodes: keptNodes.length,
        edges: keptEdges.length,
        sources: sourcesCount,
        sinkCalls: sinkCallsCount,
        functions: functionsCount,
      },
    },
    nodes: keptNodes,
    edges: keptEdges,
  };
}
