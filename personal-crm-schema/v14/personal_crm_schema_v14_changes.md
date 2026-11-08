# Repository schema v13 to v14

V14 (AUD-V2) makes the database backstop workspace isolation, implementing
[ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md)
as amended on 2026-11-08 with the product owner's answers to the AUD-V2
questions. It closes SECT-01 and SECT-02 of the
[2026-11-07 audit](../../docs/validation/audit-2026-11-07/04-security-tenant-isolation-and-authorization.md).
It adds twenty columns and no table, so the field catalog has 897 rows; the
Monica mappings are unchanged, since no Monica column maps to a new one.

## Workspace-bound references

- 26 tenant parents gain `UNIQUE (workspace_id, id)`
  (`<table>_workspace_id_id_key`), joining the five that already had it.
- 88 references between tenant tables become composite
  `FOREIGN KEY (workspace_id, column) REFERENCES parent (workspace_id, id)`,
  each keeping its constraint name and delete action. A `SET NULL` action clears
  only the referencing column (`ON DELETE SET NULL (column)`, PostgreSQL 15+),
  so `workspace_id` survives. With v10/v11's seven composite keys, 95 of the 96
  tenant references are workspace-bound.
- `api_request_logs.member_id` stays plain. A request log outlives its
  workspace: `api_request_logs.workspace_id` is set to null when the workspace
  is deleted, and under `MATCH SIMPLE` a composite key's member half would then
  stay behind if the workspace's own key cleared first. The budgets write the
  member and workspace together through one function.
- `tests/support/workspace_references.ts` lists the 96 references as the
  foreign-key catalog generates them, each with the kind (person, member,
  vocabulary, file, aggregate) whose negative cross-workspace test in
  `tests/integration/workspace_isolation_postgres_test.ts` covers it. That suite
  fails while the live catalog and the list differ, so a new reference cannot
  land without a listed test.

## Link-table workspaces

Fifteen tables gain
`workspace_id uuid NOT NULL DEFAULT
(nullif(current_setting('app.workspace_id', true), ''))::uuid`,
last in their column order: every table with two or more references into tenant
tables — `activity_participants`, `gift_file_links`, `messages`,
`person_addresses`, `person_avatars`, `person_contact_methods`,
`person_file_links`, `person_first_meetings`, `person_occupations`,
`person_tags`, `reminder_occurrences`, `stay_in_touch_cadences`, and, through
the first two of those, `person_address_labels` and
`person_contact_method_labels` — plus `person_dates`, which
`reminders.person_date_id` references from another aggregate. Every reference
from these rows is then a composite key, so a link cannot bridge two workspaces.
The default takes the transaction's scope, so an application insert need not
name it; a set-based insert in a scoped transaction gets the same value, and an
unscoped insert gets null and fails `NOT NULL`. Single-parent children
(`activity_emotions`, `call_emotions`, `pets`, `member_preferences`,
`romantic_relationship_details`, `data_import_entities`, `data_import_reports`,
`billing_subscriptions`, `location_weather_cache`) cannot bridge workspaces and
stay as they were. `data_import_reports.entity_id` and its `import_id` both
point into one import's children; they are not tenant tables and are left for a
later version.

These nine children, `billing_subscription_items` one level below
`billing_subscriptions`, and the root `workspaces` table — eleven tables — have
no row-level security backstop in v14: without a `workspace_id` they match no
policy form, so they are not forced. An unscoped `kinship_app` statement reads
every workspace's `workspaces` row and every child row directly — verified live:
both workspaces' names, and another workspace's pet — and the API's `DELETE` on
`workspaces` cascades below row-level security. Their isolation therefore rests
on the application's workspace predicate on the parent chain, as before v14. The
isolation suite lists exactly the nine references from an unforced table into a
tenant table (`SINGLE_PARENT_REFERENCES` in
`tests/support/workspace_references.ts`), and the two further references into
these eleven tables that are not a tenant table's own `workspace_id` key
(`UNFORCED_CHILD_REFERENCES`:
`billing_subscription_items →
billing_subscriptions`,
`data_import_reports → data_import_entities`), with the same allowlists in
`tools/schema/assert_isolation.sql`; a new link table without its own
`workspace_id`, or a table below a child such as one referencing `pets`, fails
both. Backstops for them — a `workspaces` policy on `id = scope`, and a
`workspace_id` on the children — are a follow-up item, not part of v14.

## Row-level security

All 64 tables with a `workspace_id` are `ENABLE` and `FORCE ROW LEVEL SECURITY`
with one permissive policy for every command and role, `workspace_isolation`:
`USING` and `WITH CHECK`
`workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`.

- An unset setting, and the `''` a pooled connection reads back after a
  transaction that set it with `SET LOCAL` (verified on 18.4 and 17.10), match
  no row and do not fail the cast.
