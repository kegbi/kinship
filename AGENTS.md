# AGENTS.md

## Purpose

This repo builds a Monica-compatible, modern relationship management system: a
person-centered personal CRM on current production technologies, with a built-in
MCP endpoint, AI assistance, and a fully supported import of Monica data
exports.

## Core Goals

- Maintain at least 80% line, branch, and function coverage for production code.
  Required user flows still need end-to-end coverage, and changed behavior,
  security/tenant boundaries, and schema behavior always need focused tests.
- Build a modular, expandable architecture that supports future extensibility
  without forcing broad rewrites.
- Preserve solid architectural boundaries so each application module can be
  swapped, extended, or replaced independently.

## Delivery Default

Ship vertical user-visible behavior. The accepted architecture, product,
authorization, and schema documents are sufficient to start application work. Do
not add another contract, spike, validator, framework, or foundation ticket
unless the active feature is concretely blocked without it.

Production behavior follows a small RED -> GREEN -> REFACTOR cycle:

1. Add the narrowest focused test for the requested behavior or regression and
   observe the intended failure before changing production code.
2. Implement the smallest architecture-compliant change that passes it.
3. Refactor only while focused and affected tests remain green.

Apply evidence proportionately:

- Ordinary feature work runs its focused tests and affected existing gates.
- Database, security, tenant, API, browser, and infrastructure tests are added
  when the ticket changes those boundaries, not pre-emptively for future work.
- Required cataloged user flows receive Playwright coverage when the complete
  flow is delivered. A scaffold does not pretend to deliver a flow.
- Documentation-only planning changes use review and existing validators. They
  do not require a new permanent test unless machine-consumed behavior changes.
- Spikes are time-boxed to the decision needed by the active feature. Once one
  option is selected or an option is rejected, stop hardening rejected
  alternatives.

Use one clean implementer context per ticket and one separate clean, read-only
reviewer for the exact candidate. Keep a single candidate commit; do not create
test-freeze commits, hash catalogs, controller IDs, packet files, mirrored
state, or evidence documents solely to operate the workflow. Review findings
normally return to the same implementer with a regression test. Use a fresh
implementer only for high-risk redesign or after a repeated failed approach.

The controller integrates only an approved exact candidate after rerunning the
applicable gates. See
[docs/development/autonomous-delivery.md](docs/development/autonomous-delivery.md)
and invoke the repo-local `run-tdd-ticket-loop` skill for autonomous
implementation. The active work order is
[docs/planning/active-delivery.md](docs/planning/active-delivery.md).

## Technology and Architecture Baseline

- [docs/architecture/README.md](docs/architecture/README.md) is the entry point
  for technology and architecture decisions. It distinguishes accepted
  constraints from proposals that still require explicit approval.
- [docs/architecture/technology-baseline.md](docs/architecture/technology-baseline.md)
  records the accepted runtime, frontend, database, container, and delivery
  constraints, plus the evaluated framework and library candidates.
- [docs/architecture/backend-architecture.md](docs/architecture/backend-architecture.md)
  defines the modular-monolith boundaries, dependency direction, workspace
  isolation rules, API contract, and accepted container topology.
- [docs/architecture/quality-gates.md](docs/architecture/quality-gates.md)
  defines the mandatory coverage interpretation, Deno-first checks, schema
  tests, dependency controls, hooks, and CI gates.
- [docs/architecture/repository-layout.md](docs/architecture/repository-layout.md)
  fixes the scaffold paths, public entry points, import rules, and generated
  artifact locations.
- [docs/architecture/module-boundaries.yaml](docs/architecture/module-boundaries.yaml)
  is the machine-readable authority for module IDs, table ownership, allowed
  dependencies, events, and cross-module read models.
- [docs/architecture/authorization-matrix.yaml](docs/architecture/authorization-matrix.yaml)
  defines the baseline roles, permissions, scopes, and tenant-security
  invariants.
- [docs/architecture/compose-contract.md](docs/architecture/compose-contract.md),
  [docs/architecture/configuration-and-secrets.md](docs/architecture/configuration-and-secrets.md),
  [docs/architecture/migration-policy.md](docs/architecture/migration-policy.md),
  and [docs/architecture/observability.md](docs/architecture/observability.md)
  define the infrastructure contract before implementation versions are chosen.

