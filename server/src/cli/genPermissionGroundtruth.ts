import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureDir } from '../analyzer/io.js';
import { collectPermissionsFromApp } from '../eval/permissionGroundtruthEval.js';

type CliArgs = {
  repoRoot?: string;
  inputDir?: string;
  outDir?: string;
  app?: string;
  help?: boolean;
};

function usage(): string {
  return [
    'Generate permission groundtruth files for apps under input/app.',
    '',
    'Usage:',
    '  node --import tsx server/src/cli/genPermissionGroundtruth.ts [--app <appName>]',
    '',
    'Options:',
    '  --repoRoot <path>   Repo root (default: auto-detect)',
    '  --inputDir <path>   Apps directory (default: <repoRoot>/input/app)',
    '  --outDir <path>     Output directory (default: <repoRoot>/groundtruth/permission)',
    '  --app <name>        Only generate for one app',
    '  -h, --help          Show help',
    '',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
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
    else if (key === '--inputDir') out.inputDir = value;
    else if (key === '--outDir') out.outDir = value;
    else if (key === '--app') out.app = value;
    else throw new Error(`Unknown option: ${key}`);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : await findRepoRoot(process.cwd());
  const inputDirAbs = toAbs(repoRoot, args.inputDir ?? path.join(repoRoot, 'input', 'app'));
  const outDirAbs = toAbs(repoRoot, args.outDir ?? path.join(repoRoot, 'groundtruth', 'permission'));

  await ensureDir(outDirAbs);

  const entries = await fs.readdir(inputDirAbs, { withFileTypes: true });
  const apps = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => (args.app ? name === args.app : true))
    .sort((a, b) => a.localeCompare(b));

  if (apps.length === 0) throw new Error('No apps found to process.');

  for (const appName of apps) {
    const appDirAbs = path.join(inputDirAbs, appName);
    const perms = await collectPermissionsFromApp(appDirAbs);
    const lines = [...perms].sort((a, b) => a.localeCompare(b));
    const filePath = path.join(outDirAbs, `${appName}.txt`);
    await fs.writeFile(filePath, `${lines.join('\n')}${lines.length ? '\n' : ''}`, 'utf8');
    process.stdout.write(`Wrote ${filePath} (${lines.length} permissions)\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${String((error as any)?.stack ?? error)}\n`);
  process.exitCode = 1;
});
