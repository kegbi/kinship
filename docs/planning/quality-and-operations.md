# Quality, Delivery, And Operations Plan

## Purpose

This plan turns the accepted quality, Compose, configuration, migration, and
observability contracts into an implementation sequence. It supplements, but
does not replace:

- [`quality-gates.md`](../architecture/quality-gates.md);
- [`compose-contract.md`](../architecture/compose-contract.md);
- [`configuration-and-secrets.md`](../architecture/configuration-and-secrets.md);
- [`migration-policy.md`](../architecture/migration-policy.md); and
- [`observability.md`](../architecture/observability.md).

Quality work is part of each vertical slice. A separate hardening phase may add
depth, but it may not repair missing baseline tests after a flow is marked
delivered.

## Test-First Delivery And Independent Review

Every behavior and every enforcement mechanism follows the repository's strict
delivery loop:

1. **RED** adds the narrowest truthful test, validator, or bounded executable
   probe before production changes and records the intended failure.
2. **GREEN** makes only the smallest architecture-compliant change needed to
   pass that proof.
3. **REFACTOR** improves structure while the focused and affected checks remain
   green; newly discovered behavior returns to RED.
4. A fresh clean-context reviewer inspects the exact candidate revision and its
   evidence. Every actionable finding returns to a fresh implementer for a new
   RED -> GREEN -> REFACTOR cycle and then a new review.
5. The orchestrator independently reruns the applicable gates before accepting
   or integrating the reviewed revision.

This ordering applies to application code, UI, migrations, containers, CI,
hooks, documentation, schemas, catalogs, configuration, and repository tooling.
Coverage added after implementation is not RED evidence, and a command that does
nothing is never an acceptable harness.

## Current Executable Commands

At the 2026-08-11 baseline, `deno.json` exposes only these real tasks:

| Command                            | Current executable scope                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| `deno task fmt`                    | Format paths currently owned by the root Deno configuration. |
| `deno task fmt:check`              | Check formatting for those current paths without mutation.   |
| `deno task lint`                   | Lint the existing repository tools.                          |
| `deno task check`                  | Type-check the PostgreSQL schema and workflow tools.         |
| `deno task ticket:validate`        | Validate one autonomous ticket evidence directory.           |
| `deno task test:workflow`          | Run the dependency-free workflow validator suite.            |
| `deno task test:workflow:coverage` | Enforce 100% line, branch, and function workflow coverage.   |
| `deno task test:schema`            | Run the primary live PostgreSQL schema harness.              |
| `deno task test:schema:compat`     | Run the compatibility PostgreSQL schema harness.             |
| `deno task test:schema:matrix`     | Run both current schema harness variants.                    |

No application unit, integration, contract, coverage, browser, hook, main
Compose, or CI aggregate command exists yet. Do not cite a future command as
passing evidence. Introduce each missing command only after a RED self-test or
bounded probe demonstrates the absent behavior, then make the command execute a
real suite before any hook or CI provider calls it.

## Planned Canonical Command Contract

The root `deno task` interface remains the one supported entry point even when a
task delegates to pnpm, Astro, Vitest, Playwright, Docker Compose, or a helper
binary. Lefthook invokes these tasks; validation tasks do not delegate their
semantics to Lefthook. The table below is the target command contract. Existing
names remain executable with their current narrow scope until their test-first
expansion is delivered; all other names are planned and must not be represented
as available early.

