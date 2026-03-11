import fs from 'node:fs/promises';
import ts from 'typescript';

import type { SdkModuleIndex } from './sdkIndexer.js';
import { extractSdkImportBindings } from './imports.js';
import { resolveBindingViaKitReExport } from './kitResolver.js';
import type { ResolvedBinding, SinkRecord } from './types.js';
import { toWorkspaceRelativePath } from './pathUtils.js';
import { SdkDocStore } from './sdkDocStore.js';

type SinkAnalyzeOptions = {
  repoRoot: string;
  appFiles: string[];
  sdkIndex: SdkModuleIndex;
  csvDescriptions: Map<string, string>;
  overrideDescriptions: Map<string, string>;
  csvPermissions?: Map<string, string[]>;
};

type ImportedCallKind = 'direct' | 'method' | 'new';

type ImportedCallHit = {
  kind: ImportedCallKind;
  localName: string;
  methodName?: string;
};

type BindingPair = {
  original: ResolvedBinding;
  resolved: ResolvedBinding;
};

type ResolvedImportedCall = {
  original: ResolvedBinding;
  resolved: ResolvedBinding;
  segments: string[];
  apiKey: string;
};

type InstanceTypeInfo = {
  module: string;
  typeName: string;
  importLine: number;
  importCode: string;
};

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

function getLineTextAt(sourceText: string, lineNumber1Based: number): string {
  const lines = sourceText.split(/\r?\n/u);
  const idx = lineNumber1Based - 1;
  if (idx < 0 || idx >= lines.length) return '';
  return lines[idx].trim();
}

function buildApiKey(moduleName: string, segments: string[]): string {
  return `${moduleName}.${segments.join('.')}`;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isAsExpression(cur)) cur = cur.expression;
    else if (ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur)) cur = cur.expression;
    else if (ts.isAwaitExpression(cur)) cur = cur.expression;
    else break;
  }
  return cur;
}

function isPropertyAccessLike(expr: ts.Expression): expr is ts.PropertyAccessExpression | ts.PropertyAccessChain {
  return ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain(expr);
}

function isCallLike(expr: ts.Expression): expr is ts.CallExpression | ts.NewExpression {
  return ts.isCallExpression(expr) || ts.isNewExpression(expr);
}

function extractImportedCallHit(node: ts.CallExpression | ts.NewExpression): ImportedCallHit | null {
  const callee = node.expression;

  if (ts.isIdentifier(callee)) {
    const localName = callee.text;
    if (!localName) return null;
    return { kind: ts.isNewExpression(node) ? 'new' : 'direct', localName };
  }

  if (ts.isCallExpression(node) && isPropertyAccessLike(callee)) {
    const base = unwrapExpression(callee.expression);
    if (!ts.isIdentifier(base)) return null;
    const localName = base.text;
    const methodName = callee.name?.text ?? '';
    if (!localName || !methodName) return null;
    return { kind: 'method', localName, methodName };
  }

  return null;
}

async function buildSegmentsForImportedHit(args: {
  sdkDocStore: SdkDocStore;
  binding: ResolvedBinding;
  hit: ImportedCallHit;
}): Promise<string[]> {
  const defaultKind = args.binding.importKind === 'default' ? await args.sdkDocStore.getDefaultExportKind(args.binding.module) : 'unknown';

  if (args.hit.kind === 'new') {
    if (args.binding.importKind === 'named') return [args.binding.importedName];
    return [args.binding.localName];
  }

  if (args.hit.kind === 'direct') {
    if (args.binding.importKind === 'named') return [args.binding.importedName];
    return [args.binding.localName];
  }

  if (args.hit.kind === 'method' && args.hit.methodName) {
    if (args.binding.importKind === 'named') return [args.binding.importedName, args.hit.methodName];
    if (args.binding.importKind === 'default' && defaultKind !== 'namespace') return [args.binding.localName, args.hit.methodName];
    return [args.hit.methodName];
  }

  return [];
}

async function buildApiInfo(args: {
  sdkDocStore: SdkDocStore;
  moduleName: string;
  segments: string[];
  csvDescriptions: Map<string, string>;
  overrideDescriptions: Map<string, string>;
  csvPermissions?: Map<string, string[]>;
}): Promise<{ apiKey: string; description: string; permissions: string[] }> {
  const apiKey = buildApiKey(args.moduleName, args.segments);

  const [fromSdk, fromSdkPerms] = await Promise.all([
    args.sdkDocStore.getDescription(args.moduleName, args.segments),
    args.sdkDocStore.getPermissions(args.moduleName, args.segments),
  ]);

  const fromCsv = args.csvDescriptions.get(apiKey);
  const fromOverride = args.overrideDescriptions.get(apiKey);
  const description =
    fromSdk ??
    fromCsv ??
    fromOverride ??
    `未提取到SDK注释；请在 input/csv/sdk_api_description_override.csv 补充该 API 描述（api=${apiKey}）`;

  const permissions = uniq([
    ...((args.csvPermissions?.get(apiKey) ?? []).map(String)),
    ...(fromSdkPerms ?? []),
  ])
    .map((p) => p.trim())
    .filter((p) => p.startsWith('ohos.permission.'))
    .sort((a, b) => a.localeCompare(b));

  return { apiKey, description, permissions };
}

