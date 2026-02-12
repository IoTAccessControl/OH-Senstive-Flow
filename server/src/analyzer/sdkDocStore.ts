import fs from 'node:fs/promises';
import ts from 'typescript';

import type { SdkModuleIndex } from './sdkIndexer.js';

type DefaultExportKind = 'namespace' | 'class' | 'function' | 'unknown';

type ModuleCacheEntry = {
  sf: ts.SourceFile;
  text: string;
  defaultExportName?: string;
  defaultExportKind: DefaultExportKind;
};

function jsDocCommentToText(comment: ts.NodeArray<ts.JSDocComment> | string | undefined): string | undefined {
  if (!comment) return undefined;
  if (typeof comment === 'string') return comment.trim() || undefined;
  const combined = comment.map((p) => ('text' in p ? String(p.text) : '')).join('');
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
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) return stmt.expression.text;
    }
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
  if (ts.isClassDeclaration(container)) {
    for (const member of container.members) {
      if (!('name' in member) || !member.name) continue;
      if (ts.isIdentifier(member.name) && member.name.text === memberName) return member;
      if (ts.isStringLiteral(member.name) && member.name.text === memberName) return member;
    }
  }
  if (ts.isInterfaceDeclaration(container)) {
    for (const member of container.members) {
      if (!('name' in member) || !member.name) continue;
      if (ts.isIdentifier(member.name) && member.name.text === memberName) return member;
      if (ts.isStringLiteral(member.name) && member.name.text === memberName) return member;
    }
  }
  return undefined;
}

export class SdkDocStore {
  private readonly moduleCache = new Map<string, ModuleCacheEntry>();
  private readonly descriptionCache = new Map<string, string | undefined>();

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

  private findDescriptionInStatements(statements: readonly ts.Statement[], segments: string[]): string | undefined {
    if (segments.length === 0) return undefined;

    const [head, ...rest] = segments;
    if (segments.length === 1) {
      const decl = findContainerByName(statements, head);
      if (decl) return getBestJsDocSummary(decl);

      // Also allow looking for function declarations with this name inside namespaces.
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
}

