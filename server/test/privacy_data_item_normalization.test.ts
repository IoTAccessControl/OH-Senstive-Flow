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

import {
  applyDataItemNormalization,
  buildNormalizationArtifact,
  buildNormalizationPrompt,
  collectUnmatchedDataItemCandidates,
  normalizeDataItemNames,
  parseNormalizationDecisions,
  type DataItemCandidate,
  type DataItemVocabularyEntry,
} from '../src/analyzer/privacy/normalizeDataItems.js';
import { loadPrivacyRules } from '../src/analyzer/extract/csv.js';
import { generatePrivacyReportArtifacts } from '../src/analyzer/privacy/report.js';
import type { FeaturePrivacyFactsContent } from '../src/analyzer/privacy/types.js';
import type { DataflowsResult } from '../src/analyzer/dataflow/types.js';

const llm = { provider: 'OpenAI', apiKey: 'test-key', model: 'qwen-test', baseUrl: 'https://api.example.com/v1' };

const vocabulary: DataItemVocabularyEntry[] = [
  { name: '头像图片', definition: '用户头像图片本身' },
  { name: '位置信息', definition: '地理位置（经纬度、行政区、定位结果）' },
];

function dataflowsFixture(): DataflowsResult {
  return {
    meta: { runId: 'r', generatedAt: '', counts: { flows: 1, nodes: 1, edges: 0 } },
    flows: [
      {
        flowId: 'flow1',
        pathId: 'p1',
        nodes: [{ id: 'n1', filePath: 'a.ets', line: 12, code: 'this.userIcon = avatar', description: '', context: '' }],
        edges: [],
        summary: '',
      },
    ],
  } as unknown as DataflowsResult;
}

function factsWith(items: Array<{ name: string; refs?: Array<{ flowId: string; nodeId: string }> }>): FeaturePrivacyFactsContent {
  return {
    dataPractices: [
      {
        businessScenario: '用户查看头像',
        dataSources: ['相册'],
        dataItems: items.map((item) => ({ name: item.name, refs: item.refs ?? [] })),
        processingMethod: '读取',
        storageMethod: '内存',
        dataRecipients: [],
        processingPurpose: '展示',
      },
    ],
    permissionPractices: [],
  } as FeaturePrivacyFactsContent;
}

beforeEach(() => {
  mockChat.mockReset();
});

