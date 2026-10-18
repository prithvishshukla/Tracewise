# Development guide

## Daily commands

```powershell
docker compose up -d
npm run dev                  # api + worker + web
npm test ; npm run typecheck ; npm run lint
npm run db:generate          # after editing packages/database/src/schema.ts (then review the SQL)
npm run db:migrate
```

## Adding a provider

1. Create `packages/providers/catalog/<slug>.json` (see `stripe.json`): packages, API hosts, `sdk.js` / `sdk.python` bindings (`modules`, canonical `root`, `factories`), and sources.
2. Import it in `packages/providers/src/catalog.ts`.
3. Run `npm run db:seed` (or any process calling `syncProviderCatalog`) to upsert it.
4. Add simulated events under `fixtures/provider-changes/<slug>.json` for demos/tests (they are always labelled demo).

## Adding a source kind

Implement interpretation in `packages/providers/src/process.ts` (`interpretSnapshot`), add the kind to `SOURCE_KINDS` in `packages/shared/src/enums.ts` **and** the pg enum in `packages/database/src/schema.ts`, then generate a migration.

## Adding a match rule

Edit `packages/matcher/src/index.ts`. Keep it a pure function; add cases to `packages/matcher/test/matcher.test.ts` (positive and negative). Every rule must set `kind`, `confidence`, `reason`, `explanation` and `limitations`.

## Testing strategy

| Layer               | Where                                                   | Notes                                                                |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| Unit                | `packages/*/test`                                       | Temp directories and inline code; local HTTP servers for the fetcher |
| Integration         | `tests/pipeline.test.ts`, `apps/api/test`               | Real services/handlers on PGlite (or `TEST_DATABASE_URL`)            |
| End-to-end (API)    | `tests/demo-e2e.test.ts`                                | Seed, open finding, change status, verify in the database            |
| Queue               | `apps/worker/test/queue.test.ts`                        | Real Redis (db 15); skipped when unavailable                         |
| Detection benchmark | `tests/callsite-benchmark.test.ts`, `npm run benchmark` | Labelled synthetic cases, including documented limitations           |
| Frontend            | `apps/web/test`                                         | Testing Library + jsdom for interactions; no browser E2E yet         |

## Conventions

- Business logic lives in `packages/*`; apps are wiring only.
- Never log or store raw source beyond the redacted snippet.
- Anything that can fail permanently should throw `NonRetryableError` inside handlers.
- Prefer reporting uncertainty (lower confidence, `limitations`) over guessing.
- Format with Prettier (`npm run format`), lint with ESLint (`npm run lint`).
