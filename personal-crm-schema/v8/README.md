# Personal CRM database schema — repository baseline v8

## Status

This directory is the current canonical database baseline. Repository v1
through v7 remain immutable. V8 adds only the two member preferences consumed by
`PLANNING-003`: the reminder-delivery channel and the daily email digest time.

## Synchronized unit

- `personal_crm_schema_v8.sql` is the complete canonical PostgreSQL DDL.
- `personal_crm_schema_spec_v8.md` is the complete human contract.
- `personal_crm_field_catalog_v8.csv` catalogs all 845 canonical fields.
- The Monica table and column mappings preserve all 94 source-table and 823
  source-column dispositions unchanged.
- `personal_crm_schema_v8_changes.md` records rationale and recovery.
- `personal_crm_schema_v8_validation.json` records counts and exact hashes.
- `migrations/0008_add_member_reminder_delivery.sql` is the additive v7-to-v8
  migration; copied immutable `0002` through `0007` migrations retain history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v8 DDL. Exact v1 through v7 targets upgrade
transactionally. Every existing member keeps in-app reminder delivery and no
digest, so behaviour does not change until a member chooses email delivery.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
