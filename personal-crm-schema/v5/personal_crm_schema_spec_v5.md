# Personal CRM schema specification — repository v5

## Status

This is the complete repository schema version 5 contract. It preserves the
externally audited repository-v1 model and the repository-reviewed v2
privacy-preserving runtime security field and index, the v3 exact purpose for
every user-session authority, the v4 supported ISO 4217 currency reference
catalog, and adds typed person-date year approximation. The external audit
covers the unchanged v1 source bundle only; the v2 through v5 deltas are
repository-reviewed and live-PostgreSQL validated.

Repository v5 contains 87 tables, 814 columns, and 145 explicit indexes. Monica
compatibility remains 94/94 source tables and 823/823 source columns with
unchanged dispositions.

**Canonical baseline:** PostgreSQL; UUID primary keys; modular monolith; one workspace is the tenant boundary; external integrations remain optional adapters.

## Re-audit result

| Metric | v1 proposal | audited v3 | Change |
|---|---:|---:|---:|
| Canonical/optional tables | 88 | 87 | -1 |
| Columns | 856 | 811 | -45 |
| Explicit indexes | 152 | 144 | -8 |
| Foreign-key declarations | 201 | 168 | -33 |
| Table-level constraints | 33 | 91 | +58 |
| JSONB fields | 20 | 17 | -3 |
| Monica tables mapped | 94 | 94/94 | complete |
| Monica columns mapped | table-level only | 823/823 | complete |

The audited model is smaller than v1 even after restoring omitted data and adding stronger integrity rules. No Monica-specific field was added to a product table solely to make import easier.

## Design rules

1. **Model product facts, not Monica storage history.** Source IDs, source UUIDs, table names, raw rows, and migration flags are isolated in import metadata.
2. **Use aggregate ownership instead of duplicated tenant columns.** Aggregate roots carry `workspace_id`; strict children derive ownership through a required parent.
3. **Keep optional services outside the people model.** DAV, weather, billing, OAuth, runtime logs, and update checks are independent modules.
4. **Keep unknown or partial dates losslessly.** Date components plus `precision` are the single source of truth; no duplicate complete-date column can drift.
5. **Use one file catalog.** Photos, documents, avatars, gift images, import artifacts, and export artifacts share `files`; link tables express their role.
6. **Separate definitions from generated workflow state.** Reminder definitions/rules are canonical; `reminder_occurrences` is generated delivery state.
7. **Use typed columns for stable values.** JSONB is reserved for genuinely variable schemas, provider payloads, manifests, audit payloads, and redacted import diagnostics.
8. **Do not activate imported secrets.** Sessions, reset codes, OAuth tokens, API keys, U2F material, and recovery codes are regenerated or require re-enrollment.
9. **Keep closed workflow states checked, but leave user/provider vocabularies extensible.** This adds integrity without PostgreSQL-enum migration friction.
10. **Preserve source semantics before translating labels.** For example, calls retain the exact source boolean and gifts retain the optional recipient reference.

## Tenant and aggregate ownership

`workspace_id` remains on aggregate roots that are independently queried or authorized: people, files, locations, organizations, activities, calls, conversations, notes, journal roots, life events, tasks, reminders, relationships, gifts, debts, integration roots, imports/exports, audits, and optional service roots.

Strict child and link rows do **not** repeat `workspace_id`. Application services must reject cross-workspace references before persistence. Repository integration tests must include a negative cross-tenant case for every command that links two workspace-owned aggregates.

## Module summary

| Module | Deployment | Tables | Purpose |
|---|---|---:|---|
| Foundation | core_domain | 4 | Global currency catalog plus tenant/workspace membership and member preferences. |
| Identity | core_domain | 8 | Login identities, invitations, credential factors, verification/reset workflows, and sessions. |
| Workspace configuration | core_domain | 13 | Workspace-customizable vocabularies and profile-section configuration; global emotion/pet catalogs are seeded once. |
| People | core_domain | 14 | Person profiles, dates, contact methods, addresses, work history, tags, and pets. |
| Files | core_domain | 3 | Unified file metadata and typed links to people and gifts. |
| Interactions | core_domain | 4 | Activities, participants, emotions, and notes. |
| Communications | core_domain | 4 | Calls, conversations, and messages. |
| Journal | core_domain | 3 | Journal posts, daily ratings, and ordered timeline items. |
| Life events | core_domain | 1 | Typed life milestones with partial-date precision. |
| Tasks and reminders | core_domain | 5 | Tasks, reminder definitions/rules, generated occurrences, and stay-in-touch cadence. |
| Relationships | core_domain | 2 | Directional relationship graph and optional romantic metadata. |
| Gifts and debts | core_domain | 2 | Gift ideas/history and debts/IOUs. |
| Integrations | optional_module | 5 | DAV synchronization and weather caching; isolated from person records. |
| Import/export | core_domain | 4 | Versioned import/export workflows, source identity map, redacted diagnostics, and manifests. |
| Audit | core_domain | 1 | Append-oriented product audit history. |
| API | runtime_support | 6 | API usage logs, personal tokens, and optional OAuth server state. |
| Compliance | optional_module | 2 | Versioned legal documents and immutable acceptances. |
| Billing | optional_module | 3 | Provider-agnostic customer, subscription, and item records. |
| Operations | runtime_support | 3 | Scheduled-run history, instance update metadata, and statistics snapshots. |

## Monica import compatibility

The importer uses `data_imports`, `data_import_entities`, and `data_import_reports`. Domain tables contain no Monica IDs or legacy flags.

Import order:

1. Parse SQL/JSON/vCard input into bounded staging.
2. Create the workspace, users/members, currencies, and configurable vocabularies.
3. Create people, files, locations, organizations, and source identity-map rows.
4. Resolve dependent rows and pivots through the identity map.
5. Import interactions, communications, journal data, tasks/reminders, relationships, gifts/debts, and optional integrations.
6. Regenerate future reminder occurrences, derived counters, search documents, and caches.
7. Validate row counts, references, missing files, unsupported secrets, and cross-workspace invariants before commit.

Every Monica source column has an explicit treatment in `monica_column_mapping_v5.csv`. `reminders_sent` is audit-first because the source row does not identify a recipient member; an occurrence is updated only after exact correlation. Redacted snapshots may retain non-secret legacy details; secrets and session payloads are never written there.

## Monica table coverage

