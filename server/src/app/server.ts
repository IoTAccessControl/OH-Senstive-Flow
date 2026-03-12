import cors from 'cors';
import express, { type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { AnalyzeResponse } from './run.js';
import { listRunRegistry, readResultJson, runAnalysis } from './run.js';
import { normalizeWorkspaceSubpath, resolveSafeWorkspaceChild } from '../utils/accessWorkspace.js';

type AnalyzeJobStatus = 'running' | 'done' | 'error';

type AnalyzeJobSnapshot = {
  jobId: string;
  status: AnalyzeJobStatus;
  stage: string;
  percent: number;
  result?: AnalyzeResponse;
  error?: string;
};

type AnalyzeJobInternal = {
  snapshot: AnalyzeJobSnapshot;
  subscribers: Set<Response>;
  updatedAt: number;
};

const JOB_TTL_MS = 60 * 60 * 1000;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function toSseDataLine(snapshot: AnalyzeJobSnapshot): string {
  return `data: ${JSON.stringify(snapshot)}\n\n`;
}

class AnalyzeJobManager {
  private readonly jobs = new Map<string, AnalyzeJobInternal>();

  public constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  public hasRunningJob(): boolean {
    for (const job of this.jobs.values()) {
      if (job.snapshot.status === 'running') return true;
    }
    return false;
  }

  public createJob(): AnalyzeJobSnapshot {
    const jobId = randomUUID();
    const snapshot: AnalyzeJobSnapshot = {
      jobId,
      status: 'running',
      stage: '任务已创建',
      percent: 0,
    };
    this.jobs.set(jobId, { snapshot, subscribers: new Set(), updatedAt: Date.now() });
    return { ...snapshot };
  }

  public getJob(jobId: string): AnalyzeJobSnapshot | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job.snapshot } : null;
  }

  public addSubscriber(jobId: string, res: Response): (() => void) | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.subscribers.add(res);
    return () => {
      job.subscribers.delete(res);
    };
  }

  public updateJob(
    jobId: string,
    patch: Partial<Omit<AnalyzeJobSnapshot, 'jobId'>>,
    options: { broadcast?: boolean } = {},
  ): AnalyzeJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const next: AnalyzeJobSnapshot = {
      ...job.snapshot,
      ...patch,
      percent: patch.percent === undefined ? job.snapshot.percent : clampPercent(patch.percent),
    };
    job.snapshot = next;
    job.updatedAt = Date.now();

    if (options.broadcast !== false) this.broadcast(job);
    return { ...next };
  }

  public completeJob(jobId: string, result: AnalyzeResponse): AnalyzeJobSnapshot | null {
    const snapshot = this.updateJob(
      jobId,
      { status: 'done', stage: '完成', percent: 100, result, error: undefined },
      { broadcast: true },
    );
    const job = this.jobs.get(jobId);
    if (job) this.endAllSubscribers(job);
    return snapshot;
  }

  public failJob(jobId: string, error: string): AnalyzeJobSnapshot | null {
    const snapshot = this.updateJob(jobId, { status: 'error', error: error || '分析失败' }, { broadcast: true });
    const job = this.jobs.get(jobId);
    if (job) this.endAllSubscribers(job);
    return snapshot;
  }

  private broadcast(job: AnalyzeJobInternal): void {
    const payload = toSseDataLine(job.snapshot);
    for (const res of job.subscribers) {
      try {
        res.write(payload);
      } catch {
        // ignore dead connections
      }
    }
  }

  private endAllSubscribers(job: AnalyzeJobInternal): void {
    for (const res of job.subscribers) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    job.subscribers.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.snapshot.status === 'running') continue;
      if (now - job.updatedAt < JOB_TTL_MS) continue;
      this.jobs.delete(jobId);
    }
  }
}

function resolveRepoRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), '..', '..', '..');
}

function assertSafeSlug(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`非法 ${label}=${value}`);
  return value;
}

async function sendResultJson(args: {
  repoRoot: string;
  reqQuery: Record<string, unknown>;
  res: Response;
  pathSegments: string[];
}): Promise<void> {
  const outputDir = typeof args.reqQuery.outputDir === 'string' ? args.reqQuery.outputDir : undefined;
  const runId = typeof args.reqQuery.runId === 'string' ? args.reqQuery.runId : undefined;
  const data = await readResultJson({
    repoRoot: args.repoRoot,
    outputDir,
    runId,
    pathSegments: args.pathSegments,
  });
  args.res.json(data);
}

