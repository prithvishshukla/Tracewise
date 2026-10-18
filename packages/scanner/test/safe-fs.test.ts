import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside, resolveAllowedDirectory, safeJoin, UnsafePathError, walkRepository } from '../src';
import { tempRepo } from './helpers';

describe('path safety', () => {
  it('safeJoin rejects traversal, absolute paths and NUL bytes', () => {
    const root = path.resolve('/tmp/repo');
    expect(safeJoin(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'));
    expect(() => safeJoin(root, '../etc/passwd')).toThrow(UnsafePathError);
    expect(() => safeJoin(root, 'src/../../etc')).toThrow(UnsafePathError);
    expect(() => safeJoin(root, '/etc/passwd')).toThrow(UnsafePathError);
    expect(() => safeJoin(root, 'C:\\Windows\\system32')).toThrow(UnsafePathError);
    expect(() => safeJoin(root, 'a\0b')).toThrow(UnsafePathError);
  });

  it('isPathInside is not fooled by prefix siblings', () => {
    expect(isPathInside('/tmp/repo-evil/x', '/tmp/repo')).toBe(false);
    expect(isPathInside('/tmp/repo/x', '/tmp/repo')).toBe(true);
  });

  it('resolveAllowedDirectory enforces roots, absoluteness and symlink escapes', async () => {
    const allowed = await tempRepo({ 'ok/readme.txt': 'x' });
    const outside = await tempRepo({ 'secret/a.ts': 'x' });
    try {
      await expect(resolveAllowedDirectory(path.join(allowed.dir, 'ok'), [allowed.dir])).resolves.toContain('ok');
      await expect(resolveAllowedDirectory(outside.dir, [allowed.dir])).rejects.toThrow(/outside the allowed/);
      await expect(resolveAllowedDirectory('relative/path', [allowed.dir])).rejects.toThrow(/absolute/);
      await expect(resolveAllowedDirectory(path.join(allowed.dir, 'missing'), [allowed.dir])).rejects.toThrow(/does not exist/);
      await expect(resolveAllowedDirectory(path.join(allowed.dir, 'ok', 'readme.txt'), [allowed.dir])).rejects.toThrow(/not a directory/);
      const link = path.join(allowed.dir, 'escape');
      await fs.symlink(outside.dir, link);
      await expect(resolveAllowedDirectory(link, [allowed.dir])).rejects.toThrow(/outside the allowed/);
    } finally {
      await allowed.cleanup();
      await outside.cleanup();
    }
  });
});

describe('walkRepository', () => {
  const limits = { maxFiles: 100, maxFileBytes: 1000, maxTotalBytes: 100_000, timeoutMs: 10_000 };

  it('ignores vendor/build dirs, symlinks, unsupported and generated files', async () => {
    const r = await tempRepo({
      'src/a.ts': 'export {}',
      'src/b.min.js': 'x',
      'src/types.d.ts': 'x',
      'node_modules/pkg/index.js': 'x',
      'dist/out.js': 'x',
      '.git/config': 'x',
      'docs/readme.md': 'x',
      'package.json': '{}',
    });
    const outside = await tempRepo({ 'leak.ts': 'export {}' });
    try {
      await fs.symlink(outside.dir, path.join(r.dir, 'linked'));
      await fs.symlink(path.join(outside.dir, 'leak.ts'), path.join(r.dir, 'src', 'leak.ts'));
      const w = await walkRepository(r.dir, limits, () => undefined, Date.now() + 5000);
      expect(w.entries.map((e) => e.rel).sort()).toEqual(['package.json', 'src/a.ts']);
      expect(w.skipped.symlink).toBe(2);
      expect(w.skipped.ignored_directory).toBe(3);
      expect(w.skipped.generated_file).toBe(2);
      expect(w.skipped.unsupported_type).toBe(1);
    } finally {
      await r.cleanup();
      await outside.cleanup();
    }
  });

  it('enforces file size, file count and total byte limits', async () => {
    const r = await tempRepo({ 'big.ts': 'x'.repeat(2000), 'a.ts': 'x', 'b.ts': 'x', 'c.ts': 'x' });
    try {
      const warnings: string[] = [];
      const w = await walkRepository(r.dir, { ...limits, maxFiles: 2 }, (x) => warnings.push(x.message), Date.now() + 5000);
      expect(w.entries).toHaveLength(2);
      expect(w.truncated).toBe(true);
      expect(w.skipped.too_large).toBe(1);
      expect(warnings.some((m) => /limit reached/.test(m))).toBe(true);
    } finally {
      await r.cleanup();
    }
  });

  it('stops when the deadline has passed', async () => {
    const r = await tempRepo({ 'a.ts': 'x' });
    try {
      const w = await walkRepository(r.dir, limits, () => undefined, Date.now() - 1);
      expect(w.truncated).toBe(true);
      expect(w.entries).toHaveLength(0);
    } finally {
      await r.cleanup();
    }
  });
});
