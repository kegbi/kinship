# MCP Server Plan — 2026-11-22

Status: user-directed work order (2026-11-22). The product owner asked for an
MCP server through which an AI agent can add, edit, and remove CRM records
within what its credential grants, and asked that access-control gaps found in
the API be fixed first, because the MCP server reuses the same routes. This plan
is subordinate to `AGENTS.md` and to the accepted schema, architecture, and
product contracts.
[ADR 0009](../architecture/decisions/0009-mcp-endpoint-over-the-token-api.md)
records the architecture.

## Part 1 — What the analysis found

The analysis read the route registry, the token machinery, the composition root,
the gateway, and every module's application layer at `bdc989ea`.

### 1.1 What is already right (do not "fix" these)

- **Authentication.** All routes with a `security` requirement refuse a missing,
  unknown, or malformed credential (`apps/api/default_deny_test.ts`). An
  `Authorization` header commits a request to token admission; a refused bearer
  never falls back to the cookie.
- **Roles.** `packages/contracts/routes/permissions.ts` maps every route to one
  permission of `authorization-matrix.yaml`, and `apps/api/role_matrix_test.ts`
  probes each route as owner, admin, and member. Role decisions sit in the use
  cases, in front of the first read.
- **Membership.** Every CRM write revalidates the actor under a lock in its own
  transaction. A token acts with its issuer's current role; suspension or
  leaving revokes it.
- **Tenancy.** A token is bound to one workspace, an `X-Workspace-Id` that
  disagrees answers 401, and every tenant statement runs under the row-level
  security scope of ADR 0008.
- **Legal guard.** A token-admitted actor still answers to the legal-requirement
  guard through `tokenAdmission`.

### 1.2 Findings this plan fixes

| ID | Finding                                                                                                                                                                                                        | Fix                                                         |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| F1 | A token-enabled route's required scope exists only inside its handler and as prose in the descriptor. Nothing checks that the two agree.                                                                       | MCP-A1: `tokenScope` on the descriptor; admission reads it. |
| F2 | A change made with a token is audited as the member. Neither the audit event nor the request log names the token.                                                                                              | MCP-A1: `payload.apiTokenId` on every audit event.          |
| F3 | The bearer surface is pinned by hand: the count `14` in three tests, per-route tables, and "seven grants" prose.                                                                                               | MCP-A1 and MCP-W1: derive from the registry.                |
| F4 | Only 14 of 157 routes accept a token. An agent cannot create a person, a reminder, a journal post, a gift, or a relationship.                                                                                  | Lanes MCP-B1 to MCP-B9.                                     |
| F5 | Several creates are not safe to retry (`createPerson`, `createJournalPost`, `createGift`, `createDebt`, `createRecurringDebt`), and journal and gift updates have no revision check.                           | MCP-D4 (people, journal), MCP-D3 (gifts, debts).            |
| F6 | Operations an agent expects have no use case: edit or delete a note, activity, call, or conversation; delete a task; edit or delete a reminder; delete a cadence; edit a gift or debt's values; delete a gift. | MCP-D1 (interactions), MCP-D2 (planning), MCP-D3 (gifts).   |

### 1.3 Findings recorded, not changed

- **Demotion.** Only owners and admins may issue tokens, but a demoted admin's
  token keeps working at member level until an owner or admin revokes it. Its
  grants still intersect the member role, and the workspace token list still
  shows it. Unchanged.
- **Throttling.** Nothing limits a single token. The gateway limits each client
  address to 50 requests a second. One MCP request performs at most one route
  call, so the endpoint adds no amplification. Unchanged.
- **Journal and gifts are workspace-wide.** Any member may edit or delete any
  journal post, gift, or debt, by design. The route and tool descriptions and
  the token form's grant details say so.

## Part 2 — Decisions

These are the defaults this plan executes. Each keeps an accepted contract
unless the product owner says otherwise.

