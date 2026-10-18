import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AffectedItem, Evidence, ProviderConfig } from '@tracewise/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').defaultNow().notNull();
const updatedAt = () =>
  ts('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const severityEnum = pgEnum('severity', ['critical', 'high', 'medium', 'low', 'info']);
export const changeTypeEnum = pgEnum('change_type', ['breaking', 'deprecation', 'warning', 'informational']);
export const findingStatusEnum = pgEnum('finding_status', ['open', 'snoozed', 'fixed', 'false_positive']);
export const matchKindEnum = pgEnum('match_kind', [
  'exact_symbol',
  'known_endpoint',
  'api_path',
  'package_version',
  'pattern',
  'dynamic_prefix',
]);
export const scanStatusEnum = pgEnum('scan_status', ['queued', 'running', 'succeeded', 'failed']);
export const sourceKindEnum = pgEnum('source_kind', ['fixture_events', 'rss', 'atom', 'openapi']);
export const originEnum = pgEnum('origin', ['demo', 'live']);
export const ecosystemEnum = pgEnum('ecosystem', ['npm', 'pypi']);
export const repoSourceEnum = pgEnum('repo_source', ['local', 'git']);
export const dependencySourceEnum = pgEnum('dependency_source', ['manifest', 'lockfile']);
export const callSiteKindEnum = pgEnum('call_site_kind', ['sdk_call', 'sdk_import', 'http_call', 'endpoint_literal', 'dynamic_call']);
export const detectionMethodEnum = pgEnum('detection_method', ['typescript_ast', 'tree_sitter', 'regex_fallback', 'manifest']);

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  docsUrl: text('docs_url').notNull(),
  description: text('description').notNull(),
  packages: jsonb('packages').$type<{ ecosystem: string; name: string }[]>().notNull(),
  hosts: jsonb('hosts').$type<string[]>().notNull(),
  config: jsonb('config').$type<ProviderConfig>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const providerSources = pgTable(
  'provider_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    kind: sourceKindEnum('kind').notNull(),
    url: text('url').notNull(),
    label: text('label').notNull(),
    origin: originEnum('origin').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    etag: text('etag'),
    lastModified: text('last_modified'),
    lastContentHash: text('last_content_hash'),
    lastCheckedAt: ts('last_checked_at'),
    lastSuccessAt: ts('last_success_at'),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('provider_sources_provider_url_uq').on(t.providerId, t.url)],
);

export const sourceSnapshots = pgTable(
  'source_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => providerSources.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    content: text('content').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    previousSnapshotId: uuid('previous_snapshot_id').references((): AnyPgColumn => sourceSnapshots.id, {
      onDelete: 'set null',
    }),
    fetchedAt: ts('fetched_at').defaultNow().notNull(),
    processedAt: ts('processed_at'),
  },
  (t) => [uniqueIndex('source_snapshots_source_hash_uq').on(t.sourceId, t.contentHash)],
);

export const changeEvents = pgTable(
  'change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => providerSources.id, { onDelete: 'set null' }),
    snapshotId: uuid('snapshot_id').references(() => sourceSnapshots.id, { onDelete: 'set null' }),
    previousSnapshotId: uuid('previous_snapshot_id').references(() => sourceSnapshots.id, { onDelete: 'set null' }),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    changeType: changeTypeEnum('change_type').notNull(),
    severity: severityEnum('severity').notNull(),
    affected: jsonb('affected')
      .$type<AffectedItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    effectiveAt: ts('effective_at'),
    publishedAt: ts('published_at'),
    detectedAt: ts('detected_at').defaultNow().notNull(),
    sourceUrl: text('source_url').notNull(),
    detectionMethod: text('detection_method').notNull(),
    confidence: real('confidence').notNull(),
    evidence: jsonb('evidence')
      .$type<Evidence[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    origin: originEnum('origin').notNull(),
    remediation: text('remediation'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('change_events_fingerprint_uq').on(t.fingerprint),
    index('change_events_provider_idx').on(t.providerId),
    index('change_events_detected_idx').on(t.detectedAt),
    index('change_events_severity_idx').on(t.severity),
  ],
);

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sourceType: repoSourceEnum('source_type').notNull(),
    location: text('location').notNull(),
    lastScanAt: ts('last_scan_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('repositories_location_uq').on(t.location)],
);

export const repositoryScans = pgTable(
  'repository_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    status: scanStatusEnum('status').notNull().default('queued'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    filesIndexed: integer('files_indexed').notNull().default(0),
    dependenciesCount: integer('dependencies_count').notNull().default(0),
    callSitesCount: integer('call_sites_count').notNull().default(0),
    findingsCreated: integer('findings_created').notNull().default(0),
    error: text('error'),
    warnings: jsonb('warnings')
      .$type<{ path?: string; message: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    stats: jsonb('stats')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('repository_scans_repo_idx').on(t.repositoryId, t.createdAt)],
);

export const detectedDependencies = pgTable(
  'detected_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => repositoryScans.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    packageName: text('package_name').notNull(),
    versionSpec: text('version_spec'),
    resolvedVersion: text('resolved_version'),
    ecosystem: ecosystemEnum('ecosystem').notNull(),
    manifestPath: text('manifest_path').notNull(),
    manifestLine: integer('manifest_line'),
    source: dependencySourceEnum('source').notNull(),
    confidence: real('confidence').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('detected_deps_uq').on(t.scanId, t.ecosystem, t.packageName, t.manifestPath, t.source),
    index('detected_deps_repo_idx').on(t.repositoryId),
  ],
);

