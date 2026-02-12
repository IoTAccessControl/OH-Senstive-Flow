import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

type OverrideRow = { api?: string; description?: string };

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function getOverrideCsvPath(csvDir: string): string {
  return path.join(csvDir, 'sdk_api_description_override.csv');
}

export async function loadOverrideDescriptions(csvDir: string): Promise<Map<string, string>> {
  const filePath = getOverrideCsvPath(csvDir);
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