| Monica table | Columns | Disposition | Canonical target/treatment | Import action |
|---|---:|---|---|---|
| `accounts` | 14 | canonical_split | workspaces | workspace_settings | billing_customers | Import through staging and the source identity map, then validate references before commit. |
| `users` | 27 | canonical_split | users | workspace_members | member_preferences | user_mfa_totp | Import through staging and the source identity map, then validate references before commit. |
| `invitations` | 7 | canonical | workspace_invitations | Import through staging and the source identity map, then validate references before commit. |
| `recovery_codes` | 7 | security_recreated | user_recovery_codes (newly generated only) | data_import_reports | Generate a new recovery-code set; retain only non-secret source-row metadata for the import report. |
| `terms` | 7 | optional_adapter | legal_documents | Import through staging and the source identity map, then validate references before commit. |
| `term_user` | 6 | optional_adapter | legal_acceptances | Import through staging and the source identity map, then validate references before commit. |
| `modules` | 8 | canonical | workspace_profile_modules | Import through staging and the source identity map, then validate references before commit. |
| `default_contact_modules` | 8 | seed_manifest | seed_manifest:workspace_profile_modules | Load equivalent versioned seed manifest; never clone migration flags. |
| `subscriptions` | 11 | canonical_split | billing_subscriptions | billing_subscription_items | Import through staging and the source identity map, then validate references before commit. |
| `subscription_items` | 8 | optional_adapter | billing_subscription_items | Import through staging and the source identity map, then validate references before commit. |
| `export_jobs` | 12 | canonical_split | data_exports | files | Import through staging and the source identity map, then validate references before commit. |
| `import_jobs` | 14 | canonical_split | data_imports | files | Import through staging and the source identity map, then validate references before commit. |
| `import_job_reports` | 9 | canonical | data_import_reports | Import through staging and the source identity map, then validate references before commit. |
| `audit_logs` | 11 | canonical | audit_events | Import through staging and the source identity map, then validate references before commit. |
| `api_usage` | 6 | optional_adapter | api_request_logs | Import through staging and the source identity map, then validate references before commit. |
| `currencies` | 6 | canonical | currencies | Import through staging and the source identity map, then validate references before commit. |
| `contacts` | 49 | canonical_split | people | person_avatars | person_dates | person_first_meetings | stay_in_touch_cadences | reminders | dav_objects | files | Import through staging and the source identity map, then validate references before commit. |
| `genders` | 7 | canonical | gender_options | Import through staging and the source identity map, then validate references before commit. |
| `contact_fields` | 8 | canonical | person_contact_methods | Import through staging and the source identity map, then validate references before commit. |
| `contact_field_types` | 10 | canonical | contact_method_types | Import through staging and the source identity map, then validate references before commit. |
| `default_contact_field_types` | 9 | seed_manifest | seed_manifest:contact_method_types | Load equivalent versioned seed manifest; never clone migration flags. |
| `contact_field_labels` | 6 | canonical | contact_labels | Import through staging and the source identity map, then validate references before commit. |
| `contact_field_contact_field_label` | 3 | canonical | person_contact_method_labels | Import through staging and the source identity map, then validate references before commit. |
| `addresses` | 8 | canonical | person_addresses | Import through staging and the source identity map, then validate references before commit. |
| `places` | 11 | canonical | locations | Import through staging and the source identity map, then validate references before commit. |
| `address_contact_field_label` | 3 | canonical | person_address_labels | Import through staging and the source identity map, then validate references before commit. |
| `companies` | 7 | canonical | organizations | Import through staging and the source identity map, then validate references before commit. |
| `occupations` | 13 | canonical | person_occupations | Import through staging and the source identity map, then validate references before commit. |
| `tags` | 7 | canonical | tags | Import through staging and the source identity map, then validate references before commit. |
| `contact_tag` | 5 | canonical | person_tags | Import through staging and the source identity map, then validate references before commit. |
| `photos` | 9 | canonical | files | Import through staging and the source identity map, then validate references before commit. |
| `contact_photo` | 4 | canonical | person_file_links | Import through staging and the source identity map, then validate references before commit. |
| `documents` | 12 | canonical_split | files | person_file_links | Import through staging and the source identity map, then validate references before commit. |
| `addressbooks` | 8 | optional_adapter | dav_address_books | Import through staging and the source identity map, then validate references before commit. |
| `addressbook_subscriptions` | 17 | optional_adapter | dav_address_book_subscriptions | Import through staging and the source identity map, then validate references before commit. |
| `synctoken` | 7 | optional_adapter | dav_sync_tokens | Import through staging and the source identity map, then validate references before commit. |
| `weather` | 6 | optional_adapter | location_weather_cache | Import through staging and the source identity map, then validate references before commit. |
| `activities` | 9 | canonical_split | activities | journal_items | Import through staging and the source identity map, then validate references before commit. |
| `activity_contact` | 3 | canonical | activity_participants | Import through staging and the source identity map, then validate references before commit. |
| `activity_statistics` | 7 | derived_recomputed | derived:activity aggregates | Recompute from imported activities; retain source counts only for reconciliation. |
| `activity_type_categories` | 7 | canonical | activity_type_categories | Import through staging and the source identity map, then validate references before commit. |
| `activity_types` | 9 | canonical | activity_types | Import through staging and the source identity map, then validate references before commit. |
| `default_activity_type_categories` | 4 | seed_manifest | seed_manifest:activity_type_categories | Load equivalent versioned seed manifest. |
| `default_activity_types` | 6 | seed_manifest | seed_manifest:activity_types | Load equivalent versioned seed manifest. |
| `calls` | 9 | canonical | calls | Import the source contact_called boolean exactly as calls.contact_was_caller; do not infer inbound/outbound semantics during migration. |
| `emotion_call` | 6 | canonical | call_emotions | Import through staging and the source identity map, then validate references before commit. |
| `emotion_activity` | 5 | canonical | activity_emotions | Import through staging and the source identity map, then validate references before commit. |
| `emotions` | 6 | canonical | emotion_options | Import through staging and the source identity map, then validate references before commit. |
| `emotions_primary` | 4 | canonical | emotion_options | Import through staging and the source identity map, then validate references before commit. |
| `emotions_secondary` | 5 | canonical | emotion_options | Import through staging and the source identity map, then validate references before commit. |
| `notes` | 9 | canonical | notes | Import through staging and the source identity map, then validate references before commit. |
| `conversations` | 8 | canonical | conversation_threads | Import through staging and the source identity map, then validate references before commit. |
| `messages` | 10 | canonical | messages | Import through staging and the source identity map, then validate references before commit. |
| `debts` | 11 | canonical | debts | Import through staging and the source identity map, then validate references before commit. |
| `gifts` | 14 | canonical | gifts <br> gift_file_links | Resolve gifts.contact_id to gifts.person_id and gifts.is_for to the optional gifts.recipient_person_id; zero/null means no particular recipient. |
| `gift_photo` | 4 | canonical | gift_file_links | Import through staging and the source identity map, then validate references before commit. |
| `tasks` | 10 | canonical_split | tasks | dav_objects | Import through staging and the source identity map, then validate references before commit. |
| `reminders` | 13 | canonical | reminders | Import through staging and the source identity map, then validate references before commit. |
| `reminder_rules` | 6 | canonical | reminder_rules | Import through staging and the source identity map, then validate references before commit. |
| `reminder_outbox` | 9 | canonical | reminder_occurrences | Regenerate pending future occurrences from reminder definitions and rules. |
| `reminders_sent` | 11 | canonical_audit_history | audit_events <br> reminder_occurrences (only when unambiguously correlated) | Preserve each sent-history row as an audit event. Update an imported occurrence only when it can be correlated to one exact reminder_outbox occurrence; never invent a recipient member. |
| `journal_entries` | 7 | canonical | journal_items | Import through staging and the source identity map, then validate references before commit. |
| `entries` | 7 | canonical_split | journal_posts | journal_items | Import through staging and the source identity map, then validate references before commit. |
| `days` | 8 | canonical_split | journal_day_ratings | journal_items | Import through staging and the source identity map, then validate references before commit. |
| `life_event_categories` | 8 | canonical | life_event_categories | Import through staging and the source identity map, then validate references before commit. |
| `life_event_types` | 10 | canonical | life_event_types | Import through staging and the source identity map, then validate references before commit. |
| `life_events` | 14 | canonical_split | life_events | reminders | Import through staging and the source identity map, then validate references before commit. |
| `default_life_event_categories` | 5 | seed_manifest | seed_manifest:life_event_categories | Load equivalent versioned seed manifest. |
| `default_life_event_types` | 7 | seed_manifest | seed_manifest:life_event_types | Load equivalent versioned seed manifest. |
| `special_dates` | 9 | canonical | person_dates | Import through staging and the source identity map, then validate references before commit. |
| `relationship_type_groups` | 6 | canonical | relationship_type_groups | Import through staging and the source identity map, then validate references before commit. |
| `relationship_types` | 8 | canonical | relationship_types | Import through staging and the source identity map, then validate references before commit. |
| `relationships` | 8 | canonical | relationships | Import through staging and the source identity map, then validate references before commit. |
| `default_relationship_type_groups` | 6 | seed_manifest | seed_manifest:relationship_type_groups | Load equivalent versioned seed manifest. |
| `default_relationship_types` | 8 | seed_manifest | seed_manifest:relationship_types | Load equivalent versioned seed manifest. |
| `metadata_love_relationships` | 11 | canonical_split | romantic_relationship_details | relationships | Import through staging and the source identity map, then validate references before commit. |
| `pets` | 8 | canonical | pets | Import through staging and the source identity map, then validate references before commit. |
| `pet_categories` | 5 | canonical | pet_categories | Import through staging and the source identity map, then validate references before commit. |
| `oauth_access_tokens` | 9 | security_recreated | security_recreated:oauth_access_tokens | Do not activate old tokens; issue replacements after user/admin approval. |
| `oauth_auth_codes` | 6 | security_recreated | security_recreated:oauth_authorization_codes | Discard expired/one-time authorization codes. |
| `oauth_clients` | 11 | optional_adapter | oauth_clients | Import through staging and the source identity map, then validate references before commit. |
| `oauth_personal_access_clients` | 4 | optional_adapter | oauth_clients | Import through staging and the source identity map, then validate references before commit. |
| `oauth_refresh_tokens` | 4 | security_recreated | security_recreated:oauth_refresh_tokens | Do not activate old tokens. |
| `webauthn_keys` | 13 | optional_adapter | webauthn_credentials | Conditional disabled import only when relying-party compatibility is verified; otherwise re-register. |
| `u2f_key` | 9 | security_reenrollment | security_reenroll:webauthn_credentials | Require WebAuthn re-registration. |
| `password_resets` | 3 | security_recreated | security_recreated:password_reset_requests | Discard all reset tokens. |
| `sessions` | 6 | runtime_recreated | runtime_recreated:user_sessions | Invalidate all sessions; users sign in again. |
| `cache` | 3 | runtime_recreated | runtime_recreated:cache | Do not import. |
| `jobs` | 6 | runtime_recreated | runtime_recreated:queue | Do not import queued work. |
| `failed_jobs` | 6 | runtime_recreated | runtime_recreated:queue_failure_log | Do not replay; optionally report failures without payload secrets. |
| `job_batches` | 10 | runtime_recreated | runtime_recreated:queue_batches | Do not import. |
| `crons` | 5 | optional_adapter | scheduled_job_runs | Import through staging and the source identity map, then validate references before commit. |
| `instances` | 8 | optional_adapter | app_instances | Import through staging and the source identity map, then validate references before commit. |
| `statistics` | 30 | optional_adapter | statistics_snapshots | derived:live counters | Optionally store one historical snapshot, then recompute live counters. |

## Canonical table specification

Every field below is also present in `personal_crm_field_catalog_v5.csv`, including nullability, default, foreign key, classification, and version status.

## Foundation

### `currencies`

Global ISO currency catalog used by members, gifts, debts, and billing display.
Repository v4 ships 165 active codes with numeric minor units from the official
SIX ISO 4217 List One snapshot retrieved on 2026-08-15 (source XML SHA-256
`838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`).
The synchronized schema and v3-to-v4 migration carry identical reference rows.

| Column | SQL definition | Purpose |
|---|---|---|
| `code` | `char(3) PRIMARY KEY` | ISO 4217 currency code. |
| `name` | `text NOT NULL` | Human-readable currency name. |
| `symbol` | `text` | Common display symbol. |
| `minor_unit` | `smallint NOT NULL DEFAULT 2` | Number of decimal places normally used by the currency. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether this currency is selectable for new data. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (minor_unit BETWEEN 0 AND 6)`

**Indexes**

- `CREATE INDEX currencies_active_idx ON currencies (is_active);`

### `workspaces`

Tenant/workspace root. This replaces Monica accounts and is the ownership boundary for product data.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `name` | `text NOT NULL` | Workspace display name. |
| `slug` | `text` | Optional human-readable URL slug; not used as a permanent identifier. |
| `status` | `text NOT NULL DEFAULT 'active'` | Workspace lifecycle state: active, suspended, or archived. |
| `created_by_user_id` | `uuid REFERENCES users(id) ON DELETE SET NULL` | User that created the workspace, when known. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete timestamp for workspace closure or GDPR deletion workflow. |

**Table constraints**

- `CHECK (status IN ('active', 'suspended', 'archived'))`

**Indexes**

- `CREATE UNIQUE INDEX workspaces_slug_unique ON workspaces (lower(slug)) WHERE slug IS NOT NULL AND deleted_at IS NULL;`
- `CREATE INDEX workspaces_status_idx ON workspaces (status);`

### `workspace_members`

Membership row connecting a user to a workspace with role, state, and optional self-person link.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this membership belongs to. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User identity for this membership. |
| `role` | `text NOT NULL DEFAULT 'member'` | Workspace role, typically owner, admin, or member. |
| `status` | `text NOT NULL DEFAULT 'active'` | Membership state: active, suspended, or left; pending invitations live in workspace_invitations. |
| `invited_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who sent the invitation, if applicable. |
| `self_person_id` | `uuid` | Person/contact row representing this member inside the workspace address book. |
| `joined_at` | `timestamptz` | When the invitation was accepted or the membership became active. |
| `left_at` | `timestamptz` | When the member left or was removed. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, user_id)`
- `CHECK (role IN ('owner', 'admin', 'member'))`
- `CHECK (status IN ('active', 'suspended', 'left'))`

**Deferred foreign keys**

- `ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_self_person_fk
  FOREIGN KEY (self_person_id) REFERENCES people(id) ON DELETE SET NULL;`

**Indexes**

- `CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);`
- `CREATE INDEX workspace_members_status_idx ON workspace_members (workspace_id, status);`
- `CREATE UNIQUE INDEX workspace_members_self_person_unique ON workspace_members (self_person_id) WHERE self_person_id IS NOT NULL;`

### `member_preferences`

Per-member locale, timezone, display, sorting, measurement, and sparse UI-state preferences.

| Column | SQL definition | Purpose |
|---|---|---|
| `member_id` | `uuid PRIMARY KEY REFERENCES workspace_members(id) ON DELETE CASCADE` | Member whose preferences are stored here. |
| `timezone` | `text` | IANA timezone used for local date display and reminder scheduling. |
| `locale` | `text NOT NULL DEFAULT 'en'` | Language/locale preference. |
| `temperature_scale` | `text NOT NULL DEFAULT 'celsius'` | Weather display scale. |
| `measurement_system` | `text NOT NULL DEFAULT 'metric'` | Preferred measurement system for distances and other non-temperature units. |
| `currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL` | Default currency for new money records. |
| `contact_sort_order` | `text NOT NULL DEFAULT 'given_name_asc'` | Default contact list sort. |
| `contact_name_order` | `text NOT NULL DEFAULT 'given_family_nickname'` | Default name display order. |
| `fluid_layout` | `boolean NOT NULL DEFAULT false` | Layout preference. |
| `ui_state` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Sparse presentation state such as active tabs and dismissed feature badges; never stores domain data. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (temperature_scale IN ('celsius', 'fahrenheit'))`
- `CHECK (measurement_system IN ('metric', 'imperial'))`

## Identity

### `users`

Global login identity. A user can belong to one or more workspaces through workspace_members.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `email` | `citext NOT NULL UNIQUE` | Primary login email address. |
| `password_hash` | `text` | Password hash for local login. Null when only external identity providers are enabled. |
| `first_name` | `text NOT NULL DEFAULT ''` | User given name. |
| `last_name` | `text NOT NULL DEFAULT ''` | User family name. |
| `status` | `text NOT NULL DEFAULT 'active'` | Login account state: active, disabled, or deleted. |
| `email_verified_at` | `timestamptz` | When the primary email was verified. |
| `last_login_at` | `timestamptz` | Last successful login timestamp. |
| `password_changed_at` | `timestamptz` | Last password update timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete/anonymization timestamp. |

