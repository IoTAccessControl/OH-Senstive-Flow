import { describe, expect, it } from 'vitest';

import { buildPrivacyReport } from '../src/analyzer/privacy/report.js';

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

  it('renders a non-empty fallback sentence for synthetic app-level permissions without refs', async () => {
    const result = await buildPrivacyReport({
      runId: 'run2',
      appName: 'App',
      llm: { provider: 'Qwen', apiKey: '', model: 'qwen3-32b' },
      features: [
        {
          featureId: '__app_permissions',
          facts: {
            dataPractices: [],
            permissionPractices: [
              {
                permissionName: 'ohos.permission.INTERNET',
                businessScenario: '应用源码/配置声明或 SDK API 使用推断的权限',
                permissionPurpose: '当前已在应用源码/配置扫描或 SDK API→权限映射中识别到该权限，但尚未定位到具体功能点数据流。',
                denyImpact: '当前未从已识别的数据流中定位到具体拒绝授权影响。',
                refs: [],
              },
            ],
          },
          dataflows: {
            meta: {
              runId: 'run2',
              generatedAt: new Date().toISOString(),
              counts: { flows: 0, nodes: 0, edges: 0 },
            },
            flows: [],
          },
        },
      ],
    });

    const permissionSection = result.report.sections.permissions[0];
    expect(permissionSection?.tokens.length).toBeGreaterThan(0);
    expect(permissionSection?.tokens[0]?.text).toContain('ohos.permission.INTERNET');
    expect(result.text).toContain('尚未定位到可回溯的功能点数据流');
  });
});
