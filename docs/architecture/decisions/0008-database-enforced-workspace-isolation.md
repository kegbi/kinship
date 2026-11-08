# ADR 0008: Database-Enforced Workspace Isolation

- Status: accepted 2026-11-07; amended 2026-11-08 with the product owner's
  answers to the AUD-V2 questions (see [Amendment](#amendment-2026-11-08));
  implemented by schema v14 (AUD-V2)
- Date: 2026-11-07, amended 2026-11-08

## Context

Today only application code enforces workspace isolation; see
[Workspace Isolation](../backend-architecture.md#workspace-isolation). The
[2026-11-07 audit](../../validation/audit-2026-11-07/04-security-tenant-isolation-and-authorization.md)
found no cross-workspace path, in 964 attack requests and about 825 SQL
statements. It also found nothing behind the application (SECT-01, SECT-02):

- Schema v12 has no row-level security, policy, or trigger in schema `crm`.
- Only 7 of 63 tenant-to-tenant foreign keys include `workspace_id`. If a
  predicate is ever forgotten, most tables accept a reference to another
  workspace's row.
- The API, the worker, and the migrator all connect as the bootstrap superuser.
  A superuser bypasses row-level security even when it is forced; the
  orchestrator verified this on PostgreSQL 18.4.

`backend-architecture.md` deferred the question: row-level security "can be
evaluated later as defense in depth".

## Decision

On 2026-11-07 the product owner accepted decision D2 ("Approve") of the
[audit remediation plan](../../planning/audit-remediation-plan-2026-11-07.md).
Schema v14 makes the database enforce the workspace boundary, in three layers
that ship as one synchronized version.

1. **Least-privilege roles.**
   - `kinship_migrator` owns schema `crm`, and only the migrate job uses it.
   - `kinship_app`, used by the API, has DML on `crm` and no DDL. It is not a
     superuser, and it has `NOBYPASSRLS`.
   - `kinship_worker` has only the privileges the worker's jobs need, also with
     `NOBYPASSRLS`.
   - `CREATE` on schema `public` is revoked.

   Compose and the Dokploy file give each service its own credentials. Only the
   bootstrap step uses the superuser.
2. **Workspace-bound references.**
   - Every tenant parent table gets `UNIQUE (workspace_id, id)`.
   - Every tenant-to-tenant foreign key becomes a composite `(workspace_id, …)`
     key.
   - Link tables that today rely on their parent get a denormalized
     `workspace_id`, so that they can carry a composite key too.
3. **Row-level security.**
   - Every tenant table uses `FORCE ROW LEVEL SECURITY`, with a policy of the
     form
     `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`.
   - The transaction runners (`workspaceTransactionRunner` and
     `peopleTransactionRunner`) and every read path set that value, with
     `SET LOCAL app.workspace_id` or `set_config(…, true)`, inside the
     transaction that runs the query.

The implementation must keep these constraints:

- **Use `nullif(…, '')`.** After a `SET LOCAL` transaction ends, a pooled
  connection reads the setting back as `''`. A bare `::uuid` cast then fails
  every later query on that connection; this was verified on PostgreSQL 18.4. An
  unset or empty setting must match no rows.
- **Never use session-level `SET`.** Do not set the workspace that way on a
  pooled connection.
- **Every tenant query runs in a transaction that has set the workspace.** Read
  paths that run outside a transaction today move into one. Design this together
  with AUD-K3, which consolidates per-request round trips, so that a request
  sets its workspace once.
- **Cross-workspace paths are each scoped narrowly.** Some paths legitimately
  span a workspace or run before one exists:
  - session resolution and the workspace switcher;
  - the worker's due-work scans;
  - the calendar feed, resolved by its secret;
  - registration;
  - workspace lifecycle;
  - migrations.

  Each uses a narrowly scoped means, reviewed one at a time: an explicit role,
  or a `SECURITY DEFINER` function with its own policy. No request path runs as
  a role with `BYPASSRLS`.
- **Application rules stay.** Row-level security does not replace application
  authorization or the negative cross-workspace tests. The list of those tests
  is generated from the foreign-key catalog, so a new link cannot be added
  without a test.

## Amendment 2026-11-08

Implementing AUD-V2 showed that the constraints above could not all hold as
written. Four of the 49 tenant tables — `api_request_logs`, `api_tokens`,
`legal_acceptances`, and `statistics_snapshots` — admit rows without a
workspace. Under the exact policy those rows match no setting, so the durable
sign-in throttle and the mail budgets would neither see nor write their rows,
and AUD-M3's per-recipient cap, which counts across workspaces on purpose, would
quietly narrow to one. Five existing paths also span workspaces without being in
the list above. On 2026-11-08 the product owner approved the recommended answer
to each question:

1. **Rows without a workspace.** Every tenant table keeps
   `FORCE ROW LEVEL
   SECURITY` with the exact policy, so such rows stay
   invisible to every other statement. Their identity-level uses run through
   narrow `SECURITY DEFINER` functions owned by a dedicated non-login role whose
   own policy admits only those calls.
2. **The unlisted cross-workspace paths** each get one narrowly scoped means,
   documented as one of the categories above: durable throttles and mail
   budgets; bearer-token login; invitation acceptance by token hash; personal
   account leave and delete across memberships; and the worker's eligibility,
   recurring-debt, and cleanup scans and AUD-A2's purge. The means is a
   `SECURITY DEFINER` function owned by a role that neither logs in nor bypasses
   row-level security, or, for the worker alone, `kinship_worker` policies on
   just the tables its scans read. Owner roles beyond the three above are
   approved.
3. **The migrator** may have `BYPASSRLS`: it owns the schema, runs only the
   migrate job, and is never a request path. Definer functions are owned by
   other roles, so they never inherit it.
4. **Index conditions under row-level security.** PostgreSQL uses a query's
   condition as an index condition under a security qual only when every
   function in it is leakproof; `lower`, `btrim`, `to_tsvector`, and `@@` are
   not. Measured on 18.4 for a workspace of 10,000 people and 30,000 notes, the
   directory's name order 5,000 people in went from 0.08 to 1.3 ms (5,020 rows
   read), the duplicate-name check from 0.07 to 2.3 ms, and a note's full-text
   arm from 1.3 to 28.9 ms. The product owner approved stored generated sort and
   duplicate keys on `people` with btree indexes on them, which text comparison
   (leakproof) can seek; full-text search keeps its workspace-bounded scan as a
   measured cost that AUD-P1 puts a ceiling on, and crossing it reopens the
   question. No search definer function is added.

Schema v14 implements these as follows.

| Path (category)                                        | Means                                                                                                                                                  | Owner role                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Session resolution and the switcher                    | `session_workspace_contexts(user)`, `session_audit_context(user)`; issuing a session then enters the chosen workspace and locks its rows there         | `kinship_session_resolver`     |
| Bearer-token login and the calendar feed (session)     | `enter_api_token_workspace(token id)` scopes the transaction to the token row's workspace; the secret is checked afterwards                            | `kinship_token_resolver`       |
| Invitation acceptance by token hash (registration)     | `enter_invitation_workspace(token hash)` scopes the transaction to the invitation's workspace                                                          | `kinship_invitation_resolver`  |
| Discarding an unverified registration (registration)   | `unshared_registration_workspaces(user)`; a new workspace's transaction enters it as soon as it is created                                             | `kinship_registration`         |
| Personal account leave and delete (lifecycle)          | `account_lifecycle_memberships(user)`; leaving every workspace visits each in turn                                                                     | `kinship_account_lifecycle`    |
| Workspace delete and reset signing out sole members    | `workspace_sole_member_user_ids(workspace)`                                                                                                            | `kinship_workspace_lifecycle`  |
| Durable throttles and mail budgets (session, registr.) | `request_budget_attempts`, `request_budget_workspace_count`, `record_request_budget`, `finalize_request_budget`; the role sees only rows with a digest | `kinship_request_budget`       |
| Worker scans and AUD-A2's purge (worker)               | `kinship_worker` policies: read the scanned tables, settle claimed occurrences and cleanup records, withdraw occurrences, purge request logs           | —                              |
| Planner statistics after a bulk load (REL-116)         | `analyze_planning_tables()`; neither service role holds `MAINTAIN`                                                                                     | `kinship_planning_maintenance` |
| Migrations                                             | `kinship_migrator`, owner, `BYPASSRLS`, migrate job only                                                                                               | —                              |
| Directory order and duplicate check (Q4)               | stored `people.sort_*` and `people.duplicate_*` keys under `people_active_given_name_idx` and `people_active_duplicate_name_idx`                       | —                              |
| Not backstopped: `workspaces` and ten children         | no row-level security (no `workspace_id`); the application's predicate on the parent, and a guard that refuses any new such reference                  | —                              |

Eleven workspace-owned tables are outside the backstop, because they carry no
`workspace_id`: the root `workspaces` table (an unscoped `kinship_app` reads
every workspace's name, and its `DELETE` cascades below row-level security) and
nine single-parent children — `pets`, `romantic_relationship_details`,
`activity_emotions`, `call_emotions`, `data_import_entities`,
`data_import_reports`, `member_preferences`, `billing_subscriptions`, and
`location_weather_cache` — and `billing_subscription_items`, one level further
below `billing_subscriptions`. Each references one parent by a plain key, so it
cannot bridge two workspaces, but a statement that reads or writes it directly
is not bound by the scope. Their isolation rests on the application's predicate
on the parent chain. The isolation suite and `tools/schema/assert_isolation.sql`
allow exactly the nine references from an unforced table into a tenant table,
and into these eleven tables only a tenant table's own `workspace_id` key or the
two listed further levels (`billing_subscription_items →
billing_subscriptions`,
`data_import_reports → data_import_entities`), so a new link table without its
own `workspace_id`, or a table below a child, fails them. Backstopping these
eleven is a follow-up item.

A function named `enter_*` refuses to move a transaction that is already scoped
to another workspace. Every function pins `search_path`, qualifies every name,
and is executable only by the service roles. One reference stays plain:
`api_request_logs.member_id`, because a request log outlives its workspace
(`ON DELETE SET NULL`) and a composite key would leave the member column
dangling when the workspace's own key clears first. The worker's request-log
policies admit only the `POST` rows AUD-A2's purge deletes — the sign-in and MFA
throttle paths and `mail-budget/*`, older rows without a subject digest included
— and it reads invitations across workspaces only to keep a pending invitee's
registration. The purge locks the stale users it considers, so the worker also
holds `UPDATE (updated_at)` on `users`, writing none.

## Consequences

- An application bug that forgets a workspace predicate returns no rows, or
  fails its write, instead of crossing tenants.
- Schema v14 is a large synchronized bundle: SQL, specification, catalogs,
  migrations, validation, generated types, and deployment roles. It touches
  every module's adapter tests. It follows schema v13 (AUD-V1) and lands as
  AUD-V2.
- Deployment gains role bootstrap and per-service credentials, recorded in
  `configuration-and-secrets.md` and `compose-contract.md`. A compose-contract
  test asserts that the application roles are not superusers and do not bypass
  row-level security.
- Each transaction pays for one `SET LOCAL`, and AUD-K3's round-trip budget
  accounts for it.
- `backend-architecture.md` records this decision. Its isolation rules are
  otherwise unchanged.

## Alternatives Rejected

- **Roles only.** This removes superuser access, but the database still accepts
  cross-workspace references.
- **Defer.** Isolation stays one layer deep. The audit's list of id-only
  statements (SECT-09) shows where that layer is thinnest.
- **Row-level security without least-privilege roles.** This would do nothing: a
  superuser bypasses it even when it is forced.
