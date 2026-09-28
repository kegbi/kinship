# Release Slices

## Delivery Rule

Build complete vertical slices. A slice includes domain behavior, application
use cases, PostgreSQL adapters, HTTP contracts, generated frontend contracts,
Astro surfaces, telemetry, and all required tests. Do not scaffold every module
with empty folders before one real path proves the architecture.

Exact dependency and runtime versions are selected and locked only when the
first executable scaffold is created. These slices intentionally contain no
version numbers.

PRODUCT-001 accepts the bounded flow assignments, page ownership, milestone
meanings, and deferred-gate ledger below. Other planning and architecture
choices remain proposals until their own decision gates close.

## Slice 0: Prove The Foundation

Slice 0 is delivered incrementally through the first runnable vertical paths. It
is not a sequential prerequisite wave. Pull each item below into the first
feature that consumes it, and do not finish all spikes before application work.

Deliverables:

- repository workspace and canonical top-level tasks;
- architecture manifest validation and dependency graph check;
- PostgreSQL migration-runner spike;
- Better Auth compatibility spike, with accept/reject ADR update;
- one authenticated Astro rendering spike;
- Compose development/test skeleton and health checks;
- OpenAPI generation and client-drift proof;
- Lefthook configuration invoking only canonical tasks.

Exit conditions:

- the canonical schema still passes its PostgreSQL matrix;
- a protected request carries typed principal/workspace context;
- frontend code cannot import backend internals;
- no provisional library is adopted without its spike criteria passing.

The active order is maintained in
[`docs/planning/active-delivery.md`](../planning/active-delivery.md). Spikes are
time-boxed decisions inside the first affected feature; rejected alternatives
are not hardened. Root commands arrive with the first real suite that uses them.

## Slice 1: Identity, Workspace, And People Core

Flows: `AUTH-001`, `AUTH-002`, `AUTH-003`, `AUTH-004`, `WORKSPACE-001`,
`PEOPLE-001`, and `PEOPLE-002`.

Deliver:

- registration, verification, sign-in, MFA/session baseline, and invitations;
- workspace membership and active-workspace resolution;
- the settings shell, overview, personal profile, preferences, flow-backed
  security/session behavior, and the `settings.workspace` and `settings.members`
  page contracts;
- people list, search, create, archived list, and canonical person workspace;
- the `public.home` and `public.features` static route contracts with the
  current `ready` and `not-found` public states, navigation and accessibility
  proof;
- the Today shell and first-workspace onboarding state, before its complete due
  projection arrives in Slice 4;
- person identity summary and explicit empty/loading/error states;
- cross-workspace negative tests for every introduced identifier.

`public.home` and `public.features` have no stable user-flow ID.

The person workspace starts as a typed `PEOPLE-003` shell that remains planned.
It may initially contain honest unavailable or empty section contracts, but it
must already be the single canonical route rather than a temporary subpage tree.
`PEOPLE-003` remains `planned` until its complete Slice 6 contract passes.

## Slice 2: Complete Profile Facts And Relationships

Flows: `PEOPLE-004`, `PEOPLE-005`, `PEOPLE-006`, `RELATIONSHIP-001`, and
`WORKSPACE-003`.

Deliver contact methods, addresses, important dates, first meeting, work,
organizations, tags, pets, food preferences, relationships, archive/restore,
profile-module settings, controlled-vocabulary settings, and partial-date
behavior. Person data appears as sections or local actions in the person
workspace; related vocabularies use the accepted personalization deep links.
Only flow-backed local actions are scheduled by this slice contract.

Edit, archive, restore, and delete are one indivisible `PEOPLE-004` flow. Slice
1 owns no partial form of that flow.

## Slice 3: Interactions And Person History

Flows: `INTERACTION-001`, `INTERACTION-002`, and `GOVERNANCE-002`.

Deliver notes, activities, participants, calls, conversations/messages,
emotions, the person history projection, activity report, and audit history.
Prove that the read composition does not permit cross-module writes.

## Slice 4: Today, Planning, And Worker Reliability

