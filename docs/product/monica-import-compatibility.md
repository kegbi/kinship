# Monica import compatibility

The import page accepts Monica account SQL data exports, the `monica-json`
version 1 envelope, vCard and CSV. Monica imports use a dry run, explicit
confirmation and one workspace-scoped transaction. Native preview JSON and raw
backups containing DDL are not supported.

## SQL reader and limits

SQL is parsed as data and never executed. Accepted statements are literal
`INSERT [IGNORE] INTO table (columns...) VALUES (...)` and
`SET FOREIGN_KEY_CHECKS=0/1`. Expressions, executable comments, functions, DDL,
malformed tuples, duplicate columns and NUL values are rejected. Errors do not
include source values. Numeric-looking text retains its original spelling.

Limits include a 1.5 MB source envelope, 500 contacts, 100 legacy users, 100 SQL
tables, 100 columns per INSERT and 10,000 SQL rows. Oversized notes and business
text reject the source rather than being truncated. SQL exports contain file
metadata, not attachment bytes.

## Imported data

| Source                         | Imported behavior                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts                       | Names, nickname, description, food preferences, occupation, archive/deceased/partial/starred state, deletion state, source timestamps, gender and first-meeting context; missing nonnull gender references require per-contact review. Source UUIDs and numeric keys remain traceable in the import identity map.                                                                             |
| Contact fields and types       | Email, phone, URL, social, messaging, username and custom values. The complete source catalog, including unused types, retains names, kinds, protocols, icons, deletion flags and timestamps. Newly created method values retain source timestamps. Existing destination records are not overwritten. Missing types require Create, Map or Skip choices; validation creates no configuration. |
| Addresses and places           | Structured address, display label, coordinates and timestamps, through the people owner.                                                                                                                                                                                                                                                                                                      |
| Special dates                  | Birthday, deceased and first-met dates, including unknown years and approximate age-only years. Invalid or unresolvable dates are reported.                                                                                                                                                                                                                                                   |
| Notes                          | Separate note bodies, source creation/update times, favorite state and favorite time. Legacy authors are not assigned to the importing member. A favorite without a source favorite timestamp uses an available source update/creation timestamp.                                                                                                                                             |
| Relationships and vocabularies | Forward/reverse labels, groups and edges. Mirrored Monica rows map to one directional edge while both source identities remain traceable.                                                                                                                                                                                                                                                     |
| Activities and calls           | Activity categories/types, summaries, descriptions, occurrence timestamps, participants, call direction/content and supported stock emotion tags.                                                                                                                                                                                                                                             |
| Reminders, rules and cadence   | Source definitions, active/delete state, recurrence, lead-time rules and stay-in-touch cadence. Only future notification occurrences are generated in the importing member's explicitly selected timezone. Historical delivery queues are not replayed.                                                                                                                                       |
| Tags and pets                  | Workspace tags, person links, pet names and verified stock pet categories. Unknown private categories remain unlinked and are reported.                                                                                                                                                                                                                                                       |
| Gifts and debts                | Amount, currency when known, direction, state and available historical metadata. Missing or unsupported debt currencies require a choice; invalid amounts are reported.                                                                                                                                                                                                                       |
| Journal                        | Posts, day ratings and index references to imported activities, with source dates.                                                                                                                                                                                                                                                                                                            |
| Photos and gallery links       | Missing-file metadata, MIME type, original filename, size, gallery links and selected avatar. Remote URLs are not fetched.                                                                                                                                                                                                                                                                    |
| Workspace vocabulary           | Gender options, life-event categories/types and supported profile module visibility. This does not import life-event instances.                                                                                                                                                                                                                                                               |
| Audit history                  | Historical actions, timestamps, actor name snapshots and safe provenance. Legacy actors are not granted memberships or credentials.                                                                                                                                                                                                                                                           |

Monica SQL money fields contain integer minor units. The importer converts them
exactly using the known or explicitly selected currency's minor-unit scale.
Debts with missing or unsupported currencies stay staged with the exact source
integer until the member chooses a supported currency. The preview shows the
resulting amount, contact, direction and reason. Apply a currency to all debts,
then override individual debts as needed. The JSON profile retains decimal
major-unit amounts. Neither source currency IDs nor a legacy user's preferred
currency are guessed.

Each missing nonnull source gender reference requires a per-contact choice: an
active workspace option, an available source catalog option, a newly named
option, or explicit Unspecified. Names never imply gender. No destination
options are required to choose Unspecified or create an option.

Every Monica import also requires **Your timezone**. This saves only the
importing member's personal timezone and schedules their imported reminders,
including future replenishment. Other members keep their preferences. All
currency, gender, timezone and contact-type selections are validated by the
server before writes. Source changes and revalidation clear the form choices; a
retryable commit failure retains them. CSV and vCard do not require these
Monica-specific choices.

A Monica date does not by itself enable a new reminder: only source reminder
rows create imported definitions. Corresponding reminders generated by an older
import are reused and their source active state is respected. Existing reminders
without a corresponding source row are left as the member has kept them.

## Reports and exclusions

The report lists staged business records, unsupported table rows, unsupported
nonempty fields, missing files, orphan references and discarded credentials.
Totals combine rows and fields; they do not count people lost. Missing catalog
references are reported instead of inventing values. Pending debt currencies and
contact genders appear as review items, not skipped data; completed reports show
the reviewed outcomes.

Legacy users, account credentials, recovery codes and terms links are excluded.
Weather caches, activity statistics and historical reminder delivery queues are
excluded; canonical activity reports are derived from imported interactions.
Unsupported tables, including conversations, messages and documents, are
reported explicitly. Contact view counters, obsolete avatar implementation flags
and other unsupported metadata remain disclosed in the field report. Recognized
credential fields are redacted before persistent staging.

## Re-imports and existing workspaces

Approved vocabulary creation, the personal timezone, reminder scheduling and
every business write share the import transaction; a failure rolls them all
back. Mapping targets must remain active and belong to the workspace. Retired
types are not reactivated.

Repeated imports reuse staged business identities and already reviewed currency
and gender resolutions, without requesting those choices again or overwriting
later user edits. Older unresolved imports support additive repair only while
the destination field remains null, the original debt amount and other source
facts still match, and the owning record has not been edited since its first
import. A later user edit is preserved even when an intermediate reimport did
not resolve the missing field. Newly supported records can be added to people
imported by an older version. Contact UUIDs identify prior imported people
within the workspace; contacts without UUIDs require a matching current or
supported legacy source fingerprint. Numeric source keys alone never match
unrelated exports. Business IDs also include a source namespace to isolate
unrelated exports that reuse numeric IDs.

Previously imported note bodies and addresses are reconciled with their source
identities when upgrading an older partial import. Contact methods remain
additive: approving a previously skipped type adds only missing normalized
values. Deleted people stay deleted and dependent records are skipped. This is
an import facility, not a general synchronization engine for changed exports.

All committed fixtures contain invented data. Private exports must never be
committed to the repository.

Monica profile module aliases map to the application’s section keys. Its three
relationship sections share one section, enabled when any source relationship
section is enabled; mixed visibility is reported. Source settings for fixed
sections (including gifts, debts, reminders and documents) and unknown section
keys are reported as unsupported. Global pet categories accept only verified
stock category names; custom names are reported rather than published into the
shared catalog. Distinctly named phone, email and URL types require an explicit
catalog choice when no same-name type exists.