**Table constraints**

- `CHECK (status IN ('active', 'disabled', 'deleted'))`

**Indexes**

- `CREATE INDEX users_status_idx ON users (status);`

### `workspace_invitations`

Pending workspace invitations. Replaces Monica invitations.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace invite is for. |
| `invited_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who sent the invite. |
| `email` | `citext NOT NULL` | Invited email address. |
| `token_hash` | `text NOT NULL` | Hash of opaque acceptance token. |
| `role` | `text NOT NULL DEFAULT 'member'` | Role granted on acceptance. |
| `status` | `text NOT NULL DEFAULT 'pending'` | pending, accepted, expired, revoked. |
| `expires_at` | `timestamptz` | Expiration timestamp. |
| `accepted_at` | `timestamptz` | Acceptance timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (role IN ('admin', 'member'))`
- `CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))`
- `CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)`

**Indexes**

- `CREATE INDEX workspace_invitations_email_idx ON workspace_invitations (workspace_id, email);`
- `CREATE UNIQUE INDEX workspace_invitations_token_idx ON workspace_invitations (token_hash);`

### `password_reset_requests`

Password reset requests/tokens. Runtime security table; not imported as active data from Monica.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid REFERENCES users(id) ON DELETE CASCADE` | User requesting reset, if known. |
| `email` | `citext NOT NULL` | Email used for reset request. |
| `token_hash` | `text NOT NULL` | Hash of reset token. |
| `requested_ip` | `inet` | IP address that requested reset. |
| `expires_at` | `timestamptz NOT NULL` | Token expiration. |
| `used_at` | `timestamptz` | When token was used. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE UNIQUE INDEX password_reset_token_idx ON password_reset_requests (token_hash);`
- `CREATE INDEX password_reset_email_idx ON password_reset_requests (email);`

### `email_verification_tokens`

Email verification tokens for users.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User verifying email. |
| `email` | `citext NOT NULL` | Email being verified. |
| `token_hash` | `text NOT NULL` | Hash of verification token. |
| `expires_at` | `timestamptz NOT NULL` | Token expiration. |
| `used_at` | `timestamptz` | When token was used. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE UNIQUE INDEX email_verification_token_idx ON email_verification_tokens (token_hash);`

### `user_mfa_totp`

TOTP MFA secrets. Replaces Monica users.google2fa_secret without mixing secrets into users.

| Column | SQL definition | Purpose |
|---|---|---|
| `user_id` | `uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` | User with TOTP configured. |
| `encrypted_secret` | `text NOT NULL` | Encrypted TOTP secret. |
| `confirmed_at` | `timestamptz` | When TOTP was confirmed. |
| `last_used_at` | `timestamptz` | Last successful TOTP use. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

### `user_recovery_codes`

Hashed MFA recovery codes. Replaces Monica recovery_codes.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the recovery code. |
| `code_hash` | `text NOT NULL` | Hash of recovery code. |
| `used_at` | `timestamptz` | When code was consumed. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);`
- `CREATE UNIQUE INDEX user_recovery_codes_hash_idx ON user_recovery_codes (code_hash);`

### `webauthn_credentials`

FIDO2/WebAuthn credentials. Replaces Monica webauthn_keys; legacy U2F should be re-registered rather than activated blindly.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the credential. |
| `name` | `text NOT NULL DEFAULT 'key'` | User-visible key name. |
| `credential_id` | `text NOT NULL` | WebAuthn credential id. |
| `credential_type` | `text NOT NULL` | Credential type. |
| `transports` | `text[] NOT NULL DEFAULT '{}'::text[]` | Supported authenticator transports. |
| `attestation_type` | `text` | Attestation type. |
| `trust_path` | `jsonb` | Trust path information. |
| `aaguid` | `text` | Authenticator AAGUID. |
| `public_key` | `text NOT NULL` | Credential public key. |
| `sign_count` | `integer NOT NULL DEFAULT 0` | Signature counter. |
| `last_used_at` | `timestamptz` | Last successful authentication. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (credential_id)`
- `CHECK (sign_count >= 0)`

**Indexes**

- `CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials (user_id);`

### `user_sessions`

Stateful web sessions if the deployment uses DB-backed sessions. Replaces Monica sessions without Laravel payload coupling.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid REFERENCES users(id) ON DELETE CASCADE` | Authenticated user. |
| `session_hash` | `text NOT NULL` | Hash of session token/id. |
| `purpose` | `text NOT NULL` | Exact authority purpose: authenticated session, verified identity entry, or revoked legacy authority. |
| `ip_address` | `inet` | Client IP address. |
| `user_agent` | `text` | Client user agent. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Session creation timestamp. |
| `last_seen_at` | `timestamptz NOT NULL DEFAULT now()` | Last activity timestamp. |
| `expires_at` | `timestamptz NOT NULL` | Session expiration timestamp. |
| `revoked_at` | `timestamptz` | Revocation timestamp. |

**Table constraints**

- `CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy'))`
- `CHECK (purpose <> 'legacy' OR revoked_at IS NOT NULL)`

**Indexes**

- `CREATE UNIQUE INDEX user_sessions_hash_idx ON user_sessions (session_hash);`
- `CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);`

## Workspace configuration

### `gender_options`

Workspace-level gender vocabulary. Replaces Monica genders while allowing custom labels.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this option. |
| `name` | `text NOT NULL` | Display label. |
| `code` | `text` | Optional short internal code, such as m, f, nb, or custom. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from the app seed manifest rather than by a user. |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Hidden for new selection but kept for existing people. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX gender_options_workspace_idx ON gender_options (workspace_id);`
- `CREATE UNIQUE INDEX gender_options_workspace_name_unique ON gender_options (workspace_id, lower(name));`

### `workspace_settings`

Typed workspace defaults used when creating members, people, and reminder schedules.

| Column | SQL definition | Purpose |
|---|---|---|
| `workspace_id` | `uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace these settings apply to. |
| `default_locale` | `text NOT NULL DEFAULT 'en'` | Default locale for new members. |
| `default_timezone` | `text` | Default timezone for new members and scheduled workflows. |
| `default_currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL` | Default workspace currency. |
| `default_gender_option_id` | `uuid REFERENCES gender_options(id) ON DELETE SET NULL` | Default gender option for new people, when desired. |
| `default_reminder_time` | `time NOT NULL DEFAULT '12:00'` | Default local send time for reminder notifications. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

### `workspace_profile_modules`

Profile-module toggles shown on person pages. Replaces Monica modules and default_contact_modules.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this module toggle. |
| `key` | `text NOT NULL` | Stable feature/module key. |
| `name` | `text` | Display name if not translated by key. |
| `translation_key` | `text` | I18n key for seeded modules. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether the module appears in the profile UI. |
| `can_delete` | `boolean NOT NULL DEFAULT false` | Whether a member can remove the module definition. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, key)`

**Indexes**

- `CREATE INDEX workspace_profile_modules_active_idx ON workspace_profile_modules (workspace_id, is_active);`

### `contact_method_types`

Workspace-defined contact method types: email, phone, URL, social profile, instant messaging, or custom.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type. |
| `name` | `text NOT NULL` | Display name. |
| `kind` | `text NOT NULL DEFAULT 'custom'` | Broad kind: email, phone, url, social, im, username, or custom. |
| `icon` | `text` | Icon name for UI display. |
| `protocol` | `text` | URI protocol prefix such as mailto, tel, sms, https. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Seeded app type. |
| `can_delete` | `boolean NOT NULL DEFAULT true` | Whether this type can be deleted. |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Hidden for new use but retained for old methods. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, name)`

**Indexes**

- `CREATE INDEX contact_method_types_kind_idx ON contact_method_types (workspace_id, kind);`

### `contact_labels`

Reusable labels for contact methods and addresses. Replaces Monica contact_field_labels and label pivots.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this label. |
| `label` | `text` | Custom display label. |
| `translation_key` | `text` | Seeded translated label key. |
| `applies_to` | `text NOT NULL DEFAULT 'any'` | Scope: any, contact_method, or address. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (label IS NOT NULL OR translation_key IS NOT NULL)`
- `CHECK (applies_to IN ('any', 'contact_method', 'address'))`

**Indexes**

- `CREATE INDEX contact_labels_workspace_idx ON contact_labels (workspace_id);`

### `activity_type_categories`

Workspace activity category vocabulary.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this category. |
| `name` | `text` | Display name. |
| `translation_key` | `text` | I18n key for seeded categories. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX activity_type_categories_workspace_idx ON activity_type_categories (workspace_id);`

### `activity_types`

Workspace activity types used by multi-person interactions.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type. |
| `category_id` | `uuid REFERENCES activity_type_categories(id) ON DELETE SET NULL` | Optional category. |
| `name` | `text` | Display name. |
| `translation_key` | `text` | I18n key for seeded types. |
| `location_behavior` | `text` | How this type handles location, matching Monica's location_type idea. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Hidden for new activities but retained for history. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX activity_types_workspace_idx ON activity_types (workspace_id);`
- `CREATE INDEX activity_types_category_idx ON activity_types (category_id);`

### `emotion_options`

Global hierarchical emotion taxonomy shared by activity and call tagging.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `parent_id` | `uuid REFERENCES emotion_options(id) ON DELETE CASCADE` | Parent emotion in the hierarchy. |
| `name` | `text NOT NULL` | Emotion display name. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether the emotion remains selectable for new calls and activities. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX emotion_options_parent_idx ON emotion_options (parent_id);`
- `CREATE INDEX emotion_options_active_idx ON emotion_options (is_active, sort_order);`

### `life_event_categories`

Workspace life-event category vocabulary.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this category. |
| `name` | `text NOT NULL` | Display name. |
| `seed_key` | `text` | Stable seed key for default categories. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX life_event_categories_workspace_idx ON life_event_categories (workspace_id);`

### `life_event_types`

Workspace life-event type vocabulary with optional structured information schema.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type. |
| `category_id` | `uuid REFERENCES life_event_categories(id) ON DELETE SET NULL` | Category containing this type. |
| `name` | `text` | Display name. |
| `seed_key` | `text` | Stable seed key for default types. |
| `information_schema` | `jsonb` | JSON Schema or field description for type-specific information. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Hidden for new events but retained for history. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX life_event_types_workspace_idx ON life_event_types (workspace_id);`
- `CREATE INDEX life_event_types_category_idx ON life_event_types (category_id);`

### `relationship_type_groups`

Workspace relationship grouping vocabulary.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this group. |
| `name` | `text NOT NULL` | Display name. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `can_delete` | `boolean NOT NULL DEFAULT false` | Whether members can delete the group. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX relationship_type_groups_workspace_idx ON relationship_type_groups (workspace_id);`

### `relationship_types`

Directional relationship labels with forward and reverse names.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this type. |
| `group_id` | `uuid REFERENCES relationship_type_groups(id) ON DELETE SET NULL` | Group/category for this relationship type. |
| `forward_label` | `text NOT NULL` | Label when traversing from source person to target person. |
| `reverse_label` | `text NOT NULL` | Label when traversing from target person back to source person. |
| `is_system` | `boolean NOT NULL DEFAULT false` | Created from seed manifest. |
| `can_delete` | `boolean NOT NULL DEFAULT false` | Whether members can delete the type. |
| `is_archived` | `boolean NOT NULL DEFAULT false` | Hidden for new relationships but retained for history. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX relationship_types_workspace_idx ON relationship_types (workspace_id);`
- `CREATE INDEX relationship_types_group_idx ON relationship_types (group_id);`

### `pet_categories`

Global pet category catalog.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `name` | `text NOT NULL` | Pet category name. |
| `is_common` | `boolean NOT NULL DEFAULT false` | Whether this category belongs to the common/default set shown prominently. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether this category is selectable for new pets. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE UNIQUE INDEX pet_categories_name_unique ON pet_categories (lower(name));`
- `CREATE INDEX pet_categories_common_idx ON pet_categories (is_common, sort_order);`

