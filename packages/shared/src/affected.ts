import { z } from 'zod';
import { ECOSYSTEMS } from './enums';

/** What an upstream change affects. The matcher consumes these. */
export const AffectedItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sdk_symbol'),
    /** Canonical dotted symbol, e.g. "stripe.charges.create" (JS) or "openai.ChatCompletion.create" (Python). */
    symbol: z.string().min(3),
    ecosystem: z.enum(ECOSYSTEMS).optional(),
  }),
  z.object({
    kind: z.literal('endpoint'),
    method: z.string().optional(),
    /** Path template; {param}, :param and * segments are wildcards. */
    path: z.string().startsWith('/'),
    host: z.string().optional(),
  }),
  z.object({
    kind: z.literal('package_version'),
    ecosystem: z.enum(ECOSYSTEMS),
    package: z.string(),
    /** semver range (npm) or the same range syntax applied to PEP 440 versions on a best-effort basis. */
    range: z.string(),
  }),
  z.object({
    kind: z.literal('pattern'),
    pattern: z.string().min(3),
    note: z.string().optional(),
  }),
]);
export type AffectedItem = z.infer<typeof AffectedItemSchema>;

export const EvidenceSchema = z.object({
  type: z.enum(['source_quote', 'code', 'import', 'dependency', 'manifest', 'openapi_diff', 'note']),
  label: z.string(),
  detail: z.string().optional(),
  url: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export function affectedLabel(a: AffectedItem): string {
  switch (a.kind) {
    case 'sdk_symbol':
      return a.symbol;
    case 'endpoint':
      return `${a.method ? a.method.toUpperCase() + ' ' : ''}${a.host ?? ''}${a.path}`;
    case 'package_version':
      return `${a.package}@${a.range}`;
    case 'pattern':
      return `/${a.pattern}/`;
  }
}
