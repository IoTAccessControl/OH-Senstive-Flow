import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildUiTree } from '../src/analyzer/uiTree/buildUiTree.js';
import { groupDataflowsByPageFeature } from '../src/analyzer/pages/buildPageFeatureGroups.js';

describe('ui tree + page/feature grouping', () => {
  it('extracts UI nodes and router navigation edges', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-ui-'));
    const appRootAbs = path.join(repoRoot, 'app');
    const scanRootAbs = path.join(appRootAbs, 'entry', 'src', 'main', 'ets');
    await fs.mkdir(path.join(scanRootAbs, 'pages', 'chat'), { recursive: true });

    const indexFileAbs = path.join(scanRootAbs, 'pages', 'Index.ets');
    const chatFileAbs = path.join(scanRootAbs, 'pages', 'chat', 'ChatPage.ets');

    await fs.writeFile(
      indexFileAbs,
      [
        "import router from '@ohos.router';",
        '',
        '@Entry',
        '@Component',
        'struct Index {',
        '  build() {',
        '    Column() {',
        "      Button('Go').onClick(() => {",
        "        router.pushUrl({ url: 'pages/chat/ChatPage' })",
        '      })',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      chatFileAbs,
      [
        '@Entry',
        '@Component',
        'struct ChatPage {',
        '  build() {',
        '    Column() {',
        '      TextInput()',
        "      Text('hi')",
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const uiTree = await buildUiTree({
      repoRoot,
      runId: 'test',
      appRootAbs,
      appFiles: [indexFileAbs, chatFileAbs],
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      describeNodes: async (nodes) => new Map(nodes.map((n) => [n.id, `desc:${n.category}:${n.name ?? ''}`] as const)),
      contextRadiusLines: 2,
      maxNodesPerLlmBatch: 50,
    });

    expect(uiTree.meta.counts.pages).toBeGreaterThanOrEqual(2);
    expect(uiTree.edges.some((e) => e.kind === 'navigatesTo')).toBe(true);

    const navEdge = uiTree.edges.find((e) => e.kind === 'navigatesTo');
    expect(navEdge).toBeTruthy();
    const target = navEdge ? uiTree.nodes[navEdge.to] : null;
    expect(target?.category).toBe('Page');
    expect(target?.filePath).toContain('pages/chat/ChatPage.ets');
  });

  it('groups dataflows by page->feature (UI-first, fallback to source)', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-pages-'));
    await fs.mkdir(path.join(repoRoot, 'app', 'entry', 'src', 'main', 'ets', 'pages'), { recursive: true });
	    await fs.writeFile(
	      path.join(repoRoot, 'app', 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'),
	      [
	        '@Entry',
	        '@Component',
	        'struct Index {',
	        '  private x: number = 1',
	        '  private y: number = 2',
	        '  private z: number = 3',
	        '  private a: number = 4',
	        '  private b: number = 5',
	        '  private c: number = 6',
	        '  private d: number = 7',
	        '  private e: number = 8',
	        '  build() {',
	        '    Column() {',
	        "      Text('title')",
	        '      Blank()',
	        '      Blank()',
	        '      Blank()',
	        '      Blank()',
	        '      Blank()',
	        '      TextInput()',
	        '      this.onSearch()',
	        '    }',
	        '  }',
	        '  onSearch() {',
	        '    doSearch();',
	        '  }',
	        '}',
	        '',
	      ].join('\n'),
	      'utf8',
	    );

    const uiTree = {
      meta: {
        runId: 'test',
        generatedAt: new Date().toISOString(),
        counts: { nodes: 2, edges: 1, pages: 1, elements: 1 },
      },
      roots: ['page-root'],
      nodes: {
        'page-root': {
          id: 'page-root',
          category: 'Page',
          description: 'Index page',
          name: 'Index',
          filePath: 'app/entry/src/main/ets/pages/Index.ets',
          line: 1,
          code: 'struct Index {',
          context: { startLine: 1, lines: ['struct Index {'] },
        },
        'ui-1': {
          id: 'ui-1',
          category: 'Input',
          description: '搜索输入框',
          name: 'TextInput',
          filePath: 'app/entry/src/main/ets/pages/Index.ets',
          line: 20,
          code: 'TextInput()',
          context: { startLine: 20, lines: ['TextInput()'] },
        },
      },
      edges: [{ from: 'page-root', to: 'ui-1', kind: 'contains' }],
    } as any;

    const sources = [
      {
        App源码文件路径: 'app/entry/src/main/ets/pages/Index.ets',
        行号: 12,
        函数名称: 'build',
        描述: 'build entry',
      },
      {
        App源码文件路径: 'app/entry/src/main/ets/pages/Other.ets',
        行号: 5,
        函数名称: 'build',
        描述: 'build entry',
      },
    ];

    const dataflows = {
      meta: {
	        runId: 'test',
	        generatedAt: new Date().toISOString(),
	        llm: { provider: 'Qwen', model: 'qwen3-coder-plus' },
	        counts: { flows: 4, nodes: 7, edges: 3 },
	      },
	      flows: [
	        {
	          flowId: 'flow:ui',
	          pathId: 'p1',
          nodes: [
            {
              id: 'n1',
              filePath: 'app/entry/src/main/ets/pages/Index.ets',
              line: 12,
              code: 'build() {',
              description: 'source',
              context: { startLine: 12, lines: ['build() {'] },
            },
            {
              id: 'n2',
              filePath: 'app/entry/src/main/ets/pages/Index.ets',
              line: 20,
              code: 'TextInput()',
              description: 'ui',
              context: { startLine: 20, lines: ['TextInput()'] },
            },
          ],
	          edges: [{ from: 'n1', to: 'n2' }],
	        },
	        {
	          flowId: 'flow:src',
	          pathId: 'p2',
          nodes: [
            {
              id: 'm1',
              filePath: 'app/entry/src/main/ets/pages/Index.ets',
              line: 12,
              code: 'build() {',
              description: 'source',
              context: { startLine: 12, lines: ['build() {'] },
            },
            {
              id: 'm2',
              filePath: 'app/entry/src/main/ets/pages/Index.ets',
              line: 13,
              code: 'doWork();',
              description: 'work',
              context: { startLine: 13, lines: ['doWork();'] },
            },
          ],
	          edges: [{ from: 'm1', to: 'm2' }],
	        },
	        {
	          flowId: 'flow:handler',
	          pathId: 'p4',
	          nodes: [
	            {
	              id: 'h0',
	              filePath: 'app/entry/src/main/ets/pages/Index.ets',
	              line: 12,
	              code: 'build() {',
	              description: 'source',
	              context: { startLine: 12, lines: ['build() {'] },
	            },
	            {
	              id: 'h1',
	              filePath: 'app/entry/src/main/ets/pages/Index.ets',
	              line: 25,
	              code: 'doSearch();',
	              description: 'handler',
	              context: { startLine: 25, lines: ['doSearch();'] },
	            },
	          ],
	          edges: [{ from: 'h0', to: 'h1' }],
	        },
	        {
	          flowId: 'flow:unassigned',
	          pathId: 'p3',
	          nodes: [
            {
              id: 'u1',
              filePath: 'app/entry/src/main/ets/pages/Other.ets',
              line: 5,
              code: 'build() {',
              description: 'source',
              context: { startLine: 5, lines: ['build() {'] },
            },
          ],
          edges: [],
        },
      ],
    } as any;

    const grouped = await groupDataflowsByPageFeature({ runId: 'test', repoRoot, uiTree, sources, dataflows, maxUiDistanceLines: 30 });

    const indexPage = grouped.pages.find((p) => p.page.pageId !== '_unassigned');
    expect(indexPage).toBeTruthy();
    expect(indexPage?.uiTree).toBeTruthy();
    expect(indexPage?.featuresIndex.features.length).toBe(2);

    const uiFeature = indexPage?.featuresIndex.features.find((f) => f.kind === 'ui');
    const srcFeature = indexPage?.featuresIndex.features.find((f) => f.kind === 'source');
    expect(uiFeature).toBeTruthy();
    expect(srcFeature).toBeTruthy();

	    const uiDf = indexPage?.features.find((x) => x.feature.featureId === uiFeature?.featureId)?.dataflows;
	    const srcDf = indexPage?.features.find((x) => x.feature.featureId === srcFeature?.featureId)?.dataflows;
	    expect(uiDf?.flows.length).toBe(2);
	    expect(srcDf?.flows.length).toBe(1);

    const unassignedPage = grouped.pages.find((p) => p.page.pageId === '_unassigned');
    expect(unassignedPage).toBeTruthy();
    expect(unassignedPage?.uiTree).toBeNull();
    expect(unassignedPage?.features.reduce((acc, f) => acc + f.feature.counts.flows, 0)).toBe(1);
  });
});
