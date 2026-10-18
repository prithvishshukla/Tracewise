import Link from 'next/link';
import type { DashboardStats } from '@tracewise/shared';
import { Badge, Card, CardHeader, DemoBadge, EmptyState, PageHeader, SeverityBadge, Stat } from '@/components/ui';
import { SeverityChart } from '@/components/severity-chart';
import { apiGet } from '@/lib/api';
import { CHANGE_TYPE_LABEL, formatDate, relativeTime } from '@/lib/format';

export const metadata = { title: 'Dashboard' };
const STATUS_STYLE = {
  demo: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
  ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40',
  failing: 'bg-red-500/15 text-red-300 ring-red-400/40',
  never_checked: 'bg-slate-500/15 text-slate-300 ring-slate-400/30',
} as const;
const STATUS_TEXT = { demo: 'Demo data only', ok: 'Live: healthy', failing: 'Live: failing', never_checked: 'Not checked' } as const;

export default async function DashboardPage() {
  const d = await apiGet<DashboardStats>('/api/dashboard/stats');
  return (
    <>
      <PageHeader title="Dashboard" description="What changed upstream, and which of your repositories it may affect." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monitored providers" value={d.providers} href="/providers" />
        <Stat label="Repositories" value={d.repositories} href="/repositories" />
        <Stat label="Open findings" value={d.openFindings} hint={`${d.verifiedFindings} verified`} href="/findings?status=open" />
        <Stat label="Critical findings" value={d.criticalFindings} href="/findings?severity=critical&status=open" tone="danger" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Open findings by severity" />
          <div className="p-4">
            <SeverityChart data={d.findingsBySeverity} />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent upstream changes"
            action={
              <Link href="/changes" className="text-xs text-accent hover:underline">
                View all
              </Link>
            }
          />
          {d.recentChanges.length === 0 ? (
            <EmptyState title="No changes yet" description="Run `npm run db:seed` to load demo data, or enable live polling in Settings." />
          ) : (
            <ul>
              {d.recentChanges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 px-5 py-3 last:border-0">
                  <SeverityBadge severity={c.severity} />
                  <Link href={`/changes/${c.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent">
                    {c.title}
                  </Link>
                  <span className="text-xs text-muted">
                    {c.providerName} · {CHANGE_TYPE_LABEL[c.changeType]}
                  </span>
                  {c.origin === 'demo' && <DemoBadge />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent scanning activity"
            action={
              <Link href="/repositories" className="text-xs text-accent hover:underline">
                Repositories
              </Link>
            }
          />
          {d.recentScans.length === 0 ? (
            <EmptyState title="No scans yet" description="Register a repository and start a scan." />
          ) : (
            <ul>
              {d.recentScans.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-3 text-sm last:border-0">
                  <div className="min-w-0">
                    <Link href={`/repositories/${s.repositoryId}`} className="font-medium hover:text-accent">
                      {s.repositoryName}
                    </Link>
                    <p className="text-xs text-muted">
                      {s.filesIndexed} files · {s.callSitesCount} call sites · {s.findingsCreated} new findings
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge
                      className={
                        s.status === 'succeeded'
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'
                          : s.status === 'failed'
                            ? 'bg-red-500/15 text-red-300 ring-red-400/40'
                            : 'bg-accent/15 text-blue-300 ring-accent/40'
                      }
                    >
                      {s.status}
                    </Badge>
                    <p className="mt-1 text-xs text-muted" title={formatDate(s.createdAt, true)}>
                      {relativeTime(s.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Provider monitoring" subtitle="Live status reflects real feed checks; demo data is simulated." />
          <ul>
            {d.providerStatus.map((p) => (
              <li key={p.slug} className="flex items-center justify-between border-b border-line/60 px-5 py-3 text-sm last:border-0">
                <Link href={`/providers/${p.slug}`} className="font-medium hover:text-accent">
                  {p.name}
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">last success {relativeTime(p.lastSuccessAt)}</span>
                  <Badge className={STATUS_STYLE[p.status]}>{STATUS_TEXT[p.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
