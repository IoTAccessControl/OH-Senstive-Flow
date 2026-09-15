import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analysisLog } from '../../utils/analysisLog.js';

type GenerateCpgJsonOptions = {
  repoRoot: string;
  appRootAbs: string;
  appFiles: string[];
  outputDirAbs: string;
};

/**
 * Windows `cmd.exe` 的命令行上限为 8191 字符（`.bat` 必须经 cmd 解释）。
 * 这里留出参数转义与 shell 包装的余量，超过预算时改用 picocli 参数文件（`@file`）传递参数。
 */
export const WINDOWS_COMMAND_LENGTH_LIMIT = 8191;
export const COMMAND_LENGTH_BUDGET = WINDOWS_COMMAND_LENGTH_LIMIT - 1200;

function cpgBinaryPath(repoRoot: string): string {
  const fileName = process.platform === 'win32' ? 'cpg-neo4j.bat' : 'cpg-neo4j';
  return path.join(repoRoot, 'lib', 'cpg', 'cpg-neo4j', 'build', 'install', 'cpg-neo4j', 'bin', fileName);
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`未找到 CPG 工具：${filePath}`);
  }
}

export function estimateCommandLength(binaryPath: string, args: string[]): number {
  return [binaryPath, ...args].reduce((sum, item) => sum + item.length + 1, 0);
}

export function shouldUseArgFile(binaryPath: string, args: string[]): boolean {
  if (process.platform !== 'win32') return false;
  return estimateCommandLength(binaryPath, args) > COMMAND_LENGTH_BUDGET;
}

/**
 * picocli 参数文件格式：按空白切分；含空白的值用双引号包裹，
 * 引号内 `\` 与 `"` 需要转义（Windows 路径的重复分隔符会被系统归一化）。
 */
export function serializeArgFile(args: string[]): string {
  const tokens = args.map((arg) => {
    if (!/[\s"]/u.test(arg)) return arg;
    return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  });
  return `${tokens.join('\n')}\n`;
}

async function writeArgFile(args: string[]): Promise<string> {
  const filePath = path.join(os.tmpdir(), `cpg-args-${process.pid}-${Date.now()}.txt`);
  await fs.writeFile(filePath, serializeArgFile(args), 'utf8');
  return filePath;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 16000) {
        stdout = stdout.slice(-16000);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 16000) {
        stderr = stderr.slice(-16000);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = stderr.trim() || stdout.trim() || `cpg-neo4j 退出码 ${code ?? 'unknown'}`;
      reject(new Error(message));
    });
  });
}

export async function generateCpgJson(options: GenerateCpgJsonOptions): Promise<string> {
  const binaryPath = cpgBinaryPath(options.repoRoot);
  await assertReadableFile(binaryPath);
  if (options.appFiles.length === 0) {
    throw new Error('未找到可用于生成 CPG 的 ArkTS 文件');
  }

  const outputPath = path.join(options.outputDirAbs, 'cpg.json');
  const args = ['--no-neo4j', `--export-json=${outputPath}`, `--top-level=${options.appRootAbs}`, ...options.appFiles];

  analysisLog(`CPG 开始：输入 ArkTS 文件 ${options.appFiles.length} 个`);
  const startedAt = Date.now();

  let argFilePath: string | null = null;
  let keepArgFile = false;
  let runArgs = args;
  if (shouldUseArgFile(binaryPath, args)) {
    argFilePath = await writeArgFile(args);
    runArgs = [`@${argFilePath}`];
    analysisLog(
      `CPG 命令行约 ${estimateCommandLength(binaryPath, args)} 字符，超过 Windows 安全预算 ${COMMAND_LENGTH_BUDGET}，改用参数文件：${argFilePath}`,
    );
  }

  try {
    await runCommand(binaryPath, runArgs, options.repoRoot);
  } catch (error) {
    keepArgFile = argFilePath !== null;
    if (argFilePath) {
      throw new Error(`${(error as Error).message}\n（CPG 参数文件已保留以便排查：${argFilePath}）`);
    }
    throw error;
  } finally {
    if (argFilePath && !keepArgFile) {
      await fs.rm(argFilePath, { force: true });
    }
  }

  await assertReadableFile(outputPath);
  const stat = await fs.stat(outputPath);
  analysisLog(`CPG 完成：${outputPath}（${stat.size} bytes，${Date.now() - startedAt}ms）`);
  return outputPath;
}
