import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  AppError,
  getFinding,
  getSettings,
  listFindings,
  listProviders,
  pollSource,
  processSnapshot,
  registerRepository,
  runScan,
  seedDemo,
  startScan,
  updateFindingStatus,
  updateSettings,
} from '@tracewise/core';
import {
  changeEvents,
  findings,
  jobRecords,
  notifications,
  providers,
  providerSources,
  repositoryScans,
  sourceSnapshots,
} from '@tracewise/database';
import { fingerprintOf } from '@tracewise/providers';
import { createTestRuntime, FIXTURES, type TestRuntime } from './helpers';

const expected = JSON.parse(await fs.readFile(path.join(FIXTURES, 'sample-repositories/demo-shop/expected-findings.json'), 'utf8')) as {
  expected: { event: string; file: string; matchKind: string; impact: 'verified' | 'possible' }[];
  mustNotMatch: { file: string; symbol?: string }[];
};

let rt: TestRuntime;
const all = (ctx = rt.ctx) =>
  ctx.db
    .select({ f: findings, fp: changeEvents.fingerprint })
    .from(findings)
    .innerJoin(changeEvents, eq(changeEvents.id, findings.changeEventId));

beforeAll(async () => {
  rt = await createTestRuntime();
  await seedDemo(rt.ctx);
});
afterAll(async () => rt.close());

describe('demo scenario (end to end)', () => {
  it('produces exactly the expected findings: no misses and no extras', async () => {
    const rows = await all();
    const got = rows.map((r) => `${r.fp}|${r.f.filePath}|${r.f.matchKind}|${r.f.confidence >= 0.85 ? 'verified' : 'possible'}`).sort();
    const want = expected.expected
      .map((e) => `${fingerprintOf('fixture', e.event.split('-')[0]!, e.event)}|${e.file}|${e.matchKind}|${e.impact}`)
      .sort();
    expect(got).toEqual(want);
  });

  it('unrelated code never produces findings', async () => {
    const rows = await all();
    for (const n of expected.mustNotMatch) {
      const hits = rows.filter((r) => r.f.filePath === n.file);
      if (n.symbol) expect(hits.every((h) => !h.f.snippet.split('\n')[2]?.includes('paymentIntents'))).toBe(true);
      else expect(hits).toEqual([]);
    }
  });

  it('findings carry evidence, explanation, limitations, snippet and remediation', async () => {
    const f = (await all()).find((r) => r.f.filePath === 'src/payments.ts')!.f;
    expect(f).toMatchObject({ severity: 'high', matchKind: 'exact_symbol', line: 8, status: 'open' });
    expect(f.snippet).toContain('stripe.charges.create');
    expect(f.snippet).not.toContain('sk_test_');
    expect(f.evidence.map((e) => e.type)).toEqual(expect.arrayContaining(['source_quote', 'code', 'import']));
    expect(f.limitations.length).toBeGreaterThan(20);
    expect(f.remediation).toMatch(/paymentIntents/);
  });

  it('possible impacts are labelled as such with their uncertainty', async () => {
    const dyn = (await all()).find((r) => r.f.matchKind === 'dynamic_prefix')!.f;
    expect(dyn.title).toMatch(/^Possible impact:/);
    expect(dyn.confidence).toBeLessThan(0.5);
    expect(dyn.limitations).toMatch(/runtime/);
  });

  it('is idempotent: reseeding creates no duplicates and keeps finding status', async () => {
    const before = await all();
    const target = before.find((r) => r.f.filePath === 'src/payments.ts')!.f;
    await updateFindingStatus(rt.ctx, target.id, { status: 'fixed', note: 'migrated' });
    const eventsBefore = (await rt.ctx.db.select().from(changeEvents)).length;
    await seedDemo(rt.ctx);
    const after = await all();
    expect(after.length).toBe(before.length);
    expect((await rt.ctx.db.select().from(changeEvents)).length).toBe(eventsBefore);
    const again = after.find((r) => r.f.id === target.id)!.f;
    expect(again.status).toBe('fixed');
    expect(again.statusNote).toBe('migrated');
    await updateFindingStatus(rt.ctx, target.id, { status: 'open' });
  });

  it('OpenAPI diff events exist only after the second snapshot and are labelled demo', async () => {
    const evs = await rt.ctx.db.select().from(changeEvents).where(eq(changeEvents.detectionMethod, 'openapi_diff'));
    expect(evs).toHaveLength(4);
    expect(evs.every((e) => e.origin === 'demo' && e.previousSnapshotId && e.snapshotId)).toBe(true);
  });
});

