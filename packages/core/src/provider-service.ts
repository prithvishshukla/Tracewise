import { and, eq, sql } from 'drizzle-orm';
import { providers, providerSources, type Db } from '@tracewise/database';
import type { ProviderConfig } from '@tracewise/shared';

/** Upserts the provider catalog and its sources. Re-running is safe and keeps polling state (etag, hash, timestamps). */
export async function syncProviderCatalog(db: Db, catalog: ProviderConfig[]): Promise<void> {
  for (const c of catalog) {
    const [row] = await db
      .insert(providers)
      .values({
        slug: c.slug,
        name: c.name,
        docsUrl: c.docsUrl,
        description: c.description,
        packages: c.packages,
        hosts: c.hosts,
        config: c,
      })
      .onConflictDoUpdate({
        target: providers.slug,
        set: {
          name: c.name,
          docsUrl: c.docsUrl,
          description: c.description,
          packages: c.packages,
          hosts: c.hosts,
          config: c,
          updatedAt: new Date(),
        },
      })
      .returning({ id: providers.id });
    for (const s of c.sources) {
      await db
        .insert(providerSources)
        .values({ providerId: row!.id, kind: s.kind, url: s.url, label: s.label, origin: s.origin, enabled: s.enabled })
        .onConflictDoUpdate({
          target: [providerSources.providerId, providerSources.url],
          set: { kind: s.kind, label: s.label, origin: s.origin },
        });
    }
  }
}

export async function findProvider(db: Db, idOrSlug: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const [row] = await db
    .select()
    .from(providers)
    .where(isUuid ? eq(providers.id, idOrSlug) : eq(providers.slug, idOrSlug))
    .limit(1);
  return row ?? null;
}

export async function countSourcesByProvider(db: Db) {
  return db
    .select({ providerId: providerSources.providerId, total: sql<number>`count(*)::int` })
    .from(providerSources)
    .where(and(eq(providerSources.enabled, true)))
    .groupBy(providerSources.providerId);
}
