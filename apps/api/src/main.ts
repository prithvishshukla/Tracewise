import pino from 'pino';
import { loadConfig } from '@tracewise/config';
import { createRuntime } from '@tracewise/core';
import { buildApp } from './app';

const config = loadConfig();
const logger = pino({ level: config.logLevel, redact: ['req.headers.authorization'] });
const rt = createRuntime(config, logger);
const app = await buildApp(rt, { logger: { level: config.logLevel } });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await rt.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.api.host, port: config.api.port });
app.log.info(
  `Tracewise API on http://${config.api.host}:${config.api.port} (mode=${config.mode}, queue=${config.queueMode}); docs at /docs`,
);
