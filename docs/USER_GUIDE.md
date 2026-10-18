# Tracewise user guide

A step-by-step guide to **opening**, **using** and **understanding** Tracewise. Read it top to bottom once (about 15 minutes); afterwards use the table of contents.

1. [What Tracewise does, in one minute](#1-what-tracewise-does-in-one-minute)
2. [How to access it](#2-how-to-access-it)
3. [First-time setup (Windows 11)](#3-first-time-setup-windows-11)
4. [Guided tour of the demo](#4-guided-tour-of-the-demo)
5. [Scan your own repository](#5-scan-your-own-repository)
6. [How it works](#6-how-it-works)
7. [Reading a finding line by line](#7-reading-a-finding-line-by-line)
8. [Live monitoring](#8-live-monitoring)
9. [Using the API directly](#9-using-the-api-directly)
10. [Modes and configuration](#10-modes-and-configuration)
11. [Everyday operations](#11-everyday-operations)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary and FAQ](#13-glossary-and-faq)

---

## 1. What Tracewise does, in one minute

API providers (payments, messaging, LLMs, source hosting) regularly announce that an endpoint or SDK method is **deprecated** or **will be removed**. Most teams only learn about it when something breaks.

Tracewise does three things:

1. **Collects** upstream changes (from changelog feeds, release feeds, OpenAPI specs, or built-in simulated demo events) and turns each one into a structured _change event_: what changed, how serious, effective date, which SDK method or endpoint is affected.
2. **Reads your code** (without running it) and records where it uses each provider: SDK imports, SDK method calls, raw HTTP calls, and dependency versions.
3. **Connects the two.** A _finding_ is created only when your code really uses the thing that changed. Each finding says where (file and line), why it was flagged, how sure Tracewise is, how serious it is, and what to do next.

It never pretends to understand everything. If it cannot be sure (for example a method name built at runtime), it labels the result **Possible** and explains the uncertainty.

---

## 2. How to access it

Tracewise is a small set of local processes. After setup (section 3) you reach everything from your browser:

| What                            | URL / address                      | Notes                                                             |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| **Landing page**                | http://localhost:3000/             | Product overview and an example                                   |
| **Dashboard (start here)**      | http://localhost:3000/dashboard    | Totals, findings by severity, recent changes and scans            |
| Findings                        | http://localhost:3000/findings     | Everything that may affect your code                              |
| API changes                     | http://localhost:3000/changes      | The upstream change feed                                          |
| Providers                       | http://localhost:3000/providers    | Stripe, GitHub, Twilio, OpenAI and their sources                  |
| Repositories                    | http://localhost:3000/repositories | Register and scan repositories                                    |
| Settings                        | http://localhost:3000/settings     | Environment status, live-polling toggle, notification preferences |
| REST API                        | http://127.0.0.1:4000              | JSON API used by the web app                                      |
| **API documentation (Swagger)** | http://127.0.0.1:4000/docs         | Try every endpoint in the browser                                 |
| Health check                    | http://127.0.0.1:4000/health       | `{"status":"ok", "database":true, "redis":true}` when all is well |
| PostgreSQL                      | `localhost:5432`, db `tracewise`   | user `postgres`, password `tracewise` (local development only)    |
| Redis                           | `localhost:6379`                   | Job queue storage                                                 |

**Who can open it?** Only your own computer. The API listens on `127.0.0.1`, and demo mode has **no login**. Do not expose these ports to a network (see [Modes](#10-modes-and-configuration)).

**The five processes**

| Process    | Started by                              | What it does                                                               |
| ---------- | --------------------------------------- | -------------------------------------------------------------------------- |
| PostgreSQL | `docker compose up -d`                  | Stores providers, change events, repositories, scans, call sites, findings |
| Redis      | `docker compose up -d`                  | Holds the background job queues                                            |
| API        | `npm run dev:api` (or `npm run dev`)    | Validates requests, answers the web app, queues jobs                       |
| Worker     | `npm run dev:worker` (or `npm run dev`) | Does the heavy work in the background: scanning, polling feeds, matching   |
| Web        | `npm run dev:web` (or `npm run dev`)    | The user interface; forwards browser requests to the API                   |

---

## 3. First-time setup (Windows 11)

You need: **Node.js 20.11 or newer**, **npm**, **VS Code**, and **Docker Desktop** (for PostgreSQL and Redis). Git is only needed if you will scan Git URLs.

Open the extracted `tracewise` folder in VS Code, open a terminal (**Terminal > New Terminal**, PowerShell) and run these one at a time:

```powershell
Copy-Item .env.example .env     # 1. create your settings file
npm install                     # 2. install dependencies (a few minutes the first time)
docker compose up -d            # 3. start PostgreSQL and Redis (Docker Desktop must be running)
npm run db:migrate              # 4. create the database tables
npm run db:seed                 # 5. load the demo data
npm run dev                     # 6. start API + worker + web
```

What you should see:

- Step 4 prints `Migrations applied to postgres://postgres:****@127.0.0.1:5432/tracewise`.
- Step 5 prints `Demo data seeded.` with `open findings: 6 (critical: 1, verified: 4)`.
- Step 6 prints lines tagged `[api]`, `[worker]` and `[web]`. Wait until the web line says it is ready (first start takes a few seconds).

**Check it works:** open http://127.0.0.1:4000/health (should show `"status":"ok"`) and then http://localhost:3000/dashboard.

To stop everything press **Ctrl+C** in the terminal. To stop the containers too: `docker compose down` (your data is kept; add `-v` to wipe it).

Prefer separate terminals (easier to read logs)? Run `npm run dev:api`, `npm run dev:worker` and `npm run dev:web` in three terminals.

> No Docker? Install PostgreSQL 16 for Windows, set `DATABASE_URL` in `.env`, and set `QUEUE_MODE=inline` so no Redis or worker is needed (the API then runs jobs itself). Details: [Troubleshooting](#12-troubleshooting).

---

## 4. Guided tour of the demo

The demo is **deterministic**: everyone sees the same numbers. All provider announcements in it are **simulated** (they carry a violet **DEMO DATA** badge) and the "repository" is a small fake shop in `fixtures/sample-repositories/demo-shop`. No API key and no internet are needed.

### Step 1: Dashboard (`/dashboard`)

You should see: **4** monitored providers, **1** repository, **6** open findings (4 verified), **1** critical finding; a bar chart of open findings by severity (1 critical, 1 high, 4 medium); recent upstream changes; the latest scan; and provider monitoring status ("Demo data only").

### Step 2: The upstream changes (`/changes`)

12 changes: 5 breaking, 5 deprecations, 1 warning, 1 informational. Seven belong to Stripe (three simulated announcements plus four detected by **comparing two versions of a mini OpenAPI spec**), three to OpenAI, one each to Twilio and GitHub. Try the filters (provider, severity, type, origin) and the search box; the filters are stored in the address bar, so a filtered view can be bookmarked.

Open any change to see its summary, the **affected symbols or endpoints**, the evidence, a suggested remediation, and which of your code locations it hits. The informational Stripe change lists no affected symbol, so it can never produce a finding.

### Step 3: Findings (`/findings`)

Six findings, sorted by severity:

| Severity | Impact       | Where                | Why                                                                                         |
| -------- | ------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| Critical | Verified     | `src/legacy.py:11`   | `openai.ChatCompletion.create` was removed and the removal date has already passed          |
| High     | Verified     | `src/payments.ts:8`  | `stripe.charges.create` will be removed; the Stripe client is traced from `new Stripe(...)` |
| Medium   | Verified     | `src/legacy.py:18`   | `requests.post("https://api.stripe.com/v1/charges")` calls a deprecated endpoint            |
| Medium   | Verified     | `src/notify.ts:5`    | `fetch` POSTs to the Twilio Messages endpoint whose parameter is deprecated                 |
| Medium   | **Possible** | `requirements.txt:2` | `openai==0.28.1` is inside the unsupported range `<1.0.0`, but this does not prove a call   |
| Medium   | **Possible** | `src/dynamic.ts:12`  | The method name is computed at runtime; this call _might_ reach `stripe.charges.create`     |

Just as important: **files that must not be flagged are not flagged**: `src/ai.ts` (modern OpenAI call), `src/github.ts` (uses the GitHub SDK but not the changed endpoint), `src/lookalike.ts` (a local class with a similar-looking method), `src/server.ts` (a route with the same path but no provider SDK). Using a provider is not enough; the _changed API_ must be used.

### Step 4: Open the critical finding

Click the top finding. From top to bottom you will see the severity/impact/status badges, **Affected code** (the snippet with the matching line highlighted), **Why this was flagged**, **Evidence**, **Suggested next step**, a **Status** panel, the **upstream change**, and related findings. Section 7 explains each part.

### Step 5: Change its status and see that it persists

In the Status panel click **Snoozed** (hides the finding for 7 days, then it reopens automatically), then **Fixed**. Go back to `/findings`, filter by status "Fixed", and refresh the page: the change is stored in PostgreSQL, not just in the browser. The dashboard's open-findings count drops from 6 to 5.

### Step 6: Providers and repositories

- `/providers/stripe` lists the monitored **sources**: the demo ones (read from local files) and live ones (public GitHub release feeds, whose last check reads _never_ until you enable live polling). The **Check sources now** button queues a check.
- `/repositories` lists `demo-shop`. Open it to see detected dependencies (e.g. `stripe 14.5.0`, `openai 0.28.1` for Python), 12 indexed files, 15 provider call sites, scan history, and a **warning** about a deliberately malformed `tools/legacy-service/package.json` (a bad file is reported, it never aborts the scan). Click **Scan again** to watch a scan run through the queue; the finding statuses you set are kept.

To go back to a clean demo at any time: `npm run db:reset` then `npm run db:seed`.

---

## 5. Scan your own repository

1. **Allow the folder.** Tracewise only reads directories you explicitly allow (a safety rule, see Security in the README). Edit `.env`:

   ```
   SCAN_ROOTS=C:\Users\you\projects;C:\path\to\tracewise\fixtures\sample-repositories
   ```

   Use `;` between folders on Windows. Keep the `sample-repositories` entry if you still want to re-scan the demo. **Restart the API and the worker** (Ctrl+C, `npm run dev`) because settings are read at start-up.

2. **Register it.** Go to **Repositories**, choose _Local directory_, paste the absolute path (for example `C:\Users\you\projects\my-app`) and click **Register**. The browser cannot read your disk; the API process reads the folder, and only inside `SCAN_ROOTS`. Errors are explicit, e.g. _"Directory is outside the allowed scan roots"_.

   Alternatively choose _Git URL (https)_ and paste something like `https://github.com/owner/repo` (hosts allowed by default: github.com, gitlab.com, bitbucket.org). Tracewise makes a shallow, restricted clone into a temporary folder, scans it and deletes it.

3. **Scan.** The repository page opens; click **Start first scan**. A scan usually takes seconds. Nothing in your repository is executed; files are only read and parsed.

4. **Read the result.** The repository page shows detected provider dependencies, indexed files and call sites. If no known provider SDK is found you will see an explicit empty state. **Findings appear only when an upstream change in the feed matches something your code uses.** With the demo data that means Stripe, OpenAI, Twilio or GitHub APIs; to get findings for real announcements enable live monitoring ([section 8](#8-live-monitoring)).

Supported today: TypeScript/JavaScript (`.ts .tsx .js .jsx .mjs .cjs`) and Python (`.py`); manifests `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements*.txt`, `pyproject.toml`. Folders such as `node_modules`, `.git`, `dist`, `build`, `.venv` are skipped.

---

## 6. How it works

### The big picture

```
 UPSTREAM SIDE                                              YOUR CODE SIDE
 ─────────────                                              ──────────────
 demo fixtures / RSS & Atom feeds / OpenAPI specs           local folder or https Git URL
        │ provider-poll job                                        │ repository-scan job
        ▼                                                          ▼
 immutable snapshot (hashed)                               scanner (reads files, never runs them)
        │ change-processing job                              ├─ dependencies (manifests, lockfiles)
        ▼                                                    ├─ SDK imports and calls (AST)
 change events (deduplicated)                                └─ raw HTTP calls to provider hosts
        │                                                          ▼
        └──────────────┐                                  call-site index (latest scan)
                       ▼                                           │
                 finding-generation job  ◄─────────────────────────┘
                 (matcher: event  vs  call sites / dependencies)
                       ▼
                    findings  ──►  notifications  ──►  web UI (dashboard, findings, detail)
```

Each box labelled "job" runs in the background worker through Redis (BullMQ), with automatic retries and backoff, so the web UI stays fast. In `QUEUE_MODE=inline` the API runs the same jobs itself.

### A worked example: `stripe.charges.create`

**1. The upstream change.** A (simulated) announcement says _"`stripe.charges.create` will be removed on 2026-12-01"_. Tracewise stores a change event: type **breaking**, base severity **high**, affected item `sdk_symbol: stripe.charges.create`, a source quote as evidence and a remediation hint ("use `stripe.paymentIntents.create`").

**2. The scan.** In `src/payments.ts` the scanner sees:

```ts
import Stripe from 'stripe';                      // line 1: imports the Stripe SDK
const stripe = new Stripe('sk_test_...');         // line 4: `stripe` is a client built from that SDK
...
return stripe.charges.create({ ... });            // line 8: a call on that client
```

It records a call site: file `src/payments.ts`, line 8, canonical symbol `stripe.charges.create`, **resolved = true** (the variable `stripe` was traced back to `new Stripe(...)`), plus a short snippet around the line. Secrets inside snippets (like that key) are replaced by `[REDACTED:...]` before anything is stored. Only the snippet is kept, never the whole file.

**3. The match.** The matcher compares the event's affected symbol with call sites of the same provider. It is an exact symbol match on a resolved call, so confidence is **0.95** (≥ 0.85, so it is **Verified**). The call `stripe.paymentIntents.create` on line 13 is _not_ the affected symbol and is ignored.

**4. The finding.** It receives severity **high** (the event's severity), an explanation, limitations ("clients are traced within a single file"), the evidence list (announcement, import line, call site) and the remediation text plus timing ("takes effect on 2026-12-01 (N days from now)"). It is stored with status **Open**.

### Match types and how sure Tracewise is

| Match type          | When it applies                                                                                         | Confidence                                |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Exact SDK symbol    | A call on a client traced to the SDK has exactly the affected symbol                                    | 0.95                                      |
| Known endpoint      | A request to the provider's host whose path (and method, if known) matches the affected endpoint        | 0.92 (0.82 if the HTTP method is unknown) |
| API path only       | The path matches but there is no host evidence; only used when the repository clearly uses the provider | 0.60                                      |
| Package version     | A dependency's version falls inside the affected range (lockfile 0.70, pinned 0.65, range only 0.50)    | 0.50 to 0.70                              |
| Unresolved receiver | Same method chain, but the variable could not be traced to the SDK (the file does import the SDK)       | 0.55                                      |
| Dynamic call        | A method name is computed at runtime and its static prefix overlaps the affected symbol                 | 0.35                                      |
| Pattern             | A regular expression supplied by the event matched a provider call site                                 | 0.40                                      |

**Verified** means confidence ≥ 0.85: concrete static evidence that the changed API is used. **Possible** means anything lower: a lead to investigate, not a confirmed impact.

### How severity is decided

Start from the upstream event's severity, then adjust:

- A **breaking** change whose effective date has **already passed** and whose match is **verified** becomes **Critical**.
- **Package-version** matches never exceed **Medium** (a vulnerable version does not prove a call).
- A match with confidence **below 0.5** is lowered one level.

### What makes it safe to re-run

- **Snapshots** are hashed: polling an unchanged source creates nothing.
- **Change events** have a fingerprint: the same announcement can never be stored twice.
- **Findings** have a fingerprint that deliberately ignores line numbers: after you edit code and re-scan, the same finding is **updated** (new line number) rather than duplicated, and **your status is kept**. If the code disappears, the finding stays but shows _"No longer detected"_ so you can mark it fixed.

### Demo data vs live data

Every change event has an **origin**. `demo` events come from the fixture files in `fixtures/provider-changes/`, always have titles starting with `[DEMO]`, use `example.invalid` links and are labelled **DEMO DATA** everywhere. `live` events come from real public feeds you enabled. The two are never mixed up.

---

## 7. Reading a finding line by line

| Section                | What it tells you                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Badges                 | **Severity**, **Verified/Possible**, **status**, and **DEMO DATA** when the upstream change is simulated                    |
| Title                  | "Breaking change affects `symbol` in `file`"; starts with **Possible impact:** when confidence is below 0.85                |
| Possible-impact banner | Appears only for possible impacts and states the limitation in plain words                                                  |
| Affected code          | The stored snippet (up to five lines) with line numbers; the matched line is highlighted                                    |
| Why this was flagged   | The match type and the exact reason, followed by a plain-language explanation and the **limitations** of that kind of match |
| Evidence               | The announcement quote, the import of the SDK in this file, the call site, or the dependency that matched                   |
| Suggested next step    | What to change, plus the effective date and how many days remain (or how long ago it took effect)                           |
| Status                 | Open, Snoozed (7 days), Fixed, False positive; stored in the database                                                       |
| Details                | Confidence meter, provider, repository, first seen and last updated                                                         |
| Upstream change        | Link to the change that triggered the finding                                                                               |
| Related findings       | Other findings in the same file or from the same change                                                                     |

A good workflow: start with **Critical** and **Verified** findings, read the evidence, fix the code, re-scan, and mark the finding **Fixed**. Treat **Possible** findings as questions: investigate, then mark **False positive** if the code is unaffected.

---

## 8. Live monitoring

Out of the box, Tracewise only reads local demo files and contacts **no external server**. To watch real public sources:

1. Open **Settings** and tick **Poll live sources**, then **Save settings** (or set `ENABLE_LIVE_POLLING=true` in `.env`).
2. The worker checks each live source on a schedule (default every 360 minutes; change the interval in Settings and restart the worker). Or press **Check sources now** on a provider page.
3. Live sources in the catalog are the GitHub release Atom feeds of the Stripe, OpenAI and Twilio SDKs and the Octokit SDK, plus GitHub's changelog feed (that last URL could not be verified from the authoring environment, so a failure there is possible). Every request uses conditional headers (ETag), timeouts, retries with backoff and a per-host concurrency limit; a failed check is recorded as a failure (red status on the provider page), never as a success.

**What to expect.** Release feeds are free text. Tracewise keeps only entries that mention words such as _deprecated_, _removed_, _sunset_ or _breaking change_, and labels them with modest confidence (at most 0.75). Most such entries do **not** name an exact method or endpoint, so they appear in the change feed but produce **no findings**. When a note does name a symbol in code formatting (for example `stripe.charges.create`) or an endpoint such as `POST /v1/charges`, Tracewise extracts it and the matcher can create findings. Always open the linked source to check the wording.

Optional: an AI-assisted extractor can suggest affected symbols from public changelog text. It is off by default (`LLM_PROVIDER=none`); see `.env.example`. It never sees your code.

---

## 9. Using the API directly

Interactive documentation: **http://127.0.0.1:4000/docs** (open an endpoint, press _Try it out_).

PowerShell examples:

```powershell
# Dashboard numbers
Invoke-RestMethod http://127.0.0.1:4000/api/dashboard/stats

# The five most severe open findings
(Invoke-RestMethod "http://127.0.0.1:4000/api/findings?status=open&pageSize=5").items |
  Select-Object severity, impact, filePath, line, title

# Mark a finding fixed (replace <id> with an id from the list above)
Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:4000/api/findings/<id> `
  -ContentType 'application/json' -Body '{"status":"fixed"}'

# Register and scan a repository
$repo = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/repositories `
  -ContentType 'application/json' -Body '{"sourceType":"local","location":"C:\\Users\\you\\projects\\my-app"}'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/api/repositories/$($repo.id)/scan"
```

(`curl.exe` works the same way. These HTTP calls were exercised with curl in the authoring environment; the PowerShell cmdlets are standard but were not run there.)

Useful filters: `/api/findings?severity=critical`, `?impact=verified`, `?provider=openai`, `?repositoryId=<id>`, `?q=payments`; `/api/changes?changeType=breaking&origin=live`. Errors always look like `{"error":{"code":"...","message":"..."}}`. Full reference: [API.md](API.md).

---

## 10. Modes and configuration

| Setting               | Values             | Meaning                                                                                                                                          |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRACEWISE_MODE`      | `demo` (default)   | No authentication. Intended for local use with seeded data.                                                                                      |
|                       | `production`       | Requires `API_TOKEN`; every `/api/*` call needs `Authorization: Bearer <token>`. Set `TRACEWISE_API_TOKEN` to the same value for the web server. |
| `QUEUE_MODE`          | `bullmq` (default) | Jobs go through Redis to the separate worker process.                                                                                            |
|                       | `inline`           | The API runs jobs itself. No Redis or worker needed (good for a quick look without Docker).                                                      |
| `SCAN_ROOTS`          | folders            | The only places local repositories may live. `;` separated on Windows.                                                                           |
| `ENABLE_LIVE_POLLING` | `false` (default)  | Whether public feeds may be contacted (also togglable in Settings).                                                                              |

Important: **production mode is not a complete login system.** It protects the API with one shared token; the web interface itself still has no user accounts. See [SECURITY.md](SECURITY.md) for what remains before a real deployment. After editing `.env`, restart the processes.

---

## 11. Everyday operations

| I want to...                     | Do this                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| Start everything                 | `docker compose up -d` then `npm run dev`                             |
| Stop everything                  | Ctrl+C, then `docker compose down`                                    |
| Re-scan after changing my code   | Repository page > **Scan again**                                      |
| Reset to a clean demo            | `npm run db:reset` then `npm run db:seed`                             |
| Run the tests                    | `npm test` (uses an in-process database; Docker not required)         |
| Check code quality               | `npm run typecheck`, `npm run lint`                                   |
| Measure detection quality        | `npm run benchmark` (see [BENCHMARKS.md](../BENCHMARKS.md))           |
| Change a port                    | Edit `API_PORT` and `API_URL` in `.env` (web uses port 3000); restart |
| See what the background jobs did | Table `job_records` in PostgreSQL (status, attempts, errors)          |

---

## 12. Troubleshooting

| Symptom                                             | Likely cause                                                   | Fix                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432` / `:6379`             | PostgreSQL or Redis is not running                             | Start Docker Desktop, run `docker compose up -d`, check `docker compose ps`     |
| Web page shows "Cannot reach the Tracewise API"     | The API is not running or `API_URL` is wrong                   | Run `npm run dev:api`; open http://127.0.0.1:4000/health                        |
| Scan stays **queued**                               | The worker is not running                                      | Run `npm run dev:worker` (or use `QUEUE_MODE=inline`)                           |
| "Could not enqueue the scan job. Is Redis running?" | Redis is down while `QUEUE_MODE=bullmq`                        | Start Redis, or switch to `QUEUE_MODE=inline`                                   |
| "Directory is outside the allowed scan roots"       | Folder not covered by `SCAN_ROOTS`                             | Add it to `SCAN_ROOTS`, restart API and worker                                  |
| Re-scanning the demo repo now fails                 | `SCAN_ROOTS` no longer includes `fixtures\sample-repositories` | Add that folder back to `SCAN_ROOTS`                                            |
| "Path is not a directory" / "does not exist"        | Typo, or a relative path                                       | Use an absolute path                                                            |
| Git URL rejected                                    | Not https, host not allowed, or an IP address                  | Use `https://github.com/owner/repo`; extend `GIT_ALLOWED_HOSTS` if needed       |
| Dashboard shows 0 everywhere                        | Demo data not loaded                                           | `npm run db:seed`                                                               |
| Live source shows last check "never"                | Live polling is off                                            | Enable it in Settings, then press **Check sources now**                         |
| Live provider shows "Live: failing"                 | Network blocked or feed unavailable                            | Open the provider page to read the recorded error; retries happen automatically |
| `EADDRINUSE` (port in use)                          | Another program uses 3000 or 4000                              | Stop it or change the port as described above                                   |
| No findings for my repository                       | No current change affects APIs your code uses                  | Expected. Findings need a matching upstream change; enable live monitoring      |
| Unknown or malformed link shows "Not found"         | Invalid id in the address                                      | Go back to the list page                                                        |

Still stuck? Check the three terminal logs (`[api]`, `[worker]`, `[web]`) and the README's Troubleshooting section.

---

## 13. Glossary and FAQ

**Provider**: an API vendor in the catalog (Stripe, GitHub, Twilio, OpenAI). Each is a JSON file listing package names, API hosts and sources.
**Source**: where changes are read from: a local fixture file, an RSS/Atom feed, or an OpenAPI spec.
**Snapshot**: an immutable, hashed copy of a source's content at one moment.
**Change event**: one normalized upstream change (type, severity, affected symbols/endpoints, dates, evidence, origin).
**Call site**: one place in your code that uses a provider (SDK call, HTTP request, import).
**Finding**: a match between a change event and a place in your repository.
**Verified / Possible**: confidence at or above / below 0.85.
**Confidence**: how sure the match is (0 to 1). **Severity**: how urgent it is (critical, high, medium, low, info).
**Origin**: `demo` (simulated) or `live` (from a real feed).
**Fingerprint**: a hash that identifies "the same thing" so repeated runs do not create duplicates.
**Inline mode**: running background jobs inside the API process instead of through Redis.

**Does Tracewise run my code?** No. It reads and parses files only.
**Does it upload my code anywhere?** No. Repository contents are not sent to any external service. Only short, redacted snippets are stored in your own database. The optional AI extractor receives public changelog text only.
**Why did it not flag a file that uses Stripe?** Using the provider is not enough; the _changed_ method or endpoint must be used.
**Why is a finding marked Possible?** The evidence is partial: an untraceable receiver, a runtime-built method name, or a dependency version match. Read its limitations.
**Can it miss things?** Yes. Analysis is per file: a client created in one file and used in another, or an alias such as `const ch = stripe.charges`, is not followed. These limits are documented and measured in [BENCHMARKS.md](../BENCHMARKS.md).
**Is the demo data real?** No. Everything labelled DEMO DATA is simulated for demonstration.
**Where is the code?** `apps/web` (UI), `apps/api` (REST API), `apps/worker` (background jobs), `packages/scanner` (code analysis), `packages/matcher` (matching), `packages/providers` (sources and parsing), `packages/core` (services), `packages/database` (schema and migrations). See [ARCHITECTURE.md](ARCHITECTURE.md).
