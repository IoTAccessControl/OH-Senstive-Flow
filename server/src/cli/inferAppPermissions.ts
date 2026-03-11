import fs from 'node:fs/promises';
import path from 'node:path';

import { scanAppArkTsFiles } from '../analyzer/appScanner.js';
import { buildSdkModuleIndex } from '../analyzer/sdkIndexer.js';
import { analyzeSinks } from '../analyzer/sinkAnalyzer.js';
import { loadCsvApiDescriptions, loadCsvApiPermissions } from '../analyzer/csvSupplement.js';
import { loadOverrideDescriptions } from '../analyzer/overrideCsv.js';
import { collectPermissionsFromApp, normalizePermissionToken } from '../analyzer/permissions.js';

type Mode = 'declared' | 'inferred' | 'union' | 'intersection';
type Format = 'json' | 'text';

type CliArgs = {
  repoRoot?: string;
  inputDir?: string;
  sdkDir?: string;
  csvDir?: string;
  app?: string;
  mode?: Mode;
  format?: Format;
  details?: boolean;
  help?: boolean;
};

function usage(): string {
  return [
    'Infer app permissions from (1) app source/config strings and (2) SDK API usage (CSV + SDK @permission tags).',
    '',
    'Usage:',
    '  node --import tsx server/src/cli/inferAppPermissions.ts [--app <appName>] [--mode union] [--format json]',
    '',
    'Options:',
    '  --repoRoot <path>   Repo root (default: auto-detect)',
    '  --inputDir <path>   Apps dir (default: <repoRoot>/input/app)',
    '  --sdkDir <path>     SDK ETS dir (default: <repoRoot>/input/sdk/default/openharmony/ets)',
    '  --csvDir <path>     CSV dir (default: <repoRoot>/input/csv)',
    '  --app <name>        Only infer for one app',
    '  --mode <m>          declared|inferred|union|intersection (default: union)',
    '  --format <f>        json|text (default: json)',
    '  --details           Include per-app counts in JSON output',
    '  -h, --help          Show help',
    '',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { mode: 'union', format: 'json', details: false };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? '';
    if (raw === '-h' || raw === '--help') {
      out.help = true;
      continue;
    }
    if (raw === '--details') {
      out.details = true;
      continue;
    }
    if (!raw.startsWith('--')) throw new Error(`Unknown arg: ${raw}`);

    const eq = raw.indexOf('=');
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const value = eq > 0 ? raw.slice(eq + 1) : (argv[i + 1] ?? '');
    if (eq <= 0) i += 1;
    if (!value) throw new Error(`Missing value for ${key}`);

    if (key === '--repoRoot') out.repoRoot = value;
    else if (key === '--inputDir') out.inputDir = value;
    else if (key === '--sdkDir') out.sdkDir = value;
    else if (key === '--csvDir') out.csvDir = value;
    else if (key === '--app') out.app = value;
    else if (key === '--mode') {
      if (value !== 'declared' && value !== 'inferred' && value !== 'union' && value !== 'intersection') {
        throw new Error(`Invalid --mode: ${value}`);
      }
      out.mode = value;
    } else if (key === '--format') {
      if (value !== 'json' && value !== 'text') throw new Error(`Invalid --format: ${value}`);
      out.format = value;
    } else {
      throw new Error(`Unknown option: ${key}`);
    }
  }
  return out;
}

async function findRepoRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  for (;;) {
    const pkg = path.join(current, 'package.json');
    try {
      const parsed = JSON.parse(await fs.readFile(pkg, 'utf8')) as any;
      if (parsed && Array.isArray(parsed.workspaces) && parsed.workspaces.includes('server')) return current;
    } catch {
      // ignore
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function toAbs(baseDir: string, maybeRelative: string): string {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(baseDir, maybeRelative);
}

function setUnion(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>(a);
  for (const x of b) out.add(x);
  return out;
}

function setIntersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

function normalizePermissionSet(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const t = normalizePermissionToken(v);
    if (t && t.startsWith('ohos.permission.')) out.add(t);
  }
  return out;
}

function sortArr(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : await findRepoRoot(process.cwd());
  const inputDirAbs = toAbs(repoRoot, args.inputDir ?? path.join(repoRoot, 'input', 'app'));
  const sdkDirAbs = toAbs(repoRoot, args.sdkDir ?? path.join(repoRoot, 'input', 'sdk', 'default', 'openharmony', 'ets'));
  const csvDirAbs = toAbs(repoRoot, args.csvDir ?? path.join(repoRoot, 'input', 'csv'));

  const sdkIndex = await buildSdkModuleIndex(sdkDirAbs);
  const [csvDescriptions, overrideDescriptions, csvPermissions] = await Promise.all([
    loadCsvApiDescriptions(csvDirAbs),
    loadOverrideDescriptions(csvDirAbs),
    loadCsvApiPermissions(csvDirAbs),
  ]);

  const entries = await fs.readdir(inputDirAbs, { withFileTypes: true });
  const apps = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => (args.app ? name === args.app : true))
    .sort((a, b) => a.localeCompare(b));

  if (apps.length === 0) throw new Error('No apps found to process.');

  const results: Array<{
    app: string;
    permissions: string[];
    counts?: { declared: number; inferred: number; combined: number; sinks: number; files: number };
  }> = [];

  for (const appName of apps) {
    const appDirAbs = path.join(inputDirAbs, appName);
    const appFiles = await scanAppArkTsFiles(appDirAbs);
    const sinks = await analyzeSinks({
      repoRoot,
      appFiles,
      sdkIndex,
      csvDescriptions,
      overrideDescriptions,
      csvPermissions,
    });

    const declared = await collectPermissionsFromApp(appDirAbs);
    const inferred = normalizePermissionSet(
      sinks.flatMap((s) => (Array.isArray((s as any).__permissions) ? ((s as any).__permissions as string[]) : [])),
    );

    const mode: Mode = args.mode ?? 'union';
    const combined =
      mode === 'declared'
        ? normalizePermissionSet(declared)
        : mode === 'inferred'
          ? inferred
          : mode === 'intersection'
            ? setIntersect(normalizePermissionSet(declared), inferred)
            : setUnion(normalizePermissionSet(declared), inferred);

    results.push({
      app: appName,
      permissions: sortArr(combined),
      counts: args.details
        ? {
            declared: normalizePermissionSet(declared).size,
            inferred: inferred.size,
            combined: combined.size,
            sinks: sinks.length,
            files: appFiles.length,
          }
        : undefined,
    });
  }

  if (args.format === 'text') {
    for (const r of results) {
      process.stdout.write(`${r.app}\t${r.permissions.length}\n`);
      for (const p of r.permissions) process.stdout.write(`  - ${p}\n`);
      process.stdout.write('\n');
    }
    return;
  }

  process.stdout.write(`${JSON.stringify({ ok: true, mode: args.mode ?? 'union', results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String((error as any)?.stack ?? error)}\n`);
  process.exitCode = 1;
});

