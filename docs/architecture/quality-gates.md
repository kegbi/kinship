# Quality Gates

## Coverage Contract

The repository coverage contract has two complementary requirements:

1. Production TypeScript must reach at least 80% line, branch, and function
   coverage through unit and integration tests.
2. Every defined user-facing workflow and supported compatibility workflow must
   have end-to-end coverage.

E2E coverage is measured against the workflow catalog, not JavaScript source
lines. Generated code, declarations, exhaustive type-only helpers, and
unreachable defensive assertions may be excluded only through a reviewed,
documented allowlist. A blanket coverage-ignore comment is forbidden.

The canonical workflow inventory is
[`docs/product/user-flows.yaml`](../product/user-flows.yaml), and the canonical
page inventory is
[`docs/product/page-catalog.yaml`](../product/page-catalog.yaml). E2E tests
carry their flow ID in a Playwright annotation or title. Once implemented, the
required CI gate must reject unknown IDs, delivered required flows without
tests, shipped routes missing from the page catalog, and catalog references to
unknown pages or modules.

Coverage is necessary but does not prove test-first development. It cannot
replace the RED evidence required below.

## Test-First Change Contract

Every new or changed production behavior uses a recorded RED -> GREEN ->
REFACTOR cycle:

1. RED adds or changes the narrowest automated test or deterministic executable
   check before production code changes. The implementer runs it and verifies
   that the intended assertion fails because behavior is absent or incorrect.
   Syntax, type, harness, fixture, permission, service, timeout, and unrelated
   failures are invalid RED evidence. A bug fix starts with a failing regression
   test.
2. GREEN makes only the smallest compliant production change required to pass
   the RED test. Tests cannot be weakened, deleted, skipped, excluded,
   over-mocked, or reversed to obtain GREEN.
3. REFACTOR improves structure without changing behavior and reruns the focused
   and affected broader gates. Any new behavior begins another RED cycle.

This contract applies to executable backend, frontend, API, worker, database,
migration, infrastructure, configuration, generator, security, and
repository-tooling behavior. Machine-consumed contracts or configuration need a
focused executable consumer check. Planning and documentation-only prose changes
receive review and any already-applicable validation; they do not require a new
permanent test or validator. Bootstrap a truthful harness only when the vertical
feature changes executable behavior that otherwise cannot be tested; no-op task
names are forbidden.

RED evidence records the command, non-zero exit, expected assertion, concise
redacted output, changed test/check paths, and proof that production paths were
unchanged. A permanently failing commit is not required.

## Independent Clean-Context Review

Every candidate receives a separate review after REFACTOR. The reviewer cannot
be the implementation context. For agent-authored work, use a fresh agent thread
without inherited implementation discussion and provide only the ticket,
accepted contracts, exact base and candidate revisions, diff, tests, and phase
evidence.

The reviewer independently checks and reports evidence for all of these lenses:

- bugs and correctness;
- security, privacy, authorization, and workspace isolation;
- architecture, schema ownership, dependency direction, and product/API
  contracts;
- performance, concurrency, reliability, and resource use;
- code style, clarity, maintainability, and unnecessary complexity;
- test discrimination, RED integrity, coverage, E2E traceability, and flake
  risk.

Actionable findings return to the implementer with a focused regression; use a
fresh implementer for high-risk redesign or a repeated failed approach. A fresh
reviewer examines every changed exact candidate. Implementer self-review, hook
success, and CI success do not replace this gate. The controller independently
reruns applicable gates before integrating the reviewed revision. The complete
operational protocol is
[`docs/development/autonomous-delivery.md`](../development/autonomous-delivery.md).

## Canonical Commands

`deno.json` exposes 26 stable verbs and nothing else.
[`tools/tasks/manifest.ts`](../../tools/tasks/manifest.ts) declares what each
one runs — module test sets, coverage includes, permission sets, check and build
targets — and [`tools/tasks/run.ts`](../../tools/tasks/run.ts) composes the
concrete command. Adding a suite means editing the manifest, never a task
string, and `tools/tasks/manifest_test.ts` holds the vocabulary at 26 verbs
while proving every test file is reachable from root `test`.

