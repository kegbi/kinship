# PostgreSQL Schema v6 Validation

Canonical schema v6 passed the repository live matrix on PostgreSQL 18.4 and
17.10 on 2026-08-18.

Both images proved atomic failed apply rollback; exact v1, v2, v3, v4, and v5
transactional upgrades; failed v5-to-v6 rollback; clean v6 apply; exact catalog
and field-catalog shape; delivery constraints and behavior; teardown; and clean
reapply. The verified catalog contains 88 tables, 832 columns, 170 foreign keys,
148 explicit indexes (253 total), 83 checks, and 17 unique constraints.

The disposable Compose projects and their containers, networks, and volumes were
removed by the validation harness after each run.
