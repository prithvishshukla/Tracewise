import Link from 'next/link';
import type { RepositoryDTO } from '@tracewise/shared';
import { RegisterRepoForm } from '@/components/repo-actions';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Repositories' };

export default async function RepositoriesPage() {
  const { items } = await apiGet<{ items: RepositoryDTO[] }>('/api/repositories');
  return (
    <>
      <PageHeader
        title="Repositories"
        description="Register a local directory or an https Git URL. Scans read files only and never run repository code."
      />
      <Card className="mb-6">
        <CardHeader title="Register a repository" />
        <RegisterRepoForm />
      </Card>
      <Card>
        <CardHeader title={`Registered repositories (${items.length})`} />
        {items.length === 0 ? (
          <EmptyState title="No repositories yet" description="Register one above, or run `npm run db:seed` to add the demo repository." />
        ) : (
          <ul>
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line/60 px-5 py-4 last:border-0">
                <div className="min-w-0">
                  <Link href={`/repositories/${r.id}`} className="font-medium hover:text-accent">
                    {r.name}
                  </Link>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted">{r.location}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.providers.length ? (
                      r.providers.map((p) => (
                        <Badge key={p} className="bg-raised text-muted ring-line">
                          {p}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted">No provider dependencies detected</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right">
                    <p className="text-xs text-muted">Last scan</p>
                    <p>{relativeTime(r.lastScanAt)}</p>
                  </div>
                  {r.latestScanStatus && (
                    <Badge
                      className={
                        r.latestScanStatus === 'succeeded'
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'
                          : r.latestScanStatus === 'failed'
                            ? 'bg-red-500/15 text-red-300 ring-red-400/40'
                            : 'bg-accent/15 text-blue-300 ring-accent/40'
                      }
                    >
                      {r.latestScanStatus}
                    </Badge>
                  )}
                  <Link
                    href={`/findings?repositoryId=${r.id}&status=open`}
                    className="rounded-md bg-raised px-2.5 py-1 text-xs hover:text-accent"
                  >
                    {r.openFindings} open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
