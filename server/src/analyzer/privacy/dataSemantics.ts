import type { PrivacyRules } from '../extract/csv.js';

export type FallbackDataKind =
  | 'profile' | 'nickname' | 'login' | 'authorization-code' | 'input' | 'chat'
  | 'transaction' | 'location' | 'health' | 'device' | 'local-id' | 'cookie'
  | 'avatar' | 'contacts' | 'identity';

type SemanticEntry = {
  kind: FallbackDataKind;
  names: string[];
  keywords: string[];
  definition: RegExp;
};

// These are semantic clues for the supported fallback descriptions. CSV labels
// may change independently; never use a configured outputName as a clue.
const SEMANTICS: SemanticEntry[] = [
  {
    kind: 'profile',
    names: ['姓名', '性别', '年龄', '年龄段', '出生日期', '年级', '国家', '民族', '工作信息', '收入状况', '房屋数据', '身高', '体重', '婚姻状况', '家庭成员信息', '教育背景'],
    keywords: ['姓名', '性别', '年龄', '年龄段', '生日', '年级', '国家', '民族', '工作', '收入', '房屋数据', '身高', '体重', '婚姻状况', '家庭成员', '教育背景']
      .flatMap((label) => [`// ${label}`, `${label}：`]),
    definition: /自然人姓名|用户.*(?:身高|体重|性别|年龄|生日|出生日期|年级|国家|民族|工作|收入|房屋|婚姻|家庭成员|教育背景)|个人资料/u,
  },
  { kind: 'nickname', names: ['昵称'], keywords: ['// 昵称', '昵称：', 'nickname:', 'this.data.nickname', 'class MediaInfo'], definition: /昵称|网名/u },
  { kind: 'login', names: ['登录账号', '登录密码', '手机号码'], keywords: ['phoneNumber', 'anonymousPhone', "placeholder: '账号'", '登录密码', "placeholder: '密码'"], definition: /用户本人的手机号码|登录凭证/u },
  { kind: 'authorization-code', names: ['授权码'], keywords: ['authorizationCode', 'authCode', '授权码'], definition: /一次性授权码/u },
  { kind: 'input', names: ['搜索关键词', '用户输入内容'], keywords: ['searchText', 'searchKeyword', 'this.keyword', 'changeValue', '搜索关键词', 'shareIntent', '用户输入内容'], definition: /发起搜索.*关键词|主动键入.*文本|用户输入的文本/u },
  { kind: 'chat', names: ['聊天内容'], keywords: ['chatText', '聊天内容'], definition: /消息正文|聊天记录/u },
  { kind: 'transaction', names: ['商户号', '预支付交易会话标识', '授权标识', '预签约编号'], keywords: ['merc_no', '商户号', 'prepay_id', '预支付交易会话标识', 'auth_id', '授权标识', 'preSignNo', '预签约编号'], definition: /商户编号|预支付.*会话标识|持久授权标识|预签约.*编号/u },
  { kind: 'location', names: ['位置信息'], keywords: ['geoLocationManager'], definition: /地理位置|经纬度/u },
  { kind: 'health', names: ['步数数据', '运动健康数据'], keywords: ['runningSequence', 'exerciseSequence', '运动健康数据', 'PEDOMETER', '步数数据', '步数统计'], definition: /运动.*健康记录|计步器|步数.*运动记录/u },
  { kind: 'device', names: ['设备标识信息', '匿名设备标识符', '设备信息', 'IP地址'], keywords: ['deviceToken', 'DeviceCategory', '设备标识信息', 'oaid', '匿名设备标识', 'IPAddress', 'IP地址', 'ScenarioFusionKit', 'data.deviceType', 'deviceType: string', '设备品牌', '设备方向'], definition: /设备标识信息|匿名设备标识|设备硬件与系统特征|设备网络 IP 地址/iu },
  { kind: 'local-id', names: ['应用唯一标识符'], keywords: ['appUuid', '应用唯一标识符'], definition: /应用安装实例.*唯一标识/u },
  { kind: 'cookie', names: ['Cookie'], keywords: ['CookieManager', "@Header('Cookie')", 'let cookies =', 'set-cookie'], definition: /\bcookie\b/iu },
  { kind: 'avatar', names: ['头像图片'], keywords: ['imgPath: string', 'avatar_url', 'avatarUrl', '头像地址'], definition: /头像图片/u },
  { kind: 'contacts', names: ['通讯录信息'], keywords: ['contact', '联系人'], definition: /系统通讯录/u },
  { kind: 'identity', names: ['用户身份信息'], keywords: ['用户身份信息', 'MyQrCode'], definition: /用户身份信息/u },
];

const normalize = (text: string) => text.replaceAll(/\s+/gu, ' ').trim().toLowerCase();
const keywordKinds = new Map(SEMANTICS.flatMap((entry) => entry.keywords.map((keyword) => [normalize(keyword), entry.kind] as const)));
const nameKinds = new Map(SEMANTICS.flatMap((entry) => entry.names.map((name) => [name, entry.kind] as const)));

function uniqueKind(kinds: FallbackDataKind[]): FallbackDataKind | undefined {
  const unique = new Set(kinds);
  return unique.size === 1 ? [...unique][0] : undefined;
}

export function resolveFallbackDataKind(args: {
  name: string;
  rules: PrivacyRules['dataItems'];
  codes: string[];
}): FallbackDataKind | undefined {
  const keywordHits = args.rules.flatMap((rule) => rule.keywords.flatMap((keyword) => {
    const kind = keywordKinds.get(normalize(keyword));
    return kind ? [kind] : [];
  }));
  if (keywordHits.length > 0) return uniqueKind(keywordHits);

  const definitionHits = args.rules.flatMap((rule) => SEMANTICS
    .filter((entry) => entry.definition.test(rule.definition ?? ''))
    .map((entry) => entry.kind));
  if (definitionHits.length > 0) return uniqueKind(definitionHits);

  const sourceHits = args.codes.flatMap((code) => {
    const text = normalize(code);
    const kinds = SEMANTICS.filter((entry) => entry.keywords.some((keyword) => text.includes(normalize(keyword))))
      .map((entry) => entry.kind);
    if (/\b(?:cookie(?:manager|s)?|webcookiemanager|(?:fetch|config|clearall)cookies?(?:sync)?)\b/iu.test(code)) kinds.push('cookie');
    return kinds;
  });
  if (sourceHits.length > 0) return uniqueKind(sourceHits);

  // Legacy callers can provide facts without CSV/source metadata. A configured
  // rule with unknown semantics must not inherit a template from its label.
  return args.rules.length === 0 ? nameKinds.get(args.name) : undefined;
}
