import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import semver from 'semver';
import type { Ecosystem } from '@tracewise/shared';
import { normalizePyName, type ProviderIndex } from './provider-index';
import type { DetectedDependency, ScanWarning } from './types';

type Out = DetectedDependency[];

function lineOf(text: string, needle: RegExp): number | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (needle.test(lines[i] ?? '')) return i + 1;
  return null;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function push(
  out: Out,
  idx: ProviderIndex,
  eco: Ecosystem,
  name: string,
  data: Omit<DetectedDependency, 'packageName' | 'ecosystem' | 'providerSlug'>,
) {
  const key = `${eco}:${eco === 'pypi' ? normalizePyName(name) : name}`;
  const providerSlug = idx.packages.get(key);
  if (!providerSlug) return;
  out.push({ packageName: name, ecosystem: eco, providerSlug, ...data });
}

/** Extracts a concrete version from a range when it is a plain pin ("1.2.3", "=1.2.3", "~1.2.3" -> min version). */
export function minVersionOf(spec: string | null): string | null {
  if (!spec) return null;
  try {
    return semver.minVersion(spec)?.version ?? null;
  } catch {
    return null;
  }
}

export function parsePackageJson(text: string, path: string, idx: ProviderIndex, warn: (w: ScanWarning) => void): Out {
  const out: Out = [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    warn({ path, message: `Malformed package.json: ${(e as Error).message}` });
    return out;
  }
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = json[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      push(out, idx, 'npm', name, {
        versionSpec: spec,
        resolvedVersion: /^\d+\.\d+\.\d+/.test(spec) ? spec : null,
        manifestPath: path,
        manifestLine: lineOf(text, new RegExp(`"${esc(name)}"\\s*:`)),
        source: 'manifest',
        confidence: 0.95,
      });
    }
  }
  return out;
}

export function parsePackageLock(text: string, path: string, idx: ProviderIndex, warn: (w: ScanWarning) => void): Out {
  const out: Out = [];
  let json: { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
  try {
    json = JSON.parse(text);
  } catch (e) {
    warn({ path, message: `Malformed package-lock.json: ${(e as Error).message}` });
    return out;
  }
  const seen = new Set<string>();
  const add = (name: string, version?: string) => {
    if (!version || seen.has(name)) return;
    seen.add(name);
    push(out, idx, 'npm', name, {
      versionSpec: null,
      resolvedVersion: version,
      manifestPath: path,
      manifestLine: lineOf(text, new RegExp(`"(node_modules/)?${esc(name)}"\\s*:`)),
      source: 'lockfile',
      confidence: 0.99,
    });
  };
  for (const [key, v] of Object.entries(json.packages ?? {})) {
    const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (m?.[1]) add(m[1], v.version);
  }
  for (const [name, v] of Object.entries(json.dependencies ?? {})) add(name, v.version);
  return out;
}

export function parsePnpmLock(text: string, path: string, idx: ProviderIndex, warn: (w: ScanWarning) => void): Out {
  const out: Out = [];
  let doc: any;
  try {
    doc = parseYaml(text);
  } catch (e) {
    warn({ path, message: `Malformed pnpm-lock.yaml: ${(e as Error).message}` });
    return out;
  }
  const seen = new Set<string>();
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\(.*$/, '') : undefined);
  const consume = (deps: Record<string, any> | undefined) => {
    for (const [name, v] of Object.entries(deps ?? {})) {
      const version = clean(typeof v === 'string' ? v : v?.version);
      if (!version || seen.has(name)) continue;
      seen.add(name);
      push(out, idx, 'npm', name, {
        versionSpec: typeof v === 'object' ? (v?.specifier ?? null) : null,
        resolvedVersion: version,
        manifestPath: path,
        manifestLine: lineOf(text, new RegExp(`^\\s*'?${esc(name)}'?:`)),
        source: 'lockfile',
        confidence: 0.99,
      });
    }
  };
  for (const imp of Object.values<any>(doc?.importers ?? {})) {
    consume(imp?.dependencies);
    consume(imp?.devDependencies);
  }
  consume(doc?.dependencies);
  consume(doc?.devDependencies);
  if (out.length === 0) {
    for (const key of Object.keys(doc?.packages ?? {})) {
      const m = /^\/?((?:@[^/@]+\/)?[^/@]+)[@/](\d[^()_/\s]*)/.exec(key);
      if (m?.[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        push(out, idx, 'npm', m[1], {
          versionSpec: null,
          resolvedVersion: m[2] ?? null,
          manifestPath: path,
          manifestLine: null,
          source: 'lockfile',
          confidence: 0.9,
        });
      }
    }
  }
  return out;
}

export function parseYarnLock(text: string, path: string, idx: ProviderIndex): Out {
  const out: Out = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line || line.startsWith(' ') || line.startsWith('#') || !line.trimEnd().endsWith(':')) continue;
    const specs = line
      .trimEnd()
      .slice(0, -1)
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''));
    const names = specs.map((s) => s.slice(0, s.lastIndexOf('@')).replace(/@npm$/, '')).filter(Boolean);
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const m = /^\s+version:?\s+"?([^"\s]+)"?/.exec(lines[j] ?? '');
      if (m?.[1]) {
        for (const name of names) {
          if (seen.has(name)) continue;
          seen.add(name);
          push(out, idx, 'npm', name, {
            versionSpec: null,
            resolvedVersion: m[1],
            manifestPath: path,
            manifestLine: i + 1,
            source: 'lockfile',
            confidence: 0.99,
          });
        }
        break;
      }
    }
  }
  return out;
}

