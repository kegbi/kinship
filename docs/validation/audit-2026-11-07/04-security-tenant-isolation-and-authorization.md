# Security: tenant isolation and authorization

**Scope.** The question audited: _can a user reach another person's data?_ The
tenant is the workspace. This audit covers (1) every PostgreSQL adapter and
read-model adapter, statement by statement; (2) what the database itself
guarantees (row-level security, composite foreign keys, triggers); (3) workspace
switching, membership states and invitations; (4) role enforcement against
`docs/architecture/authorization-matrix.yaml`; (5) personal API tokens and
calendar feeds; and (6) a live, scripted cross-tenant attack run against the
production-built stack, route by route. Authentication mechanics (login,
sessions, CSRF, gateway headers, XSS) belong to the sibling audit
`03-security-authentication-and-edge.md` (`SECA-*`); where this audit touched
them it says so and points there. Out of scope: SSRF of the DAV client (noted
once), AI features, UI code.

**Bottom line.** In about 1,800 attack and verification requests, a signed-in
owner of workspace B could not read, change, delete or link anything that
belongs to workspace A: 183 request builders (covering 122 of the 153 documented
operations, the rest by targeted scenarios) were attacked with A's real ids,
including mixed-ownership bodies, and a before/after dump of all 657 database
rows that mention A's ids was identical. Four static reviewers read about 825
SQL statements and found no cross-tenant path. The weakness is structural: **the
application layer is the only barrier** (no row-level security, 56 of 63
tenant-to-tenant foreign keys are not workspace-bound, and every service
connects as the PostgreSQL superuser), so the next missed predicate becomes a
breach with nothing behind it (SECT-01, SECT-02). Separately, the
workspace-delete/reset danger zone is broken for any workspace that holds a
contact method (SECT-03), and a pending invitation keeps minting an admin seat
after its inviter is removed (SECT-04).

## Method

Static review.

- A scanner (`sql_scan.ts`, brace-aware over the `sql` templates and Kysely
  chains) listed 680 statements that touch a `crm` table and flagged 141 that
  carry no `workspace_id` token. The tenant-table list was generated from the
  live catalog, not hand-typed.
- Four independent read-only reviewers each traced every id from route to SQL
  and classified each statement: people and relationships (266 statements), read
  models (44), files/gifts/import-export/integrations (134), and
  interactions/journal/planning/governance/api-access/identity/workspaces (381).
  Result: 612 `SCOPED`, 161 `PARENT-PROVEN`, 49 `UNSCOPED-UNREACHABLE`
  (worker-only or server-derived ids), 3 `SUSPECT` (all low, none crossing the
  tenant boundary: SECT-04, SECT-06, SECT-07). I re-read the high-risk adapters
  (relationships, session resolution, actor revalidation, invitations, member
  management, tokens, export download, lifecycle) myself and spot-checked every
  `file:line` cited in the permission table.
- Catalog queries against the live database (RLS, policies, triggers, foreign
  keys, unique indexes, roles).

Dynamic verification (shared audit stack, APP_ENV=test, through the gateway at
`https://127.0.0.1:18443`, paced at about 14 requests per second).

- Cast: owners A, B and a sacrificial C; an admin and a plain member invited
  into A (`AD`, `M`) and into C (`CA`, `CM`) through the real invitation flow
  (tokens read from Mailpit). Each member also owns a home workspace, so the
  `X-Workspace-Id` switch is exercised for real.
- Seed ("one of everything", every string carries the marker `SECTMARK-A`):
  people, contact methods, addresses, first meeting, occupation, pet, food
  preferences, tags, important date, life event, relationship, note, activity,
  call, conversation, reminder, stay-in-touch cadence, task, gift (with photo
  attachment), debts (one settled with a photo), recurring debt, document,
  photos, avatar, journal post/day rating/activity link, JSON export, Monica
  import, nine personalization vocabularies, API token, calendar feed, DAV
  subscription, a second session. Identical seeds for B (and a disposable copy
  B2 used only for controls).
- **Route-registry walk.** `packages/contracts/openapi/openapi.json` lists 153
  operations (only three health probes are undocumented in the route registry).
  The catalogue holds 183 request builders (one per operation, split by variant:
  profile-fact section, interaction kind, personalization section). Each builder
  produces a request that is _fully valid_ for the workspace whose id map it
  receives, including fresh optimistic-concurrency tokens, merge digests and
  deletion confirmations, so the only thing that can refuse it is the tenant
  check. For every builder:
  - control: B2's own ids (proves the payload is valid; 177 of 178 returned 2xx,
    the exception is listed under "Not exercised");
  - attack: every path-slot set (all foreign, and each slot alone for
    parent/child mixing) plus explicit body/query slot sets (vocabulary, person,
    file, tag, replacement ids), each paired with the same request using a
    random non-existent id, so any difference between "foreign" and
    "non-existent" shows up as an existence oracle;
  - B's session naming A in `X-Workspace-Id`; an anonymous call; B's personal
    token with and without the foreign header (token-enabled routes).
- Side-effect proof: a dump of every row of all 92 `crm` tables whose text
  mentions any of A's 69 ids, taken before and after the run, then diffed.
  Response bodies are scanned for the marker and for A's ids that the request
  did not itself send.
- Role sweep: the same catalogue executed as the admin and as the plain member
  of C, each on its own fresh data set.
- Targeted scenarios: member management and self-promotion (12 blocked
  attempts), owner-only lifecycle, invitations (replay, wrong user, smuggled
  fields, superseding, pending-after-suspension), tokens and feeds (scope,
  header, suspension, demotion, deletion), export download references, workspace
  switching header, membership states (suspend, reactivate, leave, delete),
  forged cursors (36 variants), `requestId` replays across tenants (7 kinds),
  identical Monica uuid and vCard UID imported by both tenants, over-posting
  (`workspaceId`, `id`, `createdByMemberId`, `memberId` in 11 bodies), id-format
  variants (10), alternate HTTP methods and override headers (32), secret
  material in admin read responses (13 routes plus the full 193-event audit
  log).

## Summary

| ID      | Severity | Title                                                         | Status                  |
| ------- | -------- | ------------------------------------------------------------- | ----------------------- |
| SECT-01 | Medium   | The database offers no tenancy backstop                       | Verified (dynamic)      |
| SECT-02 | Medium   | API, worker and migrator run as the PostgreSQL superuser      | Verified (dyn., static) |
| SECT-03 | Medium   | Workspace delete and reset fail once a contact method exists  | Verified (dynamic)      |
| SECT-04 | Medium   | A pending invitation outlives its inviter's authority         | Verified (dynamic)      |
| SECT-05 | Low      | Workspace delete/reset signs out every (ex-)member everywhere | Verified (dynamic)      |
| SECT-06 | Low      | Session revocation is an id-existence oracle and locks a row  | Verified (dynamic)      |
| SECT-07 | Low      | Personal tokens are issuer-only and unmanaged after demotion  | Verified (dynamic)      |
| SECT-08 | Low      | Role checks are hand-written; the matrix is not machine-bound | Verified (static)       |
| SECT-09 | Low      | Id-only statements that rest on their callers (next-bug list) | Verified (static)       |
| SECT-10 | Info     | Global identifiers and catalogs shared across tenants         | Verified (dyn., static) |
| SECT-11 | Info     | Person reminders answer 200 for an unknown or foreign person  | Verified (dynamic)      |

No Critical or High finding. Counts: Medium 4, Low 5, Info 2.

## Findings

### SECT-01 The database offers no tenancy backstop

