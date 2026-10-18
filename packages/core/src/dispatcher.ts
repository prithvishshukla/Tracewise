import { randomUUID } from 'node:crypto';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { jobRecords, type Db } from '@tracewise/database';
import type { Logger } from './context';

export const QUEUE_NAMES = ['repository-scan', 'provider-poll', 'change-processing', 'finding-generation', 'notifications'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface JobPayloads {
  'repository-scan': { scanId: string };
  'provider-poll': { sourceId: string };
  'change-processing': { snapshotId: string };
  'finding-generation': { repositoryId?: string; changeEventIds?: string[]; scanId?: string };
  notifications: { findingIds: string[] };
}

export type JobHandlers = { [Q in QueueName]: (payload: JobPayloads[Q]) => Promise<Record<string, unknown> | void> };

export interface EnqueueOptions {
  /** Deterministic id: a second enqueue with the same id while the job still exists is deduplicated. */
  jobId?: string;
  delayMs?: number;
}
export interface EnqueueResult {
  jobId: string;
  deduplicated: boolean;
}

export interface JobDispatcher {
  enqueue<Q extends QueueName>(queue: Q, payload: JobPayloads[Q], opts?: EnqueueOptions): Promise<EnqueueResult>;
  close(): Promise<void>;
}

/** Retry policy: exponential backoff starting at 2s. Scan jobs retry less because they are expensive. */
export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  'repository-scan': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
  'provider-poll': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
  'change-processing': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
  'finding-generation': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
  notifications: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
};

export interface JobRecordInput {
  queue: string;
  jobId: string;
  name: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  attempts?: number;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export async function upsertJobRecord(db: Db, r: JobRecordInput): Promise<void> {
  const set: Record<string, unknown> = { status: r.status, name: r.name };
  if (r.attempts !== undefined) set.attempts = r.attempts;
  if (r.result !== undefined) set.result = r.result;
  if (r.error !== undefined) set.error = r.error;
  if (r.startedAt !== undefined) set.startedAt = r.startedAt;
  if (r.finishedAt !== undefined) set.finishedAt = r.finishedAt;
  await db
    .insert(jobRecords)
    .values({
      queue: r.queue,
      jobId: r.jobId,
      name: r.name,
      status: r.status,
      attempts: r.attempts ?? 0,
      payload: r.payload ?? {},
      result: r.result ?? null,
      error: r.error ?? null,
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
    })
    .onConflictDoUpdate({ target: [jobRecords.queue, jobRecords.jobId], set });
}

/** Runs jobs immediately in-process (QUEUE_MODE=inline). Used for tests and Docker-free demos. */
export class InlineDispatcher implements JobDispatcher {
  private seen = new Set<string>();
  constructor(
    private getHandlers: () => JobHandlers,
    private db: Db,
    private logger: Logger,
  ) {}

  async enqueue<Q extends QueueName>(queue: Q, payload: JobPayloads[Q], opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    const jobId = opts.jobId ?? `${queue}-${randomUUID()}`;
    if (opts.jobId && this.seen.has(`${queue}:${jobId}`)) return { jobId, deduplicated: true };
    this.seen.add(`${queue}:${jobId}`);
    const startedAt = new Date();
    await upsertJobRecord(this.db, {
      queue,
      jobId,
      name: queue,
      status: 'active',
      attempts: 1,
      payload: payload as Record<string, unknown>,
      startedAt,
    });
    try {
      const result = await (this.getHandlers()[queue] as (p: JobPayloads[Q]) => Promise<Record<string, unknown> | void>)(payload);
      await upsertJobRecord(this.db, {
        queue,
        jobId,
        name: queue,
        status: 'completed',
        result: (result ?? {}) as Record<string, unknown>,
        finishedAt: new Date(),
      });
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error({ queue, jobId, err: message }, 'inline job failed');
      await upsertJobRecord(this.db, { queue, jobId, name: queue, status: 'failed', error: message, finishedAt: new Date() });
    }
    return { jobId, deduplicated: false };
  }
  async close(): Promise<void> {}
}

export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

/** Enqueues into Redis-backed BullMQ queues; a separate worker process consumes them. */
export class BullDispatcher implements JobDispatcher {
  private queues = new Map<QueueName, Queue>();
  constructor(
    private connection: IORedis,
    private db: Db,
  ) {}

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue<Q extends QueueName>(queue: Q, payload: JobPayloads[Q], opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    const q = this.queue(queue);
    const jobId = opts.jobId ?? `${queue}-${randomUUID()}`;
    if (opts.jobId && (await q.getJob(jobId))) return { jobId, deduplicated: true };
    await q.add(queue, payload, { jobId, delay: opts.delayMs });
    await upsertJobRecord(this.db, { queue, jobId, name: queue, status: 'queued', payload: payload as Record<string, unknown> });
    return { jobId, deduplicated: false };
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
