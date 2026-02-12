import ts from 'typescript';

export type Token = {
  kind: ts.SyntaxKind;
  text: string;
  pos: number;
};

export function scanTokens(text: string): Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: Token[] = [];

  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      pos: scanner.getTokenPos(),
    });
    kind = scanner.scan();
  }

  return tokens;
}

