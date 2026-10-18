import { Activity, ArrowRight, FileSearch, GitPullRequestArrow, Radar, ShieldCheck, Workflow } from 'lucide-react';
import Link from 'next/link';

const STEPS = [
  {
    icon: Radar,
    title: 'Watch upstream',
    text: 'Provider adapters read changelog feeds, release feeds and OpenAPI specs, and normalize deprecations and breaking changes into structured events.',
  },
  {
    icon: FileSearch,
    title: 'Index your code',
    text: 'The scanner reads package manifests and source files (TypeScript, JavaScript, Python) and records SDK calls and raw HTTP requests, without executing anything.',
  },
  {
    icon: Workflow,
    title: 'Match deterministically',
    text: 'An event only produces a finding when the changed symbol, endpoint or version range appears in your code. Using the same provider is not enough.',
  },
  {
    icon: ShieldCheck,
    title: 'Act with context',
    text: 'Every finding shows the code location, the evidence, a confidence level, and what to do next. Verified and possible impacts are kept apart.',
  },
];
const CAPS = [
  ['Repository-aware impact analysis', 'Connect an upstream change to the exact file and line that uses the affected API.'],
  ['Source-linked evidence', 'Findings quote the announcement, the import and the call site, so reviewers can check the reasoning.'],
  ['Honest uncertainty', 'Dynamic or untraceable code is reported as a possible impact with its limitations, never as a confirmed one.'],
  ['Risk prioritisation', 'Severity reflects the change type, timing and match confidence. Overdue breaking changes surface first.'],
  ['Historical tracking', 'Change events, snapshots and finding status history are stored, so you can see what changed and when.'],
  ['Safe by design', 'Path and symlink restrictions, size limits, secret redaction in stored snippets, and an SSRF-guarded fetcher.'],
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Activity className="h-5 w-5 text-cyan-400" aria-hidden /> Tracewise
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-6 text-sm text-muted">
          <a href="#how" className="hover:text-fg">
            How it works
          </a>
          <a href="#capabilities" className="hover:text-fg">
            Capabilities
          </a>
          <a href="#technical" className="hidden hover:text-fg sm:block">
            Technical
          </a>
          <Link href="/dashboard" className="rounded-lg bg-accent px-3.5 py-2 font-medium text-white hover:bg-blue-500">
            Open dashboard
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-14 text-center">
          <p className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            <GitPullRequestArrow className="h-3.5 w-3.5 text-cyan-400" aria-hidden /> API change intelligence for developers
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Know what breaks before your APIs do.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
            Tracewise connects upstream API changes to the code that uses them, so your team can investigate deprecations before they become
            incidents.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 font-medium text-white hover:bg-blue-500"
            >
              Open the dashboard <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="#example" className="rounded-lg border border-line bg-surface px-5 py-3 font-medium hover:border-accent/60">
              See an example
            </a>
          </div>
        </section>

        <section id="example" className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="example-h">
          <h2 id="example-h" className="sr-only">
            Example
          </h2>
          <p className="mb-3 text-center text-xs uppercase tracking-wide text-muted">Illustrative example. Not real provider data.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">1 · Upstream announcement</p>
              <p className="mt-3 font-medium">
                SDK method <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[13px]">payments.charges.create</code> will be
                removed on 2026-12-01
              </p>
              <p className="mt-2 text-sm text-muted">
                Classified as a <span className="text-orange-300">breaking change</span>. Replacement: create a payment intent instead.
              </p>
              <div className="mt-4 rounded-lg border border-line bg-bg p-3 text-sm">
                <p className="text-xs text-muted">Affected symbol</p>
                <code className="font-mono text-[13px]">payments.charges.create</code>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">2 · Finding in your repository</p>
              <pre
                className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg py-2 font-mono text-[13px] leading-6"
                aria-label="Example code with an affected line highlighted"
              >
                <code className="block min-w-max">
                  <span className="flex px-3">
                    <span className="w-8 select-none text-muted/70">11</span>
                    {'export async function charge(id: string) {'}
                  </span>
                  <span className="flex bg-red-500/10 px-3 shadow-[inset_3px_0_0_#f87171]">
                    <span className="w-8 select-none text-muted/70">12</span>
                    {'  return client.charges.create({ customer: id });'}
                  </span>
                  <span className="flex px-3">
                    <span className="w-8 select-none text-muted/70">13</span>
                    {'}'}
                  </span>
                </code>
              </pre>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-orange-500/15 px-2 py-0.5 text-orange-300 ring-1 ring-inset ring-orange-400/40">High</span>
                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                  Verified
                </span>
                <span className="text-muted">src/billing.ts:12 · client traced to the SDK constructor in the same file</span>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="how-h">
          <h2 id="how-h" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className="text-xs text-muted">Step {i + 1}</span>
                </div>
                <h3 className="mt-3 font-medium">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="capabilities" className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="cap-h">
          <h2 id="cap-h" className="text-2xl font-semibold tracking-tight">
            Key capabilities
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAPS.map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line bg-surface p-5">
                <h3 className="font-medium">{t}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="technical" className="mx-auto max-w-6xl px-6 pb-24" aria-labelledby="tech-h">
          <h2 id="tech-h" className="text-2xl font-semibold tracking-tight">
            Under the hood
          </h2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ul className="space-y-3 rounded-xl border border-line bg-surface p-6 text-sm leading-6 text-muted">
              <li>
                <strong className="text-fg">Static analysis.</strong> TypeScript compiler AST for JavaScript and TypeScript, tree-sitter for
                Python, with a documented regex fallback.
              </li>
              <li>
                <strong className="text-fg">Deterministic matching.</strong> Exact symbol, known endpoint, path, version-range and pattern
                rules, each with its own confidence.
              </li>
              <li>
                <strong className="text-fg">Background processing.</strong> Redis and BullMQ workers for scans, polling, change processing
                and notifications, with retries and deduplication.
              </li>
              <li>
                <strong className="text-fg">PostgreSQL.</strong> Snapshots, change events, call-site index and findings, with idempotent
                ingestion keyed by content hashes.
              </li>
            </ul>
            <div className="rounded-xl border border-line bg-surface p-6 text-sm leading-6 text-muted">
              <h3 className="font-medium text-fg">What Tracewise does not claim</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  It does not understand every dynamic code path. Calls built at runtime are reported as possible impacts with their
                  limitations.
                </li>
                <li>It follows clients within a file. Wrappers defined in other files are not traced yet.</li>
                <li>Feed classification is keyword based and labelled with modest confidence. Review the linked source.</li>
              </ul>
              <Link href="/dashboard" className="mt-5 inline-flex items-center gap-2 font-medium text-accent hover:underline">
                Explore the demo <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-muted">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" aria-hidden /> Tracewise · open-source starter
          </span>
          <span>Demo data is simulated and clearly labelled.</span>
        </div>
      </footer>
    </div>
  );
}
