import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectPredictedPermissionsFromRun, evaluatePermissionSets } from '../src/eval/permissionGroundtruthEval.js';

describe('permission groundtruth evaluation', () => {
  it('computes TP/FP/FN, recall and FP/Pred', () => {
    const gt = new Set(['ohos.permission.A', 'ohos.permission.B', 'ohos.permission.C']);
    const pred = new Set(['ohos.permission.A', 'ohos.permission.C', 'ohos.permission.D']);
    const res = evaluatePermissionSets(gt, pred);
    expect(res.counts).toEqual({ gt: 3, pred: 3, tp: 2, fp: 1, fn: 1 });
    expect(res.recall).toBeCloseTo(2 / 3, 6);
    expect(res.falsePositiveRate).toBeCloseTo(1 / 3, 6);
    expect(res.missing).toEqual(['ohos.permission.B']);
    expect(res.extra).toEqual(['ohos.permission.D']);
  });

  it('handles empty GT', () => {
    const res = evaluatePermissionSets(new Set(), new Set());
    expect(res.recall).toBe(1);
    expect(res.falsePositiveRate).toBe(0);
    expect(res.counts).toEqual({ gt: 0, pred: 0, tp: 0, fp: 0, fn: 0 });
  });

  it('handles empty Pred', () => {
    const res = evaluatePermissionSets(new Set(['ohos.permission.A']), new Set());
    expect(res.recall).toBe(0);
    expect(res.falsePositiveRate).toBe(0);
    expect(res.counts).toEqual({ gt: 1, pred: 0, tp: 0, fp: 0, fn: 1 });
  });

  it('collects predicted permissions from privacy_facts.json', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cx-oh-run-'));
    const runDir = path.join(repoRoot, 'output', 'App', 'run1');
    const factsDir = path.join(runDir, 'pages', 'P1', 'features', 'F1');
    await fs.mkdir(factsDir, { recursive: true });

    await fs.writeFile(
      path.join(factsDir, 'privacy_facts.json'),
      JSON.stringify(
        {
          meta: { runId: 'App_run1', featureId: 'F1', generatedAt: new Date().toISOString() },
          facts: {
            permissionPractices: [
              { permissionName: 'ohos.permission.INTERNET（可选）' },
              { permissionName: '未识别' },
              { permissionName: 'some text with ohos.permission.GET_NETWORK_INFO inside' },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const perms = await collectPredictedPermissionsFromRun(runDir);
    expect([...perms].sort()).toEqual(['ohos.permission.GET_NETWORK_INFO', 'ohos.permission.INTERNET']);
  });
});

