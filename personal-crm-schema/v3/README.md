# Personal CRM database schema — repository baseline v3

## Status

This directory is the current canonical database baseline. Repository v1 and
v2 remain immutable prior baselines. V3 adds the exact purpose of every
`user_sessions` authority; it does not infer purpose from token lifetime.

## Synchronized unit

- `personal_crm_schema_v3.sql` is the complete canonical PostgreSQL DDL.
- `personal_crm_schema_spec_v3.md` is the complete human contract.
- `personal_crm_field_catalog_v3.csv` catalogs all 813 canonical fields.
- `monica_table_mapping_v3.csv` and `monica_column_mapping_v3.csv` preserve all
  94 table and 823 source-column dispositions unchanged.
- `personal_crm_schema_v3_changes.md` records rationale and recovery.
- `personal_crm_schema_v3_validation.json` records counts and exact hashes.
- `migrations/0003_add_user_session_purpose.sql` is the transactional v2-to-v3
  migration. The copied immutable `0002` migration retains v1 upgrade history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v3 DDL. Exact v1 and v2 targets upgrade
transactionally. Because v2 has no exact session-purpose invariant, v2-to-v3
marks every existing authority `legacy` and revokes it rather than guessing.
Exact v3 verifies idempotently; ambiguous catalog drift is rejected.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
