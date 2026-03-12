import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

import { walkFiles } from '../../utils/accessWorkspace.js';

type CsvApiRow = Record<string, string | undefined>;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of arr) {
    if (!a) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

export function normalizeCsvApiKey(raw: string): string {
  let s = raw.trim();

  // Remove signature / params part.
  const paren = s.indexOf('(');
  if (paren !== -1) s = s.slice(0, paren);

  // Normalize separators seen in some CSV exports (e.g. "a->b", "a-->b").
  s = s.replaceAll('-->', '.').replaceAll('->', '.');

  // Normalize common typos / punctuation.
  s = s.replaceAll('#', '.');
  s = s.replaceAll("'", '').replaceAll('"', '').replaceAll('`', '');

  // Drop URL-like suffixes that are not part of the API key.
  const urlIdx = s.indexOf('://');
  if (urlIdx !== -1) s = s.slice(0, urlIdx);

  // Cleanup redundant dots.
  s = s.replaceAll(/\s+/gu, '');
  s = s.replaceAll(/\.{2,}/gu, '.');
  s = s.replaceAll(/^\.+|\.+$/gu, '');

  return s.trim();
}

function extractPermissionNames(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const matches = text.match(/ohos\.permission\.[A-Za-z0-9_]+/gu) ?? [];
  return uniq(matches.map((m) => m.trim()).filter(Boolean));
}

function buildDescriptionFromRow(row: CsvApiRow): string | undefined {
  const behavior = row['敏感行为']?.trim();
  const sub = row['行为子项']?.trim();
  const perm = row['相关权限']?.trim();
  const data = row['敏感数据项']?.trim();
  const dataSub = row['敏感数据子项']?.trim();

  const parts: string[] = [];
  if (behavior) parts.push(sub ? `${behavior} / ${sub}` : behavior);
  if (perm) parts.push(`权限: ${perm}`);
  if (data || dataSub) parts.push(`数据: ${[data, dataSub].filter(Boolean).join(' / ')}`);
  const joined = parts.join('; ').trim();
  return joined.length > 0 ? joined : undefined;
}

export async function loadCsvApiDescriptions(csvDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const csvFiles = await walkFiles(csvDir, {
    extensions: ['.csv'],
    ignoreDirNames: ['node_modules', '.git', 'output', 'dist', 'build'],
  });

  for (const filePath of csvFiles) {
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    text = stripBom(text);

    let records: CsvApiRow[];
    try {
      records = parse(text, {
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as CsvApiRow[];
    } catch {
      continue;
    }

    // Only use CSVs that look like "sdk_api_and_permission.csv"
    const hasRelatedApiColumn = records.length > 0 && Object.prototype.hasOwnProperty.call(records[0], '相关API');
    if (!hasRelatedApiColumn) continue;

    for (const row of records) {
      const apiRaw = row['相关API']?.trim();
      if (!apiRaw) continue;
      const apiKey = normalizeCsvApiKey(apiRaw);
      if (!apiKey.startsWith('@ohos.') && !apiKey.startsWith('@kit.')) continue;
      const desc = buildDescriptionFromRow(row);
      if (!desc) continue;
      if (!map.has(apiKey)) map.set(apiKey, desc);
    }
  }

  return map;
}

export async function loadCsvApiPermissions(csvDir: string): Promise<Map<string, string[]>> {
  const map = new Map<string, Set<string>>();

  const csvFiles = await walkFiles(csvDir, {
    extensions: ['.csv'],
    ignoreDirNames: ['node_modules', '.git', 'output', 'dist', 'build'],
  });

  for (const filePath of csvFiles) {
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    text = stripBom(text);

    let records: CsvApiRow[];
    try {
      records = parse(text, {
        columns: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as CsvApiRow[];
    } catch {
      continue;
    }

    const hasRelatedApiColumn = records.length > 0 && Object.prototype.hasOwnProperty.call(records[0], '相关API');
    if (!hasRelatedApiColumn) continue;

    for (const row of records) {
      const apiRaw = row['相关API']?.trim();
      if (!apiRaw) continue;
      const apiKey = normalizeCsvApiKey(apiRaw);
      if (!apiKey.startsWith('@ohos.') && !apiKey.startsWith('@kit.')) continue;

      const permRaw = row['相关权限']?.trim() ?? '';
      const permissions = extractPermissionNames(permRaw);
      if (permissions.length === 0) continue;

      const set = map.get(apiKey) ?? new Set<string>();
      for (const p of permissions) set.add(p);
      map.set(apiKey, set);
    }
  }

  const out = new Map<string, string[]>();
  for (const [apiKey, perms] of map) {
    const arr = Array.from(perms).sort((a, b) => a.localeCompare(b));
    if (arr.length > 0) out.set(apiKey, arr);
  }
  return out;
}

type OverrideRow = { api?: string; description?: string };

export async function loadOverrideDescriptions(csvDir: string): Promise<Map<string, string>> {
  const filePath = path.join(csvDir, 'sdk_api_description_override.csv');
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return new Map();
  }
  text = stripBom(text);

  let rows: OverrideRow[];
  try {
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as OverrideRow[];
  } catch {
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of rows) {
    const api = row.api?.trim();
    const desc = row.description?.trim();
    if (!api || !desc) continue;
    map.set(api, desc);
  }
  return map;
}
