# Delivery Planning

## Status And Purpose

**Status: proposed for explicit product and architecture approval.** The audit,
inventories, risks, and verification results are factual; milestone names,
reassigned flows, new catalog work, and recommended architecture choices remain
proposals until their authoritative contracts are approved.

This directory is the execution plan for moving the repository from its current
schema-and-contract baseline to a production-ready Personal CRM. It derives work
from the accepted architecture, product catalogs, and canonical schema; it does
not override them.

The plan has two jobs:

1. propose an explicit, testable definition and path for the first MVP; and
2. continue from MVP to core, optional-platform, AI-enabled, and production
   completeness without weakening the modular-monolith boundaries.

Research and repository audit snapshot: **2026-08-11**.

## Authority And Change Control

Use the repository precedence from
[`docs/architecture/README.md`](../architecture/README.md): canonical schema,
architecture, product contract, Monica compatibility specifications, then this
execution plan. A plan item that conflicts with a higher authority is a decision
gate, not permission to work around the conflict.

When execution changes a stable page ID, flow ID, module boundary, table owner,
rendering strategy, persistent schema, or accepted technology, update the
authoritative documents and machine-readable catalogs in the same change. Never
make a plan document the only record of such a decision.

## Current Baseline

The repository is pre-scaffold for application code.

| Inventory                    | Current state                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Canonical PostgreSQL schema  | 87 tables and 811 columns; live validation passes on PostgreSQL 18.4 and 17.10        |
| Backend modules              | 15 accepted module boundaries with exact table ownership                              |
| Cross-module read models     | 6 accepted, query-only compositions                                                   |
| Cataloged pages              | 39                                                                                    |
| Cataloged flows              | 30 total: 17 P0, 10 P1, and 3 P2                                                      |
| Delivered flows              | 0; every flow is still `planned` and has no E2E reference                             |
| Existing executable code     | Schema validation tool and SQL assertions only                                        |
| Missing application scaffold | API, worker, web app, contracts, main Compose stack, CI, hooks, and application tests |

The reproducible baseline commands are:

```console
deno task fmt:check
deno task lint
deno task check
deno task test:schema:matrix
```

Do not remove or subsume the narrow schema harness until a broader application
stack preserves all of its checks.

## Milestone Definitions

These names prevent different meanings of "MVP" or "feature complete" from being
used during implementation.

| Milestone                  | Meaning                                                                                                                                                                                                                         | Exit point                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Foundation complete        | The executable architecture, spikes, contracts, Compose topology, and enforcement gates are proven by one protected walking skeleton.                                                                                           | Slice 0                                                     |
| Core alpha                 | A secure workspace can manage people, interactions, tasks, reminders, and Today, but compatibility and later P0 flows are incomplete.                                                                                           | Slice 4                                                     |
| Proposed MVP               | Every P0 flow passes in all required browsers, all production TypeScript has 100% line/branch/function coverage, and the production-like stack meets the feature-milestone gates.                                               | Expected Slice 7, pending DG-07 and release-slice approval  |
| Core feature complete      | Every P0 and P1 flow, both cataloged public product pages, and every surface required by those flows is delivered. It is expected to coincide with the proposed MVP only if DG-07 closes without adding later-slice core scope. | Expected Slice 7, pending DG-07/catalog approval            |
| Optional platform complete | The explicitly enabled P2 modules are delivered and remain disableable without breaking core CRM behavior.                                                                                                                      | Selected Slice 8 capabilities                               |
| Catalog complete           | All currently cataloged P0, P1, and P2 flows are delivered, including all three optional P2 flows.                                                                                                                              | Full Slice 8                                                |
| AI-enabled complete        | An approved AI product/privacy contract and its flows are delivered through a provider-neutral adapter with isolation, safety, and evaluation gates.                                                                            | Not yet schedulable; Decision Gate DG-08                    |
| Production ready           | Restore, rollout, rollback, security, privacy, accessibility, performance, observability, and operational objectives are proven for a named deployment environment.                                                             | Independent release gate; not implied by feature completion |

The proposed MVP is intentionally broad. `FILES-001`, `IMPORT-001`, and
`EXPORT-001` are P0, so a release after Slice 4 would be a core alpha under this
proposal. Approving or changing that cutoff requires an explicit product
decision. DG-07 must close and the inventory/counts must be regenerated before
either milestone becomes authoritative.

