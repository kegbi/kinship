# Active Application Delivery Plan

Status: Accepted execution ledger, revised 2026-08-24

This is the authoritative delivery checklist. Select the first unchecked leaf in
the current phase and deliver it as a complete vertical behavior. The larger
[`roadmap.md`](roadmap.md), [`release-slices.md`](../product/release-slices.md),
and [`traceability.md`](traceability.md) remain coverage references, not
prerequisite queues.

## Cursor

- Current phase: **Phase 12 — UX And Design Integration**
- Current leaf: **UXD-010 — Remove dead dependencies and amend the component
  clause**
- Also open: **OPS-001E — Deployment rollout, rollback, and post-deploy
  verification** in Phase 11. It neither blocks nor is blocked by Phase 12.
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
- [x] **REL-001 — Correct the APP-002C Chromium keyboard focus-order E2E.** Not
      flaky. The walk in `keyboardReachMemberMenuToggle` never tabbed through
      the Journal primary-navigation link that `06093381` added, so focus landed
      on Journal and the Quick capture assertion failed deterministically. The
      application's tab order was correct; only the spec was stale. Found once
      `REL-012` let the stack start again.
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
- [x] **OPS-001E1 — RustFS local and recovery object-storage boundary.**
  - [x] Replace the development, test, and real disposable recovery MinIO
        servers with the exact accepted RustFS image while retaining the
        existing SDK only as a compatible S3 client.
  - [x] Make root development wait for RustFS and pass its loopback S3 endpoint
        to the host API so local file operations use the real object store.
  - [x] Prove upload, download, delete, backup, and isolated source-to-target
        restore against real RustFS instances without running a MinIO server.
- [x] **REL-011 — Rebuild the current migration bundle in root development.**
  - [x] Make `deno task dev` build the migration image from the current checkout
        before applying it so a stale cached API image cannot run an older
        canonical schema bundle.
  - [x] Preserve the existing serial startup, cleanup, and local development
        volumes without introducing a registry or deployment build workflow.
- [x] **APP-011A — Discoverable public authentication entry.**
  - [x] Give anonymous visitors visible sign-in and account-creation links in
        both the public header and home-page hero.
  - [x] Route those links to the existing authentication pages while keeping
        private people navigation inside the authenticated application shell.
  - [x] Preserve coherent keyboard order and overflow-free desktop and `390x844`
        layouts without adding client state.
- [ ] **OPS-001E — Deployment rollout, rollback, and post-deploy verification.**
- [ ] **Phase 11 accepted:** the named environment independently passes every
      required security, privacy, accessibility, performance, observability,
      backup, restore, migration, rollout, rollback, and operational proof.

## Phase 12 — UX And Design Integration

Owning specification:
[`docs/validation/ux-design-review-2026-08-29.md`](../validation/ux-design-review-2026-08-29.md),
the accepted full-codebase UX and design review recorded at `cde53f33`. Its §6
through §11 are the implementation specs for these leaves, and its §12 roadmap
fixes their rank, effort, and dependencies. Leaf `UXD-<n>` is review §12 item
`n`; the review's numbering is preserved so a leaf and its spec never drift.

This phase is scheduled ahead of the still-open Phase 11 `OPS-001E` deployment
leaf. `OPS-001E` is not a prerequisite for any leaf here, and no leaf here
blocks it.

These constraints bind every leaf in this phase:

- The accepted direction is vanilla TypeScript plus CSS custom properties
  (review §10.6). Do not introduce React, Tailwind, shadcn, or another component
  framework.
- Preserve the static-shell and gateway-rewrite routing pattern (review §3.2).
  The five `internal/*-shell.astro` pages remain the implementations of the
  cataloged dynamic routes.
- `?section=` deep links stay non-negotiable
  ([`person-workspace.md`](../product/person-workspace.md), review §7.4). Every
  section ID keeps resolving after the layout changes.
- One roadmap item per candidate. Do not batch two items into one commit.
- An accepted contract changes only through an explicit amendment inside the
  same candidate that needs it. Never silently violate one.

### Execution Order

1. `UXD-006`, `UXD-007`, and `UXD-010` as three separate same-day candidates.
2. `UXD-001` design tokens, with `UXD-013` opened in parallel on the API side so
   the per-section summary lands before `UXD-002` consumes it.
