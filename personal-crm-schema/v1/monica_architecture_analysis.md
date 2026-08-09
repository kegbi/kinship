# Monica 4.x Architecture and Simplification Analysis
This report evaluates the uploaded `monica-internals-spec` package. The package is a static documentation/specification bundle generated from Monica 4.x migrations and extracted relationships; it is not a live database dump and it is not the full source tree. The schema should therefore be treated as a strong portability map, with a small amount of caution around historical migrations, omitted SQL-export columns, and legacy indexes.
## Executive verdict
Monica 4.x is not random or badly organized: it is a pragmatic Laravel application built around a clear tenant root (`accounts`) and a clear business center (`contacts`). Most complexity exists because Monica supports a broad personal-CRM feature set: multi-user accounts, per-account vocabularies, contact methods, activities, communications, reminders, tasks, journal, life events, gifts, debts, files, CardDAV/CalDAV, imports/exports, billing, MFA, and external services.
However, it is not optimal for a greenfield reimplementation. The final schema is heavy because it accumulated years of migrations, compatibility columns, framework tables, legacy provider state, and UI preferences stored directly on core rows. A new app can preserve the full product functionality with fewer canonical concepts by separating business data from infrastructure, making UUIDs first-class, consolidating attachments and timeline items, moving integration state out of core contacts, and replacing default/runtime seed tables with versioned manifests.
My conclusion: keep the functional breadth, but do not copy the tables one-for-one. Use Monica import adapters and an identity map, then transform into a cleaner canonical model.
## Measured inventory from the uploaded spec
- Total inferred tables: **94**.
- Total inferred columns: **823**.
- Total foreign-key declarations found: **145**.
- Tables with `account_id`: **59**.
- Tables with `uuid`: **32**.
| Area | Tables | Columns | FK declarations | Tables with account_id | Tables with uuid |
|---|---:|---:|---:|---:|---:|
| Core account / identity / billing / import-export | 16 | 161 | 23 | 10 | 3 |
| Contacts and profile data | 21 | 209 | 47 | 19 | 9 |
| Interactions, journal, relationships | 41 | 320 | 72 | 30 | 19 |
| System platform | 16 | 133 | 3 | 0 | 1 |

## Architecture map
### 1. Runtime shape
Monica 4.x is documented as a Laravel 9 / PHP 8.1 application with Vue 2/Tachyons/Bootstrap frontend assets. Routes are split into API, OAuth, web, and special routes. The core source organization follows conventional Laravel boundaries: Eloquent models, services for command-style business operations, controllers, API resources, export resources, migrations, and route files.
### 2. Tenant boundary
The dominant architecture decision is the `accounts` table. Nearly all user-owned data is scoped by `account_id`. `users` belong to accounts, and a user may also point to `me_contact_id`, a contact row representing the user inside their own CRM. This is a sensible multi-tenant boundary and should be preserved. A replacement app should make this even stricter using workspace-scoped authorization, tenant-aware queries, and ideally non-null stable UUIDs.
### 3. Contact-centered domain
`contacts` is the central aggregate. Profile data hangs off it: contact fields, addresses, tags, occupations, relationships, notes, calls, conversations, activities, tasks, reminders, gifts, debts, life events, special dates, pets, photos, documents, and audit logs. This is correct for Monica’s product: everything is about remembering people. The problem is not the contact-centered model; the problem is that too much unrelated state is stored directly on `contacts` itself, especially avatar internals, DAV sync state, counters, legacy company/job strings, and duplicated special-date/reminder pointers.
### 4. Per-account vocabulary pattern
Monica uses default tables to seed per-account copies of activity types, contact field types, life event types, relationship types, gender entries, reminder rules, and profile modules. Functionally this enables custom labels and deletability per account. Architecturally it creates many tables. A new app can retain user-customizable dictionaries but implement defaults as versioned seed manifests rather than persisted `default_*` tables.
### 5. Journal and timeline pattern
`journal_entries` links `activities`, `entries`, and `days` polymorphically. This gives Monica a cross-object timeline, but it is partial: notes, calls, tasks, gifts, debts, life events, and messages have their own dates and do not all flow through the same timeline table. A new architecture can either keep a small timeline index or use a unified `timeline_items` projection generated from domain events.
### 6. DAV and remote-service integration
CardDAV/CalDAV is bolted onto existing contacts/tasks through `addressbooks`, `addressbook_subscriptions`, `synctoken`, plus contact-level `address_book_id`, `vcard`, and `distant_etag`. This is functional but leaky: integration sync state sits inside core profile rows. A new design should move all remote sync state to adapter-owned tables keyed by local object id and remote object id/etag.
### 7. Background work and external services
Exports, imports, reminders, stay-in-touch scheduling, weather, geocoding, DAV sync, avatar updates, and audit logging are job-driven. This is a sound pattern. The external-service list is broad: Stripe/Cashier, mail providers, S3, Redis/Memcached/database queues/cache/sessions, Passport OAuth, WebAuthn/Google2FA/U2F, SabreDAV, LocationIQ, WeatherAPI, Gravatar, Adorable Avatars, Sentry, and version ping. In a privacy-first clone, each should be an explicit optional adapter, not assumed core functionality.
## Full functionality map
| Domain | Monica functionality | Main tables | Preserve? | Simplification direction |
|---|---|---|---|---|
| Workspace/account | Tenant root, billing state, default reminder time, default gender, invited-user statistics | accounts | Yes | Workspace table plus separate billing adapter and settings object. |
| Members and identity | Login users, locale/timezone, UI preferences, admin flag, MFA hooks, self-contact link | users, recovery_codes, webauthn_keys, u2f_key, password_resets | Yes, but do not import secrets as active credentials | Split member profile, auth credentials, security factors, and preferences. |
| Invitations | Invite additional account users | invitations | Yes if multi-user accounts exist | Keep minimal pending invitation table. |
| Compliance | Versioned terms/privacy documents and acceptance ledger | terms, term_user | Optional/hosted-app dependent | Keep if hosted SaaS; not needed for local-only clone. |
| Billing | Stripe customer/subscription/payment method state | subscriptions, subscription_items, account billing columns | Optional | Adapter-owned billing tables; no billing columns in workspace core. |
| Exports/imports | Async export jobs, vCard/CSV imports, import reports | export_jobs, import_jobs, import_job_reports | Yes | Keep as operational/import history; add versioned manifests and dry-run reports. |
| Audit | Account/contact audit trail and dashboard-worthy logs | audit_logs | Yes | Keep read-only imported audit and separate new audit stream. |
| Contacts | People records, archive/delete state, first-met info, birthday/death/first-met pointers, avatar, DAV state, counters | contacts | Absolutely | Keep person core; move avatar, DAV, counters, and import flags out. |
| Gender/profile vocab | Custom gender vocabulary and default gender | genders, accounts.default_gender_id | Maybe | Treat as profile field/dictionary; preserve imported custom rows. |
| Contact methods | Emails, phones, social links, URLs, typed contact data | contact_fields, contact_field_types, default_contact_field_types | Yes | Typed `contact_methods` plus custom field definitions. |
| Labels | Labels for contact fields and addresses | contact_field_labels, contact_field_contact_field_label, address_contact_field_label | Yes if labels are exposed | Use one label/linking model. |
| Addresses/locations | Structured postal addresses, geocoding coordinates, address labels | addresses, places | Yes | Either embed structured address fields or keep places if sharing/geocoding matters. |
| Weather | Cached weather by place | weather | Optional | Drop/re-fetch; never treat as user-owned canonical data. |
| Work | Companies/employers and employment history; legacy company/job strings | companies, occupations, contacts.company, contacts.job | Yes | Organization + role history; import legacy strings as fallback fields. |
| Tags | Contact grouping labels | tags, contact_tag | Yes | Keep. |
| Photos/documents/avatar | Uploaded images, documents, contact/gift/avatar associations | photos, documents, contact_photo, gift_photo, contacts.avatar_* | Yes | One `attachments` table plus link table and one avatar selection object. |
| DAV sync | Local address books, remote subscriptions, sync token ledger, vCard/etag cache | addressbooks, addressbook_subscriptions, synctoken, contacts.vcard, contacts.distant_etag | Optional but important for exact clone | Adapter-owned integration tables; keep out of core contact row. |
| Activities | Shared interactions involving multiple contacts, activity taxonomy, yearly stats | activities, activity_contact, activity_types, activity_type_categories, activity_statistics | Yes | Keep events + participants; recompute stats. |
| Calls | Call logs, call content, who called whom, emotions | calls, emotion_call | Yes if communications retained | Can be communication entries with type=call. |
| Emotions | Emotion vocabulary and tagging for calls/activities | emotions, emotions_primary, emotions_secondary, emotion_activity, emotion_call | Optional/niche | Retain only if UI uses emotion tagging; otherwise import as tags/metadata. |
| Notes | Free-form notes with favorite flag | notes | Yes | Keep. |
| Conversations/messages | Threads and individual messages, channel/type | conversations, messages | Yes | Keep as communication threads/messages. |
| Debts | Money owed by/to contact, status, amount, currency | debts, currencies | Yes if feature retained | Keep, but use decimal money type/currency reference. |
| Gifts | Gift ideas/offered/received, URL, amount, photo, recipient/for contact | gifts, gift_photo, photos | Yes if feature retained | Keep as gift records plus attachments. |
| Tasks | Account/contact tasks, completion, CalDAV VTODO export | tasks | Yes | Keep; separate local task from CalDAV sync state. |
| Reminders | Recurring/one-off reminders, notification lead times, generated outbox, sent history | reminders, reminder_rules, reminder_outbox, reminders_sent | Yes | Definitions + generated occurrences; recompute future outbox after import. |
| Stay in touch | Cadence and trigger date for contacting someone | contacts.stay_in_touch_frequency, contacts.stay_in_touch_trigger_date, reminder jobs | Yes | Model as a reminder/relationship-nurture schedule, not contact columns. |
| Journal | Journal text entries, day ratings, polymorphic journal timeline | entries, days, journal_entries | Yes if journal retained | Use timeline projection or explicit journal records. |
| Life events | Typed contact life events, categories, JSON-specific details, unknown day/month flags | life_event_categories, life_event_types, life_events, default_life_event_* | Yes | Keep event records; replace default tables with seed manifests. |
| Special dates | Birthday, deceased date, first-met date, unknown-year support | special_dates and contact pointer columns | Yes | Keep important dates; avoid duplicate pointer/reminder coupling if possible. |
| Relationships | Directional edges, type groups, reverse labels | relationships, relationship_types, relationship_type_groups, default_relationship_* | Yes | Keep explicit direction and reverse label; graph queries can be symmetric. |
| Love relationship metadata | Dating/official/breakup metadata on a relationship | metadata_love_relationships | Optional | Import as relationship-specific metadata if no dedicated UI. |
| Pets | Contact-associated pets and categories | pets, pet_categories | Optional but part of Monica feature set | Keep if full clone; else import as custom profile facts. |
| API | Public statistics/compliance/currency APIs; authenticated CRUD APIs for nearly all domains | routes/api.php surface documented in spec | Yes for API compatibility | Version the API; do not mirror route quirks unless required. |
| Web-only settings | Export/import, subscriptions, users, DAV setup, security controls, API token settings | web route groups | Yes if product includes web app | Separate app UI routes from API service contracts. |
| System platform | OAuth tokens, queues, cache, sessions, cron run state, instance/version, statistics | oauth_*, jobs, cache, sessions, crons, instances, statistics | Runtime only | Recreate with current stack; do not import as user data. |

