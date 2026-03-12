import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { resolveLlmBaseUrls, LlmHttpError, LlmNetworkError, openAiCompatibleChat } from '../../llm/client.js';
import { DEFAULT_APP_SCAN_SUBDIR } from '../extract/app.js';
import { toPosixPath, toWorkspaceRelativePath } from '../../utils/accessWorkspace.js';
import { scanFunctionBlocks, type FunctionBlock } from '../callgraph/functionBlocks.js';
import { buildLineStarts, findMatchingDelimiter, lineNumberAt } from '../../utils/scanSourceText.js';

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

export type StringTable = Map<string, string>;

export type UiNodeTitleHints = {
  visibleTexts: string[];
  resourceIds: string[];
  resourceTexts: string[];
  handlerNames: string[];
  routeHints: string[];
  suggested: string;
};

const PAGE_SEGMENT_MAP: Record<string, string> = {
  index: '首页',
  home: '首页',
  main: '首页',
  entry: '首页',
  chat: '聊天',
  message: '聊天',
  messages: '聊天',
  contact: '通讯录',
  contacts: '通讯录',
  addressbook: '通讯录',
  discover: '发现',
  find: '发现',
  moment: '朋友圈',
  moments: '朋友圈',
  timeline: '朋友圈',
  mine: '我的',
  me: '我',
  my: '我的',
  profile: '我的',
  setting: '设置',
  settings: '设置',
  search: '搜索',
  login: '登录',
  register: '注册',
  qrcode: '二维码',
  qr: '二维码',
  scan: '扫一扫',
};

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function cleanWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function normalizeShortTitle(text: string): string {
  let title = cleanWhitespace(text);
  title = title.replaceAll(/[“”"]/gu, '');
  title = title.replaceAll(/[’']/gu, '');
  title = title.replaceAll(/[（(]\s*/gu, '（').replaceAll(/\s*[）)]/gu, '）');
  title = title.replaceAll(/\s+/gu, '');
  title = title.replaceAll(/^[：:，,。.!！？?]+/gu, '').replaceAll(/[：:，,。.!！？?]+$/gu, '');
  return title;
}

function isLikelyNoiseString(text: string): boolean {
  const title = text.trim();
  if (!title) return true;
  if (title.length > 40) return true;
  if (title.includes('pages/')) return true;
  if (title.includes('@ohos')) return true;
  if (title.includes('ohos.permission')) return true;
  if (title.includes('/') || title.includes('\\')) return true;
  if (title.includes('.ets') || title.includes('.ts')) return true;
  return false;
}

function splitPathSegments(filePath: string): string[] {
  return filePath.replaceAll('\\', '/').split('/').filter(Boolean);
}

function stripTsExt(name: string): string {
  return name.replace(/\.(ets|ts|tsx|js|jsx)$/u, '');
}

function stripCommonPageSuffix(name: string): string {
  return name.replace(/(Page|View|Screen|Ability)$/u, '');
}

function humanizeEnglishToken(token: string): string {
  const raw = token.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (PAGE_SEGMENT_MAP[lower]) return PAGE_SEGMENT_MAP[lower]!;
  const parts = raw
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/\s+/u)
    .filter(Boolean);
  if (parts.length <= 1) return '';
  const translated = parts.map((part) => PAGE_SEGMENT_MAP[part.toLowerCase()] ?? '').filter(Boolean);
  return translated.length > 0 ? translated.join('') : '';
}

function ensurePageSuffix(title: string): string {
  const value = title.trim();
  if (!value) return '';
  if (value === '首页') return value;
  if (/(页|页面|界面|主页)$/u.test(value)) return value;
  return `${value}页面`;
}

export async function loadArkuiStringTable(appRootAbs: string): Promise<StringTable> {
  const candidates = [
    path.join(appRootAbs, 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'),
    path.join(appRootAbs, 'AppScope', 'resources', 'base', 'element', 'string.json'),
  ];

  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, 'utf8');
      const json = JSON.parse(text) as { string?: Array<{ name?: string; value?: string }> };
      const arr = Array.isArray(json?.string) ? json.string : [];
      const map = new Map<string, string>();
      for (const item of arr) {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        const value = typeof item?.value === 'string' ? item.value.trim() : '';
        if (name && value) map.set(name, value);
      }
      return map;
    } catch {
      // try next candidate
    }
  }
  return new Map();
}

export function extractResourceIdsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /\$r\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of text.matchAll(re)) {
    const id = typeof match[1] === 'string' ? match[1].trim() : '';
    if (id) out.push(id);
  }
  return out;
}

