import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { StatusDTO } from '@tracewise/shared';
import { SettingsForm } from '@/components/settings-form';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { apiGet } from '@/lib/api';

export const metadata = { title: 'Settings' };

function Row({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  const Icon = ok === null ? MinusCircle : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-start gap-3 border-b border-line/60 px-5 py-3 text-sm last:border-0">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok === null ? 'text-muted' : ok ? 'text-emerald-400' : 'text-red-400'}`} aria-hidden />
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const [status, settings] = await Promise.all([
    apiGet<StatusDTO>('/api/status'),
    apiGet<{
      monitoring: { livePollingEnabled: boolean; pollIntervalMinutes: number };
      notifications: { emailEnabled: boolean; recipients: string[]; minSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info' };
    }>('/api/settings'),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Preferences are stored in the database. Credentials and infrastructure are configured with environment variables and are never shown here."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Environment and integration status"
            action={
              <Badge
                className={
                  status.mode === 'demo'
                    ? 'bg-violet-500/15 text-violet-300 ring-violet-400/40'
                    : 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40'
                }
              >
                {status.mode} mode
              </Badge>
            }
          />
          <ul>
            <Row
              label="PostgreSQL"
              ok={status.database.ok}
              detail={status.database.ok ? 'Connected' : 'Unreachable: check DATABASE_URL and `docker compose up -d`'}
            />
            <Row
              label="Redis / job queue"
              ok={status.redis.ok}
              detail={
                status.queueMode === 'inline'
                  ? 'QUEUE_MODE=inline: jobs run inside the API process (no Redis needed)'
                  : status.redis.ok
                    ? 'Connected (BullMQ). Make sure the worker process is running.'
                    : 'Unreachable: check REDIS_URL'
              }
            />
            <Row
              label="Authentication"
              ok={status.authRequired}
              detail={
                status.authRequired
                  ? 'API requires a bearer token (production mode)'
                  : 'Demo mode: no authentication. Do not expose this instance publicly.'
              }
            />
            <Row
              label="Live feed polling"
              ok={status.livePollingEnabled}
              detail={status.livePollingEnabled ? 'Enabled' : 'Disabled: only local demo sources are read'}
            />
            <Row
              label="AI-assisted extraction"
              ok={status.llm.configured ? true : null}
              detail={
                status.llm.configured
                  ? `Provider: ${status.llm.provider} (changelog text only; never repository code)`
                  : 'Not configured (optional). Deterministic extraction is used.'
              }
            />
            <Row label="Email transport" ok={null} detail={`${status.email.transport}: messages are recorded in the database, not sent`} />
          </ul>
        </Card>
        <Card>
          <CardHeader title="Allowed scan roots and Git hosts" />
          <div className="space-y-4 p-5 text-sm">
            <div>
              <p className="text-xs text-muted">Local repositories must be inside (SCAN_ROOTS)</p>
              <ul className="mt-1 space-y-1">
                {status.scanRoots.map((r) => (
                  <li key={r} className="font-mono text-xs">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs text-muted">Git hosts allowed for https clones (GIT_ALLOWED_HOSTS)</p>
              <p className="mt-1 font-mono text-xs">{status.gitAllowedHosts.join(', ')}</p>
            </div>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Monitoring and notification preferences" />
          <SettingsForm initial={settings} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Optional credentials and configuration"
            subtitle="Set these in your .env file, then restart the processes. The browser never sees them."
          />
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted">Variable</th>
                <th className="px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted">Purpose</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:border-line/60 [&_td]:px-5 [&_td]:py-2.5">
              <tr>
                <td className="font-mono text-xs">SCAN_ROOTS</td>
                <td>Directories (separated by ; on Windows) that local repositories may live in</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">ENABLE_LIVE_POLLING</td>
                <td>Default for live polling (also adjustable above)</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL</td>
                <td>Optional AI-assisted extraction from public changelog text via an OpenAI-compatible endpoint</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">TRACEWISE_MODE, API_TOKEN, TRACEWISE_API_TOKEN</td>
                <td>Production mode: API bearer token, and the same token for the web server (never sent to browsers)</td>
              </tr>
              <tr>
                <td className="font-mono text-xs">QUEUE_MODE</td>
                <td>
                  <code>bullmq</code> (Redis + worker) or <code>inline</code> (no Redis, jobs run in the API)
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
