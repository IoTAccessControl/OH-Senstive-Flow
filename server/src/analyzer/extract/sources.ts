import fs from 'node:fs/promises';

import type { SourceRecord } from './types.js';
import { toWorkspaceRelativePath } from '../../utils/accessWorkspace.js';

const SOURCE_FUNCTION_DESCRIPTIONS: Record<string, string> = {
  build: 'ArkUI 组件的 UI 构建入口函数',
  aboutToAppear: '组件即将显示时触发的生命周期函数',
  aboutToDisappear: '组件即将消失时触发的生命周期函数',
  onPageShow: '页面显示时触发的生命周期函数',
  onPageHide: '页面隐藏时触发的生命周期函数',
  onBackPress: '返回键事件回调（页面/组件）',
  onCreate: 'UIAbility 创建时触发的生命周期函数',
  onDestroy: 'UIAbility 销毁时触发的生命周期函数',
  onForeground: 'UIAbility 切换到前台时触发的生命周期函数',
  onBackground: 'UIAbility 切换到后台时触发的生命周期函数',
  onWindowStageCreate: 'WindowStage 创建时触发的生命周期函数',
  onWindowStageDestroy: 'WindowStage 销毁时触发的生命周期函数',
  onWindowStageActive: 'WindowStage 获得焦点时触发的生命周期函数',
  onWindowStageInactive: 'WindowStage 失去焦点时触发的生命周期函数',
  onNewWant: '收到新的 Want 时触发的生命周期函数',
  onConfigurationUpdate: '系统配置更新时触发的生命周期函数',
};

const TARGET_NAMES = new Set(Object.keys(SOURCE_FUNCTION_DESCRIPTIONS));

function isFunctionDefinitionLine(line: string, functionName: string): boolean {
  // Matches: build() { ... } , async aboutToAppear() { ... }, private onCreate(...) { ... }
  const pattern = new RegExp(
    String.raw`^\s*(?:public|private|protected)?\s*(?:async\s+)?${functionName}\s*\([^)]*\)\s*\{`,
    'u',
  );
  return pattern.test(line);
}

export type SourceRef = {
  filePath: string;
  line: number;
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

export function sourceRecordToRef(record: SourceRecord): SourceRef {
  return {
    filePath: record['App源码文件路径'],
    line: record['行号'],
    functionName: record['函数名称'],
    description: normalizeSourceRefDescription(String(record['函数名称'] ?? ''), String(record['描述'] ?? '')),
  };
}

export async function analyzeSources(repoRoot: string, appFiles: string[]): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];

  for (const filePath of appFiles) {
    const fileText = await fs.readFile(filePath, 'utf8');
    const lines = fileText.split(/\r?\n/u);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const name of TARGET_NAMES) {
        if (!isFunctionDefinitionLine(line, name)) continue;
        records.push({
          App源码文件路径: toWorkspaceRelativePath(repoRoot, filePath),
          行号: i + 1,
          函数名称: name,
          描述: SOURCE_FUNCTION_DESCRIPTIONS[name] ?? '入口函数/生命周期函数',
        });
      }
    }
  }

  return records;
}