## People

### `people`

Core person/contact profile. Lifecycle is represented by partial, archived, deceased, and deleted fields rather than a second status column.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this person. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member that created the person, when known. |
| `gender_option_id` | `uuid REFERENCES gender_options(id) ON DELETE SET NULL` | Selected workspace gender option. |
| `given_name` | `text NOT NULL DEFAULT ''` | Given/first name. |
| `middle_name` | `text` | Middle name. |
| `family_name` | `text` | Family/last name. |
| `nickname` | `text` | Nickname shown with formal names. |
| `description` | `text` | Short profile description or bio. |
| `food_preferences` | `text` | Food, allergy, and dietary preferences. |
| `is_partial` | `boolean NOT NULL DEFAULT false` | Incomplete/imported contact flag. |
| `is_starred` | `boolean NOT NULL DEFAULT false` | Favorite/star flag. |
| `is_deceased` | `boolean NOT NULL DEFAULT false` | Whether this person is known to be deceased. |
| `archived_at` | `timestamptz` | When the person was archived. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete timestamp. Deleted people are hidden by default. |

**Indexes**

- `CREATE INDEX people_workspace_idx ON people (workspace_id);`
- `CREATE INDEX people_starred_idx ON people (workspace_id, is_starred);`
- `CREATE INDEX people_active_name_idx ON people (workspace_id, lower(family_name), lower(given_name)) WHERE archived_at IS NULL AND deleted_at IS NULL;`

### `person_avatars`

Current avatar presentation for a person; provider-specific legacy payload remains only in redacted import staging.

| Column | SQL definition | Purpose |
|---|---|---|
| `person_id` | `uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE` | Person whose avatar is configured. |
| `source` | `text NOT NULL DEFAULT 'default'` | default, file, external, gravatar, or generated. |
| `file_id` | `uuid REFERENCES files(id) ON DELETE SET NULL` | Uploaded/generated file if source=file. |
| `external_url` | `text` | External avatar URL, including imported Gravatar/Adorable URLs. |
| `background_color` | `text` | Generated default avatar background color. |
| `initials` | `text` | Generated initials, when precomputed. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (source IN ('default', 'file', 'external', 'gravatar', 'generated'))`

### `person_dates`

Important person dates with explicit precision. Replaces Monica special_dates and date pointers on contacts.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this date belongs to. |
| `kind` | `text NOT NULL` | birthday, deceased, first_met, anniversary, custom, or another app-defined kind. |
| `label` | `text` | Custom label for non-core dates. |
| `year` | `smallint` | Year component; null means intentionally unknown. |
| `month` | `smallint` | Month component; null means intentionally unknown. |
| `day` | `smallint` | Day component; null means intentionally unknown. |
| `precision` | `text NOT NULL DEFAULT 'full'` | Known-part precision: full, year_month, month_day, year, month, day, or unknown. |
| `is_year_approximate` | `boolean NOT NULL DEFAULT false` | Whether the stated year is approximate; false does not imply that an unknown year exists. |
| `is_age_based` | `boolean NOT NULL DEFAULT false` | Whether age should be computed/displayed when year is known. |
| `notes` | `text` | Additional notes about the date. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (month IS NULL OR month BETWEEN 1 AND 12)`
- `CHECK (day IS NULL OR day BETWEEN 1 AND 31)`
- `CHECK (year IS NULL OR year BETWEEN 1 AND 9999)`
- `CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown'))`
- `CONSTRAINT person_dates_is_year_approximate_ck CHECK (NOT is_year_approximate OR year IS NOT NULL)`
- `CHECK ( (precision = 'full' AND year IS NOT NULL AND month IS NOT NULL AND day IS NOT NULL) OR (precision = 'year_month' AND year IS NOT NULL AND month IS NOT NULL AND day IS NULL) OR (precision = 'month_day' AND year IS NULL AND month IS NOT NULL AND day IS NOT NULL) OR (precision = 'year' AND year IS NOT NULL AND month IS NULL AND day IS NULL) OR (precision = 'month' AND year IS NULL AND month IS NOT NULL AND day IS NULL) OR (precision = 'day' AND year IS NULL AND month IS NULL AND day IS NOT NULL) OR (precision = 'unknown' AND year IS NULL AND month IS NULL AND day IS NULL) )`

**Indexes**

- `CREATE INDEX person_dates_person_idx ON person_dates (person_id);`
- `CREATE INDEX person_dates_person_kind_idx ON person_dates (person_id, kind);`
- `CREATE INDEX person_dates_month_day_idx ON person_dates (month, day) WHERE month IS NOT NULL AND day IS NOT NULL;`
- `CREATE UNIQUE INDEX person_dates_singleton_kind_unique ON person_dates (person_id, kind) WHERE kind IN ('birthday', 'deceased', 'first_met');`

### `person_first_meetings`

First-met context separated from the person row. Replaces contacts.first_met_where/additional_info/through_contact.

| Column | SQL definition | Purpose |
|---|---|---|
| `person_id` | `uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE` | Person this first-meeting context describes. |
| `introduced_by_person_id` | `uuid REFERENCES people(id) ON DELETE SET NULL` | Person through whom this person was introduced. |
| `location_id` | `uuid` | Structured location where the first meeting happened, if known; the date itself is the person_dates row with kind=first_met. |
| `place_text` | `text` | Free-text place/context where the member first met the person. |
| `notes` | `text` | Additional first-met narrative. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (introduced_by_person_id IS NULL OR introduced_by_person_id <> person_id)`

**Deferred foreign keys**

- `ALTER TABLE person_first_meetings
  ADD CONSTRAINT person_first_meetings_location_fk
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;`

### `person_contact_methods`

Typed contact values such as email, phone, social profile, URL, and custom identifiers.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this value belongs to. |
| `type_id` | `uuid NOT NULL REFERENCES contact_method_types(id) ON DELETE RESTRICT` | Workspace contact-method type. |
| `value` | `text NOT NULL` | Raw user-entered value. |
| `normalized_value` | `text` | Normalized email/phone/URL for searching and deduplication. |
| `is_primary` | `boolean NOT NULL DEFAULT false` | Whether this is the primary value for its type/kind. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `notes` | `text` | Optional notes about the value. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX person_contact_methods_person_idx ON person_contact_methods (person_id);`
- `CREATE INDEX person_contact_methods_type_idx ON person_contact_methods (type_id);`
- `CREATE INDEX person_contact_methods_normalized_idx ON person_contact_methods (normalized_value) WHERE normalized_value IS NOT NULL;`
- `CREATE UNIQUE INDEX person_contact_methods_primary_per_type_unique ON person_contact_methods (person_id, type_id) WHERE is_primary;`

### `person_contact_method_labels`

Many-to-many labels for contact methods, preserving Monica's label pivot without forcing a single label.

| Column | SQL definition | Purpose |
|---|---|---|
| `contact_method_id` | `uuid NOT NULL REFERENCES person_contact_methods(id) ON DELETE CASCADE` | Contact method being labeled. |
| `label_id` | `uuid NOT NULL REFERENCES contact_labels(id) ON DELETE CASCADE` | Label assigned to the contact method. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (contact_method_id, label_id)`

**Indexes**

- `CREATE INDEX person_contact_method_labels_label_idx ON person_contact_method_labels (label_id);`

### `locations`

Structured postal/geographical place data. Replaces Monica places and is also used by weather/geocoding adapters.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this location. |
| `label` | `text` | Optional display label for the location. |
| `street` | `text` | Street address line. |
| `city` | `text` | City/locality. |
| `region` | `text` | Province/state/region. |
| `postal_code` | `text` | Postal or ZIP code. |
| `country` | `text` | Country name or code as entered/normalized by the application; not restricted to an import-specific code width. |
| `latitude` | `double precision` | Latitude coordinate. |
| `longitude` | `double precision` | Longitude coordinate. |
| `geocoded_at` | `timestamptz` | When coordinates were last geocoded. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)`
- `CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)`

**Indexes**

- `CREATE INDEX locations_workspace_idx ON locations (workspace_id);`
- `CREATE INDEX locations_geo_idx ON locations (workspace_id, latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;`

### `person_addresses`

Address links between people and locations. Replaces Monica addresses.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this address belongs to. |
| `location_id` | `uuid REFERENCES locations(id) ON DELETE SET NULL` | Structured location details. |
| `display_name` | `text` | Address display name, such as Home or Office. |
| `is_primary` | `boolean NOT NULL DEFAULT false` | Whether this is the primary address. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX person_addresses_person_idx ON person_addresses (person_id);`
- `CREATE INDEX person_addresses_location_idx ON person_addresses (location_id);`
- `CREATE UNIQUE INDEX person_addresses_primary_unique ON person_addresses (person_id) WHERE is_primary;`

### `person_address_labels`

Many-to-many labels for addresses.

| Column | SQL definition | Purpose |
|---|---|---|
| `address_id` | `uuid NOT NULL REFERENCES person_addresses(id) ON DELETE CASCADE` | Address being labeled. |
| `label_id` | `uuid NOT NULL REFERENCES contact_labels(id) ON DELETE CASCADE` | Label assigned to the address. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (address_id, label_id)`

**Indexes**

- `CREATE INDEX person_address_labels_label_idx ON person_address_labels (label_id);`

### `organizations`

Workspace organizations/employers. Replaces Monica companies.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this organization. |
| `name` | `text NOT NULL` | Organization/company name. |
| `website` | `text` | Organization website. |
| `employee_count` | `integer` | Approximate number of employees. |
| `notes` | `text` | Optional organization notes. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX organizations_workspace_idx ON organizations (workspace_id);`
- `CREATE UNIQUE INDEX organizations_workspace_name_unique ON organizations (workspace_id, lower(name));`

### `person_occupations`

Employment history and current work records. Replaces Monica occupations plus legacy contacts.company/job.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person with this occupation. |
| `organization_id` | `uuid REFERENCES organizations(id) ON DELETE SET NULL` | Employer/organization. |
| `title` | `text NOT NULL` | Job title or role. |
| `description` | `text` | Role description. |
| `salary_amount` | `numeric(19,4)` | Optional salary amount. |
| `salary_currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL` | Salary currency, if salary is stored. |
| `salary_unit` | `text` | Salary cadence/unit such as year, month, hour. |
| `is_current` | `boolean NOT NULL DEFAULT false` | Whether the person currently works here. |
| `start_on` | `date` | Occupation start date. |
| `end_on` | `date` | Occupation end date. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (salary_amount IS NULL OR salary_amount >= 0)`
- `CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)`

**Indexes**

- `CREATE INDEX person_occupations_person_idx ON person_occupations (person_id);`
- `CREATE INDEX person_occupations_org_idx ON person_occupations (organization_id);`

### `tags`

