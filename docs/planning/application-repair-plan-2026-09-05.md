# Application Repair Plan — 2026-09-05

Status: User-requested execution plan. Work through the unchecked items in
order, one candidate and independent review at a time. The active-delivery
cursor links here; this document owns the remaining item statuses.

## Review baseline and method

This follows the person block layout (`PRF-001`) and focus-border repair
(`PRF-002`) in [active-delivery.md](active-delivery.md). Their candidate
revisions and integration results belong to Git and that ledger. Do not redo the
completed Phase 12 design review or restore its narrow, internally scrolling
facts rail.

The review inspected rendered person, directory, shell, and settings behavior;
the web controllers, styles, templates, and tests; API composition, public
module interfaces and read-model imports; and the root test-task graph. Browser
probes used a fresh local Compose project with synthetic records, at 1440, 768,
390, and short-phone sizes. Failure probes intercepted only requests in that
test browser. Existing user data and deployed services were not changed.

Monica's useful composition is a compact collection of contact facts beside
larger activity modules, with local context retained on one contact screen.
Sources:
[Monica profile template](https://github.com/monicahq/monica/blob/4.x/resources/views/people/profile.blade.php),
[sidebar](https://github.com/monicahq/monica/blob/4.x/resources/views/people/sidebar.blade.php),
and the repository's
[person-profile analysis](../product/monica-person-profile-analysis.md). The new
layout follows that organization while retaining Kinship's tokens, canonical
section links, and responsive editors.

This is a risk-based application review, with reproduction evidence below. It
does not claim that every backend branch or production deployment has been
audited. No new schema, tenant-isolation defect, or need for an SPA rewrite was
established in this pass.

## Composition and architecture assessment

- Keep Astro's static shells, the private API/renderer topology, generated
  client contracts, and owner-module mutation facades. The inspected backend
  application imports use public module interfaces; read-model adapters compose
  queries. A broad backend rewrite would not address the demonstrated defects.
- The frontend's main weakness is ownership of interaction state. A DOM `submit`
  event is treated as persistence success, and opening a fact editor resets
  other editors without consulting the draft guard. Repair those observable
  behaviors in APR-001 and APR-002 with one coordinated decision.
- Mobile sheet presentation is CSS applied to ordinary forms. It has visual
  modality without dialog behavior. APR-004 should give that existing feature
  one small shared presentation owner; it must not add another application-wide
  registry or a second mutation path.
- `person.css` also contains responsive header, directory, and settings rules.
  `application.css` imports every application stylesheet. During APR-007 move
  the affected shell rules beside their base rules in `shell.css`. Extract
  profile markup/components only where a repair actually consumes the shared
  behavior. File size alone is not a refactoring ticket.
- Coverage is useful but does not establish UX correctness. The old layout
  assertions passed with an inaccessible short-phone dropdown; a dirty-guard
  test explicitly expects submit to clear dirty state. Tests below assert user
  outcomes, negative paths, and rendered geometry where relevant.

## Ordered repairs

### APR-001 — Keep failed or pending saves marked as unsaved

- [x] **P1, delivered.** Submit and hidden forms retain dirty state;
      acknowledged writes and explicit reset clear the relevant draft. Pending
      non-resetting editors lock their submitted values. The Chromium
      `PEOPLE-006` failure, declined-navigation, retry, and persisted-reload
      regression passes in the isolated production stack. All 570 web tests pass
      at 94.91% line, 83.72% branch, and 88.44% function coverage; affected
      static and five product-contract checks pass. No schema or API boundary
      changed.
- Evidence: `submitted` in
  [unsaved-changes.ts](../../apps/web/src/lib/unsaved-changes.ts) calls
  `rebaseline` on every bubbling submit, before validation or an awaited write.
  A real food-preference edit with its update request aborted displayed “Save is
  temporarily unavailable”; a cancellable `beforeunload` probe changed from
  prevented before Submit to unprevented after failure while the draft remained
  in the editor. The current unit test pins this faulty behavior.
- Outcome: pending, rejected, invalid, and failed saves remain dirty. Only an
  acknowledged save or explicit discard/reset clears the relevant draft.
  Preserve the draft when the user declines navigation or a workspace change.
- Scope: guard and the consuming profile save handlers. Introduce one explicit
  successful-save signal if necessary; do not infer success from DOM hiding.
- Verify: focused guard tests for pending/validation/transport/conflict/success;
  one `PEOPLE-006` browser regression for a failed save followed by navigation
  and retry. Run affected web coverage and static checks.

### APR-002 — Confirm before switching away from a dirty local editor

- [x] **P1, delivered.** Rail editors request the shared guard's discard
      decision before changing either form. Decline retains values and restores
      focus; clean switches and explicit Cancel proceed directly. Pending saves
      or option loads block competing opens. Fact, date, cadence, and
      relationship regressions pass; Chromium passes the APR-001/002
      `PEOPLE-006` pair on the isolated worktree stack. The 600-test web
      coverage checkpoint passes at 95.10% line, 84.10% branch, and 88.64%
      function coverage. The relationship option-load review amendment passes 57
      focused tests at 95.40% line, 86.43% branch, and 94.04% function coverage;
      static and five product-contract checks pass.
- Evidence: [rail-editors.ts](../../apps/web/src/lib/rail-editors.ts) broadcasts
  an opened form; handlers in `profile-facts.ts`, `important-dates.ts`, and
  other consumers hide/reset previously open forms. Typing a food-preference
  draft then opening Pets left the old form hidden and its textarea empty
  without a discard decision. The navigation guard cannot protect a draft after
  it is hidden and reset.
- Outcome: one editor remains active. Request the switch before resetting the
  old editor; declining keeps its values and focus, accepting opens the
  requested editor. Explicit Cancel remains an intentional discard. Do not
  persist drafts across page or process lifetimes.
- Verify: dirty and clean transitions between two fact editors and between a
  fact/date/cadence editor; keyboard focus and accept/decline behavior. Reuse
  the guard's dirty-state decision rather than creating another competing owner.

### APR-003 — Provide a working retry after a profile fact fails to load

- [x] **P1, delivered.** Failed blocks offer a local Retry, serialize repeated
      clicks, and recover populated, empty, read-only, or hidden state without
      disturbing neighboring values or drafts. Access denial removes stale
      values and controls without offering an ineffective retry. Chromium passes
      the APR-001/002/003 `PEOPLE-006` regressions on the isolated worktree
      stack. The 621-test web coverage checkpoint passes at 95.12% line, 84.15%
      branch, and 88.74% function coverage. A review amendment serializes
      retries with that block's editing controls; its extended Chromium
      regression and 70 focused tests pass, with 95.74% line, 85.21% branch, and
      88.52% function coverage. Static and five product-contract checks pass.
- Evidence: `load` in
  [profile-facts.ts](../../apps/web/src/lib/profile-facts.ts) sets an error
  message and returns before wiring an action. Aborting the initial Pets GET
  produced “This profile section is temporarily unavailable. Try again.” with
  **zero visible buttons** in that block. Recovery currently requires a page
  reload.
- Outcome: each failed fact block offers a local retry which resolves into
  populated/empty/read-only/hidden state correctly. Other sections and drafts
  remain usable. Access denial must not become an endless retry loop.
- Verify: initial GET failure then success, repeated failure, and revoked/hidden
  state; verify neighboring values and draft stay intact. Extend `PEOPLE-006`.

### APR-004 — Make mobile fact editors behave as actual dialogs

- [x] **P1, delivered.** One shared native-dialog presentation keeps the nine
      mobile rail editors labeled, keyboard-contained, and independently
      scrollable, with background interaction excluded. Escape consults the
      existing discard guard; dismissal restores the opener, and desktop editing
      remains inline. The 186 affected tests pass at 95.80% line, 85.02% branch,
      and 89.75% function coverage; the new presentation helper reaches 100%
      line/function and 91.83% branch coverage. The affected Chromium
      date/profile flows, ordinary axe, short-phone and forced-color visual
      checks, static checks, and five product-contract checks pass. The review
      amendment keeps relationship and cadence feedback inside the modal. Its
      focused browser failures, 96 affected tests, and scoped
      presentation/reminder coverage (96.10% line, 84.58% branch, 88% function)
      pass.
- Evidence: mobile `.profile-rail-block > form:not([hidden])` rules in
  [person.css](../../apps/web/src/styles/person.css) fix a normal form to the
  viewport and draw a scrim with `pointer-events: none`. At 390×844, three Tabs
  from the food textarea reached Save, Cancel, then a background section's Add
  button. Escape left the Pets sheet open. There is no dialog/inert boundary.
- Outcome: a labeled modal sheet keeps focus within its controls, excludes the
  background from interaction, scrolls its own content, handles Escape through
  the discard policy, and restores focus to the opener. Desktop inline editing
  remains available. Keep one editor and the same module-owned mutations.
- Verify: Tab and Shift+Tab loop, Escape, Cancel, dirty-draft decision, focus
  restoration, background inertness, 320/390 widths and a short viewport; check
  accessibility while the sheet is open. Preserve the PRF-002 ring fix.

### APR-005 — Allow authenticated use when browser storage is unavailable

- [x] **P1, delivered.** Unavailable storage falls back to API session
      resolution, including legal acceptance and revalidation; failed cleanup
      cannot interrupt sign-out. Unusable caches are bypassed without extending
      their TTL. A workspace selection that cannot be retained leaves the
      current workspace and drafts intact with a recoverable message. All 112
      affected tests pass at 98.66% line, 87.72% branch, and 88.23% function
      coverage. The authenticated Chromium `AUTH-003` regression passes with
      session storage disabled and no page errors, including navigation, failed
      switching, save, sign-out, and rejected protected entry. Affected static
      checks pass; no session registry, schema, or API was added.
- Evidence: [workspace-context.ts](../../apps/web/src/lib/workspace-context.ts)
  catches failures in its optional session cache, but directly reads/writes
  `sessionStorage` in workspace selection and clear/set helpers. In an
  authenticated browser with storage reads throwing `SecurityError`, navigation
  to `/app` raised a page error and left “Opening Kinship…” visible.
- Outcome: unavailable or quota-limited storage disables the cache/preference
  accelerator; session resolution still reaches the API and a usable workspace
  or explicit recoverable error. Clearing storage must not prevent sign-out. The
  server remains the authorization authority.
- Verify: throwing reads, writes, and removals; sign-in, workspace selection,
  revalidation, and sign-out. Use focused unit tests and one authenticated
  browser test with storage disabled. Do not retain a second session registry.

### APR-011 — Include API-token and DAV checks in aggregate test commands

- [x] **P1, delivered.** Root unit and coverage commands invoke the existing
      API-token/DAV gates once, preserving their focused commands, permissions,
      and coverage scopes. Two RED/GREEN configuration regressions prove the
      links; all seven configuration tests and focused static checks pass. The
      dedicated unit gates pass 37/19 tests, and coverage gates pass 38/43 tests
      at 94.2/84.7/100% and 88.8/85.6/96.6% line/branch/function coverage. Root
      test executes both added unit gates once, then reaches the unchanged
      planning permission failure queued separately as `REL-030` in the active
      ledger; one focused reproduction confirms it is unrelated. Root coverage
      stops in its unchanged API gate after 538 tests and 22 steps on the Astro
      readiness deadline, before the added coverage gates. The isolated probe
      passes under coverage; `REL-031` tracks this intermittent checkpoint
      failure. Dedicated API-token/DAV coverage remains green.
- Evidence: traversing `deno task` references from both root `test` and root
  `test:coverage` leaves `test:unit:api-access`, `test:unit:integrations`, and
  their dedicated coverage paths unreachable. For example,
  `apps/api/api_tokens_test.ts` is otherwise named only by its dedicated
  coverage task; `packages/contracts/api_tokens_test.ts` only by its dedicated
  unit task. Type-checking DAV tests does not execute them.
- Outcome: the owning aggregate commands run the existing API-token/DAV unit and
  coverage gates once, with required permissions and their current coverage
  scope. Keep the focused tasks for fast inner loops. Correct any documentation
  that claims aggregate checks include these paths.
- Verify: run the affected dedicated gates and the amended aggregate once at
  this repair checkpoint. Verify task reachability and collection; avoid adding
  a general task-orchestration framework or duplicate test executions.

### APR-006 — Make profile summary labels and counts truthful

- [x] **P2, delivered.** Stay in touch shows actual cadence or an unset value;
      the reminder owner refreshes the authoritative Next reminder summary after
      local writes and exposes refresh failure. Tags count assigned IDs, and
      capped or paginated lists distinguish shown rows from known totals.
      Mutation reloads discard obsolete pre-edit totals. The 162 affected tests
      pass; profile/fact/reminder coverage is 96.02% line, 85.69% branch, and
      91.22% function, while the rail helper reaches 100/96.66/100%. Chromium
      `PEOPLE-006` verifies empty/populated tags and local cadence and reminder
      summary updates. A review amendment serializes all reminder writes through
      their authoritative refresh; six delayed-response regressions and all 35
      reminder tests pass at 96.72/87.62/93.18% coverage. The amended Chromium
      case and focused static checks pass. Existing refresh owners and API
      contracts are preserved.
- Evidence: the hero labels `person-profile-due-state` as “Stay in touch”, but
  `renderReady` in [people-profile.ts](../../apps/web/src/lib/people-profile.ts)
  fills it from aggregate `dueInformation.detail`. A person without cadence
  displayed “0 open tasks”; with a reminder it included a raw six-digit ISO
  timestamp. The tags block simultaneously displayed “No tags saved” and “1
  saved” because the singleton tag-assignment record was counted as a tag.
- Outcome: show the actual cadence or a clear unset value under Stay in touch;
  keep tasks/reminders under matching labels. Count assigned tags rather than
  transport records, and distinguish a limited preview from a known total.
  Refresh the affected hero values after local edits through existing owners.
- Verify: zero/many tags, no cadence, active cadence, tasks-only,
  reminders-only, and local updates. No raw timestamps or contradictory
  empty/count text.

### APR-007 — Reduce mobile shell chrome and fix stylesheet ownership

- [x] **P2, delivered.** The mobile header uses two rows (114px versus the
      reproduced 221px), with labeled search/capture/menu actions and all four
      primary links. Add person remains in the mobile member menu; Escape,
      outside click, and focus departure dismiss it. Responsive shell rules live
      in `shell.css`, and a narrow directory-grid breakpoint fixes overflow at
      768px. All 41 shell tests and 30 affected presentation checks pass; shell
      coverage is 98.97% line, 91.36% branch, and 86.66% function. Chromium
      `APP-002C` checks all 12 route/width combinations, long workspace names,
      short-screen menus, keyboard/focus behavior, search/capture, and desktop
      order. A review amendment preserves the menu and restores focus after
      failed workspace-switch/sign-out actions; focused and Chromium regressions
      pass. Before/after screenshots were visually reviewed; static checks pass.
- Evidence: at 390×844 the shared header occupied approximately **220px** before
  any page content: brand/search, primary navigation, quick actions, then a
  wrapped Member menu. Its responsive rules live in `person.css`, even though
  every application route uses them.
- Outcome: a compact mobile header keeps primary navigation, person search,
  capture, add-person, and account/workspace actions reachable with clear
  labels. Group secondary actions in the existing menu or one intentional
  disclosure. Move the affected responsive shell rules into `shell.css`.
  Preserve Today/People/Tasks/Journal routes and all role gates.
- Verify: 320/390/768 widths on Today, people, tasks, and settings; long
  workspace labels, keyboard navigation, visible focus, menu dismissal, and no
  horizontal overflow or sticky-content occlusion. Capture before/after rendered
  evidence.

### APR-008 — Apply saved person-name and default-sort preferences

- [x] **P2, delivered.** Explicit membership preferences now drive directory,
      profile, search, and capture labels through one pure name formatter.
      Directory defaults use the saved sort; valid URL overrides win. Partial
      names remain honest, recent search entries use bounded existing summary
      reads, and exact identity matching remains independent of display order.
      The 128-test affected checkpoint passes at 95.35% line, 85.08% branch, and
      88.84% function coverage; the formatter reaches 100% in all metrics. The
      subsequent matching amendment passes all 19 search tests at
      96.42/84.90/92.15%. Chromium `AUTH-004` verifies saved preferences,
      navigation/reload, all four surfaces, partial identities, and membership
      switching in both directions. Static and five product checks pass; API
      contracts are unchanged.
- Evidence: `settings.ts` reads/saves `contactNameOrder` and `contactSortOrder`,
  but other web controllers do not consume them. `hydrateControls` in
  [people-directory.ts](../../apps/web/src/lib/people-directory.ts) defaults to
  `given-name`; person, search, and participant labels concatenate given/family
  names directly. The backend read-model search did not reveal preference use.
- Outcome: saved membership preferences determine default order and display;
  explicit directory URL sorting wins. Apply one small shared display function
  to the affected directory/profile/search/capture surfaces. Handle partial
  identities without inventing missing names.
- Verify: change preferences, revisit views, explicit URL override, partial
  names, and switching between memberships with different settings.

### APR-009 — Use consistent locale and time-zone presentation

- [ ] **P2, ready.**
- Evidence: `person-timeline.ts` formats event instants in hard-coded English
  and UTC, while profile/reminder/audit controllers use browser-local formats.
  The synthetic note appeared at 22:10 in the timeline and 00:10 in audit on the
  same browser. Saved locale/time-zone preferences are edited in settings but
  are not passed to these formatters.
- Outcome: format instants using the accepted membership/workspace preference
  fallback consistently. Keep partial dates and date-only work/birthday values
  as calendar dates, without time-zone conversion or invented components. A
  small formatter must receive explicit preferences; avoid hidden global state.
- Verify: an instant crossing midnight in two time zones, locale differences,
  daylight-saving boundaries, unknown date components, and date-only stability.
  Start with profile/timeline/reminders/audit, then update remaining existing
  instant displays in the same bounded presentation pass.

### APR-010 — Honor the saved fluid-layout preference

- [ ] **P2, ready.**
- Evidence: Preferences offers “Use fluid layout”; only `settings.ts` reads or
  writes `fluidLayout`. Application widths remain fixed in CSS regardless of the
  saved value. This is an offered control with no visible effect.
- Outcome: apply the existing membership preference to application width with
  sensible reading limits inside text-heavy blocks. Keep mobile stacking and the
  PRF-001 minimum useful card widths. Workspace changes refresh the setting.
- Verify: constrained and fluid modes at wide desktop and mobile widths,
  persistence through navigation, and membership switching. No schema change.

## Decisions and existing deferrals

These are deliberately outside the ready repair sequence:

- **UI dependency contract conflict:** `AGENTS.md` and `technology-baseline.md`
  still require shadcn/ui, while the accepted Phase 12 ledger explicitly selects
  vanilla TypeScript/tokens and removes the unused dependencies. Resolve and
  synchronize the authoritative decision before any UI framework migration.
  Routine repairs above use the existing implementation and require no new
  dependencies; this is not permission to rewrite either accepted contract
  silently.
- **Identity editing breadth:** Edit person currently exposes names and the
  partial-identity flag, while the read view includes description, gender and
  other identity states. Compare each missing mutation with the product/API
  contract before scheduling additions. Favorites and life-event mutations
  already have explicit deferrals; do not recast them as newly approved fixes.
- **CI/hooks and deployment:** the planning baseline already records absent CI
  and Lefthook wiring. They remain an integration/release concern, not a newly
  discovered completed capability. `OPS-001E`, billing, and AI work stay parked.

## Execution handoff

Read `AGENTS.md`, `docs/development/autonomous-delivery.md`, the
repository-local `run-tdd-ticket-loop` skill, the active cursor, and this
document. Start with APR-001. The user has requested execution in a new task
with a clean context; there is no need to repeat this audit or ask whether to
begin.

For each item, reproduce its failure with the narrowest useful test, implement
the observable repair, run affected gates, create one candidate, and obtain a
separate clean read-only review before integration. Tick its checkbox here only
with evidence and acceptance. Reuse the same implementer/reviewer for localized
amendments. Full coverage and browser matrices run at the owning integration
checkpoint, not after every cosmetic amendment. If an unrelated gate fails,
reproduce once, establish causality, and queue it separately.

Preserve canonical v7 and module/tenant boundaries. A required new API/schema or
material product decision must be made explicit before extending scope. Do not
deploy, resume parked product work, or migrate UI frameworks as part of this
repair sequence. Keep evidence concise in the ticket status and Git; create no
workflow packets or parallel state ledgers.
