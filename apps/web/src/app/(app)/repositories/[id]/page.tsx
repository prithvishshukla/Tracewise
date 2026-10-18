import Link from 'next/link';
import type { DependencyDTO, FindingDTO, IndexedFileDTO, Paginated, RepositoryDetailDTO, ScanDTO } from '@tracewise/shared';
import { FilterBar } from '@/components/filter-bar';
import { ScanButton } from '@/components/repo-actions';
import { Badge, Card, CardHeader, EmptyState, ImpactBadge, PageHeader, SeverityBadge, Stat, Table, Td, Th } from '@/components/ui';
import { apiGet, one, orNotFound, qs, type SearchParams } from '@/lib/api';
import { formatBytes, formatDate, relativeTime } from '@/lib/format';

export default async function RepositoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const repo = await apiGet<RepositoryDetailDTO>(`/api/repositories/${id}`).catch(orNotFound);
  const [deps, files, scans, found] = await Promise.all([
    apiGet<{ items: DependencyDTO[] }>(`/api/repositories/${id}/dependencies`),
    apiGet<Paginated<IndexedFileDTO>>(`/api/repositories/${id}/files${qs({ q: one(sp.fq), pageSize: 15 })}`),
    apiGet<{ items: ScanDTO[] }>(`/api/repositories/${id}/scans`),
    apiGet<Paginated<FindingDTO>>(`/api/repositories/${id}/findings${qs({ status: 'open', pageSize: 8 })}`),
  ]);
  const warnings = repo.latestScan?.warnings ?? [];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/repositories" className="hover:text-fg">
          Repositories
        </Link>{' '}
        / <span className="text-fg">{repo.name}</span>
      </nav>
      <PageHeader
        title={repo.name}
        description={`${repo.sourceType === 'git' ? 'Git' : 'Local'} · ${repo.location}`}
        actions={<ScanButton repositoryId={repo.id} label={repo.lastScanAt ? 'Scan again' : 'Start first scan'} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Last scan"
          value={<span className="text-xl">{relativeTime(repo.lastScanAt)}</span>}
          hint={repo.latestScan?.status ?? 'never scanned'}
        />
        <Stat label="Indexed files" value={repo.fileCount} />
        <Stat label="Provider call sites" value={repo.callSiteCount} />
        <Stat label="Open findings" value={repo.openFindings} href={`/findings?repositoryId=${repo.id}&status=open`} tone="danger" />
      </div>

      {repo.latestScan?.status === 'failed' && (
        <div role="alert" className="mt-6 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">
          <strong>Last scan failed:</strong> {repo.latestScan.error}
        </div>
      )}
      {warnings.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title={`Scan warnings (${warnings.length})`}
            subtitle="Files that could not be fully analysed. The rest of the scan is unaffected."
          />
          <ul className="divide-y divide-line/60">
            {warnings.slice(0, 10).map((w, i) => (
              <li key={i} className="px-5 py-2.5 text-sm">
                <span className="font-mono text-xs text-muted">{w.path ?? 'scan'}</span> {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Detected provider dependencies" />
          {deps.items.length === 0 ? (
            <EmptyState
              title="No provider dependencies found"
              description="No known provider SDK (Stripe, GitHub/Octokit, Twilio, OpenAI) appears in package.json, requirements.txt, pyproject.toml or lockfiles. Raw HTTP calls to provider hosts can still produce call sites."
            />
          ) : (
            <Table caption="Detected dependencies">
              <thead>
                <tr>
                  <Th>Package</Th>
                  <Th>Version</Th>
                  <Th>Manifest</Th>
                </tr>
              </thead>
              <tbody>
                {deps.items.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <span className="font-medium">{d.packageName}</span>
                      <p className="text-xs text-muted">
                        {d.providerSlug} · {d.ecosystem}
                      </p>
                    </Td>
                    <Td className="font-mono text-xs">{d.resolvedVersion ?? d.versionSpec ?? '—'}</Td>
                    <Td>
                      <span className="font-mono text-xs">{d.manifestPath}</span>
                      <p className="text-xs text-muted">{d.source}</p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Open findings"
            action={
              <Link href={`/findings?repositoryId=${repo.id}`} className="text-xs text-accent hover:underline">
                All findings
              </Link>
            }
          />
          {found.items.length === 0 ? (
            <EmptyState title="No open findings" description="Nothing in the latest scan matches a known upstream change." />
          ) : (
            <ul>
              {found.items.map((f) => (
                <li key={f.id} className="border-b border-line/60 px-5 py-3 text-sm last:border-0">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <ImpactBadge confidence={f.confidence} />
                  </div>
                  <Link href={`/findings/${f.id}`} className="mt-1 block font-medium hover:text-accent">
                    {f.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Indexed files (${files.total})`}
          subtitle="Source files and manifests from the latest scan. Contents are not stored; only call-site snippets are."
        />
        <FilterBar fields={[{ name: 'fq', label: 'Filter by path', type: 'search', placeholder: 'src/payments' }]} />
        {files.items.length === 0 ? (
          <EmptyState title="No indexed files" description="Run a scan, or check that the directory contains .ts/.js/.py files." />
        ) : (
          <Table caption="Indexed files">
            <thead>
              <tr>
                <Th>Path</Th>
                <Th>Language</Th>
                <Th>Size</Th>
              </tr>
            </thead>
            <tbody>
              {files.items.map((f) => (
                <tr key={f.id}>
                  <Td className="font-mono text-xs">{f.path}</Td>
                  <Td>
                    <Badge className="bg-raised text-muted ring-line">{f.language}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">{formatBytes(f.sizeBytes)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {files.totalPages > 1 && (
          <p className="px-5 py-3 text-xs text-muted">
            Showing the first {files.items.length} of {files.total}. Narrow with the filter.
          </p>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Scan history" />
        <Table caption="Scan history">
          <thead>
            <tr>
              <Th>Started</Th>
              <Th>Status</Th>
              <Th>Files</Th>
              <Th>Deps</Th>
              <Th>Call sites</Th>
              <Th>New findings</Th>
            </tr>
          </thead>
          <tbody>
            {scans.items.map((s) => (
              <tr key={s.id}>
                <Td>{formatDate(s.startedAt ?? s.createdAt, true)}</Td>
                <Td>
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
                </Td>
                <Td>{s.filesIndexed}</Td>
                <Td>{s.dependenciesCount}</Td>
                <Td>{s.callSitesCount}</Td>
                <Td>{s.findingsCreated}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
