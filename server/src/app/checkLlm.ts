import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLlmAvailability, type LlmCheckConfig } from '../llm/check.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

type Target = 'dataflow' | 'ui' | 'privacy-report';

function first(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? '';
}

function readTimeout(argv: string[]): number {
  const index = argv.indexOf('--timeoutMs');
  if (index < 0) return 15_000;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 1000) throw new Error('--timeoutMs 必须是不小于 1000 的数字');
  return Math.floor(value);
}

function readTarget(argv: string[]): Target | 'all' {
  const index = argv.indexOf('--target');
  if (index < 0) return 'all';
  const value = argv[index + 1];
  if (value === 'all' || value === 'dataflow' || value === 'ui' || value === 'privacy-report') return value;
  throw new Error('--target 必须是 all、dataflow、ui 或 privacy-report');
}

function configs(): Record<Target, LlmCheckConfig> {
  const shared = {
    provider: first(process.env.LLM_PROVIDER),
    apiKey: first(process.env.LLM_API_KEY),
    model: first(process.env.LLM_MODEL),
    baseUrl: first(process.env.LLM_BASE_URL) || undefined,
  };
  return {
    dataflow: shared,
    ui: {
      provider: first(process.env.UI_LLM_PROVIDER, shared.provider),
      apiKey: first(process.env.UI_LLM_API_KEY, shared.apiKey),
      model: first(process.env.UI_LLM_MODEL, shared.model),
      baseUrl: first(process.env.UI_LLM_BASE_URL) || undefined,
    },
    'privacy-report': {
      provider: first(process.env.PRIVACY_REPORT_LLM_PROVIDER, shared.provider),
      apiKey: first(process.env.PRIVACY_REPORT_LLM_API_KEY, shared.apiKey),
      model: first(process.env.PRIVACY_REPORT_LLM_MODEL, shared.model),
      baseUrl: first(process.env.PRIVACY_REPORT_LLM_BASE_URL) || undefined,
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write('Usage: npm run llm:check -- [--target all|dataflow|ui|privacy-report] [--timeoutMs 15000]\n');
    return;
  }

  const target = readTarget(argv);
  const timeoutMs = readTimeout(argv);
  const allConfigs = configs();
  const targets: Target[] = target === 'all' ? ['dataflow', 'ui', 'privacy-report'] : [target];
  const results = await Promise.all(
    targets.map(async (name) => ({ name, result: await checkLlmAvailability(allConfigs[name], timeoutMs) })),
  );

  for (const { name, result } of results) {
    const status = result.available ? '可用' : `不可用（${result.errorType}）`;
    process.stdout.write(`[${name}] ${status}，模型=${result.model || '未配置'}，耗时=${result.latencyMs}ms：${result.message}\n`);
  }
  if (results.some(({ result }) => !result.available)) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
