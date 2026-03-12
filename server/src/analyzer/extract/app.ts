import fs from 'node:fs/promises';
import path from 'node:path';

import { walkFiles } from '../../utils/accessWorkspace.js';

export const DEFAULT_APP_SCAN_SUBDIR = path.join('entry', 'src', 'main', 'ets');

export const OHOS_PERMISSION_REGEX = /ohos\.permission\.[A-Za-z0-9_]+/gu;

export async function scanAppArkTsFiles(appRootPath: string): Promise<string[]> {
  // Prefer scanning all ArkTS sources under */src/main/ets, not just entry/, to avoid missing
  // multi-module projects (e.g. common/home/mine/video).
  const files = await walkFiles(appRootPath, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });

  const inMainEts = (filePath: string): boolean => {
    const normalized = filePath.split(path.sep).join('/');
    if (normalized.includes('/src/ohosTest/')) return false;
    return normalized.includes('/src/main/ets/');
  };

  const picked = files.filter(inMainEts);
  if (picked.length > 0) return picked;

  // Fallback to the original default path for backward compatibility / minimal apps.
  const scanRoot = path.join(appRootPath, DEFAULT_APP_SCAN_SUBDIR);
  const fallback = await walkFiles(scanRoot, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });
  if (fallback.length > 0) return fallback;

  // Last resort: some imported samples only keep transpiled ArkTS cache files under build/.
  // We prefer real sources, but scanning the generated cache is better than returning zero files.
  const generatedFiles = await walkFiles(appRootPath, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'dist', 'out', 'hvigor', 'oh_modules'],
  });
  return generatedFiles.filter((filePath) => {
    const normalized = filePath.split(path.sep).join('/');
    return normalized.includes('/build/') && normalized.includes('/src/main/ets/');
  });
}

export function normalizePermissionToken(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  return t.replaceAll(/（[^）]*）/gu, '').trim();
}

export function extractPermissionNames(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const match of text.matchAll(OHOS_PERMISSION_REGEX)) out.push(match[0]);
  return Array.from(new Set(out.map((item) => normalizePermissionToken(item)).filter(Boolean)));
}

function addAll(target: Set<string>, items: string[]): void {
  for (const item of items) {
    const normalized = normalizePermissionToken(item);
    if (normalized) target.add(normalized);
  }
}

export async function collectPermissionsFromApp(appDirAbs: string): Promise<Set<string>> {
  const permissions = new Set<string>();
  const files = await walkFiles(appDirAbs, {
    extensions: ['ets', 'ts', 'js', 'json', 'json5'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });

  for (const filePath of files) {
    const normalized = filePath.split(path.sep).join('/');
    if (normalized.includes('/src/ohosTest/')) continue;

    let text = '';
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    addAll(permissions, extractPermissionNames(text));
  }

  return permissions;
}