- **D1 Architecture.** ADR 0009: `POST /api/v1/mcp` in the API process; a tool
  call is an in-process request to an existing route.
- **D2 Credential.** Personal API tokens only. OAuth is out of scope.
- **D3 Issuance.** Stays owner/admin-only. Opening it to members changes
  `api-tokens.manage` and is the product owner's call.
- **D4 Dependency.** `@modelcontextprotocol/server`, pinned exactly.
- **D5 Scopes.** The vocabulary in Part 3. Grants stay independent: no scope
  implies another, and a write scope does not grant reads.
- **D6 Composite reads.** `search:read` and `today:read` are explicit grants
  that return content from several modules (notes, activities, journal posts,
  tasks, reminders). Their labels say so. The aggregate person reads
  (`getPerson`, the person timeline) stay session-only.
- **D7 Exclusions.** The list in ADR 0009 "What stays out".
- **D8 New operations ship without new UI.** Lanes D add use cases and routes
  the web app does not call yet. They are agent- and API-visible behavior.

## Part 3 — Token scopes

Existing before this plan: `people:read`, `people:profile:read`,
`relationships:read`, `tasks:read`, `tasks:create`, `tasks:write`,
`interactions:create`. The table lists what each grant admits as delivered; the
route registry (`tokenScope` on each descriptor) is the authority.

| Scope                              | Routes it admits (operation ids)                                                                                                                                                                              | Lane       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `people:read` (existing, extended) | `listPeopleTagOptions`, `listPeopleTagFacet`                                                                                                                                                                  | B1         |
| `people:write`                     | `createPerson`, `editPerson`, `archivePerson`, `restorePerson`, `starPerson`, `unstarPerson`, `bulkPeople`                                                                                                    | B1         |
| `people:write`                     | `createProfileFact`, `updateProfileFact`, `deleteProfileFact`, `createImportantDate`, `updateImportantDate`, `deleteImportantDate`, `createPersonLifeEvent`, `updatePersonLifeEvent`, `deletePersonLifeEvent` | B2, B6     |
| `people:profile:read` (extended)   | `listPersonLifeEvents`                                                                                                                                                                                        | B2         |
| `people:delete`                    | `getPersonDeletionImpact`, `deletePerson`                                                                                                                                                                     | B1         |
| `people:merge`                     | `listPeopleDuplicates`, `dismissPeopleDuplicate`, `previewPeopleMerge`, `mergePeople`                                                                                                                         | B1         |
| `search:read`                      | `searchWorkspace`                                                                                                                                                                                             | B1         |
| `today:read`                       | `getTodayRecentPeople`, `getTodayAttention`, `getTodayReminders`, `getTodayTasks`, `getTodayFavoriteNotes`, `getTodayRecentActivity`                                                                          | B1, B4, B5 |
| `relationships:write`              | `createRelationship`, `updateRelationship`, `deleteRelationship`                                                                                                                                              | B3         |
| `interactions:read`                | `getActivityReport`, `listPersonCommunications`                                                                                                                                                               | B4         |
| `interactions:write`               | `updateNote`, `deleteNote`, `updateActivity`, `deleteActivity`, `updateCall`, `deleteCall`, `updateConversation`, `deleteConversation`                                                                        | D1         |
| `tasks:write` (existing, extended) | `deleteTask`                                                                                                                                                                                                  | D2         |
| `reminders:read`                   | `listPersonReminders`                                                                                                                                                                                         | B5         |
| `reminders:write`                  | `createReminder`, `setReminderActive`, `updateReminder`, `deleteReminder`, `createStayInTouchCadence`, `deleteStayInTouchCadence`                                                                             | B5, D2     |
| `journal:read`                     | `listJournal`, `getJournalItem`                                                                                                                                                                               | B6         |
| `journal:write`                    | `createJournalPost`, `updateJournalPost`, `saveJournalDayRating`, `linkJournalActivity`, `deleteJournalItem`                                                                                                  | B6         |
| `gifts:read`                       | `listPersonGiftsAndDebts`, `listDebtSettlements`                                                                                                                                                              | B7         |
| `gifts:write`                      | `createGift`, `updateGift`, `changeGiftStatus`, `deleteGift`, `createDebt`, `updateDebt`, `changeDebtStatus`, `deleteDebt`, `createRecurringDebt`, `updateRecurringDebt`, `deleteRecurringDebt`               | B7, D3     |
| `files:read`                       | `listPersonFiles`, `downloadPersonFile` (binary, REST only)                                                                                                                                                   | B8         |
| `files:write`                      | `uploadPersonFile` (binary, REST only), `removePersonFile`                                                                                                                                                    | B8         |
| `vocabularies:read`                | `listPersonalizationEntries`                                                                                                                                                                                  | B9         |
| `vocabularies:write`               | `createPersonalizationEntry`, `updatePersonalizationEntry`, `deletePersonalizationEntry`                                                                                                                      | B9         |