describe('loadPrivacyRules definitions', () => {
  it('carries the rule column as definition for data_item rows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-def-'));
    try {
      await fs.writeFile(
        path.join(dir, 'privacy_rules.csv'),
        [
          'type,keywords,outputName,rule',
          'data_item,authCode|授权码,授权码,OAuth 一次性授权码',
          'data_item,oaid,匿名设备标识符,',
          'description_rule,,,业务场景应具体',
        ].join('\n'),
        'utf8',
      );
      const rules = await loadPrivacyRules(dir);
      expect(rules.dataItems[0]).toEqual({ keywords: ['authCode', '授权码'], outputName: '授权码', definition: 'OAuth 一次性授权码' });
      expect(rules.dataItems[1]!.definition).toBeUndefined();
      expect(rules.descriptionRules).toEqual(['业务场景应具体']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('collectUnmatchedDataItemCandidates', () => {
  it('dedupes, skips canonical names and resolves evidence from dataflow refs', () => {
    const candidates = collectUnmatchedDataItemCandidates(
      [
        {
          facts: factsWith([
            { name: 'userIcon', refs: [{ flowId: 'flow1', nodeId: 'n1' }] },
            { name: '头像图片' },
            { name: '  ' },
          ]),
          dataflows: dataflowsFixture(),
        },
        { facts: factsWith([{ name: 'userIcon' }]), dataflows: dataflowsFixture() },
      ],
      new Set(['头像图片']),
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('userIcon');
    expect(candidates[0]!.scenario).toBe('用户查看头像');
    expect(candidates[0]!.evidence).toEqual(['a.ets:12 this.userIcon = avatar']);
  });

  it('caps evidence at two entries per candidate', () => {
    const flows = dataflowsFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstFlow: any = flows.flows[0];
    firstFlow.nodes = [
      { id: 'n1', filePath: 'a.ets', line: 1, code: 'one' },
      { id: 'n2', filePath: 'a.ets', line: 2, code: 'two' },
      { id: 'n3', filePath: 'a.ets', line: 3, code: 'three' },
    ];
    const candidates = collectUnmatchedDataItemCandidates(
      [
        {
          facts: factsWith([
            { name: 'x', refs: [{ flowId: 'flow1', nodeId: 'n1' }, { flowId: 'flow1', nodeId: 'n2' }, { flowId: 'flow1', nodeId: 'n3' }] },
          ]),
          dataflows: flows,
        },
      ],
      new Set(),
    );
    expect(candidates[0]!.evidence).toHaveLength(2);
  });
});

describe('buildNormalizationPrompt', () => {
  it('contains app name, definitions, evidence and the anti-generalization rules', () => {
    const candidates: DataItemCandidate[] = [
      { name: 'userIcon', scenario: '用户查看头像', evidence: ['a.ets:12 this.userIcon = avatar'] },
    ];
    const prompt = buildNormalizationPrompt('TestApp', vocabulary, candidates);
    expect(prompt).toContain('应用：TestApp');
    expect(prompt).toContain('1. 头像图片：用户头像图片本身');
    expect(prompt).toContain('a.ets:12 this.userIcon = avatar');
    expect(prompt).toContain('"userIcon"');
    expect(prompt).toContain('泛化');
    expect(prompt).toContain('复合名');
    expect(prompt).toContain('null');
  });
});

describe('parseNormalizationDecisions', () => {
  const vocab = new Set(['头像图片', '位置信息']);

  it('keeps in-vocabulary decisions and nulls unknown canonical values', () => {
    const decisions = parseNormalizationDecisions(
      {
        decisions: [
          { name: 'userIcon', canonical: '头像图片', reason: '证据显示读取头像文件' },
          { name: 'loc', canonical: '地理位置', reason: '词表外名称' },
        ],
      },
      ['userIcon', 'loc', 'missing'],
      vocab,
    );
    expect(decisions).toEqual([
      { name: 'userIcon', canonical: '头像图片', reason: '证据显示读取头像文件' },
      { name: 'loc', canonical: null, reason: '词表外名称' },
      { name: 'missing', canonical: null, reason: '模型未返回该候选的判定' },
    ]);
  });

  it('accepts a bare array, ignores extras and malformed entries', () => {
    const decisions = parseNormalizationDecisions(
      [42, { canonical: '头像图片' }, { name: 'extra', canonical: '头像图片' }, { name: 'userIcon', canonical: '头像图片', reason: 'ok' }],
      ['userIcon'],
      vocab,
    );
    expect(decisions).toEqual([{ name: 'userIcon', canonical: '头像图片', reason: 'ok' }]);
  });

  it('returns all-null decisions for garbage responses', () => {
    const decisions = parseNormalizationDecisions('not json', ['a', 'b'], vocab);
    expect(decisions.every((d) => d.canonical === null)).toBe(true);
    expect(decisions).toHaveLength(2);
  });
});

describe('normalizeDataItemNames', () => {
  const candidates: DataItemCandidate[] = [
    { name: 'contactUs', scenario: '点击按钮', evidence: [] },
    { name: 'userIcon', scenario: '查看头像', evidence: ['a.ets:12 avatar'] },
  ];

  it('builds the mapping from a successful batch response', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        decisions: [
          { name: 'contactUs', canonical: null, reason: '按钮行为' },
          { name: 'userIcon', canonical: '头像图片', reason: '证据显示读取头像' },
        ],
      }),
      raw: {},
    });

    const result = await normalizeDataItemNames({ appName: 'TestApp', candidates, vocabulary, llm });

    expect(result.mapping.get('userIcon')).toBe('头像图片');
    expect(result.mapping.has('contactUs')).toBe(false);
    expect(result.decisions).toHaveLength(2);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('keeps original names when the request fails', async () => {
    mockChat.mockRejectedValue(new Error('boom'));

    const result = await normalizeDataItemNames({ appName: 'TestApp', candidates, vocabulary, llm });

    expect(result.mapping.size).toBe(0);
    expect(result.decisions.every((d) => d.canonical === null && d.reason === '归一请求失败')).toBe(true);
  });

  it('skips the LLM entirely when there are no candidates', async () => {
    const result = await normalizeDataItemNames({ appName: 'TestApp', candidates: [], vocabulary, llm });
    expect(result.decisions).toEqual([]);
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe('applyDataItemNormalization / buildNormalizationArtifact', () => {
  it('replaces only mapped names and returns the same object when mapping is empty', () => {
    const facts = factsWith([{ name: 'userIcon' }, { name: 'keepMe' }]);
    const applied = applyDataItemNormalization(facts, new Map([['userIcon', '头像图片']]));
    expect(applied.dataPractices[0]!.dataItems.map((d) => d.name)).toEqual(['头像图片', 'keepMe']);

    const untouched = applyDataItemNormalization(facts, new Map());
    expect(untouched).toBe(facts);
  });

  it('counts applied and rejected decisions', () => {
    const artifact = buildNormalizationArtifact({
      model: 'qwen-test',
      canonicalCount: 2,
      normalization: {
        decisions: [
          { name: 'a', canonical: '头像图片', reason: '' },
          { name: 'b', canonical: null, reason: '' },
        ],
        mapping: new Map([['a', '头像图片']]),
      },
    });
    expect(artifact).toMatchObject({ candidateCount: 2, appliedCount: 1, rejectedCount: 1, canonicalCount: 2 });
  });
});

describe('generatePrivacyReportArtifacts with batch normalization', () => {
  it('normalizes unmatched names with evidence before the known-item gate and persists decisions', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'norm-repo-'));
    const outputDirAbs = await fs.mkdtemp(path.join(os.tmpdir(), 'norm-out-'));

    try {
      await fs.mkdir(path.join(repoRoot, 'input', 'csv'), { recursive: true });
      await fs.mkdir(path.join(repoRoot, 'input', 'app', 'TestApp'), { recursive: true });
      await fs.writeFile(
        path.join(repoRoot, 'input', 'csv', 'privacy_rules.csv'),
        ['type,keywords,outputName,rule', 'data_item,avatar_url,头像图片,用户头像图片本身', 'data_item,phoneNumber,手机号码,用户本人手机号'].join('\n'),
        'utf8',
      );

      const featureDir = path.join(outputDirAbs, 'pages', 'p1', 'features', 'f1');
      await fs.mkdir(featureDir, { recursive: true });
      const writeJson = async (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value), 'utf8');

      await writeJson(path.join(outputDirAbs, 'meta.json'), {
        runId: 'r1',
        input: { appPath: 'input/app/TestApp/', csvDir: 'input/csv/' },
        scan: { appFiles: 0 },
        counts: {},
      });
      await writeJson(path.join(outputDirAbs, 'sinks.json'), []);
      await writeJson(path.join(outputDirAbs, 'sources.json'), []);
      await writeJson(path.join(outputDirAbs, 'pages', 'index.json'), {
        meta: { runId: 'r1', generatedAt: '', counts: { pages: 1, features: 1, flows: 1 } },
        pages: [
          {
            pageId: 'p1',
            entry: { filePath: 'a.ets', structName: 'P1', line: 1, description: '测试页面' },
            counts: { features: 1, flows: 1 },
          },
        ],
      });
      await writeJson(path.join(outputDirAbs, 'pages', 'p1', 'features', 'index.json'), {
        meta: { runId: 'r1', generatedAt: '', counts: { features: 1 } },
        page: { pageId: 'p1' },
        features: [
          {
            featureId: 'f1',
            title: '查看头像',
            kind: 'ui',
            anchor: { filePath: 'a.ets', line: 1, functionName: 'build' },
            counts: { flows: 1, nodes: 1, edges: 0 },
          },
        ],
      });
      await writeJson(path.join(featureDir, 'dataflows.json'), {
        meta: { runId: 'r1', generatedAt: '', counts: { flows: 1, nodes: 1, edges: 0 } },
        flows: [
          {
            flowId: 'flow1',
            pathId: 'path1',
            nodes: [{ id: 'n1', filePath: 'a.ets', line: 1, code: 'Avatar()', description: '头像', context: '' }],
            edges: [],
            summary: '',
          },
        ],
      });

      let normalizationPrompt = '';
      mockChat.mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
        const text = JSON.stringify(req.messages);
        if (text.includes('候选名称')) {
          normalizationPrompt = text;
          return {
            content: JSON.stringify({
              decisions: [
                { name: 'contactUs', canonical: null, reason: '按钮跳转行为，不指代隐私数据' },
                { name: 'userIcon', canonical: '头像图片', reason: '证据显示读取头像文件，同指' },
              ],
            }),
            raw: {},
          };
        }
        if (text.includes('dataPractices')) {
          return {
            content: JSON.stringify({
              dataPractices: [
                {
                  businessScenario: '用户查看并设置头像',
                  processingSubject: '本应用',
                  dataSources: ['系统相册'],
                  dataItems: [
                    { name: 'userIcon', refs: [{ flowId: 'flow1', nodeId: 'n1' }] },
                    { name: 'contactUs', refs: [{ flowId: 'flow1', nodeId: 'n1' }] },
                  ],
                  processingMethod: '读取并展示',
                  storageMethod: '仅内存缓存',
                  dataRecipients: [],
                  processingPurpose: '展示用户头像',
                },
              ],
              permissionPractices: [],
            }),
            raw: {},
          };
        }
        return { content: JSON.stringify({ collectionAndUse: [], permissions: [] }), raw: {} };
      });

      await generatePrivacyReportArtifacts({
        repoRoot,
        runId: 'r1',
        appName: 'TestApp',
        outputDirAbs,
        llm: { ...llm, apiKey: 'test-key' },
      });

      const factsRaw = JSON.parse(await fs.readFile(path.join(featureDir, 'privacy_facts.json'), 'utf8'));
      const content = factsRaw.facts ?? factsRaw;
      const names = content.dataPractices[0].dataItems.map((d: { name: string }) => d.name);
      expect(names).toEqual(['头像图片']);

      expect(normalizationPrompt).toContain('应用：TestApp');
      expect(normalizationPrompt).toContain('用户头像图片本身');
      expect(normalizationPrompt).toContain('Avatar()');

      const artifact = JSON.parse(
        await fs.readFile(path.join(outputDirAbs, 'data_item_normalization.json'), 'utf8'),
      );
      expect(artifact.candidateCount).toBe(2);
      expect(artifact.appliedCount).toBe(1);
      expect(artifact.rejectedCount).toBe(1);
      expect(artifact.decisions.find((d: { name: string }) => d.name === 'contactUs').canonical).toBeNull();

      const normalizationCalls = mockChat.mock.calls.filter((call) =>
        JSON.stringify(call[0].messages).includes('候选名称'),
      );
      expect(normalizationCalls).toHaveLength(1);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(outputDirAbs, { recursive: true, force: true });
    }
  }, 60_000);
});
