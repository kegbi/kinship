# Delivery Traceability

## Purpose

This document connects the accepted architecture and product catalogs to an
implementation slice and a verifiable acceptance artifact. It is an execution
index, not a replacement for any accepted architecture, schema, page, or flow
contract.

The current baseline contains:

- 15 backend modules and 9 read models in `module-boundaries.yaml`; 14 modules
  and all 9 read models exist under `packages/backend`, the optional `billing`
  module being the one not built;
- 41 cataloged pages (35 `static-shell-islands`, 2 `on-demand`, 4 `static`), all
  implemented, except `settings.billing`, which the catalog marks as an optional
  module and Phase 10 `APP-010C` withholds;
- 43 required flows: 17 P0, 20 P1, and 6 P2;
- 42 of those flows `delivered` with populated `testRefs`. Only `BILLING-001` is
  still planned with an empty `testRefs` array, consistent with its withheld
  optional module; and
- 50 Playwright specs under `tests/e2e/`. Flow specs are named
  `<feature>.<FLOW-ID>.spec.ts` (GAP-036); specs with no flow keep a feature
  name. The flows' `testRefs` name 46 of them; `perf.PERF-001.spec.ts`,
  `perf.PERF-002.spec.ts`, `content-security-policy.spec.ts`, and
  `public-home.spec.ts` prove no catalog flow.

Verified against `docs/architecture/module-boundaries.yaml`,
`docs/product/page-catalog.yaml`, `docs/product/user-flows.yaml`, and
`tests/e2e/` on 2026-09-27 by GAP-043 and updated by GAP-050, which added
`IMPORT-002` and `EXPORT-002`, by GAP-051, which added `PEOPLE-009`, and by
GAP-053, which added `TODAY-002`, `PEOPLE-010`, and the `notifications` read
model, and on 2026-11-22 by MCP-C3 and MCP-C4, which added `public.mcp-guide`
and `API-003`; the earlier count was taken on 2026-08-29 while integrating
[`ux-design-review-2026-08-29.md`](../validation/ux-design-review-2026-08-29.md)
§5.3 item 5. `tools/product/flow_traceability_test.ts` keeps the `testRefs` and
the specs' `flow` annotations in agreement. The five cataloged dynamic routes
are served by the internal shell and gateway-rewrite pattern rather than by
separate Astro routes; that is an implementation shape, not a coverage gap.

The slice column below is the **accepted slice in which the complete contract is
accepted**, not necessarily the first slice in which a shell or dependency is
introduced. PRODUCT-001 accepts these assignments while leaving the named
follow-up product gaps open.

## Module Delivery Matrix

All writes go through the owning module's public application facade. A slice may
compose public facades, but it must not reach into another module's domain,
repository, adapter, or transport implementation.

