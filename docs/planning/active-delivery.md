# Active Application Delivery Plan

Status: Accepted execution ledger, revised 2026-09-05

This is the authoritative delivery checklist. Select the first unchecked leaf in
the current phase and deliver it as a complete vertical behavior. The larger
[`roadmap.md`](roadmap.md), [`release-slices.md`](../product/release-slices.md),
and [`traceability.md`](traceability.md) remain coverage references, not
prerequisite queues.

## Cursor

- Current phase: **Phase 13 — Person Blocks And Usability Repair**
- Active work order:
  [architecture gap remediation plan](architecture-gap-remediation-plan-2026-09-15.md),
  executed one GAP ticket per candidate from GAP-001 onward.
- Phase 0 of that plan (GAP-001 through GAP-005) is integrated at `08680601`.
  The Phase 0 checkpoint on `main` passed `check`, `check:architecture`,
  `contracts:check`, `test:coverage`, and `build`; root `test` hit the Astro
  child exit tracked by `REL-034` once, and the E2E matrix failed 8 of 171
  flows, tracked by `REL-032` and `REL-033`; none is caused by Phase 0. The
  GAP-004 GitHub Actions workflow has not run on a branch yet because nothing
  has been pushed.
- Phase 1 of that plan (GAP-006 through GAP-014) is integrated at `59a2298d`,
  and `REL-037` closed at `faead934`. The Phase 1 checkpoint on `faead934`
  passed root `check`, `contracts:check`, `check:architecture` (14 baseline
  entries, all declared-dependency table reads), `test` (718 vitest, every Deno
  set, integration 126/0), and `test:coverage` (every set above its floor,
  `gifts` at 87.3% branch); the Chromium E2E project passed 53 of 57 flows and
  failed exactly the four tracked by `REL-032` and `REL-033`. Nothing new was
  parked. The CI workflow still has not run because nothing has been pushed.
- Phase 2 of that plan (GAP-015 through GAP-018) is integrated at `1c050b5a`.
  The Phase 2 checkpoint on `1c050b5a` passed root `check`, `contracts:check`,
  `check:architecture` (14 baseline entries, unchanged since GAP-013), `test`,
  and `test:coverage` (all 26 sets above their floors); the Chromium E2E project
  passed 53 of 57 flows and failed exactly the four tracked by `REL-032` and
  `REL-033`. Every backend module now has `domain/` and `ports/` directories
  measured at the shared kernel's bar, and `REL-038` records the one
  non-deterministic coverage measurement seen on the way.
- Phase 3 of that plan (GAP-019 through GAP-024) is integrated at `cb132f30`,
  and `REL-039` was parked at `6c915aa6`. The Phase 3 checkpoint on `6c915aa6`
  passed root `check`, `contracts:check` (123 documented, 126 mounted),
  `check:architecture` (14 baseline entries, unchanged), `test` (734 vitest,
  every Deno set, integration 130/0), `test:coverage` (every set above its
  floor; the only differences from the GAP-024 measurement are one branch in
  `workspaces/adapters/postgres/personalization.ts` that flaps between 80.8% and
  81.3% on identical code), `build`, and the `Dockerfile.api`, `Dockerfile.web`,
  and `Dockerfile.gateway` image builds. The three-browser E2E matrix passed 158
  of 171 flows with 2 skipped and failed 11: the eight tracked by `REL-032` and
  `REL-033` as at the Phase 0 checkpoint, plus `app-003b` on Chromium and WebKit
  and `app-007b` on WebKit, all three tracked by `REL-039` (`app-007b` passed
  three WebKit repeats alone on the same commit). Route surfaces now live in
  each module's `transport/http/` and the HTTP kit in `packages/http-kit`; the
  next ticket, GAP-025, needs the product owner's decision on the UI stack
  before it starts.
- Phase 4 ran under ADR 0006 (shadcn/ui in React islands), and GAP-039 and
  GAP-040 from Phase 6 ran in parallel and are integrated too. The CI workflow
  runs on every push to `main`; the first-run Linux faults and the E2E
  intermittents found on the way are fixed as `REL-032`, `REL-033`, and
  `REL-039` through `REL-045` (`REL-034`, `REL-035`, `REL-036`, and `REL-038`
  stay parked). On 2026-09-26 the product owner removed AI assistance (GAP-054,
  DG-08) from scope and paused the plan after REL-045; it resumed the same day
  with `REL-046` and GAP-030. GAP-041 from Phase 6 is integrated too.
- Phase 4 of that plan (GAP-025 through GAP-033, under ADR 0006) is integrated
  at `84ed13bd`, and GAP-034 and GAP-035 from Phase 5 at `f37d444`. Every
  application surface is now a React island or static Astro, public pages ship
  no React, and no production module outside `components/ui/` builds DOM with
  `document.createElement`.
  - Local checkpoint on `84ed13bd`: root `check` and root `test` passed (1,299
    vitest, 844 Deno tests including integration 130/0 and the gateway
    log-capture fixture). The GAP-033 candidate passed `test:coverage` (every
    set above its floor, web 98.64/95.38/99.43/99.86), `contracts:check` (123
    documented, 126 mounted), `check:architecture` (14 baseline entries,
    unchanged), and `build` (14 web-build tests).
  - Main CI on `84ed13bd` passed every job but one WebKit flow, `app-008b`,
    parked as the `REL-054` watch.
  - Main CI on `f37d444` passed every job: static gates, unit and coverage,
    PostgreSQL integration, schema, the api, web, and gateway images, and the
    three-browser E2E matrix (169 passed, `perf-001`'s two own skips).
  - `REL-047` through `REL-054` were found on the way; `REL-048`, `REL-050`, and
    `REL-051` are fixed, and `REL-047`, `REL-049`, `REL-052`, `REL-053`, and
    `REL-054` stay parked. The next work is GAP-036 and GAP-037, then the Phase
    5 checkpoint.
- Phase 5 (GAP-034 through GAP-037) and Phase 6 (GAP-039 through GAP-043) are
  integrated, and so are GAP-044 through GAP-047 from Phase 7, up to `534c3f1`.
  The optional GAP-038 is skipped.
  - The checkpoint ran locally on `534c3f1`, a clean copy of main that trusts
    the session proxy CA only for its image builds. Everything passed:
    - `test:unit` and `test:coverage`, with every set at or above its floor (web
      at 98.69/95.61/99.45/99.86);
    - `test:integration`: 196 passed, 0 failed;
    - the api, web, and gateway production images;
    - the three-browser E2E suite: 184 passed across 62 Chromium, 62 Firefox,
      and 62 WebKit tests, with `perf-001`'s two own skips;
    - `test:schema:matrix` on PostgreSQL 18.4 and 17.10 for schema v8.
  - Main CI could not confirm it. From `9766905` on, every push fails within
    seconds without being given a runner, which points to the repository's
    GitHub Actions account rather than the code. The product owner accepted
    local gates as the checkpoint evidence, and CI confirmation stays owed.
  - `REL-055` through `REL-060` were found on the way and stay parked. The next
    work is GAP-048 through GAP-053, then the Phase 7 checkpoint.
- User-directed follow-up: responsive person blocks, focus-border repair, then
  an evidence-backed application repair plan and execution in a clean task.
- Remaining repair statuses and execution order belong to the
  [application repair plan](application-repair-plan-2026-09-05.md). **APR-001
  through APR-005** preserve unsaved drafts, coordinate local editors, provide
  fact-load retries and accessible mobile dialogs, and keep authenticated use
  recoverable when browser storage is unavailable. **APR-011** connects the
  existing API-token/DAV aggregate gates; `REL-030/031` track unrelated
  aggregate gate failures. **APR-006** makes profile summaries and counts
  truthful. **APR-007** compacts the mobile header and corrects shared
  stylesheet ownership. **APR-008** applies saved person-name and sort
  preferences. **APR-009** applies consistent locale/time-zone presentation and
  explicit calendar-date semantics. **APR-010** honors the saved fluid-layout
  preference. All 11 repair candidates are independently reviewed and accepted;
  the repair plan records the completed affected integration verification. Full
  repository aggregate acceptance remains blocked by the unrelated failures
  tracked by `REL-030/031`.
- **Phase 12 is accepted.** `REL-029` is delivered; `REL-020` and `REL-025`
  remain watches. Phase 11's `OPS-001E` deployment work stays parked until
  explicitly requested.
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

- [x] **REL-030 — Repair planning unit-gate environment permissions.** The
      APR-011 root test checkpoint passed the newly connected API-token/DAV
      gates, then failed while importing `apps/worker/composition_test.ts`:
      `readable-stream` requires `READABLE_STREAM`, which `test:unit:planning`
      does not allow. One focused reproduction fails identically; the task and
      worker code are unchanged from the accepted pre-APR-011 base. Correct the
      owning permission contract with a focused regression. This separate
      reliability item blocks a green aggregate checkpoint, not the bounded
      application repair candidates. Delivered by GAP-001 (`22b98309`):
      `test:unit:planning` grants the worker runtime environment and a contract
      test proves root `test` reaches every unit gate with sufficient
      permissions.

- [x] **REL-031 — Investigate intermittent Astro readiness under coverage.** The
      APR-011 root coverage checkpoint finished 538 tests and 22 steps, then
      failed the unchanged canonical Astro-child probe's 30-second
      page-readiness deadline. Its direct coverage command, probe, and public
      page are unchanged from the accepted base. One isolated reproduction under
      coverage passes in 17 seconds, and the root unit run also passed this
      probe. Track the deadline failure separately; do not weaken readiness or
      repeatedly rerun the aggregate to hide it. The disposable PostgreSQL
      project was cleaned. Delivered by GAP-002 (`0baefd91`): readiness is
      measured from the child's own listener signal, one probe request may use
      the remaining page budget, and `deno task test:repro:astro-readiness` runs
      the probe under coverage three times.

- [x] **REL-032 — Person workspace due-state E2E assertions no longer match the
      rendered summary.** The Phase 0 checkpoint on `08680601` ran the full
      three-browser E2E matrix: `tests/e2e/app-003c.spec.ts:229` expects
      `#person-profile-due-state` to contain "0 open tasks" but receives "Not
      set", and `tests/e2e/app-008c.spec.ts:173` expects "1 open task" but
      receives "Every 1 month", identically on Chromium, Firefox, and WebKit. No
      path under `apps/`, `packages/`, `tests/e2e/`, Compose, or the Dockerfiles
      changed between `f9f847ff` and `08680601`, so the mismatch predates
      GAP-001 through GAP-005; the block now renders the contact cadence, which
      points at the person-section chrome and summary work in `14d8ed2a` and
      APR-006. Decide whether the specs or the block are stale and fix the
      owning side with a focused test. The specs were stale because APR-006
      (`3abb45fe`) deliberately made the hero's Stay in touch slot show only the
      cadence or "Not set" and updated `app-004c` but not these two flows, so
      they now assert the cadence there, the next reminder in its vital, and the
      open tasks in the tasks section.

- [x] **REL-033 — Two Chromium E2E flows fail deterministically.** In the same
      checkpoint and again in an isolated Chromium rerun,
      `tests/e2e/app-009a.spec.ts:99` ([IMPORT-001]) never sees "Monica JSON
      version 1 detected." after the dry run, and
      `tests/e2e/auth-002.spec.ts:521` ([AUTH-002]) fails at
      `inviteeContext.close()` because the invitee context is already closed.
      Both flows pass on Firefox and WebKit. Same causality proof as REL-032: no
      product or spec code changed in Phase 0. Reproduce with
      `deno task test:e2e tests/e2e/app-009a.spec.ts tests/e2e/auth-002.spec.ts --project=chromium`.
      The import page was wrong: it bound the file input's `change` listener
      only after the session and preferences requests resolved, and Chromium's
      trace shows `setInputFiles` finishing before those requests did, so the
      page now also detects a file already chosen when it mounts. The members
      page was wrong too: the close error followed a timeout on a replacement
      invitation whose early click the trace shows as a native
      `GET /app/settings/members?email=…` before the submit listener existed, so
      the listener now binds before any await and sends the invitation once the
      page has loaded.

- [ ] **REL-034 — Astro child exits before readiness with a libuv assertion on
      Windows.** Root `deno task test` on `08680601` failed "E2E canonical Astro
      child remains live outside CI" once: `deno task dev:web` exited with code
      0 after 17 seconds and the post-test output carried
      `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`.
      The same probe passed in the following root `test:coverage` run and in an
      isolated `deno task test:unit --module=api` rerun. This is a different
      failure from REL-031, which GAP-002 closed: the child dies instead of
      starting slowly. Track it; do not loosen readiness. Recurred once on
      2026-09-17 during the GAP-012 verification: the same probe failed in the
      first root `test:unit` (`deno task dev:web` exited with code 0 before
      readiness), then passed in an isolated `tools/e2e_test.ts` run and in the
      full rerun; the candidate touched nothing under `apps/web` or
      `tools/e2e.ts`.

- [ ] **REL-035 — Raise the pinned dependencies past the accepted moderate
      advisories.** `deno task deps:audit` (GAP-003) reports five moderate
      advisories and no high or critical ones: three in `hono` < 4.13.5 (the
      repository pins 4.13.1), plus `stream-json` <= 3.4.0 and
      `decode-uri-component` <= 0.4.2, both transitive through `minio`. GAP-004
      records them as an explicit exception in
      `docs/architecture/quality-gates.md` and gates CI at high severity only.
      Bump `hono` and re-resolve the `minio` graph under the frozen lockfile and
      the 72-hour minimum dependency age, then shrink the exception; the Hono
      contract suites and `deno task test:contract` are the focused gates.

- [ ] **REL-036 — An Astro dev child survived the readiness probe's cleanup
      once.** During the GAP-002 verification on 2026-09-15 a
      `node …/astro/bin/astro.mjs dev --root apps/web --ignore-lock` process
      started at 14:47:55 outlived its `deno test` parent, kept listening on
      127.0.0.1:33826, and held the `.worktrees/GAP-002` directory open until it
      was stopped by hand. Its parent had already exited, so `stopOwnedProcess`
      either never ran for that child or terminated a process tree that no
      longer contained it. The probe's own suite and
      `deno task test:repro:astro-readiness` were green at the time, and the
      leak did not recur in the later GAP-003 through GAP-005 runs. Reproduce by
      running the canonical probe under load and listing surviving
      `astro.mjs dev` processes afterwards; if it recurs, make the cleanup
      re-read the process tree before termination and assert absence of every
      listener the child bound.
- [x] **REL-037 — The `gifts` coverage set sits under its branch threshold on
      `main`.** `deno task test:coverage --module=gifts` fails at `2bf0de36`
      with branch 78.6% against the set's 80% floor (`apps/api/gifts.ts` 72.3%,
      `gifts/application/gift_management.ts` 83.0%, lines 91.2%, functions
      100%). The set passed at the Phase 0 checkpoint (`08680601`); nothing has
      touched `apps/api/gifts.ts` since, and the only changes to the measured
      files are the GAP-007 and GAP-009 rewrites of `gift_management.ts`, which
      moved the aggregate branch weight under the floor rather than removing any
      test. Found on 2026-09-17 while verifying GAP-011, whose diff touches
      neither measured file and reproduces the identical numbers. Root
      `test:coverage` stops at this set, so the sets ordered after it were
      verified one by one and pass. Fix by covering the untaken branches of
      `apps/api/gifts.ts` in the gifts unit suite, not by lowering the floor.
      Delivered 2026-09-17: five route tests in `apps/api/gifts_test.ts` cover
      the origin, validation, session, creation-failure, and status-mapping
      branches; `apps/api/gifts.ts` is at 92.2% branch and 100% line, the set at
      87.3% branch, and root `test:coverage` runs to completion again. No
      production file or threshold changed.
- [ ] **REL-038 — The `lifecycle` coverage set is not perfectly deterministic.**
      During the GAP-018 verification on 2026-09-17 one of four runs of
      `deno task test:coverage --module=lifecycle` measured
      `identity/adapters/postgres/personal_lifecycle.ts` at 83.3% branch and
      85.7% line instead of 100% and 98.4%, taking the set to 84.5 / 92.5 / 93.2
      against its usual 85.6 / 94.3 / 94.1, and the reviewer's own run saw 75.0%
      branch on the same file. The set stayed above its 80% floor, so no gate
      failed, but a reviewer comparing against the previous measurement sees a
      spurious drop. The candidates touched nothing in that adapter; the
      variance points at a timing-sensitive path in
      `tests/integration/personal_lifecycle_postgres_test.ts` that sometimes
      skips a branch. Reproduce by running the set several times and diffing the
      per-file lines; fix by making the affected test deterministic, not by
      widening the floor.
- [x] **REL-039 — `app-004a` and `app-003b` fail intermittently in the Chromium
      E2E under host load.** During the GAP-024 verification on 2026-09-23 two
      full Chromium runs of the candidate failed `app-004a` (`[PEOPLE-004]`, the
      delete dialog never opened after `Delete person` was clicked at
      `app-004a.spec.ts:224`) and `app-003b` (`[PEOPLE-002]`, the search dialog
      and command palette at lines 270, 298, and 312) beside the four parked
      specs, and one run also failed `app-002c`. None of the steps sends an API
      request. `app-003b` failed on `main` when run alone at the same line 298,
      and the same session's full `main` runs passed both specs. Three repeats
      of the two specs passed `app-004a` 3/3 on the candidate while `app-003b`
      passed 2/3, and the candidate changed only import paths in the routes
      those flows use. The likely cause is a click before the island's handler
      attaches (the spec follows the person link and opens the person menu
      without waiting for hydration). Reproduce with
      `deno task test:e2e --project=chromium
      --repeat-each=5 tests/e2e/app-004a.spec.ts tests/e2e/app-003b.spec.ts`
      on a loaded host; fix by waiting for the surface's ready marker in the
      spec or making the control inert until it is wired, not by adding retries.
      The Phase 3 checkpoint matrix on `6c915aa6` failed `app-003b` on Chromium
      and WebKit and, in the same class, `app-007b` ([GIFTS-001]) on WebKit at
      `app-007b.spec.ts:108`: the gift form kept its filled name after `Save`
      with no error shown, so the click never reached a wired handler.
      `app-007b` then passed three WebKit repeats alone. Include it in the
      repeat command above with `--project=webkit`. The global people search
      bound every listener only after its session and preferences reads and the
      person page wired its lifecycle actions only after the person loaded, so
      the search now binds before any await, renders a queued or pre-typed query
      once ready, and hands `Log interaction` to Quick capture only once that
      opener is wired, the person menu toggle and lifecycle actions ship
      disabled until their handlers attach, and the relationships section
      announces its state on an archived person without the scrolling `focus()`
      that moved the page under Firefox's pending `Restore person` click
      (`app-004a`, `app-004d`); the Linux WebKit `app-002c` failure was the
      still-disabled Quick capture being skipped by Tab, now awaited in
      `app-002c` and `auth-003`, `app-004c` replayed the upstream Content-Length
      with a longer rewritten "archived" body, and `app-003c` now scopes "No
      tags saved" to the hero's tag list.
- [x] **REL-040 — The first GitHub Actions run fails on two Linux-only tooling
      paths.** Run `36151735884` on `a22818fe`, the workflow's first run on the
      ubuntu runners, found two faults the Windows developer machine never
      exercises. The unit job failed `tools/e2e_test.ts` "E2E canonical Astro
      child remains live outside CI" with `Requires run access to "ps"`: off
      Windows the launcher's process-tree helpers spawn `ps` to inspect and
      `kill` to terminate, but the `api` unit and coverage sets granted only
      `deno` and `powershell`. The E2E job stopped before any flow with
      `Docker reassigned the inspected gateway port.`: the launcher created the
      stack, started the gateway alone to learn its Docker-assigned port, then
      rebuilt the environment with that origin and ran `compose up`, which on
      Linux recreated the gateway under the changed configuration on a new
      ephemeral port. Delivered 2026-09-25: `tools/e2e.ts` exports
      `E2E_PROCESS_BINARIES`, which both sets now grant and which a
      `manifest_test.ts` regression and a launcher source scan keep equal to
      what the launcher spawns and to the `test:e2e` grant. The launcher now
      chooses the gateway host port from a released loopback listener before any
      container exists, passes it as `E2E_GATEWAY_PORT` in the one environment,
      starts the stack with one `compose up --build --wait`, and fails clearly
      if the gateway is published anywhere else. `compose.test.yaml` maps
      `127.0.0.1:${E2E_GATEWAY_PORT:-}:8443`, so the PostgreSQL gate and the
      other overlay consumers, which leave it unset, keep a Docker-assigned
      port; the production `compose.yaml` mapping is unchanged.