| Command                        | Required behavior                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `deno task fmt`                | Format owned source/document/config paths; never rewrite the canonical schema bundle.         |
| `deno task fmt:check`          | Non-mutating formatter verification for all owned paths.                                      |
| `deno task fix`                | Explicit formatting and safe lint fixes; never run from hooks or CI.                          |
| `deno task lint`               | Deno strict lint plus targeted Astro/accessibility/React ESLint.                              |
| `deno task check`              | Deno check for every backend/tool entry point, `astro check`, and frontend TypeScript checks. |
| `deno task check:architecture` | Module/import/schema/catalog/route/flow/generated-file enforcement.                           |
| `deno task test:unit`          | Backend domain/application and frontend utility/component unit tests.                         |
| `deno task test:integration`   | Real PostgreSQL and external-boundary integration suites in an isolated project.              |
| `deno task test:schema`        | Existing primary PostgreSQL schema harness.                                                   |
| `deno task test:contract`      | Port adapters, OpenAPI, generated clients/types, problems, and schema drift.                  |
| `deno task test:e2e`           | Production-like gateway stack in Chromium, Firefox, and WebKit.                               |
| `deno task test:coverage`      | Independent 100% backend and frontend production TypeScript gates.                            |
| `deno task test:prepush`       | Full non-browser suites plus a Chromium production-stack smoke project.                       |
| `deno task test`               | Complete local test aggregate with explicit documented scope.                                 |
| `deno task ci`                 | Frozen install, static checks, full tests, security gates, and artifact rules.                |

Preserve the current `deno task test:schema:matrix` helper. The accepted target
also requires `deno task hooks:install`, `deno task dev:reset-data`, and
`deno task test:down`, but those helpers are planned until their truthful
harnesses exist. Add narrowly named helpers for frozen install, frontend/backend
build, Compose validation, isolated-stack lifecycle, OpenAPI/client generation,
database-type generation, drift checks, and diagnostics as their behavior is
implemented. The names `migration:status`, `migration:plan`, `migration:apply`,
and `migration:verify` remain proposals until DG-02 selects the runner and
synchronizes naming across the accepted contracts. Helpers are implementation
details behind canonical commands, not alternate pipelines.

## Static And Tooling Gates

- Reject production `any`. Unsafe assertions require a localized validation
  boundary or a narrow, explained lint suppression.
- Run `astro check` with warnings treated as failures, plus targeted Astro,
  accessibility, and React-hooks ESLint rules.
- Trial the pinned Deno Astro-component formatter on representative files; use a
  pinned, documented fallback only if the accepted formatter proof fails.
- Enforce consistent shadcn primitive families; do not mix overlapping component
  systems without a reviewed exception.
- Run `deno audit`, apply the vulnerability exception policy, and review
  `deno outdated` under the accepted dependency-freshness policy.
- Enable leak detection and randomized test ordering where useful and make any
  deterministic-order dependency fail visibly.

## Coverage Interpretation

The 100% requirement is enforced independently for the two executable TypeScript
environments:

1. Deno production TypeScript/TSX: 100% lines, branches, and functions.
2. Frontend production TypeScript/TSX: 100% lines, branches, and functions.

Holding each scope at 100% prevents an aggregate report from hiding missing
frontend coverage behind backend volume or vice versa. Statements should also
remain at 100% in the frontend provider when it reports them.

Coverage configuration must use an exhaustive `include` set for every production
source directory. A file that no test imports must still appear as uncovered;
the test graph alone is not the denominator.

The reviewed exclusion manifest may contain only:

- generated API/database code with a named drift generator;
- declaration-only and type-only files;
- demonstrably unreachable defensive assertions with a written rationale.

Composition roots, bootstrap, API/worker entry points, transports, adapters, and
read models remain production code. Cover them through merged unit, integration,
contract, and process-observable coverage rather than excluding them.

Every exclusion names the file, reason, owner, and review date. Directory-wide
ignores and casual coverage comments are forbidden.

E2E 100% is separate: every delivered required flow has a real Playwright test
reference and every applicable page state has its required coverage. Browser
source instrumentation cannot replace the flow catalog.

## Test Layers

