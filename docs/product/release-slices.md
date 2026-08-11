# Release Slices

## Delivery Rule

Build complete vertical slices. A slice includes domain behavior, application
use cases, PostgreSQL adapters, HTTP contracts, generated frontend contracts,
Astro surfaces, telemetry, and all required tests. Do not scaffold every module
with empty folders before one real path proves the architecture.

Exact dependency and runtime versions are selected and locked only when the
first executable scaffold is created. These slices intentionally contain no
version numbers.

> Planning review, 2026-08-11: the repository audit found flow-assignment and
> milestone gaps in this accepted summary. Proposed corrections are documented
> in [the delivery-planning index](../planning/README.md) and in explicitly
> labeled proposal callouts below. Unlabeled text remains the accepted contract
> until those proposals receive explicit product approval.

## Slice 0: Prove The Foundation

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

> **Proposed Slice 0 amendment:** schedule all eight bounded Foundation spikes,
> including SP-07 durable reminder/import/export/DAV job claims and recovery.
> Introduce each missing root command with a failing executable proof, make the
> real local harness pass, then configure Lefthook to invoke it. Select and
> configure a CI provider only after those provider-neutral command contracts
> exist; no hook or workflow may call a no-op task.

## Slice 1: Identity, Workspace, And People Core

Flows: `AUTH-001`, `AUTH-002`, `AUTH-003`, `AUTH-004`, `PEOPLE-001`,
`PEOPLE-002`, `PEOPLE-003`, and the read portion of `PEOPLE-004`.

Deliver:

- registration, verification, sign-in, MFA/session baseline, and invitations;
- workspace membership and active-workspace resolution;
- the settings shell, overview, personal profile, preferences, and security
  routes;
- people list, search, create, archived list, and canonical person workspace;
- the Today shell and first-workspace onboarding state, before its complete due
  projection arrives in Slice 4;
- person identity summary and explicit empty/loading/error states;
- cross-workspace negative tests for every introduced identifier.

The person workspace may initially contain empty section contracts, but it must
already be the single canonical route rather than a temporary subpage tree.

> **Proposed Slice 1 flow amendment (DG-07):** accept `AUTH-001`, `AUTH-002`,
> `AUTH-003`, `AUTH-004`, `WORKSPACE-001`, `PEOPLE-001`, and `PEOPLE-002` here.
> Start only the typed `PEOPLE-003` person-workspace shell; keep that flow
> `planned` until its complete contract is delivered in Slice 6, and do not
> claim a fictional read-only subset of `PEOPLE-004`. Deliver
> `/app/settings/workspace` and `/app/settings/members`, including invitations,
> roles, last-owner protection, and forbidden states, with the other Slice 1
> settings routes. Also deliver the cataloged public home/features route, state,
> navigation, and accessibility contracts; DG-07 decides whether they need a
> stable user flow. Close the DG-10 security-verification checkpoint and the
> onboarding/invitation/atomic-audit coordination decision before the first
> Slice 1 production behavior.

## Slice 2: Complete Profile Facts And Relationships

Flows: `PEOPLE-004`, `PEOPLE-005`, `PEOPLE-006`, `RELATIONSHIP-001`, and
`WORKSPACE-003`.

Deliver contact methods, addresses, important dates, first meeting, work,
organizations, tags, pets, food preferences, relationships, archive/restore,
profile-module settings, controlled-vocabulary settings, and partial-date
behavior. Person data appears as sections or local actions in the person
workspace; related vocabularies use the accepted personalization deep links.

> **Proposed avatar phasing:** Slice 2 may deliver accepted default, generated,
> or external avatar presentation that needs no owned file object. Uploaded or
> file-backed avatars wait for the Slice 5 object-store lifecycle and the
> approved people/files coordinator.

## Slice 3: Interactions And Person History

Flows: `INTERACTION-001`, `INTERACTION-002`, and `GOVERNANCE-002`.