- [x] **REL-041 — Forms submitted before their handler fall back to a native
      GET.** REL-033 found the members page's invitation form submitting
      natively as `GET /app/settings/members?email=…` because its listener bound
      only after the session and member reads, which put the invitee's email in
      the URL, browser history, and the `Referer` header. On `823f8a07` 33 of
      the 37 `<form>` elements in `apps/web/src/**/*.astro` declared no method,
      and the page modules for API tokens, DAV integrations, person creation,
      the people directory, import, storage lookup, and the leave-workspace and
      delete-identity forms (with the current password) still bound their
      `submit` listener after an await. Delivered 2026-09-25: every form now
      declares `method="post"`, except Quick capture's `method="dialog"` and the
      three `method="get"` audit and activity-report filters, whose fields are
      opaque IDs, an action name, and dates. The gateway answers a POST to a
      static path with 405 and logs only the method, route template, and status;
      the two on-demand auth pages (`/auth/mfa`, `/auth/reset-password`) reach
      the private renderer, which never reads a request body.
      `form-method-contract.test.ts` fails on any form without a method, on a
      GET form outside that allowlist or carrying a personal field, and on a
      script-created form without `method = "post"`. `lib/early-submit.ts` binds
      a form's submission before the first await and replays the latest early
      one once the page is ready, used by the create, search, and import forms;
      the directory lets its first load serve an early search and keeps a search
      typed while it loaded. The two password forms start disabled and drop an
      early submission until the current impact is shown, the export action and
      the tasks page's `Add task` start disabled until their clicks are wired,
      the personalization create form stays hidden until its section loads, and
      the invitation actions appear only once their token handoff is wired. Each
      change has a focused test that acts before the page is ready.
- [x] **REL-042 — A spec's own navigation interrupts the app's still-loading
      page on Linux WebKit.** Run `36160197116` on `823f8a07` failed `app-004b`
      (`[PEOPLE-005]`, `app-004b.spec.ts:110`) and `app-004c` (`[PEOPLE-006]`
      APR-001, `app-004c.spec.ts:1325`) on WebKit with "WebKit encountered an
      internal error" from `page.goto`. The preceding `toHaveURL` passes as soon
      as the app's own navigation commits, so the spec's `goto` interrupted a
      document that was still loading; Chromium and Firefox tolerate that, Linux
      WebKit does not. Delivered 2026-09-25: `tests/e2e/support/navigation.ts`
      exports `settleNavigation(page)`, which waits for the current document's
      `load` event, and a scripted search for an app-driven navigation or
      `toHaveURL` followed by a spec `goto` or `reload` with no page wait
      between placed it at every such site: `app-002c`, `app-003b`, `app-004b`,
      `app-004c` (two), `app-004e`, `app-005b`, `app-005c`, `app-006a` (two),
      `app-006b` (two), and `auth-003` (two). No assertion changed and no retry,
      sleep, or timeout was added.
- [x] **REL-043 — Test fixtures leave the images they build behind.** The
      REL-040 and REL-039 implementers each found about 1,900
      `kinship-e2e-<pid>-<ts>-*` images on the developer machine with no
      container attached. `tools/e2e.ts` removed its own five images at
      teardown, but the Compose readiness fixture in
      `tools/gateway_log_capture_test.ts`, which the `gateway` set runs in every
      root `test:unit`, ran `compose up --build` under its own `kinship-e2e-*`
      project and tore down only containers, volumes, and networks. It is the
      only fixture that builds under a per-run project: the PostgreSQL gate, the
      object-storage and schema fixtures start only pinned images, and
      `tools/dev.ts` builds under the fixed development project. Delivered
      2026-09-25: `tools/e2e.ts` exports `removeE2eImages` and
      `assertE2eProjectAbsent` over one Docker runner, which the launcher now
      uses, and `tearDownE2eComposeProject`, which runs `compose down`, proves
      the project absent, and removes exactly that run's five images, each step
      even after an earlier one fails. The fixture's teardown calls it, and two
      `e2e_test.ts` regressions prove it removes only the run's images after a
      failed `down` and fails when one remains. The leftover images were not
      removed.
- [x] **REL-044 — Spec helpers end on an app navigation their callers then
      interrupt.** Linux CI run 36182979003 on `bf572f3e` timed out in
      `app-004b.spec.ts:92` (`[PEOPLE-005]`) on WebKit waiting for "Given name"
      to become editable: the spec's `signIn` helper returns once
      `toHaveURL(/\/app$/)` passes at commit, and the caller's
      `goto("/app/people/new")` interrupts `/app` while it is still loading.
      REL-042 settled the call sites inside test bodies but not the helpers. The
      eleven helpers that end on an app navigation (`signIn` in `app-002e`,
      `app-003a`, `app-003b`, `app-003c`, `app-004a`, `app-004b`, `app-004c`,
      and `auth-002`; `createPerson` in `app-004d` and `app-005a`;
      `keyboardFinishSignOut` in `auth-003`) now call `settleNavigation` before
      returning.
- [x] **REL-045 — Clicks land before, or beside, the handler they were aimed
      at.** Linux CI run 36208299565 on `2048ff98` failed `auth-002.spec.ts:216`
      (`[AUTH-002]`): `Accept invitation` was clicked before the page had even
      asked for the session, although REL-041 keeps `#invitation-actions` hidden
      until its handlers attach, because `auth.css` gave `.invitation-actions`
      `display: grid` and, unlike `base.css`, no rule that lets `hidden` win.
      Run 36222291227 on `781bb1c5` failed `app-007a.spec.ts:85` (`[FILES-001]`,
      the upload form never opened after `Attach document`), run 36225990339 on
      `0855ba9c` failed `app-005c.spec.ts:146` (`[GOVERNANCE-002]`,
      `Open full audit history` never navigated) on WebKit, and a local WebKit
      run of the GAP-040 candidate failed `app-004c.spec.ts:319` (`[PEOPLE-006]`
      APR-006, the reminder form never opened). In the person-page traces the
      page scrolls under the click: the workspace animated its `?section=`
      placement through the document's smooth scrolling and, once every zone
      settled, animated it again, moving a section the reader could already see
      while the pointer was down. Delivered 2026-09-26: `auth.css` hides every
      `[hidden]` element, and a stylesheet test proves no auth page displays an
      element its markup hides; a deep link now jumps to its section instead of
      gliding, the settled pass leaves a visible section where it is and jumps
      back to one that drifted out of view, and a section the reader picks still
      glides; and the tasks page wires `Retry tasks` before showing it when its
      own session read fails. An audit of the person-page modules and the
      settings, journal, tasks, and compliance pages found no other control
      visible and enabled before its handler across an await. No spec changed.
- [x] **REL-046 — Linux WebKit loses clicks to a gliding page and stalls after a
      spec leaves a person page early.** Each recent main run failed one WebKit
      flow. Run `36225990339` on `0855ba9c` failed `app-005c.spec.ts:146`
      (`[GOVERNANCE-002]`, already recorded under REL-045) and, on its second
      attempt, `app-004c.spec.ts:1597` (`[PEOPLE-006]`, "Clicking the checkbox
      did not change its state" on `Primary for this contact type`); run
      `36242267071` on `3210bd20` failed `app-004d.spec.ts:67`
      (`[RELATIONSHIP-001]`, `Save person` never left `/app/people/new`) and, on
      its second attempt, `app-004c.spec.ts:808` (`[PEOPLE-006]` APR-003, the
      pets `Retry` never became disabled). In the three click traces the
      document scrolls between Playwright's pointer retries with no DOM change
      (`2016` to `501`, `428`, `837`, and `889`; `622` to `71`, `213`, and
      `549`): `base.css` gave the document `scroll-behavior: smooth`, which
      turns every focus reveal and every `scrollIntoView` without an explicit
      behavior, including Playwright's retry scrolls, into a glide, so each
      retry aimed at a control still moving and the last click landed off it.
      REL-045 removed the workspace's own deep-link glide that set off the
      audit-history retries, not the glide under them. In the `app-004d` trace
      the save handler did run (`Saving person…`, `POST /api/v1/people` sent)
      but neither it nor the page's session and preference reads were ever
      answered, while `Quick capture` waited on that session; the helper's
      `goto` had left the previous person page while its section code and
      deferred view record were still loading, and cancelling them was the last
      network activity before the stall. Delivered 2026-09-26: the application
      document no longer scrolls smoothly, and a stylesheet test keeps it so;
      the one glide the workspace keeps, a section the reader picks, asks for it
      from script and jumps under reduced motion. The workspace marks
      `data-workspace-settled` once its first sections have answered and its
      view is recorded, `support/navigation.ts` exports `settlePersonWorkspace`,
      and the `createPerson` helpers in `app-004d` and `app-005a` wait for it
      before leaving. No assertion changed and no retry, sleep, or timeout was
      added.
- [ ] **REL-047 — Web unit tests near the 5-second limit time out under machine
      load.** On 2026-09-26, while Docker builds and a second vitest run shared
      the machine, `apps/web/src/features/person/facts/fact-editor.test.tsx`
      timed out in one to five of its
      `APR-003 locks add/edit during post-save
      Retry…` cases (about 1.8 s
      each when idle) and `apps/web/src/lib/people-profile.test.ts` timed out in
      its first case (`APR-008 applies membership name order…`, 2.4 to 2.8 s
      cold). The same timeout reproduced on `main` at `f18ff843` without the
      GAP-030 changes, so it predates them. CI has not failed on it yet. Next
      step: find what makes these cases slow (real timers, repeated full
      re-renders, or cold imports) and make them fast rather than raising the
      timeout.
- [x] **REL-048 — Today's attention queue can stay loading after its read
      answered.** Main CI run `36271395679` on `a88429c` (GAP-041, which changed
      no web code) failed `app-006c.spec.ts:484` (`[TODAY-001]`) on Chromium
      only: after the spec's one-time 503 for `/today/favorite-notes` and
      `goto("/app")`, "Needs attention" and "Upcoming" stayed on their loading
      status and the `Complete` control for "Plan Ada's call" never appeared.
      The trace shows `GET /today/attention` answered 200 in 173 ms, but the
      member-preferences read `mountTodayAttention` (`lib/tasks.ts`) sends after
      it was never issued, and no page error was recorded; the same page's
      reconnect, favorite-notes, and recent-activity regions rendered. The spec
      passed on Firefox and WebKit in the same run, on the GAP-041 PR run, in a
      full local Chromium run, and 10 of 10 local Chromium repeats on `a88429c`.
      The module keeps several operation ids, region owners, and cross-mount
      maps for one surface, the pattern `AGENTS.md` warns against; GAP-033
      replaces it with one island and one read slot, and its candidate must
      include a test that an answered attention read always settles the queue.
      This session could not rerun the job (the integration token is refused
      rerun and dispatch), so the next push to `main` is the rerun. Delivered
      2026-09-27 by GAP-033: the attention queue is one island with one read
      slot and a pure reducer in which every read settles every region it marked
      loading, proved by a reducer test over every read sequence and an island
      test with a failed preferences read and a superseded first read; every
      main run since passed `app-006c` on all three browsers.
- [ ] **REL-049 — "Set a stay-in-touch cadence" never opens the cadence
      editor.** Found reviewing GAP-031: the first-run action in
      `lib/people-profile.ts` targets the cadence field inside
      `[data-cadence-form]`, which `StayInTouchSection.astro` draws `hidden` and
      nothing un-hides before the action runs, so the action returns at
      `control.closest("[hidden]")` and focuses nothing, before and after
      GAP-031. Fix by aiming the action at the block's add control
      (`[data-cadence-add]`) so it opens the editor, with a focused test and the
      `app-006b` flow unchanged.

- [x] **REL-050 — Specs still leave a person workspace they just reached before
      it settles.** Main CI run `36276307459` on `9aa51fc` (a documentation-only
      commit) failed `app-004e.spec.ts:407` (`[WORKSPACE-003]`) on WebKit with
      "WebKit encountered an internal error" from `page.goto`: the spec saved a
      new person and navigated again once the arrival page's `load` event fired
      (`settleNavigation`, REL-042), while that workspace was still loading
      section code and reading, the state REL-046 found Linux WebKit mishandles.
      REL-046 made only the two `createPerson` helpers wait for
      `data-workspace-settled`. The same run's Chromium `app-006c` passed, as
      REL-048 expects. Delivered 2026-09-26: a scripted search for a
      `settleNavigation` that leaves a person workspace the spec just reached
      found six sites; four (`app-003b`, `app-004e`, `app-006a`, `app-006b`) now
      wait with `settlePersonWorkspace`, and the two in `app-004b` and
      `app-004c` keep `settleNavigation` because they deliberately hold a
      section read open across that navigation, so that workspace never settles
      by design. No assertion changed and no retry, sleep, or timeout was added.
      The four specs passed on Chromium and WebKit, twice each.

- [x] **REL-051 — The important-dates island lost Firefox's focus ring, and more
      specs left a person workspace mid-load.** Main CI run `36278743014` on
      `2f49606` (GAP-031) failed two `app-004c` flows. On Firefox,
      `app-004c.spec.ts:669` (`[PEOPLE-006]` APR-004) found no 2 px focus
      outline on the important-dates sheet's `Cancel` after a keyboard open; it
      reproduced locally every time. The vanilla module focused the date type
      field inside the add button's click, while the island only queued its
      `open` action there, so the field took focus after the click and Firefox,
      which draws a script focus ring only while it handles the keyboard input
      that asked for it, stopped matching `:focus-visible` for that focus and
      the spec's later one. On WebKit, `app-004c.spec.ts:689` never saw "Given
      name" on `/app/people/new`: its loop left the person it had just created
      mid-load, the REL-046 and REL-050 class. Delivered 2026-09-27: the island
      commits its `open` with `flushSync`, so the field is focused inside the
      opening click again, with a unit test that fails without it; a scan for a
      person arrival followed by a spec `goto` or `reload` added
      `settlePersonWorkspace` at seven more sites (`app-003a` two, `app-004a`,
      `app-004c` two, `app-005b`, `app-005c`), leaving the sites that
      deliberately hold a section read open. No assertion changed and no retry,
      sleep, or timeout was added. `app-004c` in full with the touched specs
      passed 12 of 12 on each of Firefox, WebKit, and Chromium; web tests 1,043.

- [ ] **REL-052 — Lazily mounted person sections can lose their status live
      region.** Found reviewing GAP-033: `promoteSectionStatusRegions` in
      `features/person/workspace.ts` gives each section's `.section-state` line
      `role="status"` once, when the workspace settles, but the files, gifts,
      reminders, and audit-summary islands render that line only when their zone
      activates. A zone opened after settle therefore announces "File uploaded."
      or "Removing file…" without a live region; the vanilla modules' static
      line kept it. Fix by having each island render its own status line with
      `role="status"` (and `aria-live="polite"`) from its first commit, checking
      that no spec's `getByRole("status")` becomes ambiguous, with a unit test
      per island and the affected specs unchanged.

- [ ] **REL-053 — A boundary test checks a file that no longer exists.** Found
      in GAP-034: "workspaces interaction boundary owns its actor and
      transaction types" runs `deno info` on
      `workspaces/application/interaction_workspace_boundary.ts`, which no
      longer exists, and `deno info` exits 0 for a missing module, so the test
      passes without checking anything. Point it at the file that now carries
      that boundary (or delete it if the boundary is gone and another test
      already holds the rule), and make the helper fail on a missing path so the
      class cannot recur.

- [ ] **REL-054 — Signing in with a pending legal version can outlast the spec's
      navigation window on Linux WebKit.** Main CI run `36294196846` on
      `84ed13b` (GAP-032, CSS only) failed `app-008b.spec.ts:127`
      (`[GOVERNANCE-001]`) on WebKit: after `Sign in` the page reached `/app`,
      and the shell's redirect to `/app/compliance?next=%2Fapp` committed just
      after the 5-second `toHaveURL` window closed. The flow passed on WebKit in
      the two previous main runs on the same island code. The member makes two
      sequential page loads before seeing the review. Watch: if it recurs, fix
      the product side so a sign-in whose session reports a required legal
      acceptance navigates straight to `/app/compliance?next=…` instead of
      loading Today first, with a unit test; never by lengthening the timeout.

- [ ] **REL-055 — The life-events "Add life event" button stays enabled during a
      save.** Found reviewing GAP-046: the section header's button sits outside
      the editor form and is not locked by `rowControlsDisabled`. If a member
      opens a new editor while a save is in flight and accepts the discard
      prompt, the late `saved` answer closes the fresh editor. Disable or hide
      the button while `state.editor?.busy`, with a reducer or island test.

- [ ] **REL-056 — Avatar files have gaps in their removal paths.** Found
      reviewing GAP-045: - The generic
      `DELETE /people/{personId}/files/{fileId}` removes an avatar-kind file.
      The avatar row keeps pointing at the soft-deleted file, and only
      `files.file-removed` is audited. The read side does fall back to initials.
      - A quarantined avatar has no removal path, because file listings leave
      out the `avatar` kind. - If the person is archived, or the member revoked,
      between storing and linking a replacement, the new image's discard fails
      and leaves an orphaned file. - Unaudited avatar reads are documented only
      in `file_rules.ts`.

      Fix: refuse the `avatar` kind in the generic remove, give quarantined
      avatars a removal path, make the discard independent of the person
      state, and record the read exception in the FILES-001 flow or the
      architecture docs.

- [ ] **REL-057 — The legal-acceptance spec disturbs concurrent E2E specs.**
      Found in GAP-045's full local E2E run with three workers:
      `legal-acceptance.GOVERNANCE-001` publishes an active legal document. At
      that moment IMPORT-001 answered `legal_acceptance_required` (403), and
      JOURNAL-001 and AUTH-002 failed too. All of them pass alone. Isolate the
      spec's legal document from other specs' workspaces, or run it in serial
      mode, without adding retries or longer timeouts.

- [ ] **REL-058 — The concurrent-leave test covers only whichever order wins.**
      "AUTH-005 concurrent leave preserves a final active owner"
      (`tests/integration/personal_lifecycle_postgres_test.ts`) races two leave
      requests, so `personal_lifecycle.ts#revokeSessions` runs only when one
      particular member wins. The `lifecycle` coverage set moves between runs
      (functions 93.8% or 91.7%). Cover both orders deterministically.

- [ ] **REL-059 — Failed email reminders never reach Today's attention queue.**
      Found reviewing GAP-044: `today_attention_repository.ts` filters
      `channel = 'in_app'`, so an email-only member's `failed` and
      `manual_attention` email occurrences are missing there. They still show in
      the Today reminders list and on the profile. Include email delivery
      failures in the attention queue, or record the product decision not to.

- [ ] **REL-060 — A digest's attempt key outlives a failed attempt.** Found
      reviewing GAP-044: `markAttempted` stores the digest key in
      `reminder_occurrences.provider_receipt`, and `finalize` keeps it on
      `rejected` and `manual_attention` rows. The column comment describes a
      receipt after confirmed delivery or reconciliation. Nothing misreads it
      today. Clear it on those outcomes, or document the attempt-reference
      convention in the flow.

- [ ] **REL-061 — Search needs full-text indexes at scale (schema v9).** At
      50,000 notes and 50,000 activities per workspace, the text groups of
      `GET /api/v1/search` scan every row and reach GAP-048's 1.5 s statement
      bound, so they answer "temporarily unavailable". A client abort does not
      cancel the query on the server. The product owner deferred the fix to a
      synchronized schema v9 that adds GIN expression indexes on
      `to_tsvector('simple', …)` for `notes`, `activities`, `journal_posts`, and
      `tasks`, with the search SQL using the same expressions. Schedule it after
      Phase 7 or when real data volumes demand it.

- [ ] **REL-062 — A search test checks the wrong pool for timeout leaks.**
      `tests/integration/search_postgres_test.ts:531-537` runs
      `show statement_timeout` on eight connections of the helper's separate
      client, not `connection.db`, the pool that ran the transaction-local
      bound. There is no leak today, because the bound is transaction-scoped.
      Run the parallel check through `connection.db`.

- [ ] **REL-063 — A merged duplicate's unused avatar image is never reclaimed.**
      Found reviewing GAP-049: when the primary keeps its own avatar, the
      duplicate's image stays on the primary as a hidden avatar-kind file link.
      Nothing lists it, so its bytes can never be removed. Discard it after the
      merge commits, through the files facade, as avatar replacement does (see
      `REL-056`).

- [ ] **REL-064 — A false duplicate pair can never be dismissed.** Found
      reviewing GAP-049: two genuinely different people with the same name, or
      sharing a phone number, stay in the directory's duplicates review forever.
      Let a member mark a pair "not duplicates". Where that decision would be
      stored needs a product and schema decision first.

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
  framework. Superseded on 2026-09-23 by
  [ADR 0006](../architecture/decisions/0006-ui-stack-shadcn-react-islands.md).
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

- [x] **REL-013 — Keep section navigation authoritative over a concurrent
      refresh.** The Tags step failed roughly three times in eight runs, leaving
      the URL on `?section=profile-modules`. The page reported "All changes
      saved.", so no unsaved-changes confirm was blocking, and the network trace
      showed the navigation had already fired its request before a later refresh
      of the current section followed it.
  - [x] `render()` carries a `requestGeneration` watermark and returns false
        when superseded, and the navigation handler pushed history only if that
        render won. Any refresh landing in the window cancelled the navigation
        silently, the same defect `UXD-006` fixed on the person page and the
        class `AGENTS.md` warns about when one surface has several async owners
        behind a watermark.
  - [x] Navigation now commits `current`, `currentIndex`, and history before
        awaiting the load. A failed load leaves the member on the requested
        section with its existing error state and Retry, matching how a
        `?section=` deep link already behaves on first load.
  - [x] The authoritative evidence is the deterministic unit reproduction of the
        race, not repeated browser runs: one green `app-004e` run sits inside
        the old pass rate and could not distinguish a fix from luck.
  - [ ] Still open from this investigation: `app-004e` cannot be run with
        `--repeat-each`, because its `E2E chromium companion category` fixture
        insert is not idempotent and collides on a unique name. That blocks the
        cheapest way to measure a flake in this spec.

- [x] **REL-014 — Walk the real header focus order in `auth-003`.**
      `tests/e2e/auth-003.spec.ts:265` skips the Journal navigation link exactly
      as `app-002c` did, so both sign-out tests fail. `REL-001` fixed the
      `app-002c` copy of this walk and missed this duplicate. Reproduced on
      clean `main`. Check every remaining spec for a third copy before closing.
- [x] **REL-015 — Stop announcing a standing constraint as an alert.**
      `getByRole('alert')` matched two elements on the settings profile page.
      The competing alert was the real defect, not the locator:
      `#lifecycle-blockers` states a standing condition rendered during load, so
      its `role="alert"` gave final-owner members an assertive interruption on
      page load, nested inside a region that already declares
      `aria-live="polite"`. Removing the role fixed the announcement and the
      ambiguity together.
- [x] **REL-016 — Send each security header exactly once.**
      `tests/e2e/auth-002.spec.ts:212` received `no-referrer, no-referrer`.
      nginx `add_header` appends to a proxied response, and the five on-demand
      Astro routes set their own headers, so the gateway doubled them. The audit
      found all seven gateway-owned headers exposed on four of the five
      renderer-proxying locations, not only the one the assertion caught.
      `tools/gateway_log_capture_test.ts` could never catch this because it runs
      the gateway with no renderer upstream, which is how the `OPS-001A` proof
      passed while real responses carried duplicates.

- [x] **UXD-001A — Raise `--ink-3` to meet AA on every surface.** The first
      full-suite sweep failed 22 of 44 tests, all on the axe contrast rule,
      every violating node carrying `#6b7a72`. That value is the one review
      §10.2 specifies, and it is below 4.5:1 on all five of its own surface
      tokens (3.60 to 4.44). The section whose purpose was fixing contrast
      specified one. Amended to `#5d6a63`, the smallest darkening holding hue
      and saturation that clears AA everywhere. Missed originally because
      `UXD-001` ran static and unit gates only, and computed contrast is visible
      to neither.
- [x] **REL-018 — Give the file sections their declared load mode.** The file
      branch of the person shell dropped `data-load-mode`, failing `app-003c`.
      The audit corrected the diagnosis: the attribute appears three times in a
      template rendering twenty-two sections, `life-events` hardcodes it, and no
      runtime code reads it at all. `UXD-002` should decide whether that tuple
      field is real metadata or dead weight.
- [x] **REL-022 — Repair the stale person-shell section assertion.**
      `deno task test:coverage:api` had been failing on `main` at
      `tools/gateway_contract_test.ts`'s `[APP-003C]` test since `UXD-002C`
      retired `data-load-mode` under `REL-018`. The test extracted the shell's
      sections with a three-field tuple whose last field was that retired value,
      so the regex matched nothing, `declared` was empty, and the comparison
      against twenty-two ids failed. Unnoticed because web candidates run web
      gates, not the API ones. Reproduced on clean `main` with the concurrent
      candidate stashed, so it was queued rather than folded into it. Extraction
      now reads the current tuple and refuses to pass on an empty result — a
      regex matching zero rows must never look like a passing extraction — and
      the companion assertion swaps the retired attribute for `data-zone`, the
      metadata that replaced it and is read at runtime.

- [x] **REL-021 — Give a lazily activated zone the current archived state.** The
      lazy zone mounts received `archived` as
      `result.value.status ===
      "archived"`, an expression frozen when
      `getPerson` resolved at initial load, and each module only corrected it
      from a later `person-lifecycle-changed` event. A module that mounted
      _after_ an in-page archive therefore started from the stale snapshot and
      never heard the event it missed, so an archived person could present
      enabled gift, file, task, or capture controls. Reachable since `UXD-003B`
      made `things` and `admin` activate on scroll: archive a person without
      scrolling, then scroll down. Diagnosed while integrating `UXD-005B`, whose
      first-run card made one instance visible to `app-004a`; that candidate was
      not expanded to repair it.
  - [x] **Correction to this leaf's own text.** It said four lazy mounts. There
        are five: `mountCommunications` passes the same argument and was missed,
        alongside `mountPersonInteractions`, `mountTaskSurface`,
        `mountPersonFiles`, and `mountPersonGifts`.
  - [x] One live value read at activation time, not a fifth listener per module
        and not a mirror variable in `people-profile.ts`.
        `mountLifecycleActions` already owns the only mutable archived state on
        the page and `people-profile.ts` holds the single
        `person-lifecycle-changed` dispatcher in the application — every other
        occurrence under `apps/web/src` is a listener. It now returns
        `() => state === "archived"`, and the registrations call it. A mirror
        would have been a second owner of a fact that already has one.
  - [x] The four eager rail mounts adopted the same reader even though they
        cannot observe the defect, because they run before any archive is
        possible. Leaving two different expressions for one fact is how this
        defect would survive the next edit; the frozen snapshot is now gone from
        mount wiring entirely. `renderReady` keeps its `status` parameter, which
        renders the load result rather than configuring a mount.
  - [x] The evidence is a deterministic unit reproduction, not a browser scroll.
        `stubDeferredZoneObserver` already existed for `UXD-003B`, so the test
        archives the person while `things` is unmounted, activates the zone by
        hand, and asserts the gift add control is hidden — after asserting it
        exists, since a query matching nothing makes a hidden-ness assertion
        pass while proving nothing. Without the fix it fails on
        `hidden === false`. No `tests/e2e/` spec was touched.
  - [x] Gates: `fmt:check` 580 files, `lint` 473 files, `check:web` 0 errors,
        496 web unit tests, `test:coverage:web` at 92.62/83.21/87.60/94.64, and
        the complete Chromium suite 44/44 with an empty `.artifacts/playwright`.

- [ ] **REL-020 — Watch the `app-002c` header keyboard walk.** One full-suite
      run during `UXD-002C` failed `keyboardReachMemberMenuToggle` at
      `tests/e2e/app-002c.spec.ts:127`: the brand link never took focus after
      the first Tab. The candidate touched neither the application shell nor the
      header, the same suite had passed that spec three times that day, and it
      passed again on the very next run with no change to that surface. Recorded
      rather than diagnosed, so a recurrence has a trail. This walk has been
      wrong twice before for real reasons — `REL-001` and `REL-014` — so treat a
      second occurrence as a stale walk before assuming flake.
- [x] **REL-019 — Gate settings forms until they are wired.** All three settings
      mounts awaited two sequential round trips, assigned values, and only then
      attached the submit handler, while the form shipped visible and enabled. A
      person could type into it and press Save: the input was overwritten and
      the click swallowed. Same class as the already-accepted `REL-007`, which
      had only been applied to the destructive lifecycle form.

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
- [x] **UXD-007B — Give the reminder and cadence editors the shared add-form
      pattern.** (§6.8, §7.7; effort M; split out of `UXD-007`; no dependency)
  - [x] The review asks only for the `hidden` attribute on the two always-open
        forms so all twenty-two behave identically. Adding the attribute alone
        would have stranded them: unlike the other twenty sections these two had
        no add button, and `reminders.ts` never toggled their visibility, so a
        hidden form would have been unreachable. The whole pattern shipped
        instead — add control, hidden form, cancel, focus.
  - [x] Each section took the shape of the column it lives in rather than a
        third convention. Reminders is a Planning stream card, so it gained a
        `button-primary` "Add reminder" between its list and its form, modelled
        on `data-communication-add`. Stay in touch is a rail block, so it gained
        the rail's 44x44 icon control with the accessible name "Add
        stay-in-touch cadence", modelled on `#important-date-add`.
  - [x] Cancel hides the form, calls `reset()`, and returns focus to the add
        control. The `reset()` is load-bearing beyond tidiness: `UXD-005B`'s
        unsaved-changes guard re-baselines a form on its `reset` event, so a
        cancelled draft stops blocking navigation.
  - [x] An archived person loses both add controls and keeps both submits
        disabled, through the `person-lifecycle-changed` listener that already
        toggled the submits rather than a second listener. A failed load leaves
        the add control hidden, matching what `profile-facts.ts` does with a
        section that did not become ready.
  - [x] The empty stay-in-touch block can finally collapse to the single muted
        row `UXD-002B` built for the rail. It was the one rail block that could
        never collapse, because its cadence form was always open — which is the
        user-visible reason this leaf existed. The now-dead
        `.profile-rail-block[data-rail-empty="true"] > form` rule, which only
        existed to lay that permanently-open form out inside a collapsed block,
        was removed.
  - [x] Two specs were amended, both proving the new behavior rather than
        dropping an old assertion. `app-006b` opens each form through its add
        control and asserts the first control takes focus, which is the point of
        the pattern. Its archived assertion could no longer read
        `cadenceForm.getByRole("button", { name: "Save cadence" })`, because
        saving now closes the form and `getByRole` does not match inside a
        `hidden` container; it proves the add control exists and is hidden —
        `toHaveCount(1)` first, since `toBeHidden()` passes against zero
        elements — and that the submit is still disabled. `app-004c` opens the
        cadence form before measuring its controls, and needed nothing else.
  - [x] Split out of `UXD-007` because it changes a delivered P0 flow's UI and
        needs its own browser evidence, which is not a same-day quick win.
  - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors), 480 web unit tests,
        `test:coverage:web` at 92.52/83.05/87.57/94.57 with `reminders.ts` at
        95.25 lines, zero hex literals outside `:root`, and the complete
        Chromium suite 44/44.

