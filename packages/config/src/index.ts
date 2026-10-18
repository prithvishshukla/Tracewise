import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walks up from `start` to the directory whose package.json declares workspaces. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (json.workspaces) return dir;
      } catch {
        /* ignore malformed package.json while walking up */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRACEWISE_MODE: z.enum(['demo', 'production']).default('demo'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://postgres:tracewise@localhost:5432/tracewise'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4000),
  API_TOKEN: z.string().optional(),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SCAN_ROOTS: z.string().optional(),
  GIT_ALLOWED_HOSTS: z.string().default('github.com,gitlab.com,bitbucket.org'),
  SCAN_MAX_FILES: z.coerce.number().int().default(5000),
  SCAN_MAX_FILE_BYTES: z.coerce.number().int().default(1_000_000),
  SCAN_MAX_TOTAL_BYTES: z.coerce.number().int().default(50_000_000),
  SCAN_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  ENABLE_LIVE_POLLING: bool.default(false),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().default(360),
  FETCH_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  FETCH_ALLOW_PRIVATE: bool.default(false),
  FETCH_USER_AGENT: z.string().default('Tracewise/0.1 (+https://github.com/your-org/tracewise)'),
  LLM_PROVIDER: z.enum(['none', 'openai_compatible']).default('none'),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  EMAIL_TRANSPORT: z.enum(['log']).default('log'),
  FIXTURES_DIR: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  mode: 'demo' | 'production';
  logLevel: string;
  repoRoot: string;
  fixturesDir: string;
  databaseUrl: string;
  redisUrl: string;
  queueMode: 'bullmq' | 'inline';
  api: { host: string; port: number; token?: string; webOrigin: string };
  scan: {
    roots: string[];
    gitAllowedHosts: string[];
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    timeoutMs: number;
  };
  monitoring: {
    livePollingEnabled: boolean;
    pollIntervalMinutes: number;
    fetchTimeoutMs: number;
    allowPrivateHosts: boolean;
    userAgent: string;
  };
  llm: { provider: 'none' | 'openai_compatible'; baseUrl: string; apiKey?: string; model: string };
  emailTransport: 'log';
}

let dotenvLoaded = false;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { loadDotenv?: boolean } = {}): AppConfig {
  const repoRoot = findRepoRoot();
  if (opts.loadDotenv !== false && !dotenvLoaded && env === process.env) {
    loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });
    dotenvLoaded = true;
  }
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const e = parsed.data;
  const fixturesDir = e.FIXTURES_DIR ? path.resolve(e.FIXTURES_DIR) : path.join(repoRoot, 'fixtures');
  const roots = (e.SCAN_ROOTS ? e.SCAN_ROOTS.split(path.delimiter) : [path.join(fixturesDir, 'sample-repositories')])
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => path.resolve(r));

  if (e.TRACEWISE_MODE === 'production' && !e.API_TOKEN) {
    throw new Error('API_TOKEN must be set when TRACEWISE_MODE=production');
  }
  return {
    nodeEnv: e.NODE_ENV,
    mode: e.TRACEWISE_MODE,
    logLevel: e.LOG_LEVEL,
    repoRoot,
    fixturesDir,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    queueMode: e.QUEUE_MODE,
    api: { host: e.API_HOST, port: e.API_PORT, token: e.API_TOKEN, webOrigin: e.WEB_ORIGIN },
    scan: {
      roots,
      gitAllowedHosts: e.GIT_ALLOWED_HOSTS.split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
      maxFiles: e.SCAN_MAX_FILES,
      maxFileBytes: e.SCAN_MAX_FILE_BYTES,
      maxTotalBytes: e.SCAN_MAX_TOTAL_BYTES,
      timeoutMs: e.SCAN_TIMEOUT_MS,
    },
    monitoring: {
      livePollingEnabled: e.ENABLE_LIVE_POLLING,
      pollIntervalMinutes: e.POLL_INTERVAL_MINUTES,
      fetchTimeoutMs: e.FETCH_TIMEOUT_MS,
      allowPrivateHosts: e.FETCH_ALLOW_PRIVATE,
      userAgent: e.FETCH_USER_AGENT,
    },
    llm: { provider: e.LLM_PROVIDER, baseUrl: e.LLM_BASE_URL, apiKey: e.LLM_API_KEY, model: e.LLM_MODEL },
    emailTransport: e.EMAIL_TRANSPORT,
  };
}

/** Describes integration state without ever returning secret values. */
export function integrationStatus(cfg: AppConfig) {
  return {
    mode: cfg.mode,
    queueMode: cfg.queueMode,
    authRequired: cfg.mode === 'production',
    livePollingEnabled: cfg.monitoring.livePollingEnabled,
    llm: { provider: cfg.llm.provider, configured: cfg.llm.provider !== 'none' && Boolean(cfg.llm.apiKey) },
    email: { transport: cfg.emailTransport },
    scanRoots: cfg.scan.roots,
    gitAllowedHosts: cfg.scan.gitAllowedHosts,
  };
}
export * from './net-safety';