- Rows whose `workspace_id` is null — anonymous request logs, instance
  statistics snapshots — match no setting; their uses go through the budget
  functions.
- Referential actions and checks are not bound by row-level security, so
  cascades, `SET NULL`, and composite-key checks behave as before.

## Roles and grants

The schema names roles and never creates one: a `DO` block at the top of the
isolation section refuses to apply until all of them exist. The deployment's
bootstrap step (`tools/migrations/bootstrap.ts`, the only code that connects as
the superuser) creates or corrects them, sets the three login passwords, grants
the migrator `CREATE` on the database and `SET` membership in the function
owners, revokes `CREATE` on schema `public`, and hands an existing schema `crm`
to the migrator.

| Role                  | Login | Bypasses RLS | Holds                                                                                      |
| --------------------- | ----- | ------------ | ------------------------------------------------------------------------------------------ |
| `kinship_migrator`    | yes   | yes          | Owns `crm`; runs only the migrate job (amendment answer 3)                                 |
| `kinship_app`         | yes   | no           | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on every table; no DDL                              |
| `kinship_worker`      | yes   | no           | Only the tables reminder delivery, recurring debts, cleanup, and the retention purge touch |
| eight function owners | no    | no           | Only what their function reads, under their own policy                                     |

The worker reads across workspaces only through `kinship_worker` policies on the
tables its scans read: `people`, `reminders`, `reminder_rules`,
`reminder_occurrences`, `workspace_members`, `workspace_settings`,
`recurring_debts`, `workspace_lifecycle_records`, and `api_request_logs`. It
updates claimed occurrences and cleanup records, deletes withdrawn occurrences
and purged request logs, and inserts only in a transaction scoped to the row's
workspace. Its grants include what AUD-A2's retention purge needs (`DELETE` on
`users`, `user_sessions`, `password_reset_requests`,
`email_verification_tokens`, and `api_request_logs`, and `UPDATE (updated_at)`
on `users`, because the stale-registration purge locks the users it considers
`FOR UPDATE` and writes none). Its request-log policies admit exactly the rows
that purge deletes: `POST` rows on `/api/v1/sessions`, `/api/v1/mfa-challenges`,
or `mail-budget/*`, with or without the subject digest older rows lack.

## Narrow cross-workspace functions

Each is `SECURITY DEFINER` with `search_path` pinned to `pg_catalog, pg_temp`,
names every relation as `crm.<name>`, is owned by its own non-login role that
does not bypass row-level security, and is executable only by the service roles
(`kinship_app`; the worker also `analyze_planning_tables`).

| Function                                                 | Path                                        | Owner                          |
| -------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| `session_workspace_contexts(user)`                       | Session resolution and the switcher         | `kinship_session_resolver`     |
| `session_audit_context(user)`                            | An account-level security event's workspace | `kinship_session_resolver`     |
| `enter_api_token_workspace(token id)`                    | Bearer-token login and the calendar feed    | `kinship_token_resolver`       |
| `enter_invitation_workspace(token hash)`                 | Invitation acceptance                       | `kinship_invitation_resolver`  |
| `unshared_registration_workspaces(user)`                 | Discarding an unverified registration       | `kinship_registration`         |
| `account_lifecycle_memberships(user)`                    | Personal account leave and delete           | `kinship_account_lifecycle`    |
| `workspace_sole_member_user_ids(workspace)`              | Workspace delete and reset (SECT-05)        | `kinship_workspace_lifecycle`  |
| `request_budget_attempts(path, digests, since)`          | Throttles and the per-recipient mail cap    | `kinship_request_budget`       |
| `request_budget_workspace_count(path, workspace, since)` | The per-workspace invitation quota          | `kinship_request_budget`       |
| `record_request_budget(…)`, `finalize_request_budget(…)` | Recording and settling a budget row         | `kinship_request_budget`       |
| `analyze_planning_tables()`                              | Planner statistics after a bulk load        | `kinship_planning_maintenance` |

- The `enter_*` functions scope the calling transaction with
  `set_config('app.workspace_id', …, true)` to the workspace the secret's row
  names, and raise when the transaction is already scoped to another one. The
  caller still checks the secret.
- The budget role's policies admit only rows that carry a subject digest, and
  inserts only `POST` rows with one.
- REL-116: neither service role may `ANALYZE` a table it does not own, and
  neither receives `MAINTAIN` (PostgreSQL 17+). `kinship_planning_maintenance`
  holds `MAINTAIN` on exactly `people`, `reminders`, and `reminder_occurrences`,
  and the import job can call `analyze_planning_tables()` after a bulk load;
  wiring that call stays with REL-116.

## Index conditions under row-level security (Q4)

