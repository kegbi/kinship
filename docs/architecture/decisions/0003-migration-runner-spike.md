# ADR 0003: Migration Runner Spike

- Status: spike-required
- Date: 2026-08-09

## Context

The audited PostgreSQL SQL is the sole DDL source. The project needs ordered,
immutable deployment migrations without allowing a query builder or ORM to
redefine the schema. Runner metadata may itself require a canonical schema
change.

## Decision

Compare a thin Deno-compatible raw-SQL runner approach with a dedicated
versioned migration tool during Slice 0. No runner is accepted yet.

The selected approach must satisfy
[`migration-policy.md`](../migration-policy.md), including locking, checksums,
inspectable status, transactional failure behavior, recovery, Compose operation,
and real PostgreSQL tests. A required ledger table is proposed through the next
synchronized schema version rather than created implicitly.

## Consequences

- No migration dependency or version is pinned before the spike.
- API and worker processes never auto-migrate.
- The one-shot Compose migration service is the only deployment entry point.
- The spike result updates this ADR and the technology baseline before
  application migrations are accepted.
