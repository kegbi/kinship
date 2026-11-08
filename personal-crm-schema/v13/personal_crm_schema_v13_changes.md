# Repository schema v12 to v13

V13 (AUD-V1) makes the indexes match the statements that read them, lets a
durable MFA challenge be a session row, holds a pending registration's
workspace name, and seeds the two global catalogs once. It adds one column and
no table, so the field catalog has 877 rows; the Monica mappings are unchanged,
since no Monica column maps to the new one.

## Indexes

Each measurement below is three runs of the repository's statement with
`EXPLAIN (ANALYZE)` on a disposable database, on PostgreSQL 18.4 and 17.10,
before (v12) and after applying `0013` and `ANALYZE`. The data is one workspace
at about the audit's large profile: 10,000 people, 30,000 notes, 7,300 birthday
reminders, and 87,600 reminder occurrences (eleven years of delivered history
and one open occurrence per reminder).

| Statement (index)                                           | v12, 18.4 / 17.10 (ms) | v13, 18.4 / 17.10 (ms) |
| ----------------------------------------------------------- | ---------------------- | ---------------------- |
| Today recent notes (`notes_workspace_created_idx`)          | 13.8–15.9 / 10.7–15.6  | 0.43–0.52 / 0.48–0.71  |
| Notification feed arm (`reminder_occurrences_member_feed_idx`) | 35.4–44.8 / 37.2–41.1  | 0.72–0.94 / 0.76–0.95  |
| Today attention arm (`reminder_occurrences_member_open_idx`) | 14.3–19.3 / 15.4–17.9  | 1.05–1.11 / 0.99–1.65  |
| Directory first page (`people_active_given_name_idx`)       | 4.8–7.4 / 3.4–5.1      | 0.05–0.08 / 0.06–0.09  |
| Directory continuation 5,000 people in (same index)         | 3.5 / 4.9 (v13 index, OR seek) | 0.10–0.13 / 0.11–0.13  |
| Duplicate-name check (`people_active_duplicate_name_idx`)   | 2.9–3.3 / 2.1–2.8      | 0.09–0.17 / 0.06–0.23  |
| A birthday's reminder (`reminders_person_date_idx`)         | 0.51–0.76 / 0.48–0.84  | 0.047–0.051 / 0.049–0.066 |
| Authentication budget count (`api_request_logs_post_subject_idx`) | 14.2–15.3 / 14.5–17.2  | 0.13–0.16 / 0.14–0.20  |

- The feed index leads with `member_id` and orders by
  `date_trunc('milliseconds', visible_at AT TIME ZONE 'UTC') DESC, id DESC`, the
  exact key each feed arm orders and pages by (AUD-Q1), so an arm's page is read
  in index order. BEQ-07's `(member_id, visible_at DESC, id DESC)` could not
  supply that order.
- The directory's name-order continuation compares
  `(primary, secondary, id) > (cursor)` as one row instead of its expanded
  disjunction. The keys are never null, so the order is the same, and only the
  row form lets the index seek; the OR form read and discarded every earlier
  person (5,000 rows in the row above).
- The budget count statement (AUD-A3, AUD-M3) was measured with 450,000 log rows
  (150,000 sign-in, reset, and registration attempts across 5,000 subjects and
  300,000 other requests). v12's partial index excludes the null and 200
  outcomes the statement counts, so it read every row of the 24-hour window.
- `reminders_life_event_idx` and `reminders_task_idx` have the shape of
  `reminders_person_date_idx`, for the same lookup and delete cascade.

Dropped: `people_workspace_idx` (a prefix of `people_workspace_id_id_key`),
`person_dates_person_idx` (a prefix of `person_dates_person_kind_idx`),
`people_active_name_idx` (no statement uses its expressions),
`api_request_logs_auth_subject_idx` (see below),
`person_contact_methods_normalized_idx` (the duplicate finder never reads the
column), and `users_status_idx`, `workspaces_status_idx`,
`workspace_members_status_idx`, and `debts_status_idx` (never scanned; the
member and debt workspace cascades use their `(workspace_id, id)` keys). Net:
nine added and nine dropped, so the explicit-index count stays 157.

