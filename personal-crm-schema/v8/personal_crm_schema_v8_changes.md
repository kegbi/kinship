# Repository schema v7 to v8

## Decision

`PLANNING-003` delivers reminders by email and in a daily digest. The member's
choice needs durable storage, and `member_preferences` is the table that holds a
member's own settings. On 2026-09-27 the product owner approved synchronized
schema v8 with exactly two new `member_preferences` columns.

- `reminder_delivery text NOT NULL DEFAULT 'in_app'`, constrained by
  `member_preferences_reminder_delivery_ck` to `in_app`, `email`, or `both`.
- `digest_time time`, nullable. Null sends each email reminder when it is due;
  a value batches the member's due email reminders into one digest at that
  local time in `member_preferences.timezone`, or UTC when that is null.

Nothing else in the DDL changes. `reminder_occurrences` already stores the
channel, attempts, provider idempotency key, receipt, and reconciliation state,
and its unique key already includes the channel, so email and digest delivery
reuse it. A digest needs no marker of its own: each included occurrence is
finalized with the digest's receipt.

## Compatibility mappings

The Monica mappings are complete copies of v7. Monica's per-user reminder
settings have no source column for a delivery channel or digest time, so import
dispositions do not change.

## Migration and recovery

`0008_add_member_reminder_delivery.sql` is additive and transaction-safe. Every
existing row receives `in_app` and a null digest time, which is today's
behaviour. Application rollback is compatible with the extra columns, because an
older application never reads them. Once a member has chosen email delivery, a
rollback silently returns that member to in-app delivery for newly generated
occurrences; already generated email occurrences remain and are left pending by
an older worker that claims only `in_app` occurrences.

## Validation boundary

V8 requires exact artifact hashes, clean apply, exact v1-v7 upgrades,
idempotent verification, drift rejection, atomic migration rollback, and the
reminder-delivery vocabulary constraint.