`people:profile:read` keeps `getPersonIdentity`, `listProfileFacts`, and
`listImportantDates` and gains `listPersonLifeEvents`; the life-event writes
(MCP-B6) are `people:write`, not a journal grant. Routes not listed keep session
admission. `createRelatedPersonRelationship` stays session-only because it needs
two grants; an agent creates the person and then the relationship.
`acknowledgeReminderOccurrence`, `recordPersonView`, the avatar routes, and the
vCard exports stay session-only.

## Part 4 — Tickets

Each ticket is one candidate commit by one implementer in its own worktree,
reviewed once by a separate read-only reviewer, following
[autonomous delivery](../development/autonomous-delivery.md). The controller
merges approved candidates and regenerates the contract artefacts at each merge.

### Phase A — Foundation (serial)

- [x] **MCP-A1 Token surface foundation.** Fixes F1, F2, and the backend half of
      F3.
  - `RouteDescriptor.tokenScope`; a registry rule that a route has it exactly
    when its `security` lists `kinship_api_token` (two named exceptions accept
    any valid token: `getTokenContext` and, later, `mcp`); the OpenAPI documents
    carry it as `x-kinship-token-scope`.
  - One http-kit admission that takes the descriptor and reads its scope. The 14
    existing token routes move to it.
  - The full scope vocabulary of Part 3 in `token_rules.ts` and the contract
    schema. The unknown-scope fixtures move off `people:write`.
  - `apiTokenId` on the actor's correlation and in `auditPayload`, with a
    PostgreSQL test that a token-authenticated write stores it and a cookie
    write does not.
  - Token introspection in `api-access` (any valid token, no required scope) and
    `GET /api/v1/me` (`getTokenContext`): token id, name, scopes, expiry,
    workspace id, member id, and role. It runs the legal guard.
  - Every route factory a lane will touch accepts the token authority, and the
    composition root passes it, so lanes do not edit `apps/api/composition.ts`.
  - The hand-pinned `14`s and per-route tables become registry-derived rules.
  - Shared integration support for minting a token and sending bearer requests,
    so each lane writes its own `tests/integration` file.

### Phase B — Token enablement and the server (parallel after A1)

Lane recipe: add `tokenScope`, the security pair, optional `Origin` on writes,
and a one-sentence description to each descriptor; move each handler to the
descriptor-driven admission; cover the routes with handler tests using a fake
authority and with one lane-owned PostgreSQL file (granted, missing scope, a
different scope, revoked, expired, foreign workspace, foreign child ids, never
borrowing the cookie, `apiTokenId` on the audit event); remove the session-only
pins for those routes; regenerate contracts. Lanes do not edit the authorization
matrix or architecture prose; MCP-C4 does that once.

- [x] **MCP-B1 People identity.** `people:write`, `people:delete`,
      `people:merge`, the `people:read` lookups, `search:read`, and
      `getTodayRecentPeople`.
