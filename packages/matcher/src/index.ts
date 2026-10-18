import semver from 'semver';
import {
  affectedLabel,
  downgradeSeverity,
  SEVERITY_RANK,
  VERIFIED_THRESHOLD,
  type AffectedItem,
  type Evidence,
  type MatchKind,
  type Severity,
} from '@tracewise/shared';
import type { Match, MatchContext, MatcherCallSite, MatcherDependency, MatcherEvent } from './types';

export * from './types';

const MS_PER_DAY = 86_400_000;

// ---- helpers -----------------------------------------------------------------------------------

const isWildcard = (seg: string) => /^\{.*\}$/.test(seg) || seg.startsWith(':') || seg === '*';

/** Compares two path templates segment by segment; `{param}`, `:param` and `*` match any single segment. */
export function pathsMatch(a: string, b: string): boolean {
  const split = (p: string) => p.split('?')[0]!.split('/').filter(Boolean);
  const x = split(a);
  const y = split(b);
  if (x.length !== y.length) return false;
  return x.every((seg, i) => isWildcard(seg) || isWildcard(y[i]!) || seg === y[i]);
}

const hostMatches = (host: string, allowed: string) => host === allowed || host.endsWith('.' + allowed);
const ecosystemOk = (item: AffectedItem, cs: MatcherCallSite) => {
  const e = (item as { ecosystem?: string }).ecosystem;
  const c = cs.metadata.ecosystem as string | undefined;
  return !e || !c || e === c;
};
const normPy = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');

export function assignSeverity(
  ev: Pick<MatcherEvent, 'severity' | 'changeType' | 'effectiveAt'>,
  confidence: number,
  kind: MatchKind,
  now: Date,
): Severity {
  let sev = ev.severity;
  if (ev.changeType === 'breaking' && ev.effectiveAt && ev.effectiveAt <= now && confidence >= VERIFIED_THRESHOLD) sev = 'critical';
  if (kind === 'package_version' && SEVERITY_RANK[sev] > SEVERITY_RANK.medium) sev = 'medium';
  if (confidence < 0.5) sev = downgradeSeverity(sev, 1);
  else if (confidence < VERIFIED_THRESHOLD && sev === 'critical') sev = 'high';
  return sev;
}

const LIMITATIONS: Record<MatchKind | 'unresolved', string> = {
  exact_symbol:
    'Analysis traces SDK clients within a single file. Calls routed through wrapper functions defined in other files are not followed.',
  unresolved:
    'The receiver variable could not be traced to an SDK client in this file, so the match relies on the method name and on the file importing the provider SDK. It may be a different object.',
  known_endpoint:
    'The URL was matched through its literal path template. Dynamically built URLs can be missed, and a template may over-match similar paths.',
  api_path: 'Only the path matched. No host or SDK evidence ties this call to the provider API, so it may be unrelated.',
  package_version:
    'The installed or declared version falls inside the affected range. This does not prove the changed API is called anywhere.',
  pattern: 'A regular-expression pattern matched this source line. Pattern matches are low confidence by design.',
  dynamic_prefix: 'The method name is computed at runtime. This call may or may not reach the affected API; static analysis cannot tell.',
};

function defaultRemediation(ev: MatcherEvent): string {
  switch (ev.changeType) {
    case 'breaking':
      return 'Update this code before the change takes effect. Check the linked source for the replacement API and add a test that covers this call.';
    case 'deprecation':
      return 'Plan a migration away from this API. Check the linked source for the recommended replacement and the removal date.';
    case 'warning':
      return 'Review the linked announcement and confirm this code does not depend on the changing behavior.';
    default:
      return 'No action is required. Review the linked source for context.';
  }
}

function timing(ev: MatcherEvent, now: Date): string {
  if (!ev.effectiveAt) return 'No effective date was announced.';
  const days = Math.ceil((ev.effectiveAt.getTime() - now.getTime()) / MS_PER_DAY);
  const d = ev.effectiveAt.toISOString().slice(0, 10);
  return days >= 0
    ? `The change takes effect on ${d} (${days} day${days === 1 ? '' : 's'} from now).`
    : `The change took effect on ${d} (${-days} day${days === -1 ? '' : 's'} ago).`;
}