`api_request_logs_auth_subject_idx` holds POST attempts with a subject and
status 401 only. The sign-in budget counts outstanding, 200, and 401 attempts,
the registration and invitation mail budgets count their 202 reservations, and
a reservation is finalized by its id, so no statement's condition implies the
index's predicate. With `api_request_logs_post_subject_idx` dropped and
sequential scans disabled, PostgreSQL 18.4 still planned every one of these
statements without it.
`reminder_occurrences_due_idx` and `reminder_occurrences_lease_idx` stay for
the worker's claim and lease scans.

Kept after validation against workspace delete and reset (BEQ-12):
`calls_workspace_date_idx`, `conversation_threads_workspace_idx`, and
`gifts_status_idx`. Each is its table's only workspace-leading index, and the
workspace cascade, the lifecycle impact counts, and the directory's last-contact
aggregate filter these tables by workspace alone. Deleting one of 200
workspaces (600,000 calls, 150,000 threads, 100,000 gifts in all) on 18.4, with
and without them:

| Cascade or read                 | kept (ms) | dropped (ms) |
| ------------------------------- | --------- | ------------ |
| calls workspace cascade         | 10.9–12.6 | 35.9–42.8    |
| threads workspace cascade       | 2.7–3.3   | 8.5–10.7     |
| gifts workspace cascade         | 2.0–4.4   | 4.6–6.4      |
| last-contact calls arm          | 5.7–9.0   | 25.8–34.5    |

At 40 workspaces the cascades cost the same either way; without the index each
grows with every tenant's rows, so the three stay. `gifts_status_idx` is one of
BEQ-12's five status indexes and is kept for this reason.

