# Active Application Delivery Plan

Status: open backlog, trimmed 2026-11-25

This is the authoritative delivery checklist. It lists only work that is still
open. Delivered phases, tickets, and their checkpoints were removed from this
file once they shipped; `git log -- docs/planning/active-delivery.md` holds
them. Ticket IDs that appear in code comments and test names (`GAP-`, `AUD-`,
`MCP-`, `APR-`, `UXD-`, `APP-`, `OPS-`, and closed `REL-` numbers) name
delivered work described in that history.

The larger [`roadmap.md`](roadmap.md),
[`release-slices.md`](../product/release-slices.md), and
[`traceability.md`](traceability.md) remain coverage references, not
prerequisite queues.

Each open item below is carried as it was last recorded. Reproduce it on the
current `main` before working on it: later work may have fixed it without
ticking it here.

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
6. Remove a delivered leaf from this file in the candidate that delivers it; do
   not create a separate status commit.
7. Git and test output hold detailed evidence. Do not add ticket packets,
   dispatch files, controller IDs, evidence ledgers, hash catalogs, or frozen
   test commits.

Every leaf must preserve at least 80% line, branch, and function coverage for
production code. Changed behavior, authorization and tenant boundaries, schema
behavior, and required user flows still receive focused tests. Every shipped
route needs its accepted page-catalog ID, and every required workflow needs a
Playwright test carrying its stable flow ID.

## Release Gates

- [ ] **All-browser E2E matrix.** Main CI run `45614836377` on `fd7a9ffe` passed
      every job but the browser matrix, which passed 253 cases, skipped 11, and
      failed 9. Their causes are fixed and each case was rerun on Playwright's
      Linux browsers; the matrix still has to pass whole on one manual or
      nightly run. WebKit `EXPORT-001` ("WebKit encountered an internal error"
      on navigation) failed once in run `45304750920` and has not failed since.
- [ ] **OPS-001E — Deployment rollout, rollback, and post-deploy verification.**
- [ ] **Phase 11 accepted:** the named environment independently passes every
      required security, privacy, accessibility, performance, observability,
      backup, restore, migration, rollout, rollback, and operational proof.

## Open Reliability Tickets

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
- [ ] **REL-091 — Cold browser-image builds fail during dependency downloads.**
      Observed on 2026-10-04 before the targeted import/settings/people browser
      tests started: the frozen Deno install failed reading the response body
      for `typescript@5.9.3`; the concurrent pnpm install reported repeated
      download error 23. Docker had ample free disk space. No manifest or
      lockfile changed in the application candidate. Diagnose registry transport
      and bounded cache reuse separately; do not weaken frozen installs or alter
      dependency pins to accept a retry. A cached-runtime test with current
      source and freshly built frontend output does not prove a cold image
      build.
- [ ] **REL-092 — Windows frontend asset relocation can fail in the synced
      checkout.** Observed on 2026-10-04: Astro compiled and prerendered the
      application, then failed with `EPERM` moving `AuthLayout` CSS from
      `dist/server/_astro` to `dist/client/_astro`. The same candidate built
      successfully into a fresh nonsynced output directory with access to the
      same installed dependencies. Diagnose the file-lock/output-directory
      interaction separately; no application behavior change is required by this
      observation.
- [ ] **REL-098 — Frontend build-output assertions have baseline drift.** Astro
      emits the frontend, but its output suite reports ten passes and four
      failures: two assertions assume one preferences-page script, one expects
      an absent spacing utility, and one rejects the existing `contents` class
      collision. Building the approved checkout without the API guide reproduces
      the same four failures. Public-page no-React checks pass in both builds.
      Repair the owning output contracts separately.
- [ ] **REL-100 — Monica import currency conversion disagrees with its
      three-decimal fixture.** The existing live-choice import case expects
      `0.5550 KWD` but persists `555.0000 KWD`; its JPY case agrees. The same
      filtered test fails at pre-API-plan `b4e4cc1` on disposable PostgreSQL.
      Resolve source amount units and conversion in the owning import boundary.
