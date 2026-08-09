# AGENTS.md

## Purpose

This repo builds a Monica-compatible, modern relationship management system: a person-centered personal CRM on current production technologies, with AI assistance built in.

## Core Goals

- Maintain full, 100% test coverage across unit tests and end-to-end tests. This is non-negotiable for all production code and user-facing workflows.
- Build a modular, expandable architecture that supports future extensibility without forcing broad rewrites.
- Preserve solid architectural boundaries so each application module can be swapped, extended, or replaced independently.

## Canonical Personal CRM Schema

- [personal-crm-schema/v1/README.md](personal-crm-schema/v1/README.md) is the starting point and current repository database baseline.
- [personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql](personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql) is the canonical PostgreSQL DDL.
- [personal-crm-schema/v1/personal_crm_rewrite_schema_spec_v3.md](personal-crm-schema/v1/personal_crm_rewrite_schema_spec_v3.md) is the human-readable schema and behavioral contract.
- [personal-crm-schema/v1/personal_crm_field_catalog_v3.csv](personal-crm-schema/v1/personal_crm_field_catalog_v3.csv) is the field-level catalog.
- [personal-crm-schema/v1/monica_table_mapping_v3.csv](personal-crm-schema/v1/monica_table_mapping_v3.csv) and [personal-crm-schema/v1/monica_column_mapping_v3.csv](personal-crm-schema/v1/monica_column_mapping_v3.csv) are the complete Monica import mappings.
- [personal-crm-schema/v1/personal_crm_schema_reaudit_v3.md](personal-crm-schema/v1/personal_crm_schema_reaudit_v3.md) and [personal-crm-schema/v1/personal_crm_schema_v3_validation.json](personal-crm-schema/v1/personal_crm_schema_v3_validation.json) contain the audit rationale and machine validation.

Treat `personal-crm-schema/v1` as one synchronized, versioned unit. The directory is repository schema version 1; `_v3` in the filenames records the accepted external audit iteration. Do not update the SQL, specification, catalogs, mappings, or validation independently.

The canonical Personal CRM schema is the application's own data model. The Monica mappings in each schema version describe import compatibility only; they must not be used to reintroduce Monica-specific storage choices into canonical product tables.

The current DDL has been structurally cross-validated but not executed against PostgreSQL. Before accepting implementation migrations, CI must cover clean apply, teardown or rollback, schema introspection, cross-workspace negative cases, import idempotency, partial dates, reminder regeneration, missing attachments, and legacy credential non-activation.