Workspace tags for grouping people. Replaces Monica tags.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this tag. |
| `name` | `text NOT NULL` | Tag display name. |
| `slug` | `text NOT NULL` | Stable slug generated from the tag name. |
| `description` | `text` | Tag description. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, slug)`

### `person_tags`

Many-to-many link between people and tags. Replaces Monica contact_tag.

| Column | SQL definition | Purpose |
|---|---|---|
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Tagged person. |
| `tag_id` | `uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE` | Assigned tag. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (person_id, tag_id)`

**Indexes**

- `CREATE INDEX person_tags_tag_idx ON person_tags (tag_id);`

### `pets`

Pets associated with a person. Replaces Monica pets.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person associated with the pet. |
| `category_id` | `uuid REFERENCES pet_categories(id) ON DELETE SET NULL` | Pet category. |
| `name` | `text` | Pet name. |
| `notes` | `text` | Optional pet notes. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX pets_person_idx ON pets (person_id);`
- `CREATE INDEX pets_category_idx ON pets (category_id);`

## Files

### `files`

Unified file metadata for photos, documents, avatars, exports, and import artifacts. File bytes live in object storage.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns the file and its storage lifecycle. |
| `uploaded_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who uploaded or generated the file. |
| `original_filename` | `text` | Original client filename. |
| `storage_provider` | `text NOT NULL DEFAULT 'local'` | Storage provider/disk such as local, s3, or gcs. |
| `storage_bucket` | `text` | Bucket/container name if applicable. |
| `storage_key` | `text` | Object-storage key or path. |
| `byte_size` | `bigint` | File size in bytes. |
| `mime_type` | `text` | MIME type. |
| `checksum_sha256` | `text` | SHA-256 checksum when available. |
| `status` | `text NOT NULL DEFAULT 'available'` | available, missing, deleted, processing, or quarantined. |
| `visibility` | `text NOT NULL DEFAULT 'private'` | private, workspace, or public. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Non-domain file metadata such as image dimensions. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete timestamp for file metadata. |

**Table constraints**

- `CHECK (byte_size IS NULL OR byte_size >= 0)`
- `CHECK (status IN ('available', 'missing', 'deleted', 'processing', 'quarantined'))`
- `CHECK (visibility IN ('private', 'workspace', 'public'))`

**Indexes**

- `CREATE INDEX files_workspace_idx ON files (workspace_id);`
- `CREATE INDEX files_storage_key_idx ON files (storage_provider, storage_bucket, storage_key);`
- `CREATE INDEX files_status_idx ON files (workspace_id, status);`

### `person_file_links`

Links files to people as photos, documents, or other person-owned attachments. Replaces photos, contact_photo, and documents.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person the file belongs to. |
| `file_id` | `uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE` | Linked file metadata. |
| `kind` | `text NOT NULL` | photo, document, avatar_candidate, or other app-defined kind. |
| `title` | `text` | Attachment title. |
| `description` | `text` | Attachment description. |
| `document_type` | `text` | Optional document classification. |
| `download_count` | `integer NOT NULL DEFAULT 0` | Download counter for document links. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (person_id, file_id, kind)`

**Indexes**

- `CREATE INDEX person_file_links_file_idx ON person_file_links (file_id);`

### `gift_file_links`

Links files to gifts, especially gift photos. Replaces Monica gift_photo.

| Column | SQL definition | Purpose |
|---|---|---|
| `gift_id` | `uuid NOT NULL REFERENCES gifts(id) ON DELETE CASCADE` | Gift. |
| `file_id` | `uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE` | Linked file. |
| `role` | `text NOT NULL DEFAULT 'photo'` | Role of file for the gift. |
| `sort_order` | `integer NOT NULL DEFAULT 0` | Display order. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (gift_id, file_id)`

**Indexes**

- `CREATE INDEX gift_file_links_file_idx ON gift_file_links (file_id);`

## Interactions

### `activities`

Multi-person interactions/events. Replaces Monica activities without denormalized contact counters.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this activity. |
| `activity_type_id` | `uuid REFERENCES activity_types(id) ON DELETE SET NULL` | Activity type. |
| `summary` | `text NOT NULL` | Short activity summary. |
| `description` | `text` | Detailed activity description. |
| `happened_at` | `timestamptz NOT NULL` | When the activity occurred; timestamp precision avoids losing Monica happened_at values. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the activity. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX activities_type_idx ON activities (activity_type_id);`
- `CREATE INDEX activities_workspace_time_idx ON activities (workspace_id, happened_at DESC);`

### `activity_participants`

People participating in an activity. Replaces Monica activity_contact.

| Column | SQL definition | Purpose |
|---|---|---|
| `activity_id` | `uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE` | Activity. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Participating person. |
| `role` | `text` | Optional participant role. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (activity_id, person_id)`

**Indexes**

- `CREATE INDEX activity_participants_person_idx ON activity_participants (person_id);`

### `activity_emotions`

Emotion tags attached to activities. Replaces Monica emotion_activity.

| Column | SQL definition | Purpose |
|---|---|---|
| `activity_id` | `uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE` | Activity. |
| `emotion_id` | `uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT` | Selected emotion. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (activity_id, emotion_id)`

**Indexes**

- `CREATE INDEX activity_emotions_emotion_idx ON activity_emotions (emotion_id);`

### `notes`

Free-form notes attached to people. Replaces Monica notes.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this note. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this note belongs to. |
| `body` | `text NOT NULL` | Note body. |
| `is_favorited` | `boolean NOT NULL DEFAULT false` | Favorite note flag. |
| `favorited_at` | `timestamptz` | When the note was marked favorite. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the note. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK ((is_favorited AND favorited_at IS NOT NULL) OR (NOT is_favorited))`

**Indexes**

- `CREATE INDEX notes_person_idx ON notes (person_id, created_at DESC);`
- `CREATE INDEX notes_favorite_idx ON notes (workspace_id, is_favorited);`

## Communications

### `calls`

Logged calls with a person. Replaces Monica calls.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this call. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person involved in the call. |
| `called_at` | `timestamptz NOT NULL` | When the call happened. |
| `contact_was_caller` | `boolean NOT NULL DEFAULT false` | Whether the person/contact was recorded as the caller; application views may derive labels without guessing during import. |
| `content` | `text` | Call notes/content. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who logged the call. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX calls_person_date_idx ON calls (person_id, called_at DESC);`
- `CREATE INDEX calls_workspace_date_idx ON calls (workspace_id, called_at DESC);`

### `call_emotions`

Emotion tags attached to calls. Replaces Monica emotion_call.

| Column | SQL definition | Purpose |
|---|---|---|
| `call_id` | `uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE` | Call. |
| `emotion_id` | `uuid NOT NULL REFERENCES emotion_options(id) ON DELETE RESTRICT` | Selected emotion. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `PRIMARY KEY (call_id, emotion_id)`

**Indexes**

- `CREATE INDEX call_emotions_emotion_idx ON call_emotions (emotion_id);`

### `conversation_threads`

Messaging/conversation thread with a person. Replaces Monica conversations.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this conversation. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this conversation is with. |
| `channel_type_id` | `uuid REFERENCES contact_method_types(id) ON DELETE SET NULL` | Channel type such as email, SMS, or social. |
| `contact_method_id` | `uuid REFERENCES person_contact_methods(id) ON DELETE SET NULL` | Specific contact method used, if known. |
| `happened_at` | `timestamptz NOT NULL` | Conversation start or representative date. |
| `title` | `text` | Optional thread title. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX conversation_threads_person_idx ON conversation_threads (person_id, happened_at DESC);`
- `CREATE INDEX conversation_threads_workspace_idx ON conversation_threads (workspace_id, happened_at DESC);`

### `messages`

Individual messages inside a conversation. Replaces Monica messages.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `conversation_id` | `uuid NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE` | Thread containing the message. |
| `content` | `text NOT NULL` | Message body. |
| `written_at` | `timestamptz NOT NULL` | When the message was written. |
| `direction` | `text NOT NULL` | inbound or outbound. |
| `author_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member author for outbound messages, if known. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (direction IN ('inbound', 'outbound'))`

**Indexes**

- `CREATE INDEX messages_conversation_idx ON messages (conversation_id, written_at);`

## Journal

### `journal_posts`

Manual journal entries. Replaces Monica entries with the journal date kept on the row.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this post. |
| `title` | `text` | Journal title. |
| `body` | `text NOT NULL` | Journal post body. |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` | Journal/timeline date. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who wrote the post. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX journal_posts_workspace_date_idx ON journal_posts (workspace_id, occurred_at DESC);`

### `journal_day_ratings`

Daily mood/rating records. Replaces Monica days.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this day rating. |
| `rated_on` | `date NOT NULL` | Calendar day being rated. |
| `rating` | `integer NOT NULL` | User's daily rating. |
| `comment` | `text` | Optional comment. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the rating. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, rated_on)`

### `journal_items`

Typed journal/timeline index. Replaces Monica polymorphic journal_entries with explicit nullable foreign keys.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this journal item. |
| `occurred_at` | `timestamptz NOT NULL` | Timeline date/time. |
| `activity_id` | `uuid REFERENCES activities(id) ON DELETE CASCADE` | Activity represented in the journal. |
| `journal_post_id` | `uuid REFERENCES journal_posts(id) ON DELETE CASCADE` | Journal post represented in the journal. |
| `day_rating_id` | `uuid REFERENCES journal_day_ratings(id) ON DELETE CASCADE` | Day rating represented in the journal. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the journal item. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (((activity_id IS NOT NULL)::int + (journal_post_id IS NOT NULL)::int + (day_rating_id IS NOT NULL)::int) = 1)`

**Indexes**

- `CREATE INDEX journal_items_workspace_date_idx ON journal_items (workspace_id, occurred_at DESC);`
- `CREATE UNIQUE INDEX journal_items_activity_unique ON journal_items (activity_id) WHERE activity_id IS NOT NULL;`
- `CREATE UNIQUE INDEX journal_items_post_unique ON journal_items (journal_post_id) WHERE journal_post_id IS NOT NULL;`
- `CREATE UNIQUE INDEX journal_items_day_rating_unique ON journal_items (day_rating_id) WHERE day_rating_id IS NOT NULL;`

## Life events

### `life_events`

Typed milestones for a person with precision-aware dates. Replaces Monica life_events.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this event. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person this life event belongs to. |
| `life_event_type_id` | `uuid REFERENCES life_event_types(id) ON DELETE SET NULL` | Life-event type. |
| `name` | `text` | Event display name. |
| `note` | `text` | Event notes. |
| `year` | `smallint` | Year component; null means unknown. |
| `month` | `smallint` | Month component; null means unknown. |
| `day` | `smallint` | Day component; null means unknown. |
| `happened_at` | `timestamptz` | Complete date/time when all relevant components are known. |
| `precision` | `text NOT NULL DEFAULT 'full'` | full, year_month, month_day, year, month, day, or unknown. |
| `specific_information` | `jsonb` | Type-specific information payload. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (month IS NULL OR month BETWEEN 1 AND 12)`
- `CHECK (day IS NULL OR day BETWEEN 1 AND 31)`
- `CHECK (year IS NULL OR year BETWEEN 1 AND 9999)`
- `CHECK (precision IN ('full', 'year_month', 'month_day', 'year', 'month', 'day', 'unknown'))`

**Indexes**

- `CREATE INDEX life_events_person_idx ON life_events (person_id);`
- `CREATE INDEX life_events_workspace_date_idx ON life_events (workspace_id, happened_at DESC);`

## Tasks and reminders

### `tasks`

Workspace or person-scoped tasks. Replaces Monica tasks and supports CalDAV through dav_objects.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this task. |
| `person_id` | `uuid REFERENCES people(id) ON DELETE SET NULL` | Related person, if any. |
| `title` | `text NOT NULL` | Task title. |
| `description` | `text` | Task description. |
| `status` | `text NOT NULL DEFAULT 'open'` | Task state: open, completed, or cancelled. |
| `due_at` | `timestamptz` | Optional due date/time. |
| `completed_at` | `timestamptz` | When the task was completed. |
| `completed_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who completed the task. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the task. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete timestamp. |

