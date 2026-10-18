'use client';

import { useState } from 'react';
import { SEVERITIES } from '@tracewise/shared';
import { SEVERITY_LABEL } from '@/lib/format';
import { buttonClass } from './ui';

interface Settings {
  monitoring: { livePollingEnabled: boolean; pollIntervalMinutes: number };
  notifications: { emailEnabled: boolean; recipients: string[]; minSeverity: (typeof SEVERITIES)[number] };
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [recipients, setRecipients] = useState(initial.notifications.recipients.join(', '));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = {
      monitoring: s.monitoring,
      notifications: {
        ...s.notifications,
        recipients: recipients
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      },
    };
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) setMsg({ ok: true, text: 'Saved.' });
    else {
      const err = (await res.json().catch(() => null)) as {
        error?: { message?: string; details?: { path: string; message: string }[] };
      } | null;
      setMsg({
        ok: false,
        text: err?.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ?? err?.error?.message ?? 'Could not save',
      });
    }
  }

  const field = 'rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg';
  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-6 p-5">
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium text-fg">Monitoring</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-blue-500"
            checked={s.monitoring.livePollingEnabled}
            onChange={(e) => setS({ ...s, monitoring: { ...s.monitoring, livePollingEnabled: e.target.checked } })}
          />
          <span>
            Poll live sources (public RSS/Atom feeds)
            <span className="block text-xs text-muted">
              Off by default. When on, the worker contacts the external feeds listed on each provider page. Demo sources never leave your
              machine.
            </span>
          </span>
        </label>
        <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted">
          Poll interval (minutes, applied when the worker restarts)
          <input
            type="number"
            min={15}
            max={10080}
            className={field}
            value={s.monitoring.pollIntervalMinutes}
            onChange={(e) => setS({ ...s, monitoring: { ...s.monitoring, pollIntervalMinutes: Number(e.target.value) } })}
          />
        </label>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium text-fg">Email notifications</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-blue-500"
            checked={s.notifications.emailEnabled}
            onChange={(e) => setS({ ...s, notifications: { ...s.notifications, emailEnabled: e.target.checked } })}
          />
          <span>
            Email a digest when new findings appear
            <span className="block text-xs text-muted">
              The bundled transport records messages in the database and logs them; it does not send real email. See docs for adding SMTP.
            </span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Recipients (comma separated)
          <input
            className={field}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="dev@example.com, lead@example.com"
          />
        </label>
        <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted">
          Minimum severity
          <select
            className={field}
            value={s.notifications.minSeverity}
            onChange={(e) =>
              setS({ ...s, notifications: { ...s.notifications, minSeverity: e.target.value as Settings['notifications']['minSeverity'] } })
            }
          >
            {SEVERITIES.map((v) => (
              <option key={v} value={v}>
                {SEVERITY_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="submit" className={buttonClass('primary')} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}