- [x] **UXD-010 — Remove dead dependencies and amend the component clause.**
      (§10.6; effort S; no dependency)
  - [x] Removed the thirteen unused React, Tailwind, and shadcn packages, taking
        `devDependencies` from 27 to 14 and the lockfile from 8,374 to 6,013
        lines. The production web image now installs 566 packages instead of
        809.
  - [x] Kept `eslint-plugin-jsx-a11y`, which is live through
        `astro.configs["flat/jsx-a11y-recommended"]`; lint still covers the same
        460 files, so accessibility linting was not silently dropped.
  - [x] Amended the component clause in
        [`dashboard-settings-design.md`](../product/dashboard-settings-design.md)
        to name Kinship primitives and to record that it supersedes the
        shadcn/ui naming. Every accessibility clause is unchanged, including the
        rule against using tabs to hide unrelated datasets, which review §7.4
        relies on to justify `UXD-002`'s segmented filter.

- [x] **UXD-001 — Design tokens.** (§10.1, §10.2; effort M; no dependency)
  - [x] Declared the accepted token set on `:root` and replaced every literal
        across the three stylesheets. 270 hex literals became 24, all inside the
        token block; literals outside `:root` are zero in all three files, and
        all 38 tokens are declared and referenced with no orphans.
  - [x] Fixed the contrast failures in the same pass. `#809087` measured 3.302:1
        behind .72-.82rem text and the two borderline greens about 4.04:1; all
        three now use `--ink-2` at 7.184:1.
  - [x] Kept the token families paired. Two rules had mapped `--warning` text
        onto `--accent-soft` because the original warm literals were numerically
        closer to it; both now use `--warning-soft` at 5.987:1, so `UXD-016` can
        override each family together without inverting them wrongly.

- [x] **UXD-013 — Person summary read model with per-section counts.** (§9.2
      stage 2; effort M; API side; no dependency)
  - [x] `?include=summary` adds primary contact methods capped at three, the
        next reminder and stay-in-touch dates copied from `dueInformation`,
        relationship counts grouped by type, and a count for each of the
        fourteen stable section ids.
  - [x] Hidden and empty stay distinct in the type system: the section count is
        a discriminated union, so a hidden section cannot carry a count and a
        turned-off module can never render as "none recorded".
  - [x] One lateral projection on the existing person query, with counts built
        from a single `UNION ALL` and one `GROUP BY`. Without the parameter the
        projection is not emitted and the response is byte-for-byte unchanged.
  - [x] Tenant boundaries proven against real PostgreSQL: a foreign-workspace
        person with `include=summary` returns 404 and a forged workspace context
        is forbidden.

