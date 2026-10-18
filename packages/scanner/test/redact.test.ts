import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src';

describe('redactSecrets', () => {
  const cases: [string, string][] = [
    ['const k = "sk_live_FAKEKEYFORDEMO000000000";', 'stripe_key'],
    ['key sk_test_FAKEKEYFORDEMO000000000', 'stripe_key'],
    ['OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'openai_key'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'aws_key'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_token'],
    ['xoxb-1234567890-abcdefghij', 'slack_token'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'jwt'],
    ['https://user:hunter2pass@example.com/path', 'credentials'],
    ['api_key = "abcdef123456789"', 'secret'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', 'private_key'],
  ];
  it.each(cases)('redacts %s', (input, label) => {
    const out = redactSecrets(input);
    expect(out).toContain(`[REDACTED:${label}]`);
    expect(out).not.toMatch(/FAKEKEY|IOSFODNN7|abcdefghijklmnopqrstuvwxyz0123|hunter2pass|abcdef123456789|MIIabc/);
  });

  it('leaves ordinary code untouched', () => {
    const code = 'const total = items.reduce((a, b) => a + b.price, 0);\nconsole.log("token count", n);';
    expect(redactSecrets(code)).toBe(code);
  });
});