| Command                                                     | What it runs                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `deno task fmt`, `deno task fix`                            | `deno fmt` over the owned paths                                                    |
| `deno task fmt:check`                                       | the non-mutating formatter check                                                   |
| `deno task lint`                                            | `deno lint` plus ESLint over `apps/web/src`                                        |
| `deno task check`                                           | the architecture gate, `deno check` over every manifest target, then `astro check` |
| `deno task check:architecture`                              | the module-boundary checker against its baseline                                   |
| `deno task build`                                           | the contracts check, the entry-point type check, the Astro build                   |
| `deno task test`                                            | every unit module, then integration, then the contracts check                      |
| `deno task test:unit [--module=<id>]`                       | the unit sets                                                                      |
| `deno task test:integration [--module=<id>]`                | the PostgreSQL suites on a disposable Compose project                              |
| `deno task test:contract [--module=<id>]`                   | the contract view over the unit sets plus `contracts:check`                        |
| `deno task test:coverage [--module=<id>]`                   | the measured sets against the 80% threshold                                        |
| `deno task test:e2e [Playwright arguments]`                 | Playwright against the production-like Compose stack                               |
| `deno task test:schema`, `deno task test:schema:matrix`     | the canonical schema harness on the pinned PostgreSQL images                       |
| `deno task contracts:generate`, `deno task contracts:check` | the generated OpenAPI document and TypeScript client                               |
| `deno task deps:deno`, `deno task deps:node`                | frozen dependency installation                                                     |
| `deno task deps:audit`                                      | `deno audit`                                                                       |
| `deno task dev`, `deno task dev:api`, `deno task dev:web`   | the local run targets                                                              |
| `deno task migration:apply`                                 | the versioned migration bundle                                                     |
| `deno task ops <script>`                                    | the operator scripts declared in the manifest                                      |
| `deno task test:repro:astro-readiness`                      | the on-demand Astro readiness reproduction                                         |

Tests run through the test verbs, never by appending targets, redirections,
shell separators, or fallback commands to `deno task check`.

`check:architecture` runs
[`tools/architecture/check_boundaries.ts`](../../tools/architecture/check_boundaries.ts),
the generic boundary checker GAP-005 added. It validates
`module-boundaries.yaml` against its JSON Schema, proves every canonical table
has exactly one owning module, enforces the manifest's `layerRules` over the
import graph, measures every `crm.<table>` token in a module's `adapters/`
against that module's `ownsTables` and the tables of its declared dependencies,
and reports dependency cycles. The violations the repository already had are
recorded in
[`tools/architecture/boundary-baseline.json`](../../tools/architecture/boundary-baseline.json);
the gate fails both on a violation missing from that file and on an entry in it
that no longer occurs, so the baseline can only shrink. `deno task check` runs
it first, before the slower type checks, and the CI static job runs it as its
own step. The few remaining `tools/architecture/<TICKET>/` suites assert
documentation clauses and behavioral invariants the checker's rules cannot
express, so they stay in the unit sets.

### Dependency bootstrap

```text
deno task deps:deno
deno task deps:node
```

Both are frozen: `deno install --frozen --node-modules-dir=none` and
`pnpm install --frozen-lockfile`. Extra flags pass through, so an offline proof
is `deno task deps:deno --cached-only` and `deno task deps:node --offline`. It
must reuse only the explicit cache populated by the corresponding online run and
must leave both lockfiles byte-identical.

The root dependency contract intentionally accepts only those canonical task
spellings. Equivalent aliases such as `--frozen=true` or `pnpm i` are rejected
until the repository adopts them explicitly. Deno must use `./deno.lock`; pnpm
must keep one enabled, non-branch lockfile at the workspace root. npm lifecycle
scripts stay denied by default: `pnpm-workspace.yaml` decides each one
explicitly, and `deno.json` keeps an empty `allowScripts`.

