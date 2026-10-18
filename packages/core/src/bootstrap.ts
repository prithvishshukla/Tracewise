import type { AppConfig } from '@tracewise/config';
import { createDb } from '@tracewise/database';
import { NoopExtractionProvider, OpenAICompatibleExtractionProvider } from '@tracewise/providers';
import type { CoreContext, Logger } from './context';
import { BullDispatcher, createRedisConnection, InlineDispatcher, type JobDispatcher } from './dispatcher';
import { createHandlers } from './handlers';

export interface Runtime {
  ctx: CoreContext;
  close: () => Promise<void>;
  redis?: ReturnType<typeof createRedisConnection>;
}

/** Wires database, queue dispatcher and optional integrations from configuration. */
export function createRuntime(config: AppConfig, logger: Logger): Runtime {
  const handle = createDb(config.databaseUrl);
  const extractor =
    config.llm.provider === 'openai_compatible' && config.llm.apiKey
      ? new OpenAICompatibleExtractionProvider({ baseUrl: config.llm.baseUrl, apiKey: config.llm.apiKey, model: config.llm.model })
      : new NoopExtractionProvider();
  const ctx: CoreContext = { db: handle.db, config, logger, extractor, dispatcher: undefined as unknown as JobDispatcher };
  let dispatcher: JobDispatcher;
  let redis: Runtime['redis'];
  if (config.queueMode === 'inline') {
    dispatcher = new InlineDispatcher(() => createHandlers(ctx), handle.db, logger);
  } else {
    redis = createRedisConnection(config.redisUrl);
    redis.on('error', (e) => logger.warn({ err: e.message }, 'redis connection error'));
    dispatcher = new BullDispatcher(redis, handle.db);
  }
  ctx.dispatcher = dispatcher;
  return {
    ctx,
    redis,
    close: async () => {
      await dispatcher.close();
      await redis?.quit().catch(() => undefined);
      await handle.close();
    },
  };
}
