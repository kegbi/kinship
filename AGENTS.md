# AGENTS.md

## Purpose

This repo exists to create a full-featured copy of the monicaorg project with
better designs, current production technologies, and AI assistance built in.

## Core Goals

- Maintain at least 80% line, branch, and function coverage for production code.
  Required user flows still need end-to-end coverage, and changed behavior,
  security/tenant boundaries, and schema behavior always need focused tests.
- Build a modular, expandable architecture that supports future extensibility
  without forcing broad rewrites.
- Preserve solid architectural boundaries so each application module can be
  swapped, extended, or replaced independently.

## Mandatory Change Method

Every new or changed production behavior must be developed in small RED -> GREEN
-> REFACTOR cycles. This applies to features, bug fixes, UI, API, workers,
database access, migrations, infrastructure and configuration, generators,
security controls, and repository enforcement tooling.

1. RED adds or changes the narrowest appropriate automated test or deterministic
   executable check before production implementation. Run it and confirm that it
   fails for the intended missing or incorrect behavior, not because
   compilation, fixtures, permissions, services, or the environment are broken.
   Production files remain unchanged during RED. A bug fix begins with a failing
   regression test.
2. GREEN makes the smallest architecture-compliant production change needed to
   pass the RED proof. Never weaken, delete, skip, exclude, or over-mock a test
   to make it pass.
3. REFACTOR improves structure only while the focused and affected tests remain
   green. New behavior discovered during refactoring starts another RED cycle.

Coverage and tests written after implementation do not substitute for recorded
RED evidence. If a truthful harness does not exist, bootstrap and self-test the
harness first; never add a no-op task. Documentation, contract, catalog,
configuration, architecture, and infrastructure changes require a failing
validator, contract test, schema test, or bounded executable probe before the
change.

Every code candidate then passes a separate clean, read-only review. The
reviewer receives the accepted contracts, exact candidate revision, diff, and
concise evidence for RED/GREEN/REFACTOR. Review covers bugs/correctness,
security/privacy, architecture, performance/reliability, style/maintainability,
and tests/TDD. Every actionable finding returns to a fresh implementer for a new
RED -> GREEN -> REFACTOR round, followed by a fresh review of the new exact
candidate.

The orchestrator alone accepts and integrates a ticket after independently
rerunning applicable repository gates. Implementer self-review, hook success, or
CI success does not replace independent review. Full role boundaries, worktree
isolation, ticket artifacts, state transitions, and escalation rules are defined
in
[docs/development/autonomous-delivery.md](docs/development/autonomous-delivery.md).
Invoke the repo-local run-tdd-ticket-loop skill for autonomous implementation
runs; use the project custom agents under .codex/agents for clean role contexts.

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
  user-facing and Monica-compatibility workflows that require E2E coverage.
- [docs/product/release-slices.md](docs/product/release-slices.md) defines the
  accepted vertical implementation order.
- [docs/product/monica-person-profile-analysis.md](docs/product/monica-person-profile-analysis.md)
  records the source-derived person-profile behavior to preserve without copying
  Monica's obsolete UI.
- [docs/product/monica-dashboard-settings-analysis.md](docs/product/monica-dashboard-settings-analysis.md)
  records Monica's source-derived dashboard/settings composition, standalone
  surfaces, and historical routes.
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
the documented semantic order. Do not restore Monica's product-news card,
lifetime counters, three-month reminder wall, or calls/notes/debts/tasks tab
mixture. The `today` read model is also read-only; inline actions call the
owning module's public use case.

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

- [personal-crm-schema/v1/README.md](personal-crm-schema/v1/README.md) is the
  starting point and current repository database baseline.
- [personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql](personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql)
  is the canonical PostgreSQL DDL.
- [personal-crm-schema/v1/personal_crm_rewrite_schema_spec_v3.md](personal-crm-schema/v1/personal_crm_rewrite_schema_spec_v3.md)
  is the human-readable schema and behavioral contract.
- [personal-crm-schema/v1/personal_crm_field_catalog_v3.csv](personal-crm-schema/v1/personal_crm_field_catalog_v3.csv)
  is the field-level catalog.
- [personal-crm-schema/v1/monica_table_mapping_v3.csv](personal-crm-schema/v1/monica_table_mapping_v3.csv)
  and
  [personal-crm-schema/v1/monica_column_mapping_v3.csv](personal-crm-schema/v1/monica_column_mapping_v3.csv)
  are the complete Monica import mappings.
- [personal-crm-schema/v1/personal_crm_schema_reaudit_v3.md](personal-crm-schema/v1/personal_crm_schema_reaudit_v3.md)
  and
  [personal-crm-schema/v1/personal_crm_schema_v3_validation.json](personal-crm-schema/v1/personal_crm_schema_v3_validation.json)
  contain the audit rationale and machine validation.

Treat `personal-crm-schema/v1` as one synchronized, versioned unit. The
directory is repository schema version 1; `_v3` in the filenames records the
accepted external audit iteration. Do not update the SQL, specification,
catalogs, mappings, or validation independently.

For the new application model, the canonical Personal CRM schema takes
precedence over rewrite suggestions in the Monica source analysis. The Monica
specifications remain authoritative for source behavior, feature coverage, and
import compatibility only.

The DDL has passed the repository's live PostgreSQL validation matrix on
PostgreSQL 18.4 and 17.10. See
[docs/validation/postgresql-schema-v1.md](docs/validation/postgresql-schema-v1.md)
and rerun `deno task test:schema:matrix` after any schema-test or toolchain
change. The external audit JSON remains immutable and still records that live
execution was unavailable in the audit environment.

The current database harness proves clean apply, transactional rollback,
teardown and reapply, exact catalog shape, constraint behavior, partial-date
storage shapes, import identity-map idempotency, reminder occurrence uniqueness,
and missing-file representation. Before accepting application migrations and use
cases, CI must additionally cover cross-workspace rejection, full import
idempotency, time-zone-aware reminder regeneration, object-store failure
handling, and legacy credential non-activation through the application boundary.

## Monica Specifications

- [monica-internals-spec](monica-internals-spec) contains the Monica
  architecture, schema, API, compatibility, and domain-model specifications.
- [monica-internals-spec/README.md](monica-internals-spec/README.md) is the
  starting point for the detailed relationships schema and links into the spec
  set.
- [personal-crm-schema/v1/monica_architecture_analysis.md](personal-crm-schema/v1/monica_architecture_analysis.md)
  is the measured 94-table, 823-column Monica inventory used by the accepted
  schema audit.
