import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanLimits, ScanWarning } from './types';

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** True when `child` equals or is nested inside `parent` (purely lexical; both must be absolute). */
export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(norm(path.resolve(parent)), norm(path.resolve(child)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Joins a repository-relative path onto `root`, rejecting NUL bytes, absolute paths and traversal. */
export function safeJoin(root: string, rel: string): string {
  if (rel.includes('\0')) throw new UnsafePathError('Path contains a NUL byte');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel)) throw new UnsafePathError('Absolute paths are not allowed');
  const joined = path.resolve(root, rel);
  if (!isPathInside(joined, root)) throw new UnsafePathError('Path escapes the repository root');
  return joined;
}

/**
 * Resolves a user-supplied local directory to its real path and verifies it lies inside one of the
 * allowed scan roots. Symlinks are resolved before the check, so a link cannot be used to escape.
 */
export async function resolveAllowedDirectory(input: string, allowedRoots: string[]): Promise<string> {
  if (input.includes('\0')) throw new UnsafePathError('Path contains a NUL byte');
  if (!path.isAbsolute(input)) throw new UnsafePathError('Local repository path must be absolute');
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new UnsafePathError('Directory does not exist or is not accessible');
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new UnsafePathError('Path is not a directory');
  const roots = await Promise.all(
    allowedRoots.map(async (r) => {
      try {
        return await fs.realpath(r);
      } catch {
        return path.resolve(r);
      }
    }),
  );
  if (!roots.some((r) => isPathInside(real, r))) {
    throw new UnsafePathError('Directory is outside the allowed scan roots (see SCAN_ROOTS)');
  }
  return real;
}

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  '.gradle',
  'bower_components',
  'site-packages',
  '.svelte-kit',
  '.parcel-cache',
]);

export const SOURCE_EXTENSIONS: Record<string, 'typescript' | 'javascript' | 'python'> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

export function isManifestName(name: string): boolean {
  return (
    ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pyproject.toml'].includes(name) ||
    /^requirements[\w.-]*\.txt$/.test(name)
  );
}

const GENERATED_SUFFIXES = ['.min.js', '.bundle.js', '.d.ts', '.d.mts', '.d.cts', '.map', '.generated.ts'];

export interface FileEntry {
  abs: string;
  rel: string;
  size: number;
  manifest: boolean;
  language?: 'typescript' | 'javascript' | 'python';
}

export interface WalkResult {
  entries: FileEntry[];
  skipped: Record<string, number>;
  filesVisited: number;
  truncated: boolean;
}

/**
 * Walks `root` without following symlinks, applying ignore rules and resource limits.
 * Never reads file contents; callers read the returned entries.
 */
export async function walkRepository(
  root: string,
  limits: ScanLimits,
  warn: (w: ScanWarning) => void,
  deadline: number,
): Promise<WalkResult> {
  const entries: FileEntry[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);
  let filesVisited = 0;
  let totalBytes = 0;
  let truncated = false;
  const MANIFEST_MAX = Math.max(limits.maxFileBytes, 5_000_000);

  async function visit(dir: string): Promise<void> {
    if (truncated) return;
    if (Date.now() > deadline) {
      truncated = true;
      warn({ message: 'Scan time limit reached; results are partial' });
      return;
    }
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      warn({ path: path.relative(root, dir) || '.', message: `Cannot read directory: ${(e as Error).message}` });
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (truncated) return;
      const abs = path.join(dir, d.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (d.isSymbolicLink()) {
        skip('symlink');
        continue;
      }
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name)) skip('ignored_directory');
        else await visit(abs);
        continue;
      }
      if (!d.isFile()) {
        skip('not_regular_file');
        continue;
      }
      filesVisited++;
      const manifest = isManifestName(d.name);
      const ext = path.extname(d.name).toLowerCase();
      const language = SOURCE_EXTENSIONS[ext];
      if (!manifest && !language) {
        skip('unsupported_type');
        continue;
      }
      if (!manifest && GENERATED_SUFFIXES.some((s) => d.name.endsWith(s))) {
        skip('generated_file');
        continue;
      }
      let size: number;
      try {
        size = (await fs.lstat(abs)).size;
      } catch {
        skip('unreadable');
        continue;
      }
      if (size > (manifest ? MANIFEST_MAX : limits.maxFileBytes)) {
        skip('too_large');
        warn({ path: rel, message: `Skipped: file is larger than the size limit (${size} bytes)` });
        continue;
      }
      if (entries.length >= limits.maxFiles || totalBytes + size > limits.maxTotalBytes) {
        truncated = true;
        warn({ message: 'File count or total size limit reached; results are partial' });
        return;
      }
      totalBytes += size;
      entries.push({ abs, rel, size, manifest, language });
    }
  }

  await visit(root);
  return { entries, skipped, filesVisited, truncated };
}

/** Reads a text file, rejecting binary content (NUL bytes in the first 1 KiB). */
export async function readTextFile(abs: string): Promise<string | null> {
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, 1024).includes(0)) return null;
  return buf.toString('utf8');
}
