import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildSdkModuleIndex, resolveKitExportBinding, SdkDocStore } from '../src/analyzer/extract/sdk.js';
import { analyzeSinks } from '../src/analyzer/extract/sinks.js';
import { analyzeSources } from '../src/analyzer/extract/sources.js';
import { buildCallGraph } from '../src/analyzer/callgraph/build.js';
import { scanFunctionBlocks } from '../src/analyzer/callgraph/functionBlocks.js';
import { extractPaths } from '../src/analyzer/dataflow/paths.js';
import { buildDataflows } from '../src/analyzer/dataflow/build.js';
import { scanAppArkTsFiles } from '../src/analyzer/extract/app.js';

const REPO_ROOT = path.resolve(process.cwd(), '..');
const SDK_ROOT = path.join(REPO_ROOT, 'input/sdk/default/openharmony/ets');

describe('sdk docs', () => {
  it('extracts JSDoc for @ohos.router.pushUrl', async () => {
    const sdkIndex = await buildSdkModuleIndex(SDK_ROOT);
    const store = new SdkDocStore(sdkIndex);
    const desc = await store.getDescription('@ohos.router', ['pushUrl']);
    expect(desc).toBeTruthy();
    expect(desc).toContain('Navigates to a specified page');
  });

  it('resolves @kit.AudioKit audio -> @ohos.multimedia.audio', async () => {
    const sdkIndex = await buildSdkModuleIndex(SDK_ROOT);
    const resolved = await resolveKitExportBinding(sdkIndex, '@kit.AudioKit', 'audio');
    expect(resolved).toBeTruthy();
    expect(resolved?.module).toBe('@ohos.multimedia.audio');
  });
});

