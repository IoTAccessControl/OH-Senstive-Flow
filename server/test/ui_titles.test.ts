import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildUiTree } from '../src/analyzer/uiTree/buildUiTree.js';

describe('ui tree titles (heuristics)', () => {
  it('generates human-readable page/feature titles without UI LLM', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-titles-'));
    const appRootAbs = path.join(repoRoot, 'app');
    const scanRootAbs = path.join(appRootAbs, 'entry', 'src', 'main', 'ets');
    await fs.mkdir(path.join(scanRootAbs, 'pages', 'chat'), { recursive: true });

    const chatFileAbs = path.join(scanRootAbs, 'pages', 'chat', 'ChatPage.ets');
    await fs.writeFile(
      chatFileAbs,
      [
        '@Entry',
        '@Component',
        'export default struct ChatPage {',
        '  onPressTalk() {',
        '    // record voice',
        '  }',
        '  sendTextMsg() {}',
        '  build() {',
        '    Column() {',
        '      Button("按住 说话")',
        '        .onTouch(this.onPressTalk)',
        '      Text("发送")',
        '        .onClick(() => { this.sendTextMsg() })',
        '      TextInput({ placeholder: "搜索" })',
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
      appFiles: [chatFileAbs],
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      contextRadiusLines: 2,
      maxNodesPerLlmBatch: 50,
    });

    const pages = Object.values(uiTree.nodes).filter((n) => n.category === 'Page');
    expect(pages.length).toBeGreaterThanOrEqual(1);

    const chatPage = pages.find((p) => (p.filePath ?? '').includes('pages/chat/ChatPage.ets'));
    expect(chatPage).toBeTruthy();
    expect(chatPage?.description).toContain('聊天');
    expect(chatPage?.description).toMatch(/(页|页面)$/u);

    const elementTitles = Object.values(uiTree.nodes)
      .filter((n) => n.category !== 'Page')
      .map((n) => n.description);

    expect(elementTitles.some((t) => t.includes('发送'))).toBe(true);
    expect(elementTitles.some((t) => t.includes('说话') || t.includes('语音'))).toBe(true);
    expect(elementTitles.some((t) => t.includes('搜索'))).toBe(true);

    for (const n of Object.values(uiTree.nodes)) {
      expect(n.description.trim()).toBeTruthy();
      expect(n.description).not.toMatch(/\b(Button|TextInput|TextArea|struct|ChatPage)\b/u);
    }
  });
});