// ---- main ---------------------------------------------------------------------------------------

export function matchEvent(ev: MatcherEvent, ctx: MatchContext): Match[] {
  const now = ctx.now ?? new Date();
  const sites = ctx.callSites.filter((c) => c.providerSlug === ev.providerSlug);
  const deps = ctx.dependencies.filter((d) => d.providerSlug === ev.providerSlug);
  const importLines = new Map<string, number>();
  for (const s of sites) if (s.kind === 'sdk_import' && !importLines.has(s.filePath)) importLines.set(s.filePath, s.line);
  const providerEvidence = deps.length > 0 || importLines.size > 0;
  const results: Match[] = [];
  const seen = new Set<string>();

  const push = (m: Omit<Match, 'severity' | 'remediation' | 'evidence' | 'title'> & { symbolLabel: string; extra?: Evidence[] }) => {
    const key = `${m.callSiteId ?? m.dependencyId}|${m.kind}|${affectedLabel(m.affectedItem)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { symbolLabel, extra, ...rest } = m;
    const impact = rest.confidence >= VERIFIED_THRESHOLD ? '' : 'Possible impact: ';
    const word =
      ev.changeType === 'breaking'
        ? 'Breaking change'
        : ev.changeType === 'deprecation'
          ? 'Deprecation'
          : ev.changeType === 'warning'
            ? 'Upcoming change'
            : 'Change';
    const evidence: Evidence[] = [...ev.evidence.slice(0, 2), ...(extra ?? [])];
    const imp = importLines.get(rest.filePath);
    if (imp && rest.callSiteId)
      evidence.push({ type: 'import', label: `File imports the ${ev.providerSlug} SDK`, detail: `${rest.filePath}:${imp}` });
    results.push({
      ...rest,
      title: `${impact}${word} affects ${symbolLabel} in ${rest.filePath}`,
      severity: assignSeverity(ev, rest.confidence, rest.kind, now),
      remediation: `${ev.remediation ?? defaultRemediation(ev)}\n\n${timing(ev, now)}`,
      evidence,
    });
  };

  for (const item of ev.affected) {
    if (item.kind === 'sdk_symbol') {
      for (const cs of sites) {
        if (!ecosystemOk(item, cs)) continue;
        if (cs.kind === 'sdk_call' && cs.symbol === item.symbol) {
          const resolved = cs.resolved;
          push({
            callSiteId: cs.id,
            dependencyId: null,
            kind: 'exact_symbol',
            confidence: resolved ? 0.95 : 0.55,
            filePath: cs.filePath,
            line: cs.line,
            snippet: cs.snippet,
            snippetStartLine: cs.snippetStartLine,
            matchKey: `exact_symbol|${item.symbol}|${cs.filePath}`,
            affectedItem: item,
            symbolLabel: `\`${item.symbol}\``,
            reason: resolved
              ? 'Exact SDK symbol match; receiver traced to an SDK client in the same file.'
              : 'Method-name match on an unresolved receiver in a file that imports the SDK.',
            explanation: resolved
              ? `\`${item.symbol}\` is called at ${cs.filePath}:${cs.line}. The receiver \`${String(cs.metadata.receiver ?? '')}\` was traced to a client created from the ${ev.providerSlug} SDK, and the upstream change lists this exact symbol as affected. ${timing(ev, now)}`
              : `A call ending in the same method chain as \`${item.symbol}\` appears at ${cs.filePath}:${cs.line}, and the file imports the ${ev.providerSlug} SDK, but the receiver \`${String(cs.metadata.receiver ?? '')}\` could not be traced to an SDK client. ${timing(ev, now)}`,
            limitations: resolved ? LIMITATIONS.exact_symbol : LIMITATIONS.unresolved,
            extra: [{ type: 'code', label: 'Call site', detail: `${cs.filePath}:${cs.line}` }],
          });
        } else if (cs.kind === 'dynamic_call') {
          const prefix = String(cs.metadata.dynamicPrefix ?? '');
          if (prefix.split('.').length >= 2 && item.symbol.startsWith(prefix + '.')) {
            push({
              callSiteId: cs.id,
              dependencyId: null,
              kind: 'dynamic_prefix',
              confidence: 0.35,
              filePath: cs.filePath,
              line: cs.line,
              snippet: cs.snippet,
              snippetStartLine: cs.snippetStartLine,
              matchKey: `dynamic_prefix|${item.symbol}|${cs.filePath}`,
              affectedItem: item,
              symbolLabel: `\`${prefix}.*\``,
              reason: `Dynamic call on \`${prefix}\`; the affected symbol \`${item.symbol}\` shares this prefix.`,
              explanation: `The call at ${cs.filePath}:${cs.line} invokes a method of \`${prefix}\` whose name is computed at runtime. The upstream change affects \`${item.symbol}\`, which is one of the methods this call could reach. ${timing(ev, now)}`,
              limitations: LIMITATIONS.dynamic_prefix,
              extra: [{ type: 'code', label: 'Dynamic call site', detail: `${cs.filePath}:${cs.line}` }],
            });
          }
        }
      }
    } else if (item.kind === 'endpoint') {
      for (const cs of sites) {
        if (cs.kind !== 'http_call' && cs.kind !== 'endpoint_literal') continue;
        const csPath = String(cs.metadata.pathTemplate ?? '');
        if (!csPath || !pathsMatch(csPath, item.path)) continue;
        const csHost = cs.metadata.host as string | undefined;
        const viaSdk = cs.metadata.viaSdkRequest === true;
        if (csHost) {
          const allowed = item.host ? [item.host] : ev.providerHosts;
          if (!allowed.some((h) => hostMatches(csHost, h))) continue;
        } else if (!viaSdk && !providerEvidence) continue; // path-only needs provider evidence in the repo
        const csMethod = cs.metadata.method as string | undefined;
        const methodKnown = cs.metadata.methodKnown === true;
        if (item.method && csMethod && methodKnown && item.method.toUpperCase() !== csMethod.toUpperCase()) continue;
        const methodOk = !item.method || (methodKnown && csMethod?.toUpperCase() === item.method.toUpperCase());
        const withHost = Boolean(csHost) || viaSdk;
        let confidence = withHost ? (cs.kind === 'http_call' ? (methodOk ? 0.92 : 0.82) : 0.7) : 0.6;
        if (!withHost && !cs.resolved) confidence = 0.6;
        const kind: MatchKind = withHost ? 'known_endpoint' : 'api_path';
        push({
          callSiteId: cs.id,
          dependencyId: null,
          kind,
          confidence,
          filePath: cs.filePath,
          line: cs.line,
          snippet: cs.snippet,
          snippetStartLine: cs.snippetStartLine,
          matchKey: `${kind}|${affectedLabel(item)}|${cs.filePath}`,
          affectedItem: item,
          symbolLabel: `\`${affectedLabel(item)}\``,
          reason:
            kind === 'known_endpoint'
              ? `${cs.kind === 'http_call' ? 'HTTP call' : 'URL literal'} to a known ${ev.providerSlug} endpoint matches the affected path${methodOk ? ' and method' : ' (method not determined)'}.`
              : 'Request path equals the affected path; no host evidence.',
          explanation: `${cs.filePath}:${cs.line} references \`${cs.symbol}\`, which matches the affected endpoint \`${affectedLabel(item)}\`. ${timing(ev, now)}`,
          limitations: kind === 'known_endpoint' ? LIMITATIONS.known_endpoint : LIMITATIONS.api_path,
          extra: [{ type: 'code', label: 'Request site', detail: `${cs.filePath}:${cs.line}` }],
        });
      }
    } else if (item.kind === 'package_version') {
      const groups = new Map<string, MatcherDependency[]>();
      for (const d of deps) {
        const same =
          d.ecosystem === item.ecosystem &&
          (d.ecosystem === 'pypi' ? normPy(d.packageName) === normPy(item.package) : d.packageName === item.package);
        if (!same) continue;
        const dir = d.manifestPath.includes('/') ? d.manifestPath.slice(0, d.manifestPath.lastIndexOf('/')) : '';
        const k = `${d.ecosystem}|${d.packageName}|${dir}`;
        groups.set(k, [...(groups.get(k) ?? []), d]);
      }
      for (const group of groups.values()) {
        const lock = group.find((g) => g.source === 'lockfile' && g.resolvedVersion);
        const manifest = group.find((g) => g.source === 'manifest') ?? group[0]!;
        const pinned = lock?.resolvedVersion ?? manifest.resolvedVersion;
        const version =
          pinned ?? (manifest.versionSpec ? (semver.minVersion(manifest.versionSpec, { loose: true })?.version ?? null) : null);
        if (!version) continue;
        const coerced = semver.coerce(version)?.version;
        let hit = false;
        try {
          hit = Boolean(coerced) && semver.satisfies(coerced as string, item.range, { includePrerelease: true });
        } catch {
          hit = false;
        }
        if (!hit) continue;
        const confidence = lock?.resolvedVersion ? 0.7 : pinned ? 0.65 : 0.5;
        push({
          callSiteId: null,
          dependencyId: manifest.id,
          kind: 'package_version',
          confidence,
          filePath: manifest.manifestPath,
          line: manifest.manifestLine,
          snippet: `${manifest.packageName} ${manifest.versionSpec ?? manifest.resolvedVersion ?? ''}`.trim(),
          snippetStartLine: manifest.manifestLine,
          matchKey: `package_version|${item.package}@${item.range}|${manifest.manifestPath}`,
          affectedItem: item,
          symbolLabel: `\`${item.package}@${item.range}\``,
          reason: `Dependency version ${version} satisfies the affected range ${item.range}.`,
          explanation: `${manifest.manifestPath} ${pinned ? 'pins' : 'declares'} \`${manifest.packageName}\` ${manifest.versionSpec ?? version}${lock?.resolvedVersion ? ` (lockfile resolves ${lock.resolvedVersion})` : ''}, which falls inside the affected range \`${item.range}\`. ${timing(ev, now)}`,
          limitations: LIMITATIONS.package_version,
          extra: [{ type: 'dependency', label: 'Dependency', detail: `${manifest.packageName} ${version} in ${manifest.manifestPath}` }],
        });
      }
    } else if (item.kind === 'pattern') {
      let re: RegExp | null = null;
      try {
        re = item.pattern.length <= 200 ? new RegExp(item.pattern) : null;
      } catch {
        re = null;
      }
      if (!re) continue;
      for (const cs of sites) {
        if (cs.kind === 'sdk_import' || cs.snippet.length > 2000) continue;
        if (!re.test(cs.snippet)) continue;
        push({
          callSiteId: cs.id,
          dependencyId: null,
          kind: 'pattern',
          confidence: 0.4,
          filePath: cs.filePath,
          line: cs.line,
          snippet: cs.snippet,
          snippetStartLine: cs.snippetStartLine,
          matchKey: `pattern|${item.pattern}|${cs.filePath}`,
          affectedItem: item,
          symbolLabel: `pattern \`${item.pattern}\``,
          reason: 'Regex pattern matched the stored snippet of a provider call site.',
          explanation:
            `The pattern \`${item.pattern}\` matches code near ${cs.filePath}:${cs.line}. ${item.note ?? ''} ${timing(ev, now)}`.replace(
              /\s+/g,
              ' ',
            ),
          limitations: LIMITATIONS.pattern,
        });
      }
    }
  }
  return results;
}

export function sortMatches(m: Match[]): Match[] {
  return [...m].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence || a.filePath.localeCompare(b.filePath),
  );
}
