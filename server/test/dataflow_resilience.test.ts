import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockChat } = vi.hoisted(() => ({
  mockChat: vi.fn(),
}));

vi.mock('../src/llm/client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/llm/client.js')>('../src/llm/client.js');
  return {
    ...actual,
    openAiCompatibleChat: mockChat,
  };
});

import { LlmNetworkError } from '../src/llm/client.js';
import { buildDataflows } from '../src/analyzer/dataflow/build.js';
import type { CallGraph } from '../src/analyzer/callgraph/types.js';
import type { SinkRecord, SourceRecord } from '../src/analyzer/extract/types.js';

async function makeRepoFile(lines: string[]): Promise<{ repoRoot: string; filePath: string; fileRel: string }> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-dataflow-'));
  const filePath = path.join(repoRoot, 'main.ets');
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { repoRoot, filePath, fileRel: 'main.ets' };
}

beforeEach(() => {
  mockChat.mockReset();
});

describe('buildDataflows resilience', () => {
  it('retries transient LLM failures and still returns dataflows on the first run', async () => {
    const { repoRoot, filePath, fileRel } = await makeRepoFile([
      'function build() {',
      '  doSink();',
      '}',
      'function doSink() {',
      '  router.pushUrl({ url: "pages/a" });',
      '}',
    ]);

    const callGraph: CallGraph = {
      meta: { runId: 'run1', generatedAt: new Date().toISOString(), counts: { nodes: 2, edges: 1, sources: 1, sinkCalls: 1, functions: 0 } },
      nodes: [
        { id: 'src1', type: 'source', filePath: fileRel, line: 1, code: 'function build() {', name: 'build', description: 'source' },
        { id: 'sink1', type: 'sinkCall', filePath: fileRel, line: 5, code: 'router.pushUrl({ url: "pages/a" });', name: '@ohos.router.pushUrl', description: 'sink' },
      ],
      edges: [{ from: 'src1', to: 'sink1', kind: 'containsSink' }],
    };

    const sinks: SinkRecord[] = [
      {
        App源码文件路径: fileRel,
        导入行号: 1,
        导入代码: "import router from '@ohos.router';",
        调用行号: 5,
        调用代码: 'router.pushUrl({ url: "pages/a" });',
        API功能描述: '页面跳转',
        __apiKey: '@ohos.router.pushUrl',
        __module: '@ohos.router',
      },
    ];
    const sources: SourceRecord[] = [{ App源码文件路径: fileRel, 行号: 1, 函数名称: 'build', 描述: 'source' }];

    mockChat
      .mockRejectedValueOnce(new LlmNetworkError('temporary network issue'))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          nodes: [
            { filePath: fileRel, line: 1, description: '进入 build' },
            { filePath: fileRel, line: 5, description: '调用页面跳转 API' },
          ],
          edges: [{ from: 0, to: 1 }],
        }),
        raw: {},
      });

    const result = await buildDataflows({
      repoRoot,
      runId: 'run1',
      appFiles: [filePath],
      callGraph,
      paths: [{ pathId: 'p1', nodeIds: ['src1', 'sink1'], sourceId: 'src1', sinkCallId: 'sink1' }],
      sinks,
      sources,
      llm: { provider: 'OpenAI', apiKey: 'test-key', model: 'gpt-4.1-mini' },
      contextRadiusLines: 2,
    });

    expect(result.meta.skipped).not.toBe(true);
    expect(result.meta.counts.flows).toBe(1);
    expect(result.meta.counts.failedPaths).toBe(0);
    expect(result.meta.counts.fallbackFlows).toBe(0);
    expect(result.meta.warnings).toBeUndefined();
    expect(result.flows[0]?.meta?.fallback).not.toBe(true);
    expect(result.flows[0]?.nodes.length).toBeGreaterThan(0);
  });

  it('falls back per failed path instead of emptying the whole result set', async () => {
    const { repoRoot, filePath, fileRel } = await makeRepoFile([
      'function build1() {',
      '  doSink1();',
      '}',
      'function doSink1() {',
      '  router.pushUrl({ url: "pages/a" });',
      '}',
      'function build2() {',
      '  doSink2();',
      '}',
      'function doSink2() {',
      '  router.replaceUrl({ url: "pages/b" });',
      '}',
    ]);

    const callGraph: CallGraph = {
      meta: { runId: 'run2', generatedAt: new Date().toISOString(), counts: { nodes: 4, edges: 2, sources: 2, sinkCalls: 2, functions: 0 } },
      nodes: [
        { id: 'src1', type: 'source', filePath: fileRel, line: 1, code: 'function build1() {', name: 'build1', description: 'source1' },
        { id: 'sink1', type: 'sinkCall', filePath: fileRel, line: 5, code: 'router.pushUrl({ url: "pages/a" });', name: '@ohos.router.pushUrl', description: 'sink1' },
        { id: 'src2', type: 'source', filePath: fileRel, line: 7, code: 'function build2() {', name: 'build2', description: 'source2' },
        { id: 'sink2', type: 'sinkCall', filePath: fileRel, line: 11, code: 'router.replaceUrl({ url: "pages/b" });', name: '@ohos.router.replaceUrl', description: 'sink2' },
      ],
      edges: [
        { from: 'src1', to: 'sink1', kind: 'containsSink' },
        { from: 'src2', to: 'sink2', kind: 'containsSink' },
      ],
    };

    const sinks: SinkRecord[] = [
      {
        App源码文件路径: fileRel,
        导入行号: 1,
        导入代码: "import router from '@ohos.router';",
        调用行号: 5,
        调用代码: 'router.pushUrl({ url: "pages/a" });',
        API功能描述: '页面跳转',
        __apiKey: '@ohos.router.pushUrl',
        __module: '@ohos.router',
      },
      {
        App源码文件路径: fileRel,
        导入行号: 1,
        导入代码: "import router from '@ohos.router';",
        调用行号: 11,
        调用代码: 'router.replaceUrl({ url: "pages/b" });',
        API功能描述: '页面替换跳转',
        __apiKey: '@ohos.router.replaceUrl',
        __module: '@ohos.router',
      },
    ];
    const sources: SourceRecord[] = [
      { App源码文件路径: fileRel, 行号: 1, 函数名称: 'build1', 描述: 'source1' },
      { App源码文件路径: fileRel, 行号: 7, 函数名称: 'build2', 描述: 'source2' },
    ];

    mockChat
      .mockRejectedValueOnce(new LlmNetworkError('temporary network issue 1'))
      .mockRejectedValueOnce(new LlmNetworkError('temporary network issue 2'))
      .mockRejectedValueOnce(new LlmNetworkError('temporary network issue 3'))
      .mockResolvedValueOnce({
        content: JSON.stringify({
          nodes: [
            { filePath: fileRel, line: 7, description: '进入 build2' },
            { filePath: fileRel, line: 11, description: '调用 replaceUrl' },
          ],
          edges: [{ from: 0, to: 1 }],
        }),
        raw: {},
      });

    const result = await buildDataflows({
      repoRoot,
      runId: 'run2',
      appFiles: [filePath],
      callGraph,
      paths: [
        { pathId: 'p1', nodeIds: ['src1', 'sink1'], sourceId: 'src1', sinkCallId: 'sink1' },
        { pathId: 'p2', nodeIds: ['src2', 'sink2'], sourceId: 'src2', sinkCallId: 'sink2' },
      ],
      sinks,
      sources,
      llm: { provider: 'OpenAI', apiKey: 'test-key', model: 'gpt-4.1-mini' },
      contextRadiusLines: 2,
    });

    expect(result.meta.counts.flows).toBe(2);
    expect(result.meta.counts.failedPaths).toBe(1);
    expect(result.meta.counts.fallbackFlows).toBe(1);
    expect(result.meta.warnings?.length).toBe(1);
    expect(result.flows.some((flow) => flow.meta?.fallback)).toBe(true);
    expect(result.flows.every((flow) => flow.nodes.length > 0)).toBe(true);
  });
});