`reminder_occurrences_member_idx` also stays. The member foreign key deletes a
removed member's occurrences with `DELETE FROM ONLY crm.reminder_occurrences
WHERE $1 = member_id`, and D5 keeps the sent history, which the two partial
member indexes exclude, so without a full index leading with `member_id` that
statement reads every tenant's occurrences. The data is 40 workspaces of two
members, 10,000 monthly reminders, and 800,000 occurrences (39 sent and one
open per reminder and member); each figure is three runs, rolled back, of the
cascade statement's generic plan or of deleting one workspace:

| Cascade or delete                        | dropped, 18.4 / 17.10 (ms) | kept, 18.4 / 17.10 (ms) |
| ---------------------------------------- | -------------------------- | ----------------------- |
| one member's cascade statement           | 22.2–61.8 / 46.5–58.5      | 3.3–3.7 / 3.1–3.4       |
| member cascade within a workspace delete | 45.1–53.4 / 87.1–95.0      | 5.2–6.1 / 5.9–7.2       |
| the whole workspace delete               | 79.9–124.2 / 122.1–164.4   | 37.8–79.2 / 44.5–92.0   |

Without the index, 18.4 skip-scans `reminder_occurrences_unique_delivery`, which
leads with `reminder_id`, across every tenant's reminders, and 17.10, which has
no skip scan, reads the whole table. The review measured a sequential scan on
18.4 with fewer reminders. Either way the cost grows with every tenant's
history.

## MFA challenge purpose

`user_sessions_purpose_check` admits `mfa-challenge`, and the column comment
says so, so AUD-A4 can store a password-verified challenge as a hashed session
row with durable attempt counts. No row is rewritten.

## Pending registration workspace name

`users.pending_workspace_name text` is nullable with no default. AUD-A2
provisions a registration's workspace when its address is verified rather than
when it registers, so the name the registration asked for must wait somewhere
in between. Identity owns `users` and the pending user it creates, so the name
is a column there rather than a `pending_registrations` table, which would add
a second identity table with the same key and lifecycle as the user row. A2
clears the column once it provisions the workspace.

`workspaces.name` has no database constraint; the only limit on a workspace
name is the registration contract's `z.string().trim().min(2).max(120)`.
`users_pending_workspace_name_ck` mirrors that: the value equals its `btrim` and
is 1 to 120 characters. Zod counts UTF-16 code units, so its minimum of two
admits a single astral character and its maximum of 120 never exceeds 120
characters; the check therefore admits every name the contract does. Existing
users receive null, so `0013` backfills nothing, and the check is validated on
an all-null column.

## Seeded catalogs

`emotion_options` receives the 132 distinct Monica 4.x stock emotions (133 ids;
`pleasure` appears twice), top-level and active, with the Monica id as
`sort_order`. `pet_categories` receives the 11 stock categories in Monica id
order; `cat`, `dog`, and `fish` are common, as the importer already marks them.
An upgraded database keeps each row an import already created, with its id, so
the calls, activities, and pets that reference it are untouched; only the
missing stock names are inserted. The importers already reuse an existing name,
so no tenant's import changes the shared catalogs any more (SECT-10).

## Decided, not in v13

- **Version-7 ids (BEQ-15): not adopted.** PostgreSQL 17.10 has no `uuidv7()`,
  so a column default would need a PostgreSQL 17 function. One million rows
  into a table with a uuid key and a `(workspace_id, at DESC)` index, three runs
  each:

  | Generator                       | 18.4 bulk (s)  | 17.10 bulk (s) | 50,000 single-row inserts into 1M (ms), 18.4 / 17.10 | key size |
  | ------------------------------- | -------------- | -------------- | ---------------------------------------------------- | -------- |
  | `gen_random_uuid()` (v4)        | 5.8, 6.9, 6.3  | 6.2, 6.3, 6.4  | 520, 428, 443 / 577, 480, 387                        | 37–38 MB |
  | PostgreSQL 17 compatible v7     | 6.4, 5.0, 5.8  | 5.4, 5.5, 4.9  | 465, 390, 389 / 359, 381, 361                        | 39–40 MB |
  | native `uuidv7()` (18.4 only)   | 4.0, 5.2       | unavailable    | not measured                                         | 30 MB    |

  The compatible function is not monotonic within a millisecond, so it loses the
  key-size win and its bulk result on 18.4 ranges from 10% slower to 27% faster;
  the native function's win does not exist on 17.10. The gain appears only at
  a million rows, above the capacity profile's tables, and a version-7 id would
  publish each note's, call's, and message's creation time in its URL. Reopen
  when PostgreSQL 17 leaves the support matrix and an append-heavy table's key
  index outgrows memory.
- **`reminders.generated_through`: not added.** AUD-W1 measured the
  steady-state replenishment at 7 statements and about 145 ms at the large
  profile without it.
- **Not in v13:** a change to the keys behind SECT-03 (AUD-M1 deletes in
  dependency order) and a trigram index (D6).

## Migration, locking, and rollback

`0013_index_queries_and_seed_catalogs.sql` runs inside the runner's single
transaction. Each `CREATE INDEX` takes a `SHARE` lock that blocks writes to its
table until commit, so a large deployment upgrades in a quiet window; reads are
not blocked. `DROP INDEX` and the constraint swap take brief exclusive locks.
The constraint is re-added with validation, which reads `user_sessions` once.
Adding the nullable `users` column changes only the catalog; its check is
validated in one read of `users` under a brief exclusive lock. Failure rolls
back every index, the constraints, the column, and the seeds together.

The v12 application code runs unchanged on v13: it never writes
`mfa-challenge` or `pending_workspace_name`, the indexes change only plans, and the importers already reuse
existing catalog names. A migration runner built before v13 finds an unknown
catalog and refuses it, so roll back by redeploying a v13-aware image. A
reviewed manual script can recreate the dropped indexes and drop the new ones,
though the exact-catalog check would then classify the database as drift;
prefer a forward fix.

Validation covers immutable v1–v12 hashes, clean v13 apply, exact v1–v12
upgrade through `0013`, idempotent verification, drift rejection, transactional
rollback of `0013`, preservation of imported catalog rows and existing
sessions, the exact definitions of the added, kept, and dropped indexes, a full
index leading with `reminder_occurrences.member_id`, and
`users.pending_workspace_name` with its exact check.
