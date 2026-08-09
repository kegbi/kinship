# Quality Gates

## Coverage Contract

The repository's 100% requirement has two complementary meanings:

1. All production TypeScript must reach 100% line, branch, and function coverage
   through unit and integration tests.
2. Every defined user-facing workflow and supported compatibility workflow must
   have end-to-end coverage.

E2E coverage is measured against the workflow catalog, not JavaScript source
lines. Generated code, declarations, exhaustive type-only helpers, and
unreachable defensive assertions may be excluded only through a reviewed,
documented allowlist. A blanket coverage-ignore comment is forbidden.

## Canonical Commands

The implementation should expose stable top-level `deno task` commands even when
they delegate to pnpm, Astro, Vitest, Playwright, Docker Compose, or a helper
binary:

```text
deno task fmt
deno task fmt:check
deno task lint
deno task check
deno task test:unit
deno task test:integration
deno task test:schema
deno task test:e2e
deno task test:coverage
deno task test
deno task ci
```

Local hooks and CI call these same commands. There must not be a second, subtly
different hook-only validation pipeline.

## Static Enforcement

Enable strict TypeScript settings, including `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`useUnknownInCatchVariables`, and `verbatimModuleSyntax`. Production code must
not use `any`; unsafe assertions require a localized validation boundary or an
explanatory lint suppression.

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

Test custom lint rules with Deno's lint-plugin test API. Keep an explicit,
minimal allowlist for read models and composition roots.

Deno lint does not parse `.astro` templates. The frontend gate therefore also
runs `astro check` with warnings treated as failures and a targeted ESLint flat
configuration for `eslint-plugin-astro`, Astro accessibility rules, and the
official React hooks rules on interactive islands. Do not duplicate all generic
TypeScript style rules in ESLint; Deno remains their canonical owner.

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
substitute for the 100% coverage gate.

## Required Schema Tests

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

## Deno Dependency and Security Gates

CI should use a pinned Deno runtime and execute:

- frozen dependency installation with `deno ci`;
- `deno fmt --check` only on owned, supported paths;
- `deno lint` including the architecture plugin;
- `deno check` over every backend entry point and tool;
- `deno test` with leak detection and randomized ordering where useful;
- coverage reporting with 100% line, branch, and function thresholds;
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

- pre-commit: formatter check for staged owned files, lint, type check,
  architecture checks, and the fast affected unit suite;
- pre-push: full unit/integration/schema/contract suite when practical;
- CI: the authoritative full suite, including all E2E browsers and
  security/dependency gates.

Hooks improve feedback time but are bypassable. Protected-branch rules and
required CI checks enforce the contract. A repository-local `.githooks`
directory with Git's `core.hooksPath` is an acceptable zero-dependency fallback,
but it needs a reliable install/update command and offers fewer staged-file and
parallel-execution conveniences.

## Suggested CI Stages

1. Lockfile, generated-file, schema-bundle, formatting, lint, architecture, and
   type checks.
2. Backend and frontend unit/component suites with coverage gates.
3. Fresh PostgreSQL schema and adapter integration suites.
4. Build pinned production images and generate an immutable Compose test stack.
5. API contract and Playwright E2E suites against that stack.
6. Dependency audit, container/image scan, permission-policy checks, and
   artifact publication.

Parallelize independent jobs, but do not split coverage in a way that lets
uncovered code evade the aggregate threshold. Upload coverage, test, OpenAPI,
migration verification, and Playwright trace artifacts on failure.
