import { z } from 'zod';
import { ECOSYSTEMS, ORIGINS, SOURCE_KINDS } from './enums';

const SdkBinding = z.object({
  /** Package/module names that expose the SDK (npm package names or Python module prefixes). */
  modules: z.array(z.string()).min(1),
  /** Canonical symbol root used in change fixtures, e.g. "stripe". */
  root: z.string(),
  /** Exported names that construct a client (named imports / Python classes). Default/namespace imports always count. */
  factories: z.array(z.string()).default([]),
});

export const ProviderConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  docsUrl: z.string().url(),
  description: z.string(),
  packages: z.array(z.object({ ecosystem: z.enum(ECOSYSTEMS), name: z.string() })),
  /** Hostnames of the provider's HTTP API, used for raw-HTTP detection and endpoint matching. */
  hosts: z.array(z.string()),
  sdk: z.object({ js: z.array(SdkBinding).default([]), python: z.array(SdkBinding).default([]) }),
  sources: z.array(
    z.object({
      kind: z.enum(SOURCE_KINDS),
      url: z.string(),
      label: z.string(),
      origin: z.enum(ORIGINS),
      enabled: z.boolean().default(true),
    }),
  ),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type SdkBindingConfig = z.infer<typeof SdkBinding>;
