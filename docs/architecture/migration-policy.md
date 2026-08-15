# Database Migration Policy

## Canonical Baseline

[`personal-crm-schema/v5/personal_crm_schema_v5.sql`](../../personal-crm-schema/v5/personal_crm_schema_v5.sql)
is repository schema version 5 and the accepted DDL and reference-data baseline.
Repository v1 through v4 are immutable prior states. SQL generated from Kysely,
an ORM, or an authentication library cannot replace or amend any accepted
version.

The synchronized schema bundle is immutable after acceptance. A persistent
change creates a new repository schema version with updated SQL, specification,
field catalog, Monica mappings, audit, and validation artifacts.

## Migration Files

When application migrations begin, each file has:

- a monotonically ordered identifier;
- a descriptive immutable name;
- reviewed raw PostgreSQL SQL;
- a checksum recorded by the selected runner or release artifact;
- explicit transaction expectations;
- a validation/test reference;
- restore or downgrade guidance.

Editing an applied migration is forbidden. Correct it with a new migration and a
new synchronized schema version.

## Runner Requirements

The migration-runner spike must prove all of the following against real
PostgreSQL before selection:

- single-runner coordination through an advisory lock or equivalent;
- immutable checksum detection;
- inspectable status and dry-run/plan output;
- deterministic ordering;
- transactional failure behavior where PostgreSQL permits it;
- correct handling of statements that cannot run in a transaction;
- clean Compose one-shot execution and meaningful exit codes;
- no dependency on private or unstable APIs;
- recovery after a process dies before, during, and after commit.

The canonical schema does not currently grant permission to invent a migration
ledger table. If the selected runner requires persistent metadata, that table is
designed and audited as part of the next synchronized schema version before the
runner creates it.

## Deployment Order

1. Verify backup/restore readiness for a persistent environment.
2. Start the one-shot `migrate` service.
3. Acquire the migration lock and verify current checksums/schema state.
4. Apply pending migrations and their postconditions.
5. Release the lock and exit successfully.
6. Start or mark ready API and worker processes compatible with that state.

API and worker processes never race to migrate on startup. A failed migration
keeps new application processes unready and leaves diagnostics available.

## Compatibility

Prefer expand-and-contract changes when existing processes may overlap during a
deployment:

1. add backward-compatible storage;
2. deploy code that can read/write the transition state;
3. backfill through an observable, resumable operation;
4. enforce the new constraint;
5. remove obsolete storage in a later version.

Destructive changes require explicit data disposition, tested backups, and an
operator-confirmed rollout. A migration must not silently truncate, reinterpret,
or activate imported secrets.

## Rollback And Recovery

Transaction rollback is tested for every migration whose statements support it.
Production rollback is not assumed to mean running arbitrary down SQL. Recovery
may be:

- application rollback while the schema remains backward compatible;
- a reviewed forward-fix migration;
- point-in-time database restore plus object-manifest reconciliation;
- a narrow, tested down migration when data preservation is provable.

Each release names its recovery path before deployment.

## Required Verification

CI applies migrations to an empty supported database and to the previous
released schema state. It checks:

- schema catalog and generated Kysely type agreement;
- constraints, indexes, foreign keys, and cross-workspace negative cases;
- partial dates, reminder idempotency, import identity mapping, and files;
- failed/aborted migration recovery;
- clean teardown or restore procedure;
- current and compatibility PostgreSQL versions from the support policy.
