import fs from 'node:fs/promises';
import path from 'node:path';

import { runAnalysis } from '../analyzer/runAnalysis.js';

type CliArgs = {
  repoRoot?: string;
  appRoot?: string;
  sdkPath?: string;
  csvDir?: string;
  llmApiKey?: string;
  llmProvider?: string;
  llmModel?: string;
  uiLlmApiKey?: string;
  uiLlmProvider?: string;
  uiLlmModel?: string;
  privacyReportLlmApiKey?: string;
  privacyReportLlmProvider?: string;
  privacyReportLlmModel?: string;
  summaryPath?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? '';
    if (!raw.startsWith('--')) throw new Error(`Unknown arg: ${raw}`);
    const eq = raw.indexOf('=');
    const key = eq > 0 ? raw.slice(0, eq) : raw;
    const value = eq > 0 ? raw.slice(eq + 1) : (argv[i + 1] ?? '');
    if (eq <= 0) i += 1;
    if (!value) throw new Error(`Missing value for ${key}`);

    if (key === '--repoRoot') out.repoRoot = value;
    else if (key === '--appRoot') out.appRoot = value;
    else if (key === '--sdkPath') out.sdkPath = value;
    else if (key === '--csvDir') out.csvDir = value;
    else if (key === '--llmApiKey') out.llmApiKey = value;
    else if (key === '--llmProvider') out.llmProvider = value;
    else if (key === '--llmModel') out.llmModel = value;
    else if (key === '--uiLlmApiKey') out.uiLlmApiKey = value;
    else if (key === '--uiLlmProvider') out.uiLlmProvider = value;
    else if (key === '--uiLlmModel') out.uiLlmModel = value;
    else if (key === '--privacyReportLlmApiKey') out.privacyReportLlmApiKey = value;
    else if (key === '--privacyReportLlmProvider') out.privacyReportLlmProvider = value;
    else if (key === '--privacyReportLlmModel') out.privacyReportLlmModel = value;
    else if (key === '--summaryPath') out.summaryPath = value;
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

async function listApps(appRoot: string): Promise<string[]> {
  const entries = await fs.readdir(appRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : await findRepoRoot(process.cwd());
  const appRoot = toAbs(repoRoot, args.appRoot ?? path.join('input', 'app'));
  const sdkPath = toAbs(repoRoot, args.sdkPath ?? path.join('input', 'sdk', 'default', 'openharmony', 'ets'));
  const csvDir = toAbs(repoRoot, args.csvDir ?? path.join('input', 'csv'));
  const llmApiKey = args.llmApiKey ?? '';
  const uiLlmApiKey = args.uiLlmApiKey ?? llmApiKey;
  const privacyReportLlmApiKey = args.privacyReportLlmApiKey ?? llmApiKey;
  const summaryPath = toAbs(repoRoot, args.summaryPath ?? path.join('output', '_batch_full_analysis_latest.json'));

  const apps = await listApps(appRoot);
  const summary: Array<Record<string, unknown>> = [];
  const startedAt = new Date();

  const writeSummary = async (finishedAt?: Date): Promise<void> => {
    await fs.writeFile(
      summaryPath,
      `${JSON.stringify(
        {
          startedAt,
          updatedAt: new Date(),
          finishedAt,
          apps: summary,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  };

  console.log(`[${new Date().toISOString()}] batch-start apps=${apps.length}`);
  await writeSummary();

  for (let i = 0; i < apps.length; i += 1) {
    const app = apps[i]!;
    const appPath = path.join(appRoot, app);
    const appStarted = Date.now();
    let lastStage = 'queued';

    console.log(`[${new Date().toISOString()}] app-start index=${i + 1}/${apps.length} app=${app}`);

    try {
      const result = await runAnalysis(
        {
          repoRoot,
          appPath,
          sdkPath,
          csvDir,
          llmProvider: args.llmProvider ?? 'Qwen',
          llmApiKey,
          llmModel: args.llmModel ?? 'qwen3.5-397b-a17b',
          uiLlmProvider: args.uiLlmProvider ?? 'Qwen',
          uiLlmApiKey,
          uiLlmModel: args.uiLlmModel ?? 'qwen3.5-27b',
          privacyReportLlmProvider: args.privacyReportLlmProvider ?? 'Qwen',
          privacyReportLlmApiKey,
          privacyReportLlmModel: args.privacyReportLlmModel ?? 'qwen3.5-27b',
        },
        {
          onProgress: ({ stage, percent }) => {
            if (stage === lastStage) return;
            lastStage = stage;
            console.log(`[${new Date().toISOString()}] app-progress app=${app} percent=${percent} stage=${stage}`);
          },
        },
      );

      const durationSec = Math.round((Date.now() - appStarted) / 1000);
      summary.push({
        app,
        status: 'ok',
        runId: result.runId,
        outputDir: result.outputDir,
        counts: result.counts,
        durationSec,
      });
      await writeSummary();
      console.log(
        `[${new Date().toISOString()}] app-done app=${app} runId=${result.runId} durationSec=${durationSec} counts=${JSON.stringify(result.counts)}`,
      );
    } catch (error) {
      const durationSec = Math.round((Date.now() - appStarted) / 1000);
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      summary.push({
        app,
        status: 'error',
        durationSec,
        error: message,
        lastStage,
      });
      await writeSummary();
      console.log(`[${new Date().toISOString()}] app-error app=${app} durationSec=${durationSec} lastStage=${lastStage} error=${message}`);
    }
  }

  await writeSummary(new Date());
  const okCount = summary.filter((item) => item.status === 'ok').length;
  const errorCount = summary.filter((item) => item.status === 'error').length;
  console.log(`[${new Date().toISOString()}] batch-done ok=${okCount} error=${errorCount}`);
}

main().catch((error) => {
  process.stderr.write(`${String((error as any)?.stack ?? error)}\n`);
  process.exitCode = 1;
});
