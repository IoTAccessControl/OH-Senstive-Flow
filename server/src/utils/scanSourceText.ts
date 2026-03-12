export function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

export function lineNumberAt(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid]! <= pos) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(1, lo);
}

export function findNextNonWhitespace(text: string, startPos: number): number | null {
  for (let i = Math.max(0, startPos); i < text.length; i += 1) {
    if (!/\s/u.test(text[i] ?? '')) return i;
  }
  return null;
}

function isEscaped(text: string, pos: number): boolean {
  let slashCount = 0;
  for (let i = pos - 1; i >= 0 && text[i] === '\\'; i -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

export function findMatchingDelimiter(text: string, openPos: number, openChar: string, closeChar: string): number | null {
  if (openPos < 0 || openPos >= text.length) return null;
  if (text[openPos] !== openChar) return null;

  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;

  for (let i = openPos; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'" && !isEscaped(text, i)) inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && !isEscaped(text, i)) inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`' && !isEscaped(text, i)) inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === openChar) depth += 1;
    else if (ch === closeChar) depth -= 1;

    if (depth === 0) return i;
  }

  return null;
}
