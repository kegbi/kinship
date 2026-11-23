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
carry their flow ID in a Playwright annotation or title. The required gate must
reject unknown IDs, delivered required flows without tests, shipped routes
missing from the page catalog, and catalog references to unknown pages or
modules. Today `tools/product/flow_traceability_test.ts` (GAP-036) covers the
flow half: a required flow's missing or unannotated `testRefs`, a delivered flow
without a reference, and a spec annotation whose flow omits that spec, and
`tools/product/PRODUCT-001/release_contract_test.ts` checks the catalogs'
priorities, slices, and page ownership. No gate yet compares the shipped routes
with the page catalog.

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
string, and `tools/tasks/manifest_test.ts` caps the vocabulary at 27 verbs while
proving every test file is reachable from root `test`.

| Command                                                     | What it runs                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `deno task fmt`, `deno task fix`                            | `deno fmt` over the owned paths                                                    |
| `deno task fmt:check`                                       | the non-mutating formatter check                                                   |
| `deno task lint`                                            | `deno lint` plus ESLint over `apps/web/src`                                        |
| `deno task check`                                           | the architecture gate, `deno check` over every manifest target, then `astro check` |
| `deno task check:architecture`                              | the module-boundary checker against its baseline                                   |
| `deno task build`                                           | the contracts check, the entry-point type check, the Astro build, `web-build`      |
| `deno task test`                                            | every unit module, then integration, then the contracts check                      |
| `deno task test:unit [--module=<id>]`                       | the unit sets                                                                      |
| `deno task test:integration [--module=<id>]`                | the Kysely type drift check, then the PostgreSQL suites, on a disposable project   |
| `deno task test:contract [--module=<id>]`                   | the contract view over the unit sets plus `contracts:check`                        |
| `deno task test:coverage [--module=<id>]`                   | the measured sets against the 80% threshold                                        |
| `deno task test:e2e [Playwright arguments]`                 | Playwright against the production-like Compose stack                               |
| `deno task test:schema`, `deno task test:schema:matrix`     | the canonical schema harness on the pinned PostgreSQL images                       |
| `deno task contracts:generate`, `deno task contracts:check` | the generated OpenAPI document and TypeScript client                               |
| `deno task deps:deno`, `deno task deps:node`                | frozen dependency installation                                                     |
| `deno task deps:audit`                                      | `deno audit`                                                                       |
| `deno task deps:audit:gate`                                 | high/critical audit gate, with no exception                                        |
| `deno task dev`, `deno task dev:api`, `deno task dev:web`   | the local run targets                                                              |
| `deno task migration:apply`                                 | the versioned migration bundle                                                     |
| `deno task ops <script>`                                    | the operator scripts `probe`, `recovery`, and `preflight`                          |
| `deno task test:repro:astro-readiness`                      | the on-demand Astro readiness reproduction                                         |

Every verb that calls `tools/tasks/run.ts` passes it one runner verb: `all`
(`test`), `unit`, `integration`, `contract`, `coverage`, `architecture`
(`check:architecture`), `check`, `build`, and `ops`. `--module=<id>` selects one
manifest module; without it `unit` and `coverage` walk the manifest's declared
aggregate order and skip on-demand modules such as `web-build` (run by `build`)
and `repro-astro-readiness` (run by `test:repro:astro-readiness`). The web
modules run Vitest; every other module runs `deno test` with the permissions the
manifest declares for it. `integration`, and each coverage set that measures
integration suites, run inside a disposable PostgreSQL Compose project.

Tests run through the test verbs, never by appending targets, redirections,
shell separators, or fallback commands to `deno task check`.

The contract build writes five checked-in artifacts: internal OpenAPI, the full
generated TypeScript types and client barrel, bearer-only external OpenAPI, and
the agent tool catalog `packages/contracts/mcp/tools.json` (ADR 0009). The
`contracts-build` unit/contract set verifies external operation filtering and
complete reference closure; its focused coverage measures the projection. It
uses the generator's existing environment permission because
openapi-typescript's debug dependency enumerates `process.env`, without printing
it. Public build checks include `/docs/api` and `/docs/mcp` in the React-free
inventory, and the MCP guide must render exactly the catalog's tools; `API-002`
covers signed-out reading/download and real bearer person/task/capture
automation across browsers. The `mcp` module's unit set holds the catalog to the
rule that every token-enabled route is a tool or a named exclusion, and its
integration suite drives `POST /api/v1/mcp` as a client would; `API-003` covers
a real MCP client through the gateway with a token minted in settings.

