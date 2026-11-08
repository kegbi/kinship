# Repository schema v14 to v15

V15 (REL-120) brings the eleven workspace-owned tables that v14 left outside the
row-level-security backstop under it, following
[ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md):
the root `workspaces` table, the nine single-parent children `pets`,
`romantic_relationship_details`, `activity_emotions`, `call_emotions`,
`data_import_entities`, `data_import_reports`, `member_preferences`,
`billing_subscriptions`, and `location_weather_cache`, and
`billing_subscription_items` one level below `billing_subscriptions`. Under v14
an unscoped `kinship_app` statement read every workspace's rows there; under v15
it reads none. It adds ten columns and no table, so the field catalog has 907
rows; the Monica mappings are unchanged, since no Monica column maps to a new
one.

## Single-parent workspaces

The ten children gain
`workspace_id uuid NOT NULL DEFAULT
(nullif(current_setting('app.workspace_id', true), ''))::uuid`,
last in their column order, exactly as v14's link tables did: an insert names no
workspace and takes the transaction's scope.

- Six parents gain `UNIQUE (workspace_id, id)` (`<table>_workspace_id_id_key`):
  `relationships`, `calls`, `data_imports`, `billing_customers`, and the two
  children that are themselves parents, `data_import_entities` and
  `billing_subscriptions`.
- Eleven references become composite
  `FOREIGN KEY (workspace_id, column) REFERENCES parent (workspace_id, id)`,
  keeping their constraint names and `ON DELETE CASCADE`: each child's parent
  key, and `data_import_reports.entity_id`. `pets.category_id`,
  `activity_emotions.emotion_id`, `call_emotions.emotion_id`, and
  `member_preferences.currency_code` stay plain: they name instance-wide
  catalogs, not tenant rows.
- `location_weather_cache` is a per-location cache of a workspace's own
  `locations`, not a cache shared across workspaces, so it carries the
  location's workspace like the others.
- `tests/support/workspace_references.ts` lists 107 tenant references (96 in
  v14), 106 of them workspace-bound; `api_request_logs.member_id` stays the one
  plain key. v14's `SINGLE_PARENT_REFERENCES` and `UNFORCED_CHILD_REFERENCES`
  allowlists, and their copies in `tools/schema/assert_isolation.sql`, are gone:
  no tenant table is referenced from an unforced one any more, so the reference
  guard now refuses every such reference, and REL-125's rule that a forced
  table's own workspace key is exactly `(workspace_id) -> workspaces(id)` is
  unchanged. Its self-tests (a link table without `workspace_id`, a table below
  `pets`, a `workspace_id` key into `pets (person_id, id)` or
  `workspaces (created_by_user_id)`, a non-workspace column into
  `workspaces (id)`) all still fail the guard.

## Row-level security

- Each child is `ENABLE` and `FORCE ROW LEVEL SECURITY` under the one
  `workspace_isolation` policy,
  `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`,
  `USING` and `WITH CHECK`.
- `workspaces` is forced under `workspace_isolation` on its own key,
  `id = nullif(current_setting('app.workspace_id', true), '')::uuid`. An
  unscoped statement reads no workspace; a workspace row is created, renamed, or
  deleted only inside its own scope. Registration therefore enters the new
  workspace before inserting its row, and discarding a pending registration
  deletes each unshared workspace from inside its scope.
- 75 tables are forced (64 in v14), and 104 policies exist (87).

## Narrow cross-workspace roles

The paths that read `workspaces` before any scope is set keep doing so, each
through a role-scoped policy of its own that mirrors its existing policy on
`workspace_members`:

| Policy on `workspaces`            | Role                          | Function or path                                                                 |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `session_resolution FOR SELECT`   | `kinship_session_resolver`    | `session_workspace_contexts` (sign-in and the switcher), `session_audit_context` |
| `registration_cleanup FOR SELECT` | `kinship_registration`        | `unshared_registration_workspaces` (discarding an unverified registration)       |
| `account_lifecycle FOR SELECT`    | `kinship_account_lifecycle`   | `account_lifecycle_memberships` (leaving every workspace, deleting the account)  |
| `workspace_lifecycle FOR SELECT`  | `kinship_workspace_lifecycle` | `workspace_sole_member_user_ids` (workspace delete and reset)                    |
| `worker_scan FOR SELECT`          | `kinship_worker`              | the stale-registration purge's held-registration check                           |

