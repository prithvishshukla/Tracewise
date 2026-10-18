import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '@tracewise/providers';
import { scanRepository } from '../src';
import { tempRepo } from './helpers';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/sample-repositories/demo-shop');
const scan = (dir: string, limits = {}) => scanRepository({ rootDir: dir, providers: PROVIDER_CATALOG, limits });

describe('scanRepository on the demo fixture', () => {
  it('indexes files, detects dependencies and call sites deterministically', async () => {
    const a = await scan(FIXTURE);
    const b = await scan(FIXTURE);
    expect(JSON.stringify(a.callSites)).toBe(JSON.stringify(b.callSites));
    expect(a.files.map((f) => f.path)).toContain('src/payments.ts');
    expect(a.files.map((f) => f.path)).not.toContain('NOTES.md');
    const names = a.dependencies.map((d) => `${d.source}:${d.packageName}`);
    expect(names).toEqual(
      expect.arrayContaining(['manifest:stripe', 'lockfile:stripe', 'manifest:openai', 'manifest:twilio', 'manifest:@octokit/rest']),
    );
    expect(a.dependencies.find((d) => d.packageName === 'openai' && d.ecosystem === 'pypi')).toMatchObject({ resolvedVersion: '0.28.1' });
    const sym = (f: string) => a.callSites.filter((c) => c.filePath === f && c.kind === 'sdk_call').map((c) => c.symbol);
    expect(sym('src/payments.ts')).toEqual(expect.arrayContaining(['stripe.charges.create', 'stripe.paymentIntents.create']));
    expect(a.callSites.filter((c) => c.filePath === 'src/lookalike.ts')).toEqual([]);
    expect(a.callSites.filter((c) => c.filePath === 'src/server.ts')).toEqual([]);
    expect(a.warnings.some((w) => w.path === 'tools/legacy-service/package.json' && /Malformed/.test(w.message))).toBe(true);
    expect(a.stats.skipped.unsupported_type).toBeGreaterThanOrEqual(1);
    expect(a.stats.pythonParser).toBe('tree_sitter');
  });

  it('never stores raw secrets from source files', async () => {
    const a = await scan(FIXTURE);
    expect(JSON.stringify(a)).not.toContain('FAKEKEYFORDEMO000000000');
  });
});

describe('scanRepository edge cases', () => {
  it('handles an empty repository and one without supported files', async () => {
    const r = await tempRepo({ 'README.md': '# hi', 'data.csv': 'a,b' });
    try {
      const out = await scan(r.dir);
      expect(out.files).toEqual([]);
      expect(out.callSites).toEqual([]);
      expect(out.stats.skipped.unsupported_type).toBe(2);
    } finally {
      await r.cleanup();
    }
  });

  it('reports a missing root as an error', async () => {
    await expect(scan('/definitely/not/here')).rejects.toThrow();
  });

  it('skips binary content even with a supported extension', async () => {
    const r = await tempRepo({});
    try {
      await fs.writeFile(path.join(r.dir, 'weird.ts'), Buffer.from([0x69, 0x6d, 0x00, 0x01, 0x02]));
      const out = await scan(r.dir);
      expect(out.files).toEqual([]);
      expect(out.stats.skipped.binary).toBe(1);
    } finally {
      await r.cleanup();
    }
  });

  it('a failing file does not abort the scan', async () => {
    const r = await tempRepo({
      'good.ts': `import Stripe from 'stripe'; const s = new Stripe(''); s.charges.create({});`,
      'bad/package.json': '{',
    });
    try {
      const out = await scan(r.dir);
      expect(out.callSites.some((c) => c.symbol === 'stripe.charges.create')).toBe(true);
      expect(out.warnings.length).toBe(1);
    } finally {
      await r.cleanup();
    }
  });

  it('flags partial results when limits are hit', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.ts`] = 'export {}';
    const r = await tempRepo(files);
    try {
      const out = await scan(r.dir, { maxFiles: 3 });
      expect(out.stats.truncated).toBe(true);
      expect(out.files).toHaveLength(3);
    } finally {
      await r.cleanup();
    }
  });

  it('does not follow symlinks out of the repository', async () => {
    const r = await tempRepo({ 'a.ts': 'export {}' });
    const outside = await tempRepo({ 'secret.ts': `import Stripe from 'stripe'; new Stripe('').charges.create({})` });
    try {
      await fs.symlink(outside.dir, path.join(r.dir, 'out'));
      const out = await scan(r.dir);
      expect(out.files.map((f) => f.path)).toEqual(['a.ts']);
      expect(out.stats.skipped.symlink).toBe(1);
    } finally {
      await r.cleanup();
      await outside.cleanup();
    }
  });
});