- [ ] **REL-101 — Important-date occurrence test disagrees with dispatch.** The
      existing planning case reports direct and important-date reminders as
      conflated, missing, or duplicated. The same filtered case fails at
      pre-API-plan `b4e4cc1` on disposable PostgreSQL. Diagnose occurrence
      selection and its fixture in a separate planning candidate.
- [ ] **REL-102 — Immutable-migration guard assertion expects the wrong checksum
      failure.** The existing guard test receives a v9-to-v10 checksum mismatch
      but rejects that expected refusal message. The filtered case reproduces at
      pre-API-plan `b4e4cc1`; repair the assertion and its intended artifact
      selection without changing immutable migrations.
- [ ] **REL-103 — Rolling reminder fixture disagrees with generated horizon.**
      The ninth-occurrence lifecycle case finds 13 distinct occurrences rather
      than its expected rolling count, with its ninth instant at
      `2026-11-02 01:30:00+00`. The same filtered test fails at pre-API-plan
      `b4e4cc1`. Since AUD-W1 it instead reports
      `{"count":8,"distinct_count":8,"ninth_at":"2026-11-15 01:30:00+00"}`: the
      replenishment's shortfall query treats eight future dates as a full
      window, so no ninth row is added. Diagnose its horizon and timezone
      contract separately.
- [ ] **REL-104 — WebKit native downloads fail with the loopback TLS fixture.**
      The API-002 visitor receives valid gateway JSON but never receives a
      native download event under self-signed HTTPS. The same WebKit download
      succeeds over HTTP. Adding Content-Disposition, an ephemeral default
      context, and a transport-only route bridge did not fix HTTPS; all
      experiments were removed. Chromium and Firefox pass the HTTPS visitor
      flow, and all three browsers pass bearer automation. Keep the real native
      download assertion visible; do not alter production TLS or user trust
      stores or replace the original link with a synthetic download to claim a
      green gateway matrix.
- [ ] **REL-105 — Deno spawns and run permissions resolve the nvm shim instead
      of the real binary on Windows.** Observed during the 2026-11-07
      audit-remediation run on a Windows 11 host (Git Bash/PowerShell, Deno
      2.9.6, nvm-installed `deno.exe`); unrelated to the remediation tickets. On
      this host `deno` on `PATH` resolves to the nvm `.nodejs\deno.exe` shim
      (546 KB), while `Deno.execPath()` is the real
      `…\nvm\installs\v24.22.1\node_modules\deno\deno.exe`. Both symptoms below
      share that root cause.

      Long argument lists: `tools/tasks/run.ts:71` spawns the literal `"deno"`,
      so the shim receives the full file list and refuses arguments beyond
      roughly 8,000 characters with "The command line is too long."; spawning
      `Deno.execPath()` with the same 7,000-, 9,000-, and 20,000-character
      arguments succeeds. `deno task check` (339–344 files, about 19,600
      characters), `test:coverage --module=api` (about 20,200 characters), and
      the aggregate `test:coverage` fail this way although all are below the
      32,767-character `CreateProcess` limit. The `api` unit set is already
      about 7,900 characters, so adding one test file to it breaks
      `test:unit --module=api` here. Observed on `b387d1cf` (baseline) and
      `c7d88daa` (checkpoint C1); running the same `deno check` file list in
      chunks of 100 succeeds with only REL-095's error.

      Run permission: the manifest's `--allow-run=deno` resolves to the shim,
      while code spawns `Deno.execPath()`, so
      `packages/backend/modules/relationships/application/manage_relationships_test.ts:86`
      ("relationships and governance have no direct dependency edge") fails with
      `NotCapable: Requires run access to …deno.exe`, and `deno task dev` fails
      the same way in `tools/dev.ts` until the real binary's folder is first on
      `PATH`.

      Spawn one consistent executable, such as `Deno.execPath()`, everywhere
      (the task runner, `tools/dev.ts`, and tests) and grant run permission for
      exactly that executable without broadening it or dropping files from any
      gate. Treat the 32,767-character `CreateProcess` cap only as a secondary
      limit to watch as file lists grow; if a list approaches it, pass the list
      another way (for example a response file, a config `include`, or
      chunking).

      Partly repaired 2026-11-16, enough for the push hook to run on that host:
      the task runner splits a long file list across command lines
      (`argumentBatches`) for `check` and the unit sets, and the relationships
      dependency test spawns `deno` by the name its permission grants. Still
      open: `test:coverage` (its `--clean` forbids batching), `tools/dev.ts`,
      and `tools/dependency_audit_gate.ts`.
