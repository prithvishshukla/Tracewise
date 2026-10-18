import type { AffectedItem, ChangeType, Severity } from '@tracewise/shared';

const RULES: { re: RegExp; type: ChangeType; severity: Severity; weight: number }[] = [
  { re: /\b(breaking change|breaking:|backwards?[- ]incompatible)\b/i, type: 'breaking', severity: 'high', weight: 0.7 },
  {
    re: /\b(removed?|removal|removes|no longer (?:available|supported)|will be removed|shut ?down|retire[sd]?|end[- ]of[- ]life|sunset)\b/i,
    type: 'breaking',
    severity: 'high',
    weight: 0.6,
  },
  { re: /\b(deprecat\w+)\b/i, type: 'deprecation', severity: 'medium', weight: 0.65 },
  { re: /\b(will (?:change|stop)|behaviou?r change|changes? to)\b/i, type: 'warning', severity: 'low', weight: 0.45 },
];

export interface Classification {
  changeType: ChangeType;
  severity: Severity;
  confidence: number;
  matched: string[];
}

/** Keyword-based classification. Returns null when nothing indicates a deprecation or breaking change. */
export function classifyText(text: string): Classification | null {
  const hits = RULES.filter((r) => r.re.test(text));
  if (hits.length === 0) return null;
  const order: ChangeType[] = ['breaking', 'deprecation', 'warning', 'informational'];
  const best = [...hits].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0]!;
  const confidence = Math.min(0.75, best.weight + 0.05 * (hits.length - 1));
  return { changeType: best.type, severity: best.severity, confidence, matched: hits.map((h) => h.re.source.slice(0, 40)) };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Finds the first plausible date in text (ISO yyyy-mm-dd or "Month D, YYYY"). */
export function extractDate(text: string): Date | null {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const long = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'i').exec(text);
  if (long) {
    const m = MONTHS.indexOf((long[1] ?? '').toLowerCase());
    const d = new Date(Date.UTC(Number(long[3]), m, Number(long[2])));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Heuristic extraction of affected symbols and endpoints from code spans and "METHOD /path" patterns. */
export function extractAffected(text: string, providerRoots: string[]): AffectedItem[] {
  const items: AffectedItem[] = [];
  const seen = new Set<string>();
  const add = (i: AffectedItem, key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      items.push(i);
    }
  };
  for (const m of text.matchAll(/`([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*){1,5})\(?\)?`/g)) {
    const symbol = m[1] as string;
    if (providerRoots.some((r) => symbol.startsWith(r + '.'))) add({ kind: 'sdk_symbol', symbol }, 's:' + symbol);
  }
  for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-./{}:]+)/g)) {
    add({ kind: 'endpoint', method: m[1] as string, path: m[2] as string }, `e:${m[1]} ${m[2]}`);
  }
  return items;
}
