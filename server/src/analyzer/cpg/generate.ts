import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

type GenerateCpgJsonOptions = {
  repoRoot: string;
  appRootAbs: string;
  appFiles: string[];
  outputDirAbs: string;
};

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

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

  await runCommand(binaryPath, args, options.repoRoot);
  await assertReadableFile(outputPath);
  return outputPath;
}
