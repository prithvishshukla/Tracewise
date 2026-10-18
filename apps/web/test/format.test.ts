import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, pct, relativeTime } from '@/lib/format';

describe('format helpers', () => {
  const now = new Date('2026-10-10T12:00:00Z').getTime();
  it('relativeTime', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime('2026-10-10T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-10-10T11:30:00Z', now)).toBe('30 minutes ago');
    expect(relativeTime('2026-10-10T11:00:00Z', now)).toBe('1 hour ago');
    expect(relativeTime('2026-10-07T12:00:00Z', now)).toBe('3 days ago');
    expect(relativeTime('2026-10-12T12:00:00Z', now)).toBe('in 2 days');
  });
  it('formatDate handles nulls and invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('—');
    expect(formatDate('2026-12-01T00:00:00Z')).toBe('01 Dec 2026');
  });
  it('formatBytes and pct', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(pct(0.955)).toBe('96%');
  });
});
