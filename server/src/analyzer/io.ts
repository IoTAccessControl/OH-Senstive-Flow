import fs from 'node:fs/promises';
import path from 'node:path';

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
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  const bom = '\ufeff';
  await fs.writeFile(filePath, `${bom}${lines.join('\n')}\n`, 'utf8');
}