3. `UXD-002` person-workspace three-zone layout.
4. `UXD-003` staged loading. Its three prefetch deletions may ship as an earlier
   independent slice.
5. `UXD-005` feedback pass, then the remaining leaves in §12 rank order,
   respecting each row's dependency note.

Report and request direction once `UXD-001` through `UXD-005` are integrated.

### Blocking Reliability Repair

- [x] **REL-012 — Restore the end-to-end object-storage container.** The
      production-like browser gate could not start: `deno task test:e2e` failed
      because the `object-store` service exited 1 with
      `[FATAL] Server runtime failed: Io error: Permission denied (os error 13)`,
      so `api`, `web`, and `worker` never started. Reproduced with no repository
      code involved, from the pinned RustFS image plus the test overlay's own
      settings.
  - [x] Root cause: the image runs as `uid=10001(rustfs)` and ships `/data`
        owned by that user, but `compose.test.yaml` mounts `/data` as a bare
        `tmpfs`, which Docker creates root-owned at mode 0755, so the server
        cannot write its data or log directories. The same service in
        `compose.dev.yaml` uses the `object-store-data` named volume, which
        inherits the image's ownership, and therefore still works. The tmpfs
        arrived with the MinIO-to-RustFS switch in `cb9e544b`; MinIO tolerated a
        root-owned mount.
  - [x] Give the test overlay's `/data` tmpfs the ownership or mode the pinned
        image requires, and prove the stack reaches ready with a focused
        executable check that consumes the changed Compose artifact.
  - [x] Do not weaken `read_only`, drop the tmpfs for a persistent volume in the
        test overlay, or change the accepted RustFS image pin.

- [ ] **REL-013 — Stabilize the WORKSPACE-003 personalization browser flow.**
      With the stack able to start again, `app-004e.spec.ts` failed twice at the
      Tags step: after the Tags module is toggled off and back on, clicking the
      `Tags` section link left the URL at `?section=profile-modules` instead of
      `?section=tags`. It then passed twice. Treat it as intermittent, not
      deterministic, and reproduce it before changing anything.
  - [ ] Reproduced identically on `10019c60` carrying only the REL-012 Compose
        fix, so neither `UXD-006` nor `REL-012` caused it. The failure was
        hidden while the object-store could not start, which means a delivered
        P1 flow has been red without anyone seeing it.
  - [ ] Prime suspect, to confirm before fixing: the section link handler in
        `apps/web/src/lib/personalization.ts` calls `navigationCleanMessage()`,
        which fires `globalThis.confirm()` while the page is dirty. Playwright
        auto-dismisses an unhandled dialog, so the handler returns early and
        never pushes the new section. Decide whether the page is wrongly still
        dirty after a successful module save, in which case the product is at
        fault and the dirty baseline must be refreshed, or whether the guard is
        correct and the spec must handle its own dialog. Do not change the
        accepted dirty-state protection contract to make a test pass.
  - [ ] Check whether other cataloged flows regressed while the browser gate was
        unrunnable before claiming this is the only one. Two of the first two
        flows run against a healthy stack were red: `APP-002C`, corrected by
        `REL-001`, and `WORKSPACE-003` here. Until that sweep runs, treat
        `user-flows.yaml`'s delivered statuses as unverified rather than false.

- [ ] **REL-014 — Walk the real header focus order in `auth-003`.**
      `tests/e2e/auth-003.spec.ts:265` skips the Journal navigation link exactly
      as `app-002c` did, so both sign-out tests fail. `REL-001` fixed the
      `app-002c` copy of this walk and missed this duplicate. Reproduced on
      clean `main`. Check every remaining spec for a third copy before closing.
- [ ] **REL-015 — Disambiguate the settings alert region.**
      `tests/e2e/app-002e.spec.ts:203` fails a Playwright strict-mode check
      because `getByRole('alert')` matches both `#settings-errors` and
      `#lifecycle-blockers` on the settings page. Decide whether two
      simultaneous alerts on one page is the intended experience before
      narrowing the locator; two competing alert regions may be the real defect.
      Reproduced on clean `main`.
