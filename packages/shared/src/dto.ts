import type { AffectedItem, Evidence } from './affected';
import type { CallSiteKind, ChangeType, FindingStatus, MatchKind, Origin, ScanStatus, Severity, SourceKind } from './enums';

/** Response shapes shared by the API and the web app (dates are ISO strings on the wire). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProviderSourceDTO {
  id: string;
  kind: SourceKind;
  url: string;
  label: string;
  origin: Origin;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export type MonitoringStatus = 'demo' | 'ok' | 'failing' | 'never_checked';

export interface ProviderDTO {
  id: string;
  slug: string;
  name: string;
  docsUrl: string;
  description: string;
  packages: { ecosystem: string; name: string }[];
  hosts: string[];
  monitoringStatus: MonitoringStatus;
  lastSuccessAt: string | null;
  changeCount: number;
  sources?: ProviderSourceDTO[];
}

export interface ChangeDTO {
  id: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  title: string;
  summary: string;
  changeType: ChangeType;
  severity: Severity;
  affected: AffectedItem[];
  effectiveAt: string | null;
  publishedAt: string | null;
  detectedAt: string;
  sourceUrl: string;
  detectionMethod: string;
  confidence: number;
  evidence: Evidence[];
  origin: Origin;
  remediation: string | null;
  findingCount?: number;
}

export interface RepositoryDTO {
  id: string;
  name: string;
  sourceType: 'local' | 'git';
  location: string;
  lastScanAt: string | null;
  latestScanStatus: ScanStatus | null;
  openFindings: number;
  providers: string[];
  createdAt: string;
}

export interface ScanDTO {
  id: string;
  repositoryId: string;
  status: ScanStatus;
  startedAt: string | null;
  finishedAt: string | null;
  filesIndexed: number;
  dependenciesCount: number;
  callSitesCount: number;
  findingsCreated: number;
  error: string | null;
  warnings: { path?: string; message: string }[];
  createdAt: string;
}

export interface DependencyDTO {
  id: string;
  packageName: string;
  versionSpec: string | null;
  resolvedVersion: string | null;
  ecosystem: string;
  providerSlug: string | null;
  manifestPath: string;
  source: 'manifest' | 'lockfile';
  confidence: number;
}

export interface IndexedFileDTO {
  id: string;
  path: string;
  language: string;
  sizeBytes: number;
  sha256: string;
}

export interface FindingDTO {
  id: string;
  title: string;
  providerSlug: string;
  providerName: string;
  repositoryId: string;
  repositoryName: string;
  changeEventId: string;
  changeTitle: string;
  changeType: ChangeType;
  changeOrigin: Origin;
  filePath: string;
  line: number | null;
  severity: Severity;
  confidence: number;
  impact: 'verified' | 'possible';
  matchKind: MatchKind;
  matchReason: string;
  explanation: string;
  evidence: Evidence[];
  limitations: string;
  remediation: string;
  snippet: string;
  snippetStartLine: number | null;
  status: FindingStatus;
  statusNote: string | null;
  snoozedUntil: string | null;
  stillDetected: boolean;
  createdAt: string;
  updatedAt: string;
  related?: FindingDTO[];
  change?: ChangeDTO;
}

export interface DashboardStats {
  providers: number;
  repositories: number;
  openFindings: number;
  criticalFindings: number;
  verifiedFindings: number;
  findingsBySeverity: { severity: Severity; count: number }[];
  recentChanges: ChangeDTO[];
  recentScans: (ScanDTO & { repositoryName: string })[];
  providerStatus: { slug: string; name: string; status: MonitoringStatus; lastSuccessAt: string | null }[];
  demoMode: boolean;
}

export interface CallSiteKindLabel {
  kind: CallSiteKind;
}

export interface ChangeDetailDTO extends ChangeDTO {
  sourceLabel: string | null;
  findings: FindingDTO[];
}

export interface ProviderDetailDTO extends ProviderDTO {
  sources: ProviderSourceDTO[];
  recentChanges: ChangeDTO[];
}

export interface RepositoryDetailDTO extends RepositoryDTO {
  latestScan: ScanDTO | null;
  dependencyCount: number;
  fileCount: number;
  callSiteCount: number;
}

export interface StatusDTO {
  mode: 'demo' | 'production';
  queueMode: 'bullmq' | 'inline';
  authRequired: boolean;
  livePollingEnabled: boolean;
  database: { ok: boolean };
  redis: { ok: boolean | null };
  llm: { provider: string; configured: boolean };
  email: { transport: string };
  scanRoots: string[];
  gitAllowedHosts: string[];
}
