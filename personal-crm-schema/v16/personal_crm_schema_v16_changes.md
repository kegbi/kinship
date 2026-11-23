# Repository schema v15 to v16

V16 (MCP-E3) adds one workspace-owned table, `request_tombstones`, and changes
nothing else. It adds four columns, so the field catalog has 911 rows; the
Monica mappings are unchanged, since no Monica column maps to a tombstone.

## Why

A create that carries a retry key (`requestId`) derives its record's id from the
workspace and the key (`deterministicId`, a version-8 UUID), locks that id
(`lockRequest`), and returns a record already stored under it instead of writing
it twice. Journal posts, notes, activities, calls, conversations, gifts, debts,
and recurring debt rules are deleted permanently, so once one is deleted the
retry finds no row. Under v15 the first five then recorded the item again;
`gifts` refused the retry only because it asked the audit history whether an
event about the id existed (`AuditEventRecorder.subjectRecorded`), which is
correct only while no audit event is ever pruned and has no matching index.

## The table

```sql
CREATE TABLE request_tombstones (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  record_type text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, record_id),
  CONSTRAINT request_tombstones_record_type_ck CHECK (record_type IN ('activity', 'call', 'conversation', 'debt', 'gift', 'journal_post', 'note', 'recurring_debt'))
);
```

- The primary key `(workspace_id, record_id)` makes the create's check a point
  lookup, whatever the size of the workspace's history.
- It forces row-level security under the exact v14 `workspace_isolation` policy
  on `workspace_id`
  ([ADR 0008](../../docs/architecture/decisions/0008-database-enforced-workspace-isolation.md)),
  which makes 76 forced tables. It references only its workspace, so the
  reference guard and `tests/support/workspace_references.ts` are unchanged.
- `kinship_app` holds `SELECT` and `INSERT` and nothing else: the API reads and
  adds tombstones and never changes or removes one. `kinship_worker` holds no
  privilege on it, since no worker job deletes one of these records. The
  workspace cascade removes the rows as the table's owner, as every referential
  action runs.
- `governance` owns it (`docs/architecture/module-boundaries.yaml`), beside
  `audit_events`: like the audit history it is a record about other modules'
  rows that every one of them writes through one kernel port
  (`RequestTombstones` in
  `packages/backend/shared-kernel/request_tombstone.ts`), implemented once by
  governance's adapter.

## Which ids get a tombstone

Only an id a retry key derived. `deterministicId` stamps version 8 into every
derived id, while every fresh id is a random version-4 UUID (the injected
generator is `crypto.randomUUID()`, and the DDL's default is
`gen_random_uuid()`), so the version nibble tells them apart reliably
(`isRequestDerivedId` in `shared-kernel/ids.ts`). A random id can never be
reached by a keyed create, so its tombstone would be dead weight. The use cases
hand every permanent delete of the eight kinds to the port, and the governance
adapter keeps only the derived ids.

## Writes: every path that removes one of the eight kinds

