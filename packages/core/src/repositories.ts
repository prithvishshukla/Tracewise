import path from 'node:path';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { callSites, detectedDependencies, indexedFiles, providers, repositories, repositoryScans } from '@tracewise/database';
import {
  cloneRepository,
  parseGitUrl,
  redactSecrets,
  resolveAllowedDirectory,
  scanRepository,
  UnsafeGitUrlError,
  UnsafePathError,
} from '@tracewise/scanner';
import type { CoreContext } from './context';
import { audit } from './audit';
import { AppError, NonRetryableError } from './errors';

export async function registerRepository(ctx: CoreContext, input: { name?: string; sourceType: 'local' | 'git'; location: string }) {
  let location: string;
  let defaultName: string;
  try {
    if (input.sourceType === 'local') {
      location = await resolveAllowedDirectory(input.location, ctx.config.scan.roots);
      defaultName = path.basename(location);
    } else {
      const url = parseGitUrl(input.location, ctx.config.scan.gitAllowedHosts);
      location = `https://${url.hostname}${url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`;
      defaultName = location.split('/').slice(-2).join('/');
    }
  } catch (e) {
    if (e instanceof UnsafePathError || e instanceof UnsafeGitUrlError) throw AppError.unsafe(e.message);
    throw e;
  }
  const [existing] = await ctx.db.select().from(repositories).where(eq(repositories.location, location)).limit(1);
  if (existing) throw AppError.conflict('This repository is already registered', { id: existing.id });
  const [repo] = await ctx.db
    .insert(repositories)
    .values({ name: input.name ?? defaultName, sourceType: input.sourceType, location })
    .returning();
  await audit(ctx.db, 'repository.registered', 'repository', repo!.id, { sourceType: input.sourceType });
  return repo!;
}

const ACTIVE_WINDOW_MS = 30 * 60_000;