### Generated Kysely types

`packages/backend/platform/postgres/generated/database.ts` holds the Kysely
types of every `crm` table, keyed `crm.<table>` with snake_case columns, as
`kysely-codegen` (pinned in `deno.json`) introspects them from a disposable
database the repository's migration runner has just migrated. The canonical DDL
stays the only schema source; the file is derived output, never edited by hand,
excluded from `deno fmt` and from coverage, and exported to adapters as
`Database` from `platform/postgres/database.ts`. Regenerate it after a schema
version change with the task runner's `schema-types` verb, which needs no
`deno.json` task of its own:

```sh
DENO_NO_PACKAGE_JSON=1 deno run --allow-read --allow-run=deno,docker,pnpm \
  tools/tasks/run.ts schema-types          # add --check to compare only
```

`deno task test:integration` regenerates the types in memory from its own
freshly migrated database before any suite runs and fails unless they match the
committed file byte for byte, so CI's `integration` job fails whenever the DDL
and the generated types differ. The gifts adapters build their queries against
`Database`; the other modules adopt it in their own tickets.

`check:architecture` runs
[`tools/architecture/check_boundaries.ts`](../../tools/architecture/check_boundaries.ts),
the generic boundary checker GAP-005 added. Its seven rules validate
`module-boundaries.yaml` against
[`module-boundaries.schema.json`](module-boundaries.schema.json), prove every
canonical table has exactly one owning module, enforce the manifest's
`layerRules` over the import graph, measure every `crm.<table>` token in a
module's `adapters/` against that module's `ownsTables` and the tables of its
declared dependencies (narrowed only by `approvedCrossModuleReads`), report
dependency cycles, allow only declared composition roots to import a unit's
`composition.ts` (GAP-013), and refuse a `public.ts` that re-exports an adapter
value. The violations the repository already had are recorded in
[`tools/architecture/boundary-baseline.json`](../../tools/architecture/boundary-baseline.json),
which holds 14 ordinary reads of a declared dependency's tables; the gate fails
both on a violation missing from that file and on an entry in it that no longer
occurs, so the baseline can only shrink. `deno task check` runs it first, before
the slower type checks, and the CI static job runs it as its own step. The few
remaining `tools/architecture/<TICKET>/` suites assert documentation clauses and
behavioral invariants the checker's rules cannot express, so they stay in the
unit sets.

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

As of 2026-11-23, `deno task deps:audit` reports no advisories. The backend pins
`hono` 4.13.19 in `deno.json`, past the seven advisories fixed by 4.13.16, and
the DAV client in
`packages/backend/modules/integrations/adapters/dav/http_dav_client.ts` imports
`fast-xml-parser` 5.12.1, past `GHSA-474x-hrwr-fgx4`. A version imported by an
inline `npm:` specifier stays in `deno.lock` after the import moves, so a bump
of such an import regenerates the lockfile rather than adding to it.

As of the same date, `pnpm audit` reports three advisories in the web and
tooling tree, two high and one moderate. Nothing gates on this report:

- `happy-dom` 20.14.6, the test DOM for the web unit suites, carries
  `GHSA-834v-8h66-3h79` and `GHSA-c8p4-j97h-3vg8`, both high. The first is fixed
  only in 21.0.4. The second names 20.14.7 as its fix, but no 20.x release after
  20.14.6 is published. Both remain until the web suites move to `happy-dom` 21,
  a major upgrade that needs its own change. `happy-dom` runs only under Vitest
  and never ships.
- `minimatch` 10.2.6, `GHSA-g3hv-75wg-m249`, is a moderate denial-of-service
  advisory fixed only in 11.0.1. It reaches the tree only through the `shadcn`
  4.23.0 CLI, whose `ts-morph` 26 asks for `@ts-morph/common` 0.27 and thus
  `minimatch` ^10. The CLI is a developer tool and never ships. It remains until
  a `shadcn` release moves off that line; an override across the major is not
  used.

`pnpm-workspace.yaml` carries one override: `fast-uri@3` resolves to 3.1.9.
`ajv` 8.20.0 asks for `fast-uri` ^3.0.1 and is shared as a peer of
`@hookform/resolvers`, so `pnpm update` keeps the locked release instead of
moving it to the fixed one. The override stays inside the major line `ajv` asks
for and is removed once `ajv` resolves a fixed release unaided.

Five advisories left the graph when MCP-E4 replaced `minio` with
`@aws-sdk/client-s3`, which adds none: two for `decode-uri-component`, one of
them high, and three for `stream-json`.