Deliver notes, activities, participants, calls, conversations/messages,
emotions, the person history projection, activity report, and audit history.
Prove that the read composition does not permit cross-module writes.

## Slice 4: Today, Planning, And Worker Reliability

Flows: `TODAY-001`, `PLANNING-001`, and `PLANNING-002`.

Deliver global tasks, person tasks, reminders, stay-in-touch cadence, Today
projections, occurrence generation, worker claiming, retries, time-zone and
daylight-saving behavior, secondary-region failure isolation, and
duplicate-delivery tests.

## Slice 5: Files, Gifts, And Debts

Flows: `FILES-001` and `GIFTS-001`.

Deliver object-storage adapters, person documents/photos, gift attachments,
gifts, debts, storage limits, missing/quarantined object states, and authorized
downloads. Include the workspace storage settings surface without exposing file
inventory to ordinary members.

> **Proposed Slice 5 amendment:** include uploaded/file-backed avatar metadata,
> object lifecycle, compensation, and tenant-safe retrieval here; do not make
> Slice 2 depend on object storage.

## Slice 6: Journal And Governance

Flows: `JOURNAL-001` and `GOVERNANCE-001`.

Deliver journal posts, day ratings, ordered journal items, legal-document
acceptance, and the necessary global navigation. Keep person-linked history
visible in the person workspace without making Journal a people submodule.

> **Proposed Slice 6 amendment (DG-07):** accept the complete `PEOPLE-003`
> person-workspace flow here. A life-event editor/history may ship only after
> the product catalog adds a stable flow ID, priority, page association,
> observable outcomes, and E2E contract. Until then it is not covered by
> `PEOPLE-003` or counted toward a milestone; an explicit deferral must also
> define its effect on core-completeness scope.

## Slice 7: Data Lifecycle, Import, And Export

Flows: `IMPORT-001`, `EXPORT-001`, `AUTH-005`, and `WORKSPACE-002`.

Deliver format detection, bounded staging, identity mapping, dry-run reports,
atomic commit, idempotent rerun, attachment manifests, vCard export, workspace
exports, and explicit legacy credential non-activation. Complete workspace reset
and deletion only after every introduced module participates in the atomic data
lifecycle and impact preview.

> **Proposed Slice 7 amendment:** complete the durable import/export job design,
> destructive-lifecycle coordinator, legacy-credential policy, surviving
> deletion-record decision, and DG-07 catalog/release amendment before accepting
> this slice. Imported accounts and password/TOTP/recovery/WebAuthn material
> must never activate access, issue sessions, or authenticate factors; the open
> decision is whether to discard, report, or preserve it inertly pending forced
> reset/re-enrollment. Core import/export must work with integrations disabled;
> optional-source treatment follows the accepted import policy and must not make
> Slice 8 a prerequisite.
>
> Slice 7 is only the proposed MVP/core-feature-complete target. Promote either
> feature milestone from the then-current approved catalog and its passing
> evidence, never from a fixed flow count. The labels remain unavailable until
> DG-07 closes, catalogs/counts are regenerated, and all in-scope non-optional
> flows, pages, states, and performance gates pass. Production promotion remains
> a separate operational decision.

## Slice 8: Optional Platform Modules

Flows: `API-001`, `INTEGRATION-001`, and `BILLING-001`.

Deliver API tokens/OAuth only when required, DAV and other optional adapters,
billing, and operational administration. Each optional module must be disabled
without breaking core CRM workflows.

> **Proposed Slice 8 amendment (DG-07):** do not ship an operations UI until an
> accepted page ID, flow ID, permissions, states, and E2E contract exist;
> otherwise keep operations limited to internal runtime evidence and runbooks.
> Treat API access and integrations as optional only after the page catalog
> gains authoritative availability/feature-gating metadata. Promote each enabled
> optional module independently.

## Slice Acceptance

A slice is complete only when:

- every changed behavior has recorded RED -> GREEN -> REFACTOR evidence for the
  exact candidate revision, followed by a fresh clean-context review and
  independent orchestrator gate rerun;
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
