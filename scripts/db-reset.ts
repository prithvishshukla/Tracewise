import { loadConfig } from '@tracewise/config';
import { resetDatabase } from '@tracewise/database';

const cfg = loadConfig();
if (cfg.mode === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to reset a database in production mode without --force');
  process.exit(1);
}
await resetDatabase(cfg.databaseUrl);
console.log('Database schema dropped and migrations re-applied. Run `npm run db:seed` to load demo data.');
