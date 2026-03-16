import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runAnalysis, type AnalyzeRequest } from '../analyzer/api.js';
import { ensureDir, readJsonFile, writeJsonFile } from '../utils/accessWorkspace.js';

type RunRegistryEntry = {
  runId: string;
  outputDir: string;
};

type ReadResultJsonArgs = {
  repoRoot: string;
  outputDir?: string;
  runId?: string;
  pathSegments: string[];
};

type PermissionSetEvaluation = {
  counts: {
    gt: number;
    pred: number;
    tp: number;
    fp: number;
    fn: number;
  };
  recall: number;
  falsePositiveRate: number;
  missing: string[];
  extra: string[];
};

function registryDir(repoRoot: string): string {
  return path.join(repoRoot, 'output', '_runs');
}

function asFsErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
}

function extractPermissionNamesFromText(text: string): string[] {
  const matches = text.match(/ohos\.permission\.[A-Z0-9_]+/gu) ?? [];
  return [...new Set(matches.map((item) => item.trim()).filter(Boolean))].sort();
}

export async function listRunRegistry(repoRoot: string): Promise<RunRegistryEntry[]> {
  const dir = registryDir(repoRoot);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (asFsErrorCode(error) === 'ENOENT') return [];
    throw error;
  }

  const items: Array<{ entry: RunRegistryEntry; mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'latest.json') continue;
    const filePath = path.join(dir, name);
    try {
      const [text, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const parsed = JSON.parse(text) as Partial<RunRegistryEntry>;
      const runId =
        typeof parsed.runId === 'string' && parsed.runId.trim() ? parsed.runId.trim() : name.slice(0, -'.json'.length);
      const outputDir = typeof parsed.outputDir === 'string' ? parsed.outputDir : '';
      items.push({ entry: { runId, outputDir }, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore broken registry entries
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map((item) => item.entry);
}

export async function writeRunRegistry(repoRoot: string, entry: RunRegistryEntry): Promise<void> {
  const dir = registryDir(repoRoot);
  await ensureDir(dir);
  await writeJsonFile(path.join(dir, `${entry.runId}.json`), entry);
  await writeJsonFile(path.join(dir, 'latest.json'), entry);
}

export async function resolveRunIdToOutputDir(repoRoot: string, runId?: string): Promise<string> {
  if (!runId) {
    const latestPath = path.join(registryDir(repoRoot), 'latest.json');
    const text = await fs.readFile(latestPath, 'utf8');
    const latest = JSON.parse(text) as RunRegistryEntry;
    return path.resolve(repoRoot, latest.outputDir);
  }

  const filePath = path.join(registryDir(repoRoot), `${runId}.json`);
  const text = await fs.readFile(filePath, 'utf8');
  const entry = JSON.parse(text) as RunRegistryEntry;
  return path.resolve(repoRoot, entry.outputDir);
}

export async function resolveResultOutputDir(args: { repoRoot: string; outputDir?: string; runId?: string }): Promise<string> {
  if (typeof args.outputDir === 'string' && args.outputDir.trim()) return path.resolve(args.repoRoot, args.outputDir);
  return resolveRunIdToOutputDir(args.repoRoot, args.runId);
}

export async function readResultJson(args: ReadResultJsonArgs): Promise<unknown> {
  const outputDir = await resolveResultOutputDir(args);
  return readJsonFile(path.join(outputDir, ...args.pathSegments));
}

export function evaluatePermissionSets(gt: Set<string>, pred: Set<string>): PermissionSetEvaluation {
  const missing = [...gt].filter((item) => !pred.has(item)).sort();
  const extra = [...pred].filter((item) => !gt.has(item)).sort();
  const tp = gt.size - missing.length;
  const fp = extra.length;
  const fn = missing.length;
  const recall = gt.size === 0 ? 1 : tp / gt.size;
  const falsePositiveRate = pred.size === 0 ? 0 : fp / pred.size;

  return {
    counts: { gt: gt.size, pred: pred.size, tp, fp, fn },
    recall,
    falsePositiveRate,
    missing,
    extra,
  };
}

export async function collectPredictedPermissionsFromRun(runDirAbs: string): Promise<Set<string>> {
  const predicted = new Set<string>();

  let files: string[] = [];
  try {
    files = await fs.readdir(path.join(runDirAbs, 'pages'));
  } catch {
    files = [];
  }

  const privacyFactsPaths: string[] = [];
  for (const pageId of files) {
    const featuresRoot = path.join(runDirAbs, 'pages', pageId, 'features');
    let featureIds: string[] = [];
    try {
      featureIds = await fs.readdir(featuresRoot);
    } catch {
      featureIds = [];
    }
    for (const featureId of featureIds) {
      privacyFactsPaths.push(path.join(featuresRoot, featureId, 'privacy_facts.json'));
    }
  }

  privacyFactsPaths.push(path.join(runDirAbs, 'app_permissions', 'privacy_facts.json'));

  for (const filePath of privacyFactsPaths) {
    try {
      const parsed = (await readJsonFile(filePath)) as {
        facts?: { permissionPractices?: Array<{ permissionName?: string }> };
      };
      const items = parsed?.facts?.permissionPractices ?? [];
      for (const item of items) {
        const value = typeof item.permissionName === 'string' ? item.permissionName : '';
        for (const permissionName of extractPermissionNamesFromText(value)) predicted.add(permissionName);
      }
    } catch {
      // ignore missing or invalid privacy facts
    }
  }

  return predicted;
}

type DirectRunArgs = Partial<AnalyzeRequest> & {
  help?: boolean;
};

function usage(): string {
  return [
    'Run one app analysis end-to-end.',
    '',
    'Usage:',
    '  node --import tsx server/src/app/run.ts --appPath input/app/Test_user_info/ [--sdkPath ...] [--csvDir ...]',
    '',
    'Options:',
    '  --repoRoot <path>',
    '  --appPath <path>',
    '  --sdkPath <path>',
    '  --csvDir <path>',
    '  --maxDataflowPaths <n>',
    '  --llmProvider <name>',
    '  --llmApiKey <key>',
    '  --llmModel <name>',
    '  --uiLlmProvider <name>',
    '  --uiLlmApiKey <key>',
    '  --uiLlmModel <name>',
    '  --privacyReportLlmProvider <name>',
    '  --privacyReportLlmApiKey <key>',
    '  --privacyReportLlmModel <name>',
    '  -h, --help',
    '',
  ].join('\n');
}

function parseDirectRunArgs(argv: string[]): DirectRunArgs {
  const out: DirectRunArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? '';
    if (raw === '-h' || raw === '--help') {
      out.help = true;
      continue;
    }
    if (!raw.startsWith('--')) throw new Error(`Unknown arg: ${raw}`);

    const eq = raw.indexOf('=');
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const value = eq > 0 ? raw.slice(eq + 1) : (argv[i + 1] ?? '');
    if (eq <= 0) i += 1;
    if (!value) throw new Error(`Missing value for ${key}`);

    if (key === '--repoRoot') out.repoRoot = value;
    else if (key === '--appPath') out.appPath = value;
    else if (key === '--sdkPath') out.sdkPath = value;
    else if (key === '--csvDir') out.csvDir = value;
    else if (key === '--maxDataflowPaths') out.maxDataflowPaths = Number(value);
    else if (key === '--llmProvider') out.llmProvider = value;
    else if (key === '--llmApiKey') out.llmApiKey = value;
    else if (key === '--llmModel') out.llmModel = value;
    else if (key === '--uiLlmProvider') out.uiLlmProvider = value;
    else if (key === '--uiLlmApiKey') out.uiLlmApiKey = value;
    else if (key === '--uiLlmModel') out.uiLlmModel = value;
    else if (key === '--privacyReportLlmProvider') out.privacyReportLlmProvider = value;
    else if (key === '--privacyReportLlmApiKey') out.privacyReportLlmApiKey = value;
    else if (key === '--privacyReportLlmModel') out.privacyReportLlmModel = value;
    else throw new Error(`Unknown option: ${key}`);
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseDirectRunArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : path.resolve(path.dirname(thisFile), '..', '..', '..');
  const result = await runAnalysis({
    repoRoot,
    appPath: args.appPath,
    sdkPath: args.sdkPath,
    csvDir: args.csvDir,
    maxDataflowPaths: args.maxDataflowPaths,
    llmProvider: args.llmProvider,
    llmApiKey: args.llmApiKey,
    llmModel: args.llmModel,
    uiLlmProvider: args.uiLlmProvider,
    uiLlmApiKey: args.uiLlmApiKey,
    uiLlmModel: args.uiLlmModel,
    privacyReportLlmProvider: args.privacyReportLlmProvider,
    privacyReportLlmApiKey: args.privacyReportLlmApiKey,
    privacyReportLlmModel: args.privacyReportLlmModel,
  });

  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
}

const isDirectRun = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;

if (isDirectRun) {
  void main().catch((error) => {
    process.stderr.write(`${String((error as Error)?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
