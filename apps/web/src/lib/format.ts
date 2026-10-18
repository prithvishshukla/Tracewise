import type { ChangeType, FindingStatus, Severity } from '@tracewise/shared';

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' } : { timeZone: 'UTC' }),
  });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff >= 0 ? `${n} ${name}${n > 1 ? 's' : ''} ago` : `in ${n} ${name}${n > 1 ? 's' : ''}`;
    }
  }
  return 'just now';
}

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-300 ring-red-400/40',
  high: 'bg-orange-500/15 text-orange-300 ring-orange-400/40',
  medium: 'bg-amber-400/15 text-amber-200 ring-amber-300/40',
  low: 'bg-sky-500/15 text-sky-300 ring-sky-400/40',
  info: 'bg-slate-500/15 text-slate-300 ring-slate-400/30',
};
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fcd34d',
  low: '#38bdf8',
  info: '#94a3b8',
};
export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  breaking: 'Breaking',
  deprecation: 'Deprecation',
  warning: 'Warning',
  informational: 'Informational',
};
export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  snoozed: 'Snoozed',
  fixed: 'Fixed',
  false_positive: 'False positive',
};
export const STATUS_CLASS: Record<FindingStatus, string> = {
  open: 'bg-accent/15 text-blue-300 ring-accent/40',
  snoozed: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
  fixed: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40',
  false_positive: 'bg-slate-500/15 text-slate-300 ring-slate-400/30',
};
export const MATCH_KIND_LABEL: Record<string, string> = {
  exact_symbol: 'Exact SDK symbol',
  known_endpoint: 'Known endpoint',
  api_path: 'API path only',
  package_version: 'Package version',
  pattern: 'Pattern',
  dynamic_prefix: 'Dynamic call',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const pct = (c: number) => `${Math.round(c * 100)}%`;
