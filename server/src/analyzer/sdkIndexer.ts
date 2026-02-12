import path from 'node:path';

import { walkFiles } from './walk.js';

export type SdkModuleIndex = {
  moduleToFile: Map<string, string>;
};

export async function buildSdkModuleIndex(sdkRootPath: string): Promise<SdkModuleIndex> {
  const moduleToFile = new Map<string, string>();

  const files = await walkFiles(sdkRootPath, {
    extensions: ['.d.ts', '.d.ets'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'out', 'dist'],
  });

  for (const filePath of files) {
    const base = path.basename(filePath);
    if (!(base.startsWith('@ohos.') || base.startsWith('@kit.'))) continue;
    const moduleName = base.replace(/(\.d\.ets|\.d\.ts)$/u, '');
    const existing = moduleToFile.get(moduleName);
    if (!existing) {
      moduleToFile.set(moduleName, filePath);
      continue;
    }

    const existingIsDts = existing.endsWith('.d.ts');
    const currentIsDts = filePath.endsWith('.d.ts');
    if (currentIsDts && !existingIsDts) moduleToFile.set(moduleName, filePath);
  }

  return { moduleToFile };
}
