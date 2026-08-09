# PostgreSQL Validation — Personal CRM Schema v1

## Result

**Passed on 2026-08-09.** The canonical audited DDL was executed without
modification against both pinned database images:

- `postgres:18.4-alpine3.23` — PostgreSQL 18.4;
- `postgres:17.10-alpine3.23` — PostgreSQL 17.10.

The local validation environment used Deno 2.9.5, Docker Engine 29.5.3, and
Docker Compose 5.1.4. The test is reproducible with:

```console
deno task test:schema:matrix
```

## Verified Live Catalog

| Metric                                           | Expected | PostgreSQL 18.4 | PostgreSQL 17.10 |
| ------------------------------------------------ | -------: | --------------: | ---------------: |
| Canonical tables                                 |       87 |              87 |               87 |
| Canonical columns                                |      811 |             811 |              811 |
| Primary keys                                     |       87 |              87 |               87 |
| Foreign keys                                     |      168 |             168 |              168 |
| Explicit indexes                                 |      144 |             144 |              144 |
| All indexes, including constraint-backed indexes |      248 |             248 |              248 |
| Check constraints                                |       68 |              68 |               68 |
| Unique constraints                               |       17 |              17 |               17 |
| JSONB fields                                     |       17 |              17 |               17 |
| `workspace_id` fields                            |       44 |              44 |               44 |
| Forward-reference foreign keys                   |        2 |               2 |                2 |

The live table/column set and nullability also matched all 811 field-catalog
rows exactly. Every canonical table has a primary key and table comment, every
canonical column has a comment, all constraints are validated, all indexes are
valid and ready, and there are no unexpected user-defined triggers.

## Executed Checks

- Recomputed and matched every SHA-256 value in the immutable external audit
  report before starting PostgreSQL.
- Applied the complete DDL atomically to a clean database.
- Applied the DDL inside an explicit transaction and proved that rollback left
  no `crm` schema.
- Dropped the live `crm` schema, proved teardown removed its tables, and applied
  the DDL cleanly again while the required extensions already existed.
- Loaded the canonical field catalog into PostgreSQL and compared its exact
  table/column membership and nullability with `information_schema`.
- Exercised case-insensitive identity uniqueness, status checks, all seven
  partial-date precision shapes, invalid partial-date shapes, and singleton
  person-date uniqueness.
- Exercised missing-file metadata linked to a person and invalid file-status
  rejection.
- Exercised import identity uniqueness plus an idempotent `ON CONFLICT` update.
- Exercised reminder target checks, invalid lead time, occurrence uniqueness,
  and idempotent occurrence regeneration/upsert.
- Confirmed that known raw Monica credential columns are absent from the
  canonical schema.
- Confirmed that each run removed its unique Compose containers, network, and
  temporary PostgreSQL storage.

No PostgreSQL DDL defect or audited catalog mismatch was found, so the canonical
schema artifacts did not require modification.

## Remaining Application-Level Proofs

The database cannot prove behavior that belongs to application services and
external adapters. These remain mandatory before the affected implementation is
accepted:

- rejection of every cross-workspace read and mutation path before persistence;
- semantic idempotency of complete Monica imports, not only identity-map
  uniqueness;
- serialization round trips for partial dates through API and UI boundaries;
- recurrence generation across user/workspace time zones and daylight-saving
  transitions;
- missing, inaccessible, and quarantined object-storage behavior and import
  warnings;
- redaction of secret fields from import snapshots and proof that legacy
  passwords, tokens, sessions, MFA secrets, and WebAuthn/U2F material are never
  activated;
- generated Kysely type agreement once Kysely is scaffolded;
- the accepted Better Auth compatibility spike against the exact canonical
  identity tables.

The external
[`personal_crm_schema_v3_validation.json`](../../personal-crm-schema/v1/personal_crm_schema_v3_validation.json)
is intentionally unchanged: its `live_postgresql_execution: false` field
describes the original audit environment, while this report records the later
repository-owned live execution.