- [ ] **REL-109 — A workspace settings save can deadlock with reminder
      occurrence inserts.** Found by the AUD-W1 re-check during the 2026-11-07
      audit-remediation run on the REL-105 Windows host; the risk predates
      AUD-W1 and is unrelated to the remediation tickets. `updateWorkspace` in
      `packages/backend/modules/workspaces/adapters/postgres/settings_management.ts`
      locks the admin's member and workspace rows `for update of wm, w` and then
      `workspace_settings` `FOR UPDATE`. `reminder_occurrences.member_id`
      references `workspace_members`, so each occurrence insert takes
      `FOR KEY SHARE` on that member row. A replenishment holding
      `workspace_settings FOR SHARE` that inserts for the same admin can
      deadlock with that save, and PostgreSQL aborts one with 40P01. The AUD-M2
      re-check found that the same `for update of wm, w` (`:178`) also deadlocks
      with invitation acceptance: `lockInvitationAuthority`
      (`invitation_authority.ts:65–75`) takes `FOR KEY SHARE` on the workspace
      and then `FOR SHARE` on the inviter's member row, so an acceptance holding
      the workspace waits on the save's member lock while the save waits on the
      workspace. Lock `for no key update of w, wm` (workspace first), matching
      the `for no key update` of `actor_revalidation.ts`; `FOR NO KEY UPDATE`
      does not conflict with `FOR KEY SHARE`, which removes both cycles. Prove
      it with two interleavings in which the same admin saves workspace
      settings: a top-up held open after its locks, and an invitation acceptance
      for that admin's invitation held open after its workspace lock. Each pair
      commits and no 40P01 occurs.
- [ ] **REL-110 — The architecture checker ignores `compositionMayImport`.**
      Found in the AUD-K1 review during the 2026-11-07 audit-remediation run on
      the REL-105 Windows host; unrelated to the remediation tickets.
      `tools/architecture/check_boundaries.ts` never reads the token list
      declared at `docs/architecture/module-boundaries.yaml:92`; the name
      appears only in a `check_boundaries_test.ts` fixture. Composition imports
      into a module follow hard-coded rules, and an import whose target lies
      outside every module, such as `packages/contracts`, skips all checks at
      `if (target === undefined) continue;`. So `check:architecture` passed
      while `apps/api/composition.ts` imported `packages/contracts/registry.ts`;
      that import was removed. Enforce `compositionMayImport` for every import
      target.