describe('app analysis', () => {
  it('finds sink call router.pushUrl()', async () => {
    const sdkIndex = await buildSdkModuleIndex(SDK_ROOT);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-'));
    const filePath = path.join(tmpDir, 'sample.ets');
    await fs.writeFile(
      filePath,
      [
        "import router from '@ohos.router';",
        '',
        'function f() {',
        "  router.pushUrl({ url: 'pages/a' });",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const sinks = await analyzeSinks({
      repoRoot: REPO_ROOT,
      appFiles: [filePath],
      sdkIndex,
      csvDescriptions: new Map(),
      overrideDescriptions: new Map(),
    });

    expect(sinks.length).toBeGreaterThan(0);
    expect(sinks.some((r) => r.__apiKey === '@ohos.router.pushUrl')).toBe(true);
    expect(sinks.find((r) => r.__apiKey === '@ohos.router.pushUrl')?.['API功能描述']).toContain('Navigates');
  });

  it('finds source function build() definition', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-'));
    const filePath = path.join(tmpDir, 'ui.ets');
    await fs.writeFile(
      filePath,
      [
        '@Entry',
        '@Component',
        'struct Index {',
        '  build() {',
        '    Text("hi")',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const sources = await analyzeSources(REPO_ROOT, [filePath]);
    expect(sources.some((r) => r['函数名称'] === 'build')).toBe(true);
  });
});

describe('callgraph + paths', () => {
  it('builds a source->sink call path and extracts paths', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-repo-'));
    const filePath = path.join(repoRoot, 'main.ets');
    const code = [
      "import router from '@ohos.router';",
      '',
      '@Entry',
      '@Component',
      'struct Index {',
      '  build() {',
      '    this.step1();',
      '  }',
      '',
      '  step1() {',
      '    step2();',
      '  }',
      '}',
      '',
      'function step2() {',
      '  doSink();',
      '}',
      '',
      'function doSink() {',
      "  router.pushUrl({ url: 'pages/a' });",
      '}',
      '',
    ].join('\n');
    await fs.writeFile(filePath, code, 'utf8');

    const appFiles = [filePath];
    const sources = await analyzeSources(repoRoot, appFiles);
    const sinkLine = code.split('\n').findIndex((l) => l.includes('router.pushUrl')) + 1;
    expect(sinkLine).toBeGreaterThan(0);

    const sinks = [
      {
        App源码文件路径: 'main.ets',
        导入行号: 1,
        导入代码: "import router from '@ohos.router';",
        调用行号: sinkLine,
        调用代码: "router.pushUrl({ url: 'pages/a' });",
        API功能描述: 'test sink',
        __apiKey: '@ohos.router.pushUrl',
        __module: '@ohos.router',
      },
    ];

    const callGraph = await buildCallGraph({ repoRoot, runId: 'test', appFiles, sinks, sources });
    expect(callGraph.nodes.some((n) => n.type === 'sinkCall')).toBe(true);
    expect(callGraph.nodes.some((n) => n.type === 'source')).toBe(true);

    const paths = extractPaths({ callGraph, maxPaths: 5 });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]!.nodeIds.length).toBeGreaterThan(1);
  });

  it('skips dataflow analysis when api-key is empty', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-repo-'));
    const filePath = path.join(repoRoot, 'a.ets');
    await fs.writeFile(filePath, ['function build() {', '  doSink();', '}', 'function doSink() {', '  x();', '}'].join('\n'), 'utf8');

    const sources = [{ App源码文件路径: 'a.ets', 行号: 1, 函数名称: 'build', 描述: 'test source' }];
    const sinks = [
      {
        App源码文件路径: 'a.ets',
        导入行号: 1,
        导入代码: '',
        调用行号: 5,
        调用代码: 'x();',
        API功能描述: 'test sink',
      },
    ];

    const callGraph = await buildCallGraph({ repoRoot, runId: 'test', appFiles: [filePath], sinks: sinks as any, sources });
    const paths = extractPaths({ callGraph, maxPaths: 3 });

    const result = await buildDataflows({
      repoRoot,
      runId: 'test',
      appFiles: [filePath],
      callGraph,
      paths,
      sinks: sinks as any,
      sources,
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-coder-plus' },
      contextRadiusLines: 5,
    });

    expect(result.meta.skipped).toBe(true);
    expect(result.flows.length).toBe(0);
  });

  it('detects struct methods below template strings and class methods with return types', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-blocks-'));
    const filePath = path.join(tmpDir, 'sample.ets');
    const code = [
      '@Entry',
      '@Component',
      'struct Index {',
      '  requestPaymentCallBack() {',
      '    console.error(`failed to pay, error.code: ${error.code}, error.message: ${error.message}`);',
      '  }',
      '',
      '  build() {',
      "    Button('go').onClick(() => {",
      '      this.requestPaymentCallBack();',
      '    })',
      '  }',
      '}',
      '',
      'class Helper {',
      '  static async shareIntent(context: unknown): Promise<string> {',
      "    return 'ok';",
      '  }',
      '}',
      '',
    ].join('\n');
    await fs.writeFile(filePath, code, 'utf8');

    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const blocks = scanFunctionBlocks(code, sf);

    expect(blocks.some((b) => b.name === 'build')).toBe(true);
    expect(blocks.some((b) => b.name === 'requestPaymentCallBack')).toBe(true);
    expect(blocks.some((b) => b.name === 'shareIntent')).toBe(true);
  });

  it('builds a path through onClick callback to an instance method sink', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-repo-'));
    const filePath = path.join(repoRoot, 'pay.ets');
    const code = [
      "import { prompt } from '@kit.ArkUI';",
      '',
      '@Entry',
      '@Component',
      'struct Index {',
      '  pay() {',
      '    console.error(`failed to pay, error.code: ${error.code}, error.message: ${error.message}`);',
      "    prompt.showToast({ message: 'ok' });",
      '  }',
      '',
      '  build() {',
      "    Button('go').onClick(() => {",
      '      this.pay();',
      '    })',
      '  }',
      '}',
      '',
    ].join('\n');
    await fs.writeFile(filePath, code, 'utf8');

    const appFiles = [filePath];
    const sources = await analyzeSources(repoRoot, appFiles);
    const sinks = [
      {
        App源码文件路径: 'pay.ets',
        导入行号: 1,
        导入代码: "import { prompt } from '@kit.ArkUI';",
        调用行号: 8,
        调用代码: "prompt.showToast({ message: 'ok' });",
        API功能描述: 'toast',
        __apiKey: '@ohos.prompt.showToast',
        __module: '@ohos.prompt',
      },
    ];

    const callGraph = await buildCallGraph({ repoRoot, runId: 'test', appFiles, sinks: sinks as any, sources });
    const paths = extractPaths({ callGraph, maxPaths: 5 });

    expect(callGraph.nodes.some((n) => n.type === 'source' && n.name === 'build')).toBe(true);
    expect(callGraph.nodes.some((n) => n.type === 'function' && n.name === 'pay')).toBe(true);
    expect(callGraph.nodes.some((n) => n.type === 'sinkCall')).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('builds a path through static helper methods with return type annotations', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-repo-'));
    const filePath = path.join(repoRoot, 'helper.ets');
    const code = [
      "import router from '@ohos.router';",
      '',
      'class Helper {',
      '  static async shareIntent(): Promise<string> {',
      "    router.pushUrl({ url: 'pages/a' });",
      "    return 'ok';",
      '  }',
      '}',
      '',
      '@Entry',
      '@Component',
      'struct Index {',
      '  build() {',
      "    Button('go').onClick(async () => {",
      '      await Helper.shareIntent();',
      '    })',
      '  }',
      '}',
      '',
    ].join('\n');
    await fs.writeFile(filePath, code, 'utf8');

    const appFiles = [filePath];
    const sources = await analyzeSources(repoRoot, appFiles);
    const sinks = [
      {
        App源码文件路径: 'helper.ets',
        导入行号: 1,
        导入代码: "import router from '@ohos.router';",
        调用行号: 5,
        调用代码: "router.pushUrl({ url: 'pages/a' });",
        API功能描述: 'test sink',
        __apiKey: '@ohos.router.pushUrl',
        __module: '@ohos.router',
      },
    ];

    const callGraph = await buildCallGraph({ repoRoot, runId: 'test', appFiles, sinks: sinks as any, sources });
    const paths = extractPaths({ callGraph, maxPaths: 5 });

    expect(callGraph.nodes.some((n) => n.type === 'function' && n.name === 'shareIntent')).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('app scanner fallbacks', () => {
  it('falls back to generated build cache files when src/main/ets is missing', async () => {
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-app-'));
    const generatedFile = path.join(
      appRoot,
      'entry',
      'build',
      'default',
      'cache',
      'default',
      'default@CompileArkTS',
      'esmodule',
      'debug',
      'entry',
      'src',
      'main',
      'ets',
      'pages',
      'Index.ts',
    );
    await fs.mkdir(path.dirname(generatedFile), { recursive: true });
    await fs.writeFile(generatedFile, 'export default function demo() {}', 'utf8');

    const files = await scanAppArkTsFiles(appRoot);
    expect(files).toContain(generatedFile);
  });
});
