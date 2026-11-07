# ADR 0008: Database-Enforced Workspace Isolation

- Status: accepted; implemented by schema v14 (AUD-V2)
- Date: 2026-11-07

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