### Accepted dependency advisories

`deno task deps:audit` currently reports five moderate advisories and no high or
critical ones. They are recorded here rather than silenced:

- three in `hono` < 4.13.5 — a `toSSG()` path escape (no route generates static
  output through Hono), unbounded dot-notation nesting in `parseBody()` (no
  handler calls `parseBody`), and a query-parser fragment differential, which is
  a hardening fix that arrives with the next Hono version;
- `stream-json` <= 3.4.0 and `decode-uri-component` <= 0.4.2, both transitive
  through `minio`, which uses them to parse responses from the workspace's own
  object store rather than untrusted input.

CI prints the complete report and then fails on high and critical severity only
(`deno task deps:audit --level=high`). Raising a dependency version is a
separate change; when one lands, this exception shrinks with it. A developer
still runs the ungated `deno task deps:audit` locally.

### Hook and CI wiring

When local hooks and CI run these gates, they call these same commands. There
must not be a second, subtly different hook-only validation pipeline. Lefthook
invokes repository commands; repository tests do not delegate their validation
semantics to Lefthook. Add each task with its first truthful executable harness
before the corresponding production behavior, not as a placeholder.

### Candidate-bound review gates

The controller records the base revision and creates the exact candidate
revision after GREEN and REFACTOR. The separate clean, read-only reviewer gets
that revision, its diff, accepted contracts, and concise evidence only. A
localized post-review amendment may return to the same implementer and reviewer.
A fresh review context is required only when the amendment changes a
schema/security/tenant/API boundary, materially redesigns the candidate, or
follows a repeated failed approach. The controller still records and reviews the
exact amended revision before integration.

Ordinary implementation cannot write `.codex` or `.agents`; explicit protected
configuration maintenance is limited to its named paths. `.git` remains
forbidden to implementers. Git history is the revision record and no parallel
state ledger is required.

## Static Enforcement

Enable strict TypeScript settings, including `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters`, `useUnknownInCatchVariables`, and `verbatimModuleSyntax`.
Production code must not use `any`; unsafe assertions require a localized
validation boundary or an explanatory lint suppression.

Use member-specific Deno/TypeScript configuration when backend, worker, browser,
or generated-code library contexts differ. Root tasks aggregate the members.
Require explicit return types on exported application/module boundaries, not on
every small local function. Validate `unknown` at process and persistence
boundaries and use branded IDs for aggregate identifiers.

Deno lint should enable strict rules intentionally rather than relying only on
its recommended default set. A project lint plugin and graph check should
enforce at least:

- no cross-module imports into private folders;
- no module-to-module adapter or repository imports;
- no Hono, Zod, Kysely, driver, environment, filesystem, or network APIs in
  domain code;
- no environment access outside validated configuration/bootstrap code;
- no wall-clock construction inside domain/application code when an injected
  clock is required;
- no `console` logging in production paths; use the structured telemetry port;
- no circular package or module dependencies;
- no frontend import from backend internals;
- no unapproved edits or formatting of the synchronized canonical schema bundle.

The architecture checker also validates
[`module-boundaries.yaml`](module-boundaries.yaml), verifies exact one-owner
coverage of all canonical tables, rejects unknown dependencies and read-model
sources, and compares the implementation graph with the manifest. Do not depend
on an unstable CLI JSON format without a pinned compatibility test; use a
reviewed module-graph library or a repository-owned parser selected during
scaffolding.

Test custom lint rules with Deno's lint-plugin test API. Keep an explicit,
minimal allowlist for read models and composition roots.

