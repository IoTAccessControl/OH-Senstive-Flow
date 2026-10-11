import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { scanFunctionBlocks } from '../callgraph/functionBlocks.js';
import type { Dataflow, DataflowNode, DataflowsResult } from '../dataflow/types.js';
import { buildLineStarts, findMatchingDelimiter, lineNumberAt } from '../../utils/scanSourceText.js';

export type EvidenceOccurrence = { filePath: string; line: number; code: string; property?: string };
export type PrivacyEvidence = {
  node: DataflowNode;
  occurrences: EvidenceOccurrence[];
  summary: NonNullable<Dataflow['summary']>;
};

function occurrenceScore(occurrence: EvidenceOccurrence): number {
  const code = occurrence.code.trim();
  if (/^(?:import\b|\/\/|\/\*|\*|@|private\s+|public\s+)/u.test(code)) return 0;
  if (/^(?:let|const|var)\s+|^this\.[\w]+\s*=/u.test(code)) return 3;
  return /\(/u.test(code) ? 2 : 1;
}

function connectedNodes(flow: Dataflow): Set<string> {
  const ids = new Set(flow.nodes.map((node) => node.id));
  return new Set(flow.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).flatMap((edge) => [edge.from, edge.to]));
}

function renameEvidenceNode(flow: Dataflow, selectedId: string, evidence: PrivacyEvidence): Dataflow {
  const rename = (id: string) => id === selectedId ? evidence.node.id : id;
  const ids = new Set(flow.nodes.map((node) => node.id));
  const edges = flow.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const reachable = new Set([selectedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!reachable.has(edge.from) && !reachable.has(edge.to)) continue;
      for (const id of [edge.from, edge.to]) if (!reachable.has(id)) { reachable.add(id); changed = true; }
    }
  }
  return {
    ...flow,
    flowId: `flow:app_evidence_${crypto.createHash('sha1').update(evidence.node.id).digest('hex').slice(0, 12)}`,
    nodes: flow.nodes.filter((node) => reachable.has(node.id)).map((node) => ({ ...node, id: rename(node.id) })),
    edges: edges.filter((edge) => reachable.has(edge.from) && reachable.has(edge.to)).map((edge) => ({ from: rename(edge.from), to: rename(edge.to) })),
    summary: evidence.summary,
  };
}

function propertyUses(text: string): Map<string, number[]> {
  const starts = buildLineStarts(text);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const uses = new Map<string, number[]>();
  let previous = ts.SyntaxKind.Unknown;
  let beforePrevious = ts.SyntaxKind.Unknown;
  const templateDepths: number[] = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.TemplateHead) templateDepths.push(0);
    else if (token === ts.SyntaxKind.OpenBraceToken && templateDepths.length > 0) templateDepths[templateDepths.length - 1]! += 1;
    else if (token === ts.SyntaxKind.CloseBraceToken && templateDepths.length > 0) {
      if (templateDepths[templateDepths.length - 1] === 0) {
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateTail) templateDepths.pop();
      } else templateDepths[templateDepths.length - 1]! -= 1;
    }
    if (beforePrevious === ts.SyntaxKind.ThisKeyword && previous === ts.SyntaxKind.DotToken && token === ts.SyntaxKind.Identifier) {
      const name = scanner.getTokenText();
      const lines = uses.get(name) ?? [];
      lines.push(lineNumberAt(starts, scanner.getTokenPos()));
      uses.set(name, lines);
    }
    beforePrevious = previous; previous = token; token = scanner.scan();
  }
  return uses;
}

