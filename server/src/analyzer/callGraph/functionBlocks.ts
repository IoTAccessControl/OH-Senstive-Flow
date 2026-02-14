import ts from 'typescript';

import { scanTokens, type Token } from '../tokenScanner.js';

export type FunctionBlock = {
  name: string;
  signaturePos: number;
  startLine: number; // 1-based
  endLine: number; // 1-based, line containing closing brace
  bodyStartPos: number; // position of "{"
  bodyEndPos: number; // position of matching "}"
};

function isMethodModifier(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PublicKeyword ||
    kind === ts.SyntaxKind.PrivateKeyword ||
    kind === ts.SyntaxKind.ProtectedKeyword ||
    kind === ts.SyntaxKind.AsyncKeyword ||
    kind === ts.SyntaxKind.StaticKeyword ||
    kind === ts.SyntaxKind.ReadonlyKeyword ||
    kind === ts.SyntaxKind.AbstractKeyword ||
    kind === ts.SyntaxKind.OverrideKeyword
  );
}

function findMatchingParen(tokens: Token[], openParenIndex: number): number | null {
  let depth = 0;
  for (let i = openParenIndex; i < tokens.length; i += 1) {
    const k = tokens[i]?.kind;
    if (k === ts.SyntaxKind.OpenParenToken) depth += 1;
    else if (k === ts.SyntaxKind.CloseParenToken) depth -= 1;
    if (depth === 0) return i;
  }
  return null;
}

function findMatchingBrace(tokens: Token[], openBraceIndex: number): number | null {
  let depth = 0;
  for (let i = openBraceIndex; i < tokens.length; i += 1) {
    const k = tokens[i]?.kind;
    if (k === ts.SyntaxKind.OpenBraceToken) depth += 1;
    else if (k === ts.SyntaxKind.CloseBraceToken) depth -= 1;
    if (depth === 0) return i;
  }
  return null;
}

function tokenStartsModifierSequence(tokens: Token[], index: number): boolean {
  const t = tokens[index];
  if (!t) return false;
  if (!isMethodModifier(t.kind)) return false;
  const prev = tokens[index - 1];
  return !prev || !isMethodModifier(prev.kind);
}

function tokenIsStandaloneNameCandidate(tokens: Token[], index: number): boolean {
  const t = tokens[index];
  if (!t) return false;
  if (t.kind !== ts.SyntaxKind.Identifier && t.kind !== ts.SyntaxKind.ConstructorKeyword) return false;
  const prev = tokens[index - 1];
  return !prev || !isMethodModifier(prev.kind);
}

export function scanFunctionBlocks(fileText: string, sourceFile: ts.SourceFile): FunctionBlock[] {
  const tokens = scanTokens(fileText);
  const blocks: FunctionBlock[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;

    // function foo(...) { ... }
    if (t.kind === ts.SyntaxKind.FunctionKeyword) {
      const nameTok = tokens[i + 1];
      const openParen = tokens[i + 2];
      if (nameTok?.kind !== ts.SyntaxKind.Identifier) continue;
      if (openParen?.kind !== ts.SyntaxKind.OpenParenToken) continue;

      const closeParenIndex = findMatchingParen(tokens, i + 2);
      if (closeParenIndex === null) continue;
      const openBraceIndex = closeParenIndex + 1;
      if (tokens[openBraceIndex]?.kind !== ts.SyntaxKind.OpenBraceToken) continue;
      const closeBraceIndex = findMatchingBrace(tokens, openBraceIndex);
      if (closeBraceIndex === null) continue;

      const startLine = sourceFile.getLineAndCharacterOfPosition(nameTok.pos).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(tokens[closeBraceIndex]!.pos).line + 1;

      blocks.push({
        name: nameTok.text,
        signaturePos: nameTok.pos,
        startLine,
        endLine,
        bodyStartPos: tokens[openBraceIndex]!.pos,
        bodyEndPos: tokens[closeBraceIndex]!.pos,
      });
      continue;
    }

    // foo = async (...) => { ... } / foo = (...) => { ... }
    // (Used frequently in ArkTS/ArkUI event handlers: onPress = async (e) => { ... })
    if (t.kind === ts.SyntaxKind.Identifier && tokens[i + 1]?.kind === ts.SyntaxKind.EqualsToken) {
      const nameTok = t;
      let j = i + 2;
      if (tokens[j]?.kind === ts.SyntaxKind.AsyncKeyword) j += 1;
      if (tokens[j]?.kind !== ts.SyntaxKind.OpenParenToken) continue;

      const closeParenIndex = findMatchingParen(tokens, j);
      if (closeParenIndex === null) continue;
      const arrowIndex = closeParenIndex + 1;
      if (tokens[arrowIndex]?.kind !== ts.SyntaxKind.EqualsGreaterThanToken) continue;
      const openBraceIndex = arrowIndex + 1;
      if (tokens[openBraceIndex]?.kind !== ts.SyntaxKind.OpenBraceToken) continue;

      const closeBraceIndex = findMatchingBrace(tokens, openBraceIndex);
      if (closeBraceIndex === null) continue;

      const startLine = sourceFile.getLineAndCharacterOfPosition(nameTok.pos).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(tokens[closeBraceIndex]!.pos).line + 1;

      blocks.push({
        name: nameTok.text,
        signaturePos: nameTok.pos,
        startLine,
        endLine,
        bodyStartPos: tokens[openBraceIndex]!.pos,
        bodyEndPos: tokens[closeBraceIndex]!.pos,
      });

      // Jump forward a bit to avoid duplicate detections on the same signature.
      i = openBraceIndex;
      continue;
    }

    // async foo(...) { ... } / public foo(...) { ... } / foo(...) { ... }
    if (!tokenStartsModifierSequence(tokens, i) && !tokenIsStandaloneNameCandidate(tokens, i)) continue;

    let j = i;
    while (tokens[j] && isMethodModifier(tokens[j]!.kind)) j += 1;
    const nameTok = tokens[j];
    const openParen = tokens[j + 1];
    if (!nameTok || !openParen) continue;
    if (nameTok.kind !== ts.SyntaxKind.Identifier && nameTok.kind !== ts.SyntaxKind.ConstructorKeyword) continue;
    if (openParen.kind !== ts.SyntaxKind.OpenParenToken) continue;

    const closeParenIndex = findMatchingParen(tokens, j + 1);
    if (closeParenIndex === null) continue;
    const openBraceIndex = closeParenIndex + 1;
    if (tokens[openBraceIndex]?.kind !== ts.SyntaxKind.OpenBraceToken) continue;
    const closeBraceIndex = findMatchingBrace(tokens, openBraceIndex);
    if (closeBraceIndex === null) continue;

    const name = nameTok.kind === ts.SyntaxKind.ConstructorKeyword ? 'constructor' : nameTok.text;
    const startLine = sourceFile.getLineAndCharacterOfPosition(nameTok.pos).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(tokens[closeBraceIndex]!.pos).line + 1;

    blocks.push({
      name,
      signaturePos: nameTok.pos,
      startLine,
      endLine,
      bodyStartPos: tokens[openBraceIndex]!.pos,
      bodyEndPos: tokens[closeBraceIndex]!.pos,
    });

    // Jump forward a bit to avoid duplicate detections on the same signature.
    i = openBraceIndex;
  }

  return blocks;
}
