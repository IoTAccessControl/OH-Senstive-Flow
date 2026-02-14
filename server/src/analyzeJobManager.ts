import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

import type { AnalyzeResponse } from './analyzer/types.js';

export type AnalyzeJobStatus = 'running' | 'done' | 'error';

export type AnalyzeJobSnapshot = {
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

export class AnalyzeJobManager {
  private jobs = new Map<string, AnalyzeJobInternal>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  hasRunningJob(): boolean {
    for (const job of this.jobs.values()) {
      if (job.snapshot.status === 'running') return true;
    }
    return false;
  }

  createJob(): AnalyzeJobSnapshot {
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

  getJob(jobId: string): AnalyzeJobSnapshot | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job.snapshot } : null;
  }

  addSubscriber(jobId: string, res: Response): (() => void) | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.subscribers.add(res);
    return () => {
      job.subscribers.delete(res);
    };
  }

  updateJob(
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

  completeJob(jobId: string, result: AnalyzeResponse): AnalyzeJobSnapshot | null {
    const snapshot = this.updateJob(
      jobId,
      {
        status: 'done',
        stage: '完成',
        percent: 100,
        result,
        error: undefined,
      },
      { broadcast: true },
    );
    const job = this.jobs.get(jobId);
    if (job) this.endAllSubscribers(job);
    return snapshot;
  }

  failJob(jobId: string, error: string): AnalyzeJobSnapshot | null {
    const snapshot = this.updateJob(
      jobId,
      {
        status: 'error',
        error: error || '分析失败',
      },
      { broadcast: true },
    );
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