Deno lint does not parse `.astro` templates. Once the frontend scaffold exists,
its gate must also run `astro check` with warnings treated as failures and a
targeted ESLint flat configuration for `eslint-plugin-astro`, Astro
accessibility rules, and the official React hooks rules on interactive islands.
Do not duplicate all generic TypeScript style rules in ESLint; Deno remains
their canonical owner.

## Test Layers

| Layer                   | Purpose                                                                     | Environment                                              |
| ----------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Unit                    | Domain values, invariants, policies, application branching, serialization   | Deno without network/database permissions where possible |
| Adapter contract        | Every adapter implementation satisfies the same port contract               | Real dependency or deterministic protocol fixture        |
| Integration             | SQL, transactions, constraints, locking, auth, storage, external boundaries | Disposable Compose services; real PostgreSQL             |
| Schema                  | Apply/teardown, catalog introspection, mappings, tenancy, import edge cases | Fresh supported PostgreSQL versions                      |
| Frontend unit/component | Astro utilities and interactive islands                                     | Vitest and DOM/browser component harness as appropriate  |
| API contract            | OpenAPI validity, generated-client drift, RFC 9457 errors                   | Built API or in-process HTTP adapter                     |
| E2E                     | Complete user and Monica compatibility workflows                            | Production-like Compose stack with Playwright            |

Run Playwright against Chromium, Firefox, and WebKit in CI. Add automated
accessibility checks such as axe to each representative page state, plus
keyboard-only workflow assertions. Accessibility checks complement, rather than
replace, semantic component tests.

Use mutation testing selectively for the highest-risk identity,
workspace-isolation, partial-date, reminder, and import logic after the baseline
suite is fast and stable. Mutation score is a diagnostic initially, not a
substitute for the 80% coverage gate.

## Required Schema Tests

The baseline database harness is
[`tools/schema/validate_postgres.ts`](../../tools/schema/validate_postgres.ts).
Run `deno task test:schema:matrix` for the pinned PostgreSQL 18 primary image
and PostgreSQL 17 compatibility image. Its current verified result is recorded
in
[`docs/validation/postgresql-schema-v1.md`](../validation/postgresql-schema-v1.md).

Before implementation migrations are accepted, CI must prove all requirements
already named in `AGENTS.md`, including:

- clean apply on an empty supported PostgreSQL instance;
- repeatable teardown or tested down/restore procedure;
- schema catalog introspection against the audited table, column, constraint,
  index, and foreign-key expectations;
- generated Kysely type drift detection;
- rejection of every cross-workspace relationship path;
- Monica import idempotency and complete table/column mapping fixtures;
- all partial-date precisions and invalid combinations;
- reminder regeneration, time-zone, and daylight-saving cases;
- missing, quarantined, and inaccessible attachments;
- proof that imported legacy credentials are not activated.

Run these tests against PostgreSQL, not an in-memory substitute or SQLite
compatibility layer.

The baseline harness covers the database-enforceable subset now. Generated
Kysely drift, cross-workspace application rejection, complete importer
semantics, time-zone-aware reminder generation, object-store behavior, and
credential activation require application code and must be added without
weakening the existing database checks.

## Deno Dependency and Security Gates

CI should use a pinned Deno runtime and execute:

- frozen dependency installation with `deno ci`;
- `deno fmt --check` only on owned, supported paths;
- `deno lint` including the architecture plugin;
- `deno check` over every backend entry point and tool;
- `deno test` with leak detection and randomized ordering where useful;
- coverage reporting with 80% line, branch, and function thresholds;
- `deno audit` and a documented vulnerability exception process;
- a dependency freshness policy and review of `deno outdated` output;
- verification that npm lifecycle-script permissions and Deno runtime
  permissions match explicit allowlists.

Tests should run with the smallest permissions that fit their layer. A test
unexpectedly requiring broad filesystem, network, environment, subprocess, FFI,
or system access is a review signal. Never normalize `--allow-all` as the CI
default.

## Hooks

Deno has no Git-hook manager. Use Lefthook only to invoke repository tasks:

