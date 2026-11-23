# Personal CRM database schema — repository baseline v16

This is the current canonical database baseline. Repository v1 through v15
remain immutable. V16 (MCP-E3) adds one workspace-owned table,
`request_tombstones`, and changes nothing else:

- A create sent with a retry key (`requestId`) derives its record's id from the
  workspace and the key. When a journal post, note, activity, call,
  conversation, gift, debt, or recurring debt rule created that way is deleted
  permanently, the delete writes the record's id to `request_tombstones` in its
  own transaction. A keyed create that finds no row under its derived id asks
  the table and is refused when the id is there, so a retry after the delete
  never records the item again. `gifts` no longer asks the audit history.
- The primary key `(workspace_id, record_id)` makes the check a point lookup.
  The table forces row-level security under the exact v14 `workspace_isolation`
  policy
  ([ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md));
  `kinship_app` may only read and add a tombstone, and `kinship_worker` has no
  privilege on it. A workspace deletion or reset removes the tombstones with the
  workspace.

With it, 76 workspace-owned tables are forced. The SQL, specification, field
catalog, unchanged complete Monica mappings, changes, migrations, and validation
JSON form one synchronized versioned unit. The field catalog covers 911 columns.
Mappings retain all 94 source tables and 823 source columns unchanged.

Empty targets receive the complete v16 DDL. Exact v1–v15 targets upgrade
transactionally. Migration 0016 creates the table, its forced policy, and its
grant; it backfills nothing, because retry keys on these creates exist only on
unreleased code.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. See personal_crm_schema_v16_changes.md for the
delete paths, the concurrency argument, locking, and recovery.