- [ ] **REL-111 — Planned module integration targets are not declared.**
      Observed during the 2026-11-07 audit-remediation run on the REL-105
      Windows host; unrelated to the remediation tickets. The plan's Verify
      lists name `test:integration` with `--module=governance`, `people`,
      `interactions`, `relationships`, and `files`, but
      `tools/tasks/manifest.ts` declares no integration suite for them ("No
      integration suite is declared for …"). Their files run only inside the
      `api` set, whose run is blocked by REL-095. Declare those module
      integration suites through the task runner's consistent executable from
      REL-105, without dropping any file from an existing gate.
- [ ] **REL-112 — A frozen database server has no client-side deadline.** Found
      in the AUD-K3 review during the 2026-11-07 audit-remediation run on the
      REL-105 Windows host; a residual of SECA-15 that AUD-K3 did not set out to
      close. AUD-K3 gives the API pool a 10 s `statement_timeout`
      (`REQUEST_STATEMENT_TIMEOUT_MS`,
      `packages/backend/platform/postgres/database.ts:38`, applied at
      `:109–110`), but the server enforces that setting, so it fires only for
      statements the server is executing. `connect_timeout: 5` (`:107`) bounds
      only a new connection. With the server paused (`docker pause`) a request
      on an open connection waits on the socket indefinitely, so SECA-15 is
      closed for lock waits only. Add a client-side request or statement
      deadline that answers 503 within about 15 s, and prove it with an
      integration test that pauses the server mid-request.
- [ ] **REL-113 — Planning tests assert database-wide state and fail on a reused
      database.** Found in the AUD-W2 re-check during the 2026-11-07
      audit-remediation run on the REL-105 Windows host; the defect predates the
      remediation tickets. "PLANNING-002 PostgreSQL cancels an expired
      unattempted claim after disable"
      (`tests/integration/planning_delivery_postgres_test.ts:575`) claims with
      `claimDue({ limit: 1 })` over every due occurrence and asserts it got its
      own (`:597`), then asserts a deployment-wide maintenance tick claimed
      nothing (`:677`). "PLANNING-002 PostgreSQL keeps reminder delivery,
      tenancy, cadence, and audit replay-safe"
      (`tests/integration/planning_reminders_postgres_test.ts:49`) asserts
      deployment-wide `worker.tick` counts of exactly one (`:314`, `:326`,
      `:344`). Any due occurrence left by an earlier run breaks them. "TODAY-001
      PostgreSQL projects every v6 reminder target through its authoritative
      owner" (`tests/integration/planning_today_postgres_test.ts:502`) inserts
      fixed reminder and occurrence ids (`:587–595`), so a second run on the
      same database fails on `reminders_pkey`. Scope those assertions and
      fixtures to the test's own workspace and member, for example generated ids
      that keep the intended UUID ordering, and prove each test passes twice in
      a row on one database.
- [ ] **REL-114 — The console-based CSP violation helper is redundant.** Found
      in the AUD-G3 review during the 2026-11-07 audit-remediation run on the
      REL-105 Windows host; the redundancy was created by AUD-G3's fixture and
      does not predate the remediation tickets.
      `tests/e2e/support/page-checks.ts:84` still exports
      `recordPolicyViolations`, which matches console text, and six specs call
      it: `favorites.PEOPLE-010`, `notifications.TODAY-002`,
      `people-bulk.PEOPLE-009`, `public-home`, `settings.AUTH-004`, and
      `sign-in.AUTH-003`. AUD-G3's `securitypolicyviolation` fixture in
      `tests/e2e/support/test.ts` now fails every test on any refusal in any of
      its contexts, including those a spec opens through `browser.newContext`.
      Remove the helper and its call sites without weakening any other assertion
      those specs make. Optionally add a second positive control beside
      `tests/e2e/content-security-policy.spec.ts` in a page opened through
      `browser.newContext`.
- [ ] **REL-115 — PostgreSQL error logs can carry CRM values.** Found in the
      AUD-G4 review during the 2026-11-07 audit-remediation run on the REL-105
      Windows host; the exposure predates the remediation tickets. The
      PostgreSQL `command` that AUD-G4 introduced in `compose.yaml:17-31` sets
      `log_parameter_max_length=0` (`compose.yaml:30`), which hides bind values
      in slow-statement lines. The default `log_error_verbosity` still writes
      `DETAIL: Key (…)=(value) already exists` on a unique violation, so a CRM
      value such as an email address can reach the PostgreSQL log. Set
      `log_error_verbosity=terse` (or an equivalent) in the Compose PostgreSQL
      command, add the matching sentence to
      `docs/architecture/observability.md`, and prove a forced unique violation
      logs no DETAIL line.
- [ ] **REL-116 — A first large Monica import leaves the planning tables
      unanalyzed.** Found in the AUD-W1-fix review during the 2026-11-07
      audit-remediation run on the REL-105 Windows host; the defect predates
      AUD-W1, is not a regression from it, and is transient. The import
      bulk-inserts `crm.reminders` and `crm.reminder_occurrences` in one job
      (`packages/backend/modules/planning/adapters/postgres/business_import_boundary.ts:113`
      and `:178`). On a fresh deployment the worker's `claimDue` and first
      `replenish` (`reminder_repository.ts:1444` and `:1316`) then plan on
      default estimates until autovacuum analyzes those tables, about one cycle
      later. After its commit, the import job runs `analyze` on the tables it
      bulk-loaded; prove that the worker's claim plan uses
      `reminder_occurrences_due_idx` right after an import.
- [ ] **REL-119 — Firefox fails one E2E case on the Windows host.** Found during
      AUD-V2's all-browser E2E run in the 2026-11-07 audit-remediation run on
      the REL-105 Windows host, and reproduced at `54a9b31c`, before AUD-V2.
      Firefox fails "[PEOPLE-006] PRF-001 scans profile blocks and edits long
      facts across screen sizes" (`tests/e2e/profile-facts.PEOPLE-006.spec.ts`)
      at its section-menu bound. Firefox passes it on Linux, in CI and in
      Playwright's container. Diagnose it; do not weaken the assertion. The
      WebKit style refusals first recorded here were Playwright's own screenshot
      preparation, which the policy guard now leaves out, and WebKit's `API-002`
      download on that host is REL-104.
- [ ] **REL-121 — Some web remount and failure tests no longer discriminate.**
      Found in the AUD-F1 review and the AUD-F5 final re-check during the
      2026-11-07 audit-remediation run on the REL-105 Windows host. Since
      AUD-F1's single-flight reads a remounted island joins the read its
      predecessor left on the wire, so "forgets an unmounted island's pending
      completion and read; a remount starts fresh"
      (`apps/web/src/features/today/attention/today-attention.test.tsx:973–1008`)
      and "makes a pending old mount inert after the page draws again"
      (`apps/web/src/features/today/reminders/today-reminders.test.tsx:265–290`)
      resolve one shared answer for both islands and cannot tell a stale island
      from the new one. Separately, nothing pins that a zone, rail, or card
      owner's failure still rejects the person workspace's `settled()`: the
      registry's internal `mount`
      (`apps/web/src/features/person/workspace.ts:295–303`) absorbs failures
      only for `tolerated` owners, which AUD-F5 introduced for the summaries
      (`:325–329`), and making every owner tolerated breaks no test. Send a
      write before the remount so the new island reads on its own and give the
      late answer a distinct body, and add a case in which a non-summary owner's
      failure rejects the settle.
- [ ] **REL-122 — Signing out with two session cookies leaves the live session
      live.** Found in the AUD-K4 review during the 2026-11-07 audit-remediation
      run on the REL-105 Windows host. The sign-out route
      (`packages/backend/modules/workspaces/transport/http/authentication.ts:561–579`)
      revokes only what `sessionToken` returns, and `sessionToken`
      (`packages/http-kit/cookies.ts:53–59`) returns nothing when the `Cookie`
      header carries more than one session cookie (SECA-09). With two cookies
      the route revokes no token, clears the cookie, and answers 200
      `signed-out`, while the live session stays usable until it expires. Before
      AUD-K4 (`b1499b33`) the route revoked only the first cookie's token, so
      the gap is older, but now no token is revoked at all. It is realistic only
      over loopback HTTP, where the cookie is `kinship_session`; over HTTPS a
      `__Host-` cookie cannot be duplicated in one browser. Revoke each distinct
      token in the header, and prove with an HTTP test that a two-cookie
      sign-out leaves neither session usable.
- [ ] **REL-123 — Firefox PEOPLE-005 asserts a loading state its route hold does
      not control.** Found during AUD-V2's all-browser E2E run in the 2026-11-07
      audit-remediation run on the REL-105 Windows host, and in its one bounded
      Firefox reproduction, in which two of three runs passed; it is not a
      database or product failure. The spec's hold is unchanged since AUD-G3 and
      GAP-036, but the person read it waits on was reworked by AUD-F3
      (`54a9b31c`), AUD-F5 (`af6a5390`), and AUD-Q3, and whether it reproduces
      before them was not checked. "[PEOPLE-005] manages honest important dates
      on the person profile" (`tests/e2e/important-dates.PEOPLE-005.spec.ts:9`)
      installs its route before saving the new person and holds only the first
      `GET …/people/*/dates` it sees (`:25–36`), then waits for `load` (`:41`),
      opens the profile again (`:42`), and expects `data-section-state` to be
      `loading` and "Loading important dates…" to show (`:45–46`) before it
      releases the hold (`:47`). At AUD-V2's candidate `9ab36e91` the dates
      island read its own dates (`important-dates.tsx:157` there) only after the
      deferred person read answered, which can be after `load`, so the held
      request could belong to the profile the app opened after the save, and the
      profile the spec opened reached `ready` at once. Since AUD-Q3 (`6e8b0329`)
      the island takes its first answer from
      `GET /api/v1/people/{id}?include=rail`
      (`apps/web/src/features/person/workspace.ts:1115`) and reads `…/dates`
      only when the rail is missing
      (`apps/web/src/features/person/important-dates/important-dates.tsx:181–195`),
      so the hold matches nothing the profile sends at open. The loading state
      is the prerendered shell's
      (`apps/web/src/components/person/PersonSection.astro:50`, `:74`) and lasts
      only until the composed person read answers, on every browser. Hold the
      request that drives the asserted page's loading state, now the
      `?include=rail` read of the profile the spec opens, rather than the first
      request seen, and keep both assertions.
- [ ] **REL-124 — Firefox context teardown sometimes fails with a protocol
      error.** Seen in AUD-F5-fix's Firefox runs of the person specs during the
      2026-11-07 audit-remediation run on the REL-105 Windows host; a
      test-infrastructure flake on that host that nothing ties to the
      remediation tickets, and whether it reproduces before them was not
      checked. After a test body passed, closing its context threw
      `browserContext.close: Protocol error (Browser.removeBrowserContext): can't access property "_maybeDontRestoreTabs"`,
      on a different test in each run, while every other Firefox test in those
      runs passed. The repository pins `@playwright/test` 1.62.1
      (`package.json:16`; `playwright-core@1.62.1` at `pnpm-lock.yaml:3570`),
      which installs its own Firefox build, and runs with `retries: 0`
      (`playwright.config.ts:20`). Reproduce it on those pinned versions, then
      report it upstream with the trace, or pin or upgrade to a Playwright
      release whose Firefox build closes contexts cleanly. Keep the failure
      visible: do not add retries or swallow teardown errors.
- [ ] **REL-126 — The composed person rail trades requests for statements and
      couples two sections.** Found in the AUD-Q3 review's Low notes during the
      2026-11-07 audit-remediation run on the REL-105 Windows host; AUD-Q3
      introduced all three. First, the relationships section needs both its list
      and its types
      (`packages/backend/read-models/person-profile/application/compose_person_rail.ts:146–158`,
      read at `:181–190`), so a failed or thrown types read makes the whole
      section `unavailable`, which the island draws as "This relationship
      section is temporarily unavailable. Try again."
      (`apps/web/src/features/person/relationships/person-relationships.tsx:348`,
      `relationships.ts:292–293`) with no control to try again; it recovers only
      on reload or a lifecycle change (`person-relationships.tsx:424`). Before
      AUD-Q3 the island's own `readAll` settled the two reads apart
      (`:225–239`), so the list still showed and only the editor's vocabulary
      failed. Second, the rail reads every section whatever the summary the same
      read already counted (`get_person_profile.ts:318–333`): the seven facts,
      the relationships, their types (8 statements through
      `ensureDefaultRelationshipTypes`, which takes the seeding advisory lock
      only when a default is missing,
      `packages/backend/modules/workspaces/adapters/postgres/relationship_workspace_boundary.ts:49–61`),
      the dates, and the reminders, while most islands' own reads skip a section
      the summary counted empty (FEQ-04,
      `apps/web/src/features/person/section-mounts.ts:79–91`).
      `RAIL_STATEMENT_BUDGET` = 83
      (`tests/integration/people_profile_postgres_test.ts:929–943`) is measured
      for a filled rail; a blank person's open sends the same section reads in
      one request, and its count is not measured. Third, the page now waits for
      `include=rail` instead of `include=summary` before it draws the hero
      (`apps/web/src/features/person/workspace.ts:1115`; `:1114` at `9ab36e91`),
      and the server runs the section reads one after another
      (`compose_person_rail.ts:176–200`). Answer zero-count sections from the
      profile's counts, skip the types read when the list is empty (the island
      then reads the vocabulary itself when the editor first needs it,
      `person-relationships.tsx:571–579`, so adding a first relationship keeps
      working), return the list with only the vocabulary marked unavailable, and
      measure the hero's time at the release checkpoint; AUD-P1's budgets
      (`tests/e2e/perf.PERF-002.spec.ts`) must stay green.
