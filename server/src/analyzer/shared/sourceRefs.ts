import type { SourceRecord } from '../types.js';

export type SourceRef = {
  filePath: string; // workspace-relative
  line: number; // 1-based
  functionName: string;
  description?: string;
};

function normalizeSourceRefDescription(functionName: string, description: string): string {
  const fn = functionName.trim();
  const desc = description.trim();

  if (fn === 'build') return '页面或组件展示与交互的入口逻辑';
  if (fn === 'aboutToAppear') return '页面或组件即将显示时';
  if (fn === 'aboutToDisappear') return '页面或组件即将隐藏时';
  if (fn === 'onPageShow') return '页面显示时';
  if (fn === 'onPageHide') return '页面隐藏时';
  if (fn === 'onBackPress') return '处理返回操作时';
  if (fn === 'onCreate') return '应用创建时';
  if (fn === 'onDestroy') return '应用退出时';
  if (fn === 'onForeground') return '应用切到前台时';
  if (fn === 'onBackground') return '应用切到后台时';
  if (fn === 'onWindowStageCreate') return '应用窗口创建时';
  if (fn === 'onWindowStageDestroy') return '应用窗口销毁时';

  return desc;
}

export function sourceRecordToRef(r: SourceRecord): SourceRef {
  return {
    filePath: r['App源码文件路径'],
    line: r['行号'],
    functionName: r['函数名称'],
    description: normalizeSourceRefDescription(String(r['函数名称'] ?? ''), String(r['描述'] ?? '')),
  };
}

