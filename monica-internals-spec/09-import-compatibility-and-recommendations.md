# Import Compatibility And Recommendations

## Goal

The replacement app should let a Monica user bring forward enough data that they can continue using the new product without losing relationship history, reminders, notes, conversations, files, and personal CRM context. Support at least three Monica input profiles:

1. Monica SQL export from the app UI.
2. Monica JSON export from the app UI.
3. Raw SQL/database backup from a self-hosted instance.

Those profiles are not equivalent. The SQL export is account-scoped and hard-coded; raw backups include platform tables and newer columns that the export code may omit.

## Monica SQL Export Format

`Settings\ExportController` creates an `export_jobs` row and dispatches `ExportAccount` for SQL or JSON ([source](../monica-4.x/app/Http/Controllers/Settings/ExportController.php#L33)). `ExportAccount` runs `SqlExportAccount` for SQL jobs and moves the generated temp file into the configured storage disk ([source](../monica-4.x/app/Jobs/ExportAccount.php#L48)).

`SqlExportAccount` writes a header, disables foreign key checks, writes `INSERT IGNORE INTO ... VALUES ...` blocks, then reenables foreign key checks ([source](../monica-4.x/app/Services/Account/Settings/SqlExportAccount.php#L60)). Rows are selected by `account_id` or special account-scoped logic.

Tables exported by `SqlExportAccount`:

`accounts`, `activities`, `activity_contact`, `activity_statistics`, `activity_type_categories`, `activity_types`, `addresses`, `calls`, `companies`, `contact_field_types`, `contact_fields`, `contact_tag`, `contacts`, `conversations`, `days`, `debts`, `documents`, `emotion_call`, `entries`, `genders`, `gifts`, `invitations`, `journal_entries`, `life_event_categories`, `life_event_types`, `life_events`, `messages`, `metadata_love_relationships`, `modules`, `notes`, `occupations`, `pets`, `photos`, `places`, `recovery_codes`, `relationship_type_groups`, `relationship_types`, `relationships`, `reminder_outbox`, `reminder_rules`, `reminders`, `special_dates`, `tags`, `tasks`, `term_user`, `users`, `weather`, `contact_photo`, `audit_logs`.

Notable omissions from SQL export compared with the final inferred schema:

- UUIDs are omitted from many exported tables even though final schema has `uuid`.
- `contacts.deleted_at`, `contacts.address_book_id`, `contacts.vcard`, and `contacts.distant_etag` are omitted.
- `addressbooks`, `addressbook_subscriptions`, and `synctoken` are not exported, so DAV sync state is not portable through the built-in SQL export.
- Label pivots `contact_field_labels`, `contact_field_contact_field_label`, and `address_contact_field_label` are not exported.
- `gift_photo` is not exported, even though `contact_photo` is exported manually.
- Platform/security tables such as OAuth tokens, sessions, cache, queue jobs, WebAuthn keys, U2F keys, subscriptions, and password reset tokens are not exported. That is generally desirable for app-to-app migration.

## JSON Export Format

JSON export writes version metadata and delegates to `App\ExportResources\Account\Account` ([source](../monica-4.x/app/Services/Account/Settings/JsonExportAccount.php#L47)). The account export groups data into:

- `data`: users, contacts, relationships, address books, address book subscriptions, photos, documents, and activities.
- `properties`: default gender, journal entries, modules, reminder rules, audit logs.
- `instance`: activity/contact/life-event/gender vocabularies ([source](../monica-4.x/app/ExportResources/Account/Account.php#L25)).

JSON export is more intentionally portable because export resources use UUID mapping, but it is marked `1.0-preview.1` and should be validated against real exports before becoming the only importer.

## Recommended Canonical Mapping

Use your new schema as the canonical model and build Monica import adapters around it. Do not mirror Monica's tables one-for-one unless you want to preserve all legacy quirks.

| Monica domain | New app canonical objects | Notes |
|---|---|---|
| `accounts`, `users` | Workspace/account, members, preferences | Preserve Monica account id and UUID as import metadata. Do not import passwords as active credentials unless explicitly building an account takeover flow. |
| `contacts` | Person/profile | Preserve raw Monica id and UUID. Treat `is_active=false` as archived and `deleted_at` as soft-deleted/import-hidden. |
| `contact_fields`, `contact_field_types`, labels | Contact methods and custom profile fields | Normalize values by type: email, phone, URL, social, instant messaging. Keep unknown types as custom fields. |
| `addresses`, `places` | Addresses/locations | Keep free-text and coordinates. Weather cache is optional and can be dropped or re-fetched. |
| `companies`, `occupations` | Organizations and roles | Convert legacy `contacts.company`/`contacts.job` to text fields if no occupation row exists. |
| `relationships`, `relationship_types` | Directional relationship graph | Preserve both direction and reverse label. Import orphaned relationships only if both contacts exist. |
| `activities`, `activity_contact`, types | Shared interactions/events | Activities can involve multiple contacts. Keep activity type vocabulary as workspace configuration. |
| `calls`, `conversations`, `messages` | Communications timeline | Calls are standalone communication entries; conversations/messages are thread/message entries. |
| `notes`, `entries`, `days`, `journal_entries` | Notes and journal timeline | Use `journal_entries` to preserve date ordering and polymorphic links. |
| `tasks`, `reminders`, `reminder_rules`, `reminder_outbox` | Tasks and reminder schedules | Recompute future reminder occurrences rather than trusting stale outbox rows after import. |
| `life_events`, `special_dates` | Important dates and timeline milestones | Keep unknown-day/month flags and JSON `specific_information`. |
| `gifts`, `debts` | Gift ideas/history and financial IOUs | Preserve amount plus currency. Gift `status` changed over time, so handle legacy values. |
| `photos`, `documents`, pivots | Attachments/media | Import metadata first, then link file bytes if the user provides the storage archive. |
| `audit_logs` | Imported audit/history log | Keep as read-only history unless it maps cleanly to the new audit system. |
| `default_*`, per-account vocabularies | Workspace dictionaries/templates | Keep custom rows. You can replace Monica defaults with new defaults if imported rows have no user edits. |

## Import Algorithm

1. Detect input profile: SQL export, raw SQL dump, JSON export, or storage archive.
2. Parse into a staging schema that keeps original table names, columns, Monica ids, UUIDs, and row order.
3. Validate referential integrity by account: contacts first, then dependent rows. Log orphaned rows with source table and ids.
4. Create canonical workspace and member records. Attach import metadata: original account id, export date, source app version if available.
5. Import vocabularies before profile data: genders, contact field types, activity types/categories, relationship types/groups, life event types/categories, modules, reminder rules.
6. Import contacts and establish an `import_identity` table mapping `{source_table, source_id, source_uuid}` to new ids.
7. Import dependent rows in dependency order: places, addresses, companies, occupations, contact fields, tags, photos/documents metadata, special dates, reminders, tasks, activities, calls, conversations/messages, notes, debts, gifts, life events, relationships, journal entries, audit logs.
8. Re-link pivots using the identity map: `activity_contact`, `contact_tag`, `contact_photo`, `gift_photo`, labels.
9. Recompute denormalized counts and future reminder schedules in the new app.
10. Import file bytes if provided; mark missing files as broken attachments with the original storage path.

## Data Quality Rules

- Never trust old foreign keys blindly. Monica added cleanup foreign keys years after initial release, so early backups may have orphaned ids.
- Treat missing UUIDs as normal. The `HasUuid` trait lazily creates UUIDs when accessed, so old rows can have null UUIDs.
- Treat unknown enum/string values as legacy custom values. Examples include old gift status/date fields, old contact gender enum data, and reminder recurrence values.
- Preserve source ids and source table names. They are essential for debugging imports and for future incremental migration tooling.
- Keep original timestamps and a separate `imported_at` timestamp.
- Do not import OAuth tokens, sessions, password resets, queue jobs, cache rows, or old WebAuthn/U2F keys as active credentials.
- Ask the user whether to import deleted/archived contacts. Default should be archive-preserving but not show soft-deleted contacts in normal lists.

## File Import Rules

SQL/JSON export rows contain filenames, not file bytes. If the user only uploads `monica.sql` or `monica.json`, import attachment metadata and show missing-file warnings. If the user provides storage files, map by:

- `photos.new_filename` -> file under `photos/`.
- `documents.new_filename` -> file under `documents/`.
- `contacts.avatar_file_name`, `avatar_default_url`, `avatar_location`, and `avatar_photo_id` -> avatar source or linked photo.
- `export_jobs.filename` should not be imported as user content.

## Improvements For The New App

- Use UUIDs as first-class stable ids from day one, with integer ids as internal implementation details only.
- Replace hard-coded SQL export with a versioned, documented export manifest that includes schema version, checksums, attachment manifest, and row counts.
- Store normalized contact methods and custom fields in one flexible typed model, with labels as first-class rows.
- Separate reminder definitions from scheduled deliveries. Always regenerate future deliveries after import or timezone changes.
- Model relationship edges symmetrically in queries but store direction explicitly, as Monica does.
- Make external services optional adapters. Weather, geocoding, avatars, Stripe, Sentry, version ping, and DAV sync should be independently disableable.
- Provide an import dry run that reports row counts, orphan counts, missing files, unsupported fields, and expected resulting contacts before committing.
- Preserve raw imported rows in compressed import archives for a fixed retention period so mapping bugs can be repaired without asking users to re-upload.
