import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DefaultLlmUsageCollector,
  llmUsageStorage,
  withLlmUsageCollector,
  openAiCompatibleChat,
  type LlmUsageStats,
} from '../src/llm/client.js';
import { extractPaths, extractPathsWithStats } from '../src/analyzer/dataflow/paths.js';
import type { CallGraph } from '../src/analyzer/callgraph/types.js';
import { runAnalysis, type MetaJson, type AnalysisTiming } from '../src/analyzer/api.js';

describe('LlmUsageCollector', () => {
  it('initializes with all zero metrics', () => {
    const collector = new DefaultLlmUsageCollector();
    expect(collector.getStats()).toEqual({
      requestCount: 0,
      failedRequests: 0,
      totalMs: 0,
      requestMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it('records successful requests and aggregates tokens and time', () => {
    const collector = new DefaultLlmUsageCollector();
    collector.recordSuccess(150, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    collector.recordSuccess(250, { promptTokens: 200, completionTokens: 80 }); // totalTokens omitted, should sum

    const stats = collector.getStats();
    expect(stats.requestCount).toBe(2);
    expect(stats.failedRequests).toBe(0);
    expect(stats.totalMs).toBe(400);
    expect(stats.requestMs).toBe(400);
    expect(stats.inputTokens).toBe(300);
    expect(stats.outputTokens).toBe(130);
    expect(stats.totalTokens).toBe(430);
  });

  it('handles missing or invalid token counts without producing NaN', () => {
    const collector = new DefaultLlmUsageCollector();
    collector.recordSuccess(100, undefined);
    collector.recordSuccess(120, { promptTokens: undefined, completionTokens: undefined });

    const stats = collector.getStats();
    expect(stats.requestCount).toBe(2);
    expect(stats.failedRequests).toBe(0);
    expect(stats.totalMs).toBe(220);
    expect(stats.requestMs).toBe(220);
    expect(stats.inputTokens).toBe(0);
    expect(stats.outputTokens).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  it('separates concurrent wall-clock time from accumulated request time', async () => {
    const collector = new DefaultLlmUsageCollector();
    const run = (durationMs: number) => new Promise<void>((resolve) => {
      collector.startRequest();
      setTimeout(() => {
        collector.recordSuccess(durationMs);
        resolve();
      }, durationMs);
    });

    await Promise.all([run(20), run(20)]);
    const stats = collector.getStats();
    expect(stats.requestMs).toBeGreaterThanOrEqual(40);
    expect(stats.totalMs).toBeGreaterThanOrEqual(15);
    expect(stats.totalMs).toBeLessThan(stats.requestMs);
  });

  it('records failed requests properly', () => {
    const collector = new DefaultLlmUsageCollector();
    collector.recordSuccess(100, { promptTokens: 50, completionTokens: 20, totalTokens: 70 });
    collector.recordFailure(300);

    const stats = collector.getStats();
    expect(stats.requestCount).toBe(2);
    expect(stats.failedRequests).toBe(1);
    expect(stats.totalMs).toBe(400);
    expect(stats.requestMs).toBe(400);
    expect(stats.inputTokens).toBe(50);
    expect(stats.outputTokens).toBe(20);
    expect(stats.totalTokens).toBe(70);
  });

  it('collects metrics via withLlmUsageCollector and openAiCompatibleChat', async () => {
    const collector = new DefaultLlmUsageCollector();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"ok"}' } }],
          usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await withLlmUsageCollector(collector, async () => {
        const res = await openAiCompatibleChat({
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'test-model',
          messages: [{ role: 'user', content: 'hi' }],
        });
        expect(res.content).toBe('{"status":"ok"}');
      });

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(1);
      expect(stats.failedRequests).toBe(0);
      expect(stats.inputTokens).toBe(42);
      expect(stats.outputTokens).toBe(18);
      expect(stats.totalTokens).toBe(60);
      expect(stats.totalMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records failures when openAiCompatibleChat encounters errors', async () => {
    const collector = new DefaultLlmUsageCollector();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response('internal error', { status: 500 });
    }) as typeof fetch;

    try {
      await withLlmUsageCollector(collector, async () => {
        await expect(
          openAiCompatibleChat({
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            model: 'test-model',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        ).rejects.toThrow();
      });

      const stats = collector.getStats();
      expect(stats.requestCount).toBe(1);
      expect(stats.failedRequests).toBe(1);
      expect(stats.totalMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('extractPathsWithStats and truncation tracking', () => {
  const dummyCallGraph: CallGraph = {
    meta: {
      runId: 'test_run',
      generatedAt: new Date().toISOString(),
      counts: { nodes: 6, edges: 5, sources: 1, sinkCalls: 1, functions: 4 },
    },
    nodes: [
      { id: 'src1', type: 'source', filePath: 'a.ets', line: 1, code: '' },
      { id: 'f1', type: 'function', filePath: 'a.ets', line: 2, code: '' },
      { id: 'f2', type: 'function', filePath: 'a.ets', line: 3, code: '' },
      { id: 'f3', type: 'function', filePath: 'a.ets', line: 4, code: '' },
      { id: 'f4', type: 'function', filePath: 'a.ets', line: 5, code: '' },
      { id: 'sink1', type: 'sinkCall', filePath: 'a.ets', line: 6, code: '' },
    ],
    edges: [
      { from: 'src1', to: 'f1', kind: 'calls' },
      { from: 'f1', to: 'f2', kind: 'calls' },
      { from: 'f2', to: 'f3', kind: 'calls' },
      { from: 'f3', to: 'f4', kind: 'calls' },
      { from: 'f4', to: 'sink1', kind: 'calls' },
    ],
  };

  it('finds paths without truncation when limits are large', () => {
    const result = extractPathsWithStats({ callGraph: dummyCallGraph, maxPaths: 10, maxDepth: 60 });
    expect(result.paths.length).toBe(1);
    expect(result.truncation.pathBranches).toBe(0);
    expect(result.truncation.depthBranches).toBe(0);

    // backward compatibility: extractPaths returns the same path array
    const legacyPaths = extractPaths({ callGraph: dummyCallGraph, maxPaths: 10, maxDepth: 60 });
    expect(legacyPaths).toEqual(result.paths);
  });

  it('tracks truncation when maxDepth is exceeded', () => {
    // Path length from src1 to sink1 is 6 nodes (stack length > 3)
    const result = extractPathsWithStats({ callGraph: dummyCallGraph, maxPaths: 10, maxDepth: 3 });
    expect(result.paths.length).toBe(0);
    expect(result.truncation.depthBranches).toBeGreaterThan(0);
  });

  it('tracks truncation when maxPaths is exceeded', () => {
    // Multi-branch graph
    const branchingGraph: CallGraph = {
      meta: {
        runId: 'test_branch',
        generatedAt: new Date().toISOString(),
        counts: { nodes: 4, edges: 3, sources: 1, sinkCalls: 2, functions: 1 },
      },
      nodes: [
        { id: 'src1', type: 'source', filePath: 'a.ets', line: 1, code: '' },
        { id: 'f1', type: 'function', filePath: 'a.ets', line: 2, code: '' },
        { id: 'sink1', type: 'sinkCall', filePath: 'a.ets', line: 3, code: '' },
        { id: 'sink2', type: 'sinkCall', filePath: 'a.ets', line: 4, code: '' },
      ],
      edges: [
        { from: 'src1', to: 'f1', kind: 'calls' },
        { from: 'f1', to: 'sink1', kind: 'calls' },
        { from: 'f1', to: 'sink2', kind: 'calls' },
      ],
    };

    const result = extractPathsWithStats({ callGraph: branchingGraph, maxPaths: 1, maxDepth: 60 });
    expect(result.paths.length).toBe(1);
    expect(result.truncation.pathBranches).toBeGreaterThan(0);
  });
});

describe('meta.json timing structure and backward compatibility', () => {
  it('validates timing object format and stage properties', () => {
    const timing: AnalysisTiming = {
      totalMs: 123456,
      stages: {
        scan: 1200,
        sourceSink: 800,
        callgraph: 3500,
        cpgGenerate: 18000,
        cpgParse: 4200,
        dataflow: 76000,
        ui: 12000,
        report: 5000,
      },
      llm: {
        requestCount: 10,
        failedRequests: 1,
        totalMs: 70000,
        requestMs: 90000,
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
      },
      truncation: {
        pathBranches: 0,
        depthBranches: 0,
      },
    };

    expect(timing.totalMs).toBeGreaterThan(0);
    expect(Object.keys(timing.llm).sort()).toEqual([
      'failedRequests',
      'inputTokens',
      'outputTokens',
      'requestCount',
      'requestMs',
      'totalMs',
      'totalTokens',
    ]);
    expect(Object.keys(timing.truncation).sort()).toEqual(['depthBranches', 'pathBranches']);
    for (const [stage, ms] of Object.entries(timing.stages)) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(ms)).toBe(true);
    }
    for (const [key, val] of Object.entries(timing.llm)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
    for (const [key, val] of Object.entries(timing.truncation)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('ensures old meta.json without timing can be read without errors', () => {
    const oldMeta: MetaJson = {
      runId: 'old_run_20260101-000000',
      input: {
        appPath: 'input/app/demo',
        sdkPath: 'input/sdk/demo',
        csvDir: 'input/csv',
        maxDataflowPaths: null,
        graphBackend: 'heuristic',
        llmProvider: 'Qwen',
        llmModel: 'qwen',
        uiLlmProvider: 'Qwen',
        uiLlmModel: 'qwen',
        privacyReportLlmProvider: 'Qwen',
        privacyReportLlmModel: 'qwen',
      },
      scan: { appFiles: 5 },
      counts: {
        sinks: 1,
        sources: 1,
        callGraphNodes: 2,
        callGraphEdges: 1,
        dataflows: 1,
        dataflowNodes: 2,
        dataflowEdges: 1,
        dataflowFailedPaths: 0,
        dataflowFallbackFlows: 0,
        dataflowSkipped: false,
        uiTreeNodes: 0,
        uiTreeEdges: 0,
        pageCount: 1,
        pageFeatureCount: 1,
        pageFeatureUnassignedFlows: 0,
      },
    };

    expect(oldMeta.timing).toBeUndefined();
    // Default fallback
    const resolvedTiming: AnalysisTiming = oldMeta.timing ?? {
      totalMs: 0,
      stages: {
        scan: 0,
        sourceSink: 0,
        callgraph: 0,
        cpgGenerate: 0,
        cpgParse: 0,
        dataflow: 0,
        ui: 0,
        report: 0,
      },
      llm: {
        requestCount: 0,
        failedRequests: 0,
        totalMs: 0,
        requestMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      truncation: {
        pathBranches: 0,
        depthBranches: 0,
      },
    };
    expect(resolvedTiming.totalMs).toBe(0);
    expect(resolvedTiming.stages.scan).toBe(0);
  });

  it('runAnalysis creates meta.json with full timing object on disk', async () => {
    const REPO_ROOT = path.resolve(process.cwd(), '..');
    const tmpAppDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-test-app-'));
    const entryFile = path.join(tmpAppDir, 'entry.ets');
    await fs.writeFile(entryFile, 'export function main() {}\n', 'utf8');

    try {
      const response = await runAnalysis({
        repoRoot: REPO_ROOT,
        appPath: path.relative(REPO_ROOT, tmpAppDir).replaceAll('\\', '/'),
        sdkPath: 'input/sdk/default/openharmony/ets/',
        csvDir: 'input/csv/',
        maxDataflowPaths: 5,
        graphBackend: 'heuristic',
        llmApiKey: '', // no LLM API key
      });

      expect(response.timing).toBeDefined();
      expect(response.timing?.totalMs).toBeGreaterThanOrEqual(0);

      const metaPath = path.join(REPO_ROOT, response.outputDir, 'meta.json');
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf8')) as MetaJson;

      expect(metaContent.timing).toBeDefined();
      expect(metaContent.timing?.totalMs).toBeGreaterThanOrEqual(0);

      // Verify all required stages are present and integers
      expect(metaContent.timing?.stages.scan).toBeGreaterThanOrEqual(0);
      expect(metaContent.timing?.stages.sourceSink).toBeGreaterThanOrEqual(0);
      expect(metaContent.timing?.stages.callgraph).toBeGreaterThanOrEqual(0);
      expect(metaContent.timing?.stages.cpgGenerate).toBe(0);
      expect(metaContent.timing?.stages.cpgParse).toBe(0);
      expect(metaContent.timing?.stages.dataflow).toBeGreaterThanOrEqual(0);
      expect(metaContent.timing?.stages.ui).toBeGreaterThanOrEqual(0);
      expect(metaContent.timing?.stages.report).toBeGreaterThanOrEqual(0);

      // Verify LLM metrics (zero since no LLM was called)
      expect(metaContent.timing?.llm.requestCount).toBe(0);
      expect(metaContent.timing?.llm.failedRequests).toBe(0);
      expect(metaContent.timing?.llm.totalMs).toBe(0);
      expect(metaContent.timing?.llm.inputTokens).toBe(0);
      expect(metaContent.timing?.llm.outputTokens).toBe(0);
      expect(metaContent.timing?.llm.totalTokens).toBe(0);

      // Verify truncation metrics
      expect(metaContent.timing?.truncation.pathBranches).toBe(0);
      expect(metaContent.timing?.truncation.depthBranches).toBe(0);

      // Clean up test run output
      await fs.rm(path.join(REPO_ROOT, response.outputDir), { recursive: true, force: true });
    } finally {
      await fs.rm(tmpAppDir, { recursive: true, force: true });
    }
  });
});
