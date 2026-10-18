import { and, count, desc, asc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  callSites,
  changeEvents,
  detectedDependencies,
  findings,
  indexedFiles,
  providers,
  providerSources,
  repositories,
  repositoryScans,
  type Db,
} from '@tracewise/database';
import {
  impactClass,
  SEVERITIES,
  type ChangeDetailDTO,
  type ChangeDTO,
  type DashboardStats,
  type DependencyDTO,
  type FindingDTO,
  type IndexedFileDTO,
  type MonitoringStatus,
  type Paginated,
  type ProviderDetailDTO,
  type ProviderDTO,
  type ProviderSourceDTO,
  type RepositoryDetailDTO,
  type RepositoryDTO,
  type ScanDTO,
  type Severity,
} from '@tracewise/shared';
import type { z } from 'zod';
import type { ChangesQuery, FindingsQuery } from '@tracewise/shared';
import { reopenExpiredSnoozes } from './findings';
import { latestSucceededScans } from './repositories';
import { AppError } from './errors';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
const page = <T>(items: T[], total: number, p: { page: number; pageSize: number }): Paginated<T> => ({
  items,
  total,
  page: p.page,
  pageSize: p.pageSize,
  totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
});
const sevRank = sql`case ${findings.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;

type EventRow = { ev: typeof changeEvents.$inferSelect; provider: typeof providers.$inferSelect };
function changeDTO(r: EventRow, findingCount?: number): ChangeDTO {
  const e = r.ev;
  return {
    id: e.id,
    providerId: e.providerId,
    providerSlug: r.provider.slug,
    providerName: r.provider.name,
    title: e.title,
    summary: e.summary,
    changeType: e.changeType,
    severity: e.severity,
    affected: e.affected,
    effectiveAt: iso(e.effectiveAt),
    publishedAt: iso(e.publishedAt),
    detectedAt: e.detectedAt.toISOString(),
    sourceUrl: e.sourceUrl,
    detectionMethod: e.detectionMethod,
    confidence: e.confidence,
    evidence: e.evidence,
    origin: e.origin,
    remediation: e.remediation,
    findingCount,
  };
}

type FindingRow = {
  f: typeof findings.$inferSelect;
  repo: typeof repositories.$inferSelect;
  provider: typeof providers.$inferSelect;
  ev: typeof changeEvents.$inferSelect;
};
function findingDTO(r: FindingRow, latest: Map<string, string>): FindingDTO {
  const f = r.f;
  return {
    id: f.id,
    title: f.title,
    providerSlug: r.provider.slug,
    providerName: r.provider.name,
    repositoryId: f.repositoryId,
    repositoryName: r.repo.name,
    changeEventId: f.changeEventId,
    changeTitle: r.ev.title,
    changeType: r.ev.changeType,
    changeOrigin: r.ev.origin,
    filePath: f.filePath,
    line: f.line,
    severity: f.severity,
    confidence: f.confidence,
    impact: impactClass(f.confidence),
    matchKind: f.matchKind,
    matchReason: f.matchReason,
    explanation: f.explanation,
    evidence: f.evidence,
    limitations: f.limitations,
    remediation: f.remediation,
    snippet: f.snippet,
    snippetStartLine: f.snippetStartLine,
    status: f.status,
    statusNote: f.statusNote,
    snoozedUntil: iso(f.snoozedUntil),
    stillDetected: latest.get(f.repositoryId) === f.lastSeenScanId,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

const findingSelect = (db: Db) =>
  db
    .select({ f: findings, repo: repositories, provider: providers, ev: changeEvents })
    .from(findings)
    .innerJoin(repositories, eq(repositories.id, findings.repositoryId))
    .innerJoin(providers, eq(providers.id, findings.providerId))
    .innerJoin(changeEvents, eq(changeEvents.id, findings.changeEventId));

// ------------------------------------------------------------------ changes
export async function listChanges(db: Db, q: z.infer<typeof ChangesQuery>): Promise<Paginated<ChangeDTO>> {
  const where: SQL[] = [];
  if (q.q) where.push(or(ilike(changeEvents.title, like(q.q)), ilike(changeEvents.summary, like(q.q)))!);
  if (q.provider) where.push(eq(providers.slug, q.provider));
  if (q.severity) where.push(eq(changeEvents.severity, q.severity));
  if (q.changeType) where.push(eq(changeEvents.changeType, q.changeType));
  if (q.origin) where.push(eq(changeEvents.origin, q.origin));
  const cond = where.length ? and(...where) : undefined;
  const base = () =>
    db
      .select({ ev: changeEvents, provider: providers })
      .from(changeEvents)
      .innerJoin(providers, eq(providers.id, changeEvents.providerId))
      .where(cond);
  const rows = await base()
    .orderBy(
      q.sort === 'newest'
        ? desc(sql`coalesce(${changeEvents.publishedAt}, ${changeEvents.detectedAt})`)
        : asc(sql`coalesce(${changeEvents.publishedAt}, ${changeEvents.detectedAt})`),
      desc(changeEvents.createdAt),
    )
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .where(cond);
  const counts = rows.length
    ? await db
        .select({ id: findings.changeEventId, n: count() })
        .from(findings)
        .where(
          inArray(
            findings.changeEventId,
            rows.map((r) => r.ev.id),
          ),
        )
        .groupBy(findings.changeEventId)
    : [];
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return page(
    rows.map((r) => changeDTO(r, byId.get(r.ev.id) ?? 0)),
    total,
    q,
  );
}

export async function getChange(db: Db, id: string): Promise<ChangeDetailDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('Change');
  const [row] = await db
    .select({ ev: changeEvents, provider: providers, source: providerSources })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .leftJoin(providerSources, eq(providerSources.id, changeEvents.sourceId))
    .where(eq(changeEvents.id, id))
    .limit(1);
  if (!row) throw AppError.notFound('Change');
  const fr = await findingSelect(db).where(eq(findings.changeEventId, id)).orderBy(desc(sevRank));
  const latest = await latestSucceededScans({ db }, [...new Set(fr.map((r) => r.f.repositoryId))]);
  return { ...changeDTO(row, fr.length), sourceLabel: row.source?.label ?? null, findings: fr.map((r) => findingDTO(r, latest)) };
}

// ------------------------------------------------------------------ providers
function monitoringStatus(sources: (typeof providerSources.$inferSelect)[]): MonitoringStatus {
  const live = sources.filter((s) => s.origin === 'live' && s.enabled);
  const checked = live.filter((s) => s.lastCheckedAt);
  if (checked.length === 0) return sources.some((s) => s.origin === 'demo') ? 'demo' : 'never_checked';
  if (checked.some((s) => s.consecutiveFailures > 0)) return 'failing';
  return 'ok';
}
const sourceDTO = (s: typeof providerSources.$inferSelect): ProviderSourceDTO => ({
  id: s.id,
  kind: s.kind,
  url: s.url,
  label: s.label,
  origin: s.origin,
  enabled: s.enabled,
  lastCheckedAt: iso(s.lastCheckedAt),
  lastSuccessAt: iso(s.lastSuccessAt),
  lastError: s.lastError,
  consecutiveFailures: s.consecutiveFailures,
});

export async function listProviders(db: Db): Promise<ProviderDTO[]> {
  const rows = await db.select().from(providers).orderBy(asc(providers.name));
  const sources = await db.select().from(providerSources);
  const counts = await db.select({ id: changeEvents.providerId, n: count() }).from(changeEvents).groupBy(changeEvents.providerId);
  const cnt = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((p) => {
    const ss = sources.filter((s) => s.providerId === p.id);
    const last = ss
      .map((s) => s.lastSuccessAt)
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      docsUrl: p.docsUrl,
      description: p.description,
      packages: p.packages,
      hosts: p.hosts,
      monitoringStatus: monitoringStatus(ss),
      lastSuccessAt: iso(last),
      changeCount: cnt.get(p.id) ?? 0,
    };
  });
}

export async function getProviderDetail(db: Db, idOrSlug: string): Promise<ProviderDetailDTO> {
  const all = await listProviders(db);
  const p = all.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!p) throw AppError.notFound('Provider');
  const sources = await db
    .select()
    .from(providerSources)
    .where(eq(providerSources.providerId, p.id))
    .orderBy(asc(providerSources.origin), asc(providerSources.label));
  const recent = await db
    .select({ ev: changeEvents, provider: providers })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .where(eq(changeEvents.providerId, p.id))
    .orderBy(desc(changeEvents.detectedAt))
    .limit(10);
  return { ...p, sources: sources.map(sourceDTO), recentChanges: recent.map((r) => changeDTO(r)) };
}

// ------------------------------------------------------------------ repositories
const scanDTO = (s: typeof repositoryScans.$inferSelect): ScanDTO => ({
  id: s.id,
  repositoryId: s.repositoryId,
  status: s.status,
  startedAt: iso(s.startedAt),
  finishedAt: iso(s.finishedAt),
  filesIndexed: s.filesIndexed,
  dependenciesCount: s.dependenciesCount,
  callSitesCount: s.callSitesCount,
  findingsCreated: s.findingsCreated,
  error: s.error,
  warnings: s.warnings,
  createdAt: s.createdAt.toISOString(),
});

export async function listRepositories(db: Db): Promise<RepositoryDTO[]> {
  const repos = await db.select().from(repositories).orderBy(desc(repositories.createdAt));
  if (!repos.length) return [];
  const ids = repos.map((r) => r.id);
  const scans = await db
    .select()
    .from(repositoryScans)
    .where(inArray(repositoryScans.repositoryId, ids))
    .orderBy(desc(repositoryScans.createdAt));
  const open = await db
    .select({ id: findings.repositoryId, n: count() })
    .from(findings)
    .where(and(inArray(findings.repositoryId, ids), eq(findings.status, 'open')))
    .groupBy(findings.repositoryId);
  const deps = await db
    .select({ id: detectedDependencies.repositoryId, slug: providers.slug })
    .from(detectedDependencies)
    .innerJoin(providers, eq(providers.id, detectedDependencies.providerId))
    .where(inArray(detectedDependencies.repositoryId, ids));
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    sourceType: r.sourceType,
    location: r.location,
    lastScanAt: iso(r.lastScanAt),
    createdAt: r.createdAt.toISOString(),
    latestScanStatus: scans.find((s) => s.repositoryId === r.id)?.status ?? null,
    openFindings: open.find((o) => o.id === r.id)?.n ?? 0,
    providers: [...new Set(deps.filter((d) => d.id === r.id).map((d) => d.slug))].sort(),
  }));
}

export async function getRepositoryDetail(db: Db, id: string): Promise<RepositoryDetailDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('Repository');
  const list = await listRepositories(db);
  const r = list.find((x) => x.id === id);
  if (!r) throw AppError.notFound('Repository');
  const [latest] = await db
    .select()
    .from(repositoryScans)
    .where(eq(repositoryScans.repositoryId, id))
    .orderBy(desc(repositoryScans.createdAt))
    .limit(1);
  const [d] = await db.select({ n: count() }).from(detectedDependencies).where(eq(detectedDependencies.repositoryId, id));
  const [f] = await db.select({ n: count() }).from(indexedFiles).where(eq(indexedFiles.repositoryId, id));
  const [c] = await db.select({ n: count() }).from(callSites).where(eq(callSites.repositoryId, id));
  return { ...r, latestScan: latest ? scanDTO(latest) : null, dependencyCount: d?.n ?? 0, fileCount: f?.n ?? 0, callSiteCount: c?.n ?? 0 };
}

export async function listScans(db: Db, repositoryId: string): Promise<ScanDTO[]> {
  return (
    await db
      .select()
      .from(repositoryScans)
      .where(eq(repositoryScans.repositoryId, repositoryId))
      .orderBy(desc(repositoryScans.createdAt))
      .limit(50)
  ).map(scanDTO);
}
export async function getScan(db: Db, id: string): Promise<ScanDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('Scan');
  const [s] = await db.select().from(repositoryScans).where(eq(repositoryScans.id, id)).limit(1);
  if (!s) throw AppError.notFound('Scan');
  return scanDTO(s);
}

export async function listDependencies(db: Db, repositoryId: string): Promise<DependencyDTO[]> {
  const rows = await db
    .select({ d: detectedDependencies, slug: providers.slug })
    .from(detectedDependencies)
    .leftJoin(providers, eq(providers.id, detectedDependencies.providerId))
    .where(eq(detectedDependencies.repositoryId, repositoryId))
    .orderBy(asc(detectedDependencies.packageName), asc(detectedDependencies.manifestPath));
  return rows.map(({ d, slug }) => ({
    id: d.id,
    packageName: d.packageName,
    versionSpec: d.versionSpec,
    resolvedVersion: d.resolvedVersion,
    ecosystem: d.ecosystem,
    providerSlug: slug,
    manifestPath: d.manifestPath,
    source: d.source,
    confidence: d.confidence,
  }));
}
export async function listIndexedFiles(
  db: Db,
  repositoryId: string,
  p: { page: number; pageSize: number; q?: string },
): Promise<Paginated<IndexedFileDTO>> {
  const cond = and(eq(indexedFiles.repositoryId, repositoryId), p.q ? ilike(indexedFiles.path, like(p.q)) : undefined);
  const rows = await db
    .select()
    .from(indexedFiles)
    .where(cond)
    .orderBy(asc(indexedFiles.path))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [t] = await db.select({ n: count() }).from(indexedFiles).where(cond);
  return page(
    rows.map((f) => ({ id: f.id, path: f.path, language: f.language, sizeBytes: f.sizeBytes, sha256: f.sha256 })),
    t?.n ?? 0,
    p,
  );
}

// ------------------------------------------------------------------ findings
export async function listFindings(db: Db, q: z.infer<typeof FindingsQuery>): Promise<Paginated<FindingDTO>> {
  await reopenExpiredSnoozes({ db });
  const where: SQL[] = [];
  if (q.q) where.push(or(ilike(findings.title, like(q.q)), ilike(findings.filePath, like(q.q)), ilike(findings.matchReason, like(q.q)))!);
  if (q.provider) where.push(eq(providers.slug, q.provider));
  if (q.repositoryId) where.push(eq(findings.repositoryId, q.repositoryId));
  if (q.severity) where.push(eq(findings.severity, q.severity));
  if (q.status) where.push(eq(findings.status, q.status));
  if (q.impact === 'verified') where.push(gte(findings.confidence, 0.85));
  if (q.impact === 'possible') where.push(lt(findings.confidence, 0.85));
  const cond = where.length ? and(...where) : undefined;
  const rows = await findingSelect(db)
    .where(cond)
    .orderBy(
      ...(q.sort === 'severity' ? [desc(sevRank), desc(findings.confidence)] : [desc(findings.createdAt)]),
      asc(findings.filePath),
      asc(findings.line),
    )
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [t] = await db.select({ n: count() }).from(findings).innerJoin(providers, eq(providers.id, findings.providerId)).where(cond);
  const latest = await latestSucceededScans({ db }, [...new Set(rows.map((r) => r.f.repositoryId))]);
  return page(
    rows.map((r) => findingDTO(r, latest)),
    t?.n ?? 0,
    q,
  );
}

export async function getFinding(db: Db, id: string): Promise<FindingDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('Finding');
  await reopenExpiredSnoozes({ db });
  const [row] = await findingSelect(db).where(eq(findings.id, id)).limit(1);
  if (!row) throw AppError.notFound('Finding');
  const latest = await latestSucceededScans({ db }, [row.f.repositoryId]);
  const relatedRows = await findingSelect(db)
    .where(
      and(
        or(
          and(eq(findings.repositoryId, row.f.repositoryId), eq(findings.filePath, row.f.filePath)),
          eq(findings.changeEventId, row.f.changeEventId),
        ),
        sql`${findings.id} <> ${id}`,
      ),
    )
    .orderBy(desc(sevRank))
    .limit(8);
  const [chRow] = await db
    .select({ ev: changeEvents, provider: providers })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .where(eq(changeEvents.id, row.f.changeEventId))
    .limit(1);
  return {
    ...findingDTO(row, latest),
    related: relatedRows.map((r) => findingDTO(r, latest)),
    change: chRow ? changeDTO(chRow) : undefined,
  };
}

// ------------------------------------------------------------------ dashboard
export async function dashboardStats(db: Db, demoMode: boolean): Promise<DashboardStats> {
  await reopenExpiredSnoozes({ db });
  const [p] = await db.select({ n: count() }).from(providers);
  const [r] = await db.select({ n: count() }).from(repositories);
  const [o] = await db.select({ n: count() }).from(findings).where(eq(findings.status, 'open'));
  const [c] = await db
    .select({ n: count() })
    .from(findings)
    .where(and(eq(findings.status, 'open'), eq(findings.severity, 'critical')));
  const [v] = await db
    .select({ n: count() })
    .from(findings)
    .where(and(eq(findings.status, 'open'), gte(findings.confidence, 0.85)));
  const bySev = await db
    .select({ s: findings.severity, n: count() })
    .from(findings)
    .where(eq(findings.status, 'open'))
    .groupBy(findings.severity);
  const recent = await db
    .select({ ev: changeEvents, provider: providers })
    .from(changeEvents)
    .innerJoin(providers, eq(providers.id, changeEvents.providerId))
    .orderBy(desc(sql`coalesce(${changeEvents.publishedAt}, ${changeEvents.detectedAt})`))
    .limit(5);
  const scans = await db
    .select({ s: repositoryScans, name: repositories.name })
    .from(repositoryScans)
    .innerJoin(repositories, eq(repositories.id, repositoryScans.repositoryId))
    .orderBy(desc(repositoryScans.createdAt))
    .limit(5);
  const provs = await listProviders(db);
  return {
    providers: p?.n ?? 0,
    repositories: r?.n ?? 0,
    openFindings: o?.n ?? 0,
    criticalFindings: c?.n ?? 0,
    verifiedFindings: v?.n ?? 0,
    findingsBySeverity: SEVERITIES.map((s: Severity) => ({ severity: s, count: bySev.find((x) => x.s === s)?.n ?? 0 })),
    recentChanges: recent.map((x) => changeDTO(x)),
    recentScans: scans.map((x) => ({ ...scanDTO(x.s), repositoryName: x.name })),
    providerStatus: provs.map((x) => ({ slug: x.slug, name: x.name, status: x.monitoringStatus, lastSuccessAt: x.lastSuccessAt })),
    demoMode,
  };
}
