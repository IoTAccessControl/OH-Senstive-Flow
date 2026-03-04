import fs from 'node:fs/promises';
import path from 'node:path';

import type { UiTreeNavTarget, UiTreeNode, UiTreeNodeCategory } from './types.js';

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

  mine: '我',
  me: '我',
  my: '我',
  profile: '我的',

  setting: '设置',
  settings: '设置',

  search: '搜索',
  login: '登录',
  register: '注册',

  qrcode: '扫一扫',
  qr: '扫一扫',
  scan: '扫一扫',
};

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function cleanWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

function normalizeShortTitle(text: string): string {
  let t = cleanWhitespace(text);
  t = t.replaceAll(/[“”"]/gu, '');
  t = t.replaceAll(/[’']/gu, '');
  t = t.replaceAll(/[（(]\s*/gu, '（').replaceAll(/\s*[）)]/gu, '）');
  // Prefer no spaces in short UI titles.
  t = t.replaceAll(/\s+/gu, '');
  // Trim obvious punctuation.
  t = t.replaceAll(/^[：:，,。.!！？?]+/gu, '').replaceAll(/[：:，,。.!！？?]+$/gu, '');
  return t;
}

function isLikelyNoiseString(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 40) return true;
  if (t.includes('pages/')) return true;
  if (t.includes('@ohos')) return true;
  if (t.includes('ohos.permission')) return true;
  if (t.includes('/') || t.includes('\\')) return true;
  if (t.includes('.ets') || t.includes('.ts')) return true;
  return false;
}

function splitPathSegments(filePath: string): string[] {
  const p = filePath.replaceAll('\\', '/');
  return p.split('/').filter(Boolean);
}

function stripTsExt(name: string): string {
  return name.replace(/\.(ets|ts|tsx|js|jsx)$/u, '');
}

function stripCommonPageSuffix(name: string): string {
  // ChatPage -> Chat, SettingsPage -> Settings
  return name.replace(/(Page|View|Screen|Ability)$/u, '');
}

function humanizeEnglishToken(token: string): string {
  const raw = token.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (PAGE_SEGMENT_MAP[lower]) return PAGE_SEGMENT_MAP[lower]!;
  // Split camelCase / PascalCase tokens into parts and translate piecewise.
  const parts = raw
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/\s+/u)
    .filter(Boolean);
  if (parts.length <= 1) return '';
  const translated = parts.map((p) => PAGE_SEGMENT_MAP[p.toLowerCase()] ?? '').filter(Boolean);
  return translated.length > 0 ? translated.join('') : '';
}

function ensurePageSuffix(title: string): string {
  const t = title.trim();
  if (!t) return '';
  if (t === '首页') return t;
  if (/(页|页面|界面|主页)$/u.test(t)) return t;
  return `${t}页面`;
}

export async function loadArkuiStringTable(appRootAbs: string): Promise<StringTable> {
  const candidates = [
    path.join(appRootAbs, 'entry', 'src', 'main', 'resources', 'base', 'element', 'string.json'),
    path.join(appRootAbs, 'AppScope', 'resources', 'base', 'element', 'string.json'),
  ];

  for (const p of candidates) {
    try {
      const text = await fs.readFile(p, 'utf8');
      const json = JSON.parse(text) as any;
      const arr = Array.isArray(json?.string) ? (json.string as any[]) : [];
      const map = new Map<string, string>();
      for (const item of arr) {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        const value = typeof item?.value === 'string' ? item.value.trim() : '';
        if (name && value) map.set(name, value);
      }
      return map;
    } catch {
      // try next
    }
  }
  return new Map();
}

export function extractResourceIdsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /\$r\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const m of text.matchAll(re)) {
    const id = typeof m[1] === 'string' ? m[1].trim() : '';
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
  // app.string.xxx -> xxx
  const m = /^app\.string\.([A-Za-z0-9_]+)$/u.exec(resourceId);
  if (!m) return '';
  const key = m[1] ?? '';
  if (!key) return '';
  return strings.get(key) ?? '';
}

export function extractQuotedStringsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /(['"])([^'"]{1,60})\1/gu;
  for (const m of text.matchAll(re)) {
    const raw = typeof m[2] === 'string' ? m[2] : '';
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
    for (const m of line.matchAll(reDirect)) {
      const name = typeof m[1] === 'string' ? m[1].trim() : '';
      if (!name) continue;
      out.push(name);
    }
  }
  // De-dup while preserving order.
  return Array.from(new Set(out));
}

function handlerNameToTitle(handler: string): string {
  const h = handler.toLowerCase();
  if (h.includes('search')) return '搜索';
  if (h.includes('send')) return '发送';
  if (h.includes('press') && (h.includes('talk') || h.includes('voice'))) return '发送语音';
  if (h.includes('talk') || h.includes('voice') || h.includes('record')) return '语音';
  if (h.includes('scan') || h.includes('qrcode') || h.includes('qr')) return '扫一扫';
  if (h.includes('login')) return '登录';
  if (h.includes('register')) return '注册';
  if (h.includes('back')) return '返回';
  if (h.includes('setting')) return '设置';
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
  const segs = splitPathSegments(filePath);
  const lowerSegs = segs.map((s) => stripTsExt(s).toLowerCase());

  const pagesIdx = lowerSegs.lastIndexOf('pages');
  const afterPages = pagesIdx >= 0 ? segs.slice(pagesIdx + 1) : segs;
  const afterPagesClean = afterPages.map((s) => stripCommonPageSuffix(stripTsExt(s)));
  const last = afterPagesClean[afterPagesClean.length - 1] ?? '';
  const penultimate = afterPagesClean.length >= 2 ? afterPagesClean[afterPagesClean.length - 2] ?? '' : '';

  const candidates = [last, penultimate].filter(Boolean);
  for (const c of candidates) {
    if (hasCjk(c)) return c;
    const translated = humanizeEnglishToken(c);
    if (translated) return translated;
    const mapped = PAGE_SEGMENT_MAP[c.toLowerCase()];
    if (mapped) return mapped;
  }

  // Fallback: try any segment matches.
  for (let i = afterPagesClean.length - 1; i >= 0; i -= 1) {
    const seg = afterPagesClean[i] ?? '';
    const mapped = PAGE_SEGMENT_MAP[seg.toLowerCase()];
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
  // Prefer Chinese, then short English.
  const cleaned = candidates
    .map((c) => normalizeShortTitle(c))
    .filter((c) => c && !isLikelyNoiseString(c));
  const uniq = Array.from(new Set(cleaned));

  const chinese = uniq.filter((t) => hasCjk(t));
  if (chinese[0]) return chinese[0];

  const shortEn = uniq.filter((t) => /^[A-Za-z0-9]+$/u.test(t) && t.length <= 10);
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
  const resourceTexts = resourceIds.map((rid) => resolveStringResource(rid, args.strings)).filter(Boolean);
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
    // Component
    title = visibleText || handlerTitles[0] || iconTitles[0] || '';
    if (!title && args.navTarget?.url) title = '进入页面';
    if (!title) title = '功能入口';
  }

  title = normalizeShortTitle(title);
  if (!title) title = args.category === 'Input' ? '输入' : '功能';

  return {
    title,
    hints: {
      visibleTexts: quoted.filter((t) => !isLikelyNoiseString(t)).slice(0, 8),
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
  const t = normalizeShortTitle(raw);
  if (!t) return false;
  if (t.length > (args.category === 'Page' ? 16 : 24)) return false;

  // Avoid obvious machine-ish prefixes.
  if (/^(页面|输入框|显示元素|可点击元素|UI元素|UI)\s*[：:]/u.test(raw.trim())) return false;

  // Avoid leaking component / struct / file names.
  if (/\b(Button|TextInput|TextArea|Search|Column|Row|List|Image|Text|struct)\b/u.test(raw)) return false;
  if (/(Page|View|Screen)\b/u.test(raw) && !hasCjk(raw)) return false;
  if (raw.includes('.ets') || raw.includes('.ts')) return false;
  if (raw.includes('desc:')) return false;

  // Page should generally mention it's a page unless it's "首页".
  if (args.category === 'Page' && t !== '首页' && !/(页|页面|界面|主页)$/u.test(t)) return false;

  return true;
}

export function normalizeUiTitle(args: { category: UiTreeNodeCategory; title: string }): string {
  const base = normalizeShortTitle(args.title);
  if (!base) return '';
  if (args.category === 'Page') return ensurePageSuffix(base);
  return base;
}