| Layer                          | First introduced                                 | Required scope and environment                                                                                            | Release signal                                                                                                            |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Domain unit                    | First use case in each module                    | Pure TypeScript values, invariants, state transitions, policies, serializers; no ambient I/O permissions                  | Blocking                                                                                                                  |
| Application unit               | First use case in each module                    | Authorization branches, orchestration, transaction decisions, retry/idempotency policy using fakes and injected clock/IDs | Blocking                                                                                                                  |
| Architecture-rule unit         | Slice 0                                          | Positive/negative fixtures for every custom lint and graph rule                                                           | Blocking                                                                                                                  |
| Port contract                  | First concrete adapter                           | One shared suite per repository, object store, mail, telemetry, clock, ID, auth, and provider contract                    | Blocking                                                                                                                  |
| PostgreSQL adapter integration | First repository in each module                  | Real PostgreSQL 18 primary; transactions, constraints, locks, cursors, workspace negatives, shutdown                      | Blocking                                                                                                                  |
| Compatibility integration      | Schema/driver/locking-sensitive changes          | PostgreSQL 17 compatibility image                                                                                         | Blocking for affected changes                                                                                             |
| Schema                         | Already present; extend per slice                | Apply/rollback/reapply/catalog plus application-boundary schema behavior                                                  | Blocking                                                                                                                  |
| Frontend utility unit          | First web code                                   | Pure formatting/state/query helpers in Vitest                                                                             | Blocking                                                                                                                  |
| Browser component              | First island/component                           | Real browser events, forms, focus, keyboard, history, live regions, and network fakes                                     | Blocking                                                                                                                  |
| API contract                   | Slice 0 onward                                   | OpenAPI 3.1 validity, all media/status variants, RFC 9457, stable codes, auth/tenant negatives, generated drift           | Blocking                                                                                                                  |
| E2E flow                       | Every delivered flow                             | Production-built Compose stack through gateway; three browser engines                                                     | Blocking                                                                                                                  |
| Accessibility automation       | First page state onward                          | Axe on representative states plus semantic assertions                                                                     | Blocking                                                                                                                  |
| Manual accessibility           | Before external beta and major UI changes        | Screen-reader/zoom/reflow/keyboard/reduced-motion review against the proposed WCAG 2.2 AA target                          | Blocking for production after target approval                                                                             |
| Migration upgrade/recovery     | First app migration onward                       | Empty and prior release, lock contention, kill points, postconditions, recovery                                           | Blocking                                                                                                                  |
| Backup/restore acceptance      | Before production data                           | PostgreSQL and object backup, restore, manifest reconciliation, missing-object behavior                                   | Blocking for production                                                                                                   |
| Security verification          | Slice 0 onward                                   | ASVS-derived controls, auth abuse, CSRF, IDOR/tenant, upload, secrets, dependency/container scans                         | Blocking according to severity policy                                                                                     |
| Performance/load               | Baselines in Slice 1; trend through feature work | Named datasets and workloads for API/page/query/worker/import/export behavior                                             | Diagnostic until the DG-10 MVP checkpoint; blocking for the proposed MVP afterward, with production SLOs gated separately |
| Resilience                     | Worker/files/import slices                       | Dependency loss, timeouts, retries, restart, duplicate/process-death behavior                                             | Blocking for affected flow                                                                                                |
| Mutation                       | After a stable fast suite                        | Identity, tenant, partial-date, recurrence, import logic                                                                  | Diagnostic initially; promoted only by decision                                                                           |

All Deno tests explicitly request the minimal permissions they need and enable
operation/resource sanitization intentionally. Do not depend on runtime-default
sanitizer behavior.

## Test Data And Fixture Architecture

### Deterministic primitives

- Inject clocks, UUID sources, randomness, and provider responses.
- Store instants in UTC and make timezone/locale inputs explicit.
- Use builders that produce valid aggregates by default and make invalid cases
  visible at the call site.
- Seed through public fixture/application APIs after migration; do not bypass
  invariants with ad hoc SQL except in adapter/schema-specific tests.

### Mandatory tenant fixtures

Every integration and E2E harness starts with at least:

- Workspace A: owner, admin, member, suspended/inactive membership where needed.
- Workspace B: distinct owner/member and deliberately colliding human-readable
  names/tags/people.
- A multi-workspace user for active-context tests once its flow is accepted.
- Cross-workspace IDs for every new aggregate and link command.

Cross-workspace cases are generated from the command schema so a newly added ID
field cannot escape the negative matrix.

### Time fixtures

Cover:

