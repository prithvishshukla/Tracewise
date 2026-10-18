import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo, type Runtime } from '@tracewise/core';
import { findings } from '@tracewise/database';
import { buildApp } from '../apps/api/src/app';
import { createTestRuntime, type TestRuntime } from './helpers';

/** The demo flow from the product spec, driven through the HTTP API and verified in the database. */
let rt: TestRuntime;
let app: FastifyInstance;
beforeAll(async () => {
  rt = await createTestRuntime();
  await seedDemo(rt.ctx); // 1-4: provider change fixture, sample repo, scan, matching
  app = await buildApp(rt as Runtime, { logger: false, disableRateLimit: true });
});
afterAll(async () => {
  await app.close();
  await rt.close();
});

describe('demo flow', () => {
  it('walks the full scenario deterministically', async () => {
    const json = async (url: string, init?: { method: 'PATCH'; payload: object }) => (await app.inject({ url, ...init })).json();
    // 5. dashboard shows the finding
    const stats = await json('/api/dashboard/stats');
    expect(stats).toMatchObject({ openFindings: 6, criticalFindings: 1, demoMode: true });
    // 6-7. open the finding and see location, evidence, confidence, severity, remediation
    const list = await json('/api/findings?q=payments.ts');
    expect(list.total).toBe(1);
    const detail = await json(`/api/findings/${list.items[0].id}`);
    expect(detail).toMatchObject({
      filePath: 'src/payments.ts',
      line: 8,
      severity: 'high',
      impact: 'verified',
      matchKind: 'exact_symbol',
      changeOrigin: 'demo',
    });
    expect(detail.snippet).toContain('stripe.charges.create');
    expect(detail.confidence).toBeGreaterThanOrEqual(0.9);
    expect(detail.evidence.length).toBeGreaterThan(1);
    expect(detail.remediation).toContain('paymentIntents');
    // 8-9. snooze, then mark fixed; both persist in PostgreSQL
    await json(`/api/findings/${detail.id}`, { method: 'PATCH', payload: { status: 'snoozed', snoozeDays: 7 } });
    let [row] = await rt.ctx.db.select().from(findings).where(eq(findings.id, detail.id));
    expect(row!.status).toBe('snoozed');
    await json(`/api/findings/${detail.id}`, { method: 'PATCH', payload: { status: 'fixed' } });
    [row] = await rt.ctx.db.select().from(findings).where(eq(findings.id, detail.id));
    expect(row).toMatchObject({ status: 'fixed', snoozedUntil: null });
    expect(
      (
        await rt.ctx.db
          .select()
          .from(findings)
          .where(and(eq(findings.status, 'open')))
      ).length,
    ).toBe(5);
    // unrelated code never produced a finding
    const files = new Set((await rt.ctx.db.select({ f: findings.filePath }).from(findings)).map((r) => r.f));
    for (const f of ['src/lookalike.ts', 'src/ai.ts', 'src/github.ts', 'src/server.ts']) expect(files.has(f)).toBe(false);
  });
});
