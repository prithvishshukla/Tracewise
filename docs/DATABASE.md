# Database

PostgreSQL 16, Drizzle ORM. Schema: `packages/database/src/schema.ts`. Migration: `packages/database/drizzle/0000_init.sql` (generated with `npm run db:generate`; apply with `npm run db:migrate`). Seed: `npm run db:seed`. Reset: `npm run db:reset`.

## Tables

| Table                   | Purpose                                                                                                    | Notable constraints / indexes                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `providers`             | Catalog entry, including the full parsed config (SDK bindings)                                             | unique `slug`                                                                                    |
| `provider_sources`      | Monitored source (fixture/feed/OpenAPI), polling state (etag, hash, failures, last error)                  | unique `(provider_id, url)`; FK cascade                                                          |
| `source_snapshots`      | Immutable fetched content, `previous_snapshot_id` chain, `processed_at`                                    | unique `(source_id, content_hash)`                                                               |
| `change_events`         | Normalized upstream change: type, severity, `affected` (jsonb), dates, evidence, origin                    | unique `fingerprint` (dedupe key); indexes on provider, detected_at, severity; refs to snapshots |
| `repositories`          | Registered repository (`local` path or `git` URL)                                                          | unique `location`                                                                                |
| `repository_scans`      | Scan history: status, counts, warnings, stats, error                                                       | index `(repository_id, created_at)`; cascade                                                     |
| `detected_dependencies` | Provider SDK dependencies (manifest or lockfile), version, line                                            | unique `(scan_id, ecosystem, package_name, manifest_path, source)`                               |
| `indexed_files`         | Files seen by the latest scan (path, language, size, sha256; contents are **not** stored)                  | unique `(scan_id, path)`                                                                         |
| `call_sites`            | Call-site index (symbol, kind, snippet of at most 5 lines, confidence, resolved flag, file hash, metadata) | indexes on repository and `(provider_id, symbol)`                                                |
| `findings`              | Match of an event with a location, with explanation, evidence, limitations, remediation, status            | unique `fingerprint`; indexes on status, severity, repository, change                            |
| `job_records`           | Mirror of queue jobs (status, attempts, payload, result, error)                                            | unique `(queue, job_id)`                                                                         |
| `audit_events`          | Who did what (registrations, scans, status changes)                                                        | index `(entity_type, entity_id)`                                                                 |
| `app_settings`          | Key/value preferences (`monitoring`, `notifications`)                                                      | primary key `key`                                                                                |
| `notifications`         | Outbox of email messages produced by the (logging) transport                                               | -                                                                                                |

Enums: `severity`, `change_type`, `finding_status`, `match_kind`, `scan_status`, `source_kind`, `origin` (`demo`/`live`), `ecosystem`, `repo_source`, `dependency_source`, `call_site_kind`, `detection_method`.

## Behaviour worth knowing

- **Idempotency**: events dedupe on `fingerprint` (hash of provider, source and item identity, not of timestamps); snapshots dedupe on content hash; findings upsert on fingerprint and never overwrite `status`, `status_note` or `snoozed_until`.
- **Replace-on-scan**: `call_sites`, `indexed_files` and `detected_dependencies` hold the latest scan only. Findings keep `file_path`, `line` and `snippet` themselves; `call_site_id` is `ON DELETE SET NULL`. `last_seen_scan_id` tells whether a finding is still detected.
- **Timestamps** are `timestamptz`; `updated_at` is maintained by the application.
- **Secrets**: no tokens or credentials are stored. Snippets and error messages pass through the redactor.
- **Cascades**: deleting a repository removes its scans, index and findings; deleting a provider removes its sources, events and findings.
