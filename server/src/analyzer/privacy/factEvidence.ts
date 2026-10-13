// Classify claims using executable source, never rule labels, comments or prompt titles.
export function executablePrivacyEvidence(source: string): string {
  return source.replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/gu, '""')
    .replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

export function supportsPrivacySource(source: string, evidence: string): boolean {
  const code = executablePrivacyEvidence(evidence);
  if (!code.trim()) return false;
  const system = /\b(?:deviceInfo|deviceType|sensor|pedometer|geoLocationManager|connection|display|accountKit|authorizationCode|authCode)\b|\b(?:contact\w*|camera\w*)\./iu.test(code);
  const network = /\b(?:http|https|fetch|axios|request|response|rpc|socket|websocket)\b|\.(?:request|getCookie|fetchCookie\w*)\s*\(|\b(?:cookie\w*|authCode|authorizationCode)\b/iu.test(code);
  const input = /\b(?:TextInput|TextArea|Search|Slider|DatePicker|TextPicker)\s*\(|\.(?:onChange|onSubmit|onSelect)\s*\(/u.test(code);
  const disk = /\b(?:preferences|persistentStorage|relationalStore|rdb|fileIo|readFile|writeFile|database)\b|\.(?:getItem|setItem)\s*\(/iu.test(code);
  const externalApp = /\b(?:want|Want|startAbility|onNewWant|ExtensionAbility)\b/u.test(code);
  const local = /@State|\b(?:const|let|var|this)\b|\w+\s*[:=]/u.test(code);
  // A source combining origins must have evidence for every asserted origin.
  if (/其他应用|第三方应用|外部应用/u.test(source) && !externalApp) return false;
  if (/系统|传感器|设备(?:测量|服务)|账号服务/u.test(source) && !system) return false;
  if (/网络|服务(?:端|器)|接口响应|业务服务|支付.*服务|签约.*服务/u.test(source) && !network) return false;
  if (/用户.*(?:输入|填写|选择|授权)/u.test(source) && !input && !/authCode|authorizationCode/iu.test(code)) return false;
  if (/存储|磁盘|数据库|文件/u.test(source) && !disk) return false;
  if (/初始化|页面状态|应用业务数据|业务已有|本地数据/u.test(source) && !local) return false;
  // Unclassified prose cannot replace an existing source merely by being fluent.
  return /其他应用|第三方应用|外部应用|系统|传感器|设备(?:测量|服务)|账号服务|网络|服务(?:端|器)|接口响应|业务服务|支付.*服务|签约.*服务|用户.*(?:输入|填写|选择|授权)|存储|磁盘|数据库|文件|初始化|页面状态|应用业务数据|业务已有|本地数据/u.test(source);
}

export function supportsPrivacyOperations(text: string, evidence: string): boolean {
  const code = executablePrivacyEvidence(evidence);
  if (!code.trim()) return false;
  const network = /\b(?:http|https|fetch|axios|request|rpc|socket|websocket)\b|\.(?:send|upload|post|put|publish|share|request)\s*\(|cookie|@header/iu.test(code);
  const persistent = /preferences|persistentStorage|relationalStore|\brdb\b|fileIo|writeFile|setItem|database/iu.test(code);
  if (/(发送|上传|共享|传输|服务端|服务器)/u.test(text) && !network) return false;
  if (/(加密|解密)/u.test(text) && !/\b(?:crypto\w*|cipher|encrypt\w*|decrypt\w*|rsa|aes|sm2|sm4)\b/iu.test(code)) return false;
  if (/(验证|校验)/u.test(text) && !/(validate\w*|verify\w*|check\w*|assert\w*|RegExp|\.test\s*\(|if\s*\(|[!=]==?|auth\w*|login|signIn)/iu.test(code)) return false;
  if (/(持久|长期保存|数据库|磁盘|文件存储|本地存储|本地保存)/u.test(text) && !persistent) return false;
  if (/(存储|保存|缓存)/u.test(text) && !/(内存|临时|暂存|页面状态|期间|所需|有效期)/u.test(text) && !persistent && !/cookie/iu.test(code)) return false;
  if (/(计算|运算)/u.test(text) && !/(\b(?:Math|calc\w*|calculate\w*|compute\w*|bmi)\b|[\w)\]]\s*[+*\/-]\s*[\w(\[])/iu.test(code)) return false;
  if (/(设备品牌|厂商)/u.test(text) && !/brand|manufacturer/iu.test(code)) return false;
  if (/设备方向/u.test(text) && !/orientation|rotation/iu.test(code)) return false;
  if (/(系统版本|系统信息)/u.test(text) && !/deviceInfo|osFullName|sdkApiVersion|systemVersion/iu.test(code)) return false;
  return !/(不存储|不保存|不会保存)/u.test(text);
}
