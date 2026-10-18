import { describe, expect, it } from 'vitest';
import { assignSeverity, matchEvent, pathsMatch, type MatcherCallSite, type MatcherDependency, type MatcherEvent } from '../src';

const NOW = new Date('2026-10-01T00:00:00Z');
let n = 0;
const site = (o: Partial<MatcherCallSite>): MatcherCallSite => ({
  id: `cs${++n}`,
  providerSlug: 'stripe',
  filePath: 'src/a.ts',
  line: 10,
  symbol: 'stripe.charges.create',
  kind: 'sdk_call',
  snippet: 'x',
  snippetStartLine: 8,
  confidence: 0.95,
  resolved: true,
  metadata: { ecosystem: 'npm', receiver: 'stripe' },
  ...o,
});
const dep = (o: Partial<MatcherDependency>): MatcherDependency => ({
  id: `d${++n}`,
  providerSlug: 'openai',
  packageName: 'openai',
  ecosystem: 'pypi',
  versionSpec: '==0.28.1',
  resolvedVersion: '0.28.1',
  manifestPath: 'requirements.txt',
  manifestLine: 2,
  source: 'manifest',
  ...o,
});
const event = (o: Partial<MatcherEvent>): MatcherEvent => ({
  id: 'ev1',
  providerSlug: 'stripe',
  providerHosts: ['api.stripe.com'],
  title: 't',
  changeType: 'breaking',
  severity: 'high',
  affected: [{ kind: 'sdk_symbol', symbol: 'stripe.charges.create' }],
  effectiveAt: new Date('2026-12-01T00:00:00Z'),
  sourceUrl: 'https://x',
  remediation: null,
  evidence: [],
  origin: 'demo',
  ...o,
});
const run = (ev: MatcherEvent, callSites: MatcherCallSite[], dependencies: MatcherDependency[] = []) =>
  matchEvent(ev, { callSites, dependencies, now: NOW });

describe('exact symbol matching', () => {
  it('matches a resolved call with high confidence and an explanation', () => {
    const [m] = run(event({}), [site({})]);
    expect(m).toMatchObject({ kind: 'exact_symbol', confidence: 0.95, severity: 'high', filePath: 'src/a.ts', line: 10 });
    expect(m!.title).toMatch(/^Breaking change affects `stripe.charges.create`/);
    expect(m!.explanation).toContain('src/a.ts:10');
    expect(m!.limitations).toMatch(/single file/);
    expect(m!.remediation).toMatch(/takes effect on 2026-12-01/);
  });

  it('does not match a similar but different symbol', () => {
    expect(
      run(event({}), [
        site({ symbol: 'stripe.charges.list' }),
        site({ symbol: 'stripe.paymentIntents.create' }),
        site({ symbol: 'stripe.charges.createToken' }),
      ]),
    ).toEqual([]);
  });

  it('does not match when the provider differs, or only an import exists', () => {
    expect(run(event({}), [site({ providerSlug: 'twilio' })])).toEqual([]);
    expect(run(event({}), [site({ kind: 'sdk_import', symbol: 'stripe' })])).toEqual([]);
  });

  it('a provider dependency without an affected method produces no finding', () => {
    const deps = [dep({ providerSlug: 'stripe', packageName: 'stripe', ecosystem: 'npm', versionSpec: '^14.0.0', resolvedVersion: null })];
    expect(run(event({}), [site({ symbol: 'stripe.customers.list' })], deps)).toEqual([]);
  });

  it('respects the ecosystem of the affected symbol', () => {
    const ev = event({ affected: [{ kind: 'sdk_symbol', symbol: 'stripe.charges.create', ecosystem: 'pypi' }] });
    expect(run(ev, [site({ metadata: { ecosystem: 'npm' } })])).toEqual([]);
    expect(run(ev, [site({ metadata: { ecosystem: 'pypi' } })])).toHaveLength(1);
  });

  it('unresolved receivers give a low-confidence possible match', () => {
    const [m] = run(event({}), [site({ resolved: false, confidence: 0.4, metadata: { unresolvedReceiver: true, receiver: 'thing' } })]);
    expect(m).toMatchObject({ kind: 'exact_symbol', confidence: 0.55 });
    expect(m!.title).toMatch(/^Possible impact:/);
    expect(m!.limitations).toMatch(/could not be traced/);
  });

  it('dynamic calls only match when the static prefix has two segments and overlaps', () => {
    const dyn = (prefix: string) =>
      site({ kind: 'dynamic_call', symbol: `${prefix}.<dynamic>`, resolved: false, confidence: 0.3, metadata: { dynamicPrefix: prefix } });
    const [m] = run(event({}), [dyn('stripe.charges')]);
    expect(m).toMatchObject({ kind: 'dynamic_prefix', confidence: 0.35 });
    expect(m!.limitations).toMatch(/computed at runtime/);
    expect(run(event({}), [dyn('stripe')])).toEqual([]);
    expect(run(event({}), [dyn('stripe.customers')])).toEqual([]);
  });
});

