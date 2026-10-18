import { loadConfig } from '@tracewise/config';
import { consoleLogger, createRuntime, dashboardStats, seedDemo } from '@tracewise/core';

const config = { ...loadConfig(), queueMode: 'inline' as const }; // inline: finish everything before exiting
const rt = createRuntime(config, { ...consoleLogger, info: () => undefined });
try {
  const summary = await seedDemo(rt.ctx);
  const stats = await dashboardStats(rt.ctx.db, true);
  console.log('Demo data seeded.');
  console.log(`  providers: ${stats.providers}, repositories: ${stats.repositories}`);
  console.log(`  open findings: ${stats.openFindings} (critical: ${stats.criticalFindings}, verified: ${stats.verifiedFindings})`);
  console.log(`  repository id: ${summary.repositoryId}`);
  console.log('All change events and the sample repository are simulated demo data.');
} finally {
  await rt.close();
}
