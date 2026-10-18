import type { CoreContext } from './context';
import type { JobHandlers } from './dispatcher';
import { generateFindings } from './findings';
import { pollSource, processSnapshot } from './monitoring';
import { sendFindingNotifications } from './notifications';
import { runScan } from './repositories';

/** The business logic behind each queue. Used by the BullMQ worker and by the inline dispatcher. */
export function createHandlers(ctx: CoreContext): JobHandlers {
  return {
    'repository-scan': async ({ scanId }) => runScan(ctx, scanId),
    'provider-poll': async ({ sourceId }) => ({ ...(await pollSource(ctx, sourceId)) }),
    'change-processing': async ({ snapshotId }) => ({ ...(await processSnapshot(ctx, snapshotId)) }),
    'finding-generation': async (p) => ({ ...(await generateFindings(ctx, p)) }),
    notifications: async ({ findingIds }) => ({ ...(await sendFindingNotifications(ctx, findingIds)) }),
  };
}
