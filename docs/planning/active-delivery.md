# Active Application Delivery Plan

Status: Accepted execution ledger, revised 2026-08-24

This is the authoritative delivery checklist. Select the first unchecked leaf in
the current phase and deliver it as a complete vertical behavior. The larger
[`roadmap.md`](roadmap.md), [`release-slices.md`](../product/release-slices.md),
and [`traceability.md`](traceability.md) remain coverage references, not
prerequisite queues.

## Cursor

- Current phase: **Phase 11 — Production Readiness**
- Current leaf: **OPS-001E — Deployment rollout, rollback, and post-deploy
  verification**
- Last accepted process checkpoint: `0b82f1a218c95587e82c2d5581b5b688e643f2b0`
- Exact delivery checkpoints: `git log -- docs/planning/active-delivery.md`

## How To Use This Ledger

1. Work on one unchecked leaf at a time on a controller-owned `codex/` branch.
2. One implementation context delivers the complete leaf through a focused RED
   -> GREEN -> REFACTOR cycle. Its inner loop runs only focused tests and it
   does not commit or integrate.
3. After behavior stabilizes, the controller runs affected candidate gates,
   ticks the delivered leaf and its acceptance boxes, and creates one candidate
   commit.
4. A separate read-only context reviews the exact candidate. Localized findings
   return to the same implementer and reviewer; replace contexts only for a
   material redesign, changed high-risk boundary, or repeated failed approach.
5. Only an approved candidate with its smallest owning integration gate passing
   is integrated. Full aggregate gates run once at the flow/phase checkpoint.
   Until integration, checked boxes on its branch are not authoritative.
6. Tick a phase only when every required leaf in that phase is accepted. Update
   the Cursor in the same candidate; do not create a separate status commit.
7. Git and test output hold detailed evidence. Do not add ticket packets,
   dispatch files, controller IDs, evidence ledgers, hash catalogs, or frozen
   test commits.

Every leaf must preserve at least 80% line, branch, and function coverage for
production code. Changed behavior, authorization and tenant boundaries, schema
behavior, and required user flows still receive focused tests. Every shipped
route needs its accepted page-catalog ID, and every required workflow needs a
Playwright test carrying its stable flow ID.

## Parked Work

- [ ] Revisit the migration-runner comparison only when the first
      database-backed vertical leaf needs it. The unaccepted spike is parked on
      `codex/fnd-03-migration-runner-spike` at
      `22c169864cdc50abf525f22bf1c34bb01dadfa7b`; do not resume Atlas hardening.
- [ ] Pull authentication, Compose, gateway/TLS, background work, CI, telemetry,
      design-system breadth, and architecture enforcement into the first leaf
      that consumes each boundary. Do not turn them into a new Foundation phase.
- [ ] **REL-001 — Stabilize the APP-002C Chromium keyboard focus-order E2E.**
      The Phase 6 aggregate run failed once before passing its one bounded exact
      reproduction; keep this isolated from feature candidates and revisit at a
      later reliability checkpoint.
- [ ] **AI-mediated CRM data interaction is deferred.** It is not part of the
      active delivery queue or a prerequisite for core, optional-platform, or
      production-readiness completion. Revisit it only when the product is ready
      to define how a user should interact with CRM data through AI; DG-08 must
      then establish the product, privacy, authorization, safety, evaluation,
      and persistence contract before implementation begins.
- [x] **REL-002 — Isolate governance PostgreSQL legal-document fixtures.**
  - [x] Remove the legal documents, acceptances, and audits owned by
        `GOVERNANCE-001` after its assertions complete.
  - [x] Prove `GOVERNANCE-001` followed by `INTERACTION-001` on one disposable
        database without legal-acceptance guard leakage.
- [x] **REL-003 — Serialize production-like E2E shared state.**
  - [x] Default the shared Compose-stack browser run to one worker while
        preserving an explicit caller override.
  - [x] Remove each `GOVERNANCE-001` browser project's legal fixture
        unconditionally by its exact document ID.

## Just-In-Time Technical Capabilities

These are cross-cutting acceptance items, not separately scheduled tickets.

- [x] Real root development, build, check, test, and coverage commands arrive
      with the first application code that uses them.
- [x] Exact runtime and dependency pins remain frozen once selected by
      executable application code.
- [x] The minimum raw migration runner and PostgreSQL Compose service arrive
      with the first database-backed user flow.
- [x] The identity adapter and Better Auth accept/reject decision arrive with
      the first real registration or sign-in flow.
- [x] Deterministic OpenAPI 3.1 and a frontend client boundary arrive with the
      first business API contract that benefits from generation; frontend code
      never imports backend internals.
