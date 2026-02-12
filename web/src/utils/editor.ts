function normalizePathSlashes(value: string): string {
  return value.replace(/\\/gu, '/');
}

function isWindowsDrivePath(value: string): boolean {
  const normalized = normalizePathSlashes(value).trim();
  return /^[A-Za-z]:\//u.test(normalized);
}

function isProbablyAbsolutePath(value: string): boolean {
  const normalized = normalizePathSlashes(value).trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return true;
  if (normalized.startsWith('//')) return true;
  if (isWindowsDrivePath(normalized)) return true;
  return false;
}

function isPosixAbsolutePath(value: string): boolean {
  const normalized = normalizePathSlashes(value).trim();
  if (!normalized) return false;
  if (normalized.startsWith('//')) return false;
  return normalized.startsWith('/');
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '');
}

function stripLeadingSlashes(value: string): string {
  return value.replace(/^\/+/u, '');
}

export function resolveToAbsoluteFilePath(repoRoot: string | undefined, filePath: string): string | null {
  const normalizedFilePath = normalizePathSlashes(filePath).trim();
  if (!normalizedFilePath) return null;
  if (isProbablyAbsolutePath(normalizedFilePath)) return normalizedFilePath;

  const normalizedRepoRoot = normalizePathSlashes(repoRoot ?? '').trim();
  if (!normalizedRepoRoot) return null;

  return `${stripTrailingSlashes(normalizedRepoRoot)}/${stripLeadingSlashes(normalizedFilePath)}`;
}

function readEditorSchemeFromEnv(): { scheme: string; localPrefix: string } {
  const raw = (import.meta.env.VITE_EDITOR_SCHEME as string | undefined) ?? 'vscode';
  const trimmed = raw.trim();
  if (!trimmed) return { scheme: 'vscode', localPrefix: 'vscode://file' };
  if (trimmed.includes('://')) {
    const localPrefix = trimmed.replace(/\/+$/u, '');
    const scheme = localPrefix.split('://')[0] || 'vscode';
    return { scheme, localPrefix };
  }
  return { scheme: trimmed, localPrefix: `${trimmed}://file` };
}

function supportsVsCodeRemote(scheme: string): boolean {
  const s = scheme.trim().toLowerCase();
  if (!s) return false;
  return s === 'vscode' || s === 'vscode-insiders' || s.startsWith('vscode');
}

function isWindowsBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\bWindows\b/ui.test(ua);
}

function encodeFilePathAsUrlPath(absoluteFilePath: string): string {
  const normalized = normalizePathSlashes(absoluteFilePath).trim();
  if (!normalized) return '';

  // Windows drive path: "C:/Users/me/file.ts" -> "/C:/Users/me/file.ts"
  const driveMatch = /^([A-Za-z]:)(\/.*)$/u.exec(normalized);
  if (driveMatch) {
    const drive = driveMatch[1] ?? '';
    const rest = driveMatch[2] ?? '';
    const encodedRest = rest
      .split('/')
      .map((seg) => (seg ? encodeURIComponent(seg) : ''))
      .join('/');
    return `/${drive}${encodedRest}`;
  }

  const encoded = normalized
    .split('/')
    .map((seg, idx) => {
      if (!seg && idx === 0) return '';
      return encodeURIComponent(seg);
    })
    .join('/');

  return encoded.startsWith('/') ? encoded : `/${encoded}`;
}

function buildEditorHrefWithPrefix(prefix: string, args: { absoluteFilePath: string; line?: number; column?: number }): string {
  const urlPath = encodeFilePathAsUrlPath(args.absoluteFilePath);

  let url = `${prefix}${urlPath}`;
  if (typeof args.line === 'number' && Number.isFinite(args.line) && args.line > 0) {
    url += `:${Math.floor(args.line)}`;
    if (typeof args.column === 'number' && Number.isFinite(args.column) && args.column > 0) {
      url += `:${Math.floor(args.column)}`;
    }
  }
  return url;
}

export function buildEditorHref(args: { absoluteFilePath: string; line?: number; column?: number }): string {
  const { localPrefix } = readEditorSchemeFromEnv();
  return buildEditorHrefWithPrefix(localPrefix, args);
}

export function buildEditorHrefForPath(args: {
  repoRoot?: string;
  filePath: string;
  line?: number;
  column?: number;
  wslDistroName?: string;
}): string | null {
  const absolute = resolveToAbsoluteFilePath(args.repoRoot, args.filePath);
  if (!absolute) return null;

  const { scheme, localPrefix } = readEditorSchemeFromEnv();
  const wslDistroName = (args.wslDistroName ?? '').trim();

  if (wslDistroName && supportsVsCodeRemote(scheme) && isWindowsBrowser() && isPosixAbsolutePath(absolute) && !isWindowsDrivePath(absolute)) {
    const remotePrefix = `${scheme}://vscode-remote/wsl+${encodeURIComponent(wslDistroName)}`;
    return buildEditorHrefWithPrefix(remotePrefix, { absoluteFilePath: absolute, line: args.line, column: args.column });
  }

  return buildEditorHrefWithPrefix(localPrefix, { absoluteFilePath: absolute, line: args.line, column: args.column });
}
