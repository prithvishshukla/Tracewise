# Tracewise: handoff for ChatGPT

Written as a transfer from the engineer who built this codebase to the engineer who continues it. Everything below describes what **exists in the code today**. Items that are missing are listed under [Not implemented](#10-not-implemented-incomplete-or-unverified). Upload this file together with `tracewise-starter.zip`.

## 1. Product description

Tracewise monitors third-party API changes (simulated fixtures, RSS/Atom feeds, OpenAPI snapshots) and connects them to the code in registered repositories. For each change it produces **findings**: file, line, snippet, severity, confidence, a verified-vs-possible classification, evidence, limitations and a suggested next step. Static analysis is file-local and the system prefers reporting uncertainty over a confident guess. Demo mode needs no API key and no network.

## 2. Implemented functionality (all verified by tests unless stated)

**P0 (all implemented)**: landing page, dashboard (real backend numbers), provider catalog (Stripe, GitHub, Twilio, OpenAI; JSON-driven), API change feed (search, provider/severity/type/origin filters, sort, pagination, detail), repository registration and scanning (local directory under allowed roots, or restricted https Git URL), dependency detection (6 manifest/lockfile formats), TypeScript/JavaScript and Python source analysis, call-site index, deterministic change-to-code matching with confidence, severity, evidence and limitations, findings with status management persisted in PostgreSQL (open/snoozed/fixed/false positive), settings page, seeded deterministic demo, automated tests, Docker Compose for PostgreSQL/Redis, README and docs.

**P1**: RSS/Atom feed polling with ETag/Last-Modified conditional requests, timeouts, retry with backoff, per-host concurrency (implemented; verified against local servers and real GitHub Atom feeds); OpenAPI snapshot comparison (supported subset: operations, deprecated flag, parameters required/enum, response codes; verified on fixtures only); BullMQ background jobs on five queues with retries, exponential backoff, deduplication, job records, graceful shutdown (verified with real Redis); historical tracking through immutable `source_snapshots`, `change_events`, `repository_scans`, `audit_events`; email notification **interface** (the bundled transport records to the database and logs; it does not send); suggested remediation text on events and findings; optional AI-assisted extraction behind `ExtractionProvider` (OpenAI-compatible; disabled by default; verified with a mock only).

**P2**: only a static bearer-token auth for production mode and a basic rate limiter. GitHub App, webhooks, Slack, issue/PR creation, CI check mode and multi-tenancy are **not** implemented.

## 3. Tech stack (installed versions)

Node 22 (>=20.11), npm 10 workspaces. TypeScript 5.9. Next.js 15.5 (App Router, React 19.3), Tailwind CSS 3.4, lucide-react, Recharts 2.15. Fastify 5.12, zod 4.6, @fastify/swagger + swagger-ui, @fastify/rate-limit, @fastify/cors, pino. PostgreSQL 16, Drizzle ORM 0.45 + drizzle-kit 0.31, `pg` 8, `@electric-sql/pglite` 0.5 (tests). Redis 7, BullMQ 5.81, ioredis 5.11. Scanner: TypeScript compiler API, `web-tree-sitter` 0.25 + `tree-sitter-wasms` 0.1.13, semver, yaml, smol-toml. Providers: fast-xml-parser. Tests: Vitest 3.2, Testing Library, jsdom. Tooling: tsx, ESLint 9, Prettier 3, concurrently. CI: GitHub Actions (`.github/workflows/ci.yml`).

## 4. Directory tree

```
tracewise/
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── main.ts
│   │   │   ├── route.ts
│   │   │   └── routes.ts
│   │   ├── test/
│   │   │   └── api.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (app)/
│   │   │   │   │   ├── changes/
│   │   │   │   │   │   ├── [id]/
│   │   │   │   │   │   │   └── page.tsx
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── dashboard/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── findings/
│   │   │   │   │   │   ├── [id]/
│   │   │   │   │   │   │   └── page.tsx
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── providers/
│   │   │   │   │   │   ├── [id]/
│   │   │   │   │   │   │   └── page.tsx
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── repositories/
│   │   │   │   │   │   ├── [id]/
│   │   │   │   │   │   │   └── page.tsx
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── settings/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   ├── error.tsx
│   │   │   │   │   ├── layout.tsx
│   │   │   │   │   ├── loading.tsx
│   │   │   │   │   └── not-found.tsx
│   │   │   │   ├── api/
│   │   │   │   │   └── [...path]/
│   │   │   │   │       └── route.ts
│   │   │   │   ├── globals.css
│   │   │   │   ├── layout.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── components/
│   │   │   │   ├── filter-bar.tsx
│   │   │   │   ├── repo-actions.tsx
│   │   │   │   ├── settings-form.tsx
│   │   │   │   ├── severity-chart.tsx
│   │   │   │   ├── sidebar.tsx
│   │   │   │   ├── status-controls.tsx
│   │   │   │   └── ui.tsx
│   │   │   └── lib/
│   │   │       ├── api.ts
│   │   │       └── format.ts
│   │   ├── test/
│   │   │   ├── filter-bar.test.tsx
│   │   │   ├── format.test.ts
│   │   │   ├── repo-actions.test.tsx
│   │   │   ├── setup.ts
│   │   │   ├── status-controls.test.tsx
│   │   │   └── ui.test.tsx
│   │   ├── next.config.mjs
│   │   ├── package.json
│   │   ├── postcss.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── worker/
│       ├── src/
│       │   ├── main.ts
│       │   └── workers.ts
│       ├── test/
│       │   └── queue.test.ts
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── DEVELOPMENT.md
│   ├── ROADMAP.md
│   ├── SCANNER.md
│   ├── SECURITY.md
│   └── USER_GUIDE.md
├── fixtures/
│   ├── benchmarks/
│   │   └── callsite-cases.json
│   ├── provider-changes/
│   │   ├── openapi/
│   │   │   ├── stripe-mini-v1.json
│   │   │   └── stripe-mini-v2.json
│   │   ├── github.json
│   │   ├── openai.json
│   │   ├── stripe.json
│   │   └── twilio.json
│   └── sample-repositories/
│       └── demo-shop/
│           ├── src/
│           │   ├── ai.ts
│           │   ├── dynamic.ts
│           │   ├── github.ts
│           │   ├── legacy.py
│           │   ├── lookalike.ts
│           │   ├── notify.ts
│           │   ├── payments.ts
│           │   └── server.ts
│           ├── tools/
│           │   └── legacy-service/
│           │       └── package.json
│           ├── expected-findings.json
│           ├── NOTES.md
│           ├── package-lock.json
│           ├── package.json
│           └── requirements.txt
├── infra/
│   └── docker/
│       └── Dockerfile
├── packages/
│   ├── config/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── net-safety.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core/
│   │   ├── src/
│   │   │   ├── audit.ts
│   │   │   ├── bootstrap.ts
│   │   │   ├── context.ts
│   │   │   ├── demo.ts
│   │   │   ├── dispatcher.ts
│   │   │   ├── errors.ts
│   │   │   ├── findings.ts
│   │   │   ├── handlers.ts
│   │   │   ├── index.ts
│   │   │   ├── monitoring.ts
│   │   │   ├── notifications.ts
│   │   │   ├── provider-service.ts
│   │   │   ├── queries.ts
│   │   │   ├── repositories.ts
│   │   │   └── settings.ts
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── database/
│   │   ├── drizzle/
│   │   │   ├── meta/
│   │   │   │   ├── 0000_snapshot.json
│   │   │   │   └── _journal.json
│   │   │   └── 0000_init.sql
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── index.ts
│   │   │   ├── schema.ts
│   │   │   └── testing.ts
│   │   ├── test/
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── matcher/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── test/
│   │   │   └── matcher.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── providers/
│   │   ├── catalog/
│   │   │   ├── github.json
│   │   │   ├── openai.json
│   │   │   ├── stripe.json
│   │   │   └── twilio.json
│   │   ├── src/
│   │   │   ├── catalog.ts
│   │   │   ├── classify.ts
│   │   │   ├── extraction.ts
│   │   │   ├── feeds.ts
│   │   │   ├── fetcher.ts
│   │   │   ├── fixtures.ts
│   │   │   ├── hash.ts
│   │   │   ├── index.ts
│   │   │   ├── openapi.ts
│   │   │   ├── process.ts
│   │   │   └── types.ts
│   │   ├── test/
│   │   │   ├── classify.test.ts
│   │   │   ├── feeds.test.ts
│   │   │   ├── fetcher.test.ts
│   │   │   └── openapi.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── scanner/
│   │   ├── src/
│   │   │   ├── analyzers/
│   │   │   │   ├── common.ts
│   │   │   │   ├── javascript.ts
│   │   │   │   └── python.ts
│   │   │   ├── dependencies.ts
│   │   │   ├── git.ts
│   │   │   ├── index.ts
│   │   │   ├── provider-index.ts
│   │   │   ├── redact.ts
│   │   │   ├── safe-fs.ts
│   │   │   ├── scan.ts
│   │   │   └── types.ts
│   │   ├── test/
│   │   │   ├── dependencies.test.ts
│   │   │   ├── git.test.ts
│   │   │   ├── helpers.ts
│   │   │   ├── javascript.test.ts
│   │   │   ├── python.test.ts
│   │   │   ├── redact.test.ts
│   │   │   ├── safe-fs.test.ts
│   │   │   └── scan.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/
│       ├── src/
│       │   ├── affected.ts
│       │   ├── dto.ts
│       │   ├── enums.ts
│       │   ├── index.ts
│       │   ├── provider-config.ts
│       │   └── schemas.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── scripts/
│   ├── benchmark-lib.ts
│   ├── benchmark.ts
│   ├── db-migrate.ts
│   ├── db-reset.ts
│   └── seed-demo.ts
├── tests/
│   ├── callsite-benchmark.test.ts
│   ├── demo-e2e.test.ts
│   ├── helpers.ts
│   └── pipeline.test.ts
├── .dockerignore
├── .editorconfig
├── .env.example
├── .gitattributes
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── BENCHMARKS.md
├── CHATGPT_HANDOFF.md
├── CLAUDE_HANDOFF.md
├── docker-compose.yml
├── eslint.config.mjs
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.base.json
└── vitest.config.ts
```

## 5. Database entities

`providers`, `provider_sources`, `source_snapshots`, `change_events`, `repositories`, `repository_scans`, `detected_dependencies`, `indexed_files`, `call_sites`, `findings`, `job_records`, `audit_events`, `app_settings`, `notifications` (schema: `packages/database/src/schema.ts`; migration `packages/database/drizzle/0000_init.sql`; details in `docs/DATABASE.md`).

Important behaviours: `change_events.fingerprint` and `findings.fingerprint` are unique (idempotent ingestion; findings fingerprint = sha256(repo | event | matchKey | occurrence) and excludes line numbers); `source_snapshots` unique on `(source_id, content_hash)`; `call_sites`/`indexed_files`/`detected_dependencies` are replaced on every scan while findings keep their own file/line/snippet copy; findings upsert never overwrites `status`.

## 6. API endpoint inventory

`GET /health`, `GET /docs` (Swagger UI), `GET /docs/json`, `GET /api/status`, `GET /api/dashboard/stats`, `GET /api/providers`, `GET /api/providers/:id` (id or slug), `POST /api/providers/:id/poll`, `GET /api/changes`, `GET /api/changes/:id`, `GET /api/repositories`, `POST /api/repositories`, `GET /api/repositories/:id`, `POST /api/repositories/:id/scan`, `GET /api/repositories/:id/scans`, `GET /api/repositories/:id/dependencies`, `GET /api/repositories/:id/files`, `GET /api/repositories/:id/findings`, `GET /api/scans/:id`, `GET /api/findings`, `GET /api/findings/:id`, `PATCH /api/findings/:id`, `GET /api/settings`, `PUT /api/settings`. Contract details: `docs/API.md`. The web app calls these through its own `/api/*` proxy route (`apps/web/src/app/api/[...path]/route.ts`).

## 7. Main execution flows

1. **Seed** (`npm run db:seed`, runs with an inline dispatcher): `syncProviderCatalog` -> poll each demo source (`fixture:` files) -> snapshot -> `change-processing` -> `change_events` (labelled demo) -> mini OpenAPI v1 then v2 snapshots (diff produces 4 events) -> register `fixtures/sample-repositories/demo-shop` -> scan -> `finding-generation`. Result: 12 events, 6 open findings (1 critical, 4 verified, 2 possible).
2. **Scan**: `POST /api/repositories/:id/scan` creates a `queued` scan and enqueues `repository-scan`; the worker re-validates the path, runs `scanRepository`, replaces the index transactionally, enqueues `finding-generation`; the UI polls `GET /api/scans/:id`.
3. **Monitoring**: `provider-poll` (scheduled for live sources by the worker; skipped while live polling is disabled) -> `politeFetch` -> snapshot (hash dedupe) -> `change-processing` -> events -> `finding-generation` -> `notifications`.
4. **Matching**: `matchEvent` (pure, `packages/matcher`) for each affected item: SDK symbol (exact/unresolved/dynamic prefix), endpoint (host+path+method, SDK `request` routes, path-only with provider evidence), package version (semver range; lockfile preferred), pattern.
5. **Status change**: `PATCH /api/findings/:id` -> `updateFindingStatus` (+ audit event); snoozes expire on read.

## 8. Setup commands (Windows 11, PowerShell)

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev            # api :4000, worker, web :3000   (or npm run dev:api / dev:worker / dev:web separately)
```

To scan your own repositories set `SCAN_ROOTS` in `.env` (for example `SCAN_ROOTS=C:\Users\you\projects;C:\path\to\tracewise\fixtures\sample-repositories`) and restart the API and worker. No Docker: use a local PostgreSQL and set `QUEUE_MODE=inline`. **The Windows workflow itself was not executed** (see section 10).

## 9. Test commands and actual outcomes

All results below were produced in the authoring environment (Linux, Node 22.22, PostgreSQL 16 and Redis 7 installed from apt) on a **fresh extraction of this ZIP** after `npm ci`.

| Command                                                                                        | Result                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate` then `npm run db:seed`                                                    | migrations applied; seed: 4 providers, 1 repository, 6 open findings (1 critical, 4 verified)                                                                                                                                                                                                             |
| `npm run typecheck`                                                                            | 0 TypeScript errors across all workspaces                                                                                                                                                                                                                                                                 |
| `npm run lint` / `npm run format:check`                                                        | ESLint clean / Prettier clean                                                                                                                                                                                                                                                                             |
| `npx vitest run` (in-process PGlite; Redis queue tests ran against a real Redis)               | **17 files, 196 tests passed**                                                                                                                                                                                                                                                                            |
| `TEST_DATABASE_URL=postgres://postgres:tracewise@127.0.0.1:5432/tracewise_test npx vitest run` | **17 files, 196 tests passed** on real PostgreSQL 16                                                                                                                                                                                                                                                      |
| `npm run test:web`                                                                             | **5 files, 26 tests passed** (Testing Library + jsdom)                                                                                                                                                                                                                                                    |
| `npm run build:web`                                                                            | Next.js production build compiled successfully                                                                                                                                                                                                                                                            |
| `npm run dev` (api + BullMQ worker + web)                                                      | all started; pages `/`, `/dashboard`, `/findings`, `/changes`, `/providers/openai`, `/repositories`, `/settings` returned 200; a scan started through the web proxy was processed by the worker and `succeeded`                                                                                           |
| Real network (authoring sandbox)                                                               | polling GitHub Atom feeds for stripe-node and openai-python worked and the second poll returned 304; restricted clone of `https://github.com/octocat/Hello-World` worked and its temp directory was removed; `https://github.blog/changelog/feed/` was **unreachable from the sandbox and is unverified** |

Test inventory (backend, 196): api 22, pipeline 21, queue 5, demo e2e 1, fetcher 10, scan 8, call-site benchmark 2, python 9, javascript 10, safe-fs 6, openapi 6, feeds 6, dependencies 8, matcher 31, git/net-safety 31, classify 9, redact 11. Measured benchmark results are in `BENCHMARKS.md` (call-site precision 0.967 / recall 0.935 on 37 synthetic labelled cases including 3 documented limitations; 6/6 expected demo findings and 0 extras; about 700 files/s scan throughput on 1 vCPU). These numbers describe synthetic data written by the same developer and are **not** an accuracy claim.

## 10. Not implemented, incomplete or unverified

- **Not implemented**: GitHub App installation and webhooks, Slack, GitHub issue/PR creation, CI check mode, user authentication, multi-tenancy, real email sending, Playwright end-to-end tests, "GitHub integration scaffolding" beyond cloning public https repositories, languages other than TS/JS/Python, cross-file client tracing.
- **Unverified in the authoring environment**: Docker Compose (`docker compose up` was never run: no Docker daemon; the YAML parses and PostgreSQL/Redis were verified natively instead), the `app` compose profile and `infra/docker/Dockerfile`, Windows (all commands are PowerShell-compatible by construction), the `github.blog` changelog feed URL, OpenAI-compatible extraction against a real endpoint (mock only), OpenAPI diff on real-world specs (fixtures only; fetched bodies over 5 MB are rejected).

## 11. Current limitations

Analysis is per-file (aliasing sub-resources and shadowed names are mishandled; documented in `BENCHMARKS.md`); feed classification is keyword-based and low-confidence, and most feed events list no affected symbols so they produce no findings; demo mode has no authentication and production mode only a static token; rate limiting is in memory per API process; poll-interval changes need a worker restart; indexed contents are not stored (only short snippets).

## 12. Known issues

1. For a dynamic route with an invalid or unknown id (for example `/findings/not-a-uuid`) the Next.js page renders the "Not found" UI but the HTTP status is **200** (streaming with `loading.tsx`). The API itself returns correct 400/404.
2. `npm audit` reports a PostCSS advisory inside Next.js 15's bundled copy (build-time only); upgrading Next.js is the fix.
3. `scripts/benchmark.ts` uses `import.meta.dirname` (Node 20.11+).
4. With `QUEUE_MODE=bullmq` the API needs Redis for any action that enqueues (scan, poll); the UI shows the API error. Use `QUEUE_MODE=inline` to avoid Redis.
5. Seeded events use `example.invalid` URLs on purpose; the UI shows "Simulated demo event" instead of a link.
6. Job records for a retrying BullMQ job show status `queued` between attempts.

## 13. Suggested next milestones

1. Cross-file client tracing (index exported client bindings) and scoped bindings; extend `fixtures/benchmarks/callsite-cases.json` first, then fix.
2. Authentication + organization tenancy (Auth.js/OIDC), then remove the static token path from the UI proxy.
3. Playwright E2E for the demo flow; verify Docker app profile and Windows.
4. GitHub App + webhooks with incremental indexing; Slack and issue/PR suggestions (read-only first).
5. Real-repository evaluation with hand-labelled usages and CI-tracked precision/recall.

## 14. Where to start for common changes

| Task                   | Files                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| New provider           | `packages/providers/catalog/*.json`, `packages/providers/src/catalog.ts`, `fixtures/provider-changes/*.json`                            |
| Detection rule (JS/TS) | `packages/scanner/src/analyzers/javascript.ts` (+ cases in `fixtures/benchmarks/callsite-cases.json`, tests in `packages/scanner/test`) |
| Match rule / severity  | `packages/matcher/src/index.ts`, `packages/matcher/test/matcher.test.ts`                                                                |
| New endpoint           | `apps/api/src/routes.ts` (`route()` helper), query in `packages/core/src/queries.ts`, DTO in `packages/shared/src/dto.ts`               |
| New page               | `apps/web/src/app/(app)/...`, components in `apps/web/src/components`                                                                   |
| Schema change          | edit `packages/database/src/schema.ts`, `npm run db:generate`, review SQL, `npm run db:migrate`                                         |
| Job behaviour          | `packages/core/src/dispatcher.ts`, `handlers.ts`, `apps/worker/src/workers.ts`                                                          |
