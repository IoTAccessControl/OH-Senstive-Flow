import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { walkFiles } from '../../utils/accessWorkspace.js';
import { extractPermissionNames, normalizePermissionToken } from './app.js';
import type { ImportBinding, ImportBindingKind, ResolvedBinding, SdkModuleIndex } from './types.js';

type ExportTarget = {
  module: string;
  importKind: ImportBindingKind;
  importedName: string;
};

type DefaultExportKind = 'namespace' | 'class' | 'function' | 'unknown';

type ModuleCacheEntry = {
  sf: ts.SourceFile;
  text: string;
  defaultExportName?: string;
  defaultExportKind: DefaultExportKind;
};

const kitExportCache = new Map<string, Map<string, ExportTarget>>();

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function jsDocCommentToText(comment: ts.NodeArray<ts.JSDocComment> | string | undefined): string | undefined {
  if (!comment) return undefined;
  if (typeof comment === 'string') return comment.trim() || undefined;
  const combined = comment.map((part) => ('text' in part ? String(part.text) : '')).join('');
  return combined.trim() || undefined;
}

function getBestJsDocSummary(node: ts.Node): string | undefined {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!docs || docs.length === 0) return undefined;
  for (const doc of docs) {
    const text = jsDocCommentToText(doc.comment);
    if (text) return text;
  }
  return undefined;
}

function findDefaultExportName(sf: ts.SourceFile): string | undefined {
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) return stmt.expression.text;
  }
  return undefined;
}

function findContainerByName(statements: readonly ts.Statement[], name: string): ts.Node | undefined {
  for (const stmt of statements) {
    if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name) && stmt.name.text === name) return stmt;
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt;
    if (ts.isEnumDeclaration(stmt) && stmt.name.text === name) return stmt;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) return stmt;
  }
  return undefined;
}

function getModuleBlockStatements(moduleDecl: ts.ModuleDeclaration): readonly ts.Statement[] {
  let current: ts.ModuleBody | undefined = moduleDecl.body;
  while (current && ts.isModuleDeclaration(current)) current = current.body;
  if (current && ts.isModuleBlock(current)) return current.statements;
  return [];
}

function descend(container: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isModuleDeclaration(container)) return getModuleBlockStatements(container);
  if (ts.isSourceFile(container)) return container.statements;
  return undefined;
}

function findMemberInClassOrInterface(container: ts.Node, memberName: string): ts.Node | undefined {
  if (ts.isClassDeclaration(container) || ts.isInterfaceDeclaration(container)) {
    for (const member of container.members) {
      if (!('name' in member) || !member.name) continue;
      if (ts.isIdentifier(member.name) && member.name.text === memberName) return member;
      if (ts.isStringLiteral(member.name) && member.name.text === memberName) return member;
    }
  }
  return undefined;
}

function extractPermissionsFromJsDoc(node: ts.Node): string[] {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (!docs || docs.length === 0) return [];
  const out: string[] = [];
  for (const doc of docs) {
    const tags = doc.tags;
    if (!tags || tags.length === 0) continue;
    for (const tag of tags) {
      const tagName = tag.tagName?.text ?? '';
      if (tagName !== 'permission') continue;
      const commentText = jsDocCommentToText((tag as { comment?: ts.NodeArray<ts.JSDocComment> | string }).comment);
      if (!commentText) continue;
      for (const permission of extractPermissionNames(commentText)) out.push(normalizePermissionToken(permission));
    }
  }
  return uniq(out.filter((item) => item.startsWith('ohos.permission.')));
}

function typeNameText(typeName: ts.EntityName): string {
  if (ts.isIdentifier(typeName)) return typeName.text;
  return typeNameText(typeName.right);
}

function extractReturnTypeNames(typeNode: ts.TypeNode): string[] {
  if (ts.isParenthesizedTypeNode(typeNode)) return extractReturnTypeNames(typeNode.type);
  if (ts.isUnionTypeNode(typeNode)) return uniq(typeNode.types.flatMap(extractReturnTypeNames));
  if (ts.isIntersectionTypeNode(typeNode)) return uniq(typeNode.types.flatMap(extractReturnTypeNames));
  if (ts.isArrayTypeNode(typeNode)) return extractReturnTypeNames(typeNode.elementType);
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNameText(typeNode.typeName);
    const wrappers = new Set([
      'Promise',
      'Array',
      'ReadonlyArray',
      'AsyncCallback',
      'Callback',
      'Record',
      'Partial',
      'Required',
      'Pick',
      'Omit',
      'Map',
      'Set',
    ]);
    if (wrappers.has(name) && typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      return uniq(typeNode.typeArguments.flatMap(extractReturnTypeNames));
    }
    return name ? [name] : [];
  }
  return [];
}