## What is well-designed and should survive
1. **Clear tenant root.** `account_id` on most business rows is a strong ownership boundary. Keep this pattern and back it with row-level authorization tests.
2. **Contact-centric product model.** The app understands that a personal CRM is centered on people, not generic tasks or notes. Keep contacts/people as the aggregate root for most UX.
3. **Per-account customization.** Custom contact field types, activity types, relationship types, life-event types, gender vocabulary, reminder rules, and modules explain why the schema is not tiny. Users can tailor the CRM vocabulary. Keep the capability, but simplify its storage.
4. **Service-oriented business operations.** Controllers delegating to services is healthier than fat controllers and will translate well to a modern backend.
5. **Async jobs for slow work.** Exports, imports, DAV sync, geocoding/weather, reminder sending, and avatar updates are correctly not blocking request flow.
6. **Data portability awareness.** SQL and JSON export pipelines exist, even if imperfect. A new app should go much further with versioned export manifests, checksums, attachment manifests, and row counts.
## Main architectural problems
1. **Business data, UI state, integration state, and infrastructure are mixed.** Examples: user active tabs on `users`, DAV state on `contacts`, avatar provider internals on `contacts`, billing columns on `accounts`, and platform tables in the same schema inventory.
2. **The contact row is overloaded.** It has core identity, life-status flags, first-met narrative, legacy work fields, reminder pointers, special-date pointers, stay-in-touch scheduling, avatar internals, CardDAV fields, archive/delete flags, counters, and import partiality. This makes contacts difficult to reason about and migrate.
3. **Default tables add runtime clutter.** The `default_*` tables are mostly seed/template data. They are useful historically but not ideal as runtime schema in a new product.
4. **Identifier strategy is historical.** Integer ids are primary. UUIDs were added later and are nullable/lazy. A new app should use UUIDs/public IDs from day one and keep integers only as internal storage keys if desired.
5. **Export/import is inconsistent.** SQL export is hard-coded and omits newer final columns such as DAV fields and some UUIDs. JSON export is more portable but preview-labeled. A clone should not repeat this.
6. **Denormalized data is not separated cleanly.** `activity_statistics`, `statistics`, `contacts.last_talked_to`, `number_of_views`, and generated reminder outbox rows are useful projections/runtime data, but they should not be treated as canonical source of truth.
7. **External-service coupling leaks into data model.** Stripe, Gravatar, Adorable Avatars, DAV, geocoding, weather, version ping, Sentry, and storage concerns should live behind adapters.
8. **Some field names and legacy artifacts reduce clarity.** `delible` is misspelled but retained; `contacts.has_avatar` and `has_avatar_bool` coexist; `users.metric` and `temperature_scale` are confusing; old company/job strings coexist with normalized occupations.
## Simplification recommendations
### A. Do not copy Monica table-for-table
Build a canonical model for your app, then create Monica import adapters. Preserve source ids/UUIDs in an `import_identities` table. This allows the new product to be simpler while still importing every Monica row.
### B. Suggested cleaner module boundaries
- **Workspace module:** accounts/workspaces, members, roles, invitations, workspace settings.
- **Identity/security module:** credentials, MFA, sessions, OAuth clients/tokens if needed. Keep separate from profile preferences.
- **People module:** contacts/persons, profile summary, lifecycle state, important dates, food preferences, custom facts.
- **Contact methods module:** email/phone/social/URL/custom methods with labels and normalized values.
- **Organizations/work module:** organizations and roles/occupations.
- **Relationship graph module:** directional edges with relationship type dictionary.
- **Timeline/interaction module:** activities, calls, notes, conversations/messages, life events, journal entries, day ratings, with a generated timeline projection.
- **Tasks/reminders module:** task definitions, reminder definitions, reminder rules, generated notification occurrences.
- **Attachments module:** one attachment table for photos/documents plus link table for contact/gift/avatar/message/etc.
- **Integration module:** DAV, geocoding/weather, avatar providers, mail, storage, Stripe, Sentry as optional adapters.
- **Import/export module:** staging, identity mapping, dry-run reports, artifact manifests, row/file checksums.
- **Audit module:** append-only history for product actions and imported Monica audit logs.
### C. Fields/tables that are safe to remove from the new canonical model, while still supporting import
- **Framework/runtime tables:** `sessions`, `cache`, `jobs`, `failed_jobs`, `job_batches`, `password_resets`, `crons`, and many OAuth token rows should be recreated by the new runtime.
- **Legacy credential tables:** `u2f_key` and old recovery codes should not become active credentials. Ask users to re-enroll MFA.
- **Billing fields if not building SaaS billing:** Stripe columns, `subscriptions`, `subscription_items`, `pm_type`, `pm_last_four`, trial flags, legacy plan flags. Keep only imported metadata if needed for admin history.
- **Default seed tables:** `default_contact_field_types`, `default_activity_*`, `default_life_event_*`, `default_relationship_*`, `default_contact_modules`; replace with versioned seed manifests and import only custom per-account rows.
- **Contact legacy work fields:** `contacts.company` and `contacts.job` should become fallback text or be converted into organization/occupation records.
- **Avatar clutter:** collapse `avatar_file_name`, `gravatar_url`, `has_avatar_bool`, `has_avatar`, `avatar_external_url`, `avatar_source`, `avatar_gravatar_url`, `avatar_adorable_uuid`, `avatar_adorable_url`, `avatar_default_url`, `avatar_photo_id`, and `avatar_location` into one avatar selection model with provider/source metadata.
- **DAV clutter on contacts:** move `address_book_id`, `vcard`, and `distant_etag` to integration sync state.
- **Derived counters/caches:** `number_of_invitations_sent`, `number_of_views`, `last_talked_to`, `activity_statistics`, `statistics`, `weather`, generated reminder outbox, and some sent-reminder history can be recomputed or imported read-only.
- **UI preferences on user rows:** active tabs, badge-seen flags, layout flags, name order, sort order, temperature units should move to a typed or JSON preferences object.
### D. Things that look removable but are functionally important
- **`account_id` on business rows and pivots.** It may feel redundant when foreign keys can traverse back to accounts, but it improves tenant filtering, authorization, and import validation. You may remove it from some join tables only if your database constraints and tests enforce tenant isolation elsewhere.
- **Directional relationships.** Do not collapse relationship types into a simple undirected friend/family tag. Monica stores forward and reverse relationship labels.
- **Unknown date semantics.** Life events and special dates contain unknown year/month/day behavior. A naive `date` field loses this.
- **Activity participants.** Activities can involve multiple contacts; do not model them as single-contact notes.
- **Source identity mapping.** Missing UUIDs are normal in old Monica rows; preserve original table/id/uuid mappings for debugging and incremental import.
- **Attachment metadata separate from bytes.** SQL/JSON exports contain filenames, not files. Preserve metadata and surface missing-file warnings.
## Proposed canonical object model
| Canonical object | Absorbs Monica tables/fields | Notes |
|---|---|---|
| Workspace | accounts, modules, reminder_rules, default settings | Keep workspace settings and feature toggles, not legacy billing columns. |
| Member | users, invitations, term_user | Separate auth credentials and UI preferences. |
| Person | contacts core fields, genders, food_preferences, archived/deleted flags | Store avatar and DAV as child objects, not dozens of columns. |
| ImportantDate | special_dates, birthday/deceased/first-met pointers | Use type enum, date precision flags, optional reminder link. |
| ContactMethod | contact_fields, contact_field_types, labels | Typed email/phone/social/url/custom value with label and normalized value. |
| Address | addresses, places, address labels | Structured address with optional geocode and provider metadata. |
| OrganizationRole | companies, occupations, legacy company/job | Roles/employment history. |
| RelationshipEdge | relationships, relationship_types, groups, love metadata | Directional edge plus optional metadata. |
| TimelineItem/Event | activities, calls, notes, life_events, journal_entries, entries, days | Use event-specific details or subtype tables; generate timeline projection. |
| ConversationThread/Message | conversations, messages | Can also be under communications module. |
| Task | tasks | Contact-linked or workspace-wide. |
| ReminderDefinition/Occurrence | reminders, reminder_rules, reminder_outbox, reminders_sent | Definitions canonical; occurrences generated and regenerated. |
| Gift | gifts, gift_photo | Gift state, price, URL, attachments. |
| Debt | debts, currencies | Use decimal money/currency. |
| Attachment | photos, documents, contact_photo, gift_photo, avatar photo | One file metadata table plus polymorphic/object link table. |
| IntegrationConnection/SyncObject | addressbooks, subscriptions, synctoken, vcard/etag, geocoding/weather/avatar providers | Adapter-owned tables; disabled unless feature enabled. |
| ImportRun/ImportIdentity | import_jobs, import_job_reports, source table/id/uuid maps | Critical for Monica compatibility. |
| AuditEntry | audit_logs | New audit entries plus imported Monica logs. |

