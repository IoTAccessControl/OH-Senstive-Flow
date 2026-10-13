// Reject examples from prompts and empty/unknown values before they can replace
// evidence-based descriptions. Keep genuine short descriptions such as 本地处理.
export function usablePrivacyFactText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replaceAll(/\s+/gu, ' ').trim();
  if (/^(?:无|空|未知|未识别|none|null)$/iu.test(text)) return '';
  if (/(原数据项名称|原值|具体用户场景|具体来源|具体处理方式|具体保存方式|具体用途|用户进行具体操作时|用于完成具体操作|完成具体操作|拒绝后无法完成的具体操作)/u.test(text)) return '';
  return text;
}
