import { auditEvents, type Db } from '@tracewise/database';

export async function audit(
  db: Db,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
  actor = 'demo-user',
): Promise<void> {
  await db.insert(auditEvents).values({ actor, action, entityType, entityId, metadata });
}