## Table-level disposition inventory
The table below maps every table from the uploaded schema to a high-level disposition. “Keep” means keep the functionality, not necessarily the exact table or fields.

| Area | Table | Columns | Account-scoped | UUID | Description | Disposition |
|---|---|---:|:---:|:---:|---|---|
| Core account / identity / billing / import-export | `accounts` | 14 | no | yes | Tenant/account root. Most user-owned records carry `account_id` and cascade from this table. | Keep, but slim; workspace root. |
| Core account / identity / billing / import-export | `users` | 27 | yes | yes | Login identities inside an account. Stores authentication, MFA, display, locale, and preference data. | Keep, but split auth, preferences, and member profile. |
| Core account / identity / billing / import-export | `invitations` | 7 | yes | no | Pending invitations for additional account users. | Keep if multi-user accounts exist. |
| Core account / identity / billing / import-export | `recovery_codes` | 7 | yes | no | 2FA recovery codes for users. | Security credential/secret table; never import as active credentials without a dedicated takeover flow. |
| Core account / identity / billing / import-export | `terms` | 7 | no | no | Versioned legal/compliance policy documents. | Keep if compliance acceptance/versioning is required. |
| Core account / identity / billing / import-export | `term_user` | 6 | yes | no | Pivot recording which user/account accepted which terms and from what IP. | Keep as compliance acceptance ledger. |
| Core account / identity / billing / import-export | `modules` | 8 | yes | no | Per-account feature-module toggles shown on contact profiles. | UI/profile module toggle; can be a feature preference instead of a table. |
| Core account / identity / billing / import-export | `default_contact_modules` | 8 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Core account / identity / billing / import-export | `subscriptions` | 11 | yes | no | Laravel Cashier subscription records for account billing. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Core account / identity / billing / import-export | `subscription_items` | 8 | no | no | Laravel Cashier subscription item rows after Cashier upgrade. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Core account / identity / billing / import-export | `export_jobs` | 12 | yes | yes | Async export job metadata for SQL/JSON downloads. | Keep if async export downloads exist. |
| Core account / identity / billing / import-export | `import_jobs` | 14 | yes | no | vCard/CSV import job metadata. | Keep as import run record. |
| Core account / identity / billing / import-export | `import_job_reports` | 9 | yes | no | Per-contact import result rows for an import job. | Keep as import diagnostics. |
| Core account / identity / billing / import-export | `audit_logs` | 11 | yes | no | Account audit/event log rows, optionally about a contact. | Keep as read-only/history or real audit system. |
| Core account / identity / billing / import-export | `api_usage` | 6 | no | no | Daily API usage counters by account/user/IP. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Core account / identity / billing / import-export | `currencies` | 6 | no | no | Global currency list used by users, debts, and gifts. | Keep as reference data if debts/gifts have money. |
| Contacts and profile data | `contacts` | 49 | yes | yes | Primary person record. Holds name, profile metadata, special-date pointers, avatar state, CardDAV state, and archive/delete flags. | Keep; central Person/Profile aggregate, but reduce legacy/avatar/DAV fields. |
| Contacts and profile data | `genders` | 7 | yes | yes | Per-account gender vocabulary; contacts reference this instead of old enum gender. | Keep only if customizable gender vocabulary is a requirement; otherwise custom field/reference data. |
| Contacts and profile data | `contact_fields` | 8 | yes | yes | Typed contact data values such as email addresses, phone numbers, social URLs, and profile links. | Keep concept; model as normalized contact methods/custom fields. |
| Contacts and profile data | `contact_field_types` | 10 | yes | yes | Per-account definitions for contact field kinds. Defaults are copied from `default_contact_field_types`. | Keep concept; simplify into typed definitions or enum + custom field definitions. |
| Contacts and profile data | `default_contact_field_types` | 9 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Contacts and profile data | `contact_field_labels` | 6 | yes | no | Reusable labels attached to contact fields or addresses. | Keep concept; labels are useful and missing from SQL export. |
| Contacts and profile data | `contact_field_contact_field_label` | 3 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Contacts and profile data | `addresses` | 8 | yes | yes | Connects contacts to normalized places with an optional address display name. | Keep. |
| Contacts and profile data | `places` | 11 | yes | no | Postal/geographical place details shared by addresses and weather cache. | Keep if geocoding/shared structured addresses are supported; otherwise embed address fields. |
| Contacts and profile data | `address_contact_field_label` | 3 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Contacts and profile data | `companies` | 7 | yes | no | Companies/employers scoped to an account. | Keep as Organization table if work history matters. |
| Contacts and profile data | `occupations` | 13 | yes | no | Employment history and current work records for contacts. | Keep as contact roles/employment history. |
| Contacts and profile data | `tags` | 7 | yes | no | Account-scoped labels used for contact grouping. | Keep. |
| Contacts and profile data | `contact_tag` | 5 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Contacts and profile data | `photos` | 9 | yes | yes | Uploaded image metadata stored in filesystem-backed storage. | Keep concept; combine with attachments. |
| Contacts and profile data | `contact_photo` | 4 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Contacts and profile data | `documents` | 12 | yes | yes | Uploaded non-image document metadata stored in filesystem-backed storage. | Keep concept; combine with attachments. |
| Contacts and profile data | `addressbooks` | 8 | yes | yes | Local CardDAV address books owned by a user/account. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Contacts and profile data | `addressbook_subscriptions` | 17 | yes | yes | Remote CardDAV address book subscriptions and sync state. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Contacts and profile data | `synctoken` | 7 | yes | no | DAV sync-token ledger used to track changed/deleted contacts/tasks/calendars. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Contacts and profile data | `weather` | 6 | yes | no | Cached weather JSON for places. | Optional adapter/runtime table; keep only if the corresponding integration/feature is enabled. |
| Interactions, journal, relationships | `activities` | 9 | yes | yes | Shared account activity/interactions that can involve multiple contacts and appear in the journal. | Keep; multi-contact interaction/event. |
| Interactions, journal, relationships | `activity_contact` | 3 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Keep as participants table. |
| Interactions, journal, relationships | `activity_statistics` | 7 | yes | no | Yearly per-contact denormalized activity counts. | Derived/runtime/history table; recompute or import read-only, not as canonical source. |
| Interactions, journal, relationships | `activity_type_categories` | 7 | yes | yes | Per-account grouping for activity types. | Keep if user-customizable activity taxonomy is retained. |
| Interactions, journal, relationships | `activity_types` | 9 | yes | yes | Per-account activity type definitions. | Keep if activities have types. |
| Interactions, journal, relationships | `default_activity_type_categories` | 4 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `default_activity_types` | 6 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `calls` | 9 | yes | yes | Logged phone/communication calls with a contact and optional emotions. | Keep, or merge into communications/interactions. |
| Interactions, journal, relationships | `emotion_call` | 6 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Interactions, journal, relationships | `emotion_activity` | 5 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Interactions, journal, relationships | `emotions` | 6 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Reference vocabulary for emotion tagging; keep only if emotion tagging is retained. |
| Interactions, journal, relationships | `emotions_primary` | 4 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Reference vocabulary for emotion tagging; keep only if emotion tagging is retained. |
| Interactions, journal, relationships | `emotions_secondary` | 5 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Reference vocabulary for emotion tagging; keep only if emotion tagging is retained. |
| Interactions, journal, relationships | `notes` | 9 | yes | yes | Free-form notes attached to contacts, with favorite support. | Keep. |
| Interactions, journal, relationships | `conversations` | 8 | yes | yes | Messaging thread with a contact, usually through a contact field type/channel. | Keep if message threads are supported. |
| Interactions, journal, relationships | `messages` | 10 | yes | yes | Individual messages inside conversations. | Keep if conversations are supported. |
| Interactions, journal, relationships | `debts` | 11 | yes | yes | Money owed by or to contacts. | Keep if IOU feature is retained. |
| Interactions, journal, relationships | `gifts` | 14 | yes | yes | Gift ideas, offered gifts, and received gifts for contacts. | Keep if gifts feature is retained. |
| Interactions, journal, relationships | `gift_photo` | 4 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Relationship/pivot table; keep concept, but can be generalized as link/participant/attachment-label tables. |
| Interactions, journal, relationships | `tasks` | 10 | yes | yes | Tasks that may be account-wide or attached to a contact; exported to CalDAV VTODO. | Keep. |
| Interactions, journal, relationships | `reminders` | 13 | yes | yes | Recurring or one-off reminders about contacts/special dates. | Keep; separate definitions from generated occurrences. |
| Interactions, journal, relationships | `reminder_rules` | 6 | yes | no | Per-account notification lead-time rules. | Keep as notification lead-time preferences. |
| Interactions, journal, relationships | `reminder_outbox` | 9 | yes | no | Scheduled reminder notifications generated from reminders and rules. | Derived/runtime/history table; recompute or import read-only, not as canonical source. |
| Interactions, journal, relationships | `reminders_sent` | 11 | yes | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Derived/runtime/history table; recompute or import read-only, not as canonical source. |
| Interactions, journal, relationships | `journal_entries` | 7 | yes | no | Polymorphic journal timeline linking days, entries, and activities. | Keep concept as timeline index if journal is retained. |
| Interactions, journal, relationships | `entries` | 7 | yes | yes | Manual journal text entries. | Keep if journal free-form entries are retained. |
| Interactions, journal, relationships | `days` | 8 | yes | yes | Daily mood/rating records in the journal. | Keep if mood/day rating is retained. |
| Interactions, journal, relationships | `life_event_categories` | 8 | yes | yes | Per-account groupings for life event types. | Keep if typed life events are retained. |
| Interactions, journal, relationships | `life_event_types` | 10 | yes | yes | Per-account life-event type definitions; can carry JSON schemas for specific fields. | Keep if typed life events are retained. |
| Interactions, journal, relationships | `life_events` | 14 | yes | yes | Timeline events for a contact, optionally tied to a reminder and with JSON details. | Keep. |
| Interactions, journal, relationships | `default_life_event_categories` | 5 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `default_life_event_types` | 7 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `special_dates` | 9 | yes | yes | Normalized contact dates such as birthdays, first-met date, and deceased date. | Keep concept; important for birthday/death/first-met and unknown year flags. |
| Interactions, journal, relationships | `relationship_type_groups` | 6 | yes | no | Per-account relationship category groups. | Keep if relationship type customization is retained. |
| Interactions, journal, relationships | `relationship_types` | 8 | yes | no | Directional relationship labels; stores forward and reverse names. | Keep; directional labels matter. |
| Interactions, journal, relationships | `relationships` | 8 | yes | yes | Directional edge from one contact to another through a relationship type. | Keep; directional graph is essential. |
| Interactions, journal, relationships | `default_relationship_type_groups` | 6 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `default_relationship_types` | 8 | no | no | System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle. | Seed/template table; replace with code/seed manifest unless per-account migration history must be preserved. |
| Interactions, journal, relationships | `metadata_love_relationships` | 11 | yes | no | Extra metadata for love/couple relationships. | Keep only if the couple/love metadata UI is retained; otherwise import as relationship metadata. |
| Interactions, journal, relationships | `pets` | 8 | yes | yes | Contact-associated pet records. | Keep if pet tracking is retained. |
| Interactions, journal, relationships | `pet_categories` | 5 | no | no | Global pet category vocabulary. | Keep as reference data if pets are retained. |
| System platform | `oauth_access_tokens` | 9 | no | no | Laravel Passport OAuth access tokens. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `oauth_auth_codes` | 6 | no | no | Laravel Passport OAuth authorization codes. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `oauth_clients` | 11 | no | no | Laravel Passport OAuth clients. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `oauth_personal_access_clients` | 4 | no | no | Laravel Passport personal access client registry. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `oauth_refresh_tokens` | 4 | no | no | Laravel Passport refresh tokens. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `webauthn_keys` | 13 | no | no | WebAuthn/FIDO2 credential records. | Security credential/secret table; never import as active credentials without a dedicated takeover flow. |
| System platform | `u2f_key` | 9 | no | no | Legacy U2F key table retained for older installations. | Security credential/secret table; never import as active credentials without a dedicated takeover flow. |
| System platform | `password_resets` | 3 | no | no | Password reset tokens. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `sessions` | 6 | no | no | Database session store. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `cache` | 3 | no | no | Database cache store. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `jobs` | 6 | no | no | Database queue jobs. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `failed_jobs` | 6 | no | no | Failed queue job log. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `job_batches` | 10 | no | no | Laravel queue batch metadata. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `crons` | 5 | no | no | Tracks scheduled command execution metadata. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `instances` | 8 | no | yes | Instance-level metadata and version/check state. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |
| System platform | `statistics` | 30 | no | no | Instance/account aggregate counters used by dashboard/admin/statistics. | Platform/infrastructure table; do not import as business data, recreate in the new runtime. |

