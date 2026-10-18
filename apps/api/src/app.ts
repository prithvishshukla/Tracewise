import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { AppError, type Runtime } from '@tracewise/core';
import { registerRoutes } from './routes';

export interface BuildOptions {
  logger?: boolean | { level: string };
  /** Disables the global rate limiter (tests). */
  disableRateLimit?: boolean;
}

function tokenOk(header: string | undefined, expected: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function buildApp(rt: Runtime, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { config } = rt.ctx;
  const app = Fastify({
    logger: opts.logger === undefined ? { level: config.logLevel } : opts.logger,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
    bodyLimit: 256 * 1024,
    disableRequestLogging: config.nodeEnv === 'test',
  });
  // Validation is done with zod inside route(); Fastify's own validator is bypassed so documentation schemas are not enforced twice.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  await app.register(cors, { origin: [config.api.webOrigin], methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'] });
  if (!opts.disableRateLimit) await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Tracewise API',
        version: '0.1.0',
        description: 'Repository-aware API change impact analysis. In production mode all /api routes require a Bearer token.',
      },
      tags: ['system', 'providers', 'changes', 'repositories', 'findings', 'settings', 'dashboard'].map((name) => ({ name })),
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onRequest', async (req) => {
    if (config.mode !== 'production') return;
    if (!req.url.startsWith('/api')) return;
    if (!config.api.token || !tokenOk(req.headers.authorization, config.api.token))
      throw new AppError('unavailable', 'Missing or invalid API token', 401);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url.split('?')[0]} not found` } });
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.status)
        .send({ error: { code: err.status === 401 ? 'unauthorized' : err.code, message: err.message, details: err.details } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const exposeMessage = status < 500 || config.mode !== 'production';
    const code = status === 429 ? 'rate_limited' : status === 413 ? 'payload_too_large' : status < 500 ? 'bad_request' : 'internal_error';
    return reply.code(status).send({ error: { code, message: exposeMessage ? err.message : 'Internal server error' } });
  });

  registerRoutes(app, rt);

  app.get('/health', { schema: { tags: ['system'], summary: 'Liveness and dependency check' } }, async (_req, reply) => {
    let db = false;
    let redis: boolean | null = null;
    try {
      await rt.ctx.db.execute(sql`select 1`);
      db = true;
    } catch {
      db = false;
    }
    if (rt.redis)
      redis = await rt.redis
        .ping()
        .then(() => true)
        .catch(() => false);
    const ok = db && redis !== false;
    return reply
      .code(ok ? 200 : 503)
      .send({ status: ok ? 'ok' : 'degraded', time: new Date().toISOString(), database: db, redis, mode: config.mode });
  });
  return app;
}
