import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo, type Runtime } from '@tracewise/core';
import { buildApp } from '../src/app';
import { createTestRuntime, FIXTURES, type TestRuntime } from '../../../tests/helpers';

let rt: TestRuntime;
let app: FastifyInstance;
const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json() };
};
const send = async (method: 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, payload: payload as object });
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  rt = await createTestRuntime();
  await seedDemo(rt.ctx);
  app = await buildApp(rt as Runtime, { logger: false, disableRateLimit: true });
});
afterAll(async () => {
  await app.close();
  await rt.close();
});

describe('system', () => {
  it('health and status', async () => {
    expect((await get('/health')).body).toMatchObject({ status: 'ok', database: true, mode: 'demo' });
    const s = (await get('/api/status')).body;
    expect(s).toMatchObject({
      mode: 'demo',
      queueMode: 'inline',
      authRequired: false,
      database: { ok: true },
      llm: { provider: 'none', configured: false },
    });
    expect(JSON.stringify(s)).not.toMatch(/apiKey|API_TOKEN|password/i);
  });
  it('serves OpenAPI documentation for the endpoints', async () => {
    const doc = (await get('/docs/json')).body;
    expect(doc.info.title).toBe('Tracewise API');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/findings',
        '/api/findings/{id}',
        '/api/repositories/{id}/scan',
        '/api/changes',
        '/api/dashboard/stats',
        '/health',
      ]),
    );
    expect(doc.paths['/api/findings'].get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['severity', 'status', 'page']),
    );
  });
  it('consistent 404 and error shape', async () => {
    const r = await get('/api/nope');
    expect(r).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
  });
});

describe('dashboard', () => {
  it('returns real aggregates from the database', async () => {
    const d = (await get('/api/dashboard/stats')).body;
    expect(d).toMatchObject({ providers: 4, repositories: 1, openFindings: 6, criticalFindings: 1, verifiedFindings: 4, demoMode: true });
    expect(d.findingsBySeverity.reduce((a: number, x: { count: number }) => a + x.count, 0)).toBe(6);
    expect(d.recentChanges).toHaveLength(5);
    expect(d.recentScans[0]).toMatchObject({ status: 'succeeded' });
    expect(d.providerStatus.map((p: { status: string }) => p.status)).toEqual(['demo', 'demo', 'demo', 'demo']);
  });
});

