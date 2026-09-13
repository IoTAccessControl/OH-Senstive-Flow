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
): Promise<{
  callGraph: CallGraph;
  paths: CallGraphPath[];
  cpgGenerateMs: number;
  cpgParseMs: number;
  callgraphMs: number;
  truncation: { pathBranches: number; depthBranches: number };
}> {
  const genStart = Date.now();
  const cpgJsonPath = await generateCpgJson({
    repoRoot: options.repoRoot,
    appRootAbs: options.appRootAbs,
    appFiles: options.appFiles,
    outputDirAbs: options.outputDirAbs,
  });
  const cpgGenerateMs = Math.max(0, Date.now() - genStart);

  const parseStart = Date.now();
  const cpg = await parseCpgJson({
    repoRoot: options.repoRoot,
    appFiles: options.appFiles,
    cpgJsonPath,
  });
  const cpgParseMs = Math.max(0, Date.now() - parseStart);

  const cgStart = Date.now();
  const result = buildCallGraphAndPathsFromParsedCpg({
    runId: options.runId,
    cpg,
    sinks: options.sinks,
    sources: options.sources,
    maxPaths: options.maxPaths,
  });
  const callgraphMs = Math.max(0, Date.now() - cgStart);

  return {
    callGraph: result.callGraph,
    paths: result.paths,
    cpgGenerateMs,
    cpgParseMs,
    callgraphMs,
    truncation: result.truncation,
  };
}