- [x] Production-like gateway, secure-cookie, origin, CSRF, and test-TLS
      behavior arrive with the first protected browser flow that consumes them.
- [x] Durable worker guarantees arrive with the first reminder, import, export,
      or synchronization behavior that needs them.
- [ ] Provider CI configuration arrives only after truthful local root commands
      and real suites exist.

## Phase 0 — Delivery Reset

- [x] **PROC-001 — Replace Foundation-first delivery with vertical execution.**
  - [x] Make this file the authoritative queue.
  - [x] Reduce orchestration to one clean implementer, one exact candidate, one
        clean reviewer, and controller-owned integration.
  - [x] Retire workflow-policy tests, runtime-policy tests, packets, run IDs,
        and frozen-test commits.
  - [x] Preserve accepted architecture, product, authorization, schema, and the
        repository-wide 80% production coverage requirement.

## Phase 1 — Runnable Product Surface

- [x] **APP-001A — Runnable API and public home.**
  - [x] Create the Deno/Hono application under `apps/api`.
  - [x] Expose stable `/api/v1/health` health/readiness behavior without
        secrets.
  - [x] Create the Astro application under `apps/web`.
  - [x] Render `public.home` with honest API ready and error states.
  - [x] Add only the shared API contract needed by this behavior.
  - [x] Add truthful root development, build, check, test, and coverage
        commands.
  - [x] Add focused API/contract/UI tests and one Chromium smoke path.
  - [x] Document the one root command that starts both applications locally.
- [x] **APP-001B — Complete the static public product surface.**
  - [x] Deliver the accepted `public.features` route and public navigation.
  - [x] Preserve accepted ready and not-found states, responsive layout,
        metadata, keyboard behavior, and representative accessibility coverage.
- [x] **Phase 1 accepted:** a developer can start both real applications and use
      the complete accepted public surface against a live versioned API.

Do not add authentication, persistence, broad component libraries, all-browser
E2E, deployment infrastructure, or module scaffolds to APP-001A unless its
runnable behavior cannot work without them.

## Phase 2 — Identity And Protected Workspace

- [x] **APP-002A / `AUTH-001` — Create the first workspace.**
  - [x] Deliver registration, verification, first workspace creation, and the
        documented success and failure states atomically.
  - [x] Introduce only the identity/database/migration/Compose behavior consumed
        by this flow and prove rollback and imported-credential non-activation.
- [x] **APP-002B / `AUTH-003` — Sign in and establish a protected session.**
  - [x] Deliver password and required MFA challenges, safe errors, session
        rotation, sign-out, and protected-route rejection.
  - [x] Resolve active member and workspace context and prove a second-workspace
        isolation negative.
- [x] **APP-002C — Protected application shell.**
  - [x] Deliver the accepted authenticated navigation, first-workspace
        onboarding state, settings shell, and an honest initial Today shell at
        `/app`.
  - [x] Add the minimum gateway/CSRF/origin/secure-cookie behavior consumed by
        the protected Chromium path.
- [x] **APP-002D / `AUTH-002` — Invite and add a workspace member.**
  - [x] Deliver invitation creation, acceptance, expiry/replay handling, role
        checks, and member-list state.
- [x] **APP-002E / `AUTH-004`, `WORKSPACE-001` — Preferences, sessions,
      workspace, and members settings.**
  - [x] Deliver personal profile/preferences and session management.
  - [x] Deliver role-safe workspace settings and member administration.
- [x] **Phase 2 accepted:** anonymous, active-member, administrator, owner, and
      cross-workspace boundaries pass the Slice 1 identity/workspace flows.

## Phase 3 — People Core

- [x] **APP-003A / `PEOPLE-001` — Create a person.**
  - [x] Deliver domain/application behavior, tenant-safe PostgreSQL adapter,
        versioned API, creation UI, validation/conflict states, and flow E2E.
- [x] **APP-003B / `PEOPLE-002` — Find a person.**
  - [x] Deliver people list, search, filter/sort behavior required by the flow,
        empty/loading/error states, and archived-list entry point.
- [x] **APP-003C — Open the canonical person workspace shell.**
  - [x] Use only `/app/people/:personId` for person-specific work.
  - [x] Deliver identity summary, deep-linkable section shell, not-found and
        cross-workspace rejection, and honest unavailable/empty section states.
- [x] **Phase 3 accepted:** create, find, and open a person form one tenant-safe
      API-to-database-to-Astro walking path. `PEOPLE-003` remains incomplete
      until Phase 8 supplies every enabled core section.

## Phase 4 — Profile Facts And Relationships

