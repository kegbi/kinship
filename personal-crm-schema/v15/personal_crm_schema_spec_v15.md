# Personal CRM schema specification — repository v15

## Status

This is the complete repository schema version 15 contract. It preserves the
externally audited repository-v1 model and the repository-reviewed v2
privacy-preserving runtime security field and index, the v3 exact purpose for
every user-session authority, the v4 supported ISO 4217 currency reference
catalog, typed person-date year approximation, durable reminder delivery leases
and provider reconciliation, the v7 surviving workspace deletion record, the v8
member reminder-delivery channel and daily digest time, the v9 full-text search
indexes and workspace-shared duplicate dismissals, and the v10 recurring debt
rules with their one-debt-per-period generation key, plus v11 permanent debt
settlement reasons and optional photo references, plus the v12 reword of the
member reminder-delivery column comment, plus the v13 indexes that match the
statements reading them, the durable MFA-challenge session purpose, a pending
registration's workspace name, and the seeded global emotion and pet catalogs,
plus the v14 database-enforced workspace isolation: workspace-bound composite
references, denormalized link-table workspaces, forced row-level security on
every tenant table, and the role grants and narrow cross-workspace functions of
ADR 0008, plus the v15 backstop of the root `workspaces` table and its
single-parent children (REL-120): a denormalized workspace on each child, its
reference as a composite key, and forced row-level security on all eleven. The
external audit covers the unchanged v1 source bundle only; the v2 through v15
deltas are repository-reviewed and live-PostgreSQL validated.

Repository v15 contains 92 tables, 907 columns, and 158 explicit indexes. Monica
compatibility remains 94/94 source tables and 823/823 source columns with
unchanged dispositions.

**Canonical baseline:** PostgreSQL; UUID primary keys; modular monolith; one
workspace is the tenant boundary; external integrations remain optional
adapters.

## Re-audit result

| Metric                    |      v1 proposal | audited v3 |   Change |
| ------------------------- | ---------------: | ---------: | -------: |
| Canonical/optional tables |               88 |         87 |       -1 |
| Columns                   |              856 |        811 |      -45 |
| Explicit indexes          |              152 |        144 |       -8 |
| Foreign-key declarations  |              201 |        168 |      -33 |
| Table-level constraints   |               33 |         91 |      +58 |
| JSONB fields              |               20 |         17 |       -3 |
| Monica tables mapped      |               94 |      94/94 | complete |
| Monica columns mapped     | table-level only |    823/823 | complete |

The audited model is smaller than v1 even after restoring omitted data and
adding stronger integrity rules. No Monica-specific field was added to a product
table solely to make import easier.

## Design rules

1. **Model product facts, not Monica storage history.** Source IDs, source
   UUIDs, table names, raw rows, and migration flags are isolated in import
   metadata.
2. **Use aggregate ownership instead of duplicated tenant columns.** Aggregate
   roots carry `workspace_id`; strict children derive ownership through a
   required parent.
3. **Keep optional services outside the people model.** DAV, weather, billing,
   OAuth, runtime logs, and update checks are independent modules.
4. **Keep unknown or partial dates losslessly.** Date components plus
   `precision` are the single source of truth; no duplicate complete-date column
   can drift.
5. **Use one file catalog.** Photos, documents, avatars, gift images, import
   artifacts, and export artifacts share `files`; link tables express their
   role.
6. **Separate definitions from generated workflow state.** Reminder
   definitions/rules are canonical; `reminder_occurrences` is generated delivery
   state.
7. **Use typed columns for stable values.** JSONB is reserved for genuinely
   variable schemas, provider payloads, manifests, audit payloads, and redacted
   import diagnostics.
8. **Do not activate imported secrets.** Sessions, reset codes, OAuth tokens,
   API keys, U2F material, and recovery codes are regenerated or require
   re-enrollment.
9. **Keep closed workflow states checked, but leave user/provider vocabularies
   extensible.** This adds integrity without PostgreSQL-enum migration friction.
10. **Preserve source semantics before translating labels.** For example, calls
    retain the exact source boolean and gifts retain the optional recipient
    reference.

## Tenant and aggregate ownership

`workspace_id` remains on aggregate roots that are independently queried or
authorized: people, files, locations, organizations, activities, calls,
conversations, notes, journal roots, life events, tasks, reminders,
relationships, gifts, debts, recurring debt rules, integration roots,
imports/exports, audits, and optional service roots.

Since v14 a child or link row that references two workspace-owned rows, or that
another tenant table references, repeats its parent's `workspace_id`:
`activity_participants`, `gift_file_links`, `messages`, `person_addresses`,
`person_address_labels`, `person_avatars`, `person_contact_methods`,
`person_contact_method_labels`, `person_dates`, `person_file_links`,
`person_first_meetings`, `person_occupations`, `person_tags`,
`reminder_occurrences`, and `stay_in_touch_cadences`. The column is last in each
table and defaults from the transaction's `app.workspace_id`. Since v15
(REL-120) every child row with a single tenant parent repeats it the same way:
`activity_emotions`, `billing_subscriptions`, `billing_subscription_items`,
`call_emotions`, `data_import_entities`, `data_import_reports`,
`location_weather_cache`, `member_preferences`, `pets`, and
`romantic_relationship_details`, so no workspace-owned row is reached only
through its parent's predicate. Application services must still reject
cross-workspace references before persistence, and repository integration tests
must still include a negative cross-tenant case for every command that links two
workspace-owned aggregates; the database refusal below is a second layer, not a
replacement.

## Workspace isolation (v14, v15)

Schema v14 implements
[ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md),
as amended on 2026-11-08.

**Workspace-bound references.** Every tenant parent that another tenant table
references has `UNIQUE (workspace_id, id)`, and every reference between two
tenant tables is a composite
`FOREIGN KEY (workspace_id, column) REFERENCES
parent (workspace_id, id)` with
the same delete action as before; a `SET NULL` action clears only the
referencing column (`ON DELETE SET NULL (column)`). The one exception is
`api_request_logs.member_id`: a request log outlives its workspace (its
`workspace_id` is cleared on delete), and a composite key would leave the member
column behind when the workspace's key clears first.
`tests/support/workspace_references.ts` lists all 107 tenant references, as the
foreign-key catalog generates them; since v15 no reference into a tenant table
comes from a table without forced row-level security.

**Row-level security.** Each of the 74 tables with a `workspace_id` is `ENABLE`
and `FORCE ROW LEVEL SECURITY` with one permissive policy,
`workspace_isolation`, for every command and role:
`workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`,
both `USING` and `WITH CHECK`. A transaction sets the value with `SET LOCAL` or
`set_config(…, true)`. An unset setting, and the `''` a pooled connection reads
back after such a transaction, match no row; rows whose `workspace_id` is null
(an anonymous request log, a statistics snapshot of the instance) match none
either. Referential actions and checks are not bound by row-level security.
Since v15 the root `workspaces` table is forced too, under the same
`workspace_isolation` policy on its own key,
`id = nullif(current_setting('app.workspace_id', true), '')::uuid`: an unscoped
statement reads no workspace, and a workspace row is created, renamed, or
deleted only from inside its own scope. That makes 75 forced tables.

