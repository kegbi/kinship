# AGENTS.md

## Purpose

This repo exists to create a full-featured copy of the monicaorg project with better designs, current production technologies, and AI assistance built in.

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

For the new application model, the canonical Personal CRM schema takes precedence over rewrite suggestions in the Monica source analysis. The Monica specifications remain authoritative for source behavior, feature coverage, and import compatibility only.

The current DDL has been structurally cross-validated but not executed against PostgreSQL. Before accepting implementation migrations, CI must cover clean apply, teardown or rollback, schema introspection, cross-workspace negative cases, import idempotency, partial dates, reminder regeneration, missing attachments, and legacy credential non-activation.

## Monica Specifications

- [monica-internals-spec](monica-internals-spec) contains the Monica architecture, schema, API, compatibility, and domain-model specifications.
- [monica-internals-spec/README.md](monica-internals-spec/README.md) is the starting point for the detailed relationships schema and links into the spec set.
- [personal-crm-schema/v1/monica_architecture_analysis.md](personal-crm-schema/v1/monica_architecture_analysis.md) is the measured 94-table, 823-column Monica inventory used by the accepted schema audit.
