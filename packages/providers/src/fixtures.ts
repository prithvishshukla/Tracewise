import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AffectedItemSchema, EvidenceSchema, CHANGE_TYPES, SEVERITIES } from '@tracewise/shared';
import { fingerprintOf } from './hash';
import type { NormalizedChange, SourceInfo } from './types';

export const FIXTURE_SCHEME = 'fixture:';

/** Resolves `fixture:<relative path>` inside fixturesDir; rejects anything that escapes it. */
export async function readFixture(url: string, fixturesDir: string): Promise<string> {
  if (!url.startsWith(FIXTURE_SCHEME)) throw new Error('Not a fixture URL');
  const rel = url.slice(FIXTURE_SCHEME.length);
  const root = path.resolve(fixturesDir);
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || rel.includes('\0'))
    throw new Error('Fixture path escapes the fixtures directory');
  return fs.readFile(abs, 'utf8');
}

const FixtureEvent = z.object({
  key: z.string(),
  title: z.string(),
  summary: z.string(),
  changeType: z.enum(CHANGE_TYPES),
  severity: z.enum(SEVERITIES),
  publishedAt: z.string().datetime().optional(),
  effectiveAt: z.string().datetime().optional(),
  sourceUrl: z.string(),
  affected: z.array(AffectedItemSchema),
  evidence: z.array(EvidenceSchema),
  remediation: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export const FixtureFileSchema = z.object({ provider: z.string(), events: z.array(FixtureEvent) });

/** Fixture events are always labelled as demo data. */
export function parseFixtureEvents(content: string, source: SourceInfo): NormalizedChange[] {
  const file = FixtureFileSchema.parse(JSON.parse(content));
  return file.events.map((e) => ({
    fingerprint: fingerprintOf('fixture', source.providerSlug, e.key),
    title: e.title,
    summary: e.summary,
    changeType: e.changeType,
    severity: e.severity,
    affected: e.affected,
    effectiveAt: e.effectiveAt ? new Date(e.effectiveAt) : null,
    publishedAt: e.publishedAt ? new Date(e.publishedAt) : null,
    sourceUrl: e.sourceUrl,
    detectionMethod: 'fixture',
    confidence: e.confidence,
    evidence: e.evidence,
    origin: 'demo',
    remediation: e.remediation ?? null,
  }));
}
