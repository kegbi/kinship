# Personal CRM database schema — repository baseline v5

## Status

This directory is the current canonical database baseline. Repository v1
through v4 remain immutable prior baselines. V5 adds lossless, typed
year-approximation state to important person dates.

## Synchronized unit

- `personal_crm_schema_v5.sql` is the complete canonical PostgreSQL DDL and
  reference data.
- `personal_crm_schema_spec_v5.md` is the complete human contract.
- `personal_crm_field_catalog_v5.csv` catalogs all 814 canonical fields.
- `monica_table_mapping_v5.csv` and `monica_column_mapping_v5.csv` preserve all
  94 table and 823 source-column dispositions unchanged.
- `personal_crm_schema_v5_changes.md` records rationale and recovery.
- `personal_crm_schema_v5_validation.json` records counts and exact hashes.
- `migrations/0005_add_person_date_year_approximation.sql` is the v4-to-v5
  migration and is applied inside the canonical runner's transaction. Copied
  immutable `0002` through `0004` migrations retain prior upgrade history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v5 DDL and reference data. Exact v1 through
v4 targets upgrade transactionally. Existing date rows receive the honest
default `false`; the migration never guesses that a previously exact year was
approximate. Exact v5 verifies idempotently; ambiguous catalog or reference-data
drift is rejected.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
