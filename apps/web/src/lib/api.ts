import 'server-only';
import { notFound } from 'next/navigation';

/** Server-side API client. The token never reaches the browser: client components call the same-origin /api proxy. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const base = () => (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      cache: 'no-store',
      headers: process.env.TRACEWISE_API_TOKEN ? { authorization: `Bearer ${process.env.TRACEWISE_API_TOKEN}` } : {},
    });
  } catch {
    throw new ApiError(0, `Cannot reach the Tracewise API at ${base()}. Is it running? (npm run dev:api)`, 'unreachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    throw new ApiError(res.status, body?.error?.message ?? `API returned ${res.status}`, body?.error?.code);
  }
  return (await res.json()) as T;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Use in `.catch(orNotFound)`: renders the 404 page for missing/invalid ids and rethrows everything else. */
export function orNotFound(e: unknown): never {
  if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
  throw e;
}