## Compact column inventory
This section is intentionally exhaustive at table/column-name level so a migration plan does not accidentally drop a Monica feature.

### Core account / identity / billing / import-export
**`accounts`** — Tenant/account root. Most user-owned records carry `account_id` and cascade from this table.

Columns: `id`, `api_key`, `created_at`, `updated_at`, `stripe_id`, `trial_ends_at`, `number_of_invitations_sent`, `has_access_to_paid_version_for_free`, `default_time_reminder_is_sent`, `legacy_free_plan_unlimited_contacts`, `default_gender_id`, `uuid`, `pm_type`, `pm_last_four`.

**`users`** — Login identities inside an account. Stores authentication, MFA, display, locale, and preference data.

Columns: `id`, `first_name`, `last_name`, `email`, `password`, `remember_token`, `created_at`, `updated_at`, `account_id`, `timezone`, `locale`, `fluid_container`, `metric`, `contacts_sort_order`, `currency_id`, `invited_by_user_id`, `name_order`, `google2fa_secret`, `dashboard_active_tab`, `gifts_active_tab`, `profile_active_tab`, `profile_new_life_event_badge_seen`, `email_verified_at`, `temperature_scale`, `admin`, `me_contact_id`, `uuid`.

**`invitations`** — Pending invitations for additional account users.

