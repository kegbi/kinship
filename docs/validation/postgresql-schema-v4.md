# PostgreSQL schema v4 validation

Status: passed on 2026-08-15.

Repository schema v4 preserves immutable v1, v2, and v3 and adds the supported
ISO 4217 reference catalog required by persisted currency preferences. The
external audit covers v1 only; it does not cover the repository-reviewed v2, v3,
or v4 deltas.

The repository harness passed against PostgreSQL 18.4 and 17.10. For each
version it verified v1/v2/v3 artifact immutability, every v4 artifact hash, full
clean v4 apply and rollback, exact transactional v1/v2/v3-to-v4 upgrades with
row preservation, fail-closed revocation of ambiguous v2 authorities, currency
reference-data equivalence, rollback after a forced migration failure, complete
field-catalog agreement, canonical database behavior, teardown, and clean
reapply.

Observed v4 catalog: 87 tables, 813 columns, 168 foreign keys, 145 explicit
indexes, 249 total indexes, 71 check constraints, 17 unique constraints, 17
JSONB fields, and 44 workspace identifier fields.

Run `deno task test:schema:matrix` to reproduce both supported-image checks.
