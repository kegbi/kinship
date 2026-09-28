# Repository schema v8 to v9

## Decision

On 2026-09-28 the product owner approved one synchronized schema v9 that batches
two changes:

- `REL-061`: at 50,000 notes and 50,000 activities per workspace, the text
  groups of `GET /api/v1/search` scanned every row and reached the 1.5 s
  statement bound. V9 adds GIN expression indexes on the exact
  `to_tsvector('simple', …)` expression search matches for each group.
- `REL-064`: a member needs to mark two people "not duplicates" so the
  directory's duplicates review stops offering the pair, and every member of the
  workspace shares that decision. V9 adds the table that stores it; the use
  case, API, and interface are a separate ticket.

## Full-text search indexes

| Index                      | Table           | Indexed expression                                                       |
| -------------------------- | --------------- | ------------------------------------------------------------------------ |
| `notes_search_idx`         | `notes`         | `to_tsvector('simple', body)`                                            |
| `activities_search_idx`    | `activities`    | `to_tsvector('simple', summary \|\| ' ' \|\| coalesce(description, ''))` |
| `journal_posts_search_idx` | `journal_posts` | `to_tsvector('simple', coalesce(title, '') \|\| ' ' \|\| body)`          |
| `tasks_search_idx`         | `tasks`         | `to_tsvector('simple', title \|\| ' ' \|\| coalesce(description, ''))`   |

All four use `USING gin`. The planner uses an expression index only for the
identical expression, so the search statement spells each match exactly as its
index does. Before v9 the statement matched
`to_tsvector('simple', concat_ws(' ', a, b))`; `concat_ws` is `STABLE`, not
`IMMUTABLE`, so PostgreSQL refuses it in an index. The v9 expressions
concatenate with `||` and `coalesce` instead. For every row they produce the
same lexemes in the same positions as the `concat_ws` form (a leading or
trailing space adds no word), so search semantics do not change: matching is
still `websearch_to_tsquery('simple', …)` word matching, with the same results,
order, and snippets.

The indexes do not include `workspace_id`. A multicolumn GIN index over a
`uuid` needs the `btree_gin` extension, which the schema does not use; the
planner combines the GIN match with the existing workspace indexes or filters
the few matching rows by workspace instead.

## Workspace-shared duplicate dismissals

`person_duplicate_dismissals (workspace_id, person_low_id, person_high_id,
dismissed_by_member_id, created_at)` stores one row per dismissed unordered
pair:

- `person_duplicate_dismissals_order_ck` requires
  `person_low_id < person_high_id`, so a pair has exactly one spelling, and the
  primary key `(workspace_id, person_low_id, person_high_id)` makes a second
  dismissal of the same pair a conflict rather than a second row.
- `person_duplicate_dismissals_low_person_fk` and
  `person_duplicate_dismissals_high_person_fk` reference
  `people (workspace_id, id)`, so the database rejects a pair whose people
  belong to another workspace than the row. Both cascade when a person is
  hard-deleted, as person links do. To be referenced, `people` gains
  `people_workspace_id_id_key UNIQUE (workspace_id, id)`; no existing row can
  violate it because `id` is already unique.
- `dismissed_by_member_id` follows the `*_by_member_id` pattern and is set null
  when the member is removed.
- `person_duplicate_dismissals_high_idx (workspace_id, person_high_id)` serves
  the cascade and lookups by the higher id; the primary key serves the lower.

The table is owned by the `people` module, which owns merge and the directory's
people. A person merge rewrites the duplicate's dismissals onto the primary in
canonical order and drops the pair being merged and any pair the primary
already has.

## Documentation-only comment correction

The comment on `reminder_occurrences.channel` still said the first production
adapter supports `in_app` only, which has been untrue since v8's email delivery
(`PLANNING-003`). V9 corrects the column comment, the specification, and the
field catalog to describe both `in_app` and `email`. No constraint, default, or
data changes.

## Compatibility mappings

The Monica mappings are complete copies of v8. Monica has no search index or
duplicate-dismissal source, and the mappings list source tables only, so no
disposition changes.

## Migration and recovery

`0009_add_search_indexes_and_duplicate_dismissals.sql` is additive and runs
inside the canonical migration runner's single transaction, so it cannot use
`CREATE INDEX CONCURRENTLY`. Each `CREATE INDEX` holds a lock that blocks writes
to its table while it builds; at the volumes `REL-061` measured the builds take
seconds, well within the runner's 120 s statement bound. Adding
`people_workspace_id_id_key` with
`ALTER TABLE crm.people ADD CONSTRAINT … UNIQUE (workspace_id, id)` takes an
`ACCESS EXCLUSIVE` lock on `people`, blocking its reads and writes while the
unique index builds. The runner waits at most 5 s (`lock_timeout`) for each
lock, so on a busy system the migration may roll back and need a retry. The
upgrade changes no row. A failure anywhere rolls the whole migration back.

Application rollback is compatible: an older application never reads the new
table, and the indexes and unique key only speed up or constrain reads it
already makes. Rolling the schema itself back is a manual, reviewed operation:
drop the four `*_search_idx` indexes, drop `person_duplicate_dismissals` (losing
recorded dismissals, so those pairs are offered again), and drop
`people_workspace_id_id_key`.

## Validation boundary

V9 requires exact artifact hashes, clean apply, exact v1-v8 upgrades,
idempotent verification, drift rejection, atomic migration rollback, the
canonical pair order, pair uniqueness, cross-workspace rejection by both
composite foreign keys, the cascade on person deletion, and the presence of each
full-text index. The search integration suite proves that the search statement
reaches each group's index.