describe('findings', () => {
  it('lists by severity then confidence with pagination metadata', async () => {
    const r = (await get('/api/findings?pageSize=4')).body;
    expect(r).toMatchObject({ total: 6, page: 1, pageSize: 4, totalPages: 2 });
    expect(r.items.map((f: { severity: string }) => f.severity)).toEqual(['critical', 'high', 'medium', 'medium']);
    expect((await get('/api/findings?pageSize=4&page=2')).body.items).toHaveLength(2);
  });
  it('filters by provider, severity, impact, status and search', async () => {
    expect((await get('/api/findings?provider=openai')).body.total).toBe(2);
    expect((await get('/api/findings?severity=critical')).body.items[0].filePath).toBe('src/legacy.py');
    expect((await get('/api/findings?impact=possible')).body.total).toBe(2);
    expect((await get('/api/findings?impact=verified')).body.total).toBe(4);
    expect((await get('/api/findings?status=fixed')).body.total).toBe(0);
    expect((await get('/api/findings?q=twilio')).body.total).toBe(1);
    expect((await get('/api/findings?q=%25')).body.total).toBe(0); // LIKE wildcards are escaped
  });
  it('validates query parameters', async () => {
    for (const q of ['severity=urgent', 'page=0', 'pageSize=1000', 'status=done', 'repositoryId=nope']) {
      const r = await get(`/api/findings?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code).toBe('validation_error');
    }
  });
  it('detail includes change, related findings, evidence and uncertainty fields', async () => {
    const list = (await get('/api/findings?provider=stripe')).body.items;
    const target = list.find((f: { filePath: string }) => f.filePath === 'src/payments.ts');
    const d = (await get(`/api/findings/${target.id}`)).body;
    expect(d).toMatchObject({
      impact: 'verified',
      matchKind: 'exact_symbol',
      status: 'open',
      stillDetected: true,
      changeOrigin: 'demo',
      line: 8,
    });
    expect(d.change.title).toMatch(/^\[DEMO\]/);
    expect(d.related.map((r: { id: string }) => r.id)).toContain(
      list.find((f: { filePath: string }) => f.filePath === 'src/dynamic.ts').id,
    );
    expect(d.limitations).toBeTruthy();
  });
  it('status changes persist (open -> snoozed -> fixed -> false_positive -> open)', async () => {
    const id = (await get('/api/findings')).body.items[0].id;
    const sn = await send('PATCH', `/api/findings/${id}`, { status: 'snoozed', snoozeDays: 14, note: 'later' });
    expect(sn.status).toBe(200);
    expect(sn.body).toMatchObject({ status: 'snoozed', statusNote: 'later' });
    expect(new Date(sn.body.snoozedUntil).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect((await get(`/api/findings/${id}`)).body.status).toBe('snoozed');
    expect((await get('/api/dashboard/stats')).body.openFindings).toBe(5);
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'fixed' })).body).toMatchObject({ status: 'fixed', snoozedUntil: null });
    expect((await get('/api/findings?status=fixed')).body.total).toBe(1);
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'false_positive' })).body.status).toBe('false_positive');
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'open' })).body.status).toBe('open');
    expect((await get('/api/dashboard/stats')).body.openFindings).toBe(6);
  });
  it('rejects invalid patches and unknown ids', async () => {
    const id = (await get('/api/findings')).body.items[0].id;
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'wontfix' })).status).toBe(400);
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'fixed', extra: 1 })).status).toBe(400);
    expect((await send('PATCH', `/api/findings/${id}`, { status: 'snoozed', snoozeDays: 0 })).status).toBe(400);
    expect((await send('PATCH', `/api/findings/${id}`, {})).status).toBe(400);
    expect((await send('PATCH', '/api/findings/00000000-0000-4000-8000-000000000000', { status: 'fixed' })).status).toBe(404);
    expect((await get('/api/findings/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('/api/findings/not-a-uuid')).status).toBe(400);
  });
});

describe('changes and providers', () => {
  it('searches, filters and sorts changes', async () => {
    const all = (await get('/api/changes?pageSize=100')).body;
    expect(all.total).toBe(12); // 8 fixture events + 4 OpenAPI-diff events
    expect(all.items.every((c: { origin: string }) => c.origin === 'demo')).toBe(true);
    expect((await get('/api/changes?provider=openai&changeType=breaking')).body.total).toBe(1);
    expect((await get('/api/changes?severity=high')).body.items.every((c: { severity: string }) => c.severity === 'high')).toBe(true);
    expect((await get('/api/changes?q=charges')).body.total).toBeGreaterThan(0);
    const newest = (await get('/api/changes?sort=newest&pageSize=100')).body.items;
    const oldest = (await get('/api/changes?sort=oldest&pageSize=100')).body.items;
    expect(newest[0].id).toBe(oldest[oldest.length - 1].id);
  });
  it('change detail lists linked findings', async () => {
    const c = (await get('/api/changes?q=stripe.charges.create')).body.items.find((x: { findingCount: number }) => x.findingCount === 2);
    const d = (await get(`/api/changes/${c.id}`)).body;
    expect(d.findings).toHaveLength(2);
    expect(d.affected[0]).toMatchObject({ kind: 'sdk_symbol', symbol: 'stripe.charges.create' });
    expect(d.sourceLabel).toMatch(/demo/i);
  });
  it('providers list and detail (by slug)', async () => {
    const l = (await get('/api/providers')).body.items;
    expect(l.map((p: { slug: string }) => p.slug)).toEqual(['github', 'openai', 'stripe', 'twilio']);
    const d = (await get('/api/providers/stripe')).body;
    expect(d.sources.some((s: { origin: string }) => s.origin === 'demo')).toBe(true);
    expect(d.sources.some((s: { origin: string; lastCheckedAt: string | null }) => s.origin === 'live' && s.lastCheckedAt === null)).toBe(
      true,
    );
    expect(d.recentChanges.length).toBeGreaterThan(0);
    expect((await get('/api/providers/unknown')).status).toBe(404);
  });
  it('poll endpoint queues checks (live sources are skipped while disabled)', async () => {
    const r = await send('POST', '/api/providers/stripe/poll');
    expect(r.status).toBe(202);
    expect(r.body.enqueued).toBeGreaterThan(0);
  });
});

describe('repositories', () => {
  it('rejects unsafe or invalid registrations with consistent errors', async () => {
    expect((await send('POST', '/api/repositories', { sourceType: 'local', location: '/etc' })).body.error.code).toBe('unsafe_input');
    expect((await send('POST', '/api/repositories', { sourceType: 'local', location: '../../../etc' })).status).toBe(400);
    expect((await send('POST', '/api/repositories', { sourceType: 'ftp', location: 'x' })).status).toBe(400);
    expect((await send('POST', '/api/repositories', { sourceType: 'local' })).status).toBe(400);
    expect((await send('POST', '/api/repositories', { sourceType: 'git', location: 'https://127.0.0.1/a/b' })).body.error.code).toBe(
      'unsafe_input',
    );
    const dup = await send('POST', '/api/repositories', {
      sourceType: 'local',
      location: path.join(FIXTURES, 'sample-repositories/demo-shop'),
    });
    expect(dup.status).toBe(409);
  });
  it('register -> scan -> inspect: dependencies, files, findings, history', async () => {
    const dir = await rt.tempRepo({
      'package.json': '{"dependencies":{"stripe":"^14.0.0"}}',
      'src/pay.ts': `import Stripe from 'stripe';\nconst s = new Stripe('');\nexport const go = () => s.charges.create({});\n`,
      'src/other.ts': `export const noop = () => 1;\n`,
    });
    const reg = await send('POST', '/api/repositories', { sourceType: 'local', location: dir, name: 'tmp repo' });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ name: 'tmp repo', lastScanAt: null, openFindings: 0, fileCount: 0 });
    const id = reg.body.id;
    const scan = await send('POST', `/api/repositories/${id}/scan`);
    expect(scan.status).toBe(202);
    expect(scan.body.scan).toMatchObject({ status: 'succeeded', filesIndexed: 3, dependenciesCount: 1 });
    expect((await get(`/api/scans/${scan.body.scan.id}`)).body.status).toBe('succeeded');
    const detail = (await get(`/api/repositories/${id}`)).body;
    expect(detail).toMatchObject({ dependencyCount: 1, fileCount: 3, openFindings: 1, providers: ['stripe'] });
    expect((await get(`/api/repositories/${id}/dependencies`)).body.items[0]).toMatchObject({
      packageName: 'stripe',
      providerSlug: 'stripe',
      versionSpec: '^14.0.0',
    });
    const files = (await get(`/api/repositories/${id}/files?q=pay`)).body;
    expect(files.items.map((f: { path: string }) => f.path)).toEqual(['src/pay.ts']);
    const fs_ = (await get(`/api/repositories/${id}/findings`)).body;
    expect(fs_.items[0]).toMatchObject({ filePath: 'src/pay.ts', line: 3, severity: 'high' });
    expect((await get(`/api/repositories/${id}/scans`)).body.items).toHaveLength(1);
    await send('POST', `/api/repositories/${id}/scan`);
    expect((await get(`/api/repositories/${id}/scans`)).body.items).toHaveLength(2);
    expect((await get(`/api/repositories/${id}/findings`)).body.total).toBe(1);
  });
  it('a repository without provider dependencies yields an empty, valid state', async () => {
    const dir = await rt.tempRepo({ 'main.py': 'print(1)\n' });
    const id = (await send('POST', '/api/repositories', { sourceType: 'local', location: dir })).body.id;
    await send('POST', `/api/repositories/${id}/scan`);
    expect((await get(`/api/repositories/${id}/dependencies`)).body.items).toEqual([]);
    expect((await get(`/api/repositories/${id}/findings`)).body).toMatchObject({ total: 0, items: [] });
  });
  it('unknown repository ids', async () => {
    expect((await get('/api/repositories/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await send('POST', '/api/repositories/00000000-0000-4000-8000-000000000000/scan')).status).toBe(404);
    expect((await get('/api/repositories/xyz/scans')).status).toBe(400);
  });
});

describe('settings', () => {
  it('reads defaults, validates and persists updates', async () => {
    expect((await get('/api/settings')).body).toMatchObject({
      monitoring: { livePollingEnabled: false },
      notifications: { emailEnabled: false, minSeverity: 'high' },
    });
    expect(
      (await send('PUT', '/api/settings', { notifications: { emailEnabled: true, recipients: ['not-an-email'], minSeverity: 'high' } }))
        .status,
    ).toBe(400);
    expect((await send('PUT', '/api/settings', { monitoring: { livePollingEnabled: true, pollIntervalMinutes: 5 } })).status).toBe(400);
    const ok = await send('PUT', '/api/settings', {
      monitoring: { livePollingEnabled: true, pollIntervalMinutes: 120 },
      notifications: { emailEnabled: true, recipients: ['a@b.co'], minSeverity: 'medium' },
    });
    expect(ok.status).toBe(200);
    expect((await get('/api/settings')).body).toMatchObject({
      monitoring: { livePollingEnabled: true, pollIntervalMinutes: 120 },
      notifications: { recipients: ['a@b.co'], minSeverity: 'medium' },
    });
  });
});

describe('production mode', () => {
  it('requires a bearer token on /api, leaves /health open, and hides internal error details', async () => {
    const prod = await createTestRuntime({ TRACEWISE_MODE: 'production', API_TOKEN: 'secret-token-123' });
    const papp = await buildApp(prod as Runtime, { logger: false, disableRateLimit: true });
    try {
      expect((await papp.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await papp.inject({ method: 'GET', url: '/api/providers' })).statusCode).toBe(401);
      expect((await papp.inject({ method: 'GET', url: '/api/providers', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(
        401,
      );
      expect(
        (await papp.inject({ method: 'GET', url: '/api/providers', headers: { authorization: 'Bearer secret-token-123' } })).statusCode,
      ).toBe(200);
      const body = (await papp.inject({ method: 'GET', url: '/api/providers' })).json();
      expect(body.error.code).toBe('unauthorized');
    } finally {
      await papp.close();
      await prod.close();
    }
  });
  it('refuses to start production mode without a token', async () => {
    await expect(createTestRuntime({ TRACEWISE_MODE: 'production' })).rejects.toThrow(/API_TOKEN/);
  });
});

describe('rate limiting', () => {
  it('limits sensitive endpoints', async () => {
    const limited = await createTestRuntime();
    const lapp = await buildApp(limited as Runtime, { logger: false });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 22; i++)
        codes.push(
          (await lapp.inject({ method: 'POST', url: '/api/repositories', payload: { sourceType: 'local', location: '/etc' } })).statusCode,
        );
      expect(codes.slice(0, 20).every((c) => c === 400)).toBe(true);
      expect(codes.slice(20)).toEqual([429, 429]);
      const r = await lapp.inject({ method: 'POST', url: '/api/repositories', payload: {} });
      expect(r.json().error.code).toBe('rate_limited');
    } finally {
      await lapp.close();
      await limited.close();
    }
  });
});
