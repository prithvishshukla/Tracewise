import { and, desc, eq } from 'drizzle-orm';
import { changeEvents, providerSources, providers, sourceSnapshots } from '@tracewise/database';
import {
  FetchError,
  interpretSnapshot,
  politeFetch,
  readFixture,
  sha256,
  snapshotContent,
  FIXTURE_SCHEME,
  type NormalizedChange,
  type SourceInfo,
} from '@tracewise/providers';
import { redactSecrets } from '@tracewise/scanner';
import type { CoreContext } from './context';
import { NonRetryableError } from './errors';
import { getSettings } from './settings';

export type PollOutcome = 'skipped' | 'not_modified' | 'unchanged' | 'changed';
export interface PollResult {
  outcome: PollOutcome;
  snapshotId?: string;
  reason?: string;
}

const MAX_SNAPSHOT_BYTES = 2_000_000;

async function loadSource(ctx: CoreContext, sourceId: string) {
  const [row] = await ctx.db
    .select({ source: providerSources, provider: providers })
    .from(providerSources)
    .innerJoin(providers, eq(providers.id, providerSources.providerId))
    .where(eq(providerSources.id, sourceId))
    .limit(1);
  if (!row) throw new NonRetryableError(`Source ${sourceId} not found`);
  return row;
}

async function recordFailure(ctx: CoreContext, sourceId: string, message: string, failures: number) {
  await ctx.db
    .update(providerSources)
    .set({ lastCheckedAt: new Date(), lastError: redactSecrets(message).slice(0, 500), consecutiveFailures: failures + 1 })
    .where(eq(providerSources.id, sourceId));
}

/**
 * Fetches one source and, if its content changed, stores a snapshot and enqueues change-processing.
 * Unchanged content (same hash or HTTP 304) creates nothing. Failures are recorded on the source and re-thrown
 * so the queue's retry/backoff policy applies; a failed check is never reported as successful.
 */
export async function pollSource(ctx: CoreContext, sourceId: string): Promise<PollResult> {
  const { source, provider } = await loadSource(ctx, sourceId);
  if (!source.enabled) return { outcome: 'skipped', reason: 'source disabled' };
  const settings = await getSettings(ctx.db, ctx.config);
  if (source.origin === 'live' && !settings.monitoring.livePollingEnabled)
    return { outcome: 'skipped', reason: 'live polling is disabled' };

  let raw: string;
  let etag: string | null | undefined;
  let lastModified: string | null | undefined;
  try {
    if (source.url.startsWith(FIXTURE_SCHEME)) {
      raw = await readFixture(source.url, ctx.config.fixturesDir);
    } else {
      const res = await politeFetch(source.url, {
        timeoutMs: ctx.config.monitoring.fetchTimeoutMs,
        userAgent: ctx.config.monitoring.userAgent,
        allowPrivate: ctx.config.monitoring.allowPrivateHosts,
        etag: source.etag,
        lastModified: source.lastModified,
      });
      if (res.status === 304) {
        await ctx.db
          .update(providerSources)
          .set({ lastCheckedAt: new Date(), lastSuccessAt: new Date(), lastError: null, consecutiveFailures: 0 })
          .where(eq(providerSources.id, sourceId));
        return { outcome: 'not_modified' };
      }
      raw = res.body ?? '';
      etag = res.etag;
      lastModified = res.lastModified;
    }
  } catch (e) {
    await recordFailure(ctx, sourceId, (e as Error).message, source.consecutiveFailures);
    if (e instanceof FetchError && !e.retryable) throw new NonRetryableError((e as Error).message);
    throw e;
  }
  return storeSnapshot(ctx, { source, providerSlug: provider.slug }, raw, { etag, lastModified });
}