- [x] **UXD-002 — Person workspace three-zone layout.** (§7; effort L; depends
      on `UXD-001` and `UXD-006`) Accepted: the workspace reads as a hero, a
      nine-block rail, and four grouped zones behind a filter. `UXD-002B2`,
      `UXD-002C2`, and `UXD-002C3` are named refinements, not unfinished parts
      of this item. Delivered in slices, because a single candidate rewriting
      the 726-line shell, `people-profile.ts`, and the stylesheet at once would
      be unreviewable and the `?section=` contract must stay provable at every
      step.
  - [x] **UXD-002A — Hero.** (§7.1) Absorbs the lifecycle panel, the
        due-information card, the identity-summary card, and the back link.
        Breadcrumb, vital-stats strip, tags, archived banner. Every id the
        browser flows drive survives, so eight specs needed no change.
  - [x] **UXD-002A2 — Overflow menu.** (§7.1) The hero action cluster is now
        `Log interaction`, `Add note`, and a `⋯` menu holding Edit person,
        Export vCard, Archive person, Audit history, and Delete person. Delete
        stops being the second-most prominent control on the page.
    - [x] The menu mirrors the shipped member popover exactly — toggle with
          `aria-expanded` and `aria-controls`, a `hidden` container, one click
          handler. Escape and outside-click dismissal were deliberately not
          added, because the member popover has neither; a later leaf should
          give both menus the same dismissal behavior at once rather than
          leaving two menus that behave differently.
    - [x] Cancelling an edit or a delete reopens the menu before restoring
          focus, so focus never lands on a control inside a closed container.
    - [x] Audit history reveals the Admin zone through `UXD-002C`'s
          section-to-zone map instead of linking to the audit-history route. The
          audit-summary card already owns that link and `app-003c` pins the page
          at exactly two person-scoped links, so a menu link would have been
          both a duplicate and a failure. Restore stays in the archived banner,
          where review §7.1 puts it and where it cannot collide with a second
          control carrying the same accessible name.
    - [x] Ten browser flows reach these controls, not the eight this leaf
          originally listed: `app-003a` and `app-005c` were missing from the
          count. Each of the ten gained one idempotent `openPersonMenu` helper
          modelled on `openMemberPopover`; `app-005c` reaches the audit link
          inside its own card and needed no change.
    - [x] No assertion was weakened. `app-004a`'s archived-Edit check now proves
          the control exists before proving it is hidden: `getByRole` does not
          match inside a `hidden` container, so `toBeHidden()` would otherwise
          have passed against zero elements and proved nothing.
    - [x] One specificity defect was caught by the suite and one token-family
          defect by review. `.person-menu-popover > :is(button, a)` is (0,1,1)
          and loses to the shared control rule's anchor branch at (0,2,1), so
          every menu-item declaration was landing on the buttons only and the
          vCard link kept a different border radius; the rule is now strictly
          more specific on both branches rather than relying on source order,
          which `UXD-012` will reshuffle. The Delete item was reading
          `--accent-hover` rather than `--danger` — the same family-pairing
          mistake `UXD-001` recorded and repaired, and one that would follow the
          accent into dark mode.
    - [x] Known and left for `UXD-016`: `.person-menu-popover` and
          `.member-popover` both use the `white` keyword rather than
          `--surface-1`. Changing one without the other would make two popovers
          visibly different surfaces, and dark mode has to convert both anyway.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, 421 web unit tests,
          `test:coverage:web` at 91.69/82.24/86.15/93.72, and the complete
          Chromium suite 44/44.
  - [x] **UXD-002B — Profile-facts rail.** (§7.2) The nine sections left the
        main column for one sticky column holding the workspace-section
        directory and the rail. Block chrome is an `<h3>` at .95rem, a count,
        and a 44×44 icon add control; the kicker and the `.state-badge` are gone
        from all nine, so `important-dates` and `relationships` had to stop
        requiring a badge element the way `profile-facts` already did. Density
        is `.875rem` against the main column's
        `clamp(1.1rem, 3vw,
        1.6rem)`, and the grid took review §7.5's
        `minmax(280px, 320px)` and its 1199px step.
    - [x] An empty block collapses to one muted row. The row keeps the section's
          own empty text, because `app-004b` and `app-004c` assert those strings
          and they are the honest message. The first attempt rendered two rows:
          an add button at `grid-column: 4` before a state paragraph at
          `grid-column: 3` moves the sparse auto-placement cursor to the next
          row. Measured in Chromium, fixed with an explicit `grid-row: 1`, and
          pinned by a CSS-shape assertion, since happy-dom cannot compute grid
          placement.
    - [x] `?include=summary` seeds the seven counts the `UXD-013` projection
          covers before the nine section fetches land; each section then writes
          its own count. `important-dates` and `stay-in-touch` are not in the
          projection and get their count only from their own load.
    - [x] **Correction to this leaf's own text:** the summary payload carries
          counts, primary contact methods, relationship counts, and the two due
          dates. It carries no birthday, job title, or first-meeting value, so
          `?include=summary` cannot fill those three hero slots. They are filled
          from data the page already loads — birthday and first met from the
          important dates, work from the work profile fact — and each is
          republished when its section re-renders, so a saved or deleted record
          updates the hero without a reload.
    - [x] The age prefix honours `is_age_based`, which
          [`personal_crm_schema_spec_v7.md`](../../personal-crm-schema/v7/personal_crm_schema_spec_v7.md)
          defines as whether age should be displayed when the year is known and
          the important-date form already exposes. The first implementation
          showed an age whenever a non-approximate year existed, overriding the
          member's explicit choice.
    - [x] Two specs changed because the delivered design changed what they
          observe, not to hide a defect. `app-003c` needed `*` on three route
          globs, because the person request now carries a query string and
          Playwright's glob is anchored and treats `?` literally. `app-004b`
          needed four page-wide `getByText` calls scoped to the important-dates
          section, because review §7.1 puts the birthday and first-met values in
          the hero on purpose, so a page-wide search for a date string now
          matches twice; two hero assertions were added in the same place, and
          that fixture is the only one in the suite with an approximate birthday
          to prove the age prefix stays off.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, `contracts:check`, 408 web
          unit tests, `test:coverage:web` at 91.63/82.15/85.92/93.63 with the
          new rail module at 100%, and the complete Chromium suite 44/44. The
          first full-suite run caught the `app-004b` locator ambiguity that no
          static or unit gate could see.
  - [x] **UXD-002B2 — Rail summary formats.** (§7.2 table, §7.6) The per-row
        "Summary shown" and "Expand rule" columns. Split out of `UXD-002B`
        because it becomes a second renderer for lists `profile-facts.ts` and
        `relationships.ts` already own, and the copy button needs the `UXD-005`
        feedback surface. Delivered in two slices.
    - [x] **UXD-002B2a — Contact methods and relationships.** (§7.2 rows 1-2,
          §7.6 rows "Contact methods" and "Relationships") Primary contact
          methods render as `mailto:`/`tel:` links with a copy button; the rest
          sit behind one `+ n more` expander. Relationships group by type and
          cap at five rows behind the same expander shape.
      - [x] The email/phone distinction reaches the client through exactly one
            channel. `ProfileFactOption.kind` is `"contact-type"` — it says what
            kind of _option_ a row is, not what kind of contact it holds — so
            the `href` computed by the `UXD-013` projection is the only source.
            It arrives as a parameter from the `getPerson` call the page already
            makes, costing no request on the load path, and is refreshed with
            one summary call after a contact-methods mutation only.
            `profile-facts.ts` stays the single owner of that block.
      - [x] **Correction to review §7.2:** the row reads "primary per type (1
            email, 1 phone)", which assumes primaries are derived. They are not:
            the projection selects `method.is_primary`, an explicit member
            choice, capped at three. The first implementation collapsed every
            record whenever that set came back empty, so a person who had never
            ticked "Primary for this contact type" saw a block containing
            nothing but an expander — a worse first impression than the one this
            leaf exists to fix. An empty primary set is now treated exactly like
            an absent one and the full list renders unchanged.
      - [x] **Correction to this leaf's own text:** `summary.relationshipCounts`
            is not needed and was not used. The loaded relationships already
            carry both the type id and the directional label, so deriving the
            groups client-side keeps one owner and stays correct after every
            mutation without a second payload.
      - [x] Groups are keyed on the relationship type **and** its directional
            label, not the type alone. One type yields `Parent` in one direction
            and `Child` in the other, so keying on the type put both under a
            single heading carrying whichever arrived first. The API's own
            `relationshipCounts` query already groups the same way. A group
            whose rows are all collapsed hides with them rather than leaving a
            heading above an empty list.
      - [x] Both expanders compose their accessible name from the visible text
            plus an `sr-only` suffix rather than replacing it with an
            `aria-label`. A control reading `+ n more` under the name "Show n
            more contact methods" fails WCAG 2.5.3 Label in Name, and default
            axe does not run `label-content-name-mismatch`, so the suite could
            not have caught it. The controller's ticket specified those names
            and was wrong.
      - [x] Every existing accessible name was preserved, so no browser spec
            changed: `Edit Email: …`, `Delete Email: …`,
            `Relationship type for …`, `Save relationship with …`, `Unlink …`,
            and `No relationships saved.` `app-004c`'s archived assertion also
            still holds, because `Copy` and `+ n more` do not match its
            `/Add|Edit|Delete/` pattern, and its request counter filters on
            `/facts/`, which the summary refresh is not.
      - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors), 477 web unit
            tests, `test:coverage:web` at 92.21/82.84/87.42/94.28, zero hex
            literals outside `:root`, and the complete Chromium suite 44/44 with
            no spec changed.
    - [x] **UXD-002B2b — The remaining seven rows.** (§7.2 rows 3-9) Split in
          two: the four rows that collapse a list share one mechanism, and the
          two-line text clamps are a different one.
      - [x] **UXD-002B2b1 — Important dates, addresses, work, and pets.** (§7.2
            rows 3-6) Important dates show the birthday plus the soonest
            upcoming record behind `Show all (n)`; addresses show the first
            record over three lines behind `+ n more`; work shows the current
            role behind `Show history`.
        - [x] `pets` needed nothing. It already rendered `Byron · Cat` — a name
              and a species on one line — so the row was recorded as satisfied
              rather than given a diff to tick it.
        - [x] The expander `UXD-002B2a` built for contact methods became one
              shared `insertProfileRailExpander` consumed by both
              `profile-facts.ts` and `important-dates.ts`, rather than a second
              implementation. It keeps the `sr-only`-suffix accessible name:
              visible text plus a section suffix, never an `aria-label` that
              replaces the visible text, because default axe does not run
              `label-content-name-mismatch` and no gate would catch the WCAG
              2.5.3 failure.
        - [x] Selection is pure and takes the current instant as a parameter, so
              the rule is table-tested against a fixed date instead of the clock
              the suite happens to run on. No browser assertion says which
              record is upcoming, for the same reason.
        - [x] **A defect caught in review.** The first implementation resolved a
              February 29 record to the next actual February 29, up to four
              years away, on the stated grounds that no leap-day policy exists.
              One does: `reminder_management.ts` generates every recurrence
              through `Temporal.PlainDate.add`, whose default `constrain`
              overflow lands February 29 on February 28 in a non-leap year. The
              rail would have said a date was four years away while the reminder
              this same section describes fired next February. It now clamps the
              day to the target month, and the search is two candidates rather
              than a 400-year scan.
        - [x] **A second browser failure the suite caught, in a place the
              amendment had not reached.** `app-004b` asserts the First meeting
              row immediately after the third save — the save that first makes
              the block collapse — and `getByRole` does not match inside a
              `hidden` element, so the listitem locator resolved to nothing. The
              spec now expands before that assertion, which proves the expander
              at the moment it first appears and keeps the record assertion
              intact rather than weakening it to a locator that matches hidden
              content. Both `Show all` locators are section-scoped: the
              first-run `Show all sections` control shares the substring.
        - [x] `app-004c`'s address assertion moved from the joined
              `Home, 1 Analytical Engine Way, London` to the three rendered
              lines, proving the new format rather than dropping the old string.
              Its `work`, `pets`, and `food-preferences` assertions needed
              nothing, because each holds one record and no collapse applies.
        - [x] Gates: `fmt:check` 581 files, `lint` 474 files, `check:web` 0
              errors, 511 web unit tests, `test:coverage:web` at
              92.66/83.22/87.71/94.68, zero hex literals outside `:root`, and
              the complete Chromium suite 44/44 with an empty
              `.artifacts/playwright`.
      - [x] **UXD-002B2b2 — The two text clamps.** (§7.2 rows 7-8) Food
            preferences and first meeting clamp to two lines and reveal in place
            through a `More` control that becomes `Less`. `stay-in-touch` needed
            nothing here — its cadence editor is `UXD-007B`.
        - [x] The shared list expander was deliberately not reused. It collapses
              whole `<li>` elements; this is one record whose text is clamped
              and revealed in place, so forcing one mechanism to do both jobs
              would have made both worse. The two do share the
              `profile-rail-summary-control` treatment and the
              visible-text-plus-`sr-only`-suffix accessible name, so
              `More food
              preferences` and `More first meeting`
              stay distinguishable without an `aria-label` that would replace
              the visible text and fail WCAG 2.5.3.
        - [x] The control appears only on measured overflow —
              `scrollHeight > clientHeight`, taken once per render inside one
              `requestAnimationFrame`. No `ResizeObserver`, no `resize`
              listener, no third async owner: a control left stale by a viewport
              change is a smaller problem than another owner on this surface,
              and `AGENTS.md` is explicit about which of those two to choose.
        - [x] **Recorded limitation:** happy-dom performs no layout, so the unit
              tests define `scrollHeight` and `clientHeight` to drive both
              branches and the measurement itself is exercised only in a real
              browser. The clamp is also expressed entirely in CSS, which the
              expanded state turns off through `data-expanded` on the element
              rather than a second rule hoping to win on order.
        - [x] No browser spec changed. The clamp is presentation, so
              `app-004c`'s `Tea; no shellfish` and
              `London salon — Introduced while discussing mathematics`
              assertions still hold against the same unchanged strings.
        - [x] Gates: `fmt:check` 581 files, `lint` 474 files, `check:web` 0
              errors, 515 web unit tests, `test:coverage:web` at
              92.68/83.26/87.75/94.69, zero hex literals outside `:root`, and
              the complete Chromium suite 44/44 with an empty
              `.artifacts/playwright`.
    - [ ] Deliberately not attempted in either slice: removing the inline
          relationship editor from the rail. Review §7.2 wants the rail compact
          and a type `<select>` plus two buttons per row is not that, but four
          `app-004d` assertions drive those controls and replacing them is a
          product decision, not a formatting one.
  - [x] **UXD-002C — Streams and zone filter.** (§7.3, §7.4, §7.5) The twelve
        main-column sections became four zones under real `<h2>` headings, with
        the section cards dropping to `<h3>` and the task columns to `<h4>` so
        axe's heading order stays legal behind the rail's own `<h3>` blocks.
        Fourteen kickers are gone. The sections were already in the right DOM
        order, so this wrapped them rather than moving them.
    - [x] The switcher is a segmented filter, not a tab set: five `aria-pressed`
          buttons in a `role="group"`, `All` first-class and default, `?view=`
          as the whole state, and the `hidden` attribute on the groups that are
          off so they leave the accessibility tree and the tab order. It sticks
          below the app header with a 24px avatar and name once an
          IntersectionObserver sees the hero leave. The mini identity is
          `aria-hidden` and not a heading, because the hero `<h1>` already names
          the page and a second live copy of the name is the locator ambiguity
          that cost `UXD-002B` a full-suite failure.
    - [x] `?section=` resolves through the static twenty-two entry map from
          §7.4. `focusSection` gained exactly one new step at the front, and it
          fires only when the current filter is actually hiding the target — a
          section link clicked from `All` does not silently filter the page, and
          a section a workspace has turned off keeps `UXD-006`'s turned-off
          notice instead of switching the view to reveal nothing.
    - [x] One history entry per navigation. The first attempt pushed from inside
          `focusSection`, which both double-pushed on every click and re-pushed
          from the `popstate` handler, so Back restored a view and was
          immediately overwritten and the member was trapped. Navigation now
          writes `section` and `view` in one `pushState`, a deep link that needs
          a zone activated reconciles with `replaceState`, and `popstate` writes
          nothing. `app-003c` never caught it because it only exercises Back
          under the default `All`, where no zone is hidden.
    - [x] `data-load-mode` is retired, per `REL-018`. No runtime code ever read
          it, it covered three of twenty-two sections, and `data-zone` is the
          structural metadata that earns its place by being read — by the filter
          and by the section-to-zone map. `app-003c`'s assertion now pins
          `data-zone` rather than being deleted.
    - [x] The audit-summary section keeps its own link to the full audit
          history. `information-architecture.md` reserves separate pages for
          scale-heavy audit history, and `app-003c` pins the person page at
          exactly two `/app/people/<id>/…` links.
    - [x] Two style leaks were caught in review before they shipped. Renaming
          `.profile-section-heading h2` to `h3` put it at identical specificity
          to `.profile-rail-block h3`, which also matches a rail block, so the
          rail kept its .95rem only by source order — and `UXD-012` is a
          scheduled task that reorders this stylesheet. Both that rule and the
          raised `scroll-margin-top` are now scoped to `.person-zone`.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, 419 web unit tests,
          `test:coverage:web` at 91.69/82.23/86.07/93.69, and the complete
          Chromium suite 44/44. The first full-suite run also failed
          `app-002c`'s header keyboard walk once; it passed on the re-run with
          no change to that surface, so it is recorded below rather than treated
          as caused by this candidate.
  - [x] **UXD-002C2 — Merged timeline surface.** (§7.3 Timeline bullet, §7.6
        row 1) `life-events`, `notes`, `conversations`, `calls`, and
        `activities` become one reverse-chronological list. Split out of
        `UXD-002C` because merging five independently cursored lists cannot be
        done honestly in the client; it needs an API-side chronological
        projection the way `UXD-013` supplied the summary, and
        `information-architecture.md` already asks for "a compact chronological
        projection across relevant person events". Delivered API side first.
    - [x] **UXD-002C2A — The projection.**
          `GET /api/v1/people/:personId/timeline` returns the five kinds as one
          keyset page ordered by `(occurredAt, id)` descending, with an opaque
          cursor bound to the workspace, person, and kind filter, a limit
          clamped to 50, and a `stale-cursor` outcome when the anchor no longer
          resolves.
      - [x] It is a second operation on the existing `person-profile` read model
            rather than a new one. That entry already allowlists `journal`,
            `interactions`, `people`, and `workspaces` — exactly the modules the
            projection composes, since `crm.life_events` belongs to `journal`
            and the other four tables to `interactions` — so
            `module-boundaries.yaml` needed no amendment. A new read model would
            have required one and bought nothing.
      - [x] Personalization is honoured inside the projection: a kind whose
            `workspace_profile_modules` row is inactive contributes no rows, and
            the cursor anchor is validated against the same condition. Without
            that, a merged list would have leaked exactly the content `UXD-006`
            exists to hide, and a cursor into a hidden kind would have paged
            through it.
      - [x] Life events resolve their sort timestamp from `happened_at`, then
            from a UTC timestamp built out of `year` with `month` and `day`
            defaulted, and finally from `created_at` with precision `unknown`.
            The last case is deliberate: an undated milestone stays reachable
            and the keyset stays total, while the precision stops a client from
            rendering a date the member never entered.
      - [x] **Known limitation, recorded rather than fixed:** an event with a
            `month_day` precision but no year sorts by `created_at` and reports
            `unknown`, so its real day is not renderable from the timeline item.
            The item carries `occurredAt` as a sort key and a precision, not the
            raw date parts. `UXD-002C2B` must keep the life-events section
            reachable, or carry the parts, rather than silently losing that
            date.
      - [x] Gates: `check:api`, `contracts:check`, `test:contract` 122 passed,
            `fmt:check`, `lint`, and `test:coverage:api` against a real
            PostgreSQL at 85.0 branches / 82.1 / 87.2 lines aggregate, covering
            the five kinds merging, a turned-off module contributing nothing,
            paging across a duplicate timestamp, a foreign-workspace person, and
            a forged workspace context.
    - [x] **UXD-002C2B1 — The merged surface.** (§7.6 row 1) The Timeline zone
          now leads with one reverse-chronological list: type-filter chips, each
          row a `<details>` collapsed to date, type, and a two-line excerpt, and
          `Load older events` through the projection's cursor.
      - [x] Filtering goes through the API's `kind` parameter and discards the
            current cursor, because the cursor is kind-bound server-side and
            reusing it across filters returns `stale-cursor`. One request
            sequence guard replaces the temptation to add a watermark.
      - [x] Retry is offered on 5xx and on a network failure and withheld on 403
            and 404, per §11: a terminal answer is not something to retry. A
            failed load takes a `--danger-soft` treatment so it cannot be
            mistaken for an empty state, which is the same paragraph's third
            fix.
      - [x] A partial life-event date renders at its own precision and never at
            the timestamp `UXD-002C2A` synthesised to sort it. **A defect caught
            in review:** the first implementation put the full synthesised
            instant in `<time datetime>` for every precision except `unknown`,
            so a year-only milestone visibly read "1998" while asserting
            `1998-01-01T00:00:00Z` to assistive technology and to any parser.
            The machine-readable value is now emitted only at a precision HTML
            can express — `YYYY`, `YYYY-MM`, `MM-DD` — and a bare month or
            day-of-month gets no `<time>` element at all, matching what
            `person-life-events.ts` already does with the same data. That closes
            the limitation `UXD-002C2A` recorded: the merged row never displays
            or asserts a date the member did not enter.
      - [x] The surface carries no `data-profile-section`, so it is a sixth
            thing inside the zone rather than a twenty-third section, and
            `app-003c`'s count of 22 and `app-008c`'s sweep over the same set
            both still hold. It is registered in the lazy `timeline` zone, not
            made eager.
      - [x] The first chip is named "All types", not "All". Playwright matches
            accessible names as a case-insensitive substring, so a locator for
            "All" would also have matched "Log call", "Show all sections", and
            the zone filter's own "All" button.
      - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors), 486 web unit
            tests, `test:coverage:web` at 92.59/83.12/87.62/94.63 with the new
            module at 99.13 lines, zero hex literals outside `:root`, and the
            complete Chromium suite 44/44 with no spec changed.
    - [x] **UXD-002C2B2 — Demote the five cards to editors.** §7.3 asks for
          "five cards become one surface", and until this lands the Timeline
          zone shows the merged list _and_ the five lists that feed it, which is
          duplication rather than the consolidation the review wants. Those
          cards own the mutations `INTERACTION-001`, `INTERACTION-002`, and
          `PEOPLE-003` drive, so suppressing their lists means amending those
          flows to assert against the merged surface instead, and the merged
          surface must then refresh when one of the five records a change. Split
          out because that is a different risk from adding a read surface.
      - [x] **A correction to this leaf, found before dispatching it.**
            Suppressing the five lists is not pure duplication removal: the
            projection `UXD-002C2A` shipped carries only `title` and `excerpt`,
            so a merged row shows strictly less than the card it would replace.
            Notes and life events lose nothing, but activities lose
            participants, category, and emotions; calls lose their direction and
            emotions; and conversations lose the channel, the contact method,
            and every message in the thread. Demoting all five as written would
            remove the conversation transcript from the person workspace
            entirely. Directed decision: enrich the projection first, then
            demote losslessly. Hence three slices.
      - [x] **UXD-002C2B2a — Refresh the merged surface on a mutation.** A live
            defect on its own, not only a prerequisite: since `UXD-002C2B1`
            shipped, logging a call, saving a conversation, or capturing a note
            or activity updated the card below while the merged list above kept
            its page-load state until a reload.
        - [x] One `document` event, `person-timeline-changed`, carrying
              `{ personIds }`, dispatched from exactly two sites — the
              quick-capture save in `interactions.ts` and the successful
              `recordInteraction` in `communications.ts` — and exactly one
              listener, in `person-timeline.ts`. Life events get no dispatch
              because they have no mutation surface, and interactions have no
              edit or delete surface, so two sites are the complete set.
        - [x] The detail is a list because one activity can name several
              participants, and the listener ignores an event whose list does
              not contain the person it was mounted for. A capture on `/app`
              reaches no timeline at all. That negative assertion is what stops
              the fix from degrading into "reload on any event".
        - [x] The reload is `load({ append: false })` through the existing
              request-sequence guard: it keeps the selected type filter, drops
              the keyset cursor, and replaces the list. No splice, no second
              sequence, no watermark — a new record at the head invalidates a
              server-bound cursor, and `REL-013` is the recorded cost of the
              alternative. A member who had paged back returns to the first
              page; that is accepted, not overlooked.
        - [x] `INTERACTION_CREATED_EVENT` and `TODAY_RECONNECT_RECORDED_EVENT`
              were left exactly as they are. This candidate adds a signal rather
              than rerouting one, so the Today page and the person cards keep
              their existing refresh paths.
        - [x] **A defect caught in review:** the listener asserted its detail
              shape through a cast and read `detail.personIds` with no runtime
              check, so an event dispatched without a detail would throw inside
              the dispatch. Every sibling listener in this codebase guards
              instead. Now guarded, with a focused test that a detail-less event
              is ignored.
        - [x] One assertion was added to `tests/e2e/app-005a.spec.ts` and
              nothing was removed: after the note save, the merged surface must
              contain the same text as the section card, immediately after the
              action that produces it. It is the browser proof that the refresh
              is real, and it is the first of the assertions `UXD-002C2B2c`
              moves rather than deletes.
        - [x] Gates: `fmt:check` 580 files, `lint` 473 files, `check:web` 0
              errors, 499 web unit tests, `test:coverage:web` at
              92.63/83.22/87.62/94.67, and the complete Chromium suite 44/44 on
              the pre-amendment candidate. The amendment was one guard inside
              the listener that run exercised, so the browser suite was not
              rerun for it, per the gate ladder.
      - [x] **UXD-002C2B2b — Carry the per-kind detail in the projection.**
            `PersonTimelineItem` now carries `activityType`, `participants`, and
            `emotions` for an activity; `contactWasCaller` and `emotions` for a
            call; and `channelType`, `contactMethod`, and `messages` for a
            conversation. Notes and life events gained nothing, because they
            already lose nothing to a merged row.
        - [x] The enrichment is seven guarded `left join lateral` clauses on the
              final select over `page`, so it runs over at most `limit + 1`
              already-chosen rows and cannot reach the keyset predicate, the
              ordering, the overfetch that decides `nextCursor`, the
              personalization predicates, or the cursor-anchor validation. The
              `projection` and `page` CTEs are byte-for-byte unchanged.
              `activity_report_repository.ts` already used this shape and was
              mirrored rather than reinvented.
        - [x] Every value matches how the same value is already resolved
              elsewhere rather than being invented here: the activity type is
              the `coalesce(nullif(name, ''), translation_key)` the activity
              report uses, and the channel name is the
              `coalesce(nullif(name, ''), 'Communication')` the interaction
              workspace boundary uses. A missing channel type omits the field
              rather than falling back, which is what the section card does.
        - [x] Tenant scope is re-asserted inside every lateral through the
              query's workspace parameter, not inherited from the parent row.
              The one exception is deliberate and correct:
              `person_contact_methods` has no `workspace_id` column, so it is
              reached through the thread's own workspace-scoped person.
              `emotion_options` is global by schema comment and is joined
              without a workspace predicate, as everywhere else.
        - [x] The published `maxItems` are the bounds the write path actually
              enforces — 20 emotions and 50 participants, from the Zod schemas
              in `apps/api/interactions.ts` — so the contract cannot describe a
              response the API can produce. `messages` is deliberately uncapped:
              a cap would make the demotion lossy again, which is the reason
              this leaf exists.
        - [x] The real-PostgreSQL assertions were written blind, since the
              implementer sandbox reaches no database, and passed on the first
              controller run. They prove an activity keeps its category, both
              ordered participants, and its emotion; a call keeps its caller
              direction and emotion; a conversation keeps its channel, contact
              method, and both messages in written order with their directions;
              and that a note and a life event carry none of the seven fields at
              all.
        - [x] Gates: `contracts:generate` then `contracts:check`, `check:api`,
              `test:contract` 125 passed, `test:unit:api`, `check:web` 0 errors,
              `fmt:check` 580 files, `lint` 473 files, and `test:coverage:api`
              against real PostgreSQL 526 passed / 0 failed at 85.1/82.1/87.3.
              No browser gate applies: the change is additive-optional on a
              response and touches no web code.
      - [x] **UXD-002C2B2c — Render the per-kind detail in the merged row.**
            Expanding a row now shows what its card shows, in the card's own
            words: `Participants:`, `Category:`, and `Emotions:` for an
            activity; `Incoming call` or `Outgoing call` with its emotions for a
            call; `Channel:`, `Via …`, and one `Inbound:`/`Outbound:` line per
            message for a conversation. Notes and life events render no detail
            list at all, which is the assertion that stops the renderer emitting
            empty scaffolding.
        - [x] The strings are `interactions.ts` and `communications.ts` verbatim
              rather than a second vocabulary, because `UXD-002C2B2d` moves
              browser assertions written against those exact strings onto this
              surface. Nothing is re-sorted client-side either: the projection
              already orders participants, emotions, and messages, and a second
              opinion about an order the server owns is how two surfaces drift.
        - [x] The collapsed `<summary>` is untouched. Detail belongs behind the
              disclosure `UXD-002C2B1` built.
        - [x] **A defect caught in review:** `Direction not recorded` was
              unreachable. It was gated on `messages.length === 0`, but the
              projection's `jsonb_agg` over zero rows yields SQL `NULL` and the
              mapper omits a null field, so a thread with no messages arrives
              with no `messages` key at all. The unit test asserted a payload
              the server cannot send. A conversation now renders that line when
              its messages are absent **or** empty, which is what makes the
              `INTERACTION-002` assertion movable in the next leaf. The fix is
              client-side: omitting a valueless field is the projection's
              accepted rule, and the client knows the kind.
        - [x] **A second defect caught in review:** the new list matched no
              stylesheet rule, so it fell back to user-agent disc bullets and
              ~40px padding beside content inset with `var(--space-4)`. It now
              has one rule reaching it through
              `.person-timeline-list > li > details > ul`, which is strictly
              more specific than anything it competes with rather than winning
              by position — `UXD-012` reorders this stylesheet.
        - [x] **The controller's ticket was wrong about the data.** It specified
              a browser assertion locating the activity row on the merged
              surface, and the full suite failed it 1 of 44: `app-005a` seeds 21
              notes immediately before that navigation, so the first page of
              twenty is entirely notes and the activity is on page two. The
              assertion now clicks the timeline's own `Activities` chip first,
              which puts the row on the first page and makes the check prove the
              chip filter as well. No production code was involved.
        - [x] Gates: `fmt:check` 580 files, `lint` 473 files, `check:web` 0
              errors, 503 web unit tests, `test:coverage:web` at
              92.66/83.29/87.67/94.67, zero hex literals outside `:root`, and
              the complete Chromium suite 44/44 with an empty
              `.artifacts/playwright`.
      - [x] **UXD-002C2B2d — Suppress the five lists.** The Timeline zone now
            shows one list. Each of the five cards keeps its heading, badge,
            state line, own request, error isolation, add control, and form, and
            renders no rows; its list container carries `hidden`, so an empty
            `<ul aria-label="Recent calls">` is not left in the accessibility
            tree. The non-empty state line carries the count and
            `Listed in the timeline above.` Every empty-state string is
            unchanged, because those are asserted and are the honest message.
        - [x] Every card kept its own request deliberately. `PEOPLE-003` proves
              per-section failure isolation by making the life-events request
              return 503 and asserting that card alone goes to
              `data-section-state="error"` with a working Retry while the others
              stay healthy. Taking the request away to save a round trip would
              have deleted that contract; this leaf removes duplicated display,
              not the isolation `UXD-003` left intact.
        - [x] Ten browser assertions moved from three delivered P0 flows onto
              the merged surface and none was deleted without a replacement
              proving the same fact. They are stronger there: each also proves
              the merged list refreshed through `UXD-002C2B2a`'s event, because
              every one of them runs immediately after the mutation that
              produced the record. `INTERACTION-002`'s `Direction not recorded`
              is the browser proof of the absent-`messages` fix `UXD-002C2B2c`
              made.
        - [x] **The implementer stopped rather than guessing, and it was right
              to.** The ticket told it to treat any failing existing unit test
              as evidence of overreach. Seven were instead legitimately obsolete
              observables. Their invariants — newest response wins, one section
              failing does not take the other down, listeners survive two
              captures — are untouched by this leaf, so each was re-pointed from
              row text to the state line rather than deleted. Two race tests
              could only be told apart by row text, so their fixtures now differ
              in record **count**: the newer response returns two records and
              the older one or three, and the assertion still fails if the older
              one wins.
        - [x] `renderRecord`, and life events' `displayDate` and `monthName`,
              were deleted as unreachable. `renderInteraction` stayed: Today and
              the activity report still call it. The one test named for
              `Unknown channel` rendering was renamed, because the behavior it
              named no longer exists; a conversation with no title and no
              resolvable channel now reads `Conversation · No details recorded.`
              on the merged row, which names the kind rather than guessing at a
              channel.
        - [x] Gates: `fmt:check` 580 files, `lint` 473 files, `check:web` 0
              errors, 503 web unit tests, `test:coverage:web` at
              92.62/83.20/87.53/94.65, and the complete Chromium suite 44/44
              with an empty `.artifacts/playwright`.
  - [x] **UXD-002C3 — Remember the member's zone choice.** (§7.4) The last zone
        choice now persists in `member_preferences.ui_state`, the mechanism
        `person-workspace.md` reserves. No read or write surface for that column
        existed — it was written only by the recent-people use case — so this
        leaf added one.
    - [x] **UXD-002C3A — The API surface.** `GET` and
          `PATCH /api/v1/member/ui-state` in the `workspaces` module, which
          already owns `member_preferences`, so no boundary changed. The session
          response carries the same projection, which is what makes the
          preference usable with no extra request on a load path `UXD-003` spent
          three leaves shortening.
      - [x] It is a closed set of named presentation keys, not a key-value
            store. The column's own comment is the contract — "sparse
            presentation state such as active tabs and dismissed feature badges;
            never stores domain data" — so the write accepts one recognised key,
            merges it, and leaves every other key intact under the same row lock
            the recent-people use case takes. `recentPersonIds` shares that
            column and must survive.
      - [x] A failed preference read omits `uiState` rather than failing the
            session. A session must not break because a stored view could not be
            loaded, and it is composed in the route beside
            `requiredLegalDocuments` rather than threaded through
            `protectedSessions.resolve`, whose path carries the audit
            transaction and tenant postconditions.
      - [x] **A test removed in review, not added.** The first candidate proved
            serialization with a three-connection choreography that read
            `pg_stat_activity`, matched backend PIDs, and coordinated through
            two promises — and it failed, because it modelled the UI-state
            writer as blocking behind the recent-person writer when both take
            `for update of member` on the same row and therefore queue behind
            the same holder. `AGENTS.md` asks for the smallest observable
            concurrency contract; the invariant is that two concurrent writes
            both survive, and `Promise.all` over the two requests plus one
            assertion on the resulting row proves exactly that.
      - [x] Gates: `check:api`, `contracts:check`, `test:contract` 125 passed,
            `fmt:check`, `lint`, and `test:coverage:api` against real PostgreSQL
            at 521 passed / 0 failed, 85.1 branches / 82.1 / 87.3 lines.
    - [x] **UXD-002C3B — The preference in the person workspace.** A page opened
          without `?view=` adopts the stored zone through `replaceState`, so the
          URL remains the whole state `UXD-002C` made it and Back never walks
          through a restoration the member did not perform. `currentView()`
          stays a pure read of the URL; a dozen call sites depend on that.
      - [x] An explicit `?view=` always beats the stored preference: a link
            someone was sent outranks that reader's own habit.
      - [x] The write also rewrites the cached session, preserving its
            `savedAt`. Without that, `UXD-003C`'s sixty-second cache would serve
            the previous choice back on the next navigation and revert the view
            under the member — a real regression, not a theoretical one. The
            reader and the updater now share one `isCurrentSessionCacheEntry`
            definition of "still usable".
      - [x] **A defect caught in review:** the first candidate moved the zone
            chips' click handlers behind the session resolution, so on a cold
            load a visible, focusable control silently ignored clicks for a full
            round trip. Handlers bind immediately again; a click in that window
            filters the page and simply does not persist, because the member's
            next click will.
      - [x] A stored zone suppresses the first-run onboarding card, since the
            restored URL makes `currentView()` something other than `all`. That
            is deliberate — an explicit choice outranks a suggestion — and it is
            asserted rather than incidental.
      - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors), 495 web unit
            tests, `test:coverage:web` at 92.62/83.19/87.67/94.64, and the
            complete Chromium suite 44/44 with no spec changed.

