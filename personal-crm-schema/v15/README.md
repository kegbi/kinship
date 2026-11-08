# Personal CRM database schema — repository baseline v15

This is the current canonical database baseline. Repository v1 through v14
remain immutable. V15 (REL-120) brings the eleven workspace-owned tables v14
left outside the row-level-security backstop under it
([ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md)):

- The root `workspaces` table forces row-level security under
  `workspace_isolation` on its own id,
  `id = nullif(current_setting('app.workspace_id', true), '')::uuid`. The narrow
  roles that read it before any scope is set — session resolution and the
  switcher, registration cleanup, account and workspace lifecycle, and the
  worker's stale-registration purge — each read it through a role-scoped policy
  of their own, as they read `workspace_members`. No role deletes a workspace
  outside its scope: the purge deletes each from inside it.
- The ten single-parent children — `pets`, `romantic_relationship_details`,
  `activity_emotions`, `call_emotions`, `data_import_entities`,
  `data_import_reports`, `member_preferences`, `billing_subscriptions`,
  `billing_subscription_items`, and `location_weather_cache` — gain a
  denormalized `workspace_id`, last in their column order, defaulting from the
  transaction's `app.workspace_id`; their parent references become composite
  `(workspace_id, …)` keys onto six new `UNIQUE (workspace_id, id)` parent keys;
  and each forces row-level security under the exact v14 policy.
- The worker reads members' delivery preferences across workspaces through its
  own `worker_scan` policy.

With these, all 75 workspace-owned tables are forced, and no tenant table is
referenced from a table without forced row-level security. It adds no table. The
SQL, specification, field catalog, unchanged complete Monica mappings, changes,
migrations, and validation JSON form one synchronized versioned unit. The field
catalog covers 907 columns. Mappings retain all 94 source tables and 823 source
columns unchanged.

Empty targets receive the complete v15 DDL. Exact v1–v14 targets upgrade
transactionally. Migration 0015 adds and backfills the ten child columns from
their parent chains, adds the six unique keys, replaces eleven references with
composite keys, and installs the forced policies and the role-scoped policies;
it keeps every existing row, and a child that already bridges two workspaces
fails its composite key and rolls the whole upgrade back.

Run `deno task test:schema` and, once at the owning schema checkpoint,
`deno task test:schema:matrix`. See personal_crm_schema_v15_changes.md for the
policies, the measurements, locking, recovery, and the application paths v15
moved into a workspace scope.