function toText(name: ts.Identifier | ts.StringLiteral | ts.Token<ts.SyntaxKind.DefaultKeyword>): string {
  return (name as { text?: string }).text ?? name.getText();
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
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const module = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;

    const direct = getImportKindFromClause(clause);
    if (direct && direct.nameText) {
      importBindings.set(direct.nameText, {
        module,
        importKind: direct.kind,
        importedName: direct.kind === 'default' ? 'default' : '*',
      });
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

    if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const module = stmt.moduleSpecifier.text;
      for (const el of stmt.exportClause.elements) {
        const exportedName = el.name.text;
        const importedName = el.propertyName ? toText(el.propertyName) : el.name.text;
        const importKind: ImportBindingKind = importedName === 'default' ? 'default' : 'named';
        exportMap.set(exportedName, {
          module,
          importKind,
          importedName: importedName === 'default' ? 'default' : importedName,
        });
      }
      continue;
    }

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

export async function buildSdkModuleIndex(sdkRootPath: string): Promise<SdkModuleIndex> {
  const moduleToFile = new Map<string, string>();
  const files = await walkFiles(sdkRootPath, {
    extensions: ['.d.ts', '.d.ets'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'out', 'dist'],
  });

  for (const filePath of files) {
    const base = path.basename(filePath);
    if (!(base.startsWith('@ohos.') || base.startsWith('@kit.'))) continue;
    const moduleName = base.replace(/(\.d\.ets|\.d\.ts)$/u, '');
    const existing = moduleToFile.get(moduleName);
    if (!existing) {
      moduleToFile.set(moduleName, filePath);
      continue;
    }

    const existingIsDts = existing.endsWith('.d.ts');
    const currentIsDts = filePath.endsWith('.d.ts');
    if (currentIsDts && !existingIsDts) moduleToFile.set(moduleName, filePath);
  }

  return { moduleToFile };
}

export function extractSdkImportBindings(sourceFile: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const module = stmt.moduleSpecifier.text;
    if (!(module.startsWith('@ohos.') || module.startsWith('@kit.'))) continue;

    const line = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile)).line + 1;
    const importCode = stmt.getText(sourceFile).trim();
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;

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

