# PostgreSQL schema v3 validation

Status: passed on 2026-08-15.

Repository schema v3 preserves immutable v1 and v2 and adds an exact,
constrained purpose to every user-session authority. The external audit covers
v1 only; it does not cover the repository-reviewed v2 or v3 deltas.

The repository harness passed against PostgreSQL 18.4 and 17.10. For each
version it verified v1/v2 artifact immutability, every v3 artifact hash, full
clean v3 apply and rollback, exact transactional v1-to-v3 and v2-to-v3 upgrades
with row preservation, fail-closed revocation of ambiguous v2 authorities,
rollback after a forced migration failure, complete field-catalog agreement,
canonical database behavior, teardown, and clean reapply.

Observed v3 catalog: 87 tables, 813 columns, 168 foreign keys, 145 explicit
indexes, 249 total indexes, 71 check constraints, 17 unique constraints, 17
JSONB fields, and 44 workspace identifier fields.

Run `deno task test:schema:matrix` to reproduce both supported-image checks.