function iconIdToTitle(resourceId: string): string {
  const id = resourceId.toLowerCase();
  if (id.includes('search')) return '搜索';
  if (id.includes('add') || id.includes('plus')) return '添加';
  if (id.includes('emoji')) return '表情';
  if (id.includes('camera') || id.includes('shoot')) return '拍照';
  if (id.includes('qrcode') || id.includes('qr')) return '扫一扫';
  if (id.includes('back')) return '返回';
  if (id.includes('setting')) return '设置';
  if (id.includes('location')) return '位置';
  if (id.includes('voice') || id.includes('mic') || id.includes('record')) return '语音';
  if (id.includes('keyboard')) return '键盘';
  return '';
}

function resolveStringResource(resourceId: string, strings: StringTable): string {
  const match = /^app\.string\.([A-Za-z0-9_]+)$/u.exec(resourceId);
  if (!match) return '';
  const key = match[1] ?? '';
  if (!key) return '';
  return strings.get(key) ?? '';
}

export function extractQuotedStringsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /(['"])([^'"]{1,60})\1/gu;
  for (const match of text.matchAll(re)) {
    const raw = typeof match[2] === 'string' ? match[2] : '';
    const candidate = raw.trim();
    if (!candidate) continue;
    out.push(candidate);
  }
  return out;
}

function extractHandlerNamesFromLines(lines: string[]): string[] {
  const out: string[] = [];
  const reDirect = /\bthis\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/gu;
  for (const line of lines) {
    if (!line.includes('on')) continue;
    if (!/(onClick|onTouch|onChange|onSubmit|onAction|onKeyEvent|onGesture)/u.test(line)) continue;
    for (const match of line.matchAll(reDirect)) {
      const name = typeof match[1] === 'string' ? match[1].trim() : '';
      if (!name) continue;
      out.push(name);
    }
  }
  return Array.from(new Set(out));
}

function handlerNameToTitle(handler: string): string {
  const lower = handler.toLowerCase();
  if (lower.includes('search')) return '搜索';
  if (lower.includes('send')) return '发送';
  if (lower.includes('press') && (lower.includes('talk') || lower.includes('voice'))) return '发送语音';
  if (lower.includes('talk') || lower.includes('voice') || lower.includes('record')) return '语音';
  if (lower.includes('scan') || lower.includes('qrcode') || lower.includes('qr')) return '扫一扫';
  if (lower.includes('login')) return '登录';
  if (lower.includes('register')) return '注册';
  if (lower.includes('back')) return '返回';
  if (lower.includes('setting')) return '设置';
  return '';
}

function navTargetToRouteHints(navTarget: UiTreeNavTarget | undefined): string[] {
  const url = navTarget?.url?.trim() ?? '';
  const resolved = navTarget?.resolvedFilePath?.trim() ?? '';
  const out: string[] = [];
  if (url) out.push(url);
  if (resolved) out.push(resolved);
  return out;
}

function inferPageBaseTitleFromPath(filePath: string): string {
  const segments = splitPathSegments(filePath);
  const lowerSegments = segments.map((segment) => stripTsExt(segment).toLowerCase());

  const pagesIdx = lowerSegments.lastIndexOf('pages');
  const afterPages = pagesIdx >= 0 ? segments.slice(pagesIdx + 1) : segments;
  const cleanAfterPages = afterPages.map((segment) => stripCommonPageSuffix(stripTsExt(segment)));
  const last = cleanAfterPages[cleanAfterPages.length - 1] ?? '';
  const penultimate = cleanAfterPages.length >= 2 ? (cleanAfterPages[cleanAfterPages.length - 2] ?? '') : '';

  const candidates = [last, penultimate].filter(Boolean);
  for (const candidate of candidates) {
    if (hasCjk(candidate)) return candidate;
    const translated = humanizeEnglishToken(candidate);
    if (translated) return translated;
    const mapped = PAGE_SEGMENT_MAP[candidate.toLowerCase()];
    if (mapped) return mapped;
  }

  for (let i = cleanAfterPages.length - 1; i >= 0; i -= 1) {
    const segment = cleanAfterPages[i] ?? '';
    const mapped = PAGE_SEGMENT_MAP[segment.toLowerCase()];
    if (mapped) return mapped;
  }

  return last || '页面';
}

export function inferPageTitle(args: { filePath?: string; structName?: string }): string {
  const filePath = args.filePath?.trim() ?? '';
  const structName = args.structName?.trim() ?? '';

  let base = '';
  if (filePath) base = inferPageBaseTitleFromPath(filePath);
  if (!base && structName) {
    const stripped = stripCommonPageSuffix(structName);
    base = hasCjk(stripped) ? stripped : humanizeEnglishToken(stripped) || PAGE_SEGMENT_MAP[stripped.toLowerCase()] || '';
  }

  base = normalizeShortTitle(base);
  if (!base) base = '页面';
  return ensurePageSuffix(base);
}

function pickBestVisibleText(candidates: string[]): string {
  const cleaned = candidates
    .map((candidate) => normalizeShortTitle(candidate))
    .filter((candidate) => candidate && !isLikelyNoiseString(candidate));
  const uniqTitles = Array.from(new Set(cleaned));

  const chinese = uniqTitles.filter((title) => hasCjk(title));
  if (chinese[0]) return chinese[0];

  const shortEn = uniqTitles.filter((title) => /^[A-Za-z0-9]+$/u.test(title) && title.length <= 10);
  if (shortEn[0]) {
    const lower = shortEn[0].toLowerCase();
    if (lower === 'go') return '进入';
    if (lower === 'ok') return '确定';
    if (lower === 'cancel') return '取消';
    if (lower === 'send') return '发送';
    if (lower === 'search') return '搜索';
    return shortEn[0];
  }

  return '';
}

function inferElementTitle(args: {
  category: UiTreeNodeCategory;
  componentName?: string;
  code?: string;
  contextLines?: string[];
  navTarget?: UiTreeNavTarget;
  strings: StringTable;
}): { title: string; hints: Omit<UiNodeTitleHints, 'suggested'> } {
  const componentName = args.componentName?.trim() ?? '';
  const code = args.code ?? '';
  const contextLines = args.contextLines ?? [];

  const resourceIds = Array.from(new Set(extractResourceIdsFromText([code, ...contextLines].join('\n'))));
  const resourceTexts = resourceIds.map((resourceId) => resolveStringResource(resourceId, args.strings)).filter(Boolean);
  const iconTitles = resourceIds.map(iconIdToTitle).filter(Boolean);
  const quoted = extractQuotedStringsFromText([code, ...contextLines].join('\n'));
  const visibleText = pickBestVisibleText([...resourceTexts, ...quoted]);
  const handlerNames = extractHandlerNamesFromLines(contextLines);
  const handlerTitles = handlerNames.map(handlerNameToTitle).filter(Boolean);
  const routeHints = navTargetToRouteHints(args.navTarget);

  let title = '';
  if (args.category === 'Input') {
    title = visibleText || handlerTitles[0] || (componentName.toLowerCase().includes('search') ? '搜索' : '');
    if (!title) title = '输入';
  } else if (args.category === 'Button') {
    title = visibleText || handlerTitles[0] || iconTitles[0] || '';
    if (!title && args.navTarget?.url) title = '进入页面';
    if (!title) title = '点击操作';
  } else if (args.category === 'Display') {
    title = visibleText || handlerTitles[0] || iconTitles[0] || '';
    if (!title && args.navTarget?.url) title = '进入页面';
    if (!title) title = '显示内容';
  } else {
    title = visibleText || handlerTitles[0] || iconTitles[0] || '';
    if (!title && args.navTarget?.url) title = '进入页面';
    if (!title) title = '功能入口';
  }

  title = normalizeShortTitle(title);
  if (!title) title = args.category === 'Input' ? '输入' : '功能';

  return {
    title,
    hints: {
      visibleTexts: quoted.filter((candidate) => !isLikelyNoiseString(candidate)).slice(0, 8),
      resourceIds: resourceIds.slice(0, 8),
      resourceTexts: resourceTexts.slice(0, 8),
      handlerNames: handlerNames.slice(0, 6),
      routeHints: routeHints.slice(0, 4),
    },
  };
}

export function buildUiNodeTitleHints(args: { node: UiTreeNode; strings: StringTable }): UiNodeTitleHints {
  if (args.node.category === 'Page') {
    const suggested = inferPageTitle({ filePath: args.node.filePath, structName: args.node.name });
    return {
      visibleTexts: [],
      resourceIds: [],
      resourceTexts: [],
      handlerNames: [],
      routeHints: navTargetToRouteHints(args.node.navTarget),
      suggested,
    };
  }

  const ctx = args.node.context?.lines ?? [];
  const { title, hints } = inferElementTitle({
    category: args.node.category,
    componentName: args.node.name,
    code: args.node.code,
    contextLines: ctx,
    navTarget: args.node.navTarget,
    strings: args.strings,
  });

  return { ...hints, suggested: title };
}

export function isGoodHumanTitle(args: { category: UiTreeNodeCategory; title: string }): boolean {
  const raw = args.title;
  const title = normalizeShortTitle(raw);
  if (!title) return false;
  if (title.length > (args.category === 'Page' ? 16 : 24)) return false;
  if (/^(页面|输入框|显示元素|可点击元素|UI元素|UI)\s*[：:]/u.test(raw.trim())) return false;
  if (/\b(Button|TextInput|TextArea|Search|Column|Row|List|Image|Text|struct)\b/u.test(raw)) return false;
  if (/(Page|View|Screen)\b/u.test(raw) && !hasCjk(raw)) return false;
  if (raw.includes('.ets') || raw.includes('.ts')) return false;
  if (raw.includes('desc:')) return false;
  if (args.category === 'Page' && title !== '首页' && !/(页|页面|界面|主页)$/u.test(title)) return false;
  return true;
}

export function normalizeUiTitle(args: { category: UiTreeNodeCategory; title: string }): string {
  const base = normalizeShortTitle(args.title);
  if (!base) return '';
  if (args.category === 'Page') return ensurePageSuffix(base);
  return base;
}

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

function scanStructBlocks(fileText: string, sourceFile: ts.SourceFile): StructBlock[] {
  const lineStarts = buildLineStarts(fileText);
  const blocks: StructBlock[] = [];
  const regex = /\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gu;
  let match: RegExpExecArray | null = regex.exec(fileText);

  while (match) {
    const name = match[1] ?? '';
    const structPos = match.index ?? 0;
    const openBracePos = fileText.indexOf('{', structPos);
    const closeBracePos = openBracePos >= 0 ? findMatchingDelimiter(fileText, openBracePos, '{', '}') : null;
    if (name && openBracePos >= 0 && closeBracePos !== null) {
      const namePos = structPos + match[0].indexOf(name);
      const beforeStruct = fileText.slice(Math.max(0, structPos - 64), structPos);
      const exportDefault = /\bexport\s+default\s*$/u.test(beforeStruct);
      const startLine = sourceFile.getLineAndCharacterOfPosition(namePos).line + 1;
      const endLine = lineNumberAt(lineStarts, closeBracePos);

      blocks.push({
        name,
        exportDefault,
        startLine,
        endLine,
        bodyStartPos: openBracePos,
        bodyEndPos: closeBracePos,
        namePos,
      });
    }
    match = regex.exec(fileText);
  }

  return blocks;
}

function relToArkUiRoot(scanRootAbs: string, abs: string): string {
  const normalized = toPosixPath(abs);
  const marker = '/src/main/ets/';
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) return normalized.slice(idx + marker.length);
  return toPosixPath(path.relative(scanRootAbs, abs));
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
  if (node.category === 'Page') return '页面';
  if (node.category === 'Input') return '输入';
  if (node.category === 'Display') return '显示内容';
  if (node.navTarget?.url) return '进入页面';
  if (node.category === 'Button') return '点击操作';
  const codeHint = node.code ? `（${node.code.slice(0, 30)}）` : '';
  return `${node.name ?? node.category}${codeHint}`;
}

