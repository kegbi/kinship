# Repository schema v10 to v11

The product owner requested a debt settlement dialog with an optional reason and
uploaded photo, permanently saved in debt history. This requires domain history
separate from permission-restricted/redacted audit records.

`debt_settlements` is owned by gifts. Each actual transition to settled and
initial-settled creation records an event in the same transaction as the debt
status and audit. Repeated settled-to-settled calls append nothing. Events
preserve original settled_at and reason; reopening clears only debts.settled_at.
Initial imports use the debt ID as event ID and remain idempotent. Backfill
creates one empty event per currently settled debt using its existing time;
unavailable past reopened history cannot be reconstructed.

Workspace/debt, workspace/file, and workspace/member composite foreign keys
reject cross-workspace references. V11 adds the required workspace/id unique
keys to debts, files, and workspace_members. Column-specific SET NULL clears
only photo_file_id or created_by_member_id after deletion and retains
workspace_id. Original photo_filename remains after removal. Files validates
available supported images linked to the same person, with row locks; gifts
never reads files internals. File storage/scanning/upload and authorized
download retain the existing public boundary. Removal or missing bytes shows an
unavailable photo without removing the reason/date.

History reads are paged and tenant/person/debt scoped. Person merges move the
debt, so its history follows without duplicating person identity. Explicit debt,
person, or workspace permanent deletion cascades events; personal actor deletion
clears attribution. History adds no new export format: current contact exports
explicitly exclude gifts/debts/history and attachment bytes.

`0011_add_debt_settlements.sql` is additive and transactional. Unique-key
validation scans the three parent tables; lock_timeout remains 5 seconds and
busy environments may need retry. Failure rolls back all keys/table/backfill
atomically. Older application versions ignore the new table. Schema downgrade is
a manual reviewed operation: dropping debt_settlements loses its history, then
drop the three workspace/id keys. Prefer application rollback or forward fix; do
not silently drop history.

Validation covers immutable hashes, clean apply, exact v1–v10 upgrade,
idempotent verification, drift rejection, transactional rollback, backfill
preservation, tenant FK rejection, file/actor SET NULL, retained reopen/resettle
history, scoped paged API reads and optional image upload failure handling.
