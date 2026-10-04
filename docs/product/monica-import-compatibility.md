# Monica import compatibility

The import page accepts Monica's account SQL data export (`.sql`), the existing
`monica-json` version 1 envelope, vCard, and CSV. SQL imports use the same dry
run, explicit confirmation, transactional commit, workspace authorization, and
same-source re-import protection as the JSON profile. The stored source profile
is `sql_export` for SQL and `json_export` for the JSON envelope.

This is a bounded contact import, not a complete implementation of the canonical
Monica mapping catalog. Monica's native preview JSON structure and raw database
backups containing DDL are not accepted by this profile.

## SQL reader

SQL is read as data and never sent to a database executor. Accepted statements
are `INSERT [IGNORE] INTO table (columns...) VALUES (...)` and
`SET FOREIGN_KEY_CHECKS=0/1`. Identifiers may be bare or backtick quoted. The
reader accepts multiple tuples, single/double quoted strings, doubled quotes,
MySQL backslash escapes, numeric literals, booleans, `NULL`, ordinary comments,
and UTF-8 text. It rejects expressions, executable comments, functions, DDL,
other commands, malformed/truncated tuples, duplicate columns, and NUL values.
Errors never echo source values. Numeric literals in consumed text columns
retain their exact spelling, including leading zeroes and plus signs, because
Monica exports numeric-looking strings without quotes. IDs, flags, and byte
sizes retain numeric semantics.

Limits are 1.5 MB for the staging source envelope, 500 contacts, 100 legacy
users, 100 tables, 100 columns per INSERT, and 10,000 total SQL rows. Text
fields are bounded before staging. Notes above 10,000 characters reject the
import rather than being truncated. SQL files do not contain attachment bytes.

## Implemented fields

| Source                                                           | Imported behavior                                                                                                                                                                                                                   | Limitations disclosed in the dry run                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contacts`                                                       | `id`, optional `uuid`; first/middle/last name, nickname, description, food preferences; active/archive, deceased, partial, starred, optional deletion timestamp                                                                     | Other columns, including gender, contact cadence, introduction references/context, counters, and original timestamps, are reported as skipped. Source identity is retained in the import map; generated target IDs belong to the active workspace.                                |
| Contact avatar columns                                           | Default color; supported default/external/Gravatar/Adorable URL presentation; safe `avatar_file_name`                                                                                                                               | Remote URLs are not fetched. Files are represented as missing metadata.                                                                                                                                                                                                           |
| `contacts.avatar_photo_id` → `photos`                            | Account-scoped photo lookup; original filename and byte size become missing avatar metadata                                                                                                                                         | Only the selected avatar is linked. Gallery pivots, storage filenames, MIME type, and original timestamps are not imported.                                                                                                                                                       |
| `contacts.job`, `contacts.company`                               | Occupation title and organization text through the existing people import boundary                                                                                                                                                  | Company without a job title is reported as skipped. Separate `companies`/`occupations` tables are not imported.                                                                                                                                                                   |
| `contact_fields`, `contact_field_types`                          | Account-scoped type resolution for explicit `email`, `phone`, and `url`; email normalized to lowercase; numeric phone literals become text; repeated equal methods collapsed                                                        | Destination workspace must already have the corresponding contact-method type. Missing destination types produce a warning and skip those methods. Custom/social types, original type labels/protocols, and timestamps are not imported.                                          |
| `addresses`, `places`                                            | Account-scoped place lookup; street, city, province → region, postal code, country; numeric postal codes become text                                                                                                                | Address names/labels, coordinates, and original timestamps are not imported.                                                                                                                                                                                                      |
| Contact birthday/deceased/first-met references → `special_dates` | Account and contact scoped resolution into birthday, deceased, and first-met dates. Known dates retain full precision; unknown-year dates retain month/day. Age-only dates retain an approximate year without inventing a birthday. | Unreferenced/unresolvable/invalid dates and original date UUIDs/timestamps are reported as skipped. Existing date creation handles reminder regeneration; Monica reminder rows are not copied.                                                                                    |
| `notes`                                                          | Each nonblank body becomes a separate note through the existing interactions import boundary                                                                                                                                        | Original author, favorite flags, and timestamps are not preserved. Oversized notes reject the source.                                                                                                                                                                             |
| `users`                                                          | Counted and discarded                                                                                                                                                                                                               | No imported identities, passwords, sessions, API keys, or second factors are activated.                                                                                                                                                                                           |
| Other tables                                                     | Counted by table, then skipped                                                                                                                                                                                                      | Includes activities and their types/pivots/statistics, calls/conversations/messages, tags/pivots, debts/gifts, journal/life events, pets, relationships/types/groups, reminders/rules/outbox, documents/gallery links, account/settings vocabularies, weather, and audit history. |

Credentials in `accounts`, `recovery_codes`, `users`, and other unsupported SQL
tables are discarded before parsed data is returned. Recognized credential
columns on contact snapshots are redacted. Only normalized, supported contact
details and note bodies reach persistent staging; unknown table contents are
never staged.

## Reading the report

The report lists unsupported table row counts and unsupported column counts,
plus missing files, orphaned contact references, discarded users, and missing
workspace contact-method types. Unsupported totals combine row and field counts;
they are not a count of people lost. Contact-column counts include occurrences
of unsupported columns even when null, preserving the existing JSON profile's
counting behavior. Related-table field counts count nonempty values on consumed
rows. Unsupported rows are counted once rather than counting every field again.

Review these losses before confirming. Re-importing the same normalized source
reuses existing people and does not append duplicate notes, methods, addresses,
dates, occupations, or missing avatars. Existing people stay unchanged; people
deleted after an earlier import stay deleted. A changed source is not an update
or reconciliation mechanism and can create new people.

The synthetic regression fixture at
`packages/backend/modules/import-export/domain/formats/fixtures/monica.sql`
contains invented people, addresses, notes, and credential markers only. Private
exports must never be committed to the repository.