CI prints the complete report and then runs `deno task deps:audit:gate`, which
runs `deno audit --level=high` and fails on every high or critical advisory and
on every audit or registry error. The gate carries no exception. The temporary
tooling exception for `braces` 3.0.3,
[`GHSA-vfj7-8cjw-p6xm`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
approved on 2026-10-04, ended on 2026-11-23: neither `deno audit` nor
`pnpm audit` reports it any longer, so the gate's special case for it was
removed. A developer still runs the ungated `deno task deps:audit` locally. No
pnpm audit suppression is configured.

The user also explicitly approved an exact release-age exemption on 2026-10-04
for `http-cache-semantics@4.3.0`, fixing `GHSA-ch52-4w7c-c8xp`. Its version and
registry integrity are locked. `pnpm-workspace.yaml` excludes only that version
from the normal 72-hour hold; all other supply-chain checks remain enabled.
Remove this exemption after 2026-10-07 02:56:05 UTC, when the release is 72
hours old. Astro uses this dependency in remote-image build caching.

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
its recommended default set. Today `deno.json` enables the `recommended` tag
plus `eqeqeq`, and no project lint plugin exists: the graph checker behind
`check:architecture` enforces the import, layer, table, cycle, composition, and
public-surface rules, and the remaining items below are still targets rather
than gates. Together they should enforce at least:

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

Test custom lint rules with Deno's lint-plugin test API once one exists. Keep an
explicit, minimal allowlist for read models and composition roots; today those
are `readModels[].sourceModules`, `compositionRoots`, and
`approvedCrossModuleReads` in `module-boundaries.yaml`.

Deno lint does not parse `.astro` templates. `deno task check` therefore also
runs `astro check`, although its warnings do not fail the gate yet (the accepted
requirement is warnings treated as failures), and `deno task lint` runs a
targeted ESLint flat configuration
([`eslint.config.js`](../../eslint.config.js)) over `apps/web/src` for
`eslint-plugin-astro`, Astro accessibility rules, and the official React hooks
rules on interactive islands. Do not duplicate all generic TypeScript style
rules in ESLint; Deno remains their canonical owner.

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

A backend unit test sits next to the file it exercises: `application/x.ts` is
tested by `application/x_test.ts`, `domain/x.ts` by `domain/x_test.ts`, and an
adapter or transport file the same way inside its own folder. A suite that
exercises several files with separate behaviours is split per file rather than
kept whole at the module root. No `_test.ts` sits at a module or read-model
root; `tools/tasks/manifest_test.ts` fails a suite placed there. Moving a suite
keeps its single unit home and the coverage sets that run it.

Run Playwright against Chromium, Firefox, and WebKit in CI. Add automated
accessibility checks such as axe to each representative page state, plus
keyboard-only workflow assertions. Accessibility checks complement, rather than
replace, semantic component tests.

- Hydration budget: each island's hydrated bytes are measured and recorded in
  its candidate's evidence, and static and public pages ship no React
  ([ADR 0006](decisions/0006-ui-stack-shadcn-react-islands.md)).
- Island readiness: each island sets `data-island-ready` after hydration, and
  E2E waits on that marker before interacting with the island.

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
- generated Kysely type drift detection (in place: the `test:integration` drift
  check above);
- rejection of every cross-workspace relationship path;
- Monica import idempotency and complete table/column mapping fixtures;
- all partial-date precisions and invalid combinations;
- reminder regeneration, time-zone, and daylight-saving cases;
- missing, quarantined, and inaccessible attachments;
- proof that imported legacy credentials are not activated.

Run these tests against PostgreSQL, not an in-memory substitute or SQLite
compatibility layer.

The baseline harness covers the database-enforceable subset now, and
`test:integration` checks generated Kysely drift. Cross-workspace application
rejection, complete importer semantics, time-zone-aware reminder generation,
object-store behavior, and credential activation require application code and
must be added without weakening the existing database checks.

Apart from generated-type drift, those application-boundary proofs now run in
`deno task test:integration`: cross-workspace negatives in the module and
read-model suites (GAP-037), the `IMPORT-001` suite's atomicity, idempotency,
and inactive legacy credentials, time-zone-aware reminder generation in the
planning suites, and object-store timeout, missing-object, and
quarantined-object cases against a pinned RustFS
(`files_object_store_postgres_test.ts`).

## Deno Dependency and Security Gates

CI's Deno version matches the one pinned in `.tool-versions`, and CI executes:

- frozen dependency installation (`deno task deps:deno`, `deno task deps:node`);
- `deno fmt --check` only on owned, supported paths;
- `deno lint` with the recommended rules plus `eqeqeq` (no architecture plugin;
  the boundary checker runs as `check:architecture`);
- `deno check` over every manifest target: entry points, tools, and tests;
- `deno test` with Deno's default leak detection;
- coverage reporting with 80% line, branch, and function thresholds (95% for the
  shared kernel and the domain sets);
- `deno audit`, failing at high severity, with the documented exceptions above.

Still targets rather than gates: `astro check` warnings treated as failures,
randomized test ordering, a dependency freshness review of `deno outdated`, and
an executable check that npm lifecycle-script decisions (`allowBuilds` in
`pnpm-workspace.yaml`) and Deno runtime permissions match explicit allowlists.
`minimumDependencyAge` in `deno.json` and `minimumReleaseAge` in
`pnpm-workspace.yaml` hold new versions back for 72 hours.

Tests should run with the smallest permissions that fit their layer. A test
unexpectedly requiring broad filesystem, network, environment, subprocess, FFI,
or system access is a review signal. Never normalize `--allow-all` as the CI
default.

## Hooks

Deno has no Git-hook manager. Use Lefthook only to invoke repository tasks:

- pre-commit: the non-mutating formatter check and lint, filtered to the staged
  files (`deno fmt --check`, `deno lint`, and ESLint for Astro templates);
- pre-push: the whole-repository `deno task fmt:check`, `deno task lint`, and
  `deno task check`, then `deno task test:unit` and `deno task test:contract`;
- CI: the authoritative full suite, including all E2E browsers and
  security/dependency gates.

Pre-commit must not format, fix, stage, or restage files. `deno task fix` is an
explicit developer action. Target less than 15 seconds for pre-commit and less
than three minutes for pre-push; measured checks that exceed those budgets move
to CI rather than being silently skipped, which is why the integration, schema,
and E2E suites are CI-only. The static gates are the exception to the budget:
pre-commit sees only staged files, and lint, type, and runtime-pin errors in
untouched files reached `main` and stayed red there for weeks, so the push hook
runs them over the whole repository and accepts about ninety seconds more. The
pre-commit staged-file filter mirrors the formatter's and the linter's own
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
`pnpm exec lefthook install`. `TASK_BUDGET` in `tools/tasks/manifest_test.ts`
caps the verb vocabulary at 26, so there is no `hooks:install` task. Hooks are
convenience feedback and remain bypassable; CI is authoritative.

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

| Job                | When                    | Gates                                                                                                                                                                   |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`           | every run               | `fmt:check`, `lint`, `check:architecture`, `check`, `contracts:check`, `test:contract`, `deps:audit` (full report), and `deps:audit:gate` (high severity, no exception) |
| `unit`             | every run               | `test:unit`, then `test:coverage` against the 80% thresholds                                                                                                            |
| `integration`      | every run               | `test:integration` on its own disposable PostgreSQL 18.4 project: the migrations, the Kysely type drift check, then the suites                                          |
| `schema`           | every run               | `test:schema` against the pinned PostgreSQL image                                                                                                                       |
| `e2e-chromium`     | pull requests           | `test:e2e --project=chromium` against the Compose stack, uploading Playwright traces on failure                                                                         |
| `e2e-all-browsers` | `main`, nightly, manual | the whole Chromium, Firefox, and WebKit matrix                                                                                                                          |
| `images`           | `main`, nightly, manual | production builds of `Dockerfile.api` and of the `web` and `gateway` targets of `Dockerfile.web`                                                                        |

`static`, `unit`, `integration`, and `schema` run in parallel; the three
expensive jobs wait for `static`. Coverage is never split in a way that lets
uncovered code evade the aggregate threshold.

[`tools/pipeline_contract_test.ts`](../../tools/pipeline_contract_test.ts) is
the executable consumer of this workflow and of `lefthook.yml`. It proves the
required jobs and hook stages exist, that the job graph stays acyclic, that
installation stays frozen, that the pinned Deno version and the Node image
version match `.tool-versions`, and that every command either names a declared
`deno.json` task or a declared dependency binary.

The flow catalog gate runs inside `test:unit` (see the coverage contract above).
Still missing: the page-catalog route gate, container image scanning, and
artifact publication beyond the Playwright traces the E2E jobs upload on
failure. Upload coverage, test, OpenAPI, and migration verification artifacts on
failure as those gates arrive.
