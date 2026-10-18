export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHANGE_TYPES = ['breaking', 'deprecation', 'warning', 'informational'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const FINDING_STATUSES = ['open', 'snoozed', 'fixed', 'false_positive'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const MATCH_KINDS = ['exact_symbol', 'known_endpoint', 'api_path', 'package_version', 'pattern', 'dynamic_prefix'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const SCAN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SOURCE_KINDS = ['fixture_events', 'rss', 'atom', 'openapi'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const ORIGINS = ['demo', 'live'] as const;
export type Origin = (typeof ORIGINS)[number];

export const ECOSYSTEMS = ['npm', 'pypi'] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export const CALL_SITE_KINDS = ['sdk_call', 'sdk_import', 'http_call', 'endpoint_literal', 'dynamic_call'] as const;
export type CallSiteKind = (typeof CALL_SITE_KINDS)[number];

export const DETECTION_METHODS = ['typescript_ast', 'tree_sitter', 'regex_fallback', 'manifest'] as const;
export type DetectionMethod = (typeof DETECTION_METHODS)[number];

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function downgradeSeverity(s: Severity, steps = 1): Severity {
  const idx = SEVERITIES.indexOf(s);
  return SEVERITIES[Math.min(idx + steps, SEVERITIES.length - 1)] as Severity;
}

export type ConfidenceLabel = 'high' | 'medium' | 'low';

/** Findings at or above this confidence are "verified" static matches; below it they are "possible". */
export const VERIFIED_THRESHOLD = 0.85;

export function confidenceLabel(c: number): ConfidenceLabel {
  if (c >= VERIFIED_THRESHOLD) return 'high';
  if (c >= 0.6) return 'medium';
  return 'low';
}

export type ImpactClass = 'verified' | 'possible';
export function impactClass(c: number): ImpactClass {
  return c >= VERIFIED_THRESHOLD ? 'verified' : 'possible';
}
