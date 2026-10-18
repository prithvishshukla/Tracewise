# Scanner

Package `@tracewise/scanner`. Entry point: `scanRepository({ rootDir, providers, limits })`. It reads files and **never executes repository code**.

## Pipeline

1. `walkRepository` lists candidate files without following symlinks. Ignored directories: `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `coverage`, `__pycache__`, `.venv`/`venv`, `vendor`, `target`, and others (see `IGNORED_DIRS`). Generated files (`*.min.js`, `*.d.ts`, `*.map`, files starting with `@generated`/`DO NOT EDIT`) and unsupported types are skipped and counted in `stats.skipped`.
2. Limits (defaults, configurable): 5000 files, 1 MB per source file (5 MB per manifest), 50 MB total, 60 s. Hitting a limit sets `stats.truncated` and adds a warning; results are partial, never silently complete.
3. Binary content (NUL bytes) is skipped.
4. Manifests go to the dependency parsers; source files go to the JS/TS or Python analyzer. A failure in one file becomes a warning (for example `Malformed package.json`) and does not abort the scan.

## Dependency detection

`package.json` (dependencies, devDependencies, peerDependencies, optionalDependencies), `package-lock.json` (v1 and v2/v3, top-level packages only), `pnpm-lock.yaml` (importers format and top-level format, `packages` keys as fallback), `yarn.lock` (v1 and Berry), `requirements*.txt`, `pyproject.toml` (PEP 621 and Poetry). Only packages of known providers are recorded. Transitive dependencies are **not** resolved. Each entry carries package, spec, resolved version (lockfile preferred), ecosystem, provider, manifest path, line, and confidence (0.95 manifest, 0.99 lockfile).

## JavaScript / TypeScript analyzer (TypeScript compiler AST)

- Bindings: default/namespace/named imports, `require(...)`, destructured `require`, `import x = require()`.
- Client tracking: `const c = new Stripe(...)`, `Stripe(...)`, `new Ns.default(...)`, class properties, `this.x = new ...`, constructor parameter properties and function parameters typed with the SDK type.
- Calls: member chains (also `?.` and string element access) on a traced client become `sdk_call` with a canonical symbol (`stripe.charges.create`). Computed member access becomes `dynamic_call` with its static prefix. Receivers that cannot be traced are kept as low-confidence candidates **only** in files that import a provider SDK.
- HTTP: `fetch`, `axios`, `got`, `ky`, `request` with literal URLs, template literals, string concatenation and same-file `const` strings. `octokit.request('GET /path')` is parsed as an endpoint. Provider-host string literals elsewhere become `endpoint_literal`.
- Snippets: matched line plus two lines of context, lines truncated to 200 characters, secrets redacted.

## Python analyzer

tree-sitter (`web-tree-sitter` + `tree-sitter-wasms`, no native build) extracts imports, assignments, typed parameters and call chains; a regex extractor is used automatically if the WASM parser cannot load (`stats.pythonParser` reports which). Raw HTTP is detected line by line (`requests`, `httpx`, `aiohttp`, `urlopen`...) with f-string placeholders normalized to `{}`. Documented limitation: no data flow through variables.

## Confidence values

| Detection                                        | Confidence |
| ------------------------------------------------ | ---------- |
| Import of a provider SDK                         | 0.99       |
| SDK call on a traced client                      | 0.95       |
| HTTP call with literal provider URL              | 0.90       |
| Provider URL literal outside a recognised call   | 0.70       |
| Path-only literal with provider evidence in file | 0.60       |
| Unresolved receiver (name match, SDK imported)   | 0.40       |
| Dynamic member access                            | 0.30       |

The matcher turns these into finding confidences (see `packages/matcher/src/index.ts`).

## Known limitations

Per-file analysis only (no cross-file client tracing); variable shadowing is not modelled (flat bindings per file); aliasing a sub-resource (`const ch = s.charges`) is not followed; template-literal and concatenation resolution is limited to same-file `const` strings; no support yet for Go/Java/PHP/Ruby. These are exercised by the labelled cases in `fixtures/benchmarks/callsite-cases.json` (see `BENCHMARKS.md`).
