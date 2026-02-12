import type { SourceRecord } from '../types.js';

export type UiModuleSourceRef = {
  filePath: string; // workspace-relative
  line: number; // 1-based
  functionName: string;
  description?: string;
};

export type UiModuleInfo = {
  moduleId: string;
  entry: {
    filePath: string; // workspace-relative
    structName?: string;
    line?: number; // 1-based
  };
  uiTreeRootId: string;
  files: string[]; // workspace-relative
  sources: UiModuleSourceRef[];
};

export type UiModulesIndex = {
  meta: {
    runId: string;
    generatedAt: string;
    counts: {
      modules: number;
      assignedFlows: number;
      unassignedFlows: number;
    };
  };
  modules: UiModuleInfo[];
};

export function sourceRecordToRef(r: SourceRecord): UiModuleSourceRef {
  return {
    filePath: r['App源码文件路径'],
    line: r['行号'],
    functionName: r['函数名称'],
    description: r['描述'],
  };
}

