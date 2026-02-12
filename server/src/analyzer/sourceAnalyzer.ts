import fs from 'node:fs/promises';

import type { SourceRecord } from './types.js';
import { SOURCE_FUNCTION_DESCRIPTIONS } from './defaults.js';
import { toWorkspaceRelativePath } from './pathUtils.js';

const TARGET_NAMES = new Set(Object.keys(SOURCE_FUNCTION_DESCRIPTIONS));

function isFunctionDefinitionLine(line: string, functionName: string): boolean {
  // Matches: build() { ... } , async aboutToAppear() { ... }, private onCreate(...) { ... }
  const pattern = new RegExp(
    String.raw`^\s*(?:public|private|protected)?\s*(?:async\s+)?${functionName}\s*\([^)]*\)\s*\{`,
    'u',
  );
  return pattern.test(line);
}

export async function analyzeSources(repoRoot: string, appFiles: string[]): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];

  for (const filePath of appFiles) {
    const fileText = await fs.readFile(filePath, 'utf8');
    const lines = fileText.split(/\r?\n/u);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const name of TARGET_NAMES) {
        if (!isFunctionDefinitionLine(line, name)) continue;
        records.push({
          App源码文件路径: toWorkspaceRelativePath(repoRoot, filePath),
          行号: i + 1,
          函数名称: name,
          描述: SOURCE_FUNCTION_DESCRIPTIONS[name] ?? '入口函数/生命周期函数',
        });
      }
    }
  }

  return records;
}

