# AGENTS.md

## Purpose

This repo exists to create a full-featured copy of the monicaorg project with
better designs, current production technologies, and AI assistance built in.

## Core Goals

- Maintain full, 100% test coverage across unit tests and end-to-end tests. This
  is non-negotiable for all production code and user-facing workflows.
- Build a modular, expandable architecture that supports future extensibility
  without forcing broad rewrites.
- Preserve solid architectural boundaries so each application module can be
  swapped, extended, or replaced independently.

## Technology and Architecture Baseline

- [docs/architecture/README.md](docs/architecture/README.md) is the entry point
  for technology and architecture decisions. It distinguishes accepted
  constraints from proposals that still require explicit approval.
- [docs/architecture/technology-baseline.md](docs/architecture/technology-baseline.md)
  records the accepted runtime, frontend, database, container, and delivery
  constraints, plus the evaluated framework and library candidates.
- [docs/architecture/backend-architecture.md](docs/architecture/backend-architecture.md)
  defines the modular-monolith boundaries, dependency direction, workspace
  isolation rules, API contract, and proposed container topology.
- [docs/architecture/quality-gates.md](docs/architecture/quality-gates.md)
  defines the mandatory coverage interpretation, Deno-first checks, schema
  tests, dependency controls, hooks, and CI gates.

The accepted implementation baseline is Docker Compose, PostgreSQL, a Deno
backend, Astro as a static-first frontend, TypeScript throughout application
code, current stable shadcn/ui components for interactive UI, and automated
unit, integration, contract, and end-to-end tests. React is permitted only where
shadcn/ui or an interactive Astro island requires it. Do not turn the
application into an always-server-rendered SPA without an explicit architecture
decision.

Start as a modular monolith with a separately runnable API and worker built from
the same backend codebase. Domain and application code must not depend on Hono,
Astro, database drivers, or other delivery and infrastructure frameworks.
Modules communicate through public application interfaces or explicitly approved
read models, never by importing another module's adapters or repository
internals.

The selected implementation stack includes Hono, Zod 4, Kysely with Postgres.js,
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

The current DDL has been structurally cross-validated but not executed against
PostgreSQL. Before accepting implementation migrations, CI must cover clean
apply, teardown or rollback, schema introspection, cross-workspace negative
cases, import idempotency, partial dates, reminder regeneration, missing
attachments, and legacy credential non-activation.

## Monica Specifications

- [monica-internals-spec](monica-internals-spec) contains the Monica
  architecture, schema, API, compatibility, and domain-model specifications.
- [monica-internals-spec/README.md](monica-internals-spec/README.md) is the
  starting point for the detailed relationships schema and links into the spec
  set.
- [personal-crm-schema/v1/monica_architecture_analysis.md](personal-crm-schema/v1/monica_architecture_analysis.md)
  is the measured 94-table, 823-column Monica inventory used by the accepted
  schema audit.