- [x] **APP-004A / `PEOPLE-004` — Person lifecycle.**
  - [x] Deliver edit, archive, restore, and delete as the indivisible accepted
        flow with impact, authorization, and cross-workspace checks.
- [x] **APP-004B / `PEOPLE-005` — Important and partial dates.**
  - [x] Deliver birthday, first meeting, death, and custom partial-date behavior
        without inventing precision.
- [x] **APP-004C / `PEOPLE-006` — Complete enabled profile facts.**
  - [x] Deliver contact methods, addresses, work, organizations, tags, pets,
        food preferences, and other accepted enabled sections as local workspace
        actions.
- [x] **APP-004D / `RELATIONSHIP-001` — Relationships between people.**
  - [x] Deliver directional relationship create/change behavior, uniqueness,
        permissions, and archive interactions.
- [x] **APP-004E / `WORKSPACE-003` — Profile modules and vocabularies.**
  - [x] Deliver module settings and controlled vocabularies through accepted
        personalization section deep links, not separate CRUD routes.
- [x] **Phase 4 accepted:** all Slice 2 flows pass and every mutation uses its
      owning module's public application facade.

## Phase 5 — Interactions And History

- [x] **APP-005A / `INTERACTION-001` — Activities and notes.**
  - [x] Deliver quick capture and person-workspace logging/review with
        participants and emotions needed by the accepted flow.
- [x] **APP-005B / `INTERACTION-002` — Calls and conversations.**
  - [x] Deliver calls, conversations/messages, person linkage, and accepted
        communication states.
- [x] **APP-005C / `GOVERNANCE-002` — History and authorized audit.**
  - [x] Deliver the remaining person-history and authorized audit-history
        surfaces while proving read composition cannot perform cross-module
        writes.
- [x] **Phase 5 accepted:** Slice 3 interaction/history flows pass with
      tenant-safe projections and authorized audit access.

## Phase 6 — Today, Tasks, Reminders, And Workers

- [x] **APP-006A / `PLANNING-001` — Tasks.**
  - [x] Deliver global and person tasks, create/change/complete behavior, and
        local person-workspace actions.
- [x] **APP-006B / `PLANNING-002` — Reminders and stay-in-touch cadence.**
  - [x] Deliver reminder/cadence scheduling, occurrence generation, timezone/DST
        behavior, duplicate-safe delivery, and user-visible failure states.
- [x] **APP-006C / `TODAY-001` — Action-oriented Today.**
  - [x] Deliver the accepted semantic order: attention queue, people due for
        contact, upcoming work, recent people, reference notes, and activity.
  - [x] Inline actions call owning module use cases; the `today` read model
        stays read-only.
- [x] **APP-006D — Worker reliability.**
  - [x] Prove claim, retry, restart, secondary-region failure isolation,
        timezone, DST, and duplicate-delivery behavior required by active
        workloads.
- [x] **Phase 6 accepted:** Slice 4 flows pass and the core-alpha user journey
      is complete without a horizontal job framework unrelated to active
      workloads.

## Phase 7 — Files, Gifts, And Debts

- [x] **APP-007A / `FILES-001` — Person files.**
  - [x] Deliver the object-storage adapter, authorized upload/download,
        documents, photos, limits, and missing/quarantined object states.
- [x] **APP-007B / `GIFTS-001` — Gifts and debts.**
  - [x] Deliver gift ideas/history, gift attachments, debts, permissions, and
        person-workspace sections/actions.
- [x] **APP-007C — Workspace storage settings.**
  - [x] Deliver role-safe storage configuration without exposing workspace file
        inventory to ordinary members.
- [x] **Phase 7 accepted:** Slice 5 flows pass, including object-store failure
      and compensation behavior.

## Phase 8 — Journal, Governance, And Complete Person Workspace

- [x] **APP-008A / `JOURNAL-001` — Personal journal.**
  - [x] Deliver posts, day ratings, ordered items, CRUD behavior, and accepted
        journal routes/states.
- [x] **APP-008B / `GOVERNANCE-001` — Legal-document acceptance.**
  - [x] Deliver versioned review/acceptance behavior and required navigation or
        access interruption states.
- [x] **APP-008C / `PEOPLE-003` — Complete person workspace.**
  - [x] Compose every enabled core person section through approved read models,
        preserve deep links, and prove mutations still call owning facades.
- [x] **Phase 8 accepted:** Slice 6 flows pass and the canonical person
      workspace is complete for every enabled core module.

## Phase 9 — Import, Export, And Destructive Data Lifecycle