Columns: `id`, `account_id`, `invited_by_user_id`, `email`, `invitation_key`, `created_at`, `updated_at`.

**`recovery_codes`** — 2FA recovery codes for users.

Columns: `id`, `account_id`, `user_id`, `recovery`, `used`, `created_at`, `updated_at`.

**`terms`** — Versioned legal/compliance policy documents.

Columns: `id`, `term_version`, `term_content`, `privacy_version`, `privacy_content`, `created_at`, `updated_at`.

**`term_user`** — Pivot recording which user/account accepted which terms and from what IP.

Columns: `account_id`, `user_id`, `term_id`, `ip_address`, `created_at`, `updated_at`.

**`modules`** — Per-account feature-module toggles shown on contact profiles.

Columns: `id`, `account_id`, `key`, `translation_key`, `active`, `delible`, `created_at`, `updated_at`.

**`default_contact_modules`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `key`, `translation_key`, `delible`, `active`, `migrated`, `created_at`, `updated_at`.

**`subscriptions`** — Laravel Cashier subscription records for account billing.

Columns: `id`, `account_id`, `name`, `stripe_id`, `quantity`, `trial_ends_at`, `ends_at`, `created_at`, `updated_at`, `stripe_status`, `stripe_price`.

**`subscription_items`** — Laravel Cashier subscription item rows after Cashier upgrade.