| Module          | Kind     |                                             First complete slice | Capability delivered                                                                                                                                                             | Required proof                                                                                  |
| --------------- | -------- | ---------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `identity`      | core     |                              Core sign-in/session 1; lifecycle 7 | Flow-backed registration, verification, sign-in/session security, and recovery in Slice 1; identity deletion in Slice 7; any broader credential/MFA/passkey settings await DG-07 | Auth contract/unit/integration suites; malicious token and session cases; accepted `AUTH-*` E2E |
| `workspaces`    | core     |                     Membership 1; personalization 2; lifecycle 7 | Membership, invitations, active workspace, preferences, controlled vocabularies, and safe reset/delete                                                                           | Role/scope matrix, cross-workspace rejection, invitation races, lifecycle transaction tests     |
| `people`        | core     |                                                                2 | Person identity and profile facts, contact methods, locations, organizations, tags, and pets; `PEOPLE-008` merge through every owning module                                     | Tenant-safe repositories, partial dates, archive/restore/delete, `PEOPLE-*` E2E                 |
| `relationships` | core     |                                                                2 | Directional relationship graph; romantic metadata only if DG-07 accepts its product behavior                                                                                     | Directionality, uniqueness, permissions, archive interactions, `RELATIONSHIP-001`               |
| `interactions`  | core     |                                                                3 | Notes, activities, calls, conversations, messages, participants, and emotions                                                                                                    | Composition and authorization tests, immutable audit effects, interaction E2E                   |
| `journal`       | core     |                                                                6 | Journal posts, ratings, and ordered items; person life-event writes through `JOURNAL-002`                                                                                        | Ordering/concurrency and life-event tests; `JOURNAL-001`/`-002` E2E                             |
| `planning`      | core     |                                                                4 | Tasks, reminder rules/occurrences, stay-in-touch cadence, and worker work                                                                                                        | Clock/time-zone/DST suites, claim/retry/idempotency/process-death proof, planning E2E           |
| `files`         | core     |                                                                5 | Metadata, object lifecycle, authorized retrieval, and person/gift links                                                                                                          | Object failure, quarantine/missing states, tenant-safe download, storage-limit tests            |
| `gifts`         | core     |                                                                5 | Gifts, gift ideas/history, debts, and attachment coordination                                                                                                                    | Amount/currency invariants, file coordination, person-local `GIFTS-001` E2E                     |
| `integrations`  | optional |                                                                8 | DAV synchronization and optional weather cache                                                                                                                                   | Disabled-module contract, fake provider, retry/idempotency and `INTEGRATION-001`                |
| `import-export` | core     |                                                                7 | Staged imports, identity mapping, reports, manifests, and portable exports                                                                                                       | Fixture corpus, dry-run/atomicity/idempotency, hostile archives, round-trip tests               |
| `api-access`    | runtime  |                                                                8 | Personal tokens with independent scopes, token introspection, and the token API and MCP endpoint over it (ADR 0009); OAuth only if separately approved                           | Secret hashing/scopes/revocation, per-lane bearer suites, `API-001`, `API-002`, and `API-003`   |
| `governance`    | core     |                                         3 for audit; 6 for legal | Audit history, versioned legal documents, and immutable acceptance                                                                                                               | Same-transaction audit proof, append-only behavior, authorization, governance E2E               |
| `billing`       | optional |                                                                8 | Provider-neutral customer, subscription, and entitlement state                                                                                                                   | Disabled-module contract, signed webhook/replay cases, fake provider, `BILLING-001`             |
| `operations`    | runtime  | Begins in Foundation; completion pending DG-07/DG-10 and Slice 8 | Concrete internal run history and instance/statistics support; any user surface remains undecided                                                                                | No tenant-data leakage, bounded retention, health/readiness and operator authorization          |

### Token API and MCP endpoint

The 2026-11-22 work order ([MCP server plan](mcp-server-plan-2026-11-22.md),
ADR 0009) added no module. It extended the existing modules' routes to personal
tokens and added a delivery adapter over them. Each surface maps to its
evidence:

