# Repository schema v9 to v10

## Decision

On 2026-10-01 the product owner approved recurring debts as part of
`GIFTS-001`: on a person's debts section a member creates a rule — direction,
amount, currency, reason, "every N months on day D", a start date, and an
optional end date — and every period on its due day a separate open debt is
created, so each month's charge is settled on its own. Members list, pause,
resume, edit, and delete a person's rules. Generation must be idempotent and
must catch up periods a stopped worker missed without charging any period
twice. That needs a rule table and a generation key on `debts`, so v10 adds
both and nothing else.

## Recurring debt rules

`recurring_debts (id, workspace_id, person_id, direction, amount, currency_code,
reason, interval_months, day_of_month, starts_on, ends_on, is_active,
next_occurrence_on, created_by_member_id, created_at, updated_at)` stores one
rule:

- `direction`, `amount`, `currency_code`, and `reason` are copied onto every
  debt the rule generates, with the same vocabulary and money checks `debts`
  has. Unlike a debt, a rule always names its currency, so `currency_code` is
  `NOT NULL` and keeps the default `NO ACTION` reference (currencies are
  deactivated, never deleted).
- `interval_months` (1 through 120) and `day_of_month` (1 through 31) are the
  recurrence. The first charge falls on the first such day on or after
  `starts_on`; later charges follow every `interval_months` months. A month
  shorter than the day uses its last day without carrying it, so a rule on the
  31st is charged on 28 or 29 February and on 31 March again.
- `ends_on` is optional and, when present, not before `starts_on`
  (`recurring_debts_window_ck`).
- `is_active` is false while the member has paused the rule.
- `next_occurrence_on` is the next due date not yet generated, and null once the
  rule has passed `ends_on`. The worker scans
  `recurring_debts_due_idx (next_occurrence_on) WHERE is_active AND
  next_occurrence_on IS NOT NULL` and generates every period from it up to the
  workspace's local today, so a period missed while the worker was down is
  generated on its next run.
- `recurring_debts_person_fk` references `people (workspace_id, id)`, the key v9
  added, so the database rejects a rule whose person belongs to another
  workspace, and the rule cascades when the person is hard-deleted.
  `recurring_debts_workspace_id_id_key UNIQUE (workspace_id, id)` exists to be
  referenced the same way from `debts`.

## Generated debts

`debts` gains two nullable columns, appended after `updated_at`:

- `recurring_debt_id` names the rule that generated the debt.
  `debts_recurring_debt_fk FOREIGN KEY (workspace_id, recurring_debt_id)
  REFERENCES recurring_debts (workspace_id, id) ON DELETE SET NULL
  (recurring_debt_id)` keeps a generated debt in its rule's workspace and, when
  the rule is deleted, clears only that column: the debts it already generated
  are real money and stay.
- `occurrence_on` is the due date of the period the debt was generated for.
  `debts_recurrence_ck` requires it whenever `recurring_debt_id` is set, and
  `debts_recurring_occurrence_key UNIQUE (recurring_debt_id, occurrence_on)`
  makes a second debt for the same rule and period a conflict. Generation
  inserts with `ON CONFLICT DO NOTHING` on that key, so a retried or concurrent
  run never charges a period twice.

The rule table is owned by the `gifts` module, which owns `debts`. A person
merge moves the duplicate's rules onto the primary with its debts.

## Compatibility mappings

The Monica mappings are complete copies of v9. Monica has no recurring debt
source, and the mappings list source tables only, so no disposition changes.

## Migration and recovery

`0010_add_recurring_debts.sql` is additive and runs inside the canonical
migration runner's single transaction. Creating the empty table and its indexes
is immediate. `ALTER TABLE crm.debts` adds two nullable columns without a
default, which rewrites no row, but adding the foreign key and the unique
constraint takes locks on `debts` while they validate and build: the unique
index build scans the table, which at personal-CRM volumes takes well under a
second. The runner waits at most 5 s (`lock_timeout`) for each lock, so on a
busy system the migration may roll back and need a retry. The upgrade changes
no row. A failure anywhere rolls the whole migration back.

Application rollback is compatible: an older application never reads the new
table or columns, and every debt it writes leaves both new columns null. Rolling
the schema itself back is a manual, reviewed operation: drop the three new
`debts` constraints and two columns (generated debts stay as ordinary debts),
then drop `recurring_debts` (losing the rules, so no further periods are
generated).

## Validation boundary

V10 requires exact artifact hashes, clean apply, exact v1-v9 upgrades,
idempotent verification, drift rejection, atomic migration rollback, the rule
checks, cross-workspace rejection by the person and rule composite foreign keys,
one debt per rule and due date, the rule cascade on person deletion, and that
deleting a rule keeps its generated debts. The gifts integration suite proves
idempotent generation, catch-up, and workspace isolation through the
application boundary.