const REQ_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/;

function parsePep508(entry: string): { name: string; spec: string | null; pinned: string | null } | null {
  const cleaned = entry.split(';')[0]?.split('#')[0]?.trim() ?? '';
  const m = REQ_RE.exec(cleaned);
  if (!m?.[1]) return null;
  const spec = m[3]?.replace(/\s+/g, '') || null;
  const pin = spec ? /^===?([0-9][\w.!+-]*)$/.exec(spec) : null;
  return { name: m[1], spec, pinned: pin?.[1] ?? null };
}

export function parseRequirements(text: string, path: string, idx: ProviderIndex): Out {
  const out: Out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || /^(https?|git\+)/.test(line)) return;
    const dep = parsePep508(line);
    if (!dep) return;
    push(out, idx, 'pypi', dep.name, {
      versionSpec: dep.spec,
      resolvedVersion: dep.pinned,
      manifestPath: path,
      manifestLine: i + 1,
      source: 'manifest',
      confidence: 0.95,
    });
  });
  return out;
}

export function parsePyproject(text: string, path: string, idx: ProviderIndex, warn: (w: ScanWarning) => void): Out {
  const out: Out = [];
  let doc: any;
  try {
    doc = parseToml(text);
  } catch (e) {
    warn({ path, message: `Malformed pyproject.toml: ${(e as Error).message}` });
    return out;
  }
  const entries: string[] = [...(doc?.project?.dependencies ?? [])];
  for (const group of Object.values<any>(doc?.project?.['optional-dependencies'] ?? {})) entries.push(...group);
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const dep = parsePep508(entry);
    if (!dep) continue;
    push(out, idx, 'pypi', dep.name, {
      versionSpec: dep.spec,
      resolvedVersion: dep.pinned,
      manifestPath: path,
      manifestLine: lineOf(text, new RegExp(`['"]${esc(dep.name)}`, 'i')),
      source: 'manifest',
      confidence: 0.95,
    });
  }
  const poetry: Record<string, any>[] = [doc?.tool?.poetry?.dependencies ?? {}];
  for (const g of Object.values<any>(doc?.tool?.poetry?.group ?? {})) poetry.push(g?.dependencies ?? {});
  for (const table of poetry) {
    for (const [name, v] of Object.entries<any>(table)) {
      const spec = typeof v === 'string' ? v : (v?.version ?? null);
      push(out, idx, 'pypi', name, {
        versionSpec: spec,
        resolvedVersion: spec && /^\d/.test(spec) && !/[<>=^~*,]/.test(spec) ? spec : null,
        manifestPath: path,
        manifestLine: lineOf(text, new RegExp(`^\\s*${esc(name)}\\s*=`, 'i')),
        source: 'manifest',
        confidence: 0.95,
      });
    }
  }
  return out;
}

export function detectDependencies(
  fileName: string,
  relPath: string,
  text: string,
  idx: ProviderIndex,
  warn: (w: ScanWarning) => void,
): Out {
  switch (true) {
    case fileName === 'package.json':
      return parsePackageJson(text, relPath, idx, warn);
    case fileName === 'package-lock.json':
      return parsePackageLock(text, relPath, idx, warn);
    case fileName === 'pnpm-lock.yaml':
      return parsePnpmLock(text, relPath, idx, warn);
    case fileName === 'yarn.lock':
      return parseYarnLock(text, relPath, idx);
    case fileName === 'pyproject.toml':
      return parsePyproject(text, relPath, idx, warn);
    case /^requirements[\w.-]*\.txt$/.test(fileName):
      return parseRequirements(text, relPath, idx);
    default:
      return [];
  }
}