describe('endpoint matching', () => {
  const ev = event({ affected: [{ kind: 'endpoint', method: 'POST', host: 'api.stripe.com', path: '/v1/charges' }] });
  const http = (meta: Record<string, unknown>, o: Partial<MatcherCallSite> = {}) =>
    site({
      kind: 'http_call',
      symbol: 'POST api.stripe.com/v1/charges',
      metadata: { host: 'api.stripe.com', pathTemplate: '/v1/charges', method: 'POST', methodKnown: true, ...meta },
      confidence: 0.9,
      ...o,
    });

  it('matches host, path and method', () => {
    const [m] = run(ev, [http({})]);
    expect(m).toMatchObject({ kind: 'known_endpoint', confidence: 0.92 });
  });
  it('lowers confidence when the method is unknown and rejects a different known method', () => {
    expect(run(ev, [http({ methodKnown: false })])[0]!.confidence).toBe(0.82);
    expect(run(ev, [http({ method: 'GET' })])).toEqual([]);
  });
  it('rejects other hosts and paths', () => {
    expect(run(ev, [http({ host: 'api.evil.com' })])).toEqual([]);
    expect(run(ev, [http({ pathTemplate: '/v1/charges/refunds' })])).toEqual([]);
    expect(run(ev, [http({ pathTemplate: '/v1/customers' })])).toEqual([]);
  });
  it('treats path parameters as wildcards on both sides', () => {
    const e2 = event({ affected: [{ kind: 'endpoint', path: '/v1/charges/{charge}' }] });
    expect(run(e2, [http({ pathTemplate: '/v1/charges/{}' })])).toHaveLength(1);
    expect(run(e2, [http({ pathTemplate: '/v1/charges/ch_123' })])).toHaveLength(1);
  });
  it('URL literals are lower confidence than calls', () => {
    const [m] = run(ev, [
      site({
        kind: 'endpoint_literal',
        symbol: 'api.stripe.com/v1/charges',
        confidence: 0.7,
        metadata: { host: 'api.stripe.com', pathTemplate: '/v1/charges' },
      }),
    ]);
    expect(m).toMatchObject({ kind: 'known_endpoint', confidence: 0.7 });
  });
  it('path-only routes need provider evidence in the repository', () => {
    const pathOnly = site({
      kind: 'endpoint_literal',
      symbol: 'GET /v1/charges',
      resolved: false,
      confidence: 0.6,
      metadata: { method: 'GET', methodKnown: true, pathTemplate: '/v1/charges' },
    });
    const evAny = event({ affected: [{ kind: 'endpoint', path: '/v1/charges' }] });
    expect(run(evAny, [pathOnly])).toEqual([]);
    const withImport = site({ kind: 'sdk_import', symbol: 'stripe', filePath: 'src/a.ts' });
    const [m] = run(evAny, [pathOnly, withImport]);
    expect(m).toMatchObject({ kind: 'api_path', confidence: 0.6 });
  });
  it('matches SDK request routes without a host', () => {
    const gh = event({
      providerSlug: 'github',
      providerHosts: ['api.github.com'],
      affected: [{ kind: 'endpoint', method: 'GET', path: '/repos/{owner}/{repo}/issues' }],
    });
    const req = site({
      providerSlug: 'github',
      kind: 'http_call',
      symbol: 'GET /repos/{owner}/{repo}/issues',
      metadata: { method: 'GET', methodKnown: true, pathTemplate: '/repos/{owner}/{repo}/issues', viaSdkRequest: true },
    });
    expect(run(gh, [req])[0]).toMatchObject({ kind: 'known_endpoint', confidence: 0.92 });
  });
});

