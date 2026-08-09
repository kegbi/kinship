# Architecture Documents

This directory records the implementation baseline for the Personal CRM rewrite.
Read it together with the canonical schema in
[`personal-crm-schema/v1`](../../personal-crm-schema/v1/README.md).

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
  evaluated frameworks, the proposed Compose topology, and dependencies.
- [`backend-architecture.md`](backend-architecture.md) defines module
  boundaries, dependency rules, data access, tenancy, HTTP contracts, and
  background work.
- [`quality-gates.md`](quality-gates.md) defines automated enforcement, tests,
  coverage, dependency controls, hooks, and CI stages.

## Precedence

1. The canonical schema SQL and synchronized schema bundle define persisted
   data.
2. These documents define implementation boundaries and technology decisions.
3. The Monica specifications define source behavior, feature coverage, and
   import compatibility.
4. Framework defaults, generated code, and convenience APIs must adapt to the
   first three; they must not silently redefine them.

Research snapshot: 2026-08-09. The locally available backend runtime was
verified as Deno 2.9.5.