- Severity: Medium (defense in depth; no exploitable path was found).
- Status: Verified (dynamic: catalog queries on the live database).
- Where: `personal-crm-schema/v12/personal_crm_schema_v12.sql` (no
  `ENABLE ROW LEVEL SECURITY`, no policy, trigger or function in schema `crm`);
  foreign keys such as `:815` (`person_contact_methods.type_id`) and `:1584`
  (`relationships.relationship_type_id`);
  `docs/architecture/backend-architecture.md:317-319` ("row-level security can
  be evaluated later as defense in depth").

What happens. Tenant isolation is enforced only by `workspace_id = $actor`
predicates and by use-case checks that run before a write. The database rejects
almost no cross-workspace reference on its own:

```text
tables in crm: 92, with workspace_id: 49
relrowsecurity = true: 0    policies: 0    non-internal triggers: 0    functions: 0
FKs between tenant tables: 63
  workspace-composite (workspace_id, id):  7   (debts, debt_settlements,
      recurring_debts, person_duplicate_dismissals: the v10/v11 additions)
  NOT composite:                          56
child tables without workspace_id: 43; 37 of their FKs point at tenant tables
CHECK constraints mentioning workspace/person/member columns: 8, all shape
  rules (relationships.from <> to, dav_objects one-of, reminders target_kind,
  statistics scope); none ties a reference to a workspace
```

The 56 plain foreign keys, grouped by what they would let through (full list in
the Reproduction query):

| Reference class                             | Count | Examples                                                                                                                                                            |
| ------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person links                                |    14 | `notes/calls/tasks/reminders/gifts.person_id`, `gifts.recipient_person_id`, `relationships.from/to_person_id`, `workspace_members.self_person_id`                   |
| Member links                                |    22 | `*.created_by_member_id`, `data_exports.requested_by_member_id`, `dav_*.owner_member_id`, `audit_events.actor_member_id`                                            |
| Vocabulary links                            |     9 | `people.gender_option_id`, `relationships.relationship_type_id`, `activities.activity_type_id`, `conversation_threads.channel_type_id`                              |
| File links                                  |     2 | `data_exports.file_id`, `data_imports.artifact_file_id`                                                                                                             |
| Other aggregate links                       |     9 | `journal_items.(activity_id, journal_post_id, day_rating_id)`, `dav_objects.(task_id, address_book_id)`, `reminders.(task_id, life_event_id)`                       |
| Link tables with no `workspace_id` (37 FKs) |    37 | `person_tags(person, tag)`, `person_file_links(person, file)`, `person_avatars`, `gift_file_links`, `activity_participants`, `person_contact_methods(person, type)` |

Blast radius, by table. These 31 tenant tables hold at least one plain foreign
key to another tenant table, so the database would accept a reference into
another workspace if the application forgot to check it: `activities`,
`activity_types`, `api_request_logs`, `audit_events`, `calls`,
`conversation_threads`, `data_exports`, `data_imports`,
`dav_address_book_subscriptions`, `dav_address_books`, `dav_objects`,
`dav_sync_tokens`, `debts` (person), `files`, `gifts`, `journal_day_ratings`,
`journal_items`, `journal_posts`, `life_event_types`, `life_events`, `notes`,
`people`, `person_duplicate_dismissals` (creator), `recurring_debts` (creator),
`relationship_types`, `relationships`, `reminders`, `tasks`,
`workspace_invitations`, `workspace_members`, `workspace_settings`. So do these
24 child tables, which carry no `workspace_id` at all: `activity_emotions`,
`activity_participants`, `billing_subscriptions`, `call_emotions`,
`data_import_entities`, `data_import_reports`, `gift_file_links`,
`location_weather_cache`, `member_preferences`, `messages`,
`person_address_labels`, `person_addresses`, `person_avatars`,
`person_contact_method_labels`, `person_contact_methods`, `person_dates`,
`person_file_links`, `person_first_meetings`, `person_occupations`,
`person_tags`, `pets`, `reminder_occurrences`, `romantic_relationship_details`,
`stay_in_touch_cadences`. Only `debt_settlements`, `debts.recurring_debt_id`,
`recurring_debts.person_id` and the two person keys of
`person_duplicate_dismissals` are workspace-bound.

A link table that references two parents (a person and a tag, a person and a
file) cannot carry a composite foreign key at all, because it has no
`workspace_id`. If one predicate or one pre-write check were missing, the
database would store a row that bridges two tenants and every read that joins
through it would then cross the boundary.

Evidence. The application layer currently holds: 825 statements reviewed, 183
operations attacked, 58 operations with explicit mixed-ownership cases, zero
changes to A's data (Appendix C). The point of this finding is what stands
behind that layer: nothing.

Impact. Any future defect (a new route, a refactor of a boundary adapter, an
import path, a raw SQL fragment) that forgets one predicate is a full
cross-tenant read or write, silently persisted, with no second check. SECT-09
lists the statements that are one caller-change away from that today.

Recommendation (architecture-compliant: a new synchronized schema version, not
an ad hoc migration, per `AGENTS.md`).

1. Add `UNIQUE (workspace_id, id)` to every tenant parent and convert the 56
   tenant-to-tenant foreign keys to `(workspace_id, x_id)` composites, as v10
   already did for debts. Add a denormalized `workspace_id` to the 37-FK link
   tables so they can carry composites too (`person_tags`, `person_file_links`,
   `person_avatars`, `gift_file_links`, `activity_participants`,
   `person_contact_methods`, `person_first_meetings`, `person_occupations`,
   `messages`, `reminder_occurrences`, `stay_in_touch_cadences`, labels).
2. Enable row-level security (`FORCE ROW LEVEL SECURITY`) on the 49 tenant
   tables with `workspace_id = current_setting('app.workspace_id')::uuid`, set
   by `SET LOCAL` in the two transaction runners (`workspaceTransactionRunner`,
   `peopleTransactionRunner`). It needs the non-superuser role of SECT-02 to
   take effect.
3. Keep the existing rule "a negative integration test for every cross-aggregate
   link", and generate the list from the foreign-key catalog so a new link
   cannot be added untested (the Reproduction section has the query).

### SECT-02 API, worker and migrator run as the PostgreSQL superuser

- Severity: Medium (defense in depth; prerequisite of SECT-01 fix 2).
- Status: Verified (static, code read) for production; role attributes Verified
  (dynamic) on the audit stack.
- Where: `compose.yaml:37` (migrate), `:63` (api) and `:120` (worker) set
  `PGUSER: ${POSTGRES_USER}`, the bootstrap superuser of the `postgres` image
  (`compose.yaml:8`, `compose.dokploy.yaml:48`); there is no second role.

What happens. The one database role is the cluster superuser and the owner of
all 92 tables:

```text
select rolname, rolsuper, rolbypassrls from pg_roles where rolname !~ '^pg_';
 kinship_audit | t | t        -- the role every service connects with
select tableowner, count(*) from pg_tables where schemaname='crm' group by 1;
 kinship_audit | 92
```

Impact. A SQL injection, a deserialization bug or code execution in the API or
the worker is immediately full database control (read every tenant, write
anything, `COPY ... PROGRAM`, disable constraints, read server files), and
row-level security can never constrain this role (superusers bypass it).

Recommendation. Create `kinship_migrator` (owner, runs only the `migrate` job),
`kinship_app` (DML on `crm`, `NOBYPASSRLS`, no DDL, no `pg_read_server_files`)
for `api`, and `kinship_worker` for the worker with only the tables it needs;
`REVOKE CREATE ON SCHEMA public`; pass the role through
`POSTGRES_APP_USER`/`..._PASSWORD`. Add a compose-contract test that the
application URL's role is not a superuser.

### SECT-03 Workspace delete and reset fail once a contact method exists

- Severity: Medium (a promised data-protection capability is broken; no
  confidentiality impact). Treat as a release blocker: it prevents erasure.
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/workspaces/adapters/postgres/workspace_lifecycle.ts:164`
  (`resetWorkspace`: `delete from crm.workspaces ...`) and `:202`
  (`deleteWorkspace`); `personal-crm-schema/v12/personal_crm_schema_v12.sql:815`
  (`person_contact_methods.type_id ... REFERENCES contact_method_types(id) ON
  DELETE RESTRICT`).

What happens. Both operations delete the `workspaces` row and rely on the
`ON DELETE CASCADE` chain. `contact_method_types` and `person_contact_methods`
are reached by two different cascade paths, and the `RESTRICT` check on the
child fires while the parent type row is being deleted but before the child rows
are gone. PostgreSQL aborts the statement, the use case answers a generic 503
"Nothing was changed. Try again", and no retry can succeed.

Evidence (fresh accounts, owner deletes with the correct typed confirmation,
impact token and password):

```text
D1 empty workspace                        DELETE -> 200
D2 one person                             DELETE -> 200
D4 contact-method TYPE, no contact method DELETE -> 200
D5 two people + a relationship            DELETE -> 200
D3 one contact method (type + value)      DELETE -> 503 workspace_lifecycle_unavailable
D3 same workspace                         RESET  -> 503 workspace_lifecycle_unavailable
postgres: ERROR: update or delete on table "contact_method_types" violates
  RESTRICT setting of foreign key constraint "person_contact_methods_type_id_fkey"
  on table "person_contact_methods"
```

The same failure stopped the sacrificial workspace C (18 people, 4
relationships, contact methods). `relationships_relationship_type_id_fkey` is
also `RESTRICT` (`:1584`); it appears to survive only because of the order in
which PostgreSQL fires the two cascade triggers (inferred from the D5 result).
The repository's own
`tests/integration/workspace_lifecycle_impact_postgres_test.ts` seeds a contact
method but only inspects the impact digest; it never executes a reset or a
delete.

Impact. An owner whose workspace holds any contact method (a very common kind of
data in this product) cannot reset or delete it. Because the last owner can
neither leave (`409 final_owner`, observed) nor delete their identity while they
own a workspace (the personal-lifecycle preview lists it under
`blockingWorkspaces`), the person cannot erase their account either; the only
workaround is promoting another owner first. This breaks the `workspace.delete`,
`workspace.reset` and `member.self.delete` permissions in the matrix for real
data, and with them the right to erasure.

Recommendation. Delete in dependency order inside the transaction (children of
`people` first, then vocabularies), or make the two `RESTRICT` keys
`ON DELETE CASCADE` / `DEFERRABLE INITIALLY DEFERRED` in the next schema
version. Add an integration test that seeds every module (the seed script in the
Reproduction section works) and then runs reset and delete.

### SECT-04 A pending invitation outlives its inviter's authority

- Severity: Medium (privilege persistence inside one workspace; not a tenant
  boundary break).
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/workspaces/adapters/postgres/workspace_invitations.ts:158-235`
  (`accept` takes workspace and role from the invitation row and inserts the
  membership at `:208`); `.../application/invite_member.ts:336-370`;
  `.../adapters/postgres/settings_management.ts:256-306` (member updates never
  touch invitations).

What happens. `accept` verifies the token, the invited verified email and the
workspace, but never that `invited_by_member_id` is still an active owner or
admin. No route revokes an invitation (the only way to cancel one is to invite
the same address again, which supersedes it); the pending list does not show who
invited.

Evidence (owner `E`, admin `EA`, accomplice `INV` with a verified account):

```text
W12 owner PATCH /settings/members/{EA} {"role":"admin","status":"suspended"} 200
W13 EA GET /settings/members (header E)                                    401
    (EA invited INV as admin BEFORE the suspension)
W14 INV POST /workspace-invitations/accept {token}                         200
    INV in E -> role=admin; INV GET /settings/members -> 200
```

Impact. An admin who expects to be removed can pre-mint an admin seat for an
accomplice that activates after the owner has removed the admin (within the 7
day window). The accomplice then has full workspace read/write, export and
member management (everything except owner actions). The same applies when the
inviter is demoted to member or leaves.

Recommendation. At accept time require the inviter still to hold owner/admin
(`join workspace_members inviter on inviter.id = wi.invited_by_member_id`), and
revoke the inviter's pending invitations in the same transaction as any role
change, suspension, leave or identity deletion. Add
`DELETE /api/v1/workspace-invitations/{id}` for owners/admins and show the
inviter and the role in the pending list. Cover with a test next to
`tests/integration/invitation_postgres_test.ts`.

### SECT-05 Workspace delete/reset signs out every (ex-)member everywhere

- Severity: Low (cross-tenant availability side effect).
- Status: Verified (dynamic).
- Where: `workspace_lifecycle.ts:149-152` (reset) and `:186-189` (delete):
  `update crm.user_sessions set revoked_at = ... where user_id in (select
  user_id from crm.workspace_members where workspace_id = $W)`.

What happens. The statement selects every membership row of the workspace
regardless of status (active, suspended, left) and revokes all of those users'
sessions, including sessions they use for other workspaces.

Evidence: after the owner deleted workspace E (W20 200), admin `EA`, who also
owns a home workspace, got `401 session_invalid` on `GET /session` with no
header (W23); the home workspace was untouched.

Impact. The owner of any workspace can force a sign-out, in all their
workspaces, of anyone who ever accepted an invitation to it (repeatable with
reset). It is a nuisance rather than a breach, but it is an action in one tenant
changing another tenant's users.

Recommendation. Membership is re-resolved on every request
(`actor_revalidation.ts:205-229`), so deleting the workspace already denies
access to it. Drop the session revocation, or restrict it to users whose only
active membership was this workspace.

### SECT-06 Session revocation is an id-existence oracle and locks a row

- Severity: Low.
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/identity/adapters/postgres/account_settings.ts:79-92`
  (`revokeOwnedSession`).

What happens. `select ... from crm.user_sessions where id = $1 for update`
carries no user filter. For a session id that belongs to someone else the route
answers `403 session_forbidden`; for a missing or inactive id it answers
`404 session_stale`.

Evidence (the only genuine difference among the foreign-vs-random pairs):

```text
B DELETE /settings/sessions/{A's second session}  -> 403 session_forbidden
B DELETE /settings/sessions/{random uuid}          -> 404 session_stale
```

Impact. Someone holding a leaked 122-bit session id learns whether it is active,
and briefly holds a row lock on it. The id is not enumerable.

Recommendation. Add `and user_id = $actor` to the select and answer 404 in both
cases.

### SECT-07 Personal tokens are issuer-only and unmanaged after demotion

- Severity: Low (matrix mismatch).
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts:110-118`
  (list) and `:136-146` (revoke) filter by the issuing user;
  `.../application/api_token_management.ts:105,139,152` require owner/admin.

What happens. A token is bound to its issuer and workspace, and each admin sees
only their own tokens; nobody (including the owner) can list or revoke another
admin's token. If the admin is demoted to member, the token keeps authenticating
with the member's role and its scopes, and the demoted user can neither list nor
revoke it (403).

Evidence on workspace C:

```text
P63 owner suspends admin CA                      200
P64 CA's token GET /people                       401   (suspension kills tokens)
P66 owner reinstates CA as member                200
P67 CA's token GET /people                       200   (still alive)
P68 CA POST /settings/api-tokens                 403
P69 CA GET /settings/api-tokens                  403   (cannot see or revoke it)
```

Impact. Low: the granted scopes are member-level reads and creates. But the
matrix lists `api-tokens.manage` for owner and admin as a workspace capability,
and the owner has no overview or kill switch short of suspending the person.

Recommendation. Let owners and admins list and revoke every token of the
workspace (show issuer and last use), and revoke or downgrade a user's tokens
when their role changes.

### SECT-08 Role checks are hand-written; the matrix is not machine-bound

- Severity: Low.
- Status: Verified (static, code read).
- Where: 13 deny-list checks `role === "member"` (e.g.
  `workspaces/adapters/postgres/settings_management.ts:167,235,259`,
  `import-export/application/export_downloads.ts:116,127,154`,
  `files/application/storage_settings.ts:60`), about 20 allow-list checks
  (`privileged(actor)`, `role in ('owner','admin')`), and three separate copies
  of `privileged()`: `workspaces/domain/roles.ts:23`,
  `api-access/domain/token_rules.ts:103`,
  `integrations/domain/dav_rules.ts:167`.

What happens. There is no single policy function. No test or tool reads
`docs/architecture/authorization-matrix.yaml` (only docs reference it), and
nothing maps routes to permission ids. Today the behaviour matches the matrix
exactly (see the permission table and Appendix B), but a deny-list check
`=== "member"` grants a future fourth role every admin route by default.

Gaps between matrix and behaviour (documentation, not exploits):

- `GET /settings/storage`, export download references, `GET /workspace-members`
  and the person audit route have no explicit matrix row (they ride on
  `workspace.manage`, `data.export`, `workspace.members.invite` and
  `audit.read`).
- `people.vcard.export` is granted to every role and `POST /people/bulk/vcard`
  returns up to 100 full vCards (with contact methods) per call, while
  `data.export` is owner/admin only. Members can already read the same data
  through the person routes, so this is a policy inconsistency, not an
  escalation.
- `billing.manage` has no route.

Recommendation. One `authorize(actor, permissionId)` generated from the YAML, a
route-to-permission table in the route descriptors
(`packages/contracts/registry.ts` already carries `security`), and a unit test
that fails when a mounted route has no permission or when the declared roles
disagree with an admin/member probe. This also closes the per-handler convention
noted in `SECA-10`.

### SECT-09 Id-only statements that rest on their callers (next-bug-away list)

- Severity: Low (no path is reachable today).
- Status: Verified (static, code read); the "no reachable caller" conclusion is
  the reviewers' and was not independently re-traced by me.

These statements address a row by id (or join a foreign table by id) without a
`workspace_id` predicate. Each is safe because every caller loads the id under
the actor's workspace first; with no database backstop (SECT-01) they are the
places a future caller would turn into a breach.

| Where                                                                        | What                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `planning/adapters/postgres/person_date_reminders.ts:40,64,82,90,93,138,255` | `update/delete crm.reminders ... where id = $reminderId` (ids derived from a locked date row)                    |
| `planning/adapters/postgres/reminder_repository.ts:1419`                     | same pattern                                                                                                     |
| `people/adapters/postgres/profile_fact_repository.ts:218,511`                | `select/update crm.people ... where id = $personId` (protected by `lockContext` at `:55`)                        |
| `people/adapters/postgres/person_merge_repository.ts:199,440`                | introducer and location joined by id with no workspace predicate; introducer is written only after a check       |
| `people/adapters/postgres/import_people_boundary.ts:240`                     | `linkAvatar` stores `file_id` unproven in the statement; safe only because the file was created one call earlier |
| `interactions/adapters/postgres/business_import_boundary.ts:54-63,104`       | checks `p.activityId ?? p.parentId` but inserts `p.parentId` (the mapper only emits `parentId`)                  |
| `workspaces/application/recent_people.ts:35-62`                              | stores any UUID in the member's `ui_state`; the only reader filters by workspace                                 |

Recommendation. Add `and workspace_id = $actor` to each (cheap, and the indexes
already exist), and prefer the composite keys of SECT-01.

### SECT-10 Global identifiers and catalogs shared across tenants

- Severity: Info.
- Status: Verified (dynamic for the first; static for the rest).

- Workspace `slug` is globally unique: `PUT /settings/workspace` with a slug
  that another tenant holds answers `409 workspace_slug_conflict`, also for a
  case variant (`settings_management.ts:202`). B learned A's chosen slug exists
  (A set it, B probed it). Slugs are not used by any public route.
- `emotion_options` and `pet_categories` are global tables with no
  `workspace_id`. They are empty on a fresh database and are filled lazily by
  whichever tenant first runs a Monica import that uses them
  (`workspaces/adapters/postgres/business_vocabulary_import.ts:19-22`,
  `people/adapters/postgres/import_business_boundary.ts:68-75`). The names come
  from the fixed list `MONICA_EMOTIONS` indexed by `emotion_id`
  (`import-export/domain/formats/monica_business.ts:219`), so no tenant can
  inject content, but one tenant's action mutates shared state, and the emotion
  options list is empty for everyone until some tenant imports. Seed them once
  instead.
- Object storage keys are `objects/<random uuid>` with no workspace prefix, and
  every read goes through a workspace-scoped metadata row; the database lookup
  is the only barrier.
- An export download token is bound to workspace plus export, one-shot, 5
  minutes, but not to the member who requested it: any owner or admin holding it
  can redeem it (P50 200; replay 410; a member 403; another tenant 401/404).
- `apps/api/composition.ts:850-909` falls back to fixed development key patterns
  (`localKeyset(0x4b/0x52/0x69)`) for MFA, cursor signing and DAV secrets in any
  environment other than `production`; see `SECA-11`.
- Bearer-token requests skip the legal-acceptance guard; see `SECA-05`.

### SECT-11 Person reminders answer 200 for an unknown or foreign person

- Severity: Info.
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/planning/application/reminder_definitions.ts:200-239`
  (`listPerson` never checks that the person exists in the workspace).

`GET /api/v1/people/{personId}/reminders` returns `200` with empty `reminders`
and `cadences` arrays for A's person id and for a random id alike, while every
other person route answers `404 person_not_found`. No data is exposed and there
is no oracle (identical answers), but clients cannot tell a missing person from
an empty list. Call the shared person-existence check first.

## Permission to enforcement table

Roles: O owner, A admin, M member. "Observed" is the dynamic result of the role
sweep (Appendix B, 178 operations as admin and as member of workspace C) and the
targeted scenarios (P-numbers).

| Permission (matrix)                                                                                                    | Roles  | Routes                                                                   | Enforced at (file:line)                                                                                                           | Observed                                       | Gap         |
| ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- |
| registration.create                                                                                                    | anon   | POST /registrations                                                      | `workspaces/adapters/postgres/registration_repository.ts:22-83` (creates a new tenant only)                                       | n/a (SECA-*)                                   | none        |
| session.create                                                                                                         | anon   | POST /sessions, /mfa-challenges, /application-entry                      | `workspaces/application/protected_session.ts:55-212`; workspace chosen only among own memberships `actor_revalidation.ts:205-229` | header tests below                             | none        |
| legal.accept                                                                                                           | user   | GET /legal-requirements, POST /legal-acceptances                         | `governance/transport/http/routes.ts:212-239`                                                                                     | n/a                                            | SECA-05     |
| member.self.manage                                                                                                     | O A M  | /settings/profile, /preferences, /sessions, /member/ui-state             | own ids from the actor: `identity/adapters/postgres/account_settings.ts:20-102`, `member_ui_state.ts:13-34`                       | over-posting 400; M cannot touch O's data      | SECT-06     |
| member.self.delete                                                                                                     | O A M  | DELETE /settings/personal-lifecycle, POST .../leave                      | `workspaces/application/personal_lifecycle.ts:60-125,183,188,249,258` (password, confirmation, final-owner block)                 | P72-P76: final owner 409, leave 200, then 401  | SECT-03     |
| workspace.read                                                                                                         | O A M  | GET /session and all workspace reads                                     | `http-kit/session.ts:145-171` + `actor_revalidation.ts:205-229`                                                                   | B + header A: 401 on 183/183                   | none        |
| workspace.manage                                                                                                       | O A    | GET/PUT /settings/workspace, GET /settings/storage                       | `workspaces/adapters/postgres/settings_management.ts:167,175`; `files/application/storage_settings.ts:60`                         | M 403, AD 200, B+hdr 401                       | doc         |
| workspace.delete                                                                                                       | O      | DELETE /settings/workspace-lifecycle (+ preview)                         | `workspaces/application/workspace_lifecycle.ts:123,246`; SQL `adapters/postgres/workspace_lifecycle.ts:80`                        | A, M 403 (P1-P6); B+hdr 401                    | SECT-03, 05 |
| workspace.reset                                                                                                        | O      | POST /settings/workspace-lifecycle/reset                                 | same                                                                                                                              | A, M 403; B+hdr 401                            | SECT-03, 05 |
| workspace.members.invite                                                                                               | O A    | POST /workspace-invitations, GET /workspace-members                      | `workspaces/application/invite_member.ts:276`; SQL `workspace_invitations.ts:17-28`                                               | M 403 (P22,P25); role owner 400                | SECT-04     |
| workspace.members.manage                                                                                               | O A    | GET /settings/members, PATCH /settings/members/{id}                      | `workspaces/adapters/postgres/settings_management.ts:235,259,283-297`                                                             | 12 tamper attempts blocked; last owner 409     | none        |
| workspace.personalization.manage                                                                                       | O A    | /settings/personalization/{section}[/{id}]                               | `workspaces/application/personalization.ts:46,58`; `adapters/postgres/personalization.ts:190-205`                                 | M 403 on 29 ops                                | none        |
| people.\*, relationships.write, interactions.write, journal.write, tasks.write, reminders.write, files.\*, gifts.write | O A M  | /people/\*, /interactions, /journal/\*, /tasks, /reminders, files, gifts | per-module actor revalidation (`actor_revalidation.ts:122-149`) then workspace-scoped statements                                  | admin and member identical (all 2xx)           | none        |
| data.import                                                                                                            | O A    | /imports\*                                                               | `import-export/domain/import_rules.ts:178` used at `application/import_commit.ts:60`, `import_reads.ts:30`                        | M 403 (3 ops)                                  | none        |
| data.export                                                                                                            | O A    | /exports\*                                                               | `import-export/application/export_artifact.ts:83`, `export_downloads.ts:116,127,154`                                              | M 403 (3 ops); token bound to workspace        | SECT-10     |
| audit.read                                                                                                             | O A    | GET /audit-events, GET /people/{id}/audit                                | `read-models/audit-history/application/list_audit_history.ts:421`; SQL `adapters/postgres/audit_history_repository.ts:82`         | M 403 (3 ops)                                  | none        |
| api-tokens.manage                                                                                                      | O A    | /settings/api-tokens\*                                                   | `api-access/application/api_token_management.ts:105,139,152`; issuer filter `adapters/postgres/api_token_repository.ts:110-146`   | M 403 (3 ops); P63-P69                         | SECT-07     |
| integrations.manage                                                                                                    | O A    | /settings/integrations/dav\*                                             | `integrations/application/dav_context.ts:41`                                                                                      | M 403 (3 ops)                                  | none        |
| calendar-feed.manage                                                                                                   | O A M  | /settings/calendar-feed\*                                                | `api-access/application/calendar_feed_tokens.ts:140-187`; `adapters/postgres/api_token_repository.ts:182-227`                     | M creates, rotates, revokes only its own (P44) | none        |
| billing.manage                                                                                                         | O      | none                                                                     | no route exists                                                                                                                   | n/a                                            | none        |
| reminder-delivery.execute, recurring-debts.charge                                                                      | worker | none                                                                     | `apps/worker/composition.ts:83,89`                                                                                                | no HTTP route reaches them                     | none        |

Tenant-security invariants of the same file, with evidence:

| Invariant                                                                 | Evidence                                                                                                                                                       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A role is ignored unless the membership is active                         | Suspended, reinstated, left, deleted: 401 within one request; sessions, tokens and feeds (P55-P76, W20-W29)                                                    |
| A body or route workspace identifier is never authorization evidence      | 11 over-posting bodies rejected 400; the `workspaceId` query/header only _selects among the caller's own active memberships_ (`actor_revalidation.ts:205-229`) |
| Every aggregate identifier is resolved together with the active workspace | 825 statements, 0 cross-tenant suspects; 183-operation attack, 0 changes                                                                                       |
| Strict child rows are reachable only through an authorized aggregate      | `PARENT-PROVEN` classification (161 statements); mixed parent/child attacks all 404                                                                            |
| Cross-workspace links are rejected before persistence                     | 58 operations with foreign body/query ids: all 400/404 (Appendix C); see SECT-01 for the missing backstop                                                      |
| An admin cannot remove, demote or suspend the last active owner           | Stronger in practice: an admin cannot touch an owner at all (P13-P16 403); the sole owner is protected (P17-P18 409)                                           |
| A member manages only their own credentials, factors and sessions         | Session list/revoke by `user_id` (SECT-06 is the only wrinkle)                                                                                                 |
| Identity deletion cannot orphan an owned workspace or leave a session     | Final owner leave 409 (P72); identity deletion itself not exercised (see below)                                                                                |
| Reset and deletion revalidate ownership and impact after confirmation     | Static: owner, password, typed phrase and impact token (`workspaces/application/workspace_lifecycle.ts:123-182`); but SECT-03                                  |
| Secrets are never returned through audit, admin, import or export         | 13 admin routes plus all 193 audit events scanned: no token, feed secret, password or hash                                                                     |
| Worker permission is capability-specific                                  | Worker-only statements are unreachable from Hono routes (`planning/composition.ts:109-140`)                                                                    |

## Checked and sound

- **Application-layer scoping.** 612 of 825 reviewed statements carry the
  actor's `workspace_id` directly and 161 are proven through a parent that is
  locked in the same transaction; the other 49 are worker-only or use ids the
  server derived from scoped rows. No statement reads or writes a row selected
  by a request-supplied id without one of these. Multi-id inputs (participants,
  bulk person lists, tag ids, replacement ids) are proven with row-count
  equality, so one foreign id fails the whole set
  (`relationship_person_boundary.ts:88-103`).
- **Cross-tenant attack run.** 964 attack requests over 183 builders: 393 `401`
  (header A or anonymous), 438 `404`, 34 `400`, 14 `409`, 1 `403`, and 84 `2xx`.
  The 84 are: 48 B-own calls on routes that take no id (39 reads, 9 creates by B
  in B), 5 token calls on token-enabled list routes, 18 list/search routes given
  a foreign filter id that they ignore or apply inside B's own data
  (`listPeople`, `search`, tag options, relationship types, tasks, person
  reminders), 12 per-item outcome answers (`bulkPeople` reports `not_found` per
  id; `exportPeopleVCards` skips foreign ids and returns `X-Skipped-Count`), and
  1 deletion of a reminder rule that B owns. No `2xx` returned a foreign byte:
  the marker and A's ids never appeared. The 657-row dump of rows mentioning A's
  ids had 0 rows added, removed or changed. Mixed cases (B's person with A's
  vocabulary, file, tag, relationship type, recipient, activity type, contact
  method, organization, replacement id, gender option, settlement or gift photo)
  were all refused (Appendix C).
- **Existence oracles.** Foreign and non-existent ids produce the same status
  and error code everywhere except the session id of SECT-06. (Five further
  apparent differences were artifacts of my own harness: a profile-fact update
  sent with another tenant's revision token answers 409 before the existence
  check, and re-sent with B's own revision token it answers the same 404 as a
  random id; verified by hand.)
- **Workspace switching.** `X-Workspace-Id` is resolved against the user's
  active memberships in the same query that loads the session
  (`actor_revalidation.ts:205-229`). For a user with two memberships (`CM`):
  header naming a non-member workspace 401, all-zero uuid 401, two values 401,
  upper-case uuid accepted (same workspace), empty header falls back to the
  default. The header never selects a workspace the user is not an active member
  of; on data routes a malformed value yields 503, see `SECA-08`.
- **Membership states.** Suspending a member makes their next request 401 for
  that workspace, their personal token 401, their calendar feed 404, while their
  home workspace keeps working; reinstating restores it; leaving behaves like
  suspension; deleting a workspace kills access, tokens, feeds, pending
  invitations and download references for all (P52-P76, W20-W29).
- **Roles as the real members of A.** Plain member `M` of workspace A sent the
  54 admin-only request builders (personalization, members, invitations, tokens,
  exports, imports, audit, storage, workspace settings, DAV) with A's real ids
  and `X-Workspace-Id: A`: 54 times `403`. `M` and admin `AD` both got
  `403 workspace_owner_required` on the owner-only lifecycle preview, reset and
  delete; `M` got `403 member_forbidden` for self to owner, self to admin, owner
  to suspended and admin to suspended. The full admin and member sweep ran in
  workspace C (Appendix B) so that allowed writes could not damage A.
- **Member management.** 12 escalation attempts blocked: member promotes self or
  touches owner/admin (403), admin grants owner, touches owner or promotes to
  owner (403), sole owner demotes or suspends self (409), foreign tenant names
  the member id (404, or 401 with the header). Admin promoting a member to admin
  and back is allowed by the matrix.
- **Invitations.** The token is hashed; workspace and role come only from the
  row; the invited address must equal the verified account email (citext);
  consumed tokens answer 410, wrong user 403, garbage 404, smuggled
  `role`/`workspaceId` fields are not honoured, `authenticate` with another
  account's valid credentials is a plain 401 with no cookie, re-inviting an
  address supersedes the old token (410). Create accepts only `admin`/`member`
  (owner is 400). The one weakness is SECT-04.
- **Tokens and feeds.** A personal token is bound to issuer and workspace,
  re-resolved against the live membership on every use, scope-limited per route,
  and `X-Workspace-Id` can only confirm its own workspace (401 for A or B). A
  refused bearer never falls back to a cookie. A feed secret is not accepted as
  a bearer token and a personal token is not accepted as a feed secret; a
  rotated, revoked, suspended or deleted feed answers 404; forged or truncated
  secrets 404; one member's revocation does not affect another's feed; feed
  content contained no other tenant's data; the secret is not written to the API
  log (route pattern only).
- **Cursors.** 36 forged cursors (A's workspace id and anchor ids swapped in,
  across 10 paginated routes, signed and unsigned) produced 400/409 or an
  ordinary page of B's own data; zero leaks. Audit and task cursors are
  HMAC-signed; the others carry the workspace and are re-validated.
- **Idempotency.** Aggregate ids derive from a SHA-256 over namespace, workspace
  id and `requestId` (`shared-kernel/ids.ts`); replaying A's `requestId` as B
  created B's own row (7 kinds) and replaying A's exact request returned 404,
  never A's record.
- **Imports.** The same Monica `uuid` and the same vCard `UID` imported by A and
  B produced one separate person each (`peopleReused: 0`); B cannot read, map or
  commit A's import (404). Import ids are workspace-hashed.
- **Files.** Storage keys are server-minted random uuids, never request derived;
  file bytes, avatars, gift attachments and debt photos are served and attached
  only through workspace-and-person-scoped lookups (9 file operations attacked,
  all 404).
- **Over-posting and id formats.** `workspaceId`, `id`, `createdByMemberId`,
  `memberId` in create/update bodies: 400 on strict schemas; upper-case, braced,
  URN, dashless, dot-segment and encoded-slash variants of A's id: 404/400.
  HEAD, OPTIONS and method-override headers change nothing.
- **Error hygiene.** Problem bodies never echo ids of other tenants; the
  invitation list returns no token or hash; admin reads and the audit log
  contain no secret material.

## Not exercised, and why

- Authentication and credential flows: `sign-out`, `mfa-challenges`,
  `password-reset-requests`, `password-resets`, `email-verification-deliveries`,
  `application-entry`, invitation MFA and verification delivery, public legal
  documents: covered by `03-security-authentication-and-edge.md`.
  `registrations`, `sessions`, `email-verifications`, `legal-requirements` and
  `legal-acceptances` were used only to build the cast. Coverage of the 153
  documented operations: 122 by the route sweep, 16 by targeted scenarios, 5 as
  test setup only, 10 not at all.
- `DELETE /settings/personal-lifecycle` (delete own identity): destructive and
  self-scoped; the final-owner rule was proven through `leave`, the code read
  statically. Note SECT-03 blocks it for owners with contact methods.
- `POST /settings/personalization/{section}` was not in the matrix (no ids);
  checked statically and for over-posting.
- `acknowledgeReminderOccurrence`: the control returned `409` because the seeded
  occurrence is pending, not delivered by the worker, so only the attack side is
  proven (foreign and random id answer identically, 404).
- `synchronizeDavSubscription` and DAV remote I/O: attacked with A's
  subscription id (404); no real sync was run against a remote.
- Worker paths (reminder delivery, recurring-debt charging, DAV sync, cleanup):
  not reachable from HTTP.
- Billing: no routes.
- CSV import column mapping control (needs a pending CSV import); attacked with
  an A import id (404).
- Time-based states (invitation expiry at 7 days, export link at 5 minutes): not
  waited for.

## Reproduction

The harness lives in the audit scratchpad under `work/sect/` (temporary). The
essentials are inlined below so this document stands alone. Everything runs
through the gateway (`https://127.0.0.1:18443`) with:

```sh
DENO_NO_PACKAGE_JSON=1 deno run --no-lock --allow-net --allow-run=docker   --allow-read --allow-write --allow-env   --unsafely-ignore-certificate-errors=127.0.0.1 <file>.ts
```

| File                                                                                                    | Purpose                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lib.ts`                                                                                                | paced HTTP client, register/verify/sign-in/legal, Mailpit, `psql` via `docker exec`  |
| `step1_accounts.ts`                                                                                     | cast: owners A, B, C; invited admin/member of A and C                                |
| `seed.ts`, `refresh.ts`                                                                                 | one-of-everything seed; fresh concurrency tokens and spares                          |
| `catalogue.ts`                                                                                          | 183 declarative request builders with attack slot sets                               |
| `attack.ts`                                                                                             | controls, attacks, random-id baseline, before/after row dump                         |
| `roles.ts`                                                                                              | catalogue as admin and as member of C                                                |
| `privileged.ts`                                                                                         | lifecycle, member tamper, tokens, feeds, export reference, suspension, header, leave |
| `deleted_ws.ts`                                                                                         | invitation tampering, SECT-04, feed/bearer confusion, workspace deletion             |
| `cursors.ts`                                                                                            | forged cursors                                                                       |
| `idem_import.ts`                                                                                        | requestId replays and identical import identities                                    |
| `overpost.ts`, `misc.ts`, `methods.ts`, `member_on_a.ts`, `slug.ts`, `secrets_scan.ts`, `audit_scan.ts` | over-posting, settings by role, method/header tricks, secret scans                   |
| `lifecycle_repro.ts`                                                                                    | SECT-03 minimal repro                                                                |
| `sql_scan.ts`                                                                                           | static statement scanner                                                             |

Test accounts stay in the audit database (`audit-sect-*@example.test`, password
`correct horse battery staple`).

### Catalog queries (SECT-01, SECT-02)

```sql
-- RLS, policies, triggers, functions
select count(*) filter (where relrowsecurity) as rls, count(*) as tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'crm' and c.relkind = 'r';                      -- 0 | 92
select count(*) from pg_policy;                                    -- 0
select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'crm' and not t.tgisinternal;                   -- 0
select rolname, rolsuper, rolbypassrls from pg_roles
 where rolname !~ '^pg_';                                          -- t | t

-- foreign keys between tenant tables that do NOT carry workspace_id
create temp table tenant as
select c.oid as relid, c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id'
       and not a.attisdropped
 where n.nspname = 'crm' and c.relkind = 'r';
select src.relname as child, tgt.relname as parent,
       (select array_agg(a.attname order by k.ord)
          from unnest(con.conkey) with ordinality k(attnum, ord)
          join pg_attribute a on a.attrelid = con.conrelid
           and a.attnum = k.attnum) as columns
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
 where con.contype = 'f'
   and con.conrelid in (select relid from tenant)
   and con.confrelid in (select relid from tenant)
   and not exists (select 1 from unnest(con.conkey) k
                     join pg_attribute a on a.attrelid = con.conrelid
                      and a.attnum = k and a.attname = 'workspace_id');
-- 56 rows (composite ones: debt_settlements x3, debts.recurring_debt_id,
-- recurring_debts.person_id, person_duplicate_dismissals x2)
```

### Attack engine core (route-registry walk)

```ts
// A catalogue entry: valid for whichever workspace's id map `x` it receives.
add({ g: "relationships", id: "createRelationship", m: "POST",
  p: "/api/v1/people/{person}/relationships",
  b: (x) => ({ targetPersonId: x.person3, relationshipTypeId: x.relationshipType2 }),
  extra: [["person3"], ["relationshipType2"], ["person", "person3"]] });

// Cases: all path slots foreign, each path slot alone, plus `extra` sets.
// A slot swap also swaps its revision tokens ("person" -> "person.updatedAt").
const x = overlay(idsB /* own */, idsA /* foreign */, slots);
const hit  = await runOne(op, Bs, x, label);                      // A's ids
const miss = await runOne(op, Bs, overlayRandom(idsB, slots), ""); // random ids
if (hit.status !== miss.status || hit.code !== miss.code) oracle.push(...);
// plus: B + "X-Workspace-Id: A", anonymous, B's token, token + header
```

Side effects: one `union all` arm per `crm` table (92), run before and after the
attack; the set difference must be empty.

```sql
select '<table>' as t, left(replace(x::text, E'\n', ' '), 700) as row_text
  from crm.<table> x
 where x::text ~ '<uuid1>|<uuid2>|...';   -- every id of workspace A
```

### SECT-03 minimal repro

```ts
const owner = await registerAccount(email, "ws"); // lib.ts
const t = await call(
  p,
  "POST",
  "/api/v1/settings/personalization/contact-method-types",
  { body: { name: "Phone", contactKind: "phone" } },
);
const person = (await call(p, "POST", "/api/v1/people", {
  body: { givenName: "Zed", isPartial: false },
})).json.person.id;
const f = await call(
  p,
  "GET",
  `/api/v1/people/${person}/facts/contact-methods`,
);
await call(p, "POST", `/api/v1/people/${person}/facts/contact-methods`, {
  body: {
    section: "contact-methods",
    typeId: t.json.entry.id,
    value: "555-0101",
    isPrimary: true,
    labelIds: [],
    expectedPersonUpdatedAt: f.json.personUpdatedAt,
  },
});
const prev = await call(p, "GET", "/api/v1/settings/workspace-lifecycle");
await call(p, "DELETE", "/api/v1/settings/workspace-lifecycle", {
  body: {
    confirmation: prev.json.confirmations.deleteWorkspace,
    impactToken: prev.json.impactToken,
    password: PASSWORD,
  },
}); // 503
// docker compose logs postgres: violates RESTRICT ... person_contact_methods_type_id_fkey
```

### SECT-04 request sequence

1. Owner `E` invites admin `EA`; `EA` accepts (`POST /workspace-invitations`,
   `POST /workspace-invitations/accept {token}`).
2. `EA` sends `POST /workspace-invitations {"email": INV, "role": "admin"}` with
   `X-Workspace-Id: E`.
3. Owner sends
   `PATCH /settings/members/{EA} {"role":"admin","status":"suspended"}`.
4. `INV` (a verified account) sends `POST /workspace-invitations/accept` with
   the mailed token: `200`. `GET /session` with `X-Workspace-Id: E` then shows
   `member.role = "admin"`.

### SECT-05 request sequence

Owner `E` deletes a workspace that has no contact method (SECT-03 permitting);
then `GET /api/v1/session` with admin `EA`'s cookie and no header answers
`401 session_invalid` although `EA` still owns a home workspace.

## Appendix A: route sweep, workspace B against workspace A

One row per request builder (183). `Req` is the number of requests sent for it
(attack sets, their random-id twins, header, anonymous, token). Columns show the
status codes observed (`404x3` = three 404s). "B own session" is B's cookie
against A's ids, every slot set; "B + hdr A" adds `X-Workspace-Id: A`; token
columns apply to token-enabled routes only.

| Operation                                  | Req | B own session   | B + hdr A | Anon | B token | Token + hdr A |
| ------------------------------------------ | --: | --------------- | --------- | ---- | ------- | ------------- |
| listPeople                                 |  10 | 200x3           | 401       | 401  | 200     | 401           |
| createPerson                               |   3 | 201             | 401       | 401  | -       | -             |
| listPeopleDuplicates                       |   3 | 200             | 401       | 401  | -       | -             |
| dismissPeopleDuplicate                     |   8 | 404x3           | 401       | 401  | -       | -             |
| listPeopleTagFacet                         |   3 | 200             | 401       | 401  | -       | -             |
| listPeopleTagOptions                       |   4 | 200             | 401       | 401  | -       | -             |
| bulkPeople:tag                             |   8 | 200 400x2       | 401       | 401  | -       | -             |
| bulkPeople:untag                           |   8 | 200 400x2       | 401       | 401  | -       | -             |
| bulkPeople:archive-mixed                   |   6 | 200x2           | 401       | 401  | -       | -             |
| bulkPeople:restore                         |   4 | 200             | 401       | 401  | -       | -             |
| exportPeopleVCards                         |   6 | 200 404         | 401       | 401  | -       | -             |
| getPerson                                  |   4 | 404             | 401       | 401  | -       | -             |
| getPerson:summary                          |   4 | 404             | 401       | 401  | -       | -             |
| editPerson                                 |   6 | 400 404         | 401       | 401  | -       | -             |
| getActivityReport                          |   4 | 404             | 401       | 401  | -       | -             |
| listPersonAudit                            |   4 | 404             | 401       | 401  | -       | -             |
| listPersonCommunications                   |   4 | 404             | 401       | 401  | -       | -             |
| listPersonTimeline                         |   4 | 404             | 401       | 401  | -       | -             |
| listPersonReminders                        |   4 | 200             | 401       | 401  | -       | -             |
| getPersonDeletionImpact                    |   4 | 404             | 401       | 401  | -       | -             |
| getPersonIdentity                          |   6 | 404             | 401       | 401  | 404     | 401           |
| recordPersonView                           |   4 | 404             | 401       | 401  | -       | -             |
| starPerson                                 |   4 | 404             | 401       | 401  | -       | -             |
| unstarPerson                               |   4 | 404             | 401       | 401  | -       | -             |
| exportPersonVCard                          |   4 | 404             | 401       | 401  | -       | -             |
| exportPersonVCard:workspaceId              |   6 | 401 404         | 401       | 401  | -       | -             |
| previewPeopleMerge                         |   8 | 404x3           | 401       | 401  | -       | -             |
| replacePersonAvatar                        |   4 | 404             | 401       | 401  | -       | -             |
| removePersonAvatar                         |   4 | 404             | 401       | 401  | -       | -             |
| listImportantDates                         |   6 | 404             | 401       | 401  | 404     | 401           |
| createImportantDate                        |   4 | 404             | 401       | 401  | -       | -             |
| updateImportantDate                        |   8 | 404x3           | 401       | 401  | -       | -             |
| deleteImportantDate                        |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonLifeEvents                       |   4 | 404             | 401       | 401  | -       | -             |
| createPersonLifeEvent                      |   6 | 400 404         | 401       | 401  | -       | -             |
| updatePersonLifeEvent                      |  10 | 400 404x3       | 401       | 401  | -       | -             |
| deletePersonLifeEvent                      |   8 | 404x3           | 401       | 401  | -       | -             |
| listRelationships                          |   6 | 404             | 401       | 401  | 404     | 401           |
| listRelationshipTypes                      |   6 | 200             | 401       | 401  | 200     | 401           |
| createRelationship                         |  12 | 404x5           | 401       | 401  | -       | -             |
| createRelatedPersonRelationship            |   6 | 404x2           | 401       | 401  | -       | -             |
| updateRelationship                         |  10 | 404x4           | 401       | 401  | -       | -             |
| deleteRelationship                         |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonGiftsAndDebts                    |   4 | 404             | 401       | 401  | -       | -             |
| createGift                                 |  10 | 404x4           | 401       | 401  | -       | -             |
| changeGiftStatus                           |   8 | 404x3           | 401       | 401  | -       | -             |
| createDebt                                 |   4 | 404             | 401       | 401  | -       | -             |
| listDebtSettlements                        |   8 | 404x3           | 401       | 401  | -       | -             |
| changeDebtStatus                           |  10 | 404x4           | 401       | 401  | -       | -             |
| deleteDebt                                 |   8 | 404x3           | 401       | 401  | -       | -             |
| createRecurringDebt                        |   4 | 404             | 401       | 401  | -       | -             |
| updateRecurringDebt                        |   8 | 404x3           | 401       | 401  | -       | -             |
| deleteRecurringDebt                        |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonFiles                            |   4 | 404             | 401       | 401  | -       | -             |
| uploadPersonFile                           |   4 | 404             | 401       | 401  | -       | -             |
| downloadPersonFile                         |   8 | 404x3           | 401       | 401  | -       | -             |
| downloadPersonFile:photo                   |   8 | 404x3           | 401       | 401  | -       | -             |
| downloadPersonFile:avatar                  |   8 | 404x3           | 401       | 401  | -       | -             |
| downloadPersonFile:settlementPhoto         |   8 | 404x3           | 401       | 401  | -       | -             |
| removePersonFile                           |   8 | 404x3           | 401       | 401  | -       | -             |
| listProfileFacts:contact-methods           |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:addresses                 |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:first-meeting             |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:work                      |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:pets                      |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:food-preferences          |   6 | 404             | 401       | 401  | 404     | 401           |
| listProfileFacts:tags                      |   6 | 404             | 401       | 401  | 404     | 401           |
| createProfileFact:contact-methods          |  10 | 400x3 404       | 401       | 401  | -       | -             |
| createProfileFact:addresses                |   6 | 400 404         | 401       | 401  | -       | -             |
| createProfileFact:work                     |   6 | 400 404         | 401       | 401  | -       | -             |
| createProfileFact:pets                     |   4 | 404             | 401       | 401  | -       | -             |
| updateProfileFact:contact-methods          |  12 | 400x2 404x2 409 | 401       | 401  | -       | -             |
| updateProfileFact:addresses                |  10 | 400 404x2 409   | 401       | 401  | -       | -             |
| updateProfileFact:work                     |  10 | 400 404x2 409   | 401       | 401  | -       | -             |
| updateProfileFact:pets                     |   8 | 404x2 409       | 401       | 401  | -       | -             |
| updateProfileFact:tags                     |   6 | 404 409         | 401       | 401  | -       | -             |
| updateProfileFact:first-meeting            |   6 | 400 404         | 401       | 401  | -       | -             |
| updateProfileFact:food-preferences         |   4 | 404             | 401       | 401  | -       | -             |
| deleteProfileFact:contact-methods          |   8 | 404x2 409       | 401       | 401  | -       | -             |
| deleteProfileFact:addresses                |   8 | 404x2 409       | 401       | 401  | -       | -             |
| deleteProfileFact:work                     |   8 | 404x2 409       | 401       | 401  | -       | -             |
| deleteProfileFact:pets                     |   8 | 404x2 409       | 401       | 401  | -       | -             |
| listInteractionOptions                     |   5 | 200             | 401       | 401  | 200     | 401           |
| listCommunicationOptions                   |   5 | 200             | 401       | 401  | 200     | 401           |
| recordInteraction:note                     |   6 | 404             | 401       | 401  | 404     | 401           |
| recordInteraction:activity                 |  12 | 404x4           | 401       | 401  | 404     | 401           |
| recordInteraction:call                     |   6 | 404             | 401       | 401  | 404     | 401           |
| recordInteraction:conversation             |  12 | 404x4           | 401       | 401  | 404     | 401           |
| createReminder                             |   4 | 404             | 401       | 401  | -       | -             |
| acknowledgeReminderOccurrence              |   4 | 404             | 401       | 401  | -       | -             |
| setReminderActive                          |   4 | 404             | 401       | 401  | -       | -             |
| createStayInTouchCadence                   |   4 | 404             | 401       | 401  | -       | -             |
| listTasks                                  |   6 | 200             | 401       | 401  | 200     | 401           |
| createTask                                 |   6 | 404             | 401       | 401  | 404     | 401           |
| getTask                                    |   6 | 404             | 401       | 401  | 404     | 401           |
| changeTask                                 |   8 | 404x2           | 401       | 401  | 404     | 401           |
| setTaskCompletion                          |   6 | 404             | 401       | 401  | 404     | 401           |
| listJournal                                |   3 | 200             | 401       | 401  | -       | -             |
| createJournalPost                          |   3 | 201             | 401       | 401  | -       | -             |
| updateJournalPost                          |   4 | 404             | 401       | 401  | -       | -             |
| getJournalItem:post                        |   4 | 404             | 401       | 401  | -       | -             |
| getJournalItem:dayRating                   |   4 | 404             | 401       | 401  | -       | -             |
| getJournalItem:activity                    |   4 | 404             | 401       | 401  | -       | -             |
| saveJournalDayRating                       |   3 | 200             | 401       | 401  | -       | -             |
| linkJournalActivity                        |   4 | 404             | 401       | 401  | -       | -             |
| deleteJournalItem:post                     |   4 | 404             | 401       | 401  | -       | -             |
| deleteJournalItem:dayRating                |   4 | 404             | 401       | 401  | -       | -             |
| deleteJournalItem:activity                 |   4 | 404             | 401       | 401  | -       | -             |
| searchWorkspace                            |   4 | 200             | 401       | 401  | -       | -             |
| searchWorkspace:name                       |   4 | 200             | 401       | 401  | -       | -             |
| listNotifications                          |   3 | 200             | 401       | 401  | -       | -             |
| today:attention                            |   3 | 200             | 401       | 401  | -       | -             |
| today:favorite-notes                       |   3 | 200             | 401       | 401  | -       | -             |
| today:recent-activity                      |   3 | 200             | 401       | 401  | -       | -             |
| today:recent-people                        |   3 | 200             | 401       | 401  | -       | -             |
| today:reminders                            |   3 | 200             | 401       | 401  | -       | -             |
| today:tasks                                |   3 | 200             | 401       | 401  | -       | -             |
| listWorkspaceAudit                         |   8 | 404x3           | 401       | 401  | -       | -             |
| listWorkspaceAudit:plain                   |   3 | 200             | 401       | 401  | -       | -             |
| listExports                                |   3 | 200             | 401       | 401  | -       | -             |
| createWorkspaceExport                      |   3 | 201             | 401       | 401  | -       | -             |
| createExportDownload                       |   4 | 404             | 401       | 401  | -       | -             |
| downloadExport:fakeToken                   |   6 | 401 404         | 401       | 401  | -       | -             |
| listImports                                |   3 | 200             | 401       | 401  | -       | -             |
| createImportDryRun                         |   3 | 201             | 401       | 401  | -       | -             |
| getImportReport                            |   4 | 404             | 401       | 401  | -       | -             |
| commitImport                               |   4 | 404             | 401       | 401  | -       | -             |
| mapImportColumns                           |   4 | 404             | 401       | 401  | -       | -             |
| getApiTokens                               |   3 | 200             | 401       | 401  | -       | -             |
| createApiToken                             |   3 | 201             | 401       | 401  | -       | -             |
| revokeApiToken                             |   4 | 404             | 401       | 401  | -       | -             |
| getCalendarFeed                            |   3 | 200             | 401       | 401  | -       | -             |
| getDavSubscriptions                        |   3 | 200             | 401       | 401  | -       | -             |
| createDavSubscription                      |   3 | 201             | 401       | 401  | -       | -             |
| synchronizeDavSubscription                 |   4 | 404             | 401       | 401  | -       | -             |
| disableDavSubscription                     |   4 | 404             | 401       | 401  | -       | -             |
| listManagedMembers                         |   3 | 200             | 401       | 401  | -       | -             |
| listWorkspaceMembers                       |   3 | 200             | 401       | 401  | -       | -             |
| updateManagedMember                        |   4 | 404             | 401       | 401  | -       | -             |
| listMemberSessions                         |   3 | 200             | 401       | 401  | -       | -             |
| revokeMemberSession                        |   4 | 403             | 401       | 401  | -       | -             |
| getStorageSettings                         |   3 | 200             | 401       | 401  | -       | -             |
| getWorkspaceSettings                       |   3 | 200             | 401       | 401  | -       | -             |
| getMemberPreferences                       |   3 | 200             | 401       | 401  | -       | -             |
| getSettingsProfile                         |   3 | 200             | 401       | 401  | -       | -             |
| getMemberUiState                           |   3 | 200             | 401       | 401  | -       | -             |
| saveMemberUiState:recent                   |   3 | 200             | 401       | 401  | -       | -             |
| getWorkspaceLifecyclePreview               |   3 | 200             | 401       | 401  | -       | -             |
| getPersonalLifecyclePreview                |   3 | 200             | 401       | 401  | -       | -             |
| createWorkspaceInvitation                  |   3 | 201             | 401       | 401  | -       | -             |
| listPersonalization:tags                   |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:tags                 |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:tags                 |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:contact-labels         |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:contact-labels       |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:contact-labels       |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:contact-method-types   |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:contact-method-types |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:contact-method-types |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:activity-types         |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:activity-types       |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:activity-types       |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:life-event-types       |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:life-event-types     |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:life-event-types     |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:gender-options         |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:gender-options       |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:gender-options       |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:reminder-rules         |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:reminder-rules       |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:reminder-rules       |   8 | 200 404x2       | 401       | 401  | -       | -             |
| listPersonalization:profile-modules        |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:profile-modules      |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:profile-modules      |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:relationship-types     |   3 | 200             | 401       | 401  | -       | -             |
| updatePersonalization:relationship-types   |   4 | 404             | 401       | 401  | -       | -             |
| deletePersonalization:relationship-types   |   8 | 404x3           | 401       | 401  | -       | -             |
| listPersonalization:emotion-options        |   3 | 200             | 401       | 401  | -       | -             |
| listPersonalization:pet-categories         |   3 | 200             | 401       | 401  | -       | -             |
| archivePerson                              |   4 | 404             | 401       | 401  | -       | -             |
| restorePerson                              |   4 | 404             | 401       | 401  | -       | -             |
| mergePeople                                |   8 | 404x3           | 401       | 401  | -       | -             |
| deletePerson                               |   4 | 404             | 401       | 401  | -       | -             |

## Appendix B: role matrix (178 operations as owner, admin, plain member)

Owner column: B2 control run in workspace B (own data). Admin and member
columns: the same operations in workspace C, each role on its own fresh data.
Codes are HTTP status plus the problem code of a refusal. `-` means not run.
Deviations from the contract: none (the three that looked odd were an admin
patching the owner, an admin or member revoking the owner's session, and the
owner-only lifecycle preview, all correct refusals).

| Operation                                  | Owner                         | Admin                        | Member                         |
| ------------------------------------------ | ----------------------------- | ---------------------------- | ------------------------------ |
| listPeople                                 | 200                           | 200                          | 200                            |
| createPerson                               | 201                           | 201                          | 201                            |
| listPeopleDuplicates                       | 200                           | 200                          | 200                            |
| dismissPeopleDuplicate                     | 200                           | 200                          | 200                            |
| listPeopleTagFacet                         | 200                           | 200                          | 200                            |
| listPeopleTagOptions                       | 200                           | 200                          | 200                            |
| bulkPeople:tag                             | 200                           | 200                          | 200                            |
| bulkPeople:untag                           | 200                           | 200                          | 200                            |
| exportPeopleVCards                         | 200                           | 200                          | 200                            |
| getPerson                                  | 200                           | 200                          | 200                            |
| getPerson:summary                          | 200                           | 200                          | 200                            |
| editPerson                                 | 200                           | 200                          | 200                            |
| getActivityReport                          | 200                           | 200                          | 200                            |
| listPersonAudit                            | 200                           | 200                          | 403 audit_forbidden            |
| listPersonCommunications                   | 200                           | 200                          | 200                            |
| listPersonTimeline                         | 200                           | 200                          | 200                            |
| listPersonReminders                        | 200                           | 200                          | 200                            |
| getPersonDeletionImpact                    | 200                           | 200                          | 200                            |
| getPersonIdentity                          | 200                           | 200                          | 200                            |
| recordPersonView                           | 200                           | 200                          | 200                            |
| starPerson                                 | 200                           | 200                          | 200                            |
| unstarPerson                               | 200                           | 200                          | 200                            |
| exportPersonVCard                          | 200                           | 200                          | 200                            |
| exportPersonVCard:workspaceId              | 200                           | 200                          | 200                            |
| previewPeopleMerge                         | 200                           | 200                          | 200                            |
| replacePersonAvatar                        | 200                           | 200                          | 200                            |
| listImportantDates                         | 200                           | 200                          | 200                            |
| createImportantDate                        | 201                           | 201                          | 201                            |
| updateImportantDate                        | 200                           | 200                          | 200                            |
| listPersonLifeEvents                       | 200                           | 200                          | 200                            |
| createPersonLifeEvent                      | 201                           | 201                          | 201                            |
| updatePersonLifeEvent                      | 200                           | 200                          | 200                            |
| listRelationships                          | 200                           | 200                          | 200                            |
| listRelationshipTypes                      | 200                           | 200                          | 200                            |
| createRelationship                         | 201                           | 201                          | 201                            |
| createRelatedPersonRelationship            | 201                           | 201                          | 201                            |
| updateRelationship                         | 200                           | 200                          | 200                            |
| listPersonGiftsAndDebts                    | 200                           | 200                          | 200                            |
| createGift                                 | 201                           | 201                          | 201                            |
| changeGiftStatus                           | 200                           | 200                          | 200                            |
| createDebt                                 | 201                           | 201                          | 201                            |
| listDebtSettlements                        | 200                           | 200                          | 200                            |
| changeDebtStatus                           | 200                           | 200                          | 200                            |
| createRecurringDebt                        | 201                           | 201                          | 201                            |
| updateRecurringDebt                        | 200                           | 200                          | 200                            |
| listPersonFiles                            | 200                           | 200                          | 200                            |
| uploadPersonFile                           | 201                           | 201                          | 201                            |
| downloadPersonFile                         | 200                           | 200                          | 200                            |
| downloadPersonFile:photo                   | 200                           | 200                          | 200                            |
| downloadPersonFile:avatar                  | 200                           | 200                          | 200                            |
| downloadPersonFile:settlementPhoto         | 200                           | 200                          | 200                            |
| listProfileFacts:contact-methods           | 200                           | 200                          | 200                            |
| listProfileFacts:addresses                 | 200                           | 200                          | 200                            |
| listProfileFacts:first-meeting             | 200                           | 200                          | 200                            |
| listProfileFacts:work                      | 200                           | 200                          | 200                            |
| listProfileFacts:pets                      | 200                           | 200                          | 200                            |
| listProfileFacts:food-preferences          | 200                           | 200                          | 200                            |
| listProfileFacts:tags                      | 200                           | 200                          | 200                            |
| createProfileFact:contact-methods          | 200                           | 200                          | 200                            |
| createProfileFact:addresses                | 200                           | 200                          | 200                            |
| createProfileFact:work                     | 200                           | 200                          | 200                            |
| createProfileFact:pets                     | 200                           | 200                          | 200                            |
| updateProfileFact:contact-methods          | 200                           | 200                          | 200                            |
| updateProfileFact:addresses                | 200                           | 200                          | 200                            |
| updateProfileFact:work                     | 200                           | 200                          | 200                            |
| updateProfileFact:pets                     | 200                           | 200                          | 200                            |
| updateProfileFact:tags                     | 200                           | 200                          | 200                            |
| updateProfileFact:first-meeting            | 200                           | 200                          | 200                            |
| updateProfileFact:food-preferences         | 200                           | 200                          | 200                            |
| listInteractionOptions                     | 200                           | 200                          | 200                            |
| listCommunicationOptions                   | 200                           | 200                          | 200                            |
| recordInteraction:note                     | 201                           | 201                          | 201                            |
| recordInteraction:activity                 | 201                           | 201                          | 201                            |
| recordInteraction:call                     | 201                           | 201                          | 201                            |
| recordInteraction:conversation             | 201                           | 201                          | 201                            |
| createReminder                             | 201                           | 201                          | 201                            |
| acknowledgeReminderOccurrence              | 409 reminder_occurrence_stale | 404 reminder_not_found       | 404 reminder_not_found         |
| setReminderActive                          | 200                           | 200                          | 200                            |
| createStayInTouchCadence                   | 201                           | 201                          | 201                            |
| listTasks                                  | 200                           | 200                          | 200                            |
| createTask                                 | 201                           | 201                          | 201                            |
| getTask                                    | 200                           | 200                          | 200                            |
| changeTask                                 | 200                           | 200                          | 200                            |
| setTaskCompletion                          | 200                           | 200                          | 200                            |
| listJournal                                | 200                           | 200                          | 200                            |
| createJournalPost                          | 201                           | 201                          | 201                            |
| updateJournalPost                          | 200                           | 200                          | 200                            |
| getJournalItem:post                        | 200                           | 200                          | 200                            |
| getJournalItem:dayRating                   | 200                           | 200                          | 404 journal_item_not_found     |
| getJournalItem:activity                    | 200                           | 200                          | 200                            |
| saveJournalDayRating                       | 200                           | 201                          | 200                            |
| linkJournalActivity                        | 201                           | 201                          | 201                            |
| searchWorkspace                            | 200                           | 200                          | 200                            |
| searchWorkspace:name                       | 200                           | 200                          | 200                            |
| listNotifications                          | 200                           | 200                          | 200                            |
| today:attention                            | 200                           | 200                          | 200                            |
| today:favorite-notes                       | 200                           | 200                          | 200                            |
| today:recent-activity                      | 200                           | 200                          | 200                            |
| today:recent-people                        | 200                           | 200                          | 200                            |
| today:reminders                            | 200                           | 200                          | 200                            |
| today:tasks                                | 200                           | 200                          | 200                            |
| listWorkspaceAudit                         | 200                           | 200                          | 403 audit_forbidden            |
| listWorkspaceAudit:plain                   | 200                           | 200                          | 403 audit_forbidden            |
| listExports                                | 200                           | 200                          | 403 export_forbidden           |
| createWorkspaceExport                      | 201                           | 201                          | 403 export_forbidden           |
| createExportDownload                       | 201                           | 201                          | 403 export_forbidden           |
| listImports                                | 200                           | 200                          | 403 import_forbidden           |
| createImportDryRun                         | 201                           | 201                          | 403 import_forbidden           |
| getImportReport                            | 200                           | 200                          | 403 import_forbidden           |
| getApiTokens                               | 200                           | 200                          | 403 api_tokens_forbidden       |
| createApiToken                             | 201                           | 201                          | 403 api_tokens_forbidden       |
| getCalendarFeed                            | 200                           | 200                          | 200                            |
| getDavSubscriptions                        | 200                           | 200                          | 403 integrations_forbidden     |
| createDavSubscription                      | 201                           | 201                          | 403 integrations_forbidden     |
| listManagedMembers                         | 200                           | 200                          | 403 members_forbidden          |
| listWorkspaceMembers                       | 200                           | 200                          | 403 members_forbidden          |
| updateManagedMember                        | 200                           | 403 member_forbidden         | 403 member_forbidden           |
| listMemberSessions                         | 200                           | 200                          | 200                            |
| getStorageSettings                         | 200                           | 200                          | 403 storage_settings_forbidden |
| getWorkspaceSettings                       | 200                           | 200                          | 403 workspace_forbidden        |
| getMemberPreferences                       | 200                           | 200                          | 200                            |
| getSettingsProfile                         | 200                           | 200                          | 200                            |
| getMemberUiState                           | 200                           | 200                          | 200                            |
| saveMemberUiState:recent                   | 200                           | 200                          | 200                            |
| getWorkspaceLifecyclePreview               | 200                           | 403 workspace_owner_required | 403 workspace_owner_required   |
| getPersonalLifecyclePreview                | 200                           | 200                          | 200                            |
| listPersonalization:tags                   | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:tags                 | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:contact-labels         | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:contact-labels       | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:contact-method-types   | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:contact-method-types | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:activity-types         | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:activity-types       | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:life-event-types       | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:life-event-types     | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:gender-options         | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:gender-options       | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:reminder-rules         | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:reminder-rules       | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:profile-modules        | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:profile-modules      | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:relationship-types     | 200                           | 200                          | 403 personalization_forbidden  |
| updatePersonalization:relationship-types   | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:emotion-options        | 200                           | 200                          | 403 personalization_forbidden  |
| listPersonalization:pet-categories         | 200                           | 200                          | 403 personalization_forbidden  |
| bulkPeople:archive-mixed                   | 200                           | 200                          | 200                            |
| bulkPeople:restore                         | 200                           | 200                          | 200                            |
| removePersonAvatar                         | 200                           | 200                          | 200                            |
| deleteImportantDate                        | 200                           | 200                          | 200                            |
| deletePersonLifeEvent                      | 200                           | 200                          | 200                            |
| deleteRelationship                         | 200                           | 200                          | 200                            |
| deleteDebt                                 | 200                           | 200                          | 200                            |
| deleteRecurringDebt                        | 200                           | 200                          | 200                            |
| removePersonFile                           | 200                           | 200                          | 200                            |
| deleteProfileFact:contact-methods          | 200                           | 200                          | 200                            |
| deleteProfileFact:addresses                | 200                           | 200                          | 200                            |
| deleteProfileFact:work                     | 200                           | 200                          | 200                            |
| deleteProfileFact:pets                     | 200                           | 200                          | 200                            |
| deleteJournalItem:post                     | 200                           | 200                          | 200                            |
| deleteJournalItem:dayRating                | 200                           | 200                          | 404 journal_item_not_found     |
| deleteJournalItem:activity                 | 200                           | 200                          | 200                            |
| revokeApiToken                             | 200                           | 404 api_token_not_found      | 403 api_tokens_forbidden       |
| disableDavSubscription                     | 200                           | 200                          | 403 integrations_forbidden     |
| revokeMemberSession                        | 200                           | 403 session_forbidden        | 403 session_forbidden          |
| deletePersonalization:tags                 | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:contact-labels       | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:contact-method-types | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:activity-types       | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:life-event-types     | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:gender-options       | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:reminder-rules       | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:profile-modules      | 200                           | 200                          | 403 personalization_forbidden  |
| deletePersonalization:relationship-types   | 200                           | 200                          | 403 personalization_forbidden  |
| archivePerson                              | 200                           | 200                          | 200                            |
| restorePerson                              | 200                           | 200                          | 200                            |
| mergePeople                                | 200                           | 200                          | 200                            |
| deletePerson                               | 200                           | 200                          | 200                            |

## Appendix C: mixed-ownership attacks (B's own session)

Foreign ids swapped in, own ids everywhere else, one status per case. `200` rows
are by-design per-item outcomes (bulk and vCard routes report each person) or
list filters that ignore a foreign id; none returned foreign data.

| Operation                                  | Foreign ids swapped in (own ids elsewhere)                                                         | Status                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| listPeople                                 | tag<br>person + person2<br>tag + person + person2                                                  | 200<br>200<br>200                                                                                                                                            |
| dismissPeopleDuplicate                     | person + person2<br>person2<br>person                                                              | 404 person_not_found<br>404 person_not_found<br>404 person_not_found                                                                                         |
| bulkPeople:tag                             | tag<br>person4<br>person4 + tag                                                                    | 400 profile_fact_reference_invalid<br>200<br>400 profile_fact_reference_invalid                                                                              |
| bulkPeople:untag                           | tag<br>person<br>person + tag                                                                      | 400 profile_fact_reference_invalid<br>200<br>400 profile_fact_reference_invalid                                                                              |
| bulkPeople:archive-mixed                   | bulk2<br>bulk1 + bulk2                                                                             | 200<br>200                                                                                                                                                   |
| exportPeopleVCards                         | person + person2<br>person2                                                                        | 404 person_not_found<br>200                                                                                                                                  |
| editPerson                                 | person<br>genderOption                                                                             | 404 person_not_found<br>400 validation_failed                                                                                                                |
| exportPersonVCard:workspaceId              | person<br>workspace                                                                                | 404 export_not_found<br>401 session_invalid                                                                                                                  |
| previewPeopleMerge                         | person4<br>person3<br>person4 + person3                                                            | 404 person_not_found<br>404 person_not_found<br>404 person_not_found                                                                                         |
| updateImportantDate                        | person + date<br>person<br>date                                                                    | 404 person_date_not_found<br>404 person_date_not_found<br>404 person_date_not_found                                                                          |
| deleteImportantDate                        | person + date<br>person<br>date                                                                    | 404 person_date_not_found<br>404 person_date_not_found<br>404 person_date_not_found                                                                          |
| createPersonLifeEvent                      | person<br>lifeEventType                                                                            | 404 life_event_not_found<br>400 validation_failed                                                                                                            |
| updatePersonLifeEvent                      | person + lifeEvent<br>person<br>lifeEvent<br>lifeEventType                                         | 404 life_event_not_found<br>404 life_event_not_found<br>404 life_event_not_found<br>400 validation_failed                                                    |
| deletePersonLifeEvent                      | person + lifeEvent<br>person<br>lifeEvent                                                          | 404 life_event_not_found<br>404 life_event_not_found<br>404 life_event_not_found                                                                             |
| createRelationship                         | person<br>person3<br>relationshipType2<br>person + person3<br>person + person3 + relationshipType2 | 404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found           |
| createRelatedPersonRelationship            | person<br>relationshipType                                                                         | 404 relationship_not_found<br>404 relationship_not_found                                                                                                     |
| updateRelationship                         | person + relationship<br>person<br>relationship<br>relationshipType2                               | 404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found                                         |
| deleteRelationship                         | person + relationship<br>person<br>relationship                                                    | 404 relationship_not_found<br>404 relationship_not_found<br>404 relationship_not_found                                                                       |
| createGift                                 | person<br>person2<br>attackPhoto1<br>person2 + attackPhoto1                                        | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                         |
| changeGiftStatus                           | person + gift<br>person<br>gift                                                                    | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                                               |
| listDebtSettlements                        | person + debt2<br>person<br>debt2                                                                  | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                                               |
| changeDebtStatus                           | person + debt<br>person<br>debt<br>attackPhoto2                                                    | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                         |
| deleteDebt                                 | person + debt2<br>person<br>debt2                                                                  | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                                               |
| updateRecurringDebt                        | person + recurringDebt<br>person<br>recurringDebt                                                  | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                                               |
| deleteRecurringDebt                        | person + recurringDebt<br>person<br>recurringDebt                                                  | 404 gift_not_found<br>404 gift_not_found<br>404 gift_not_found                                                                                               |
| downloadPersonFile                         | person + file<br>person<br>file                                                                    | 404 person_file_not_found<br>404 person_file_not_found<br>404 person_file_not_found                                                                          |
| downloadPersonFile:photo                   | person + photoFile<br>person<br>photoFile                                                          | 404 person_file_not_found<br>404 person_file_not_found<br>404 person_file_not_found                                                                          |
| downloadPersonFile:avatar                  | person2 + avatarFile<br>person2<br>avatarFile                                                      | 404 person_file_not_found<br>404 person_file_not_found<br>404 person_file_not_found                                                                          |
| downloadPersonFile:settlementPhoto         | person + settlementPhotoFile<br>person<br>settlementPhotoFile                                      | 404 person_file_not_found<br>404 person_file_not_found<br>404 person_file_not_found                                                                          |
| removePersonFile                           | person + file<br>person<br>file                                                                    | 404 person_file_not_found<br>404 person_file_not_found<br>404 person_file_not_found                                                                          |
| createProfileFact:contact-methods          | person<br>contactType<br>contactLabel<br>contactType + contactLabel                                | 404 person_fact_not_found<br>400 profile_fact_reference_invalid<br>400 profile_fact_reference_invalid<br>400 profile_fact_reference_invalid                  |
| createProfileFact:addresses                | person<br>contactLabel                                                                             | 404 person_fact_not_found<br>400 profile_fact_reference_invalid                                                                                              |
| createProfileFact:work                     | person<br>organization                                                                             | 404 person_fact_not_found<br>400 profile_fact_reference_invalid                                                                                              |
| updateProfileFact:contact-methods          | person + fact.contact-methods<br>person<br>fact.contact-methods<br>contactType<br>contactLabel     | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale<br>400 profile_fact_reference_invalid<br>400 profile_fact_reference_invalid |
| updateProfileFact:addresses                | person + fact.addresses<br>person<br>fact.addresses<br>contactLabel                                | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale<br>400 profile_fact_reference_invalid                                       |
| updateProfileFact:work                     | person + fact.work<br>person<br>fact.work<br>organization                                          | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale<br>400 profile_fact_reference_invalid                                       |
| updateProfileFact:pets                     | person + fact.pets<br>person<br>fact.pets                                                          | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale                                                                             |
| updateProfileFact:tags                     | person<br>tag2                                                                                     | 404 person_fact_not_found<br>409 profile_fact_stale                                                                                                          |
| updateProfileFact:first-meeting            | person<br>person2                                                                                  | 404 person_fact_not_found<br>400 profile_fact_reference_invalid                                                                                              |
| deleteProfileFact:contact-methods          | person + fact.contact-methods<br>person<br>fact.contact-methods                                    | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale                                                                             |
| deleteProfileFact:addresses                | person + fact.addresses<br>person<br>fact.addresses                                                | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale                                                                             |
| deleteProfileFact:work                     | person + fact.work<br>person<br>fact.work                                                          | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale                                                                             |
| deleteProfileFact:pets                     | person + fact.pets<br>person<br>fact.pets                                                          | 404 person_fact_not_found<br>404 person_fact_not_found<br>409 profile_fact_stale                                                                             |
| recordInteraction:activity                 | person<br>person2<br>activityType<br>person + person2                                              | 404 interaction_context_not_found<br>404 interaction_context_not_found<br>404 interaction_context_not_found<br>404 interaction_context_not_found             |
| recordInteraction:conversation             | person<br>contactType<br>contactMethod<br>person + contactType + contactMethod                     | 404 interaction_context_not_found<br>404 interaction_context_not_found<br>404 interaction_context_not_found<br>404 interaction_context_not_found             |
| changeTask                                 | task<br>person2                                                                                    | 404 task_not_found<br>404 task_not_found                                                                                                                     |
| listWorkspaceAudit                         | person<br>member<br>person + member                                                                | 404 audit_scope_not_found<br>404 audit_scope_not_found<br>404 audit_scope_not_found                                                                          |
| downloadExport:fakeToken                   | exportId<br>workspace                                                                              | 404 export_not_found<br>401 session_invalid                                                                                                                  |
| deletePersonalization:tags                 | tag<br>tag2<br>tag + tag2                                                                          | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:contact-labels       | contactLabel<br>contactLabelAlt<br>contactLabel + contactLabelAlt                                  | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:contact-method-types | contactType<br>contactTypeAlt<br>contactType + contactTypeAlt                                      | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:activity-types       | activityType<br>activityTypeAlt<br>activityType + activityTypeAlt                                  | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:life-event-types     | lifeEventType<br>lifeEventTypeAlt<br>lifeEventType + lifeEventTypeAlt                              | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:gender-options       | genderOption<br>genderOptionAlt<br>genderOption + genderOptionAlt                                  | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:reminder-rules       | reminderRule<br>reminderRuleAlt<br>reminderRule + reminderRuleAlt                                  | 404 personalization_not_found<br>200<br>404 personalization_not_found                                                                                        |
| deletePersonalization:profile-modules      | profileModule<br>profileModuleAlt<br>profileModule + profileModuleAlt                              | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| deletePersonalization:relationship-types   | relationshipTypeAlt<br>relationshipType2<br>relationshipTypeAlt + relationshipType2                | 404 personalization_not_found<br>404 personalization_not_found<br>404 personalization_not_found                                                              |
| mergePeople                                | person4<br>person3<br>person4 + person3                                                            | 404 person_not_found<br>404 person_not_found<br>404 person_not_found                                                                                         |
