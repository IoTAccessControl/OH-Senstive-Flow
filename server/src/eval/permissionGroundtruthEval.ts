import fs from 'node:fs/promises';
import path from 'node:path';

import { walkFiles } from '../analyzer/walk.js';

export const OHOS_PERMISSION_REGEX = /ohos\.permission\.[A-Za-z0-9_]+/gu;

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replaceAll(/\r?\n/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
}

export function normalizePermissionToken(v: unknown): string {
  const t = cleanText(v);
  if (!t) return '';
  // Remove optional hints like "（可选）" to keep tokens stable.
  return t.replaceAll(/（[^）]*）/gu, '').trim();
}

export function extractPermissionNames(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  for (const match of text.matchAll(OHOS_PERMISSION_REGEX)) out.push(match[0]);
  return out;
}

function addAll(target: Set<string>, items: string[]): void {
  for (const it of items) {
    const t = normalizePermissionToken(it);
    if (t) target.add(t);
  }
}

export async function collectPermissionsFromApp(appDirAbs: string): Promise<Set<string>> {
  const permissions = new Set<string>();
  const files = await walkFiles(appDirAbs, {
    extensions: ['ets', 'ts', 'js', 'json', 'json5'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out'],
  });

  for (const filePath of files) {
    const normalized = filePath.split(path.sep).join('/');
    if (!normalized.includes('/src/main/')) continue;
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

export async function loadGroundtruthFile(filePath: string): Promise<Set<string>> {
  const text = await fs.readFile(filePath, 'utf8');
  const set = new Set<string>();
  for (const line of text.split(/\r?\n/gu)) {
    const t = line.trim();
    if (!t) continue;
    const extracted = extractPermissionNames(t);
    if (extracted.length > 0) {
      addAll(set, extracted);
      continue;
    }
    const normalized = normalizePermissionToken(t);
    if (normalized.startsWith('ohos.permission.')) set.add(normalized);
  }
  return set;
}

export async function collectPredictedPermissionsFromRun(runDirAbs: string): Promise<Set<string>> {
  const permissions = new Set<string>();
  const files = await walkFiles(runDirAbs, {
    extensions: ['json'],
    ignoreDirNames: ['node_modules', '.git'],
  });

  for (const filePath of files) {
    if (!filePath.endsWith(`${path.sep}privacy_facts.json`)) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    const practices = parsed?.facts?.permissionPractices;
    if (!Array.isArray(practices)) continue;
    for (const practice of practices) {
      const raw = normalizePermissionToken(practice?.permissionName);
      if (!raw || raw === '未识别') continue;

      const extracted = extractPermissionNames(raw);
      if (extracted.length > 0) {
        addAll(permissions, extracted);
        continue;
      }
      if (raw.startsWith('ohos.permission.')) permissions.add(raw);
    }
  }

  return permissions;
}

export type PermissionEvalResult = {
  counts: { gt: number; pred: number; tp: number; fp: number; fn: number };
  recall: number;
  precision: number;
  falsePositiveRate: number; // FP / Pred
  missing: string[]; // in GT but not Pred
  extra: string[]; // in Pred but not GT
};

function sortPermissions(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function evaluatePermissionSets(gt: Set<string>, pred: Set<string>): PermissionEvalResult {
  const missing: string[] = [];
  const extra: string[] = [];
  let tp = 0;
  for (const g of gt) {
    if (pred.has(g)) tp += 1;
    else missing.push(g);
  }
  for (const p of pred) {
    if (!gt.has(p)) extra.push(p);
  }

  const fp = extra.length;
  const fn = missing.length;

  const gtSize = gt.size;
  const predSize = pred.size;

  const recall = gtSize === 0 ? (predSize === 0 ? 1 : 0) : tp / gtSize;
  const precision = predSize === 0 ? 1 : tp / predSize;
  const falsePositiveRate = predSize === 0 ? 0 : fp / predSize;

  return {
    counts: { gt: gtSize, pred: predSize, tp, fp, fn },
    recall,
    precision,
    falsePositiveRate,
    missing: sortPermissions(missing),
    extra: sortPermissions(extra),
  };
}

