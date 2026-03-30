import type { CallGraph, CallGraphPath } from '../callgraph/types.js';
import type { SinkRecord, SourceRecord } from '../extract/types.js';

import { buildCallGraphAndPathsFromParsedCpg } from './extractPaths.js';
import { generateCpgJson } from './generate.js';
import { parseCpgJson } from './parse.js';

type BuildCallGraphAndPathsFromCpgOptions = {
  repoRoot: string;
  runId: string;
  appRootAbs: string;
  appFiles: string[];
  sinks: SinkRecord[];
  sources: SourceRecord[];
  maxPaths: number | null;
  outputDirAbs: string;
};

export async function buildCallGraphAndPathsFromCpg(
  options: BuildCallGraphAndPathsFromCpgOptions,
): Promise<{ callGraph: CallGraph; paths: CallGraphPath[] }> {
  const cpgJsonPath = await generateCpgJson({
    repoRoot: options.repoRoot,
    appRootAbs: options.appRootAbs,
    appFiles: options.appFiles,
    outputDirAbs: options.outputDirAbs,
  });
  const cpg = await parseCpgJson({
    repoRoot: options.repoRoot,
    appFiles: options.appFiles,
    cpgJsonPath,
  });

  return buildCallGraphAndPathsFromParsedCpg({
    runId: options.runId,
    cpg,
    sinks: options.sinks,
    sources: options.sources,
    maxPaths: options.maxPaths,
  });
}