- [ ] **REL-016 — Send one `referrer-policy` header.**
      `tests/e2e/auth-002.spec.ts:212` receives `no-referrer, no-referrer`, so
      the gateway emits the header twice, most likely from `add_header` in two
      nginx scopes. `OPS-001A` claims this policy was proved on the real pinned
      Nginx, so establish why that proof passes while a browser response carries
      a duplicate. Reproduced on clean `main`.

`REL-012` is delivered, so candidates in this phase can produce browser evidence
again. `UXD-007` changes keyboard focus order that `tests/e2e/app-002c.spec.ts`
asserts, so it runs that spec on its candidate.

### Do First

- [x] **UXD-006 — Repair dead section navigation for hidden modules.** (§3.4,
      §6.9, §7.4; effort S; no dependency)
  - [x] Remove section-navigation entries for sections hidden by workspace
        personalization instead of leaving links that only push history.
  - [x] Render an inline turned-off notice with a personalization link when a
        hidden section is deep-linked, never a silent no-op in `focusSection`.
- [x] **UXD-007 — Quick-wins bundle.** (§6.8, §8, §10.7; effort S; no
      dependency)
  - [x] Make the reduced-motion rule stop animation, not only transitions and
        scroll behavior, so the directory spinner honors the preference.
  - [x] Link the member menu Profile item to the existing profile settings page
        and delete the help and what-is-new stub.
  - [x] Move sign out and the workspace switcher into the member popover so
        header height stops changing between accounts.
  - [x] Widen the person workspace frame to the header width.
- [ ] **UXD-007B — Give the reminder and cadence editors the shared add-form
      pattern.** (§6.8, §7.7; effort M; split out of `UXD-007`; no dependency)
  - [ ] The review asks for the `hidden` attribute on the two always-open forms
        so all twenty-two behave identically. Adding the attribute alone would
        strand them: unlike the other twenty sections these two have no add
        button, and `apps/web/src/lib/reminders.ts` never toggles their
        visibility, so a hidden form would be unreachable.
  - [ ] Deliver the same add-button, hidden-form, and focus behavior the other
        sections already use, and update the `PLANNING-002` browser flow that
        drives those forms directly.
  - [ ] Split out of `UXD-007` because it changes a delivered P0 flow's UI and
        needs its own browser evidence, which is not a same-day quick win.

- [ ] **UXD-010 — Remove dead dependencies and amend the component clause.**
      (§10.6; effort S; no dependency)
  - [ ] Remove the React, Tailwind, shadcn, and related unused packages from the
        manifest and lockfile while keeping the live JSX accessibility plugin.
  - [ ] Amend the component clause in
        [`dashboard-settings-design.md`](../product/dashboard-settings-design.md)
        to name the equivalent Kinship primitives, keeping every accessibility
        clause verbatim. Amend it; do not silently violate it.
- [ ] **UXD-001 — Design tokens.** (§10.1, §10.2; effort M; no dependency)
  - [ ] Introduce the accepted token set and replace the hardcoded literals
        across the three stylesheets.
  - [ ] Fix the small-text contrast failures found in the same pass rather than
        tokenizing them unchanged.
- [ ] **UXD-013 — Person summary read model with per-section counts.** (§9.2
      stage 2; effort M; API side; no dependency)
  - [ ] Extend the person read path with primary contact methods, next reminder,
        stay-in-touch state, relationship counts, and a record count per
        section.
  - [ ] Keep the `person-profile` read model read-only and regenerate contract
        artifacts through their generator.
- [ ] **UXD-002 — Person workspace three-zone layout.** (§7; effort L; depends
      on `UXD-001` and `UXD-006`)
  - [ ] Deliver the hero that absorbs the lifecycle panel, due-information card,
        identity summary, and standalone back link, with destructive actions
        demoted into the overflow menu.
  - [ ] Move the nine profile-fact sections into the rail and group the
        remaining stream sections into Timeline, Planning, Things, and Admin
        behind a pressed-state filter, not a tab list.
  - [ ] Preserve every `?section=` deep link through the section-to-zone map and
        keep DOM order contractual at every breakpoint.