- [x] **MCP-B2 People profile.** Fact and important-date writes, and the
      life-event list.
- [x] **MCP-B3 Relationships.** `relationships:write`.
- [x] **MCP-B4 Interactions.** `interactions:read` and the two interaction Today
      regions.
- [x] **MCP-B5 Planning.** `reminders:read`, `reminders:write`, and the three
      planning Today regions.
- [x] **MCP-B6 Journal.** `journal:read`, `journal:write`, and the life-event
      writes under `people:write`.
- [x] **MCP-B7 Gifts and debts.** `gifts:read`, `gifts:write`.
- [x] **MCP-B8 Files.** `files:read`, `files:write`, including the binary upload
      and download over REST.
- [x] **MCP-B9 Vocabularies.** `vocabularies:read`, `vocabularies:write` on the
      personalization routes. The owner/admin rule stays in the use case.
- [x] **MCP-C1 MCP endpoint.** The dependency, `packages/mcp-kit/`,
      `packages/contracts/tools/` with `defineTool`, the `mcp` route, its mount,
      the boundary and manifest entries, and tools for the routes that are
      token-enabled at A1 plus `get_context`. Unit tests for the kit, and a
      PostgreSQL suite that drives the endpoint as a client would: initialize, a
      tool list filtered by scope, a successful call, a refused scope, a revoked
      token, a foreign `Origin`, an ignored cookie, and the legal guard.
- [x] **MCP-W1 Token settings.** The scope picker grouped by area with read and
      write grants, two presets (read-only agent, full CRM agent), and a
      "Connect an AI agent" block with the endpoint URL and client
      configuration. The `/docs/api` prose stops counting grants by hand.

### Phase D — Missing operations (parallel, each after its B lane)

A lane that finds it needs a schema change stops and reports; a schema version
is a separate decision.

- [x] **MCP-D1 Interactions.** Edit and delete a note (including its favourite
      flag), an activity, a call, and a conversation, under
      `interactions:write`, with revision checks.
- [x] **MCP-D2 Planning.** Delete a task; edit and delete a reminder; delete a
      cadence.
- [x] **MCP-D3 Gifts and debts.** Edit a gift's and a debt's values, delete a
      gift, retry-safe creates (`requestId`), and revision checks on updates.
- [x] **MCP-D4 People and journal retries.** `requestId` on `createPerson` (the
      existing `ensure` use case) and `createJournalPost`, and a revision check
      on `updateJournalPost`.

### Phase C — Catalog, guide, and checkpoint (serial, after B and D)

- [x] **MCP-C2 Tool catalog.** A tool for every token-enabled JSON route, named
      and described consistently, with the contract test of ADR 0009 point 5 and
      the generated `packages/contracts/mcp/tools.json`.
- [x] **MCP-C3 Public MCP guide.** A static `/docs/mcp` page with its own
      page-catalog id: connecting a client, the scope-to-tool table, and the
      tool reference rendered from the generated catalog.
- [x] **MCP-R1 One shared token-route admission.** The gate-and-actor pair the
      journal, gift, file, and personalization lanes each copied is one
      `routeAdmission` in `packages/http-kit/route_admission.ts`, and one
      `presentsAuthorization` predicate decides token admission everywhere; no
      route's answers or check order change.
- [x] **MCP-C5 Tool catalog follow-up.** Tools for the edit, delete, and file
      routes the D lanes merged after MCP-C2, the retry keys and revision checks
      those lanes added, revision-source and grant notes in every description,
      `defineTool`'s `require`, and the updated grant details.
- [x] **MCP-C4 Flow and checkpoint.** Flow `API-003` in the catalogs with its
      Playwright test (mint a token in settings, call tools through the
      endpoint, see the change in the app); the authorization-matrix invariants,
      `backend-architecture.md`, `repository-layout.md`,
      `module-boundaries.yaml`, and traceability brought up to date; then the
      integration gates once: coverage, contracts, architecture, build, and the
      affected browser flows. The flow, its test, and the documents are
      delivered, with `API-001` to `API-003` passing in Chromium; full coverage
      and the all-browser run remain for the integration checkpoint below.

