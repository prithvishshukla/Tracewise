import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROVIDER_CATALOG } from '@tracewise/providers';
import { buildProviderIndex } from '../src';

export const idx = buildProviderIndex(PROVIDER_CATALOG);

export async function tempRepo(files: Record<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return { dir: await fs.realpath(dir), cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
