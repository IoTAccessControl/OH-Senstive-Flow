import path from 'node:path';

export function toPosixPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/');
}

export function toWorkspaceRelativePath(repoRoot: string, filePath: string): string {
  const rel = path.relative(repoRoot, filePath);
  return toPosixPath(rel.length === 0 ? filePath : rel);
}

export function ensureTrailingSlash(p: string): string {
  return p.endsWith('/') || p.endsWith(path.sep) ? p : `${p}/`;
}

