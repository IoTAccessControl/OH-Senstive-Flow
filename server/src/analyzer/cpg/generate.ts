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

export const WINDOWS_CREATE_PROCESS_LIMIT = 32767;
export const CPG_MAIN_CLASS = 'de.fraunhofer.aisec.cpg_vis_neo4j.ApplicationKt';
export const DEFAULT_JVM_OPTIONS = ['-Xss515m', '-Xmx8g'];
export const COMMAND_LENGTH_BUDGET = process.platform === 'win32' ? WINDOWS_CREATE_PROCESS_LIMIT - 2000 : 100_000;

export function cpgInstallDir(repoRoot: string): string {
  return path.join(repoRoot, 'lib', 'cpg', 'cpg-neo4j', 'build', 'install', 'cpg-neo4j');
}

export function resolveJavaExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const javaHome = String(env.JAVA_HOME ?? '').trim();
  if (javaHome) return path.join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java');
  return 'java';
}

export function buildCpgJavaArgs(
  installDir: string,
  extraArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const envOptions = `${env.JAVA_OPTS ?? ''} ${env.CPG_NEO4J_OPTS ?? ''}`.trim();
  const jvmOptions = [...DEFAULT_JVM_OPTIONS, ...(envOptions ? envOptions.split(/\s+/u) : [])];
  return [...jvmOptions, '-classpath', path.join(installDir, 'lib', '*'), CPG_MAIN_CLASS, ...extraArgs];
}

async function assertReadableDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    throw new Error(`未找到 CPG 工具（${dirPath}），请先在 lib/cpg 下执行 gradlew installDist`);
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`未生成 CPG 输出文件：${filePath}`);
  }
}

export function estimateCommandLength(binaryPath: string, args: string[]): number {
  return [binaryPath, ...args].reduce((sum, item) => sum + item.length + 1, 0);
}

export function shouldUseArgFile(javaPath: string, args: string[]): boolean {
  return estimateCommandLength(javaPath, args) > COMMAND_LENGTH_BUDGET;
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
      shell: false,
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
  const installDir = cpgInstallDir(options.repoRoot);
  await assertReadableDir(path.join(installDir, 'lib'));
  if (options.appFiles.length === 0) {
    throw new Error('未找到可用于生成 CPG 的 ArkTS 文件');
  }

  const outputPath = path.join(options.outputDirAbs, 'cpg.json');
  const javaPath = resolveJavaExecutable();
  const args = buildCpgJavaArgs(installDir, [
    '--no-neo4j',
    `--export-json=${outputPath}`,
    `--top-level=${options.appRootAbs}`,
    ...options.appFiles,
  ]);

  analysisLog(`CPG 开始：输入 ArkTS 文件 ${options.appFiles.length} 个（java 直调）`);
  const startedAt = Date.now();

  let argFilePath: string | null = null;
  let keepArgFile = false;
  let runArgs = args;
  if (shouldUseArgFile(javaPath, args)) {
    argFilePath = await writeArgFile(args);
    runArgs = [`@${argFilePath}`];
    analysisLog(
      `CPG 命令行约 ${estimateCommandLength(javaPath, args)} 字符，超过安全预算 ${COMMAND_LENGTH_BUDGET}，改用参数文件：${argFilePath}`,
    );
  }

  try {
    await runCommand(javaPath, runArgs, options.repoRoot);
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
