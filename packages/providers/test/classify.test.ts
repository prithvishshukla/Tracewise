import { describe, expect, it } from 'vitest';
import { classifyText, extractAffected, extractDate } from '../src';

describe('classifyText', () => {
  it.each([
    ['Breaking change: the foo endpoint was removed', 'breaking'],
    ['The v1 API will be removed on 2027-01-01', 'breaking'],
    ['Deprecation notice for the legacy SDK method', 'deprecation'],
    ['`bar.baz` is deprecated', 'deprecation'],
    ['Response format will change next quarter', 'warning'],
  ])('%s -> %s', (text, type) => expect(classifyText(text)?.changeType).toBe(type));

  it('ignores routine release notes', () => {
    expect(classifyText('v14.2.0: adds new payment method types and fixes typos')).toBeNull();
  });
  it('caps confidence because it is keyword-based', () => {
    expect(classifyText('Breaking change. Removed. Deprecated. Sunset.')!.confidence).toBeLessThanOrEqual(0.75);
  });
});

describe('extractDate / extractAffected', () => {
  it('parses ISO and long dates', () => {
    expect(extractDate('removed on 2027-03-15.')!.toISOString()).toBe('2027-03-15T00:00:00.000Z');
    expect(extractDate('effective December 1, 2026')!.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(extractDate('no date here')).toBeNull();
  });
  it('extracts symbols for known roots and METHOD /path endpoints', () => {
    const out = extractAffected('`stripe.charges.create()` and `lodash.map` are changing; POST /v1/charges is removed', ['stripe']);
    expect(out).toEqual([
      { kind: 'sdk_symbol', symbol: 'stripe.charges.create' },
      { kind: 'endpoint', method: 'POST', path: '/v1/charges' },
    ]);
  });
});
