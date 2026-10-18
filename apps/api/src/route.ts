import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';

type Schemas = { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
type Parsed<S extends Schemas> = {
  params: S['params'] extends z.ZodType ? z.infer<S['params']> : undefined;
  query: S['query'] extends z.ZodType ? z.infer<S['query']> : undefined;
  body: S['body'] extends z.ZodType ? z.infer<S['body']> : undefined;
};

const toJson = (s: z.ZodType) => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
};

export interface RouteDef<S extends Schemas> {
  method: HTTPMethods;
  url: string;
  tag: string;
  summary: string;
  schemas?: S;
  status?: number;
  /** Stricter per-route rate limit for sensitive endpoints. */
  rateLimit?: { max: number; timeWindow: string };
  handler: (args: Parsed<S> & { req: FastifyRequest; reply: FastifyReply }) => Promise<unknown>;
}

/**
 * Registers a route whose input is validated with zod (errors become the consistent 400 response)
 * and whose OpenAPI documentation is derived from the same zod schemas.
 */
export function route<S extends Schemas>(app: FastifyInstance, def: RouteDef<S>): void {
  const docs: Record<string, unknown> = { tags: [def.tag], summary: def.summary };
  if (def.schemas?.params) docs.params = toJson(def.schemas.params);
  if (def.schemas?.query) docs.querystring = toJson(def.schemas.query);
  if (def.schemas?.body) docs.body = toJson(def.schemas.body);
  app.route({
    method: def.method,
    url: def.url,
    schema: docs,
    config: def.rateLimit ? { rateLimit: def.rateLimit } : undefined,
    handler: async (req, reply) => {
      const s: Schemas = def.schemas ?? {};
      const parsed = {
        params: s.params ? s.params.parse(req.params) : undefined,
        query: s.query ? s.query.parse(req.query) : undefined,
        body: s.body ? s.body.parse(req.body) : undefined,
      } as Parsed<S>;
      if (def.status) reply.code(def.status);
      return def.handler({ ...parsed, req, reply });
    },
  });
}