- [x] **APP-009A / `IMPORT-001` — Safe Monica import.**
  - [x] Deliver format detection, bounded staging, mapping, dry-run reports,
        attachment manifests, atomic commit, idempotent rerun, and explicit
        legacy-credential non-activation.
- [x] **APP-009B / `EXPORT-001` — Portable exports.**
  - [x] Deliver vCard/person and workspace exports with authorization, resumable
        behavior where required, and safe artifact access.
- [x] **APP-009C / `AUTH-005` — Personal lifecycle.**
  - [x] Deliver leave-workspace and personal-identity deletion with recent auth,
        typed confirmation, impact preview, and final-owner handling.
- [x] **APP-009D / `WORKSPACE-002` — Workspace reset and deletion.**
  - [x] Coordinate every delivered module, session effect, atomic database
        boundary, object cleanup/reconciliation, retries, and durable deletion
        audit decision.
- [x] **REL-004 — Aggregate integration object-storage authority.**
  - [x] Permit the shared integration composition to read the object-storage
        configuration required by delivered API modules.
- [x] **REL-005 — Bound the PEOPLE-006 full-integration hang.**
  - [x] Reproduce and correct the stalled profile-facts integration boundary
        observed with idle PostgreSQL sessions and no Deno progress.
- [x] **REL-006 — Restore the authoritative API coverage manifest.**
  - [x] Include the existing Slice 7 unit, API, contract, worker, and PostgreSQL
        tests required to measure every delivered production surface.
- [x] **REL-007 — Serialize workspace lifecycle form initialization.**
  - [x] Keep destructive submissions disabled until the current owner session,
        impact preview, and submit handlers are ready in every supported
        browser.
- [x] **REL-008 — Keep the production Compose worker alive.**
  - [x] Grant the existing worker its exact dependency environment authority and
        prove reminder/cadence delivery through the production-like boundary.
- [x] **PERF-001 — Accept the DG-10 MVP capacity profile.**
  - [x] Fix the initial one-workspace, one-user/three-user-burst assumptions,
        representative datasets, desktop/browser baseline, and functional
        page/API ceilings.
  - [x] Keep large files represented by metadata/manifests and require heavy
        import/export work to expose durable visible status and resume/retry
        behavior.
  - [x] Add one blocking regression gate for the delivered
        page/API/query/worker/import/export boundaries without claiming a
        production SLO.
- [x] **Phase 9 accepted:** Slice 7 P0/P1 data-lifecycle flows pass and the
      catalog-derived proposed-MVP/core-feature-complete criteria are satisfied.

## Phase 10 — Optional Platform Modules

Each leaf remains optional until its module is enabled and its accepted product
contract applies. Disabled modules must not break core CRM workflows.

- [x] **APP-010A / `API-001` — API tokens and approved programmatic access.**
- [x] **APP-010B / `INTEGRATION-001` — DAV and selected integrations.**
  - [x] Configure, synchronize, retry, inspect, and disable CardDAV contacts and
        CalDAV/VTODO tasks through the owner/admin settings surface.
  - [x] Encrypt credentials, isolate tenant state, checkpoint href/ETag/token
        progress, reclaim stale work after restart, and preserve core people and
        tasks when the optional module is disabled.
- [x] **APP-010C — Keep optional workspace billing disabled for the initial
      private deployment.**
  - [x] Do not claim `BILLING-001` as delivered: it remains conditional future
        work when a deployment explicitly enables the billing module and selects
        a provider with credentials.
  - [x] Do not introduce billing state, adapters, or entitlement coupling while
        the module is disabled; the current one-primary-user deployment does not
        require subscription or invoice operations.
- [x] **APP-010D — Keep operational administration internal until its product
      contract is accepted.**
  - [x] Do not ship or claim an operations/admin user surface for this
        deployment: no accepted page ID, flow ID, permission, availability,
        state, or E2E contract exists.
  - [x] Preserve the unresolved DG-07 choice between a future user surface and
        CLI/runbook-only administration. Keep existing runtime/lifecycle
        evidence internal; production runbooks remain Phase 11 work.
- [x] **REL-009 — Make the API-token Copy E2E browser-neutral.**
  - [x] Exercise the real Copy handler without requesting clipboard permissions
        that Firefox or WebKit do not support in Playwright.
  - [x] Verify both the visible success outcome and the exact one-time secret
        passed to the page-local clipboard boundary in every browser engine.
- [x] **Phase 10 accepted:** every enabled Slice 8 module independently passes
      its flows and can be disabled without breaking the core product.

## Phase 11 — Production Readiness

Production readiness is independent of feature-completion labels and applies to
a named environment.

