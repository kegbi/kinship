# Personal CRM schema re-audit — audited v3

## Executive verdict

The previous v3 draft was mechanically synchronized but still contained two material semantic errors and one avoidable duplication: it interpreted Monica `gifts.is_for` as gift direction, translated `calls.contact_called` into an unproven inbound/outbound enum, and stored both a complete `date_value` and partial-date components. Those issues are corrected here.

The final audited baseline contains **87 tables and 811 fields**, maps **94/94 Monica tables and 823/823 Monica columns**, and is smaller than the original 88-table/856-field proposal. The reduction comes from removing derived/duplicated state, not from dropping product data.

## Audit evidence and limits

The audit cross-compared the 94-table/823-column Monica export inventory, v1 SQL/specification, the prior v3 SQL/specification, table and column mappings, and every final SQL table/field/comment/constraint/index/foreign key.

The SQL was structurally parsed and cross-validated, but no PostgreSQL server was installed here; CI must still apply and roll back the migration on an ephemeral supported PostgreSQL version.

## Material inconsistencies found and corrected

### 1. Gifts: recipient relation, not direction

Monica `gifts.is_for` is an optional contact reference. The prior draft replaced `recipient_person_id` with `direction`, losing the ability to identify a particular recipient and inventing a meaning not represented by that field. The final table restores `recipient_person_id`; null/zero source values mean no particular recipient.

### 2. Calls: preserve the source boolean exactly

The prior draft converted `contact_called` to `direction`. Because the source model exposes only a boolean, the importer should not encode an unverified inversion. The final field is `contact_was_caller boolean`; presentation code can derive labels.

### 3. Person dates: one source of truth

`person_dates.date_value` duplicated `year/month/day/precision` and could disagree. It is removed. A precision-shape check guarantees that known components match the declared precision.

### 4. Reminder sent history: no invented recipient

Monica sent-history rows do not identify a member recipient, while canonical occurrences require one. The importer now writes an `audit_events` history row and updates an occurrence only after exact correlation with one imported outbox row. It does not loosen the canonical recipient constraint for compatibility.

### 5. Source soft deletion

`contacts.deleted_at` now maps only to `people.deleted_at`. It no longer falsely marks files, reminders, or DAV objects deleted; those children remain attached and hidden through aggregate lifecycle.

### 6. Closed workflow integrity

Checks were added for file state/visibility, avatar source, occurrence status, cadence unit, DAV sync status, import/export workflow states, import report severity, and scheduled job state. These are closed application workflows, not user-extensible vocabularies.

### 7. Focused reverse/idempotency indexes

Reverse indexes were added only where a real query or deletion path needs them (label/emotion lookup and gift recipient). Journal target partial unique indexes prevent one activity/post/day rating from appearing twice. The schema does not blindly index every low-selectivity audit/creator foreign key.

## Complexity and coverage

| Measure | v1 | audited v3 | Result |
|---|---:|---:|---|
| Tables | 88 | 87 | One derived table removed |
| Fields | 856 | 811 | 45 fewer fields while restoring omitted source data |
| Explicit indexes | 152 | 144 | Focused indexes only |
| Foreign keys | 201 | 168 | Duplicated child ownership removed |
| Table constraints | 33 | 91 | More semantic integrity, no new entities |
| JSONB fields | 20 | 17 | Generic settings/preferences buckets removed |
| `workspace_id` fields | — | 44 | Kept on aggregate roots, not strict children |

## Source-column retention summary

| Treatment | Count |
|---|---:|
| `canonical_or_identity_preserved` | 689 |
| `not_activated` | 35 |
| `policy_review` | 1 |
| `recomputed_or_reconciled` | 12 |
| `redacted_audit_only` | 41 |
| `semantic_seed_preserved` | 45 |

Every source column has a target or explicit treatment. “Not activated” applies to obsolete/runtime secrets, not business data; non-secret metadata can still be reported in redacted import diagnostics.

## Canonical field-class summary

| Field class | Count |
|---|---:|
| `business_data` | 211 |
| `business_flag` | 1 |
| `identifier` | 80 |
| `lifecycle_or_policy` | 48 |
| `money` | 7 |
| `numeric_measure` | 24 |
| `reference` | 127 |
| `security` | 15 |
| `structured_or_multi_value` | 24 |
| `temporal` | 231 |
| `tenant_boundary` | 43 |

The complete field-by-field analysis is `personal_crm_field_catalog_v3.csv`. It contains the SQL definition, nullability, default, primary/foreign-key status, purpose, class, and v1→v3 change for every canonical field.

## Full table-by-table review