- [ ] **REL-128 — WebKit loses window focus in a PEOPLE-006 local-editor step.**
      Seen in AUD-Q3-fix's WebKit runs during the 2026-11-07 audit-remediation
      run on the REL-105 Windows host, which passed one of three; the reviewer
      judged it environmental, and it is distinct from REL-119's CSP refusals.
      Whether it reproduces before AUD-Q3-fix or the remediation was not
      checked. "[PEOPLE-006] maintains enabled profile facts in local person
      sections" (`tests/e2e/profile-facts.PEOPLE-006.spec.ts:1576`) failed at
      the first-meeting add (`:1792` at `90b25fd2`) and the tags edit (`:1847`),
      `:1826` and `:1881` in AUD-Q3-fix, with `toBeFocused` receiving "inactive"
      because the WebKit window had lost focus. Both are `openLocalEditor`'s
      focus check (`:34`), before any line AUD-Q3-fix changed. The repository
      pins `@playwright/test` 1.62.1 (`package.json:16`) with `retries: 0`
      (`playwright.config.ts:20`). Reproduce it on the pinned WebKit build, then
      make the focus assertions robust to an inactive window without hiding a
      real focus regression, for example by asserting `document.activeElement`
      within the page or bringing the page to the front. Do not add retries.
- [ ] **REL-130 — Two migrate jobs started together on a brand-new database: one
      fails.** Found while testing REL-129 and reproduced at `2cee1b76`, before
      it. Each job builds its expected catalogs before it takes the advisory
      lock, the canonical DDL runs `CREATE EXTENSION IF NOT EXISTS`, and on a
      database with no extensions the two builds collide: the loser exits with
      `duplicate key value violates unique constraint
      "pg_extension_name_index"`,
      the other applies v16, and a rerun verifies. Nothing wrong is committed,
      and Compose starts one migrate job. If it is worth closing, take the lock
      before the first scratch build, as a session lock released in a `finally`,
      and keep the five-second wait in mind: a second job would then wait
      through the first one's builds.

