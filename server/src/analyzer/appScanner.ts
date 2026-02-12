import path from 'node:path';

import { walkFiles } from './walk.js';
import { DEFAULT_APP_SCAN_SUBDIR } from './defaults.js';

export async function scanAppArkTsFiles(appRootPath: string): Promise<string[]> {
  const scanRoot = path.join(appRootPath, DEFAULT_APP_SCAN_SUBDIR);
  return walkFiles(scanRoot, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out'],
  });
}

