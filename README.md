# Tracewise

**Know what breaks before your APIs do.** Tracewise connects upstream API changes to the code that uses them, so teams can investigate deprecations before they become incidents.

> Status: working MVP / starter. Everything marked **DEMO DATA** in the UI is simulated. See [Known limitations](#19-known-limitations).

## Quick start and how to access

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

Then open:

| What                               | Address                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| **Dashboard (start here)**         | http://localhost:3000/dashboard                          |
| Landing page                       | http://localhost:3000/                                   |
| Findings / API changes / Providers | http://localhost:3000/findings, `/changes`, `/providers` |
| Repositories / Settings            | http://localhost:3000/repositories, `/settings`          |
| REST API and **Swagger docs**      | http://127.0.0.1:4000 and http://127.0.0.1:4000/docs     |
| Health check                       | http://127.0.0.1:4000/health                             |

Everything is local-only: the API listens on `127.0.0.1` and demo mode has no login. After seeding you should see **6 open findings** (1 critical, 1 high, 4 medium; 4 verified, 2 possible).

**New here? Read the [User guide](docs/USER_GUIDE.md)**: setup walkthrough, a guided tour of the demo, how to scan your own repository, how findings are decided, and troubleshooting.

## How it works in two minutes

1. **Collect upstream changes.** Sources (simulated demo files, public RSS/Atom feeds, OpenAPI specs) are fetched, stored as hashed snapshots and turned into structured **change events**: what changed, how serious, when, and which SDK method or endpoint is affected.
2. **Read your code.** The scanner parses your repository (it never executes it) and records provider dependencies, SDK imports and calls, and raw HTTP requests as a **call-site index**, with the exact file and line.
3. **Match.** A deterministic matcher compares each change event with the call sites. A finding exists only if your code really uses the thing that changed (using the same provider is not enough).
4. **Explain.** Every finding carries severity, confidence, the reason it matched, evidence, the limitations of that kind of match and a suggested next step. Confidence of 0.85 or more is **Verified**; lower is **Possible**.

Worked example: a (simulated) announcement says `stripe.charges.create` will be removed. In `src/payments.ts` the scanner sees `const stripe = new Stripe(...)` on line 4 and `stripe.charges.create(...)` on line 8, traces the client back to the SDK, and the matcher reports an exact-symbol match with confidence 0.95, severity High, the snippet, the evidence and the replacement hint. The neighbouring `stripe.paymentIntents.create(...)` call is not flagged.

Safe to re-run: snapshots, change events and findings are deduplicated by hashes and fingerprints; re-scanning updates findings instead of duplicating them and keeps the status you set. Background work (scans, feed polling, matching, notifications) runs in a separate worker through Redis/BullMQ with retries and backoff.

Full explanation with diagrams, match types, confidence and severity rules: [User guide, section 6](docs/USER_GUIDE.md#6-how-it-works) and [ARCHITECTURE](docs/ARCHITECTURE.md).

## 1. What Tracewise is

Tracewise monitors third-party API specifications, SDK release feeds and changelogs, normalizes deprecations and breaking changes, scans your repositories for the code that uses the affected APIs, and reports **findings** with a severity, a confidence level, evidence, and a suggested next step.

The differentiator is **repository-aware impact analysis**: instead of "an API changed", Tracewise answers "which files of mine may be affected, why, how serious is it, and what should I do next?"

It keeps **verified** impacts (concrete static evidence) separate from **possible** impacts (partial evidence), and never pretends static analysis can understand every dynamic code path.

## 2. The problem it solves

Deprecations are announced in changelog posts and emails nobody reads. Teams discover removed endpoints and SDK methods in production. Monitoring tools tell you _that_ something changed; Tracewise tells you _where it hits your code_.

## 3. Target users

Backend and full-stack developers and small teams (including agencies) that integrate many third-party APIs (payments, messaging, source hosting, LLM providers).

## 4. Main features (implemented)

- Provider catalog (Stripe, GitHub, Twilio, OpenAI) defined as data (JSON), with package names, API hosts and monitored sources.
- Change monitoring: simulated fixture events (demo), RSS/Atom feed polling with conditional requests, and OpenAPI snapshot comparison (supported subset).
- Normalized change events with severity, confidence, detection method, evidence and **origin (demo vs live)**.
- Repository registration (local directory under allowed roots, or restricted https Git URL), scanning, dependency detection (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements.txt`, `pyproject.toml`).
- Source analysis: TypeScript/JavaScript via the TypeScript compiler AST; Python via tree-sitter (WASM) with a regex fallback; raw HTTP calls and URL literals for known provider hosts.
- Deterministic change-to-code matching (exact symbol, known endpoint, API path, package version, pattern, dynamic prefix) with confidence, severity and limitations.
- Findings with status management (open / snoozed / fixed / false positive), persisted in PostgreSQL.
- Background jobs on Redis + BullMQ (scan, provider poll, change processing, finding generation, notifications) with retries, exponential backoff, deduplication, job records and graceful shutdown. An `inline` mode runs jobs in-process without Redis.
- Next.js dashboard, change feed, provider catalog, repositories, findings, settings; REST API with OpenAPI docs at `/docs`.
- Seeded, deterministic demo that needs no API key and no GitHub account.

## 5. Architecture

```
 provider sources ──► provider-poll ──► change-processing ──► change_events ─┐
 (fixtures, feeds,       (fetch,           (interpret snapshot,               │ finding-generation
  OpenAPI specs)          snapshot)         dedupe by fingerprint)            ▼
                                                                         findings ──► notifications
 repository ──► repository-scan ──► call_sites / dependencies / files ───────┘
 (local dir / git)   (scanner, no code execution)

 Next.js web  ──►  /api proxy  ──►  Fastify REST API  ──►  PostgreSQL  ◄──  BullMQ worker  ◄──  Redis
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 6. Technology stack

TypeScript everywhere. Next.js 15 (App Router) + Tailwind CSS 3 + Lucide + Recharts; Fastify 5 + zod 4; PostgreSQL 16 + Drizzle ORM (SQL migrations); Redis 7 + BullMQ 5; TypeScript compiler API + web-tree-sitter; Vitest 3 + Testing Library; Docker Compose; GitHub Actions. npm workspaces.

## 7. Repository structure

```
tracewise/
  apps/
    web/        Next.js dashboard (App Router)
    api/        Fastify REST API (+ Swagger UI at /docs)
    worker/     BullMQ worker process
  packages/
    shared/     enums, zod schemas, DTO types (used by api and web)
    config/     environment parsing, SSRF helpers
    database/   Drizzle schema, migrations (drizzle/), client, test DB factory
    scanner/    safe file walking, dependency detection, JS/TS + Python analyzers, git clone
    providers/  provider catalog (JSON), fetcher, feed/OpenAPI/fixture parsing, classification
    matcher/    deterministic change-to-code matching engine
    core/       services: dispatcher, monitoring, scans, findings, queries, demo seed
  fixtures/     demo repository, simulated provider changes, benchmark cases
  docs/         architecture, API, database, scanner, security, development, roadmap
  infra/docker/ Dockerfile (optional app image)
  scripts/      db-migrate, db-reset, seed-demo, benchmark
  tests/        cross-package integration and end-to-end demo tests
```

Deviation from the suggested layout: an extra `packages/core` holds business logic shared by the API and the worker so neither duplicates it; unit tests live next to each package (`packages/*/test`), integration tests in `tests/` and `apps/*/test`.

## 8. Prerequisites

- Node.js 20.11+ (developed with Node 22) and npm 10+
- Docker Desktop (recommended) for PostgreSQL and Redis. Alternatives: [Troubleshooting](#17-troubleshooting).
- Git (only needed for Git-URL repositories)

## 9. Environment variables

Copy `.env.example` to `.env`. Every variable is documented inside it. Key ones: `DATABASE_URL`, `REDIS_URL`, `QUEUE_MODE` (`bullmq` | `inline`), `SCAN_ROOTS`, `TRACEWISE_MODE` (`demo` | `production`), `API_TOKEN`, `ENABLE_LIVE_POLLING`, optional `LLM_*`. No secrets are included in this archive.

## 10. Installation (Windows 11 / PowerShell)

```powershell
cd path\to\tracewise
Copy-Item .env.example .env
npm install
```

## 11. Database setup

```powershell
docker compose up -d          # PostgreSQL 16 on :5433 (mapped to container :5432) and Redis 7 on :6379
npm run db:migrate            # applies packages/database/drizzle/*.sql
```

Reset everything: `npm run db:reset` (drops the schema and re-applies migrations; refuses in production mode without `--force`).

## 12. Seeding demo data

```powershell
npm run db:seed
```

Idempotent. Loads the provider catalog, simulated change events (all labelled **DEMO DATA**), a baseline and updated mini OpenAPI snapshot, registers `fixtures/sample-repositories/demo-shop` and scans it. Expected result: **6 open findings (1 critical, 4 verified, 2 possible)**.

## 13. Running the frontend

```powershell
npm run dev:web               # http://localhost:3000
```

## 14. Running the backend

```powershell
npm run dev:api               # http://127.0.0.1:4000  (OpenAPI docs: /docs)
```

## 15. Running the worker

```powershell
npm run dev:worker            # consumes the five BullMQ queues
```

Or start all three in one terminal: `npm run dev`. Without Redis/worker, set `QUEUE_MODE=inline` and the API runs jobs itself.

| Process  | Port | Purpose                                                  |
| -------- | ---- | -------------------------------------------------------- |
| web      | 3000 | Next.js UI; proxies `/api/*` to the API (adds the token) |
| api      | 4000 | REST API, validation, rate limiting, OpenAPI             |
| worker   | -    | scans, feed polling, change processing, finding matching |
| postgres | 5433 | primary database (mapped to 5432 in container)           |
| redis    | 6379 | BullMQ queues                                            |

## 16. Running tests

```powershell
npm test                      # backend/integration suite (Vitest) + web component tests
npm run test:unit             # backend only
npm run test:web              # frontend only
npm run typecheck ; npm run lint ; npm run format:check
npm run benchmark             # measures detection quality and scan throughput
```

By default tests use in-process PGlite (no Docker). Set `TEST_DATABASE_URL=postgres://postgres:tracewise@localhost:5433/tracewise_test` to run the suite on real PostgreSQL (each test runtime gets its own temporary database). Queue tests use Redis database 15 (`TEST_REDIS_URL`) and are skipped when Redis is not reachable.

## 17. Troubleshooting

- **`ECONNREFUSED 5433/6379`**: start the containers (`docker compose up -d`) and check `docker compose ps`.
- **No Docker?** Install PostgreSQL 16 for Windows and point `DATABASE_URL` at it; set `QUEUE_MODE=inline` to avoid Redis (or use Memurai/WSL Redis).
- **"Directory is outside the allowed scan roots"**: add the folder to `SCAN_ROOTS` in `.env` (separator `;` on Windows) and restart the API.
- **Web shows "Cannot reach the Tracewise API"**: start `npm run dev:api`; check `API_URL`.
- **Scans stay "queued"**: the worker is not running (`npm run dev:worker`) or `QUEUE_MODE=inline` is not set.
- **Port in use**: change `API_PORT` (and `API_URL`) or stop the other process.

## 18. Security considerations

Scanning is read-only and never executes repository code. Paths are validated against `SCAN_ROOTS` after resolving symlinks; symlinks inside repositories are never followed; size/file-count/time limits apply; secrets are redacted from stored snippets and logs; Git URLs are https-only with an allow-listed host, DNS/IP checks and redirects disabled; the feed fetcher blocks private addresses. **Demo mode has no authentication.** Do not expose it to a network. Remaining production work: [docs/SECURITY.md](docs/SECURITY.md).

## 19. Known limitations

- Demo mode has no user authentication; production mode only adds a static bearer token (no users, no multi-tenancy).
- Analysis is per-file: clients created in one file and used in another are not traced; aliasing a sub-resource and shadowed variable names are mishandled (documented, covered by [BENCHMARKS.md](BENCHMARKS.md)).
- Feed classification is keyword-based and low-confidence; most feed events have no `affected` symbols and therefore produce no findings.
- OpenAPI comparison supports operations, deprecation flags, parameters (required/enum) and response codes only; very large specs (over 5 MB) are rejected by the fetcher.
- Email notifications are recorded in the database and logged, not sent.
- Docker image/profile, Playwright end-to-end tests and Windows were **not** verified in the authoring environment (see `CHATGPT_HANDOFF.md`).

## 20. Future roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md): GitHub App + webhooks, Slack, issue/PR creation, cross-file client tracing, more languages, CI check mode, real authentication and multi-tenancy.

## Further documentation

[USER_GUIDE](docs/USER_GUIDE.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [API](docs/API.md) · [DATABASE](docs/DATABASE.md) · [SCANNER](docs/SCANNER.md) · [SECURITY](docs/SECURITY.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [ROADMAP](docs/ROADMAP.md) · [BENCHMARKS](BENCHMARKS.md) · [CLAUDE_HANDOFF](CLAUDE_HANDOFF.md) · [CHATGPT_HANDOFF](CHATGPT_HANDOFF.md)