**Table constraints**

- `CHECK (status IN ('open', 'completed', 'cancelled'))`
- `CHECK (status <> 'completed' OR completed_at IS NOT NULL)`

**Indexes**

- `CREATE INDEX tasks_workspace_status_idx ON tasks (workspace_id, status);`
- `CREATE INDEX tasks_person_idx ON tasks (person_id);`
- `CREATE INDEX tasks_due_idx ON tasks (workspace_id, due_at) WHERE due_at IS NOT NULL;`

### `reminder_rules`

Workspace notification lead-time rules. Replaces Monica reminder_rules.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this rule. |
| `days_before` | `integer NOT NULL` | Number of days before an occurrence to notify. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether this rule is active. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (workspace_id, days_before)`
- `CHECK (days_before >= 0)`

**Indexes**

- `CREATE INDEX reminder_rules_active_idx ON reminder_rules (workspace_id, is_active);`

### `reminders`

Reminder definitions. Replaces Monica reminders plus birthday/deceased/first-met reminder pointer columns.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this reminder. |
| `person_id` | `uuid REFERENCES people(id) ON DELETE CASCADE` | Related person, if any. |
| `person_date_id` | `uuid REFERENCES person_dates(id) ON DELETE CASCADE` | Related important date, if this reminder is date-based. |
| `life_event_id` | `uuid REFERENCES life_events(id) ON DELETE CASCADE` | Related life event, if any. |
| `task_id` | `uuid REFERENCES tasks(id) ON DELETE CASCADE` | Related task, if any. |
| `target_kind` | `text NOT NULL DEFAULT 'custom'` | Reminder target kind: custom, person, person_date, life_event, or task. |
| `title` | `text` | Reminder title. |
| `description` | `text` | Reminder description. |
| `anchor_on` | `date NOT NULL` | Initial/anchor occurrence date. |
| `recurrence_unit` | `text NOT NULL DEFAULT 'none'` | none, day, week, month, or year. |
| `recurrence_interval` | `integer NOT NULL DEFAULT 1` | Interval count for recurrence_unit. |
| `send_time` | `time` | Local send time override; null uses workspace default. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether this reminder is active. |
| `can_delete` | `boolean NOT NULL DEFAULT true` | Whether members can delete it; false for generated core date reminders if desired. |
| `created_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who created the reminder. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete timestamp. |

**Table constraints**

- `CHECK (recurrence_interval > 0)`
- `CHECK (target_kind IN ('custom', 'person', 'person_date', 'life_event', 'task'))`
- `CHECK (recurrence_unit IN ('none', 'day', 'week', 'month', 'year'))`
- `CHECK (((person_date_id IS NOT NULL)::int + (life_event_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1)`
- `CHECK ( (target_kind = 'custom' AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person' AND person_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'person_date' AND person_date_id IS NOT NULL AND life_event_id IS NULL AND task_id IS NULL) OR (target_kind = 'life_event' AND life_event_id IS NOT NULL AND person_date_id IS NULL AND task_id IS NULL) OR (target_kind = 'task' AND task_id IS NOT NULL AND person_date_id IS NULL AND life_event_id IS NULL) )`

**Indexes**

- `CREATE INDEX reminders_workspace_active_idx ON reminders (workspace_id, is_active);`
- `CREATE INDEX reminders_person_idx ON reminders (person_id);`
- `CREATE INDEX reminders_anchor_idx ON reminders (workspace_id, anchor_on);`

### `reminder_occurrences`

Generated notification/occurrence rows. Replaces Monica reminder_outbox and reminders_sent.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `reminder_id` | `uuid NOT NULL REFERENCES reminders(id) ON DELETE CASCADE` | Reminder definition. |
| `member_id` | `uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE` | Member who will receive this occurrence. |
| `occurs_on` | `date NOT NULL` | Date of the underlying event/reminder occurrence. |
| `deliver_at` | `timestamptz NOT NULL` | Exact notification delivery time. |
| `lead_time_days` | `integer` | Lead time used to generate this occurrence. |
| `channel` | `text NOT NULL DEFAULT 'email'` | Delivery channel such as email, in_app, or webhook. |
| `status` | `text NOT NULL DEFAULT 'pending'` | pending, sent, skipped, failed, or cancelled. |
| `sent_at` | `timestamptz` | When notification was sent. |
| `title_snapshot` | `text` | Title at time of scheduling/sending. |
| `body_snapshot` | `text` | Body at time of scheduling/sending. |
| `error` | `text` | Failure details. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (lead_time_days IS NULL OR lead_time_days >= 0)`
- `CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'cancelled'))`

**Indexes**

- `CREATE INDEX reminder_occurrences_due_idx ON reminder_occurrences (status, deliver_at);`
- `CREATE INDEX reminder_occurrences_member_idx ON reminder_occurrences (member_id);`
- `CREATE UNIQUE INDEX reminder_occurrences_unique_delivery ON reminder_occurrences (reminder_id, member_id, deliver_at, channel);`

### `stay_in_touch_cadences`

Contact cadence settings. Replaces contacts.stay_in_touch_frequency and stay_in_touch_trigger_date.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person to stay in touch with. |
| `interval_count` | `integer NOT NULL` | Cadence interval count. |
| `interval_unit` | `text NOT NULL DEFAULT 'day'` | day, week, month, or year. |
| `next_due_at` | `timestamptz` | Next stay-in-touch trigger. |
| `last_contacted_at` | `timestamptz` | Last known contact time, including imported Monica last_talked_to when interaction history is incomplete. |
| `last_triggered_at` | `timestamptz` | Last generated trigger. |
| `reminder_id` | `uuid REFERENCES reminders(id) ON DELETE SET NULL` | Generated/linked reminder definition. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether the cadence is active. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (person_id)`
- `CHECK (interval_count > 0)`
- `CHECK (interval_unit IN ('day', 'week', 'month', 'year'))`

**Indexes**

- `CREATE INDEX stay_in_touch_due_idx ON stay_in_touch_cadences (is_active, next_due_at) WHERE is_active AND next_due_at IS NOT NULL;`

## Relationships

### `relationships`

Directional person-to-person relationship edges. Replaces Monica relationships.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this edge. |
| `from_person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Subject/source person. |
| `to_person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Object/target person. |
| `relationship_type_id` | `uuid NOT NULL REFERENCES relationship_types(id) ON DELETE RESTRICT` | Directional relationship type. |
| `status` | `text NOT NULL DEFAULT 'active'` | Relationship state: active or ended. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (from_person_id <> to_person_id)`
- `UNIQUE (from_person_id, to_person_id, relationship_type_id)`
- `CHECK (status IN ('active', 'ended'))`

**Indexes**

- `CREATE INDEX relationships_to_idx ON relationships (to_person_id);`
- `CREATE INDEX relationships_workspace_idx ON relationships (workspace_id);`

### `romantic_relationship_details`

Optional relationship-specific metadata for romantic/love relationships. Replaces Monica metadata_love_relationships.

| Column | SQL definition | Purpose |
|---|---|---|
| `relationship_id` | `uuid PRIMARY KEY REFERENCES relationships(id) ON DELETE CASCADE` | Relationship edge these details describe. |
| `notes` | `text` | Relationship notes. |
| `met_at` | `timestamptz` | When the couple met. |
| `official_at` | `timestamptz` | When the relationship became official. |
| `ended_at` | `timestamptz` | Breakup/end timestamp. |
| `breakup_reason` | `text` | Breakup reason. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (ended_at IS NULL OR official_at IS NULL OR ended_at >= official_at)`

## Gifts and debts

### `gifts`

Gift ideas and gift history associated with a person, optionally intended for a specific related person. Replaces Monica gifts.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this gift. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Primary person whose profile owns the gift record. |
| `recipient_person_id` | `uuid REFERENCES people(id) ON DELETE SET NULL` | Optional person the gift is specifically intended for; null means no particular recipient. |
| `name` | `text NOT NULL` | Gift name. |
| `url` | `text` | External gift URL. |
| `comment` | `text` | Gift notes/comment. |
| `status` | `text NOT NULL DEFAULT 'idea'` | idea, planned, given, received, archived, or custom status. |
| `event_at` | `timestamptz` | Date/time the gift was/will be given or received. |
| `amount` | `numeric(19,4)` | Gift amount using decimal currency value. |
| `currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL` | Gift currency. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (amount IS NULL OR amount >= 0)`

**Indexes**

- `CREATE INDEX gifts_person_idx ON gifts (person_id);`
- `CREATE INDEX gifts_recipient_idx ON gifts (recipient_person_id) WHERE recipient_person_id IS NOT NULL;`
- `CREATE INDEX gifts_status_idx ON gifts (workspace_id, status);`
- `CREATE INDEX gifts_event_idx ON gifts (workspace_id, event_at) WHERE event_at IS NOT NULL;`

### `debts`

Money owed by or to a person. Replaces Monica debts.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this debt. |
| `person_id` | `uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE` | Person involved in the debt. |
| `direction` | `text NOT NULL` | Debt direction: i_owe when the user owes the person; they_owe when the person owes the user. |
| `status` | `text NOT NULL DEFAULT 'open'` | Debt lifecycle state: open, settled, or cancelled. |
| `amount` | `numeric(19,4) NOT NULL` | Debt amount using decimal currency value. |
| `currency_code` | `char(3) REFERENCES currencies(code) ON DELETE SET NULL` | Debt currency. |
| `reason` | `text` | Reason for the debt. |
| `settled_at` | `timestamptz` | When the debt was settled. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (direction IN ('i_owe', 'they_owe'))`
- `CHECK (status IN ('open', 'settled', 'cancelled'))`
- `CHECK (amount >= 0)`
- `CHECK (status <> 'settled' OR settled_at IS NOT NULL)`

**Indexes**

- `CREATE INDEX debts_person_idx ON debts (person_id);`
- `CREATE INDEX debts_status_idx ON debts (workspace_id, status);`

## Integrations

### `dav_address_books`

Local CardDAV address books. Replaces Monica addressbooks.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this address book. |
| `owner_member_id` | `uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE` | Member that owns the address book. |
| `name` | `text NOT NULL` | Address book name. |
| `description` | `text` | Address book description. |
| `uri` | `text` | DAV URI/slug for the local address book. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (owner_member_id, uri)`

**Indexes**

- `CREATE INDEX dav_address_books_workspace_idx ON dav_address_books (workspace_id);`

### `dav_address_book_subscriptions`

Remote CardDAV subscriptions and encrypted sync credentials. Replaces Monica addressbook_subscriptions.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this subscription. |
| `owner_member_id` | `uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE` | Member who owns the subscription. |
| `local_address_book_id` | `uuid REFERENCES dav_address_books(id) ON DELETE SET NULL` | Local address book used for synchronized contacts. |
| `name` | `text NOT NULL` | Subscription name. |
| `remote_url` | `text NOT NULL` | Remote CardDAV URL/URI. |
| `username` | `text` | Remote DAV username. |
| `encrypted_password` | `text` | Encrypted remote DAV password/token. |
| `is_readonly` | `boolean NOT NULL DEFAULT false` | Whether the remote book is read-only. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether synchronization is active. |
| `capabilities` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Remote server capabilities. |
| `remote_sync_token` | `text` | Remote sync token. |
| `local_sync_token` | `text` | Local sync marker. |
| `last_synced_at` | `timestamptz` | Last synchronization timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX dav_subscriptions_workspace_idx ON dav_address_book_subscriptions (workspace_id);`
- `CREATE INDEX dav_subscriptions_active_idx ON dav_address_book_subscriptions (workspace_id, is_active);`

