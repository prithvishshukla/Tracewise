import { describe, expect, it } from 'vitest';
import { feedItemsToChanges, NoopExtractionProvider, OpenAICompatibleExtractionProvider, parseFeed, type SourceInfo } from '../src';

const source: SourceInfo = {
  providerSlug: 'stripe',
  kind: 'atom',
  url: 'https://github.com/stripe/stripe-node/releases.atom',
  label: 'x',
  origin: 'live',
};

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>tag:1</id><title>v15.0.0</title><link rel="alternate" href="https://example.com/r/15"/><updated>2026-09-01T10:00:00Z</updated>
<content type="html">&lt;p&gt;BREAKING CHANGE: &lt;code&gt;stripe.charges.create&lt;/code&gt; removed. Use PaymentIntents by 2026-12-01.&lt;/p&gt;</content></entry>
<entry><id>tag:2</id><title>v14.9.1</title><link href="https://example.com/r/14"/><updated>2026-08-01T10:00:00Z</updated><content>Fix typo in docs</content></entry></feed>`;
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Deprecation of the legacy endpoint POST /v1/charges</title><link>https://example.com/a</link><guid>g1</guid><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><description>The endpoint will be removed in 2027.</description></item>
<item><title>Nothing special</title><link>https://example.com/b</link><guid>g2</guid></item></channel></rss>`;

describe('feed parsing', () => {
  it('parses Atom and RSS', () => {
    const a = parseFeed(ATOM);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ id: 'tag:1', title: 'v15.0.0', link: 'https://example.com/r/15' });
    expect(a[0]!.summary).toContain('stripe.charges.create');
    expect(parseFeed(RSS)).toHaveLength(2);
    expect(parseFeed(RSS)[0]!.publishedAt).toBeInstanceOf(Date);
  });
  it('handles single-item feeds and rejects non-feeds', () => {
    expect(parseFeed(`<rss><channel><item><title>x</title></item></channel></rss>`)).toHaveLength(1);
    expect(() => parseFeed('<html><body>nope</body></html>')).toThrow(/not a recognizable/);
  });
});

describe('feedItemsToChanges', () => {
  it('keeps only items that indicate deprecation/removal and extracts affected symbols and dates', async () => {
    const out = await feedItemsToChanges(parseFeed(ATOM), { source, providerRoots: ['stripe'] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      changeType: 'breaking',
      origin: 'live',
      detectionMethod: 'feed_keyword',
      sourceUrl: 'https://example.com/r/15',
    });
    expect(out[0]!.affected).toEqual([{ kind: 'sdk_symbol', symbol: 'stripe.charges.create' }]);
    expect(out[0]!.effectiveAt!.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(out[0]!.confidence).toBeLessThanOrEqual(0.75);
  });
  it('produces stable fingerprints for the same item (deduplication key)', async () => {
    const a = await feedItemsToChanges(parseFeed(RSS), { source: { ...source, kind: 'rss' }, providerRoots: [] });
    const b = await feedItemsToChanges(parseFeed(RSS), { source: { ...source, kind: 'rss' }, providerRoots: [] });
    expect(a[0]!.fingerprint).toBe(b[0]!.fingerprint);
    expect(a[0]!.affected).toEqual([{ kind: 'endpoint', method: 'POST', path: '/v1/charges' }]);
  });
  it('uses an optional extractor only when heuristics found nothing, with capped confidence', async () => {
    const xml = `<rss><channel><item><title>Legacy upload API is deprecated</title><link>l</link><guid>z</guid></item></channel></rss>`;
    const extractor = { name: 't', extractAffected: async () => [{ kind: 'sdk_symbol' as const, symbol: 'stripe.files.upload' }] };
    const [c] = await feedItemsToChanges(parseFeed(xml), { source, providerRoots: ['stripe'], extractor });
    expect(c).toMatchObject({ detectionMethod: 'llm_assisted' });
    expect(c!.confidence).toBeLessThanOrEqual(0.6);
    const [none] = await feedItemsToChanges(parseFeed(xml), { source, providerRoots: ['stripe'], extractor: new NoopExtractionProvider() });
    expect(none!.affected).toEqual([]);
  });
});

describe('OpenAICompatibleExtractionProvider', () => {
  const mk = (content: string, ok = true) =>
    new OpenAICompatibleExtractionProvider({
      baseUrl: 'https://llm.example/v1/',
      apiKey: 'k',
      model: 'm',
      fetchImpl: (async (url: string, init: RequestInit) => {
        expect(url).toBe('https://llm.example/v1/chat/completions');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: ok ? 200 : 500 });
      }) as unknown as typeof fetch,
    });
  const input = { title: 't', text: 'x', providerRoots: ['stripe'] };
  it('validates model output and falls back to [] on garbage or errors', async () => {
    expect(await mk('{"affected":[{"kind":"sdk_symbol","symbol":"stripe.a.b"}]}').extractAffected(input)).toHaveLength(1);
    expect(await mk('not json').extractAffected(input)).toEqual([]);
    expect(await mk('{"affected":[{"kind":"weird"}]}').extractAffected(input)).toEqual([]);
    expect(await mk('{}', false).extractAffected(input)).toEqual([]);
  });
});
