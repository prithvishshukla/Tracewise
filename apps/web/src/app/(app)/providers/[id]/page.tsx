import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ProviderDetailDTO } from '@tracewise/shared';
import { PollButton } from '@/components/repo-actions';
import { Badge, Card, CardHeader, DemoBadge, EmptyState, PageHeader, SeverityBadge, Table, Td, Th } from '@/components/ui';
import { apiGet, orNotFound } from '@/lib/api';
import { CHANGE_TYPE_LABEL, relativeTime } from '@/lib/format';

const STATUS = {
  demo: ['Demo data only', 'bg-violet-500/15 text-violet-300 ring-violet-400/40'],
  ok: ['Live: healthy', 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'],
  failing: ['Live: failing', 'bg-red-500/15 text-red-300 ring-red-400/40'],
  never_checked: ['Not checked', 'bg-slate-500/15 text-slate-300 ring-slate-400/30'],
} as const;

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await apiGet<ProviderDetailDTO>(`/api/providers/${id}`).catch(orNotFound);
  const [label, cls] = STATUS[p.monitoringStatus];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/providers" className="hover:text-fg">
          Providers
        </Link>{' '}
        / <span className="text-fg">{p.name}</span>
      </nav>
      <PageHeader title={p.name} description={p.description} actions={<PollButton providerId={p.id} />} />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <Badge className={cls}>{label}</Badge>
        <span className="text-muted">Last successful check: {relativeTime(p.lastSuccessAt)}</span>
        <a
          href={p.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          Documentation <ArrowUpRight className="h-3 w-3" aria-hidden />
        </a>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Monitored sources"
            subtitle="Demo sources read local fixture files. Live sources are public feeds and are only contacted when live polling is enabled."
          />
          <Table caption="Monitored sources">
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>Type</Th>
                <Th>Last check</Th>
                <Th>Last success</Th>
              </tr>
            </thead>
            <tbody>
              {p.sources.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.label}</span>
                      {s.origin === 'demo' && <DemoBadge label="DEMO" />}
                    </div>
                    {s.origin === 'live' && <p className="mt-0.5 break-all font-mono text-xs text-muted">{s.url}</p>}
                    {s.lastError && (
                      <p className="mt-1 text-xs text-red-300">
                        Error: {s.lastError} ({s.consecutiveFailures} in a row)
                      </p>
                    )}
                  </Td>
                  <Td>{s.kind.replace('_', ' ')}</Td>
                  <Td>{relativeTime(s.lastCheckedAt)}</Td>
                  <Td>{relativeTime(s.lastSuccessAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Detection configuration" />
          <dl className="space-y-4 p-5 text-sm">
            <div>
              <dt className="text-xs text-muted">Package names</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {p.packages.map((x) => (
                  <Badge key={x.ecosystem + x.name} className="bg-raised font-mono text-muted ring-line">
                    {x.ecosystem}:{x.name}
                  </Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">API hosts</dt>
              <dd className="mt-1 font-mono text-xs">{p.hosts.join(', ')}</dd>
            </div>
          </dl>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Recent changes" />
        {p.recentChanges.length === 0 ? (
          <EmptyState title="No changes recorded" description="Run `npm run db:seed` for demo events, or enable live polling." />
        ) : (
          <ul>
            {p.recentChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line/60 px-5 py-3 text-sm last:border-0">
                <SeverityBadge severity={c.severity} />
                <Link href={`/changes/${c.id}`} className="flex-1 font-medium hover:text-accent">
                  {c.title}
                </Link>
                <span className="text-xs text-muted">{CHANGE_TYPE_LABEL[c.changeType]}</span>
                {c.origin === 'demo' && <DemoBadge />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