The accepted implementation baseline is Docker Compose, PostgreSQL, a Deno
backend, Astro as a static-first frontend, TypeScript throughout application
code, current stable shadcn/ui components for interactive UI, and automated
unit, integration, contract, and end-to-end tests. React is permitted only where
shadcn/ui or an interactive Astro island requires it. Do not turn the
application into an always-server-rendered SPA without an explicit architecture
decision.

<!-- deno-fmt-ignore -->
The production-like frontend topology keeps `web` as a private Astro renderer for exactly the page catalog's `on-demand` routes. The gateway serves static, prerendered, and fingerprinted output, forwards `/api/v1/*` to the private `api`, and is the only public entry point. Development alone may override `web` to run `astro dev`.

Start as a modular monolith with a separately runnable API and worker built from
the same backend codebase. Domain and application code must not depend on Hono,
Astro, database drivers, or other delivery and infrastructure frameworks.
Modules communicate through public application interfaces or explicitly approved
read models, never by importing another module's adapters or repository
internals.

The selected implementation stack includes Hono, Zod, Kysely with Postgres.js,
and Lefthook. A bounded Better Auth compatibility spike is approved, but Better
Auth itself is not an accepted dependency until the spike proves exact
compatibility with the canonical identity schema. Do not silently substitute
Bun, add Redis, introduce microservices, or let an ORM become a second schema
source of truth. Record a new architecture decision before changing these
choices.

The PostgreSQL DDL below remains the sole schema source of truth. Any new
persistent queue, outbox, auth table, ORM-generated DDL, or other database
change requires a synchronized new schema version rather than an ad hoc
migration.

Architecture and product documents do not pin snapshot package versions. Choose
and lock exact compatible versions only when an executable scaffold or approved
spike first needs them; from then on, committed manifests, lockfiles, container
pins, and frozen CI installs are mandatory.

## Product And User-Flow Contract

- [docs/product/README.md](docs/product/README.md) is the product-contract entry
  point.
- [docs/product/information-architecture.md](docs/product/information-architecture.md)
  and [docs/product/page-catalog.yaml](docs/product/page-catalog.yaml) define
  navigation, rendering, page states, and stable page IDs.
- [docs/product/user-flows.md](docs/product/user-flows.md) and
  [docs/product/user-flows.yaml](docs/product/user-flows.yaml) define the
  user-facing and Monica-import workflows that require E2E coverage.
- [docs/product/release-slices.md](docs/product/release-slices.md) defines the
  accepted vertical implementation order.
- [docs/product/person-workspace.md](docs/product/person-workspace.md) records
  what belongs on the one person workspace and when a separate page is
  justified.
- [docs/product/monica-import-compatibility.md](docs/product/monica-import-compatibility.md)
  records the supported Monica export formats, the imported data, the limits,
  and the documented exclusions.
- [docs/product/dashboard-settings-design.md](docs/product/dashboard-settings-design.md)
  is the accepted UX and route contract for Today and settings.

The product is person-centered. `/app/people/:personId` is the one canonical
person workspace and must expose nearly all person-specific information through
composable, deep-linkable sections and local actions. Do not create mandatory
subpages for contact methods, addresses, relationships, life events, notes,
conversations, calls, activities, reminders, tasks, gifts, debts, documents, or
photos. Separate person pages are reserved for scale-heavy reports and full
audit history; cross-person, long-running, administrative, and settings
workflows may have their own pages.

The `person-profile` read model may compose the source modules allowlisted in
`module-boundaries.yaml`, but it is read-only. Every mutation must call the
public application facade of the module that owns the changed table. A unified
screen is never permission to bypass module boundaries.

`/app` is the one Today route. Prioritize its attention queue, people due for
contact, upcoming work, recent people, reference notes, and recent activity in
the documented semantic order. Do not add a product-news card, lifetime
counters, a three-month reminder wall, or a calls/notes/debts/tasks tab mixture.
The `today` read model is also read-only; inline actions call the owning
module's public use case.

Settings use the stable hierarchy in `dashboard-settings-design.md` and
`page-catalog.yaml`. Keep personal, workspace, data, developer, and optional
billing scopes visibly grouped. Related workspace vocabularies share
`/app/settings/personalization?section=<section-id>`; do not create separate
page routes for their CRUD forms. Preserve standalone routes for resumable data
jobs, operational administration, and the owner-only workspace danger zone. Do
not place destructive workspace actions beside routine preferences.

