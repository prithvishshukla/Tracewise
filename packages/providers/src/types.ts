import type { AffectedItem, ChangeType, Evidence, Origin, Severity, SourceKind } from '@tracewise/shared';

/** A normalized upstream change, before it is stored. `fingerprint` is the dedupe key. */
export interface NormalizedChange {
  fingerprint: string;
  title: string;
  summary: string;
  changeType: ChangeType;
  severity: Severity;
  affected: AffectedItem[];
  effectiveAt: Date | null;
  publishedAt: Date | null;
  sourceUrl: string;
  detectionMethod: 'fixture' | 'feed_keyword' | 'openapi_diff' | 'llm_assisted';
  confidence: number;
  evidence: Evidence[];
  origin: Origin;
  remediation: string | null;
}

export interface SourceInfo {
  providerSlug: string;
  kind: SourceKind;
  url: string;
  label: string;
  origin: Origin;
}
