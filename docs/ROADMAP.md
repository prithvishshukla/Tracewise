# Roadmap

**Next (small, high value)**

1. Cross-file client tracing: resolve `import { stripe } from './stripeClient'` by indexing exported client bindings per repository.
2. Authentication (Auth.js/OIDC) and organization-scoped tenancy; replace the static token.
3. Playwright end-to-end tests for the demo flow; verify the Docker app profile; verify behaviour on Windows.
4. Real email transport (SMTP) behind the existing `EmailTransport` interface.

**Then** 5. GitHub App: installation, webhooks (push, installation), incremental indexing by blob SHA, per-repository configuration. 6. Slack notifications; GitHub issue/PR creation (read-only suggestions first; never auto-merge). 7. CI check mode (fail a PR that adds use of an API past its sunset date). 8. More languages (Go, Java, PHP, Ruby) via tree-sitter query packs; scoped (non-flat) bindings. 9. More providers and real OpenAPI sources (streaming/size-aware diff for multi-megabyte specs; `$ref` resolution; request-body schema diffs). 10. Evaluation on real repositories with hand-labelled usages; track precision/recall in CI.

**Later** 11. Deadline reminders (90/30/7 days), digest scheduling, snooze policies. 12. Internal API contract drift (your own services' OpenAPI) using the same diff engine. 13. SSO, audit-log export, self-hosted scan runners.
