# Personal CRM database schema — repository baseline v14

This is the current canonical database baseline. Repository v1 through v13
remain immutable. V14 makes the database backstop workspace isolation
([ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md),
amended 2026-11-08; AUD-V2):

- Every reference between two tenant tables is a composite `(workspace_id, …)`
  key onto its parent's new `UNIQUE (workspace_id, id)`, so the database refuses
  a row that names another workspace's row.
- Fifteen link and child tables gain a denormalized `workspace_id`, last in
  their column order, which defaults from the transaction's `app.workspace_id`.
- Every one of the 64 tenant tables forces row-level security under one policy,
  `workspace_id = nullif(current_setting('app.workspace_id', true),
  '')::uuid`.
  An unset or emptied setting matches no row.
- Grants bind the deployment's roles: `kinship_app` has DML and no DDL,
  `kinship_worker` only what its jobs need, and twelve `SECURITY DEFINER`
  functions, each owned by a non-login role that does not bypass row-level
  security, are the only cross-workspace paths besides the worker's own scan
  policies. The schema never creates a role or holds a password; it refuses to
  apply until the bootstrap step (`tools/migrations/bootstrap.ts`) created them.
- `people` gains five stored generated keys (`sort_given_name`,
  `sort_family_name`, `duplicate_given_name`, `duplicate_family_name`,
  `duplicate_nickname`) under the directory and duplicate-check indexes, which
  an index condition can seek under row-level security (Q4).
- `api_request_logs (member_id)` gains the index its member cascade needs.

It adds no table. The SQL, specification, field catalog, unchanged complete
Monica mappings, changes, migrations, and validation JSON form one synchronized
versioned unit. The field catalog covers 897 columns. Mappings retain all 94
source tables and 823 source columns unchanged.

Empty targets receive the complete v14 DDL. Exact v1–v13 targets upgrade
transactionally. Migration 0014 adds and backfills the link columns, adds the 26
unique keys, replaces 88 references with composite keys, adds the index, and
installs the grants, policies, and functions; a link row that already bridges
two workspaces fails its composite key and rolls the whole upgrade back.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. See personal_crm_schema_v14_changes.md for the
roles, the cross-workspace means, the measurements, locking, recovery, and the
decisions v14 records.