- [ ] **UXD-003 — Staged loading.** (§9.2, §9.3; effort M; the prefetch
      deletions are independent, zone laziness depends on `UXD-002`)
  - [ ] Delete the duplicate contact-methods fetch, the gifts prefetch, and the
        global quick-capture prefetch, including the failure path that disables
        quick capture application-wide.
  - [ ] Replace the full-page takeover with a shell and skeletons, cache the
        session, and load only the visible zone eagerly.
  - [ ] Keep the initial fan-out silent for assistive technology while
        user-initiated refreshes still announce.
- [ ] **UXD-005 — Feedback pass.** (§11; effort M; depends on `UXD-001` and
      `UXD-003`)
  - [ ] Promote the existing status region into a dismissible toast region for
        off-screen and undoable outcomes only, keeping inline form feedback
        authoritative.
  - [ ] Deliver the person-level first-run empty state, collapsed empty rail
        rows, and the dirty-state guard the settings design already requires.

### Then

- [ ] **UXD-004 — Global people search and command palette.** (§8; effort M; no
      dependency) The only design-document requirement that is unimplemented and
      untracked elsewhere.
- [ ] **UXD-008 — Persistent settings sidebar.** (§8; effort M; depends on
      `UXD-001`)
- [ ] **UXD-009 — Breadcrumbs on routes at least two levels deep.** (§8; effort
      S; no dependency)
- [ ] **UXD-011 — Decide the Inter question: self-host or drop the name.**
      (§10.3; effort S; depends on `UXD-001`)
- [ ] **UXD-012 — Split the application stylesheet into six files.** (§10.7;
      effort S; depends on `UXD-001`)
- [ ] **UXD-014 — Optimistic UI on the four safe mutations only.** (§9.4; effort
      M; depends on `UXD-003` and `UXD-005`) Anything carrying an expected
      update timestamp stays non-optimistic.
- [ ] **UXD-015 — Parser-inert role gating on the application shell.** (§9.5;
      effort M; no dependency)
- [ ] **UXD-016 — Dark mode.** (§10.5; effort M; depends on `UXD-001` and
      `UXD-011`)
- [ ] **UXD-017 — Type-scale and spacing-rhythm pass.** (§10.3, §10.4; effort M;
      depends on `UXD-001` and `UXD-011`)
- [ ] **UXD-018 — Command mode in the palette.** (§8; effort M; depends on
      `UXD-004`)
- [ ] **UXD-019 — Mobile bottom-sheet editors below the tablet breakpoint.**
      (§7.7; effort M; depends on `UXD-002`)
- [ ] **UXD-020 — Deferred product features named in §12 row 20.** Notifications
      centre, people favorites, life-event mutation, and directory tag cloud and
      sort are product scope, not design debt. They stay parked until their
      product contracts exist; life-event mutation still depends on the open
      flow decision in [`traceability.md`](traceability.md).
- [ ] **DOC-001 — Refresh the planning entry-point baseline.** The Current
      Baseline table in [`README.md`](README.md) still describes a pre-scaffold
      repository with zero delivered flows, and
      `tools/product/PRODUCT-001/release_contract_test.ts` pins that zero. Fix
      the table and its pinning assertion together so the two planning documents
      stop contradicting each other. This continues review §5.3 item 5 beyond
      the traceability correction shipped with this queue.
- [ ] **Phase 12 accepted:** the person workspace reads as grouped zones rather
      than peer cards, first paint no longer waits on the full section fan-out,
      tokens back every surface, and no leaf above is unchecked without a
      recorded parked reason.

### Recorded Correction To The Owning Review

Review §5.3 item 5 states the actual totals as 30 delivered flows and 34 pages.
Both numbers are wrong against the catalogs it cites:
`docs/product/user-flows.yaml` declares 30 flows of which 29 are `delivered`,
because `BILLING-001` remains planned with empty `testRefs`, and
`docs/product/page-catalog.yaml` declares 39 page IDs, which is the number
[`traceability.md`](traceability.md) already carried. The 34 appears to be the
count of prerendered Astro pages from review §3.1. The traceability refresh
shipped with this queue uses the verified totals; the review itself keeps its
original analysis.

The review file was also brought under `deno fmt`, which it failed as committed,
so the repository formatting gate passes for every candidate in this phase. That
pass changed exactly one character of prose: a wrapped continuation line in §7.4
began with `+ name appear alongside`, which every CommonMark parser reads as a
nested list item, and it now reads `and name appear alongside`. No other wording
changed.
