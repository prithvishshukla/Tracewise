import { loadConfig } from '@tracewise/config';
import { runMigrations } from '@tracewise/database';

const cfg = loadConfig();
await runMigrations(cfg.databaseUrl);
console.log('Migrations applied to', cfg.databaseUrl.replace(/:[^:@/]+@/, ':****@'));