- UTC and a non-UTC ordinary zone;
- a DST gap and fold zone;
- a zone with a non-hour offset;
- local midnight/month/year boundaries;
- leap day and invalid calendar combinations;
- member-timezone change after occurrence generation; and
- workspace default versus member override.

Use explicit IANA zone names and fixed tzdata/runtime images. Do not assert on
the developer machine's local zone.

### Scale fixtures

Before performance budgets are accepted, define small, medium, and large
workspaces with measured counts for people, interactions, tasks/reminders,
files, journal items, audit events, import rows, and concurrent members. The
large dataset must be large enough to exercise cursor pagination, indexes,
progressive profile loading, and long-running jobs.

### Monica compatibility fixtures

Keep sanitized, license-reviewed fixtures for:

- Monica UI SQL export;
- Monica UI JSON export;
- raw database backup at each accepted source-version family;
- vCard/CSV if included in the approved MVP support matrix;
- storage archive with complete files;
- missing/corrupt/quarantined storage objects;
- old/missing/extra columns and legacy enum values;
- orphan and duplicate source references;
- all 94 table and 823 column mapping treatments; and
- every credential class, proving the accepted activation policy.

Fixture manifests record source profile/version, expected row counts, expected
warnings, target checksums, and secrets that must not appear anywhere.

## Flow And Page E2E Structure

- Each spec uses the stable flow ID in a Playwright `flow` annotation or title.
- The catalog checker reads test metadata without depending on an unstable
  reporter format; a repository-owned manifest/extractor has compatibility tests
  against the pinned Playwright version.
- A flow's happy path and browser-visible alternate outcomes may be separate
  tests, but the catalog points to the complete set.
- Do not mark `deliveryStatus: delivered` until test references exist and pass.
- Retries never convert a retry-only pass into a green release signal. Report
  first-attempt failure and quarantine only through a time-bounded reviewed
  record.

Page coverage is generated from `page-catalog.yaml` and includes applicable:

- ready;
- loading/skeleton;
- meaningful first-use and no-result empty states;
- validation and recoverable dependency errors;
- forbidden direct navigation;
- not found/stale identifiers;
- archived/read-only and module-disabled states;
- desktop and narrow responsive layouts;
- keyboard-only primary paths; and
- automated accessibility on representative state families.

Synthetic error-state controls exist only in test builds or through
deterministic adapter fixtures; production UI must not expose hidden failure
toggles.

## Architecture And Catalog Enforcement

`check:architecture` must fail on:

- a canonical table with zero or multiple owners;
- a module dependency not in the allowlist or any dependency cycle;
- imports into another module's private layers;
- a read model reading an unapproved module or issuing a mutation;
- Hono, Zod, Kysely, database drivers, environment, filesystem, network, wall
  clock, or random APIs in domain code;
- infrastructure access in application code outside an owned port;
- frontend imports from backend source;
- production `console` calls outside approved bootstrap/tool paths;
- partial or reformatted changes to the synchronized schema bundle;
- hand-edited generated files or generation drift;
- shipped routes absent from the page catalog;
- unknown/reused page, flow, module, permission, or section IDs;
- delivered flows without known test references;
- page/flow references that disagree under the accepted association semantics;
  and
- a built route whose rendering/access strategy differs from the catalog.

The checker has unit fixtures for each rejection and a positive fixture for each
narrow exception such as composition roots and allowlisted read models.

## Compose Test Harness

### Project identity

- Accept a test-run ID matching a narrow character/length grammar.
- Derive one Compose project name from that ID and print it before mutation.
- Never use an empty environment value, current directory alone, a global Docker
  prune, or an unvalidated glob as a cleanup target.
- Support concurrent local worktrees and CI jobs without fixed host ports.

### Lifecycle

1. Render and validate the exact merged Compose configuration.
2. Start with empty project-scoped database/object volumes.
3. Wait for PostgreSQL health.
4. Run the same one-shot migration image/command used for deployment.
5. Start API and worker after successful migration. Start the DG-01-selected
   renderer if required. Gateway readiness waits for API readiness, built static
   assets, and that renderer when present; worker/provider degradation is
   reported separately and does not block gateway readiness.