Columns: `id`, `subscription_id`, `stripe_id`, `quantity`, `created_at`, `updated_at`, `stripe_price`, `stripe_product`.

**`export_jobs`** — Async export job metadata for SQL/JSON downloads.

Columns: `id`, `uuid`, `account_id`, `user_id`, `type`, `status`, `location`, `filename`, `started_at`, `ended_at`, `created_at`, `updated_at`.

**`import_jobs`** — vCard/CSV import job metadata.

Columns: `id`, `account_id`, `user_id`, `type`, `contacts_found`, `contacts_skipped`, `contacts_imported`, `filename`, `started_at`, `ended_at`, `failed`, `failed_reason`, `created_at`, `updated_at`.

**`import_job_reports`** — Per-contact import result rows for an import job.

Columns: `id`, `account_id`, `user_id`, `import_job_id`, `contact_information`, `skipped`, `skip_reason`, `created_at`, `updated_at`.

**`audit_logs`** — Account audit/event log rows, optionally about a contact.

Columns: `id`, `account_id`, `author_id`, `about_contact_id`, `author_name`, `action`, `objects`, `audited_at`, `should_appear_on_dashboard`, `created_at`, `updated_at`.

**`api_usage`** — Daily API usage counters by account/user/IP.

Columns: `id`, `url`, `method`, `client_ip`, `created_at`, `updated_at`.

**`currencies`** — Global currency list used by users, debts, and gifts.

Columns: `id`, `iso`, `name`, `symbol`, `created_at`, `updated_at`.


### Contacts and profile data
**`contacts`** — Primary person record. Holds name, profile metadata, special-date pointers, avatar state, CardDAV state, and archive/delete flags.

Columns: `id`, `account_id`, `first_name`, `middle_name`, `last_name`, `first_met_where`, `first_met_additional_info`, `job`, `deleted_at`, `created_at`, `updated_at`, `default_avatar_color`, `last_talked_to`, `avatar_file_name`, `company`, `gravatar_url`, `avatar_location`, `is_partial`, `first_met_through_contact_id`, `is_dead`, `has_avatar_bool`, `has_avatar`, `avatar_external_url`, `birthday_special_date_id`, `deceased_special_date_id`, `first_met_special_date_id`, `last_consulted_at`, `gender_id`, `stay_in_touch_frequency`, `stay_in_touch_trigger_date`, `nickname`, `is_starred`, `is_active`, `description`, `number_of_views`, `uuid`, `birthday_reminder_id`, `first_met_reminder_id`, `deceased_reminder_id`, `food_preferences`, `avatar_source`, `avatar_gravatar_url`, `avatar_adorable_uuid`, `avatar_adorable_url`, `avatar_default_url`, `avatar_photo_id`, `address_book_id`, `vcard`, `distant_etag`.

**`genders`** — Per-account gender vocabulary; contacts reference this instead of old enum gender.

Columns: `id`, `account_id`, `name`, `created_at`, `updated_at`, `type`, `uuid`.

**`contact_fields`** — Typed contact data values such as email addresses, phone numbers, social URLs, and profile links.

Columns: `id`, `account_id`, `contact_id`, `contact_field_type_id`, `data`, `created_at`, `updated_at`, `uuid`.

**`contact_field_types`** — Per-account definitions for contact field kinds. Defaults are copied from `default_contact_field_types`.

Columns: `id`, `account_id`, `name`, `fontawesome_icon`, `protocol`, `delible`, `type`, `created_at`, `updated_at`, `uuid`.

**`default_contact_field_types`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `name`, `fontawesome_icon`, `protocol`, `migrated`, `delible`, `type`, `created_at`, `updated_at`.

**`contact_field_labels`** — Reusable labels attached to contact fields or addresses.

Columns: `id`, `account_id`, `label_i18n`, `label`, `created_at`, `updated_at`.

**`contact_field_contact_field_label`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `contact_field_label_id`, `contact_field_id`, `account_id`.

**`addresses`** — Connects contacts to normalized places with an optional address display name.

Columns: `id`, `account_id`, `contact_id`, `name`, `created_at`, `updated_at`, `place_id`, `uuid`.

**`places`** — Postal/geographical place details shared by addresses and weather cache.

Columns: `id`, `account_id`, `street`, `city`, `province`, `postal_code`, `country`, `latitude`, `longitude`, `created_at`, `updated_at`.

**`address_contact_field_label`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `contact_field_label_id`, `address_id`, `account_id`.

**`companies`** — Companies/employers scoped to an account.

Columns: `id`, `account_id`, `name`, `website`, `number_of_employees`, `created_at`, `updated_at`.

**`occupations`** — Employment history and current work records for contacts.

Columns: `id`, `account_id`, `contact_id`, `company_id`, `title`, `description`, `salary`, `salary_unit`, `currently_works_here`, `start_date`, `end_date`, `created_at`, `updated_at`.

**`tags`** — Account-scoped labels used for contact grouping.

Columns: `id`, `account_id`, `name`, `name_slug`, `description`, `created_at`, `updated_at`.

**`contact_tag`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `contact_id`, `tag_id`, `account_id`, `created_at`, `updated_at`.

**`photos`** — Uploaded image metadata stored in filesystem-backed storage.

Columns: `id`, `account_id`, `original_filename`, `new_filename`, `filesize`, `mime_type`, `created_at`, `updated_at`, `uuid`.

**`contact_photo`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `contact_id`, `photo_id`, `created_at`, `updated_at`.

**`documents`** — Uploaded non-image document metadata stored in filesystem-backed storage.

Columns: `id`, `account_id`, `contact_id`, `original_filename`, `new_filename`, `filesize`, `type`, `mime_type`, `number_of_downloads`, `created_at`, `updated_at`, `uuid`.