The worker has no `DELETE` policy on `workspaces`. Its one workspace delete, the
stale-registration purge, goes through the shared discard path, which deletes
each unshared workspace from inside that workspace's scope, where
`workspace_isolation` already admits it; v14's `DELETE` grant therefore removes
nothing from an unscoped worker statement (asserted by the `[REL-120]` isolation
case and `tools/schema/assert_isolation.sql`).

The worker also reads `member_preferences` across workspaces: the due-occurrence
claim reads each eligible member's digest time and zone before any workspace is
chosen. It gains `worker_scan ON member_preferences FOR SELECT`, one more of the
ADR's worker-scan policies; its `FOR SHARE` lock on preferences runs inside a
workspace-scoped transaction and needs nothing new. No role is created, no grant
changes, no function changes, and no request path gains a policy: `kinship_app`
has none on `workspaces` beyond the scope.

## Migration 0015

In the runner's one transaction, as the schema owner, with no transaction
control of its own (REL-118): add each child's column without a default,
backfill it from its parent (`billing_subscription_items` after
`billing_subscriptions`), set `NOT NULL` and the default; add the six unique
keys; drop and re-add the eleven references as composites; force row-level
security and create the policies with the same statements as the DDL, so a fresh
v15 and an upgraded v14 compare equal in the runner's catalog check.

- Every existing row keeps every value it held; only the new column is added
  (`deno task test:schema` compares each of the eleven tables' rows, as JSON
  without the new column, before and after, on an exact v14 database with a
  workspace holding pets, emotions, a romantic relationship, import entities and
  reports, member preferences, billing rows, and a weather cache, and
  `tests/integration/migrations_postgres_test.ts` upgrades one through the
  runner).
- A child whose two references already name two workspaces — an import report
  whose entity belongs to another workspace's import — fails its composite key,
  and the whole upgrade rolls back (asserted by `deno task test:schema`).
  Recovery: find the row with the failing constraint's name, decide its owner,
  correct or delete it, and rerun the migrate job.
- Locking: `ALTER TABLE` takes `ACCESS EXCLUSIVE` on each altered table until
  commit; the backfill rewrites each child once. On an exact v14 database at the
  large profile (10,000 people and pets, 5,000 romantic relationships, 50,000
  activity and 50,000 call emotion tags, 250,000 import entities and 250,000
  import reports, 10,000 weather-cache rows), the migration took 4.7, 4.1, and
  4.3 s inside its transaction on PostgreSQL 18.4 (measured 2026-11-09), well
  inside the runner's 120 s statement timeout. The migrate job runs before the
  API and worker start.
- Rollback: an image built before v15 finds an unknown catalog and refuses to
  start the migrate job. Roll back by restoring the pre-migration backup, or by
  redeploying a v15-aware image; no down migration is provided.
- Deployment: nothing new. The bootstrap step already creates every role v15
  names, and no setting, secret, or credential changes.

## Application contract

- Every application statement on the eleven tables already ran inside a
  workspace-scoped transaction, apart from two that read or wrote `workspaces`
  outside their own scope: registration now enters the new workspace before
  inserting its row, and discarding an unverified registration deletes each
  unshared workspace from inside that workspace's scope. Fixtures that seed the
  children as the superuser, which no setting scopes, name the workspace.
- The workspace settings write no longer reads other workspaces to find a taken
  slug: `workspaces_slug_unique`, which row-level security does not bind,
  refuses it, inside a savepoint, and the write answers the same conflict.
- No statement-count pin moves: AUD-K3's directory and session pins, the
  person-rail budget, and the registration and settings suites pass unchanged.
  Discarding a pending registration sends three statements per discarded
  workspace (enter, delete, restore) instead of one shared delete, and a
  settings write two more (its savepoint); neither path is pinned.