- [x] **OPS-001A — Security, privacy, and accessibility verification.**
  - [x] Keep every accepted authentication, authorization, tenant-isolation,
        lifecycle, secret-redaction, and gateway-log gate blocking without
        claiming an unapproved ASVS profile.
  - [x] Harden every public gateway response with a bounded CSP, denied ambient
        browser capabilities, no-referrer, HSTS, MIME-sniffing prevention, and
        framing denial; prove the exact policy on the real pinned Nginx.
  - [x] Use the private owner-operated privacy boundary: no support access and
        no CRM content in telemetry; the delivered export, personal deletion,
        and workspace lifecycle contracts remain authoritative. Backup retention
        belongs to OPS-001C and incident handling to OPS-001D.
  - [x] Keep automated accessibility scans, semantic assertions, keyboard-only
        primary paths, and the `390x844` smoke blocking for the current private
        desktop audience without claiming an unapproved manual WCAG target.
- [x] **REL-010 — Restore the aggregate API unit read permission.**
  - [x] Add only the exact v7 specification and canonical SQL files consumed by
        the existing baseline test to the `test:unit:api` read allowlist.
  - [x] Prove the aggregate API unit task no longer fails its own Deno
        permission boundary.
- [x] **OPS-001B — Representative performance, capacity, SLOs, and
      observability.**
  - [x] Fix conservative startup objectives for the named owner-operated
        `private-production` environment: one steady user, a burst of three, one
        workspace, 99.0% rolling 30-day availability, and p95 latency targets no
        looser than the accepted PERF-001 functional ceilings.
  - [x] Consume the existing redacted gateway request duration/status logs and
        API/renderer readiness boundary without introducing third-party
        telemetry for the initial deployment.
  - [x] Provide one executable HTTPS operator probe that emits a bounded local
        structured result and reports unavailability only after three
        consecutive one-minute readiness failures.
- [x] **OPS-001C — Backup/restore, migration rollout/rollback, and recovery.**
  - [x] Provide one explicit operator command that creates a consistent
        canonical-v7 PostgreSQL custom dump plus a complete S3-compatible object
        archive only while application and worker writes are explicitly
        quiesced. Accept only an atomic direct-child archive ID under the
        repo-local recovery root so a concurrent loser cannot delete its winner.
  - [x] Make a versioned manifest authoritative for schema version, database and
        object checksums, object metadata, and the private recovery policy; fail
        closed before target mutation on missing source bytes, format drift, or
        checksum mismatch without emitting object keys or credentials.
  - [x] Restore only into an explicitly isolated database with no user relation
        or non-system schema and an empty object endpoint that reuses the
        manifest bucket name required by restored file metadata, verify the
        restored database through the canonical migration verifier, and report
        missing and extra object counts with measured recovery time and
        recovery-point age. Treat either reconciliation class or a missed
        objective as non-zero operator attention and never promote that target.
  - [x] Fix the proportionate owner-operated policy at daily backups, 30-day
        retention, 24-hour RPO, and four-hour RTO. Keep archive encryption and
        provider/session key material external for OPS-001D.
  - [x] Reuse the owning schema matrix for v6-to-v7 rollout and atomic failed
        migration rollback instead of creating another migration framework.
- [x] **OPS-001D — Secrets, provider configuration, incident and release
      runbooks.**
  - [x] Provide one fail-closed operator preflight that consumes the existing
        runtime validators for HTTPS origin, PostgreSQL, S3-compatible object
        storage, versioned MFA/throttle/DAV keys, authentication timing, and
        authenticated implicit-TLS SMTP. Emit only bounded issue codes and
        corrective actions, never supplied values.
  - [x] Keep DAV explicitly enabled with its complete encryption keyset or
        explicitly disabled without residual key material. Require TLS for the
        public gateway, object storage, and production SMTP without choosing a
        deployment provider; keep Mailpit capture and its API dependency only in
        the development and test overlays.
  - [x] Keep application/provider/session/archive secrets outside the repo and
        recovery archive. Name the private owner, overlap-safe rotation, and
        independent recovery dependency for every consumed secret class.
  - [x] Require an external encrypted-at-rest archive boundary and independently
        verified archive-key recovery before preflight succeeds; actual secret
        values and the deployment key store remain OPS-001E inputs.
  - [x] Provide exact release/abort, readiness, incident, compromised-key,
        isolated recovery, log-retention, daily backup, monthly restore, and
        secret-rotation steps for the named owner-operated environment.
- [ ] **OPS-001E — Deployment rollout, rollback, and post-deploy verification.**
- [ ] **Phase 11 accepted:** the named environment independently passes every
      required security, privacy, accessibility, performance, observability,
      backup, restore, migration, rollout, rollback, and operational proof.
