import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPrivacyReport, generatePrivacyReportArtifacts } from '../src/analyzer/privacy/report.js';
import { loadPrivacyRules } from '../src/analyzer/extract/csv.js';
import type { PrivacyDataPractice } from '../src/analyzer/privacy/types.js';

const configuredRules = await loadPrivacyRules(fileURLToPath(new URL('../../input/csv/', import.meta.url)));

async function generateReport(rule: string, code: string) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-custom-name-'));
  try {
    const appPath = 'input/app/WebCookie';
    const outputDirAbs = path.join(repoRoot, 'output');
    await fs.mkdir(path.join(repoRoot, appPath), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'input/csv'), { recursive: true });
    await fs.mkdir(path.join(outputDirAbs, 'pages'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, appPath, 'main.ets'), code);
    await fs.writeFile(path.join(repoRoot, 'input/csv/privacy_rules.csv'), `type,keywords,outputName,rule\n${rule}\n`);
    await fs.writeFile(path.join(outputDirAbs, 'meta.json'), JSON.stringify({ input: { appPath, csvDir: 'input/csv' } }));
    await fs.writeFile(path.join(outputDirAbs, 'pages/index.json'), JSON.stringify({
      meta: { counts: { pages: 0, features: 0, flows: 0, unassignedFlows: 0 } }, pages: [],
    }));

    await generatePrivacyReportArtifacts({
      repoRoot, outputDirAbs, runId: 'custom-name', appName: 'WebCookie',
      llm: { provider: 'Qwen', apiKey: '', model: 'test' },
    });
    return {
      text: await fs.readFile(path.join(outputDirAbs, 'privacy_report.txt'), 'utf8'),
      facts: JSON.parse(await fs.readFile(path.join(outputDirAbs, 'app_permissions/privacy_facts.json'), 'utf8')),
      report: JSON.parse(await fs.readFile(path.join(outputDirAbs, 'privacy_report.json'), 'utf8')),
    };
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

describe('custom Cookie output names in fallback privacy reports', () => {
  it.each(['Cookie', '12345', '自定义会话数据', '登录密码'])('preserves Cookie semantics when outputName is %s', async (name) => {
    const result = await generateReport(
      `data_item,CookieManager|@Header('Cookie')|let cookies =|set-cookie,${name},Web Cookie（会话标识、登录态凭证）`,
      "webview.WebCookieManager.configCookieSync(url, value);",
    );
    expect(result.text).toContain(`在应用访问网络服务并维持登录会话时，本应用会收集和使用${name}，数据来源为网络服务返回，处理方式为读取、写入并随网络请求发送会话信息，用于维持登录状态和网络会话。数据将按照“按照网络会话有效期保存和更新”方式处理。`);
    expect(result.facts.dataPractices[0].dataItems.map((item: { name: string }) => item.name)).toEqual([name]);
    const anchor = result.report.sections.collectionAndUse.flatMap((section: { tokens: Array<{ text: string; jumpTo?: unknown }> }) => section.tokens)
      .find((token: { text: string; jumpTo?: unknown }) => token.text === name && token.jumpTo);
    expect(anchor).toBeDefined();
  });

  it('uses the definition when the matching keyword has no Cookie terminology', async () => {
    const result = await generateReport('data_item,sessionData,12345,Web Cookie（会话标识、登录态凭证）', 'let sessionData = response.value;');
    expect(result.text).toContain('维持登录状态和网络会话');
  });

  it('uses rule keywords even without a definition or Cookie terminology on the first matched line', async () => {
    const result = await generateReport('data_item,sessionData|CookieManager,12345,', 'let sessionData = response.value;');
    expect(result.text).toContain('维持登录状态和网络会话');
  });

  it('uses all matching source occurrences when the rule has no semantic hints', async () => {
    const result = await generateReport('data_item,sessionData,12345,', 'let sessionData = response.value;\nwebview.WebCookieManager.configCookieSync(url, sessionData);');
    expect(result.text).toContain('维持登录状态和网络会话');
  });

  it('does not infer Cookie semantics from the app directory or an unrelated identifier', async () => {
    const result = await generateReport('data_item,employeeId,12345,员工编号', 'let employeeId = "A001";\nlet nonCookieValue = 1;');
    expect(result.text).toContain('应用提供12345所对应的服务时');
    expect(result.text).not.toContain('维持登录状态和网络会话');
  });
});

function semanticFields(practice: PrivacyDataPractice) {
  const { dataItems: _items, ...fields } = practice;
  return fields;
}

