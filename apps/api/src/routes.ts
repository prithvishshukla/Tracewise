import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { integrationStatus } from '@tracewise/config';
import {
  dashboardStats,
  getChange,
  getFinding,
  getProviderDetail,
  getRepositoryDetail,
  getScan,
  getSettings,
  listChanges,
  listDependencies,
  listFindings,
  listIndexedFiles,
  listProviders,
  listRepositories,
  listScans,
  registerRepository,
  startScan,
  updateFindingStatus,
  updateSettings,
  type Runtime,
} from '@tracewise/core';
import { providerSources } from '@tracewise/database';
import {
  ChangesQuery,
  FindingPatchBody,
  FindingsQuery,
  PaginationQuery,
  RepositoryCreateBody,
  SettingsBody,
  type StatusDTO,
} from '@tracewise/shared';
import { route } from './route';

const Uuid = z.object({ id: z.string().uuid() });
const ProviderId = z.object({ id: z.string().min(1).max(100) });
const FilesQuery = PaginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function registerRoutes(app: FastifyInstance, rt: Runtime): void {
  const { ctx } = rt;

  route(app, {
    method: 'GET',
    url: '/api/status',
    tag: 'system',
    summary: 'Environment and integration status (no secrets)',
    handler: async (): Promise<StatusDTO> => {
      let db = false;
      try {
        await ctx.db.execute(sql`select 1`);
        db = true;
      } catch {
        db = false;
      }
      const redis = rt.redis
        ? await rt.redis
            .ping()
            .then(() => true)
            .catch(() => false)
        : null;
      return { ...integrationStatus(ctx.config), database: { ok: db }, redis: { ok: redis } };
    },
  });

  route(app, {
    method: 'GET',
    url: '/api/dashboard/stats',
    tag: 'dashboard',
    summary: 'Dashboard statistics',
    handler: async () => dashboardStats(ctx.db, ctx.config.mode === 'demo'),
  });

  // providers
  route(app, {
    method: 'GET',
    url: '/api/providers',
    tag: 'providers',
    summary: 'List providers with monitoring status',
    handler: async () => ({ items: await listProviders(ctx.db) }),
  });
  route(app, {
    method: 'GET',
    url: '/api/providers/:id',
    tag: 'providers',
    summary: 'Provider detail (id or slug)',
    schemas: { params: ProviderId },
    handler: async ({ params }) => getProviderDetail(ctx.db, params.id),
  });
  route(app, {
    method: 'POST',
    url: '/api/providers/:id/poll',
    tag: 'providers',
    summary: 'Queue a check of all enabled sources of a provider',
    schemas: { params: ProviderId },
    status: 202,
    rateLimit: { max: 10, timeWindow: '1 minute' },
    handler: async ({ params }) => {
      const provider = await getProviderDetail(ctx.db, params.id);
      const sources = await ctx.db.select().from(providerSources).where(eq(providerSources.providerId, provider.id));
      let enqueued = 0;
      for (const s of sources.filter((x) => x.enabled)) {
        const bucket = Math.floor(Date.now() / 60_000);
        const r = await ctx.dispatcher.enqueue('provider-poll', { sourceId: s.id }, { jobId: `poll-${s.id}-${bucket}` });
        if (!r.deduplicated) enqueued++;
      }
      return { enqueued };
    },
  });

  // changes
  route(app, {
    method: 'GET',
    url: '/api/changes',
    tag: 'changes',
    summary: 'Search and filter upstream changes',
    schemas: { query: ChangesQuery },
    handler: async ({ query }) => listChanges(ctx.db, query),
  });
  route(app, {
    method: 'GET',
    url: '/api/changes/:id',
    tag: 'changes',
    summary: 'Change detail with linked findings',
    schemas: { params: Uuid },
    handler: async ({ params }) => getChange(ctx.db, params.id),
  });

  // repositories
  route(app, {
    method: 'GET',
    url: '/api/repositories',
    tag: 'repositories',
    summary: 'List registered repositories',
    handler: async () => ({ items: await listRepositories(ctx.db) }),
  });
  route(app, {
    method: 'POST',
    url: '/api/repositories',
    tag: 'repositories',
    summary: 'Register a repository (local directory under SCAN_ROOTS, or https Git URL on an allowed host)',
    schemas: { body: RepositoryCreateBody },
    status: 201,
    rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: async ({ body }) => {
      const repo = await registerRepository(ctx, body);
      return getRepositoryDetail(ctx.db, repo.id);
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/repositories/:id',
    tag: 'repositories',
    summary: 'Repository detail',
    schemas: { params: Uuid },
    handler: async ({ params }) => getRepositoryDetail(ctx.db, params.id),
  });
  route(app, {
    method: 'POST',
    url: '/api/repositories/:id/scan',
    tag: 'repositories',
    summary: 'Start a scan (queued; returns the active scan if one is already running)',
    schemas: { params: Uuid },
    status: 202,
    rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: async ({ params }) => {
      const { scan, deduplicated } = await startScan(ctx, params.id);
      return { scan: await getScan(ctx.db, scan.id), deduplicated };
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/repositories/:id/scans',
    tag: 'repositories',
    summary: 'Scan history',
    schemas: { params: Uuid },
    handler: async ({ params }) => {
      await getRepositoryDetail(ctx.db, params.id);
      return { items: await listScans(ctx.db, params.id) };
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/repositories/:id/dependencies',
    tag: 'repositories',
    summary: 'Detected provider dependencies',
    schemas: { params: Uuid },
    handler: async ({ params }) => {
      await getRepositoryDetail(ctx.db, params.id);
      return { items: await listDependencies(ctx.db, params.id) };
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/repositories/:id/files',
    tag: 'repositories',
    summary: 'Indexed files',
    schemas: { params: Uuid, query: FilesQuery },
    handler: async ({ params, query }) => {
      await getRepositoryDetail(ctx.db, params.id);
      return listIndexedFiles(ctx.db, params.id, query);
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/repositories/:id/findings',
    tag: 'repositories',
    summary: 'Findings of one repository',
    schemas: { params: Uuid, query: FindingsQuery },
    handler: async ({ params, query }) => {
      await getRepositoryDetail(ctx.db, params.id);
      return listFindings(ctx.db, { ...query, repositoryId: params.id });
    },
  });
  route(app, {
    method: 'GET',
    url: '/api/scans/:id',
    tag: 'repositories',
    summary: 'Scan status',
    schemas: { params: Uuid },
    handler: async ({ params }) => getScan(ctx.db, params.id),
  });

  // findings
  route(app, {
    method: 'GET',
    url: '/api/findings',
    tag: 'findings',
    summary: 'Search and filter findings',
    schemas: { query: FindingsQuery },
    handler: async ({ query }) => listFindings(ctx.db, query),
  });
  route(app, {
    method: 'GET',
    url: '/api/findings/:id',
    tag: 'findings',
    summary: 'Finding detail with related findings and the upstream change',
    schemas: { params: Uuid },
    handler: async ({ params }) => getFinding(ctx.db, params.id),
  });
  route(app, {
    method: 'PATCH',
    url: '/api/findings/:id',
    tag: 'findings',
    summary: 'Change a finding status (open, snoozed, fixed, false_positive)',
    schemas: { params: Uuid, body: FindingPatchBody },
    handler: async ({ params, body }) => {
      await updateFindingStatus(ctx, params.id, body);
      return getFinding(ctx.db, params.id);
    },
  });

  // settings
  route(app, {
    method: 'GET',
    url: '/api/settings',
    tag: 'settings',
    summary: 'Monitoring and notification preferences',
    handler: async () => getSettings(ctx.db, ctx.config),
  });
  route(app, {
    method: 'PUT',
    url: '/api/settings',
    tag: 'settings',
    summary: 'Update preferences',
    schemas: { body: SettingsBody },
    handler: async ({ body }) => updateSettings(ctx.db, ctx.config, body),
  });
}