6. Seed through supported fixtures.
7. Run browser/HTTP behavior through gateway TLS using a test CA or another
   explicitly accepted secure-cookie/origin test mechanism. Run lower-layer
   integration work only through the runner topology accepted below.
8. On failure, collect state/config, bounded redacted logs, health, migration
   report, traces, database diagnostics, and Playwright artifacts.
9. In a finalizer, remove the exact project, disposable volumes, and orphans.

Fixed sleeps are forbidden. Use health/readiness and bounded polling with useful
timeout diagnostics.

FND-10 must choose and document the runner location in the Compose contract. The
recommended model is a profile-gated one-shot test-runner image on the private
network, controlled by a host-side harness; the alternative is a host runner
using validated dynamically discovered loopback ports. Do not assume an
uncataloged private endpoint or publish fixed data-service ports.

Preserve `compose.schema-test.yaml` and its narrow schema matrix as an
independent harness until an accepted change proves complete equivalence.
`dev:reset-data` and `test:down` retain their exact scoped semantics. Production
reset never becomes a Compose helper: it needs a restore point and operator
runbook. Redact secrets and sensitive values from rendered Compose configuration
and all diagnostics before artifact upload.

### Image requirements

- Multi-stage, frozen builds with minimal trusted bases and `.dockerignore`.
- Exact runtime/service tags and reviewed digests.
- One backend artifact/image, explicit API and worker commands.
- Non-root user, read-only root filesystem, explicit tmp/cache paths, graceful
  signal handling, and bounded stop times where supported.
- No package installation at container startup.
- Health tools baked deliberately into the image.
- No secrets in layers, build args, Compose YAML, CLI args, or browser bundles.
- SBOM, provenance, vulnerability scan, and documented exception policy.
- Playwright package, browser binaries, and test image remain version-matched.

## CI Pipeline

These stages describe the provider-neutral target, not a currently installed CI
workflow. First make each root command truthful and self-tested locally. Then
select the CI provider and record its permissions, event/fork policy, secret
boundary, immutable third-party pins, artifact retention, and required-check
mapping before adding provider-specific configuration. CI aggregates the same
root commands; it must not become the first or only implementation of a gate.

### Stage 1: Reproducibility and static contracts

- Frozen Deno and pnpm installs.
- Lockfile/manifests, package age, lifecycle-script allowlists, and generated
  drift.
- Schema-bundle integrity, formatting, lint, type checks, architecture,
  catalogs, routes, and workflow references.

### Stage 2: Independent coverage

- Run backend unit/application suites and retain mergeable coverage without
  declaring the final backend threshold yet.
- Frontend utility/component suites enforce their independent exhaustive 100%
  line/branch/function gate.
- Upload HTML/lcov and test reports on failure or explicit request, with short
  access-controlled retention.

### Stage 3: Real dependency verification

- PostgreSQL 18 adapter/integration and schema suites.
- PostgreSQL 17 schema and affected compatibility suites.
- Object-store/mail/provider adapter contracts and failure cases.
- Merge all backend unit, integration, contract, and process-observable reports,
  include every production domain/application/adapter/transport/read-model/
  bootstrap/API/worker path, reject shard gaps, and enforce the final
  independent 100% line/branch/function gate.

### Stage 4: Immutable build

- Build and scan pinned production images from frozen dependencies.
- Create SBOM/provenance.
- Render the production-like Compose stack with immutable image references.

### Stage 5: Contract and browser behavior

- OpenAPI 3.1 and generated-client checks against the built API.
- Playwright flows/page states/accessibility through gateway on Chromium,
  Firefox, and WebKit.
- Isolate sharding so the complete workflow manifest and coverage reports are
  reconciled before promotion.

### Stage 6: Security and release evidence

- Deno and frontend dependency audits, secret scan, image scan, permission
  policy, and migration report. Signing/attestation becomes mandatory only after
  its proposed supply-chain policy and CI/deployment provider are accepted.
