# PostgreSQL Schema Validation

Run the canonical schema against an isolated PostgreSQL container:

```console
deno task test:schema
```

The default image is pinned in `compose.schema-test.yaml`. To test another
supported PostgreSQL image:

```console
deno task test:schema --postgres-image postgres:17.10-alpine3.23
```

The runner creates a unique Compose project, verifies every immutable v1 through
v7 artifact hash and every repository-v8 artifact hash, applies clean v8 in one
transaction, upgrades exact v1 through v7 through `0002` to `0008`, checks the
live PostgreSQL catalog and currency reference data, proves failed-migration
rollback, runs database-enforceable behavior tests, proves teardown/reapply, and
always removes its containers and temporary storage.

The database tests cover:

- v8 table, column, foreign-key, explicit-index, JSONB, and workspace-field
  counts;
- exact field-catalog table/column membership and nullability;
- primary keys, comments, valid indexes, validated constraints, extensions, and
  the two forward-reference foreign keys;
- all partial-date precision shapes and invalid-shape rejection;
- import identity-map uniqueness and idempotent upsert support;
- reminder target, durable claim/lease/retry/provider-result constraints, and
  occurrence de-duplication;
- missing-file metadata and attachment links;
- absence of known raw Monica credential columns from the canonical model.
- nullable, constrained pseudonymous authentication-subject digests and their
  partial lookup index.
- exact user-session authority purpose and fail-closed legacy revocation.
- the 165 synchronized active ISO 4217 currency-reference rows.
- the member reminder-delivery default and vocabulary constraint.

The schema cannot by itself prove application behavior. Cross-workspace
authorization, recurrence generation across time zones, object-store failure
reporting, secret redaction during import, and legacy-credential non-activation
remain mandatory application/integration tests once those use cases exist.
