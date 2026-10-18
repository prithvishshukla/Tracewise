import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { affectedLabel, type ChangeDetailDTO } from '@tracewise/shared';
import { Badge, Card, CardHeader, ConfidenceMeter, DemoBadge, ImpactBadge, SeverityBadge, StatusBadge } from '@/components/ui';
import { apiGet, orNotFound } from '@/lib/api';
import { CHANGE_TYPE_LABEL, formatDate } from '@/lib/format';

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await apiGet<ChangeDetailDTO>(`/api/changes/${id}`).catch(orNotFound);
  const simulated = c.sourceUrl.includes('example.invalid');
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/changes" className="hover:text-fg">
          API changes
        </Link>{' '}
        / <span className="text-fg">{c.providerName}</span>
      </nav>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={c.severity} />
          <Badge className="bg-raised text-muted ring-line">{CHANGE_TYPE_LABEL[c.changeType]}</Badge>
          {c.origin === 'demo' && <DemoBadge />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
      </header>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Summary" />
            <p className="p-5 text-sm leading-6">{c.summary}</p>
          </Card>
          <Card>
            <CardHeader title="Affected endpoints, fields or SDK symbols" />
            {c.affected.length === 0 ? (
              <p className="p-5 text-sm text-muted">
                No specific symbol or endpoint was identified, so no repository findings can be generated for this change.
              </p>
            ) : (
              <ul className="divide-y divide-line/60">
                {c.affected.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <Badge className="bg-raised text-muted ring-line">{a.kind.replace('_', ' ')}</Badge>
                    <code className="font-mono text-[13px]">{affectedLabel(a)}</code>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Evidence" />
            <ul className="divide-y divide-line/60">
              {c.evidence.map((e, i) => (
                <li key={i} className="px-5 py-3 text-sm">
                  <span className="font-medium">{e.label}</span>
                  {e.detail && <p className="mt-1 text-muted">{e.detail}</p>}
                </li>
              ))}
            </ul>
          </Card>
          {c.remediation && (
            <Card>
              <CardHeader title="Suggested remediation" />
              <p className="whitespace-pre-line p-5 text-sm leading-6">{c.remediation}</p>
            </Card>
          )}
          <Card>
            <CardHeader title={`Affected locations in your repositories (${c.findings.length})`} />
            {c.findings.length === 0 ? (
              <p className="p-5 text-sm text-muted">No scanned repository uses the affected API.</p>
            ) : (
              <ul>
                {c.findings.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-line/60 px-5 py-3 text-sm last:border-0">
                    <SeverityBadge severity={f.severity} />
                    <ImpactBadge confidence={f.confidence} />
                    <Link href={`/findings/${f.id}`} className="font-mono text-xs hover:text-accent">
                      {f.repositoryName}: {f.filePath}
                      {f.line ? `:${f.line}` : ''}
                    </Link>
                    <StatusBadge status={f.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Details" />
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-3 p-5 text-sm">
            <dt className="text-muted">Provider</dt>
            <dd>
              <Link href={`/providers/${c.providerSlug}`} className="text-accent hover:underline">
                {c.providerName}
              </Link>
            </dd>
            <dt className="text-muted">Published</dt>
            <dd>{formatDate(c.publishedAt)}</dd>
            <dt className="text-muted">Effective</dt>
            <dd>{formatDate(c.effectiveAt)}</dd>
            <dt className="text-muted">Detected</dt>
            <dd>{formatDate(c.detectedAt, true)}</dd>
            <dt className="text-muted">Detection</dt>
            <dd>{c.detectionMethod.replace('_', ' ')}</dd>
            <dt className="text-muted">Confidence</dt>
            <dd>
              <ConfidenceMeter value={c.confidence} />
            </dd>
            <dt className="text-muted">Source</dt>
            <dd>
              {simulated ? (
                <span className="text-muted">Simulated demo event (no real source)</span>
              ) : (
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-accent hover:underline"
                >
                  {c.sourceLabel ?? 'Open source'} <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
                </a>
              )}
            </dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
