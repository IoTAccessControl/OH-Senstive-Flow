import cors from 'cors';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAnalysis } from './analyzer/runAnalysis.js';
import { readJsonFile } from './analyzer/io.js';
import { listRunRegistry, resolveRunIdToOutputDir } from './analyzer/runRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

app.get('/api/results/modules', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'modules', 'index.json');
    const data = await readJsonFile(filePath);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ ok: false, error: message });
  }
});

app.get('/api/results/modules/:moduleId/dataflows', async (req, res) => {
  try {
    const outputDirParam = typeof req.query.outputDir === 'string' ? req.query.outputDir : undefined;
    const runIdParam = typeof req.query.runId === 'string' ? req.query.runId : undefined;
    const repoRoot = path.resolve(__dirname, '..', '..');

    const moduleId = String(req.params.moduleId ?? '');
    if (!/^[A-Za-z0-9_-]+$/u.test(moduleId)) throw new Error(`非法 moduleId=${moduleId}`);

    const outputDir =
      outputDirParam ? path.resolve(repoRoot, outputDirParam) : await resolveRunIdToOutputDir(repoRoot, runIdParam);

    const filePath = path.join(outputDir, 'modules', moduleId, 'dataflows.json');
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
