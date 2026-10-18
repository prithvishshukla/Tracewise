import { redactSecrets } from '../redact';
import type { DetectedCallSite } from '../types';

export const MAX_SITES_PER_FILE = 300;
const MAX_LINE = 200;

export function makeSnippet(lines: string[], line: number, context = 2): { snippet: string; start: number } {
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const slice = lines.slice(start - 1, end).map((l) => (l.length > MAX_LINE ? l.slice(0, MAX_LINE) + '…' : l));
  return { snippet: redactSecrets(slice.join('\n')), start };
}

export function parseUrlParts(value: string): { host: string; path: string } | null {
  const m = /^(?:https?:)?\/\/([^/?#\s]+)([^?#\s]*)/i.exec(value.trim());
  return m?.[1] ? { host: m[1].toLowerCase(), path: m[2] || '/' } : null;
}

/** Finds the first provider host contained in a string, returning the host and the path after it. */
export function findHostInString(
  value: string,
  hosts: { host: string; providerSlug: string }[],
): { host: string; path: string; providerSlug: string } | null {
  const m = /https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?([^\s"'`)<>]*)/i.exec(value);
  if (!m?.[1]) return null;
  const host = m[1].toLowerCase();
  const hit = hosts.find((h) => host === h.host || host.endsWith('.' + h.host));
  return hit ? { host, path: m[2] || '/', providerSlug: hit.providerSlug } : null;
}

export class SiteCollector {
  readonly sites: DetectedCallSite[] = [];
  private seen = new Set<string>();
  constructor(
    private base: Pick<DetectedCallSite, 'filePath' | 'fileHash'>,
    private lines: string[],
  ) {}

  add(site: Omit<DetectedCallSite, 'filePath' | 'fileHash' | 'snippet' | 'snippetStartLine'>, dedupeExtra = ''): void {
    if (this.sites.length >= MAX_SITES_PER_FILE) return;
    const key = `${site.providerSlug}|${site.kind}|${site.symbol}|${site.line}|${dedupeExtra}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const { snippet, start } = makeSnippet(this.lines, site.line);
    this.sites.push({ ...site, ...this.base, snippet, snippetStartLine: start });
  }
}