Flows: `TODAY-001`, `TODAY-002`, `PLANNING-001`, `PLANNING-002`, and
`PLANNING-003`.

Deliver global tasks, person tasks, reminders, stay-in-touch cadence, Today
projections, occurrence generation, worker claiming, retries, time-zone and
daylight-saving behavior, secondary-region failure isolation, and
duplicate-delivery tests. `PLANNING-003` adds email reminder delivery and a
daily digest per member time zone over the same durable occurrences.

## Slice 5: Files, Gifts, And Debts

Flows: `FILES-001`, `GIFTS-001`, and `PEOPLE-007`.

Deliver object-storage adapters, person documents/photos, gift attachments,
gifts, debts, storage limits, missing/quarantined object states, and authorized
downloads, including a person's avatar with its initials fallback. Include the
workspace storage settings surface without exposing file inventory to ordinary
members.

## Slice 6: Journal And Governance

Flows: `JOURNAL-001`, `JOURNAL-002`, `GOVERNANCE-001`, `PEOPLE-003`, and
`SEARCH-001`.

Deliver journal posts, day ratings, ordered journal items, legal-document
acceptance, and the necessary global navigation. Keep person-linked history
visible in the person workspace without making Journal a people submodule.
Complete `PEOPLE-003` here only after every enabled core person section exists
and its read contract passes. `JOURNAL-002` adds, edits, and removes a person's
life events from the Life events section through the journal module.
`SEARCH-001` finds people, notes, activities, journal posts, and tasks from the
header palette once every one of them exists, opening each in the person
workspace section, journal item, or tasks page it lives on.

## Slice 7: Data Lifecycle, Import, And Export

Flows: `IMPORT-001`, `IMPORT-002`, `EXPORT-001`, `EXPORT-002`, `AUTH-005`,
`WORKSPACE-002`, `PEOPLE-008`, `PEOPLE-009`, and `PEOPLE-010`.

Deliver format detection, bounded staging, identity mapping, dry-run reports,
atomic commit, idempotent rerun, attachment manifests, vCard export, workspace
exports, and explicit legacy credential non-activation. Complete workspace reset
and deletion only after every introduced module participates in the atomic data
lifecycle and impact preview. `PEOPLE-008` merges two people the same way: every
owning module relinks its own rows in one transaction, and a re-import of the
same export lands on the person who was kept. `PEOPLE-009` acts on up to 100
selected people at once, each through the single-person use case in its own
transaction, and exports the selection as one vCard.

> **Proposed Slice 7 amendment:** complete the durable import/export job design,
> destructive-lifecycle coordinator, legacy-credential policy, surviving
> deletion-record decision, and remaining DG-07 product gates before accepting
> this slice. Imported accounts and password/TOTP/recovery/WebAuthn material
> must never activate access, issue sessions, or authenticate factors; the open
> decision is whether to discard, report, or preserve it inertly pending forced
> reset/re-enrollment. Core import/export must work with integrations disabled;
> optional-source treatment follows the accepted import policy and must not make
> Slice 8 a prerequisite.
>
> Slice 7 is only the proposed MVP/core-feature-complete target. Promote either
> feature milestone from the then-current accepted catalog and its passing
> evidence, never from a fixed flow count. All in-scope non-optional flows,
> pages, states, and performance gates must pass. Production promotion remains a
> separate operational decision.

## Slice 8: Optional Platform Modules

Flows: `API-001`, `INTEGRATION-001`, `INTEGRATION-002`, and `BILLING-001`.

Deliver API tokens/OAuth only when required, DAV and other optional adapters,
billing, and operational administration. `INTEGRATION-002` is a read-only
iCalendar feed of person dates and a member's reminder days behind a secret URL
the member can rotate or revoke; it pushes nothing to a remote server. Each
optional module must be disabled without breaking core CRM workflows.

> **Proposed Slice 8 amendment (DG-07):** do not ship an operations UI until an
> accepted page ID, flow ID, permissions, states, and E2E contract exist;
> otherwise keep operations limited to internal runtime evidence and runbooks.
> Treat API access and integrations as optional only after the page catalog
> gains authoritative availability/feature-gating metadata. Promote each enabled
> optional module independently.

