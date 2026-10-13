import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
vi.mock('../src/llm/client.js', async () => ({
  ...await vi.importActual<typeof import('../src/llm/client.js')>('../src/llm/client.js'), openAiCompatibleChat: mockChat,
}));
import { extractFeaturePrivacyFacts } from '../src/analyzer/privacy/facts.js';
import { mergeSyntheticModelFacts } from '../src/analyzer/privacy/report.js';

const ref = { flowId: 'flow:height', nodeId: 'height:1' };
const practice = { businessScenario: '用户填写身高时', processingSubject: '本应用', dataSources: ['用户输入'],
  dataItems: [{ name: '67890', refs: [ref] }], processingMethod: '读取身高字段', storageMethod: '在页面内存中暂存', dataRecipients: [], processingPurpose: '展示用户填写的身高' };
async function extract(raw: unknown, code = 'TextInput({ text: this.height }).onChange(value => { this.height = value; }); // 身高', synthetic = false) {
  mockChat.mockResolvedValueOnce({ content: JSON.stringify(raw), raw: {} });
  return extractFeaturePrivacyFacts({
    runId: 'test', appName: 'App', feature: synthetic ? { featureId: '__app_permissions', title: '个人信息处理：67890', kind: 'source', anchor: { filePath: 'app/main.ets', line: 1 }, page: { pageId: '_app_permissions', entry: { filePath: 'app/main.ets', line: 1 } }, sources: [] } : null, uiTree: null,
    llm: { provider: 'Qwen', apiKey: 'test-key', model: 'test' },
    privacyRules: { dataItems: [{ keywords: ['// 身高'], outputName: '67890', definition: '用户填写的身高' }, { keywords: ['phoneNumber'], outputName: '手机号码' }], descriptionRules: [] },
    dataflows: { meta: { runId: 'test', generatedAt: '', counts: { flows: 1, nodes: 1, edges: 0 } },
      flows: [{ flowId: ref.flowId, pathId: 'height', nodes: [{ id: ref.nodeId, code, filePath: 'app/main.ets', line: 1, description: '身高字段', context: { startLine: 1, lines: [code] } }], edges: [] }] },
  });
}
describe('privacy facts alias and content validation', () => {
  beforeEach(() => mockChat.mockReset());
  it('accepts grounded object-array aliases and preserves exact custom labels and references', async () => {
    const result = await extract({ collectionAndUse: [practice], permissionPractices: [] });
    expect(result.compatibilityAliasUsed).toBe(true);
    expect(result.content.dataPractices).toEqual([practice]);
    expect(result.warnings).toEqual([]);
  });
  it.each([['报告文案'], [practice, '报告文案'], [{ businessScenario: '用户输入' }]])('rejects non-fact alias arrays: %j', async (...entries) => {
    const result = await extract({ collectionAndUse: entries, permissionPractices: [] });
    expect(result.content.dataPractices).toEqual([]);
    expect(result.compatibilityAliasUsed).toBe(false);
    expect(result.warnings.join(' ')).toContain('仅兼容');
  });
  it.each([[], null, '错误类型'])('keeps canonical precedence even when its value is %j', async (canonical) => {
    const result = await extract({ dataPractices: canonical, collectionAndUse: [practice], permissionPractices: [] });
    expect(result.content.dataPractices).toEqual([]);
    expect(result.compatibilityAliasUsed).toBe(false);
  });
  it('keeps usable fields and falls back per rejected field rather than discarding genuine content', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, businessScenario: '具体用户场景', dataSources: ['具体来源'], storageMethod: '具体保存方式或处理期间', processingPurpose: '具体用途' }] });
    const accepted = result.content.dataPractices[0]!;
    expect(accepted.businessScenario).toBe('');
    expect(accepted.dataSources).toEqual([]);
    expect(accepted.storageMethod).toBe('');
    expect(accepted.processingPurpose).toBe('');
    expect(accepted.processingMethod).toBe('读取身高字段');
    expect(result.warnings.join(' ')).toContain('占位词');
    const merged = mergeSyntheticModelFacts({ dataPractices: [practice], permissionPractices: [] }, result.content);
    expect(merged.dataPractices).toEqual([practice]);
  });
  it.each([
    { name: '原数据项名称', refs: [ref] },
    { name: '67890', refs: [{ flowId: '原值', nodeId: '原值' }] },
    { name: '67890', refs: [{ flowId: 'flow:missing', nodeId: 'missing' }] },
    { name: '67890', refs: 'not-an-array' },
  ])('rejects invalid identities or references: %j', async (item) => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataItems: [item] }] });
    expect(result.content.dataPractices).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('filters canned permission text while retaining the permission and grounded reference', async () => {
    const result = await extract({ dataPractices: [], permissionPractices: [{ permissionName: 'ohos.permission.INTERNET', businessScenario: '用户进行具体操作时', permissionPurpose: '用于完成具体操作', denyImpact: '拒绝后无法完成的具体操作', refs: [ref] }] });
    expect(result.content.permissionPractices[0]).toMatchObject({ businessScenario: '', permissionPurpose: '', denyImpact: '', refs: [ref] });
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });
  it('does not apply a single unrelated model practice to every seed item', () => {
    const unrelated = { ...practice, dataItems: [{ name: '头像图片', refs: [] }], processingPurpose: '更新头像' };
    const merged = mergeSyntheticModelFacts({ dataPractices: [practice], permissionPractices: [] }, { dataPractices: [unrelated], permissionPractices: [] });
    expect(merged.dataPractices).toEqual([practice]);
  });
  it('rejects unsupported transmission, encryption and unconditional no-storage assertions', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['系统记录/应用本地处理', '源码检查'], processingMethod: '本地处理并发送', processingPurpose: '显示、检索或加密', storageMethod: '不存储' }] });
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: [], processingMethod: '', processingPurpose: '', storageMethod: '' });
    expect(result.warnings.join(' ')).toContain('缺少源码证据');
  });
  it('accepts transmission descriptions supported by the referenced source flow', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, processingMethod: '上传用户填写的身高', processingPurpose: '向服务器提交用户填写的资料' }] }, 'TextInput().onChange(value => { height = value; }); http.request(url, { body: height });');
    expect(result.content.dataPractices[0]).toMatchObject({ processingMethod: '上传用户填写的身高', processingPurpose: '向服务器提交用户填写的资料' });
  });
  it('does not turn a height form field into a system measurement or a BMI calculation', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['系统身高测量'], processingPurpose: '计算用户身高状态' }] }, '@State height1: number = 170; // 身高(cm)');
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: [], processingPurpose: '' });
    const merged = mergeSyntheticModelFacts({ dataPractices: [practice], permissionPractices: [] }, result.content);
    expect(merged.dataPractices[0]).toMatchObject({ dataSources: ['用户输入'], processingPurpose: '展示用户填写的身高' });
  });
  it('accepts calculation purpose when actual arithmetic is present', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, processingPurpose: '计算身体指标' }] }, 'const bmi = weight / (height * height);');
    expect(result.content.dataPractices[0].processingPurpose).toBe('计算身体指标');
  });
  it('rejects a different configured item even if it points at a valid reference in the current batch', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataItems: [{ name: '手机号码', refs: [ref] }] }] }, '// 身高', true);
    expect(result.content.dataPractices).toEqual([]);
    expect(result.warnings.join(' ')).toContain('不属于当前抽取批次');
  });
  it('rejects an analysis title, unrelated origin and device attributes absent from executable evidence', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, businessScenario: '个人信息处理：67890', dataSources: ['其他应用'], processingPurpose: '读取设备品牌和设备方向' }] }, '@State deviceType: string = "-";');
    expect(result.content.dataPractices[0]).toMatchObject({ businessScenario: '', dataSources: [], processingPurpose: '' });
    expect(result.warnings.join(' ')).toContain('分析标题');
  });
  it('does not treat initialized state or a storage-sounding origin as input or persistent storage', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['用户主动输入', '用户信息存储'], processingMethod: '本地存储', storageMethod: '系统缓存', processingPurpose: '存储婚姻状况状态变量' }] }, '@State maritalStatus: string = "未婚";');
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: [], processingMethod: '', storageMethod: '', processingPurpose: '' });
  });
  it('accepts persistent storage and external origins only when actual APIs are present', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['其他应用', '用户信息存储'], processingMethod: '本地存储', storageMethod: '写入数据库' }] }, 'const value = want.parameters.height; const height = preferences.get("height"); preferences.put("height", value);');
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: ['其他应用', '用户信息存储'], processingMethod: '本地存储', storageMethod: '写入数据库' });
  });
  it('does not use comments or string examples as proof of APIs or calculations', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['系统信息'], processingMethod: '上传身高', storageMethod: '本地存储', processingPurpose: '计算身体指标' }] }, 'const note = "http.request preferences deviceInfo Math"; // http.request(url);');
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: [], processingMethod: '', storageMethod: '', processingPurpose: '' });
  });
  it('keeps valid system sources while rejecting unclassified fluent source text', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, dataSources: ['系统信息', '某种数据供应方'], processingPurpose: '展示设备类型' }] }, 'this.deviceType = deviceInfo.deviceType;');
    expect(result.content.dataPractices[0]).toMatchObject({ dataSources: ['系统信息'], processingPurpose: '展示设备类型' });
  });
  it('does not accept a data category as purpose or a bare state label as storage method', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, processingPurpose: '用于收集用户社会属性数据', storageMethod: '本地状态' }] });
    expect(result.content.dataPractices[0]).toMatchObject({ processingPurpose: '', storageMethod: '' });
  });
  it('rejects a verb prepended to the rule definition as a purported processing purpose', async () => {
    const result = await extract({ collectionAndUse: [{ ...practice, processingPurpose: '获取用户填写的身高' }] });
    expect(result.content.dataPractices[0].processingPurpose).toBe('');
    expect(result.warnings.join(' ')).toContain('复述数据定义');
  });
  it('rejects birthday verification without validation code and allows an actual validation condition', async () => {
    const raw = { collectionAndUse: [{ ...practice, businessScenario: '生日验证', processingPurpose: '验证生日' }] };
    const missing = await extract(raw, '@State birthday: string = "2000-01-01";');
    expect(missing.content.dataPractices[0]).toMatchObject({ businessScenario: '', processingPurpose: '' });
    const checked = await extract(raw, 'if (birthday.length === 10) { showBirthday(birthday); }');
    expect(checked.content.dataPractices[0]).toMatchObject({ businessScenario: '生日验证', processingPurpose: '验证生日' });
  });
});
