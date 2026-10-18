import pino from 'pino';
import { loadConfig } from '@tracewise/config';
import { createRuntime } from '@tracewise/core';
import { schedulePolling, startWorkers } from './workers';

const config = { ...loadConfig(), queueMode: 'bullmq' as const };
const logger = pino({ level: config.logLevel });
const rt = createRuntime(config, logger);
const handle = startWorkers(rt);
const scheduled = await schedulePolling(rt);
logger.info(
  `Tracewise worker started: ${handle.workers.length} queues, ${scheduled} live sources scheduled (live polling is ${config.monitoring.livePollingEnabled ? 'enabled' : 'disabled until enabled in Settings or ENABLE_LIVE_POLLING=true'})`,
);

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'graceful shutdown: waiting for active jobs');
  await handle.close();
  await rt.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
