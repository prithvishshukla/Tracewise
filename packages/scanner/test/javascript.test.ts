import { describe, expect, it } from 'vitest';
import { analyzeJavaScript } from '../src';
import { idx } from './helpers';

const analyze = (code: string, file = 'src/x.ts') => analyzeJavaScript(code, file, 'hash', idx).callSites;
const sdkCalls = (code: string) => analyze(code).filter((c) => c.kind === 'sdk_call');

describe('TypeScript/JavaScript analysis', () => {
  it('resolves a client created from the default import and reports exact line numbers', () => {
    const code = `import Stripe from 'stripe';\n\nconst stripe = new Stripe('k');\n\nexport function f() {\n  return stripe.charges.create({});\n}\n`;
    const calls = sdkCalls(code);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ symbol: 'stripe.charges.create', line: 6, resolved: true, confidence: 0.95, providerSlug: 'stripe' });
    expect(calls[0]!.snippet).toContain('stripe.charges.create');
    expect(calls[0]!.snippetStartLine).toBe(4);
  });

  it('handles aliases, named factories, require(), class properties and typed parameters', () => {
    expect(sdkCalls(`import S from 'stripe'; const c = new S(''); c.refunds.create({});`)[0]!.symbol).toBe('stripe.refunds.create');
    expect(sdkCalls(`import { OpenAI } from 'openai'; const o = new OpenAI(); o.chat.completions.create({});`)[0]!.symbol).toBe(
      'openai.chat.completions.create',
    );
    expect(sdkCalls(`const twilio = require('twilio'); const c = twilio('a','b'); c.messages.create({});`)[0]!.symbol).toBe(
      'twilio.messages.create',
    );
    expect(sdkCalls(`const { Octokit } = require('@octokit/rest'); const k = new Octokit(); k.rest.issues.update({});`)[0]!.symbol).toBe(
      'octokit.rest.issues.update',
    );
    const cls = `import Stripe from 'stripe';\nclass Billing {\n  private stripe = new Stripe('');\n  pay() { return this.stripe.charges.create({}); }\n}`;
    expect(sdkCalls(cls)[0]).toMatchObject({ symbol: 'stripe.charges.create', resolved: true, line: 4 });
    const di = `import Stripe from 'stripe';\nclass B { constructor(private readonly stripe: Stripe) {}\n  go() { return this.stripe.customers.list(); } }`;
    expect(sdkCalls(di)[0]).toMatchObject({ symbol: 'stripe.customers.list', resolved: true });
    expect(sdkCalls(`import Stripe from 'stripe'; function f(client: Stripe) { return client.charges.create({}); }`)[0]!.symbol).toBe(
      'stripe.charges.create',
    );
  });

  it('does not report calls on unrelated objects in files without provider imports', () => {
    const code = `class Ledger { charges = { create: (x) => x }; }\nconst ledger = new Ledger();\nledger.charges.create({});\nconsole.log('x'); res.json({});`;
    expect(analyze(code)).toEqual([]);
  });

  it('keeps unresolved receivers as low-confidence candidates when the SDK is imported', () => {
    const code = `import Stripe from 'stripe';\nfunction make(): any { return null; }\nconst thing = make();\nthing.charges.create({});`;
    const c = sdkCalls(code).find((x) => x.metadata.unresolvedReceiver);
    expect(c).toMatchObject({ symbol: 'stripe.charges.create', resolved: false, confidence: 0.4 });
  });

  it('reports dynamic member access as a dynamic call with its static prefix', () => {
    const code = `import Stripe from 'stripe';\nconst s = new Stripe('');\nasync function f(m: string) { return (s.charges as any)[m]({}); }\nasync function g(m: string) { return s[m](); }`;
    const dyn = analyze(code).filter((c) => c.kind === 'dynamic_call');
    expect(dyn.map((d) => d.metadata.dynamicPrefix)).toEqual(['stripe.charges', 'stripe']);
    expect(dyn[0]).toMatchObject({ confidence: 0.3, resolved: false, line: 3 });
  });

  it('detects raw HTTP calls to provider hosts with method and resolved constants', () => {
    const code = `const BASE = 'https://api.twilio.com/2010-04-01';\nconst url = \`\${BASE}/Accounts/\${sid}/Messages.json\`;\nfetch(url, { method: 'POST' });\naxios.get('https://api.stripe.com/v1/customers/' + id);\nfetch('https://api.openai.com/v1/models');`;
    const http = analyze(code).filter((c) => c.kind === 'http_call');
    expect(http.map((h) => [h.providerSlug, h.metadata.method, h.metadata.pathTemplate, h.line])).toEqual([
      ['twilio', 'POST', '/2010-04-01/Accounts/{}/Messages.json', 3],
      ['stripe', 'GET', '/v1/customers/{}', 4],
      ['openai', 'GET', '/v1/models', 5],
    ]);
    expect(analyze(code).filter((c) => c.kind === 'endpoint_literal')).toHaveLength(0); // constants are claimed by the call
  });

  it('records stray provider URL literals and octokit.request routes', () => {
    const lit = analyze(`const u = 'https://api.stripe.com/v1/charges';`);
    expect(lit[0]).toMatchObject({ kind: 'endpoint_literal', providerSlug: 'stripe', confidence: 0.7 });
    const req = analyze(
      `import { Octokit } from '@octokit/rest';\nconst k = new Octokit();\nk.request('GET /repos/{owner}/{repo}/issues');`,
    );
    expect(req.find((c) => c.kind === 'http_call')).toMatchObject({
      providerSlug: 'github',
      metadata: { method: 'GET', pathTemplate: '/repos/{owner}/{repo}/issues', viaSdkRequest: true },
    });
  });

  it('path-only routes are only recorded when the file imports a provider SDK', () => {
    expect(analyze(`app.get('/v1/charges', h);`)).toEqual([]);
    const withSdk = analyze(`import Stripe from 'stripe';\napi.get('/v1/charges');`).filter((c) => c.kind === 'endpoint_literal');
    expect(withSdk[0]).toMatchObject({ confidence: 0.6, resolved: false });
  });

  it('redacts secrets in stored snippets', () => {
    const code = `import Stripe from 'stripe';\nconst s = new Stripe('sk_test_FAKEKEYFORDEMO000000000');\ns.charges.create({});`;
    const snippet = sdkCalls(code)[0]!.snippet;
    expect(snippet).not.toContain('FAKEKEY');
    expect(snippet).toContain('[REDACTED:stripe_key]');
  });

  it('tolerates syntax errors and works on JSX/TSX', () => {
    expect(() => analyze(`import Stripe from 'stripe'; const s = new Stripe(; s.charges.create(`)).not.toThrow();
    const tsx = analyze(
      `import Stripe from 'stripe';\nconst s = new Stripe('');\nexport const C = () => <button onClick={() => s.charges.create({})}>x</button>;`,
      'a.tsx',
    );
    expect(tsx.find((c) => c.kind === 'sdk_call')).toBeTruthy();
  });
});
