# Personal CRM database schema — repository baseline v10

## Status

This directory is the current canonical database baseline. Repository v1
through v9 remain immutable. V10 adds only what the recurring debts of
`GIFTS-001` consume: the workspace-owned `recurring_debts` rule table and the
`debts.recurring_debt_id` and `debts.occurrence_on` pair that keeps generation
to one debt per rule and due date.

## Synchronized unit

- `personal_crm_schema_v10.sql` is the complete canonical PostgreSQL DDL.
- `personal_crm_schema_spec_v10.md` is the complete human contract.
- `personal_crm_field_catalog_v10.csv` catalogs all 868 canonical fields.
- The Monica table and column mappings preserve all 94 source-table and 823
  source-column dispositions unchanged.
- `personal_crm_schema_v10_changes.md` records rationale and recovery.
- `personal_crm_schema_v10_validation.json` records counts and exact hashes.
- `migrations/0010_add_recurring_debts.sql` is the additive v9-to-v10
  migration; copied immutable `0002` through `0009` migrations retain history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v10 DDL. Exact v1 through v9 targets upgrade
transactionally. No existing row changes: the new table starts empty, and every
existing debt keeps null in both new columns because each was recorded by hand.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
