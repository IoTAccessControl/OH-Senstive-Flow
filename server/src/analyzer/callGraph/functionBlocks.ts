import ts from 'typescript';

import { buildLineStarts, findMatchingDelimiter, findNextNonWhitespace, lineNumberAt } from '../shared/textScan.js';

export type FunctionBlock = {
  name: string;
  signaturePos: number;
  startLine: number; // 1-based
  endLine: number; // 1-based, line containing closing brace
  bodyStartPos: number; // position of "{"
  bodyEndPos: number; // position of matching "}"
};

const METHOD_NAME_BLACKLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'instanceof',
  'new',
  'delete',
]);

type Candidate = {
  name: string;
  signaturePos: number;
  openParenPos: number;
  kind: 'function' | 'method' | 'arrowAssign';
};

function findFunctionBodyOpenBrace(text: string, afterCloseParenPos: number, kind: Candidate['kind']): number | null {
  const significantStart = findNextNonWhitespace(text, afterCloseParenPos + 1);
  if (significantStart === null) return null;
  let pos = significantStart;
  const significant = text.slice(pos, Math.min(text.length, pos + 400));

  if (kind === 'arrowAssign') {
    const arrowOffset = significant.indexOf('=>');
    if (arrowOffset < 0) return null;
    const afterArrow = findNextNonWhitespace(text, pos + arrowOffset + 2);
    return afterArrow !== null && text[afterArrow] === '{' ? afterArrow : null;
  }

  if (text[pos] === '{') return pos;
  if (text[pos] !== ':') return null;

  for (let i = pos + 1; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (ch === '{') {
      const typeClose = findMatchingDelimiter(text, i, '{', '}');
      if (typeClose !== null) {
        const nextBrace = findNextNonWhitespace(text, typeClose + 1);
        if (nextBrace !== null && text[nextBrace] === '{') return nextBrace;
      }
      return i;
    }
    if (ch === ';' || ch === '=') return null;
  }

  return null;
}

function addCandidateFromRegex(matches: Candidate[], fileText: string, lineStarts: number[], regex: RegExp, kind: Candidate['kind']): void {
  let match: RegExpExecArray | null = regex.exec(fileText);
  while (match) {
    const name = match[1] ?? '';
    if (name && !METHOD_NAME_BLACKLIST.has(name)) {
      const nameOffset = match[0].indexOf(name);
      const signaturePos = (match.index ?? 0) + Math.max(0, nameOffset);
      const openParenPos = fileText.indexOf('(', signaturePos + name.length);
      if (openParenPos > signaturePos) {
        const startLine = lineNumberAt(lineStarts, signaturePos);
        const lineText = fileText.slice(lineStarts[startLine - 1] ?? 0, lineStarts[startLine] ?? fileText.length);
        if (!lineText.trimStart().startsWith('//')) {
          matches.push({ name, signaturePos, openParenPos, kind });
        }
      }
    }
    match = regex.exec(fileText);
  }
}

export function scanFunctionBlocks(fileText: string, sourceFile: ts.SourceFile): FunctionBlock[] {
  const lineStarts = buildLineStarts(fileText);
  const candidates: Candidate[] = [];
  const blocks: FunctionBlock[] = [];

  addCandidateFromRegex(candidates, fileText, lineStarts, /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu, 'function');
  addCandidateFromRegex(
    candidates,
    fileText,
    lineStarts,
    /^\s*(?:const|let|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/gmu,
    'arrowAssign',
  );
  addCandidateFromRegex(
    candidates,
    fileText,
    lineStarts,
    /^\s*(?:(?:public|private|protected|async|static|readonly|abstract|override)\s+)*([A-Za-z_][A-Za-z0-9_]*|constructor)\s*(?:<[^>\n]+>)?\s*\(/gmu,
    'method',
  );

  const seen = new Set<string>();
  for (const candidate of candidates.sort((a, b) => a.signaturePos - b.signaturePos || a.name.localeCompare(b.name))) {
    const closeParenPos = findMatchingDelimiter(fileText, candidate.openParenPos, '(', ')');
    if (closeParenPos === null) continue;
    const bodyStartPos = findFunctionBodyOpenBrace(fileText, closeParenPos, candidate.kind);
    if (bodyStartPos === null || fileText[bodyStartPos] !== '{') continue;
    const bodyEndPos = findMatchingDelimiter(fileText, bodyStartPos, '{', '}');
    if (bodyEndPos === null) continue;

    const startLine = sourceFile.getLineAndCharacterOfPosition(candidate.signaturePos).line + 1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(bodyEndPos).line + 1;
    const dedupeKey = `${candidate.name}:${startLine}:${bodyStartPos}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    blocks.push({
      name: candidate.name,
      signaturePos: candidate.signaturePos,
      startLine,
      endLine,
      bodyStartPos,
      bodyEndPos,
    });
  }

  return blocks;
}
