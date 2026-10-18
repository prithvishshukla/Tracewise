import { z } from 'zod';
import { CHANGE_TYPES, FINDING_STATUSES, SEVERITIES } from './enums';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ChangesQuery = PaginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(100).optional(),
  severity: z.enum(SEVERITIES).optional(),
  changeType: z.enum(CHANGE_TYPES).optional(),
  origin: z.enum(['demo', 'live']).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export const FindingsQuery = PaginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(100).optional(),
  repositoryId: z.string().uuid().optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  impact: z.enum(['verified', 'possible']).optional(),
  sort: z.enum(['severity', 'newest']).default('severity'),
});

export const IdParam = z.object({ id: z.string().min(1).max(100) });

export const RepositoryCreateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sourceType: z.enum(['local', 'git']),
  /** Absolute path under an allowed scan root, or an https Git URL on an allowed host. */
  location: z.string().trim().min(1).max(1000),
});

export const FindingPatchBody = z
  .object({
    status: z.enum(FINDING_STATUSES),
    note: z.string().trim().max(500).optional(),
    snoozeDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export const SettingsBody = z.object({
  monitoring: z
    .object({
      livePollingEnabled: z.boolean(),
      pollIntervalMinutes: z.number().int().min(15).max(10080),
    })
    .optional(),
  notifications: z
    .object({
      emailEnabled: z.boolean(),
      recipients: z.array(z.string().email()).max(20),
      minSeverity: z.enum(SEVERITIES),
    })
    .optional(),
});
export type SettingsInput = z.infer<typeof SettingsBody>;

export const DEFAULT_SETTINGS = {
  monitoring: { livePollingEnabled: false, pollIntervalMinutes: 360 },
  notifications: { emailEnabled: false, recipients: [] as string[], minSeverity: 'high' as const },
};
