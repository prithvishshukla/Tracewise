import Link from 'next/link';
import { SEVERITIES, FINDING_STATUSES, type FindingDTO, type Paginated, type ProviderDTO } from '@tracewise/shared';
import { FilterBar } from '@/components/filter-bar';
import {
  Card,
  ConfidenceMeter,
  EmptyState,
  ImpactBadge,
  PageHeader,
  Pagination,
  SeverityBadge,
  StatusBadge,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { apiGet, one, qs, type SearchParams } from '@/lib/api';
import { SEVERITY_LABEL, STATUS_LABEL } from '@/lib/format';

export const metadata = { title: 'Findings' };

export default async function FindingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = {
    q: one(sp.q),
    provider: one(sp.provider),
    severity: one(sp.severity),
    status: one(sp.status),
    impact: one(sp.impact),
    repositoryId: one(sp.repositoryId),
    page: one(sp.page),
  };
  const [data, providers] = await Promise.all([
    apiGet<Paginated<FindingDTO>>(`/api/findings${qs({ ...q, pageSize: 20 })}`),
    apiGet<{ items: ProviderDTO[] }>('/api/providers'),
  ]);
  const hrefFor = (p: number) => `/findings${qs({ ...q, page: p })}`;
  return (
    <>
      <PageHeader
        title="Findings"
        description="Places in your repositories that an upstream change may affect. Verified means concrete static evidence; possible means partial evidence."
      />
      <Card>
        <FilterBar
          fields={[
            { name: 'q', label: 'Search', type: 'search', placeholder: 'Title, file or reason' },
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
              name: 'status',
              label: 'Status',
              type: 'select',
              options: FINDING_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            },
            {
              name: 'impact',
              label: 'Impact',
              type: 'select',
              options: [
                { value: 'verified', label: 'Verified' },
                { value: 'possible', label: 'Possible' },
              ],
            },
          ]}
        />
        {data.items.length === 0 ? (
          <EmptyState
            title="No findings match"
            description="Adjust the filters, or scan a repository to generate findings. A repository that uses a provider SDK is not flagged unless the changed API is actually used."
          />
        ) : (
          <Table caption="Findings">
            <thead>
              <tr>
                <Th>Severity</Th>
                <Th>Finding</Th>
                <Th>Location</Th>
                <Th>Confidence</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f.id} className="hover:bg-raised/40">
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={f.severity} />
                      <ImpactBadge confidence={f.confidence} />
                    </div>
                  </Td>
                  <Td className="max-w-md">
                    <Link href={`/findings/${f.id}`} className="font-medium hover:text-accent">
                      {f.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {f.providerName} · {f.changeTitle}
                    </p>
                  </Td>
                  <Td>
                    <Link href={`/repositories/${f.repositoryId}`} className="text-xs text-muted hover:text-fg">
                      {f.repositoryName}
                    </Link>
                    <p className="font-mono text-xs">
                      {f.filePath}
                      {f.line ? `:${f.line}` : ''}
                    </p>
                  </Td>
                  <Td>
                    <ConfidenceMeter value={f.confidence} />
                  </Td>
                  <Td>
                    <StatusBadge status={f.status} />
                    {!f.stillDetected && <p className="mt-1 text-xs text-amber-200">No longer detected</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} totalPages={data.totalPages} total={data.total} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
