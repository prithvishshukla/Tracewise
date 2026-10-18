import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { assertPublicHostname } from '@tracewise/config';

export class UnsafeGitUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeGitUrlError';
  }
}

/** Validates a Git URL: https only, no credentials, allow-listed host, default port, simple owner/repo path. */
export function parseGitUrl(input: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeGitUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeGitUrlError('Only https:// Git URLs are supported');
  if (url.username || url.password) throw new UnsafeGitUrlError('URLs with embedded credentials are not allowed');
  if (url.port && url.port !== '443') throw new UnsafeGitUrlError('Custom ports are not allowed');
  const host = url.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) throw new UnsafeGitUrlError('IP address hosts are not allowed');
  if (!allowedHosts.includes(host)) throw new UnsafeGitUrlError(`Host ${host} is not in GIT_ALLOWED_HOSTS`);
  if (!/^\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url.pathname)) throw new UnsafeGitUrlError('Expected a /owner/repository path');
  if (url.search || url.hash) throw new UnsafeGitUrlError('Query strings and fragments are not allowed');
  return url;
}

/** Minimal environment for git: only what it needs to run, never application secrets. */
function gitEnv(home: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'LANG'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, HOME: home, USERPROFILE: home, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: 'echo' };
}

export interface CloneResult {
  dir: string;
  cleanup: () => Promise<void>;
}

/** Shallow, restricted clone into a temp directory. Caller must call cleanup(). Requires git on PATH. */
export async function cloneRepository(
  input: string,
  opts: { allowedHosts: string[]; timeoutMs?: number; maxBytes?: number },
): Promise<CloneResult> {
  const url = parseGitUrl(input, opts.allowedHosts);
  await assertPublicHostname(url.hostname);
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'tracewise-clone-'));
  const dir = path.join(base, 'repo');
  const cleanup = () => fs.rm(base, { recursive: true, force: true });
  const args = [
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'http.followRedirects=false',
    '-c',
    'core.symlinks=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'credential.helper=',
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--no-tags',
    '--no-recurse-submodules',
    '--template=',
    '--',
    url.toString(),
    dir,
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          timeout: opts.timeoutMs ?? 120_000,
          env: gitEnv(base),
          maxBuffer: 1024 * 1024,
        },
        (err, _out, stderr) => (err ? reject(new Error(`git clone failed: ${stderr.slice(0, 300) || err.message}`)) : resolve()),
      );
    });
    await fs.rm(path.join(dir, '.git'), { recursive: true, force: true });
    if (opts.maxBytes) {
      let total = 0;
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop() as string;
        for (const e of await fs.readdir(d, { withFileTypes: true })) {
          if (e.isSymbolicLink()) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) stack.push(p);
          else if (e.isFile()) {
            total += (await fs.lstat(p)).size;
            if (total > opts.maxBytes) throw new Error('Repository exceeds the maximum allowed size');
          }
        }
      }
    }
    return { dir, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
