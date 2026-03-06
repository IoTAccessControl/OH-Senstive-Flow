import { describe, expect, it } from 'vitest';

import { buildPrivacyReport } from '../src/analyzer/privacyReport/buildPrivacyReport.js';

describe('privacy report evidence rules', () => {
  it('keeps collection text but omits permission text when permission refs are missing', async () => {
    const result = await buildPrivacyReport({
      runId: 'run1',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      features: [
        {
          featureId: 'feature_avatar',
          facts: {
            dataPractices: [
              {
                appName: 'App',
                businessScenario: '用户点击头像',
                dataSources: ['系统相册'],
                dataItems: [{ name: '头像图片', refs: [] }],
                processingMethod: '复制并展示图片',
                storageMethod: '本地缓存',
                dataRecipients: [],
                processingPurpose: '展示头像',
              },
            ],
            permissionPractices: [
              {
                permissionName: 'ohos.permission.READ_MEDIA',
                businessScenario: '用户点击头像',
                permissionPurpose: '读取图片',
                denyImpact: '无法选择图片',
                refs: [],
              },
            ],
          },
          dataflows: {
            meta: {
              runId: 'run1',
              generatedAt: new Date().toISOString(),
              counts: { flows: 1, nodes: 1, edges: 0 },
            },
            flows: [
              {
                flowId: 'flow:p1',
                pathId: 'p1',
                nodes: [
                  {
                    id: 'p1:n1',
                    filePath: 'app/main.ets',
                    line: 10,
                    code: 'Image(this.avatar)',
                    description: '展示头像',
                    context: { startLine: 9, lines: ['Image(this.avatar)'] },
                  },
                ],
                edges: [],
              },
            ],
          },
        },
      ],
    });

    const collectionSection = result.report.sections.collectionAndUse[0];
    const permissionSection = result.report.sections.permissions[0];

    expect(collectionSection?.tokens.some((t) => t.text.includes('头像图片'))).toBe(true);
    expect(collectionSection?.tokens.some((t) => t.jumpTo)).toBe(false);
    expect(permissionSection?.tokens ?? []).toEqual([]);
    expect(result.text).toContain('头像图片');
    expect(result.text).not.toContain('ohos.permission.READ_MEDIA');
    expect(result.warnings.some((item) => item.includes('权限段落缺少有效跳转引用'))).toBe(false);
    expect(result.warnings.some((item) => item.includes('个人信息段落缺少有效跳转引用'))).toBe(true);
  });
});
