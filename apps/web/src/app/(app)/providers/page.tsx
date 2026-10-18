import Link from 'next/link';
import type { MonitoringStatus, ProviderDTO } from '@tracewise/shared';
import { Badge, Card, PageHeader } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Providers' };
const STATUS: Record<MonitoringStatus, { text: string; cls: string }> = {
  demo: { text: 'Demo data only', cls: 'bg-violet-500/15 text-violet-300 ring-violet-400/40' },
  ok: { text: 'Live: healthy', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  failing: { text: 'Live: failing', cls: 'bg-red-500/15 text-red-300 ring-red-400/40' },
  never_checked: { text: 'Not checked', cls: 'bg-slate-500/15 text-slate-300 ring-slate-400/30' },
};

export default async function ProvidersPage() {
  const { items } = await apiGet<{ items: ProviderDTO[] }>('/api/providers');
  return (
    <>
      <PageHeader
        title="Providers"
        description="The provider catalog is data-driven: each provider is a JSON file listing its packages, API hosts and monitored sources."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/providers/${p.slug}`} className="text-lg font-semibold hover:text-accent">
                  {p.name}
                </Link>
                <p className="mt-1 text-sm text-muted">{p.description}</p>
              </div>
              <Badge className={STATUS[p.monitoringStatus].cls}>{STATUS[p.monitoringStatus].text}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Changes</dt>
                <dd className="font-medium tabular-nums">{p.changeCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Packages</dt>
                <dd className="font-mono text-xs">
                  {p.packages
                    .map((x) => x.name)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Last success</dt>
                <dd>{relativeTime(p.lastSuccessAt)}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}
