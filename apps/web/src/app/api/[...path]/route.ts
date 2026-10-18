import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for browser requests. It forwards to the Tracewise API and attaches the bearer token on the
 * server, so the token is never exposed to client code. This is NOT user authentication; see docs/SECURITY.md.
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = (process.env.API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  const url = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  if (process.env.TRACEWISE_API_TOKEN) headers.authorization = `Bearer ${process.env.TRACEWISE_API_TOKEN}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
    });
    return new NextResponse(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'unreachable', message: 'Cannot reach the Tracewise API. Is it running?' } },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT };
