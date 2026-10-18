import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, politeFetch } from '../src';

let server: http.Server;
let base: string;
const hits: Record<string, number> = {};
const noSleep = async () => undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    hits[url] = (hits[url] ?? 0) + 1;
    if (url === '/ok') {
      res.setHeader('etag', '"v1"');
      if (req.headers['if-none-match'] === '"v1"') {
        res.statusCode = 304;
        return res.end();
      }
      return res.end('hello');
    }
    if (url === '/flaky') {
      if (hits[url]! < 3) {
        res.statusCode = 503;
        return res.end('x');
      }
      return res.end('recovered');
    }
    if (url === '/always500') {
      res.statusCode = 500;
      return res.end('x');
    }
    if (url === '/404') {
      res.statusCode = 404;
      return res.end('x');
    }
    if (url === '/ratelimit') {
      if (hits[url]! < 2) {
        res.statusCode = 429;
        res.setHeader('retry-after', '1');
        return res.end();
      }
      return res.end('ok');
    }
    if (url === '/slow') {
      return void setTimeout(() => res.end('late'), 500);
    }
    if (url === '/big') return res.end('x'.repeat(5000));
    if (url === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', '/ok');
      return res.end();
    }
    if (url === '/loop') {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      return res.end();
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const opts = { allowPrivate: true, sleep: noSleep, baseDelayMs: 1 };

describe('politeFetch', () => {
  it('fetches and supports conditional requests (304)', async () => {
    const a = await politeFetch(`${base}/ok`, opts);
    expect(a).toMatchObject({ status: 200, body: 'hello', etag: '"v1"' });
    const b = await politeFetch(`${base}/ok`, { ...opts, etag: a.etag });
    expect(b.status).toBe(304);
  });
  it('retries 5xx with backoff and then succeeds', async () => {
    const r = await politeFetch(`${base}/flaky`, { ...opts, retries: 3 });
    expect(r.body).toBe('recovered');
    expect(r.attempts).toBe(3);
  });
  it('gives up after the retry budget and reports a retryable failure', async () => {
    await expect(politeFetch(`${base}/always500`, { ...opts, retries: 1 })).rejects.toMatchObject({
      name: 'FetchError',
      retryable: true,
      status: 500,
    });
  });
  it('does not retry 4xx', async () => {
    const before = hits['/404'] ?? 0;
    await expect(politeFetch(`${base}/404`, { ...opts, retries: 3 })).rejects.toMatchObject({ retryable: false, status: 404 });
    expect((hits['/404'] ?? 0) - before).toBe(1);
  });
  it('honours Retry-After on 429', async () => {
    const waits: number[] = [];
    const r = await politeFetch(`${base}/ratelimit`, {
      ...opts,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(r.body).toBe('ok');
    expect(waits[0]).toBe(1000);
  });
  it('times out slow responses', async () => {
    await expect(politeFetch(`${base}/slow`, { ...opts, timeoutMs: 100, retries: 0 })).rejects.toThrow(/timed out/);
  });
  it('enforces the response size cap', async () => {
    await expect(politeFetch(`${base}/big`, { ...opts, maxBytes: 1000 })).rejects.toThrow(/exceeded|too large/);
  });
  it('follows limited redirects and stops redirect loops', async () => {
    expect((await politeFetch(`${base}/redirect`, opts)).body).toBe('hello');
    await expect(politeFetch(`${base}/loop`, { ...opts, maxRedirects: 2 })).rejects.toThrow(/redirect/i);
  });
  it('blocks private hosts unless explicitly allowed (SSRF protection)', async () => {
    await expect(politeFetch(`${base}/ok`, { sleep: noSleep })).rejects.toBeInstanceOf(FetchError);
    await expect(politeFetch('http://169.254.169.254/latest/meta-data', { sleep: noSleep })).rejects.toThrow(/non-public|not a public/);
    await expect(politeFetch('http://localhost:1/', { sleep: noSleep })).rejects.toThrow(/not allowed/);
    await expect(politeFetch('file:///etc/passwd', { sleep: noSleep })).rejects.toThrow(/protocol/);
  });
  it('limits concurrent requests per host', async () => {
    let active = 0;
    let peak = 0;
    const s2 = http.createServer((_q, res) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.end('x');
      }, 40);
    });
    await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}/`;
    await Promise.all(Array.from({ length: 6 }, () => politeFetch(url, { ...opts, perHostConcurrency: 2 })));
    await new Promise<void>((r) => s2.close(() => r()));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
