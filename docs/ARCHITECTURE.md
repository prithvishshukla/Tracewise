# Architecture

## Goals

A small, understandable, runnable system whose core is **deterministic**: the scanner indexes facts about code, the matcher compares facts with structured change events, and every result carries evidence and an explicit confidence.

## Components

| Component            | Responsibility                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router UI. Server components call the API; client components call the same-origin `/api` proxy.      |
| `apps/api`           | Fastify REST API. zod validation, consistent errors, rate limiting, OpenAPI. No business logic beyond wiring.    |
| `apps/worker`        | One BullMQ worker per queue. Calls handlers from `@tracewise/core`. Records every job in `job_records`.          |
| `packages/core`      | Services: dispatcher (BullMQ/inline), monitoring pipeline, scan service, finding generation, queries, demo seed. |
| `packages/scanner`   | Safe file walking, dependency detection, JS/TS and Python analyzers, restricted git clone.                       |
| `packages/matcher`   | Pure functions: `matchEvent(event, {callSites, dependencies}) -> Match[]`.                                       |
| `packages/providers` | Provider catalog (JSON), polite fetcher, feed/OpenAPI/fixture interpretation, keyword classifier, LLM interface. |
| `packages/database`  | Drizzle schema, SQL migrations, pg client, PGlite/real-Postgres test factory.                                    |
| `packages/shared`    | Enums, zod schemas, DTO types shared with the web app.                                                           |
| `packages/config`    | Environment parsing (zod) and SSRF helpers.                                                                      |

Dependency direction (no cycles): `shared`, `config` <- `database`, `scanner`, `providers`, `matcher` <- `core` <- `api`, `worker`. `web` depends only on `shared`.

## Data flow

1. **Monitoring.** `provider-poll(sourceId)` fetches the source (`fixture:` files are read locally; HTTP goes through `politeFetch`). Content is normalized (OpenAPI specs are reduced to a comparable subset), hashed, and stored as an immutable `source_snapshot` (unique per source+hash). An unchanged hash or HTTP 304 creates nothing. A new snapshot enqueues `change-processing(snapshotId)`.
2. **Interpretation.** `change-processing` interprets the snapshot (fixture events / feed items / OpenAPI diff against the previous snapshot) into `NormalizedChange` records and inserts `change_events` with `ON CONFLICT (fingerprint) DO NOTHING`. New events enqueue `finding-generation`.
3. **Scanning.** `repository-scan(scanId)` re-validates the target, scans without executing code, then replaces the repository's index (files, dependencies, call sites) in one transaction and enqueues `finding-generation(repositoryId)`.
4. **Matching.** `finding-generation` runs `matchEvent` for the relevant events and call sites, and upserts `findings` by fingerprint `sha256(repo | event | matchKey | occurrence)`. Line numbers are deliberately not part of the fingerprint, so a rescan updates a finding (keeping its status) instead of duplicating it. New findings enqueue `notifications`.

## Job system

Five queues: `repository-scan`, `provider-poll`, `change-processing`, `finding-generation`, `notifications`. Default options per queue are in `DEFAULT_JOB_OPTIONS` (attempts 2-5, exponential backoff, bounded retention). Deterministic `jobId`s deduplicate (for example `scan-<scanId>`, `poll-<sourceId>-<minute>`). `NonRetryableError` is mapped to BullMQ's `UnrecoverableError` so permanent failures do not retry. Job state is mirrored to `job_records` (writes are serialized per job so events cannot land out of order). `QUEUE_MODE=inline` swaps the dispatcher for one that runs the same handlers in-process.

## Impact classification

`confidence >= 0.85` is **verified** (the changed API is called through a client traced to the SDK, or a literal request to the provider host), otherwise **possible**. Severity starts from the event's severity and is adjusted: breaking changes already in effect with verified confidence become `critical`; package-version matches are capped at `medium`; confidence below 0.5 lowers severity one level.

## Key decisions

- **Drizzle + SQL migrations** instead of Prisma: pure JavaScript (no engine binaries), simple Windows setup, SQL migrations that are reviewed in git.
- **TypeScript compiler API for JS/TS** (not tree-sitter): richer semantics (imports, types, class properties) and no native build step. **tree-sitter (WASM)** is used for Python, with a regex fallback. Both are file-local.
- **PGlite for tests**: the same SQL migrations run in-process, so contributors need no Docker to test; CI also runs against real PostgreSQL.
- **Findings keep their own copy** of file, line and a short redacted snippet, so the index can be replaced on every scan.
- **One image / no microservices**: api and worker share `core`; the web app talks only to the API.
