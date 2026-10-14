# Personal CRM database schema — repository baseline v11

This is the current canonical database baseline. Repository v1 through v10
remain immutable. V11 adds the settlement history consumed by GIFTS-001:
optional settlement reasons and photos survive reload, reopening, and subsequent
settlement.

The SQL, specification, field catalog, unchanged complete Monica mappings,
changes, migration, and validation JSON form one synchronized versioned unit.
The field catalog covers 876 columns. Mappings retain all 94 source tables and
823 source columns unchanged.

Empty targets receive complete v11 DDL. Exact v1–v10 targets upgrade
transactionally. Migration 0011 adds workspace composite keys and the history
table, then backfills one event for each currently settled debt using its
recorded settlement time. Previously reopened settlements cannot be
reconstructed.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. Application rollback is compatible with the
additive schema. See personal_crm_schema_v11_changes.md for recovery and
retention.