**`addressbooks`** — Local CardDAV address books owned by a user/account.

Columns: `id`, `account_id`, `user_id`, `description`, `name`, `created_at`, `updated_at`, `uuid`.

**`addressbook_subscriptions`** — Remote CardDAV address book subscriptions and sync state.

Columns: `id`, `account_id`, `user_id`, `address_book_id`, `name`, `uri`, `username`, `password`, `readonly`, `active`, `capabilities`, `syncToken`, `localSyncToken`, `last_synchronized_at`, `created_at`, `updated_at`, `uuid`.

**`synctoken`** — DAV sync-token ledger used to track changed/deleted contacts/tasks/calendars.

Columns: `id`, `account_id`, `user_id`, `timestamp`, `created_at`, `updated_at`, `name`.

**`weather`** — Cached weather JSON for places.

Columns: `id`, `account_id`, `place_id`, `weather_json`, `created_at`, `updated_at`.


### Interactions, journal, relationships
**`activities`** — Shared account activity/interactions that can involve multiple contacts and appear in the journal.

Columns: `id`, `account_id`, `activity_type_id`, `description`, `created_at`, `updated_at`, `summary`, `happened_at`, `uuid`.

**`activity_contact`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `activity_id`, `contact_id`, `account_id`.

**`activity_statistics`** — Yearly per-contact denormalized activity counts.

Columns: `id`, `account_id`, `contact_id`, `year`, `count`, `created_at`, `updated_at`.

**`activity_type_categories`** — Per-account grouping for activity types.

Columns: `id`, `account_id`, `name`, `translation_key`, `created_at`, `updated_at`, `uuid`.

**`activity_types`** — Per-account activity type definitions.

Columns: `id`, `account_id`, `activity_type_category_id`, `name`, `translation_key`, `location_type`, `created_at`, `updated_at`, `uuid`.

**`default_activity_type_categories`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `translation_key`, `created_at`, `updated_at`.

**`default_activity_types`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `default_activity_type_category_id`, `translation_key`, `location_type`, `created_at`, `updated_at`.

**`calls`** — Logged phone/communication calls with a contact and optional emotions.

Columns: `id`, `account_id`, `contact_id`, `called_at`, `content`, `created_at`, `updated_at`, `contact_called`, `uuid`.

**`emotion_call`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `account_id`, `call_id`, `emotion_id`, `contact_id`, `created_at`, `updated_at`.

**`emotion_activity`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `account_id`, `activity_id`, `emotion_id`, `created_at`, `updated_at`.

**`emotions`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `emotion_primary_id`, `emotion_secondary_id`, `name`, `created_at`, `updated_at`.

**`emotions_primary`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `name`, `created_at`, `updated_at`.

**`emotions_secondary`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `emotion_primary_id`, `name`, `created_at`, `updated_at`.

**`notes`** — Free-form notes attached to contacts, with favorite support.

Columns: `id`, `account_id`, `body`, `created_at`, `updated_at`, `contact_id`, `is_favorited`, `favorited_at`, `uuid`.

**`conversations`** — Messaging thread with a contact, usually through a contact field type/channel.

Columns: `id`, `account_id`, `contact_id`, `contact_field_type_id`, `happened_at`, `created_at`, `updated_at`, `uuid`.

**`messages`** — Individual messages inside conversations.

Columns: `id`, `account_id`, `contact_id`, `conversation_id`, `content`, `written_at`, `written_by_me`, `created_at`, `updated_at`, `uuid`.

**`debts`** — Money owed by or to contacts.

Columns: `id`, `account_id`, `contact_id`, `in_debt`, `status`, `amount`, `reason`, `created_at`, `updated_at`, `currency_id`, `uuid`.

**`gifts`** — Gift ideas, offered gifts, and received gifts for contacts.

Columns: `id`, `account_id`, `url`, `created_at`, `updated_at`, `name`, `comment`, `contact_id`, `is_for`, `status`, `date`, `currency_id`, `amount`, `uuid`.

**`gift_photo`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `photo_id`, `gift_id`, `created_at`, `updated_at`.

**`tasks`** — Tasks that may be account-wide or attached to a contact; exported to CalDAV VTODO.

Columns: `id`, `account_id`, `title`, `description`, `completed_at`, `created_at`, `updated_at`, `contact_id`, `completed`, `uuid`.

**`reminders`** — Recurring or one-off reminders about contacts/special dates.

Columns: `id`, `account_id`, `title`, `description`, `frequency_type`, `frequency_number`, `created_at`, `updated_at`, `contact_id`, `initial_date`, `delible`, `inactive`, `uuid`.

**`reminder_rules`** — Per-account notification lead-time rules.

Columns: `id`, `account_id`, `number_of_days_before`, `active`, `created_at`, `updated_at`.

**`reminder_outbox`** — Scheduled reminder notifications generated from reminders and rules.

Columns: `id`, `account_id`, `reminder_id`, `user_id`, `planned_date`, `nature`, `notification_number_days_before`, `created_at`, `updated_at`.

**`reminders_sent`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `account_id`, `contact_id`, `reminder_id`, `title`, `description`, `html_sent_content`, `sent_date`, `scheduled_number_days_before`, `created_at`, `updated_at`.

**`journal_entries`** — Polymorphic journal timeline linking days, entries, and activities.

Columns: `id`, `account_id`, `date`, `journalable_id`, `journalable_type`, `created_at`, `updated_at`.

**`entries`** — Manual journal text entries.

Columns: `id`, `account_id`, `title`, `post`, `created_at`, `updated_at`, `uuid`.

**`days`** — Daily mood/rating records in the journal.

Columns: `id`, `account_id`, `date`, `rate`, `comment`, `created_at`, `updated_at`, `uuid`.

**`life_event_categories`** — Per-account groupings for life event types.

Columns: `id`, `account_id`, `name`, `default_life_event_category_key`, `core_monica_data`, `created_at`, `updated_at`, `uuid`.

**`life_event_types`** — Per-account life-event type definitions; can carry JSON schemas for specific fields.

Columns: `id`, `account_id`, `life_event_category_id`, `name`, `default_life_event_type_key`, `core_monica_data`, `specific_information_structure`, `created_at`, `updated_at`, `uuid`.

**`life_events`** — Timeline events for a contact, optionally tied to a reminder and with JSON details.

Columns: `id`, `account_id`, `contact_id`, `life_event_type_id`, `name`, `note`, `happened_at`, `happened_at_month_unknown`, `happened_at_day_unknown`, `specific_information`, `created_at`, `updated_at`, `reminder_id`, `uuid`.

**`default_life_event_categories`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `translation_key`, `migrated`, `created_at`, `updated_at`.

**`default_life_event_types`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `default_life_event_category_id`, `translation_key`, `specific_information_structure`, `migrated`, `created_at`, `updated_at`.

**`special_dates`** — Normalized contact dates such as birthdays, first-met date, and deceased date.