- [x] **UXD-003 — Staged loading.** (§9.2, §9.3; effort M; the prefetch
      deletions are independent, zone laziness depends on `UXD-002`)
  - [x] **UXD-003A — Delete the three eager prefetches.** (§9.1) Shipped as the
        independent slice this leaf already allowed for. Five eager requests
        leave a person-page open.
    - [x] The global one was the robustness bug, not a perf nit.
          `mountInteractionCapture` runs on every authenticated page and awaited
          `listPeople` plus `listInteractionOptions` before enabling anything;
          on failure it disabled the quick-capture openers and left them there,
          so a transient failure of a prefetch nobody asked for disabled the
          primary capture action application-wide. Openers are now wired and
          enabled immediately, options load on first open and are cached for the
          mount, and a failure is retryable inside the dialog with the form
          gated until the selects are populated — the `REL-019` and `REL-007`
          rule.
    - [x] Module availability travelled with that request, so a turned-off
          interaction kind now says so in the dialog instead of silently
          disabling a header button. `app-002c` and `auth-003` both Tab onto
          Quick capture and assert it is focused, and a disabled button is not
          focusable, so those two flows previously depended on the prefetch
          succeeding. Removing the dependency made them more robust.
    - [x] `communications` stopped refetching the `contact-methods` section that
          `profile-facts` already loads for the rail. A contact-methods failure
          used to fail the whole communications section; it can now only affect
          the one select it feeds.
    - [x] `person-gifts` stopped fetching people and files on every refresh, so
          the list and its states no longer depend on either being reachable.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, 424 web unit tests,
          `test:coverage:web` at 91.65/82.26/85.82/93.71, and the complete
          Chromium suite 44/44 on the first run, with no spec changed.
  - [x] **UXD-003B — Staged person-page loading.** (§9.2 stages 0, 3, 4; §9.3)
        Six requests on open become three.
    - [x] The shell paints from the first frame with skeletons in the hero, the
          rail, and the streams; `#person-profile-state` is reserved for the
          three terminal states. The `<h1>` carries a skeleton plus
          screen-reader text so axe's `empty-heading` rule never sees an empty
          heading now that the shell is visible during load.
    - [x] The initial fan-out went silent. The shell carried 17 `aria-live`
          attributes and 19 `role="status"` attributes, and `role="status"` is
          an implicit polite region, so removing only the explicit attribute
          would have changed nothing. Section state paragraphs now ship inert
          and are promoted in one central place after first paint; everything
          the member triggers still announces. `REL-015` is the same lesson in
          the other direction.
    - [x] The `Promise.all` fan-out became a zone registry. The rail stays
          eager; each stream zone loads once, on the first of being the selected
          view, a `?section=` deep link, or intersecting the viewport at a 400px
          margin. That third condition is what keeps the default `All` honest —
          without it every zone is visible and nothing would be deferred.
    - [x] Deep links trigger a zone rather than awaiting it. Every section card
          exists from first paint and renders its own loading state, so
          `focusSection` stayed synchronous and navigation stayed authoritative,
          avoiding the `REL-013` failure mode entirely.
    - [x] `mountPersonReminders` stayed eager because one mount feeds both the
          rail's stay-in-touch block and the Planning reminders card. Planning
          is therefore half-lazy — tasks lazy, reminders eager — which is a
          better trade than splitting that module.
    - [x] `app-008c` was amended, not weakened. It asserts no section is left
          loading across the complete workspace; with `things` and `admin`
          deferred, five sections legitimately remain loading until revealed, so
          the flow now scrolls those two zones into view first and then proves
          the same invariant over the same twenty-two sections. Scrolling rather
          than clicking the filter, because the spec asserts focus on the
          deep-linked section a few lines later. `app-003c`'s takeover assertion
          was replaced with one proving the staged shell.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, 431 web unit tests,
          `test:coverage:web` at 91.68/82.23/86.44/93.79, zero hex literals
          outside `:root`, and the complete Chromium suite 44/44.
  - [x] **UXD-003C — Cache the resolved session.** (§9.2 stage 2) The resolved
        `SessionContext` persists to `sessionStorage` under `kinship.session`
        for sixty seconds and is served to the first resolution of each
        document, which removes one blocking round trip from all thirty-four
        page loads. A 401 during revalidation falls through to the existing
        access-lost render; a transient failure changes nothing and leaves the
        working page alone.
    - [x] The cache is a cross-document accelerator, not a same-document memo. A
          second resolution inside one long-lived document makes a real round
          trip, which bounds how long a stale session can be served and keeps
          the existing in-flight deduplication as the only same-document
          sharing. The flag that does this carries a comment saying so, because
          a resolver that ignores a warm cache otherwise reads as a defect.
    - [x] The active workspace and the cached session can no longer be changed
          independently. Every write of `kinship.active-workspace` — in
          `app-shell`, `settings`, `workspace-lifecycle`, `invitation`, and
          `workspace-context` itself — now goes through `setActiveWorkspace` or
          `clearActiveWorkspace`, which clear the cache with it. `invitation.ts`
          had declared its own duplicate copy of the key; there is now one
          definition.
    - [x] A successful sign-in and every sign-out path clear the cache, so a
          second identity in the same tab can never be served the first's
          optimistic session. Sign-in is the backstop that makes the four
          sign-out sites non-load-bearing; a _failed_ sign-out clears nothing,
          because that session is still live.
    - [x] Revalidation re-runs the role, forbidden-route, and compliance gating
          through one extracted `applySessionGating`, so a demoted role, a newly
          forbidden route, and a newly required legal version are all corrected
          rather than skipped. It reports through one `onSessionRevalidated`
          subscription that fires even when the outcome landed before the shell
          subscribed — a plain event would have raced the `await` the shell
          already performs.
    - [x] **Correction to this ticket's own instructions:** the controller wrote
          that a stale workspace _name_ was an accepted cosmetic limitation and
          that revalidation should not repaint the header. The suite disproved
          it. The same render call owns the switcher's `<select>` options and
          its `hidden` state, so a member added to a second workspace kept a
          hidden switcher, which left the tab order and failed the header
          keyboard walks in `app-002c` and `auth-003` and the switch in
          `app-004e`. Revalidation now repaints workspace name, options, and
          visibility — but only after gating returns `allowed`, and never
          through `renderSession`, whose `clearToasts()` would wipe an unread
          error and whose welcome text comes from a one-shot `entryFirstName`.
    - [x] Three specs gained one option-count wait each, before the first
          switcher interaction that follows a workspace-set change made through
          a channel the client cannot observe. They prove the revalidation
          repopulates the switcher rather than merely delaying;
          `expect(switcher).toBeHidden()` could not gate it, because that passes
          in both worlds while the popover is closed. Real-world exposure is one
          round trip, not the sixty-second TTL, because every cached page load
          revalidates immediately.
    - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors), 469 web unit
          tests, `test:coverage:web` at 91.99/82.51/87.19/94.08 with
          `workspace-context.ts` at 97.05 lines and `app-shell.ts` at 98.86, and
          the complete Chromium suite 44/44.
- [x] **UXD-005 — Feedback pass.** (§11; effort M; depends on `UXD-001` and
      `UXD-003`) Delivered in two slices, because the toast region and the
      empty-state work touch different surfaces and each needs its own browser
      evidence.
  - [x] **UXD-005A — Toast region.** (§11 "Inline vs toasts") `#shell-status`
        became `#app-toasts`, a permanent `aria-live="polite"` `<ul>` sitting
        last inside `#protected-shell`. Items auto-dismiss after six seconds
        except errors, cap at three stacked with the oldest dropped, pause on
        hover and focus, and carry a keyboard-reachable dismiss control. Inline
        form feedback is untouched and stays authoritative: every other
        `announce(...)` on the person page — edit saved, edit cancelled, delete
        cancelled, and every failure path — still writes to
        `#person-lifecycle-status`.
    - [x] The region carries no `role="status"` and no `role="alert"`.
          `auth-001` uses a page-wide `getByRole("status")`, and `REL-015` is
          the recorded defect from giving a standing region an announcement
          role; a bare `aria-live` list is both what §11 asks for and the only
          shape that cannot become a second matching element.
    - [x] Two consumers, and only two. The application shell's five workspace
          and sign-out outcomes, and person archive/restore, where archiving now
          offers the `Undo` the review's own example asks for. `Undo` does not
          collide with `Restore person`, which stays in the archived banner
          where `UXD-002A2` put it.
    - [x] **Correction found in review:** the first candidate deleted the
          "Signing out securely…" announcement while keeping its twin "Switching
          workspace…". The ticket had listed four status writes and the file had
          five; an omission in the ticket is not permission to drop
          member-facing feedback, so both progress messages now ship as `info`
          toasts.
    - [x] **Second correction found in review:** the two retargeted `app-004a`
          assertions were left in their original position, several assertions
          and an `openPersonMenu` round trip after the action. The old
          `#person-lifecycle-status` text never expired; a six-second toast
          does, so each assertion now sits immediately after the archive or
          restore it proves. The class of bug is new to this surface: moving an
          outcome onto an expiring element makes assertion _position_
          load-bearing.
    - [x] Tone is carried by a left border in `--danger`, `--warning`,
          `--positive`, or `--line-2`, never by body text colour, so the
          `--ink-inverse`-on-`--ink-1` contrast is identical in all four tones
          and axe sees one value. `.app-toasts` keeps `pointer-events: none` and
          only `.app-toast` takes `auto`, so an empty region never intercepts
          clicks in the page corner — the invariant `people-layout.test.ts` used
          to pin on `#shell-status`.
    - [x] Nine browser assertions across six specs moved to the new surface,
          each proving the same thing it proved before. Six emptiness checks
          became `toHaveCount(0)` on `#app-toasts > li` rather than
          `toBeHidden`, per the recorded trap that `toBeHidden()` passes against
          zero elements.
    - [x] Gates: `fmt:check`, `lint`, `check:web`, 447 web unit tests,
          `test:coverage:web` at 91.84/82.28/86.78/93.92 with the new module at
          97.89/86.11/100/97.64, zero hex literals outside `:root`, and the
          complete Chromium suite 44/44 on the first run.
  - [x] **UXD-005B — First-run empty state and the unsaved-changes guard.** (§11
        "Empty states" and "Form UX" fix a) A person with nothing recorded opens
        on one onboarding card instead of twelve section cards that each say
        nothing. The collapsed empty rail rows the review also lists here
        already shipped with `UXD-002B` and were not rebuilt.
    - [x] The card offers the review's three first actions. Each targets an
          eagerly mounted rail section, awaits the eager-rail promise before
          clicking that section's add control, and does nothing beyond focusing
          the section if the control is still hidden — an archived person or a
          failed section load never gets a click on a hidden control.
          `stay-in-touch` is focused rather than clicked, because it has no add
          button until `UXD-007B`.
    - [x] **Correction to review §11:** "zero records anywhere" is not knowable
          from what the page has. `?include=summary` counts fourteen of the
          twenty-two sections; important dates, gifts, debts, documents, photos,
          and a reminder with no next occurrence are outside it. Widening the
          projection means widening `PersonProfileSectionId`, which is also the
          personalization module key set that `profileSections` and `UXD-006`'s
          turned-off notice read, so it is an API leaf rather than a detail of
          this one. The card is therefore decided from those fourteen counts
          plus `stayInTouchAt` and `nextReminderAt`, and it is built so a wrong
          answer costs nothing: all four zones stay in the DOM,
          `[data-profile-section]` still counts 22, and the card gives way to
          `Show all sections`, to any zone filter button, and to any `?section=`
          link or deep link that targets a stream section.
    - [x] **Second correction to §11:** the section asks for `beforeunload`
          _plus_ intercepted in-page navigation. On the person page there is
          nothing to intercept — `?section=` and `?view=` are `pushState` only
          and never discard a form's values — so a confirm there would prompt
          about a loss that cannot happen. The two real exits are a document
          unload and a workspace switch, which is exactly the pair `settings.ts`
          already guards, and `unsaved-changes.ts` follows that module's shape
          rather than inventing a second one.
    - [x] A form is baselined when focus first enters it, not from
          `defaultValue`: the person page fills its edit forms by assigning
          `.value`, so a `defaultValue` comparison would report every opened
          edit form as dirty. Dirtiness is evaluated lazily and only counts a
          form that is still connected and visible, so a form the member opened,
          typed into, and cancelled blocks nothing.
    - [x] Known limitation, deliberate: the guard re-baselines on `submit`,
          which it cannot tell from a _successful_ save. A save that fails
          server-side leaves a visible form whose values are no longer
          protected. The alternative — never re-baselining — would prompt on
          every navigation after every successful save, which is worse.
    - [x] The full suite caught what static and unit gates could not: two flows
          create a person through `/app/people/new` and then reach a control
          inside a stream zone, which is now behind the card. `app-004a` failed
          `toBeDisabled` on the activities capture button and `app-004c` could
          not find `Log activity` at all, because `getByRole` does not match
          inside a `hidden` container. Both now walk the card the way a member
          does, proving it is there and then clicking `Show all sections`; no
          assertion was weakened. `app-003c` gained an axe scan of the card
          while it is on screen.
    - [x] Gates: `fmt:check`, `lint`, `check:web` (0 errors, 3 pre-existing
          `returnValue` deprecation hints), 462 web unit tests,
          `test:coverage:web` at 91.96/82.44/87.05/94.03 with the new guard
          module at 100/86.48/100, zero hex literals outside `:root`, and the
          complete Chromium suite 44/44.

