import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

import { walkFiles } from './walk.js';

type CsvApiRow = Record<string, string | undefined>;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeCsvApiKey(raw: string): string {
  let s = raw.trim();
  const paren = s.indexOf('(');
  if (paren !== -1) s = s.slice(0, paren);
  s = s.replaceAll('#', '.');
  return s.trim();
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
