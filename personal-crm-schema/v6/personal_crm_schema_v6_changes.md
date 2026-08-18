# Repository schema v5 to v6

## Decision

`PLANNING-002` requires process-death recovery and duplicate-safe provider
delivery. V5 can mark an occurrence pending or sent, but cannot persist claim
ownership, lease expiry, attempts, retry schedule, or ambiguous provider state.
The user accepted DG-05 and DG-06B on 2026-08-18.

V6 adds only the reminder-occurrence lifecycle fields and workspace-scoped
cadence request receipts consumed by this flow. The receipt history preserves
accepted A/B requests without restoring superseded cadence settings, while the
occurrence row is also the durable in-app notification: confirmed effects carry
provider-effect and visibility instants. `scheduled_job_runs` remains
observability and is not a queue. The first production provider is idempotent
`in_app`; email and webhook are not claimed.

## Compatibility mappings

The Monica mappings are complete copies of v5. Durable worker metadata has no
Monica source column, so import dispositions do not change.

## Migration and recovery

`0006_add_durable_reminder_delivery.sql` is transaction-safe. It assigns every
existing occurrence a stable key, records an explicit legacy receipt and
visibility evidence for sent rows, moves unsupported pending legacy channels to
manual attention, backfills the latest accepted cadence request receipt, and
installs constraints and claim/retry indexes. Application rollback is compatible
with the additive columns, but delivery after v6 data exists should use a
reviewed forward fix rather than dropping reconciliation evidence.

The migration replaces the delivery-instant uniqueness index with the stable
calendar identity `(reminder_id, member_id, occurs_on, channel,
coalesce(lead_time_days, -1))`. Regeneration may move an unattempted row's
`deliver_at`, but it cannot create another row for the same calendar occurrence
and lead rule or silently discard an existing conflict. Null is the distinct
no-explicit-rule slot, so explicit zero-day and seven-day rules remain separate.

## Validation boundary

V6 requires exact artifact hashes, clean apply, exact v1-v5 upgrades, idempotent
v6 verification, structural drift rejection, atomic migration rollback,
claim-shape and terminal-state constraint tests, and live PostgreSQL 18/17
matrix execution. V1 through v5 hashes remain immutable.
