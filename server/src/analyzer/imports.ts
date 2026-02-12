import ts from 'typescript';

import type { ImportBinding } from './types.js';

export function extractSdkImportBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const module = stmt.moduleSpecifier.text;
    if (!(module.startsWith('@ohos.') || module.startsWith('@kit.'))) continue;

    const line = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile)).line + 1;
    const importCode = stmt.getText(sourceFile).trim();

    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;

    // Default import: import foo from '@ohos.xxx'
    if (clause.name) {
      bindings.push({
        module,
        importKind: 'default',
        importedName: 'default',
        localName: clause.name.text,
        importLine: line,
        importCode,
      });
    }

    const namedBindings = clause.namedBindings;
    if (!namedBindings) continue;

    // Namespace import: import * as foo from '@ohos.xxx'
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.push({
        module,
        importKind: 'namespace',
        importedName: '*',
        localName: namedBindings.name.text,
        importLine: line,
        importCode,
      });
      continue;
    }

    // Named imports: import { a, b as c } from '@ohos.xxx'
    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        bindings.push({
          module,
          importKind: 'named',
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
          localName: el.name.text,
          importLine: line,
          importCode,
        });
      }
    }
  }

  return bindings;
}

