import Link from 'next/link';
import { CHANGE_TYPES, SEVERITIES, affectedLabel, type ChangeDTO, type Paginated, type ProviderDTO } from '@tracewise/shared';
import { FilterBar } from '@/components/filter-bar';
import { Badge, Card, DemoBadge, EmptyState, PageHeader, Pagination, SeverityBadge } from '@/components/ui';
import { apiGet, one, qs, type SearchParams } from '@/lib/api';
import { CHANGE_TYPE_LABEL, SEVERITY_LABEL, formatDate } from '@/lib/format';

export const metadata = { title: 'API changes' };

export default async function ChangesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = {
    q: one(sp.q),
    provider: one(sp.provider),
    severity: one(sp.severity),
    changeType: one(sp.changeType),
    origin: one(sp.origin),
    sort: one(sp.sort),
    page: one(sp.page),
  };
  const [data, providers] = await Promise.all([
    apiGet<Paginated<ChangeDTO>>(`/api/changes${qs({ ...q, pageSize: 15 })}`),
    apiGet<{ items: ProviderDTO[] }>('/api/providers'),
  ]);
  return (
    <>
      <PageHeader
        title="API change feed"
        description="Deprecations, removals and breaking changes detected from provider sources. Items marked DEMO DATA are simulated; everything else came from a real feed or spec."
      />
      <Card>
        <FilterBar
          fields={[
            { name: 'q', label: 'Search', type: 'search', placeholder: 'Title or summary' },
            {
              name: 'provider',
              label: 'Provider',
              type: 'select',
              options: providers.items.map((p) => ({ value: p.slug, label: p.name })),
            },
            {
              name: 'severity',
              label: 'Severity',
              type: 'select',
              options: SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] })),
            },
            {
              name: 'changeType',
              label: 'Type',
              type: 'select',
              options: CHANGE_TYPES.map((c) => ({ value: c, label: CHANGE_TYPE_LABEL[c] })),
            },
            {
              name: 'origin',
              label: 'Origin',
              type: 'select',
              options: [
                { value: 'live', label: 'Live source' },
                { value: 'demo', label: 'Demo data' },
              ],
            },
            {
              name: 'sort',
              label: 'Sort',
              type: 'select',
              options: [
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
              ],
            },
          ]}
        />
        {data.items.length === 0 ? (
          <EmptyState title="No changes match" description="Clear a filter, or seed demo data with `npm run db:seed`." />
        ) : (
          <ul>
            {data.items.map((c) => (
              <li key={c.id} className="border-b border-line/60 px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={c.severity} />
                  <Badge className="bg-raised text-muted ring-line">{CHANGE_TYPE_LABEL[c.changeType]}</Badge>
                  <span className="text-xs text-muted">{c.providerName}</span>
                  {c.origin === 'demo' && <DemoBadge />}
                  {(c.findingCount ?? 0) > 0 && (
                    <Badge className="bg-red-500/10 text-red-300 ring-red-400/30">
                      {c.findingCount} finding{c.findingCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <Link href={`/changes/${c.id}`} className="mt-1.5 block font-medium hover:text-accent">
                  {c.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{c.summary}</p>
                <p className="mt-1.5 text-xs text-muted">
                  {c.affected.length ? (
                    <>
                      Affects <span className="font-mono">{c.affected.map(affectedLabel).join(', ')}</span> ·{' '}
                    </>
                  ) : null}
                  published {formatDate(c.publishedAt ?? c.detectedAt)} · {c.detectionMethod.replace('_', ' ')} · confidence{' '}
                  {Math.round(c.confidence * 100)}%
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} totalPages={data.totalPages} total={data.total} hrefFor={(p) => `/changes${qs({ ...q, page: p })}`} />
      </Card>
    </>
  );
}
