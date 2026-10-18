'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FINDING_STATUSES, type FindingStatus } from '@tracewise/shared';
import { STATUS_LABEL } from '@/lib/format';

const HINT: Record<FindingStatus, string> = {
  open: 'Needs attention',
  snoozed: 'Hidden for 7 days, then reopens',
  fixed: 'Resolved in code',
  false_positive: 'Not a real impact',
};

/** Changes a finding's status through the API; the new state is stored in PostgreSQL. */
export function StatusControls({ findingId, status: initial }: { findingId: string; status: FindingStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<FindingStatus>(initial);
  const [pending, setPending] = useState<FindingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(next: FindingStatus) {
    if (next === status || pending) return;
    setPending(next);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next === 'snoozed' ? { status: next, snoozeDays: 7 } : { status: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setStatus(next);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div role="group" aria-label="Finding status" className="grid grid-cols-2 gap-2">
        {FINDING_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            disabled={pending !== null}
            title={HINT[s]}
            onClick={() => void change(s)}
            className={clsx(
              'rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60',
              status === s
                ? 'border-accent bg-accent/15 font-medium text-fg'
                : 'border-line bg-raised text-muted hover:border-accent/60 hover:text-fg',
            )}
          >
            {pending === s ? 'Saving…' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {HINT[status]}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
