import { assertPublicHostname } from '@tracewise/config';

export class FetchError extends Error {
  retryAfterMs?: number;
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  userAgent?: string;
  etag?: string | null;
  lastModified?: string | null;
  maxBytes?: number;
  allowPrivate?: boolean;
  maxRedirects?: number;
  perHostConcurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchResult {
  status: 200 | 304;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
  attempts: number;
}

/** Per-host concurrency limiter (process-wide). */
const hostState = new Map<string, { active: number; waiters: (() => void)[] }>();
async function withHostSlot<T>(host: string, limit: number, fn: () => Promise<T>): Promise<T> {
  const st = hostState.get(host) ?? { active: 0, waiters: [] };
  hostState.set(host, st);
  if (st.active >= limit) await new Promise<void>((r) => st.waiters.push(r));
  st.active++;
  try {
    return await fn();
  } finally {
    st.active--;
    st.waiters.shift()?.();
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new FetchError(`Response too large (${declared} bytes)`, false);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError(`Response exceeded ${maxBytes} bytes`, false);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Polite, SSRF-aware HTTP GET: timeouts, retry with exponential backoff and jitter, Retry-After handling,
 * conditional requests (ETag / Last-Modified), manual redirect following with host re-validation,
 * response size cap and per-host concurrency limits.
 */
export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = 15_000,
    retries = 2,
    baseDelayMs = 500,
    maxBytes = 5_000_000,
    maxRedirects = 3,
    perHostConcurrency = 2,
    sleep = defaultSleep,
  } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetchOnce(url, opts, timeoutMs, maxRedirects, perHostConcurrency, maxBytes);
      return { ...res, attempts: attempt };
    } catch (e) {
      lastErr = e;
      const err = e instanceof FetchError ? e : new FetchError((e as Error).message, true);
      if (!err.retryable || attempt > retries) throw err;
      const delay = Math.min(10_000, baseDelayMs * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
      await sleep(err.retryAfterMs ?? delay);
    }
  }
  throw lastErr;
}

async function fetchOnce(
  startUrl: string,
  opts: FetchOptions,
  timeoutMs: number,
  maxRedirects: number,
  perHost: number,
  maxBytes: number,
): Promise<Omit<FetchResult, 'attempts'>> {
  let current = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError(`Unsupported protocol ${u.protocol}`, false);
    if (!opts.allowPrivate)
      await assertPublicHostname(u.hostname).catch((e: Error) => {
        throw new FetchError(e.message, false);
      });
    const headers: Record<string, string> = {
      'user-agent': opts.userAgent ?? 'Tracewise/0.1',
      accept: 'application/atom+xml, application/rss+xml, application/json, application/yaml, text/xml, */*;q=0.5',
    };
    if (opts.etag) headers['if-none-match'] = opts.etag;
    if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;
    const res = await withHostSlot(u.host, perHost, async () => {
      try {
        const r = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        if (r.status >= 300 && r.status < 400) return r;
        if (r.status === 304) return r;
        if (!r.ok) {
          const err = new FetchError(`HTTP ${r.status} from ${u.host}`, r.status === 429 || r.status >= 500, r.status);
          const ra = Number(r.headers.get('retry-after'));
          if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(ra * 1000, 10_000);
          await r.body?.cancel();
          throw err;
        }
        const body = await readLimited(r, maxBytes);
        return new Response(body, { status: 200, headers: r.headers });
      } catch (e) {
        if (e instanceof FetchError) throw e;
        const name = (e as Error).name;
        throw new FetchError(
          name === 'TimeoutError' || name === 'AbortError'
            ? `Request timed out after ${timeoutMs}ms`
            : `Network error: ${(e as Error).message}`,
          true,
        );
      }
    });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchError('Redirect without Location header', false);
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 304) return { status: 304, etag: opts.etag, lastModified: opts.lastModified };
    return { status: 200, body: await res.text(), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  }
  throw new FetchError('Too many redirects', false);
}
