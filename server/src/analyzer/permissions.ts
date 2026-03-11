import fs from 'node:fs/promises';
import path from 'node:path';

import { walkFiles } from './walk.js';

export const OHOS_PERMISSION_REGEX = /ohos\.permission\.[A-Za-z0-9_]+/gu;

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
