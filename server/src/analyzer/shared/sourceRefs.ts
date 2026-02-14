import type { SourceRecord } from '../types.js';

export type SourceRef = {
  filePath: string; // workspace-relative
  line: number; // 1-based
  functionName: string;
  description?: string;
};

export function sourceRecordToRef(r: SourceRecord): SourceRef {
  return {
    filePath: r['App源码文件路径'],
    line: r['行号'],
    functionName: r['函数名称'],
    description: r['描述'],
  };
}

