# Delivery Planning

## Status And Purpose

**Status: proposed execution program with the PRODUCT-001 subset accepted.** The
audit, inventories, risks, and verification results are factual. PRODUCT-001
accepts the release assignments and milestone meanings recorded in the product
contract; unrelated new catalog work and architecture choices remain proposals
until their own authorities approve them.

This directory maps the path from the schema-and-contract baseline to the
Personal CRM. [`active-delivery.md`](active-delivery.md) is the authoritative
near-term queue. The larger roadmap and operations documents are coverage and
release references, not a list of prerequisites for starting application code.
The retired workflow's `tickets/` tree of packets, dispatch files, and evidence
logs was removed from the working tree by GAP-043; it remains readable at the
branch `archive/planning-tickets-2026-09-27`. New tickets do not use its
packets, IDs, dispatch files, or evidence logs.

The current user-requested follow-up is the
[application repair plan](application-repair-plan-2026-09-05.md), covering
reproduced usability and composition defects after the responsive person-block
and focus-border repairs. Its ordered checklist owns those repair statuses.

The plan has two jobs:

1. propose an explicit, testable definition and path for the first MVP; and
2. continue from MVP to core, optional-platform, AI-enabled, and production
   completeness without weakening the modular-monolith boundaries.

Research and repository audit snapshot: **2026-08-11**.

## Authority And Change Control

Use the repository precedence from
[`docs/architecture/README.md`](../architecture/README.md): canonical schema,
architecture, product contract, Monica import compatibility, then this execution
plan. A plan item that conflicts with a higher authority is a decision gate, not
permission to work around the conflict.

When execution changes a stable page ID, flow ID, module boundary, table owner,
rendering strategy, persistent schema, or accepted technology, update the
authoritative documents and machine-readable catalogs in the same change. Never
make a plan document the only record of such a decision.

## Current Baseline

The repository contains a runnable application scaffold and delivered user
flows.

| Inventory                    | Current state                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical PostgreSQL schema  | 89 tables and 843 columns; current v7 passed live validation on PostgreSQL 18.4; immutable v6 additionally passed PostgreSQL 17.10 compatibility validation |
| Backend modules              | 15 accepted module boundaries with exact table ownership                                                                                                    |
| Cross-module read models     | 6 accepted, query-only compositions                                                                                                                         |
| Cataloged pages              | 39                                                                                                                                                          |
| Cataloged flows              | 32 total: 17 P0, 12 P1, and 3 P2                                                                                                                            |
| Delivered flows              | 31 of 32; `BILLING-001` alone remains `planned` with empty `testRefs`                                                                                       |
| Existing executable code     | Runnable Deno API and worker, Astro web app, gateway, shared contracts, and application test suites                                                         |
| Current application scaffold | API, worker, web app, contracts, main Compose stack, and application tests are present; CI and hooks remain pending                                         |

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

| Milestone                  | Meaning                                                                                                                                                             | Exit point                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Foundation complete        | The executable architecture, spikes, contracts, Compose topology, and enforcement gates are proven by one protected walking skeleton.                               | Slice 0                    |
| Core alpha                 | A secure workspace can manage people, interactions, tasks, reminders, and Today, but compatibility and later P0 flows are incomplete.                               | Slice 4                    |
| Proposed MVP               | Every P0 flow passes in all required browsers with complete pages, states, coverage, and production-like feature-gate evidence.                                     | Slice 7                    |
| Core feature complete      | Every P0 and P1 flow, both cataloged public product pages, and every surface required by those flows is delivered.                                                  | Slice 7                    |
| Optional platform complete | The selected enabled P2 modules are delivered and remain disableable without breaking core CRM behavior.                                                            | Slice 8                    |
| Catalog complete           | All cataloged P0, P1, and P2 flows and their required page contracts are delivered.                                                                                 | Slice 8                    |
| AI-enabled complete        | An approved AI product and privacy contract and its flows are delivered through a provider-neutral adapter with isolation, safety, and evaluation gates.            | Not yet schedulable; DG-08 |
| Production ready           | Restore, rollout, rollback, security, privacy, accessibility, performance, observability, and operational objectives are proven for a named deployment environment. | Independent release gate   |

The Proposed MVP is intentionally broad. `FILES-001`, `IMPORT-001`, and
`EXPORT-001` are P0, so a release after Slice 4 is Core alpha rather than MVP.
The current catalog-derived Proposed MVP and Core feature complete cuts coincide
after Slice 7, while their meanings remain distinct. Future catalog changes
regenerate milestone membership and cuts rather than treating the current count
as authority. Production ready remains independent of feature completion.

## Plan Documents

- [`active-delivery.md`](active-delivery.md) is the short executable queue and
  starts with the runnable API/web application.
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

1. Take the single `Now` item from `active-delivery.md` and bound one vertical
   observable outcome.
2. Resolve only a decision that directly blocks that outcome; make the smallest
   choice needed and resume the feature.
3. Run focused RED -> GREEN -> REFACTOR with one implementer; keep the inner
   loop to focused tests and the cheapest affected check.
4. Run candidate-level affected gates once, create one candidate commit, and
   send it to one independent read-only reviewer.
5. Return localized findings to the same implementer/reviewer, then run the
   owning integration gate once, integrate, and advance the active queue.
6. Keep a cataloged flow `planned` until its complete observable outcome and
   required E2E pass. Partial scaffolds remain honestly partial.

## Work-Package Definition Of Ready

A work package is ready when:

- its page IDs, flow IDs, module owners, permissions, and schema facts are
  known;
- any decision that directly blocks its first behavior is accepted or bounded
  inside the ticket;
- API behavior and observable alternate outcomes are described;
- cross-workspace and external-failure cases are enumerated;
- its focused test layer is identified;
- any persistent-data change has a synchronized schema-version plan; and
- the owning module can be implemented without an illegal dependency;
- the bounded task fixes its observable outcome, owned paths, and relevant
  existing verification commands; and
- implementation and independent review ownership are available.

## Work-Package Definition Of Done

A production work package is done when:

- domain and application behavior is complete through public module entry
  points;
- authorization and workspace isolation are enforced before persistence;
- every boundary changed by the ticket has its focused contract or integration
  proof;
- every UI state in the ticket is implemented and accessible;
- production TypeScript remains at 80% line, branch, and function coverage;
- required E2E flow annotations and page-state checks pass;
- affected existing architecture, schema, dependency, and security gates pass;
- affected contracts are current;
- concise RED, GREEN, and REFACTOR command results identify the exact candidate;
- an independent reviewer has no unresolved actionable finding on the exact
  accepted revision; and
- the orchestrator has independently run the smallest owning integration gate
  and accepted the exact reviewed revision.