| Path                                                                                         | Kinds                                          | Tombstone   | Why                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /api/v1/journal/items/{itemId}` (`deleteItem`)                                       | journal post                                   | Written     | The post is deleted permanently, in the same transaction as the tombstone and the audit event. A day rating or an activity's journal link is never created with a key and leaves none.                                                    |
| `DELETE /api/v1/interactions/{kind}/{interactionId}` (`removeInteraction`)                   | note, activity, call, conversation             | Written     | Same transaction as the delete and the audit event.                                                                                                                                                                                       |
| `DELETE /api/v1/people/{personId}/gifts/{giftId}` (`deleteGift`)                             | gift                                           | Written     | Same transaction as the delete and the audit event.                                                                                                                                                                                       |
| `DELETE /api/v1/people/{personId}/debts/{debtId}` (`deleteDebt`)                             | debt                                           | Written     | Same transaction; its settlements cascade.                                                                                                                                                                                                |
| `DELETE /api/v1/people/{personId}/recurring-debts/{recurringDebtId}` (`deleteRecurringDebt`) | recurring debt rule                            | Written     | Same transaction; the debts it charged stay and lose their rule.                                                                                                                                                                          |
| Person merge (`mergePeople` and the module merge participants)                               | none                                           | Not written | Notes, calls, conversations, gifts, debts, and rules move to the primary person, and an activity only drops the duplicate's participation; no record is deleted, so a retry still finds it (and refuses a person mismatch as a conflict). |
| Person deletion (`delete_person`, `DELETE /api/v1/people/{personId}`)                        | none                                           | Not written | A person delete is a soft delete (`people.deleted_at`); every record stays. No path hard-deletes a person outside a workspace erasure.                                                                                                    |
| Import commit, and import rollback                                                           | none                                           | Not written | An import creates records under its own identity map and deletes none; there is no import rollback path.                                                                                                                                  |
| Workspace reset                                                                              | all, through the workspace cascade             | Not written | The reset deletes the workspace row and restores only its shell, members, and settings, so the cascade removes the tombstones with the records. A key may then create its record again, as documented before v16.                         |
| Workspace deletion (and the people erasure that runs before its cascade)                     | all, through the people and workspace cascades | Not written | Every row of the workspace goes, the tombstones included; nothing is left to replay into.                                                                                                                                                 |
| Discarding a never-verified registration's workspace (API and the worker's purge)            | all, through the workspace cascade             | Not written | Such a workspace never held a record, and its tombstones would go with it.                                                                                                                                                                |
| Other database cascades                                                                      | none                                           | Not written | Only a person hard delete (inside a workspace erasure) or a workspace delete cascades into one of the eight tables; a vocabulary, member, file, or rule delete sets a reference null and keeps the record.                                |

## Reads

A keyed create locks its derived id, reads the row, and only when it finds none
asks `request_tombstones`; a tombstone answers 409 instead of writing:

- gifts, debts, and recurring debt rules keep `gift_request_deleted`, now
  answered from the tombstone rather than the audit history;
- journal posts answer the new `journal_request_deleted`;
- notes, activities, calls, and conversations answer the new
  `interaction_request_deleted`.

`AuditEventRecorder.subjectRecorded` had no other caller and is removed from the
kernel, the governance adapter, and the test fakes.

## Concurrency

A delete racing a replayed create ends in one of two ways: the create returned
the stored record and the delete then removed it, or the delete committed and
the create was refused. It never ends with the record created again. Two things
order them, in every module the same way:

1. Both are writes, and every write revalidates its actor first, inside its
   transaction, with `FOR NO KEY UPDATE` of the account, member, and workspace
   rows (`PostgresActorRevalidation`). Any two writes of one workspace lock the
   same workspace row, whichever members make them, so the delete and the create
   serialize there before the create's `lockRequest`: the second runs only after
   the first commits, and under READ COMMITTED its statements see that commit.
2. Independently of that lock, a delete removes the row and writes its tombstone
   in one commit, and the create reads the row before the tombstone, each in its
   own statement with its own snapshot. A create that missed the row because the
   delete had committed therefore sees the tombstone; a create that saw the row
   returns it. The `lockRequest` advisory lock excludes every other keyed create
   of the same id.

`journal_postgres_test.ts`, `interactions_edit_delete_postgres_test.ts`, and
`gifts_edits_postgres_test.ts` prove both orders through the real routes, by
holding the workspace row and queueing the two requests behind it in each order.

## Migration 0016

- `0016_add_request_tombstones.sql` creates the table, its comments, its forced
  policy, and its grant, inside the runner's single transaction.
- No backfill: retry keys on these creates exist only on unreleased code, so no
  record deleted before v16 was created with one, and no tombstone is owed.
- Locking: it creates a new table and takes no lock on an existing one beyond
  the brief share lock its foreign key takes on `workspaces`.
- Rollback: an image built before v16 finds an unknown catalog and refuses to
  start the migrate job. Roll back by restoring the pre-migration backup, or by
  redeploying a v16-aware image; no down migration is provided. A v15 database
  with the table dropped by hand is again an exact v15 catalog.
- Deployment: nothing new. The bootstrap step already creates every role v16
  names, and no setting, secret, or credential changes.
