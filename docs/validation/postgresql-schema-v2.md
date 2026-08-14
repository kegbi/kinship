# PostgreSQL schema v2 validation

Status: passed on 2026-08-14.

Repository schema v2 preserves immutable, externally audited v1 and adds the
repository-reviewed pseudonymous authentication-subject digest. The external
audit did not cover this v2 delta.

The repository harness passed against PostgreSQL 18.4 and 17.10. For each
version it verified v1 artifact immutability, every v2 artifact hash, full clean
v2 apply and rollback, exact transactional v1-to-v2 upgrade with row
preservation, rollback after a forced migration failure, complete field-catalog
agreement, digest constraint/index behavior, canonical database behavior,
teardown, and clean reapply.

Observed v2 catalog: 87 tables, 812 columns, 168 foreign keys, 145 explicit
indexes, 249 total indexes, 69 check constraints, 17 unique constraints, 17
JSONB fields, and 44 workspace identifier fields.

Run `deno task test:schema:matrix` to reproduce both supported-image checks.
