import fs from 'node:fs/promises';
import ts from 'typescript';

import type { ImportBindingKind, ResolvedBinding } from './types.js';
import type { SdkModuleIndex } from './sdkIndexer.js';

type ExportTarget = {
  module: string;
  importKind: ImportBindingKind;
  importedName: string;
};

const kitExportCache = new Map<string, Map<string, ExportTarget>>();

function toText(name: ts.Identifier | ts.StringLiteral | ts.Token<ts.SyntaxKind.DefaultKeyword>): string {
  // ExportSpecifier names are Identifiers; default re-exports may use DefaultKeyword token.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (name as any).text ?? name.getText();
}

function getImportKindFromClause(clause: ts.ImportClause): { kind: ImportBindingKind; nameText?: string } | undefined {
  if (clause.name) return { kind: 'default', nameText: clause.name.text };
  if (!clause.namedBindings) return undefined;
  if (ts.isNamespaceImport(clause.namedBindings)) return { kind: 'namespace', nameText: clause.namedBindings.name.text };
  return undefined;
}

async function parseKitExportsFromFile(kitFilePath: string): Promise<Map<string, ExportTarget>> {
  const text = await fs.readFile(kitFilePath, 'utf8');
  const sf = ts.createSourceFile(kitFilePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const importBindings = new Map<string, ExportTarget>();
  const exportMap = new Map<string, ExportTarget>();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const module = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;

    const direct = getImportKindFromClause(clause);
    if (direct && direct.nameText) {
      importBindings.set(direct.nameText, { module, importKind: direct.kind, importedName: direct.kind === 'default' ? 'default' : '*' });
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        const localName = el.name.text;
        const importedName = el.propertyName ? el.propertyName.text : el.name.text;
        importBindings.set(localName, { module, importKind: 'named', importedName });
      }
    }
  }

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;

    // export { a, b as c } from 'module'
    if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const module = stmt.moduleSpecifier.text;
      for (const el of stmt.exportClause.elements) {
        const exportedName = el.name.text;
        const importedName = el.propertyName ? toText(el.propertyName) : el.name.text;
        const importKind: ImportBindingKind = importedName === 'default' ? 'default' : 'named';
        exportMap.set(exportedName, { module, importKind, importedName: importedName === 'default' ? 'default' : importedName });
      }
      continue;
    }

    // export { local as exported }
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause) && !stmt.moduleSpecifier) {
      for (const el of stmt.exportClause.elements) {
        const exportedName = el.name.text;
        const localName = el.propertyName ? el.propertyName.text : el.name.text;
        const target = importBindings.get(localName);
        if (target) exportMap.set(exportedName, target);
      }
    }
  }

  return exportMap;
}

export async function resolveKitExportBinding(
  sdkIndex: SdkModuleIndex,
  kitModule: string,
  exportedName: string,
): Promise<ExportTarget | undefined> {
  if (!kitModule.startsWith('@kit.')) return undefined;
  const kitFile = sdkIndex.moduleToFile.get(kitModule);
  if (!kitFile) return undefined;

  let exportMap = kitExportCache.get(kitModule);
  if (!exportMap) {
    exportMap = await parseKitExportsFromFile(kitFile);
    kitExportCache.set(kitModule, exportMap);
  }
  return exportMap.get(exportedName);
}

export async function resolveBindingViaKitReExport(
  sdkIndex: SdkModuleIndex,
  binding: ResolvedBinding,
): Promise<ResolvedBinding> {
  if (!binding.module.startsWith('@kit.') || binding.importKind !== 'named') return binding;
  const target = await resolveKitExportBinding(sdkIndex, binding.module, binding.importedName);
  if (!target) return binding;
  return {
    ...binding,
    module: target.module,
    importKind: target.importKind,
    importedName: target.importedName,
    resolvedFromKit: binding.module,
  };
}