**Roles.** The schema names the roles the deployment's bootstrap step creates
and refuses to apply without them; it never creates a role or holds a password.
`kinship_migrator` owns the schema, bypasses row-level security, and runs only
migrations. `kinship_app` has `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on
every table and no DDL. `kinship_worker` has only what reminder delivery,
recurring debts, the cleanup reconciler, and the retention purge need. Neither
service role is a superuser or `BYPASSRLS`, and `CREATE` on schema `public` is
revoked.

**Narrow cross-workspace means.** Each is a `SECURITY DEFINER` function, with
`search_path` pinned to `pg_catalog, pg_temp` and every name qualified, owned by
a non-login role that does not bypass row-level security and holds only the
privileges and the policy that function needs, and executable only by the
service roles:

| Function                                                                                                        | Path (ADR category)                      | Owner                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| `session_workspace_contexts(user)`, `session_audit_context(user)`                                               | Session resolution and the switcher      | `kinship_session_resolver`     |
| `enter_api_token_workspace(token id)`                                                                           | Bearer-token login and the calendar feed | `kinship_token_resolver`       |
| `enter_invitation_workspace(token hash)`                                                                        | Invitation acceptance (registration)     | `kinship_invitation_resolver`  |
| `unshared_registration_workspaces(user)`                                                                        | Discarding a registration (registration) | `kinship_registration`         |
| `account_lifecycle_memberships(user)`                                                                           | Personal account leave and delete        | `kinship_account_lifecycle`    |
| `workspace_sole_member_user_ids(workspace)`                                                                     | Workspace delete and reset               | `kinship_workspace_lifecycle`  |
| `request_budget_attempts`, `request_budget_workspace_count`, `record_request_budget`, `finalize_request_budget` | Durable throttles and mail budgets       | `kinship_request_budget`       |
| `analyze_planning_tables()`                                                                                     | Planner statistics after a bulk load     | `kinship_planning_maintenance` |

The four owners whose function reads `workspaces` before any scope is set —
`kinship_session_resolver`, `kinship_registration`, `kinship_account_lifecycle`,
and `kinship_workspace_lifecycle` — each read it through a `FOR SELECT` policy
of their own, as they read `workspace_members` (v15). An `enter_*` function
scopes the calling transaction to the workspace its secret names and refuses to
move a transaction scoped to another one. The budget role sees and writes only
request-log rows that carry a subject digest. The worker's own scans read across
workspaces through `kinship_worker` policies on `people`, `reminders`,
`reminder_rules`, `reminder_occurrences`, `workspace_members`,
`workspace_settings`, `recurring_debts`, `workspace_lifecycle_records`,
`api_request_logs`, and since v15 `member_preferences` (delivery choices and
zones) and `workspaces` (the stale-registration purge's check, read before any
scope is set; the purge deletes a workspace only from inside its scope, so an
unscoped worker deletes none); it settles claimed occurrences and cleanup
records, withdraws occurrences, and purges request logs — only the `POST` rows
on the sign-in and MFA throttle paths and `mail-budget/*` — and everything it
inserts still names its workspace. The stale-registration purge locks the users
it considers, so the worker holds `UPDATE (updated_at)` on `users` and writes
none.

## Module summary

| Module                  | Deployment      | Tables | Purpose                                                                                                             |
| ----------------------- | --------------- | -----: | ------------------------------------------------------------------------------------------------------------------- |
| Foundation              | core_domain     |      4 | Global currency catalog plus tenant/workspace membership and member preferences.                                    |
| Identity                | core_domain     |      8 | Login identities, invitations, credential factors, verification/reset workflows, and sessions.                      |
| Workspace configuration | core_domain     |     13 | Workspace-customizable vocabularies and profile-section configuration; global emotion/pet catalogs are seeded once. |
| People                  | core_domain     |     15 | Person profiles, dates, contact methods, addresses, work history, tags, pets, and duplicate dismissals.             |
| Files                   | core_domain     |      3 | Unified file metadata and typed links to people and gifts.                                                          |
| Interactions            | core_domain     |      4 | Activities, participants, emotions, and notes.                                                                      |
| Communications          | core_domain     |      4 | Calls, conversations, and messages.                                                                                 |
| Journal                 | core_domain     |      3 | Journal posts, daily ratings, and ordered timeline items.                                                           |
| Life events             | core_domain     |      1 | Typed life milestones with partial-date precision.                                                                  |
| Tasks and reminders     | core_domain     |      5 | Tasks, reminder definitions/rules, generated occurrences, and stay-in-touch cadence.                                |
| Relationships           | core_domain     |      2 | Directional relationship graph and optional romantic metadata.                                                      |
| Gifts and debts         | core_domain     |      3 | Gift ideas/history, debts/IOUs, and recurring debt rules.                                                           |
| Integrations            | optional_module |      5 | DAV synchronization and weather caching; isolated from person records.                                              |
| Import/export           | core_domain     |      4 | Versioned import/export workflows, source identity map, redacted diagnostics, and manifests.                        |
| Audit                   | core_domain     |      1 | Append-oriented product audit history.                                                                              |
| API                     | runtime_support |      6 | API usage logs, personal tokens, and optional OAuth server state.                                                   |
| Compliance              | optional_module |      2 | Versioned legal documents and immutable acceptances.                                                                |
| Billing                 | optional_module |      3 | Provider-agnostic customer, subscription, and item records.                                                         |
| Operations              | runtime_support |      3 | Scheduled-run history, instance update metadata, and statistics snapshots.                                          |

## Monica import compatibility

The importer uses `data_imports`, `data_import_entities`, and
`data_import_reports`. Domain tables contain no Monica IDs or legacy flags.

Import order:

1. Parse SQL/JSON/vCard input into bounded staging.
2. Create the workspace, users/members, currencies, and configurable
   vocabularies.
3. Create people, files, locations, organizations, and source identity-map rows.
4. Resolve dependent rows and pivots through the identity map.
5. Import interactions, communications, journal data, tasks/reminders,
   relationships, gifts/debts, and optional integrations.
6. Regenerate future reminder occurrences, derived counters, search documents,
   and caches.
7. Validate row counts, references, missing files, unsupported secrets, and
   cross-workspace invariants before commit.

Every Monica source column has an explicit treatment in
`monica_column_mapping_v5.csv`. `reminders_sent` is audit-first because the
source row does not identify a recipient member; an occurrence is updated only
after exact correlation. Redacted snapshots may retain non-secret legacy
details; secrets and session payloads are never written there.

## Monica table coverage

| Monica table                        | Columns | Disposition             | Canonical target/treatment                                                  | Import action                                                                                                                                                                            |
| ----------------------------------- | ------: | ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`                          |      14 | canonical_split         | workspaces                                                                  | workspace_settings                                                                                                                                                                       |
| `users`                             |      27 | canonical_split         | users                                                                       | workspace_members                                                                                                                                                                        |
| `invitations`                       |       7 | canonical               | workspace_invitations                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `recovery_codes`                    |       7 | security_recreated      | user_recovery_codes (newly generated only)                                  | data_import_reports                                                                                                                                                                      |
| `terms`                             |       7 | optional_adapter        | legal_documents                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `term_user`                         |       6 | optional_adapter        | legal_acceptances                                                           | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `modules`                           |       8 | canonical               | workspace_profile_modules                                                   | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `default_contact_modules`           |       8 | seed_manifest           | seed_manifest:workspace_profile_modules                                     | Load equivalent versioned seed manifest; never clone migration flags.                                                                                                                    |
| `subscriptions`                     |      11 | canonical_split         | billing_subscriptions                                                       | billing_subscription_items                                                                                                                                                               |
| `subscription_items`                |       8 | optional_adapter        | billing_subscription_items                                                  | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `export_jobs`                       |      12 | canonical_split         | data_exports                                                                | files                                                                                                                                                                                    |
| `import_jobs`                       |      14 | canonical_split         | data_imports                                                                | files                                                                                                                                                                                    |
| `import_job_reports`                |       9 | canonical               | data_import_reports                                                         | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `audit_logs`                        |      11 | canonical               | audit_events                                                                | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `api_usage`                         |       6 | optional_adapter        | api_request_logs                                                            | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `currencies`                        |       6 | canonical               | currencies                                                                  | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contacts`                          |      49 | canonical_split         | people                                                                      | person_avatars                                                                                                                                                                           |
| `genders`                           |       7 | canonical               | gender_options                                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contact_fields`                    |       8 | canonical               | person_contact_methods                                                      | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contact_field_types`               |      10 | canonical               | contact_method_types                                                        | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `default_contact_field_types`       |       9 | seed_manifest           | seed_manifest:contact_method_types                                          | Load equivalent versioned seed manifest; never clone migration flags.                                                                                                                    |
| `contact_field_labels`              |       6 | canonical               | contact_labels                                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contact_field_contact_field_label` |       3 | canonical               | person_contact_method_labels                                                | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `addresses`                         |       8 | canonical               | person_addresses                                                            | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `places`                            |      11 | canonical               | locations                                                                   | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `address_contact_field_label`       |       3 | canonical               | person_address_labels                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `companies`                         |       7 | canonical               | organizations                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `occupations`                       |      13 | canonical               | person_occupations                                                          | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `tags`                              |       7 | canonical               | tags                                                                        | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contact_tag`                       |       5 | canonical               | person_tags                                                                 | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `photos`                            |       9 | canonical               | files                                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `contact_photo`                     |       4 | canonical               | person_file_links                                                           | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `documents`                         |      12 | canonical_split         | files                                                                       | person_file_links                                                                                                                                                                        |
| `addressbooks`                      |       8 | optional_adapter        | dav_address_books                                                           | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `addressbook_subscriptions`         |      17 | optional_adapter        | dav_address_book_subscriptions                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `synctoken`                         |       7 | optional_adapter        | dav_sync_tokens                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `weather`                           |       6 | optional_adapter        | location_weather_cache                                                      | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `activities`                        |       9 | canonical_split         | activities                                                                  | journal_items                                                                                                                                                                            |
| `activity_contact`                  |       3 | canonical               | activity_participants                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `activity_statistics`               |       7 | derived_recomputed      | derived:activity aggregates                                                 | Recompute from imported activities; retain source counts only for reconciliation.                                                                                                        |
| `activity_type_categories`          |       7 | canonical               | activity_type_categories                                                    | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `activity_types`                    |       9 | canonical               | activity_types                                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `default_activity_type_categories`  |       4 | seed_manifest           | seed_manifest:activity_type_categories                                      | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `default_activity_types`            |       6 | seed_manifest           | seed_manifest:activity_types                                                | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `calls`                             |       9 | canonical               | calls                                                                       | Import the source contact_called boolean exactly as calls.contact_was_caller; do not infer inbound/outbound semantics during migration.                                                  |
| `emotion_call`                      |       6 | canonical               | call_emotions                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `emotion_activity`                  |       5 | canonical               | activity_emotions                                                           | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `emotions`                          |       6 | canonical               | emotion_options                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `emotions_primary`                  |       4 | canonical               | emotion_options                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `emotions_secondary`                |       5 | canonical               | emotion_options                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `notes`                             |       9 | canonical               | notes                                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `conversations`                     |       8 | canonical               | conversation_threads                                                        | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `messages`                          |      10 | canonical               | messages                                                                    | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `debts`                             |      11 | canonical               | debts                                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `gifts`                             |      14 | canonical               | gifts <br> gift_file_links                                                  | Resolve gifts.contact_id to gifts.person_id and gifts.is_for to the optional gifts.recipient_person_id; zero/null means no particular recipient.                                         |
| `gift_photo`                        |       4 | canonical               | gift_file_links                                                             | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `tasks`                             |      10 | canonical_split         | tasks                                                                       | dav_objects                                                                                                                                                                              |
| `reminders`                         |      13 | canonical               | reminders                                                                   | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `reminder_rules`                    |       6 | canonical               | reminder_rules                                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `reminder_outbox`                   |       9 | canonical               | reminder_occurrences                                                        | Regenerate pending future occurrences from reminder definitions and rules.                                                                                                               |
| `reminders_sent`                    |      11 | canonical_audit_history | audit_events <br> reminder_occurrences (only when unambiguously correlated) | Preserve each sent-history row as an audit event. Update an imported occurrence only when it can be correlated to one exact reminder_outbox occurrence; never invent a recipient member. |
| `journal_entries`                   |       7 | canonical               | journal_items                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `entries`                           |       7 | canonical_split         | journal_posts                                                               | journal_items                                                                                                                                                                            |
| `days`                              |       8 | canonical_split         | journal_day_ratings                                                         | journal_items                                                                                                                                                                            |
| `life_event_categories`             |       8 | canonical               | life_event_categories                                                       | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `life_event_types`                  |      10 | canonical               | life_event_types                                                            | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `life_events`                       |      14 | canonical_split         | life_events                                                                 | reminders                                                                                                                                                                                |
| `default_life_event_categories`     |       5 | seed_manifest           | seed_manifest:life_event_categories                                         | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `default_life_event_types`          |       7 | seed_manifest           | seed_manifest:life_event_types                                              | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `special_dates`                     |       9 | canonical               | person_dates                                                                | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `relationship_type_groups`          |       6 | canonical               | relationship_type_groups                                                    | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `relationship_types`                |       8 | canonical               | relationship_types                                                          | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `relationships`                     |       8 | canonical               | relationships                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `default_relationship_type_groups`  |       6 | seed_manifest           | seed_manifest:relationship_type_groups                                      | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `default_relationship_types`        |       8 | seed_manifest           | seed_manifest:relationship_types                                            | Load equivalent versioned seed manifest.                                                                                                                                                 |
| `metadata_love_relationships`       |      11 | canonical_split         | romantic_relationship_details                                               | relationships                                                                                                                                                                            |
| `pets`                              |       8 | canonical               | pets                                                                        | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `pet_categories`                    |       5 | canonical               | pet_categories                                                              | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `oauth_access_tokens`               |       9 | security_recreated      | security_recreated:oauth_access_tokens                                      | Do not activate old tokens; issue replacements after user/admin approval.                                                                                                                |
| `oauth_auth_codes`                  |       6 | security_recreated      | security_recreated:oauth_authorization_codes                                | Discard expired/one-time authorization codes.                                                                                                                                            |
| `oauth_clients`                     |      11 | optional_adapter        | oauth_clients                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `oauth_personal_access_clients`     |       4 | optional_adapter        | oauth_clients                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `oauth_refresh_tokens`              |       4 | security_recreated      | security_recreated:oauth_refresh_tokens                                     | Do not activate old tokens.                                                                                                                                                              |
| `webauthn_keys`                     |      13 | optional_adapter        | webauthn_credentials                                                        | Conditional disabled import only when relying-party compatibility is verified; otherwise re-register.                                                                                    |
| `u2f_key`                           |       9 | security_reenrollment   | security_reenroll:webauthn_credentials                                      | Require WebAuthn re-registration.                                                                                                                                                        |
| `password_resets`                   |       3 | security_recreated      | security_recreated:password_reset_requests                                  | Discard all reset tokens.                                                                                                                                                                |
| `sessions`                          |       6 | runtime_recreated       | runtime_recreated:user_sessions                                             | Invalidate all sessions; users sign in again.                                                                                                                                            |
| `cache`                             |       3 | runtime_recreated       | runtime_recreated:cache                                                     | Do not import.                                                                                                                                                                           |
| `jobs`                              |       6 | runtime_recreated       | runtime_recreated:queue                                                     | Do not import queued work.                                                                                                                                                               |
| `failed_jobs`                       |       6 | runtime_recreated       | runtime_recreated:queue_failure_log                                         | Do not replay; optionally report failures without payload secrets.                                                                                                                       |
| `job_batches`                       |      10 | runtime_recreated       | runtime_recreated:queue_batches                                             | Do not import.                                                                                                                                                                           |
| `crons`                             |       5 | optional_adapter        | scheduled_job_runs                                                          | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `instances`                         |       8 | optional_adapter        | app_instances                                                               | Import through staging and the source identity map, then validate references before commit.                                                                                              |
| `statistics`                        |      30 | optional_adapter        | statistics_snapshots                                                        | derived:live counters                                                                                                                                                                    |

## Canonical table specification

Every field below is also present in `personal_crm_field_catalog_v5.csv`,
including nullability, default, foreign key, classification, and version status.

## Foundation

### `currencies`

Global ISO currency catalog used by members, gifts, debts, and billing display.
Repository v4 ships 165 active codes with numeric minor units from the official
SIX ISO 4217 List One snapshot retrieved on 2026-08-15 (source XML SHA-256
`838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`). The
synchronized schema and v3-to-v4 migration carry identical reference rows.

| Column       | SQL definition                       | Purpose                                                             |
| ------------ | ------------------------------------ | ------------------------------------------------------------------- |
| `code`       | `char(3) PRIMARY KEY`                | ISO 4217 currency code.                                             |
| `name`       | `text NOT NULL`                      | Human-readable currency name.                                       |
| `symbol`     | `text`                               | Common display symbol.                                              |
| `minor_unit` | `smallint NOT NULL DEFAULT 2`        | Number of decimal places normally used by the currency.             |
| `is_active`  | `boolean NOT NULL DEFAULT true`      | Whether this currency is selectable for new data.                   |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC.                                          |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (minor_unit BETWEEN 0 AND 6)`

**Indexes**

- `CREATE INDEX currencies_active_idx ON currencies (is_active);`

### `workspaces`

Tenant/workspace root. This replaces Monica accounts and is the ownership
boundary for product data.

| Column               | SQL definition                                 | Purpose                                                                            |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                 | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`   | Stable public primary key used by APIs, exports, imports, and internal references. |
| `name`               | `text NOT NULL`                                | Workspace display name.                                                            |
| `slug`               | `text`                                         | Optional human-readable URL slug; not used as a permanent identifier.              |
| `status`             | `text NOT NULL DEFAULT 'active'`               | Workspace lifecycle state: active, suspended, or archived.                         |
| `created_by_user_id` | `uuid REFERENCES users(id) ON DELETE SET NULL` | User that created the workspace, when known.                                       |
| `created_at`         | `timestamptz NOT NULL DEFAULT now()`           | Creation timestamp in UTC.                                                         |
| `updated_at`         | `timestamptz NOT NULL DEFAULT now()`           | Last update timestamp in UTC; maintained by application or trigger.                |
| `deleted_at`         | `timestamptz`                                  | Soft-delete timestamp for workspace closure or GDPR deletion workflow.             |

**Table constraints**

- `CHECK (status IN ('active', 'suspended', 'archived'))`

**Row-level security (v15)**

- Forced, under `workspace_isolation` on `id`; narrow roles read it through
  their own policies (see Workspace isolation).

**Indexes**

- `CREATE UNIQUE INDEX workspaces_slug_unique ON workspaces (lower(slug)) WHERE slug IS NOT NULL AND deleted_at IS NULL;`

### `workspace_members`

Membership row connecting a user to a workspace with role, state, and optional
self-person link.

| Column                 | SQL definition                                              | Purpose                                                                                          |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.               |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this membership belongs to.                                                            |
| `user_id`              | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`      | User identity for this membership.                                                               |
| `role`                 | `text NOT NULL DEFAULT 'member'`                            | Workspace role, typically owner, admin, or member.                                               |
| `status`               | `text NOT NULL DEFAULT 'active'`                            | Membership state: active, suspended, or left; pending invitations live in workspace_invitations. |
| `invited_by_member_id` | `uuid`                                                      | Member who sent the invitation, if applicable.                                                   |
| `self_person_id`       | `uuid`                                                      | Person/contact row representing this member inside the workspace address book.                   |
| `joined_at`            | `timestamptz`                                               | When the invitation was accepted or the membership became active.                                |
| `left_at`              | `timestamptz`                                               | When the member left or was removed.                                                             |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                       |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                              |

**Table constraints**

- `UNIQUE (workspace_id, user_id)`
- `CHECK (role IN ('owner', 'admin', 'member'))`
- `CHECK (status IN ('active', 'suspended', 'left'))`
- `CONSTRAINT workspace_members_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id)`

**Deferred foreign keys**

- `ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_self_person_fk
  FOREIGN KEY (workspace_id, self_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL;`

**Indexes**

- `CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);`
- `CREATE UNIQUE INDEX workspace_members_self_person_unique ON workspace_members (self_person_id) WHERE self_person_id IS NOT NULL;`

### `member_preferences`

Per-member locale, timezone, display, sorting, measurement, and sparse UI-state
preferences.

| Column               | SQL definition                                                                        | Purpose                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `member_id`          | `uuid PRIMARY KEY`                                                                    | Member whose preferences are stored here.                                                                                       |
| `timezone`           | `text`                                                                                | IANA timezone used for local date display and reminder scheduling.                                                              |
| `locale`             | `text NOT NULL DEFAULT 'en'`                                                          | Language/locale preference.                                                                                                     |
| `temperature_scale`  | `text NOT NULL DEFAULT 'celsius'`                                                     | Weather display scale.                                                                                                          |
| `measurement_system` | `text NOT NULL DEFAULT 'metric'`                                                      | Preferred measurement system for distances and other non-temperature units.                                                     |
| `currency_code`      | `char(3) REFERENCES currencies(code) ON DELETE SET NULL`                              | Default currency for new money records.                                                                                         |
| `contact_sort_order` | `text NOT NULL DEFAULT 'given_name_asc'`                                              | Default contact list sort.                                                                                                      |
| `contact_name_order` | `text NOT NULL DEFAULT 'given_family_nickname'`                                       | Default name display order.                                                                                                     |
| `fluid_layout`       | `boolean NOT NULL DEFAULT false`                                                      | Layout preference.                                                                                                              |
| `ui_state`           | `jsonb NOT NULL DEFAULT '{}'::jsonb`                                                  | Sparse presentation state such as active tabs and dismissed feature badges; never stores domain data.                           |
| `updated_at`         | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                             |
| `reminder_delivery`  | `text NOT NULL DEFAULT 'in_app'`                                                      | Channels for every reminder occurrence not yet sent, including those already scheduled: `in_app`, `email`, or `both`.           |
| `digest_time`        | `time`                                                                                | Local daily email digest time in the member timezone, or UTC when none; null sends each when due.                               |
| `workspace_id`       | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the workspace members row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `CHECK (temperature_scale IN ('celsius', 'fahrenheit'))`
- `CHECK (measurement_system IN ('metric', 'imperial'))`
- `CONSTRAINT member_preferences_reminder_delivery_ck CHECK (reminder_delivery IN ('in_app', 'email', 'both'))`
- `CONSTRAINT member_preferences_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE`

Added in v8 for `PLANNING-003`; the v12 comment reflects the current behavior.
The preference selects the channels of every occurrence not yet sent, including
those already scheduled: the worker moves each waiting occurrence (pending,
never attempted, not yet due) onto the member's current channels, while
occurrences already attempted, sent, or due keep their
`reminder_occurrences.channel`. A member without a verified email address
receives `in_app` occurrences whatever the preference. `email` occurrences reuse
the durable claim, attempt, provider idempotency, and reconciliation columns of
`reminder_occurrences`. With `digest_time` set, the member's due `email`
occurrences are sent together at the next local digest time, and each included
occurrence records the digest's receipt.

## Identity

### `users`

Global login identity. A user can belong to one or more workspaces through
workspace_members.

| Column                   | SQL definition                               | Purpose                                                                                                                   |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references.                                        |
| `email`                  | `citext NOT NULL UNIQUE`                     | Primary login email address.                                                                                              |
| `password_hash`          | `text`                                       | Password hash for local login. Null when only external identity providers are enabled.                                    |
| `first_name`             | `text NOT NULL DEFAULT ''`                   | User given name.                                                                                                          |
| `last_name`              | `text NOT NULL DEFAULT ''`                   | User family name.                                                                                                         |
| `status`                 | `text NOT NULL DEFAULT 'active'`             | Login account state: active, disabled, or deleted.                                                                        |
| `email_verified_at`      | `timestamptz`                                | When the primary email was verified.                                                                                      |
| `last_login_at`          | `timestamptz`                                | Last successful login timestamp.                                                                                          |
| `password_changed_at`    | `timestamptz`                                | Last password update timestamp.                                                                                           |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`         | Creation timestamp in UTC.                                                                                                |
| `updated_at`             | `timestamptz NOT NULL DEFAULT now()`         | Last update timestamp in UTC; maintained by application or trigger.                                                       |
| `deleted_at`             | `timestamptz`                                | Soft-delete/anonymization timestamp.                                                                                      |
| `pending_workspace_name` | `text`                                       | Workspace name a pending registration asked for, held until email verification provisions that workspace; null otherwise. |

**Table constraints**

- `CHECK (status IN ('active', 'disabled', 'deleted'))`
- `users_pending_workspace_name_ck`: `pending_workspace_name` is null, or equals
  its `btrim` and is 1 to 120 characters long.

**Indexes**

### `workspace_invitations`

Pending workspace invitations. Replaces Monica invitations.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace invite is for.                                                           |
| `invited_by_member_id` | `uuid`                                                      | Member who sent the invite.                                                        |
| `email`                | `citext NOT NULL`                                           | Invited email address.                                                             |
| `token_hash`           | `text NOT NULL`                                             | Hash of opaque acceptance token.                                                   |
| `role`                 | `text NOT NULL DEFAULT 'member'`                            | Role granted on acceptance.                                                        |
| `status`               | `text NOT NULL DEFAULT 'pending'`                           | pending, accepted, expired, revoked.                                               |
| `expires_at`           | `timestamptz`                                               | Expiration timestamp.                                                              |
| `accepted_at`          | `timestamptz`                                               | Acceptance timestamp.                                                              |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (role IN ('admin', 'member'))`
- `CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))`
- `CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)`
- `CONSTRAINT workspace_invitations_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id)`

**Indexes**

- `CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (workspace_id, email);`
- `CREATE UNIQUE INDEX workspace_invitations_token_idx ON workspace_invitations (token_hash);`

### `password_reset_requests`

Password reset requests/tokens. Runtime security table; not imported as active
data from Monica.

| Column         | SQL definition                                | Purpose                                                                            |
| -------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`  | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id`      | `uuid REFERENCES users(id) ON DELETE CASCADE` | User requesting reset, if known.                                                   |
| `email`        | `citext NOT NULL`                             | Email used for reset request.                                                      |
| `token_hash`   | `text NOT NULL`                               | Hash of reset token.                                                               |
| `requested_ip` | `inet`                                        | IP address that requested reset.                                                   |
| `expires_at`   | `timestamptz NOT NULL`                        | Token expiration.                                                                  |
| `used_at`      | `timestamptz`                                 | When token was used.                                                               |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`          | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE UNIQUE INDEX password_reset_token_idx ON password_reset_requests (token_hash);`
- `CREATE INDEX password_reset_email_idx ON password_reset_requests (email);`

### `email_verification_tokens`

Email verification tokens for users.

| Column       | SQL definition                                         | Purpose                                                                            |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `id`         | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`           | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id`    | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User verifying email.                                                              |
| `email`      | `citext NOT NULL`                                      | Email being verified.                                                              |
| `token_hash` | `text NOT NULL`                                        | Hash of verification token.                                                        |
| `expires_at` | `timestamptz NOT NULL`                                 | Token expiration.                                                                  |
| `used_at`    | `timestamptz`                                          | When token was used.                                                               |
| `created_at` | `timestamptz NOT NULL DEFAULT now()`                   | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE UNIQUE INDEX email_verification_token_idx ON email_verification_tokens (token_hash);`

### `user_mfa_totp`

TOTP MFA secrets. Replaces Monica users.google2fa_secret without mixing secrets
into users.

| Column             | SQL definition                                            | Purpose                                                             |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `user_id`          | `uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` | User with TOTP configured.                                          |
| `encrypted_secret` | `text NOT NULL`                                           | Encrypted TOTP secret.                                              |
| `confirmed_at`     | `timestamptz`                                             | When TOTP was confirmed.                                            |
| `last_used_at`     | `timestamptz`                                             | Last successful TOTP use.                                           |
| `created_at`       | `timestamptz NOT NULL DEFAULT now()`                      | Creation timestamp in UTC.                                          |
| `updated_at`       | `timestamptz NOT NULL DEFAULT now()`                      | Last update timestamp in UTC; maintained by application or trigger. |

### `user_recovery_codes`

Hashed MFA recovery codes. Replaces Monica recovery_codes.

| Column       | SQL definition                                         | Purpose                                                                            |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `id`         | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`           | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id`    | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the recovery code.                                                   |
| `code_hash`  | `text NOT NULL`                                        | Hash of recovery code.                                                             |
| `used_at`    | `timestamptz`                                          | When code was consumed.                                                            |
| `created_at` | `timestamptz NOT NULL DEFAULT now()`                   | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);`
- `CREATE UNIQUE INDEX user_recovery_codes_hash_idx ON user_recovery_codes (code_hash);`

### `webauthn_credentials`

FIDO2/WebAuthn credentials. Replaces Monica webauthn_keys; legacy U2F should be
re-registered rather than activated blindly.

| Column             | SQL definition                                         | Purpose                                                                            |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `id`               | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`           | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id`          | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the credential.                                                      |
| `name`             | `text NOT NULL DEFAULT 'key'`                          | User-visible key name.                                                             |
| `credential_id`    | `text NOT NULL`                                        | WebAuthn credential id.                                                            |
| `credential_type`  | `text NOT NULL`                                        | Credential type.                                                                   |
| `transports`       | `text[] NOT NULL DEFAULT '{}'::text[]`                 | Supported authenticator transports.                                                |
| `attestation_type` | `text`                                                 | Attestation type.                                                                  |
| `trust_path`       | `jsonb`                                                | Trust path information.                                                            |
| `aaguid`           | `text`                                                 | Authenticator AAGUID.                                                              |
| `public_key`       | `text NOT NULL`                                        | Credential public key.                                                             |
| `sign_count`       | `integer NOT NULL DEFAULT 0`                           | Signature counter.                                                                 |
| `last_used_at`     | `timestamptz`                                          | Last successful authentication.                                                    |
| `created_at`       | `timestamptz NOT NULL DEFAULT now()`                   | Creation timestamp in UTC.                                                         |
| `updated_at`       | `timestamptz NOT NULL DEFAULT now()`                   | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (credential_id)`
- `CHECK (sign_count >= 0)`

**Indexes**

- `CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials (user_id);`

### `user_sessions`

Stateful web sessions if the deployment uses DB-backed sessions. Replaces Monica
sessions without Laravel payload coupling.

| Column         | SQL definition                                | Purpose                                                                                                                        |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`  | Stable public primary key used by APIs, exports, imports, and internal references.                                             |
| `user_id`      | `uuid REFERENCES users(id) ON DELETE CASCADE` | Authenticated user.                                                                                                            |
| `session_hash` | `text NOT NULL`                               | Hash of session token/id.                                                                                                      |
| `purpose`      | `text NOT NULL`                               | Exact authority purpose: authenticated session, verified identity entry, revoked legacy authority, or a pending MFA challenge. |
| `ip_address`   | `inet`                                        | Client IP address.                                                                                                             |
| `user_agent`   | `text`                                        | Client user agent.                                                                                                             |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`          | Session creation timestamp.                                                                                                    |
| `last_seen_at` | `timestamptz NOT NULL DEFAULT now()`          | Last activity timestamp.                                                                                                       |
| `expires_at`   | `timestamptz NOT NULL`                        | Session expiration timestamp.                                                                                                  |
| `revoked_at`   | `timestamptz`                                 | Revocation timestamp.                                                                                                          |

**Table constraints**

- `CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy', 'mfa-challenge'))`
- `CHECK (purpose <> 'legacy' OR revoked_at IS NOT NULL)`

**Indexes**

- `CREATE UNIQUE INDEX user_sessions_hash_idx ON user_sessions (session_hash);`
- `CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);`

## Workspace configuration

### `gender_options`

Workspace-level gender vocabulary. Replaces Monica genders while allowing custom
labels.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this option.                                                   |
| `name`         | `text NOT NULL`                                             | Display label.                                                                     |
| `code`         | `text`                                                      | Optional short internal code, such as m, f, nb, or custom.                         |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `is_system`    | `boolean NOT NULL DEFAULT false`                            | Created from the app seed manifest rather than by a user.                          |
| `is_archived`  | `boolean NOT NULL DEFAULT false`                            | Hidden for new selection but kept for existing people.                             |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT gender_options_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX gender_options_workspace_idx ON gender_options (workspace_id);`
- `CREATE UNIQUE INDEX gender_options_workspace_name_unique ON gender_options (workspace_id, lower(name));`

### `workspace_settings`

Typed workspace defaults used when creating members, people, and reminder
schedules.

| Column                     | SQL definition                                                 | Purpose                                                             |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `workspace_id`             | `uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace these settings apply to.                                  |
| `default_locale`           | `text NOT NULL DEFAULT 'en'`                                   | Default locale for new members.                                     |
| `default_timezone`         | `text`                                                         | Default timezone for new members and scheduled workflows.           |
| `default_currency_code`    | `char(3) REFERENCES currencies(code) ON DELETE SET NULL`       | Default workspace currency.                                         |
| `default_gender_option_id` | `uuid`                                                         | Default gender option for new people, when desired.                 |
| `default_reminder_time`    | `time NOT NULL DEFAULT '12:00'`                                | Default local send time for reminder notifications.                 |
| `updated_at`               | `timestamptz NOT NULL DEFAULT now()`                           | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CONSTRAINT workspace_settings_default_gender_option_id_fkey FOREIGN KEY (workspace_id, default_gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (default_gender_option_id)`

### `workspace_profile_modules`

Profile-module toggles shown on person pages. Replaces Monica modules and
default_contact_modules.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this module toggle.                                            |
| `key`             | `text NOT NULL`                                             | Stable feature/module key.                                                         |
| `name`            | `text`                                                      | Display name if not translated by key.                                             |
| `translation_key` | `text`                                                      | I18n key for seeded modules.                                                       |
| `is_active`       | `boolean NOT NULL DEFAULT true`                             | Whether the module appears in the profile UI.                                      |
| `can_delete`      | `boolean NOT NULL DEFAULT false`                            | Whether a member can remove the module definition.                                 |
| `sort_order`      | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (workspace_id, key)`

**Indexes**

- `CREATE INDEX workspace_profile_modules_active_idx ON workspace_profile_modules (workspace_id, is_active);`

### `contact_method_types`

Workspace-defined contact method types: email, phone, URL, social profile,
instant messaging, or custom.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type.                                                     |
| `name`         | `text NOT NULL`                                             | Display name.                                                                      |
| `kind`         | `text NOT NULL DEFAULT 'custom'`                            | Broad kind: email, phone, url, social, im, username, or custom.                    |
| `icon`         | `text`                                                      | Icon name for UI display.                                                          |
| `protocol`     | `text`                                                      | URI protocol prefix such as mailto, tel, sms, https.                               |
| `is_system`    | `boolean NOT NULL DEFAULT false`                            | Seeded app type.                                                                   |
| `can_delete`   | `boolean NOT NULL DEFAULT true`                             | Whether this type can be deleted.                                                  |
| `is_archived`  | `boolean NOT NULL DEFAULT false`                            | Hidden for new use but retained for old methods.                                   |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (workspace_id, name)`
- `CONSTRAINT contact_method_types_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX contact_method_types_kind_idx ON contact_method_types (workspace_id, kind);`

### `contact_labels`

Reusable labels for contact methods and addresses. Replaces Monica
contact_field_labels and label pivots.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this label.                                                    |
| `label`           | `text`                                                      | Custom display label.                                                              |
| `translation_key` | `text`                                                      | Seeded translated label key.                                                       |
| `applies_to`      | `text NOT NULL DEFAULT 'any'`                               | Scope: any, contact_method, or address.                                            |
| `is_system`       | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (label IS NOT NULL OR translation_key IS NOT NULL)`
- `CHECK (applies_to IN ('any', 'contact_method', 'address'))`
- `CONSTRAINT contact_labels_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX contact_labels_workspace_idx ON contact_labels (workspace_id);`

### `activity_type_categories`

Workspace activity category vocabulary.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this category.                                                 |
| `name`            | `text`                                                      | Display name.                                                                      |
| `translation_key` | `text`                                                      | I18n key for seeded categories.                                                    |
| `is_system`       | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `sort_order`      | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT activity_type_categories_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX activity_type_categories_workspace_idx ON activity_type_categories (workspace_id);`

### `activity_types`

Workspace activity types used by multi-person interactions.

| Column              | SQL definition                                              | Purpose                                                                            |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`      | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type.                                                     |
| `category_id`       | `uuid`                                                      | Optional category.                                                                 |
| `name`              | `text`                                                      | Display name.                                                                      |
| `translation_key`   | `text`                                                      | I18n key for seeded types.                                                         |
| `location_behavior` | `text`                                                      | How this type handles location, matching Monica's location_type idea.              |
| `is_system`         | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `is_archived`       | `boolean NOT NULL DEFAULT false`                            | Hidden for new activities but retained for history.                                |
| `sort_order`        | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT activity_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES activity_type_categories (workspace_id, id) ON DELETE SET NULL (category_id)`
- `CONSTRAINT activity_types_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX activity_types_workspace_idx ON activity_types (workspace_id);`
- `CREATE INDEX activity_types_category_idx ON activity_types (category_id);`

### `emotion_options`

Global hierarchical emotion taxonomy shared by activity and call tagging.

| Column       | SQL definition                                          | Purpose                                                                            |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`         | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`            | Stable public primary key used by APIs, exports, imports, and internal references. |
| `parent_id`  | `uuid REFERENCES emotion_options(id) ON DELETE CASCADE` | Parent emotion in the hierarchy.                                                   |
| `name`       | `text NOT NULL`                                         | Emotion display name.                                                              |
| `is_active`  | `boolean NOT NULL DEFAULT true`                         | Whether the emotion remains selectable for new calls and activities.               |
| `sort_order` | `integer NOT NULL DEFAULT 0`                            | Display order.                                                                     |
| `created_at` | `timestamptz NOT NULL DEFAULT now()`                    | Creation timestamp in UTC.                                                         |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()`                    | Last update timestamp in UTC; maintained by application or trigger.                |

**Indexes**

- `CREATE INDEX emotion_options_parent_idx ON emotion_options (parent_id);`
- `CREATE INDEX emotion_options_active_idx ON emotion_options (is_active, sort_order);`

Seeded once in v13 with the 132 distinct Monica 4.x stock emotions, top-level
and active, `sort_order` holding the Monica id. A Monica import reuses a seeded
name instead of adding it, so no tenant's import changes the shared catalog.

### `life_event_categories`

Workspace life-event category vocabulary.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this category.                                                 |
| `name`         | `text NOT NULL`                                             | Display name.                                                                      |
| `seed_key`     | `text`                                                      | Stable seed key for default categories.                                            |
| `is_system`    | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT life_event_categories_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX life_event_categories_workspace_idx ON life_event_categories (workspace_id);`

### `life_event_types`

Workspace life-event type vocabulary with optional structured information
schema.

| Column               | SQL definition                                              | Purpose                                                                            |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                 | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`       | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type.                                                     |
| `category_id`        | `uuid`                                                      | Category containing this type.                                                     |
| `name`               | `text`                                                      | Display name.                                                                      |
| `seed_key`           | `text`                                                      | Stable seed key for default types.                                                 |
| `information_schema` | `jsonb`                                                     | JSON Schema or field description for type-specific information.                    |
| `is_system`          | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `is_archived`        | `boolean NOT NULL DEFAULT false`                            | Hidden for new events but retained for history.                                    |
| `sort_order`         | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`         | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`         | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT life_event_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES life_event_categories (workspace_id, id) ON DELETE SET NULL (category_id)`
- `CONSTRAINT life_event_types_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX life_event_types_workspace_idx ON life_event_types (workspace_id);`
- `CREATE INDEX life_event_types_category_idx ON life_event_types (category_id);`

### `relationship_type_groups`

Workspace relationship grouping vocabulary.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this group.                                                    |
| `name`         | `text NOT NULL`                                             | Display name.                                                                      |
| `is_system`    | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `can_delete`   | `boolean NOT NULL DEFAULT false`                            | Whether members can delete the group.                                              |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT relationship_type_groups_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX relationship_type_groups_workspace_idx ON relationship_type_groups (workspace_id);`

### `relationship_types`

Directional relationship labels with forward and reverse names.

| Column          | SQL definition                                              | Purpose                                                                            |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`            | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`  | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type.                                                     |
| `group_id`      | `uuid`                                                      | Group/category for this relationship type.                                         |
| `forward_label` | `text NOT NULL`                                             | Label when traversing from source person to target person.                         |
| `reverse_label` | `text NOT NULL`                                             | Label when traversing from target person back to source person.                    |
| `is_system`     | `boolean NOT NULL DEFAULT false`                            | Created from seed manifest.                                                        |
| `can_delete`    | `boolean NOT NULL DEFAULT false`                            | Whether members can delete the type.                                               |
| `is_archived`   | `boolean NOT NULL DEFAULT false`                            | Hidden for new relationships but retained for history.                             |
| `sort_order`    | `integer NOT NULL DEFAULT 0`                                | Display order.                                                                     |
| `created_at`    | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`    | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT relationship_types_group_id_fkey FOREIGN KEY (workspace_id, group_id) REFERENCES relationship_type_groups (workspace_id, id) ON DELETE SET NULL (group_id)`
- `CONSTRAINT relationship_types_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX relationship_types_workspace_idx ON relationship_types (workspace_id);`
- `CREATE INDEX relationship_types_group_idx ON relationship_types (group_id);`

### `pet_categories`

Global pet category catalog.

| Column       | SQL definition                               | Purpose                                                                            |
| ------------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`         | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `name`       | `text NOT NULL`                              | Pet category name.                                                                 |
| `is_common`  | `boolean NOT NULL DEFAULT false`             | Whether this category belongs to the common/default set shown prominently.         |
| `is_active`  | `boolean NOT NULL DEFAULT true`              | Whether this category is selectable for new pets.                                  |
| `sort_order` | `integer NOT NULL DEFAULT 0`                 | Display order.                                                                     |
| `created_at` | `timestamptz NOT NULL DEFAULT now()`         | Creation timestamp in UTC.                                                         |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()`         | Last update timestamp in UTC; maintained by application or trigger.                |

**Indexes**

- `CREATE UNIQUE INDEX pet_categories_name_unique ON pet_categories (lower(name));`
- `CREATE INDEX pet_categories_common_idx ON pet_categories (is_common, sort_order);`

Seeded once in v13 with the 11 Monica 4.x stock categories in Monica id order:
`reptile`, `bird`, `cat`, `dog`, `fish`, `hamster`, `horse`, `rabbit`, `rat`,
`small_animal`, and `other`; `cat`, `dog`, and `fish` are common.

## People

### `people`

Core person/contact profile. Lifecycle is represented by partial, archived,
deceased, and deleted fields rather than a second status column.

| Column                  | SQL definition                                                                                                                                      | Purpose                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                    | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                                                                                        | Stable public primary key used by APIs, exports, imports, and internal references.                 |
| `workspace_id`          | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`                                                                                         | Workspace that owns this person.                                                                   |
| `created_by_member_id`  | `uuid`                                                                                                                                              | Member that created the person, when known.                                                        |
| `gender_option_id`      | `uuid`                                                                                                                                              | Selected workspace gender option.                                                                  |
| `given_name`            | `text NOT NULL DEFAULT ''`                                                                                                                          | Given/first name.                                                                                  |
| `middle_name`           | `text`                                                                                                                                              | Middle name.                                                                                       |
| `family_name`           | `text`                                                                                                                                              | Family/last name.                                                                                  |
| `nickname`              | `text`                                                                                                                                              | Nickname shown with formal names.                                                                  |
| `description`           | `text`                                                                                                                                              | Short profile description or bio.                                                                  |
| `food_preferences`      | `text`                                                                                                                                              | Food, allergy, and dietary preferences.                                                            |
| `is_partial`            | `boolean NOT NULL DEFAULT false`                                                                                                                    | Incomplete/imported contact flag.                                                                  |
| `is_starred`            | `boolean NOT NULL DEFAULT false`                                                                                                                    | Favorite/star flag.                                                                                |
| `is_deceased`           | `boolean NOT NULL DEFAULT false`                                                                                                                    | Whether this person is known to be deceased.                                                       |
| `archived_at`           | `timestamptz`                                                                                                                                       | When the person was archived.                                                                      |
| `created_at`            | `timestamptz NOT NULL DEFAULT now()`                                                                                                                | Creation timestamp in UTC.                                                                         |
| `updated_at`            | `timestamptz NOT NULL DEFAULT now()`                                                                                                                | Last update timestamp in UTC; maintained by application or trigger.                                |
| `deleted_at`            | `timestamptz`                                                                                                                                       | Soft-delete timestamp. Deleted people are hidden by default.                                       |
| `sort_given_name`       | `text GENERATED ALWAYS AS (lower(COALESCE(NULLIF(btrim(given_name), ''), NULLIF(btrim(nickname), ''), NULLIF(btrim(family_name), ''), ''))) STORED` | Directory given-name sort key (v14), stored so the order seeks its index under row-level security. |
| `sort_family_name`      | `text GENERATED ALWAYS AS (lower(COALESCE(family_name, ''))) STORED`                                                                                | Directory given-name sort tie-breaker (v14).                                                       |
| `duplicate_given_name`  | `text GENERATED ALWAYS AS (lower(btrim(given_name))) STORED`                                                                                        | Duplicate-name check key (v14).                                                                    |
| `duplicate_family_name` | `text GENERATED ALWAYS AS (lower(btrim(COALESCE(family_name, '')))) STORED`                                                                         | Duplicate-name check key (v14).                                                                    |
| `duplicate_nickname`    | `text GENERATED ALWAYS AS (lower(btrim(COALESCE(nickname, '')))) STORED`                                                                            | Duplicate-name check key (v14).                                                                    |

**Table constraints**

- `CONSTRAINT people_workspace_id_id_key UNIQUE (workspace_id, id)` — added in
- `CONSTRAINT people_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT people_gender_option_id_fkey FOREIGN KEY (workspace_id, gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (gender_option_id)`
  v9 as the target of workspace-enforcing composite foreign keys.

**Indexes**

- `CREATE INDEX people_starred_idx ON people (workspace_id, is_starred);`
- `CREATE INDEX people_active_given_name_idx ON people (workspace_id, sort_given_name, sort_family_name, id) WHERE archived_at IS NULL AND deleted_at IS NULL;`
- `CREATE INDEX people_active_duplicate_name_idx ON people (workspace_id, duplicate_given_name, duplicate_family_name, duplicate_nickname) WHERE archived_at IS NULL AND deleted_at IS NULL;`

The directory's default order and its keyset continuation use exactly the
expressions of `people_active_given_name_idx`; the duplicate-name check on
create uses exactly those of `people_active_duplicate_name_idx`.

### `person_avatars`

Current avatar presentation for a person; provider-specific legacy payload
remains only in redacted import staging.

| Column             | SQL definition                                                                        | Purpose                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `person_id`        | `uuid PRIMARY KEY`                                                                    | Person whose avatar is configured.                                                                                   |
| `source`           | `text NOT NULL DEFAULT 'default'`                                                     | default, file, external, gravatar, or generated.                                                                     |
| `file_id`          | `uuid`                                                                                | Uploaded/generated file if source=file.                                                                              |
| `external_url`     | `text`                                                                                | External avatar URL, including imported Gravatar/Adorable URLs.                                                      |
| `background_color` | `text`                                                                                | Generated default avatar background color.                                                                           |
| `initials`         | `text`                                                                                | Generated initials, when precomputed.                                                                                |
| `updated_at`       | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id`     | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CHECK (source IN ('default', 'file', 'external', 'gravatar', 'generated'))`
- `CONSTRAINT person_avatars_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id)`
- `CONSTRAINT person_avatars_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

### `person_dates`

Important person dates with explicit precision. Replaces Monica special_dates
and date pointers on contacts.

| Column                | SQL definition                                                                        | Purpose                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`           | `uuid NOT NULL`                                                                       | Person this date belongs to.                                                                                         |
| `kind`                | `text NOT NULL`                                                                       | birthday, deceased, first_met, anniversary, custom, or another app-defined kind.                                     |
| `label`               | `text`                                                                                | Custom label for non-core dates.                                                                                     |
| `year`                | `smallint`                                                                            | Year component; null means intentionally unknown.                                                                    |
| `month`               | `smallint`                                                                            | Month component; null means intentionally unknown.                                                                   |
| `day`                 | `smallint`                                                                            | Day component; null means intentionally unknown.                                                                     |
| `precision`           | `text NOT NULL DEFAULT 'full'`                                                        | Known-part precision: full, year_month, month_day, year, month, day, or unknown.                                     |
| `is_year_approximate` | `boolean NOT NULL DEFAULT false`                                                      | Whether the stated year is approximate; false does not imply that an unknown year exists.                            |
| `is_age_based`        | `boolean NOT NULL DEFAULT false`                                                      | Whether age should be computed/displayed when year is known.                                                         |
| `notes`               | `text`                                                                                | Additional notes about the date.                                                                                     |
| `created_at`          | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`          | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id`        | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CHECK (month IS NULL OR month BETWEEN 1 AND 12)`
- `CHECK (day IS NULL OR day BETWEEN 1 AND 31)`
- `CHECK (year IS NULL OR year BETWEEN 1 AND 9999)`
- `CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown'))`
- `CONSTRAINT person_dates_is_year_approximate_ck CHECK (NOT is_year_approximate OR year IS NOT NULL)`
- `CHECK ( (precision = 'full' AND year IS NOT NULL AND month IS NOT NULL AND day IS NOT NULL) OR (precision = 'year_month' AND year IS NOT NULL AND month IS NOT NULL AND day IS NULL) OR (precision = 'month_day' AND year IS NULL AND month IS NOT NULL AND day IS NOT NULL) OR (precision = 'year' AND year IS NOT NULL AND month IS NULL AND day IS NULL) OR (precision = 'month' AND year IS NULL AND month IS NOT NULL AND day IS NULL) OR (precision = 'day' AND year IS NULL AND month IS NULL AND day IS NOT NULL) OR (precision = 'unknown' AND year IS NULL AND month IS NULL AND day IS NULL) )`
- `CONSTRAINT person_dates_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_dates_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX person_dates_person_kind_idx ON person_dates (person_id, kind);`
- `CREATE INDEX person_dates_month_day_idx ON person_dates (month, day) WHERE month IS NOT NULL AND day IS NOT NULL;`
- `CREATE UNIQUE INDEX person_dates_singleton_kind_unique ON person_dates (person_id, kind) WHERE kind IN ('birthday', 'deceased', 'first_met');`

### `person_first_meetings`

First-met context separated from the person row. Replaces
contacts.first_met_where/additional_info/through_contact.

| Column                    | SQL definition                                                                        | Purpose                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `person_id`               | `uuid PRIMARY KEY`                                                                    | Person this first-meeting context describes.                                                                                 |
| `introduced_by_person_id` | `uuid`                                                                                | Person through whom this person was introduced.                                                                              |
| `location_id`             | `uuid`                                                                                | Structured location where the first meeting happened, if known; the date itself is the person_dates row with kind=first_met. |
| `place_text`              | `text`                                                                                | Free-text place/context where the member first met the person.                                                               |
| `notes`                   | `text`                                                                                | Additional first-met narrative.                                                                                              |
| `updated_at`              | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                          |
| `workspace_id`            | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14).         |

**Table constraints**

- `CHECK (introduced_by_person_id IS NULL OR introduced_by_person_id <> person_id)`
- `CONSTRAINT person_first_meetings_introduced_by_person_id_fkey FOREIGN KEY (workspace_id, introduced_by_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (introduced_by_person_id)`
- `CONSTRAINT person_first_meetings_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Deferred foreign keys**

- `ALTER TABLE person_first_meetings
  ADD CONSTRAINT person_first_meetings_location_fk
  FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL;`

### `person_contact_methods`

Typed contact values such as email, phone, social profile, URL, and custom
identifiers.

| Column             | SQL definition                                                                        | Purpose                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`               | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`        | `uuid NOT NULL`                                                                       | Person this value belongs to.                                                                                        |
| `type_id`          | `uuid NOT NULL`                                                                       | Workspace contact-method type.                                                                                       |
| `value`            | `text NOT NULL`                                                                       | Raw user-entered value.                                                                                              |
| `normalized_value` | `text`                                                                                | Normalized email/phone/URL for searching and deduplication.                                                          |
| `is_primary`       | `boolean NOT NULL DEFAULT false`                                                      | Whether this is the primary value for its type/kind.                                                                 |
| `sort_order`       | `integer NOT NULL DEFAULT 0`                                                          | Display order.                                                                                                       |
| `notes`            | `text`                                                                                | Optional notes about the value.                                                                                      |
| `created_at`       | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`       | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id`     | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CONSTRAINT person_contact_methods_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_contact_methods_type_id_fkey FOREIGN KEY (workspace_id, type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE RESTRICT`
- `CONSTRAINT person_contact_methods_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX person_contact_methods_person_idx ON person_contact_methods (person_id);`
- `CREATE INDEX person_contact_methods_type_idx ON person_contact_methods (type_id);`
- `CREATE UNIQUE INDEX person_contact_methods_primary_per_type_unique ON person_contact_methods (person_id, type_id) WHERE is_primary;`

### `person_contact_method_labels`

Many-to-many labels for contact methods, preserving Monica's label pivot without
forcing a single label.

| Column              | SQL definition                                                                        | Purpose                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `contact_method_id` | `uuid NOT NULL`                                                                       | Contact method being labeled.                                                                                                        |
| `label_id`          | `uuid NOT NULL`                                                                       | Label assigned to the contact method.                                                                                                |
| `created_at`        | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                           |
| `workspace_id`      | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the person contact methods row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `PRIMARY KEY (contact_method_id, label_id)`
- `CONSTRAINT person_contact_method_labels_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_contact_method_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX person_contact_method_labels_label_idx ON person_contact_method_labels (label_id);`

### `locations`

Structured postal/geographical place data. Replaces Monica places and is also
used by weather/geocoding adapters.

| Column         | SQL definition                                              | Purpose                                                                                                         |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.                              |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this location.                                                                              |
| `label`        | `text`                                                      | Optional display label for the location.                                                                        |
| `street`       | `text`                                                      | Street address line.                                                                                            |
| `city`         | `text`                                                      | City/locality.                                                                                                  |
| `region`       | `text`                                                      | Province/state/region.                                                                                          |
| `postal_code`  | `text`                                                      | Postal or ZIP code.                                                                                             |
| `country`      | `text`                                                      | Country name or code as entered/normalized by the application; not restricted to an import-specific code width. |
| `latitude`     | `double precision`                                          | Latitude coordinate.                                                                                            |
| `longitude`    | `double precision`                                          | Longitude coordinate.                                                                                           |
| `geocoded_at`  | `timestamptz`                                               | When coordinates were last geocoded.                                                                            |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                                      |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                                             |

**Table constraints**

- `CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)`
- `CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)`
- `CONSTRAINT locations_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX locations_workspace_idx ON locations (workspace_id);`
- `CREATE INDEX locations_geo_idx ON locations (workspace_id, latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;`

### `person_addresses`

Address links between people and locations. Replaces Monica addresses.

| Column         | SQL definition                                                                        | Purpose                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`    | `uuid NOT NULL`                                                                       | Person this address belongs to.                                                                                      |
| `location_id`  | `uuid`                                                                                | Structured location details.                                                                                         |
| `display_name` | `text`                                                                                | Address display name, such as Home or Office.                                                                        |
| `is_primary`   | `boolean NOT NULL DEFAULT false`                                                      | Whether this is the primary address.                                                                                 |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                                          | Display order.                                                                                                       |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CONSTRAINT person_addresses_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL (location_id)`
- `CONSTRAINT person_addresses_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_addresses_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX person_addresses_person_idx ON person_addresses (person_id);`
- `CREATE INDEX person_addresses_location_idx ON person_addresses (location_id);`
- `CREATE UNIQUE INDEX person_addresses_primary_unique ON person_addresses (person_id) WHERE is_primary;`

### `person_address_labels`

Many-to-many labels for addresses.

| Column         | SQL definition                                                                        | Purpose                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `address_id`   | `uuid NOT NULL`                                                                       | Address being labeled.                                                                                                         |
| `label_id`     | `uuid NOT NULL`                                                                       | Label assigned to the address.                                                                                                 |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                     |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the person addresses row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `PRIMARY KEY (address_id, label_id)`
- `CONSTRAINT person_address_labels_address_id_fkey FOREIGN KEY (workspace_id, address_id) REFERENCES person_addresses (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_address_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX person_address_labels_label_idx ON person_address_labels (label_id);`

### `organizations`

Workspace organizations/employers. Replaces Monica companies.

| Column           | SQL definition                                              | Purpose                                                                            |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`             | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`   | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this organization.                                             |
| `name`           | `text NOT NULL`                                             | Organization/company name.                                                         |
| `website`        | `text`                                                      | Organization website.                                                              |
| `employee_count` | `integer`                                                   | Approximate number of employees.                                                   |
| `notes`          | `text`                                                      | Optional organization notes.                                                       |
| `created_at`     | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`     | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT organizations_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX organizations_workspace_idx ON organizations (workspace_id);`
- `CREATE UNIQUE INDEX organizations_workspace_name_unique ON organizations (workspace_id, lower(name));`

### `person_occupations`

Employment history and current work records. Replaces Monica occupations plus
legacy contacts.company/job.

| Column                 | SQL definition                                                                        | Purpose                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`            | `uuid NOT NULL`                                                                       | Person with this occupation.                                                                                         |
| `organization_id`      | `uuid`                                                                                | Employer/organization.                                                                                               |
| `title`                | `text NOT NULL`                                                                       | Job title or role.                                                                                                   |
| `description`          | `text`                                                                                | Role description.                                                                                                    |
| `salary_amount`        | `numeric(19,4)`                                                                       | Optional salary amount.                                                                                              |
| `salary_currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL`                              | Salary currency, if salary is stored.                                                                                |
| `salary_unit`          | `text`                                                                                | Salary cadence/unit such as year, month, hour.                                                                       |
| `is_current`           | `boolean NOT NULL DEFAULT false`                                                      | Whether the person currently works here.                                                                             |
| `start_on`             | `date`                                                                                | Occupation start date.                                                                                               |
| `end_on`               | `date`                                                                                | Occupation end date.                                                                                                 |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id`         | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CHECK (salary_amount IS NULL OR salary_amount >= 0)`
- `CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)`
- `CONSTRAINT person_occupations_organization_id_fkey FOREIGN KEY (workspace_id, organization_id) REFERENCES organizations (workspace_id, id) ON DELETE SET NULL (organization_id)`
- `CONSTRAINT person_occupations_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX person_occupations_person_idx ON person_occupations (person_id);`
- `CREATE INDEX person_occupations_org_idx ON person_occupations (organization_id);`

### `tags`

Workspace tags for grouping people. Replaces Monica tags.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this tag.                                                      |
| `name`         | `text NOT NULL`                                             | Tag display name.                                                                  |
| `slug`         | `text NOT NULL`                                             | Stable slug generated from the tag name.                                           |
| `description`  | `text`                                                      | Tag description.                                                                   |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (workspace_id, slug)`
- `CONSTRAINT tags_workspace_id_id_key UNIQUE (workspace_id, id)`

### `person_tags`

Many-to-many link between people and tags. Replaces Monica contact_tag.

| Column         | SQL definition                                                                        | Purpose                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `person_id`    | `uuid NOT NULL`                                                                       | Tagged person.                                                                                                       |
| `tag_id`       | `uuid NOT NULL`                                                                       | Assigned tag.                                                                                                        |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `PRIMARY KEY (person_id, tag_id)`
- `CONSTRAINT person_tags_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_tags_tag_id_fkey FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX person_tags_tag_idx ON person_tags (tag_id);`

### `pets`

Pets associated with a person. Replaces Monica pets.

| Column         | SQL definition                                                                        | Purpose                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`    | `uuid NOT NULL`                                                                       | Person associated with the pet.                                                                                      |
| `category_id`  | `uuid REFERENCES pet_categories(id) ON DELETE SET NULL`                               | Pet category.                                                                                                        |
| `name`         | `text`                                                                                | Pet name.                                                                                                            |
| `notes`        | `text`                                                                                | Optional pet notes.                                                                                                  |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `CONSTRAINT pets_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX pets_person_idx ON pets (person_id);`
- `CREATE INDEX pets_category_idx ON pets (category_id);`

### `person_duplicate_dismissals`

Added in v9 for `PEOPLE-008`. A member's decision that two people are not
duplicates, shared by every member of the workspace, so the directory's
possible-duplicates review stops offering that pair. Each unordered pair is
stored once, lower person id first. Unlike the other person links, the row
repeats `workspace_id`: the two composite foreign keys to
`people (workspace_id, id)` make the database itself reject a pair that spans
workspaces. Hard-deleting either person removes the decision; a merge rewrites
the duplicate's decisions onto the primary.

| Column                   | SQL definition                                              | Purpose                                                                      |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `workspace_id`           | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns the decision and both people.                            |
| `person_low_id`          | `uuid NOT NULL`                                             | The pair member with the lower id; same workspace by composite foreign key.  |
| `person_high_id`         | `uuid NOT NULL`                                             | The pair member with the higher id; same workspace by composite foreign key. |
| `dismissed_by_member_id` | `uuid`                                                      | Member who marked the pair as not duplicates, when still known.              |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`                        | When the pair was dismissed, in UTC.                                         |

**Table constraints**

- `PRIMARY KEY (workspace_id, person_low_id, person_high_id)`
- `CONSTRAINT person_duplicate_dismissals_order_ck CHECK (person_low_id < person_high_id)`
- `CONSTRAINT person_duplicate_dismissals_low_person_fk FOREIGN KEY (workspace_id, person_low_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_duplicate_dismissals_high_person_fk FOREIGN KEY (workspace_id, person_high_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_duplicate_dismissals_dismissed_by_member_id_fkey FOREIGN KEY (workspace_id, dismissed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (dismissed_by_member_id)`

**Indexes**

- `CREATE INDEX person_duplicate_dismissals_high_idx ON person_duplicate_dismissals (workspace_id, person_high_id);`

## Files

### `files`

Unified file metadata for photos, documents, avatars, exports, and import
artifacts. File bytes live in object storage.

| Column                  | SQL definition                                              | Purpose                                                                            |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                    | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`          | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns the file and its storage lifecycle.                            |
| `uploaded_by_member_id` | `uuid`                                                      | Member who uploaded or generated the file.                                         |
| `original_filename`     | `text`                                                      | Original client filename.                                                          |
| `storage_provider`      | `text NOT NULL DEFAULT 'local'`                             | Storage provider/disk such as local, s3, or gcs.                                   |
| `storage_bucket`        | `text`                                                      | Bucket/container name if applicable.                                               |
| `storage_key`           | `text`                                                      | Object-storage key or path.                                                        |
| `byte_size`             | `bigint`                                                    | File size in bytes.                                                                |
| `mime_type`             | `text`                                                      | MIME type.                                                                         |
| `checksum_sha256`       | `text`                                                      | SHA-256 checksum when available.                                                   |
| `status`                | `text NOT NULL DEFAULT 'available'`                         | available, missing, deleted, processing, or quarantined.                           |
| `visibility`            | `text NOT NULL DEFAULT 'private'`                           | private, workspace, or public.                                                     |
| `metadata`              | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Non-domain file metadata such as image dimensions.                                 |
| `created_at`            | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`            | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |
| `deleted_at`            | `timestamptz`                                               | Soft-delete timestamp for file metadata.                                           |

**Table constraints**

- `CHECK (byte_size IS NULL OR byte_size >= 0)`
- `CHECK (status IN ('available', 'missing', 'deleted', 'processing', 'quarantined'))`
- `CHECK (visibility IN ('private', 'workspace', 'public'))`
- `CONSTRAINT files_uploaded_by_member_id_fkey FOREIGN KEY (workspace_id, uploaded_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (uploaded_by_member_id)`

**Indexes**

- `CREATE INDEX files_workspace_idx ON files (workspace_id);`
- `CREATE INDEX files_storage_key_idx ON files (storage_provider, storage_bucket, storage_key);`
- `CREATE INDEX files_status_idx ON files (workspace_id, status);`

### `person_file_links`

Links files to people as photos, documents, or other person-owned attachments.
Replaces photos, contact_photo, and documents.

| Column           | SQL definition                                                                        | Purpose                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`      | `uuid NOT NULL`                                                                       | Person the file belongs to.                                                                                          |
| `file_id`        | `uuid NOT NULL`                                                                       | Linked file metadata.                                                                                                |
| `kind`           | `text NOT NULL`                                                                       | photo, document, avatar_candidate, or other app-defined kind.                                                        |
| `title`          | `text`                                                                                | Attachment title.                                                                                                    |
| `description`    | `text`                                                                                | Attachment description.                                                                                              |
| `document_type`  | `text`                                                                                | Optional document classification.                                                                                    |
| `download_count` | `integer NOT NULL DEFAULT 0`                                                          | Download counter for document links.                                                                                 |
| `sort_order`     | `integer NOT NULL DEFAULT 0`                                                          | Display order.                                                                                                       |
| `created_at`     | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`     | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `workspace_id`   | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `UNIQUE (person_id, file_id, kind)`
- `CONSTRAINT person_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT person_file_links_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX person_file_links_file_idx ON person_file_links (file_id);`

### `gift_file_links`

Links files to gifts, especially gift photos. Replaces Monica gift_photo.

| Column         | SQL definition                                                                        | Purpose                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `gift_id`      | `uuid NOT NULL`                                                                       | Gift.                                                                                                               |
| `file_id`      | `uuid NOT NULL`                                                                       | Linked file.                                                                                                        |
| `role`         | `text NOT NULL DEFAULT 'photo'`                                                       | Role of file for the gift.                                                                                          |
| `sort_order`   | `integer NOT NULL DEFAULT 0`                                                          | Display order.                                                                                                      |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                          |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the gifts row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `PRIMARY KEY (gift_id, file_id)`
- `CONSTRAINT gift_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT gift_file_links_gift_id_fkey FOREIGN KEY (workspace_id, gift_id) REFERENCES gifts (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX gift_file_links_file_idx ON gift_file_links (file_id);`

## Interactions

### `activities`

Multi-person interactions/events. Replaces Monica activities without
denormalized contact counters.

| Column                 | SQL definition                                              | Purpose                                                                                  |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.       |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this activity.                                                       |
| `activity_type_id`     | `uuid`                                                      | Activity type.                                                                           |
| `summary`              | `text NOT NULL`                                             | Short activity summary.                                                                  |
| `description`          | `text`                                                      | Detailed activity description.                                                           |
| `happened_at`          | `timestamptz NOT NULL`                                      | When the activity occurred; timestamp precision avoids losing Monica happened_at values. |
| `created_by_member_id` | `uuid`                                                      | Member who created the activity.                                                         |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                               |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                      |

**Table constraints**

- `CONSTRAINT activities_activity_type_id_fkey FOREIGN KEY (workspace_id, activity_type_id) REFERENCES activity_types (workspace_id, id) ON DELETE SET NULL (activity_type_id)`
- `CONSTRAINT activities_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT activities_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX activities_type_idx ON activities (activity_type_id);`
- `CREATE INDEX activities_workspace_time_idx ON activities (workspace_id, happened_at DESC);`
- `CREATE INDEX activities_search_idx ON activities USING gin (to_tsvector('simple', summary || ' ' || coalesce(description, '')));`

### `activity_participants`

People participating in an activity. Replaces Monica activity_contact.

| Column         | SQL definition                                                                        | Purpose                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `activity_id`  | `uuid NOT NULL`                                                                       | Activity.                                                                                                                |
| `person_id`    | `uuid NOT NULL`                                                                       | Participating person.                                                                                                    |
| `role`         | `text`                                                                                | Optional participant role.                                                                                               |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                               |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the activities row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `PRIMARY KEY (activity_id, person_id)`
- `CONSTRAINT activity_participants_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT activity_participants_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX activity_participants_person_idx ON activity_participants (person_id);`

### `activity_emotions`

Emotion tags attached to activities. Replaces Monica emotion_activity.

| Column         | SQL definition                                                                        | Purpose                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `activity_id`  | `uuid NOT NULL`                                                                       | Activity.                                                                                                                |
| `emotion_id`   | `uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT`                     | Selected emotion.                                                                                                        |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                               |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the activities row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `PRIMARY KEY (activity_id, emotion_id)`
- `CONSTRAINT activity_emotions_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX activity_emotions_emotion_idx ON activity_emotions (emotion_id);`

### `notes`

Free-form notes attached to people. Replaces Monica notes.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this note.                                                     |
| `person_id`            | `uuid NOT NULL`                                             | Person this note belongs to.                                                       |
| `body`                 | `text NOT NULL`                                             | Note body.                                                                         |
| `is_favorited`         | `boolean NOT NULL DEFAULT false`                            | Favorite note flag.                                                                |
| `favorited_at`         | `timestamptz`                                               | When the note was marked favorite.                                                 |
| `created_by_member_id` | `uuid`                                                      | Member who created the note.                                                       |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK ((is_favorited AND favorited_at IS NOT NULL) OR (NOT is_favorited))`
- `CONSTRAINT notes_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT notes_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX notes_person_idx ON notes (person_id, created_at DESC);`
- `CREATE INDEX notes_favorite_idx ON notes (workspace_id, is_favorited);`
- `CREATE INDEX notes_search_idx ON notes USING gin (to_tsvector('simple', body));`
- `CREATE INDEX notes_workspace_created_idx ON notes (workspace_id, created_at DESC, id DESC);`

## Communications

### `calls`

Logged calls with a person. Replaces Monica calls.

| Column                 | SQL definition                                              | Purpose                                                                                                                    |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.                                         |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this call.                                                                                             |
| `person_id`            | `uuid NOT NULL`                                             | Person involved in the call.                                                                                               |
| `called_at`            | `timestamptz NOT NULL`                                      | When the call happened.                                                                                                    |
| `contact_was_caller`   | `boolean NOT NULL DEFAULT false`                            | Whether the person/contact was recorded as the caller; application views may derive labels without guessing during import. |
| `content`              | `text`                                                      | Call notes/content.                                                                                                        |
| `created_by_member_id` | `uuid`                                                      | Member who logged the call.                                                                                                |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                                                 |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                                                        |

**Table constraints**

- `CONSTRAINT calls_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT calls_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT calls_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX calls_person_date_idx ON calls (person_id, called_at DESC);`
- `CREATE INDEX calls_workspace_date_idx ON calls (workspace_id, called_at DESC);`

### `call_emotions`

Emotion tags attached to calls. Replaces Monica emotion_call.

| Column         | SQL definition                                                                        | Purpose                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `call_id`      | `uuid NOT NULL`                                                                       | Call.                                                                                                               |
| `emotion_id`   | `uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT`                     | Selected emotion.                                                                                                   |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                          |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the calls row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `PRIMARY KEY (call_id, emotion_id)`
- `CONSTRAINT call_emotions_call_id_fkey FOREIGN KEY (workspace_id, call_id) REFERENCES calls (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX call_emotions_emotion_idx ON call_emotions (emotion_id);`

### `conversation_threads`

Messaging/conversation thread with a person. Replaces Monica conversations.

| Column              | SQL definition                                              | Purpose                                                                            |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`      | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this conversation.                                             |
| `person_id`         | `uuid NOT NULL`                                             | Person this conversation is with.                                                  |
| `channel_type_id`   | `uuid`                                                      | Channel type such as email, SMS, or social.                                        |
| `contact_method_id` | `uuid`                                                      | Specific contact method used, if known.                                            |
| `happened_at`       | `timestamptz NOT NULL`                                      | Conversation start or representative date.                                         |
| `title`             | `text`                                                      | Optional thread title.                                                             |
| `created_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT conversation_threads_channel_type_id_fkey FOREIGN KEY (workspace_id, channel_type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE SET NULL (channel_type_id)`
- `CONSTRAINT conversation_threads_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE SET NULL (contact_method_id)`
- `CONSTRAINT conversation_threads_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT conversation_threads_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX conversation_threads_person_idx ON conversation_threads (person_id, happened_at DESC);`
- `CREATE INDEX conversation_threads_workspace_idx ON conversation_threads (workspace_id, happened_at DESC);`

### `messages`

Individual messages inside a conversation. Replaces Monica messages.

| Column             | SQL definition                                                                        | Purpose                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                                 |
| `conversation_id`  | `uuid NOT NULL`                                                                       | Thread containing the message.                                                                                                     |
| `content`          | `text NOT NULL`                                                                       | Message body.                                                                                                                      |
| `written_at`       | `timestamptz NOT NULL`                                                                | When the message was written.                                                                                                      |
| `direction`        | `text NOT NULL`                                                                       | inbound or outbound.                                                                                                               |
| `author_member_id` | `uuid`                                                                                | Member author for outbound messages, if known.                                                                                     |
| `created_at`       | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                         |
| `updated_at`       | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                                |
| `workspace_id`     | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the conversation threads row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CHECK (direction IN ('inbound', 'outbound'))`
- `CONSTRAINT messages_author_member_id_fkey FOREIGN KEY (workspace_id, author_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (author_member_id)`
- `CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation_threads (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX messages_conversation_idx ON messages (conversation_id, written_at);`

## Journal

### `journal_posts`

Manual journal entries. Replaces Monica entries with the journal date kept on
the row.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this post.                                                     |
| `title`                | `text`                                                      | Journal title.                                                                     |
| `body`                 | `text NOT NULL`                                             | Journal post body.                                                                 |
| `occurred_at`          | `timestamptz NOT NULL DEFAULT now()`                        | Journal/timeline date.                                                             |
| `created_by_member_id` | `uuid`                                                      | Member who wrote the post.                                                         |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT journal_posts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT journal_posts_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX journal_posts_workspace_date_idx ON journal_posts (workspace_id, occurred_at DESC);`
- `CREATE INDEX journal_posts_search_idx ON journal_posts USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || body));`

### `journal_day_ratings`

Daily mood/rating records. Replaces Monica days.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this day rating.                                               |
| `rated_on`             | `date NOT NULL`                                             | Calendar day being rated.                                                          |
| `rating`               | `integer NOT NULL`                                          | User's daily rating.                                                               |
| `comment`              | `text`                                                      | Optional comment.                                                                  |
| `created_by_member_id` | `uuid`                                                      | Member who created the rating.                                                     |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (workspace_id, rated_on)`
- `CONSTRAINT journal_day_ratings_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT journal_day_ratings_workspace_id_id_key UNIQUE (workspace_id, id)`

### `journal_items`

Typed journal/timeline index. Replaces Monica polymorphic journal_entries with
explicit nullable foreign keys.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this journal item.                                             |
| `occurred_at`          | `timestamptz NOT NULL`                                      | Timeline date/time.                                                                |
| `activity_id`          | `uuid`                                                      | Activity represented in the journal.                                               |
| `journal_post_id`      | `uuid`                                                      | Journal post represented in the journal.                                           |
| `day_rating_id`        | `uuid`                                                      | Day rating represented in the journal.                                             |
| `created_by_member_id` | `uuid`                                                      | Member who created the journal item.                                               |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (((activity_id IS NOT NULL)::int + (journal_post_id IS NOT NULL)::int + (day_rating_id IS NOT NULL)::int) = 1)`
- `CONSTRAINT journal_items_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT journal_items_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT journal_items_day_rating_id_fkey FOREIGN KEY (workspace_id, day_rating_id) REFERENCES journal_day_ratings (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT journal_items_journal_post_id_fkey FOREIGN KEY (workspace_id, journal_post_id) REFERENCES journal_posts (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX journal_items_workspace_date_idx ON journal_items (workspace_id, occurred_at DESC);`
- `CREATE UNIQUE INDEX journal_items_activity_unique ON journal_items (activity_id) WHERE activity_id IS NOT NULL;`
- `CREATE UNIQUE INDEX journal_items_post_unique ON journal_items (journal_post_id) WHERE journal_post_id IS NOT NULL;`
- `CREATE UNIQUE INDEX journal_items_day_rating_unique ON journal_items (day_rating_id) WHERE day_rating_id IS NOT NULL;`

## Life events

### `life_events`

Typed milestones for a person with precision-aware dates. Replaces Monica
life_events.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this event.                                                    |
| `person_id`            | `uuid NOT NULL`                                             | Person this life event belongs to.                                                 |
| `life_event_type_id`   | `uuid`                                                      | Life-event type.                                                                   |
| `name`                 | `text`                                                      | Event display name.                                                                |
| `note`                 | `text`                                                      | Event notes.                                                                       |
| `year`                 | `smallint`                                                  | Year component; null means unknown.                                                |
| `month`                | `smallint`                                                  | Month component; null means unknown.                                               |
| `day`                  | `smallint`                                                  | Day component; null means unknown.                                                 |
| `happened_at`          | `timestamptz`                                               | Complete date/time when all relevant components are known.                         |
| `precision`            | `text NOT NULL DEFAULT 'full'`                              | full, year_month, month_day, year, month, day, or unknown.                         |
| `specific_information` | `jsonb`                                                     | Type-specific information payload.                                                 |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (month IS NULL OR month BETWEEN 1 AND 12)`
- `CHECK (day IS NULL OR day BETWEEN 1 AND 31)`
- `CHECK (year IS NULL OR year BETWEEN 1 AND 9999)`
- `CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown'))`
- `CONSTRAINT life_events_life_event_type_id_fkey FOREIGN KEY (workspace_id, life_event_type_id) REFERENCES life_event_types (workspace_id, id) ON DELETE SET NULL (life_event_type_id)`
- `CONSTRAINT life_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT life_events_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX life_events_person_idx ON life_events (person_id);`
- `CREATE INDEX life_events_workspace_date_idx ON life_events (workspace_id, happened_at DESC);`

## Tasks and reminders

### `tasks`

Workspace or person-scoped tasks. Replaces Monica tasks and supports CalDAV
through dav_objects.

| Column                   | SQL definition                                              | Purpose                                                                            |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                     | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`           | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this task.                                                     |
| `person_id`              | `uuid`                                                      | Related person, if any.                                                            |
| `title`                  | `text NOT NULL`                                             | Task title.                                                                        |
| `description`            | `text`                                                      | Task description.                                                                  |
| `status`                 | `text NOT NULL DEFAULT 'open'`                              | Task state: open, completed, or cancelled.                                         |
| `due_at`                 | `timestamptz`                                               | Optional due date/time.                                                            |
| `completed_at`           | `timestamptz`                                               | When the task was completed.                                                       |
| `completed_by_member_id` | `uuid`                                                      | Member who completed the task.                                                     |
| `created_by_member_id`   | `uuid`                                                      | Member who created the task.                                                       |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |
| `deleted_at`             | `timestamptz`                                               | Soft-delete timestamp.                                                             |

**Table constraints**

- `CHECK (status IN ('open', 'completed', 'cancelled'))`
- `CHECK (status <> 'completed' OR completed_at IS NOT NULL)`
- `CONSTRAINT tasks_completed_by_member_id_fkey FOREIGN KEY (workspace_id, completed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (completed_by_member_id)`
- `CONSTRAINT tasks_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT tasks_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id)`
- `CONSTRAINT tasks_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX tasks_workspace_status_idx ON tasks (workspace_id, status);`
- `CREATE INDEX tasks_person_idx ON tasks (person_id);`
- `CREATE INDEX tasks_due_idx ON tasks (workspace_id, due_at) WHERE due_at IS NOT NULL;`
- `CREATE INDEX tasks_search_idx ON tasks USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));`

The four `*_search_idx` GIN indexes, added in v9 for `SEARCH-001`, index the
exact `to_tsvector('simple', …)` expression workspace search matches for notes,
activities, journal posts, and tasks. A query uses an index only when it spells
the same expression; `concat_ws` is not immutable and cannot be indexed, so the
expressions concatenate with `||` and `coalesce`, which yields the same words.

### `reminder_rules`

Workspace notification lead-time rules. Replaces Monica reminder_rules.

| Column         | SQL definition                                              | Purpose                                                                            |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this rule.                                                     |
| `days_before`  | `integer NOT NULL`                                          | Number of days before an occurrence to notify.                                     |
| `is_active`    | `boolean NOT NULL DEFAULT true`                             | Whether this rule is active.                                                       |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (workspace_id, days_before)`
- `CHECK (days_before >= 0)`

**Indexes**

- `CREATE INDEX reminder_rules_active_idx ON reminder_rules (workspace_id, is_active);`

### `reminders`

Reminder definitions. Replaces Monica reminders plus birthday/deceased/first-met
reminder pointer columns.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this reminder.                                                 |
| `person_id`            | `uuid`                                                      | Related person, if any.                                                            |
| `person_date_id`       | `uuid`                                                      | Related important date, if this reminder is date-based.                            |
| `life_event_id`        | `uuid`                                                      | Related life event, if any.                                                        |
| `task_id`              | `uuid`                                                      | Related task, if any.                                                              |
| `target_kind`          | `text NOT NULL DEFAULT 'custom'`                            | Reminder target kind: custom, person, person_date, life_event, or task.            |
| `title`                | `text`                                                      | Reminder title.                                                                    |
| `description`          | `text`                                                      | Reminder description.                                                              |
| `anchor_on`            | `date NOT NULL`                                             | Initial/anchor occurrence date.                                                    |
| `recurrence_unit`      | `text NOT NULL DEFAULT 'none'`                              | none, day, week, month, or year.                                                   |
| `recurrence_interval`  | `integer NOT NULL DEFAULT 1`                                | Interval count for recurrence_unit.                                                |
| `send_time`            | `time`                                                      | Local send time override; null uses workspace default.                             |
| `is_active`            | `boolean NOT NULL DEFAULT true`                             | Whether this reminder is active.                                                   |
| `can_delete`           | `boolean NOT NULL DEFAULT true`                             | Whether members can delete it; false for generated core date reminders if desired. |
| `created_by_member_id` | `uuid`                                                      | Member who created the reminder.                                                   |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |
| `deleted_at`           | `timestamptz`                                               | Soft-delete timestamp.                                                             |

**Table constraints**

- `CHECK (recurrence_interval > 0)`
- `CHECK (target_kind IN ('custom', 'person', 'person_date', 'life_event', 'task'))`
- `CHECK (recurrence_unit IN ('none', 'day', 'week', 'month', 'year'))`
- `CHECK (((person_date_id IS NOT NULL)::int + (life_event_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1)`
- `CHECK ( (target_kind = 'custom' AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person' AND person_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person_date' AND person_date_id IS NOT NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'life_event' AND life_event_id IS NOT NULL AND person_date_id IS NULL AND task_id IS NULL) OR (target_kind = 'task' AND task_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL) )`
- `CONSTRAINT reminders_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`
- `CONSTRAINT reminders_life_event_id_fkey FOREIGN KEY (workspace_id, life_event_id) REFERENCES life_events (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT reminders_person_date_id_fkey FOREIGN KEY (workspace_id, person_date_id) REFERENCES person_dates (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT reminders_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT reminders_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT reminders_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX reminders_workspace_active_idx ON reminders (workspace_id, is_active);`
- `CREATE INDEX reminders_person_idx ON reminders (person_id);`
- `CREATE INDEX reminders_anchor_idx ON reminders (workspace_id, anchor_on);`
- `CREATE INDEX reminders_person_date_idx ON reminders (person_date_id) WHERE person_date_id IS NOT NULL;`
- `CREATE INDEX reminders_life_event_idx ON reminders (life_event_id) WHERE life_event_id IS NOT NULL;`
- `CREATE INDEX reminders_task_idx ON reminders (task_id) WHERE task_id IS NOT NULL;`

### `reminder_occurrences`

Generated notification/occurrence rows. Replaces Monica reminder_outbox and
reminders_sent.

| Column                     | SQL definition                                                                        | Purpose                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                      |
| `reminder_id`              | `uuid NOT NULL`                                                                       | Reminder definition.                                                                                                    |
| `member_id`                | `uuid NOT NULL`                                                                       | Member who will receive this occurrence.                                                                                |
| `occurs_on`                | `date NOT NULL`                                                                       | Date of the underlying event/reminder occurrence.                                                                       |
| `deliver_at`               | `timestamptz NOT NULL`                                                                | Exact notification delivery time.                                                                                       |
| `lead_time_days`           | `integer`                                                                             | Lead rule used to generate this occurrence; null is the distinct no-explicit-rule slot.                                 |
| `channel`                  | `text NOT NULL DEFAULT 'in_app'`                                                      | Delivery channel: in_app for the in-app reminder inbox or email for single reminder email and the daily digest.         |
| `status`                   | `text NOT NULL DEFAULT 'pending'`                                                     | Durable lifecycle: pending, claimed, retry, sent, skipped, failed, cancelled, or manual_attention.                      |
| `sent_at`                  | `timestamptz`                                                                         | When notification was sent.                                                                                             |
| `title_snapshot`           | `text`                                                                                | Title at time of scheduling/sending.                                                                                    |
| `body_snapshot`            | `text`                                                                                | Body at time of scheduling/sending.                                                                                     |
| `error`                    | `text`                                                                                | Failure details.                                                                                                        |
| `created_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                              |
| `updated_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                     |
| `claim_token`              | `uuid`                                                                                | Opaque ownership token for the current finite worker lease.                                                             |
| `claim_owner`              | `text`                                                                                | Non-secret worker instance name that owns the current lease.                                                            |
| `lease_expires_at`         | `timestamptz`                                                                         | When another worker may recover an abandoned claim.                                                                     |
| `attempt_count`            | `integer NOT NULL DEFAULT 0`                                                          | Persistent number of started delivery attempts.                                                                         |
| `last_attempt_at`          | `timestamptz`                                                                         | When the latest delivery attempt started.                                                                               |
| `next_attempt_at`          | `timestamptz`                                                                         | Earliest instant at which retry work may be claimed.                                                                    |
| `provider_idempotency_key` | `text NOT NULL DEFAULT gen_random_uuid()::text`                                       | Stable provider key retained across claims and process restarts.                                                        |
| `provider_receipt`         | `text`                                                                                | Stable provider receipt after confirmed delivery or reconciliation.                                                     |
| `provider_result_state`    | `text NOT NULL DEFAULT 'unattempted'`                                                 | Durable provider reconciliation state: unattempted, ambiguous, confirmed, or rejected.                                  |
| `provider_effect_at`       | `timestamptz`                                                                         | When the idempotent provider effect was durably recorded.                                                               |
| `visible_at`               | `timestamptz`                                                                         | When the in-app notification became user-visible.                                                                       |
| `workspace_id`             | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the reminders row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `CHECK (lead_time_days IS NULL OR lead_time_days >= 0)`
- `CHECK (status IN ('pending', 'claimed', 'retry', 'sent', 'skipped', 'failed', 'cancelled', 'manual_attention'))`
- `CHECK (attempt_count >= 0)`
- `CHECK (provider_result_state IN ('unattempted', 'ambiguous', 'confirmed', 'rejected'))`
- Claim token, owner, and lease are all present or all absent; they are present
- `CONSTRAINT reminder_occurrences_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT reminder_occurrences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE CASCADE`
  exactly while status is `claimed`.
- A confirmed result requires a receipt plus durable effect and visibility
  timestamps; sent additionally requires `sent_at`; manual attention requires an
  ambiguous or rejected provider result.

**Indexes**

- `CREATE INDEX reminder_occurrences_due_idx ON reminder_occurrences (status, COALESCE(next_attempt_at, deliver_at)) WHERE status IN ('pending', 'retry');`
- `CREATE INDEX reminder_occurrences_lease_idx ON reminder_occurrences (lease_expires_at) WHERE status = 'claimed';`
- `CREATE INDEX reminder_occurrences_member_idx ON reminder_occurrences (member_id);`
- `CREATE INDEX reminder_occurrences_member_feed_idx ON reminder_occurrences (member_id, date_trunc('milliseconds', visible_at AT TIME ZONE 'UTC') DESC, id DESC) WHERE channel = 'in_app' AND status = 'sent' AND visible_at IS NOT NULL;`
- `CREATE INDEX reminder_occurrences_member_open_idx ON reminder_occurrences (member_id, (CASE WHEN status = 'retry' THEN next_attempt_at ELSE deliver_at END)) WHERE status IN ('pending', 'retry', 'failed', 'manual_attention');`

The notification feed orders a member's delivered in-app occurrences by the UTC
millisecond of `visible_at`, then id, which is the leading key of
`reminder_occurrences_member_feed_idx`; Today's attention reads a member's open
occurrences by their effective time through
`reminder_occurrences_member_open_idx`. Neither covers the sent email history.
`reminder_occurrences_member_idx` covers every occurrence, so removing a member,
alone or with its workspace, deletes that member's occurrences without reading
every tenant's.

- `CREATE UNIQUE INDEX reminder_occurrences_unique_delivery ON reminder_occurrences (reminder_id, member_id, occurs_on, channel, COALESCE(lead_time_days, -1));`
- `CREATE UNIQUE INDEX reminder_occurrences_provider_key_idx ON reminder_occurrences (provider_idempotency_key);`

### `stay_in_touch_cadences`

Contact cadence settings. Replaces contacts.stay_in_touch_frequency and
stay_in_touch_trigger_date.

| Column                     | SQL definition                                                                        | Purpose                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                   |
| `person_id`                | `uuid NOT NULL`                                                                       | Person to stay in touch with.                                                                                        |
| `interval_count`           | `integer NOT NULL`                                                                    | Cadence interval count.                                                                                              |
| `interval_unit`            | `text NOT NULL DEFAULT 'day'`                                                         | day, week, month, or year.                                                                                           |
| `next_due_at`              | `timestamptz`                                                                         | Next stay-in-touch trigger.                                                                                          |
| `last_contacted_at`        | `timestamptz`                                                                         | Last known contact time, including imported Monica last_talked_to when interaction history is incomplete.            |
| `last_triggered_at`        | `timestamptz`                                                                         | Last generated trigger.                                                                                              |
| `reminder_id`              | `uuid`                                                                                | Generated/linked reminder definition.                                                                                |
| `is_active`                | `boolean NOT NULL DEFAULT true`                                                       | Whether the cadence is active.                                                                                       |
| `created_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                           |
| `updated_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                  |
| `last_request_id`          | `uuid`                                                                                | Last accepted idempotent cadence mutation request.                                                                   |
| `last_request_fingerprint` | `text`                                                                                | SHA-256 fingerprint of the last accepted cadence mutation payload.                                                   |
| `workspace_id`             | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (v14). |

**Table constraints**

- `UNIQUE (person_id)`
- Request ID and fingerprint are both null or both present; fingerprint is 64
- `CONSTRAINT stay_in_touch_cadences_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT stay_in_touch_cadences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE SET NULL (reminder_id)`
- `CONSTRAINT stay_in_touch_cadences_workspace_id_id_key UNIQUE (workspace_id, id)`
  lowercase hexadecimal characters.
- `CHECK (interval_count > 0)`
- `CHECK (interval_unit IN ('day', 'week', 'month', 'year'))`

**Indexes**

- `CREATE INDEX stay_in_touch_due_idx ON stay_in_touch_cadences (is_active, next_due_at) WHERE is_active AND next_due_at IS NOT NULL;`

### `stay_in_touch_cadence_requests`

Durable workspace-scoped idempotency receipts for accepted stay-in-touch cadence
mutations. The current cadence remains person-owned; this history only decides
replay versus conflict and never restores superseded settings.

| Column                | SQL definition                                              | Purpose                                                               |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `workspace_id`        | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace scope for request identity and tenant isolation.            |
| `request_id`          | `uuid NOT NULL`                                             | Client mutation request identifier, unique only inside its workspace. |
| `cadence_id`          | `uuid NOT NULL`                                             | Cadence state returned for an accepted request replay.                |
| `request_fingerprint` | `text NOT NULL`                                             | SHA-256 fingerprint of the accepted cadence mutation payload.         |
| `accepted_at`         | `timestamptz NOT NULL DEFAULT now()`                        | When the request was first accepted.                                  |

**Table constraints**

- `PRIMARY KEY (workspace_id, request_id)`
- `CONSTRAINT stay_in_touch_cadence_requests_cadence_id_fkey FOREIGN KEY (workspace_id, cadence_id) REFERENCES stay_in_touch_cadences (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX stay_in_touch_cadence_requests_cadence_idx ON stay_in_touch_cadence_requests (cadence_id);`

## Relationships

### `relationships`

Directional person-to-person relationship edges. Replaces Monica relationships.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this edge.                                                     |
| `from_person_id`       | `uuid NOT NULL`                                             | Subject/source person.                                                             |
| `to_person_id`         | `uuid NOT NULL`                                             | Object/target person.                                                              |
| `relationship_type_id` | `uuid NOT NULL`                                             | Directional relationship type.                                                     |
| `status`               | `text NOT NULL DEFAULT 'active'`                            | Relationship state: active or ended.                                               |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (from_person_id <> to_person_id)`
- `UNIQUE (from_person_id, to_person_id, relationship_type_id)`
- `CHECK (status IN ('active', 'ended'))`
- `CONSTRAINT relationships_from_person_id_fkey FOREIGN KEY (workspace_id, from_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT relationships_relationship_type_id_fkey FOREIGN KEY (workspace_id, relationship_type_id) REFERENCES relationship_types (workspace_id, id) ON DELETE RESTRICT`
- `CONSTRAINT relationships_to_person_id_fkey FOREIGN KEY (workspace_id, to_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT relationships_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX relationships_to_idx ON relationships (to_person_id);`
- `CREATE INDEX relationships_workspace_idx ON relationships (workspace_id);`

### `romantic_relationship_details`

Optional relationship-specific metadata for romantic/love relationships.
Replaces Monica metadata_love_relationships.

| Column            | SQL definition                                                                        | Purpose                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `relationship_id` | `uuid PRIMARY KEY`                                                                    | Relationship edge these details describe.                                                                                   |
| `notes`           | `text`                                                                                | Relationship notes.                                                                                                         |
| `met_at`          | `timestamptz`                                                                         | When the couple met.                                                                                                        |
| `official_at`     | `timestamptz`                                                                         | When the relationship became official.                                                                                      |
| `ended_at`        | `timestamptz`                                                                         | Breakup/end timestamp.                                                                                                      |
| `breakup_reason`  | `text`                                                                                | Breakup reason.                                                                                                             |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                  |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                         |
| `workspace_id`    | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the relationships row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `CHECK (ended_at IS NULL OR official_at IS NULL OR ended_at >= official_at)`
- `CONSTRAINT romantic_relationship_details_relationship_id_fkey FOREIGN KEY (workspace_id, relationship_id) REFERENCES relationships (workspace_id, id) ON DELETE CASCADE`

## Gifts and debts

### `gifts`

Gift ideas and gift history associated with a person, optionally intended for a
specific related person. Replaces Monica gifts.

| Column                | SQL definition                                              | Purpose                                                                                    |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                  | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.         |
| `workspace_id`        | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this gift.                                                             |
| `person_id`           | `uuid NOT NULL`                                             | Primary person whose profile owns the gift record.                                         |
| `recipient_person_id` | `uuid`                                                      | Optional person the gift is specifically intended for; null means no particular recipient. |
| `name`                | `text NOT NULL`                                             | Gift name.                                                                                 |
| `url`                 | `text`                                                      | External gift URL.                                                                         |
| `comment`             | `text`                                                      | Gift notes/comment.                                                                        |
| `status`              | `text NOT NULL DEFAULT 'idea'`                              | idea, planned, given, received, archived, or custom status.                                |
| `event_at`            | `timestamptz`                                               | Date/time the gift was/will be given or received.                                          |
| `amount`              | `numeric(19,4)`                                             | Gift amount using decimal currency value.                                                  |
| `currency_code`       | `char(3) REFERENCES currencies(code) ON DELETE SET NULL`    | Gift currency.                                                                             |
| `created_at`          | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                 |
| `updated_at`          | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                        |

**Table constraints**

- `CHECK (amount IS NULL OR amount >= 0)`
- `CONSTRAINT gifts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT gifts_recipient_person_id_fkey FOREIGN KEY (workspace_id, recipient_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (recipient_person_id)`
- `CONSTRAINT gifts_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX gifts_person_idx ON gifts (person_id);`
- `CREATE INDEX gifts_recipient_idx ON gifts (recipient_person_id) WHERE recipient_person_id IS NOT NULL;`
- `CREATE INDEX gifts_status_idx ON gifts (workspace_id, status);`
- `CREATE INDEX gifts_event_idx ON gifts (workspace_id, event_at) WHERE event_at IS NOT NULL;`

### `recurring_debts`

Added in v10 for the recurring debts of `GIFTS-001`. A member's rule that
charges a person the same debt every `interval_months` months on `day_of_month`,
from `starts_on` until the optional `ends_on`. The first charge falls on the
first such day on or after `starts_on`, and later charges follow every
`interval_months` months. A month shorter than the day uses its last day without
carrying it, so a rule on the 31st returns to the 31st after February. Each due
period becomes its own open `debts` row, which the member settles individually;
`next_occurrence_on` is the next due date not yet generated, and the worker
catches up every missed period from it. A paused rule (`is_active = false`)
generates nothing, and resuming it continues from the first period on or after
the day it resumes. The composite foreign key to `people (workspace_id, id)`
makes the database reject a rule whose person belongs to another workspace;
hard-deleting the person removes the rule.

| Column                 | SQL definition                                              | Purpose                                                                                            |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.                 |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this rule and its person.                                                      |
| `person_id`            | `uuid NOT NULL`                                             | Person each generated debt is with; same workspace by composite foreign key.                       |
| `direction`            | `text NOT NULL`                                             | Direction of every generated debt: i_owe or they_owe.                                              |
| `amount`               | `numeric(19,4) NOT NULL`                                    | Amount of every generated debt using decimal currency value.                                       |
| `currency_code`        | `char(3) NOT NULL REFERENCES currencies(code)`              | Currency of every generated debt.                                                                  |
| `reason`               | `text`                                                      | Reason copied onto every generated debt.                                                           |
| `interval_months`      | `integer NOT NULL DEFAULT 1`                                | Number of months between charges, 1 through 120.                                                   |
| `day_of_month`         | `smallint NOT NULL`                                         | Day of the month a charge falls due, 1 through 31; a shorter month uses its last day.              |
| `starts_on`            | `date NOT NULL`                                             | First local date a charge may fall due; the first charge is the first matching day on or after it. |
| `ends_on`              | `date`                                                      | Last local date a charge may fall due; null repeats without end.                                   |
| `is_active`            | `boolean NOT NULL DEFAULT true`                             | False while the member has paused the rule; a paused rule generates nothing.                       |
| `next_occurrence_on`   | `date`                                                      | Next due date not yet generated; null once the rule has passed its end date.                       |
| `created_by_member_id` | `uuid`                                                      | Member who created the rule, when still known.                                                     |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                                |

**Table constraints**

- `CONSTRAINT recurring_debts_workspace_id_id_key UNIQUE (workspace_id, id)`
- `CONSTRAINT recurring_debts_person_fk FOREIGN KEY (workspace_id, person_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT recurring_debts_direction_ck CHECK (direction IN ('i_owe', 'they_owe'))`
- `CONSTRAINT recurring_debts_amount_ck CHECK (amount >= 0)`
- `CONSTRAINT recurring_debts_interval_ck CHECK (interval_months BETWEEN 1 AND 120)`
- `CONSTRAINT recurring_debts_day_ck CHECK (day_of_month BETWEEN 1 AND 31)`
- `CONSTRAINT recurring_debts_window_ck CHECK (ends_on IS NULL OR ends_on >= starts_on)`
- `CONSTRAINT recurring_debts_next_ck CHECK (next_occurrence_on IS NULL OR next_occurrence_on >= starts_on)`
- `CONSTRAINT recurring_debts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id)`

**Indexes**

- `CREATE INDEX recurring_debts_person_idx ON recurring_debts (workspace_id, person_id);`
- `CREATE INDEX recurring_debts_due_idx ON recurring_debts (next_occurrence_on) WHERE is_active AND next_occurrence_on IS NOT NULL;`

### `debts`

Money owed by or to a person. Replaces Monica debts. Since v10 a debt may have
been generated by a `recurring_debts` rule for one due period: the pair
`(recurring_debt_id, occurrence_on)` is unique, so a period is charged at most
once however often generation runs. Deleting the rule keeps its debts and clears
only `recurring_debt_id`.

| Column              | SQL definition                                              | Purpose                                                                                                |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references.                     |
| `workspace_id`      | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this debt.                                                                         |
| `person_id`         | `uuid NOT NULL`                                             | Person involved in the debt.                                                                           |
| `direction`         | `text NOT NULL`                                             | Debt direction: i_owe when the user owes the person; they_owe when the person owes the user.           |
| `status`            | `text NOT NULL DEFAULT 'open'`                              | Debt lifecycle state: open, settled, or cancelled.                                                     |
| `amount`            | `numeric(19,4) NOT NULL`                                    | Debt amount using decimal currency value.                                                              |
| `currency_code`     | `char(3) REFERENCES currencies(code) ON DELETE SET NULL`    | Debt currency.                                                                                         |
| `reason`            | `text`                                                      | Reason for the debt.                                                                                   |
| `settled_at`        | `timestamptz`                                               | When the debt was settled.                                                                             |
| `created_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                                             |
| `updated_at`        | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                                    |
| `recurring_debt_id` | `uuid`                                                      | Recurring rule that generated this debt; null for a debt recorded by hand or once its rule is deleted. |
| `occurrence_on`     | `date`                                                      | Due date of the period a recurring rule generated this debt for; one debt per rule and date.           |

**Table constraints**

- `CHECK (direction IN ('i_owe', 'they_owe'))`
- `CHECK (status IN ('open', 'settled', 'cancelled'))`
- `CHECK (amount >= 0)`
- `CHECK (status <> 'settled' OR settled_at IS NOT NULL)`
- `CONSTRAINT debts_recurring_debt_fk FOREIGN KEY (workspace_id, recurring_debt_id) REFERENCES recurring_debts(workspace_id, id) ON DELETE SET NULL (recurring_debt_id)`
- `CONSTRAINT debts_recurrence_ck CHECK (recurring_debt_id IS NULL OR occurrence_on IS NOT NULL)`
- `CONSTRAINT debts_recurring_occurrence_key UNIQUE (recurring_debt_id, occurrence_on)`
- `CONSTRAINT debts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX debts_person_idx ON debts (person_id);`

## Integrations

### `dav_address_books`

Local CardDAV address books. Replaces Monica addressbooks.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this address book.                                             |
| `owner_member_id` | `uuid NOT NULL`                                             | Member that owns the address book.                                                 |
| `name`            | `text NOT NULL`                                             | Address book name.                                                                 |
| `description`     | `text`                                                      | Address book description.                                                          |
| `uri`             | `text`                                                      | DAV URI/slug for the local address book.                                           |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (owner_member_id, uri)`
- `CONSTRAINT dav_address_books_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT dav_address_books_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX dav_address_books_workspace_idx ON dav_address_books (workspace_id);`

### `dav_address_book_subscriptions`

Remote CardDAV subscriptions and encrypted sync credentials. Replaces Monica
addressbook_subscriptions.

| Column                  | SQL definition                                              | Purpose                                                                            |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                    | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`          | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this subscription.                                             |
| `owner_member_id`       | `uuid NOT NULL`                                             | Member who owns the subscription.                                                  |
| `local_address_book_id` | `uuid`                                                      | Local address book used for synchronized contacts.                                 |
| `name`                  | `text NOT NULL`                                             | Subscription name.                                                                 |
| `remote_url`            | `text NOT NULL`                                             | Remote CardDAV URL/URI.                                                            |
| `username`              | `text`                                                      | Remote DAV username.                                                               |
| `encrypted_password`    | `text`                                                      | Encrypted remote DAV password/token.                                               |
| `is_readonly`           | `boolean NOT NULL DEFAULT false`                            | Whether the remote book is read-only.                                              |
| `is_active`             | `boolean NOT NULL DEFAULT true`                             | Whether synchronization is active.                                                 |
| `capabilities`          | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Remote server capabilities.                                                        |
| `remote_sync_token`     | `text`                                                      | Remote sync token.                                                                 |
| `local_sync_token`      | `text`                                                      | Local sync marker.                                                                 |
| `last_synced_at`        | `timestamptz`                                               | Last synchronization timestamp.                                                    |
| `created_at`            | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`            | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT dav_address_book_subscriptions_local_address_book_id_fkey FOREIGN KEY (workspace_id, local_address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE SET NULL (local_address_book_id)`
- `CONSTRAINT dav_address_book_subscriptions_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT dav_address_book_subscriptions_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX dav_subscriptions_workspace_idx ON dav_address_book_subscriptions (workspace_id);`
- `CREATE INDEX dav_subscriptions_active_idx ON dav_address_book_subscriptions (workspace_id, is_active);`

### `dav_objects`

Per-object DAV state kept outside domain rows. Replaces
contacts.vcard/distant_etag/address_book_id and CalDAV task state.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this DAV object.                                               |
| `address_book_id` | `uuid`                                                      | Local address book.                                                                |
| `subscription_id` | `uuid`                                                      | Remote subscription source, if any.                                                |
| `object_kind`     | `text NOT NULL`                                             | DAV object kind: person or task.                                                   |
| `person_id`       | `uuid`                                                      | Person represented by this DAV object.                                             |
| `task_id`         | `uuid`                                                      | Task represented by this DAV object.                                               |
| `remote_uid`      | `text`                                                      | Remote UID/UID property.                                                           |
| `href`            | `text`                                                      | Remote/local DAV href.                                                             |
| `etag`            | `text`                                                      | Remote ETag.                                                                       |
| `vcard`           | `text`                                                      | Cached vCard payload for contacts.                                                 |
| `icalendar`       | `text`                                                      | Cached iCalendar/VTODO payload for tasks/calendars.                                |
| `sync_status`     | `text NOT NULL DEFAULT 'synced'`                            | Synchronization state: synced, dirty, conflict, deleted, or error.                 |
| `last_synced_at`  | `timestamptz`                                               | Last sync timestamp.                                                               |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |
| `deleted_at`      | `timestamptz`                                               | Soft-delete/tombstone timestamp for sync.                                          |

**Table constraints**

- `CHECK (((person_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1)`
- `CHECK (object_kind IN ('person', 'task'))`
- `CHECK (sync_status IN ('synced', 'dirty', 'conflict', 'deleted', 'error'))`
- `CHECK ( (object_kind = 'person' AND person_id IS NOT NULL AND task_id IS NULL) OR (object_kind = 'task' AND task_id IS NOT NULL AND person_id IS NULL) )`
- `CONSTRAINT dav_objects_address_book_id_fkey FOREIGN KEY (workspace_id, address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT dav_objects_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT dav_objects_subscription_id_fkey FOREIGN KEY (workspace_id, subscription_id) REFERENCES dav_address_book_subscriptions (workspace_id, id) ON DELETE SET NULL (subscription_id)`
- `CONSTRAINT dav_objects_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX dav_objects_person_idx ON dav_objects (person_id);`
- `CREATE INDEX dav_objects_task_idx ON dav_objects (task_id);`
- `CREATE INDEX dav_objects_href_idx ON dav_objects (workspace_id, href) WHERE href IS NOT NULL;`

### `dav_sync_tokens`

DAV sync token ledger. Replaces Monica synctoken.

| Column            | SQL definition                                              | Purpose                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`    | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this sync token.                                               |
| `member_id`       | `uuid NOT NULL`                                             | Member/principal.                                                                  |
| `collection_name` | `text NOT NULL DEFAULT 'contacts'`                          | DAV collection name such as contacts, tasks, birthdays.                            |
| `sync_token`      | `text NOT NULL`                                             | Issued sync token.                                                                 |
| `issued_at`       | `timestamptz NOT NULL DEFAULT now()`                        | When the token was issued.                                                         |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CONSTRAINT dav_sync_tokens_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX dav_sync_tokens_member_idx ON dav_sync_tokens (member_id, collection_name);`
- `CREATE UNIQUE INDEX dav_sync_tokens_value_unique ON dav_sync_tokens (member_id, collection_name, sync_token);`

### `location_weather_cache`

Optional cached weather payloads for locations. Replaces Monica weather but is
safe to clear/re-fetch.

| Column         | SQL definition                                                                        | Purpose                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                      |
| `location_id`  | `uuid NOT NULL`                                                                       | Location weather was fetched for.                                                                                       |
| `provider`     | `text NOT NULL`                                                                       | Weather provider name.                                                                                                  |
| `payload`      | `jsonb NOT NULL`                                                                      | Provider response payload.                                                                                              |
| `fetched_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | When weather was fetched.                                                                                               |
| `expires_at`   | `timestamptz`                                                                         | When cache should be considered stale.                                                                                  |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                              |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                     |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the locations row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `CONSTRAINT location_weather_cache_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX location_weather_cache_location_idx ON location_weather_cache (location_id, provider);`
- `CREATE INDEX location_weather_cache_expiry_idx ON location_weather_cache (expires_at);`

## Import/export

### `data_imports`

Import run metadata for Monica SQL/JSON/raw backups, vCard, CSV, and future
sources. Replaces Monica import_jobs at the canonical layer.

| Column                   | SQL definition                                              | Purpose                                                                            |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                     | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`           | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace being imported into.                                                     |
| `requested_by_member_id` | `uuid`                                                      | Member who requested the import.                                                   |
| `source_system`          | `text NOT NULL`                                             | monica, vcard, csv, manual, or other source system.                                |
| `source_profile`         | `text`                                                      | sql_export, json_export, raw_backup, storage_archive, etc.                         |
| `status`                 | `text NOT NULL DEFAULT 'pending'`                           | pending, dry_run, running, completed, failed, or cancelled.                        |
| `artifact_file_id`       | `uuid`                                                      | Uploaded import artifact.                                                          |
| `started_at`             | `timestamptz`                                               | Import start timestamp.                                                            |
| `completed_at`           | `timestamptz`                                               | Import completion timestamp.                                                       |
| `stats`                  | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Counts and summary statistics.                                                     |
| `error`                  | `text`                                                      | Top-level error message.                                                           |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (status IN ('pending', 'dry_run', 'running', 'completed', 'failed', 'cancelled'))`
- `CONSTRAINT data_imports_artifact_file_id_fkey FOREIGN KEY (workspace_id, artifact_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (artifact_file_id)`
- `CONSTRAINT data_imports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id)`
- `CONSTRAINT data_imports_workspace_id_id_key UNIQUE (workspace_id, id)`

**Indexes**

- `CREATE INDEX data_imports_workspace_idx ON data_imports (workspace_id, created_at DESC);`
- `CREATE INDEX data_imports_status_idx ON data_imports (status);`

### `data_import_entities`

Source-to-target identity map for imports. This is where Monica table
names/ids/UUIDs live, not in domain tables.

| Column               | SQL definition                                                                        | Purpose                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                                                     |
| `import_id`          | `uuid NOT NULL`                                                                       | Import run.                                                                                                                                            |
| `source_table`       | `text NOT NULL`                                                                       | Original source table/entity name.                                                                                                                     |
| `source_primary_key` | `text`                                                                                | Original source primary key as text.                                                                                                                   |
| `source_uuid`        | `uuid`                                                                                | Original source UUID if present.                                                                                                                       |
| `source_fingerprint` | `text`                                                                                | Hash/fingerprint for rows without stable ids.                                                                                                          |
| `target_table`       | `text`                                                                                | Canonical target table name.                                                                                                                           |
| `target_key`         | `text`                                                                                | Canonical target key serialized as text; supports UUIDs, natural keys such as currency codes, and deterministic composite keys.                        |
| `status`             | `text NOT NULL DEFAULT 'mapped'`                                                      | mapped, skipped, orphaned, warning, failed.                                                                                                            |
| `warnings`           | `jsonb NOT NULL DEFAULT '[]'::jsonb`                                                  | Warnings for this source row.                                                                                                                          |
| `raw_snapshot`       | `jsonb`                                                                               | Redacted source-row snapshot for diagnostics and lossless non-secret import review; password, token, session, and private-key values are never stored. |
| `created_at`         | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                                             |
| `workspace_id`       | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the data imports row this belongs to, denormalized so every reference from this row is workspace-bound (v15).                             |

**Table constraints**

- `CHECK (status IN ('mapped', 'skipped', 'orphaned', 'warning', 'failed'))`
- `CONSTRAINT data_import_entities_workspace_id_id_key UNIQUE (workspace_id, id)`
- `CONSTRAINT data_import_entities_import_id_fkey FOREIGN KEY (workspace_id, import_id) REFERENCES data_imports (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX data_import_entities_target_idx ON data_import_entities (target_table, target_key) WHERE target_key IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_source_unique ON data_import_entities (import_id, source_table, source_primary_key) WHERE source_primary_key IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_uuid_unique ON data_import_entities (import_id, source_table, source_uuid) WHERE source_uuid IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_fingerprint_unique ON data_import_entities (import_id, source_table, source_fingerprint) WHERE source_fingerprint IS NOT NULL;`

### `data_import_reports`

Per-row or per-person import report entries. Replaces Monica import_job_reports
and powers dry-run review.

| Column         | SQL definition                                                                        | Purpose                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                         |
| `import_id`    | `uuid NOT NULL`                                                                       | Import run.                                                                                                                |
| `entity_id`    | `uuid`                                                                                | Mapped entity this report is about.                                                                                        |
| `severity`     | `text NOT NULL DEFAULT 'info'`                                                        | info, warning, error, skipped.                                                                                             |
| `message`      | `text NOT NULL`                                                                       | Report message.                                                                                                            |
| `details`      | `jsonb NOT NULL DEFAULT '{}'::jsonb`                                                  | Structured report details.                                                                                                 |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                 |
| `workspace_id` | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the data imports row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `CHECK (severity IN ('info', 'warning', 'error', 'skipped'))`
- `CONSTRAINT data_import_reports_import_id_fkey FOREIGN KEY (workspace_id, import_id) REFERENCES data_imports (workspace_id, id) ON DELETE CASCADE`
- `CONSTRAINT data_import_reports_entity_id_fkey FOREIGN KEY (workspace_id, entity_id) REFERENCES data_import_entities (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX data_import_reports_import_idx ON data_import_reports (import_id, severity);`

### `data_exports`

Export job metadata and manifest. Replaces Monica export_jobs with versioned
manifests.

| Column                   | SQL definition                                              | Purpose                                                                            |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                     | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`           | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace being exported.                                                          |
| `requested_by_member_id` | `uuid`                                                      | Member who requested the export.                                                   |
| `format`                 | `text NOT NULL`                                             | json, sql, csv, vcard, or archive.                                                 |
| `status`                 | `text NOT NULL DEFAULT 'pending'`                           | Export state: pending, running, completed, failed, expired, or cancelled.          |
| `file_id`                | `uuid`                                                      | Generated export file.                                                             |
| `manifest`               | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Versioned export manifest with checksums and row counts.                           |
| `started_at`             | `timestamptz`                                               | Export start timestamp.                                                            |
| `completed_at`           | `timestamptz`                                               | Export completion timestamp.                                                       |
| `expires_at`             | `timestamptz`                                               | When the export should be deleted.                                                 |
| `error`                  | `text`                                                      | Top-level error message.                                                           |
| `created_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`             | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired', 'cancelled'))`
- `CONSTRAINT data_exports_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id)`
- `CONSTRAINT data_exports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id)`

**Indexes**

- `CREATE INDEX data_exports_workspace_idx ON data_exports (workspace_id, created_at DESC);`
- `CREATE INDEX data_exports_status_idx ON data_exports (status);`

## Audit

### `audit_events`

Append-only account/contact audit history. Replaces Monica audit_logs with JSON
payloads.

| Column                 | SQL definition                                              | Purpose                                                                            |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`         | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this event belongs to.                                                   |
| `actor_member_id`      | `uuid`                                                      | Member who caused the event.                                                       |
| `actor_name_snapshot`  | `text`                                                      | Actor display name at event time.                                                  |
| `person_id`            | `uuid`                                                      | Person this event is about, if any.                                                |
| `subject_type`         | `text`                                                      | Subject table/entity type.                                                         |
| `subject_id`           | `uuid`                                                      | Subject id, when it is a UUID domain row.                                          |
| `action`               | `text NOT NULL`                                             | Action key.                                                                        |
| `payload`              | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Structured event payload.                                                          |
| `occurred_at`          | `timestamptz NOT NULL DEFAULT now()`                        | Domain event timestamp.                                                            |
| `visible_on_dashboard` | `boolean NOT NULL DEFAULT false`                            | Whether the event appears in dashboard/activity feeds.                             |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |

**Table constraints**

- `CONSTRAINT audit_events_actor_member_id_fkey FOREIGN KEY (workspace_id, actor_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (actor_member_id)`
- `CONSTRAINT audit_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id)`

**Indexes**

- `CREATE INDEX audit_events_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC);`
- `CREATE INDEX audit_events_person_idx ON audit_events (person_id, occurred_at DESC);`
- `CREATE INDEX audit_events_action_idx ON audit_events (workspace_id, action);`

## API

### `api_request_logs`

API usage logging and throttling analytics. Replaces Monica api_usage with
richer request context.

| Column                          | SQL definition                                             | Purpose                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                            | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`               | Stable public primary key used by APIs, exports, imports, and internal references.                                                                                                                 |
| `workspace_id`                  | `uuid REFERENCES workspaces(id) ON DELETE SET NULL`        | Workspace associated with the request, if authenticated.                                                                                                                                           |
| `user_id`                       | `uuid REFERENCES users(id) ON DELETE SET NULL`             | Authenticated user, if any.                                                                                                                                                                        |
| `member_id`                     | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Workspace member, if any.                                                                                                                                                                          |
| `method`                        | `text NOT NULL`                                            | HTTP method.                                                                                                                                                                                       |
| `path`                          | `text NOT NULL`                                            | Request path or route.                                                                                                                                                                             |
| `client_ip`                     | `inet`                                                     | Client IP address.                                                                                                                                                                                 |
| `user_agent`                    | `text`                                                     | User agent.                                                                                                                                                                                        |
| `status_code`                   | `integer`                                                  | HTTP response status.                                                                                                                                                                              |
| `occurred_at`                   | `timestamptz NOT NULL DEFAULT now()`                       | Request timestamp.                                                                                                                                                                                 |
| `created_at`                    | `timestamptz NOT NULL DEFAULT now()`                       | Creation timestamp in UTC.                                                                                                                                                                         |
| `authentication_subject_digest` | `text`                                                     | Nullable versioned keyed digest of a normalized authentication subject. Values match `hmac-sha256:v<positive-integer>:<64 lowercase hex>`. Raw email addresses and challenge tokens are forbidden. |

**Indexes**

- `CREATE INDEX api_request_logs_time_idx ON api_request_logs (occurred_at DESC);`
- `CREATE INDEX api_request_logs_workspace_idx ON api_request_logs (workspace_id, occurred_at DESC);`
- `CREATE INDEX api_request_logs_member_idx ON api_request_logs (member_id) WHERE member_id IS NOT NULL;`
  (v14: the member cascade of a workspace delete)
- `CREATE INDEX api_request_logs_post_subject_idx ON api_request_logs (path, authentication_subject_digest, occurred_at DESC) WHERE method = 'POST';`

The authentication budgets count an address's and an account's attempts on one
path and subject over 15 minutes and 24 hours, across every outcome, through
`api_request_logs_post_subject_idx`.

**Constraints**

- `api_request_logs_auth_subject_digest_ck` permits `NULL` or the versioned
  `hmac-sha256:v<positive-integer>:<64 lowercase hex>` representation only.

### `workspace_lifecycle_records`

Minimal security result for `WORKSPACE-002`, deliberately retained outside the
deleted workspace graph. `workspace_id` and `actor_user_id` are immutable UUID
snapshots rather than foreign keys. The record contains only confirmed impact
counts and the internal object keys needed for bounded cleanup recovery; it does
not retain workspace names, person content, credentials, or exported bytes.

| Column                 | Type          | Null | Default             | Purpose                                                                                                                                                                      |
| ---------------------- | ------------- | ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid`        | no   | `gen_random_uuid()` | Stable deletion record and cleanup receipt identifier.                                                                                                                       |
| `workspace_id`         | `uuid`        | no   |                     | Deleted workspace identifier snapshot.                                                                                                                                       |
| `actor_user_id`        | `uuid`        | no   |                     | Deleting owner identity snapshot.                                                                                                                                            |
| `action`               | `text`        | no   |                     | `reset` or `delete`.                                                                                                                                                         |
| `outcome`              | `text`        | no   |                     | Redacted attempted-action result: `succeeded`, `forbidden`, `rate-limited`, `reauthentication-required`, `confirmation-invalid`, `stale-impact`, or `transactional-failure`. |
| `impact_counts`        | `jsonb`       | no   | `'{}'::jsonb`       | Non-identifying counts confirmed before deletion.                                                                                                                            |
| `object_keys`          | `jsonb`       | no   | `'[]'::jsonb`       | Internal object keys pending deletion.                                                                                                                                       |
| `cleanup_status`       | `text`        | no   | `'pending'`         | `pending` or `complete`.                                                                                                                                                     |
| `occurred_at`          | `timestamptz` | no   |                     | Atomic reset or deletion result timestamp.                                                                                                                                   |
| `cleanup_completed_at` | `timestamptz` | yes  |                     | Completion time for object cleanup.                                                                                                                                          |
| `created_at`           | `timestamptz` | no   | `now()`             | Record creation time.                                                                                                                                                        |

The JSON shapes, status vocabulary, and status/completion timestamp pairing are
database constraints. `workspace_lifecycle_records_pending_idx` supports the
existing worker's bounded reconciliation pass without introducing a queue.
`transactional-failure` is written in a separate transaction after the primary
destructive transaction rolls back; it is best-effort only when the database
itself is unavailable and never replaces the original failure.

### `api_tokens`

Personal access/API tokens. Replaces Monica account API keys and Passport
personal tokens for first-party API access.

| Column         | SQL definition                                         | Purpose                                                                            |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`           | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id`      | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the token.                                                           |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE CASCADE`     | Optional workspace scope.                                                          |
| `name`         | `text NOT NULL`                                        | Token display name.                                                                |
| `token_hash`   | `text NOT NULL`                                        | Hash of token secret.                                                              |
| `scopes`       | `text[] NOT NULL DEFAULT '{}'::text[]`                 | Granted API scopes.                                                                |
| `last_used_at` | `timestamptz`                                          | Last use timestamp.                                                                |
| `expires_at`   | `timestamptz`                                          | Expiration timestamp.                                                              |
| `revoked_at`   | `timestamptz`                                          | Revocation timestamp.                                                              |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                   | Creation timestamp in UTC.                                                         |
| `updated_at`   | `timestamptz NOT NULL DEFAULT now()`                   | Last update timestamp in UTC; maintained by application or trigger.                |

**Indexes**

- `CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens (token_hash);`
- `CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);`
- `CREATE INDEX api_tokens_workspace_idx ON api_tokens (workspace_id);`

### `oauth_clients`

OAuth2 clients if the app exposes a built-in OAuth provider. Replaces Monica
oauth_clients and personal_access_clients.

| Column            | SQL definition                                 | Purpose                                                                            |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`   | Stable public primary key used by APIs, exports, imports, and internal references. |
| `owner_user_id`   | `uuid REFERENCES users(id) ON DELETE SET NULL` | User that owns the client, if personal/client-created.                             |
| `name`            | `text NOT NULL`                                | Client name.                                                                       |
| `user_provider`   | `text`                                         | Optional user-provider identifier used by grant flows.                             |
| `secret_hash`     | `text`                                         | Hash of client secret.                                                             |
| `redirect_uris`   | `text[] NOT NULL DEFAULT '{}'::text[]`         | Exact redirect URIs registered for this client.                                    |
| `allowed_grants`  | `text[] NOT NULL DEFAULT '{}'::text[]`         | OAuth grant types enabled for this client.                                         |
| `scopes`          | `text[] NOT NULL DEFAULT '{}'::text[]`         | Scopes this client may request.                                                    |
| `is_confidential` | `boolean NOT NULL DEFAULT true`                | Whether client can keep a secret.                                                  |
| `is_active`       | `boolean NOT NULL DEFAULT true`                | Whether client is active.                                                          |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`           | Creation timestamp in UTC.                                                         |
| `updated_at`      | `timestamptz NOT NULL DEFAULT now()`           | Last update timestamp in UTC; maintained by application or trigger.                |

**Indexes**

- `CREATE INDEX oauth_clients_owner_idx ON oauth_clients (owner_user_id);`

### `oauth_authorization_codes`

OAuth authorization codes. Replaces Monica oauth_auth_codes.

| Column         | SQL definition                                                 | Purpose                                                                            |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                   | Stable public primary key used by APIs, exports, imports, and internal references. |
| `client_id`    | `uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE` | OAuth client.                                                                      |
| `user_id`      | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`         | Authorizing user.                                                                  |
| `code_hash`    | `text NOT NULL`                                                | Hash of authorization code.                                                        |
| `scopes`       | `text[] NOT NULL DEFAULT '{}'::text[]`                         | Scopes approved for the authorization code.                                        |
| `redirect_uri` | `text`                                                         | Redirect URI used.                                                                 |
| `expires_at`   | `timestamptz NOT NULL`                                         | Expiration timestamp.                                                              |
| `used_at`      | `timestamptz`                                                  | When code was consumed.                                                            |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`                           | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE UNIQUE INDEX oauth_authorization_codes_hash_idx ON oauth_authorization_codes (code_hash);`
- `CREATE INDEX oauth_authorization_codes_user_idx ON oauth_authorization_codes (user_id);`

### `oauth_access_tokens`

OAuth access tokens. Replaces Monica oauth_access_tokens.

| Column       | SQL definition                                                 | Purpose                                                                            |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`         | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                   | Stable public primary key used by APIs, exports, imports, and internal references. |
| `client_id`  | `uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE` | OAuth client.                                                                      |
| `user_id`    | `uuid REFERENCES users(id) ON DELETE CASCADE`                  | User subject, if any.                                                              |
| `token_hash` | `text NOT NULL`                                                | Hash of access token.                                                              |
| `scopes`     | `text[] NOT NULL DEFAULT '{}'::text[]`                         | Scopes granted to the access token.                                                |
| `expires_at` | `timestamptz NOT NULL`                                         | Expiration timestamp.                                                              |
| `revoked_at` | `timestamptz`                                                  | Revocation timestamp.                                                              |
| `created_at` | `timestamptz NOT NULL DEFAULT now()`                           | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE UNIQUE INDEX oauth_access_tokens_hash_idx ON oauth_access_tokens (token_hash);`
- `CREATE INDEX oauth_access_tokens_user_idx ON oauth_access_tokens (user_id);`

### `oauth_refresh_tokens`

OAuth refresh tokens. Replaces Monica oauth_refresh_tokens.

| Column            | SQL definition                                                       | Purpose                                                                            |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`              | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                         | Stable public primary key used by APIs, exports, imports, and internal references. |
| `access_token_id` | `uuid NOT NULL REFERENCES oauth_access_tokens(id) ON DELETE CASCADE` | Access token this refresh token belongs to.                                        |
| `token_hash`      | `text NOT NULL`                                                      | Hash of refresh token.                                                             |
| `expires_at`      | `timestamptz NOT NULL`                                               | Expiration timestamp.                                                              |
| `revoked_at`      | `timestamptz`                                                        | Revocation timestamp.                                                              |
| `created_at`      | `timestamptz NOT NULL DEFAULT now()`                                 | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE UNIQUE INDEX oauth_refresh_tokens_hash_idx ON oauth_refresh_tokens (token_hash);`

## Compliance

### `legal_documents`

Versioned legal/compliance documents. Replaces Monica terms.

| Column          | SQL definition                               | Purpose                                                                            |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`            | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `document_type` | `text NOT NULL`                              | terms, privacy, dpa, or other policy type.                                         |
| `version`       | `text NOT NULL`                              | Policy version string.                                                             |
| `content`       | `text NOT NULL`                              | Policy content, markdown/html/plain text depending on renderer.                    |
| `published_at`  | `timestamptz`                                | When this version became active.                                                   |
| `is_active`     | `boolean NOT NULL DEFAULT true`              | Whether this document can be accepted by users.                                    |
| `created_at`    | `timestamptz NOT NULL DEFAULT now()`         | Creation timestamp in UTC.                                                         |
| `updated_at`    | `timestamptz NOT NULL DEFAULT now()`         | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (document_type, version)`

**Indexes**

- `CREATE INDEX legal_documents_active_idx ON legal_documents (document_type, is_active);`
- `CREATE UNIQUE INDEX legal_documents_one_active_per_type ON legal_documents (document_type) WHERE is_active;`

### `legal_acceptances`

Immutable record that a user accepted a legal-document version, optionally in a
workspace context.

| Column              | SQL definition                                                    | Purpose                                                                            |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                      | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`      | `uuid REFERENCES workspaces(id) ON DELETE CASCADE`                | Workspace context for acceptance, if applicable.                                   |
| `user_id`           | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`            | User who accepted the document.                                                    |
| `legal_document_id` | `uuid NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT` | Accepted legal document.                                                           |
| `ip_address`        | `inet`                                                            | IP address captured at acceptance.                                                 |
| `accepted_at`       | `timestamptz NOT NULL DEFAULT now()`                              | Acceptance timestamp.                                                              |
| `created_at`        | `timestamptz NOT NULL DEFAULT now()`                              | Creation timestamp in UTC.                                                         |

**Indexes**

- `CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id);`

## Billing

### `billing_customers`

Payment-provider customer state kept separate from workspaces. Replaces Stripe
fields on Monica accounts.

| Column                     | SQL definition                                              | Purpose                                                                            |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                       | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id`             | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace billed through this provider customer.                                   |
| `provider`                 | `text NOT NULL DEFAULT 'stripe'`                            | Billing provider.                                                                  |
| `provider_customer_id`     | `text NOT NULL`                                             | Provider customer id.                                                              |
| `trial_ends_at`            | `timestamptz`                                               | Trial expiration timestamp.                                                        |
| `complimentary_until`      | `timestamptz`                                               | Free/complimentary access expiration, if any.                                      |
| `payment_method_type`      | `text`                                                      | Card/payment method brand/type.                                                    |
| `payment_method_last_four` | `text`                                                      | Last four digits of current payment method.                                        |
| `metadata`                 | `jsonb NOT NULL DEFAULT '{}'::jsonb`                        | Provider-specific billing metadata.                                                |
| `created_at`               | `timestamptz NOT NULL DEFAULT now()`                        | Creation timestamp in UTC.                                                         |
| `updated_at`               | `timestamptz NOT NULL DEFAULT now()`                        | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `UNIQUE (provider, provider_customer_id)`
- `UNIQUE (workspace_id, provider)`
- `CONSTRAINT billing_customers_workspace_id_id_key UNIQUE (workspace_id, id)`

### `billing_subscriptions`

Subscription records from the billing provider. Replaces Monica subscriptions.

| Column                     | SQL definition                                                                        | Purpose                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                              |
| `billing_customer_id`      | `uuid NOT NULL`                                                                       | Provider customer that owns this subscription and determines its workspace and billing provider.                                |
| `provider_subscription_id` | `text NOT NULL`                                                                       | Subscription id within the provider/customer context.                                                                           |
| `name`                     | `text NOT NULL DEFAULT 'default'`                                                     | Subscription name.                                                                                                              |
| `status`                   | `text NOT NULL`                                                                       | Provider subscription status.                                                                                                   |
| `quantity`                 | `integer`                                                                             | Subscription quantity.                                                                                                          |
| `trial_ends_at`            | `timestamptz`                                                                         | Trial end timestamp.                                                                                                            |
| `current_period_ends_at`   | `timestamptz`                                                                         | Current billing period end.                                                                                                     |
| `ends_at`                  | `timestamptz`                                                                         | Cancellation/end timestamp.                                                                                                     |
| `created_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                      |
| `updated_at`               | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                             |
| `workspace_id`             | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the billing customers row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `UNIQUE (billing_customer_id, provider_subscription_id)`
- `CHECK (quantity IS NULL OR quantity >= 0)`
- `CONSTRAINT billing_subscriptions_workspace_id_id_key UNIQUE (workspace_id, id)`
- `CONSTRAINT billing_subscriptions_billing_customer_id_fkey FOREIGN KEY (workspace_id, billing_customer_id) REFERENCES billing_customers (workspace_id, id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX billing_subscriptions_customer_status_idx ON billing_subscriptions (billing_customer_id, status);`

### `billing_subscription_items`

Subscription item rows from the billing provider. Replaces Monica
subscription_items.

| Column                | SQL definition                                                                        | Purpose                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`                                          | Stable public primary key used by APIs, exports, imports, and internal references.                                                  |
| `subscription_id`     | `uuid NOT NULL`                                                                       | Parent subscription.                                                                                                                |
| `provider_item_id`    | `text NOT NULL`                                                                       | Provider subscription item id.                                                                                                      |
| `provider_price_id`   | `text NOT NULL`                                                                       | Provider price id.                                                                                                                  |
| `provider_product_id` | `text`                                                                                | Provider product id.                                                                                                                |
| `quantity`            | `integer`                                                                             | Item quantity.                                                                                                                      |
| `created_at`          | `timestamptz NOT NULL DEFAULT now()`                                                  | Creation timestamp in UTC.                                                                                                          |
| `updated_at`          | `timestamptz NOT NULL DEFAULT now()`                                                  | Last update timestamp in UTC; maintained by application or trigger.                                                                 |
| `workspace_id`        | `uuid NOT NULL DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid` | Workspace of the billing subscriptions row this belongs to, denormalized so every reference from this row is workspace-bound (v15). |

**Table constraints**

- `UNIQUE (subscription_id, provider_item_id)`
- `CHECK (quantity IS NULL OR quantity >= 0)`
- `CONSTRAINT billing_subscription_items_subscription_id_fkey FOREIGN KEY (workspace_id, subscription_id) REFERENCES billing_subscriptions (workspace_id, id) ON DELETE CASCADE`

## Operations

### `scheduled_job_runs`

Scheduler/job observability. Replaces Monica crons and job status needs without
coupling to a queue implementation.

| Column        | SQL definition                               | Purpose                                                                            |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`          | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `job_key`     | `text NOT NULL`                              | Stable scheduled job key/command.                                                  |
| `status`      | `text NOT NULL DEFAULT 'running'`            | running, succeeded, failed, skipped.                                               |
| `started_at`  | `timestamptz NOT NULL DEFAULT now()`         | Run start timestamp.                                                               |
| `finished_at` | `timestamptz`                                | Run finish timestamp.                                                              |
| `error`       | `text`                                       | Error message if failed.                                                           |
| `metadata`    | `jsonb NOT NULL DEFAULT '{}'::jsonb`         | Job run metadata.                                                                  |
| `created_at`  | `timestamptz NOT NULL DEFAULT now()`         | Creation timestamp in UTC.                                                         |

**Table constraints**

- `CHECK (status IN ('running', 'succeeded', 'failed', 'skipped'))`

**Indexes**

- `CREATE INDEX scheduled_job_runs_key_idx ON scheduled_job_runs (job_key, started_at DESC);`

### `app_instances`

Self-hosted instance metadata and update-check state. Replaces Monica instances.

| Column                 | SQL definition                               | Purpose                                                                            |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                   | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `public_instance_id`   | `uuid NOT NULL DEFAULT gen_random_uuid()`    | Public anonymous instance id for optional telemetry/update checks.                 |
| `current_version`      | `text`                                       | Currently running app version.                                                     |
| `latest_known_version` | `text`                                       | Latest version seen by update check.                                               |
| `latest_release_notes` | `text`                                       | Release notes from last update check.                                              |
| `versions_behind`      | `integer`                                    | Number of known releases between current and latest versions, when calculated.     |
| `last_checked_at`      | `timestamptz`                                | Last update-check timestamp.                                                       |
| `metadata`             | `jsonb NOT NULL DEFAULT '{}'::jsonb`         | Instance metadata.                                                                 |
| `created_at`           | `timestamptz NOT NULL DEFAULT now()`         | Creation timestamp in UTC.                                                         |
| `updated_at`           | `timestamptz NOT NULL DEFAULT now()`         | Last update timestamp in UTC; maintained by application or trigger.                |

**Table constraints**

- `CHECK (versions_behind IS NULL OR versions_behind >= 0)`

**Indexes**

- `CREATE UNIQUE INDEX app_instances_public_idx ON app_instances (public_instance_id);`

### `statistics_snapshots`

Optional aggregate statistics snapshots for public/admin dashboards. Replaces
Monica statistics without 30 fixed counter columns.

| Column         | SQL definition                                     | Purpose                                                                            |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`           | `uuid PRIMARY KEY DEFAULT gen_random_uuid()`       | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this snapshot covers; null for instance-wide snapshot.                   |
| `scope`        | `text NOT NULL DEFAULT 'workspace'`                | workspace or instance.                                                             |
| `captured_at`  | `timestamptz NOT NULL DEFAULT now()`               | When counters were captured.                                                       |
| `counters`     | `jsonb NOT NULL`                                   | Named counters, such as contacts, activities, reminders, conversations.            |
| `created_at`   | `timestamptz NOT NULL DEFAULT now()`               | Creation timestamp in UTC.                                                         |

**Table constraints**

- `CHECK (scope IN ('instance', 'workspace'))`
- `CHECK ((scope = 'instance' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL))`

**Indexes**

- `CREATE INDEX statistics_snapshots_scope_idx ON statistics_snapshots (scope, captured_at DESC);`
- `CREATE INDEX statistics_snapshots_workspace_idx ON statistics_snapshots (workspace_id, captured_at DESC);`

## Deliberately retained complexities

- `person_first_meetings` remains separate because a first meeting has a date,
  introducer, structured location, free-form place, and notes.
- `journal_items` remains a one-of timeline projection because journal order
  spans activities, posts, and day ratings.
- `reminders` retains nullable target foreign keys with checks because
  referential integrity is preferable to a generic `target_type/target_id` pair.
- `audit_events.subject_type/subject_id` remains polymorphic because audit
  history must survive subject deletion and cover optional modules.
- `data_import_entities.target_table/target_key` remains polymorphic only inside
  import metadata; it is not a domain relationship.
- Provider-specific JSON remains only where the provider schema is genuinely
  external or variable.

## Required test contract

The implementation should treat the schema as a behavioral contract, not only
DDL. Production workflows require unit, integration, and end-to-end coverage,
including:

- workspace isolation and rejection of cross-workspace references;
- partial-date round trips and birthday/reminder scheduling;
- Monica fixture imports with row-count and field-level reconciliation;
- file imports with and without the storage archive;
- reminder regeneration and idempotent occurrence generation;
- idempotent recurring-debt generation, catch-up after missed periods, and
  month-end day clamping;
- relationship direction/reverse labels;
- gift recipient resolution and debt direction mapping;
- DAV sync conflict, deletion, and token behavior when the module is enabled;
- security migration behavior proving old sessions/tokens/recovery codes are not
  activated;
- optional-module disabled behavior proving core CRM functions do not depend on
  billing, DAV, OAuth, weather, or operations tables.

## Generated consistency checks

- SQL tables parsed: **92**.
- SQL columns parsed: **907**.
- Table and column comments: **92 / 907**.
- Explicit indexes: **158**, all names unique.
- Tables under forced row-level security: **75**, each with the one
  `workspace_isolation` policy; **107** tenant references, 106 of them
  workspace-bound composite keys.
- Foreign-key references checked: **181**, no missing target table/column.
- Forward references are limited to the two explicitly deferred constraints:
  member self-person and first-meeting location.
- Monica table mappings: **94/94**.
- Monica field mappings: **823/823**.

## Debt settlement history (v11)

### `debt_settlements`

#### Storage and lifecycle

The product owner requested a debt settlement dialog with an optional reason and
uploaded photo, permanently saved in debt history. This requires domain history
separate from permission-restricted/redacted audit records.

`debt_settlements` is owned by gifts. Each actual transition to settled and
initial-settled creation records an event in the same transaction as the debt
status and audit. Repeated settled-to-settled calls append nothing. Events
preserve original settled_at and reason; reopening clears only debts.settled_at.
Initial imports use the debt ID as event ID and remain idempotent. Backfill
creates one empty event per currently settled debt using its existing time;
unavailable past reopened history cannot be reconstructed.

Workspace/debt, workspace/file, and workspace/member composite foreign keys
reject cross-workspace references. V11 adds the required workspace/id unique
keys to debts, files, and workspace_members. Column-specific SET NULL clears
only photo_file_id or created_by_member_id after deletion and retains
workspace_id. Original photo_filename remains after removal. Files validates
available supported images linked to the same person, with row locks; gifts
never reads files internals. File storage/scanning/upload and authorized
download retain the existing public boundary. Removal or missing bytes shows an
unavailable photo without removing the reason/date.

History reads are paged and tenant/person/debt scoped. Person merges move the
debt, so its history follows without duplicating person identity. Explicit debt,
person, or workspace permanent deletion cascades events; personal actor deletion
clears attribution. History adds no new export format: current contact exports
explicitly exclude gifts/debts/history and attachment bytes.

`0011_add_debt_settlements.sql` is additive and transactional. Unique-key
validation scans the three parent tables; lock_timeout remains 5 seconds and
busy environments may need retry. Failure rolls back all keys/table/backfill
atomically. Older application versions ignore the new table. Schema downgrade is
a manual reviewed operation: dropping debt_settlements loses its history, then
drop the three workspace/id keys. Prefer application rollback or forward fix; do
not silently drop history.

Validation covers immutable hashes, clean apply, exact v1–v10 upgrade,
idempotent verification, drift rejection, transactional rollback, backfill
preservation, tenant FK rejection, file/actor SET NULL, retained reopen/resettle
history, scoped paged API reads and optional image upload failure handling.

```sql
CREATE TABLE debt_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  settled_at timestamptz NOT NULL,
  reason text,
  photo_file_id uuid,
  photo_filename text,
  created_by_member_id uuid,
  CONSTRAINT debt_settlements_debt_fk FOREIGN KEY (workspace_id, debt_id) REFERENCES debts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT debt_settlements_photo_fk FOREIGN KEY (workspace_id, photo_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL (photo_file_id),
  CONSTRAINT debt_settlements_actor_fk FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members(workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT debt_settlements_reason_ck CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 10000),
  CONSTRAINT debt_settlements_photo_filename_ck CHECK (photo_filename IS NULL OR length(photo_filename) BETWEEN 1 AND 500)
);
COMMENT ON TABLE debt_settlements IS 'Append-only debt settlement history. Reopening a debt retains earlier settlements; explicit debt/person/workspace deletion cascades history.';
COMMENT ON COLUMN debt_settlements.id IS 'Stable settlement event identity; initial imported and backfilled settlements use their debt identifier.';
COMMENT ON COLUMN debt_settlements.workspace_id IS 'Workspace that owns the debt and this settlement.';
COMMENT ON COLUMN debt_settlements.debt_id IS 'Debt settled by this event; retained across reopening and person merges.';
COMMENT ON COLUMN debt_settlements.settled_at IS 'Original settlement timestamp in UTC, retained after the debt is reopened.';
COMMENT ON COLUMN debt_settlements.reason IS 'Optional explanation of how or why the debt was settled, separate from the original debt reason.';
COMMENT ON COLUMN debt_settlements.photo_file_id IS 'Optional image validated through files for the same person and workspace; cleared on hard file deletion.';
COMMENT ON COLUMN debt_settlements.photo_filename IS 'Original photo filename retained when the image later becomes unavailable or is removed.';
COMMENT ON COLUMN debt_settlements.created_by_member_id IS 'Member who settled the debt; null for historical imports/backfills or after member deletion.';
CREATE INDEX debt_settlements_debt_idx ON debt_settlements (workspace_id, debt_id, settled_at DESC, id);
```

## Query indexes, MFA challenges, and seeded catalogs (v13)

V13 changes indexes, one check constraint and its column comment, and two global
catalogs' rows, and adds one column. It adds no table.

Indexes follow the statements that read them (AUD-V1):

- Added: `notes_workspace_created_idx` (Today's recent notes),
  `reminder_occurrences_member_feed_idx` (the notification feed's order),
  `reminder_occurrences_member_open_idx` (Today's attention),
  `people_active_given_name_idx` (the directory's default order and its
  continuation), `people_active_duplicate_name_idx` (the duplicate-name check),
  `reminders_person_date_idx`, `reminders_life_event_idx`, and
  `reminders_task_idx` (a target's reminder lookup and its delete cascade), and
  `api_request_logs_post_subject_idx` (the authentication budgets).
- Dropped: `people_workspace_idx` and `person_dates_person_idx` (prefixes of
  other indexes), `people_active_name_idx` (matched no statement),
  `api_request_logs_auth_subject_idx` (it holds only failures, and the budgets
  count every outcome), `person_contact_methods_normalized_idx` (no statement
  reads the column), and the low-selectivity `users_status_idx`,
  `workspaces_status_idx`, `workspace_members_status_idx`, and
  `debts_status_idx`.
- Kept: `calls_workspace_date_idx`, `conversation_threads_workspace_idx`, and
  `gifts_status_idx` are the only workspace-leading indexes of their tables. The
  workspace delete and reset cascades, the lifecycle impact counts, and the
  directory's last-contact aggregate filter those tables by workspace alone;
  without them each reads every tenant's rows. `reminder_occurrences_member_idx`
  is the only index that leads with `member_id` and covers every occurrence, so
  a member's delete cascade, including the one a workspace delete runs, uses it
  instead of reading every tenant's occurrences.

`users.pending_workspace_name` holds the workspace name a registration asked for
until email verification provisions the workspace (AUD-A2), so an unverified
registration creates no workspace. It is null for every other user.
`users_pending_workspace_name_ck` holds it to the registration contract's
limits: trimmed, and 1 to 120 characters. The contract's minimum of two counts
UTF-16 code units, so a single astral character passes it; the check counts
characters and so admits every name the contract does. Identity owns the column
with the rest of `users`.

`user_sessions.purpose` admits `mfa-challenge`, so a password-verified MFA
challenge can be stored as a hashed session row that survives restarts and
replicas.

`emotion_options` and `pet_categories` are seeded once with the Monica 4.x stock
values instead of being filled by the first tenant whose import names them. An
upgraded database keeps every row an import already added, with its id, and
receives only the stock names it lacks.

`0013_index_queries_and_seed_catalogs.sql` runs in the runner's single
transaction. Each `CREATE INDEX` holds a lock that blocks writes to its table
until commit, so a large deployment upgrades in a quiet window. Failure rolls
back every index, the constraints, the column, and the seeds together. The v12
application code reads and writes v13 unchanged, since it never writes
`mfa-challenge` or the nullable `pending_workspace_name` and the indexes only
change plans, but a migration runner built before v13 finds an unknown catalog
and refuses it. Roll back by redeploying a v13-aware image; a reviewed manual
script can recreate the dropped indexes, though the exact-catalog check would
then classify the database as drift.