/** Creates a queued scan and enqueues it. If a scan is already queued or running, that scan is returned instead. */
export async function startScan(ctx: CoreContext, repositoryId: string) {
  const [repo] = await ctx.db.select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
  if (!repo) throw AppError.notFound('Repository');
  const [active] = await ctx.db
    .select()
    .from(repositoryScans)
    .where(
      and(
        eq(repositoryScans.repositoryId, repositoryId),
        inArray(repositoryScans.status, ['queued', 'running']),
        gte(repositoryScans.createdAt, new Date(Date.now() - ACTIVE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(repositoryScans.createdAt))
    .limit(1);
  if (active) return { scan: active, deduplicated: true };
  const [scan] = await ctx.db.insert(repositoryScans).values({ repositoryId, status: 'queued' }).returning();
  await audit(ctx.db, 'scan.requested', 'repository', repositoryId, { scanId: scan!.id });
  try {
    await ctx.dispatcher.enqueue('repository-scan', { scanId: scan!.id }, { jobId: `scan-${scan!.id}` });
  } catch (e) {
    await ctx.db
      .update(repositoryScans)
      .set({ status: 'failed', error: `Could not enqueue scan: ${(e as Error).message}`, finishedAt: new Date() })
      .where(eq(repositoryScans.id, scan!.id));
    throw AppError.conflict('Could not enqueue the scan job. Is Redis running? (QUEUE_MODE=inline avoids Redis)');
  }
  const [fresh] = await ctx.db.select().from(repositoryScans).where(eq(repositoryScans.id, scan!.id)).limit(1);
  return { scan: fresh!, deduplicated: false };
}

const CHUNK = 400;
const chunks = <T>(a: T[]): T[][] => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

/** Executes a scan: validates the target again, scans without running code, replaces the repository's index, queues matching. */
export async function runScan(ctx: CoreContext, scanId: string): Promise<Record<string, unknown>> {
  const [scan] = await ctx.db.select().from(repositoryScans).where(eq(repositoryScans.id, scanId)).limit(1);
  if (!scan) throw new NonRetryableError(`Scan ${scanId} not found`);
  const [repo] = await ctx.db.select().from(repositories).where(eq(repositories.id, scan.repositoryId)).limit(1);
  if (!repo) throw new NonRetryableError('Repository not found');
  await ctx.db.update(repositoryScans).set({ status: 'running', startedAt: new Date(), error: null }).where(eq(repositoryScans.id, scanId));

  let cleanup: (() => Promise<void>) | undefined;
  try {
    let rootDir: string;
    if (repo.sourceType === 'local') {
      rootDir = await resolveAllowedDirectory(repo.location, ctx.config.scan.roots);
    } else {
      const clone = await cloneRepository(repo.location, {
        allowedHosts: ctx.config.scan.gitAllowedHosts,
        maxBytes: ctx.config.scan.maxTotalBytes * 4,
      });
      rootDir = clone.dir;
      cleanup = clone.cleanup;
    }
    const providerRows = await ctx.db.select().from(providers);
    const idBySlug = new Map(providerRows.map((p) => [p.slug, p.id]));
    const result = await scanRepository({
      rootDir,
      providers: providerRows.map((p) => p.config),
      limits: {
        maxFiles: ctx.config.scan.maxFiles,
        maxFileBytes: ctx.config.scan.maxFileBytes,
        maxTotalBytes: ctx.config.scan.maxTotalBytes,
        timeoutMs: ctx.config.scan.timeoutMs,
      },
    });

    await ctx.db.transaction(async (tx) => {
      // The index holds the latest scan only; findings keep their own copy of file/line/snippet and survive this replace.
      await tx.delete(callSites).where(eq(callSites.repositoryId, repo.id));
      await tx.delete(indexedFiles).where(eq(indexedFiles.repositoryId, repo.id));
      await tx.delete(detectedDependencies).where(eq(detectedDependencies.repositoryId, repo.id));
      for (const part of chunks(result.files)) {
        await tx.insert(indexedFiles).values(
          part.map((f) => ({
            repositoryId: repo.id,
            scanId,
            path: f.path,
            language: f.language,
            sizeBytes: f.sizeBytes,
            sha256: f.sha256,
          })),
        );
      }
      for (const part of chunks(result.dependencies)) {
        await tx
          .insert(detectedDependencies)
          .values(
            part.map((d) => ({
              repositoryId: repo.id,
              scanId,
              providerId: idBySlug.get(d.providerSlug) ?? null,
              packageName: d.packageName,
              versionSpec: d.versionSpec,
              resolvedVersion: d.resolvedVersion,
              ecosystem: d.ecosystem,
              manifestPath: d.manifestPath,
              manifestLine: d.manifestLine,
              source: d.source,
              confidence: d.confidence,
            })),
          )
          .onConflictDoNothing();
      }
      for (const part of chunks(result.callSites.filter((c) => idBySlug.has(c.providerSlug)))) {
        await tx.insert(callSites).values(
          part.map((c) => ({
            repositoryId: repo.id,
            scanId,
            providerId: idBySlug.get(c.providerSlug)!,
            filePath: c.filePath,
            line: c.line,
            symbol: c.symbol,
            kind: c.kind,
            snippet: c.snippet,
            snippetStartLine: c.snippetStartLine,
            detectionMethod: c.detectionMethod,
            confidence: c.confidence,
            resolved: c.resolved,
            fileHash: c.fileHash,
            metadata: c.metadata,
          })),
        );
      }
      await tx
        .update(repositoryScans)
        .set({
          status: 'succeeded',
          finishedAt: new Date(),
          filesIndexed: result.files.length,
          dependenciesCount: result.dependencies.length,
          callSitesCount: result.callSites.length,
          warnings: result.warnings,
          stats: result.stats as unknown as Record<string, unknown>,
        })
        .where(eq(repositoryScans.id, scanId));
      await tx.update(repositories).set({ lastScanAt: new Date() }).where(eq(repositories.id, repo.id));
    });
    await ctx.dispatcher.enqueue('finding-generation', { repositoryId: repo.id, scanId }, { jobId: `findgen-scan-${scanId}` });
    return {
      filesIndexed: result.files.length,
      dependencies: result.dependencies.length,
      callSites: result.callSites.length,
      warnings: result.warnings.length,
    };
  } catch (e) {
    const message = redactSecrets((e as Error).message).slice(0, 500);
    await ctx.db
      .update(repositoryScans)
      .set({ status: 'failed', finishedAt: new Date(), error: message })
      .where(eq(repositoryScans.id, scanId));
    if (e instanceof UnsafePathError || e instanceof UnsafeGitUrlError) throw new NonRetryableError(message);
    throw e;
  } finally {
    await cleanup?.();
  }
}

export async function latestSucceededScans(ctx: Pick<CoreContext, 'db'>, repoIds: string[]): Promise<Map<string, string>> {
  if (repoIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: repositoryScans.id, repositoryId: repositoryScans.repositoryId })
    .from(repositoryScans)
    .where(and(inArray(repositoryScans.repositoryId, repoIds), eq(repositoryScans.status, 'succeeded')))
    .orderBy(desc(repositoryScans.createdAt));
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.repositoryId)) map.set(r.repositoryId, r.id);
  return map;
}
