import fs from 'node:fs/promises';
import path from 'node:path';
import { PROVIDER_CATALOG } from '@tracewise/providers';
import { analyzeJavaScript, analyzePython, buildProviderIndex } from '@tracewise/scanner';

export interface CallSiteCase {
  id: string;
  language: 'ts' | 'tsx' | 'js' | 'py';
  code: string;
  expected: string[];
  note: string;
  knownLimitation: boolean;
}
export interface CaseResult {
  id: string;
  expected: string[];
  got: string[];
  tp: number;
  fp: number;
  fn: number;
  knownLimitation: boolean;
}

const idx = buildProviderIndex(PROVIDER_CATALOG);

/** Symbols that count as a confident, resolved detection (what a verified finding would be built on). */
export async function detect(c: CallSiteCase): Promise<string[]> {
  const file = `case.${c.language}`;
  const sites =
    c.language === 'py' ? (await analyzePython(c.code, file, 'h', idx)).callSites : analyzeJavaScript(c.code, file, 'h', idx).callSites;
  return [...new Set(sites.filter((s) => (s.kind === 'sdk_call' || s.kind === 'http_call') && s.resolved).map((s) => s.symbol))].sort();
}

export async function loadCases(root: string): Promise<CallSiteCase[]> {
  return (JSON.parse(await fs.readFile(path.join(root, 'fixtures/benchmarks/callsite-cases.json'), 'utf8')) as { cases: CallSiteCase[] })
    .cases;
}

export async function evaluate(
  cases: CallSiteCase[],
): Promise<{ results: CaseResult[]; tp: number; fp: number; fn: number; precision: number; recall: number }> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const got = await detect(c);
    const want = [...c.expected].sort();
    const tp = got.filter((g) => want.includes(g)).length;
    results.push({ id: c.id, expected: want, got, tp, fp: got.length - tp, fn: want.length - tp, knownLimitation: c.knownLimitation });
  }
  const tp = results.reduce((a, r) => a + r.tp, 0);
  const fp = results.reduce((a, r) => a + r.fp, 0);
  const fn = results.reduce((a, r) => a + r.fn, 0);
  return { results, tp, fp, fn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) };
}
