import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffSpecs,
  normalizeOpenApi,
  serializeSpec,
  snapshotContent,
  specChangesToEvents,
  interpretSnapshot,
  readFixture,
  type SourceInfo,
} from '../src';

const FIX = path.resolve(__dirname, '../../../fixtures');
const read = (f: string) => fs.readFile(path.join(FIX, 'provider-changes/openapi', f), 'utf8');
const src: SourceInfo = { providerSlug: 'stripe', kind: 'openapi', url: 'fixture:x', label: 'x', origin: 'demo' };

describe('OpenAPI normalization and diff', () => {
  it('normalizes JSON and YAML equivalently and deterministically', async () => {
    const json = await read('stripe-mini-v1.json');
    const yaml = `openapi: 3.0.0\npaths:\n  /v1/a:\n    get:\n      deprecated: true\n      parameters:\n        - {name: q, in: query, required: true}\n`;
    expect(normalizeOpenApi(yaml).operations['GET /v1/a']).toMatchObject({ deprecated: true, params: [{ name: 'q', required: true }] });
    expect(serializeSpec(normalizeOpenApi(json))).toBe(serializeSpec(normalizeOpenApi(json)));
    expect(() => normalizeOpenApi('{"hello": 1}')).toThrow(/OpenAPI/);
  });

  it('detects removed, deprecated, required-param and enum changes between v1 and v2', async () => {
    const changes = diffSpecs(normalizeOpenApi(await read('stripe-mini-v1.json')), normalizeOpenApi(await read('stripe-mini-v2.json')));
    const kinds = changes.map((c) => `${c.kind}:${c.opKey}`).sort();
    expect(kinds).toEqual([
      'enum_value_removed:POST /v1/customers',
      'operation_deprecated:POST /v1/sources',
      'operation_removed:GET /v1/sources/{source}/mandate_notifications/{mandate_notification}',
      'required_param_added:POST /v1/customers',
    ]);
    expect(changes.find((c) => c.kind === 'operation_removed')).toMatchObject({ changeType: 'breaking', severity: 'high' });
  });

  it('produces no changes for identical specs and converts changes to endpoint events', async () => {
    const s = normalizeOpenApi(await read('stripe-mini-v1.json'));
    expect(diffSpecs(s, s)).toEqual([]);
    const events = specChangesToEvents(diffSpecs(s, normalizeOpenApi(await read('stripe-mini-v2.json'))), src);
    expect(events[0]!.affected[0]).toMatchObject({ kind: 'endpoint' });
    expect(new Set(events.map((e) => e.fingerprint)).size).toBe(events.length);
  });

  it('the first snapshot is a baseline (no events); later snapshots diff against the previous one', async () => {
    const v1 = snapshotContent('openapi', await read('stripe-mini-v1.json'));
    const v2 = snapshotContent('openapi', await read('stripe-mini-v2.json'));
    expect(await interpretSnapshot(src, v1, null, { providerRoots: [] })).toEqual([]);
    expect((await interpretSnapshot(src, v2, v1, { providerRoots: [] })).length).toBe(4);
  });
});

describe('fixtures', () => {
  it('reads fixtures inside the directory and rejects traversal', async () => {
    expect(await readFixture('fixture:provider-changes/stripe.json', FIX)).toContain('stripe-charges-create-removal');
    await expect(readFixture('fixture:../package.json', FIX)).rejects.toThrow(/escapes/);
    await expect(readFixture('fixture:/etc/passwd', FIX)).rejects.toThrow();
    await expect(readFixture('https://example.com', FIX)).rejects.toThrow(/Not a fixture/);
  });
  it('fixture events are always labelled as demo', async () => {
    const out = await interpretSnapshot(
      { ...src, kind: 'fixture_events' },
      await readFixture('fixture:provider-changes/stripe.json', FIX),
      null,
      { providerRoots: [] },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.origin === 'demo' && e.title.startsWith('[DEMO]'))).toBe(true);
  });
});
