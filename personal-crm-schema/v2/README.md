# Personal CRM database schema — repository baseline v2

## Status

This directory is the current canonical database baseline. Repository v1 remains
the immutable externally audited baseline; v2 is its complete successor plus one
repository-reviewed, live-validated authentication-throttling field and index.
The external v1 audit did not cover this v2 delta.

## Synchronized unit

- `personal_crm_schema_v2.sql` is the complete canonical PostgreSQL DDL for a
  clean v2 database.
- `personal_crm_schema_spec_v2.md` is the complete human contract.
- `personal_crm_field_catalog_v2.csv` catalogs all 812 canonical fields.
- `monica_table_mapping_v2.csv` and `monica_column_mapping_v2.csv` preserve all
  94 table and 823 column dispositions from v1 unchanged.
- `personal_crm_schema_v2_changes.md` records the rationale and recovery plan.
- `personal_crm_schema_v2_validation.json` records structural counts and hashes
  for this complete unit without claiming external-audit coverage.
- `migrations/0002_add_authentication_subject_digest.sql` is the immutable,
  transactional v1-to-v2 migration.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

The repository-owned raw SQL runner hash-verifies v1, v2, and migration bytes.
An empty target receives the complete v2 DDL. An exact v1 target receives the
transactional migration. An exact v2 target is verified without mutation. Any
other catalog is rejected as drift. A failed upgrade rolls back atomically; the
additive v2 schema remains compatible with v1 application code.

Run `deno task test:schema` for clean-v2 and v1-upgrade verification. Run
`deno task test:schema:matrix` for the supported PostgreSQL matrix.
