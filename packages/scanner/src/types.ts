import type { CallSiteKind, DetectionMethod, Ecosystem } from '@tracewise/shared';

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ScanLimits = {
  maxFiles: 5000,
  maxFileBytes: 1_000_000,
  maxTotalBytes: 50_000_000,
  timeoutMs: 60_000,
};

export interface ScannedFile {
  path: string;
  language: 'typescript' | 'javascript' | 'python' | 'manifest';
  sizeBytes: number;
  sha256: string;
}

export interface DetectedDependency {
  packageName: string;
  versionSpec: string | null;
  resolvedVersion: string | null;
  ecosystem: Ecosystem;
  providerSlug: string;
  manifestPath: string;
  manifestLine: number | null;
  source: 'manifest' | 'lockfile';
  confidence: number;
}

export interface CallSiteMetadata {
  /** HTTP method when known (http_call). */
  method?: string;
  methodKnown?: boolean;
  host?: string;
  /** URL or path with unknown segments replaced by `{}`. */
  urlTemplate?: string;
  pathTemplate?: string;
  /** Static prefix for dynamic calls, e.g. "stripe.charges". */
  dynamicPrefix?: string;
  receiver?: string;
  module?: string;
  ecosystem?: Ecosystem;
  viaSdkRequest?: boolean;
  [key: string]: unknown;
}

export interface DetectedCallSite {
  providerSlug: string;
  filePath: string;
  line: number;
  symbol: string;
  kind: CallSiteKind;
  snippet: string;
  snippetStartLine: number;
  detectionMethod: DetectionMethod;
  confidence: number;
  /** True when the receiver was traced to an SDK import/constructor in the same file. */
  resolved: boolean;
  fileHash: string;
  metadata: CallSiteMetadata;
}

export interface ScanWarning {
  path?: string;
  message: string;
}

export interface ScanStats {
  filesVisited: number;
  filesIndexed: number;
  skipped: Record<string, number>;
  bytesRead: number;
  durationMs: number;
  truncated: boolean;
  pythonParser: 'tree_sitter' | 'regex_fallback' | 'none';
}

export interface ScanResult {
  files: ScannedFile[];
  dependencies: DetectedDependency[];
  callSites: DetectedCallSite[];
  warnings: ScanWarning[];
  stats: ScanStats;
}
