import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { resolveLlmBaseUrls } from '../../llm/provider.js';
import { LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/openaiCompatible.js';
import { DEFAULT_APP_SCAN_SUBDIR } from '../defaults.js';
import { toPosixPath, toWorkspaceRelativePath } from '../pathUtils.js';
import { scanTokens, type Token } from '../tokenScanner.js';
import { scanFunctionBlocks, type FunctionBlock } from '../callGraph/functionBlocks.js';

import type { UiTreeEdge, UiTreeNavTarget, UiTreeNode, UiTreeNodeCategory, UiTreeResult } from './types.js';

type BuildUiTreeOptions = {
  repoRoot: string;
  runId: string;
  appRootAbs: string;
  appFiles: string[]; // absolute paths
  llm: { provider: string; apiKey: string; model: string };
  describeNodes?: (nodes: UiTreeNode[]) => Promise<Map<string, string>>;
  contextRadiusLines?: number; // default 5
  maxNodesPerLlmBatch?: number; // default 15
};

type StructBlock = {
  name: string;
  exportDefault: boolean;
  startLine: number; // 1-based
  endLine: number; // 1-based
  bodyStartPos: number; // position of "{"
  bodyEndPos: number; // position of matching "}"
  namePos: number;
};

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}:${sha1(parts.join('|')).slice(0, 12)}`;
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
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

function findMatchingBrace(tokens: Token[], openBraceIndex: number): number | null {
  let depth = 0;
  for (let i = openBraceIndex; i < tokens.length; i += 1) {
    const k = tokens[i]?.kind;
    if (k === ts.SyntaxKind.OpenBraceToken) depth += 1;
    else if (k === ts.SyntaxKind.CloseBraceToken) depth -= 1;
    if (depth === 0) return i;
  }
  return null;
}

function scanStructBlocks(fileText: string, sourceFile: ts.SourceFile): StructBlock[] {
  const tokens = scanTokens(fileText);
  const blocks: StructBlock[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    if (t.kind !== ts.SyntaxKind.Identifier || t.text !== 'struct') continue;

    const nameTok = tokens[i + 1];
    const openBrace = tokens[i + 2];
    if (nameTok?.kind !== ts.SyntaxKind.Identifier) continue;
    if (openBrace?.kind !== ts.SyntaxKind.OpenBraceToken) continue;

    const closeBraceIndex = findMatchingBrace(tokens, i + 2);
    if (closeBraceIndex === null) continue;

    const exportDefault =
      tokens[i - 2]?.kind === ts.SyntaxKind.ExportKeyword && tokens[i - 1]?.kind === ts.SyntaxKind.DefaultKeyword;

    const startLine = sourceFile.getLineAndCharacterOfPosition(nameTok.pos).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(tokens[closeBraceIndex]!.pos).line + 1;

    blocks.push({
      name: nameTok.text,
      exportDefault,
      startLine,
      endLine,
      bodyStartPos: openBrace.pos,
      bodyEndPos: tokens[closeBraceIndex]!.pos,
      namePos: nameTok.pos,
    });
  }

  return blocks;
}

function findEntryStructs(lines: string[], structs: StructBlock[]): StructBlock[] {
  const entryLines: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*@Entry\b/u.test(lines[i] ?? '')) entryLines.push(i + 1);
  }
  if (entryLines.length === 0) return [];

  const picked: StructBlock[] = [];
  for (const entryLine of entryLines) {
    const candidates = structs
      .filter((s) => s.startLine > entryLine && s.startLine - entryLine <= 30)
      .sort((a, b) => a.startLine - b.startLine);
    if (candidates[0]) picked.push(candidates[0]);
  }

  const uniq = new Map<string, StructBlock>();
  for (const s of picked) uniq.set(`${s.namePos}:${s.name}`, s);
  return Array.from(uniq.values());
}

function pickPrimaryStruct(structs: StructBlock[]): StructBlock | null {
  if (structs.length === 0) return null;
  const exportDefault = structs.find((s) => s.exportDefault);
  return exportDefault ?? structs[0] ?? null;
}

function normalizeRoute(rawUrl: string): string {
  let u = rawUrl.trim();
  if (u.startsWith('/')) u = u.slice(1);
  if (u.endsWith('.ets')) u = u.slice(0, -4);
  if (u.endsWith('.ts')) u = u.slice(0, -3);
  return u;
}

function categoryForComponentName(componentName: string): UiTreeNodeCategory | null {
  if (componentName === 'Button') return 'Button';
  if (componentName === 'TextInput' || componentName === 'TextArea' || componentName === 'Search') return 'Input';
  if (componentName === 'Text' || componentName === 'Image') return 'Display';
  return null;
}

const IGNORED_COMPONENT_NAMES = new Set<string>([
  // Layout / containers (too noisy for feature-level UI tree).
  'Column',
  'Row',
  'Stack',
  'Flex',
  'Grid',
  'GridRow',
  'GridCol',
  'List',
  'ListItem',
  'ListItemGroup',
  'Scroll',
  'Swiper',
  'Navigation',
  'Tabs',
  'TabContent',
  'Badge',
  'Divider',
  'Blank',
]);

function shouldCaptureUnknownComponentAsNode(componentName: string): boolean {
  if (!componentName) return false;
  if (IGNORED_COMPONENT_NAMES.has(componentName)) return false;
  return true;
}

function isLikelyCommentLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
}

function matchComponentStart(line: string): { componentName: string } | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|\{)/u.exec(line);
  if (!m) return null;
  const name = m[1] ?? '';
  if (!name) return null;
  if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'return') return null;
  return { componentName: name };
}

function extractRouterNav(args: { lines: string[]; atLine: number }): { kind: UiTreeNavTarget['kind']; url?: string } | null {
  const startIdx = Math.max(0, args.atLine - 1);
  const endIdx = Math.min(args.lines.length - 1, startIdx + 10);
  const slice = args.lines.slice(startIdx, endIdx + 1).join('\n');

  const kindMatch = /router\s*\.\s*(pushUrl|replaceUrl|back)\s*\(/u.exec(slice);
  if (!kindMatch) return null;
  const kindRaw = kindMatch[1] ?? '';
  const kind = kindRaw === 'replaceUrl' ? 'replaceUrl' : kindRaw === 'back' ? 'back' : 'pushUrl';

  const urlMatch = /\burl\s*:\s*['"]([^'"]+)['"]/u.exec(slice);
  const url = urlMatch?.[1] ? urlMatch[1] : undefined;
  return { kind, url };
}

function fallbackDescription(node: Pick<UiTreeNode, 'category' | 'name' | 'navTarget' | 'code'>): string {
  if (node.category === 'Page') return `页面：${node.name ?? '未命名页面'}`;
  if (node.category === 'Input') return `输入框：${node.name ?? '输入'}（用于输入内容）`;
  if (node.category === 'Display') return `显示元素：${node.name ?? '展示'}（用于展示信息）`;
  if (node.navTarget?.url) return `可点击元素（跳转到 ${node.navTarget.url}）`;
  if (node.category === 'Button') return `可点击元素：${node.name ?? '按钮'}`;
  const codeHint = node.code ? `（${node.code.slice(0, 30)}）` : '';
  return `UI 元素：${node.name ?? node.category}${codeHint}`;
}

async function describeNodesWithLlm(options: {
  llm: BuildUiTreeOptions['llm'];
  nodes: UiTreeNode[];
  baseUrls: string[];
}): Promise<Map<string, string>> {
  const expectedIds = options.nodes.map((n) => n.id);

  const system = [
    '你是一个前端界面理解助手，擅长从 ArkTS/ArkUI 源码切片理解 UI 元素的作用。',
    '你必须为每个输入节点生成一个“面向用户的中文短标题”（用于页面/功能分类展示）。',
    '输出必须是严格 JSON（不要 markdown，不要额外文字）。',
  ].join('\n');

  const user = [
    '请为下面每个节点生成 description。',
    '',
    '硬性要求：',
    '1) 每个输入 id 都必须出现在输出中，且只输出这些 id。',
    '2) description 是“短标题”，不是长句解释：',
    '   - Page：建议 2–8 个汉字（例如：首页、聊天页面、发现、我的、设置）。',
    '   - Button/Input/Display/Component：建议 2–20 个汉字（例如：扫一扫、录音、发送、搜索、手机号登录）。',
    '3) 禁止直接照抄 structName / 文件名 / 组件名（例如 HomePage、ChatPage、Button、TextInput 等）；如需参考，请翻译成中文。',
    '4) 优先使用代码中的用户可见文案（例如 Text("扫一扫")、Button("发送") 等）来命名。',
    '5) 若信息不足，请输出保守且短的标题（例如：某页面、某功能、按钮）。',
    '',
    '输出 JSON 结构：',
    '{ "descriptions": [ { "id": "...", "description": "..." } ] }',
    '',
    '输入 nodes（JSON）：',
    JSON.stringify(
      options.nodes.map((n) => ({
        id: n.id,
        category: n.category,
        name: n.name,
        filePath: n.filePath,
        line: n.line,
        code: n.code,
        navTarget: n.navTarget,
        context: n.context,
      })),
    ),
  ].join('\n');

  let llmRes: { content: string } | null = null;
  let lastError: unknown = null;

  for (const baseUrl of options.baseUrls) {
    try {
      llmRes = await openAiCompatibleChat({
        baseUrl,
        apiKey: options.llm.apiKey,
        model: options.llm.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        jsonMode: true,
      });
      break;
    } catch (e) {
      lastError = e;
      const canRetry =
        options.baseUrls.length > 1 &&
        (e instanceof LlmNetworkError || (e instanceof LlmHttpError && (e.status === 401 || e.status === 404 || e.status >= 500)));
      if (!canRetry) throw e;
    }
  }

  if (!llmRes) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const parsed = safeJsonParse(llmRes.content);
  if (!isRecord(parsed)) throw new Error('LLM JSON 不是对象');
  const descriptionsRaw = (parsed as any).descriptions;
  if (!Array.isArray(descriptionsRaw)) throw new Error('LLM JSON 缺少 descriptions[]');

  const map = new Map<string, string>();
  for (const item of descriptionsRaw) {
    const id = typeof item?.id === 'string' ? item.id : '';
    const desc = typeof item?.description === 'string' ? item.description : '';
    if (!id || !desc) continue;
    map.set(id, desc);
  }

  for (const id of expectedIds) {
    if (!map.has(id)) throw new Error(`LLM 输出缺少节点描述 id=${id}`);
  }

  return map;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function buildUiTree(options: BuildUiTreeOptions): Promise<UiTreeResult> {
  const apiKey = typeof options.llm.apiKey === 'string' ? options.llm.apiKey.trim() : '';
  if (!apiKey && !options.describeNodes) {
    return {
      meta: {
        runId: options.runId,
        generatedAt: new Date().toISOString(),
        skipped: true,
        skipReason: 'UI LLM api-key 为空，无法生成界面树描述',
        llm: { provider: options.llm.provider, model: options.llm.model },
        counts: { nodes: 0, edges: 0, pages: 0, elements: 0 },
      },
      roots: [],
      nodes: {},
      edges: [],
    };
  }

  const radius = options.contextRadiusLines ?? 5;
  const batchSize = options.maxNodesPerLlmBatch ?? 15;
  const baseUrls = options.describeNodes ? [] : resolveLlmBaseUrls(options.llm.provider);

  const scanRootAbs = path.join(options.appRootAbs, DEFAULT_APP_SCAN_SUBDIR);
  const routeToFileRel = new Map<string, string>();
  const fileRelToAbs = new Map<string, string>();
  for (const abs of options.appFiles) {
    const relToScan = toPosixPath(path.relative(scanRootAbs, abs));
    if (!relToScan || relToScan.startsWith('..')) continue;
    const noExt = relToScan.replace(/\.[^.]+$/u, '');
    const fileRel = toWorkspaceRelativePath(options.repoRoot, abs);
    routeToFileRel.set(noExt, fileRel);
    fileRelToAbs.set(fileRel, abs);
  }

  const nodes: Record<string, UiTreeNode> = {};
  const edges: UiTreeEdge[] = [];
  const roots: string[] = [];

  const pageQueue: Array<{ fileRel: string; structName: string; structStartLine: number; isRoot: boolean }> = [];
  const queuedPageKeys = new Set<string>();

  // Seed: @Entry pages.
  for (const abs of options.appFiles) {
    const fileText = await fs.readFile(abs, 'utf8');
    const lines = fileText.split(/\r?\n/u);
    if (!lines.some((l) => /^\s*@Entry\b/u.test(l))) continue;

    const sf = ts.createSourceFile(abs, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const structs = scanStructBlocks(fileText, sf);
    const entryStructs = findEntryStructs(lines, structs);
    if (entryStructs.length === 0) continue;

    const fileRel = toWorkspaceRelativePath(options.repoRoot, abs);
    fileRelToAbs.set(fileRel, abs);

    for (const s of entryStructs) {
      const key = `${fileRel}#${s.name}`;
      if (queuedPageKeys.has(key)) continue;
      queuedPageKeys.add(key);
      pageQueue.push({ fileRel, structName: s.name, structStartLine: s.startLine, isRoot: true });
    }
  }

  async function ensurePageNode(args: { fileRel: string; structName: string; structStartLine: number; lines: string[] }): Promise<string> {
    const id = stableId('page', [args.fileRel, args.structName]);
    if (!nodes[id]) {
      nodes[id] = {
        id,
        category: 'Page',
        name: args.structName,
        description: '',
        filePath: args.fileRel,
        line: args.structStartLine,
        code: getLineText(args.lines, args.structStartLine),
        context: buildContext(args.lines, args.structStartLine, radius),
      };
    }
    return id;
  }

  function ensureElementNode(args: {
    fileRel: string;
    line: number;
    componentName: string;
    category: UiTreeNodeCategory;
    lines: string[];
  }): string {
    const code = getLineText(args.lines, args.line);
    // NOTE: category is intentionally excluded from the stableId so that we can "upgrade" a node
    // (e.g., Component -> Button) without creating a duplicate id.
    const id = stableId('ui', [args.fileRel, String(args.line), args.componentName, code]);
    if (!nodes[id]) {
      nodes[id] = {
        id,
        category: args.category,
        name: args.componentName,
        description: '',
        filePath: args.fileRel,
        line: args.line,
        code,
        context: buildContext(args.lines, args.line, radius),
      };
    } else {
      // Upgrade category if needed (e.g., Component -> Button).
      const existing = nodes[id]!;
      if (existing.category === 'Component' && args.category !== 'Component') existing.category = args.category;
    }
    return id;
  }

  async function enqueueTargetPage(targetFileRel: string): Promise<void> {
    const abs = fileRelToAbs.get(targetFileRel) ?? path.resolve(options.repoRoot, targetFileRel);
    let fileText: string;
    try {
      fileText = await fs.readFile(abs, 'utf8');
    } catch {
      return;
    }

    const sf = ts.createSourceFile(abs, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const structs = scanStructBlocks(fileText, sf);
    const primary = pickPrimaryStruct(structs);
    if (!primary) return;

    const key = `${targetFileRel}#${primary.name}`;
    if (queuedPageKeys.has(key)) return;
    queuedPageKeys.add(key);
    pageQueue.push({ fileRel: targetFileRel, structName: primary.name, structStartLine: primary.startLine, isRoot: false });
  }

  async function processPage(page: { fileRel: string; structName: string; structStartLine: number; isRoot: boolean }): Promise<void> {
    const abs = fileRelToAbs.get(page.fileRel) ?? path.resolve(options.repoRoot, page.fileRel);
    let fileText: string;
    try {
      fileText = await fs.readFile(abs, 'utf8');
    } catch {
      return;
    }

    const lines = fileText.split(/\r?\n/u);
    const sf = ts.createSourceFile(abs, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const structs = scanStructBlocks(fileText, sf);
    const struct =
      structs.find((s) => s.name === page.structName) ?? structs.find((s) => s.startLine === page.structStartLine) ?? pickPrimaryStruct(structs);
    if (!struct) return;

    const pageId = await ensurePageNode({ fileRel: page.fileRel, structName: struct.name, structStartLine: struct.startLine, lines });
    if (page.isRoot && !roots.includes(pageId)) roots.push(pageId);

    const functionBlocks = scanFunctionBlocks(fileText, sf);
    const buildBlock: FunctionBlock | undefined = functionBlocks.find(
      (b) => b.name === 'build' && b.signaturePos > struct.bodyStartPos && b.signaturePos < struct.bodyEndPos,
    );
    if (!buildBlock) return;

    const buildStart = Math.max(1, buildBlock.startLine);
    const buildEnd = Math.min(lines.length, buildBlock.endLine);

    const componentStarts: Array<{ line: number; componentName: string }> = [];
    for (let ln = buildStart; ln <= buildEnd; ln += 1) {
      const lineText = lines[ln - 1] ?? '';
      if (isLikelyCommentLine(lineText)) continue;
      const hit = matchComponentStart(lineText);
      if (!hit) continue;
      componentStarts.push({ line: ln, componentName: hit.componentName });

      const category =
        categoryForComponentName(hit.componentName) ??
        (shouldCaptureUnknownComponentAsNode(hit.componentName) ? ('Component' satisfies UiTreeNodeCategory) : null);
      if (!category) continue;
      const elId = ensureElementNode({
        fileRel: page.fileRel,
        line: ln,
        componentName: hit.componentName,
        category,
        lines,
      });
      edges.push({ from: pageId, to: elId, kind: 'contains' });
    }

    // Router navigations inside build(): assign to nearest preceding component start.
    for (let ln = buildStart; ln <= buildEnd; ln += 1) {
      const lineText = lines[ln - 1] ?? '';
      if (!lineText.includes('router')) continue;
      const nav = extractRouterNav({ lines, atLine: ln });
      if (!nav || nav.kind === 'back') continue;
      if (!nav.url) continue;

      const routeKey = normalizeRoute(nav.url);
      const targetFileRel = routeToFileRel.get(routeKey);
      if (!targetFileRel) continue;

      // Trigger: nearest component start line above this router call.
      let trigger: { line: number; componentName: string } | null = null;
      for (let i = componentStarts.length - 1; i >= 0; i -= 1) {
        const c = componentStarts[i]!;
        if (c.line < ln) {
          trigger = c;
          break;
        }
      }
      if (!trigger) continue;

      const triggerId = ensureElementNode({
        fileRel: page.fileRel,
        line: trigger.line,
        componentName: trigger.componentName,
        category: 'Button',
        lines,
      });

      await enqueueTargetPage(targetFileRel);
      const targetAbs = fileRelToAbs.get(targetFileRel) ?? path.resolve(options.repoRoot, targetFileRel);
      let targetText = '';
      try {
        targetText = await fs.readFile(targetAbs, 'utf8');
      } catch {
        targetText = '';
      }
      const targetLines = targetText ? targetText.split(/\r?\n/u) : [];
      const targetSf = ts.createSourceFile(targetAbs, targetText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const targetStructs = scanStructBlocks(targetText, targetSf);
      const targetStruct = pickPrimaryStruct(targetStructs);
      const targetStructName = targetStruct?.name ?? path.basename(targetFileRel).replace(/\.[^.]+$/u, '');
      const targetStructLine = targetStruct?.startLine ?? 1;
      const targetPageId = await ensurePageNode({
        fileRel: targetFileRel,
        structName: targetStructName,
        structStartLine: targetStructLine,
        lines: targetLines.length > 0 ? targetLines : [''],
      });

      const triggerNode = nodes[triggerId]!;
      triggerNode.navTarget = {
        kind: nav.kind,
        url: nav.url,
        resolvedFilePath: targetFileRel,
      };

      edges.push({ from: triggerId, to: targetPageId, kind: 'navigatesTo' });
    }
  }

  // Process queued pages in order (BFS-ish).
  for (let i = 0; i < pageQueue.length; i += 1) {
    await processPage(pageQueue[i]!);
  }

  // LLM descriptions in batches.
  const allNodeIds = Object.keys(nodes).sort();
  const allNodes = allNodeIds.map((id) => nodes[id]!);

  for (const batch of chunk(allNodes, batchSize)) {
    const descMap = options.describeNodes
      ? await options.describeNodes(batch)
      : await describeNodesWithLlm({ llm: { ...options.llm, apiKey }, nodes: batch, baseUrls });
    for (const n of batch) {
      const desc = descMap.get(n.id);
      nodes[n.id]!.description = desc && desc.trim() ? desc.trim() : fallbackDescription(n);
    }
  }

  const pages = Object.values(nodes).filter((n) => n.category === 'Page').length;
  const elements = Object.values(nodes).filter((n) => n.category !== 'Page').length;

  return {
    meta: {
      runId: options.runId,
      generatedAt: new Date().toISOString(),
      llm: { provider: options.llm.provider, model: options.llm.model },
      counts: {
        nodes: Object.keys(nodes).length,
        edges: edges.length,
        pages,
        elements,
      },
    },
    roots,
    nodes,
    edges,
  };
}