export async function resolveBindingViaKitReExport(sdkIndex: SdkModuleIndex, binding: ResolvedBinding): Promise<ResolvedBinding> {
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

export class SdkDocStore {
  private readonly moduleCache = new Map<string, ModuleCacheEntry>();
  private readonly descriptionCache = new Map<string, string | undefined>();
  private readonly permissionCache = new Map<string, string[]>();
  private readonly returnTypeCache = new Map<string, string[]>();

  public constructor(private readonly sdkIndex: SdkModuleIndex) {}

  private async loadModule(moduleName: string): Promise<ModuleCacheEntry | undefined> {
    const cached = this.moduleCache.get(moduleName);
    if (cached) return cached;
    const filePath = this.sdkIndex.moduleToFile.get(moduleName);
    if (!filePath) return undefined;
    const text = await fs.readFile(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const defaultExportName = findDefaultExportName(sf);
    let defaultExportKind: DefaultExportKind = 'unknown';
    if (defaultExportName) {
      const decl = findContainerByName(sf.statements, defaultExportName);
      if (decl && ts.isModuleDeclaration(decl)) defaultExportKind = 'namespace';
      else if (decl && ts.isClassDeclaration(decl)) defaultExportKind = 'class';
      else if (decl && ts.isFunctionDeclaration(decl)) defaultExportKind = 'function';
    }

    const entry: ModuleCacheEntry = { sf, text, defaultExportName, defaultExportKind };
    this.moduleCache.set(moduleName, entry);
    return entry;
  }

  public async getDefaultExportKind(moduleName: string): Promise<DefaultExportKind> {
    const mod = await this.loadModule(moduleName);
    return mod?.defaultExportKind ?? 'unknown';
  }

  public async getDescription(moduleName: string, segments: string[]): Promise<string | undefined> {
    const key = `${moduleName}::${segments.join('.')}`;
    if (this.descriptionCache.has(key)) return this.descriptionCache.get(key);

    const mod = await this.loadModule(moduleName);
    if (!mod) {
      this.descriptionCache.set(key, undefined);
      return undefined;
    }

    const { sf, defaultExportName } = mod;
    const rootStatements = defaultExportName
      ? (() => {
          const container = findContainerByName(sf.statements, defaultExportName);
          if (container && ts.isModuleDeclaration(container)) return getModuleBlockStatements(container);
          return sf.statements;
        })()
      : sf.statements;

    const desc = this.findDescriptionInStatements(rootStatements, segments);
    this.descriptionCache.set(key, desc);
    return desc;
  }

  public async getPermissions(moduleName: string, segments: string[]): Promise<string[]> {
    const key = `${moduleName}::${segments.join('.')}`;
    if (this.permissionCache.has(key)) return this.permissionCache.get(key) ?? [];

    const mod = await this.loadModule(moduleName);
    if (!mod) {
      this.permissionCache.set(key, []);
      return [];
    }

    const { sf, defaultExportName } = mod;
    const rootStatements = defaultExportName
      ? (() => {
          const container = findContainerByName(sf.statements, defaultExportName);
          if (container && ts.isModuleDeclaration(container)) return getModuleBlockStatements(container);
          return sf.statements;
        })()
      : sf.statements;

    const node = this.findNodeInStatements(rootStatements, segments);
    if (!node) {
      this.permissionCache.set(key, []);
      return [];
    }

    const permissions = extractPermissionsFromJsDoc(node);
    this.permissionCache.set(key, permissions);
    return permissions;
  }

  public async getReturnTypes(moduleName: string, segments: string[]): Promise<string[]> {
    const key = `${moduleName}::${segments.join('.')}`;
    if (this.returnTypeCache.has(key)) return this.returnTypeCache.get(key) ?? [];

    const mod = await this.loadModule(moduleName);
    if (!mod) {
      this.returnTypeCache.set(key, []);
      return [];
    }

    const { sf, defaultExportName } = mod;
    const rootStatements = defaultExportName
      ? (() => {
          const container = findContainerByName(sf.statements, defaultExportName);
          if (container && ts.isModuleDeclaration(container)) return getModuleBlockStatements(container);
          return sf.statements;
        })()
      : sf.statements;

    const node = this.findNodeInStatements(rootStatements, segments);
    if (!node) {
      this.returnTypeCache.set(key, []);
      return [];
    }

    const typeNode = (node as { type?: ts.TypeNode }).type;
    if (!typeNode) {
      this.returnTypeCache.set(key, []);
      return [];
    }

    const types = uniq(extractReturnTypeNames(typeNode)).filter(Boolean);
    this.returnTypeCache.set(key, types);
    return types;
  }

  private findDescriptionInStatements(statements: readonly ts.Statement[], segments: string[]): string | undefined {
    if (segments.length === 0) return undefined;

    const [head, ...rest] = segments;
    if (segments.length === 1) {
      const decl = findContainerByName(statements, head);
      if (decl) return getBestJsDocSummary(decl);

      for (const stmt of statements) {
        if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
          const inner = getModuleBlockStatements(stmt);
          const innerDecl = findContainerByName(inner, head);
          if (innerDecl) return getBestJsDocSummary(innerDecl);
        }
      }

      return undefined;
    }

    const container = findContainerByName(statements, head);
    if (!container) return undefined;

    if (rest.length === 1) {
      const memberName = rest[0];
      const member = findMemberInClassOrInterface(container, memberName);
      if (member) return getBestJsDocSummary(member) ?? getBestJsDocSummary(container);

      if (ts.isModuleDeclaration(container)) {
        const innerStatements = getModuleBlockStatements(container);
        const innerDecl = findContainerByName(innerStatements, memberName);
        if (innerDecl) return getBestJsDocSummary(innerDecl) ?? getBestJsDocSummary(container);
      }
      return getBestJsDocSummary(container);
    }

    const innerStatements = descend(container);
    if (!innerStatements) return getBestJsDocSummary(container);
    return this.findDescriptionInStatements(innerStatements, rest) ?? getBestJsDocSummary(container);
  }

  private findNodeInStatements(statements: readonly ts.Statement[], segments: string[]): ts.Node | undefined {
    if (segments.length === 0) return undefined;

    const [head, ...rest] = segments;
    if (segments.length === 1) {
      const decl = findContainerByName(statements, head);
      if (decl) return decl;

      for (const stmt of statements) {
        if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
          const inner = getModuleBlockStatements(stmt);
          const innerDecl = findContainerByName(inner, head);
          if (innerDecl) return innerDecl;
        }
      }

      return undefined;
    }

    const container = findContainerByName(statements, head);
    if (!container) return undefined;

    if (rest.length === 1) {
      const memberName = rest[0] ?? '';
      if (!memberName) return container;
      const member = findMemberInClassOrInterface(container, memberName);
      if (member) return member;

      if (ts.isModuleDeclaration(container)) {
        const innerStatements = getModuleBlockStatements(container);
        const innerDecl = findContainerByName(innerStatements, memberName);
        if (innerDecl) return innerDecl;
      }

      return container;
    }

    const innerStatements = descend(container);
    if (!innerStatements) return container;
    return this.findNodeInStatements(innerStatements, rest) ?? container;
  }
}