async function resolveImportedSdkCall(args: {
  node: ts.CallExpression | ts.NewExpression;
  bindingsByLocalName: Map<string, BindingPair>;
  sdkDocStore: SdkDocStore;
}): Promise<ResolvedImportedCall | null> {
  const hit = extractImportedCallHit(args.node);
  if (!hit) return null;
  const pair = args.bindingsByLocalName.get(hit.localName);
  if (!pair) return null;

  const segments = await buildSegmentsForImportedHit({ sdkDocStore: args.sdkDocStore, binding: pair.resolved, hit });
  if (segments.length === 0) return null;
  const apiKey = buildApiKey(pair.resolved.module, segments);
  return { original: pair.original, resolved: pair.resolved, segments, apiKey };
}

async function inferInstanceTypeFromImportedCall(args: {
  sdkDocStore: SdkDocStore;
  importedCall: ResolvedImportedCall;
}): Promise<{ module: string; typeName: string } | null> {
  const returnTypes = await args.sdkDocStore.getReturnTypes(args.importedCall.resolved.module, args.importedCall.segments);
  const typeName = (returnTypes[0] ?? '').trim();
  if (!typeName) return null;
  return { module: args.importedCall.resolved.module, typeName };
}

function collectNodes(sf: ts.SourceFile): {
  callLikes: Array<ts.CallExpression | ts.NewExpression>;
  calls: ts.CallExpression[];
  varDecls: ts.VariableDeclaration[];
  assigns: ts.BinaryExpression[];
} {
  const callLikes: Array<ts.CallExpression | ts.NewExpression> = [];
  const calls: ts.CallExpression[] = [];
  const varDecls: ts.VariableDeclaration[] = [];
  const assigns: ts.BinaryExpression[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) varDecls.push(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assigns.push(node);
    if (ts.isCallExpression(node)) {
      callLikes.push(node);
      calls.push(node);
    } else if (ts.isNewExpression(node)) {
      callLikes.push(node);
    }
    node.forEachChild(walk);
  };
  walk(sf);
  return { callLikes, calls, varDecls, assigns };
}

