/**
 * Measures (never assumes) Tracewise's behaviour. Run: npm run benchmark
 * Output is Markdown; paste real results into BENCHMARKS.md.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@tracewise/config';
import { createHandlers, InlineDispatcher, seedDemo, silentLogger, type CoreContext } from '@tracewise/core';
import { changeEvents, findings } from '@tracewise/database';
import { createTestDb } from '@tracewise/database/testing';
import { fingerprintOf, PROVIDER_CATALOG } from '@tracewise/providers';
import { scanRepository } from '@tracewise/scanner';
import { evaluate, loadCases } from './benchmark-lib';

const ROOT = path.resolve(import.meta.dirname, '..');
const out: string[] = [];
const log = (s = '') => out.push(s);
const f3 = (n: number) => n.toFixed(3);

// 1. call-site detection on labeled cases
const cases = await loadCases(ROOT);
const ev = await evaluate(cases);
const clean = await evaluate(cases.filter((c) => !c.knownLimitation));
log('## 1. Call-site detection (labeled synthetic cases)');
log(`Cases: ${cases.length} (${cases.filter((c) => c.knownLimitation).length} documented limitations included)`);
log('');
log('| Subset | TP | FP | FN | Precision | Recall |');
log('|---|---|---|---|---|---|');
log(`| All cases | ${ev.tp} | ${ev.fp} | ${ev.fn} | ${f3(ev.precision)} | ${f3(ev.recall)} |`);
log(`| Excluding documented limitations | ${clean.tp} | ${clean.fp} | ${clean.fn} | ${f3(clean.precision)} | ${f3(clean.recall)} |`);
log('');

// 2. end-to-end finding generation on the demo scenario
const handle = await createTestDb();
const cfg = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', QUEUE_MODE: 'inline' } as NodeJS.ProcessEnv, { loadDotenv: false });
const ctx: CoreContext = { db: handle.db, config: cfg, logger: silentLogger, dispatcher: undefined as never };
ctx.dispatcher = new InlineDispatcher(() => createHandlers(ctx), handle.db, silentLogger);
const t0 = performance.now();
await seedDemo(ctx);
const seedMs = performance.now() - t0;
const truth = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures/sample-repositories/demo-shop/expected-findings.json'), 'utf8')) as {
  expected: { event: string; file: string; matchKind: string }[];
};
const rows = await ctx.db
  .select({ f: findings, fp: changeEvents.fingerprint })
  .from(findings)
  .innerJoin(changeEvents, eq(changeEvents.id, findings.changeEventId));
const got = new Set(rows.map((r) => `${r.fp}|${r.f.filePath}|${r.f.matchKind}`));
const want = new Set(truth.expected.map((e) => `${fingerprintOf('fixture', e.event.split('-')[0]!, e.event)}|${e.file}|${e.matchKind}`));
const tp = [...got].filter((g) => want.has(g)).length;
log('## 2. End-to-end finding generation (demo scenario, ground truth in expected-findings.json)');
log('');
log('| Expected findings | Produced findings | TP | FP | FN | Precision | Recall |');
log('|---|---|---|---|---|---|---|');
log(
  `| ${want.size} | ${got.size} | ${tp} | ${got.size - tp} | ${want.size - tp} | ${f3(tp / Math.max(1, got.size))} | ${f3(tp / Math.max(1, want.size))} |`,
);
log('');
log(`Seeding (catalog sync, 12 events, scan, matching, in-process PGlite): ${seedMs.toFixed(0)} ms`);
log('');
await handle.close();

// 3. scan throughput on generated repositories
log('## 3. Scan throughput (generated repositories)');
log('');
log('| Files | Lines per file | Scan time (ms) | Files/sec | Call sites |');
log('|---|---|---|---|---|');
for (const n of [100, 500, 2000]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-bench-'));
  for (let i = 0; i < n; i++) {
    const body = [
      `import Stripe from 'stripe';`,
      `const s = new Stripe('');`,
      ...Array.from({ length: 60 }, (_, j) => `export const f${j} = (x: number) => x + ${j};`),
      `export const pay = () => s.charges.create({});`,
    ].join('\n');
    await fs.mkdir(path.join(dir, `d${i % 20}`), { recursive: true });
    await fs.writeFile(path.join(dir, `d${i % 20}`, `f${i}.ts`), i % 7 === 0 ? body : body.replace('s.charges.create', 'noop'));
  }
  await scanRepository({ rootDir: dir, providers: PROVIDER_CATALOG }); // warm-up
  const s0 = performance.now();
  const r = await scanRepository({ rootDir: dir, providers: PROVIDER_CATALOG, limits: { maxFiles: 10_000 } });
  const ms = performance.now() - s0;
  log(`| ${n} | 63 | ${ms.toFixed(0)} | ${(n / (ms / 1000)).toFixed(0)} | ${r.callSites.length} |`);
  await fs.rm(dir, { recursive: true, force: true });
}
log('');
log(
  `Environment: Node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown CPU'} x${os.cpus().length}, ${os.platform()} ${os.arch()}. Single run after one warm-up; expect variance.`,
);
console.log(out.join('\n'));
