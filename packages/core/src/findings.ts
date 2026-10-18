import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { callSites, changeEvents, detectedDependencies, findings, providers, repositories, repositoryScans } from '@tracewise/database';
import { matchEvent, type Match, type MatcherCallSite, type MatcherDependency, type MatcherEvent } from '@tracewise/matcher';
import type { FindingStatus } from '@tracewise/shared';
import type { CoreContext } from './context';
import { audit } from './audit';
import { AppError } from './errors';
import { latestSucceededScans } from './repositories';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function reopenExpiredSnoozes(ctx: Pick<CoreContext, 'db'>): Promise<void> {
  await ctx.db
    .update(findings)
    .set({ status: 'open', snoozedUntil: null, statusChangedAt: new Date() })
    .where(and(eq(findings.status, 'snoozed'), isNotNull(findings.snoozedUntil), lt(findings.snoozedUntil, new Date())));
}

export interface GenerateResult {
  matched: number;
  created: number;
  updated: number;
  newFindingIds: string[];
}

/**
 * Matches change events against stored call sites and dependencies and upserts findings.
 * Findings are keyed by a fingerprint that excludes line numbers, so rescans update existing findings
 * (keeping their status) instead of duplicating them.
 */
export async function generateFindings(
  ctx: CoreContext,
  scope: { repositoryId?: string; changeEventIds?: string[]; scanId?: string },
): Promise<GenerateResult> {
  await reopenExpiredSnoozes(ctx);
  const repos = scope.repositoryId
    ? await ctx.db.select().from(repositories).where(eq(repositories.id, scope.repositoryId))
    : await ctx.db.select().from(repositories);
  const eventRows = await ctx.db
    .select({ ev: changeEvents, provider: providers })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .where(scope.changeEventIds ? inArray(changeEvents.id, scope.changeEventIds) : ne(changeEvents.changeType, 'informational'));
  const events: (MatcherEvent & { providerId: string })[] = eventRows
    .filter((r) => r.ev.affected.length > 0)
    .map((r) => ({
      id: r.ev.id,
      providerId: r.provider.id,
      providerSlug: r.provider.slug,
      providerHosts: r.provider.hosts,
      title: r.ev.title,
      changeType: r.ev.changeType,
      severity: r.ev.severity,
      affected: r.ev.affected,
      effectiveAt: r.ev.effectiveAt,
      sourceUrl: r.ev.sourceUrl,
      remediation: r.ev.remediation,
      evidence: r.ev.evidence,
      origin: r.ev.origin,
    }));
  const slugById = new Map((await ctx.db.select({ id: providers.id, slug: providers.slug }).from(providers)).map((p) => [p.id, p.slug]));
  const latest = await latestSucceededScans(
    ctx,
    repos.map((r) => r.id),
  );

  const result: GenerateResult = { matched: 0, created: 0, updated: 0, newFindingIds: [] };
  for (const repo of repos) {
    const lastScanId = latest.get(repo.id);
    if (!lastScanId || events.length === 0) continue;
    const sites: MatcherCallSite[] = (await ctx.db.select().from(callSites).where(eq(callSites.repositoryId, repo.id))).map((c) => ({
      id: c.id,
      providerSlug: slugById.get(c.providerId) ?? '',
      filePath: c.filePath,
      line: c.line,
      symbol: c.symbol,
      kind: c.kind,
      snippet: c.snippet,
      snippetStartLine: c.snippetStartLine,
      confidence: c.confidence,
      resolved: c.resolved,
      metadata: c.metadata,
    }));
    const deps: MatcherDependency[] = (
      await ctx.db.select().from(detectedDependencies).where(eq(detectedDependencies.repositoryId, repo.id))
    ).map((d) => ({
      id: d.id,
      providerSlug: slugById.get(d.providerId ?? '') ?? '',
      packageName: d.packageName,
      ecosystem: d.ecosystem,
      versionSpec: d.versionSpec,
      resolvedVersion: d.resolvedVersion,
      manifestPath: d.manifestPath,
      manifestLine: d.manifestLine,
      source: d.source,
    }));

    const rows: { fingerprint: string; ev: (typeof events)[number]; m: Match }[] = [];
    for (const ev of events) {
      const matches = matchEvent(ev, { callSites: sites, dependencies: deps });
      const seen = new Map<string, number>();
      for (const m of [...matches].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
        const n = seen.get(m.matchKey) ?? 0;
        seen.set(m.matchKey, n + 1);
        rows.push({ fingerprint: sha(`${repo.id}|${ev.id}|${m.matchKey}|${n}`), ev, m });
      }
    }
    result.matched += rows.length;
    if (rows.length === 0) continue;
    const existing = new Set(
      (
        await ctx.db
          .select({ f: findings.fingerprint })
          .from(findings)
          .where(
            inArray(
              findings.fingerprint,
              rows.map((r) => r.fingerprint),
            ),
          )
      ).map((r) => r.f),
    );
    for (const { fingerprint, ev, m } of rows) {
      const values = {
        fingerprint,
        repositoryId: repo.id,
        changeEventId: ev.id,
        providerId: ev.providerId,
        callSiteId: m.callSiteId,
        firstScanId: scope.scanId ?? lastScanId,
        lastSeenScanId: lastScanId,
        title: m.title,
        severity: m.severity,
        confidence: m.confidence,
        matchKind: m.kind,
        matchReason: m.reason,
        explanation: m.explanation,
        evidence: m.evidence,
        limitations: m.limitations,
        remediation: m.remediation,
        filePath: m.filePath,
        line: m.line,
        snippet: m.snippet,
        snippetStartLine: m.snippetStartLine,
      };
      const { firstScanId: _first, ...updatable } = values;
      const { fingerprint: _fp, repositoryId: _r, changeEventId: _c, providerId: _p, ...set } = updatable;
      const [row] = await ctx.db
        .insert(findings)
        .values(values)
        .onConflictDoUpdate({ target: findings.fingerprint, set: { ...set, updatedAt: new Date() } })
        .returning({ id: findings.id });
      if (existing.has(fingerprint)) result.updated++;
      else {
        result.created++;
        result.newFindingIds.push(row!.id);
      }
    }
  }
  if (scope.scanId)
    await ctx.db.update(repositoryScans).set({ findingsCreated: result.created }).where(eq(repositoryScans.id, scope.scanId));
  if (result.newFindingIds.length) await ctx.dispatcher.enqueue('notifications', { findingIds: result.newFindingIds });
  return result;
}

export async function updateFindingStatus(
  ctx: CoreContext,
  id: string,
  input: { status: FindingStatus; note?: string; snoozeDays?: number },
) {
  const now = new Date();
  const snoozedUntil = input.status === 'snoozed' ? new Date(now.getTime() + (input.snoozeDays ?? 7) * 86_400_000) : null;
  const [row] = await ctx.db
    .update(findings)
    .set({ status: input.status, statusNote: input.note ?? null, snoozedUntil, statusChangedAt: now })
    .where(eq(findings.id, id))
    .returning({ id: findings.id });
  if (!row) throw AppError.notFound('Finding');
  await audit(ctx.db, 'finding.status_changed', 'finding', id, { status: input.status, note: input.note ?? null });
  return row.id;
}
