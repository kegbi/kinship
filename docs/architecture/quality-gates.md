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
   the frozen RED test. Tests cannot be weakened, deleted, skipped, excluded,
   over-mocked, or reversed to obtain GREEN.
3. REFACTOR improves structure without changing behavior and reruns the focused
   and affected broader gates. Any new behavior begins another RED cycle.

This contract applies to backend, frontend, API, worker, database, migration,
infrastructure, configuration, generator, security, and repository-tooling
behavior. Documentation and contract changes require a failing validator,
schema/contract test, or bounded executable probe. When no truthful test harness
exists, its bootstrap and self-test are prerequisite work; no-op task names are
forbidden.

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

Every actionable finding returns through a new RED -> GREEN -> REFACTOR round in
a fresh implementation context, then a fresh reviewer examines the new exact
candidate. Any post-review code, test, generated, contract, or relevant config
change invalidates approval. Implementer self-review, hook success, and CI
success do not replace this gate. The orchestrator independently reruns the
applicable gate matrix before accepting and integrating the exact reviewed
revision. The complete operational protocol is
[`docs/development/autonomous-delivery.md`](../development/autonomous-delivery.md).

## Canonical Commands

The current executable baseline exposes formatting, lint, type-check,
workflow-policy, frozen dependency-bootstrap, and schema-matrix tasks through
`deno.json`. Their scope remains narrow until the application scaffold exists.
The workflow task checks the accepted delivery policy; the schema tasks cover
the canonical database harness.

The root type-check task is intentionally exact and production-only:

```text
DENO_NO_PACKAGE_JSON=1 deno check tools/schema/validate_postgres.ts tools/workflows/foundation_recovery_policy.ts tools/runtime/runtime_dependency_policy.ts
```

Tests run through test tasks, never by appending targets, redirections, shell
separators, or fallback commands to this check.

```text
deno task test:workflow
deno task test:workflow:coverage
deno task test:runtime
deno task test:runtime:coverage
deno task deps:deno
deno task deps:node
```

The dependency tasks use frozen locks. An offline proof must reuse only the
explicit cache populated by the corresponding online run and must leave both
lockfiles byte-identical.

The root dependency contract intentionally accepts only the canonical task
spellings in `deno.json`: Deno uses `deno install --frozen`, and pnpm uses
`pnpm install --frozen-lockfile`. Equivalent aliases such as `--frozen=true` or
`pnpm i` are rejected until the repository adopts them explicitly. Deno must use
`./deno.lock`; pnpm must keep one enabled, non-branch lockfile at the workspace
root.

As real harnesses are added, the implementation must expose stable top-level
`deno task` commands even when they delegate to pnpm, Astro, Vitest, Playwright,
Docker Compose, or a helper binary:

```text
deno task fmt
deno task fmt:check
deno task fix
deno task lint
deno task check
deno task check:architecture
deno task test:unit
deno task test:integration
deno task test:schema
deno task test:contract
deno task test:e2e
deno task test:coverage
deno task test:prepush
deno task test
deno task ci
```

Add each task with its first truthful executable harness before corresponding
production behavior, not as a placeholder. When local hooks and CI are added,
they must call these same commands. There must not be a second, subtly different
hook-only validation pipeline. Lefthook invokes repository tasks; repository
tests do not delegate their validation semantics to Lefthook.

### Candidate-bound review gates

The controller records the base revision and creates the exact candidate
revision after GREEN and REFACTOR. The separate clean, read-only reviewer gets
that revision, its diff, accepted contracts, and concise evidence only. Any
post-review change to code, tests, generated output, contracts, or relevant
configuration creates a new candidate and requires a fresh review.

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

- pre-commit: non-mutating formatter check, lint, type check, architecture
  checks, and the fast unit suite;
- pre-push: full unit/integration/schema/contract suite and a Chromium smoke E2E
  project when practical;
- CI: the authoritative full suite, including all E2E browsers and
  security/dependency gates.

Pre-commit must not format, fix, stage, or restage files. `deno task fix` is an
explicit developer action. Target less than 15 seconds for pre-commit and less
than three minutes for pre-push; measured checks that exceed those budgets move
to CI rather than being silently skipped. Add staged-file filtering only after
the complete repository checks have become measurably slow.

Do not add or pin Lefthook before canonical scaffold tasks exist. At that point,
commit its configuration and expose an idempotent `deno task hooks:install`.
Hooks are convenience feedback and remain bypassable; CI is authoritative.

Hooks improve feedback time but are bypassable. Protected-branch rules and
required CI checks enforce the contract. A repository-local `.githooks`
directory with Git's `core.hooksPath` is an acceptable zero-dependency fallback,
but it needs a reliable install/update command and offers fewer staged-file and
parallel-execution conveniences.

## Suggested CI Stages

1. Lockfile, generated-file, catalog/schema-bundle, formatting, lint,
   architecture, workflow/page coverage, and type checks.
2. Backend and frontend unit/component suites with coverage gates.
3. Fresh PostgreSQL schema and adapter integration suites.
4. Build pinned production images and generate an immutable Compose test stack.
5. API contract and Playwright E2E suites against that stack.
6. Dependency audit, container/image scan, permission-policy checks, and
   artifact publication.

Parallelize independent jobs, but do not split coverage in a way that lets
uncovered code evade the aggregate threshold. Upload coverage, test, OpenAPI,
migration verification, and Playwright trace artifacts on failure.
