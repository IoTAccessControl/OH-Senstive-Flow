import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

export type WalkOptions = {
  extensions?: string[];
  ignoreDirNames?: string[];
};

export async function walkFiles(rootDir: string, options: WalkOptions = {}): Promise<string[]> {
  const extensions = options.extensions?.map((e) => (e.startsWith('.') ? e : `.${e}`));
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