### Then

- [x] **REL-017 — Assert approved people directory auth schemes.**
      `deno task test:contract` failed on `main`: the assertion pinned
      `GET /api/v1/people` to exactly `[{ kinship_session: [] }]`, but
      `80ae3582` delivered `API-001` and added `kinship_api_token` as an
      alternative. The contract was right and the test was stale. It now proves
      the session cookie remains a standalone alternative and every accepted
      scheme is approved, so anonymous reads still fail. Found only because
      `UXD-013` required a gate the earlier candidates had not been running.

- [x] **UXD-004 — Global people search and command palette.** (§8; effort M; no
      dependency) The only design-document requirement that was unimplemented
      and untracked elsewhere. The header's middle track had been sized
      `minmax(24rem, 1fr)` for a search field that was never built.
  - [x] One combobox serves both breakpoints by relocating into the dialog when
        it opens, so there is one input, one listbox, and one result renderer
        instead of two of each. The `.global-search > input` child selector
        stops applying once the input moves, which is what makes the single
        control work below 1050px where an icon button replaces it in the
        header.
  - [x] `Ctrl`/`Cmd+K` opens the palette from anywhere and `/` focuses the field
        unless a text control already has focus. Queries debounce at 200ms with
        an `AbortController` per keystroke; an empty query offers the five most
        recently viewed people from the read model Today already uses. No exact
        match appends Monica's synthetic add row, and the create form prefills
        from the names it passes.
  - [x] **Correction to review §8:** the row's secondary line is the nickname
        alone. §8 asks for "nickname · last contact", but `listPeople` returns
        `PeopleDirectoryPerson`, which carries no last-contact value. Inventing
        one, or firing a request per row to fetch it, would both be worse than
        showing less. A real last-contact column is a separate API leaf, the way
        `UXD-013` was.
  - [x] **The control is named "Find a person", not "Search people".** The
        people directory already owns that name for its own field, so two
        different controls would have shared one accessible name — something a
        screen-reader user hears directly. The palette dialog's heading had to
        move with them, because `aria-labelledby` kept the dialog matching the
        old name too.
  - [x] One specificity defect, measured rather than guessed. The icon button's
        `display: none` never applied:
        `:is(a, button):is(.button-primary,
        .button-secondary, .button-danger)`
        is (0,2,0) and `.global-people-search-open` is (0,1,0), so the button
        was focusable at every width and the keyboard walks gained two Tab steps
        instead of one. This is the third time the shared control rule has
        out-ranked a single-class rule in this phase; the fix is specificity,
        never source order, because `UXD-012` will reorder this stylesheet.
  - [x] Three specs changed: the `app-002c` and `auth-003` header keyboard walks
        each gained the one Tab step the new control earns — the `REL-001` and
        `REL-014` rule, where the walk is corrected and the tab order is not —
        and `app-003b` gained coverage of the search, the palette, Escape focus
        restoration, and the synthetic add row. `PEOPLE-002`'s trigger already
        reads "The member searches, filters, sorts, or browses people", so
        global search belongs to that flow rather than a new ID, and no new
        route means no new page-catalog entry.
  - [x] Gates: `fmt:check`, `lint`, `check:web`, 439 web unit tests,
        `test:coverage:web` at 91.79/82.27/86.67/93.87, zero hex literals
        outside `:root`, and the complete Chromium suite 44/44.
- [x] **UXD-008 — Persistent settings sidebar.** (§8; effort M; depends on
      `UXD-001`) All fifteen settings surfaces now share one sticky grouped
      navigation of settings destinations beside a content column capped in the
      accepted band, implementing
      [`dashboard-settings-design.md`](../product/dashboard-settings-design.md)
      rather than inventing a layout. Review §8 called this "not an open
      question" and it was right.
  - [x] The layout classes already existed and were used on exactly one page.
        `/app/settings` had `.settings-layout` with a `.settings-local-nav`, but
        that nav is an in-page anchor jump, not a list of destinations. The grid
        was reused; the destination navigation is new.
  - [x] **Role gating travels with each entry.** Every admin-only and owner-only
        destination carries the same `data-requires-workspace-admin` or
        `data-requires-workspace-owner` attribute its page declares, so
        `applySessionGating` strips it for a member who cannot open it. That
        reuses the mechanism the settings hub's cards already use rather than
        adding a second one, and it is asserted exhaustively over the gated
        destinations rather than sampled. The sidebar adds no client module, no
        fetch, and no listener.
  - [x] Group labels are the hub's non-heading `scope-label` treatment, not
        `<h2>`s. A second family of level-two headings on pages that already
        have one buys nothing and risks axe's `heading-order` rule.
  - [x] The workspace danger zone sits in its own group, because
        `information-architecture.md` forbids placing a destructive workspace
        action beside routine preferences.
  - [x] Below the existing 760px breakpoint the sidebar is hidden rather than
        stacked above the content, and `UXD-009`'s breadcrumb is the upward
        path. That rule landed in `person.css`, which is where the trailing
        `@media (max-width: 760px)` block lives after `UXD-012`'s contiguous
        split — the recorded consequence of naming those files for their
        predominant content, not a misplacement.
  - [x] Personalization's `?section=` navigation is untouched and nests inside
        the content column, which is the "focused subnavigator" the design
        document places there. `WORKSPACE-003` drives it and `REL-013` is a
        recorded race in it; restructuring it was not worth the risk for a
        layout leaf.
  - [x] **A correction to `UXD-001`, repaired in the same pass.** Five
        declarations in the personalization rules referenced `--ink`,
        `--ink-muted`, `--line`, and `--surface-raised`: four custom properties
        that are never declared and carry no fallback, so every one of them was
        invalid at computed-value time. The selected personalization nav item
        had no background at all and one row border had no colour. `UXD-001`
        verified that every declared token was referenced and never the reverse.
        They now map to `--ink-1`, `--ink-2`, `--line-1`, and `--surface-1`, and
        a permanent unit test fails on any fallback-less use of an undeclared
        property — a defect invisible to every other gate. Fixing it here was a
        precondition: generalizing a layout built on invalid properties would
        have spread it to fifteen pages.
  - [x] Every destination label was checked against every `getByRole` name in
        `tests/e2e/`. The overlaps are all headings or hub content on pages
        without a sidebar, so no locator became ambiguous and no spec changed.
  - [x] Gates: `fmt:check` 593 files, `lint` 477 files, `check:web` 0 errors,
        the Astro production build, 521 web unit tests, `test:coverage:web` at
        92.68/83.23/87.77/94.68, the hex invariant, the undeclared-property
        proof, and the complete Chromium suite 44/44 with an empty
        `.artifacts/playwright`.
- [x] **UXD-009 — Breadcrumbs on routes at least two levels deep.** (§8; effort
      S; no dependency) Twenty deep routes gained a breadcrumb naming their real
      position: the two person-scoped report shells, the journal item, add
      person, archived people, and every settings page including the import and
      workspace sub-trees. `/app`, `/app/people`, `/app/tasks`, `/app/journal`,
      and `/app/compliance` get none — the first four are one level deep and the
      last is a gate, not a hierarchy.
  - [x] One component renders the shape the person hero breadcrumb already used,
        so the application has one idiom: a `Breadcrumb`-labelled `<nav>`, links
        for every entry but the last, `aria-hidden` separators, and a final
        non-link entry carrying `aria-current="page"`.
  - [x] Fourteen back links went with them, because two competing wayfinding
        affordances are worse than either alone: eleven `All settings`, two
        `Import history`, both `← Back to person` with the code that set their
        `href`, and `Back to journal`. `New import` and `Create export` stayed —
        they are actions, not wayfinding. The person hero was deliberately not
        converted: its skeleton, `sr-only`, `data-person-breadcrumb-name`, and
        `aria-current` markup is driven by a controller and worth more intact
        than deduplicated. That duplication is recorded, not overlooked.
  - [x] **A recorded behavior change.** The activity report's back link pointed
        at `/app/people/:id?section=activities`; its breadcrumb points at
        `/app/people/:id`. A breadcrumb names the parent in the hierarchy, and
        review §8's actual complaint is that the back link asserted a journey
        the reader may never have taken — it is wrong for anyone who arrived
        from Today or from search.
  - [x] **A defect caught in review.** Both person-scoped crumbs resolved their
        name only on a _successful_ load, so a failed one left a link reading
        "Loading person…" pointing at the people directory, permanently — a
        regression against the deleted back link, whose `href` was set
        synchronously from the URL. The `href` is set synchronously again, and a
        terminal failure now replaces the skeleton with a plain `Person` label,
        with a focused test per shell.
  - [x] Every breadcrumb label was checked against every `getByRole` name in
        `tests/e2e/`, because Playwright matches accessible names as a
        case-insensitive substring and these labels duplicate header navigation
        links. `People`, `Settings`, and `Journal` all have unscoped page-wide
        locators, but each runs on `/app` or `/app/people`, neither of which has
        a breadcrumb. No collision.
  - [x] One spec amendment: `app-002e` proved the dirty-state guard by clicking
        `All settings` on the profile page. It now clicks the breadcrumb's
        `Settings` link, scoped to the breadcrumb navigation so it cannot match
        the member-menu entry. The guard assertion is unchanged.
  - [x] **An unrelated full-suite failure, given one bounded reproduction and
        queued rather than folded in.** `auth-002` failed once after
        `Accept invitation`, with the invitee on the public home instead of the
        welcome heading. The spec passes alone on clean `main` and alone on this
        candidate, and the whole suite passed on the very next run. Recorded as
        `REL-025`; nothing in this candidate touches the invitation flow.
  - [x] Gates: `fmt:check` 591 files, `lint` 476 files, `check:web` 0 errors,
        the Astro production build, 518 web unit tests, `test:coverage:web` at
        92.67/83.22/87.77/94.67, the hex invariant, and the complete Chromium
        suite 44/44 with an empty `.artifacts/playwright`.
- [x] **UXD-011 — Decide the Inter question: self-host or drop the name.**
      (§10.3; effort S; depends on `UXD-001`) **Decided: self-host.** Dropping
      the name would have made the declaration honest without fixing the defect
      the review names — typography was platform-random, not merely
      mis-declared. The rejected option was not hardened.
  - [x] `@fontsource-variable/inter@5.3.0`, exact-pinned as a `devDependency`
        with the lockfile committed, is the delivery mechanism. It is SIL Open
        Font License 1.1, it is bundled at build time by the install the
        production web image already runs, and nothing is fetched from an
        external host at runtime — the gateway stays the only public entry
        point.
  - [x] One `@font-face` in a new `fonts.css`, imported first by
        `application.css`, `auth.css`, and `public.css`. `application.css`
        therefore carries seven imports rather than `UXD-012`'s six: `fonts.css`
        is a shared asset declaration, not a seventh slice of that split.
  - [x] Only the latin subset ships. The `src` is a bare package specifier to
        the one `inter-latin-wght-normal.woff2`, with the `unicode-range` copied
        verbatim from the package rather than retyped, and `astro build` emits
        exactly **one** `woff2`. Importing the package's own `wght.css` would
        have declared fourteen subsets and put every one of them in the
        production image for an interface that fetches one.
  - [x] **A correction to the controller's ticket.** It counted four Inter
        stacks across three files and then forbade the file holding one of them;
        the implementer stopped rather than either missing the outcome or
        writing outside its allowed paths. There are eight, across four:
        `tokens.css`, `auth.css` twice, `public.css` four times, and
        `shell.css`. All eight now lead with `"Inter Variable"` and keep bare
        `Inter` behind it, so a reader who has the font installed locally still
        gets it.
  - [x] Deliberately not shipped, each recorded rather than overlooked: no
        italic face, so oblique stays browser-synthesised; no preload or loading
        script, because `font-display: swap` is the accepted strategy for a
        same-origin file; and no change to Georgia, which §10.3 keeps.
  - [x] **A consequence for `UXD-017` to absorb:** 33 `font-weight: 750`
        declarations now render as a genuine 750 instead of rounding to 700,
        because a variable face supports it. §10.3 wants those at 600 for
        controls and 700 for headings; changing them here would have mixed two
        decisions in one unreviewable diff.
  - [x] `.pnpm-store/` joined `.gitignore`. The dependency install populated the
        repository-local pnpm store this checkout is already linked to with 592
        MB of package artifacts, and an untracked directory that large is a
        `git add -A` away from being committed.
  - [x] Gates: `fmt:check` 589 files, `lint` 475 files, `check:web` 0 errors,
        the Astro production build with exactly one emitted `woff2`,
        `pnpm install --frozen-lockfile` clean, 516 web unit tests,
        `test:coverage:web` at 92.68/83.25/87.77/94.69, the hex invariant, and
        the complete Chromium suite 44/44 with an empty `.artifacts/playwright`.
- [x] **UXD-012 — Split the application stylesheet into six files.** (§10.7;
      effort S; depends on `UXD-001`) `application.css` is now six `@import`
      lines over `tokens.css`, `base.css`, `shell.css`, `settings.css`,
      `components.css`, and `person.css`. Scheduled before `UXD-016` and
      `UXD-017` so both are written against the final layout.
  - [x] The split is six **contiguous** ranges of the original file, moved
        verbatim and imported in the original order — lines 1-45, 46-234,
        235-586, 587-1415, 1416-1656, and 1657-3843. Nothing was reordered,
        merged, deduplicated, or retitled. That is the entire safety argument:
        several rules in this stylesheet have depended on source order, and
        every specificity defect this phase produced came from a rule winning by
        position.
  - [x] The proof is mechanical, not a judgement. Concatenating the six files in
        import order, with the boundary blank line restored at join time,
        reproduces the pre-split file **byte for byte**; the controller ran that
        diff independently and it is empty. File names therefore describe the
        predominant content of a range, not a tidy category — `person.css` also
        holds the directory, Today, journal, and compliance rules that follow it
        in the original. Rehoming those is a later ticket with its own evidence.
  - [x] The four unit tests that read the stylesheet as text now go through one
        shared helper that inlines the imports, so they still assert against
        "the application stylesheet" rather than against this ticket's file
        layout. Every one of their assertions is unchanged.
  - [x] **A defect caught in review:** the first candidate excluded five of the
        six new files from `deno fmt`, because each ended with the blank line
        the original had between rules. Turning a repository-wide gate off to
        protect a proof is the same failure `REL-022` and `REL-023` already
        recorded, and `UXD-016` and `UXD-017` are both scheduled to edit these
        files next. The separator now lives in the join rather than in the file:
        all six are formatter-clean, `deno.json` is untouched, and the
        byte-identical proof still holds.
  - [x] The hex invariant changed shape with the file. It is no longer a line
        range inside one file but
        `! grep -n '#[0-9a-fA-F]\{3,8\}' apps/web/src/styles/{base,shell,settings,components,person}.css`
        — only `tokens.css` may carry a literal. It returns empty.
  - [x] §10.7's other half, the reduced-motion rule that reset transitions but
        not animation, was already repaired by `UXD-007` and was left alone.
  - [x] Gates: `fmt:check` 588 files, `lint` 475 files, `check:web` 0 errors,
        the Astro production build, 515 web unit tests, `test:coverage:web` at
        92.68/83.25/87.77/94.69, the byte-identical concatenation, the new hex
        gate, and the complete Chromium suite 44/44 with an empty
        `.artifacts/playwright`. For a pure refactor the browser suite is the
        only real evidence, which is why it ran on a candidate that changed no
        behavior.
- [x] **UXD-014 — Optimistic UI on the safe mutations.** (§9.4; effort M;
      depends on `UXD-003` and `UXD-005`) Task complete and reopen, on both the
      task surface and the Today attention queue, and reminder and cadence
      saves. Anything carrying an expected update timestamp stays
      non-optimistic: person edit, archive and restore, and relationship writes
      are untouched, because the optimistic-concurrency discipline is a strength
      and a 409 is information rather than noise.
  - [x] **Two of the four the review names were corrected before dispatch.**
    - [x] **The favorite toggle does not exist.** `is_starred` has no write path
          in `packages/contracts/generated`, `apps/api`, or `packages/backend`;
          the client only reads it to render a badge. People favorites are
          parked in `UXD-020` as product scope. There was nothing to make
          optimistic, and no toggle was built to create the opportunity.
    - [x] **Note and quick capture were deliberately excluded.** Since
          `UXD-002C2B2d` a captured record appears in the merged timeline, whose
          single owner is `person-timeline.ts`, and `UXD-002C2B2a` already
          reloads it on the same successful save. A pending row written from
          `interactions.ts` would be a second writer into a list its owner is
          about to replace — the shape `AGENTS.md` forbids and `REL-013` prices
          — to save one round trip on a list that is already refreshing.
  - [x] The authoritative refresh stays the single owner everywhere. An
        optimistic change is a transient presentation on an existing row,
        superseded by that refresh on success and explicitly reverted on
        failure, with the row restored to its exact prior list and position. No
        generation, watermark, pending queue, or registry was added.
  - [x] **A defect the browser suite caught, reproduced in isolation.** The
        first candidate moved the completed row instantly but left its
        `renderTask` closure holding the pre-completion snapshot, so `app-006a`
        — and any reader — could click Edit on a row that had visibly moved
        while it still advertised `status: "open"` and a stale `updatedAt`. The
        save then either lost its concurrency check or flipped the task back to
        open, and the renamed task never reached the completed list. The
        optimistic move had made an interactive row available a round trip
        before its data. Every mutating control in an in-flight row is now
        disabled and the row carries `aria-busy`, both restored on failure; no
        spec was edited, because Playwright waits for an actionable control and
        lands on the freshly rendered one.
  - [x] **A second defect caught in review.** The pending row was styled
        `color: var(--muted, var(--ink-2))` with `opacity: .72`. `--muted` is
        declared nowhere — the fallback saved it, one leaf after `UXD-008`
        repaired four properties of that family — and compositing `--ink-2` at
        72% yields **3.635:1** on `--surface-1` and **3.547:1** on
        `--surface-2`, both under AA for normal text. That is the defect
        `UXD-001A` had to repair across 22 failing tests, and no gate would have
        caught it here: the row is transient and `aria-busy`, so no axe scan in
        the suite ever sees one. It now uses `--ink-3` at 5.572:1 with no
        opacity, and the candidate own test pins that and rejects any `opacity`
        in the rule.
  - [x] The implementer abandoned its first Today approach — detaching the row —
        when three existing concurrency assertions failed, and reported that
        rather than editing them. Hiding the row keeps the node and the
        established reconciliation intact.
  - [x] Gates: `fmt:check` 593 files, `lint` 477 files, `check:web` 0 errors,
        527 web unit tests, `test:coverage:web` at 92.72/83.37/87.78/94.72, the
        hex invariant, and the complete Chromium suite 44/44 with an empty
        `.artifacts/playwright`.
