import type { AppConfig } from '@tracewise/config';
import type { Db } from '@tracewise/database';
import type { ExtractionProvider } from '@tracewise/providers';
import type { JobDispatcher } from './dispatcher';
import type { EmailTransport } from './notifications';

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
}

export const consoleLogger: Logger = {
  info: (o, m) => console.log('[info]', m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
  warn: (o, m) => console.warn('[warn]', m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
  error: (o, m) => console.error('[error]', m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
  debug: () => undefined,
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

export interface CoreContext {
  db: Db;
  config: AppConfig;
  dispatcher: JobDispatcher;
  logger: Logger;
  extractor?: ExtractionProvider;
  emailTransport?: EmailTransport;
}
