# Benchmarks

This file contains **only values that were measured by running the commands below**. It makes no claim about accuracy on real-world repositories: no such evaluation has been done yet.

## 1. Methodology

| Measurement         | Command                                                                            | Data                                                                                                                                                                            | What it measures                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Call-site detection | `npm run benchmark` (section 1), `npx vitest run tests/callsite-benchmark.test.ts` | `fixtures/benchmarks/callsite-cases.json` (37 small labelled code snippets: 19 TS/JS positives, 7 TS/JS negatives, 8 Python (6 positive, 2 negative), 3 documented limitations) | Whether the analyzers report exactly the expected **resolved** `sdk_call` / `http_call` symbols per snippet |
| End-to-end findings | `npm run benchmark` (section 2), `npx vitest run tests/pipeline.test.ts`           | `fixtures/sample-repositories/demo-shop` + simulated events, ground truth in `expected-findings.json`                                                                           | Whether seed -> scan -> match produces exactly the expected findings and none for the `mustNotMatch` files  |
| Scan throughput     | `npm run benchmark` (section 3)                                                    | Generated TypeScript repositories (63 lines per file, one SDK import per file, a call in every 7th file)                                                                        | Wall-clock time of `scanRepository` after one warm-up run                                                   |

### Precision and recall

For each case, `expected` is the set of symbols a human labelled; `got` is the set of resolved symbols the analyzer produced. Across all cases:

- TP = symbols in both, FP = symbols in `got` but not `expected`, FN = symbols in `expected` but not `got`.
- Precision = TP / (TP + FP). Recall = TP / (TP + FN).

For end-to-end findings, a finding is identified by `(change event, file, match kind)`; the same formulas apply.

### Adding your own data

Append cases to `fixtures/benchmarks/callsite-cases.json` (`id`, `language`, `code`, `expected`, optional `knownLimitation`). For real repositories, hand-label usages of a few providers, put the expected findings in a JSON file shaped like `expected-findings.json`, and compare as above. Record the repository, commit and labelling rules next to the results.

## 2. Results (measured 2026-10-10)

Environment: Node v22.22.2, Intel Xeon @ 2.80 GHz x1 (1 vCPU), Linux x64. Single run after one warm-up; expect variance.

### Call-site detection (37 labelled synthetic cases)

| Subset                                        | TP  | FP  | FN  | Precision | Recall |
| --------------------------------------------- | --- | --- | --- | --------- | ------ |
| All cases (3 documented limitations included) | 29  | 1   | 2   | 0.967     | 0.935  |
| Excluding documented limitations              | 29  | 0   | 0   | 1.000     | 1.000  |

The three documented limitations are failures **by design of the current analyzer**: `lim-cross-file-wrapper` (FN: client created in another file), `lim-intermediate-alias` (FN: `const ch = s.charges; ch.create()`), `lim-name-shadowing` (FP: a parameter shadows the SDK client name). The test suite pins this behaviour so that an improvement is noticed and this file updated.

### End-to-end findings (demo scenario)

| Expected findings | Produced findings | TP  | FP  | FN  | Precision | Recall |
| ----------------- | ----------------- | --- | --- | --- | --------- | ------ |
| 6                 | 6                 | 6   | 0   | 0   | 1.000     | 1.000  |

Seeding (catalog sync, 12 events, scan, matching, in-process PGlite): 502 ms.

### Scan throughput

| Files | Lines per file | Scan time (ms) | Files/sec | Call sites |
| ----- | -------------- | -------------- | --------- | ---------- |
| 100   | 63             | 146            | 685       | 115        |
| 500   | 63             | 719            | 696       | 572        |
| 2000  | 63             | 2816           | 710       | 2286       |

## 3. How to read these numbers (important)

- The labelled cases and the demo repository were **written by the same developer who wrote the analyzer**, and the analyzer was adjusted while building them (the benchmark exposed one false positive, `new Stripe.default(...)` being reported as an SDK call, which was fixed). Perfect scores on the non-limitation subset and on the demo are therefore a regression check, **not** evidence of accuracy on unseen code.
- The cases are tiny, synthetic and cover only Stripe, OpenAI, Twilio and Octokit-style APIs, in TypeScript/JavaScript and Python.
- Scan throughput is for small, regular files on a single vCPU; real repositories vary in file size and structure. Python scanning (tree-sitter WASM) is not included in the throughput table.
- Matching precision in real repositories also depends on the quality of change events. Events extracted from feeds by keyword rules carry low confidence and usually list no affected symbols; they produce no findings.

## 4. Other measured facts (not benchmarks)

- Full backend suite: 196 tests pass on PGlite and 196 on PostgreSQL 16 (see `CHATGPT_HANDOFF.md` for the commands and the final recorded run).
- Real-network check (authoring environment): polling the `stripe-node` and `openai-python` GitHub releases Atom feeds succeeded, stored an ETag, and a second poll returned `not_modified` (HTTP 304). Polling `https://github.blog/changelog/feed/` could not be verified because that host was not reachable from the authoring sandbox.
- Real-network check: a restricted shallow clone of `https://github.com/octocat/Hello-World` succeeded, was scanned (0 supported files), and its temporary directory was removed.