- [x] **UXD-015 — Parser-inert role gating on the application shell.** (§9.5;
      effort M; no dependency) **Parked, with the trace recorded.** The review's
      two stated consequences were checked against the shipped code before any
      work was dispatched, and neither survives.
  - [x] Consequence (a), "on slow devices a non-admin sees a flash of admin UI
        before JS strips it", cannot occur here. `ApplicationLayout.astro` wraps
        the header **and** the page `<slot />` in
        `<div id="protected-shell" hidden>`; `base.css` declares
        `[hidden] { display: none !important }`, so no author rule can reveal
        it; and `mountApplicationShell` calls `applySessionGating` **before**
        `renderSession`, which is the only place `root.hidden` becomes false.
        Gated markup is therefore never painted, never focusable, and never in
        the accessibility tree while it is still present.
  - [x] Consequence (b), "the shape of admin surfaces ships to every
        authenticated visitor", is real — and a `<template>` does not fix it.
        Template content sits in the served HTML exactly as it does now. §9.5
        itself names the actual remedy, moving those routes to on-demand
        rendering, which `information-architecture.md` permits only by ADR and
        which cuts against the accepted static-shell and gateway-rewrite pattern
        this phase is required to preserve.
  - [x] So the ticket as written would add a clone-and-remove mechanism, made
        idempotent across the two `applySessionGating` call sites `UXD-003C`
        created and able to withdraw a region on a role downgrade, in exchange
        for no user-visible change. `AGENTS.md` asks for the smallest observable
        contract and warns against adding another owner to a surface; building
        this would be the opposite.
  - [x] One real window exists and is **not** addressed by `<template>` either:
        between the optimistic session and its revalidation, a member whose role
        was downgraded sees admin UI, because the optimistic session claimed
        admin and any mechanism would have honoured it. That is inherent to
        optimistic rendering, not to the gating technique.
  - [x] What remains is a maintainability observation, not the review's item:
        role gating is declared two ways — a `data-requires-workspace-*`
        attribute that removes an element wherever it appears, and a page-id
        allow-list inside `applySessionGating` that blocks a whole route — so a
        reader must check both to know whether a surface is gated. Recorded here
        rather than queued, because no active outcome consumes it.
- [x] **UXD-016 — Dark mode.** (§10.5; effort M; depends on `UXD-001` and
      `UXD-011`) Split in three. §10.5 calls this "one ~28-line override block
      per mechanism", which is true only once every colour in the application
      stylesheets comes from a token — and eighty-eight of them did not — and
      only for the first of its two mechanisms.
  - [x] **UXD-016A — Retire the colour literals the hex invariant never saw.**
        **A correction to `UXD-001`.** Its entry reads "literals outside `:root`
        are zero", which is true of hex and narrower than it sounds: the guard
        this phase ran on every candidate only ever matched `#rrggbb`. Outside
        `tokens.css` there were still **45** uses of the `white` keyword and
        **43** of `rgb()` — eighty-eight hard-coded colours no theme override
        could reach, which would have left dark mode with that many pure-white
        and opaque-ink holes.
    - [x] Opaque `white` became `--surface-1` or `--ink-inverse`. Both are
          `#fffdf8`, a deliberately warm near-white, so those sites had been
          rendering pure `#ffffff` against the palette `UXD-001` chose — a small
          intended correction, not a no-op.
    - [x] Translucent literals became
          `color-mix(in srgb, var(--token) n%, transparent)` so they follow the
          theme rather than needing a second set of values. Every alpha is
          unchanged. One token was added, `--line-hairline`, for the 13% ink
          hairline border that recurs across the application.
    - [x] The grep hole is closed by making the invariant a permanent test
          rather than a command the controller has to remember. It fails on a
          hex literal, any of the 148 CSS named colours, or `rgb`, `rgba`,
          `hsl`, `hsla` in any of the five non-token application stylesheets,
          case-insensitively; `@media (forced-colors: active)` blocks are
          excluded by balanced-brace traversal because they deliberately use
          system colour keywords. The controller verified the guard bites:
          appending `color: white`, `background: #ABCDEF`, and
          `border-color: rgba(1, 2, 3, .5)` to `shell.css` reported exactly
          three violations.
    - [x] `auth.css` and `public.css` are deliberately out of scope. They keep
          their own `:root` blocks and their own `var(--x, <literal>)` fallback
          idiom, and `ApplicationLayout` never imports them.
    - [x] **One browser assertion moved, and not to another literal.**
          `app-006c` pinned the task status filter background to
          `rgb(255, 255, 255)` — the pre-token value of one of those 45 sites.
          It now reads `--surface-1` off the document and compares the two
          normalised through a probe element, so it tracks the token rather than
          a value. Pinning `rgb(255, 253, 248)` instead would have been the same
          defect one theme later.
    - [x] Gates: `fmt:check` 593 files, `lint` 477 files, `check:web` 0 errors,
          the Astro production build, 528 web unit tests, `test:coverage:web` at
          92.72/83.37/87.81/94.73, the widened invariant, and the complete
          Chromium suite 44/44.
  - [x] **UXD-016B — Dark mode for readers whose system asks for it.** One
        `@media (prefers-color-scheme: dark)` block overriding all 24
        theme-dependent tokens on `:root`, `color-scheme: light dark` so native
        controls follow, and paired `theme-color` meta tags in all three
        layouts.
    - [x] Every token the light block declares is overridden, enforced by a test
          that derives both sets from the file rather than listing names — a
          token left at its light value is a bright hole no invariant could see,
          because it lives in `tokens.css`, the one file allowed literals.
          `--line-hairline` is deliberately inherited: it is a `color-mix` over
          `--ink-1` and follows automatically.
    - [x] Families stayed paired and the `-soft` tokens stayed backgrounds for
          their own family text rather than becoming pale. `UXD-001` recorded
          two rules that had already crossed a family; a theme that lightens one
          half of a pair inverts them.
    - [x] **Contrast was computed, not chosen by eye, and verified twice.**
          `UXD-001A` is the precedent: 22 of 44 tests failed on axe colour
          contrast because a token was picked at 3.6:1. All 28 required pairings
          were computed by the implementer and independently recomputed by the
          controller from the committed `tokens.css`, reproducing every ratio
          exactly. Three values were raised before finishing: `--accent-soft`
          from 4.051 to 4.590, `--line-1` from 2.093 to 3.064 once its dialog
          and popover use showed it was not decorative, and `--line-2` to 3.644
          to keep the line hierarchy. The weakest text pair is `--ink-3` on
          `--surface-3` at 4.917:1.
    - [x] **The browser suite cannot see this theme**, because Playwright runs
          in the default light scheme. The controller verified it directly
          instead: the six stylesheets were inlined into a scratch page with
          representative markup and axe-core, opened under an emulated dark
          colour scheme, and scanned. `prefers-color-scheme: dark` matched, the
          dark tokens resolved, the body painted `rgb(18 25 21)`, and the axe
          `color-contrast` rule reported **zero violations**; flipping the
          emulation back to light also reported zero, proving the media query
          does not leak. The scratch directory was deleted afterwards.
    - [x] **An observed consequence, recorded rather than changed.**
          `.app-toast` is deliberately inverted against the page —
          `background: var(--ink-1)` with `color: var(--ink-inverse)` — so in
          dark mode it becomes a light chip on a dark page. That is the token
          semantics following through, it passes contrast, and changing it would
          mean introducing a dedicated toast surface pair, which is a design
          decision rather than a defect.
    - [x] `auth.css` and `public.css` keep their own `:root` blocks, so the
          authentication and marketing pages stay light while the application
          follows the system. Their `theme-color` tags were paired anyway, since
          leaving them light while the application flips would be an obvious
          inconsistency.
    - [x] Gates: `fmt:check` 593 files, `lint` 477 files, `check:web` 0 errors,
          the Astro production build, 531 web unit tests, `test:coverage:web` at
          92.72/83.37/87.81/94.73, the colour-literal invariant, the complete
          Chromium suite 44/44 with an empty `.artifacts/playwright`, and the
          dark-scheme axe probe above.
  - [x] **UXD-016C — The explicit theme toggle.** System, Light, and Dark in a
        new Appearance block on `settings.preferences`, saved on change through
        the existing `PATCH /api/v1/member/ui-state`, durable as a second
        recognised `ui_state` key, and applied through `[data-theme]` on the
        root element: the dark media block's selector became
        `:root:not([data-theme="light"])`, an explicit
        `:root[data-theme="dark"]` block repeats the dark declarations, and each
        explicit block pins `color-scheme`. No token value changed.
    - [x] **Two owners, recorded deliberately.** `kinship.theme` in localStorage
          exists only so an inline first-paint script in `ApplicationLayout`'s
          head can set `data-theme` before anything renders; `ui_state` owns the
          value. Every session resolution and revalidation reconciles the
          attribute and the cache from `session.uiState.theme` — including
          removal when the stored choice is absent or `system` — and a
          successful save rewrites the cached session the `UXD-002C3B` way,
          without which the sixty-second cache would revert the theme on the
          next navigation. The auth and public layouts carry no script and stay
          light, per `UXD-016B`.
    - [x] **A defect caught in review: the select dropped keyboard focus.** The
          first candidate disabled the control while its save was in flight, and
          disabling a focused control drops focus to the body — Chrome fires
          `change` per arrow press on a closed select, so a keyboard member
          stepping through the options lost focus on the first press. The
          disable became a depth-one coalescing queue: every change applies
          instantly, saves are issued strictly sequentially in user order, an
          intermediate outcome never touches the status or the session cache,
          and a failure reverts to the last durably saved theme. A regression
          test drives two changes against a held first save and asserts order,
          focus, and the final state.
    - [x] **The controller's ticket omitted `deno.json` from the owned paths**,
          so the new `member_ui_state_test.ts` arrived wired into no task — the
          `REL-023` class exactly. Authorized in review and added to the file
          lists of both `test:unit:api` and `test:coverage:api:direct`; the test
          reads nothing, so neither `--allow-read` list changed. `test:unit:api`
          went 295 to 298 and the PostgreSQL run 526 to 529.
    - [x] The token test now derives both dark blocks and requires them
          value-identical — drift between the media-guarded and explicit dark
          blocks is the defect it exists to catch — and pins the first-paint
          mechanism: the inline script sits inside `<head>`, is `is:inline`, and
          names the same storage key as `theme.ts`, the one deliberate string
          duplication.
    - [x] The browser suite gained its first sight of the dark theme: `app-002e`
          forces Dark, asserts the attribute and a changed body background
          without pinning a literal, runs the axe scan under the forced theme,
          and proves durability through the API by deleting the localStorage key
          before reloading. The forced-light-under-dark-system case is invisible
          to Playwright's light scheme, so the controller probed it directly:
          the full two-by-three matrix of system scheme against override
          resolves the correct palette, with forced light under an emulated dark
          scheme rendering `#f4f0e7` and `color-scheme: light`.
    - [x] Meta `theme-color` follows a forced theme by writing the computed
          `--surface-page` into both tags and restoring the captured originals
          on `system`, so no colour literal entered TypeScript.
    - [x] Recorded limitations, deliberate: no cross-tab live sync — each tab
          reconciles on its own resolution; a different member on the same
          browser can see the previous member's cached theme for one round trip
          until reconciliation rewrites it; a failed save reverts and announces,
          with no retry queue.
    - [x] Gates: `fmt:check` 596 files, `lint` 480 files, `check:web` 0 errors,
          `contracts:check`, `test:contract` 125 passed, `test:unit:api` 298
          passed / 0 failed, 541 web unit tests, `test:coverage:web` at
          92.79/83.45/87.91/94.77 with `theme.ts` at 100/95/100/100, the
          colour-literal invariant, the Astro production build with the inline
          script verbatim in every prerendered app page, `test:coverage:api`
          against real PostgreSQL 529 passed / 0 failed at 85.1/82.2/87.3, the
          complete Chromium suite 44/44 with an empty `.artifacts/playwright`,
          and the theme-matrix browser probe above.
- [x] **UXD-017 — Type-scale and spacing-rhythm pass.** (§10.3, §10.4; effort M;
      depends on `UXD-001` and `UXD-011`) Split in two before dispatch: the type
      scale and weights are one mechanism and the spacing steps and card
      densities another, and a single candidate sweeping both across five
      stylesheets would be unreviewable.
  - [x] **UXD-017A — Type-scale pass.** (§10.3) The display scale left the
        application: every app page `h1` — `.page-heading`, `.settings-heading`,
        `.access-card`, `.created-person`, `.person-profile-state` — is now
        Georgia 1.75rem/1.15 at 500 instead of `clamp` scales peaking at 77px,
        and the public and auth display headings took §10.3's
        `clamp(2.4rem, 5vw, 3.4rem)`. Group `h2`s — the four person-page zones,
        the first-run card, the settings section families, the directory states
        — dropped Georgia for the Inter stack at 1.15rem/1.3, 700. Both `h3`
        roles are Inter .95rem/1.35, 700 with .01em tracking; the rail `h3` had
        quietly been Georgia and is not any more.
    - [x] **Two interpolations the review's table lacks, recorded as such.** The
          section-card `h3` has no row — the table predates `UXD-002C`'s heading
          demotion — and after the zone `h2` drop to 1.15rem its Georgia
          `clamp(1.45rem, 3vw, 2rem)` would have out-ranked its own parent, so
          it takes the Block role. The task-board `h4`s had no size rule and the
          UA default would likewise have out-ranked the card `h3`; they are
          Inter .875rem/1.35, 700.
    - [x] **The weight zoo is gone and cannot regrow.** §10.3 names only the
          750s; the census found 46 illegal declarations — 32×750, 10×800,
          2×850, 2×650 — across the five application stylesheets. Controls,
          navigation, chips, and form labels took 600; headings, `dt`/`dd`
          emphasis, badges, and status text took 700; the classification table
          is in the candidate's review record. A permanent test beside the
          colour invariant fails on any `font-weight` outside {500, 600, 700},
          keywords included, and its RED run counted exactly the 46.
    - [x] **The implementer stopped on the closed mapping, and it was right.**
          The controller's heading census keyed on `font-size` lines and missed
          a shared family-only rule covering `.duplicate-warning h2`,
          `.created-person h1`, and `.profile-next-step h2`. The authorized fix
          is the one selector split in the candidate: the `h1` keeps its Page
          role, the two `h2`s take the Group role. Three non-heading 500s
          surfaced by the invariant were reclassified under the same
          authorization: two checkbox-row labels to 600 as control labels, and
          the three small-print hints to the inherited default.
    - [x] **Deferred with measurements recorded, not overlooked:** body text is
          1rem/normal against §10.3's .95/1.5, `.section-state` meta inherits
          1rem on `--ink-1` against .82/1.45 on `--ink-2`, and the three badge
          families sit at .7/.75/.8rem against .72/1.3. Sizing running text is a
          different risk from sizing headings, so it belongs to a later bounded
          slice, not this one.
    - [x] Two authorized test amendments and nothing else: the shared-control
          computed pin moved from 750 to 600, and the card-`h3` regex from the
          Georgia clamp to the Block role. No `tests/e2e/` file changed.
    - [x] Gates: `fmt:check` 596 files, `lint` 480 files, `check:web` 0 errors,
          542 web unit tests, `test:coverage:web` at 92.79/83.45/87.91/94.77,
          the colour and weight invariants, the Astro production build, the
          complete Chromium suite 44/44 with an empty `.artifacts/playwright`,
          and a rendered browser probe confirming the computed hierarchy — 32px
          person name, 28px page `h1`, 18.4px zone `h2`, 15.2px `h3`, 14px `h4`,
          600-weight controls — with no inversions. No API gate applies: the
          candidate touches five stylesheets and two web tests.
  - [x] **UXD-017B — Spacing-rhythm pass.** (§10.4) The five application
        stylesheets' 298 spacing declarations now sit on the shared scale: every
        on-scale literal became its `--space-1…8` token, the off-scale values
        snapped by a fixed band map, and the two densities became tokens —
        `--pad-card` 1.25rem replacing the uniform `clamp(1.1rem, 3vw, 1.6rem)`
        §10.4 names as a cause of the flat feel, `--pad-block` .875rem on the
        rail. Measured in the browser: card padding 20px against rail 14px, the
        density contrast the review asks for, with buttons snapped from
        10.4/14.4px to 12/16px.
    - [x] **The census, corrected:** the review said 17 arbitrary steps; the
          count was ~176 off-scale declarations across ~36 distinct values, and
          the invariant's RED run flagged 233 sites including the tokenizable
          on-scale literals.
    - [x] **A planned checkpoint, not a stop:** the ticket required the
          implementer to halt after the unambiguous bands and table the 23
          decision-dependent sites. Twenty-one were approved as proposed — seven
          card surfaces onto `--pad-card`, the `.page-frame` endpoints onto
          tokens, the 1.2/1.25rem band split between `--space-4` and `--space-5`
          by role. Two were amended: the `select`'s 2.35rem caret clearance
          stays a literal exception because it is component geometry, not
          rhythm; and the person hero keeps a responsive clamp with tokenized
          endpoints, `clamp(var(--pad-card), 4vw,
          var(--space-6))`,
          rather than flattening the §7.1 showcase surface to a fixed 1.25rem.
    - [x] **Fixed exceptions, each carrying its reason in the invariant:** the
          §7.5 workspace grid gap 1.25rem at the 1199px step is an accepted
          layout value and stays literal; the two −1px clipping offsets on
          `.sr-only` and the tag-picker legend; the .1rem directory-nav gap; the
          caret clearance. `forced-colors` blocks and `scroll-margin-top`
          clearances are out of the invariant's property set entirely.
    - [x] **The invariant is permanent:** beside the colour and weight tests,
          every `padding`/`margin`/`gap` declaration in the five files must be
          `0`, `auto`, a percentage, a `--space`/`--pad` token, an approved
          page-level `clamp()`, or a listed exception. The dark-token derivation
          test's deliberately-inherited filter gained the `--pad-` prefix, since
          the density tokens are theme-independent.
    - [x] **Recorded deferral closing the `UXD-017A` measurement note:**
          running-text sizes stay as they are — body 1rem against §10.3's
          .95/1.5, `.section-state` meta at inherited size on `--ink-1` against
          .82 on `--ink-2`, badges at .7–.8rem against .72. Running text is a
          third mechanism, none of those values is a contrast defect, and a
          future slice can take the recorded numbers if the density of
          information surfaces ever argues for it.
    - [x] Gates: `fmt:check` 596 files, `lint` 480 files, `check:web` 0 errors,
          543 web unit tests, `test:coverage:web` at 92.79/83.45/87.91/94.77,
          the colour, weight, and new spacing invariants, the Astro production
          build, the complete Chromium suite 44/44 with an empty
          `.artifacts/playwright`, and a rendered browser probe confirming the
          computed rhythm — card 20px, rail 14px, hero clamped at 32px, page
          frame 48px, §7.5 gap intact at 20px. No API gate applies.
- [x] **UXD-018 — Command mode in the palette.** (§8; effort M; depends on
      `UXD-004`) A `>` prefix switches `UXD-004`'s palette to a local command
      index — three actions (`Log interaction` through the header's wired
      quick-capture opener, `Add person`, `Add task`), the five primary
      destinations, and the thirteen settings destinations labelled
      `<Group> · <Label>` so short names stay unambiguous in a flat list. §8's
      other trigger ships too: a people query with zero matches appends the
      matching command rows after the synthetic add-person row. Filtering is
      synchronous — no request, no debounce — and the combobox pattern, key
      handling, and focus restoration are the shipped ones, with activation
      centralized in one helper so the Enter and click paths cannot drift.
  - [x] **Correction to §8, recorded:** it sources commands from "the index
        `settings/index.astro` already declares", which predates `UXD-008`. The
        authority is now one shared module, `settings-destinations.ts`, moved
        verbatim out of `SettingsNavigation.astro`'s frontmatter and imported by
        both the component at build time and the palette at runtime, so the
        labels, hrefs, and access levels cannot fork. The controller verified
        the component's rendered HTML is byte-identical before and after by
        hash.
  - [x] **Role gating travels with the index:** the palette filters destinations
        by the session's member role against each entry's access level, so a
        member is never offered an admin or owner destination. Asserted per role
        in unit tests.
  - [x] **The implementer stopped on `settings-navigation.test.ts`** — outside
        its owned paths, the controller's third owned-paths omission this phase
        — because that test regexed the frontmatter literals the extraction
        moved. Authorized amendment: the exhaustive 13-entry role-gating
        expectation now derives from the shared module itself, which is strictly
        stronger, plus an assertion that the component imports it, so an inline
        list cannot quietly return.
  - [x] **A defect caught in review:** command mode with zero matches left a
        sighted member a completely blank panel — the status region is `sr-only`
        and the empty element was forced hidden. Each render path now writes its
        own empty text, `No commands match` against `No people match`, so the
        two modes cannot leak copy into each other.
  - [x] One spec amended, additively: `app-003b` filters `> import`, asserts the
        `Data · Import` row scoped to the results list, lands on the import
        page, then activates `Log interaction` and proves the quick-capture
        dialog opens. Count is asserted before visibility, per the recorded
        trap.
  - [x] Gates: `fmt:check` 597 files, `lint` 481 files, `check:web` 0 errors,
        548 web unit tests, `test:coverage:web` at 92.85 statements, the three
        stylesheet invariants, the Astro production build, and the complete
        Chromium suite 44/44 with an empty `.artifacts/playwright`. No API gate
        applies.
