import { appSettings, type Db } from '@tracewise/database';
import type { AppConfig } from '@tracewise/config';
import { DEFAULT_SETTINGS, type SettingsInput } from '@tracewise/shared';

export type EffectiveSettings = {
  monitoring: { livePollingEnabled: boolean; pollIntervalMinutes: number };
  notifications: { emailEnabled: boolean; recipients: string[]; minSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info' };
};

export async function getSettings(db: Db, config: AppConfig): Promise<EffectiveSettings> {
  const rows = await db.select().from(appSettings);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    monitoring: {
      livePollingEnabled: config.monitoring.livePollingEnabled,
      pollIntervalMinutes: config.monitoring.pollIntervalMinutes,
      ...(byKey.monitoring as object | undefined),
    },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(byKey.notifications as object | undefined) },
  };
}

export async function updateSettings(db: Db, config: AppConfig, input: SettingsInput): Promise<EffectiveSettings> {
  for (const key of ['monitoring', 'notifications'] as const) {
    const value = input[key];
    if (!value) continue;
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  return getSettings(db, config);
}