## Watches

These were seen once or twice and recorded so that a recurrence has a trail.

- [ ] **REL-020 — Watch the `app-002c` header keyboard walk.** One full-suite
      run during `UXD-002C` failed `keyboardReachMemberMenuToggle` at
      `tests/e2e/app-002c.spec.ts:127`: the brand link never took focus after
      the first Tab. The candidate touched neither the application shell nor the
      header, the same suite had passed that spec three times that day, and it
      passed again on the very next run with no change to that surface. Recorded
      rather than diagnosed, so a recurrence has a trail. This walk has been
      wrong twice before for real reasons — `REL-001` and `REL-014` — so treat a
      second occurrence as a stale walk before assuming flake.
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
- [ ] **The `app-004e` spec cannot be run with `--repeat-each`.** Its
      `E2E chromium companion category` fixture insert is not idempotent and
      collides on a unique name. That blocks the cheapest way to measure a flake
      in this spec.

## Known Limitations

Recorded when the MCP endpoint shipped (ADR 0009). Each needs its own ticket or
decision before it changes.

- **Keyed creates that still accept a replay.** A stay-in-touch cadence can be
  set again by its old `requestId` after it was deleted; the agent instructions
  say so. A workspace reset removes tombstones with the records, so a key may
  create its record again afterwards, as documented.
