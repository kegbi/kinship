# Personal CRM database schema — repository baseline v4

## Status

This directory is the current canonical database baseline. Repository v1, v2,
and v3 remain immutable prior baselines. V4 seeds the supported ISO 4217
currency reference catalog; it does not rely on test or operator seeding.

## Synchronized unit

- `personal_crm_schema_v4.sql` is the complete canonical PostgreSQL DDL and
  reference data.
- `personal_crm_schema_spec_v4.md` is the complete human contract.
- `personal_crm_field_catalog_v4.csv` catalogs all 813 canonical fields.
- `monica_table_mapping_v4.csv` and `monica_column_mapping_v4.csv` preserve all
  94 table and 823 source-column dispositions unchanged.
- `personal_crm_schema_v4_changes.md` records rationale and recovery.
- `personal_crm_schema_v4_validation.json` records counts and exact hashes.
- `migrations/0004_seed_iso_4217_currencies.sql` is the transactional v3-to-v4
  migration. Copied immutable `0002` and `0003` migrations retain prior upgrade
  history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v4 DDL and reference data. Exact v1, v2, and
v3 targets upgrade transactionally. Because v2 has no exact session-purpose
invariant, v2-to-v3 marks every existing authority `legacy` and revokes it
rather than guessing. Exact v4 verifies idempotently; ambiguous catalog drift
or currency-reference drift is rejected.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