describe('configured data semantics are independent of output labels', () => {
  it('does not claim a preset payment argument was returned by a payment service', async () => {
    const csv = (name: string) => `data_item,preSignNo|预签约编号,${name},支付预签约流程编号`;
    const before = await generateReport(csv('预签约编号'), 'const contractStr = \'{"preSignNo":"***"}\';');
    const after = await generateReport(csv('67890'), 'const contractStr = \'{"preSignNo":"***"}\';');
    expect(before.facts.dataPractices[0].dataSources).toEqual(['应用内初始化的数据']);
    expect(semanticFields(after.facts.dataPractices[0])).toEqual(semanticFields(before.facts.dataPractices[0]));
  });
  it('distinguishes initialized profile state from an actual input callback after renaming', async () => {
    const csv = 'data_item,// 婚姻状况,67890,';
    const initialized = await generateReport(csv, '@State maritalStatus: string = "未婚"; // 婚姻状况\nconsole.log(this.maritalStatus);');
    expect(initialized.facts.dataPractices[0].dataSources).toEqual(['应用内初始化的数据']);
    expect(initialized.text).not.toContain('用户主动输入');
    const input = await generateReport(csv, '@State maritalStatus: string = "未婚"; // 婚姻状况\nTextPicker().onSelect((value) => { this.maritalStatus = value; });');
    expect(input.facts.dataPractices[0].dataSources).toEqual(['用户主动输入']);
  });
  it.each(configuredRules.dataItems)('preserves the practice for $outputName when renamed', async (rule) => {
    const csv = (label: string) => `data_item,${rule.keywords.join('|')},${label},${rule.definition ?? ''}`;
    const code = rule.keywords[0]!;
    const original = await generateReport(csv(rule.outputName), code);
    const practice = original.facts.dataPractices[0];
    expect(practice.businessScenario).not.toContain('所对应的服务');
    for (const label of ['自定义67890', rule.outputName === 'Cookie' ? '登录密码' : 'Cookie']) {
      const renamed = await generateReport(csv(label), code);
      expect(semanticFields(renamed.facts.dataPractices[0])).toEqual(semanticFields(practice));
      expect(renamed.facts.dataPractices[0].dataItems.map((item: { name: string }) => item.name)).toEqual([label]);
      expect(renamed.text).toContain(label);
    }
  });

  it('recognizes a personal-data definition with new keywords', async () => {
    const result = await generateReport('data_item,heightValue,67890,用户填写的身高（cm）', 'TextInput().onChange(value => { this.heightValue = value; });');
    expect(result.text).toContain('用户填写或提交个人资料时');
    expect(result.text).toContain('数据来源为用户主动输入');
  });

  it('does not treat an unknown rule as Cookie merely because its display label is Cookie', async () => {
    const result = await generateReport('data_item,employeeId,Cookie,员工编号', 'let employeeId = "A001";');
    expect(result.text).toContain('应用提供Cookie所对应的服务时');
    expect(result.text).not.toContain('维持登录状态和网络会话');
  });

  it('uses generic text when one rule mixes conflicting data concepts', async () => {
    const result = await generateReport('data_item,geoLocationManager|chatText,67890,', 'geoLocationManager.read();');
    expect(result.text).toContain('应用提供67890所对应的服务时');
    expect(result.text).not.toContain('用户使用定位或地图服务时');
  });

  it('retains source-dependent nickname and avatar descriptions after a rename', async () => {
    for (const [keywords, name, code] of [
      ['nickname:|class MediaInfo', '昵称', 'class MediaInfo { nickname: string; }'],
      ['imgPath: string|avatar_url', '头像图片', 'const avatar_url = response.avatar_url;'],
    ]) {
      const before = await generateReport(`data_item,${keywords},${name},`, code!);
      const after = await generateReport(`data_item,${keywords},67890,`, code!);
      expect(semanticFields(after.facts.dataPractices[0])).toEqual(semanticFields(before.facts.dataPractices[0]));
      expect(after.text).toContain('网络服务返回');
    }
  });

  it('uses the matched rule when report facts have missing descriptions', async () => {
    const result = await buildPrivacyReport({
      runId: 'partial', appName: 'App', llm: { provider: 'Qwen', apiKey: '', model: 'test' },
      dataItemOccurrences: [{ dataItem: '67890', filePath: 'app/main.ets', line: 1, code: '// 身高', rule: { outputName: '67890', keywords: ['// 身高'] } }],
      features: [{
        featureId: 'height',
        dataflows: { meta: { runId: 'partial', generatedAt: '', counts: { flows: 0, nodes: 0, edges: 0 } }, flows: [] },
        facts: {
          permissionPractices: [],
          dataPractices: [{ businessScenario: '', dataSources: [], dataItems: [{ name: '67890', refs: [] }], processingMethod: '', storageMethod: '', processingPurpose: '', dataRecipients: [] }],
        },
      }],
    });
    expect(result.text).toContain('用户填写或提交个人资料时');
    expect(result.text).toContain('数据来源为用户主动输入');
    expect(result.text).not.toContain('应用提供67890所对应的服务时');
  });
});