/** Preserve the connected path containing the anchor; unrelated evidence stays on separate paths. */
export async function buildPrivacyEvidenceFlows(args: {
  repoRoot: string;
  runId: string;
  evidence: PrivacyEvidence[];
  existingFlows: Dataflow[];
}): Promise<DataflowsResult> {
  const fileCache = new Map<string, Promise<string>>();
  const readSource = (filePath: string) => {
    let promise = fileCache.get(filePath);
    if (!promise) {
      const abs = path.resolve(args.repoRoot, filePath);
      const relative = path.relative(args.repoRoot, abs);
      promise = relative.startsWith('..') || path.isAbsolute(relative)
        ? Promise.resolve('')
        : fs.readFile(abs, 'utf8').catch(() => '');
      fileCache.set(filePath, promise);
    }
    return promise;
  };
  const flows: Dataflow[] = [];
  const usesCache = new Map<string, Map<string, number[]>>();
  const pathsByCallsite = new Map<string, { flow: Dataflow; nodeId: string }[]>();
  for (const flow of args.existingFlows) {
    const connected = connectedNodes(flow);
    for (const node of flow.nodes) {
      if (!connected.has(node.id)) continue;
      const key = `${node.filePath}:${node.line}`;
      const matches = pathsByCallsite.get(key) ?? [];
      matches.push({ flow, nodeId: node.id });
      pathsByCallsite.set(key, matches);
    }
  }
  for (const evidence of args.evidence) {
    const occurrences = evidence.occurrences.map((item) => ({ ...item }));
    // Privacy rules often match a field's declaration/comment. Follow that exact field's
    // uses within its own class/struct so an input or serialization site can be selected.
    for (const occurrence of evidence.occurrences) {
      const property = occurrence.code.match(/^(?:@[\w]+(?:\([^\n]*?\))?\s+)*(?:(?:private|public|protected|readonly|static)\s+)*([\w$]+)\s*:\s*[^=]+=/u)?.[1];
      if (!property || !/\.(?:ets|ts|js)$/iu.test(occurrence.filePath)) continue;
      const text = await readSource(occurrence.filePath);
      const starts = buildLineStarts(text);
      const pos = starts[occurrence.line - 1] ?? 0;
      const scope = [...text.matchAll(/\b(?:class|struct)\s+[\w]+[^\n{]*\{/gu)]
        .map((match) => ({ start: (match.index ?? 0) + match[0].length - 1 }))
        .map((item) => ({ ...item, end: findMatchingDelimiter(text, item.start, '{', '}') }))
        .filter((item) => item.start < pos && item.end !== null && item.end >= pos)
        .sort((a, b) => b.start - a.start)[0];
      if (!scope || scope.end === null) continue;
      let uses = usesCache.get(occurrence.filePath);
      if (!uses) { uses = propertyUses(text); usesCache.set(occurrence.filePath, uses); }
      const lines = text.split(/\r?\n/u);
      for (const line of new Set(uses.get(property) ?? [])) {
        const linePos = starts[line - 1] ?? 0;
        if (linePos <= scope.start || linePos >= scope.end) continue;
        const existing = occurrences.find((item) => item.filePath === occurrence.filePath && item.line === line);
        if (existing) existing.property = property;
        else occurrences.push({ filePath: occurrence.filePath, line, code: lines[line - 1]?.trim() ?? '', property });
      }
    }
    occurrences.sort((a, b) => occurrenceScore(b) - occurrenceScore(a));
    let reused: Dataflow | undefined;
    for (const occurrence of occurrences) {
      const match = pathsByCallsite.get(`${occurrence.filePath}:${occurrence.line}`)?.[0];
      if (match) {
        reused = renameEvidenceNode(match.flow, match.nodeId, evidence);
        break;
      }
    }
    if (reused) {
      flows.push(reused);
      continue;
    }

    // The graph backend can omit third-party APIs. Recover a local source-reference path
    // only inside the enclosing function, using the declared symbol and its actual uses.
    let recovered: Dataflow | undefined;
    for (const occurrence of occurrences) {
      if (!/\.(?:ets|ts|js)$/iu.test(occurrence.filePath)) continue;
      const text = await readSource(occurrence.filePath);
      if (!text) continue;
      const lines = text.split(/\r?\n/u);
      const sourceFile = ts.createSourceFile(occurrence.filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const block = scanFunctionBlocks(text, sourceFile)
        .filter((item) => item.startLine <= occurrence.line && item.endLine >= occurrence.line)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
      if (!block || block.startLine === occurrence.line) continue;
      const symbol = occurrence.property ?? occurrence.code.match(/(?:\b(?:let|const|var)\s+|\bthis\.)([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/u)?.[1];
      const symbolPattern = symbol ? new RegExp(`\\b${symbol.replaceAll('$', '\\$')}\\b`, 'u') : undefined;
      const selectedLines = new Set([block.startLine, occurrence.line]);
      const propertyLines = occurrence.property ? usesCache.get(occurrence.filePath)?.get(occurrence.property) ?? [] : [];
      for (let line = occurrence.property ? block.startLine + 1 : occurrence.line + 1; line <= block.endLine; line += 1) {
        const code = lines[line - 1]?.trim() ?? '';
        if (!symbolPattern?.test(code) || /^(?:\/\/|\/\*|\*|if\b|else\b)/u.test(code)) continue;
        if (occurrence.property ? !propertyLines.includes(line) : !/[=(]/u.test(code)) continue;
        selectedLines.add(line);
      }
      const nodes = [...selectedLines].sort((a, b) => a - b).map((line, index): DataflowNode => ({
        id: line === occurrence.line ? evidence.node.id : `${evidence.node.id}:context:${index}`,
        filePath: occurrence.filePath,
        line,
        code: lines[line - 1]?.trim() ?? '',
        description: line === occurrence.line ? evidence.node.description : index === 0
          ? `源码函数入口：${block.name}` : `在当前函数中使用 ${symbol ?? '相关 API'}`,
        context: { startLine: Math.max(1, line - 3), lines: lines.slice(Math.max(0, line - 4), line + 3) },
      }));
      recovered = {
        flowId: '', pathId: `evidence:${evidence.node.id}`, nodes,
        edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })),
        meta: { fallback: true, warnings: ['该路径根据同一函数内的源码引用关系恢复。'] },
      };
      break;
    }
    const flow = recovered ?? {
      flowId: '', pathId: `evidence:${evidence.node.id}`, nodes: [evidence.node], edges: [],
      meta: { fallback: true, warnings: ['当前仅定位到声明或源码证据，尚未识别出调用路径。'] },
    };
    flows.push(renameEvidenceNode(flow, evidence.node.id, evidence));
  }
  return {
    meta: {
      runId: args.runId,
      generatedAt: new Date().toISOString(),
      counts: {
        flows: flows.length,
        nodes: flows.reduce((sum, flow) => sum + flow.nodes.length, 0),
        edges: flows.reduce((sum, flow) => sum + flow.edges.length, 0),
      },
    },
    flows,
  };
}
