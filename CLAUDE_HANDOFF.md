# Tracewise: handoff for another coding assistant (Claude Code or similar)

The full, self-contained technical summary (directory tree, entities, endpoints, flows, test outcomes) is in [`CHATGPT_HANDOFF.md`](CHATGPT_HANDOFF.md). This file adds the working agreement for continuing development.

## Project purpose

Repository-aware API change impact analysis: connect upstream API deprecations/breaking changes to the exact code in a developer's repository, with evidence, severity and honest confidence. Portfolio-grade MVP demonstrating full-stack development, static analysis, background processing, database design and testing.

## Implemented features (what exists)

Dashboard, provider catalog (Stripe, GitHub, Twilio, OpenAI), change feed with filters and detail, repository registration (local under `SCAN_ROOTS`, https Git URL) and scanning, dependency detection (package.json, package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, pyproject.toml), TS/JS (compiler AST) and Python (tree-sitter + regex fallback) analysis, call-site index, deterministic matcher, findings with persisted status, settings, feed polling with conditional requests, OpenAPI subset diff, BullMQ queues (+ inline mode), REST API with OpenAPI docs, seeded demo, 222 automated tests (196 backend, 26 frontend). Not implemented: GitHub App/webhooks, Slack, issue/PR creation, CI check mode, real auth/multi-tenancy, email sending, Playwright E2E.

## Architecture decisions (do not rewrite without a strong reason)

- npm workspaces monorepo; **apps are wiring only**, logic lives in `packages/*` (`core` holds services shared by API and worker).
- **Drizzle + SQL migrations** (no engine binaries). **PGlite** for tests so contributors need no Docker; CI also runs on real PostgreSQL.
- **BullMQ only** (never mix queue libraries). `QUEUE_MODE=inline` runs the same handlers in-process.
- **Deterministic core**: scanner indexes facts, matcher is a pure function, every finding has `confidence`, `matchReason`, `explanation`, `limitations`. Prefer lowering confidence over inventing certainty. Verified means confidence >= 0.85.
- **Idempotency by fingerprints/hashes** (events, snapshots, findings). Finding fingerprints exclude line numbers; never overwrite finding status on upsert.
- **Demo vs live is explicit**: events carry `origin`; the UI labels demo data; fixture events always have `origin=demo`.
- TypeScript compiler API for JS/TS, tree-sitter (WASM) for Python, both file-local. No native build steps (Windows-friendly).

## Commands that work (verified on a fresh extraction)

```
npm ci ; docker compose up -d ; npm run db:migrate ; npm run db:seed
npm run dev | dev:api | dev:worker | dev:web
npm test | test:unit | test:web | typecheck | lint | format:check | benchmark | build:web
npm run db:generate | db:reset
```

## Environment variables

See `.env.example` (documented inline): `TRACEWISE_MODE`, `DATABASE_URL`, `REDIS_URL`, `QUEUE_MODE`, `API_HOST`, `API_PORT`, `API_URL`, `API_TOKEN`, `TRACEWISE_API_TOKEN`, `WEB_ORIGIN`, `SCAN_ROOTS`, `GIT_ALLOWED_HOSTS`, `SCAN_MAX_*`, `ENABLE_LIVE_POLLING`, `POLL_INTERVAL_MINUTES`, `FETCH_*`, `LLM_*`, plus test-only `TEST_DATABASE_URL`, `TEST_REDIS_URL`. No secrets are shipped.

## Tests executed and their actual results

On a fresh extraction after `npm ci`: typecheck 0 errors; ESLint clean; Prettier clean; `npx vitest run` 17 files / **196 passed** (PGlite; real Redis for queue tests); same suite with `TEST_DATABASE_URL` on PostgreSQL 16: **196 passed**; web tests 5 files / **26 passed**; `next build` succeeded; `npm run dev` smoke test passed (pages 200, scan processed by the BullMQ worker). Benchmarks: see `BENCHMARKS.md`.

## Known bugs / issues

1. Invalid-id dynamic pages in the web app render "Not found" with HTTP 200 (streaming).
2. Build-time `npm audit` advisory in Next.js 15's bundled PostCSS.
3. Per-file analysis limitations are real and pinned by tests: cross-file client, sub-resource alias (false negatives), shadowed names (false positive).
4. Rate limiter is per-process memory.

## Incomplete or unverified

Docker app profile/Dockerfile and `docker compose up` (no daemon was available), Windows execution, the `github.blog` feed URL, real LLM endpoint, OpenAPI diff on real specs, Playwright E2E, GitHub integration beyond public https clone.

## Recommended next steps

1. Cross-file client tracing + scoped bindings (extend the labelled cases first). 2. Authentication and tenancy. 3. Playwright E2E, Docker and Windows verification. 4. GitHub App with webhooks and incremental indexing. 5. Evaluation on real labelled repositories.

## Instructions for the next assistant

- Read `docs/USER_GUIDE.md`, `docs/ARCHITECTURE.md` and `docs/SCANNER.md` first; run `npm test` before changing anything and keep it green.
- Keep package boundaries: `web` imports only `@tracewise/shared`; `matcher` stays pure; do not duplicate logic in `apps/*`.
- Add tests with every change (positive and negative). For detection changes add labelled cases to `fixtures/benchmarks/callsite-cases.json` and update `BENCHMARKS.md` **with measured values only**.
- Never claim a feature is done unless it exists in code and is tested; update both handoff files when behaviour changes.
- Never log or persist raw source beyond the redacted snippet; never add credentials to the repository.
- For schema changes: edit `schema.ts`, run `npm run db:generate`, review the SQL, add tests, update `docs/DATABASE.md`.