describe('change deduplication', () => {
  it('reprocessing a snapshot creates no duplicate events', async () => {
    const [row] = await rt.ctx.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .innerJoin(providerSources, eq(providerSources.id, sourceSnapshots.sourceId))
      .where(eq(providerSources.kind, 'fixture_events'))
      .limit(1);
    const snap = row;
    const first = await processSnapshot(rt.ctx, snap!.id);
    expect(first.created).toBe(0);
    expect(first.duplicates).toBeGreaterThan(0);
  });
  it('polling an unchanged fixture source is a no-op', async () => {
    const [s] = await rt.ctx.db.select().from(providerSources).where(eq(providerSources.origin, 'demo')).limit(1);
    const before = (await rt.ctx.db.select().from(sourceSnapshots)).length;
    expect((await pollSource(rt.ctx, s!.id)).outcome).toBe('unchanged');
    expect((await rt.ctx.db.select().from(sourceSnapshots)).length).toBe(before);
  });
});

describe('live-source polling against a local HTTP server', () => {
  let server: http.Server;
  let url: string;
  let mode: 'ok' | 'fail' = 'ok';
  let body = '';
  const feed = (title: string) =>
    `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://example.com/x</link><guid>${title}</guid><description>Effective 2027-01-01.</description></item></channel></rss>`;
  let sourceId: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (mode === 'fail') {
        res.statusCode = 500;
        return res.end('boom');
      }
      const etag = `"${body.length}"`;
      res.setHeader('etag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        return res.end();
      }
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`;
    const [stripe] = await rt.ctx.db.select().from(providers).where(eq(providers.slug, 'stripe'));
    const [src] = await rt.ctx.db
      .insert(providerSources)
      .values({ providerId: stripe!.id, kind: 'rss', url, label: 'local test feed', origin: 'live' })
      .returning();
    sourceId = src!.id;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('is skipped while live polling is disabled', async () => {
    body = feed('Deprecation of `stripe.foo.bar`');
    expect((await pollSource(rt.ctx, sourceId)).outcome).toBe('skipped');
    await updateSettings(rt.ctx.db, rt.ctx.config, { monitoring: { livePollingEnabled: true, pollIntervalMinutes: 60 } });
  });

  it('creates events from a changed feed, labelled live, and dedupes repeated polls', async () => {
    const r1 = await pollSource(rt.ctx, sourceId);
    expect(r1.outcome).toBe('changed');
    const evs = async () => rt.ctx.db.select().from(changeEvents).where(eq(changeEvents.sourceId, sourceId));
    expect(await evs()).toHaveLength(1);
    expect((await evs())[0]).toMatchObject({ origin: 'live', changeType: 'deprecation', detectionMethod: 'feed_keyword' });
    expect((await pollSource(rt.ctx, sourceId)).outcome).toBe('not_modified');
    body = feed('Deprecation of `stripe.foo.bar`') + ' ';
    expect((await pollSource(rt.ctx, sourceId)).outcome).toBe('changed'); // new bytes, same item
    expect(await evs()).toHaveLength(1); // fingerprint dedupe
  });

  it('records failures honestly: error stored, failure counted, success timestamp untouched', async () => {
    const [before] = await rt.ctx.db.select().from(providerSources).where(eq(providerSources.id, sourceId));
    mode = 'fail';
    await expect(pollSource(rt.ctx, sourceId)).rejects.toThrow(/HTTP 500/);
    const [after] = await rt.ctx.db.select().from(providerSources).where(eq(providerSources.id, sourceId));
    expect(after!.lastError).toMatch(/HTTP 500/);
    expect(after!.consecutiveFailures).toBe(before!.consecutiveFailures + 1);
    expect(after!.lastSuccessAt!.getTime()).toBe(before!.lastSuccessAt!.getTime());
    const [prov] = (await listProviders(rt.ctx.db)).filter((p) => p.slug === 'stripe');
    expect(prov!.monitoringStatus).toBe('failing');
    mode = 'ok';
    body = feed('Another sunset notice');
    await pollSource(rt.ctx, sourceId);
    const [healed] = await rt.ctx.db.select().from(providerSources).where(eq(providerSources.id, sourceId));
    expect(healed).toMatchObject({ consecutiveFailures: 0, lastError: null });
  });

  it('invalid content fails permanently without being reported as success', async () => {
    body = '<html>not a feed</html>';
    await pollSource(rt.ctx, sourceId); // snapshot stored; interpretation fails in change-processing (inline: recorded)
    const failed = await rt.ctx.db
      .select()
      .from(jobRecords)
      .where(and(eq(jobRecords.queue, 'change-processing'), eq(jobRecords.status, 'failed')));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.error).toMatch(/not a recognizable/);
  });
});

describe('finding lifecycle', () => {
  it('stable fingerprints: moving code updates the finding and removing it marks it no longer detected', async () => {
    const dir = await rt.tempRepo({
      'package.json': '{"dependencies":{"stripe":"^14.0.0"}}',
      'a.ts': `import Stripe from 'stripe';\nconst s = new Stripe('');\ns.charges.create({});\n`,
    });
    const repo = await registerRepository(rt.ctx, { sourceType: 'local', location: dir });
    await startScan(rt.ctx, repo.id);
    const find = async () => (await listFindings(rt.ctx.db, { page: 1, pageSize: 50, sort: 'severity', repositoryId: repo.id })).items;
    const [first] = await find();
    expect(first).toMatchObject({ filePath: 'a.ts', line: 3, stillDetected: true, impact: 'verified' });
    await updateFindingStatus(rt.ctx, first!.id, { status: 'false_positive' });
    await fs.writeFile(path.join(dir, 'a.ts'), `import Stripe from 'stripe';\n\n\nconst s = new Stripe('');\ns.charges.create({});\n`);
    await startScan(rt.ctx, repo.id);
    const moved = await find();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: first!.id, line: 5, status: 'false_positive' });
    await fs.writeFile(path.join(dir, 'a.ts'), `export const x = 1;\n`);
    await startScan(rt.ctx, repo.id);
    expect((await find())[0]).toMatchObject({ id: first!.id, stillDetected: false, status: 'false_positive' });
  });

  it('snoozed findings reopen when the snooze expires', async () => {
    const f = (await all())[0]!.f;
    await updateFindingStatus(rt.ctx, f.id, { status: 'snoozed', snoozeDays: 3 });
    expect((await getFinding(rt.ctx.db, f.id)).status).toBe('snoozed');
    await rt.ctx.db
      .update(findings)
      .set({ snoozedUntil: new Date(Date.now() - 1000) })
      .where(eq(findings.id, f.id));
    expect(await getFinding(rt.ctx.db, f.id)).toMatchObject({ status: 'open', snoozedUntil: null });
  });

  it('updating a missing finding is a 404', async () => {
    await expect(updateFindingStatus(rt.ctx, '00000000-0000-4000-8000-000000000000', { status: 'fixed' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('repository registration and scans', () => {
  it('rejects unsafe locations and duplicates', async () => {
    await expect(registerRepository(rt.ctx, { sourceType: 'local', location: '/etc' })).rejects.toMatchObject({ code: 'unsafe_input' });
    await expect(registerRepository(rt.ctx, { sourceType: 'local', location: '../../etc' })).rejects.toMatchObject({
      code: 'unsafe_input',
    });
    await expect(registerRepository(rt.ctx, { sourceType: 'git', location: 'http://github.com/a/b' })).rejects.toMatchObject({
      code: 'unsafe_input',
    });
    await expect(registerRepository(rt.ctx, { sourceType: 'git', location: 'https://169.254.169.254/a/b' })).rejects.toMatchObject({
      code: 'unsafe_input',
    });
    await expect(
      registerRepository(rt.ctx, { sourceType: 'local', location: path.join(FIXTURES, 'sample-repositories/demo-shop') }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const link = path.join(rt.tempDirs[0]!, 'escape-link');
    await fs.symlink('/etc', link);
    await expect(registerRepository(rt.ctx, { sourceType: 'local', location: link })).rejects.toMatchObject({ code: 'unsafe_input' });
    const ok = await registerRepository(rt.ctx, { sourceType: 'git', location: 'https://github.com/acme/widgets.git' });
    expect(ok.location).toBe('https://github.com/acme/widgets');
  });

  it('an empty repository scans successfully and yields no findings', async () => {
    const dir = await rt.tempRepo({ 'README.md': '# empty' });
    const repo = await registerRepository(rt.ctx, { sourceType: 'local', location: dir });
    const { scan } = await startScan(rt.ctx, repo.id);
    expect(scan).toMatchObject({ status: 'succeeded', filesIndexed: 0 });
  });

  it('scan failures are recorded: a directory that vanished or moved outside the roots fails the scan', async () => {
    const dir = await rt.tempRepo({ 'a.ts': 'export {}' });
    const repo = await registerRepository(rt.ctx, { sourceType: 'local', location: dir });
    await fs.rm(dir, { recursive: true });
    const { scan } = await startScan(rt.ctx, repo.id);
    expect(scan.status).toBe('failed');
    expect(scan.error).toMatch(/does not exist/);
    const [rec] = await rt.ctx.db
      .select()
      .from(jobRecords)
      .where(eq(jobRecords.jobId, `scan-${scan.id}`));
    expect(rec).toMatchObject({ queue: 'repository-scan', status: 'failed' });
  });

  it('starting a scan while one is queued returns the active scan', async () => {
    const dir = await rt.tempRepo({ 'a.ts': 'export {}' });
    const repo = await registerRepository(rt.ctx, { sourceType: 'local', location: dir });
    const [queued] = await rt.ctx.db.insert(repositoryScans).values({ repositoryId: repo.id, status: 'queued' }).returning();
    const r = await startScan(rt.ctx, repo.id);
    expect(r.deduplicated).toBe(true);
    expect(r.scan.id).toBe(queued!.id);
    await expect(startScan(rt.ctx, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(AppError);
  });

  it('inline dispatcher records handler failures in job_records without crashing the caller', async () => {
    await expect(runScan(rt.ctx, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/not found/);
    const r = await rt.ctx.dispatcher.enqueue('repository-scan', { scanId: '00000000-0000-4000-8000-000000000001' }, { jobId: 'bad-scan' });
    expect(r.deduplicated).toBe(false);
    const [rec] = await rt.ctx.db.select().from(jobRecords).where(eq(jobRecords.jobId, 'bad-scan'));
    expect(rec).toMatchObject({ status: 'failed' });
    expect((await rt.ctx.dispatcher.enqueue('repository-scan', { scanId: 'x' }, { jobId: 'bad-scan' })).deduplicated).toBe(true);
  });
});

describe('notifications', () => {
  it('are skipped by default and logged (not sent) when enabled, honouring minimum severity', async () => {
    expect((await rt.ctx.dispatcher.enqueue('notifications', { findingIds: [] })).deduplicated).toBe(false);
    expect(await rt.ctx.db.select().from(notifications)).toHaveLength(0);
    await updateSettings(rt.ctx.db, rt.ctx.config, {
      notifications: { emailEnabled: true, recipients: ['dev@example.com'], minSeverity: 'critical' },
    });
    const ids = (await all()).map((r) => r.f.id);
    await rt.ctx.dispatcher.enqueue('notifications', { findingIds: ids });
    const rows = await rt.ctx.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', recipient: 'dev@example.com', status: 'logged' });
    expect(rows[0]!.body).toContain('CRITICAL');
    expect(rows[0]!.body).not.toContain('[MEDIUM]');
    expect((await getSettings(rt.ctx.db, rt.ctx.config)).notifications.minSeverity).toBe('critical');
  });
});
