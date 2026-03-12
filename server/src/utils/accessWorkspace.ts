import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

export type WalkOptions = {
  extensions?: string[];
  ignoreDirNames?: string[];
};

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as unknown;
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsQuoting = /[",\n\r]/.test(raw);
  if (!needsQuoting) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

export async function writeCsvFile(
  filePath: string,
  headers: string[],
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(','));
  for (const row of rows) lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  await fs.writeFile(filePath, `\ufeff${lines.join('\n')}\n`, 'utf8');
}

export function toPosixPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/');
}

export function toWorkspaceRelativePath(repoRoot: string, filePath: string): string {
  const rel = path.relative(repoRoot, filePath);
  return toPosixPath(rel.length === 0 ? filePath : rel);
}

export function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') || value.endsWith(path.sep) ? value : `${value}/`;
}

export function resolveWorkspacePath(repoRoot: string, maybeRelativePath: string): string {
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.resolve(repoRoot, maybeRelativePath);
}

export async function assertReadableDirectory(dirPath: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) throw new Error(`${label} 不是目录: ${dirPath}`);
  } catch {
    throw new Error(`${label} 不存在或无法访问: ${dirPath}`);
  }
}

export function normalizeWorkspaceSubpath(rawPath: string): string {
  if (rawPath.includes('\0')) throw new Error('非法 path');
  const normalized = rawPath.replace(/\\/gu, '/').replace(/^\/+/u, '').replace(/\/+$/u, '');
  if (normalized.split('/').some((part) => part === '..')) throw new Error('path 不允许包含 ..');
  return normalized;
}

export function resolveSafeWorkspaceChild(baseDirAbs: string, relPath: string): string {
  const normalized = normalizeWorkspaceSubpath(relPath);
  const targetDirAbs = path.resolve(baseDirAbs, normalized);
  const relCheck = path.relative(baseDirAbs, targetDirAbs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error('path 越界');
  return targetDirAbs;
}

export async function walkFiles(rootDir: string, options: WalkOptions = {}): Promise<string[]> {
  const extensions = options.extensions?.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  const ignoreDirNames = new Set(options.ignoreDirNames ?? []);

  const results: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirNames.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (extensions && !extensions.some((ext) => entry.name.endsWith(ext))) continue;
      results.push(fullPath);
    }
  }

  return results;
}
