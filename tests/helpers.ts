import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '@tracewise/config';
import { createHandlers, InlineDispatcher, silentLogger, type CoreContext, type Runtime } from '@tracewise/core';
import { NoopExtractionProvider } from '@tracewise/providers';
import { createTestDb } from '@tracewise/database/testing';

export const ROOT = path.resolve(__dirname, '..');
export const FIXTURES = path.join(ROOT, 'fixtures');

export interface TestRuntime extends Runtime {
  config: AppConfig;
  driver: 'postgres' | 'pglite';
  tempDirs: string[];
  tempRepo: (files: Record<string, string>) => Promise<string>;
}

/** Inline-queue runtime backed by PGlite (or TEST_DATABASE_URL). Temp repositories are created under an allowed scan root. */
export async function createTestRuntime(env: Record<string, string> = {}): Promise<TestRuntime> {
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tw-test-')));
  const cfg = loadConfig(
    {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      QUEUE_MODE: 'inline',
      FETCH_ALLOW_PRIVATE: 'true',
      SCAN_ROOTS: [path.join(FIXTURES, 'sample-repositories'), scratch].join(path.delimiter),
      ...env,
    } as NodeJS.ProcessEnv,
    { loadDotenv: false },
  );
  const handle = await createTestDb();
  const ctx: CoreContext = {
    db: handle.db,
    config: cfg,
    logger: silentLogger,
    extractor: new NoopExtractionProvider(),
    dispatcher: undefined as never,
  };
  ctx.dispatcher = new InlineDispatcher(() => createHandlers(ctx), handle.db, silentLogger);
  const tempDirs = [scratch];
  return {
    ctx,
    config: cfg,
    driver: handle.driver,
    tempDirs,
    close: async () => {
      await handle.close();
      await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    },
    tempRepo: async (files) => {
      const dir = await fs.mkdtemp(path.join(scratch, 'repo-'));
      for (const [rel, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), content);
      }
      return dir;
    },
  };
}