Every shipped route must have a page-catalog ID. Every required workflow must
have a Playwright test carrying its stable flow ID. Update catalogs, tests, and
affected architecture documents together; never reuse a released ID.

## Delivery Planning

- [docs/planning/active-delivery.md](docs/planning/active-delivery.md) is the
  authoritative near-term work queue. It prioritizes runnable vertical
  application behavior and introduces foundation capabilities only when the next
  feature consumes them.
- [docs/planning/README.md](docs/planning/README.md) defines the proposed
  milestone vocabulary, execution method, status, and entry points for the
  delivery plan.
- [docs/planning/roadmap.md](docs/planning/roadmap.md) is the proposed,
  dependency-ordered plan from Foundation through MVP, optional modules, AI
  decisioning, and production-readiness proof.
- [docs/planning/quality-and-operations.md](docs/planning/quality-and-operations.md)
  expands the required test, E2E, Compose, CI, security, observability,
  migration, backup, and release gates.
- [docs/planning/traceability.md](docs/planning/traceability.md) maps every
  current module, read model, page group, and required user flow to its proposed
  complete delivery slice and acceptance evidence.
- [docs/planning/research.md](docs/planning/research.md) records the official
  implementation research, stack capabilities, bounded compatibility spikes, and
  still-open product/provider decisions.

These planning documents are proposed executable guidance subordinate to the
accepted schema, architecture, and product contracts. Their status is recorded
in the planning entry point; proposed milestones and reassignments are not
authoritative until approved. They may expose a blocking decision but must not
silently resolve it by violating an accepted constraint.

## Canonical Personal CRM Schema

- [personal-crm-schema/v4/README.md](personal-crm-schema/v4/README.md) is the
  starting point and current repository database baseline.
- [personal-crm-schema/v4/personal_crm_schema_v4.sql](personal-crm-schema/v4/personal_crm_schema_v4.sql)
  is the canonical PostgreSQL DDL.
- [personal-crm-schema/v4/personal_crm_schema_spec_v4.md](personal-crm-schema/v4/personal_crm_schema_spec_v4.md)
  is the human-readable schema and behavioral contract.
- [personal-crm-schema/v4/personal_crm_field_catalog_v4.csv](personal-crm-schema/v4/personal_crm_field_catalog_v4.csv)
  is the field-level catalog.
- [personal-crm-schema/v4/monica_table_mapping_v4.csv](personal-crm-schema/v4/monica_table_mapping_v4.csv)
  and
  [personal-crm-schema/v4/monica_column_mapping_v4.csv](personal-crm-schema/v4/monica_column_mapping_v4.csv)
  are the complete Monica import mappings.
- [personal-crm-schema/v4/personal_crm_schema_v4_changes.md](personal-crm-schema/v4/personal_crm_schema_v4_changes.md)
  and
  [personal-crm-schema/v4/personal_crm_schema_v4_validation.json](personal-crm-schema/v4/personal_crm_schema_v4_validation.json)
  contain the change rationale and machine validation.

Treat `personal-crm-schema/v4` as one synchronized, versioned unit. Repository
v1, v2, and v3 remain immutable prior baselines; the external audit does not
cover the repository-reviewed v2, v3, or v4 deltas. Do not update the SQL,
specification, catalogs, mappings, migration, or validation independently.

The canonical Personal CRM schema is the application's own data model. The
Monica mappings in each schema version and
[docs/product/monica-import-compatibility.md](docs/product/monica-import-compatibility.md)
describe import compatibility only; they must not be used to reintroduce
Monica-specific storage choices into canonical product tables.

The DDL has passed the repository's live PostgreSQL validation matrix on
PostgreSQL 18.4 and 17.10. See
[docs/validation/postgresql-schema-v4.md](docs/validation/postgresql-schema-v4.md)
and rerun `deno task test:schema:matrix` after any schema-test or toolchain
change. The external v1 audit JSON remains immutable and still records that live
execution was unavailable in its audit environment.

The current database harness proves clean apply, transactional rollback,
teardown and reapply, exact catalog shape, constraint behavior, partial-date
storage shapes, import identity-map idempotency, reminder occurrence uniqueness,
and missing-file representation. Before accepting application migrations and use
cases, CI must additionally cover cross-workspace rejection, full import
idempotency, time-zone-aware reminder regeneration, object-store failure
handling, and legacy credential non-activation through the application boundary.