### Phase E — Follow-ups the product owner approved on 2026-11-23 (parallel)

- [x] **MCP-E1 Person revision on the identity answers.** `PersonIdentity`
      carries `updatedAt`, so `get_person` and `create_person` hand an agent the
      revision `update_person`, `archive_person`, `restore_person`, and
      `delete_person` require. A replayed keyed create answers the current
      revision, and the related-person create answers it too.
- [x] **MCP-E2 One lock order for a preference save.** A member's preference
      save holds the workspace row before it writes its preference row, the
      order every other write takes, so it cannot deadlock against a person
      restore refilling reminders. A PostgreSQL test reproduces the deadlock
      through the real routes: before the change the save answered 503 and
      PostgreSQL counted one deadlock.
- [x] **MCP-E3 Request tombstones (schema v16).** `crm.request_tombstones`,
      owned by `governance` and reached through the kernel's `RequestTombstones`
      port, records the id of a permanently deleted record that was created with
      a retry key. A keyed create of a journal post, note, activity, call,
      conversation, gift, debt, or recurring debt whose derived id has a
      tombstone answers 409 (`journal_request_deleted`,
      `interaction_request_deleted`, and the unchanged `gift_request_deleted`),
      and `gifts` no longer asks the audit history.
- [x] **MCP-E4 Object-storage client.** The backend's S3 client moved from the
      `minio` package to the official `@aws-sdk/client-s3` 3.1173.0, behind the
      unchanged `ObjectStorage` port. The `decode-uri-component` and
      `stream-json` advisories left with `minio`, no high advisory remains, and
      the audit gate carries no exception. The API and worker ignore the three
      environment names the SDK probes (`--ignore-env`) instead of being granted
      them.

### Phase F — Follow-ups the product owner approved on 2026-11-23 (parallel)

- [ ] **MCP-F1 Dependency advisories.** Raise the pinned versions that carry a
      reported advisory in both dependency trees: `hono` and `fast-xml-parser`
      in the Deno graph, and the web and tooling tree `pnpm audit` reports on
      (`astro`, `@astrojs/node`, `vite`, `vitest`, `happy-dom`, `shadcn`, and
      their transitive packages). The release-age rule and the frozen lockfiles
      stay as they are; an advisory no released version fixes is recorded, not
      hidden.
- [ ] **MCP-F2 One lock order for a workspace settings update.** A workspace
      settings update must not deadlock against the worker's reminder top-up.
      Reproduce it in PostgreSQL first, then fix the order.
- [ ] **MCP-F3 One lock order for a workspace reset and delete.** A workspace
      reset or delete must not deadlock against the worker's reminder top-up or
      against a write in the same workspace. Reproduce each cycle in PostgreSQL
      first, then fix the order.

## Delivered, and what is left

Delivered: every ticket of Part 4. Personal tokens reach the routes of Part 3
through the grant each descriptor names; the D lanes added the missing edits,
deletes, retry keys, and revision checks; `POST /api/v1/mcp` serves the tool
catalog filtered by the token's grants; the settings page offers grouped grants,
two presets, and the "Connect an AI agent" section; `/docs/mcp` documents the
endpoint; and flow `API-003` proves the whole path in a browser against the
production-like stack. The authorization matrix,
[backend architecture](../architecture/backend-architecture.md), and
[traceability](traceability.md) describe the result.

Open, each needing its own ticket or decision:

- **Dependency advisories below the gate.** `deps:audit:gate` passes with no
  exception. `deno audit` still reports seven `hono` advisories, each fixed by
  4.13.16, and one low `fast-xml-parser` advisory fixed by 5.12.0, which the DAV
  client imports directly. `pnpm audit` reports findings in the web and tooling
  tree that nothing gates on and nobody has triaged.
