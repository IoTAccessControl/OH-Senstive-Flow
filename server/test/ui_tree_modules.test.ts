import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildUiTree } from '../src/analyzer/uiTree/buildUiTree.js';
import { buildModulesFromUiTree, groupDataflowsByModule } from '../src/analyzer/modules/buildModules.js';

describe('ui tree + modules', () => {
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

  it('groups dataflows by module using source API matching', async () => {
    const uiTree = {
      meta: {
        runId: 'test',
        generatedAt: new Date().toISOString(),
        counts: { nodes: 1, edges: 0, pages: 1, elements: 0 },
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
      },
      edges: [],
    } as any;

    const sources = [
      {
        App源码文件路径: 'app/entry/src/main/ets/pages/Index.ets',
        行号: 10,
        函数名称: 'build',
        描述: 'build entry',
      },
    ];

    const dataflows = {
      meta: {
        runId: 'test',
        generatedAt: new Date().toISOString(),
        llm: { provider: 'Qwen', model: 'qwen3-coder-plus' },
        counts: { flows: 1, nodes: 1, edges: 0 },
      },
      flows: [
        {
          flowId: 'flow:1',
          pathId: 'p1',
          nodes: [
            {
              id: 'n1',
              filePath: 'app/entry/src/main/ets/pages/Index.ets',
              line: 10,
              code: 'build() {',
              description: 'source',
              context: { startLine: 10, lines: ['build() {'] },
            },
          ],
          edges: [],
        },
      ],
    } as any;

    const builtModules = buildModulesFromUiTree({ uiTree, sources, maxDepth: 3 });
    const grouped = groupDataflowsByModule({ runId: 'test', dataflows, sources, modules: builtModules });

    expect(grouped.index.meta.counts.modules).toBe(1);
    expect(grouped.index.meta.counts.assignedFlows).toBe(1);
    expect(grouped.index.meta.counts.unassignedFlows).toBe(0);

    const moduleId = grouped.index.modules[0]!.moduleId;
    expect(grouped.moduleDataflows.get(moduleId)?.flows.length).toBe(1);
  });
});