Columns: `id`, `account_id`, `contact_id`, `is_age_based`, `is_year_unknown`, `date`, `created_at`, `updated_at`, `uuid`.

**`relationship_type_groups`** — Per-account relationship category groups.

Columns: `id`, `account_id`, `name`, `delible`, `created_at`, `updated_at`.

**`relationship_types`** — Directional relationship labels; stores forward and reverse names.

Columns: `id`, `account_id`, `name`, `name_reverse_relationship`, `relationship_type_group_id`, `delible`, `created_at`, `updated_at`.

**`relationships`** — Directional edge from one contact to another through a relationship type.

Columns: `id`, `account_id`, `relationship_type_id`, `contact_is`, `of_contact`, `created_at`, `updated_at`, `uuid`.

**`default_relationship_type_groups`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `name`, `delible`, `migrated`, `created_at`, `updated_at`.

**`default_relationship_types`** — System, seed, pivot, or legacy table retained by migrations; inspect source links for exact lifecycle.

Columns: `id`, `name`, `name_reverse_relationship`, `relationship_type_group_id`, `delible`, `migrated`, `created_at`, `updated_at`.

**`metadata_love_relationships`** — Extra metadata for love/couple relationships.

Columns: `id`, `account_id`, `relationship_id`, `is_active`, `notes`, `meet_date`, `official_date`, `breakup_date`, `breakup_reason`, `created_at`, `updated_at`.

**`pets`** — Contact-associated pet records.

Columns: `id`, `account_id`, `contact_id`, `pet_category_id`, `name`, `created_at`, `updated_at`, `uuid`.

**`pet_categories`** — Global pet category vocabulary.

Columns: `id`, `name`, `is_common`, `created_at`, `updated_at`.


### System platform
**`oauth_access_tokens`** — Laravel Passport OAuth access tokens.

Columns: `id`, `user_id`, `client_id`, `name`, `scopes`, `revoked`, `created_at`, `updated_at`, `expires_at`.

**`oauth_auth_codes`** — Laravel Passport OAuth authorization codes.

Columns: `id`, `user_id`, `client_id`, `scopes`, `revoked`, `expires_at`.

**`oauth_clients`** — Laravel Passport OAuth clients.

Columns: `id`, `user_id`, `name`, `secret`, `provider`, `redirect`, `personal_access_client`, `password_client`, `revoked`, `created_at`, `updated_at`.

**`oauth_personal_access_clients`** — Laravel Passport personal access client registry.

Columns: `id`, `client_id`, `created_at`, `updated_at`.

**`oauth_refresh_tokens`** — Laravel Passport refresh tokens.

Columns: `id`, `access_token_id`, `revoked`, `expires_at`.

**`webauthn_keys`** — WebAuthn/FIDO2 credential records.

Columns: `id`, `user_id`, `name`, `credentialId`, `type`, `transports`, `attestationType`, `trustPath`, `aaguid`, `credentialPublicKey`, `counter`, `created_at`, `updated_at`.

**`u2f_key`** — Legacy U2F key table retained for older installations.

Columns: `id`, `user_id`, `keyHandle`, `publicKey`, `certificate`, `counter`, `created_at`, `updated_at`, `name`.

**`password_resets`** — Password reset tokens.

Columns: `email`, `token`, `created_at`.

**`sessions`** — Database session store.

Columns: `id`, `user_id`, `ip_address`, `user_agent`, `payload`, `last_activity`.

**`cache`** — Database cache store.

Columns: `key`, `value`, `expiration`.

**`jobs`** — Database queue jobs.

Columns: `id`, `queue`, `payload`, `reserved_at`, `available_at`, `created_at`.

**`failed_jobs`** — Failed queue job log.

Columns: `id`, `connection`, `queue`, `payload`, `exception`, `failed_at`.

**`job_batches`** — Laravel queue batch metadata.

Columns: `id`, `name`, `total_jobs`, `pending_jobs`, `failed_jobs`, `failed_job_ids`, `options`, `cancelled_at`, `created_at`, `finished_at`.

**`crons`** — Tracks scheduled command execution metadata.

Columns: `id`, `command`, `last_run`, `created_at`, `updated_at`.

**`instances`** — Instance-level metadata and version/check state.

Columns: `id`, `uuid`, `current_version`, `latest_version`, `latest_release_notes`, `number_of_versions_since_current_version`, `created_at`, `updated_at`.

**`statistics`** — Instance/account aggregate counters used by dashboard/admin/statistics.

Columns: `id`, `number_of_users`, `number_of_contacts`, `number_of_notes`, `number_of_reminders`, `number_of_tasks`, `number_of_kids`, `created_at`, `updated_at`, `number_of_invitations_sent`, `number_of_accounts_with_more_than_one_user`, `number_of_import_jobs`, `number_of_tags`, `number_of_activities`, `number_of_addresses`, `number_of_api_calls`, `number_of_calls`, `number_of_contact_fields`, `number_of_contact_field_types`, `number_of_debts`, `number_of_entries`, `number_of_gifts`, `number_of_oauth_access_tokens`, `number_of_oauth_clients`, `number_of_offsprings`, `number_of_progenitors`, `number_of_relationships`, `number_of_subscriptions`, `number_of_conversations`, `number_of_messages`.

## Import strategy for a replacement app
1. Detect input profile: Monica SQL export, Monica JSON export, raw SQL dump, and optional storage archive.
2. Load into staging tables that preserve raw table names, row ids, UUIDs, timestamps, and unknown/extra columns.
3. Build an `import_identities` map keyed by source app, source table, source integer id, source UUID, and new canonical id.
4. Import workspace/member/vocabulary records first.
5. Import contacts/persons and important dates.
6. Import dependent rows: contact methods, addresses, companies/occupations, tags, attachments metadata, notes, activities, calls, conversations/messages, tasks, reminders, gifts, debts, life events, relationships, pets, journal entries, audit logs.
7. Re-link pivots through the identity map.
8. Recompute derived data: stats, last talked to, future reminders, timeline projections, search indexes.
9. Import file bytes only if a storage archive is provided; otherwise mark attachment metadata as missing-file placeholders.
10. Produce a dry-run report before commit: row counts, orphaned references, missing files, unsupported fields, deleted/archived contact handling, and estimated resulting object counts.
## Final assessment
Monica’s architecture needs to be this broad only if the clone truly preserves all of its features: contact profiles, interactions, tasks/reminders, personal journal, activity taxonomy, relationships, gifts/debts, files, DAV, exports/imports, multi-user accounts, MFA, billing, and external integrations. It does not need to be this table-heavy or field-heavy. The optimal replacement is a smaller set of canonical aggregates with adapter modules and import staging around them. The biggest simplification wins are: make UUIDs first-class, consolidate attachments, move integration state out of contacts, split reminders into definitions/occurrences, replace default tables with seed manifests, move UI preferences out of user columns, and treat platform/security/billing tables as runtime adapter data rather than core personal-CRM data.