- **Keyed creates that still accept a replay.** A stay-in-touch cadence can be
  set again by its old `requestId` after it was deleted; the agent instructions
  say so. A workspace reset removes tombstones with the records, so a key may
  create its record again afterwards, as documented.
- **Gift attachments.** `createGift` and `updateGift` require an attachment to
  be an available, non-avatar file of the workspace, not of the gift's person.
- **Removed files keep their gift links.** `removePersonFile` deletes the bytes
  and the person link, but a gift keeps its `attachmentFileId` and a debt
  settlement reports its photo as unavailable.
- **Two more lock orders, read from the code and not reproduced (from MCP-E2).**
  A workspace settings update holds the admin's member row `for update` and then
  waits for `workspace_settings`, which the worker's reminder top-up holds
  `for share` while its inserts need `for key share` on member rows; taking the
  member row `for no key update`, as the locked revalidation does, would likely
  remove it. A workspace reset holds the actor's member row the same way while
  its cascade waits on preference rows the worker holds; it is owner-only and
  has no small fix.
- **A role change during a save.** A preference save now revalidates the actor
  like every other write, so a save made in the moments after the member's role
  changed is refused instead of accepted.
- **A short reminder window.** The top-up no longer counts cancelled rows ahead
  and revives only a cancelled row that was never attempted. A cancelled row
  that had already been attempted keeps its date, so that date is neither
  counted nor minted again and the member's window stays one date short until it
  passes.
- **Who issues tokens: decided on 2026-11-23.** Only owners and admins issue
  personal tokens for now. `api-tokens.manage` keeps its roles and no code
  changes; member-issued tokens would need a new decision.
- **Product decisions not taken.** OAuth for MCP clients that cannot send a
  static bearer header (ADR 0009), and per-token rate limits beyond the
  gateway's per-address limits.
- **Integration checkpoint, run on 2026-11-22 at `ea12b2a6`.** `check`, `lint`,
  `check:architecture`, `contracts:check`, every unit set, the web suite, and
  `build` pass. Every PostgreSQL integration suite passes (487 tests). Full
  `test:coverage` passes every threshold when run with the native Deno
  executable; through the npm shim the largest set still exceeds the Windows
  command length (REL-105). The whole browser suite in Chromium passes 89 of 91
  with one skipped; the one failure is `IMPORT-002`'s status assertion matching
  two elements, already tracked as REL-108 and untouched by this work.
- **Integration checkpoint for Phase E, run on 2026-11-23 at `a9a0fcc5`.**
  `check`, `lint`, `check:architecture`, `contracts:check`, the frozen install,
  and `deps:audit:gate` pass. The schema harness passes on PostgreSQL 18.4 and
  17.10, including the v15-to-v16 upgrade. Every PostgreSQL integration suite
  passes (496 tests), and full `test:coverage` passes every threshold with the
  web suite at 1,906 tests. `build` passes 34 of 34. The whole browser suite in
  Chromium passes 89 of 91 with one skipped and the same `IMPORT-002` failure
  (REL-108). The first coverage run caught one failure from this phase: the
  agent instructions had grown past their 150-word limit, fixed in `a9a0fcc5`.
  Still to run at release: the all-browser E2E matrix.

## Part 5 — Acceptance

- An agent holding a token can list only the tools its scopes allow, and every
  call is refused or admitted by the same route a REST client would reach.
- For each newly enabled route: a missing scope, a different scope, a revoked or
  expired token, a foreign workspace, and a foreign child id are refused, and a
  present invalid bearer never borrows cookie authority.
- Every audit event written by a token request names the token.
- The external OpenAPI document, the tool catalog, and the enforcement are all
  derived from the route registry; `contracts:check` fails when they drift.
- Production code keeps the 80% line, branch, and function floors.
