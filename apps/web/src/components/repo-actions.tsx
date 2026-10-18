'use client';

import { Loader2, Play, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ScanDTO } from '@tracewise/shared';
import { buttonClass } from './ui';

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `Request failed (${res.status})`;
}

/** Starts a scan and polls its status until it finishes. */
export function ScanButton({ repositoryId, label = 'Scan now' }: { repositoryId: string; label?: string }) {
  const router = useRouter();
  const [scan, setScan] = useState<ScanDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function poll(id: string, attempt = 0) {
    const res = await fetch(`/api/scans/${id}`);
    if (!res.ok) {
      setError(await readError(res));
      setBusy(false);
      return;
    }
    const s = (await res.json()) as ScanDTO;
    setScan(s);
    if (s.status === 'succeeded' || s.status === 'failed') {
      setBusy(false);
      router.refresh();
      return;
    }
    if (attempt > 120) {
      setError('Still running; refresh the page to check the result.');
      setBusy(false);
      return;
    }
    timer.current = setTimeout(() => void poll(id, attempt + 1), 1000);
  }

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/repositories/${repositoryId}/scan`, { method: 'POST' });
    if (!res.ok) {
      setError(await readError(res));
      setBusy(false);
      return;
    }
    const { scan: s } = (await res.json()) as { scan: ScanDTO };
    setScan(s);
    void poll(s.id);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={buttonClass('primary')} onClick={() => void start()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {busy ? 'Scanning…' : label}
      </button>
      <p className="text-xs text-muted" aria-live="polite">
        {scan?.status === 'succeeded' && `Scan finished: ${scan.filesIndexed} files, ${scan.callSitesCount} call sites.`}
        {scan?.status === 'failed' && `Scan failed: ${scan.error ?? 'unknown error'}`}
        {busy && scan && `Status: ${scan.status}`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function RegisterRepoForm() {
  const router = useRouter();
  const [sourceType, setSourceType] = useState<'local' | 'git'>('local');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/repositories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceType, location }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    const repo = (await res.json()) as { id: string };
    router.push(`/repositories/${repo.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 p-5 md:grid-cols-[160px_1fr_auto] md:items-end">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Source
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as 'local' | 'git')}
          className="rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg"
        >
          <option value="local">Local directory</option>
          <option value="git">Git URL (https)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {sourceType === 'local' ? 'Absolute path (must be inside SCAN_ROOTS)' : 'https://github.com/owner/repo'}
        <input
          required
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          spellCheck={false}
          placeholder={sourceType === 'local' ? 'C:\\Users\\you\\projects\\my-app' : 'https://github.com/owner/repo'}
          className="rounded-lg border border-line bg-raised px-3 py-2 font-mono text-sm text-fg placeholder:text-muted/60"
        />
      </label>
      <button type="submit" className={buttonClass('primary')} disabled={busy || !location.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Register
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-300 md:col-span-3">
          {error}
        </p>
      )}
      <p className="text-xs text-muted md:col-span-3">
        The browser cannot read your disk. The API server reads the directory you name, and only inside the allowed roots configured with{' '}
        <code className="font-mono">SCAN_ROOTS</code>. Nothing is executed.
      </p>
    </form>
  );
}

export function PollButton({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/providers/${providerId}/poll`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setMsg(await readError(res));
      return;
    }
    const { enqueued } = (await res.json()) as { enqueued: number };
    setMsg(enqueued ? `Queued ${enqueued} source check${enqueued > 1 ? 's' : ''}. Refresh in a moment.` : 'A check was already queued.');
    setTimeout(() => router.refresh(), 1500);
  }
  return (
    <div className="text-right">
      <button type="button" className={buttonClass()} onClick={() => void run()} disabled={busy}>
        {busy ? 'Queuing…' : 'Check sources now'}
      </button>
      {msg && (
        <p className="mt-1 text-xs text-muted" aria-live="polite">
          {msg}
        </p>
      )}
    </div>
  );
}