export const indexedFiles = pgTable(
  'indexed_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => repositoryScans.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    language: text('language').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
  },
  (t) => [uniqueIndex('indexed_files_scan_path_uq').on(t.scanId, t.path), index('indexed_files_repo_idx').on(t.repositoryId)],
);

export const callSites = pgTable(
  'call_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => repositoryScans.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    line: integer('line').notNull(),
    symbol: text('symbol').notNull(),
    kind: callSiteKindEnum('kind').notNull(),
    snippet: text('snippet').notNull(),
    snippetStartLine: integer('snippet_start_line').notNull(),
    detectionMethod: detectionMethodEnum('detection_method').notNull(),
    confidence: real('confidence').notNull(),
    resolved: boolean('resolved').notNull().default(true),
    fileHash: text('file_hash').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index('call_sites_repo_idx').on(t.repositoryId), index('call_sites_provider_symbol_idx').on(t.providerId, t.symbol)],
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fingerprint: text('fingerprint').notNull(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    changeEventId: uuid('change_event_id')
      .notNull()
      .references(() => changeEvents.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    callSiteId: uuid('call_site_id').references(() => callSites.id, { onDelete: 'set null' }),
    firstScanId: uuid('first_scan_id').references(() => repositoryScans.id, { onDelete: 'set null' }),
    lastSeenScanId: uuid('last_seen_scan_id').references(() => repositoryScans.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    severity: severityEnum('severity').notNull(),
    confidence: real('confidence').notNull(),
    matchKind: matchKindEnum('match_kind').notNull(),
    matchReason: text('match_reason').notNull(),
    explanation: text('explanation').notNull(),
    evidence: jsonb('evidence')
      .$type<Evidence[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    limitations: text('limitations').notNull(),
    remediation: text('remediation').notNull(),
    filePath: text('file_path').notNull(),
    line: integer('line'),
    snippet: text('snippet').notNull(),
    snippetStartLine: integer('snippet_start_line'),
    status: findingStatusEnum('status').notNull().default('open'),
    statusNote: text('status_note'),
    snoozedUntil: ts('snoozed_until'),
    statusChangedAt: ts('status_changed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('findings_fingerprint_uq').on(t.fingerprint),
    index('findings_status_idx').on(t.status),
    index('findings_severity_idx').on(t.severity),
    index('findings_repo_idx').on(t.repositoryId),
    index('findings_change_idx').on(t.changeEventId),
  ],
);

export const jobRecords = pgTable(
  'job_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queue: text('queue').notNull(),
    jobId: text('job_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [uniqueIndex('job_records_queue_job_uq').on(t.queue, t.jobId), index('job_records_status_idx').on(t.status)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index('audit_events_entity_idx').on(t.entityType, t.entityId)],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull(),
  findingIds: jsonb('finding_ids')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const providersRelations = relations(providers, ({ many }) => ({
  sources: many(providerSources),
  changes: many(changeEvents),
}));
export const providerSourcesRelations = relations(providerSources, ({ one }) => ({
  provider: one(providers, { fields: [providerSources.providerId], references: [providers.id] }),
}));
export const changeEventsRelations = relations(changeEvents, ({ one }) => ({
  provider: one(providers, { fields: [changeEvents.providerId], references: [providers.id] }),
}));
export const findingsRelations = relations(findings, ({ one }) => ({
  repository: one(repositories, { fields: [findings.repositoryId], references: [repositories.id] }),
  change: one(changeEvents, { fields: [findings.changeEventId], references: [changeEvents.id] }),
  provider: one(providers, { fields: [findings.providerId], references: [providers.id] }),
}));
