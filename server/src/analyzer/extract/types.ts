export type SinkRecord = {
  App源码文件路径: string;
  导入行号: number;
  导入代码: string;
  调用行号: number;
  调用代码: string;
  API功能描述: string;

  __apiKey?: string;
  __module?: string;
  __permissions?: string[];
};

export type SourceRecord = {
  App源码文件路径: string;
  行号: number;
  函数名称: string;
  描述: string;
};

export type ImportBindingKind = 'default' | 'named' | 'namespace';

export type ImportBinding = {
  module: string;
  importKind: ImportBindingKind;
  importedName: string;
  localName: string;
  importLine: number;
  importCode: string;
};

export type ResolvedBinding = ImportBinding & {
  resolvedFromKit?: string;
};

export type SdkModuleIndex = {
  moduleToFile: Map<string, string>;
};
