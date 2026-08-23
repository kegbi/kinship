# Repository schema v6 to v7

## Decision

`WORKSPACE-002` requires a durable deletion-security result outside deleted
workspace data. On 2026-08-23 the user resolved DG-11 by selecting synchronized
schema v7 instead of an external security ledger.

V7 adds one table, `workspace_lifecycle_records`. Its workspace and actor UUIDs
are snapshots without foreign keys, so the row survives workspace and later
identity cascades. It retains non-identifying impact counts and only the object
keys still needed for cleanup. A bounded outcome vocabulary also retains
redacted failed, blocked, stale, rate-limited, and successful attempts. It does
not become a general audit ledger or job queue. The `transactional-failure`
outcome records an authenticated destructive attempt in a separate bounded
transaction after the primary mutation rolls back, when the database remains
available, without masking the original failure.

## Compatibility mappings

The Monica mappings are complete copies of v6. This application-owned security
result has no Monica source table or column, so import dispositions do not
change.

## Migration and recovery

`0007_add_workspace_deletion_records.sql` is additive and transaction-safe.
Application rollback is compatible with the extra table. Once deletion records
exist, forward fixes must preserve them; rollback must not drop security or
pending cleanup evidence.

## Validation boundary

V7 requires exact artifact hashes, clean apply, exact v1-v6 upgrades,
idempotent verification, drift rejection, atomic migration rollback, constraints
on JSON/status shape, and proof that a record survives workspace cascade.