- pre-commit: the non-mutating formatter check and lint, filtered to the staged
  files (`deno fmt --check`, `deno lint`, and ESLint for Astro templates);
- pre-push: `deno task test:unit` and `deno task test:contract`;
- CI: the authoritative full suite, including all E2E browsers and
  security/dependency gates.

Pre-commit must not format, fix, stage, or restage files. `deno task fix` is an
explicit developer action. Target less than 15 seconds for pre-commit and less
than three minutes for pre-push; measured checks that exceed those budgets move
to CI rather than being silently skipped, which is why the type check, the
integration, schema, and E2E suites, and the architecture checks are CI-only.
The pre-commit staged-file filter mirrors the formatter's and the linter's own
include and exclude lists in `deno.json`, so a hook never reports a file the
repository gate ignores. Pre-commit measures about five seconds over every
tracked file; pre-push measures about four minutes, just over its budget,
because one Docker-backed gateway suite costs half of it. Pre-push stays the
last local checkpoint before CI and remains bypassable with `--no-verify`.

Lefthook is pinned as an exact dev dependency and configured in
[`lefthook.yml`](../../lefthook.yml). Its npm `postinstall`, which would run
`lefthook install`, is denied in `pnpm-workspace.yaml`, and the configuration
sets `no_auto_install`: one `.git` directory is shared by every worktree of this
repository, so installing the hooks stays the explicit developer action
`pnpm exec lefthook install`. The verb vocabulary is capped at 25, so there is
no `hooks:install` task. Hooks are convenience feedback and remain bypassable;
CI is authoritative.

Hooks improve feedback time but are bypassable. Protected-branch rules and
required CI checks enforce the contract. A repository-local `.githooks`
directory with Git's `core.hooksPath` is an acceptable zero-dependency fallback,
but it needs a reliable install/update command and offers fewer staged-file and
parallel-execution conveniences.

## CI Stages

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every pull
request, on pushes to `main`, nightly at 03:00 UTC, and on manual dispatch. Each
job installs the pinned runtimes, bootstraps dependencies from the lockfiles,
and then runs the same `deno task` verbs a developer runs locally.

| Job                | When                    | Gates                                                                                                                                                 |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`           | every run               | `fmt:check`, `lint`, `check:architecture`, `check`, `contracts:check`, `test:contract`, and `deps:audit` (reported in full, failing at high severity) |
| `unit`             | every run               | `test:unit`, then `test:coverage` against the 80% thresholds                                                                                          |
| `integration`      | every run               | `test:integration`, which provisions its own disposable PostgreSQL 18.4 project and applies the versioned migrations                                  |
| `schema`           | every run               | `test:schema` against the pinned PostgreSQL image                                                                                                     |
| `e2e-chromium`     | pull requests           | `test:e2e --project=chromium` against the Compose stack, uploading Playwright traces on failure                                                       |
| `e2e-all-browsers` | `main`, nightly, manual | the whole Chromium, Firefox, and WebKit matrix                                                                                                        |
| `images`           | `main`, nightly, manual | production builds of `Dockerfile.api`, `Dockerfile.web`, and `Dockerfile.gateway`                                                                     |

`static`, `unit`, `integration`, and `schema` run in parallel; the three
expensive jobs wait for `static`. Coverage is never split in a way that lets
uncovered code evade the aggregate threshold.

[`tools/pipeline_contract_test.ts`](../../tools/pipeline_contract_test.ts) is
the executable consumer of this workflow and of `lefthook.yml`. It proves the
required jobs and hook stages exist, that the job graph stays acyclic, that
installation stays frozen, that the pinned Deno version matches
`.tool-versions`, and that every command either names a declared `deno.json`
task or a declared dependency binary.

Named by the tickets that add them, still missing: the workflow and page catalog
coverage gate, container image scanning, and artifact publication. Upload
coverage, test, OpenAPI, and migration verification artifacts on failure as
those gates arrive.
