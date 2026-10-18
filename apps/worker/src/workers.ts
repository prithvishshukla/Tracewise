import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { providerSources } from '@tracewise/database';
import {
  createHandlers,
  DEFAULT_JOB_OPTIONS,
  type JobHandlers,
  getSettings,
  NonRetryableError,
  QUEUE_NAMES,
  upsertJobRecord,
  type QueueName,
  type Runtime,
} from '@tracewise/core';

const CONCURRENCY: Record<QueueName, number> = {
  'repository-scan': 2,
  'provider-poll': 4,
  'change-processing': 4,
  'finding-generation': 2,
  notifications: 4,
};

export interface WorkerHandle {
  workers: Worker[];
  close: () => Promise<void>;
}

/** Starts one BullMQ worker per queue. Failures are recorded in job_records; non-retryable errors skip the retry policy. */
export function startWorkers(rt: Runtime, overrides: Partial<JobHandlers> = {}): WorkerHandle {
  const { ctx, redis } = rt;
  if (!redis) throw new Error('Worker requires QUEUE_MODE=bullmq (a Redis connection)');
  const handlers = { ...createHandlers(ctx), ...overrides } as JobHandlers;
  const workers = QUEUE_NAMES.map((name) => {
    const w = new Worker(
      name,
      async (job: Job) => {
        try {
          return (await (handlers[name] as (p: unknown) => Promise<unknown>)(job.data)) ?? {};
        } catch (e) {
          if (e instanceof NonRetryableError) throw new UnrecoverableError(e.message);
          throw e;
        }
      },
      { connection: redis, concurrency: CONCURRENCY[name] },
    );
    const base = (job: Job) => ({ queue: name, jobId: String(job.id), name });
    // Job-record writes for one job are chained so events cannot land out of order (e.g. 'queued' after 'completed').
    const chain = new Map<string, Promise<unknown>>();
    const record = (job: Job, rec: Parameters<typeof upsertJobRecord>[1]) => {
      const key = String(job.id);
      const next = (chain.get(key) ?? Promise.resolve())
        .then(() => upsertJobRecord(ctx.db, rec))
        .catch((e) => ctx.logger.warn({ err: (e as Error).message }, 'job record write failed'));
      chain.set(key, next);
      void next.finally(() => {
        if (chain.get(key) === next) chain.delete(key);
      });
    };
    w.on('active', (job) =>
      record(job, { ...base(job), status: 'active', attempts: job.attemptsMade + 1, payload: job.data, startedAt: new Date() }),
    );
    w.on('completed', (job, result) =>
      record(job, {
        ...base(job),
        status: 'completed',
        attempts: job.attemptsMade + 1,
        result: (result ?? {}) as Record<string, unknown>,
        finishedAt: new Date(),
      }),
    );
    w.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
      ctx.logger.error({ queue: name, jobId: job.id, attempt: job.attemptsMade, final, err: err.message }, 'job failed');
      record(job, {
        ...base(job),
        status: final ? 'failed' : 'queued',
        attempts: job.attemptsMade,
        error: err.message.slice(0, 500),
        finishedAt: final ? new Date() : null,
      });
    });
    w.on('error', (err) => ctx.logger.warn({ queue: name, err: err.message }, 'worker error'));
    return w;
  });
  return {
    workers,
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}

/** Registers a repeatable poll job per live source. The handler skips them while live polling is disabled in settings. */
export async function schedulePolling(rt: Runtime): Promise<number> {
  const { ctx, redis } = rt;
  const settings = await getSettings(ctx.db, ctx.config);
  const queue = new Queue('provider-poll', { connection: redis!, defaultJobOptions: DEFAULT_JOB_OPTIONS['provider-poll'] });
  const sources = await ctx.db.select().from(providerSources).where(eq(providerSources.origin, 'live'));
  for (const s of sources.filter((x) => x.enabled)) {
    await queue.upsertJobScheduler(
      `poll-schedule-${s.id}`,
      { every: settings.monitoring.pollIntervalMinutes * 60_000 },
      { name: 'provider-poll', data: { sourceId: s.id } },
    );
  }
  await queue.close();
  return sources.filter((x) => x.enabled).length;
}
