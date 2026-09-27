# Architecture Gap Remediation Plan — 2026-09-15

Status: proposed execution plan from a full-codebase architecture review. Work
through the tickets in order, one candidate and one independent review at a
time. Each ticket is written to be executed by a single implementer with a clean
context that has read only `AGENTS.md`, this document, and the ticket.

Scope of the review: `packages/backend` (14 modules, 6 read models, platform),
`apps/api`, `apps/worker`, `apps/web`, `packages/contracts`, `tools`, `tests`,
`gateway`, Compose/Docker, `deno.json`, and the architecture/product/planning
documents. Seven read-only inspection passes were run, one per layer, and the
findings below cite file paths and line numbers as they stood at commit
`14d8ed2a`.

---

## Part 1 — Findings

### 1.1 Size of the codebase

| Layer                               | Production LOC | Test LOC |
| ----------------------------------- | -------------: | -------: |
| packages/backend/modules            |         29,599 |   12,003 |
| packages/backend/read-models        |          4,442 |    1,793 |
| packages/backend/platform           |            152 |       84 |
| apps/api                            |         10,759 |    8,170 |
| apps/worker                         |            124 |      162 |
| apps/web/src/lib                    |         16,738 |   32,292 |
| apps/web pages, layouts, components |          3,060 |        0 |
| apps/web/src/styles                 |          5,987 |        0 |
| tests/integration                   |              0 |   22,935 |
| tests/e2e                           |              0 |   12,242 |
| tools (9,904 is one generator)      |         14,239 |    8,314 |

### 1.2 What is already right (do not "fix" these)

- Cross-module imports are clean. Zero application files import Kysely,
  Postgres.js, Hono, MinIO, or another module's `adapters/` or `application/`.
  Every cross-module import targets `public.ts`. Read models perform no writes.
- Every use case is a factory `createXManagement(dependencies)` returning a
  method object, with results as `status`-discriminated unions, not exceptions.
- Clock is injected everywhere in application code (zero bare `new Date()`); IDs
  are injected at 30 sites with one exception (see 1.4).
- The web app has zero `innerHTML` rendering and zero raw `fetch` calls; all
  network access goes through the generated
  `packages/contracts/generated/auth-client.ts`.
- API errors are RFC 9457 problem details with stable codes.
- Container images are pinned by tag and digest, run non-root, and have health
  checks. Secrets are not committed. Migrations are versioned, checksummed, and
  applied under an advisory lock (`tools/migrations/baseline.ts`).
- 38 of 39 catalog pages and 29 of 30 required flows exist and are covered by
  Playwright specs; the only absences are the deliberately withheld billing page
  and flow. 32 of 34 specs run axe-core.
- API unit tests (fake use cases, route-to-status mapping) and integration tests
  (real Postgres through the in-process Hono app) are cleanly layered with
  minimal redundancy.

### 1.3 Contract-versus-reality drift

`docs/architecture/repository-layout.md` and `module-boundaries.yaml` mandate
paths that do not exist:

