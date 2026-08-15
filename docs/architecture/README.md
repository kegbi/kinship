# Architecture Documents

This directory records the implementation baseline for the Personal CRM rewrite.
Read it together with the canonical schema in
[`personal-crm-schema/v5`](../../personal-crm-schema/v5/README.md). Repository
v1 remains the immutable external-audit baseline.

## Decision Status

- **Accepted** means the user has selected the constraint and implementation
  must follow it.
- **Recommended** means the option has been evaluated and is the current
  recommendation, but it still needs explicit user approval before it becomes a
  mandatory dependency.
- **Deferred** means it should not be introduced without a measured need and a
  new decision.
- **Spike required** means a bounded experiment must prove compatibility before
  adoption.

When a recommendation is accepted or rejected, update these documents and
`AGENTS.md` in the same commit. Record exact dependency versions in manifests
and lockfiles when the implementation is scaffolded; use current stable releases
at that time rather than copying version numbers from this research snapshot.

## Documents

- [`technology-baseline.md`](technology-baseline.md) records platform choices,
  evaluated frameworks, the accepted Compose topology, and dependency policy.
- [`backend-architecture.md`](backend-architecture.md) defines module
  boundaries, dependency rules, data access, tenancy, HTTP contracts, and
  background work.
- [`repository-layout.md`](repository-layout.md) fixes the scaffold layout,
  public entry points, import rules, and generated-file locations.
- [`module-boundaries.yaml`](module-boundaries.yaml) is the machine-readable
  module, table-ownership, dependency, event, and read-model allowlist. Its
  shape is defined by
  [`module-boundaries.schema.json`](module-boundaries.schema.json).
- [`authorization-matrix.yaml`](authorization-matrix.yaml) defines roles,
  permissions, scopes, and mandatory tenant-security invariants.
- [`compose-contract.md`](compose-contract.md) defines services, profiles,
  readiness, isolation, data lifecycle, and image policy.
- [`configuration-and-secrets.md`](configuration-and-secrets.md) defines
  configuration ownership, validation, secret handling, redaction, and Deno
  permissions.
- [`migration-policy.md`](migration-policy.md) defines immutable SQL lifecycle,
  runner requirements, deployment, compatibility, and recovery.
- [`observability.md`](observability.md) separates telemetry, health, audit, and
  sensitive-data handling.
- [`quality-gates.md`](quality-gates.md) defines automated enforcement, tests,
  coverage, dependency controls, hooks, and CI stages.
- [`decisions`](decisions/README.md) contains accepted and spike-required
  architecture decisions.

The user-facing counterpart is [`docs/product/README.md`](../product/README.md),
which defines the page catalog, person-centered information architecture,
workflow catalog, and release slices.

The subordinate proposed execution plan is
[`docs/planning/README.md`](../planning/README.md). It turns these accepted
boundaries into dependency-ordered work, compatibility spikes,
quality/operations gates, and module/page/flow traceability. Planning documents
may identify a required decision, but they do not promote a proposal or override
an ADR.

## Precedence

1. The canonical schema SQL and synchronized schema bundle define persisted
   data.
2. These documents define implementation boundaries and technology decisions.
3. The product contract defines page composition and user workflows.
4. The Monica specifications define source behavior, feature coverage, and
   import compatibility.
5. Framework defaults, generated code, and convenience APIs must adapt to the
   first four; they must not silently redefine them.

Architecture research snapshot: 2026-08-09. Delivery research was revalidated on
2026-08-11. The locally available backend runtime was verified as Deno 2.9.5.
