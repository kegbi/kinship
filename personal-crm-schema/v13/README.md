# Personal CRM database schema — repository baseline v13

This is the current canonical database baseline. Repository v1 through v12
remain immutable. V13 changes indexes so they match the statements that read
them, lets `user_sessions.purpose` hold a durable `mfa-challenge`, adds the
nullable `users.pending_workspace_name` a registration holds until verification,
and seeds the global `emotion_options` and `pet_categories` catalogs once. It
adds no table.

The SQL, specification, field catalog, unchanged complete Monica mappings,
changes, migrations, and validation JSON form one synchronized versioned unit.
The field catalog covers 877 columns. Mappings retain all 94 source tables and
823 source columns unchanged.

Empty targets receive complete v13 DDL and seeds. Exact v1–v12 targets upgrade
transactionally. Migration 0013 adds nine indexes, drops nine, replaces the
session purpose check and its comment, adds `users.pending_workspace_name` and
its check without a backfill, and inserts the stock catalog rows an upgraded
database lacks.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. See personal_crm_schema_v13_changes.md for the
measurements, locking, recovery, and the decisions v13 records.