- **Gift attachments.** `createGift` and `updateGift` require an attachment to
  be an available, non-avatar file of the workspace, not of the gift's person.
- **Removed files keep their gift links.** `removePersonFile` deletes the bytes
  and the person link, but a gift keeps its `attachmentFileId` and a debt
  settlement reports its photo as unavailable.
- **Lock orders read from the code and not reproduced.** The worker transactions
  that open outside its shared runners take no lifecycle lock: claiming and
  renewing deliveries, marking an attempt, recording an in-app notice,
  withdrawing retired lead notices, and completing a lifecycle cleanup. Any of
  them could cross a reset's cascade over reminder occurrences. An invitation
  acceptance whose address already belongs to the owner who is resetting reads
  that account row `for share` while the reset waits for the
  member-administration lock. A writer that locks another member's row after its
  own revalidation can meet that member's sign-in, which takes member before
  workspace.
- **A role change during a save.** A preference save revalidates the actor like
  every other write, so a save made in the moments after the member's role
  changed is refused instead of accepted.
- **A short reminder window.** The top-up does not count cancelled rows ahead
  and revives only a cancelled row that was never attempted. A cancelled row
  that had already been attempted keeps its date, so that date is neither
  counted nor minted again and the member's window stays one date short until it
  passes.
- **One dependency advisory.** `pnpm audit` reports one moderate `minimatch`
  advisory under the `shadcn` CLI, which no released `shadcn` fixes; the CLI is
  a developer tool and never ships.

