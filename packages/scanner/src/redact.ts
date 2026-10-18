/** Redacts likely credentials from text before it is stored or logged. Pattern-based; not a guarantee. */
const RULES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED:private_key]'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[REDACTED:stripe_key]'],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, '[REDACTED:webhook_secret]'],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED:openai_key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws_key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[REDACTED:github_token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, '[REDACTED:github_token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack_token]'],
  [/\bSK[0-9a-f]{32}\b/g, '[REDACTED:twilio_key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED:jwt]'],
  [/(https?:\/\/)[^\s/:@'"]+:[^\s/@'"]+@/g, '$1[REDACTED:credentials]@'],
  [
    /((?:api[_-]?key|secret|token|passw(?:or)?d|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'])([^"'\n]{8,})(["'])/gi,
    '$1[REDACTED:secret]$3',
  ],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  return out;
}
