import { inArray } from 'drizzle-orm';
import { findings, notifications, providers, repositories, type Db } from '@tracewise/database';
import { eq } from 'drizzle-orm';
import { SEVERITY_RANK } from '@tracewise/shared';
import type { CoreContext } from './context';
import { getSettings } from './settings';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  findingIds: string[];
}

/** Email delivery interface. The bundled transport records messages in the database and logs them. */
export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
}

export class LogEmailTransport implements EmailTransport {
  constructor(
    private db: Db,
    private log: (msg: string) => void,
  ) {}
  async send(msg: EmailMessage): Promise<void> {
    await this.db
      .insert(notifications)
      .values({ channel: 'email', recipient: msg.to, subject: msg.subject, body: msg.body, status: 'logged', findingIds: msg.findingIds });
    this.log(`email (logged, not sent) to=${msg.to} subject="${msg.subject}"`);
  }
}

export async function sendFindingNotifications(ctx: CoreContext, findingIds: string[]): Promise<{ sent: number; skipped?: string }> {
  const settings = await getSettings(ctx.db, ctx.config);
  const n = settings.notifications;
  if (!n.emailEnabled) return { sent: 0, skipped: 'email notifications disabled' };
  if (n.recipients.length === 0) return { sent: 0, skipped: 'no recipients configured' };
  if (findingIds.length === 0) return { sent: 0, skipped: 'no findings' };
  const rows = await ctx.db
    .select({
      id: findings.id,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
      file: findings.filePath,
      line: findings.line,
      repo: repositories.name,
      provider: providers.name,
    })
    .from(findings)
    .innerJoin(repositories, eq(repositories.id, findings.repositoryId))
    .innerJoin(providers, eq(providers.id, findings.providerId))
    .where(inArray(findings.id, findingIds));
  const relevant = rows.filter((r) => r.status === 'open' && SEVERITY_RANK[r.severity] >= SEVERITY_RANK[n.minSeverity]);
  if (relevant.length === 0) return { sent: 0, skipped: 'no findings at or above the minimum severity' };
  const body = [
    `Tracewise found ${relevant.length} new finding(s):`,
    '',
    ...relevant.map((r) => `- [${r.severity.toUpperCase()}] ${r.title} (${r.repo}: ${r.file}${r.line ? ':' + r.line : ''})`),
  ].join('\n');
  const transport = ctx.emailTransport ?? new LogEmailTransport(ctx.db, (m) => ctx.logger.info({}, m));
  for (const to of n.recipients)
    await transport.send({
      to,
      subject: `Tracewise: ${relevant.length} new API change finding(s)`,
      body,
      findingIds: relevant.map((r) => r.id),
    });
  return { sent: n.recipients.length };
}
