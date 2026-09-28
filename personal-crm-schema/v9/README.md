# Personal CRM database schema — repository baseline v9

## Status

This directory is the current canonical database baseline. Repository v1
through v8 remain immutable. V9 adds only what `SEARCH-001` and `PEOPLE-008`
consume: GIN full-text indexes on the four searched text groups (`REL-061`) and
the workspace-shared table of person pairs dismissed as not duplicates
(`REL-064`).

## Synchronized unit

- `personal_crm_schema_v9.sql` is the complete canonical PostgreSQL DDL.
- `personal_crm_schema_spec_v9.md` is the complete human contract.
- `personal_crm_field_catalog_v9.csv` catalogs all 850 canonical fields.
- The Monica table and column mappings preserve all 94 source-table and 823
  source-column dispositions unchanged.
- `personal_crm_schema_v9_changes.md` records rationale and recovery.
- `personal_crm_schema_v9_validation.json` records counts and exact hashes.
- `migrations/0009_add_search_indexes_and_duplicate_dismissals.sql` is the
  additive v8-to-v9 migration; copied immutable `0002` through `0008`
  migrations retain history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v9 DDL. Exact v1 through v8 targets upgrade
transactionally. No existing row changes: the indexes are built from the
current text, and the new table starts empty, so every pair the duplicates
review offers today is still offered.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
