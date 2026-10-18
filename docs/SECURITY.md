# Security

## Threat model (short)

Tracewise reads source code the operator points it at and fetches public URLs from a fixed catalog. The main risks are: reading files outside the intended directories, being used as an SSRF proxy, leaking secrets embedded in scanned code, executing untrusted content, and exposing an unauthenticated API.

## Implemented controls

| Area            | Control                                                                                                                                                                                 | Where                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Path safety     | Local repositories must be absolute and, after `realpath`, inside `SCAN_ROOTS` (blocks `..`, symlink escapes, NUL bytes). Re-validated when the scan runs.                              | `scanner/safe-fs.ts`, `core/repositories.ts` |
| Symlinks        | Never followed during scanning; counted in `stats.skipped.symlink`.                                                                                                                     | `walkRepository`                             |
| Resource limits | File count, per-file size, total bytes, wall-clock timeout; partial results are flagged.                                                                                                | `walkRepository`, `scanRepository`           |
| No execution    | Files are parsed, never imported or run; git clones disable hooks, templates, submodules and credential helpers.                                                                        | `scanner`, `git.ts`                          |
| Git URLs        | `https` only, no credentials/ports/queries, allow-listed host (`GIT_ALLOWED_HOSTS`), no IP hosts, DNS resolution must be public, redirects disabled, size cap, temp dir always removed. | `scanner/git.ts`, `config/net-safety.ts`     |
| Fetcher (SSRF)  | Public-address check on every hop, manual redirects (max 3), timeouts, response size cap, per-host concurrency, retry with backoff, `Retry-After` honoured.                             | `providers/fetcher.ts`                       |
| Secret handling | Pattern-based redaction (Stripe, OpenAI, AWS, GitHub, Slack, JWT, private keys, URL credentials, `key = "..."`) applied to snippets, scan warnings and errors. No credentials stored.   | `scanner/redact.ts`                          |
| API             | zod validation, consistent errors, no stack traces in production mode, CORS limited to `WEB_ORIGIN`, rate limits, body limit, request timeout, security headers on the web app.         | `apps/api`, `apps/web/next.config.mjs`       |
| Auth (basic)    | `TRACEWISE_MODE=production` requires `API_TOKEN` at startup and checks it (constant-time) on `/api/*`. The web server adds it server-side; browsers never see it.                       | `apps/api/src/app.ts`, web `/api` proxy      |
| LLM (optional)  | Off by default; sends only public changelog text, never repository contents; output validated with zod; failures return no data.                                                        | `providers/extraction.ts`                    |

## Remaining production work

1. **Real authentication and authorization** (for example Auth.js/OIDC with server-side sessions) and **tenant isolation** (organization id on every table; never trust client-supplied tenant ids). The current static token is a stop-gap and the web UI itself is open in both modes.
2. Distributed rate limiting (the limiter is per API process), plus per-user quotas.
3. Egress hardening for the worker (network policy) because DNS rebinding between the address check and the connection cannot be fully prevented in-process.
4. Run scans in an isolated sandbox/container with CPU, memory and filesystem quotas for untrusted repositories.
5. Secret management for tokens (KMS/Vault), encrypted at rest; rotate `API_TOKEN`.
6. GitHub App with least-privilege permissions and webhook signature verification before enabling repository connections.
7. Dependency and image scanning in CI; `npm audit` currently reports a build-time advisory in the PostCSS copy bundled with Next.js 15 (not reachable at runtime; fixed in newer Next.js).
8. Audit log retention, structured access logs, alerting.
9. Content-Security-Policy tuned for the Next.js app and TLS termination in front of both services.