| Table | Module | V1 fields | Audited fields | Field changes | Review result |
|---|---|---:|---:|---|---|
| `currencies` | Foundation | 7 | 7 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `workspaces` | Foundation | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `workspace_members` | Foundation | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `member_preferences` | Foundation | 14 | 11 | +measurement_system, +ui_state, -default_dashboard_tab, -default_gifts_tab, -default_profile_tab, -dismissed_flags, -preferences | Retained at the current boundary; fields are individually documented in the field catalog. |
| `users` | Identity | 12 | 12 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `workspace_invitations` | Identity | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `password_reset_requests` | Identity | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `email_verification_tokens` | Identity | 7 | 7 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `user_mfa_totp` | Identity | 6 | 6 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `user_recovery_codes` | Identity | 5 | 5 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `webauthn_credentials` | Identity | 14 | 14 | ~transports | Retained at the current boundary; fields are individually documented in the field catalog. |
| `user_sessions` | Identity | 9 | 9 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `gender_options` | Workspace configuration | 9 | 9 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `workspace_settings` | Workspace configuration | 8 | 7 | -settings | Retained at the current boundary; fields are individually documented in the field catalog. |
| `workspace_profile_modules` | Workspace configuration | 10 | 10 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `contact_method_types` | Workspace configuration | 12 | 12 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `contact_labels` | Workspace configuration | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `activity_type_categories` | Workspace configuration | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `activity_types` | Workspace configuration | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `emotion_options` | Workspace configuration | 9 | 7 | +is_active, -is_system, -level, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `life_event_categories` | Workspace configuration | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `life_event_types` | Workspace configuration | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `relationship_type_groups` | Workspace configuration | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `relationship_types` | Workspace configuration | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `pet_categories` | Workspace configuration | 7 | 7 | +is_active, +is_common, -is_system, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `people` | People | 18 | 17 | -profile_state | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_avatars` | People | 9 | 7 | -provider_payload, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_dates` | People | 14 | 12 | -date_value, -workspace_id | Duplicate date_value removed; precision/component shape checked. |
| `person_first_meetings` | People | 8 | 6 | -person_date_id, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_contact_methods` | People | 11 | 10 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_contact_method_labels` | People | 4 | 3 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `locations` | People | 13 | 13 | country_code→country | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_addresses` | People | 9 | 8 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_address_labels` | People | 4 | 3 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `organizations` | People | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_occupations` | People | 14 | 13 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `tags` | People | 7 | 7 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_tags` | People | 4 | 3 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `pets` | People | 8 | 7 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `files` | Files | 16 | 16 | ~workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `person_file_links` | Files | 12 | 11 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `gift_file_links` | Files | 6 | 5 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `activities` | Interactions | 9 | 9 | happened_on→happened_at | Retained at the current boundary; fields are individually documented in the field catalog. |
| `activity_participants` | Interactions | 5 | 4 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `activity_emotions` | Interactions | 4 | 3 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `notes` | Interactions | 9 | 9 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `calls` | Communications | 9 | 9 | direction→contact_was_caller | Exact source caller boolean retained; unsupported direction inference removed. |
| `call_emotions` | Communications | 5 | 3 | -person_id, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `conversation_threads` | Communications | 9 | 9 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `messages` | Communications | 10 | 8 | -person_id, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `journal_posts` | Journal | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `journal_day_ratings` | Journal | 8 | 8 | date→rated_on | Retained at the current boundary; fields are individually documented in the field catalog. |
| `journal_items` | Journal | 9 | 9 | none | One-of target plus partial unique indexes prevents duplicate timeline entries. |
| `life_events` | Life events | 14 | 14 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `tasks` | Tasks and reminders | 13 | 13 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `reminder_rules` | Tasks and reminders | 6 | 6 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `reminders` | Tasks and reminders | 19 | 19 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `reminder_occurrences` | Tasks and reminders | 15 | 14 | ~member_id, -workspace_id | Recipient remains mandatory; ambiguous sent history goes to audit instead of inventing a member. |
| `stay_in_touch_cadences` | Tasks and reminders | 11 | 11 | +last_contacted_at, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `relationships` | Relationships | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `romantic_relationship_details` | Relationships | 10 | 8 | -is_active, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `gifts` | Gifts and debts | 13 | 13 | none | Optional particular-recipient relation restored; no false direction field. |
| `debts` | Gifts and debts | 11 | 11 | ~status | Retained at the current boundary; fields are individually documented in the field catalog. |
| `dav_address_books` | Integrations | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `dav_address_book_subscriptions` | Integrations | 16 | 16 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `dav_objects` | Integrations | 17 | 17 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `dav_sync_tokens` | Integrations | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `location_weather_cache` | Integrations | 9 | 8 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `data_imports` | Import/export | 13 | 13 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `data_import_entities` | Import/export | 13 | 12 | -workspace_id, target_id→target_key | General text target key supports UUID, natural, and composite keys without domain leakage. |
| `data_import_reports` | Import/export | 8 | 7 | -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `data_exports` | Import/export | 13 | 13 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `audit_events` | Audit | 12 | 12 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `api_request_logs` | API | 11 | 11 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `api_tokens` | API | 11 | 11 | ~scopes | Retained at the current boundary; fields are individually documented in the field catalog. |
| `oauth_clients` | API | 11 | 12 | +user_provider, ~allowed_grants, ~redirect_uris, ~scopes | Retained at the current boundary; fields are individually documented in the field catalog. |
| `oauth_authorization_codes` | API | 9 | 9 | ~scopes | Retained at the current boundary; fields are individually documented in the field catalog. |
| `oauth_access_tokens` | API | 8 | 8 | ~scopes | Retained at the current boundary; fields are individually documented in the field catalog. |
| `oauth_refresh_tokens` | API | 8 | 6 | ~access_token_id, -client_id, -user_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `legal_documents` | Compliance | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `legal_acceptances` | Compliance | 8 | 7 | ~user_id, -member_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `billing_customers` | Billing | 11 | 11 | ~workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `billing_subscriptions` | Billing | 13 | 11 | ~billing_customer_id, -provider, -workspace_id | Retained at the current boundary; fields are individually documented in the field catalog. |
| `billing_subscription_items` | Billing | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `scheduled_job_runs` | Operations | 8 | 8 | none | Retained at the current boundary; fields are individually documented in the field catalog. |
| `app_instances` | Operations | 9 | 10 | +versions_behind | Retained at the current boundary; fields are individually documented in the field catalog. |
| `statistics_snapshots` | Operations | 6 | 6 | none | Retained at the current boundary; fields are individually documented in the field catalog. |

