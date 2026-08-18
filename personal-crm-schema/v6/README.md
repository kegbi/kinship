# Personal CRM database schema — repository baseline v6

## Status

This directory is the current canonical database baseline. Repository v1 through
v5 remain immutable prior baselines. V6 adds the durable state required to
claim, retry, reconcile, and manually recover reminder delivery without
duplicating a provider effect. A recurring calendar occurrence keeps its
identity by reminder, member, calendar date, channel, and lead-rule slot when
timezone changes move its delivery instant. A null lead is the distinct
no-explicit-rule slot; it does not collapse the explicit zero-day rule.

## Synchronized unit

- `personal_crm_schema_v6.sql` is the complete canonical PostgreSQL DDL and
  reference data.
- `personal_crm_schema_spec_v6.md` is the complete human contract.
- `personal_crm_field_catalog_v6.csv` catalogs all 832 canonical fields.
- `monica_table_mapping_v6.csv` and `monica_column_mapping_v6.csv` preserve all
  94 table and 823 source-column dispositions unchanged.
- `personal_crm_schema_v6_changes.md` records rationale and recovery.
- `personal_crm_schema_v6_validation.json` records counts and exact hashes.
- `migrations/0006_add_durable_reminder_delivery.sql` is the additive v5-to-v6
  migration. Copied immutable `0002` through `0005` migrations retain prior
  upgrade history.

These artifacts are one versioned unit. Never update one independently.

## Upgrade and recovery

An empty target receives complete v6 DDL and reference data. Exact v1 through v5
targets upgrade transactionally. Existing sent rows receive a stable legacy
receipt and visibility evidence; unsupported pending legacy channels become
manual-attention work rather than being falsely delivered. Failure rolls back
atomically and ambiguous catalog drift is rejected.

Run `deno task test:schema` for the default PostgreSQL image and
`deno task test:schema:matrix` for the supported PostgreSQL 18/17 matrix.
