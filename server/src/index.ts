import cors from 'cors';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAnalysis } from './analyzer/runAnalysis.js';
import { readJsonFile } from './analyzer/io.js';
import { listRunRegistry, resolveRunIdToOutputDir } from './analyzer/runRegistry.js';
import { AnalyzeJobManager } from './analyzeJobManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const analyzeJobs = new AnalyzeJobManager();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/runs', async (_req, res) => {
  try {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const runs = await listRunRegistry(repoRoot);
    res.json(runs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message });
  }
});

app.get('/api/fs/roots', async (_req, res) => {
  try {
    const repoRoot = path.resolve(__dirname, '..', '..');
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
    if (base !== 'app' && base !== 'sdk' && base !== 'csv') {
      throw new Error(`非法 base=${base}`);
    }

    const rawRel = typeof req.query.path === 'string' ? req.query.path : '';
    if (rawRel.includes('\0')) throw new Error('非法 path');

    const relNormalized = rawRel.replace(/\\/gu, '/').replace(/^\/+/u, '').replace(/\/+$/u, '');
    if (relNormalized.split('/').some((p) => p === '..')) throw new Error('path 不允许包含 ..');

    const repoRoot = path.resolve(__dirname, '..', '..');
    const baseDirRel =
      base === 'app' ? path.join('input', 'app') : base === 'sdk' ? path.join('input', 'sdk') : path.join('input', 'csv');
    const baseDirAbs = path.resolve(repoRoot, baseDirRel);

    const targetDirAbs = path.resolve(baseDirAbs, relNormalized);
    const relCheck = path.relative(baseDirAbs, targetDirAbs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error('path 越界');

    const dirents = await fs.readdir(targetDirAbs, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
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
    const {
      appPath,
      sdkPath,
      csvDir,
      maxDataflowPaths,
      llmProvider,
      llmApiKey,
      llmModel,
      uiLlmProvider,
      uiLlmApiKey,
      uiLlmModel,
      privacyReportLlmProvider,
      privacyReportLlmApiKey,
      privacyReportLlmModel,
    } = req.body ?? {};
    const result = await runAnalysis({
      appPath,
      sdkPath,
      csvDir,
      maxDataflowPaths,
      llmProvider,
      llmApiKey,
      llmModel,
      uiLlmProvider,
      uiLlmApiKey,
      uiLlmModel,
      privacyReportLlmProvider,
      privacyReportLlmApiKey,
      privacyReportLlmModel,
      repoRoot: path.resolve(__dirname, '..', '..'),
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
    const repoRoot = path.resolve(__dirname, '..', '..');

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

    void (async () => {
      try {
        const result = await runAnalysis(
          {
            appPath: body.appPath as any,
            sdkPath: body.sdkPath as any,
            csvDir: body.csvDir as any,
            maxDataflowPaths: body.maxDataflowPaths as any,
            llmProvider: body.llmProvider as any,
            llmApiKey: body.llmApiKey as any,
            llmModel: body.llmModel as any,
            uiLlmProvider: body.uiLlmProvider as any,
            uiLlmApiKey: body.uiLlmApiKey as any,
            uiLlmModel: body.uiLlmModel as any,
            privacyReportLlmProvider: body.privacyReportLlmProvider as any,
            privacyReportLlmApiKey: body.privacyReportLlmApiKey as any,
            privacyReportLlmModel: body.privacyReportLlmModel as any,
            repoRoot,
          },
          {
            onProgress: (p) => {
              analyzeJobs.updateJob(snapshot.jobId, { stage: p.stage, percent: p.percent, status: 'running' });
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

  res.write(`data: ${JSON.stringify(latest)}\n\n`);
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
    unsubscribe?.();
  });
});

app.get('/api/results/sinks', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const sinksPath = path.join(outputDir, 'sinks.json');
    const data = await readJsonFile(sinksPath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/sources', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const sourcesPath = path.join(outputDir, 'sources.json');
    const data = await readJsonFile(sourcesPath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/callgraph', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'callgraph.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/dataflows', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'dataflows.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/ui_tree', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'ui_tree.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/pages', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'pages', 'index.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/pages/:pageId/features', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const pageId = String(req.params.pageId ?? '');
    if (!/^[A-Za-z0-9_-]+$/u.test(pageId)) throw new Error(`非法 pageId=${pageId}`);

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'pages', pageId, 'features', 'index.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/pages/:pageId/features/:featureId/dataflows', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const pageId = String(req.params.pageId ?? '');
    const featureId = String(req.params.featureId ?? '');
    if (!/^[A-Za-z0-9_-]+$/u.test(pageId)) throw new Error(`非法 pageId=${pageId}`);
    if (!/^[A-Za-z0-9_-]+$/u.test(featureId)) throw new Error(`非法 featureId=${featureId}`);

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'pages', pageId, 'features', featureId, 'dataflows.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/privacy_report', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'privacy_report.json');
    const data = await readJsonFile(filePath);
    res.json(data);
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