## Milestone Contract

Feature milestones derive their membership and exit slice from the accepted flow
and page catalogs plus the complete-flow slice mapping, never from a fixed
inventory count.

| Milestone                  | Accepted meaning                                                                                                                                          | Current catalog-derived exit |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Foundation complete        | The executable architecture, spikes, contracts, Compose topology, and enforcement gates are proven by one protected walking skeleton.                     | Slice 0                      |
| Core alpha                 | A secure workspace can manage people, interactions, tasks, reminders, and Today while later compatibility and P0 work remains incomplete.                 | Slice 4                      |
| Proposed MVP               | Every P0 flow and its required pages, states, browser, coverage, and feature-gate evidence pass.                                                          | Slice 7                      |
| Core feature complete      | Every P0 and P1 flow, both cataloged public product pages, and every surface required by those flows pass.                                                | Slice 7                      |
| Optional platform complete | The selected enabled P2 modules pass and remain disableable without breaking core CRM behavior; a deployment may name the enabled subset.                 | Slice 8                      |
| Catalog complete           | All cataloged P0, P1, and P2 flows and their required page contracts pass.                                                                                | Slice 8                      |
| AI-enabled complete        | An approved AI product and privacy contract is delivered through a provider-neutral adapter with isolation, safety, and evaluation gates.                 | Not yet schedulable          |
| Production ready           | A named environment independently passes restore, rollout, rollback, security, privacy, accessibility, performance, observability, and operational proof. | Independent release gate     |

The current Proposed MVP and Core feature complete cuts coincide after Slice 7
because of the current catalog assignments, but their accepted meanings remain
distinct. Production ready is independent of every feature-completion label.

## Deferred Product Gates

PRODUCT-001 chooses no branch and adds no new stable ID for the following
follow-up decisions:

- an operations user interface, stable page/flow IDs, permissions, states, and
  E2E contract;
- whether `page.flowIds` is exhaustive or primary-only;
- `ready` and `not-found` do not decide state inheritance; it remains deferred;
- multi-workspace switching, broader security settings, avatar management, help
  or what's new actions, and saved filters;
- external API parity, P2 page availability and feature-gating semantics,
  romantic metadata, and optional-source import behavior.

These gaps remain undecided. Current catalog identities, priorities, delivery
statuses, page associations, and public-page empty `flowIds` remain unchanged.

The former life-event mutation flow gate is resolved: GAP-046 added
`JOURNAL-002` (P1, Slice 6, `people.profile`).

GAP-050 added `IMPORT-002` and `EXPORT-002` (P1, Slice 7, `settings.import-new`
and `settings.export`) for vCard and CSV contacts, which the Slice 7 ticket
names. Import sources beyond Monica, vCard, and CSV remain part of the
optional-source import gate above.

GAP-051 added `PEOPLE-009` (P1, Slice 7, `people.index` and `people.archived`)
for bulk directory actions beside the merge and selection export it sits with.

GAP-053 added `TODAY-002` (P1, Slice 4, the application shell's notification
bell) beside the reminders it reports, and `PEOPLE-010` (P1, Slice 7,
`people.index`, `people.archived`, and `people.profile`) for starred people, the
tag facet, and the directory's orders beside the other directory work.

## Slice Acceptance

A slice is complete only when:

- every changed behavior has recorded RED -> GREEN -> REFACTOR evidence for the
  exact candidate revision, followed by independent review and one owning
  orchestrator integration gate;
- every included required flow names and passes its E2E test;
- production TypeScript reaches the repository coverage threshold;
- OpenAPI, generated client, schema, and architecture checks are clean;
- all page states and representative accessibility cases are tested;
- Compose can create and tear down an isolated test stack;
- documentation and machine-readable catalogs match the implementation.

Slice acceptance or MVP feature acceptance does not authorize a production
deployment. Production promotion additionally requires the named environment's
provider, security/privacy, performance/SLO, backup/restore, migration,
observability, incident, rollout, rollback, and post-deploy evidence.
