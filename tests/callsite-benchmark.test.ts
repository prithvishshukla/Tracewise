import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate, loadCases } from '../scripts/benchmark-lib';

const ROOT = path.resolve(__dirname, '..');

describe('call-site detection on the labeled synthetic cases', () => {
  it('detects every non-limitation case exactly (no false positives or negatives)', async () => {
    const { results } = await evaluate(await loadCases(ROOT));
    const failing = results.filter((r) => !r.knownLimitation && (r.fp > 0 || r.fn > 0));
    expect(failing, JSON.stringify(failing, null, 1)).toEqual([]);
  });

  it('documented limitations still behave as documented (so a fix is noticed and the docs updated)', async () => {
    const { results } = await evaluate(await loadCases(ROOT));
    const lim = Object.fromEntries(results.filter((r) => r.knownLimitation).map((r) => [r.id, r]));
    expect(lim['lim-cross-file-wrapper']).toMatchObject({ fn: 1, fp: 0 });
    expect(lim['lim-intermediate-alias']).toMatchObject({ fn: 1, fp: 0 });
    expect(lim['lim-name-shadowing']).toMatchObject({ fp: 1, fn: 0 });
  });
});