## Deferred And Unscheduled

Nothing here is queued. Each entry needs a product decision before it becomes a
ticket.

- [ ] **AI-mediated CRM data interaction is deferred.** It is not part of the
      active delivery queue or a prerequisite for core, optional-platform, or
      production-readiness completion. Revisit it only when the product is ready
      to define how a user should interact with CRM data through AI; DG-08 must
      then establish the product, privacy, authorization, safety, evaluation,
      and persistence contract before implementation begins.
- [ ] **Compact relationship rail.** Deliberately not attempted: removing the
      inline relationship editor from the rail. The 2026-08-29 UX review wanted
      the rail compact and a type `<select>` plus two buttons per row is not
      that, but four `app-004d` assertions drive those controls and replacing
      them is a product decision, not a formatting one.
- [ ] **Token issuance by members.** Only owners and admins issue personal API
      tokens (decided 2026-11-23). Member-issued tokens need a new product and
      authorization decision.
- [ ] **OAuth for MCP and third-party clients.** ADR 0009 leaves out OAuth for
      clients that cannot send a static bearer header. The four OAuth tables
      exist in the schema, but tenant binding, consent, PKCE, and refresh
      behavior need an approved design and a new architecture decision.
- [ ] **Per-token rate limits** beyond the gateway's per-address limits.
- [ ] **Connector synchronization.** External reference lookup and upsert, a
      change and deletion feed, and signed webhooks were researched on
      2026-10-25 and wait for a named connector that consumes them. Each needs a
      canonical schema review and a synchronized schema version.
- [ ] **Visual regression baseline (GAP-038, optional).** Playwright
      `toHaveScreenshot` for Today, the directory, a profile, and the settings
      index at 390, 768, and 1440 pixels in light and dark, in a nightly job
      only.
- [ ] **Smaller ideas.** A keyboard shortcut layer over the command palette, a
      print stylesheet for the profile, and a UI message catalog for
      translations.
- [ ] **Billing (`BILLING-001`).** The one cataloged flow that is still
      `planned`.
