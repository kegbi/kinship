# Personal CRM database schema — repository baseline v7

## Status

This directory is the current canonical database baseline. Repository v1
through v6 remain immutable. V7 adds only the durable deletion-security result
and bounded object-cleanup recovery state consumed by `WORKSPACE-002`.

## Synchronized unit

- `personal_crm_schema_v7.sql` is the complete canonical PostgreSQL DDL.
- `personal_crm_schema_spec_v7.md` is the complete human contract.
- `personal_crm_field_catalog_v7.csv` catalogs all 843 canonical fields.
- The Monica table and column mappings preserve all 94 source-table and 823
  source-column dispositions unchanged.
- `personal_crm_schema_v7_changes.md` records rationale and recovery.
- `personal_crm_schema_v7_validation.json` records counts and exact hashes.
- `migrations/0007_add_workspace_deletion_records.sql` is the additive v6-to-v7
  migration; copied immutable `0002` through `0006` migrations retain history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v7 DDL. Exact v1 through v6 targets upgrade
transactionally. V7 records a completed workspace database deletion before its
workspace row cascades, then lets the existing worker retry only captured object
removals until cleanup is complete.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