## Plan Documents

- [`roadmap.md`](roadmap.md) is the dependency-ordered implementation plan and
  defines each foundation and product work package.
- [`quality-and-operations.md`](quality-and-operations.md) defines the test,
  coverage, Compose, CI, security, observability, release, and runbook plan.
- [`traceability.md`](traceability.md) maps modules, read models, pages, flows,
  priorities, and delivery slices, and records catalog gaps that must close.
- [`research.md`](research.md) records current official capability research and
  the implementation consequences of that research.

The accepted product slice summary remains
[`docs/product/release-slices.md`](../product/release-slices.md). This directory
adds execution detail and exposes gaps; it does not create an independent
release catalog.

## How To Execute The Plan

1. Resolve all decision gates whose `blocks` value includes the next work
   package. Record accepted decisions in ADRs or product contracts.
2. Turn one vertical work package into an isolated ticket packet using
   [`autonomous-delivery.md`](../development/autonomous-delivery.md). Record the
   exact base revision, accepted contracts, acceptance cases, commands, owned
   paths, and implementer/reviewer isolation before implementation starts. Add a
   module directory only when the ticket contains executable behavior.
3. **RED:** add the narrowest automated test or deterministic executable check
   first, leave production files unchanged, run it, and record that it fails for
   the intended missing or incorrect behavior. Documentation, infrastructure,
   configuration, catalogs, and enforcement tools require a truthful failing
   validator or bounded probe too; a no-op harness is not evidence.
4. **GREEN:** make the smallest architecture-compliant production change that
   passes the RED proof. Never weaken, skip, exclude, or over-mock the proof.
5. **REFACTOR:** improve structure only while the focused and affected tests
   stay green. Any newly discovered behavior starts another RED -> GREEN ->
   REFACTOR cycle.
6. Build the complete vertical candidate: owning-module behavior, persistence,
   API contract, generated client, UI states, telemetry, and required test
   layers. Freeze its exact revision and RED/GREEN/REFACTOR evidence.
7. Send only the ticket, accepted contracts, base and candidate revisions, diff,
   and evidence to a fresh clean-context reviewer. Actionable findings return to
   a fresh implementer for a new RED -> GREEN -> REFACTOR cycle and then another
   clean review; the original implementation context cannot approve itself.
8. The orchestrator independently reruns the applicable repository gates and is
   the only role that accepts and integrates the ticket.
9. Keep flow status `planned` until its complete observable outcome and required
   alternate outcomes pass E2E. A page shell or partial use case is not a
   delivered flow. Update generated artifacts and catalogs in that same accepted
   change so CI can reject drift.
10. Promote a slice only when its complete exit checklist passes in a clean,
    production-like Compose stack.

## Work-Package Definition Of Ready

A work package is ready only when:

- its page IDs, flow IDs, module owners, permissions, and schema facts are
  known;
- all blocking decisions are accepted;
- API behavior and observable alternate outcomes are described;
- cross-workspace and external-failure cases are enumerated;
- fixture and test-layer needs are identified;
- any persistent-data change has a synchronized schema-version plan; and
- the owning module can be implemented without an illegal dependency;
- the ticket packet fixes its base revision, owned paths, accepted contracts,
  and exact verification commands; and
- independent implementer, reviewer, and orchestrator contexts are available.

## Work-Package Definition Of Done

A production work package is done only when:

- domain and application behavior is complete through public module entry
  points;
- authorization and workspace isolation are enforced before persistence;
- PostgreSQL and external adapters pass their port contracts;
- OpenAPI and generated frontend contracts are current;
- every relevant UI state is implemented and accessible;
- telemetry is useful and redacted;
- production TypeScript remains at 100% line, branch, and function coverage;
- required E2E flow annotations and page-state checks pass;
- architecture, schema, generated-file, dependency, and security gates pass;
- Compose teardown removes the exact disposable test project; and
- the affected contracts, runbooks, and decision records are current;
- truthful RED, GREEN, and REFACTOR evidence is attached to the exact candidate
  revision;
- a fresh clean-context reviewer has no unresolved actionable finding; and
- the orchestrator has independently rerun the applicable gates and accepted the
  exact reviewed revision.
