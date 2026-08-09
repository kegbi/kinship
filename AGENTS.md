# AGENTS.md

## Purpose

This repo builds a Monica-compatible, modern relationship management system: a
person-centered personal CRM on current production technologies, with a built-in
MCP endpoint, AI assistance, and a fully supported import of Monica data
exports.

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

Hono, Zod 4, Kysely with Postgres.js, Lefthook, and a Better Auth compatibility
spike are recommendations, not yet accepted dependencies. Do not silently
substitute Bun, add Redis, introduce microservices, or let an ORM become a
second schema source of truth. Record approval and update the architecture
documents before treating a proposed choice as mandatory.

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

The canonical Personal CRM schema is the application's own data model. The
Monica mappings in each schema version and
[docs/product/monica-import-compatibility.md](docs/product/monica-import-compatibility.md)
describe import compatibility only; they must not be used to reintroduce
Monica-specific storage choices into canonical product tables.

The current DDL has been structurally cross-validated but not executed against
PostgreSQL. Before accepting implementation migrations, CI must cover clean
apply, teardown or rollback, schema introspection, cross-workspace negative
cases, import idempotency, partial dates, reminder regeneration, missing
attachments, and legacy credential non-activation.