- Release candidates also run upgrade/recovery, backup/restore, performance, and
  deployment smoke jobs required by the target environment.

Independent jobs may run in parallel. A final gate consumes every report and
must not infer success from a missing artifact.

## Local Hooks

After canonical tasks are stable:

- pre-commit runs non-mutating format, lint, check, architecture/catalog, and
  fast unit work; target under 15 seconds;
- pre-push runs unit, integration, schema, contract, and a Chromium smoke flow;
  target under three minutes where measurement allows; and
- CI remains authoritative and cannot be replaced by a hook.

Move measured slow checks to CI explicitly; never silently skip them. Hook
installation is idempotent and versioned.

## Security And Privacy Verification

Use DG-10's security checkpoint before Slice 1 to propose and approve a
versioned OWASP ASVS 5.0 Level 2 verification profile; it is not an accepted
target yet. Once a target is approved, maintain a repository control matrix
linking applicable requirements to code/tests/runbooks and marking
non-applicable items with rationale. Until then, all security gates already
required by the architecture remain blocking.

At minimum, test:

- authentication enumeration, brute-force/rate-limit integration, session
  fixation/rotation/revocation, MFA/passkey ceremonies, recent-authentication,
  recovery, and key rotation;
- CSRF, origin/CORS, cookie attributes, redirect/token leakage, cache headers,
  security headers, and sensitive problem details;
- IDOR and workspace isolation for every identifier/link/filter/cursor;
- last-owner, role, invitation, account/workspace lifecycle, and worker
  capability boundaries;
- SQL injection by construction, stored/reflected DOM injection, unsafe URLs,
  markdown/rich-text handling if added, and external-response validation;
- upload size/type/content/path, archive bombs/traversal, malware/quarantine,
  signed download scope/expiry, and object mismatch;
- import parser limits, secret redaction, credential non-activation, and
  diagnostic/artifact exposure;
- secrets in config/logs/traces/errors/client bundles/build output/artifacts;
- dependency, package-script, CI token, container, and base-image supply chain;
  and
- AI prompt injection, sensitive information disclosure, output validation,
  excessive agency, denial/cost, and cross-workspace retrieval after DG-08.

Relationship data is sensitive personal data. Before production, define data
classification, retention/deletion, export, backup retention, support access,
telemetry sampling/redaction, incident response, and provider processing rules.

## Observability Acceptance

Every request/background operation carries safe correlation and records:

- service, release, instance, environment, and schema version;
- normalized route or use-case name;
- trace/span and safe request reference;
- result class and stable application error code;
- duration;
- retry/attempt and idempotency context where applicable; and
- pseudonymous workspace/actor only when policy approves it.

Required dashboards/alerts are derived from user-visible failure modes:

- API availability/latency/error class and database pool/timeouts;
- worker claim lag, attempts, delivery lag, terminal/manual-attention outcomes;
- import/export phase duration, stale jobs, reconciliation failures;
- object/mail/provider errors and quarantine/mismatch;
- migration status/checksum/failure; and
- readiness transitions and resource saturation.

Metric labels never contain person IDs, raw workspace IDs, emails, route
parameters, filenames, CRM text, SQL parameters, or free-form errors. Audit
events remain durable product history and are not reconstructed from telemetry.

Collector unavailability cannot corrupt or block domain transactions. The
collector profile uses a pinned image, private endpoints, health check,
batching, memory limiting, and redaction/filtering before export.

## Performance And Reliability Plan

DG-10 has two explicit checkpoints. Before proposed-MVP feature acceptance, it
must approve a representative small/medium/large dataset, browser/device
baseline, concurrency assumptions, and functional performance ceilings for the
in-scope pages, API operations, queries, worker work, import, and export. Those
accepted ceilings become blocking MVP regression gates. Before production
promotion, DG-10 must additionally approve deployment-specific SLOs, error
budgets, provider limits, saturation targets, RTO/RPO, and alert thresholds.
Passing the MVP checkpoint is not production-readiness evidence.

Measure at least:

- public/static and authenticated-shell asset budgets and Web Vitals;
- first identity/due-summary render and lazy profile-section latency;
- people search/cursor performance and stale-cursor behavior;
- Today attention query and independent secondary-region latency;
- task/reminder mutation latency and worker delivery lag;
- audit/history pagination;
- upload/download throughput and memory bounds;
- import dry run/commit and export throughput on accepted maximum inputs;
- database pool saturation, query plans, locks, deadlocks, and statement
  timeouts; and
- cold start, graceful shutdown, dependency loss, and recovery.

Performance tests fail on the budgets accepted for the relevant checkpoint and
publish trend data. Do not hide a functional timeout by raising limits without
query/profile evidence and an approved decision update.

## Migration And Release Verification

For every persistent schema release:

- create a synchronized schema bundle and immutable ordered migration;
- apply from empty and the previous supported release on both PostgreSQL
  versions;
- verify checksums, catalog, Kysely types, application compatibility, and
  postconditions;
- test concurrency and kill points;
- name the expand/contract sequence and incompatible overlap window;
- rehearse the chosen recovery path; and
- record data disposition for destructive or security-sensitive changes.

Deployment order is backup/restore readiness, migrate, API/worker and any
selected renderer readiness, gateway promotion, smoke, and post-deploy integrity
checks. API and worker never auto-migrate; worker/provider degradation remains
distinct from public gateway readiness.

## Backup And Restore

Before storing production data, prove in an isolated environment:

1. consistent PostgreSQL backup and restore;
2. object-store backup/replication and manifest capture;
3. restored schema/application compatibility;
4. database/object reconciliation, including missing and extra objects;
5. restore of encryption/key dependencies according to policy;
6. measured recovery time and data-loss window against accepted RTO/RPO; and
7. a documented operator runbook with verification and abort criteria.

Workspace export is portability, not a replacement for operational backup.

## MVP Feature Acceptance Checklist

The proposed MVP, Core alpha, or another feature milestone may be marked
scope-complete only when:

- its milestone definition and catalog snapshot are approved;
- every in-scope flow derived from that snapshot is `delivered` with current
  test references; never hard-code a count after catalog closure;
- every in-scope page/action and required state passes its behavioral, keyboard,
  and representative automated-accessibility checks;
- backend and frontend production TypeScript independently report 100% line,
  branch, and function coverage;
- schema, architecture, catalog, OpenAPI, generated client, and database types
  show no drift;
- PostgreSQL primary/compatibility and all affected adapter contracts pass;
- production images and three-browser E2E pass through the gateway and selected
  rendering path;
- the performance/capacity checkpoint required for that milestone is approved
  and its in-scope regression budgets pass;
- every schema change has empty/prior-release migration and recovery evidence;
- accepted security gates and secret-redaction checks pass; and
- implementation, catalog, ADR, and operator-facing change documentation agree;
- every included ticket has recorded RED/GREEN/REFACTOR evidence, a fresh
  clean-context review with no unresolved actionable finding, and independent
  orchestrator acceptance.

This checklist accepts feature scope, not a deployment. It deliberately does not
waive or imply provider, SLO, backup/restore, incident, rollout, or other
production-readiness evidence.

## Production Release Promotion Checklist

A named release is promotable only when:

- its selected feature milestone passes the checklist above;
- its slice flows are delivered with current test references;
- backend and frontend production TypeScript independently report 100%;
- schema, architecture, catalog, OpenAPI, generated client, and database types
  show no drift;
- PostgreSQL primary/compatibility and all required adapter contracts pass;
- production images and three-browser E2E pass through the gateway;
- no finding violates the accepted severity/exception policy and no secret
  exposure exists;
- approved accessibility and performance gates for the release audience pass;
- migration and recovery evidence is attached;
- operational runbooks, dashboards, alerts, and ownership are ready;
- backup/restore evidence is current for production promotion; and
- rollback/canary/smoke and post-deploy verification steps are named.

The final gate reports missing evidence as failure, not "not applicable," unless
an accepted contract explicitly says so.