- [x] **UXD-019 — Mobile bottom-sheet editors below the tablet breakpoint.**
      (§7.7; effort M; depends on `UXD-002`) Below the collapse breakpoint an
      open rail editor — important dates, relationships, all seven profile
      facts, and the stay-in-touch cadence — presents as a bottom sheet: fixed
      to the viewport bottom, `--surface-1` on `--shadow-2` with rounded top
      corners, `var(--pad-card)` padding, an `80dvh` cap with its own scroll,
      and a pointer-inert scrim mixed from tokens dimming the page behind it. At
      761px and up nothing changes; every form stays exactly where it was in the
      DOM.
  - [x] **Two corrections to §7.7's sketch, decided before dispatch.** The
        breakpoint is 760px, not 900px: `UXD-002` deliberately kept the
        application's established mobile step, and the sheet binds to the same
        media block that collapses the workspace to one column rather than
        adding a third band. And there is no `<dialog>`: wrapping a dozen forms
        would have changed every open/close site in four modules and made mobile
        modal where desktop is inline — a behavior divergence for a presentation
        change. The sheet is CSS on the open in-place form.
  - [x] **§7.7's one-open-editor rule shipped with the sheet, because the sheet
        makes it load-bearing** — two open rail editors below 760px would be two
        overlapping fixed sheets. `rail-editors.ts` is a stateless document
        event carrying the opened form and a subscription helper; each owning
        module announces on open and closes its own open editors when a foreign
        one announces — hide plus `reset()`, which re-baselines the `UXD-005B`
        unsaved-changes guard, and deliberately without the focus restore, which
        belongs only to a real Cancel. The hero tags editor participates in
        coordination because `profile-facts.ts` owns it alongside the seven rail
        forms; the stream column is untouched and recorded as outside this leaf.
  - [x] Before any code, every browser spec and unit test that opens a rail
        editor was swept for an open-A-then-open-B-without-cancel sequence. One
        existed, in `app-004c`, and nothing asserted both forms visible, so the
        new rule changes what a member sees only in the way the review asks.
  - [x] Two specs amended, additively. `app-004b`'s existing 390×844 section
        opens the date editor, proves computed `position: fixed` with the form's
        bottom on the viewport edge without pinning pixels, runs the axe scan
        while the sheet is open, and proves Cancel hides it and restores focus
        to the add control. `app-004c` at desktop width opens two fact editors
        and proves the first hides — count before hidden-ness — while focus sits
        in the second.
  - [x] The z-order was checked against the shell's scale, not assumed: the
        scrim at 40 and sheet at 41 sit above the sticky header and zone
        switcher (20/30) and below the 100-level overlay. The controller's
        rendered probe confirmed the stacking and the sheet's presentation under
        both themes.
  - [x] Gates: `fmt:check` 599 files, `lint` 483 files, `check:web` 0 errors,
        555 web unit tests across 45 files, `test:coverage:web` at 92.88
        statements with the coordinator at 100, the three stylesheet invariants,
        the Astro production build, and the complete Chromium suite 44/44 with
        an empty `.artifacts/playwright`. No API gate applies.
- [ ] **UXD-020 — Deferred product features named in §12 row 20.** Notifications
      centre, people favorites, life-event mutation, and directory tag cloud and
      sort are product scope, not design debt. They stay parked until their
      product contracts exist; life-event mutation still depends on the open
      flow decision in [`traceability.md`](traceability.md).
- [x] **DOC-001 — Refresh the planning entry-point baseline.** The Current
      Baseline table in [`README.md`](README.md) described a pre-scaffold
      repository with zero delivered flows, and
      `tools/product/PRODUCT-001/release_contract_test.ts` pinned that zero, so
      the executable check was defending the wrong document. Both are fixed
      together. This continues review §5.3 item 5 beyond the traceability
      correction shipped with this queue.
  - [x] The delivered-flow assertion no longer pins a literal. It derives the
        count and the total from the flow catalog the same test already parses,
        so a newly delivered flow fails loudly until the baseline records it,
        rather than silently agreeing with a stale number.
  - [x] **A third stale row the ticket had protected.** The controller's ticket
        listed the schema row as still true and told the implementer to leave it
        alone; the implementer checked it anyway and stopped. It was stale three
        ways — v6's 87-table and 811-column counts, and v6's PostgreSQL 17.10
        compatibility result attributed to the current baseline.
        `personal_crm_schema_v7_validation.json` records 89 tables and 843
        columns, the field catalog has 843 rows, and `AGENTS.md` assigns the
        17.10 result to the immutable v6 baseline. Corrected under explicit
        authorization.
  - [x] **A correction to the ticket in the other direction.** It asserted every
        item on the missing-scaffold list now exists. Two do not: there is no
        `.github/workflows` and no lefthook configuration, so CI and hooks stay
        recorded as pending rather than being quietly claimed.
  - [x] Gates: the focused `release_contract_test.ts` run 5 passed, `fmt:check`,
        and `lint`. No other gate applies — see `REL-023`.

- [x] **REL-023 — Give the PRODUCT-001 release contract a gate that runs it.**
      No `deno task` executed
      `tools/product/PRODUCT-001/release_contract_test.ts`. That is why its
      `Delivered flows | 0` pin stayed wrong long enough for `DOC-001` to exist,
      and why nothing would have caught the next drift either: an executable
      contract no task runs is documentation with extra steps. Second
      gate-shaped defect found this phase after `REL-022`.
  - [x] The contract now sits in the file list of both `test:unit:api` and
        `test:coverage:api:direct`, and all six documents it reads —
        `user-flows.yaml`, `page-catalog.yaml`, and `release-slices.md` under
        `docs/product/`, plus `README.md`, `roadmap.md`, and `traceability.md`
        under `docs/planning/` — are in both `--allow-read` allowlists. Adding a
        `tools/*_test.ts` that reads a new file to only one of the two is the
        omission this ledger already records as having broken three tickets, so
        every path was proven load-bearing by an omit-one probe returning
        `NotCapable` for exactly the withheld document.
  - [x] `tools/product` is deliberately absent from the coverage `--include=`
        flags, so the wiring adds an executed contract without moving the
        coverage denominator. The diff is four additions inside two task strings
        and touches nothing else.
  - [x] The gate was proven to catch the drift it exists for rather than merely
        to run. Reinstating `DOC-001`'s defect by changing the delivered-flow
        pin in [`README.md`](README.md) to `28 of 30` fails `AC-03` on
        `planning delivered flow total matches catalog`; the document was
        restored immediately.
  - [x] **The implementer's two reported failures were sandbox-only.** It
        measured `test:unit:api` at `293 passed | 2 failed` and attributed the
        two to the environment: both
        `E2E canonical Astro child remains live outside CI` and
        `Windows cleanup terminates and proves absence of the exact PID tree`
        spawn `pnpm exec astro dev`, which that sandbox cannot reach. Rerun by
        the controller the same task is `295 passed | 0 failed`, exactly five
        more than the 290 it ran before this leaf.
  - [x] Gates: `test:unit:api` 295 passed / 0 failed with the five `PRODUCT-001`
        tests among them, `test:coverage:api` against real PostgreSQL 526 passed
        / 0 failed at 85.1 / 82.2 / 87.3, `fmt:check` 580 files, and `lint` 473
        files. No web or browser gate applies.
- [x] **REL-026 — Withdrawn; the claim was wrong.** It was queued while
      accepting `UXD-008` on the reading that `audit.astro` carries no
      `data-requires-workspace-admin`, so a member reaching that route would get
      the page shell. That is false. `applySessionGating` in `app-shell.ts`
      gates by route as well as by attribute, and `settings.audit` is in its
      route list, so a non-admin gets `renderRouteForbidden` — the application
      root hidden and a forbidden view — before any of the page is usable. The
      page catalog, the authorization matrix, the settings hub card, and the new
      sidebar entry all agree that it is `[owner, admin]`, and nothing is
      ungated. Checked properly on the second look; recorded rather than quietly
      deleted, because the ledger held a false claim for one commit.
  - [x] The real observation, which belongs to `UXD-015`: this application
        expresses role gating **two** ways — a `data-requires-workspace-*`
        attribute that removes an element wherever it appears, and a page-id
        allow-list inside `applySessionGating` that blocks a whole route. They
        are not redundant, they do different jobs, but a reader must check both
        to know whether a surface is gated, and `audit.astro` uses only the
        second. Whatever `<template>`-based mechanism replaces this should make
        one declaration answer the question.
- [ ] **REL-025 — Watch the `auth-002` invitation acceptance.** One full-suite
      run during `UXD-009` failed after `Accept invitation`: the invitee page
      was the public home rather than the `Welcome to <workspace>` heading, so
      the accepted session never reached the application. Given one bounded
      reproduction — the spec passes alone on clean `main` and alone on the
      candidate, and the whole suite passed on the next run — so it was queued
      rather than folded into a candidate that touches no part of the invitation
      flow. Recorded rather than diagnosed, so a recurrence has a trail. Treat a
      second occurrence as a real ordering or shared-state defect, not a flake;
      `REL-003` already had to serialize this stack once.
  - [ ] **Second occurrence, investigated at the Phase 12 checkpoint.** The
        first all-browser aggregate failed `auth-002` on chromium at a different
        step: the owner's mismatched-email acceptance never showed
        `Invitation unavailable` within its five-second expectation. The
        controller traced the client path — the accept handler is provably wired
        before the button becomes visible, so the only way the heading stays
        stale is `acceptWorkspaceInvitation` not resolving in time under the
        132-run marathon's load. The spec passed alone and passed the full
        rerun. Still a watch, now with a mechanism: an await-bound render behind
        a tight expectation under sustained load, not an ordering defect the
        client can fix. A third occurrence should consider the expectation
        budget on this step before anything else.
- [x] **REL-024 — Run the five remaining unreferenced architecture contracts.**
      Found while wiring `REL-023`, by asking its question of every `*_test.ts`
      in the repository rather than only the one file the ticket named. Five
      more executable contracts are in no `deno task`:
      `tools/architecture/APP-004C/profile_fact_configuration_boundary_test.ts`,
      `APP-004E/personalization_boundary_test.ts`,
      `APP-005A/interaction_write_ownership_test.ts`,
      `FND-001S/astro_rendering_topology_contract_test.ts`, and
      `FND-002/coordination_contract_test.ts`. All five pass when run by hand
      today, so this is wiring rather than repair, but each needs its own read
      allowlist derived and added to both lists. Kept out of `REL-023` because
      five contracts with five different permission sets are a different size of
      change from one, and the candidate that wires a passing contract should
      not be the candidate that discovers a failing one.
  - [x] Delivered as a two-line `deno.json` diff: the five files joined the test
        lists of both `test:unit:api` and `test:coverage:api:direct`, and
        nineteen new read grants — nine adapter and facade sources, `AGENTS.md`,
        and nine architecture documents — joined both `--allow-read` allowlists,
        each proven load-bearing by an omit-one probe returning `NotCapable` for
        exactly the withheld path. `docs/product/page-catalog.yaml` was already
        granted and was not duplicated. `tools/architecture` stays out of every
        coverage `--include=`, so the executed contracts moved no denominator.
  - [x] Gates: the five contracts pass inside both tasks — `test:unit:api` 306
        passed / 0 failed and `test:coverage:api` against real PostgreSQL 537
        passed / 0 failed at 85.2 / 82.2 / 87.3 — with `fmt:check` 599 files and
        `lint` 483 files. No web or browser gate applies.
- [x] **REL-027 — Skip PERF-001 off its timing engine instead of failing.** The
      phase checkpoint's first all-browser run since `PERF-001` landed failed
      the spec deterministically on firefox and webkit:
      `tests/e2e/perf-001.spec.ts` pinned its measurements to the accepted
      profile's timing engine by asserting the browser name rather than
      skipping. The assertion became `test.skip` with the calibration reason;
      the intent — timings only from the calibrated engine — is unchanged, and a
      matrix run now reports the truth: 1 passed on chromium with real timings,
      2 skipped. Two of the checkpoint's seven failures were this.
- [x] **REL-028 — Give the sheet bottom-alignment assertion a subpixel
      tolerance.** `UXD-019`'s mobile-sheet check computed
      `bounds.bottom === innerHeight`, and firefox fails that deterministically:
      the controller instrumented the failing run and measured
      `844.0000152587891` against `844` — fifteen millionths of a pixel of
      fractional layout arithmetic, with the sheet's top at exactly the `80dvh`
      cap, so the production CSS was correct and the strict equality was the
      defect. Invisible to every chromium-only candidate gate. The assertion now
      bounds a numeric `bottomDelta` at one pixel absolute, so a future failure
      prints the measured number instead of `false` — the diagnosability gap
      cost three instrumented reruns. Proven 2 passed on firefox and chromium
      together.
- [x] **REL-029 — Harden the direct-psql fixture channel against transient exec
      failure.** Ten browser specs duplicate a `databaseValue` / `databaseSql`
      helper that shells out to `docker compose exec -T postgres psql` for
      fixture reads and writes. In each of the two all-browser marathon runs at
      the Phase 12 checkpoint, exactly one such call failed transiently —
      `app-004e` on firefox in the first run and `app-003a` on firefox in the
      second, the latter at a point where the queried row provably existed,
      since the member had already signed in and created a person through the UI
      — and both specs pass alone. The class is transport, not data:
      `docker compose exec` under a sustained multi-engine run. The remedy is
      one bounded retry with backoff in the helper, applied to every copy or to
      one extracted shared helper — `REL-014` is the recorded cost of fixing one
      duplicate and missing the rest. Queued open rather than blocking
      acceptance: the channel predates this phase, nothing in the phase touches
      it, and 264 engine-runs at the checkpoint produced zero application
      failures.
  - [x] Delivered as one bounded retry around every copy in place, not an
        extracted module: `tests/e2e` deliberately holds only self-contained
        specs with zero cross-spec imports, and a reliability leaf does not
        introduce the directory's first shared module. Each carrier spec gained
        an identical local `withExecRetry` — three attempts, retrying only a
        thrown `execFileSync`, a synchronous 250 ms `Atomics.wait` backoff, and
        successful-but-empty output returned untouched, because empty stdout is
        data. A genuine SQL error under `ON_ERROR_STOP` still fails three times
        fast, which is honest.
  - [x] The `REL-014` rule found the count wrong here too: an exhaustive
        `execFileSync` sweep turned up sixteen carrier specs, not the ten the
        evidence grep named. `auth-002` hides the read channel as
        `databaseWorkspaceId`, and `app-005b`, `app-005c`, `app-008b`,
        `app-008c`, `app-009c`, and `app-009d` carry it as a combined
        `database(statement, tuples)` helper. All twenty-five psql exec sites
        are wrapped; `perf-001`'s `runWorkerTick` execs a side-effectful worker
        tick, not the psql channel, and deliberately stays unwrapped.
  - [x] No unit test and no injectable exec seam: the retry cannot be forced
        without fault injection, and an infrastructure change takes an
        executable smoke. Evidence is the mechanical diff — every assertion, SQL
        statement, and call site byte-identical — Playwright `--list` collecting
        all sixteen specs, `deno fmt --check` and `deno lint` over the touched
        files, and the full chromium suite 44 passed / 0 failed with an empty
        `.artifacts/playwright`.
- [x] **Phase 12 accepted:** the person workspace reads as grouped zones rather
      than peer cards, first paint no longer waits on the full section fan-out,
      tokens back every surface, and no leaf above is unchecked without a
      recorded parked reason.
  - [x] The checkpoint aggregate ran on `main` after `REL-027` and `REL-028`:
        the full three-engine browser suite 129 passed / 0 failed / 2
        deliberately skipped (the `PERF-001` calibration skips) with an empty
        `.artifacts/playwright` except the one `REL-029` transport incident
        reproduced to pass alone; `test:coverage:web` 555 tests at
        92.89/83.55/88.10 with the colour, weight, and spacing invariants;
        `test:coverage:api` on real PostgreSQL 537 passed / 0 failed at
        85.2/82.2/87.3; `test:unit:api` 306 passed / 0 failed; `test:contract`
        125 passed; `contracts:check`; `check:web` and `check:api` clean;
        `fmt:check` 599 files; `lint` 483 files; and the Astro production build.
        The production-like `api`, `web`, `gateway`, `worker`, and `migrate`
        images are built fresh by every browser run. The schema matrix was
        deliberately not run: Phase 12 changed no schema, and the matrix belongs
        to the schema and release checkpoints.
  - [x] The first aggregate run found seven failures, every one dispositioned
        rather than waved through: two deterministic spec defects repaired and
        proven (`REL-027`, `REL-028`), one transport class queued with its
        evidence (`REL-029`), and four load-shaped single incidents — all four
        passed alone and passed the rerun, with the `auth-002` recurrence
        analysed under `REL-025`.

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

## Phase 13 — Person Blocks And Usability Repair

User-directed on 2026-09-05. This work follows the accepted Phase 12 checkpoint
and takes priority over the parked deployment work.

- [x] **PRF-001 — Present the person workspace as responsive blocks.**
  - [x] Pair readable fact cards beside wider timeline content on large screens;
        stack them on phones and keep natural page scrolling. Put the section
        directory above the blocks and close it when selecting a destination.
  - [x] Preserve canonical section IDs, lazy loading, role gating, local
        actions, deep links, and mobile editors. Present saved contact labels,
        work dates and description, pet notes, and introducer links in labeled
        details.
  - [x] Focused rendering and navigation regressions observed RED, then GREEN;
        affected layout expectations updated. Browser coverage checks 1440,
        1050, 768, 390, and short 375 widths, long values, editing, and keyboard
        cancellation. Real pointer checks prove menu access after scrolling;
        selected headings clear the navigator. On smaller person pages, the
        global header scrolls away and the local navigator is the sticky owner.
- [x] **PRF-002 — Remove focus borders that cover content.** Keep visible
      keyboard focus, skip links, section navigation, and forced-colors support;
      distinguish interactive controls from programmatic navigation targets.
  - [x] Use external control outlines and localized text cues for navigation
        destinations, with clearance inside scrollable navigation. Focused
        browser regression, 16 control tests, and five product-contract checks
        pass; the existing PEOPLE-002 catalog references the new regression.
  - [x] Invalid person/settings fields retain the full focus outline. The
        focus/Today regressions pass across three browser engines. WebKit uses
        explicit fixture tab stops for focus presentation and activation; that
        fixture does not establish default native anchor tab reachability.
- [x] **APR-000 — Review the application and dispatch its repair plan.** Check
      remaining composition, architecture, and UX defects against current code
      and rendered behavior. Write a prioritized sequence with evidence,
      acceptance criteria, and focused verification, then start its execution in
      a new project task with a clean context.
  - [x] The independently reviewed
        [application repair plan](application-repair-plan-2026-09-05.md)
        contains 11 ordered repairs with reproduced evidence, scope, outcomes,
        and verification. It owns the remaining checkboxes, starting at APR-001;
        parked deployment and UI-framework decisions remain outside execution.
- [x] **Profile repair checkpoint:** 561 web tests pass at 94.87% line, 83.68%
      branch, and 88.26% function coverage. Web checks, formatting, lint, and
      product-contract validation pass. The production-stack matrix passed all
      12 profile engine cases; the six focus/Today engine cases passed their
      focused rerun after correcting keyboard fixtures and invalid-field focus.
      No schema or backend boundary changed, so their release gates were not
      repeated. Both implementation candidates received independent review.
