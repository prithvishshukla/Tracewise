import clsx from 'clsx';
import { AlertTriangle, FlaskConical, Inbox } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { impactClass, type FindingStatus, type Severity } from '@tracewise/shared';
import { SEVERITY_CLASS, SEVERITY_LABEL, STATUS_CLASS, STATUS_LABEL, pct } from '@/lib/format';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-card', className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action, subtitle }: { title: string; action?: ReactNode; subtitle?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  );
}
export const SeverityBadge = ({ severity }: { severity: Severity }) => (
  <Badge className={SEVERITY_CLASS[severity]}>{SEVERITY_LABEL[severity]}</Badge>
);
export const StatusBadge = ({ status }: { status: FindingStatus }) => (
  <Badge className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
);

export function ImpactBadge({ confidence }: { confidence: number }) {
  const verified = impactClass(confidence) === 'verified';
  return (
    <Badge
      className={verified ? 'bg-success/15 text-success ring-success/30' : 'bg-warning/15 text-warning ring-warning/30'}
      title={
        verified
          ? 'Static analysis found concrete evidence that the changed API is used here.'
          : 'Evidence is partial. Treat as a lead to investigate, not a confirmed impact.'
      }
    >
      {verified ? 'Verified' : 'Possible'}
    </Badge>
  );
}

export function DemoBadge({ label = 'DEMO DATA' }: { label?: string }) {
  return (
    <Badge
      className="bg-warning/15 text-warning ring-warning/40"
      title="Simulated data seeded for demonstration. Not retrieved from a real provider."
    >
      <FlaskConical className="h-3 w-3" aria-hidden /> {label}
    </Badge>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 0.85 ? 'bg-success' : value >= 0.6 ? 'bg-warning' : 'bg-error';
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Confidence ${pct(value)}`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
        <div className={clsx('h-full rounded-full', color)} style={{ width: pct(value) }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{pct(value)}</span>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: 'danger';
}) {
  const body = (
    <div className={clsx('rounded-xl border border-line bg-card p-4 transition-colors', href && 'hover:border-accentHover')}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={clsx('mt-1.5 text-3xl font-semibold tabular-nums', tone === 'danger' && Number(value) > 0 ? 'text-error' : 'text-fg')}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, action }: { title?: string; message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-error/40 bg-error/10 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-error" aria-hidden />
      <div className="text-sm">
        <p className="font-medium text-error">{title}</p>
        <p className="mt-0.5 text-error/80">{message}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export const buttonClass = (variant: 'primary' | 'secondary' | 'ghost' = 'secondary') =>
  clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    variant === 'primary' && 'bg-accent text-bg hover:bg-accentHover',
    variant === 'secondary' && 'border border-line bg-card text-fg hover:border-accentHover',
    variant === 'ghost' && 'text-muted hover:text-fg',
  );

export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={clsx('border-b border-line px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted', className)}>
    {children}
  </th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('border-b border-line/60 px-5 py-3 align-top', className)}>{children}</td>
);

export function CodeSnippet({ code, startLine, highlightLine }: { code: string; startLine: number | null; highlightLine: number | null }) {
  const lines = code.split('\n');
  const first = startLine ?? 1;
  return (
    <pre
      className="overflow-x-auto rounded-lg border border-line bg-bg p-0 font-mono text-[13px] leading-6"
      aria-label="Relevant code snippet"
    >
      <code className="block min-w-max py-2">
        {lines.map((l, i) => {
          const n = first + i;
          const hit = highlightLine === n;
          return (
            <span key={i} className={clsx('flex px-3', hit && 'bg-red-500/10 shadow-[inset_3px_0_0_#f87171]')}>
              <span className="w-10 shrink-0 select-none pr-3 text-right text-muted/70 tabular-nums">{n}</span>
              <span className="whitespace-pre text-fg/90">{l || ' '}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  total: number;
  hrefFor: (p: number) => string;
}) {
  if (totalPages <= 1)
    return (
      <p className="px-5 py-3 text-xs text-muted">
        {total} result{total === 1 ? '' : 's'}
      </p>
    );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-5 py-3 text-sm">
      <p className="text-xs text-muted">
        {total} results · page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={buttonClass()} href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className={buttonClass('ghost') + ' opacity-40'} aria-disabled>
            Previous
          </span>
        )}
        {page < totalPages ? (
          <Link className={buttonClass()} href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : (
          <span className={buttonClass('ghost') + ' opacity-40'} aria-disabled>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
