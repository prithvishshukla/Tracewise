import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { providers, providerSources } from '@tracewise/database';
import { PROVIDER_CATALOG, readFixture } from '@tracewise/providers';
import type { CoreContext } from './context';
import { pollSource, storeSnapshot } from './monitoring';
import { syncProviderCatalog } from './provider-service';
import { registerRepository, startScan } from './repositories';
import { AppError } from './errors';

export const DEMO_REPO_DIR = 'sample-repositories/demo-shop';
const OPENAPI_V1 = 'fixture:provider-changes/openapi/stripe-mini-v1.json';
const OPENAPI_V2 = 'fixture:provider-changes/openapi/stripe-mini-v2.json';

export interface SeedSummary {
  providers: number;
  changeEventsCreatedByPoll: number;
  repositoryId: string;
  scanStatus: string;
}

/**
 * Seeds the deterministic demo: provider catalog, simulated change events (all labelled demo data),
 * a baseline + updated mini OpenAPI snapshot (to exercise the diff), and a scan of the sample repository.
 * Safe to run repeatedly: events dedupe by fingerprint and findings keep their status.
 * Requires an inline dispatcher so everything completes before returning.
 */
export async function seedDemo(ctx: CoreContext): Promise<SeedSummary> {
  await syncProviderCatalog(ctx.db, PROVIDER_CATALOG);

  const [stripe] = await ctx.db.select().from(providers).where(eq(providers.slug, 'stripe')).limit(1);
  const [openapiSource] = await ctx.db
    .select()
    .from(providerSources)
    .where(and(eq(providerSources.providerId, stripe!.id), eq(providerSources.url, OPENAPI_V2)))
    .limit(1);
  if (openapiSource && !openapiSource.lastContentHash) {
    await storeSnapshot(ctx, { source: openapiSource, providerSlug: 'stripe' }, await readFixture(OPENAPI_V1, ctx.config.fixturesDir));
  }

  const demoSources = await ctx.db.select().from(providerSources).where(eq(providerSources.origin, 'demo'));
  for (const s of demoSources) await pollSource(ctx, s.id);

  const location = path.join(ctx.config.fixturesDir, DEMO_REPO_DIR);
  let repoId: string;
  try {
    repoId = (await registerRepository(ctx, { name: 'demo-shop (sample repository)', sourceType: 'local', location })).id;
  } catch (e) {
    if (e instanceof AppError && e.code === 'conflict') repoId = (e.details as { id: string }).id;
    else throw e;
  }
  const { scan } = await startScan(ctx, repoId);
  return { providers: PROVIDER_CATALOG.length, changeEventsCreatedByPoll: 0, repositoryId: repoId, scanStatus: scan.status };
}
