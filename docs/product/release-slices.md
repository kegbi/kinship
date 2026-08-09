# Release Slices

## Delivery Rule

Build complete vertical slices. A slice includes domain behavior, application
use cases, PostgreSQL adapters, HTTP contracts, generated frontend contracts,
Astro surfaces, telemetry, and all required tests. Do not scaffold every module
with empty folders before one real path proves the architecture.

Exact dependency and runtime versions are selected and locked only when the
first executable scaffold is created. These slices intentionally contain no
version numbers.

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

## Slice 1: Identity, Workspace, And People Core

Flows: `AUTH-001`, `AUTH-002`, `AUTH-003`, `AUTH-004`, `PEOPLE-001`,
`PEOPLE-002`, `PEOPLE-003`, and the read portion of `PEOPLE-004`.

Deliver:

- registration, verification, sign-in, MFA/session baseline, and invitations;
- workspace membership and active-workspace resolution;
- people list, search, create, archived list, and canonical person workspace;
- person identity summary and explicit empty/loading/error states;
- cross-workspace negative tests for every introduced identifier.

The person workspace may initially contain empty section contracts, but it must
already be the single canonical route rather than a temporary subpage tree.

## Slice 2: Complete Profile Facts And Relationships

Flows: `PEOPLE-004`, `PEOPLE-005`, `PEOPLE-006`, and `RELATIONSHIP-001`.

Deliver contact methods, addresses, important dates, first meeting, work,
organizations, tags, pets, food preferences, relationships, archive/restore,
profile-module settings, and partial-date behavior. All appear as sections or
local actions in the person workspace.

## Slice 3: Interactions And Person History

Flows: `INTERACTION-001`, `INTERACTION-002`, and `GOVERNANCE-002`.

Deliver notes, activities, participants, calls, conversations/messages,
emotions, the person history projection, activity report, and audit history.
Prove that the read composition does not permit cross-module writes.

## Slice 4: Planning And Worker Reliability

Flows: `PLANNING-001` and `PLANNING-002`.

Deliver global tasks, person tasks, reminders, stay-in-touch cadence, Today
projections, occurrence generation, worker claiming, retries, time-zone and
daylight-saving behavior, and duplicate-delivery tests.

## Slice 5: Files, Gifts, And Debts

Flows: `FILES-001` and `GIFTS-001`.

Deliver object-storage adapters, person documents/photos, gift attachments,
gifts, debts, storage limits, missing/quarantined object states, and authorized
downloads.

## Slice 6: Journal And Governance

Flows: `JOURNAL-001` and `GOVERNANCE-001`.

Deliver journal posts, day ratings, ordered journal items, legal-document
acceptance, and the necessary global navigation. Keep person-linked history
visible in the person workspace without making Journal a people submodule.

## Slice 7: Import And Export

Flows: `IMPORT-001` and `EXPORT-001`.

Deliver format detection, bounded staging, identity mapping, dry-run reports,
atomic commit, idempotent rerun, attachment manifests, vCard export, workspace
exports, and explicit legacy credential non-activation.

## Slice 8: Optional Platform Modules

Flows: `API-001`, `INTEGRATION-001`, and `BILLING-001`.

Deliver API tokens/OAuth only when required, DAV and other optional adapters,
billing, and operational administration. Each optional module must be disabled
without breaking core CRM workflows.

## Slice Acceptance

A slice is complete only when:

- every included required flow names and passes its E2E test;
- production TypeScript reaches the repository coverage threshold;
- OpenAPI, generated client, schema, and architecture checks are clean;
- all page states and representative accessibility cases are tested;
- Compose can create and tear down an isolated test stack;
- documentation and machine-readable catalogs match the implementation.