export async function analyzeSinks(options: SinkAnalyzeOptions): Promise<SinkRecord[]> {
  const sdkDocStore = new SdkDocStore(options.sdkIndex);
  const records: SinkRecord[] = [];

  for (const filePath of options.appFiles) {
    const fileText = await fs.readFile(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const bindings = extractSdkImportBindings(sf);
    if (bindings.length === 0) continue;

    const bindingsByLocalName = new Map<string, BindingPair>();
    for (const b of bindings) {
      // Last import wins (common in TS tooling); keep stable behavior.
      const resolved = await resolveBindingViaKitReExport(options.sdkIndex, b);
      bindingsByLocalName.set(b.localName, { original: b, resolved });
    }
    if (bindingsByLocalName.size === 0) continue;

    const fileRel = toWorkspaceRelativePath(options.repoRoot, filePath);
    const nodes = collectNodes(sf);

    // Infer variable -> SDK instance type from simple assignments:
    //   const x = sdk.createX(...);
    //   x = sdk.createX(...);
    const varTypes = new Map<string, InstanceTypeInfo>();
    for (const decl of nodes.varDecls) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = unwrapExpression(decl.initializer);
      if (!isCallLike(init)) continue;

      const imported = await resolveImportedSdkCall({ node: init, bindingsByLocalName, sdkDocStore });
      if (!imported) continue;
      const inferred = await inferInstanceTypeFromImportedCall({ sdkDocStore, importedCall: imported });
      if (!inferred) continue;

      varTypes.set(decl.name.text, {
        module: inferred.module,
        typeName: inferred.typeName,
        importLine: imported.original.importLine,
        importCode: imported.original.importCode,
      });
    }
    for (const assign of nodes.assigns) {
      const left = unwrapExpression(assign.left);
      const right = unwrapExpression(assign.right);
      if (!ts.isIdentifier(left) || !isCallLike(right)) continue;

      const imported = await resolveImportedSdkCall({ node: right, bindingsByLocalName, sdkDocStore });
      if (!imported) continue;
      const inferred = await inferInstanceTypeFromImportedCall({ sdkDocStore, importedCall: imported });
      if (!inferred) continue;

      varTypes.set(left.text, {
        module: inferred.module,
        typeName: inferred.typeName,
        importLine: imported.original.importLine,
        importCode: imported.original.importCode,
      });
    }

    // (A) Imported SDK call sinks (direct / method / new).
    for (const n of nodes.callLikes) {
      const hit = extractImportedCallHit(n);
      if (!hit) continue;
      const pair = bindingsByLocalName.get(hit.localName);
      if (!pair) continue;

      const segments = await buildSegmentsForImportedHit({ sdkDocStore, binding: pair.resolved, hit });
      if (segments.length === 0) continue;

      const api = await buildApiInfo({
        sdkDocStore,
        moduleName: pair.resolved.module,
        segments,
        csvDescriptions: options.csvDescriptions,
        overrideDescriptions: options.overrideDescriptions,
        csvPermissions: options.csvPermissions,
      });

      const callLine = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const callCode = getLineTextAt(fileText, callLine);

      records.push({
        App源码文件路径: fileRel,
        导入行号: pair.original.importLine,
        导入代码: pair.original.importCode,
        调用行号: callLine,
        调用代码: callCode,
        API功能描述: api.description,
        __apiKey: api.apiKey,
        __module: pair.resolved.module,
        __permissions: api.permissions.length > 0 ? api.permissions : undefined,
      });
    }

    // (B) Instance method sinks:
    //   x.method(...) where x is a tracked SDK instance (from factory call),
    //   sdk.createX(...).method(...)
    const chainedInstanceCache = new Map<number, { module: string; typeName: string } | null>();
    for (const call of nodes.calls) {
      if (!isPropertyAccessLike(call.expression)) continue;
      const methodName = call.expression.name?.text ?? '';
      if (!methodName) continue;

      const base = unwrapExpression(call.expression.expression);

      // B1: x.method(...)
      if (ts.isIdentifier(base) && !bindingsByLocalName.has(base.text)) {
        const info = varTypes.get(base.text);
        if (!info) continue;

        const api = await buildApiInfo({
          sdkDocStore,
          moduleName: info.module,
          segments: [info.typeName, methodName],
          csvDescriptions: options.csvDescriptions,
          overrideDescriptions: options.overrideDescriptions,
          csvPermissions: options.csvPermissions,
        });

        const callLine = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
        const callCode = getLineTextAt(fileText, callLine);

        records.push({
          App源码文件路径: fileRel,
          导入行号: info.importLine,
          导入代码: info.importCode,
          调用行号: callLine,
          调用代码: callCode,
          API功能描述: api.description,
          __apiKey: api.apiKey,
          __module: info.module,
          __permissions: api.permissions.length > 0 ? api.permissions : undefined,
        });
        continue;
      }

      // B2: sdk.createX(...).method(...)
      if (isCallLike(base)) {
        const cached = chainedInstanceCache.has(base.pos) ? (chainedInstanceCache.get(base.pos) ?? null) : null;
        let inferred: { module: string; typeName: string } | null = cached;

        if (!chainedInstanceCache.has(base.pos)) {
          const imported = await resolveImportedSdkCall({ node: base, bindingsByLocalName, sdkDocStore });
          if (imported) inferred = await inferInstanceTypeFromImportedCall({ sdkDocStore, importedCall: imported });
          else inferred = null;
          chainedInstanceCache.set(base.pos, inferred);
        }

        if (!inferred) continue;

        // Try to use the same import line/code as the underlying SDK call (best-effort).
        const imported = await resolveImportedSdkCall({ node: base, bindingsByLocalName, sdkDocStore });
        const importLine = imported?.original.importLine ?? 0;
        const importCode = imported?.original.importCode ?? '';

        const api = await buildApiInfo({
          sdkDocStore,
          moduleName: inferred.module,
          segments: [inferred.typeName, methodName],
          csvDescriptions: options.csvDescriptions,
          overrideDescriptions: options.overrideDescriptions,
          csvPermissions: options.csvPermissions,
        });

        const callLine = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
        const callCode = getLineTextAt(fileText, callLine);

        records.push({
          App源码文件路径: fileRel,
          导入行号: importLine,
          导入代码: importCode,
          调用行号: callLine,
          调用代码: callCode,
          API功能描述: api.description,
          __apiKey: api.apiKey,
          __module: inferred.module,
          __permissions: api.permissions.length > 0 ? api.permissions : undefined,
        });
      }
    }
  }

  return records;
}

