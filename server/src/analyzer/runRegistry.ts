import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureDir, writeJsonFile } from './io.js';

export type RunRegistryEntry = {
  runId: string;
  outputDir: string;
};

function registryDir(repoRoot: string): string {
  return path.join(repoRoot, 'output', '_runs');
}

export async function listRunRegistry(repoRoot: string): Promise<RunRegistryEntry[]> {
  const dir = registryDir(repoRoot);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  }

  const items: Array<{ entry: RunRegistryEntry; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name === 'latest.json') continue;

    const filePath = path.join(dir, name);
    try {
      const [text, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const parsed = JSON.parse(text) as Partial<RunRegistryEntry>;
      const runId =
        typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId.trim() : name.slice(0, -'.json'.length);
      const outputDir = typeof parsed.outputDir === 'string' ? parsed.outputDir : '';
      items.push({ entry: { runId, outputDir }, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore broken registry entries
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map((item) => item.entry);
}

export async function writeRunRegistry(repoRoot: string, entry: RunRegistryEntry): Promise<void> {
  const dir = registryDir(repoRoot);
  await ensureDir(dir);
  await writeJsonFile(path.join(dir, `${entry.runId}.json`), entry);
  await writeJsonFile(path.join(dir, `latest.json`), entry);
}

export async function resolveRunIdToOutputDir(repoRoot: string, runId?: string): Promise<string> {
  if (!runId) {
    const latestPath = path.join(registryDir(repoRoot), 'latest.json');
    const text = await fs.readFile(latestPath, 'utf8');
    const latest = JSON.parse(text) as RunRegistryEntry;
    return path.resolve(repoRoot, latest.outputDir);
  }
  const filePath = path.join(registryDir(repoRoot), `${runId}.json`);
  const text = await fs.readFile(filePath, 'utf8');
  const entry = JSON.parse(text) as RunRegistryEntry;
  return path.resolve(repoRoot, entry.outputDir);
}