export function startServer(): void {
  const repoRoot = resolveRepoRoot();
  const app = express();
  const analyzeJobs = new AnalyzeJobManager();

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/runs', async (_req, res) => {
    try {
      res.json(await listRunRegistry(repoRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/fs/roots', (_req, res) => {
    try {
      const wslDistroName = typeof process.env.WSL_DISTRO_NAME === 'string' ? process.env.WSL_DISTRO_NAME.trim() : '';
      res.json({
        ok: true,
        repoRoot,
        roots: {
          app: path.join(repoRoot, 'input', 'app'),
          sdk: path.join(repoRoot, 'input', 'sdk'),
          csv: path.join(repoRoot, 'input', 'csv'),
        },
        wslDistroName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get('/api/fs/dirs', async (req, res) => {
    try {
      const base = typeof req.query.base === 'string' ? req.query.base : '';
      if (base !== 'app' && base !== 'sdk' && base !== 'csv') throw new Error(`非法 base=${base}`);

      const rawRel = typeof req.query.path === 'string' ? req.query.path : '';
      const relNormalized = normalizeWorkspaceSubpath(rawRel);
      const baseDirRel =
        base === 'app' ? path.join('input', 'app') : base === 'sdk' ? path.join('input', 'sdk') : path.join('input', 'csv');
      const baseDirAbs = path.resolve(repoRoot, baseDirRel);
      const targetDirAbs = resolveSafeWorkspaceChild(baseDirAbs, relNormalized);

      const dirents = await fs.readdir(targetDirAbs, { withFileTypes: true });
      const entries = dirents
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

      res.json({
        ok: true,
        base,
        cwd: relNormalized,
        entries: entries.map((name) => ({ name, relPath: relNormalized ? `${relNormalized}/${name}` : name })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post('/api/analyze', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      const result = await runAnalysis({
        repoRoot,
        appPath: body.appPath as string | undefined,
        sdkPath: body.sdkPath as string | undefined,
        csvDir: body.csvDir as string | undefined,
        maxDataflowPaths: body.maxDataflowPaths as number | null | undefined,
        llmProvider: body.llmProvider as string | undefined,
        llmApiKey: body.llmApiKey as string | undefined,
        llmModel: body.llmModel as string | undefined,
        uiLlmProvider: body.uiLlmProvider as string | undefined,
        uiLlmApiKey: body.uiLlmApiKey as string | undefined,
        uiLlmModel: body.uiLlmModel as string | undefined,
        privacyReportLlmProvider: body.privacyReportLlmProvider as string | undefined,
        privacyReportLlmApiKey: body.privacyReportLlmApiKey as string | undefined,
        privacyReportLlmModel: body.privacyReportLlmModel as string | undefined,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post('/api/analyze/jobs', (req, res) => {
    try {
      if (analyzeJobs.hasRunningJob()) {
        res.status(409).json({ ok: false, error: '已有分析任务运行中，请稍后再试' });
        return;
      }

      const snapshot = analyzeJobs.createJob();
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

      void (async () => {
        try {
          const result = await runAnalysis(
            {
              repoRoot,
              appPath: body.appPath as string | undefined,
              sdkPath: body.sdkPath as string | undefined,
              csvDir: body.csvDir as string | undefined,
              maxDataflowPaths: body.maxDataflowPaths as number | null | undefined,
              llmProvider: body.llmProvider as string | undefined,
              llmApiKey: body.llmApiKey as string | undefined,
              llmModel: body.llmModel as string | undefined,
              uiLlmProvider: body.uiLlmProvider as string | undefined,
              uiLlmApiKey: body.uiLlmApiKey as string | undefined,
              uiLlmModel: body.uiLlmModel as string | undefined,
              privacyReportLlmProvider: body.privacyReportLlmProvider as string | undefined,
              privacyReportLlmApiKey: body.privacyReportLlmApiKey as string | undefined,
              privacyReportLlmModel: body.privacyReportLlmModel as string | undefined,
            },
            {
              onProgress: (progress) => {
                analyzeJobs.updateJob(snapshot.jobId, {
                  stage: progress.stage,
                  percent: progress.percent,
                  status: 'running',
                });
              },
            },
          );
          analyzeJobs.completeJob(snapshot.jobId, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          analyzeJobs.failJob(snapshot.jobId, message);
        }
      })();

      res.json({ ok: true, jobId: snapshot.jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.get('/api/analyze/jobs/:jobId', (req, res) => {
    try {
      const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
      if (!jobId) throw new Error('jobId 不能为空');
      const job = analyzeJobs.getJob(jobId);
      if (!job) {
        res.status(404).json({ ok: false, error: `未知 jobId=${jobId}` });
        return;
      }
      res.json({ ok: true, job });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.get('/api/analyze/jobs/:jobId/events', (req, res) => {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
    if (!jobId) {
      res.status(400).json({ ok: false, error: 'jobId 不能为空' });
      return;
    }

    if (!analyzeJobs.getJob(jobId)) {
      res.status(404).json({ ok: false, error: `未知 jobId=${jobId}` });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = analyzeJobs.addSubscriber(jobId, res);
    const latest = analyzeJobs.getJob(jobId);
    if (!unsubscribe || !latest) {
      res.end();
      return;
    }

    res.write(toSseDataLine(latest));
    if (latest.status !== 'running') {
      unsubscribe();
      res.end();
      return;
    }

    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }, 15_000);
    ping.unref();

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get('/api/results/sinks', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['sinks.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/sources', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['sources.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/callgraph', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['callgraph.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/dataflows', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['dataflows.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/ui_tree', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['ui_tree.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/pages', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['pages', 'index.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/pages/:pageId/features', async (req, res) => {
    try {
      const pageId = assertSafeSlug(String(req.params.pageId ?? ''), 'pageId');
      await sendResultJson({
        repoRoot,
        reqQuery: req.query as Record<string, unknown>,
        res,
        pathSegments: ['pages', pageId, 'features', 'index.json'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/pages/:pageId/features/:featureId/dataflows', async (req, res) => {
    try {
      const pageId = assertSafeSlug(String(req.params.pageId ?? ''), 'pageId');
      const featureId = assertSafeSlug(String(req.params.featureId ?? ''), 'featureId');
      await sendResultJson({
        repoRoot,
        reqQuery: req.query as Record<string, unknown>,
        res,
        pathSegments: ['pages', pageId, 'features', featureId, 'dataflows.json'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  app.get('/api/results/privacy_report', async (req, res) => {
    try {
      await sendResultJson({ repoRoot, reqQuery: req.query as Record<string, unknown>, res, pathSegments: ['privacy_report.json'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(404).json({ ok: false, error: message });
    }
  });

  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://localhost:${port}`);
  });
}

startServer();