## Deliberately retained complexity

- Directional relationship edges and reverse relationship types preserve asymmetric semantics.
- Partial dates preserve unknown-year/month/day information without fabricated values.
- Reminder definitions and generated occurrences represent different facts and remain separate.
- `journal_items` is a justified typed one-of timeline projection; database checks and unique indexes bound it.
- One file catalog plus role-specific link tables is simpler than separate photo/document stores without losing attachment roles.
- DAV, billing, OAuth, weather, and operations tables remain optional modules rather than contaminating people rows.
- `data_import_entities` is intentionally adapter-polymorphic; this flexibility is confined to import identity metadata.
- `life_events.happened_at` remains alongside partial components because the source may contain exact timestamp information; importer/application tests must keep representations synchronized when both are present.

## Tenant-integrity contract

Removing duplicated tenant columns is safe only with command-level workspace compatibility checks. Required automated coverage includes policy unit tests, repository cross-workspace negative tests for every linking command, cascade/delete tests, end-to-end authorization tests, and importer orphan/cross-account tests. Re-adding unverified `workspace_id` columns to children would restore inconsistency rather than enforce isolation.

## Import rules that must be tested

1. Monica account/user/member identity resolution is deterministic and idempotent.
2. Source IDs/UUIDs remain only in `data_import_entities`.
3. Gifts resolve optional particular recipients; null/zero remains null.
4. Calls copy `contact_called` exactly.
5. Debt `in_debt`: `yes → i_owe`, `no → they_owe`.
6. Partial dates round-trip for every precision state.
7. Ambiguous `reminders_sent` creates audit history without inventing a member.
8. Future reminder occurrences are regenerated from definitions/rules/timezones.
9. Missing file bytes create warnings and missing-file metadata, not a failed full import.
10. Sessions, reset tokens, OAuth tokens/codes, recovery codes, and U2F credentials are never activated from source material.
11. Cross-account references fail or become explicit orphan reports.
12. Re-running the same import does not create duplicate canonical rows.

## Validation result

- SQL/spec table and field definitions: exact match.
- Table comments: 87/87.
- Column comments: 811/811.
- Monica table mappings: 94/94.
- Monica column mappings: 823/823.
- Canonical field catalog rows: 811/811.
- Duplicate index names: 0.
- Invalid foreign-key targets: 0.
- Forward inline foreign keys: 0.
- Deferred foreign keys: 2 (`workspace_members.self_person_id`, `person_first_meetings.location_id`).
- Live PostgreSQL migration execution: not available in this runtime; required in CI.

## Artifact set

- `personal_crm_rewrite_schema_v3.sql` — canonical PostgreSQL DDL.
- `personal_crm_rewrite_schema_spec_v3.md` — full table/field specification and Monica table coverage.
- `monica_table_mapping_v3.csv` — 94-row source table disposition.
- `monica_column_mapping_v3.csv` — 823-row source field mapping.
- `personal_crm_field_catalog_v3.csv` — one row per canonical field.
- `personal_crm_v1_to_v3_changes.csv` — normalized proposal change log.
- `personal_crm_schema_v3_validation.json` — machine-readable consistency result and hashes.
