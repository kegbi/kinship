# Personal CRM database schema — repository baseline v12

This is the current canonical database baseline. Repository v1 through v11
remain immutable. V12 changes one column comment only: a member's reminder
delivery choice now applies to every reminder occurrence not yet sent, including
those already scheduled, not only to occurrences generated afterwards.

The SQL, specification, field catalog, unchanged complete Monica mappings,
changes, migration, and validation JSON form one synchronized versioned unit.
The field catalog covers 876 columns. Mappings retain all 94 source tables and
823 source columns unchanged.

Empty targets receive complete v12 DDL. Exact v1–v11 targets upgrade
transactionally. Migration 0012 replaces the comment on
`member_preferences.reminder_delivery`; it changes no table, column, constraint,
index, or data.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. Application rollback is compatible with the
comment-only schema. See personal_crm_schema_v12_changes.md for recovery and
retention.
