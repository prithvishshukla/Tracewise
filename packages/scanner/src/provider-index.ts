import type { ProviderConfig, SdkBindingConfig } from '@tracewise/shared';

export interface BoundSdk extends SdkBindingConfig {
  providerSlug: string;
}

export interface ProviderIndex {
  /** "npm:stripe" / "pypi:openai" -> provider slug */
  packages: Map<string, string>;
  jsModules: Map<string, BoundSdk>;
  pyModules: BoundSdk[];
  hosts: { host: string; providerSlug: string }[];
  rootsByProvider: Map<string, string>;
}

export const normalizePyName = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');

export function buildProviderIndex(configs: ProviderConfig[]): ProviderIndex {
  const idx: ProviderIndex = {
    packages: new Map(),
    jsModules: new Map(),
    pyModules: [],
    hosts: [],
    rootsByProvider: new Map(),
  };
  for (const p of configs) {
    for (const pkg of p.packages) {
      idx.packages.set(`${pkg.ecosystem}:${pkg.ecosystem === 'pypi' ? normalizePyName(pkg.name) : pkg.name}`, p.slug);
    }
    for (const b of p.sdk.js) {
      for (const m of b.modules) idx.jsModules.set(m, { ...b, providerSlug: p.slug });
      if (!idx.rootsByProvider.has(p.slug)) idx.rootsByProvider.set(p.slug, b.root);
    }
    for (const b of p.sdk.python) {
      idx.pyModules.push({ ...b, providerSlug: p.slug });
      if (!idx.rootsByProvider.has(p.slug)) idx.rootsByProvider.set(p.slug, b.root);
    }
    for (const h of p.hosts) idx.hosts.push({ host: h.toLowerCase(), providerSlug: p.slug });
  }
  return idx;
}

export function providerForHost(idx: ProviderIndex, host: string): string | undefined {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return idx.hosts.find((x) => h === x.host || h.endsWith('.' + x.host))?.providerSlug;
}

/** "pkg/sub/path" -> "pkg"; "@scope/pkg/sub" -> "@scope/pkg". */
export function npmPackageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}