| Surface                                                                                                                                    | Evidence                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RouteDescriptor.tokenScope`, `ANY_TOKEN_OPERATIONS`, `x-kinship-token-scope`                                                              | `packages/contracts/registry_test.ts`, `packages/contracts/api_tokens_test.ts`, `apps/api/routes_test.ts`, `apps/api/default_deny_test.ts`, `tools/contracts/api_reference_test.ts` |
| Token admission from the descriptor, `apiTokenId` in audit, `GET /api/v1/me`                                                               | `tests/integration/api_tokens_postgres_test.ts`, `apps/api/audit_correlation_test.ts`, `tests/support/tokens.ts`                                                                    |
| Token-enabled people, profile, relationship, interaction, planning, journal, gift, file, and vocabulary routes                             | One lane suite each: `tests/integration/api_tokens_{people_identity,people_profile,relationships,interactions,planning,journal,gifts,files,vocabularies}_postgres_test.ts`          |
| New operations: interaction, task, reminder, cadence, gift, and debt edits and deletes; retry-safe person, journal, gift, and debt creates | `tests/integration/interactions_edit_delete_postgres_test.ts`, `planning_edit_delete_postgres_test.ts`, `gifts_edits_postgres_test.ts`, and the people and journal lane suites      |
| `POST /api/v1/mcp` and `packages/mcp-kit/`                                                                                                 | `packages/mcp-kit/*_test.ts`, `tests/integration/mcp_postgres_test.ts`, and `API-003`                                                                                               |
| Tool catalog `packages/contracts/tools/` and generated `packages/contracts/mcp/tools.json`                                                 | `packages/contracts/tools/*_test.ts`, `tools/contracts/tool_catalog_test.ts`, and `contracts:check`                                                                                 |
| Boundary rules for the kit, the SDK, and the catalog                                                                                       | `tools/architecture/check_boundaries_test.ts` and `check:architecture`                                                                                                              |
| Scope picker, presets, and "Connect an AI agent" in `settings.api-access`; `public.mcp-guide`                                              | `apps/web/src/features/settings/api-access/*.test.ts*`, `apps/web/src/features/mcp-guide/guide.test.ts`, the build-output suite, `API-001`, `API-002`, and `API-003`                |

`operations` begins only when the first runnable stack has concrete run-history
or instance behavior to store; do not create an empty module scaffold. Its
capability is not complete, and a user-facing administrative surface is not
authorized, until DG-07/DG-10 supply its scope, page ID, flow ID, permissions,
states, and E2E contract.

## Read-Model Delivery Matrix

Read models are read-only composition boundaries. Their query adapters may read
only the allowlisted source modules in
`docs/architecture/module-boundaries.yaml`; every action returned by a screen
still invokes the owning module's public use case.

| Read model         | Begins | Complete | Consumers and acceptance                                                                                                                                              |
| ------------------ | -----: | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `people-directory` |      1 |        1 | People list/search/archive states; tenant, pagination, ordering, and query-budget tests; the bounded `PEOPLE-008` duplicate review                                    |
| `person-profile`   |      1 |        6 | Starts as a typed shell; completion is Slice 6 after every enabled core section is present; `PEOPLE-003` is accepted there; its life-event edits follow `JOURNAL-002` |
| `activity-report`  |      3 |        3 | Scale-heavy person-specific interaction report with permission and pagination proof                                                                                   |
| `audit-history`    |      3 |        3 | Person/workspace audit query composition arrives in Slice 3; governance audit writes begin with Slice 1 mutations                                                     |
| `today`            |      1 |        4 | Starts as onboarding/empty shell; complete semantic queue and inline owning-module actions arrive in Slice 4                                                          |
| `journal-timeline` |      3 |        6 | Interaction history can seed the projection; journal ordering determines Slice 6 completion; `JOURNAL-002` life-event edits refresh it                                |
| `search`           |      6 |        6 | `SEARCH-001` palette groups over people, notes, activities, journal posts, and tasks; tenancy, visibility, soft-delete, snippet, and bound tests                      |
| `calendar-feed`    |      8 |        8 | `INTEGRATION-002` read-only iCalendar feed of person dates and the member's reminder days; tenancy, archived/deleted, window, cap, and timeout tests                  |

## Flow-To-Slice Matrix

Every row must eventually name at least one Playwright test in the flow
catalog's `testRefs`. The test must carry the stable flow ID in its title or tag
and exercise the production-like gateway, not an internal service URL.

| Flow               | Priority | Complete slice | Primary pages                                    | Acceptance emphasis                                                                                          |
| ------------------ | -------- | -------------: | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `AUTH-001`         | P0       |              1 | `auth.sign-up`, `auth.verify-email`, `app.today` | First verified owner and workspace; replay/expiry/error states                                               |
| `AUTH-002`         | P0       |              1 | `settings.members`, `invitation.accept`          | Role-authorized invite, existing/new user acceptance, expiry and replay                                      |
| `AUTH-003`         | P0       |              1 | sign-in, recovery, reset, MFA                    | Password/MFA challenge, recovery, lockout/rate controls, session creation                                    |
| `AUTH-004`         | P0       |              1 | settings overview/profile/preferences/security   | Current-member profile/preferences and session revocation, including stale/forbidden session cases           |
| `AUTH-005`         | P1       |              7 | settings overview/profile                        | Leave workspace or delete identity only after full impact analysis and lifecycle coordination                |
| `WORKSPACE-001`    | P1       |              1 | workspace and members settings                   | Settings/member/role management; this was previously missing from the release-slice assignment               |
| `WORKSPACE-002`    | P1       |              7 | workspace danger zone                            | Preview, confirmation, atomic reset/delete, retained audit policy, owner safeguards                          |
| `WORKSPACE-003`    | P1       |              2 | personalization settings                         | Module toggles and vocabulary CRUD via stable `section` deep links                                           |
| `TODAY-001`        | P0       |              4 | Today, person profile, tasks                     | Documented semantic ordering, empty/overdue/due states, authorized inline actions                            |
| `TODAY-002`        | P1       |              4 | application shell, person profile, settings      | Member-scoped notification feed, read-through watermark, bounded badge, cross-member negatives               |
| `PEOPLE-001`       | P0       |              1 | create person, person profile                    | Create minimal/full person, validation, duplicate guidance, navigation                                       |
| `PEOPLE-002`       | P0       |              1 | people, archived people, profile                 | Search/filter/order/paginate and distinguish active/archived/not-found/forbidden                             |
| `PEOPLE-003`       | P0       |              6 | person profile                                   | Complete composable workspace across all enabled core sections; shell begins in Slice 1                      |
| `PEOPLE-004`       | P0       |              2 | profile, people, archived people                 | Edit, archive, restore, and delete are one mutation flow; no fictional read-only subset                      |
| `PEOPLE-005`       | P0       |              2 | person profile                                   | Valid full/partial/unknown dates, chronology, display, recurrence behavior                                   |
| `PEOPLE-006`       | P1       |              2 | person profile                                   | All remaining enabled profile facts and section visibility behavior                                          |
| `PEOPLE-007`       | P1       |              5 | person profile, people                           | Avatar upload/replace/remove through files and people, initials fallback, quarantined/missing objects        |
| `PEOPLE-008`       | P1       |              7 | people, person profile                           | Duplicate review and atomic merge through every owning module; no undo; re-import stays idempotent           |
| `PEOPLE-009`       | P1       |              7 | people, archived people                          | Bulk tag, archive, restore, and vCard export through single-person use cases with per-person results         |
| `PEOPLE-010`       | P1       |              7 | people, archived people, person profile          | Workspace star with archived rule and audit, tag facet counts, every order's keyset cursor                   |
| `RELATIONSHIP-001` | P0       |              2 | person profile                                   | Directional graph, valid types, remove/change behavior, and romantic details only if DG-07 accepts them      |
| `INTERACTION-001`  | P0       |              3 | person profile, activity report, Today           | Add/review note or activity and observe projections/audit                                                    |
| `INTERACTION-002`  | P1       |              3 | person profile                                   | Calls, conversations/messages, participants, emotion and chronology behavior                                 |
| `PLANNING-001`     | P0       |              4 | profile, tasks, Today                            | Person/global tasks, completion/reopen, permissions and projections                                          |
| `PLANNING-002`     | P0       |              4 | profile, Today                                   | Generate, claim, deliver, retry, and de-duplicate reminders across time zones                                |
| `PLANNING-003`     | P1       |              4 | preferences settings, person profile             | Email and daily-digest delivery with person links, unverified fallback, retry, and reconciliation            |
| `FILES-001`        | P0       |              5 | profile, storage settings                        | Upload/link/download/remove with limits, authorization, missing/quarantined objects                          |
| `GIFTS-001`        | P1       |              5 | person profile                                   | Gifts, debts, amounts/currencies, and attachment coordination                                                |
| `JOURNAL-001`      | P1       |              6 | journal index/item, person profile               | Post/rating/ordered items and person-linked display                                                          |
| `JOURNAL-002`      | P1       |              6 | person profile                                   | Add/edit/remove life events: precision, revision, archived read-only, and cross-workspace rejection          |
| `SEARCH-001`       | P1       |              6 | header palette, profile, journal item, tasks     | Grouped cross-entity results, keyboard navigation, deep links, tenancy, hidden and deleted rows              |
| `IMPORT-001`       | P0       |              7 | import index/new/report                          | Detect, stage, dry-run, validate, commit atomically, rerun idempotently, handle attachments safely           |
| `IMPORT-002`       | P1       |              7 | import index/new/report                          | vCard and CSV staging, CSV column mapping, skipped-property report, UID conflicts, idempotent rerun          |
| `EXPORT-001`       | P0       |              7 | export settings, person profile                  | Authorized workspace/person exports, manifests, vCard and portable round-trip checks                         |
| `EXPORT-002`       | P1       |              7 | export settings                                  | CSV archive and all-people vCard, formula-injection guard, manifests, short-lived downloads                  |
| `API-001`          | P2       |              8 | API access settings                              | Create/scoped use/revoke tokens without weakening interactive auth                                           |
| `API-002`          | P2       |              8 | Public API reference, API access settings        | Signed-out static documentation, bearer OpenAPI, person/task/capture automation and grant refusal/revocation |
| `API-003`          | P2       |              8 | Public MCP guide, API access settings            | No-script MCP guide, preset token, stateless MCP client, scope-filtered tools, replay, audit, revocation     |
| `INTEGRATION-001`  | P2       |              8 | integrations settings                            | Configure/synchronize DAV; isolate failures; core works while disabled                                       |
| `INTEGRATION-002`  | P2       |              8 | personal preferences                             | Read-only iCalendar feed: secret URL shown once, rotate/revoke 404, 304, cap, secret never logged            |
| `GOVERNANCE-001`   | P1       |              6 | privacy, terms, compliance acceptance            | Versioned document display and immutable, required acceptance                                                |
| `GOVERNANCE-002`   | P1       |              3 | person audit, profile, workspace audit           | Authorized history, redaction, ordering, and forbidden cases                                                 |
| `BILLING-001`      | P2       |              8 | billing settings                                 | Optional entitlement and provider workflow with module disabled by default                                   |

For the current 43-flow snapshot, this assignment places all 17 P0 and all 20 P1
flows at or before Slice 7, so the accepted MVP and Core feature complete cuts
coincide there. The milestone meanings remain distinct and future catalog
changes regenerate their membership and maximum slice. Slice 4 is the accepted
Core alpha cut, but it omits current P0 flows.

## Page Delivery Matrix

The page catalog remains the route authority. The grouping below states when a
route must work end to end; an earlier slice may introduce a shared shell.

| Route group                    | Catalog IDs                                                                                                                 |                                                                          Delivery |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------: |
| Public product                 | `public.home`, `public.features`                                                                                            |                                                                                 1 |
| Public API reference           | `public.api-reference`, `public.mcp-guide`                                                                                  |                                                                                 8 |
| Legal public                   | `legal.privacy`, `legal.terms`                                                                                              |                                                                                 6 |
| Authentication and invitation  | `auth.sign-in`, `auth.sign-up`, `auth.verify-email`, `auth.recover`, `auth.reset`, `auth.mfa`, `invitation.accept`          |                                                                                 1 |
| Today                          | `app.today`                                                                                                                 |                                                               shell 1; complete 4 |
| People                         | `people.index`, `people.archived`, `people.create`, `people.profile`                                                        | shell/core 1; read-complete 6; flow-backed local actions in their assigned slices |
| Person reports                 | `people.activity-report`, `people.audit`                                                                                    |                                                                                 3 |
| Tasks                          | `tasks.index`                                                                                                               |                                                                                 4 |
| Journal                        | `journal.index`, `journal.item`                                                                                             |                                                                                 6 |
| Settings foundation            | `settings.index`, `settings.profile`, `settings.preferences`, `settings.security`, `settings.workspace`, `settings.members` |                                     core settings 1; personal lifecycle actions 7 |
| Settings personalization       | `settings.personalization`                                                                                                  |                                                                                 2 |
| Settings audit                 | `settings.audit`                                                                                                            |                                                                                 3 |
| Settings storage               | `settings.storage`                                                                                                          |                                                                                 5 |
| Settings danger/data lifecycle | `settings.workspace-danger`, `settings.import`, `settings.import-new`, `settings.import-report`, `settings.export`          |                                                                                 7 |
| Optional settings              | `settings.api-access`, `settings.integrations`, `settings.billing`                                                          |                                                                                 8 |
| Compliance                     | `compliance.accept`                                                                                                         |                                                                                 6 |

`public.home` and `public.features` are accepted in Slice 1 as cataloged route
contracts even though no current flow owns them; route, current public state,
accessibility, and navigation checks are their acceptance evidence, and their
`flowIds` remain empty. The Slice 8 treatment of `settings.api-access`,
`settings.integrations`, and `settings.billing` is also a proposal: only billing
currently declares optional availability in the page catalog. DG-07 must add
authoritative availability/feature-gating metadata or reclassify the other pages
before optional-platform promotion.

The two cataloged `on-demand` pages are `legal.privacy` and `legal.terms`, which
the private Astro Node renderer serves behind the gateway (ADR 0007).
`auth.verify-email`, `auth.reset`, `auth.mfa`, `invitation.accept`, and
`compliance.accept` are prerendered static shells with islands, served
`private, no-store`, and need no renderer.

## Deferred Catalog Repairs Before Affected Work

These are product-contract decisions, not implementation liberties:

1. Resolved 2026-09-27 (GAP-046): `JOURNAL-002` "Maintain a person's life
   events" is the stable flow for adding, editing, and removing a life event
   from the person workspace's Life events section; see
   `docs/product/user-flows.yaml`.
2. Add an operations/admin page and flow with explicit operator permissions, or
   remove the user-facing administration promise from Slice 8.
3. Define whether `page.flowIds` lists every flow that visits a page or only the
   flows for which the page is a primary acceptance surface; validate both
   directions consistently.
4. Define whether nested pages inherit the catalog's authenticated default
   states and which deviations must be declared explicitly.
5. Add or explicitly decline flows for multi-workspace switching, all promised
   password/MFA/passkey/recovery/session operations, avatar management,
   help/what's-new actions, and any saved-filter behavior.
6. Decide which external Monica API compatibility routes are required. Do not
   treat a settings page for tokens as proof of API parity.
7. Define import behavior when optional integrations are disabled and whether
   optional source records are skipped, preserved for later activation, or
   rejected with an actionable report.
8. Preserve the accepted rule that imported legacy credentials never become
   active, while deciding whether mapped password/TOTP/WebAuthn material is
   discarded, reported, or preserved only inert pending forced reset/
   re-enrollment. If the accepted mapping changes, publish a synchronized new
   schema bundle.
9. Define machine-readable availability/feature-gating metadata for P2 pages,
   including API access and integrations, so catalog and route validation can
   distinguish disabled deployment capability from a missing implementation.
10. Decide whether romantic relationship metadata is an accepted user-facing
    part of `RELATIONSHIP-001` and add the corresponding observable outcomes if
    so.

No new stable ID should reuse or renumber a released ID. After any accepted
repair adds, removes, reprioritizes, or reassigns a flow or changes a page's
availability, regenerate the inventory totals, flow-to-slice matrix, milestone
derivation, release summary, and catalog validators together.

## Traceability Lifecycle

For each slice:

1. create the Playwright spec with the stable ID, or the narrowest lower-layer
   precursor test, before the corresponding behavior; run it and record the
   intended RED result;
2. keep the flow `planned` while implementation is partial and track
   work-in-progress in the delivery system, not by overstating catalog status;
3. make the smallest GREEN implementation, REFACTOR under focused tests, run
   affected candidate gates once, and route the exact revision through
   independent review;
4. add the passing Playwright path to that flow's `testRefs` only when its full
   observable contract is complete;
5. validate that every page ID and flow ID referenced by implementation/tests
   exists in the machine-readable catalog;
6. change the flow to its delivered state only after all required browser
   projects and negative cases pass through the production-like gateway; and
7. accept the slice only when no included flow has an empty `testRefs` array.

Catalog validation must fail CI for unknown IDs, duplicate IDs, missing test
files, a required flow without a test reference, an implemented route without a
page ID, or a released ID that changes meaning.
