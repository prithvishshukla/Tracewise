import type { AffectedItem, CallSiteKind, ChangeType, Evidence, MatchKind, Origin, Severity } from '@tracewise/shared';

export interface MatcherEvent {
  id: string;
  providerSlug: string;
  providerHosts: string[];
  title: string;
  changeType: ChangeType;
  severity: Severity;
  affected: AffectedItem[];
  effectiveAt: Date | null;
  sourceUrl: string;
  remediation: string | null;
  evidence: Evidence[];
  origin: Origin;
}

export interface MatcherCallSite {
  id: string;
  providerSlug: string;
  filePath: string;
  line: number;
  symbol: string;
  kind: CallSiteKind;
  snippet: string;
  snippetStartLine: number;
  confidence: number;
  resolved: boolean;
  metadata: Record<string, unknown>;
}

export interface MatcherDependency {
  id: string;
  providerSlug: string;
  packageName: string;
  ecosystem: 'npm' | 'pypi';
  versionSpec: string | null;
  resolvedVersion: string | null;
  manifestPath: string;
  manifestLine: number | null;
  source: 'manifest' | 'lockfile';
}

export interface MatchContext {
  callSites: MatcherCallSite[];
  dependencies: MatcherDependency[];
  now?: Date;
}

export interface Match {
  callSiteId: string | null;
  dependencyId: string | null;
  kind: MatchKind;
  confidence: number;
  severity: Severity;
  filePath: string;
  line: number | null;
  snippet: string;
  snippetStartLine: number | null;
  /** Stable key (without line number) used to fingerprint findings across rescans. */
  matchKey: string;
  title: string;
  reason: string;
  explanation: string;
  limitations: string;
  remediation: string;
  evidence: Evidence[];
  affectedItem: AffectedItem;
}
