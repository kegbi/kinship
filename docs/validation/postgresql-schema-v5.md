# PostgreSQL schema v5 validation

Repository schema v5 passed the live validation matrix on PostgreSQL 18.4 and
17.10 using the pinned official images recorded by
`deno task
test:schema:matrix`.

Both runs proved:

- atomic full-schema rollback, clean apply, teardown, and clean reapply;
- exact v1, v2, v3, and v4 upgrades to v5 with fixture preservation;
- failed v4-to-v5 migration rollback without leaving the approximation field;
- exact catalog and field-catalog agreement for 87 tables, 814 columns, and 72
  check constraints;
- all behavior assertions, including partial dates and the typed
  approximate-year invariant.

The v1 external audit remains immutable and does not cover repository deltas
from v2 through v5.