### `dav_objects`

Per-object DAV state kept outside domain rows. Replaces contacts.vcard/distant_etag/address_book_id and CalDAV task state.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this DAV object. |
| `address_book_id` | `uuid REFERENCES dav_address_books(id) ON DELETE CASCADE` | Local address book. |
| `subscription_id` | `uuid REFERENCES dav_address_book_subscriptions(id) ON DELETE SET NULL` | Remote subscription source, if any. |
| `object_kind` | `text NOT NULL` | DAV object kind: person or task. |
| `person_id` | `uuid REFERENCES people(id) ON DELETE CASCADE` | Person represented by this DAV object. |
| `task_id` | `uuid REFERENCES tasks(id) ON DELETE CASCADE` | Task represented by this DAV object. |
| `remote_uid` | `text` | Remote UID/UID property. |
| `href` | `text` | Remote/local DAV href. |
| `etag` | `text` | Remote ETag. |
| `vcard` | `text` | Cached vCard payload for contacts. |
| `icalendar` | `text` | Cached iCalendar/VTODO payload for tasks/calendars. |
| `sync_status` | `text NOT NULL DEFAULT 'synced'` | Synchronization state: synced, dirty, conflict, deleted, or error. |
| `last_synced_at` | `timestamptz` | Last sync timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |
| `deleted_at` | `timestamptz` | Soft-delete/tombstone timestamp for sync. |

**Table constraints**

- `CHECK (((person_id IS NOT NULL)::int + (task_id IS NOT NULL)::int) <= 1)`
- `CHECK (object_kind IN ('person', 'task'))`
- `CHECK (sync_status IN ('synced', 'dirty', 'conflict', 'deleted', 'error'))`
- `CHECK ( (object_kind = 'person' AND person_id IS NOT NULL AND task_id IS NULL) OR (object_kind = 'task' AND task_id IS NOT NULL AND person_id IS NULL) )`

**Indexes**

- `CREATE INDEX dav_objects_person_idx ON dav_objects (person_id);`
- `CREATE INDEX dav_objects_task_idx ON dav_objects (task_id);`
- `CREATE INDEX dav_objects_href_idx ON dav_objects (workspace_id, href) WHERE href IS NOT NULL;`

### `dav_sync_tokens`

DAV sync token ledger. Replaces Monica synctoken.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace that owns this sync token. |
| `member_id` | `uuid NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE` | Member/principal. |
| `collection_name` | `text NOT NULL DEFAULT 'contacts'` | DAV collection name such as contacts, tasks, birthdays. |
| `sync_token` | `text NOT NULL` | Issued sync token. |
| `issued_at` | `timestamptz NOT NULL DEFAULT now()` | When the token was issued. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX dav_sync_tokens_member_idx ON dav_sync_tokens (member_id, collection_name);`
- `CREATE UNIQUE INDEX dav_sync_tokens_value_unique ON dav_sync_tokens (member_id, collection_name, sync_token);`

### `location_weather_cache`

Optional cached weather payloads for locations. Replaces Monica weather but is safe to clear/re-fetch.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `location_id` | `uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE` | Location weather was fetched for. |
| `provider` | `text NOT NULL` | Weather provider name. |
| `payload` | `jsonb NOT NULL` | Provider response payload. |
| `fetched_at` | `timestamptz NOT NULL DEFAULT now()` | When weather was fetched. |
| `expires_at` | `timestamptz` | When cache should be considered stale. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX location_weather_cache_location_idx ON location_weather_cache (location_id, provider);`
- `CREATE INDEX location_weather_cache_expiry_idx ON location_weather_cache (expires_at);`

## Import/export

### `data_imports`

Import run metadata for Monica SQL/JSON/raw backups, vCard, CSV, and future sources. Replaces Monica import_jobs at the canonical layer.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace being imported into. |
| `requested_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who requested the import. |
| `source_system` | `text NOT NULL` | monica, vcard, csv, manual, or other source system. |
| `source_profile` | `text` | sql_export, json_export, raw_backup, storage_archive, etc. |
| `status` | `text NOT NULL DEFAULT 'pending'` | pending, dry_run, running, completed, failed, or cancelled. |
| `artifact_file_id` | `uuid REFERENCES files(id) ON DELETE SET NULL` | Uploaded import artifact. |
| `started_at` | `timestamptz` | Import start timestamp. |
| `completed_at` | `timestamptz` | Import completion timestamp. |
| `stats` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Counts and summary statistics. |
| `error` | `text` | Top-level error message. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (status IN ('pending', 'dry_run', 'running', 'completed', 'failed', 'cancelled'))`

**Indexes**

- `CREATE INDEX data_imports_workspace_idx ON data_imports (workspace_id, created_at DESC);`
- `CREATE INDEX data_imports_status_idx ON data_imports (status);`

### `data_import_entities`

Source-to-target identity map for imports. This is where Monica table names/ids/UUIDs live, not in domain tables.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `import_id` | `uuid NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE` | Import run. |
| `source_table` | `text NOT NULL` | Original source table/entity name. |
| `source_primary_key` | `text` | Original source primary key as text. |
| `source_uuid` | `uuid` | Original source UUID if present. |
| `source_fingerprint` | `text` | Hash/fingerprint for rows without stable ids. |
| `target_table` | `text` | Canonical target table name. |
| `target_key` | `text` | Canonical target key serialized as text; supports UUIDs, natural keys such as currency codes, and deterministic composite keys. |
| `status` | `text NOT NULL DEFAULT 'mapped'` | mapped, skipped, orphaned, warning, failed. |
| `warnings` | `jsonb NOT NULL DEFAULT '[]'::jsonb` | Warnings for this source row. |
| `raw_snapshot` | `jsonb` | Redacted source-row snapshot for diagnostics and lossless non-secret import review; password, token, session, and private-key values are never stored. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `CHECK (status IN ('mapped', 'skipped', 'orphaned', 'warning', 'failed'))`

**Indexes**

- `CREATE INDEX data_import_entities_target_idx ON data_import_entities (target_table, target_key) WHERE target_key IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_source_unique ON data_import_entities (import_id, source_table, source_primary_key) WHERE source_primary_key IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_uuid_unique ON data_import_entities (import_id, source_table, source_uuid) WHERE source_uuid IS NOT NULL;`
- `CREATE UNIQUE INDEX data_import_entities_fingerprint_unique ON data_import_entities (import_id, source_table, source_fingerprint) WHERE source_fingerprint IS NOT NULL;`

### `data_import_reports`

Per-row or per-person import report entries. Replaces Monica import_job_reports and powers dry-run review.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `import_id` | `uuid NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE` | Import run. |
| `entity_id` | `uuid REFERENCES data_import_entities(id) ON DELETE CASCADE` | Mapped entity this report is about. |
| `severity` | `text NOT NULL DEFAULT 'info'` | info, warning, error, skipped. |
| `message` | `text NOT NULL` | Report message. |
| `details` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Structured report details. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `CHECK (severity IN ('info', 'warning', 'error', 'skipped'))`

**Indexes**

- `CREATE INDEX data_import_reports_import_idx ON data_import_reports (import_id, severity);`

### `data_exports`

Export job metadata and manifest. Replaces Monica export_jobs with versioned manifests.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace being exported. |
| `requested_by_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who requested the export. |
| `format` | `text NOT NULL` | json, sql, csv, vcard, or archive. |
| `status` | `text NOT NULL DEFAULT 'pending'` | Export state: pending, running, completed, failed, expired, or cancelled. |
| `file_id` | `uuid REFERENCES files(id) ON DELETE SET NULL` | Generated export file. |
| `manifest` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Versioned export manifest with checksums and row counts. |
| `started_at` | `timestamptz` | Export start timestamp. |
| `completed_at` | `timestamptz` | Export completion timestamp. |
| `expires_at` | `timestamptz` | When the export should be deleted. |
| `error` | `text` | Top-level error message. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired', 'cancelled'))`

**Indexes**

- `CREATE INDEX data_exports_workspace_idx ON data_exports (workspace_id, created_at DESC);`
- `CREATE INDEX data_exports_status_idx ON data_exports (status);`

## Audit

### `audit_events`

Append-only account/contact audit history. Replaces Monica audit_logs with JSON payloads.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this event belongs to. |
| `actor_member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Member who caused the event. |
| `actor_name_snapshot` | `text` | Actor display name at event time. |
| `person_id` | `uuid REFERENCES people(id) ON DELETE SET NULL` | Person this event is about, if any. |
| `subject_type` | `text` | Subject table/entity type. |
| `subject_id` | `uuid` | Subject id, when it is a UUID domain row. |
| `action` | `text NOT NULL` | Action key. |
| `payload` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Structured event payload. |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` | Domain event timestamp. |
| `visible_on_dashboard` | `boolean NOT NULL DEFAULT false` | Whether the event appears in dashboard/activity feeds. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE INDEX audit_events_workspace_time_idx ON audit_events (workspace_id, occurred_at DESC);`
- `CREATE INDEX audit_events_person_idx ON audit_events (person_id, occurred_at DESC);`
- `CREATE INDEX audit_events_action_idx ON audit_events (workspace_id, action);`

## API

### `api_request_logs`

API usage logging and throttling analytics. Replaces Monica api_usage with richer request context.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE SET NULL` | Workspace associated with the request, if authenticated. |
| `user_id` | `uuid REFERENCES users(id) ON DELETE SET NULL` | Authenticated user, if any. |
| `member_id` | `uuid REFERENCES workspace_members(id) ON DELETE SET NULL` | Workspace member, if any. |
| `method` | `text NOT NULL` | HTTP method. |
| `path` | `text NOT NULL` | Request path or route. |
| `client_ip` | `inet` | Client IP address. |
| `user_agent` | `text` | User agent. |
| `status_code` | `integer` | HTTP response status. |
| `occurred_at` | `timestamptz NOT NULL DEFAULT now()` | Request timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `authentication_subject_digest` | `text` | Nullable versioned keyed digest of a normalized authentication subject. Values match `hmac-sha256:v<positive-integer>:<64 lowercase hex>`. Raw email addresses and challenge tokens are forbidden. |

**Indexes**

- `CREATE INDEX api_request_logs_time_idx ON api_request_logs (occurred_at DESC);`
- `CREATE INDEX api_request_logs_workspace_idx ON api_request_logs (workspace_id, occurred_at DESC);`
- `CREATE INDEX api_request_logs_auth_subject_idx ON api_request_logs (path, client_ip, authentication_subject_digest, occurred_at DESC) WHERE authentication_subject_digest IS NOT NULL AND method = 'POST' AND status_code = 401;`

**Constraints**

- `api_request_logs_auth_subject_digest_ck` permits `NULL` or the versioned
  `hmac-sha256:v<positive-integer>:<64 lowercase hex>` representation only.

### `api_tokens`

