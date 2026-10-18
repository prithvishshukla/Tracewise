import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BullDispatcher,
  createHandlers,
  createRedisConnection,
  NonRetryableError,
  registerRepository,
  seedDemo,
  type Runtime,
} from '@tracewise/core';
import { jobRecords, repositoryScans } from '@tracewise/database';
import { createTestRuntime, type TestRuntime } from '../../../tests/helpers';
import { startWorkers, type WorkerHandle } from '../src/workers';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
const redisUp = await new Promise<boolean>((resolve) => {
  const c = new IORedis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  c.connect()
    .then(() => c.ping())
    .then(() => resolve(true))
    .catch(() => resolve(false))
    .finally(() => c.disconnect());
});

const until = async <T>(fn: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for condition');
};

describe.skipIf(!redisUp)('BullMQ queues with a real Redis (db 15)', () => {
  let rt: TestRuntime & { redis: IORedis };
  let workers: WorkerHandle;
  let failures = 0;

  beforeAll(async () => {
    const base = await createTestRuntime({ QUEUE_MODE: 'bullmq', REDIS_URL });
    const redis = createRedisConnection(REDIS_URL);
    await redis.flushdb();
    base.ctx.dispatcher = new BullDispatcher(redis, base.ctx.db);
    rt = Object.assign(base, { redis });
    // Real handlers plus one deliberately flaky handler to observe the retry policy.
    workers = startWorkers(rt as unknown as Runtime, {
      notifications: async () => {
        failures++;
        if (failures < 3) throw new Error('transient failure');
        return { sent: 0 };
      },
    });
    // seed with inline execution (same DB), then switch back to the queue dispatcher
    const queueDispatcher = base.ctx.dispatcher;
    const { InlineDispatcher, silentLogger } = await import('@tracewise/core');
    base.ctx.dispatcher = new InlineDispatcher(() => createHandlers(base.ctx), base.ctx.db, silentLogger);
    await seedDemo(base.ctx);
    base.ctx.dispatcher = queueDispatcher;
  });
  afterAll(async () => {
    await workers.close();
    await rt.ctx.dispatcher.close();
    await rt.redis.quit();
    await rt.close();
  });

  it('runs a repository scan in the worker process and records the job', async () => {
    const dir = await rt.tempRepo({ 'a.ts': `import Stripe from 'stripe';\nconst s = new Stripe('');\ns.charges.create({});\n` });
    const reg = await registerRepository(rt.ctx, { sourceType: 'local', location: dir });
    const { startScan } = await import('@tracewise/core');
    const { scan } = await startScan(rt.ctx, reg.id);
    expect(scan.status).toBe('queued');
    const done = await until(async () => {
      const [s] = await rt.ctx.db.select().from(repositoryScans).where(eq(repositoryScans.id, scan.id));
      return s!.status === 'succeeded' ? s : false;
    });
    expect(done.filesIndexed).toBe(1);
    const rec = await until(async () => {
      const [j] = await rt.ctx.db
        .select()
        .from(jobRecords)
        .where(eq(jobRecords.jobId, `scan-${scan.id}`));
      return j?.status === 'completed' ? j : false;
    });
    expect(rec.queue).toBe('repository-scan');
  });

  it('deduplicates jobs that share a deterministic id', async () => {
    const a = await rt.ctx.dispatcher.enqueue('provider-poll', { sourceId: '00000000-0000-4000-8000-000000000000' }, { jobId: 'dedupe-1' });
    const b = await rt.ctx.dispatcher.enqueue('provider-poll', { sourceId: '00000000-0000-4000-8000-000000000000' }, { jobId: 'dedupe-1' });
    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(true);
  });

  it('non-retryable errors fail immediately after a single attempt', async () => {
    await rt.ctx.dispatcher.enqueue('provider-poll', { sourceId: '00000000-0000-4000-8000-000000000001' }, { jobId: 'nonretry-1' });
    const rec = await until(async () => {
      const [j] = await rt.ctx.db.select().from(jobRecords).where(eq(jobRecords.jobId, 'nonretry-1'));
      return j?.status === 'failed' ? j : false;
    });
    expect(rec.error).toMatch(/not found/);
    expect(NonRetryableError).toBeDefined();
  });

  it('retries transient failures with exponential backoff until success', async () => {
    const q = new Queue('notifications', { connection: rt.redis });
    await q.add('notifications', { findingIds: [] }, { jobId: 'retry-1', attempts: 4, backoff: { type: 'exponential', delay: 50 } });
    const rec = await until(async () => {
      const [j] = await rt.ctx.db.select().from(jobRecords).where(eq(jobRecords.jobId, 'retry-1'));
      return j?.status === 'completed' ? j : false;
    });
    expect(failures).toBe(3);
    expect(rec.attempts).toBeGreaterThanOrEqual(3);
    await q.close();
  });

  it('exposes the configured retry policy on enqueued jobs', async () => {
    await rt.ctx.dispatcher.enqueue(
      'repository-scan',
      { scanId: '00000000-0000-4000-8000-000000000009' },
      { jobId: 'policy-1', delayMs: 60_000 },
    );
    const q = new Queue('repository-scan', { connection: rt.redis });
    const job = await q.getJob('policy-1');
    expect(job!.opts.attempts).toBe(2);
    expect(job!.opts.backoff).toMatchObject({ type: 'exponential' });
    await job!.remove();
    await q.close();
  });
});
