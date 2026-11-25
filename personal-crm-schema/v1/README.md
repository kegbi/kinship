# Personal CRM database schema — repository baseline v1

## Status

This directory is the current canonical database baseline for the rewrite.

It adopts the externally audited v3 bundle without modifying the audited artifacts. The `v1` directory is the repository's schema version; `_v3` in the original filenames records that the accepted bundle was the third audit iteration. Keeping the original filenames and bytes preserves the SHA-256 verification recorded in the validation report.

The baseline contains 87 tables and 811 fields. It maps all 94 Monica source tables and all 823 source columns.

## Implementation contract

Use these files together:

- [personal_crm_rewrite_schema_v3.sql](personal_crm_rewrite_schema_v3.sql) is the canonical PostgreSQL DDL.
- [personal_crm_rewrite_schema_spec_v3.md](personal_crm_rewrite_schema_spec_v3.md) is the human-readable schema and behavioral contract.
- [personal_crm_field_catalog_v3.csv](personal_crm_field_catalog_v3.csv) is the field-by-field catalog; it has one row for every canonical field.
- [monica_table_mapping_v3.csv](monica_table_mapping_v3.csv) and [monica_column_mapping_v3.csv](monica_column_mapping_v3.csv) define Monica import compatibility and the disposition of every source table and column.
- [personal_crm_schema_reaudit_v3.md](personal_crm_schema_reaudit_v3.md) and [personal_crm_v1_to_v3_changes.csv](personal_crm_v1_to_v3_changes.csv) explain why this baseline replaced the earlier proposal.
- [personal_crm_schema_v3_validation.json](personal_crm_schema_v3_validation.json) records structural validation results and hashes for the audited artifacts.

## Authority and change policy

For the application's data model, this bundle is authoritative. The Monica mappings describe the import-compatibility surface; they must not be used to reintroduce Monica-specific storage choices into canonical product tables.

The SQL, specification, field catalog, mappings, audit, and validation report form one versioned unit. Do not change only one artifact. A schema revision must update every affected artifact, regenerate validation and hashes, and be published as a new repository schema version.

If the SQL, specification, field catalog, or mappings disagree, stop and resolve the inconsistency instead of choosing one silently.

## Live PostgreSQL validation

After the external audit was accepted, the unchanged audited DDL passed the repository's live test harness on PostgreSQL 18.4 and 17.10. The harness verifies audited hashes, atomic apply and rollback, teardown and reapply, live catalog agreement, field-catalog membership, constraints, partial-date shapes, import identity uniqueness, reminder occurrence uniqueness, and missing-file representation. Run `deno task test:schema:matrix` from the repository root.

The historical validation JSON remains unchanged and correctly describes the external audit environment, where PostgreSQL execution was unavailable. Cross-workspace authorization, full importer behavior, time-zone-aware reminder generation, object-store failures, and legacy credential activation are application-level concerns and remain mandatory integration tests once those implementations exist.

One Monica field remains an explicit product-policy decision: `accounts.legacy_free_plan_unlimited_contacts`. It is retained in import reporting and is not part of the canonical CRM domain.