Personal access/API tokens. Replaces Monica account API keys and Passport personal tokens for first-party API access.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who owns the token. |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE CASCADE` | Optional workspace scope. |
| `name` | `text NOT NULL` | Token display name. |
| `token_hash` | `text NOT NULL` | Hash of token secret. |
| `scopes` | `text[] NOT NULL DEFAULT '{}'::text[]` | Granted API scopes. |
| `last_used_at` | `timestamptz` | Last use timestamp. |
| `expires_at` | `timestamptz` | Expiration timestamp. |
| `revoked_at` | `timestamptz` | Revocation timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens (token_hash);`
- `CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);`
- `CREATE INDEX api_tokens_workspace_idx ON api_tokens (workspace_id);`

### `oauth_clients`

OAuth2 clients if the app exposes a built-in OAuth provider. Replaces Monica oauth_clients and personal_access_clients.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `owner_user_id` | `uuid REFERENCES users(id) ON DELETE SET NULL` | User that owns the client, if personal/client-created. |
| `name` | `text NOT NULL` | Client name. |
| `user_provider` | `text` | Optional user-provider identifier used by grant flows. |
| `secret_hash` | `text` | Hash of client secret. |
| `redirect_uris` | `text[] NOT NULL DEFAULT '{}'::text[]` | Exact redirect URIs registered for this client. |
| `allowed_grants` | `text[] NOT NULL DEFAULT '{}'::text[]` | OAuth grant types enabled for this client. |
| `scopes` | `text[] NOT NULL DEFAULT '{}'::text[]` | Scopes this client may request. |
| `is_confidential` | `boolean NOT NULL DEFAULT true` | Whether client can keep a secret. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether client is active. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Indexes**

- `CREATE INDEX oauth_clients_owner_idx ON oauth_clients (owner_user_id);`

### `oauth_authorization_codes`

OAuth authorization codes. Replaces Monica oauth_auth_codes.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `client_id` | `uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE` | OAuth client. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Authorizing user. |
| `code_hash` | `text NOT NULL` | Hash of authorization code. |
| `scopes` | `text[] NOT NULL DEFAULT '{}'::text[]` | Scopes approved for the authorization code. |
| `redirect_uri` | `text` | Redirect URI used. |
| `expires_at` | `timestamptz NOT NULL` | Expiration timestamp. |
| `used_at` | `timestamptz` | When code was consumed. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE UNIQUE INDEX oauth_authorization_codes_hash_idx ON oauth_authorization_codes (code_hash);`
- `CREATE INDEX oauth_authorization_codes_user_idx ON oauth_authorization_codes (user_id);`

### `oauth_access_tokens`

OAuth access tokens. Replaces Monica oauth_access_tokens.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `client_id` | `uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE` | OAuth client. |
| `user_id` | `uuid REFERENCES users(id) ON DELETE CASCADE` | User subject, if any. |
| `token_hash` | `text NOT NULL` | Hash of access token. |
| `scopes` | `text[] NOT NULL DEFAULT '{}'::text[]` | Scopes granted to the access token. |
| `expires_at` | `timestamptz NOT NULL` | Expiration timestamp. |
| `revoked_at` | `timestamptz` | Revocation timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE UNIQUE INDEX oauth_access_tokens_hash_idx ON oauth_access_tokens (token_hash);`
- `CREATE INDEX oauth_access_tokens_user_idx ON oauth_access_tokens (user_id);`

### `oauth_refresh_tokens`

OAuth refresh tokens. Replaces Monica oauth_refresh_tokens.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `access_token_id` | `uuid NOT NULL REFERENCES oauth_access_tokens(id) ON DELETE CASCADE` | Access token this refresh token belongs to. |
| `token_hash` | `text NOT NULL` | Hash of refresh token. |
| `expires_at` | `timestamptz NOT NULL` | Expiration timestamp. |
| `revoked_at` | `timestamptz` | Revocation timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE UNIQUE INDEX oauth_refresh_tokens_hash_idx ON oauth_refresh_tokens (token_hash);`

## Compliance

### `legal_documents`

Versioned legal/compliance documents. Replaces Monica terms.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `document_type` | `text NOT NULL` | terms, privacy, dpa, or other policy type. |
| `version` | `text NOT NULL` | Policy version string. |
| `content` | `text NOT NULL` | Policy content, markdown/html/plain text depending on renderer. |
| `published_at` | `timestamptz` | When this version became active. |
| `is_active` | `boolean NOT NULL DEFAULT true` | Whether this document can be accepted by users. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (document_type, version)`

**Indexes**

- `CREATE INDEX legal_documents_active_idx ON legal_documents (document_type, is_active);`
- `CREATE UNIQUE INDEX legal_documents_one_active_per_type ON legal_documents (document_type) WHERE is_active;`

### `legal_acceptances`

Immutable record that a user accepted a legal-document version, optionally in a workspace context.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace context for acceptance, if applicable. |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | User who accepted the document. |
| `legal_document_id` | `uuid NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT` | Accepted legal document. |
| `ip_address` | `inet` | IP address captured at acceptance. |
| `accepted_at` | `timestamptz NOT NULL DEFAULT now()` | Acceptance timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Indexes**

- `CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id);`

## Billing

### `billing_customers`

Payment-provider customer state kept separate from workspaces. Replaces Stripe fields on Monica accounts.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace billed through this provider customer. |
| `provider` | `text NOT NULL DEFAULT 'stripe'` | Billing provider. |
| `provider_customer_id` | `text NOT NULL` | Provider customer id. |
| `trial_ends_at` | `timestamptz` | Trial expiration timestamp. |
| `complimentary_until` | `timestamptz` | Free/complimentary access expiration, if any. |
| `payment_method_type` | `text` | Card/payment method brand/type. |
| `payment_method_last_four` | `text` | Last four digits of current payment method. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Provider-specific billing metadata. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (provider, provider_customer_id)`
- `UNIQUE (workspace_id, provider)`

### `billing_subscriptions`

Subscription records from the billing provider. Replaces Monica subscriptions.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `billing_customer_id` | `uuid NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE` | Provider customer that owns this subscription and determines its workspace and billing provider. |
| `provider_subscription_id` | `text NOT NULL` | Subscription id within the provider/customer context. |
| `name` | `text NOT NULL DEFAULT 'default'` | Subscription name. |
| `status` | `text NOT NULL` | Provider subscription status. |
| `quantity` | `integer` | Subscription quantity. |
| `trial_ends_at` | `timestamptz` | Trial end timestamp. |
| `current_period_ends_at` | `timestamptz` | Current billing period end. |
| `ends_at` | `timestamptz` | Cancellation/end timestamp. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (billing_customer_id, provider_subscription_id)`
- `CHECK (quantity IS NULL OR quantity >= 0)`

**Indexes**

- `CREATE INDEX billing_subscriptions_customer_status_idx ON billing_subscriptions (billing_customer_id, status);`

### `billing_subscription_items`

Subscription item rows from the billing provider. Replaces Monica subscription_items.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `subscription_id` | `uuid NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE` | Parent subscription. |
| `provider_item_id` | `text NOT NULL` | Provider subscription item id. |
| `provider_price_id` | `text NOT NULL` | Provider price id. |
| `provider_product_id` | `text` | Provider product id. |
| `quantity` | `integer` | Item quantity. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `UNIQUE (subscription_id, provider_item_id)`
- `CHECK (quantity IS NULL OR quantity >= 0)`

## Operations

### `scheduled_job_runs`

Scheduler/job observability. Replaces Monica crons and job status needs without coupling to a queue implementation.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `job_key` | `text NOT NULL` | Stable scheduled job key/command. |
| `status` | `text NOT NULL DEFAULT 'running'` | running, succeeded, failed, skipped. |
| `started_at` | `timestamptz NOT NULL DEFAULT now()` | Run start timestamp. |
| `finished_at` | `timestamptz` | Run finish timestamp. |
| `error` | `text` | Error message if failed. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Job run metadata. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `CHECK (status IN ('running', 'succeeded', 'failed', 'skipped'))`

**Indexes**

- `CREATE INDEX scheduled_job_runs_key_idx ON scheduled_job_runs (job_key, started_at DESC);`

### `app_instances`

Self-hosted instance metadata and update-check state. Replaces Monica instances.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `public_instance_id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | Public anonymous instance id for optional telemetry/update checks. |
| `current_version` | `text` | Currently running app version. |
| `latest_known_version` | `text` | Latest version seen by update check. |
| `latest_release_notes` | `text` | Release notes from last update check. |
| `versions_behind` | `integer` | Number of known releases between current and latest versions, when calculated. |
| `last_checked_at` | `timestamptz` | Last update-check timestamp. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'::jsonb` | Instance metadata. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Last update timestamp in UTC; maintained by application or trigger. |

**Table constraints**

- `CHECK (versions_behind IS NULL OR versions_behind >= 0)`

**Indexes**

- `CREATE UNIQUE INDEX app_instances_public_idx ON app_instances (public_instance_id);`

### `statistics_snapshots`

Optional aggregate statistics snapshots for public/admin dashboards. Replaces Monica statistics without 30 fixed counter columns.

| Column | SQL definition | Purpose |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable public primary key used by APIs, exports, imports, and internal references. |
| `workspace_id` | `uuid REFERENCES workspaces(id) ON DELETE CASCADE` | Workspace this snapshot covers; null for instance-wide snapshot. |
| `scope` | `text NOT NULL DEFAULT 'workspace'` | workspace or instance. |
| `captured_at` | `timestamptz NOT NULL DEFAULT now()` | When counters were captured. |
| `counters` | `jsonb NOT NULL` | Named counters, such as contacts, activities, reminders, conversations. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Creation timestamp in UTC. |

**Table constraints**

- `CHECK (scope IN ('instance', 'workspace'))`
- `CHECK ((scope = 'instance' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL))`

**Indexes**

- `CREATE INDEX statistics_snapshots_scope_idx ON statistics_snapshots (scope, captured_at DESC);`
- `CREATE INDEX statistics_snapshots_workspace_idx ON statistics_snapshots (workspace_id, captured_at DESC);`
## Deliberately retained complexities

- `person_first_meetings` remains separate because a first meeting has a date, introducer, structured location, free-form place, and notes.
- `journal_items` remains a one-of timeline projection because journal order spans activities, posts, and day ratings.
- `reminders` retains nullable target foreign keys with checks because referential integrity is preferable to a generic `target_type/target_id` pair.
- `audit_events.subject_type/subject_id` remains polymorphic because audit history must survive subject deletion and cover optional modules.
- `data_import_entities.target_table/target_key` remains polymorphic only inside import metadata; it is not a domain relationship.
- Provider-specific JSON remains only where the provider schema is genuinely external or variable.

## Required test contract

The implementation should treat the schema as a behavioral contract, not only DDL. Production workflows require unit, integration, and end-to-end coverage, including:

- workspace isolation and rejection of cross-workspace references;
- partial-date round trips and birthday/reminder scheduling;
- Monica fixture imports with row-count and field-level reconciliation;
- file imports with and without the storage archive;
- reminder regeneration and idempotent occurrence generation;
- relationship direction/reverse labels;
- gift recipient resolution and debt direction mapping;
- DAV sync conflict, deletion, and token behavior when the module is enabled;
- security migration behavior proving old sessions/tokens/recovery codes are not activated;
- optional-module disabled behavior proving core CRM functions do not depend on billing, DAV, OAuth, weather, or operations tables.

## Generated consistency checks

- SQL tables parsed: **87**.
- SQL columns parsed: **814**.
- Table and column comments: **87 / 814**.
- Explicit indexes: **145**, all names unique.
- Foreign-key references checked: **168**, no missing target table/column.
- Forward references are limited to the two explicitly deferred constraints: member self-person and first-meeting location.
- Monica table mappings: **94/94**.
- Monica field mappings: **823/823**.
