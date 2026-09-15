import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { forEachJsonArrayElement } from '../src/utils/jsonArrayStream.js';
import { parseCpgJson } from '../src/analyzer/cpg/parse.js';
import {
  COMMAND_LENGTH_BUDGET,
  CPG_MAIN_CLASS,
  buildCpgJavaArgs,
  cpgInstallDir,
  estimateCommandLength,
  resolveJavaExecutable,
  serializeArgFile,
  shouldUseArgFile,
} from '../src/analyzer/cpg/generate.js';

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpg-stream-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function writeTmpJson(content: unknown | string): Promise<string> {
  const dir = await makeTmpDir();
  const file = path.join(dir, 'data.json');
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return file;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('forEachJsonArrayElement', () => {
  it('parses every element of the requested arrays like JSON.parse', async () => {
    const payload = {
      nodes: [{ id: 1, labels: ['A'], properties: { x: 1 } }, { id: 2, labels: ['B'] }],
      edges: [{ type: 'AST', startNode: 1, endNode: 2 }],
      meta: { ignored: true },
    };
    const file = await writeTmpJson(payload);

    const nodes: unknown[] = [];
    const edges: unknown[] = [];
    await forEachJsonArrayElement(file, {
      nodes: (value, index) => nodes.push({ index, value }),
      edges: (value, index) => edges.push({ index, value }),
    });

    expect(nodes).toEqual([
      { index: 0, value: payload.nodes[0] },
      { index: 1, value: payload.nodes[1] },
    ]);
    expect(edges).toEqual([{ index: 0, value: payload.edges[0] }]);
  });

  it('handles braces, brackets, quotes, escapes and unicode inside strings', async () => {
    const tricky = {
      code: 'if (a[b] === "}{") { return `x${"y"}`; }',
      escaped: 'quote: \\" brace: { bracket: [ newline: \\n unicode: \\u4e2d\\u6587',
      nested: { deep: [{ a: [1, 2, { b: 3 }] }] },
      empty: {},
      list: [],
    };
    const payload = { nodes: [tricky, { code: 'second' }] };
    const file = await writeTmpJson(payload);

    const parsed: unknown[] = [];
    await forEachJsonArrayElement(file, { nodes: (value) => parsed.push(value) });

    expect(parsed).toEqual(payload.nodes);
  });

  it('ignores keys that are not requested, including strings equal to wanted keys', async () => {
    const payload = {
      ignored: { nodes: ['not-an-array-element'] },
      other: [[1, 2], { 'edges': 'x' }],
      weird: 'nodes',
      nodes: [{ id: 1 }],
    };
    const file = await writeTmpJson(payload);

    const nodes: unknown[] = [];
    await forEachJsonArrayElement(file, { nodes: (value) => nodes.push(value) });

    expect(nodes).toEqual([{ id: 1 }]);
  });

  it('handles empty arrays, missing keys and scalar arrays', async () => {
    const file = await writeTmpJson({ nodes: [], edges: [], numbers: [1, 2, 3] });

    const nodes: unknown[] = [];
    const edges: unknown[] = [];
    const numbers: unknown[] = [];
    await forEachJsonArrayElement(file, {
      nodes: (value) => nodes.push(value),
      edges: (value) => edges.push(value),
      numbers: (value) => numbers.push(value),
    });

    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('parses elements containing strings larger than the read chunk size', async () => {
    const longText = 'a\\"b{}[]'.repeat(400_000);
    const payload = { nodes: [{ code: longText }, { code: 'tail' }] };
    const file = await writeTmpJson(payload);

    const parsed: Array<{ code: string }> = [];
    await forEachJsonArrayElement(file, { nodes: (value) => parsed.push(value as { code: string }) });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.code).toBe(longText);
    expect(parsed[1]!.code).toBe('tail');
  });

  it('throws when the file is truncated or not a top-level object', async () => {
    const truncated = await writeTmpJson('{"nodes":[{"id":1},{"id":2}');
    await expect(forEachJsonArrayElement(truncated, { nodes: () => undefined })).rejects.toThrow(/不完整/u);

    const arrayRoot = await writeTmpJson('[{"id":1}]');
    await expect(forEachJsonArrayElement(arrayRoot, { nodes: () => undefined })).rejects.toThrow(/不完整/u);
  });
});

describe('cpg command length helpers', () => {
  it('estimates the command line length including the binary and separators', () => {
    expect(estimateCommandLength('bin', ['a', 'bb'])).toBe('bin'.length + 1 + 'a'.length + 1 + 'bb'.length + 1);
  });

  it('switches to an argument file only when over budget', () => {
    expect(shouldUseArgFile('java', ['--no-neo4j', '--export-json=out.json'])).toBe(false);

    const overBudgetArgs = ['--top-level=root', `--file=${'x'.repeat(COMMAND_LENGTH_BUDGET)}`];
    expect(shouldUseArgFile('java', overBudgetArgs)).toBe(true);
  });

  it('serializes tokens verbatim unless they contain whitespace or quotes', () => {
    const lines = serializeArgFile(['--no-neo4j', '--top-level=D:\\repo\\app', 'D:\\repo\\a.ets']);
    expect(lines).toBe('--no-neo4j\n--top-level=D:\\repo\\app\nD:\\repo\\a.ets\n');

    const quoted = serializeArgFile(['--top-level=C:\\Program Files\\app', 'plain']);
    expect(quoted).toBe('"--top-level=C:\\\\Program Files\\\\app"\nplain\n');
  });
});

describe('cpg java invocation', () => {
  it('resolves java from JAVA_HOME first, then falls back to PATH', () => {
    expect(resolveJavaExecutable('win32', { JAVA_HOME: 'C:\\jdk' })).toBe(path.join('C:\\jdk', 'bin', 'java.exe'));
    expect(resolveJavaExecutable('linux', { JAVA_HOME: '/usr/lib/jdk' })).toBe(path.join('/usr/lib/jdk', 'bin', 'java'));
    expect(resolveJavaExecutable('win32', {})).toBe('java');
    expect(resolveJavaExecutable('win32', { JAVA_HOME: '   ' })).toBe('java');
  });

  it('builds java args with the same JVM options, wildcard classpath and main class as the .bat', () => {
    const installDir = cpgInstallDir('D:\\repo');
    expect(installDir).toBe(path.join('D:\\repo', 'lib', 'cpg', 'cpg-neo4j', 'build', 'install', 'cpg-neo4j'));

    const args = buildCpgJavaArgs(installDir, ['--no-neo4j', 'a.ets'], {});
    expect(args).toEqual([
      '-Xss515m',
      '-Xmx8g',
      '-classpath',
      path.join(installDir, 'lib', '*'),
      CPG_MAIN_CLASS,
      '--no-neo4j',
      'a.ets',
    ]);
  });

  it('passes through JAVA_OPTS and CPG_NEO4J_OPTS like the .bat', () => {
    const args = buildCpgJavaArgs('D:\\install', [], { JAVA_OPTS: '-Xms512m', CPG_NEO4J_OPTS: '-Dfoo=bar' });
    expect(args.slice(0, 4)).toEqual(['-Xss515m', '-Xmx8g', '-Xms512m', '-Dfoo=bar']);
    expect(args).toContain('D:\\install\\lib\\*');
  });
});

describe('parseCpgJson with the streaming reader', () => {
  it('builds the same node/edge structures as before on a synthetic cpg.json', async () => {
    const repoRoot = await makeTmpDir();
    const appDir = path.join(repoRoot, 'input', 'app', 'demo');
    await fs.mkdir(path.join(appDir, 'entry'), { recursive: true });
    const fileAbs = path.join(appDir, 'entry', 'Index.ets');
    await fs.writeFile(fileAbs, 'function main() {}\n', 'utf8');
    const artifact = fileAbs.replaceAll('\\', '/');

    const cpg = {
      nodes: [
        { id: 1, labels: ['Node', 'AstNode', 'Function'], properties: { artifact, startLine: 1, endLine: 3, name: 'main', code: 'function main() {}' } },
        { id: 2, labels: ['Node', 'AstNode', 'Call'], properties: { artifact, startLine: 2, endLine: 2, name: 'doSink' } },
        { id: 3, labels: ['Node', 'ProblemDeclaration'], properties: { artifact, startLine: 4, endLine: 4 } },
        { id: 4, labels: ['Node', 'AstNode', 'Function'], properties: { artifact: 'D:/outside/other.ets', startLine: 1, endLine: 1 } },
      ],
      edges: [
        { type: 'AST', startNode: 1, endNode: 2 },
        { type: 'DFG', startNode: 1, endNode: 4 },
        { type: 'UNKNOWN', startNode: 1, endNode: 2 },
      ],
    };
    const cpgPath = path.join(repoRoot, 'cpg.json');
    await fs.writeFile(cpgPath, JSON.stringify(cpg), 'utf8');

    const parsed = await parseCpgJson({ repoRoot, appFiles: [fileAbs], cpgJsonPath: cpgPath });

    expect([...parsed.nodesById.keys()].sort()).toEqual([1, 2]);
    expect(parsed.functionNodes.map((node) => node.id)).toEqual([1]);
    expect(parsed.edgesByType.get('AST')).toEqual([{ type: 'AST', startNode: 1, endNode: 2 }]);
    expect(parsed.edgesByType.get('DFG')).toBeUndefined();
    expect(parsed.adjacency.get(1)).toEqual([{ type: 'AST', startNode: 1, endNode: 2 }]);
    const fileKey = Object.keys(Object.fromEntries(parsed.nodesByFile))[0]!;
    expect(parsed.nodesByFile.get(fileKey)!.map((node) => node.id).sort()).toEqual([1, 2]);
  });
});