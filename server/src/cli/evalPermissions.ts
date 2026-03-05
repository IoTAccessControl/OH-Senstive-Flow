import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRunIdToOutputDir } from '../analyzer/runRegistry.js';
import {
  collectPredictedPermissionsFromRun,
  evaluatePermissionSets,
  loadGroundtruthFile,
  type PermissionEvalResult,
} from '../eval/permissionGroundtruthEval.js';

type CliArgs = {
  app?: string;
  runDir?: string;
  runId?: string;
  repoRoot?: string;
  groundtruthDir?: string;
  format?: 'text' | 'json';
  details?: boolean;
  help?: boolean;
};

function usage(): string {
  return [
    'Evaluate permission recognition against groundtruth.',
    '',
    'Predicted permissions are collected from all privacy_facts.json under the given run directory.',
    'Groundtruth permissions are loaded from groundtruth/permission/<app>.txt.',
    '',
    'Usage:',
    '  node --import tsx server/src/cli/evalPermissions.ts --app <appName> (--runDir <path> | --runId <runId>) [--details]',
    '',
    'Options:',
    '  --app <name>            App name under input/app (used for groundtruth file name)',
    '  --runDir <path>         Absolute path or path relative to repoRoot',
    '  --runId <runId>         Run id in output/_runs/<runId>.json (e.g. Wechat_HarmonyOS_20260304-193122)',
    '  --repoRoot <path>       Repo root (default: auto-detect)',
    '  --groundtruthDir <path> Groundtruth dir (default: <repoRoot>/groundtruth/permission)',
    '  --format text|json      Output format (default: text)',
    '  --details               Print missing/extra permission lists',
    '  -h, --help              Show help',
    '',
    'Metrics:',
    '  Recall (覆盖率) = TP / |GT|',
    '  False positive rate (误报率) = FP / |Pred|',
    '',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { format: 'text', details: false };
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

    if (key === '--app') out.app = value;
    else if (key === '--runDir') out.runDir = value;
    else if (key === '--runId') out.runId = value;
    else if (key === '--repoRoot') out.repoRoot = value;
    else if (key === '--groundtruthDir') out.groundtruthDir = value;
    else if (key === '--format') {
      if (value !== 'text' && value !== 'json') throw new Error(`Invalid --format: ${value}`);
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

function fmtPercent(v: number): string {
  if (!Number.isFinite(v)) return 'NaN';
  return `${(v * 100).toFixed(2)}%`;
}

function renderText(result: PermissionEvalResult, app: string, runDirAbs: string, gtFilePath: string, details: boolean): string {
  const lines: string[] = [];
  lines.push(`App: ${app}`);
  lines.push(`Run: ${runDirAbs}`);
  lines.push(`Groundtruth: ${gtFilePath}`);
  lines.push(
    `Counts: GT=${result.counts.gt}, Pred=${result.counts.pred}, TP=${result.counts.tp}, FP=${result.counts.fp}, FN=${result.counts.fn}`,
  );
  lines.push(`Recall (TP/GT): ${result.recall.toFixed(4)} (${fmtPercent(result.recall)})`);
  lines.push(`False Positive Rate (FP/Pred): ${result.falsePositiveRate.toFixed(4)} (${fmtPercent(result.falsePositiveRate)})`);

  if (details) {
    lines.push('');
    lines.push(`Missing (FN, in GT but not Pred): ${result.missing.length}`);
    for (const p of result.missing) lines.push(`  - ${p}`);
    lines.push('');
    lines.push(`Extra (FP, in Pred but not GT): ${result.extra.length}`);
    for (const p of result.extra) lines.push(`  - ${p}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.app) throw new Error('Missing required option: --app <appName>');
  if (!args.runDir && !args.runId) throw new Error('Missing required option: --runDir <path> or --runId <runId>');
  if (args.runDir && args.runId) throw new Error('Please provide only one of: --runDir or --runId');

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : await findRepoRoot(process.cwd());
  const groundtruthDirAbs = toAbs(repoRoot, args.groundtruthDir ?? path.join(repoRoot, 'groundtruth', 'permission'));

  const runDirAbs = args.runDir ? toAbs(repoRoot, args.runDir) : await resolveRunIdToOutputDir(repoRoot, args.runId);
  const gtFilePath = path.join(groundtruthDirAbs, `${args.app}.txt`);

  const [gt, pred] = await Promise.all([loadGroundtruthFile(gtFilePath), collectPredictedPermissionsFromRun(runDirAbs)]);
  const result = evaluatePermissionSets(gt, pred);

  if (args.format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          app: args.app,
          runDir: runDirAbs,
          groundtruthFile: gtFilePath,
          ...result,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(renderText(result, args.app, runDirAbs, gtFilePath, Boolean(args.details)));
}

main().catch((error) => {
  process.stderr.write(`${String((error as any)?.stack ?? error)}\n`);
  process.exitCode = 1;
});
