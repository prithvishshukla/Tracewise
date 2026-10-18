# REST API

Base URL `http://127.0.0.1:4000`. Interactive documentation (generated from the same zod schemas used for validation): **`/docs`** (Swagger UI) and **`/docs/json`** (OpenAPI 3).

## Conventions

- JSON in and out. Dates are ISO-8601 strings (UTC).
- **Errors** always have the shape `{ "error": { "code": string, "message": string, "details"?: any } }`. Codes: `validation_error` (400), `unsafe_input` (400), `unauthorized` (401), `not_found` (404), `conflict` (409), `rate_limited` (429), `payload_too_large` (413), `internal_error` (500, message hidden in production mode).
- **Pagination**: `page` (default 1) and `pageSize` (default 20, max 100; files max 200). Responses: `{ items, page, pageSize, total, totalPages }`.
- **Auth**: demo mode has none. In `TRACEWISE_MODE=production` every `/api/*` request needs `Authorization: Bearer <API_TOKEN>`; `/health` stays open.
- **Rate limits** (per client, in memory): 300/min global; 20/min on `POST /api/repositories` and `POST /api/repositories/:id/scan`; 10/min on `POST /api/providers/:id/poll`.
- Request timeout 30 s, body limit 256 KB.

## Endpoints

| Method | Path                                 | Description                                                                                                                | Success |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------- |
| GET    | `/health`                            | Liveness plus database/Redis check                                                                                         | 200/503 |
| GET    | `/api/status`                        | Mode, queue mode, DB/Redis status, integration flags (never secrets), scan roots, git hosts                                | 200     |
| GET    | `/api/dashboard/stats`               | Totals, findings by severity, recent changes/scans, provider status                                                        | 200     |
| GET    | `/api/providers`                     | Providers with monitoring status                                                                                           | 200     |
| GET    | `/api/providers/:id`                 | Provider by id **or slug**, with sources and recent changes                                                                | 200     |
| POST   | `/api/providers/:id/poll`            | Queue a check of every enabled source. Live sources are skipped while live polling is disabled                             | 202     |
| GET    | `/api/changes`                       | Query: `q, provider, severity, changeType, origin (demo\|live), sort (newest\|oldest), page, pageSize`                     | 200     |
| GET    | `/api/changes/:id`                   | Change detail with linked findings                                                                                         | 200     |
| GET    | `/api/repositories`                  | Registered repositories with open-finding counts                                                                           | 200     |
| POST   | `/api/repositories`                  | Body `{ sourceType: "local"\|"git", location, name? }`                                                                     | 201     |
| GET    | `/api/repositories/:id`              | Repository detail (counts, latest scan)                                                                                    | 200     |
| POST   | `/api/repositories/:id/scan`         | Start a scan; returns the active scan if one is queued/running (`deduplicated: true`)                                      | 202     |
| GET    | `/api/repositories/:id/scans`        | Scan history                                                                                                               | 200     |
| GET    | `/api/repositories/:id/dependencies` | Detected provider dependencies                                                                                             | 200     |
| GET    | `/api/repositories/:id/files`        | Indexed files; query `q` filters by path                                                                                   | 200     |
| GET    | `/api/repositories/:id/findings`     | Findings of one repository (same filters as `/api/findings`)                                                               | 200     |
| GET    | `/api/scans/:id`                     | Scan status                                                                                                                | 200     |
| GET    | `/api/findings`                      | Query: `q, provider, repositoryId, severity, status, impact (verified\|possible), sort (severity\|newest), page, pageSize` | 200     |
| GET    | `/api/findings/:id`                  | Detail incl. snippet, evidence, limitations, remediation, related findings and the upstream change                         | 200     |
| PATCH  | `/api/findings/:id`                  | Body `{ status: open\|snoozed\|fixed\|false_positive, note?, snoozeDays? (1-365, default 7) }`                             | 200     |
| GET    | `/api/settings`                      | Monitoring and notification preferences                                                                                    | 200     |
| PUT    | `/api/settings`                      | Update preferences (validated)                                                                                             | 200     |

## Notes

- `POST /api/repositories` with a path outside `SCAN_ROOTS`, a relative path, a symlink that escapes, or a non-allow-listed/IP/`http` Git URL returns `400 unsafe_input`. A duplicate returns `409 conflict` with `details.id`.
- Findings whose code no longer appears in the latest scan keep their status and report `stillDetected: false`.
- A `snoozed` finding returns to `open` automatically once `snoozedUntil` has passed (evaluated on read and on matching).