describe('package version matching', () => {
  const ev = event({
    providerSlug: 'openai',
    affected: [{ kind: 'package_version', ecosystem: 'pypi', package: 'openai', range: '<1.0.0' }],
    severity: 'high',
  });
  it('matches pinned versions inside the range, capped at medium severity', () => {
    const [m] = run(ev, [], [dep({})]);
    expect(m).toMatchObject({ kind: 'package_version', confidence: 0.65, filePath: 'requirements.txt', line: 2 });
    expect(m!.severity).toBe('medium');
  });
  it('does not match versions outside the range or unknown versions', () => {
    expect(run(ev, [], [dep({ resolvedVersion: '1.3.0', versionSpec: '==1.3.0' })])).toEqual([]);
    expect(run(ev, [], [dep({ resolvedVersion: null, versionSpec: null })])).toEqual([]);
  });
  it('prefers the lockfile version and uses lower confidence for ranges', () => {
    const manifest = dep({
      ecosystem: 'npm',
      packageName: 'openai',
      manifestPath: 'package.json',
      versionSpec: '^0.5.0',
      resolvedVersion: null,
    });
    const lock = dep({
      ecosystem: 'npm',
      packageName: 'openai',
      manifestPath: 'package-lock.json',
      versionSpec: null,
      resolvedVersion: '0.5.9',
      source: 'lockfile',
    });
    const evNpm = event({
      providerSlug: 'openai',
      affected: [{ kind: 'package_version', ecosystem: 'npm', package: 'openai', range: '<1.0.0' }],
    });
    const res = run(evNpm, [], [manifest, lock]);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ confidence: 0.7, filePath: 'package.json' });
    expect(run(evNpm, [], [manifest])[0]!.confidence).toBe(0.5);
  });
  it('normalizes PyPI names', () => {
    expect(run(ev, [], [dep({ packageName: 'OpenAI' })])).toHaveLength(1);
  });
});

describe('pattern matching and dedupe', () => {
  it('pattern matches are low confidence and only look at provider call sites', () => {
    const e = event({ affected: [{ kind: 'pattern', pattern: 'apiVersion:\\s*.2020' }] });
    const [m] = run(e, [
      site({ snippet: "new Stripe(k, { apiVersion: '2020-08-27' })" }),
      site({ providerSlug: 'twilio', snippet: "apiVersion: '2020'" }),
    ]);
    expect(m).toMatchObject({ kind: 'pattern', confidence: 0.4, severity: 'medium' });
  });
  it('rejects invalid or oversized patterns safely', () => {
    expect(run(event({ affected: [{ kind: 'pattern', pattern: '(' }] }), [site({})])).toEqual([]);
    expect(run(event({ affected: [{ kind: 'pattern', pattern: 'a'.repeat(300) }] }), [site({})])).toEqual([]);
  });
  it('does not emit duplicates for repeated affected items', () => {
    const e = event({
      affected: [
        { kind: 'sdk_symbol', symbol: 'stripe.charges.create' },
        { kind: 'sdk_symbol', symbol: 'stripe.charges.create' },
      ],
    });
    expect(run(e, [site({})])).toHaveLength(1);
  });
});

describe('severity assignment', () => {
  const base = { severity: 'high' as const, changeType: 'breaking' as const, effectiveAt: new Date('2026-01-01') };
  it('escalates confirmed breaking changes that are already in effect', () => {
    expect(assignSeverity(base, 0.95, 'exact_symbol', NOW)).toBe('critical');
    expect(assignSeverity({ ...base, effectiveAt: new Date('2027-01-01') }, 0.95, 'exact_symbol', NOW)).toBe('high');
    expect(assignSeverity({ ...base, changeType: 'deprecation' }, 0.95, 'exact_symbol', NOW)).toBe('high');
  });
  it('does not escalate or keep critical when confidence is not verified', () => {
    expect(assignSeverity(base, 0.7, 'exact_symbol', NOW)).toBe('high');
  });
  it('downgrades uncertain matches', () => {
    expect(assignSeverity(base, 0.4, 'pattern', NOW)).toBe('medium');
    expect(assignSeverity({ ...base, severity: 'info' }, 0.4, 'pattern', NOW)).toBe('info');
  });
});

describe('pathsMatch', () => {
  it.each([
    ['/a/b', '/a/b', true],
    ['/a/b/', '/a/b', true],
    ['/a/{x}', '/a/1', true],
    ['/a/:x', '/a/{id}', true],
    ['/a/b', '/a/c', false],
    ['/a/b', '/a/b/c', false],
    ['/a/b?x=1', '/a/b', true],
  ])('%s vs %s -> %s', (a, b, expected) => expect(pathsMatch(a, b)).toBe(expected));
});
