import { ArrowUpRight, Info } from 'lucide-react';
import Link from 'next/link';
import { affectedLabel, type FindingDTO } from '@tracewise/shared';
import { StatusControls } from '@/components/status-controls';
import { Badge, Card, CardHeader, CodeSnippet, ConfidenceMeter, DemoBadge, ImpactBadge, SeverityBadge, StatusBadge } from '@/components/ui';
import { apiGet, orNotFound } from '@/lib/api';
import { CHANGE_TYPE_LABEL, MATCH_KIND_LABEL, formatDate } from '@/lib/format';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await apiGet<FindingDTO>(`/api/findings/${id}`).catch(() => null);
  return { title: f ? f.title : 'Finding' };
}

export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await apiGet<FindingDTO>(`/api/findings/${id}`).catch(orNotFound);
  const verified = f.impact === 'verified';
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/findings" className="hover:text-fg">
          Findings
        </Link>{' '}
        / <span className="text-fg">{f.providerName}</span>
      </nav>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <ImpactBadge confidence={f.confidence} />
          <StatusBadge status={f.status} />
          {f.changeOrigin === 'demo' && <DemoBadge />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{f.title}</h1>
        <p className="mt-1 font-mono text-sm text-muted">
          {f.repositoryName} · {f.filePath}
          {f.line ? `:${f.line}` : ''}
        </p>
      </header>

      {!verified && (
        <div role="note" className="mb-6 flex gap-3 rounded-xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>Possible impact, not confirmed.</strong> {f.limitations}
          </p>
        </div>
      )}
      {!f.stillDetected && (
        <div role="note" className="mb-6 rounded-xl border border-line bg-raised p-4 text-sm text-muted">
          This location was not found in the latest scan. The code may have changed. Re-scan or mark the finding as fixed.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Affected code" subtitle={`${f.filePath}${f.line ? `:${f.line}` : ''}`} />
            <div className="p-5">
              <CodeSnippet code={f.snippet} startLine={f.snippetStartLine} highlightLine={f.line} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Why this was flagged" />
            <div className="space-y-4 p-5 text-sm leading-6">
              <p>
                <Badge className="mr-2 bg-accent/15 text-blue-300 ring-accent/40">{MATCH_KIND_LABEL[f.matchKind] ?? f.matchKind}</Badge>
                {f.matchReason}
              </p>
              <p className="text-muted">{f.explanation}</p>
              {verified && (
                <p className="rounded-lg border border-line bg-bg p-3 text-xs text-muted">
                  <strong className="text-fg">Limitations.</strong> {f.limitations}
                </p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Evidence" />
            <ul className="divide-y divide-line/60">
              {f.evidence.map((e, i) => (
                <li key={i} className="px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-raised text-muted ring-line">{e.type.replace('_', ' ')}</Badge>
                    <span className="font-medium">{e.label}</span>
                  </div>
                  {e.detail && <p className="mt-1 font-mono text-xs text-muted">{e.detail}</p>}
                  {e.url && !e.url.includes('example.invalid') && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Source <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Suggested next step" />
            <p className="whitespace-pre-line p-5 text-sm leading-6">{f.remediation}</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Status" />
            <div className="p-5">
              <StatusControls findingId={f.id} status={f.status} />
              {f.snoozedUntil && <p className="mt-3 text-xs text-muted">Snoozed until {formatDate(f.snoozedUntil)}</p>}
              {f.statusNote && <p className="mt-3 text-xs text-muted">Note: {f.statusNote}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 p-5 text-sm">
              <dt className="text-muted">Confidence</dt>
              <dd>
                <ConfidenceMeter value={f.confidence} />
              </dd>
              <dt className="text-muted">Provider</dt>
              <dd>{f.providerName}</dd>
              <dt className="text-muted">Repository</dt>
              <dd>
                <Link href={`/repositories/${f.repositoryId}`} className="text-accent hover:underline">
                  {f.repositoryName}
                </Link>
              </dd>
              <dt className="text-muted">First seen</dt>
              <dd>{formatDate(f.createdAt)}</dd>
              <dt className="text-muted">Last updated</dt>
              <dd>{formatDate(f.updatedAt)}</dd>
            </dl>
          </Card>
          {f.change && (
            <Card>
              <CardHeader title="Upstream change" />
              <div className="space-y-2 p-5 text-sm">
                <div className="flex flex-wrap gap-2">
                  <SeverityBadge severity={f.change.severity} />
                  <Badge className="bg-raised text-muted ring-line">{CHANGE_TYPE_LABEL[f.change.changeType]}</Badge>
                </div>
                <Link href={`/changes/${f.change.id}`} className="block font-medium hover:text-accent">
                  {f.change.title}
                </Link>
                <p className="text-xs text-muted">{f.change.affected.map(affectedLabel).join(', ') || 'No specific symbol listed'}</p>
                <p className="text-xs text-muted">Effective: {formatDate(f.change.effectiveAt)}</p>
              </div>
            </Card>
          )}
          {f.related && f.related.length > 0 && (
            <Card>
              <CardHeader title="Related findings" />
              <ul>
                {f.related.map((r) => (
                  <li key={r.id} className="border-b border-line/60 px-5 py-3 text-sm last:border-0">
                    <Link href={`/findings/${r.id}`} className="font-medium hover:text-accent">
                      {r.title}
                    </Link>
                    <div className="mt-1 flex items-center gap-2">
                      <SeverityBadge severity={r.severity} />
                      <span className="font-mono text-xs text-muted">
                        {r.filePath}
                        {r.line ? `:${r.line}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