/** Stores raw content for a source (shared by polling and the demo seed). Idempotent by content hash. */
export async function storeSnapshot(
  ctx: CoreContext,
  ref: { source: typeof providerSources.$inferSelect; providerSlug: string },
  raw: string,
  meta: { etag?: string | null; lastModified?: string | null } = {},
): Promise<PollResult> {
  const { source } = ref;
  let content: string;
  try {
    content = snapshotContent(source.kind, raw);
    if (Buffer.byteLength(content) > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
  } catch (e) {
    await recordFailure(ctx, source.id, `Could not normalize content: ${(e as Error).message}`, source.consecutiveFailures);
    throw new NonRetryableError(`Could not normalize content: ${(e as Error).message}`);
  }
  const hash = sha256(content);
  const now = new Date();
  if (hash === source.lastContentHash) {
    await ctx.db
      .update(providerSources)
      .set({
        lastCheckedAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        etag: meta.etag ?? source.etag,
        lastModified: meta.lastModified ?? source.lastModified,
      })
      .where(eq(providerSources.id, source.id));
    return { outcome: 'unchanged' };
  }
  const [prev] = await ctx.db
    .select({ id: sourceSnapshots.id })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.sourceId, source.id))
    .orderBy(desc(sourceSnapshots.fetchedAt))
    .limit(1);
  const [inserted] = await ctx.db
    .insert(sourceSnapshots)
    .values({
      sourceId: source.id,
      contentHash: hash,
      content,
      sizeBytes: Buffer.byteLength(content),
      previousSnapshotId: prev?.id ?? null,
    })
    .onConflictDoNothing({ target: [sourceSnapshots.sourceId, sourceSnapshots.contentHash] })
    .returning({ id: sourceSnapshots.id });
  let snapshotId = inserted?.id;
  if (!snapshotId) {
    const [existing] = await ctx.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(and(eq(sourceSnapshots.sourceId, source.id), eq(sourceSnapshots.contentHash, hash)))
      .limit(1);
    snapshotId = existing?.id;
  }
  await ctx.db
    .update(providerSources)
    .set({
      lastContentHash: hash,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: null,
      consecutiveFailures: 0,
      etag: meta.etag ?? null,
      lastModified: meta.lastModified ?? null,
    })
    .where(eq(providerSources.id, source.id));
  await ctx.dispatcher.enqueue('change-processing', { snapshotId: snapshotId! }, { jobId: `process-${snapshotId}` });
  return { outcome: 'changed', snapshotId };
}

export interface ProcessResult {
  created: number;
  duplicates: number;
  eventIds: string[];
}

/** Interprets a stored snapshot into change events. Safe to re-run: events dedupe on their fingerprint. */
export async function processSnapshot(ctx: CoreContext, snapshotId: string): Promise<ProcessResult> {
  const [row] = await ctx.db
    .select({ snap: sourceSnapshots, source: providerSources, provider: providers })
    .from(sourceSnapshots)
    .innerJoin(providerSources, eq(providerSources.id, sourceSnapshots.sourceId))
    .innerJoin(providers, eq(providers.id, providerSources.providerId))
    .where(eq(sourceSnapshots.id, snapshotId))
    .limit(1);
  if (!row) throw new NonRetryableError(`Snapshot ${snapshotId} not found`);
  const prev = row.snap.previousSnapshotId
    ? (
        await ctx.db
          .select({ content: sourceSnapshots.content })
          .from(sourceSnapshots)
          .where(eq(sourceSnapshots.id, row.snap.previousSnapshotId))
          .limit(1)
      )[0]
    : undefined;
  const info: SourceInfo = {
    providerSlug: row.provider.slug,
    kind: row.source.kind,
    url: row.source.url,
    label: row.source.label,
    origin: row.source.origin,
  };
  const roots = [...row.provider.config.sdk.js, ...row.provider.config.sdk.python].map((b) => b.root);
  let changes: NormalizedChange[];
  try {
    changes = await interpretSnapshot(info, row.snap.content, prev?.content ?? null, {
      providerRoots: [...new Set(roots)],
      extractor: ctx.extractor,
    });
  } catch (e) {
    throw new NonRetryableError(`Could not interpret snapshot: ${(e as Error).message}`);
  }
  const eventIds: string[] = [];
  let duplicates = 0;
  for (const c of changes) {
    const [ins] = await ctx.db
      .insert(changeEvents)
      .values({
        providerId: row.provider.id,
        sourceId: row.source.id,
        snapshotId,
        previousSnapshotId: row.snap.previousSnapshotId,
        fingerprint: c.fingerprint,
        title: c.title,
        summary: c.summary,
        changeType: c.changeType,
        severity: c.severity,
        affected: c.affected,
        effectiveAt: c.effectiveAt,
        publishedAt: c.publishedAt,
        sourceUrl: c.sourceUrl,
        detectionMethod: c.detectionMethod,
        confidence: c.confidence,
        evidence: c.evidence,
        origin: c.origin,
        remediation: c.remediation,
      })
      .onConflictDoNothing({ target: changeEvents.fingerprint })
      .returning({ id: changeEvents.id });
    if (ins) eventIds.push(ins.id);
    else duplicates++;
  }
  await ctx.db.update(sourceSnapshots).set({ processedAt: new Date() }).where(eq(sourceSnapshots.id, snapshotId));
  if (eventIds.length) await ctx.dispatcher.enqueue('finding-generation', { changeEventIds: eventIds });
  return { created: eventIds.length, duplicates, eventIds };
}
