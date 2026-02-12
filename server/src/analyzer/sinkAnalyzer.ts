import fs from 'node:fs/promises';
import ts from 'typescript';

import type { SdkModuleIndex } from './sdkIndexer.js';
import { extractSdkImportBindings } from './imports.js';
import { resolveBindingViaKitReExport } from './kitResolver.js';
import type { ResolvedBinding, SinkRecord } from './types.js';
import { scanTokens } from './tokenScanner.js';
import { toWorkspaceRelativePath } from './pathUtils.js';
import { SdkDocStore } from './sdkDocStore.js';

type SinkAnalyzeOptions = {
  repoRoot: string;
  appFiles: string[];
  sdkIndex: SdkModuleIndex;
  csvDescriptions: Map<string, string>;
  overrideDescriptions: Map<string, string>;
};

type CallHit = {
  kind: 'direct' | 'method' | 'new';
  localName: string;
  methodName?: string;
  callPos: number;
};

function getLineTextAt(sourceText: string, lineNumber1Based: number): string {
  const lines = sourceText.split(/\r?\n/u);
  const idx = lineNumber1Based - 1;
  if (idx < 0 || idx >= lines.length) return '';
  return lines[idx].trim();
}

function buildApiKey(moduleName: string, segments: string[]): string {
  return `${moduleName}.${segments.join('.')}`;
}

export async function analyzeSinks(options: SinkAnalyzeOptions): Promise<SinkRecord[]> {
  const sdkDocStore = new SdkDocStore(options.sdkIndex);
  const records: SinkRecord[] = [];

  for (const filePath of options.appFiles) {
    const fileText = await fs.readFile(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const bindings = extractSdkImportBindings(sf);
    if (bindings.length === 0) continue;

    const bindingMap = new Map<string, ResolvedBinding>();
    for (const b of bindings) {
      // Last import wins (common in TS tooling); keep stable behavior.
      bindingMap.set(b.localName, b);
    }

    const hits = findSdkCallHits(fileText, new Set(bindingMap.keys()));
    if (hits.length === 0) continue;

    const fileRel = toWorkspaceRelativePath(options.repoRoot, filePath);

    for (const hit of hits) {
      const originalBinding = bindingMap.get(hit.localName);
      if (!originalBinding) continue;
      const resolvedBinding = await resolveBindingViaKitReExport(options.sdkIndex, originalBinding);

      const callLine = sf.getLineAndCharacterOfPosition(hit.callPos).line + 1;
      const callCode = getLineTextAt(fileText, callLine);

      const api = await buildSegmentsAndDescription({
        sdkDocStore,
        sdkIndex: options.sdkIndex,
        csvDescriptions: options.csvDescriptions,
        overrideDescriptions: options.overrideDescriptions,
        binding: resolvedBinding,
        hit,
      });

      records.push({
        App源码文件路径: fileRel,
        导入行号: originalBinding.importLine,
        导入代码: originalBinding.importCode,
        调用行号: callLine,
        调用代码: callCode,
        API功能描述: api.description,
        __apiKey: api.apiKey,
        __module: resolvedBinding.module,
      });
    }
  }

  return records;
}

function findSdkCallHits(fileText: string, localNames: Set<string>): CallHit[] {
  const tokens = scanTokens(fileText);
  const hits: CallHit[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];

    // new LocalName(...)
    if (t.kind === ts.SyntaxKind.NewKeyword) {
      const t1 = tokens[i + 1];
      const t2 = tokens[i + 2];
      if (t1?.kind === ts.SyntaxKind.Identifier && localNames.has(t1.text) && t2?.kind === ts.SyntaxKind.OpenParenToken) {
        hits.push({ kind: 'new', localName: t1.text, callPos: t.pos });
      }
      continue;
    }

    if (t.kind !== ts.SyntaxKind.Identifier) continue;
    if (!localNames.has(t.text)) continue;

    // LocalName(...)
    if (tokens[i + 1]?.kind === ts.SyntaxKind.OpenParenToken) {
      hits.push({ kind: 'direct', localName: t.text, callPos: t.pos });
      continue;
    }

    // LocalName.method(...)
    const dot = tokens[i + 1];
    if (!dot || (dot.kind !== ts.SyntaxKind.DotToken && dot.kind !== ts.SyntaxKind.QuestionDotToken)) continue;
    const name = tokens[i + 2];
    const paren = tokens[i + 3];
    if (name?.kind !== ts.SyntaxKind.Identifier) continue;
    if (paren?.kind !== ts.SyntaxKind.OpenParenToken) continue;
    hits.push({ kind: 'method', localName: t.text, methodName: name.text, callPos: t.pos });
  }

  return hits;
}

async function buildSegmentsAndDescription(args: {
  sdkDocStore: SdkDocStore;
  sdkIndex: SdkModuleIndex;
  csvDescriptions: Map<string, string>;
  overrideDescriptions: Map<string, string>;
  binding: ResolvedBinding;
  hit: CallHit;
}): Promise<{ apiKey: string; description: string }> {
  const { binding, hit, sdkDocStore } = args;

  const defaultKind = binding.importKind === 'default' ? await sdkDocStore.getDefaultExportKind(binding.module) : 'unknown';

  let segments: string[] = [];
  if (hit.kind === 'new') {
    // new LocalName()
    if (binding.importKind === 'named') segments = [binding.importedName];
    else segments = [binding.localName];
  } else if (hit.kind === 'direct') {
    // LocalName()
    if (binding.importKind === 'named') segments = [binding.importedName];
    else segments = [binding.localName];
  } else if (hit.kind === 'method' && hit.methodName) {
    // LocalName.method()
    if (binding.importKind === 'named') {
      segments = [binding.importedName, hit.methodName];
    } else if (binding.importKind === 'default' && defaultKind !== 'namespace') {
      segments = [binding.localName, hit.methodName];
    } else {
      segments = [hit.methodName];
    }
  }

  const apiKey = buildApiKey(binding.module, segments);

  const fromSdk = await sdkDocStore.getDescription(binding.module, segments);
  const fromCsv = args.csvDescriptions.get(apiKey);
  const fromOverride = args.overrideDescriptions.get(apiKey);

  const description =
    fromSdk ??
    fromCsv ??
    fromOverride ??
    `未提取到SDK注释；请在 input/csv/sdk_api_description_override.csv 补充该 API 描述（api=${apiKey}）`;

  return { apiKey, description };
}