Under a security qual PostgreSQL uses a query's condition as an index condition
only when every function in it is leakproof. Text comparison is; `lower`,
`btrim`, `to_tsvector`, and `@@` are not, so v13's expression indexes could no
longer be sought. Measured on 18.4 as `kinship_app` and as the superuser, one
workspace of 10,000 people and 30,000 notes (plus a second of the same size),
`EXPLAIN (ANALYZE)`:

| Statement                                | Bypassing RLS    | Under RLS, v13 keys       | Under RLS, v14 keys      |
| ---------------------------------------- | ---------------- | ------------------------- | ------------------------ |
| Directory name order, 5,000 people in    | 0.08 ms, 21 rows | 1.3 ms, 5,020 rows read   | 0.32 ms, 21 rows read    |
| Duplicate-name check                     | 0.07 ms          | 2.3 ms, 10,000 rows read  | 0.04 ms, 1 row read      |
| Notes full-text arm (`notes_search_idx`) | 1.3 ms           | 28.9 ms, 30,000 rows read | unchanged (see the note) |

`people` gains five `STORED` generated columns from exactly v13's expressions —
`sort_given_name` and `sort_family_name` for the directory's given-name order,
`duplicate_given_name`, `duplicate_family_name`, and `duplicate_nickname` for
the duplicate check — and `people_active_given_name_idx` and
`people_active_duplicate_name_idx` are rebuilt on them under the same names and
partial predicate. The directory and the duplicate check compare those columns,
so the values, the order, and the cursors are unchanged. Measured again on the
v14 keys (18.4, the same two workspaces, median of seven `EXPLAIN (ANALYZE)`
runs of the repositories' own statements): the directory page 5,000 people in
reads its 21 rows through `people_active_given_name_idx` in 0.32 ms as
`kinship_app` (0.26 ms bypassing RLS), and the duplicate check its one row
through `people_active_duplicate_name_idx` in 0.04 ms (0.03 ms). Full-text
search keeps its workspace-bounded scan: a generated `tsvector` would not help,
because `@@` itself is not leakproof. The whole text statement for a word one
note holds took 62 ms as `kinship_app` (its notes arm 58.7 ms, reading the
workspace's 30,000 notes through `notes_workspace_created_idx` and filtering
them) against 0.36 ms bypassing RLS through the GIN indexes. AUD-P1 puts a
ceiling on it, and crossing that ceiling reopens the question.

## Index

`api_request_logs_member_idx ON api_request_logs (member_id) WHERE member_id IS
NOT NULL`
serves the `SET NULL` cascade from `workspace_members`, which a workspace delete
fires once per member. Measured on PostgreSQL 18.4 with 300,200 request-log
rows, deleting a workspace whose 20 members wrote 10 rows each: 181 and 190 ms
without the index, 44 (cold) and 12 ms with it. The explicit-index count is 158.

## Migration 0014

In the runner's one transaction, as the schema owner: add each link column
without a default, backfill it from the parent, set `NOT NULL` and the default;
add the unique keys; drop and re-add each reference as its composite; add the
index; then install the grants, policies, and functions with the same statements
as the DDL, so a fresh v14 and an upgraded v13 compare equal in the runner's
catalog check, which now also covers row-level security flags, policies, routine
owners, and grants (as grantee and privilege, without the owner's entry or the
grantor).

- Locking: `ALTER TABLE` takes `ACCESS EXCLUSIVE` on each altered table until
  commit. On the large profile (10,000 people, 30,000 notes, 20,000 tags, 10,000
  contact methods and dates, 7,300 reminders, 87,600 occurrences) the migration
  took 1.7, 1.9, and 2.4 s on 18.4. The migrate job runs before the API and
  worker start.
- A link row that already bridges two workspaces fails its composite key, and
  the whole upgrade rolls back (asserted by `deno task test:schema`). Recovery:
  find the row with the failing constraint's name, decide its owner, correct or
  delete it, and rerun the migrate job.
- Rollback: an image built before v14 finds an unknown catalog and refuses to
  start the migrate job. Roll back by restoring the pre-migration backup, or by
  redeploying a v14-aware image; no down migration is provided.

## Application contract

- The transaction runners take the workspace as a scope
  (`run(work, { workspaceId })`) and send `begin; set local app.workspace_id` as
  one message; an unscoped run sees no tenant row. Read models that hold the
  pool read through `readWithinWorkspace` or `readOnlyWithin`.
- Statements per request, measured with AUD-K3's counting harness on 2026-11-08:
  `GET /api/v1/people?limit=20` sends 8 (4 on v13) and `GET /api/v1/session` 8
  (4 on v13). Each keeps the session lookup and the membership read, which run
  before a workspace is chosen, and each tenant read now runs in a read-only
  transaction whose `begin` carries the workspace's `set local` in one message
  and ends with a `commit`: two such reads, two brackets. The directory stays
  within K3's pin of 8; the session's pin moves from 4 to 8. Sharing one bracket
  across a request's reads would bring both to 6, and is left to a later ticket.