async function describeNodesWithLlm(options: {
  llm: BuildUiTreeOptions['llm'];
  nodes: UiTreeNode[];
  baseUrls: string[];
  hintsById: Map<string, UiNodeTitleHints>;
}): Promise<Map<string, string>> {
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
    '5) 每个节点都提供了 suggested/hints：若 suggested 已合理，请直接采用或轻微润色。',
    '6) 若信息仍不足，请输出保守且短的标题（例如：某页面、某功能、按钮）。',
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
        hints: options.hintsById.get(n.id) ?? {},
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

  const radius = options.contextRadiusLines ?? 5;
  const batchSize = options.maxNodesPerLlmBatch ?? 15;
  const baseUrls = options.describeNodes || !apiKey ? [] : resolveLlmBaseUrls(options.llm.provider);
  const strings = await loadArkuiStringTable(options.appRootAbs);

  const scanRootAbs = path.join(options.appRootAbs, DEFAULT_APP_SCAN_SUBDIR);
  const routeToFileRel = new Map<string, string>();
  const fileRelToAbs = new Map<string, string>();
  for (const abs of options.appFiles) {
    const relToScan = relToArkUiRoot(scanRootAbs, abs);
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

  // Seed: @Entry pages + structs under /pages/.
  for (const abs of options.appFiles) {
    const fileText = await fs.readFile(abs, 'utf8');
    const lines = fileText.split(/\r?\n/u);
    const sf = ts.createSourceFile(abs, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const structs = scanStructBlocks(fileText, sf);
    const fileRel = toWorkspaceRelativePath(options.repoRoot, abs);
    fileRelToAbs.set(fileRel, abs);

    const entryStructs = lines.some((l) => /^\s*@Entry\b/u.test(l)) ? findEntryStructs(lines, structs) : [];
    for (const s of entryStructs) {
      const key = `${fileRel}#${s.name}`;
      if (queuedPageKeys.has(key)) continue;
      queuedPageKeys.add(key);
      pageQueue.push({ fileRel, structName: s.name, structStartLine: s.startLine, isRoot: true });
    }

    const relToScan = relToArkUiRoot(scanRootAbs, abs);
    const isPageFile = /(?:^|\/)pages\//u.test(relToScan);
    const primary = isPageFile ? pickPrimaryStruct(structs) : null;
    if (!primary) continue;

    const key = `${fileRel}#${primary.name}`;
    if (queuedPageKeys.has(key)) continue;
    queuedPageKeys.add(key);
    pageQueue.push({ fileRel, structName: primary.name, structStartLine: primary.startLine, isRoot: false });
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

    function looksInteractive(startLine: number): boolean {
      const end = Math.min(buildEnd, startLine + 12);
      const slice = lines.slice(startLine - 1, end).join('\n');
      return /\.(onClick|onTouch|onLongPress|onGesture|onAction)\s*\(/u.test(slice);
    }

    const componentStarts: Array<{ line: number; componentName: string }> = [];
    for (let ln = buildStart; ln <= buildEnd; ln += 1) {
      const lineText = lines[ln - 1] ?? '';
      if (isLikelyCommentLine(lineText)) continue;
      const hit = matchComponentStart(lineText);
      if (!hit) continue;
      componentStarts.push({ line: ln, componentName: hit.componentName });

      let category: UiTreeNodeCategory | null =
        categoryForComponentName(hit.componentName) ??
        (shouldCaptureUnknownComponentAsNode(hit.componentName) ? ('Component' satisfies UiTreeNodeCategory) : null);
      if (!category) continue;
      if (category !== 'Input' && category !== 'Button' && looksInteractive(ln)) category = 'Button';
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
    const hintsById = new Map<string, UiNodeTitleHints>();
    for (const n of batch) hintsById.set(n.id, buildUiNodeTitleHints({ node: n, strings }));

    let descMap = new Map<string, string>();
    try {
      if (options.describeNodes) descMap = await options.describeNodes(batch);
      else if (apiKey && baseUrls.length > 0) descMap = await describeNodesWithLlm({ llm: { ...options.llm, apiKey }, nodes: batch, baseUrls, hintsById });
    } catch {
      descMap = new Map();
    }
    for (const n of batch) {
      const suggested = hintsById.get(n.id)?.suggested ?? '';
      const raw = (descMap.get(n.id) ?? '').trim();
      const picked = raw && isGoodHumanTitle({ category: n.category, title: raw }) ? raw : suggested;
      const normalized = normalizeUiTitle({ category: n.category, title: picked || fallbackDescription(n) });
      nodes[n.id]!.description = normalized || fallbackDescription(n);
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
