import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderConfig } from '@tracewise/shared';
import { analyzeJavaScript } from './analyzers/javascript';
import { analyzePython, pythonParserAvailable } from './analyzers/python';
import { detectDependencies } from './dependencies';
import { buildProviderIndex } from './provider-index';
import { redactSecrets } from './redact';
import { readTextFile, walkRepository } from './safe-fs';
import {
  DEFAULT_LIMITS,
  type DetectedCallSite,
  type DetectedDependency,
  type ScanLimits,
  type ScanResult,
  type ScanWarning,
  type ScannedFile,
} from './types';

export interface ScanOptions {
  /** Real, already-validated absolute directory. Use resolveAllowedDirectory() first for user input. */
  rootDir: string;
  providers: ProviderConfig[];
  limits?: Partial<ScanLimits>;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Scans a repository directory. Reads files only; never executes repository code.
 * Per-file failures become warnings so one malformed file cannot abort the scan.
 */
export async function scanRepository(opts: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const root = await fs.realpath(opts.rootDir);
  const idx = buildProviderIndex(opts.providers);
  const warnings: ScanWarning[] = [];
  const warn = (w: ScanWarning) => warnings.push({ ...w, message: redactSecrets(w.message) });

  const walk = await walkRepository(root, limits, warn, started + limits.timeoutMs);
  const files: ScannedFile[] = [];
  const dependencies: DetectedDependency[] = [];
  const callSites: DetectedCallSite[] = [];
  let bytesRead = 0;
  let pythonMethod: 'tree_sitter' | 'regex_fallback' | 'none' = 'none';
  let pyTried = false;

  for (const entry of walk.entries) {
    if (Date.now() - started > limits.timeoutMs) {
      warn({ message: 'Scan time limit reached; results are partial' });
      walk.truncated = true;
      break;
    }
    let text: string | null;
    try {
      text = await readTextFile(entry.abs);
    } catch (e) {
      warn({ path: entry.rel, message: `Unreadable file: ${(e as Error).message}` });
      continue;
    }
    if (text === null) {
      walk.skipped['binary'] = (walk.skipped['binary'] ?? 0) + 1;
      continue;
    }
    if (!entry.manifest && /@generated|Code generated .* DO NOT EDIT/.test(text.slice(0, 300))) {
      walk.skipped['generated_file'] = (walk.skipped['generated_file'] ?? 0) + 1;
      continue;
    }
    bytesRead += entry.size;
    const hash = sha256(text);
    const name = path.posix.basename(entry.rel);
    try {
      if (entry.manifest) {
        files.push({ path: entry.rel, language: 'manifest', sizeBytes: entry.size, sha256: hash });
        dependencies.push(...detectDependencies(name, entry.rel, text, idx, warn));
      } else if (entry.language === 'python') {
        if (!pyTried) {
          pyTried = true;
          pythonMethod = (await pythonParserAvailable()) ? 'tree_sitter' : 'regex_fallback';
        }
        files.push({ path: entry.rel, language: 'python', sizeBytes: entry.size, sha256: hash });
        callSites.push(...(await analyzePython(text, entry.rel, hash, idx)).callSites);
      } else if (entry.language) {
        files.push({ path: entry.rel, language: entry.language, sizeBytes: entry.size, sha256: hash });
        callSites.push(...analyzeJavaScript(text, entry.rel, hash, idx).callSites);
      }
    } catch (e) {
      warn({ path: entry.rel, message: `Analysis failed: ${(e as Error).message}` });
    }
  }

  return {
    files,
    dependencies,
    callSites,
    warnings,
    stats: {
      filesVisited: walk.filesVisited,
      filesIndexed: files.length,
      skipped: walk.skipped,
      bytesRead,
      durationMs: Date.now() - started,
      truncated: walk.truncated,
      pythonParser: pythonMethod,
    },
  };
}