| Mandated                                        | Reality                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/shared-kernel`                | absent; 25 hand-rolled `{ now(): Date }`, 8 `{ create(): string }` shapes                                                             |
| `packages/backend/bootstrap`                    | absent                                                                                                                                |
| `modules/<m>/domain/`                           | absent in all 14 modules                                                                                                              |
| `modules/<m>/ports/`                            | only `identity/ports/security.ts`; ports inline in `application/*.ts` mixed with DTOs                                                 |
| `modules/<m>/transport/http/`                   | absent; all routes live in `apps/api/*.ts`                                                                                            |
| `modules/billing`                               | absent (deliberate, optional)                                                                                                         |
| `tests/support`, `tests/fixtures`               | absent; every test file hand-rolls fixtures                                                                                           |
| `apps/web/src/islands`, shadcn/ui, React        | absent; vanilla TS + Astro; conflict recorded in the repair plan. Resolved 2026-09-23 by ADR 0006 (adopt shadcn/ui in React islands). |
| `tools/workflows`, `lefthook.yml`, CI config    | absent                                                                                                                                |
| Deno lint plugin + dependency-graph checker     | absent; 11 ticket-named text-grep spot checks under `tools/architecture/<TICKET>/`                                                    |
| Telemetry port, request IDs, metrics            | absent; `observability.md` is unimplemented                                                                                           |
| Generated Kysely types + drift check            | absent                                                                                                                                |
| Event bus / outbox for `publishes:`/`consumes:` | absent; three publisher interfaces wired to one synchronous consumer each in `apps/api/composition.ts:1003,1009,1018`                 |

### 1.4 Backend module isolation

- **Table ownership is breached at the SQL level, invisibly to import checks.**
  Raw SQL against `crm.users` (owned by `identity`) appears 54 times in 24
  non-test files across 12 of 14 modules. Seven of those modules (files, gifts,
  interactions, journal, people, planning, integrations) do not list `identity`
  in `allowedModuleDependencies`. It is the same account → member → workspace
  "is this actor active" join copy-pasted per adapter (for example
  `modules/gifts/adapters/postgres/gift_repository.ts:117-120`,
  `modules/files/adapters/postgres/gift_attachment_boundary.ts:5-20`,
  `modules/people/adapters/postgres/people_repository.ts:49-65` and again
  `:108-125`). `task_repository.ts` and `interaction_repository.ts` skip the
  check entirely and filter only by `workspace_id`, so the security check is
  applied inconsistently.
- `modules/files/adapters/postgres/gift_attachment_boundary.ts:80-97` joins
  `crm.gifts` with no declared files → gifts dependency.
- `public.ts` serves two audiences at once: the type-only facade peers should
  use, and the concrete `Postgres*` adapter registry only composition roots
  should use. `governance/public.ts` exports 22 concrete classes out of 28
  lines; `operations/public.ts` is one line exporting one adapter and the module
  has no application layer.
- `apps/api/composition.ts` is one 595-line function (`createConfiguredApiApp`,
  lines 634-1229) with 106 `new Postgres…` and 37 `create*Management` calls.
  Roughly 80% is independent per-module wiring in an identical shape (gifts
  905-913, journal 914-921, tasks 1024-1032, relationships 983-992).
- `apps/api/main.ts:8,75-77` constructs the SMTP adapter directly although it is
  not a declared composition root.
- `apps/api/personalization_repository.ts` is a legitimate composition-level
  fan-out router over seven module facades, but its name suggests persistence.
- Pure logic lives inline in 800-1000-line application files:
  `people/application/profile_facts.ts` normalize/validate (423-545),
  `planning/application/task_management.ts` validation and an HMAC-signed cursor
  codec (263-311, 392-462), `relationships/application/manage_relationships.ts`
  inspect/decorate (300-380).
- One DI violation: `workspaces/application/workspace_lifecycle.ts:397` calls
  `crypto.randomUUID()` in application code.

### 1.5 Backend duplication (about 1,800-2,150 removable lines)

| Hotspot                                                         | Files | Evidence                                                                                                                                                        |
| --------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `governance/adapters/postgres/*_audit.ts`, 75-80% boilerplate   |    21 | one `insert into crm.audit_events … returning id` per file; duplicated `assertPostcondition` in `important_date_audit.ts:31-60`, `communication_audit.ts:11-30` |
| Actor authorization SQL fragment                                |   21+ | see 1.4                                                                                                                                                         |
| `adapters/postgres/workspace_lifecycle_impact.ts`               |    11 | 331 lines, only table lists vary                                                                                                                                |
| `personalization_references.ts` pairs                           |     8 | 322 lines; conflict detection duplicated `people:64-91` vs `relationships:19-52`                                                                                |
| "Unnamed person" display-name formula (TS and inline SQL)       |    10 | 20 occurrences: `people_repository.ts:20-23`, `today_attention_repository.ts:76,98,138,141`, `person_profile_repository.ts:747,750`, …                          |
| Result/status unions                                            |    23 | 48 distinct `*Result`/`*Status` exports; `readonly status: "forbidden"` 65 times; no shared kernel                                                              |
| Validation primitives (`optional`, `text`, `instant`, patterns) |    6+ | `optional()` byte-identical in `create_person.ts:156`, `important_dates.ts:191`, `lifecycle_person.ts:130`; no Zod in backend                                   |
| Partial-date precision union declared twice                     |     2 | `important_dates.ts:8-16` vs `get_person_profile.ts:122-129`                                                                                                    |
| Deterministic SHA-256 UUID derivation                           |     2 | `create_person.ts:125-145` vs `reminder_management.ts:356-377`                                                                                                  |
| Timestamp `to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` idiom    |   all | per column set in every repository                                                                                                                              |
| Optional-field spread row mapper                                |   all | `people_repository.ts:171-178`, `gift_repository.ts:72-104`, `task_repository.ts:23-40`, and `person_profile_repository.ts:106-133` drifts from it              |
| `try { transaction.run } catch { unavailable }` wrapper         |    27 | 102 call sites; 5 identical wrappers in `gift_management.ts` alone                                                                                              |
| Backend test scaffolding                                        |    43 | `assert()` copied in 36 of 43 files; actor/clock/audit/in-memory-repo fakes hand-rolled per file                                                                |

### 1.6 API delivery layer

- Every route file re-declares the same skeleton: `problem()` in 18 files with
  three divergent signatures (`gifts.ts:41-62`, `planning.ts:74-97`,
  `people.ts:243-266`), `cookieValue()` in 17, `actor()` in 15 (called 104
  times), `requireOrigin` in 12, and a per-domain `failure()` switch in 18.
  Roughly 70-75% of `gifts.ts` and `planning.ts` is this scaffold.
- No Hono middleware exists except the legal-acceptance guard
  (`composition.ts:397-405`). Session resolution and CSRF origin checks are
  manual per handler; GET routes have no origin check at all.
- Missing entirely: CORS, security headers on the API, request-ID correlation,
  structured request logging (zero `console.*` in non-test API code and no
  logger either), global body-size limit, centralized rate limiting, and a
  liveness/readiness split (single `/api/v1/health`).
- `apps/api/people.ts` is 1,775 lines mixing directory, timeline, profile-fact
  CRUD, important dates, identity edit, lifecycle, and create, with about 30 Zod
  schemas. `settings.ts` (980) and `invitations.ts` (785) mix six and seven
  concerns respectively.
- Business and infrastructure logic inside routes: IANA time-zone validation via
  `Intl.DateTimeFormat` inside a Zod refine (`settings.ts:41-48`), a hand-built
  Set-Cookie composer (`invitations.ts:86-101`), a weak IP regex
  (`invitations.ts:109`), and a hard-coded `role === "member"` gate
  (`imports.ts:101,120`) that every other domain enforces in the use case.
- **Contracts are a third hand-maintained copy.** `tools/contracts/generate.ts`
  (9,904 lines) hand-encodes every OpenAPI schema and hand-emits the TypeScript
  client as template strings. `contracts:check` only diffs generator output
  against the committed files; it cannot detect that a route's Zod schema and
  the OpenAPI literal have drifted. The dependency `@hono/standard-validator` is
  declared and never used.
- No response envelope or pagination convention. Cursor pagination exists for
  people, activity report, and audit history; tasks, gifts, debts,
  relationships, and files lists are unbounded.
- API tests: 18 files each define `assert()`, 9 duplicate the same actor
  fixture, no shared helper.

### 1.7 Frontend

- Stack conflict: `AGENTS.md` and `technology-baseline.md` require shadcn/ui,
  the accepted Phase 12 ledger selected vanilla TypeScript, and the September
  repair plan lists this as an unresolved decision. No React, Radix, `.tsx`, or
  `client:` directive exists anywhere. Resolved 2026-09-23 by ADR 0006 (adopt
  shadcn/ui in React islands).
- `apps/web/src/lib` is 46 flat feature files. Each fuses DOM querying, pure
  helpers, imperative DOM builders, network calls, closure state, and event
  wiring in one `mount*` function (`person-gifts.ts:208`, `journal.ts:209`). No
  reducer, dispatch, or view-model pattern exists (grep: 0), despite `AGENTS.md`
  asking for "one small pure reducer" before adding async owners.
- `src/pages/internal/person-profile-shell.astro` is an 852-line template that
  generates 22 section cards from one nested-ternary `.map()` (lines 257-840).
  The form-actions block is hand-typed about 10 times; the badge-plus-skeleton
  block 5 times. Only four `.astro` components exist in `src/components`.
- Section mounting uses three incompatible conventions: positional
  (`important-dates.ts:433`, `profile-facts.ts:836` with six parameters),
  options object (`person-gifts.ts:208`, `tasks.ts:131`), and zero-argument
  self-querying (`interactions.ts`, `audit-history.ts`). No `SectionMount` type.
- `profile-facts.ts` (1,808 lines) holds seven sub-forms behind one `buildForm`
  switch (168-291); its test is 3,370 lines.
- Network error idiom `.catch(() => undefined)` → `!result?.ok` → write
  `problem.detail` into a status node: 102 occurrences in 30 files.
- Forms: three independent field-error implementations (`auth-forms.ts:17-30`,
  `people-create.ts:27-97`, `profile-facts.ts:322`); `FormData` parsed by hand
  in 10+ files.
- CSS: real token system in `tokens.css`, but `.button-primary`,
  `.button-secondary`, `.form-actions`, `.section-state` are each defined in two
  stylesheets; `.state-badge` has about ten scattered rule blocks across three
  files; `.profile-section-card` is declared at `person.css:787` and again at
  `:1497`. `person.css` is 3,080 lines. `ApplicationLayout.astro:117-186`
  inlines both global dialogs into every page.
- Web tests are 1.9x the production code. 39 test files each define their own
  `markup()`/`response()` fixture builders; the only shared helper is
  `application-stylesheet.test-helper.ts`.

### 1.8 Tests and gates

- `deno.json` has 79 tasks. Test file lists are hand-maintained and duplicated
  across tasks (`apps/api/planning_test.ts` is in both `test:unit:api` and
  `test:unit:planning`); the 22-variable Postgres permission string is copied 11
  times; `test:coverage:api:direct` is a 7,626-character string.
- `test:coverage:lifecycle` is never invoked by `test:coverage`;
  `test:coverage:governance` and `:storage` do not exist. Coverage is enforced
  by per-task `--include` lists, so a file named in no list is never measured.
  `tools/coverage_manifest_test.ts` guards only 18 hard-coded Slice 7 files.
- Root `test` and `test:coverage` are red: REL-030 (`test:unit:planning` lacks
  the `READABLE_STREAM` env permission that `apps/worker/composition_test.ts`
  needs) and REL-031 (intermittent 30-second Astro readiness deadline under
  coverage).
- No CI, no Lefthook, no `check:architecture`, `test:prepush`, or `ci` task
  although `quality-gates.md:129-138` names them.
- Placement is inconsistent: 29 of 32 backend module tests sit at module root, 3
  are nested (`identity/application/password_recovery_test.ts`,
  `workspaces/application/member_ui_state_test.ts`,
  `workspaces/adapters/mail/smtp_verification_mail_test.ts`) with no rule.
  `identity_test.ts` covers five application behaviors monolithically.
- E2E specs and architecture tests are named by ticket ID (`app-006b.spec.ts` is
  the reminders test). 30 of 34 specs carry a `flow` annotation; 4 do not. The
  yaml `testRefs` and spec annotations are hand-synchronized with nothing
  verifying agreement.
- 16 of 17 integration files define their own register/sign-in/create-person
  helpers; `people_postgres_test.ts` is 5,706 lines. 33 of 34 E2E specs inline
  the registration POST; `tests/e2e` has no support file or page object.
- Thin coverage: `apps/worker/main.ts` is untested and in no coverage list; four
  of six read models (activity-report, audit-history, journal-timeline, today/*)
  never touch real Postgres; no object-storage fault injection; no visual
  regression.

### 1.9 Infrastructure and repository hygiene

- Observability contract unimplemented (no telemetry port, trace, span, request
  ID, or metrics in `apps/` or `packages/`).
- Gateway: no `limit_req_zone`/`limit_conn_zone`, no `X-Request-Id`, CSP uses
  `'unsafe-inline'` for scripts and styles, no explicit `ssl_ciphers`.
- `compose.dev.yaml` and `compose.test.yaml` duplicate the mailpit and
  object-store service blocks instead of sharing a file. `Dockerfile.gateway`
  and `Dockerfile.web` run two identical Astro builds. `.tool-versions` pins
  Node 24.15.0; both Dockerfiles pin 24.7.0.
- `docs/planning/tickets/**` is 194 tracked files (1.1 MB) of workflow logs
  consumed by no code. `.playwright-cli/` is not ignored. `CLAUDE.md` is absent.
- No `deno audit`/dependency audit task despite being named in the baseline.

### 1.10 Missing user-required functionality

Ranked by user value. The catalog is nearly complete; these are areas the
catalog never scoped or explicitly deferred, measured against the stated goal of
"a Monica-compatible relationship manager with AI assistance built in".

| #  | Gap                                                           | Evidence                                                                                                                   |
| -- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1  | Reminders have no email or push channel                       | `planning/application/reminder_delivery.ts` has no mail/push/webhook reference; only SMTP adapter is account verification  |
| 2  | Avatar upload and display                                     | `person_avatars` table exists; zero code outside import staging; catalog action `set-avatar` unimplemented                 |
| 3  | Life events are read-only                                     | `apps/api/people.ts:690` GET only; journal owns `life_events`; flow ID never decided                                       |
| 4  | Unbounded lists for tasks, gifts, debts, relationships, files | no `limit`/`cursor` in those routes                                                                                        |
| 5  | Import accepts Monica JSON only; no vCard, CSV, Monica SQL    | `import_management.ts:297`                                                                                                 |
| 6  | Export is JSON only                                           | `export_management.ts` hard-codes `format: "json"`                                                                         |
| 7  | Search covers people only                                     | only `people-directory` read model; notes, activities, journal, tasks invisible                                            |
| 8  | No merge of duplicate people                                  | `findPossibleDuplicates` fires only at create time                                                                         |
| 9  | No bulk actions on the directory                              | grep: none                                                                                                                 |
| 10 | CalDAV syncs VTODO only, no VEVENT for dates/reminders        | `http_dav_client.ts:96`                                                                                                    |
| 11 | Identity editing breadth; module visibility toggles           | repair plan "Decisions and existing deferrals"; `workspace_profile_modules` unused; all 22 sections render unconditionally |
| 12 | Notifications centre, favorites, directory tag cloud/sort     | UXD-020 parked                                                                                                             |
| 13 | AI assistance                                                 | zero application code; DG-08 gate open and unassigned; removed from scope by the product owner on 2026-09-26               |
| 14 | OAuth server, keyboard shortcuts, print styles, UI i18n       | schema-only / none                                                                                                         |

---

## Part 2 — Execution protocol for each ticket

1. Read `AGENTS.md`, `docs/development/autonomous-delivery.md`, Part 1 of this
   document, and the ticket. Do not re-audit; the evidence is recorded here.
2. Reproduce the ticket's problem with the narrowest focused test (RED), make
   the smallest architecture-compliant change (GREEN), refactor only while
   focused tests stay green.
3. Respect the accepted contracts: canonical schema v7 is unchanged unless the
   ticket says otherwise; mutations go through the owning module's facade;
   `apps/web` never imports `packages/backend`.
4. Run the ticket's listed verification plus the affected existing gates. Do not
   run the full matrix per ticket; the phase checkpoint does that.
5. Produce one candidate commit, get one independent read-only review, then tick
   the checkbox here with one line of evidence (test counts, coverage).
6. If an unrelated gate fails, reproduce once, prove causality, and queue a
   separate REL ticket in `active-delivery.md`. Do not expand the candidate.
7. Do not create workflow packets, evidence folders, or parallel ledgers.

Sizes: S ≤ 1 day, M = 2-5 days, L = 1-3 weeks of focused implementer time.

Phase checkpoints: after each phase, run root `check`, `test`, `test:coverage`,
`contracts:check`, `check:architecture` (once it exists), and the Chromium E2E
project once. Full three-browser E2E and image builds run at the end of Phases
0, 3, 4, and 7.

---

## Part 3 — Ordered tickets

### Phase 0 — Green gates and enforcement (prerequisite for every refactor)

- [x] **GAP-001 — Repair REL-030 planning unit-gate permission.** S. Depends:
      none.
  - Problem: `test:unit:planning` (`deno.json`) omits the `READABLE_STREAM` env
    permission that importing `apps/worker/composition_test.ts` needs, so root
    `test` is red.
  - Scope: add the permission to the owning task (or move the worker test to the
    task that already grants it); add a regression in
    `tools/configuration_contract_test.ts` proving root `test` reaches every
    unit task with sufficient permissions.
  - Verify: `deno task test:unit:planning` and root `deno task test` green.
  - Delivered 2026-09-15: test:unit:planning 46/0, root test green (contract,
    unit, integration 111/0, gateway-logs 2/0, web 718/0); coverage n/a (task
    config and contract test only); gates fmt:check, lint, check.

- [x] **GAP-002 — Repair REL-031 Astro readiness under coverage.** S-M. Depends:
      none.
  - Problem: root `test:coverage` intermittently fails the 30-second Astro
    readiness probe after 538 tests.
  - Scope: make the probe deterministic (warm the Astro child before the
    deadline, or measure readiness from the child's own ready signal instead of
    a fixed timeout); do not loosen readiness semantics. Add a focused
    reproduction that runs the probe under coverage three times.
  - Verify: root `deno task test:coverage` green twice in a row.
  - Delivered 2026-09-15: root test:coverage green twice in a row (api aggregate
    549/0 at 85.2% lines, scoped gates 81.0-91.2% lines, web 718/0 at 93.4%
    lines); 4 fake-clock probe tests in test:unit:api 315/0;
    test:repro:astro-readiness 3/3 runs; gates fmt:check, lint, check.

- [x] **GAP-003 — Task manifest and runner; collapse deno.json.** M. Depends:
      001, 002.
  - Problem: 79 tasks, hand-listed test files duplicated across tasks, the
    Postgres allowlist copied 11 times, orphaned `test:coverage:lifecycle`,
    missing governance/storage coverage tasks, files absent from every
    `--include` never measured.
  - Scope: create `tools/tasks/manifest.ts` (module → unit test globs, coverage
    includes, permission sets) and `tools/tasks/run.ts` (`unit`, `integration`,
    `coverage`, `contract` verbs with `--module=<id>`). Reduce `deno.json` to
    about 20 verbs. Make root `test` and `test:coverage` one truthful aggregate.
    Replace `tools/coverage_manifest_test.ts` with a general check: every
    `*_test.ts`/`*.test.ts` is reachable from root `test`, every production file
    under `apps/` and `packages/` is in some coverage include, no test file
    appears in two unit tasks. Add `deno audit` as `deps:audit`.
  - Non-goals: changing any test; changing coverage thresholds.
  - Verify: `deno task test`, `deno task test:coverage`, and the new manifest
    test green; task count ≤ 25.
  - Delivered 2026-09-15: root test green (18 unit modules incl. 718 vitest,
    integration 111/0), root test:coverage green (13 sets at 81.0-93.4% lines),
    manifest test 12/0, deno.json 25 tasks; gates fmt:check, lint, check.

- [x] **GAP-004 — CI pipeline and Lefthook hooks.** M. Depends: 003.
  - Problem: no CI, no hooks; every gate runs by hand.
  - Scope: `.github/workflows/ci.yml` with jobs: static (`fmt:check`, `lint`,
    `check`, `contracts:check`, `test:contract`, `deps:audit`), unit + coverage,
    integration (Postgres 18.4 service, `test:integration`), schema
    (`test:schema`), e2e-chromium on pull requests, e2e-all-browsers plus
    production image builds on `main` and nightly. Frozen installs
    (`deps:*:offline`). Add `lefthook.yml`: pre-commit `fmt`+`lint` on staged
    files, pre-push `test:unit` + `test:contract`. Rewrite the "Canonical
    Commands" and "Suggested CI Stages" sections of
    `docs/architecture/quality-gates.md` to match what exists.
  - Verify: workflow passes on a branch; hooks run locally.
  - Delivered 2026-09-15: pipeline contract 6 tests (tasks module 18/0);
    lefthook validate ok, pre-commit over all files ok, pre-push (test:unit +
    test:contract) ok in 160s; gates fmt:check, lint, check; the CI branch run
    is not executed here because it requires a push.

- [x] **GAP-005 — Generic architecture checker (`check:architecture`).** M-L.
      Depends: 003.
  - Problem: only 11 ticket-named text-grep spot checks; nothing validates
    `module-boundaries.yaml`, import layering, or SQL table ownership; the 54
    `crm.users` reads and the files → gifts read went undetected.
  - Scope: `tools/architecture/check_boundaries.ts` that (1) validates
    `module-boundaries.yaml` against `module-boundaries.schema.json`, (2) proves
    every table in `personal_crm_schema_v7.sql` has exactly one owner, (3) walks
    the import graph and enforces `layerRules` (cross-module only via
    `public.ts`; `application`/`domain`/`ports` may not import kysely, postgres,
    hono, minio, zod, `Deno.env`; read models never call
    `insertInto`/`updateTable`/`deleteFrom`; `apps/web` never imports
    `packages/backend`; only declared composition roots import adapters), (4)
    scans every `crm.<table>` token in each module's `adapters/` against
    `ownsTables` plus the owned tables of `allowedModuleDependencies`, (5)
    detects cycles. Known violations go into
    `tools/architecture/boundary-baseline.json` which may only shrink; the check
    fails on any new violation and on any baseline entry that no longer exists.
    Fold the 11 `tools/architecture/<TICKET>/` tests into regression cases of
    the checker and delete the folders. Wire `check:architecture` into `check`
    and CI.
  - Verify: checker green with the baseline; removing one baseline entry makes
    it red; CI job added.
  - Delivered 2026-09-15: checker suite 23/0 plus manifest and pipeline
    contracts (tasks module 41/0); check:architecture green with 98 baselined
    violations (2 layer, 30 table-access, 66 table-foreign-read) and red when
    one entry is removed; CI static step added; 5 of 11 spot-check folders
    folded, 6 kept for non-boundary invariants; gates fmt:check, lint, check;
    root test and coverage run at the Phase 0 checkpoint.

### Phase 1 — Shared kernel and backend consolidation

- [x] **GAP-006 — Create `packages/backend/shared-kernel` and adopt it in people
      and planning.** M. Depends: 005.
  - Problem: no shared kernel (mandated by `module-boundaries.yaml:5-18`); 48
    result unions, 25 clock shapes, duplicated precision enums, validators,
    cursor codecs, and deterministic ID derivation.
  - Scope: kernel modules with unit tests: `clock.ts` (`Clock`, `Instant`),
    `ids.ts` (`IdGenerator`, `deterministicId(namespace, parts)`), `result.ts`
    (shared failure statuses `forbidden`, `not-found`, `validation-error`,
    `archived-write-rejected`, `conflict`, `unavailable` plus a `Failure<Extra>`
    helper so modules extend rather than redeclare), `partial_date.ts`
    (`DatePrecision`, `componentShape`, `isRealCalendarDate`), `pagination.ts`
    (opaque cursor encode/decode, HMAC-signed variant), `validation.ts`
    (`optionalText`, `boundedText`, `instant`, `uuid`, `isoDate`, `isoTime`,
    `currencyCode`, `moneyAmount`). Kernel contains no I/O and no generic
    repository. Migrate `people` (important_dates, create_person,
    lifecycle_person, profile_facts) and `planning` (task_management cursor and
    validation, reminder_management deterministic IDs) to consume it; unify
    `ImportantDatePrecision` and `PersonLifeEventPrecision`.
  - Verify: kernel ≥ 95% coverage; people and planning unit and integration
    tests green; `check:architecture` allows `shared-kernel` per `layerRules`.
  - Delivered 2026-09-16: kernel 28/0 at 98.6% branch and 100% line/function
    against an enforced 95% threshold; api unit 328/0, planning unit 46/0, tasks
    43/0; api integration 57/0, planning integration 34/0; check:architecture
    treats the kernel as a leaf unit with the baseline unchanged at 98; derived
    identifiers pinned byte-compatible with the pre-kernel derivation; gates
    fmt:check, lint, check.

- [x] **GAP-007 — Adopt the shared kernel in the remaining 12 modules and 6 read
      models.** M. Depends: 006.
  - Scope: replace local clock/id types, `optional`/`text`/`instant` helpers,
    status unions, and the `try { transaction.run } catch { unavailable }`
    wrapper (introduce `runOrUnavailable(transaction, fn)` in the kernel or
    `platform/postgres`). Replace `crypto.randomUUID()` at
    `workspaces/application/workspace_lifecycle.ts:397` with the injected
    generator. Delete the local duplicates.
  - Verify: all backend unit tests green; grep shows zero local `optional()` or
    `readonly status: "forbidden"` declarations outside the kernel.
  - Delivered 2026-09-16: all 18 unit sets green plus 718 vitest, integration
    111/0; zero local optional/text helpers and zero
    `readonly status: "forbidden"` declarations remain in packages/backend
    (tests included); 14 transaction wrappers replaced by the kernel
    runOrUnavailable (kernel 32/0 at 98.6% branch, 100% line); baseline
    unchanged at 98; gates fmt:check, lint, check. Deferred and reported:
    `{ next(): string }` id shapes, adapter-layer randomUUID, per-module cursor
    codecs.

- [x] **GAP-008 — Actor revalidation port, wave 1 (people, relationships,
      planning).** L. Depends: 005, 006.
  - Problem: the account/member/workspace activity join is copied into 24
    adapters, crosses `identity` ownership without declaration, and is skipped
    by two repositories.
  - Scope: `workspaces` (already allowed to depend on `identity`) exposes an
    `ActorRevalidation` port from `public.ts` with one Postgres adapter that
    locks and verifies `users`, `workspace_members`, `workspaces` for a given
    actor inside the caller's transaction and returns `active | revoked`.
    Declare it in `module-boundaries.yaml` as the single approved actor-context
    read. Use cases call it first inside the transaction; repositories drop the
    join and filter by `workspace_id` (plus aggregate ownership). Apply to
    people, relationships, planning; shrink the boundary baseline accordingly.
    Add a negative integration test per module proving a revoked member cannot
    write.
  - Verify: baseline entries for those modules removed; integration tests green;
    no behavior change in existing E2E.
  - Delivered 2026-09-16: baseline 98 -> 80 (all 18 people actor-join entries
    removed; relationships had none; planning keeps 4 worker recipient-scan
    entries that are not the actor join); negative revocation integration tests
    green (api 58/0, planning 35/0, exports 2/0, imports 3/0); unit api 329/0,
    planning 46/0, tasks 46/0; lock downgraded to for no key update to avoid an
    FK deadlock, still blocking every revocation update; gates fmt:check, lint,
    check. E2E behaviour proof deferred to the Phase 1 checkpoint.

- [x] **GAP-009 — Actor revalidation wave 2 and the files → gifts edge.** L.
      Depends: 008.
  - Scope: interactions, journal, gifts, files, governance, api-access,
    import-export, integrations, and workspaces' own adapters. For
    `gift_attachment_boundary.ts:80-97`, have `gifts` expose a
    `GiftAttachmentTarget` port from its `public.ts` (gifts already depends on
    files, so files must not query gifts) and inject it. Boundary baseline
    reaches zero `crm.users` and zero undeclared edges; delete the baseline file
    if empty.
  - Verify: `check:architecture` green with an empty baseline; all integration
    suites green.
  - Delivered 2026-09-16: baseline 80 -> 18 with zero crm.users reads outside
    identity and the approved adapter and zero table-access entries; the 16
    declared-dependency foreign reads outside the actor join and the 2 SMTP
    layer entries owned by GAP-013 stay by controller decision, so the baseline
    file is kept; GiftAttachmentTarget port closes files -> gifts; identity asks
    a workspaces port for the sign-in landing workspace; 10 negative revocation
    integration tests; unit 18 sets plus 718 vitest green, integration 123/0;
    gates fmt:check, lint, check. Read models revalidate in a short separate
    transaction before their lock-free reads.

- [x] **GAP-010 — Platform Postgres helpers and the display-name formula.** M.
      Depends: 006.
  - Scope: `platform/postgres/` gains `timestamps.ts` (the single `to_char`
    fragment and `instantColumn(name)`), `rows.ts` (`pickDefined` mapper),
    `errors.ts` (Postgres error → kernel status: unique violation → `conflict`,
    FK → `not-found`, serialization → `unavailable`), `transactions.ts` (one
    transaction wrapper replacing the people-only `PostgresPeopleTransaction`),
    and `person_display.ts` (one SQL fragment plus one TS `displayName`).
    Replace the 20 display-name occurrences and the per-repository idioms.
  - Verify: unit and integration tests green; grep finds one definition of the
    `Unnamed person` fallback.
  - Delivered 2026-09-16: platform/postgres gained timestamps, rows, errors,
    transactions, and the SQL person-display fragment (13 platform tests); 93
    to_char fragments, 108 conditional spreads, 4 SQLSTATE guards, and 5 runner
    classes consolidated; the TypeScript formula and its single `Unnamed person`
    literal live in the people domain and the platform fragment takes the
    fallback as an argument; the checker now refuses platform imports from
    application, domain, and ports layers; unit 18 sets plus 718 vitest green,
    integration 123/0, baseline unchanged at 18; gates fmt:check, lint, check.
    Six web copies of the fallback remain for a frontend ticket.

- [x] **GAP-011 — Generic audit recorder for governance.** M. Depends: 006.
  - Scope: one `PostgresAuditEventRecorder` with `record(event)` and
    `assertRecorded(expected)`; each of the 21 audited events becomes a small
    pure `describeXEvent(command) → AuditEvent` function colocated with its
    owning module's application code (governance keeps the writer). Delete the
    21 adapter classes. Keep `authentication_audit.ts` pre/post-condition
    behavior as recorder options.
  - Verify: `governance` and consuming modules' tests green; audit-history read
    model unchanged; ≥ 700 lines removed.
  - Delivered 2026-09-17: one `PostgresAuditEventRecorder` (`record`,
    `recordWhen`, `assertRecorded`, with `created_at` as an option) replaced the
    22 governance audit adapters, all deleted along with the duplicate
    relationship port; the 22 events are pure `describeXEvent` functions with
    `xAuditFrom(recorder)` factories in ten modules' application code, and the
    `AuditEvent` contract lives in the shared kernel so no module imports
    governance; 1266 lines deleted, net +312 after the kernel move; every row
    verified identical to its deleted adapter; audit-history read model
    unchanged; payloads now stored as jsonb objects instead of double-encoded
    strings; baseline 18 → 16 (the two governance reads of planning's tables);
    unit 718 vitest plus all sets green, integration 123/0; coverage sets green
    except the pre-existing `gifts` branch floor tracked by REL-037; gates
    fmt:check, lint, check, check:architecture.

- [x] **GAP-012 — Generic workspace lifecycle impact and personalization
      references.** S-M. Depends: 006.
  - Scope: `platform/postgres/lifecycle_impact.ts` generic class driven by a
    per-module `{ counts, revisionSources }` spec; 11 files become 11 specs.
    `platform/postgres/reference_counter.ts` generic count/replace with a
    pluggable composite-key conflict detector; 8 files become 4 specs.
  - Verify: workspace lifecycle and personalization tests green; ≥ 300 lines
    removed.
  - Delivered 2026-09-17: `platform/postgres/` gained `workspace_scope.ts` (one
    ownership-path source string compiled to the from-list and predicate that
    select, update, and delete share), `lifecycle_impact.ts` (counts, digest,
    and object keys from a per-module spec), and `reference_counter.ts` (count,
    rewrite, label-junction insert-and-delete, and a declared composite-key
    conflict rule); the 11 lifecycle impact adapters and 4 personalization
    reference adapters are specs that keep their export names, and the
    interactions and journal replace ports return the same outcome as the
    others; the impact digest is byte-identical so held previews stay valid; 583
    lines deleted, net -310 on pre-existing files, +547 lines of platform code
    with 17 pinned SQL tests; a new
    `workspace_lifecycle_impact_postgres_test.ts` runs all 11 participants
    against the real schema (3 tests, mutation-checked against a broken join);
    unit 718 vitest plus all sets green, integration 126/0, baseline unchanged
    at 16, coverage sets green except the parked `gifts` floor (REL-037); gates
    fmt:check, lint, check, check:architecture. One `tools/e2e_test.ts` Astro
    child start flake passed on rerun (REL-034).

- [x] **GAP-013 — Per-module composition and a thin composition root.** L.
      Depends: 007.
  - Problem: `public.ts` conflates facade and adapter registry; the composition
    root is a 595-line function; `main.ts` builds an adapter.
  - Scope: each module gets `composition.ts` exporting `composeX(shared)` where
    `shared = { clock, ids, transaction, mail?, objectStore? }`; it returns the
    module's public facade objects. `public.ts` exports only types and
    application factories (no `Postgres*` classes). Cross-cutting wiring
    (lifecycle impact map, personalization router, DAV bridges, publisher links)
    stays in `apps/api/composition.ts`, which should drop to about 250 lines.
    Move SMTP construction from `main.ts` into the root. Rename
    `apps/api/personalization_repository.ts` to `personalization_router.ts`. Add
    checker rule: only declared composition roots may import a module's
    `composition.ts`.
  - Verify: `apps/api/app_test.ts`, worker composition test, all integration
    suites green; `check:architecture` green.
  - Delivered 2026-09-17: every module and read model that owns adapters has a
    `composition.ts` exporting `compose<Module>(shared, ports)`; the shared
    context is one typed contract in `platform/composition.ts`; every
    `public.ts` re-exports no adapter value (four adapter types remain);
    `createConfiguredApiApp` went from 650 to 207 lines (file 1287 to 930),
    `main.ts` from 102 to 35, the worker root from 104 to 87, and the runtime
    assembly with SMTP construction moved into the API root; the production
    preflight is a declared third composition root, so the two SMTP `layer`
    entries left the baseline (16 to 14, nothing added); the checker gained the
    `composition` and `public-surface` rules with four tests;
    `personalization_repository.ts` became `personalization_router.ts`; 55 files
    changed (+1135/-1509) plus 22 new files (1526 lines); unit 718 vitest plus
    all sets green, integration 126/0, coverage api 86.4 branch, build and
    contracts:check green; gates fmt:check, lint, check, check:architecture.

- [x] **GAP-014 — Backend and API test support package.** M. Depends: 006.
      Parallelizable with 008-013.
  - Scope: `packages/backend/testing/` (allowed by the layout contract as a
    test-only package that exposes no private production internals):
    `assert.ts`, `fixtures.ts` (actor, workspace, member, person builders with
    deterministic IDs), `fakes.ts` (fake clock, sequential ids, recording audit,
    `inMemoryRepository(keyOf)` helper, fake mail, fake object store). Migrate
    the 43 backend and 20 API unit tests to it; delete the 36 local `assert()`
    copies.
  - Verify: all unit tests green; coverage unchanged or higher.
  - Delivered 2026-09-17: `packages/backend/testing/` holds `assert.ts` (assert,
    assertEquals with the JSON-text semantics the copies relied on,
    assertThrows, assertRejects, assertStatus), `fixtures.ts` (deterministic
    uuid, user, member, workspace, person ids and actor, workspaceActor,
    sessionActor, person builders, typed structurally), and `fakes.ts`
    (fixedClock, sequentialIds, recordingAudit satisfying the kernel recorder,
    inMemoryRepository, fakeMail, fakeObjectStore), each with its own suite and
    importing only shared-kernel types; 93 local assertion copies removed (69
    assert, 5 assertEquals, 1 assertRejects, 18 in integration suites), 95 test
    files migrated, 33 actor literals and 49 inline clocks replaced; the layout
    contract now names the package and its three constraints; 97 files changed
    (+560/-986) plus 858 new lines; every coverage set unchanged or higher (api
    86.4 to 86.5 branch), `gifts` still at the parked REL-037 floor; unit 718
    vitest plus all sets green, integration 126/0, baseline 14 unchanged; gates
    fmt:check, lint, check, check:architecture. Bespoke doubles with failure
    toggles were left in their tests by decision.

### Phase 2 — Module internal structure (domain and ports)

- [x] **GAP-015 — Domain and ports extraction: people.** L. Depends: 006, 010.
  - Scope: `modules/people/domain/` with pure modules and unit tests
    (`profile_facts/normalize.ts`, `profile_facts/validate.ts`,
    `important_dates/rules.ts`, `person_identity.ts`, `lifecycle_rules.ts`);
    `modules/people/ports/` holding repository and boundary interfaces
    (`PersonRepository`, `ProfileFactRepository`, …) separated from DTOs.
    Application files orchestrate only. Target: no application file over 400
    lines; domain has no I/O imports (enforced by GAP-005).
  - Verify: people unit + integration green; domain ≥ 95% coverage.
  - Delivered 2026-09-17: `people/domain/` gained `person_identity.ts`,
    `lifecycle_rules.ts` (with pure edit, transition, and deletion decisions),
    `important_dates/rules.ts` (normalisation, validation, and the scheduling
    rule the adapter now calls), and
    `profile_facts/{values,normalize,
    validate,cursors}.ts`, each with a
    colocated suite and importing only same-module domain and the shared kernel;
    `people/ports/` holds `context.ts` (actor, transaction, runner), four
    repository and boundary files, and `audit.ts`; `profile_facts.ts` (995
    lines) became a 30-line facade over `profile_fact_context.ts`,
    `profile_fact_listing.ts` (291), and `profile_fact_writes.ts` (295), and the
    largest application file is now 336 lines; every `public.ts` name is still
    exported; domain coverage 100/100/100 in the new `people` manifest set, api
    set up to 87.1 branch; 12 files changed (+327/-1583) plus 23 new files (3197
    lines); unit 718 vitest plus all sets green, api integration 62/0,
    contracts:check green, baseline 14 unchanged; gates fmt:check, lint, check,
    check:architecture.

- [x] **GAP-016 — Domain and ports extraction: planning and relationships.** L.
      Depends: 015.
  - Scope: same pattern for `task_management`, `reminder_management`,
    `reminder_delivery` (cadence math, occurrence generation, time-zone rules
    into `planning/domain/`), and `manage_relationships` (inverse/romantic rules
    into `relationships/domain/`).
  - Verify: as above; reminder time-zone and DST tests moved to domain.
  - Delivered 2026-09-17: `planning/domain/` gained `recurrence.ts` (the
    Temporal calendar math, with the DST, fold, month-edge, and time-zone tests
    moved into `recurrence_test.ts`), `cadence.ts`, `reminder_rules.ts`,
    `task_rules.ts`, `cursors.ts` (over the kernel's signed cursors), and
    `delivery_rules.ts`; `planning/ports/` holds context, task, reminder,
    delivery, and audit contracts; `InAppReminderDelivery` moved to
    `adapters/in_app/`; `relationships/domain/` gained `relationship_rules.ts`
    (inverse labels, relabelling, success shapes, validation; no romantic rule
    existed to extract) and `cursors.ts` over the kernel codecs, with
    `relationships/ports/` beside it; `task_management.ts` (768),
    `reminder_management.ts` (757), and `manage_relationships.ts` (830) are
    facades over context, listing, and write files, the largest application file
    is 319 lines, and every previous `public.ts` name except the adapter class
    is still exported; both domain sets at 100/100/100 in the new
    `planning-domain` and `relationships` manifest entries, `planning` set up to
    89.7 branch, api set to 87.5; review found three literal NUL bytes in
    `cadence.ts`, fixed as `\u0000` escapes with the fingerprint digest pinned
    against main, and the new `tools/source_hygiene_test.ts` guard now fails the
    unit gate on any raw NUL in a source file, which also exposed and fixed one
    in `integrations/composition.ts`; 17 code files changed (+316/-2676) plus 35
    new files (5090 lines); unit 718 vitest plus all sets green, integration
    126/0, contracts:check green, baseline 14 unchanged; gates fmt:check, lint,
    check, check:architecture.

- [x] **GAP-017 — Domain and ports extraction: interactions, journal, gifts,
      files.** M-L. Depends: 015.
  - Delivered 2026-09-17: interactions gained `domain/communication_rules.ts`
    and `domain/interaction_rules.ts` (records, message canonicalisation,
    validation, replay matching, and the aggregate, call, conversation, and
    message id derivations now on the kernel's `deterministicId`, pinned
    byte-identical to main; the client-id pattern stays local because it must
    refuse the version-8 ids the backend derives), journal
    `domain/
    journal_rules.ts`, gifts `domain/gift_rules.ts` (status
    vocabularies, transition tables, money, hydration), and files
    `domain/file_rules.ts` (size, kind and status vocabulary, allowed media,
    checksum, upload validation); each module gained `ports/` with context,
    repository, boundary, and audit contracts; `record_communication.ts` (717),
    `record_interaction.ts` (641), `gift_management.ts` (572), and
    `person_files.ts` (584) are facades over context, listing or reads, and
    write files, the largest application file is 267 lines, and every previous
    `public.ts` name is still exported; domain sets at 99.4 / 100 / 99.4
    (interactions) and 100 / 100 / 100 (files, gifts, journal) in the new
    `interactions`, `files`, `gifts-domain`, and `journal-domain` manifest
    entries; gifts, journal, and storage sets unchanged or higher, api set to
    87.8 branch; 26 files changed (+338/-2759) plus 38 new files (5393 lines);
    unit 718 vitest plus all sets green, integration 126/0, contracts:check
    green, baseline 14 unchanged; gates fmt:check, lint, check,
    check:architecture.
- [x] **GAP-018 — Domain and ports extraction: workspaces, identity, governance,
      import-export, integrations, api-access.** M-L. Depends: 015.
  - Both: same pattern; identity keeps `ports/security.ts`; import-export
    isolates format parsing into `domain/formats/` (prepares GAP-050).
  - Verify: all backend gates green; `check:architecture` layer rules extended
    to `domain/` and `ports/`.
  - Delivered 2026-09-17: import-export gained `domain/formats/` with
    `canonical.ts` (one canonical JSON and SHA-256 pair), `monica_source.ts`
    (the whole Monica import profile), `portable_json.ts`, and `vcard.ts`, plus
    `import_rules.ts` and `export_rules.ts`, every fingerprint, canonical text,
    digest, and vCard line pinned by fixed vectors and proven equivalent to main
    over about 200 inputs, so GAP-050 adds CSV and vCard sources as siblings;
    workspaces gained nine domain modules (roles, session, registration,
    invitation, settings, personalization, workspace and personal lifecycle, UI
    state rules) and thirteen port files; identity keeps `ports/security.ts`
    beside eight more port files and a deliberately small domain; governance,
    integrations, and api-access each gained a domain module and ports; the
    eleven largest application files are facades or orchestration under 400
    lines (largest `invite_member.ts` at 372); nine application contract files
    moved into `ports/`; every previous `public.ts` name is still exported; the
    six domain sets measure 100/100/100 except import-export at 99.0 branch,
    every wider set is above its floor after three real coverage gaps were
    closed with tests, api set up to 88.5 branch; the checker already covered
    `domain/` and `ports/`, so `module-boundaries.yaml` and the 14-entry
    baseline are untouched; 69 files changed (+1487/-4755) plus 87 new files
    (9232 lines); unit 718 vitest plus all sets green, integration 126/0,
    contracts:check and build green; gates fmt:check, lint, check,
    check:architecture. The `lifecycle` coverage set flapped once in four runs
    on a pre-existing timing sensitivity (see REL-038).

### Phase 3 — API delivery layer

- [x] **GAP-019 — HTTP kit and middleware; migrate gifts, journal, planning.**
      M-L. Depends: 006.
  - Scope: `apps/api/http/`: `problem.ts` (one RFC 9457 responder with optional
    `errors`), `session.ts` (Hono middleware that resolves the `kinship_session`
    cookie and `X-Workspace-Id` into `c.var.actor`; bearer API-token variant
    with scope check), `origin.ts` (middleware rejecting unsafe methods without
    a matching Origin), `failures.ts` (kernel status → HTTP status/code map with
    per-domain extension), `validate.ts` (Zod parse → problem with field errors,
    built on `@hono/standard-validator` or remove that dependency),
    `cookies.ts`, `request_id.ts`, `logging.ts` (structured JSON request log
    through a `Logger` port), `body_limit.ts`, `health.ts` (`/livez`, `/readyz`,
    keep `/api/v1/health`), API-side `secure-headers` and explicit CORS
    (same-origin deny by default). Migrate `gifts.ts`, `journal.ts`,
    `planning.ts` and their tests.
  - Verify: the three route tests plus integration suites green; grep shows zero
    `function problem(` outside `http/`.
  - Delivered 2026-09-17: `apps/api/http/` holds twelve kit modules with a suite
    each at 100/100/100: the one RFC 9457 `problem` responder, a `failures` map
    from the kernel statuses to HTTP with per-domain `FailureTable` extension
    resolved at composition time, a `session` middleware that memoises the
    cookie-and-workspace actor with `requireActor` and the scope-checked bearer
    variant, `origin` as both middleware and responder, `cookies` (value reader
    and Set-Cookie composer), `validate` (Zod to problem with field errors),
    `request_id`, `logging` through a `Logger` port (route pattern, status,
    duration, request id; never a header, cookie, token, or body), a 1 MiB
    `body_limit` with an upload exemption, `health` adding `/livez` and
    `/readyz` beside the unchanged `/api/v1/health`, `secure_headers` adding
    only what `gateway/security_headers.conf` does not (a test re-reads that
    file), and a hand-written same-origin `cors` applied after `next()` because
    Hono's built-in dropped a Set-Cookie appended to a built response; the root
    mounts them in the order request id, logging, secure headers, CORS, body
    limit, health, legal guard, routes; gifts, journal, and planning dropped
    their scaffold (309 to 241, 240 to 187, 646 to 561 lines) with every
    refusal's body byte-identical, `function problem(` now defined once with 15
    copies left for GAP-020; `@hono/standard-validator` and
    `@standard-schema/spec` removed from deno.json and the lockfile; gifts,
    journal, planning, and api coverage sets up on branch (gifts line 96.8 to
    96.4 only because the migrated file shrank); 10 files changed (+1098/-945)
    plus 24 new files (2530 lines); unit 718 vitest plus all sets green,
    integration 126/0, contracts:check, build, and test:repro:astro-readiness
    green, baseline 14 unchanged; gates fmt:check, lint, check,
    check:architecture. Decisions: the gateway stays the single owner of its six
    browser headers; `/livez` and `/readyz` wait for the Phase 6 infrastructure
    tickets to be referenced.

- [x] **GAP-020 — Migrate the remaining 15 route files to the HTTP kit.** M-L.
      Depends: 019.
  - Scope: api_tokens, authentication, exports, files, governance, imports,
    integrations, interactions, invitations, people, personal_lifecycle,
    registration, relationships, settings, workspace_lifecycle. Move business
    logic out of routes: IANA validation into the workspaces settings use case
    (`settings.ts:41-48`), cookie composition into `http/cookies.ts`
    (`invitations.ts:86-101`), client-address parsing into the kit with a real
    IP parser (`invitations.ts:109`), the imports role gate into the import use
    case (`imports.ts:101,120`). Delete `personalization_repository.ts`'s unused
    paths if any.
  - Verify: all `apps/api/*_test.ts` and integration suites green; removable
    scaffold (≈ 2,200 lines) gone.
  - Delivered 2026-09-17: all fifteen route files are on the HTTP kit with their
    refusals as `FailureTable`s and named `ProblemDefinition`s, every code,
    title, and detail preserved and checked mechanically against the
    pre-migration literals; 84 duplicated helpers (1628 lines of scaffold) are
    gone and `function problem(` exists once, in `http/`; the IANA time-zone
    rule is `isSchedulableTimezone` in the workspaces settings domain and the
    use case refuses `invalid-timezone` itself, cookie composition is the kit's
    `setCookie`, client addresses go through `http/client_address.ts` (a strict
    IPv4 and RFC 4291 IPv6 parser that refuses zone ids, brackets, and ports),
    the imports role gate is `mayImport` in the import domain asked by all four
    paths, and `personalization_router.ts` lost its one dead replacement path;
    the kit grew `readActor`, `sessionOf`, `workspaceScopedActor`, problem
    extensions, and a shared private-download helper; the only wire-visible
    change is governance's problem `type` host normalised from `kinship.invalid`
    to `kinship.test` and the body key order unified, which no contract, test,
    or client read; route files went from 7857 to 7066 lines; 41 files changed
    (+6516/-5746) plus 4 new files (406 lines); unit 718 vitest plus all sets
    green, integration 126/0, every coverage set unchanged or higher per file
    (governance 84.8 to 99.4 line), contracts:check, build, and astro-readiness
    green, baseline 14 unchanged; gates fmt:check, lint, check,
    check:architecture.

- [x] **GAP-021 — Split people.ts, settings.ts, invitations.ts by concern.** M.
      Depends: 020.
  - Scope:
    `apps/api/people/{directory,profile,facts,dates,identity,lifecycle}.ts`,
    `apps/api/settings/{ui_state,profile,preferences,sessions,workspace,members,personalization}.ts`,
    `apps/api/invitations/{create,accept,register}.ts`; tests split alongside;
    no file over 400 lines.
  - Verify: route tests and `people_postgres_test` green; OpenAPI unchanged.
  - Delivered 2026-09-17: `apps/api/people/` holds directory (list, tag-options,
    view, today recent-people), profile (read, life events, timeline), facts,
    dates, identity (edit, create), and lifecycle concerns; `apps/api/settings/`
    holds ui_state, profile, preferences, sessions, workspace, members, and
    personalization; `apps/api/invitations/` holds create (with the
    workspace-members list), register (with verification delivery), and accept
    (authenticate, MFA, inspect, accept); shared schemas, presenters, and
    failure tables sit in each domain's `shared.ts`, with three schema or
    failure files split out only to stay under 400 lines; the three facades
    (185, 131, and 100 lines) mount the concerns and re-export every name, so
    `apps/api/composition.ts` and `apps/api/http/` did not change; all 48 tests
    moved byte-identical into 20 per-concern suites plus six mount-order tests,
    one of which proves the tag-options literal still beats the person-id
    parameter; largest file 361 lines; the per-domain `*.test-helper.ts`
    scaffolding is excluded from coverage by a new manifest `exclude` field; 9
    files changed (+338/-6315) plus 45 new files (7564 lines); unit 718 vitest
    plus all sets green, integration 126/0, api set 89.1 / 85.9 / 92.1,
    contracts:check and build green, baseline 14 unchanged; gates fmt:check,
    lint, check, check:architecture.

- [x] **GAP-022 — Contracts derived from Zod; retire the hand-written
      generator.** L. Depends: 020.
  - Problem: three hand-maintained copies of every schema and a drift check that
    cannot see drift.
  - Scope: move request/response Zod schemas to
    `packages/contracts/schemas/<domain>.ts` (imported by routes and by the
    generator). Register routes through a small typed registry
    (`defineRoute({ method, path, request, responses, operationId })`) that the
    Hono app mounts and the generator reads. Generate `openapi.json` with
    `zod-openapi` (or `@hono/zod-openapi`) and the client with
    `openapi-typescript` plus a thin fetch wrapper that preserves the current
    124 `auth-client.ts` function names via a generated compatibility barrel so
    `apps/web` does not change in this ticket. Delete
    `tools/contracts/generate.ts`. `contracts:check` now proves committed
    artifacts equal generated output and that every mounted route is in the
    OpenAPI document.
  - Verify: `contracts:check`, `packages/contracts/*_test.ts`, web unit tests,
    and Chromium E2E green.
  - Delivered 2026-09-17: `packages/contracts/schemas/<domain>.ts` (19 modules)
    hold every request and response schema as Zod with 258 components named by
    `meta`, `packages/contracts/routes/<domain>.ts` hold one `defineRoute`
    descriptor per operation (126 routes, 123 documented, the three probes
    marked undocumented) validated at module load, and `apps/api/http/route.ts`
    `mount` derives Hono's path from the same descriptor so mounting and
    documenting share one source; `apps/api/routes_test.ts` asserts the mounted
    app equals the registry; `tools/contracts/build.ts` (518 lines across three
    files) renders `openapi.json` with `zod-openapi` 6.0.2 and the types with
    `openapi-typescript` 7.13.0, and generates the compatibility barrel from the
    authored `packages/contracts/client/<domain>.ts` wrapper, whose 124 function
    names and 155 type names a contracts test pins (111 types are now aliases
    into the generated types); `tools/contracts/generate.ts` (9904 lines) is
    deleted; `contracts:check` proves the three artefacts current and the
    mounted and documented surfaces equal without Postgres; the document keeps
    99 paths, 123 operations, and 254 components (two named where a deep pointer
    was), with 117 ordering, naming, and explicit-default differences and no
    shape change; three real drifts surfaced and were fixed (two path parameter
    names and twelve path-level parameters), and one undocumented query
    parameter on the person audit route is now refused; `deps:audit` unchanged
    at the five parked moderates; 51 files changed (+11423/-22917) plus 71 new
    files (24359 lines); unit 718 vitest plus all sets green, integration 126/0,
    api set function coverage 86.0 to 94.0, build green, Chromium E2E 53 passed
    with only the four parked failures; gates fmt:check, lint, check,
    check:architecture.

- [x] **GAP-023 — Pagination and response conventions.** M. Depends: 022.
  - Scope: cursor pagination (`limit` 1-50, `cursor`, `nextCursor`) for tasks,
    gifts, debts, relationships, files, reminders, journal lists using the
    kernel codec; document response and timestamp conventions in
    `docs/architecture/backend-architecture.md`; move the `settings.ts`
    `toISOString` formatting into the use case. Web lists gain a "Load more"
    control via the core kit (GAP-026 may land first; otherwise a minimal
    control).
  - Verify: contract tests updated; E2E for tasks and profile sections green.
  - Delivered 2026-09-23: `docs/architecture/backend-architecture.md` gains
    `## Pagination` (`limit` 1-50 default 20, opaque `cursor` of at most 2,000
    characters, `next…Cursor` only when more rows exist, `limit + 1` reads, a
    stable key pair ending in the row id, workspace and person bound into the
    cursor, 400 `*_query_invalid` for a malformed or foreign cursor while tasks
    keep 409 `task_cursor_stale`) and `## Response and Timestamp Conventions`;
    `packages/contracts/schemas/shared.ts` publishes `pageQuery`; new plain
    kernel-codec cursors in `files`, `gifts`, and `journal` `domain/cursors.ts`
    and a reminder cursor beside the signed task cursor in
    `planning/domain/cursors.ts`; tasks 100/100 to 20/50, relationships 20/20 to
    20/50, gifts and debts from unbounded to one endpoint with
    `giftCursor`/`debtCursor` and `nextGiftCursor`/`nextDebtCursor`, files and
    reminders from unbounded or fixed 100 to 20/50, and the journal from a fixed
    200 to 20/50; the authored client gains a trailing optional page argument
    with the 124 names unchanged; the settings use case returns ISO session
    timestamps and the route passes them through byte-identically;
    `apps/web/src/components/LoadMore.astro` and `lib/load-more.ts` (focus kept
    during a load, handed to the list when the last page hides the control)
    drive tasks, gifts, debts, files, reminders, and the journal; the gift
    attachment picker now reads the first 50 files; 81 files changed
    (+2714/-253) plus 9 new files (867 lines); unit 734 vitest plus all sets
    green, integration 130/0, every coverage set unchanged or higher against
    main except `lifecycle`, which dipped only in the REL-038 file;
    `contracts:generate` idempotent, `contracts:check` 123 documented and 126
    mounted, build green, Chromium E2E 53 passed with only the four parked
    failures; gates fmt:check, lint, check, check:architecture (14).

- [x] **GAP-024 — Move routes into module `transport/http/`.** L. Depends:
      013, 021. Contract alignment; may be deferred after Phase 4 if capacity is
      short.
  - Scope: each module owns `transport/http/routes.ts` (+ tests) built on the
    HTTP kit; `apps/api/composition.ts` mounts `module.routes(services)`.
    Checker: transport may import same-module public/application and
    generated-contract support only.
  - Verify: all API and integration gates green; `apps/api` contains only the
    kit, composition, main, and config.
  - Delivered 2026-09-23: the kit moved from `apps/api/http/` to
    `packages/http-kit/` (15 modules with suites, plus `security_policy.ts`
    holding `BrowserSecurityPolicy` while `browserSecurityPolicy()` stays in
    `apps/api/security_config.ts`); every route surface moved unchanged apart
    from import paths into its owning module's `transport/http/` (`api-access`,
    `files`, `gifts`, `governance`, `integrations`, `interactions`, `journal`,
    `planning`, `relationships` one-to-one; `people` with its GAP-021 split;
    `import-export` for imports and exports; `workspaces` for registration,
    authentication, invitations, settings, and both lifecycles), each behind one
    `transport/http/routes.ts` that `apps/api/composition.ts` imports directly
    and mounts in the same order; routes are not re-exported from `public.ts` or
    a module `composition.ts`, so the worker graph loads no Hono or transport
    code; read models carry no `transport/` and are served by the module they
    project, reached through their facade only when they list that module in
    `sourceModules`; two undeclared cross-module type imports became
    consumer-owned structural ports (`ScopedTokenAuthority`,
    `SessionLegalRequirements`); `check_boundaries.ts` gains the `transport`
    layer rule and lets a declared composition root import only another module's
    `transport/http/routes.ts` (five new tests, baseline unchanged at 14);
    `module-boundaries.yaml` `transportMayImport` and `compositionMayImport`
    name `contracts` and `http-kit`, and `repository-layout.md` documents the
    kit and the transport rule; `apps/api` keeps 15 files (`main.ts`, `app.ts`,
    `composition.ts`, `personalization_router.ts`, the three configuration
    files, and the root-level suites); `openapi.json`, the generated client, and
    `apps/web` are unchanged; 128 files changed (+1614/-987, renames detected);
    unit and integration 130/0 green, every coverage set unchanged against main
    except the REL-038 file, `contracts:check` 123 documented and 126 mounted,
    build green; the Chromium E2E runs showed `app-004a` and `app-003b` failing
    beside the four parked specs, both browser-side and passing when repeated
    (REL-039), while main measured 53 passed with only the four parked failures
    on the same host; gates fmt:check, lint, check, check:architecture (14).

### Phase 4 — Frontend structure

- [x] **GAP-025 — ADR 0006: UI stack decision.** S. Depends: none. Requires
      product-owner sign-off.
  - Decision: on 2026-09-23 the product owner answered "You can use shadcn/UI,
    no framework free approach is needed if it will simplify our life
    dramatically."
    [ADR 0006](../architecture/decisions/0006-ui-stack-shadcn-react-islands.md)
    therefore adopts shadcn/ui in React islands, migrating incrementally one
    surface per candidate: source-owned components under
    `apps/web/src/components/ui/`, React only inside hydrated Astro islands
    under `apps/web/src/islands/` with the static-first shell, gateway-rewrite
    routing, and page-catalog rendering modes unchanged, Tailwind v4 carrying
    the UXD-001 tokens as the shadcn theme variables, one primitive family,
    react-hook-form with the Zod resolver over `packages/contracts/schemas`, the
    generated client as the only backend path, and an island readiness marker
    that E2E waits on. It supersedes review §10.6, the Phase 12 vanilla
    constraint, and the UXD-010 component-clause amendment, and re-scopes
    GAP-026 through GAP-033 below.
  - Verify: ADR 0006 merged; `AGENTS.md`, `technology-baseline.md`,
    `dashboard-settings-design.md`, `repository-layout.md`, and
    `quality-gates.md` agree with it; every earlier vanilla-direction statement
    is annotated as superseded rather than deleted.
  - Delivered 2026-09-23:
    `docs/architecture/decisions/0006-ui-stack-shadcn-react-islands.md`
    (accepted) records the owner's answer, the measured frontend (16,964 lines
    of imperative DOM code under 32,761 lines of DOM tests), the decision,
    answers to each review §10.6 objection, consequences, rejected alternatives,
    and a dated compatibility note; `technology-baseline.md`,
    `repository-layout.md`, and `quality-gates.md` (hydration budget and island
    readiness marker) agree with it; the `dashboard-settings-design.md`
    component clause names shadcn/ui-built Kinship primitives with every
    accessibility clause unchanged; review §10.6, the Phase 12 constraint, and
    the repair plan's conflict bullet are annotated as superseded or resolved;
    GAP-026 through GAP-033 and the Part 4 dependency summary are re-scoped as
    the incremental islands migration; `AGENTS.md` needed no change;
    documentation only (9 files changed +182/-111 plus the 136-line ADR); gates
    fmt:check, check:architecture (14), and root test:unit green.

- [x] **GAP-026 — React islands scaffold and island core.** M. Depends: 025.
  - Scope: choose and lock exact compatible versions (respecting pnpm
    `minimumReleaseAge`) of `@astrojs/react`, `react`, `react-dom`, their types,
    `tailwindcss` with `@tailwindcss/vite`, the shadcn CLI and the primitive
    family `shadcn init` selects, `class-variance-authority`, `clsx`,
    `tailwind-merge`, `lucide-react`, `react-hook-form`, `@hookform/resolvers`,
    `@testing-library/react`, `@testing-library/user-event`, and
    `eslint-plugin-react-hooks`. Register the React integration and Tailwind in
    `astro.config.mjs`. Add `apps/web/components.json`. Map the UXD-001 tokens
    onto the shadcn theme variables (light and dark) in one tokens file, so
    existing CSS and Tailwind share one source. Vendor only the primitives the
    pilot uses under `apps/web/src/components/ui/`. Build
    `apps/web/src/islands/core/`:
    - `useApi` (a typed call over the generated client answering
      `{ status, data?, problem? }`, replacing `.catch(() => undefined)`);
    - `useContractForm(schema)` (react-hook-form with the Zod resolver over
      `packages/contracts/schemas`, mapping a problem's field errors onto
      fields);
    - an island root that sets `data-island-ready` after hydration;
    - a bridge to the existing `#app-toasts` region.

    Also add the Playwright helper `waitForIsland(page, name)`, and vitest
    support for `.tsx` with Testing Library. Pilot: migrate the person gifts and
    debts section (`lib/person-gifts.ts` and its LoadMore wiring) to an island,
    keeping the labels, roles, and `data-*` hooks the E2E relies on, and delete
    the vanilla module and its tests in the same candidate.
  - Verify:
    - `GIFTS-001` E2E on Chromium, Firefox, and WebKit.
    - Web unit coverage at or above its floor, with `islands/core` at 95% or
      more.
    - axe on the person page.
    - Gateway and static-shell contract tests green.
    - A test proves public no-JavaScript pages ship no React.
    - The pilot's hydrated bytes are recorded in the evidence line.
    - `lint` includes the React-hooks rules.
    - `build` and the web and gateway image builds are green.
  - Delivered 2026-09-25: exact versions within `minimumReleaseAge`
    (`@astrojs/react` 6.0.6, React 19.3.0, Tailwind 4.3.3, shadcn 4.21.0,
    `@base-ui/react` 1.8.0, react-hook-form 7.88.0, `@hookform/resolvers` 5.9.1,
    Testing Library, `eslint-plugin-react-hooks` 7.1.1, and `zod` 4.4.3 matching
    `deno.json`), with Astro bumped to 7.3.3 and `@astrojs/node` to 11.1.6
    because the React integration needs them; `shadcn init` selected Base UI
    (`base-nova`), recorded in `technology-baseline.md`; the shadcn theme
    variables are declared over the UXD-001 tokens and Tailwind imports only its
    theme and utilities layers, so static pages are byte-identical;
    `islands/core` (`settle`, `useLatestRequest`, `useApi`, `useContractForm`
    with `applyProblem`, `useDocumentEvent`, `toast`, `LoadMore`, `IslandRoot`,
    and `mountIsland`, the second mounting mode ADR 0006 now records) measures
    100% on every axis; the gifts and debts section is one island
    (98.6/95.6/100/100) and `lib/person-gifts.ts` with its suite is deleted;
    `module-boundaries.yaml` `frontendMayImport` gains `contracts-schemas`, with
    the checker rule and tests (baseline 14); `tools/web_build_output_test.ts`,
    run by `build`, proves the public pages reach no React and records 118,358 B
    gzip hydrated for the gifts island (49,829 B entry plus 68,529 B React
    runtime), loaded with the Things zone; 55 files changed (+7196/-1556, 3295
    of them lockfile); web tests 779, web coverage 93.62/85.20/90.13/95.42
    against 93.40/84.84/89.16/95.24 on main, every Deno set unchanged or higher;
    `GIFTS-001` passed 3/3 on Chromium, 2/2 on Firefox, and 3/3 on WebKit; the
    full Chromium project passed 52 with the four parked failures and the
    REL-039 `app-004a` delete-dialog intermittent; build and the api, web, and
    gateway image builds green; gates fmt:check, lint, check,
    check:architecture, contracts:check.

- [x] **GAP-027 — shadcn component set and shell islands.** M. Depends: 026.
  - Scope: build the Kinship primitives from shadcn/ui: button, card, badge,
    breadcrumb, segmented filter, dialog, alert dialog, sheet, dropdown menu,
    command palette, select/combobox, table, skeleton, tooltip. Static Astro
    markup uses the same variant definitions (`buttonVariants`, `badgeVariants`,
    card classes) so static and island markup share one definition. Move the two
    `ApplicationLayout.astro` dialogs and the global people search / command
    palette to islands. Delete the duplicated `.button-*`, `.card`,
    `.state-badge`, `.form-actions` and dialog CSS they replace. Quick capture's
    dialog moves with interactions in GAP-031 so the surface keeps one owner.
  - Verify: axe and keyboard E2E for the palette, the dialogs, and the settings
    pages; stylesheet contract tests updated; visual check at 390, 768, and
    1440.
  - Delivered 2026-09-26: `apps/web/src/components/ui/variants.ts` is the one
    source of button, segmented-filter, badge, card, field, form-action,
    breadcrumb, and skeleton classes, consumed by the vendored React components,
    84 Astro call sites, and 19 vanilla modules, over the UXD-001 tokens;
    vendored on Base UI: button, badge, dialog, and command (`cmdk` 1.1.1, whose
    unused Radix Dialog is aliased to a stub and guarded out of every chunk by
    `tools/web_build_output_test.ts`, recorded as the one primitive-family
    exception in `technology-baseline.md`); card, breadcrumb, skeleton, and the
    segmented filter use variant classes in static markup, and alert dialog,
    sheet, dropdown menu, select, tooltip, and table are deferred until a
    surface uses them; the global people search and command palette is an island
    (110,755 B gzip hydrated on protected pages) with its 20 vanilla tests
    rewritten as 30 role-based island tests and `lib/global-people-search.ts`
    deleted; about 500 lines of duplicated `.button-*`, `.state-badge`,
    `.form-actions`, card, search-dialog, skeleton, and breadcrumb CSS are
    deleted, with element defaults moved to a `legacy-defaults` layer beneath
    the utilities; `legacy-look.ts` is gone; Quick capture's dialog moves with
    interactions in GAP-031; 100 files changed (+3673/-2703); web tests 821, web
    coverage 93.69/85.57/90.54/95.55, every Deno set unchanged; visual check at
    390, 768, and 1440 shows only a 2 px shorter form-action button; Chromium
    E2E 57 passed, WebKit and Firefox 15 each on the palette, shell, settings,
    and profile specs; build and web and gateway images green; gates fmt:check,
    lint, check, check:architecture (14), contracts:check.

- [x] **GAP-028 — Person profile section registry.** L. Depends: 026, 027.
  - Scope: a data-driven section registry (`id`, zone, component, visibility
    key) shared by the person template, the section navigation,
    `gateway_contract_test.ts`, and later the visibility preference (GAP-047).
    The 852-line `person-profile-shell.astro` becomes a registry render under
    200 lines. A registry entry mounts either an island taking
    `SectionProps = { personId, workspaceId, archived, preferences?, initial? }`
    or, until that section migrates, its existing vanilla module, so every
    section has one owner throughout. Migrate the identity/hero, the rail, and
    the life-events and timeline sections to islands in this ticket. `?section=`
    deep links keep resolving.
  - Verify: `PEOPLE-003` through `PEOPLE-006` E2E, the gateway contract test
    reads the registry, and the people-profile unit tests green.
  - Delivered 2026-09-26: `apps/web/src/features/person/sections.ts` is the
    section registry (the 22 catalog sections in order with `id`, title, zone,
    icon, `visibilityKey`, and mount kind; pure data a Deno tool can import),
    with the loaders and the `SectionProps`/`SectionMount` contract in
    `section-mounts.ts` so the registry stays free of React; the shell,
    `components/person/PersonSection.astro` and 14 partials,
    `lib/people-profile.ts` (zone activation and `?section=` deep links, 1,566
    to 853 lines), and `tools/gateway_contract_test.ts` all read it;
    `person-profile-shell.astro` is 149 lines (from 818); the hero (identity,
    vitals, due state, tag preview, person menu, contract-validated edit form,
    Base UI delete dialog, one pure lifecycle reducer), the rail, the timeline,
    and life events are islands (hero 8,943 B entry over the shared 81,533 B
    React runtime), and `lib/person-timeline.ts`, `lib/person-life-events.ts`,
    and `lib/person-facts-rail.ts` with their suites are deleted and ported by
    role; the vanilla sections publish counts, vitals, and tag names to the hero
    and rail through `features/person/profile-summary.ts`; one spec waits for
    the timeline island; screenshots at 390, 768, and 1440 are pixel-identical;
    69 files changed (+7098/-3460); web tests 863, web coverage
    94.02/86.47/91.65/95.82, every Deno set unchanged; build and images green;
    Chromium E2E 57 passed, WebKit and Firefox 13 each on the profile,
    lifecycle, dates, facts, and timeline specs; gates fmt:check, lint, check,
    check:architecture (14), contracts:check.

- [x] **GAP-029 — Profile facts as contract-driven forms.** L. Depends: 028.
  - Scope: replace `lib/profile-facts.ts` (1,808 lines) and its 3,370-line suite
    with seven fact islands (contact methods, addresses, work, pets, food, first
    meeting, tags) over one shared `FactEditor` built on `useContractForm` and
    the contract schemas, under `apps/web/src/features/person/facts/`. Keep the
    APR-001 and APR-003 draft-preservation and retry behavior. Establish the
    `features/<area>/` folder convention the remaining migrations follow.
  - Verify: `PEOPLE-006` E2E (including the APR-001 and APR-003 flows), fact
    island tests, and coverage unchanged or higher.
  - Delivered 2026-09-26: `apps/web/src/features/person/facts/` holds one
    `FactEditor` (list, add, edit, remove, a lifetime form element that keeps
    the rail editors, unsaved-changes guard, and mobile sheet working,
    `useContractForm` over the contract create and update schemas with
    per-section wording through a new `issueMessage` option, server problems
    onto fields, and every read through one latest-request slot) and seven
    section islands (contact methods, addresses, work, pets, food preferences,
    first meeting, tags; 503-1,391 B entries over the shared React runtime),
    registered as island entries in the section registry with a new
    `TAGS_MOUNT`; `lib/profile-facts.ts` (1,801 lines) and its 3,379-line suite
    are deleted and every case is ported by role; the `features/<area>/`
    convention is recorded in `repository-layout.md`; review fixed two timing
    defects with deterministic tests: the hero and rail now read a summary store
    created before mount through `useSyncExternalStore`, so a publication
    outside React renders by the next microtask, the page title changes in the
    heading's commit, and a phone save closes its sheet before the status line
    takes focus; screenshots at 390, 768, and 1440 are pixel-identical; 43 files
    changed (+6787/-5254) plus the review round; web tests 889, web coverage
    94.40/86.80/93.12/96.14, every Deno set unchanged except the REL-038 file;
    build green, Chromium E2E 57 passed, WebKit `app-004c` 24 of 24 over three
    repeats, Firefox `app-004c` 8; gates fmt:check, lint, check,
    check:architecture (14), contracts:check.

- [x] **GAP-030 — Island test support.** M. Depends: 026.
  - Scope: `apps/web/src/testing/`: `render.tsx` (Testing Library with the
    island providers), `stubApi(routes)` and `jsonResponse`, fixtures (person,
    workspace, preferences), and an axe helper. Migrate the vanilla tests' local
    `markup()`/`response()` builders that still have live callers.
  - Verify: all web tests green; migrated suites shorter.
  - Delivered 2026-09-26: `apps/web/src/testing/` holds the web suites' shared
    support: `stubApi` (routes keyed `"METHOD /path/:param"` with optional
    query, `*` method, and trailing `/*`; answers as responses, promises,
    handlers, or one-call-at-a-time lists; every call recorded; an unmatched
    request fails the test; `fetch` restored automatically), `jsonResponse`,
    `problemResponse` over the contract's `ProblemDetails`, `deferred`, and
    `unreachable`; `render.tsx` (`drawShell`, `mountSection`, `mountSettled`,
    `mountPending`, `adoptMount`, `renderIsland` waiting for
    `data-island-ready`, and `chooseOptions` holding the happy-dom multi-select
    workaround); contract-typed fixtures for ids, person, profile, summary,
    preferences, workspace session, and section props; and an axe helper
    (`expectNoAxeViolations`, without the layout and page-level rules happy-dom
    cannot evaluate); the folder and every `*.test-helper.ts` are excluded from
    production coverage and the manifest; 29 island, feature, and vanilla suites
    plus the facts test helper moved onto it with every test name kept (14,191
    to 12,614 lines); the vanilla suites GAP-031 and GAP-033 delete were left as
    they are; 35 files changed (+2336/-3881); web tests 906 after replaying onto
    REL-046, web coverage 94.43/86.83/92.98/96.17 with every production file's
    row unchanged except `workspace-context.ts` rising to 87.87% branch (the
    totals moved only because the two test-helper files left the measurement),
    every Deno set unchanged except the REL-038 file; gates fmt:check, lint,
    check, check:architecture (14), contracts:check, root test:unit.

- [x] **GAP-031 — Stateful person surfaces as islands.** L. Depends: 028, 030.
  - Scope: migrate interactions and the Quick capture dialog, communications,
    tasks, reminders, relationships, and important dates to islands. Surfaces
    with non-trivial state use `useReducer` with reducers unit-tested without
    the DOM, one owner per surface per `AGENTS.md`. Delete each vanilla module
    and its tests as its island lands.
  - Verify: reducer tests; the interactions, tasks, reminders, relationships,
    and important-dates E2E flows green.
  - Delivered 2026-09-26: implemented as two halves combined into one candidate.
    Interactions: `features/interactions/` holds Quick capture, one Base UI
    dialog island driven by a pure `captureReducer` (with `captureControls` and
    `captureSubmission`, which replays an uncertain save under the same key),
    mounted from the layout's palette script; every `data-quick-capture` opener,
    including the activity report's, ships disabled with
    `data-interaction-capture-ready="false"`, and one observer is the only
    writer of `disabled`. `features/person/interactions/` renders notes and
    activities as one island, and `features/person/communications/` renders
    calls and conversations over a pure `communicationsReducer`. Planning and
    rail surfaces: `features/tasks/` is one task surface serving the person card
    and `/app/tasks` (`taskReducer`), `features/person/reminders/` draws the
    reminders card and the rail's stay-in-touch block (`remindersReducer`), and
    `features/person/relationships/` and `features/person/important-dates/` have
    their own reducers. Each surface reads through one latest-request slot,
    keeps the unsaved-changes guard and rail editors, publishes the same
    `profile-summary.ts` keys, and keeps its ids, `data-*` hooks, labels,
    events, deep links, archived and hidden states. `lib/communications.ts`,
    `lib/relationships.ts`, `lib/important-dates.ts`, `lib/rail-labels.ts`, and
    `lib/profile-rail-expander.ts` and their suites are deleted.
    `lib/interactions.ts` (1,264 to 266 lines), `lib/tasks.ts` (1,131 to 622),
    and `lib/reminders.ts` (641 to 229) keep only the Today and activity-report
    code GAP-033 moves. Every deleted test is ported by role under its old name
    or a named successor. Review fixed six defects, each with a failing test
    first: an activity-report opener enabled before it was wired, task refreshes
    reading stale filters, Load more taking a write's refresh (now hidden while
    a write is busy), a second task save dropped during a refresh, a weakened
    first-run focus assertion, and a lost `people-profile.ts` branch. The tasks
    page is the one page script besides the palette's allowed to reach React,
    recorded in `tools/web_build_output_test.ts`. The new islands' gzip entries
    are 1,854-6,283 B over the shared 81,552 B React runtime. 63 files changed
    (+17,864/-12,779); no spec changed. Web tests 1,042, web coverage
    95.70/90.13/95.91/97.42, every production file's row unchanged or higher
    except the trimmed `lib/reminders.ts` (95.72/92.2/100/96.42), and every Deno
    set unchanged. Chromium E2E 57 passed, WebKit 17 and Firefox 7 on the
    interactions, communications, Today, dates, relationships, tasks, reminders,
    search, lifecycle, and facts specs. Gates build (12 web-build tests),
    fmt:check, lint, check, check:architecture (14), contracts:check, and root
    test:unit and test:coverage all passed. The gateway log-capture fixture
    passed in a copy that trusts this environment's proxy.

- [x] **GAP-032 — Stylesheet retirement.** M. Depends: 027, 028.
  - Scope: delete the CSS that migrated surfaces no longer use. Split what
    remains of `person.css` by zone. Document stylesheet ownership (the tokens
    file, the Tailwind layer, the remaining component CSS) in
    `docs/product/dashboard-settings-design.md`.
  - Verify: stylesheet contract tests; visual check at 390, 768, and 1440.
  - Delivered 2026-09-27: `person.css` (2,857 lines) is split into one
    stylesheet per workspace zone plus shared chrome (`person-chrome`, `-hero`,
    `-rail`, `-timeline`, `-planning`, `-things`, `-admin`). Its non-person
    rules moved to `people.css` (directory and add-a-person), `pages.css`
    (Today, tasks, journal, compliance), and `overrides.css`, which stays last.
    The settings phone rules joined `settings.css`.
    - Dead CSS: nine dead selectors are deleted (`.future-nav`,
      `.created-person`, `.profile-next-step`, and one independent-load note);
      the islands kept the class names, so little else was dead. A declaration
      comparison of the old and new sheets shows only those removals and two
      selector lists split per owner, with no reordered pair able to change the
      cascade.
    - New guard: `lib/stylesheet-liveness.test.ts` fails on any selector no
      source can produce and on any production directory Tailwind does not scan.
    - Tailwind scan fix: `islands.css` now scans `features/`. It had been missed
      since the islands moved there, so the audit badge's `justify-self-start`
      and the file badge's `mt-(--space-1)` came back; test helpers stay
      excluded.
    - Tests and docs: `application-controls.test.ts` checks every imported
      stylesheet instead of five, and `dashboard-settings-design.md` records
      stylesheet ownership and where new styles go.
    - Visual check: 78 screenshots at 390, 768, and 1440 px in light and dark,
      from plain copies, compared with every element's computed style. The 30
      captures that changed differ only by those two restored utilities; the
      rest are pixel-identical.
    - Evidence: 20 files changed (+3,374/-2,890). Web tests 1,299, web coverage
      98.66/95.40/99.43/99.87. Chromium and WebKit passed 56 on `app-003c`,
      `app-004c`, `app-002c`, `app-002e`, `app-005c`, `prf-002`, `public-home`,
      and `auth-001`.
    - Gates: build (14 web-build tests), fmt:check, lint, check,
      check:architecture (14).

- [x] **GAP-033 — Migrate the remaining surfaces and retire the vanilla DOM
      layer.** L. Depends: 029, 031.
  - Scope: move settings, personalization, the people directory and create flow,
    Today, journal, the tasks page, authentication forms, imports and exports,
    members, integrations, and audit history to islands or static Astro
    components. `apps/web/src/lib` keeps only non-UI helpers (time presentation,
    workspace context, routing).
  - Verify: `grep` finds no `document.createElement` in `apps/web/src` outside
    `components/ui/` and tests; full three-browser E2E at the Phase 4
    checkpoint.
  - Delivered 2026-09-27: implemented in four parts combined into one candidate,
    each part reviewed on its own.
    - Today, journal, and the activity report are islands under
      `features/today/`, `features/journal/`, and
      `features/interactions/activity-report/`. The Today attention queue is one
      island with one read slot and a pure reducer. Every read sequence settles
      every region it marked loading, and REL-048's reducer and island tests
      prove it.
    - The people directory, add-a-person, person files, the audit summary, and
      the audit history pages are islands under `features/people/`,
      `features/person/`, and `features/audit/`. The person workspace
      orchestration moved to `features/person/workspace.ts` with its REL-045 and
      REL-046 placement, focus, and settle behaviour unchanged. The shell's
      state region and the phone sheet are cloned from `<template>`s, and
      `section-mounts.ts` has no vanilla owner left.
    - Settings, personalization, members, integrations, API access, storage,
      imports, exports, the workspace and personal lifecycles, and the legal
      review are islands under `features/settings/` and `features/compliance/`.
      They keep the `?section=` history, the one-active-draft rule, the danger
      zone's owner-only rules, and early-submit replay.
    - The application shell and toasts (`features/shell/`) and the
      authentication, registration, invitation, and verify-email pages
      (`features/auth/`) render static Astro markup with `<template>`s. Their
      scripts only query, toggle attributes, set text, and clone templates, so
      every public page stays React-free, which a new build test enforces for
      prerendered and on-demand pages alike.
    - Scope and coverage: 24 vanilla `lib/` modules and their suites are deleted
      or trimmed to non-UI helpers, and every case is ported by role. `grep`
      finds no `document.createElement` in `apps/web/src` outside
      `components/ui/` and tests. The form-method contract now also scans island
      forms, with Quick capture the only `dialog` form and every other island
      form POST or the allowlisted audit GET. `repository-layout.md` describes
      the result.
    - Review fixed nine defects, each with a failing test first: a journal save
      racing a removal, a completion state kept across principals, the activity
      report heading stuck on loading, a files Upload left enabled while busy,
      lost pre-mount tag search text, an import Validate enabled during its file
      read, both destructive lifecycle actions runnable at once, a
      personalization draft snapshot that ignored selects and checkboxes, and a
      file chosen before the import island mounted being dropped. The only proof
      that a failed preferences save sends no layout event moved into the
      settings suite.
    - Evidence: 227 files changed (+30,166/-18,995); no spec changed. The 51
      measured island entries are 514-14,959 B gzip over the shared 81,552 B
      React runtime. Web tests 1,290, web coverage 98.64/95.38/99.43/99.86
      against 95.70/90.13/95.91/97.42 before, with every surviving file's row
      unchanged or higher except the shrunk `lib/app-shell.ts`; every Deno set
      unchanged.
    - Gates: Chromium E2E 57 passed, WebKit 56 and Firefox 56 passed with
      `perf-001`'s own skip; the api, web, and gateway images built and the
      gateway log-capture fixture passed in a copy that trusts this
      environment's proxy; build (14 web-build tests), fmt:check, lint, check,
      check:architecture (14), contracts:check, and root test:coverage all
      passed.

### Phase 5 — Test organization

- [x] **GAP-034 — Backend test placement convention.** S-M. Depends: 014.
  - Scope: rule in `docs/architecture/quality-gates.md`: unit tests sit next to
    the file they exercise (`application/x.ts` → `application/x_test.ts`,
    `domain/x.ts` → `domain/x_test.ts`); module-root tests are moved; split
    `identity_test.ts` per behavior. Manifest globs updated.
  - Verify: `deno task test:unit` green; no `_test.ts` at a module root.
  - Delivered 2026-09-27: `quality-gates.md` states the rule, and
    `misplacedBackendTests()` in `tools/tasks/manifest.ts`, with two
    `manifest_test.ts` tests, fails any `_test.ts` placed directly at a backend
    module or read-model root.
    - The 38 root suites in the modules and read models moved beside the file
      each exercises, mostly into `application/` (as `get_*`/`list_*` names in
      the read models), and six were split per behaviour:
      - `identity_test.ts` into the Argon2id and TOTP adapter suites;
      - the object-storage suite into the S3-compatible store, media scanner,
        and file-identifier suites;
      - the DAV adapter suite into the HTTP client and secret-box suites;
      - reminder management into management, delivery, and the in-app channel;
      - settings management, whose UI-state cases joined
        `member_ui_state_test.ts`;
      - the person profile into the profile and timeline suites.
    - `api-access/authentication_subject.ts` moved into `application/` with its
      suite so no root keeps a test. Every test name and body is unchanged (752
      names before, 754 after with the two new checks), and 92 manifest entries
      now point at the new paths.
    - Evidence: 54 files changed (+1,204/-1,117), no production code changed
      beyond that move's import paths. Every unit set has its baseline count
      (tools 66 to 68). Every coverage set measures the same 555 files at the
      same percentages; the two integration-only adapter rows that dipped on one
      run returned on a rerun, the REL-038 class. Web tests 1,290.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check,
      root test:unit (the gateway log-capture fixture passed in a copy that
      trusts this environment's proxy).

- [x] **GAP-035 — Integration test support and file splits.** M-L. Depends: 014.
  - Scope: `tests/support/` with `database.ts` (disposable schema reset per
    file, truncate helper), `api.ts` (register, verify, sign in, workspace
    header), `fixtures.ts` (create person, tags, dates through the API). Migrate
    the 16 local helper sets. Split `people_postgres_test.ts` (5,706) into
    directory, profile, facts, dates, lifecycle files and
    `planning_postgres_test.ts` (4,103) into tasks, reminders, cadences.
  - Verify: `test:integration` green; largest integration file under 1,500
    lines.
  - Delivered 2026-09-27: `tests/support/` holds the integration suites' shared
    support:
    - `database.ts`: the pool opener, database URL, `truncate`, `resetDatabase`,
      and the revocable-actor and membership helpers;
    - `api.ts`: register, verify, sign in, and workspace-scoped requests over
      the in-process app;
    - `fixtures.ts`: people and important dates through the API.
    - Migration: the 16 local register/verify/sign-in sets, nine identical
      revocable-actor copies, the request helpers, and every inline truncate and
      pool setup moved onto it. No suite creates tags through the API, so no tag
      fixture was added.
    - Splits: people into directory, profile, lifecycle, dates, facts, and
      relationships; planning into tasks, Today, reminders, cadences, and
      delivery; settings into preferences and personalization; authentication
      into budget and sign-in; interactions into activities and communications.
      Every integration file is now under 1,500 lines (largest 1,437, from
      5,964). Each split file opens its own resources through its family's
      helper and closes them in its own final test, because Deno loads every
      test file in its own isolate.
    - Test parity: every test name and body is unchanged apart from helper
      calls. A block-by-block comparison of all 130 old tests confirms it, and
      the 12 new per-file close tests are the only additions.
    - Evidence: 42 files changed (+13,816/-14,251); integration 142 passed and 0
      failed (130 before); every unit set unchanged; every coverage set that
      measures integration suites has the same totals.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check.

- [x] **GAP-036 — E2E support, feature-named specs, flow-ID consistency check.**
      M-L. Depends: 003.
  - Scope: `tests/e2e/support/` (API fixtures, mail capture, sign-in, page
    objects for shell, directory, profile, settings; `runAxe`). Rename specs to
    `<feature>.<flow-id>.spec.ts` (for example
    `reminders.PLANNING-002.spec.ts`), keep annotations, add the 4 missing
    `flow` annotations, update `user-flows.yaml` `testRefs`. Add
    `tools/product/flow_traceability_test.ts` proving every required flow's
    `testRefs` exist and carry the matching annotation and vice versa.
  - Verify: Chromium E2E green; traceability test green.
  - Delivered 2026-09-27: the 33 flow specs are renamed
    `<feature>.<FLOW-ID>.spec.ts` after their primary flow (for example
    `reminders.PLANNING-002`, `sign-in.AUTH-003`, `perf.PERF-001`,
    `focus.PRF-002`); `public-home` proves no catalogue flow and keeps its name.
    - Support: `tests/e2e/support/` now holds `env`, `database` (one psql retry
      helper instead of 16), `mail` (one Mailpit poll with a reader per token
      rule), `api` (register, verify, create person), `sign-in` (with and
      without the REL-042 settle), `page-checks` (the axe loader and CSP-report
      guard), and `shell`, `profile`, and `directory` page objects. Each keeps
      the exact waits, token rules, and query flags of the copies it replaced,
      and every test title is unchanged. The specs shrank from 12,428 to 9,738
      lines.
    - Annotations: of the four specs without a `flow` annotation, `perf-001` and
      `public-home` prove no catalogue flow; the app-shell spec now carries
      TODAY-001 and AUTH-003 on the test that walks them, and the person-shell
      spec carries PEOPLE-003, with `user-flows.yaml` `testRefs` updated.
    - Traceability: `tools/product/flow_traceability_test.ts` fails when a
      required flow's reference is missing or unannotated, when a delivered flow
      has no reference, or when a spec's annotation names a flow whose
      references omit it. Its synthetic case covers every rule.
    - Gateway guard: the gateway contract's sole-origin guard now reads every
      support module.
    - Evidence: 55 files changed (+1,665/-3,412). Chromium E2E 57 passed, WebKit
      56 with `perf-001`'s own skip.
    - Gates: root test:unit (the gateway log-capture fixture passed in a copy
      that trusts this environment's proxy), fmt:check, lint, check,
      check:architecture (14), contracts:check.

- [x] **GAP-037 — Coverage gaps: read models, worker, storage faults,
      migrations.** M. Depends: 035.
  - Scope: Postgres integration tests for activity-report, audit-history,
    journal-timeline, and the five today repositories (tenancy negatives
    included); a test for `apps/worker/main.ts` startup/shutdown; object-store
    fault injection (timeout, missing object, quarantined object) against the
    pinned RustFS in `files_postgres_test`; migration runner tests for `drift`
    and `v6 → v7` upgrade paths.
  - Verify: coverage includes `apps/worker/main.ts`; new suites green.
  - Delivered 2026-09-27: new PostgreSQL suites cover the activity-report,
    audit-history, and journal-timeline read models and the five Today
    repositories. Each has cross-workspace negatives that assert the foreign
    data is absent, plus revoked, member, and falsely claimed role negatives.
    - Two production defects the new tests exposed are fixed, each with a
      failing test first:
      - Tenant leak: Today reminders joined a reminder's person without a
        workspace guard, so a reminder linked across workspaces named the other
        workspace's person. The join is now guarded and drops the row, as
        attention does. A sweep of every join in those read models found no
        other gap.
      - Stalled read: the object-store request timeout did not end a read that
        stalled on a kept-alive socket, because Deno's `node:http` stays silent
        after `destroy()`. The transport now tears down the socket and settles
        the operation itself, still answering 503 `files_unavailable`.
    - Object storage: `files_object_store_postgres_test.ts` runs the timeout
      (`docker pause`), missing-object (410), and quarantined-object (423) cases
      against a disposable pinned RustFS that is removed even when setup fails.
    - Worker: `apps/worker/main.ts` exports `runWorker` with the same start,
      signal, and shutdown behaviour and gains a unit suite (8 tests, 97.5%
      lines).
    - Migrations: the runner's drift, foreign-schema, changed-artifact, and
      v6-to-v7 upgrade paths run on scratch databases.
    - Coverage: every Deno set is equal or higher. The branch rows rose for
      activity-report (84.0 to 96.2), audit-history (86.7 to 97.3),
      journal-timeline (90.6 to 100), and Today tasks (75.0 to 90.0), and
      `tools/migrations/main.ts` and `apps/worker/main.ts` are measured for the
      first time.
    - Evidence: integration 167 passed and 0 failed (142 before), root test:unit
      and test:coverage passed.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check.

- [ ] **GAP-038 — Visual regression baseline.** S-M. Depends: 036. Optional.
  - Scope: Playwright `toHaveScreenshot` for Today, directory, profile, settings
    index at 390/768/1440 in light and dark; run in the nightly job only.

### Phase 6 — Infrastructure and operations

- [x] **GAP-039 — Telemetry port and correlation.** M. Depends: 019.
  - Scope: `packages/backend/platform/telemetry/` (`Logger`, `Metrics`, `Tracer`
    ports; JSON stdout adapter; redaction of the forbidden fields in
    `private-production-profile.json`); request ID accepted from the gateway or
    generated; propagated into use cases via the actor context and into audit
    payloads; worker job runs logged with attempt/outcome. Update
    `observability.md` to describe what exists.
  - Verify: log-shape unit tests; `gateway_log_capture_test` extended to prove
    the ID crosses the gateway.
  - Delivered 2026-09-26: the `Logger` port, the `Correlation` value, and the
    closed `LogEvent` catalogue (`api.request`, `worker.job`) live in
    `packages/backend/shared-kernel/telemetry.ts`, with the JSON stdout adapter
    and its redaction in `packages/backend/platform/telemetry/json_logger.ts`
    (unknown events refused, undeclared fields and out-of-class values stripped,
    so identifiers, credentials, query strings, and free-form errors never
    print; failures carry codes); the HTTP kit logs through the port with
    `api.request` byte-identical; the gateway generates `$request_id`, replaces
    any client value when forwarding `X-Request-Id` to the API, and logs it; the
    ID rides every session, workspace-scoped, read, and token actor into the
    audit describers and reaches `audit_events.payload.requestId` (no schema
    change), which the audit-history read model hides; the reminder worker gives
    each claimed occurrence its own ID shared by its `worker.job` line and its
    delivery audit; download routes now echo `X-Request-Id` too; metrics and
    tracing ports are deliberately not added and `observability.md` records what
    would trigger them; 47 files changed plus 6 new; unit green, integration
    130/0, every coverage set unchanged or higher except the REL-038 file,
    `contracts:check` 123 and 126, build and images green, Chromium E2E 57
    passed; gates fmt:check, lint, check, check:architecture (14).

- [x] **GAP-040 — Gateway hardening.** M. Depends: 039.
  - Scope: `limit_req_zone`/`limit_conn_zone` on `/api/v1/` and auth routes,
    `X-Request-Id` generation and forwarding, explicit `ssl_ciphers` and
    `ssl_prefer_server_ciphers`, HSTS `includeSubDomains` decision, CSP nonce
    for the inline theme script (drop `'unsafe-inline'` for scripts). Extend
    `gateway_contract_test.ts`.
  - Verify: contract test and log-capture test green; E2E green.
  - Delivered 2026-09-26: the gateway rate-limits `/api/v1/` per client address
    (`kinship_api` 50 r/s burst 200, `kinship_credentials` 5 r/s burst 100 on
    the thirteen credential routes selected by a `map`, `kinship_connections`
    64), answering 429 with `Retry-After`, no-store, the security headers, and
    the API's own problem body (`request_rate_limited`), with numbers tuned from
    captured E2E traffic; TLS 1.2 offers only ECDHE with AES-GCM or
    ChaCha20-Poly1305, server cipher preference off, session tickets off; HSTS
    keeps one year without `includeSubDomains` or `preload`, recorded in
    `compose-contract.md`; `script-src` is `'self'` plus the hash of the one
    inline theme script (hashes, not a nonce, because pages are static files;
    Vite no longer inlines bundled scripts), `style-src` stays because Base UI
    renders style elements; every proxied location forwards the gateway's
    `X-Request-Id`; `gateway_contract_test.ts` gains six tests rejecting each
    old weak form, `web_build_output_test.ts` proves every built inline script
    is hash-allowed with no handlers, the log-capture test proves 429 answers
    and the served CSP, and the E2E specs load axe through `page.evaluate` with
    a helper that fails a test on any CSP report; 42 files changed (+923/-45);
    unit and coverage unchanged, build 11 web-build tests, images green,
    Chromium E2E 57 passed, Firefox 15, WebKit 14 with one REL-045 reminder-form
    intermittent that passed three repeats; gates fmt:check, lint, check,
    check:architecture (14), contracts:check.

- [x] **GAP-041 — Compose and Docker consolidation.** S-M. Depends: none.
  - Scope: `compose.support.yaml` holding mailpit and object-store once,
    included by dev and test; one multi-stage Dockerfile with `web` and
    `gateway` targets sharing a single Astro build stage; reconcile Node 24.15.0
    across `.tool-versions` and images; ignore `.playwright-cli/`.
  - Verify: `deno task dev` and `deno task test:e2e` green; image builds.
  - Delivered 2026-09-26: `compose.support.yaml` defines mailpit and the RustFS
    object store once, and the `mailpit` and `object-store` services of
    `compose.dev.yaml` and `compose.test.yaml` each `extends:` it and add only
    their published ports and storage (the implementer's `include:` form
    rendered on Compose v5 but CI's Compose v2 refuses a service that overrides
    an included one, which the existing compose-render test caught on the first
    PR run; both forms render byte-identical configurations to `main` apart from
    the build targets on v2.38 and v5.1); `Dockerfile.web` has one `build` stage
    running the frozen install and the Astro build once, with `gateway` (nginx,
    static client output) and `web` (the private Node renderer, still the
    default target) targets, selected by `target:` in `compose.yaml` and by
    `--target` in the CI images job, and `Dockerfile.gateway` is deleted; both
    Node stages run `node:24.15.0-bookworm-slim` pinned by digest, matching
    `.tool-versions`, where they ran 24.7.0; `.playwright-cli/` is ignored;
    `configuration_contract_test.ts`, `gateway_contract_test.ts` (one shared
    build stage, per-service targets), `pipeline_contract_test.ts` (each target
    built, Node image equals `.tool-versions`), and
    `private_production_compose_test.ts` (dev and test render one support
    definition) are extended and `compose-contract.md` and `quality-gates.md`
    describe the result; 15 files changed (+224/-124); web tests 906, unit and
    coverage unchanged (no production code changed); the api, web, and gateway
    images build; Chromium E2E 57 passed locally and on PR CI with the
    integration, schema, unit, and static jobs green; gates fmt:check, lint,
    check, check:architecture (14), contracts:check.

- [x] **GAP-042 — Generated Kysely types and drift check.** M. Depends: 041.
  - Scope: `kysely-codegen` from a clean migrated database into
    `packages/backend/platform/postgres/generated/database.ts` with the required
    generator header; `schema:types` and `schema:types:check` tasks in CI; adopt
    the types in one module (gifts) to prove the shape; adopt across modules in
    Phase 2 tickets thereafter.
  - Verify: CI fails when DDL and generated types differ.
  - Delivered 2026-09-27:
    `packages/backend/platform/postgres/generated/database.ts` is generated by
    `kysely-codegen` 0.20.0 from a database migrated to the canonical v7 DDL. It
    uses `crm.<table>` keys and snake_case columns and is deterministic, with
    the DDL's comments and no timestamps.
    - Pinning: the generator is pinned in `deno.json` with `typescript` 5.9.3,
      which the package requires without declaring, and is called
      programmatically over the repository's own Kysely connection. No API or
      worker entry point reaches it.
    - Tasks: `deno.json` stays at 26 tasks. Generation is the `schema-types`
      runner verb, and `schema-types --check` runs inside `test:integration`
      right after migration, so CI's integration job fails when the DDL and the
      types differ.
    - Proof: in a scratch copy, renaming `gifts.comment` to `note` made the
      check exit 1 at `database.ts` line 1357, and after regenerating,
      `deno check` of the gifts repository failed on `gift.comment`.
    - Gifts adoption: both gifts adapters build every query with the typed query
      builder over `Kysely<Database>` through `schemaDatabaseFromSession`, with
      the same columns, workspace scoping, ordering, cursors, and locks. An
      `instantOf` helper renders the same text as `instantColumn`.
      `ApplicationDatabase` stays untyped for the other modules until their
      adoption.
    - Evidence: integration 167 passed and 0 failed with the drift check green;
      six generator tests and a timestamps test; gifts unit 30.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check.

- [x] **GAP-043 — Documentation sync and repository hygiene.** S-M. Depends:
      013, 025.
  - Scope: rewrite `repository-layout.md` to the real tree (kernel, per-module
    `composition.ts`, `testing/`, `tests/support`, `tools/tasks`); update
    `module-boundaries.yaml` (actor revalidation exception, gifts
    attachment-target port, note that `publishes`/`consumes` are synchronous
    direct calls until an outbox schema version exists); `quality-gates.md` to
    real tasks; `AGENTS.md` UI stack; add `CLAUDE.md` that points to
    `AGENTS.md`; `git rm` `docs/planning/tickets/**` after tagging an archive
    ref; refresh `traceability.md` counts.
  - Verify: `check:architecture` schema validation green; docs reviewed.
  - Delivered 2026-09-27: `repository-layout.md` is rewritten to the real tree.
    - Backend: the shared kernel, `platform/`, per-module and per-read-model
      `composition.ts`, `packages/backend/testing/`, and `packages/http-kit`.
    - Web: `features`, `islands/core`, `components/ui`, `lib`, and `testing`.
    - Tests and tools: `tests/support`, `tests/e2e/support`, `tools/tasks`, and
      the generated-artefact locations.
    - It also states what does not exist, including the never-defined import
      aliases.
    - `quality-gates.md`: lists the real tasks, runner verbs, CI jobs, and
      checker rules, and keeps unmet targets as targets, among them
      `astro check` warnings.
    - `module-boundaries.yaml` comments:
      - label the actor-revalidation exception;
      - record the gifts attachment-target port;
      - say that `publishes`/`consumes` are synchronous direct calls until an
        outbox schema version exists;
      - list the four kernel contracts not yet in `allowedContents`.
    - `AGENTS.md`: the UI-stack sentence matches ADR 0006 and the Base UI and
      `cmdk` decisions in `technology-baseline.md`, with every other line
      unchanged.
    - `CLAUDE.md` points to `AGENTS.md`.
    - `traceability.md` counts are refreshed from the catalogues: 15 modules and
      6 read models, 39 pages, 30 flows, and 34 specs.
    - `docs/planning/tickets/` (194 files) is removed. It is preserved on the
      branch `archive/planning-tickets-2026-09-27` at `ff2ec7a` (a tag push is
      refused by this environment's proxy), and the planning README points
      there.
    - Evidence: 203 paths changed.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check,
      and 83 documentation-contract tool tests.

### Phase 7 — Missing user-required functionality

Each ticket adds a flow ID to `docs/product/user-flows.yaml` and a page or
section state to `page-catalog.yaml` where a surface changes, plus a Playwright
spec per the E2E policy. Mutations go through owning-module facades; new tables
require a synchronized schema v8 and are called out explicitly.

- [x] **GAP-044 — Reminder email delivery and daily digest.** L. Depends: 016,
      019, 039. Flow `PLANNING-003`.
  - Scope: `planning` gains a `ReminderDeliveryChannel` port; `workspaces`
    provides a mail adapter reusing the SMTP transport; member preference
    `reminderDelivery: in-app | email | both` and `digestTime`; the worker
    delivers due occurrences and a daily digest per member time zone; emails
    link to the person; audit `planning.reminder-delivered` records channel.
    Requires verified email; no schema change if `reminder_occurrences` already
    stores attempt/outcome (verify against v7).
  - Verify: unit tests for channel selection and idempotent delivery;
    Mailpit-backed integration test; E2E `PLANNING-003`.
  - Delivered 2026-09-27: flow `PLANNING-003` on schema v8, approved by the
    product owner.
    - `personal-crm-schema/v8` is one synchronized unit: v7 plus
      `member_preferences.reminder_delivery` (`in_app`, `email`, or `both`,
      default `in_app`) and a nullable `digest_time`, with additive migration
      `0008`. v1 through v7 are byte-identical. The migration baseline,
      validator, recovery tool, generated database types, and every live pointer
      (including `AGENTS.md`) move to v8.
    - `planning` picks channels per member, falling back to in-app without a
      verified email address. It reads delivery preferences through a
      `ReminderDeliveryPreferences` port that `workspaces` fills. The worker
      sends single emails, or one digest per member at the member's
      `digest_time` in their time zone, through a `ReminderDeliveryChannel` over
      the `workspaces` SMTP transport. Emails link to the person.
    - Each attempt is recorded by a guarded compare-and-set on the claim token
      and lease before the send. Leases are renewed during a batch, so a lost
      claim is never sent. An unclear answer is reconciled with the key that was
      actually sent, and SMTP's always-unclear reconcile ends in
      `manual_attention`. Audit `planning.reminder-delivered` records the
      channel and a digest's occurrence count.
    - The personal preferences page adds "Reminder delivery" and "Daily email
      digest".
    - Evidence: Mailpit-backed integration suites covering immediate delivery,
      the digest, retry, unclear-answer reconcile, crash, a stale claim, `both`,
      the unverified fallback, and important-date channels, plus the
      `reminder-email.PLANNING-003` spec with PLANNING-002 and AUTH-004 on
      Chromium and WebKit.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check,
      `test:schema` on PostgreSQL 18.4, unit, integration, and build.
    - Not yet run: the PostgreSQL 17.10 half of `test:schema:matrix`, because
      the local Docker daemon could not pull the image. It stays owed at the
      Phase 7 schema checkpoint.
    - The replay onto GAP-045 re-ran the static gates, unit (except the
      image-building gateway log test), integration (194 passed), and build. The
      E2E specs ran on the candidate before the replay.

- [x] **GAP-045 — Avatar upload and display.** M-L. Depends: 017, 028. Flow
      `PEOPLE-007`.
  - Scope: `files` upload kind `avatar` with size/type limits and scanning hook;
    `people` links via `person_avatars`; API
    `PUT/DELETE
    /people/:id/avatar`; hero, directory rows, search rows,
    quick-capture render the avatar with an initials fallback; import maps
    Monica avatars.
  - Verify: unit, integration (missing-object case), E2E.
  - Delivered 2026-09-27: flow `PEOPLE-007`.
    - `files` gains the `avatar` upload kind: the photo allowlist with magic
      bytes, a 1 MiB limit, the declared media scan, and quarantine. The image
      is a `person_file_links` row of kind `avatar`, served by the existing file
      content route with the same authorization and headers. Person file
      listings leave it out.
    - `people` owns `person_avatars` through a `PersonAvatarImages` port that
      the API composition root fills from the `files` facade.
      `PUT /people/{personId}/avatar` replaces the avatar, storing the new image
      before discarding the old one. `DELETE` resets to initials. A quarantined
      upload answers 423. Archived people are read-only. The changes are audited
      as `people.avatar-updated` and `people.avatar-removed`.
    - The person-profile and people-directory read models return an avatar
      descriptor with an image only while the file is `available`, so a missing
      or quarantined object shows initials. `module-boundaries.yaml` adds
      `files` to people-directory's sources for that check.
    - One Base UI `Avatar` primitive renders in the hero (with a "Change avatar"
      editor), directory rows, palette rows, and Quick capture's chosen
      participants. Monica import now maps the avatar colour, source, and
      external URL columns. External URLs are stored and never drawn.
    - Evidence: the PEOPLE-007 integration suites (missing object,
      cross-workspace, quarantined, oversized, archived) and the
      `avatars.PEOPLE-007` spec with PEOPLE-002, PEOPLE-003, INTERACTION-001,
      IMPORT-001, and JOURNAL-002 on Chromium and WebKit.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check
      (128 documented, 131 mounted), unit, integration, and build.

- [x] **GAP-046 — Life-event create, edit, delete.** M. Depends: 017, 028. Flow
      `JOURNAL-002`.
  - Scope: resolve the deferred flow decision in `traceability.md` #1; `journal`
    use case with life-event type vocabulary from `workspaces`; API
    `POST/PATCH/DELETE /people/:id/life-events`; profile section editor using
    the form kit; audit.
  - Verify: unit, integration (cross-workspace negative), E2E.
  - Delivered 2026-09-27: flow `JOURNAL-002` resolves deferred decision #1 in
    `traceability.md`.
    - The `journal` module owns create, edit, and remove use cases for
      `life_events`. They read the type vocabulary through the `workspaces`
      facade, validate dates with the shared kernel's partial-date rules, keep
      archived people read-only, and record
      `journal.life-event-created/updated/deleted` audit events.
    - `POST /people/{personId}/life-events`, and `PATCH` and `DELETE` on
      `/people/{personId}/life-events/{lifeEventId}`, are in the contract
      registry and the generated client (126 documented, 129 mounted).
    - The person workspace's Life events section has an "Add life event" control
      and an editor on the island kit, driven by a pure reducer. List controls
      lock while a save or removal is in flight, and the timeline and summary
      refresh after each change.
    - Removing an event also deletes the reminders attached to it, through the
      v7 `ON DELETE CASCADE`. The remove confirmation says so, the flow lists it
      as an alternate outcome, and an integration test pins it.
    - Evidence: journal integration suites with cross-workspace, permission,
      archived, validation, cascade, and 100-type vocabulary cases; the
      `life-events.JOURNAL-002` spec with PEOPLE-003, PEOPLE-004, and PEOPLE-006
      on Chromium and WebKit.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check,
      unit, integration, and build.

- [x] **GAP-047 — Identity editing breadth and section visibility preferences.**
      M. Depends: 028. Flow extends `PEOPLE-005`.
  - Scope: edit description, gender, deceased/date, nickname, and other read
    view identity states per the API contract; `workspace_profile_modules`
    drives which sections render (registry visibility key) with a settings
    surface under personalization; dead section-nav links removed.
  - Verify: unit, integration, E2E.
  - Delivered 2026-09-27: this extends `PEOPLE-004`, which owns the hero
    identity editor, with alternate outcomes added to `PEOPLE-005`,
    `WORKSPACE-003`, and `PEOPLE-003`. No schema change.
    - The identity PATCH now also takes description, gender option, and
      deceased. Fields left out keep their values, so DAV sync never erases
      them. A new gender choice must be current and in the workspace. An
      unchanged archived choice is kept. The options come through a `workspaces`
      boundary port.
    - Marking a person deceased hands off to the important-dates editor for the
      date of death, which writes through the dates route only. Clearing
      deceased keeps the date.
    - `workspace_profile_modules` controls which of 13 switchable person
      sections render, from the existing
      `/app/settings/personalization?section=profile-modules` section. Defaults
      resolve without rows, and the first change writes the row. Core sections
      cannot be deleted. Reordering is stored for the settings list, and the
      person workspace keeps its rail order.
    - Hidden sections are neither drawn nor mounted, and the section nav comes
      from a pure `navigableSections`, so no link is dead. A deep link to a
      hidden section shows a quiet notice.
    - Evidence: integration cases for foreign or archived options, a stale
      revision, omitted fields, the deceased date, cross-workspace (404) and
      member (403) negatives, default rows, a clash with a default name, and
      more than 100 options. The `identity.PEOPLE-004` spec with the person,
      personalization, and life-event specs passed 36/36 on Chromium and WebKit
      before the review amendment.
    - Still owed: the amendment's browser changes (the omitted gender field and
      focus fallbacks) are unit-covered, and E2E must rerun once local Docker
      can pull base images again.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check,
      unit, integration, and build.

- [x] **GAP-048 — Cross-entity search.** M-L. Depends: 022. Flow `SEARCH-001`.
  - Scope: `search` read model over people, notes, activities, journal posts,
    tasks (workspace-scoped, permission-filtered, Postgres full-text on existing
    columns); palette groups with entity icons; keyboard navigation.
  - Verify: read-model Postgres tests (tenancy negatives), E2E.
  - Delivered 2026-09-27: flow `SEARCH-001`.
    - A new `search` read model covers people, notes, activities, journal posts,
      and tasks.
      - It reads exactly its declared `sourceModules`: people, interactions,
        journal, planning, files, and workspaces.
      - It is served by `GET /api/v1/search` through the people transport, as
        the other read models are.
      - It revalidates the member, scopes every join to the workspace, and
        excludes deleted and archived people.
      - Notes and activities respect the person-section visibility.
      - Snippets are plain text, cut by code point around the first match.
    - People search runs first on the directory's indexed substring match, at
      about 7 ms with 50,000 notes. The text groups use query-time full text on
      existing columns, because v8 has no full-text index.
    - Each statement is read-only and bounded by a transaction-local 1.5 s
      timeout. When the text groups time out, people still answer and the
      palette says the other results are temporarily unavailable.
    - The product owner accepted this bounded design and deferred indexes to a
      later schema v9 (`REL-061`).
    - The command palette shows grouped results with icons, keyboard navigation,
      and deep links into the person workspace, the journal, or tasks. The page
      catalog gains a validated `sharedSurfaces` block for it.
    - Evidence: search integration suites with cross-workspace, deleted,
      archived, hidden-section, revoked-member, snippet, negated-query, and
      timeout cases; `search.SEARCH-001` with PEOPLE-002, PEOPLE-007, AUTH-003,
      AUTH-004, and TODAY-001 on Chromium and WebKit.
    - Gates: fmt:check, lint, check, check:architecture (14), contracts:check
      (129 documented, 132 mounted), unit, integration, coverage (search
      100/100/100), and build.

- [ ] **GAP-049 — Person merge and duplicate review.** L. Depends: 015, 017.
      Flow `PEOPLE-008`.
  - Scope: `people` `mergePeople(primary, duplicate)` coordinating relinks
    through owning-module facades (relationships, interactions, planning, gifts,
    files, journal) inside one transaction with postconditions; a duplicates
    review list on the directory; audit trail; undo not supported (state
    explicitly).
  - Verify: unit, integration proving every table relinks, E2E.

- [ ] **GAP-050 — Import vCard and CSV; export CSV and all-people vCard.** L.
      Depends: 018. Flows `IMPORT-002`, `EXPORT-002`.
  - Scope: `import-export/domain/formats/{vcard,csv}.ts` parsers feeding the
    existing staging pipeline with a column-mapping step for CSV; export formats
    `csv` (people, contact methods, dates) and `vcf` (all people); settings UI
    for format choice and mapping preview.
  - Verify: parser unit tests with fixture files; integration idempotency; E2E.

- [ ] **GAP-051 — Bulk directory actions.** M. Depends: 029. Flow `PEOPLE-009`.
  - Scope: selection model in the directory reducer; bulk tag, archive, restore,
    export-selection using existing facades with per-item results.
  - Verify: unit, integration, E2E.

- [ ] **GAP-052 — CalDAV VEVENT for important dates and reminders.** M-L.
      Depends: 016. Extends `INTEGRATION-001`.
  - Scope: `integrations` publishes yearly VEVENTs for important dates and
    one-off VEVENTs for reminder occurrences; subscriptions per member; sync
    tokens reuse `dav_sync_tokens`.
  - Verify: adapter unit tests with fixture calendars; integration.

- [ ] **GAP-053 — Notifications centre, favorites, directory tag cloud and
      sort.** M-L. Depends: 028, 039. Flows `TODAY-002`, `PEOPLE-010`.
  - Scope: in-app notification feed backed by audit/reminder events with read
    state (schema v8 if a table is needed); starred people (`isStarred` exists
    in the profile read model; verify write path); directory tag facet and sort
    options.
  - Verify: unit, integration, E2E.

- [ ] **GAP-054 — AI assistance: DG-08 contract and first slice.** L. Depends:
      039, 015. Flow `ASSIST-001`.
  - Removed 2026-09-26 by the product owner: AI assistance is not needed for
    now. The ticket is not scheduled and its ID is retired rather than reused;
    DG-08 is deferred until the owner asks for it again.
  - Scope, part 1 (decision): write
    `docs/architecture/decisions/0007-ai-assistance.md` covering product
    surface, data minimization, authorization (only data the member can already
    read), consent and provider settings per workspace, prompt-injection
    handling for person-authored text, evaluation fixtures, retention (no
    persistence of prompts by default), and audit.
  - Scope, part 2 (slice): `modules/assistant` with a `LanguageModel` port and
    an Anthropic adapter (timeouts, bounded retries, redacted logs, fake for
    tests); use cases `summarizePerson(personId)` and
    `draftMessage(personId,
    intent)` over explicitly selected read-model
    data; API `POST /people/:id/assist`; profile action rendering a streamed
    result with a copy button; no autonomous mutation or sending. Consult the
    `claude-api` reference for current model IDs and SDK usage at implementation
    time.
  - Verify: unit tests with the fake model; contract tests; E2E with the fake
    adapter; security review of the prompt-assembly path.

- [ ] **GAP-055 — Backlog (schedule only on demand).** OAuth server on the
      existing four tables; keyboard shortcut layer over the palette; print
      stylesheet for the profile; UI message catalog for translations; the
      parked `OPS-001E` deployment rollout and billing module remain governed by
      `active-delivery.md`.

---

## Part 4 — Dependency summary

```
GAP-001, 002 ─► 003 ─► 004
                 └───► 005 ─► 006 ─► 007 ─► 013 ─► 024
                                 ├─► 008 ─► 009
                                 ├─► 010, 011, 012, 014
                                 ├─► 015 ─► 016, 017, 018
                                 └─► 019 ─► 020 ─► 021 ─► 022 ─► 023
GAP-025 ─► 026 ─► 027 ─► 028 ─► 029 ─► 033
              └─► 030 ; 028+030 ─► 031 ─► 033 ; 027+028 ─► 032
GAP-014 ─► 034, 035 ─► 037 ; 003 ─► 036 ─► 038
GAP-019 ─► 039 ─► 040 ; 041 ─► 042 ; 013+025 ─► 043
Phase 7 tickets depend on the Phase 2-4 tickets named in each entry.
```

Phases 1-3 (backend) and Phase 4 (frontend) are independent of each other after
GAP-005 and can run as two parallel tracks with separate implementers, merging
at the Phase 5 checkpoint.
