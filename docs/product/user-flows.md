# User Flow Contract

## Purpose

[`user-flows.yaml`](user-flows.yaml) is the canonical inventory of user-facing
and Monica-compatibility workflows. It turns the repository's E2E requirement
into a finite, auditable contract rather than an informal claim.

Every catalog entry includes:

- a stable ID and delivery priority;
- actor, trigger, and preconditions;
- the observable happy path and important alternate outcomes;
- resulting persisted or security state;
- involved pages, modules, and permissions;
- required test layers and E2E references.

Flow IDs are permanent after a release. A removed workflow remains in history as
deprecated rather than having its identifier reused.

## Coverage Rule

Every delivered flow whose `e2e.required` value is `true` must have at least one
committed Playwright test reference. Tests use the flow ID in the title or
annotation. Additional E2E cases cover the cataloged alternate outcomes when
they cross a browser-visible boundary.

CI will eventually compare the YAML catalog with Playwright annotations and fail
on:

- a required flow without a test;
- a test referring to an unknown flow;
- a shipped page with no corresponding page-catalog entry;
- a flow referring to an unknown page or module;
- a P0 flow skipped outside a time-bounded quarantine record.

Unit/source coverage and workflow coverage are independent gates. One cannot
substitute for the other.

## Priorities

| Priority | Meaning                                                   |
| -------- | --------------------------------------------------------- |
| P0       | Required for the first usable, secure Personal CRM.       |
| P1       | Required for broad Monica feature parity.                 |
| P2       | Optional platform, integration, or commercial capability. |

## Person-Centered Flow Pattern

Most person-owned workflows begin and end at `people.profile`:

1. The member finds or creates a person.
2. The complete person workspace establishes context.
3. A local action invokes the owning module's use case.
4. The affected section refreshes without discarding the rest of the profile.
5. The result appears in the person summary, history, or planning section and in
   any relevant global projection such as Today or Tasks.

This pattern applies to contact methods, addresses, relationships, life events,
notes, calls, conversations, activities, tasks, reminders, gifts, debts, pets,
and files. Separate routes are not required merely because separate backend
modules own those records.

## Today And Settings Flow Pattern

`TODAY-001` treats `/app` as an action-oriented projection. Due items retain
their owning module and canonical detail location: Today may complete a task or
navigate to a person section through an approved use case, but its read model
never becomes a cross-module write service. Secondary-region failures are
isolated from the attention queue, and time-zone boundaries are explicit test
cases.

Settings workflows use category-level page routes from
[`page-catalog.yaml`](page-catalog.yaml). Related personalization vocabularies
share one route and stable `?section=` values; local CRUD actions do not invent
page routes. `WORKSPACE-003` owns the cross-module administration contract, but
each mutation still enters the module that owns the affected record.
Long-running import reports and the workspace danger zone remain standalone
because resumption, diagnostics, or destructive scope materially change the
workflow.

## P0 Acceptance Emphasis

P0 must prove all of the following before broader feature work:

- identity and workspace creation cannot cross tenant boundaries;
- a person can be created, found, opened, updated, archived, and restored;
- partial dates retain their stated precision;
- the person workspace composes multiple module sections without granting a
  cross-module write shortcut;
- interactions, tasks, and reminders update their global projections;
- Today orders overdue and current work in the member's effective time zone and
  remains usable when a secondary projection fails;
- reminder delivery is retry-safe and idempotent;
- missing attachments have an explicit recoverable state;
- Monica import supports dry-run, atomic commit, complete diagnostics, and an
  idempotent rerun;
- imported legacy credentials never become active.

Before destructive personal or workspace lifecycle work ships, `AUTH-005` and
`WORKSPACE-002` must also prove typed confirmation, current impact counts, owner
invariants, atomic failure, and post-operation session behavior.

## Test Reference Lifecycle

Catalog entries inherit `defaultDeliveryStatus: planned`. `testRefs` stays empty
while a flow is planned. Implementing a flow sets its `deliveryStatus` to
`delivered`; a delivery slice cannot be accepted until every included required
flow names its real test file or test annotation. Renaming a test updates the
catalog in the same commit.
