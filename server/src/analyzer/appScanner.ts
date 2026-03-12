import path from 'node:path';

import { walkFiles } from './walk.js';
import { DEFAULT_APP_SCAN_SUBDIR } from './defaults.js';

export async function scanAppArkTsFiles(appRootPath: string): Promise<string[]> {
  // Prefer scanning all ArkTS sources under */src/main/ets, not just entry/, to avoid missing
  // multi-module projects (e.g. common/home/mine/video).
  const files = await walkFiles(appRootPath, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });

  const inMainEts = (filePath: string): boolean => {
    const normalized = filePath.split(path.sep).join('/');
    if (normalized.includes('/src/ohosTest/')) return false;
    return normalized.includes('/src/main/ets/');
  };

  const picked = files.filter(inMainEts);
  if (picked.length > 0) return picked;

  // Fallback to the original default path for backward compatibility / minimal apps.
  const scanRoot = path.join(appRootPath, DEFAULT_APP_SCAN_SUBDIR);
  const fallback = await walkFiles(scanRoot, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'build', 'dist', 'out', 'hvigor'],
  });
  if (fallback.length > 0) return fallback;

  // Last resort: some imported samples only keep transpiled ArkTS cache files under build/.
  // We prefer real sources, but scanning the generated cache is better than returning zero files.
  const generatedFiles = await walkFiles(appRootPath, {
    extensions: ['.ets', '.ts'],
    ignoreDirNames: ['node_modules', '.git', 'dist', 'out', 'hvigor', 'oh_modules'],
  });
  return generatedFiles.filter((filePath) => {
    const normalized = filePath.split(path.sep).join('/');
    return normalized.includes('/build/') && normalized.includes('/src/main/ets/');
  });
}
