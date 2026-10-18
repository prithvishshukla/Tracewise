import { createHash } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const fingerprintOf = (...parts: (string | number | null | undefined)[]) => sha256(parts.map((p) => String(p ?? '')).join('\u0000'));

/** JSON.stringify with sorted object keys so semantically equal documents hash identically. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
