# Frontend to backend request waterfall and loading priorities

Audit agent 1 of 5 (finding prefix `FEQ`), 2026-11-07, worktree
`t3/backend-security-performance-audit`.

**Scope.** Every implemented authenticated page of
`docs/product/page-catalog.yaml` (Today, People directory, archived people,
create person, the person workspace with its audit and activity-report pages,
Journal and a journal item, Tasks, all 17 settings pages including the import
report) plus the shared shell surfaces (header search palette, notification
bell, quick capture, session gate). For each: the `/api/v1/*` requests made on
open, their count, duplicates, sequential chains, eager loads, polling, what
repeats on every navigation, and the interaction costs of the palette, bell,
quick capture, adding a note and paginating the directory. It also compares the
result with the August review (`docs/validation/ux-design-review-2026-08-29.md`,
sections 3.5 and 9) and the IA rule "load the identity summary first, lazy-load
history" (`docs/product/information-architecture.md:171`). **Not covered:** SQL
and index efficiency (agent 2), security (agents 3 and 4), SSG/SSR/hydration
strategy and JS bundle size (agent 5); things seen in passing are listed under
"Observations for other areas".

**Short answer to "are we fetching the data the optimal way?"** No. The page
data requests are mostly well formed (parallel, small, lazily activated below
the fold). The waste is in the shell and in how requests are scheduled:

- 71 percent of all API requests of a cold page load across 28 pages are shell
  overhead (session, preferences, notifications); 47 percent are the single URL
  `GET /api/v1/settings/preferences`, fetched 3 to 7 times per page.
- Chromium serializes identical concurrent GETs to a non-cacheable URL, so each
  duplicate adds a full round trip to the last one. A one-line client change
  (`cache: "no-store"`) cuts repeat-visit time to content by about 40 to 47
  percent; removing the duplicates altogether (preferences with the session)
  cuts it by 55 to 63 percent (measured through a patching proxy, no repository
  change).
- The person workspace still opens with 25 requests (19 on a phone-size
  viewport, 28 on a large one); a person with no data still costs 19.
- Nothing is cacheable (`private, no-store`, no validators), every navigation is
  a full document load, and the gateway's TLS listener speaks HTTP/1.1 only.

## Method

**Read.** Paths starting `features/`, `islands/`, `lib/` or `layouts/` are
relative to `apps/web/src/`. `islands/core/api.ts`, `lib/workspace-context.ts`,
`lib/time-presentation.ts`, `layouts/ApplicationLayout.astro`,
`features/shell/*`, `islands/global-people-search/*`,
`features/interactions/quick-capture.tsx`, `features/today/*`,
`features/people/directory/*`, `features/people/duplicates/*`,
`features/person/*` (workspace orchestration, section registry, facts,
relationships, reminders, communications, interactions), `features/tasks/*`,
`features/settings/shared/*`, `packages/contracts/client/*` (`request.ts`,
`people.ts`, `settings.ts`), the session handler
(`packages/backend/modules/workspaces/transport/http/authentication.ts`), the
read-model boundaries (`docs/architecture/module-boundaries.yaml:418`), the
person-profile and today read models, `gateway/nginx.conf`.

**Stack.** The shared production-built Compose stack `kinship-audit` behind the
gateway at `https://127.0.0.1:18443` (APP_ENV=test), Chromium from Playwright
1.62.1 (`chromium-1234`, headless, `ignoreHTTPSErrors`), desktop viewport
1280x900 unless stated.

**Dataset (owner account `audit-feq-1@example.test`).** 121 active and 6
archived people (70 tagged, 8 starred, 20 with a stored avatar image added late
in the run), a "rich" person (Margaret Hollingsworth: 4 contact methods, 2
addresses, first meeting, 2 jobs, food preferences, 2 pets, 3 tags, 4
relationships, 3 important dates, 4 life events, 8 notes, 7 activities, 3 calls,
2 conversations, 3 reminders plus a stay-in-touch cadence, 5 tasks, 3 gifts, 2
debts, a photo and a document), a blank person (no data), 8 tasks, 6 journal
posts, an imported batch with a report, an export, and notifications. Seeded
through the public API (`seed*.ts` in the reproduction section).

**Capture.** Playwright plus the DevTools protocol (`Network.requestWillBeSent`,
`responseReceived`, `loadingFinished`) for every request: start and end time,
status, encoded bytes, response `Cache-Control`/`ETag`, protocol, queueing, and
the initiating script chunk. "First content" times come from an in-page
`MutationObserver` (person name text replaced, Today attention state not
"Loading", first directory row, task state not "Loading", ...). Definitions used
below:

- _API request_: any `/api/v1/*` request (including avatar content URLs, which
  are called out separately where they matter).
- _Shell overhead_: `GET /session`, `GET /settings/preferences`,
  `GET /notifications`.
- _Sequential depth_: the longest chain in which each request starts after the
  previous one finished. It is an observed upper bound; the code-read dependency
  chains in the findings are the authoritative ones.
- _Load modes_: **cold** = empty browser cache and empty `sessionStorage`;
  **warm** = same tab after one Today load (session cache and shell chunks
  cached, the destination page's own chunks not); **hot** = repeat visit (page
  primed, left via Settings, revisited within the 60 s session cache TTL). Hot
  is the steady state of a returning user.
- _Latency_: unthrottled loopback (server times 8 to 25 ms per request) and
  `Network.emulateNetworkConditions` with 100 ms added latency, which is a
  "typical broadband to a hosted instance" case; the August review assumed 150
  ms.

**Fix simulations.** Candidate fixes were measured without touching the
repository: a local reverse proxy in front of the gateway rewrote the built
`request.*.js` and `settings.*.js` chunks (single-flight GET, a `no-store` fetch
option, preferences answered without a request) and optionally terminated TLS
with HTTP/2. Medians of 3 runs; counts are deterministic, times vary about 5
percent.

## Summary

| ID     | Severity | Title                                                                          | Status                       |
| ------ | -------- | ------------------------------------------------------------------------------ | ---------------------------- |
| FEQ-01 | High     | Duplicate identical GETs (preferences 3 to 7 per page), serialized by Chromium | Verified (dynamic)           |
| FEQ-02 | Medium   | Critical path chains session -> preferences -> data                            | Verified (dynamic)           |
| FEQ-03 | Medium   | Session cache bypassed by late islands: second blocking `/session`             | Verified (dynamic)           |
| FEQ-04 | Medium   | Person workspace opens with 19 to 25 requests; empty sections still fetched    | Verified (dynamic)           |
| FEQ-05 | Medium   | Search palette N+1 on the empty query (9 requests), no reuse or cancel         | Verified (dynamic)           |
| FEQ-06 | Medium   | Tasks page: three serial steps and a 14 KB people prefetch                     | Verified (dynamic)           |
| FEQ-07 | Medium   | Gateway TLS listener is HTTP/1.1 only (production edge unverified)             | Verified (dynamic)           |
| FEQ-08 | Low      | No HTTP caching or validators, even for immutable avatar content               | Verified (dynamic)           |
| FEQ-09 | Low      | No priority tiers: non-critical shell reads compete with page data             | Verified (static, code read) |
| FEQ-10 | Low      | A write triggers wider re-reads than needed (a note: 1 POST + 3 GETs)          | Verified (dynamic)           |
| FEQ-11 | Low      | Secondary reads at page open (duplicates, tag options, lifecycle preview)      | Verified (dynamic)           |
| FEQ-12 | Low      | JSON API responses are not compressed (about 70 percent available)             | Verified (dynamic)           |
| FEQ-13 | Info     | No request-budget regression guard; PERF-001 checks time only                  | Verified (static, code read) |

No Critical finding. The idle polling (one request per minute per tab) and the
August fixes listed below are sound.

## Measurements

### M1. Requests per page on open (cold, unthrottled)

"Shell" = session + preferences + notifications. "Page reads" = everything else,
including the person page's `POST /view`. Warm counts include the late second
`/session` read (FEQ-03); hot counts equal cold. In the timing table that
follows, "first content" is the person name (person), the Today attention list
(Today), the first row (directory), the task state (tasks), the journal state
(journal).

| Page                              | cold | unique | prefs | shell | page reads | warm | hot |
| --------------------------------- | ---: | -----: | ----: | ----: | ---------: | ---: | --: |
| `/app` (Today)                    |   14 |      8 |     7 |     9 |          5 |   14 |  14 |
| `/app/people`                     |   11 |      7 |     5 |     7 |          4 |   12 |  11 |
| `/app/people/archived`            |    9 |      6 |     4 |     6 |          3 |   10 |   - |
| `/app/people/new`                 |    5 |      3 |     3 |     5 |          0 |    5 |   - |
| `/app/people/:id` rich            |   25 |     22 |     4 |     6 |         19 |   25 |  25 |
| `/app/people/:id` blank           |   19 |     16 |     4 |     6 |         13 |   19 |  19 |
| `/app/people/:id/audit`           |    7 |      4 |     4 |     6 |          1 |    7 |   - |
| `/app/people/:id/activity-report` |    7 |      4 |     4 |     6 |          1 |    7 |   - |
| `/app/journal`                    |    7 |      4 |     4 |     6 |          1 |    7 |   7 |
| `/app/journal/:id`                |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/tasks`                      |    8 |      5 |     4 |     6 |          2 |    9 |   8 |
| `/app/settings` index             |    5 |      3 |     3 |     5 |          0 |    5 |   - |
| `/app/settings/*` (16 more)       |  5-8 |    3-5 |   3-5 |   5-7 |        0-2 |  5-9 | 6-8 |

Time to first content and to the last API response, in ms at 100 ms latency
(cold / warm / hot):

| Page                           | first content     | last API response             |
| ------------------------------ | ----------------- | ----------------------------- |
| `/app` (attention list)        | 1382 / 570 / 593  | 1795 / 891 / 910              |
| `/app/people` (first row)      | 1660 / 961 / 696  | 1754 / 1064 / 802             |
| `/app/people/archived`         | 1471 / 839 / -    | 1463 / 826 / -                |
| `/app/people/:id` rich (name)  | 1523 / 825 / 709  | 2400 / 1702 / 1066            |
| `/app/people/:id` blank (name) | 1544 / 819 / 705  | 2197 / 1484 / 973             |
| `/app/journal` (state)         | 1379 / 592 / 575  | 1474 / 588 / 564              |
| `/app/tasks` (state)           | 1728 / 1083 / 812 | 1718 / 1069 / 808             |
| `/app/settings/*` (data)       | not marked        | 1355-1649 / 460-952 / 458-817 |

Totals over the 28 pages (full per-page table in Appendix A): cold **230** API
requests, of which session 28, **preferences 107 (47 percent)**, notifications
28, page reads 67; warm at 100 ms adds 26 more `/session` reads (256 total).
Aggregate API response bytes including headers: 509 KB.

Shell overhead alone (a page with no data of its own such as `/app/people/new`,
`/app/settings`, `/app/settings/import/new`) is **5 requests**: 1 session, 3
preferences, 1 notifications.

### M2. A click path in one tab (Today, People, a person, Tasks, Journal, Today)

80 API requests: **31 preferences reads**, 7 session, 6 notifications, 36 page
reads. Every link is a full document load (no `ClientRouter`, no prefetch,
`apps/web/astro.config.mjs`), so all shell reads repeat on every navigation and
none of them is cacheable (FEQ-08).

### M3. The person workspace, rich person (cold, unthrottled)

- **Shell, 6:** session, preferences x4, notifications.
- **Hero, 1:** `GET /people/:id?include=summary` (identity, due information,
  `sectionCounts`, `relationshipCounts`, tags, primary contact method).
- **Rail, eager, 11:** the seven profile facts (contact-methods, addresses,
  first-meeting, work, food-preferences, pets, tags), relationship-types plus
  relationships, important dates, reminders.
- **Timeline zone, in view, 6:** timeline, activity-report (activity),
  activity-report (note), life-events, communications, communication-options.
- **Recording the view, 1:** `POST /people/:id/view` at idle.
- **Initial at 1280x900: 25** requests, 22 unique URLs.
- **Lazy zones, on scroll, 4:** tasks, files, gifts, audit?limit=3.
- **Whole page: 29.**

The initial count depends on the viewport because the four zones activate by
`IntersectionObserver` with a 400 px margin: 19 at 390x844 (the timeline waits
for a scroll, 10 more then load), 25 at 1280x900, 28 at 1920x1400 (plus tasks,
gifts and files). The blank person costs 19: the same shell (6), hero (1), view
(1) and all 11 rail reads (ten return empty lists, the eleventh is the
relationship-types vocabulary), while the first-run card hides the zones.

Sequential chain before the name paints (100 ms latency, from the traces):

- cold: document -> scripts (about 900 ms until the first API call) ->
  `GET /session` (120) -> `GET /settings/preferences` (370, queued behind three
  identical reads) -> `GET /people/:id?include=summary` (110) -> name at 1523.
- hot: `GET /settings/preferences` (122 -> 562, the fourth of four identical
  reads, completions at 240/348/456/562) -> person (562 -> 684) -> name at 709.

### M4. Interaction costs (warm start, unthrottled)

- Palette, Ctrl+K with an empty query: **9 requests** (`today/recent-people`,
  then 8 x `GET /people/:id?include=summary`); 835 ms to the first row at 100 ms
  on HTTP/1.1, 330 ms over HTTP/2. Clearing the field again: 9 more.
- Palette, typing "hollingsw": **1** request at 50 ms per character (the 200 ms
  debounce coalesces), **9** at 260 ms per character (one per character).
- Notification bell, opening the panel: **1** request (it re-reads the list it
  already shows). Idle: 1 per 60 s (3 in 200 s on a parked Today tab).
- Quick capture, first open: **2** (`GET /people?limit=20&starredFirst`,
  `GET /interaction-options`); second open: **0**.
- Add a note on a person: opening the dialog **2** (the same two reads, with the
  person pinned); Save **1 POST + 3 GET** (activity-report for activity and for
  note, and timeline).
- Directory: reaching the end of a page of 20 rows **1** (infinite-scroll
  observer, 160 px margin); search "ma" + Enter **1**.
- Directory with 20 stored avatars: **+20 image requests** on load and **+20**
  on reload (`GET /people/:id/files/:fileId/content`, `no-store`).

### M5. What the fixes buy (hot repeat visit, 100 ms latency, median of 3)

"Attention/all" is Today's attention list and its last section; "name/settled"
is the person's name and the workspace settling. Requests are in parentheses
(the directory counts exclude the 20 avatar images).

| Variant                                     | Today attention / all | Person name / settled | Directory first row | Tasks   | Journal |
| ------------------------------------------- | --------------------- | --------------------- | ------------------- | ------- | ------- |
| Baseline (HTTP/1.1, today's client)         | 584 / 906 (14)        | 719 / 1091 (25)       | 692 (11)            | 836 (8) | 584 (7) |
| `cache: "no-store"` on API fetches (1 line) | 357 / 478 (14)        | 393 / 766 (25)        | 377 (11)            | 507 (8) | 355 (7) |
| Single-flight identical GETs                | 265 / 380 (8)         | 379 / 757 (22)        | 367 (7)             | 496 (5) | 265 (4) |
| Preferences answered without a request      | 257 / 372 (7)         | 269 / 616 (21)        | 271 (6)             | 379 (4) | 249 (3) |
| HTTP/2 only (baseline client)               | 580 / 913 (14)        | 707 / 874 (25)        | 691 (11)            | 831 (8) | 574 (7) |
| Single-flight + HTTP/2                      | 256 / 263 (8)         | 376 / 531 (22)        | 353 (7)             | 495 (5) | 263 (4) |
| Preferences without a request + HTTP/2      | 258 / 267 (7)         | 256 / 436 (21)        | 269 (6)             | 384 (4) | 255 (3) |

Cold first visit (empty cache, 100 ms; first API call at about 900 ms on
HTTP/1.1 and 490 ms on HTTP/2):

| Variant                                | Today attention / all | Person name / settled | Directory first row |
| -------------------------------------- | --------------------- | --------------------- | ------------------- |
| Baseline                               | 1384 / 1700           | 1540 / 2421           | 1640                |
| Single-flight                          | 1158 / 1268           | 1323 / 2207           | 1532                |
| HTTP/2 only                            | 964 / 1278            | 1080 / 1360           | 1170                |
| Single-flight + HTTP/2                 | 743 / 743             | 880 / 1163            | 970                 |
| Preferences without a request + HTTP/2 | 742 / 742             | 758 / 1037            | 882                 |

## August 2026 review: what is fixed, what remains, what is new

- **"About 25 to 26 requests per person page".** Unchanged: 25 at 1280x900 (19
  on a phone, 28 on a large screen, 29 for the whole page). The per-section
  fan-out is gone, but shell overhead grew from 1 to 6 requests.
- **"Three sequential round trips before the name paints".** Changed shape, same
  depth: session (now cached) -> preferences -> person
  (`features/person/workspace.ts:949-975`). Hot: 2 steps (3 to 4 effective
  because of FEQ-01); cold: 3.
- **"Duplicate contact-methods fetch".** Fixed.
  `features/person/communications/communications.tsx:197-201` loads contacts
  only when the conversation editor opens; contact-methods appears once.
- **"No session cache across navigations".** Partly fixed. A `sessionStorage`
  stale-while-revalidate cache with a 60 s TTL exists
  (`lib/workspace-context.ts:10,253-274`), but every navigation still reads
  `/session` once and late islands trigger a second blocking read (FEQ-03).
- **"Quick capture prefetches people and options on every page".** Fixed.
  Options load on first open (2 requests), none afterwards
  (`features/interactions/quick-capture.tsx:236-290`). It still reads session
  and preferences at mount.
- **"Gifts prefetches people (limit 50) and files".** Fixed. Gifts sits in the
  lazy Things zone and reads `gifts` only. Analogues remain: the tasks people
  list (FEQ-06) and editor vocabularies (FEQ-04).
- **"20 of 23 requests below the fold; IA rule broken".** Mostly fixed. Zones
  activate on visibility (`features/person/workspace.ts:318-346`) and
  `POST /view` is deferred to idle (`:378-390`): 4 of 29 requests wait on a
  laptop screen. Five timeline-zone reads and two vocabularies are still eager
  (FEQ-04).
- **"Stage 2: one summary request with counts".** Implemented, not used.
  `?include=summary` returns `sectionCounts` and `relationshipCounts`, but the
  lists are fetched whatever the count.
- **"Skeletons, announcements".** Fixed (skeleton shell, live regions promoted
  after settle, `features/person/workspace.ts:355-364`); not a request matter.
- **"Other pages are light: directory 2, journal 1, tasks 3, settings 1".** Now
  heavier: directory 4 reads (plus duplicates), tasks 2 reads in a serial chain,
  and every page adds 5 to 9 shell reads.

New since August: the multiplied preferences reads and their serialization
(FEQ-01), the preferences hop in front of every critical read (FEQ-02), the
palette's N+1 (FEQ-05), the tasks people prefetch (FEQ-06), HTTP/1.1 as measured
(FEQ-07).

## Findings

### FEQ-01 Identical concurrent GETs are duplicated and then serialized

- **Severity:** High
- **Status:** Verified (dynamic), cause Verified (static, code read)
- **Where:** `apps/web/src/lib/time-presentation.ts:8-14` (`loadTimePreferences`
  has no memo) called from every island:
  `features/shell/application-shell/application-shell.ts:311-328`,
  `islands/global-people-search/global-people-search.tsx:360`,
  `features/interactions/quick-capture.tsx:190`,
  `features/today/attention/today-attention.tsx:85`,
  `features/today/reminders/today-reminders.tsx:55`,
  `features/today/interactions/today-interactions.tsx:152`,
  `features/people/directory/people-directory.tsx:143`,
  `features/people/duplicates/people-duplicates.tsx:95`,
  `features/person/workspace.ts:969`, `features/tasks/task-surface.tsx:185`,
  `features/settings/shared/context.ts:34` and the settings pages;
  `packages/contracts/client/request.ts:25-37` (one `fetch`, no `cache` option,
  no single-flight); every API GET answers `Cache-Control: private, no-store`.
- **What happens.** Each island that formats a time or needs the member's name
  order reads `GET /api/v1/settings/preferences` itself. The shell alone reads
  it three times (layout width, palette, quick capture) before any page island
  runs; Today reaches 7. Across the 28-page suite, 107 of 230 requests (47
  percent) are this URL. Worse, in Chromium concurrent requests for the same
  non-cacheable URL queue behind one another in the HTTP cache transaction, so
  the n-th duplicate completes n round trips after the first, and an island
  whose first paint waits for its own preferences read (person workspace,
  directory, tasks, every Today section) waits behind its siblings.
- **Evidence.**
  - Microbenchmark (reproduction), 6 concurrent GETs to one URL at 100 ms
    latency, completion times in ms:

    ```text
    same URL, default cache mode   113 222 327 435 541 662   (serialized)
    6 different URLs (?i=n)        122 123 123 123 123 123   (parallel)
    same URL, cache: "no-store"    109 110 110 110 110 110   (parallel)
    same URL, cache: "reload"      109 109 109 109 109 109   (parallel)
    ```

    Unthrottled, 12 same-URL GETs finish at 17..176 ms (14 ms apart) against
    16..56 ms for 12 different URLs. Firefox pays one extra round trip (30 ms,
    then all at about 80 ms); WebKit behaves like different URLs. It is Chromium
    behaviour, which is most users.
  - Hot person trace (100 ms): four preferences reads issued within 13 ms of
    each other complete at 240, 348, 456 and 562 ms; the workspace's own read is
    the last, and `GET /people/:id?include=summary` only starts at 562 ms.
    Today: seven completions at 243, 351, 473, 582, 693, 802, 910 ms; its
    sections render at 593 and 926 ms although their data arrived at 244 to 351
    ms.
  - Fix simulation (M5): single-flight takes Today's last section from 906 to
    380 ms (-58 percent), the person name from 719 to 379 (-47), the directory
    from 692 to 367 (-47), tasks from 836 to 496 (-41), journal from 584 to 265
    (-55). Requests: Today 14 to 8, person 25 to 22, directory 11 to 7, tasks 8
    to 5, journal 7 to 4; the click path would drop from 80 to about 55 (one
    preferences read per page instead of 31). `cache: "no-store"` alone gives
    most of the time (357/478, 393/766, 377, 507, 355) without removing any
    request.
- **Impact.** Every authenticated page; the dominant, fixable part of the
  latency of a repeat visit.
- **Recommendation.**
  1. Immediately, in `packages/contracts/client/request.ts` (hand-written source
     of the generated client): pass `cache: "no-store"` to `fetch`. The API
     already forbids caching these responses, so the HTTP cache cannot help and
     its lock is pure cost.
  2. In the same function, share one in-flight promise between identical
     concurrent GETs (key: path, query and `X-Workspace-Id`), returning a
     `structuredClone` to each caller. Roughly 10 lines; removes the whole
     duplicate class for current and future islands. RED test: two concurrent
     `getMemberPreferences()` calls produce one `fetch`.
  3. Then remove the reads themselves (FEQ-02, recommendation 1): the
     preferences are session-scoped data the shell needs on every page.
- **Expected effect.** Preferences reads across the 28-page suite fall from 107
  to 28 at step 2 (one per page) or to 0 at step 3, which removes 47 percent of
  all API requests of the suite; 25 of the 31 preferences reads of the click
  path go at step 2. Times are in M5.

### FEQ-02 Critical-path chains `session -> preferences -> data`

- **Severity:** Medium
- **Status:** Verified (dynamic + code read)
- **Where:** `features/person/workspace.ts:949-975`
  (`await resolveWorkspaceSession`, then `await getMemberPreferences`, then
  `await getPerson`), `features/people/directory/people-directory.tsx:139-151`
  (`readContext`), `features/tasks/task-surface.tsx:176-212`,
  `features/people/duplicates/people-duplicates.tsx:88-96`,
  `features/settings/shared/context.ts:20-37` (`timePreferences: true` on
  api-access, exports, imports, integrations).
- **What happens.** The preferences supply only formatting inputs (locale, time
  zone, name order, default sort), yet the pages request their own data only
  after the preferences arrive. The person's name therefore waits for a
  preferences round trip it does not need; the directory waits only to learn the
  default sort; duplicates is `session -> prefs -> duplicates`; the five
  settings pages with time formatting are `session -> prefs -> read`.
- **Evidence.** Cold 100 ms person trace: `/session` 916 to 1036, preferences to
  1405, person 1405 to 1514, name 1526. Hot: preferences 122 to 562, person 562
  to 684, name 709. Embedding the preferences (M5, no request at all) moves the
  hot person name from 379 (single-flight) to 269 ms, the hot directory first
  row from 367 to 271, tasks from 496 to 379.
- **Impact.** One round trip (100 ms at 100 ms latency) on the name, the first
  directory row, the first task row and five settings pages, on top of FEQ-01.
- **Recommendation.**
  1. Carry the resolved member preferences in `GET /api/v1/session`. The handler
     (`packages/backend/modules/workspaces/transport/http/authentication.ts:469-509`)
     already merges `uiState` from the same module; preferences live in
     `packages/backend/modules/workspaces/transport/http/settings/preferences.ts`,
     so no module boundary is crossed. Leave `supportedCurrencyCodes` out (only
     the preferences form needs it, so keep `GET /settings/preferences` for that
     page). Store them in the existing `kinship.session` entry and update it
     after `updateMemberPreferences`, as `updateCachedSessionUiState` does for
     the UI state.
  2. `loadTimePreferences`, the shell layout read, the palette and quick-capture
     contexts and the directory read all take the value from
     `resolveWorkspaceSession()`; no island needs its own read.
  3. Where a read must stay separate, issue it with `Promise.all` next to the
     page read instead of before it (`features/person/workspace.ts:969` and
     `:974`).
- **Expected effect.** Shell overhead of 5 to 9 requests becomes 2 (session,
  notifications); Today 14 to 7, tasks 8 to 4, journal 7 to 3, person 25 to 21
  (measured with the preferences simulation, M5); hot time to content -55 to -63
  percent.

### FEQ-03 The session cache is bypassed by late islands

- **Severity:** Medium
- **Status:** Verified (dynamic + code read)
- **Where:** `apps/web/src/lib/workspace-context.ts:253-274`
  (`resolveWorkspaceSession`), the comment at `:39-44`; late callers:
  `features/people/directory/people-directory.tsx:140`,
  `features/tasks/task-surface.tsx:176-180`,
  `features/settings/shared/context.ts:25`, `features/person/workspace.ts:949`.
- **What happens.** The cache serves a session only while the background
  revalidation is in flight (`activeRevalidation && optimisticSession`). After
  it settles, the next caller starts a real `GET /session` and awaits it ("later
  resolutions in a long-lived document make a real round trip"). Pages are
  short-lived documents with code-split islands: any island whose chunk arrives
  after the first revalidation finishes pays a blocking second round trip.
- **Evidence.** Warm load at 100 ms: 26 of 28 pages issue two `/session` reads
  (54 session reads in total against 28 cold). Initiators of the second read:
  `people-directory`, `task-surface`, `settings-form`/`context`,
  `person-profile-shell` chunks, starting at 340 to 590 ms after the first one
  completed at about 230 ms; the person name is 825 ms warm against 709 hot.
  Cold people page at 100 ms also shows two. Hot visits (chunks cached, caller
  inside the window) show one.
- **Impact.** One extra request and one blocking round trip on the first visit
  of each page type after a deploy or cache clear, which defeats the August
  "session cache" fix exactly when it should help.
- **Recommendation.** Keep the last resolved (or revalidated) session in module
  memory for the same TTL and hand it to every later caller of the document;
  only `clearSessionCache`, a workspace switch or a new document reads the
  network. About 10 lines in `workspace-context.ts`; the existing
  `onSessionRevalidated` path already publishes changes. Saves 1 request per
  affected page and the blocking round trip.

### FEQ-04 Person workspace: 19 to 25 requests on open

- **Severity:** Medium
- **Status:** Verified (dynamic + code read)
- **Where:** `features/person/workspace.ts:1019-1050` (rail owners mounted
  eagerly), `:318-346` (zone-level activation), `:127-142`
  (`shouldShowPersonFirstRun` already reads the counts),
  `features/person/facts/mount.tsx:51-53` (counts only feed a chip),
  `features/person/relationships/person-relationships.tsx:206-216`
  (`relationship-types` with the list),
  `features/person/communications/communications.tsx:130-137`
  (`communication-options` with the history).
- **What happens.** See M3. The hero read already returns `sectionCounts` and
  `relationshipCounts` for 14 sections, yet each section reads its list
  regardless. A blank person pays 11 rail reads, ten of which return an empty
  list. A rich person pays 11 rail requests plus 6 timeline-zone requests at
  first paint at laptop size, although the five cards below the unified timeline
  are out of view; the zone, not the card, is the unit of activation. Two
  requests are editor vocabularies (`relationship-types` 3.5 KB,
  `communication-options` 1.4 KB) needed only when an editor opens; the fact
  sections already do this right (`includeOptions` only when the editor opens,
  `features/person/facts/lookup.ts:105-110`).
- **Evidence.** M3 and the blank-person trace (19 requests, 10 of them empty
  lists of 1.0 to 1.3 KB each, mostly headers). Whole page 29 at every viewport.
- **Impact.** The canonical workspace page is the heaviest page by 2 to 3 times;
  most CRM people are sparsely filled, so the common case is the wasteful one.
  At 100 ms hot the fan-out also stretches "settled" to 1091 ms (874 over
  HTTP/2).
- **Recommendation** (in order of effort):
  1. Skip a list read when the summary says the count is 0 and render the
     existing empty state with its Add control (contact-methods, addresses,
     first-meeting, work, food-preferences, pets, tags, relationships, notes,
     activities, calls, conversations, life-events; important dates, reminders,
     gifts, debts and files have no count by design,
     `features/person/workspace.ts:133-135`). The first write reads the list.
     Blank person: 19 to 10 together with step 2.
  2. Load editor vocabularies when the editor opens (`relationship-types`,
     `communication-options`): -2 requests and -4.9 KB on every person page.
  3. Activate the timeline zone's cards individually (an `IntersectionObserver`
     per card with the existing 400 px margin): at laptop size 5 reads wait
     until the reader scrolls.
  4. Compose the rail server-side: a read-only `include=rail` (or
     `GET /people/:id/rail`) answer from the `person-profile` read model, which
     already lists `people`, `relationships` and `planning` among its source
     modules (`docs/architecture/module-boundaries.yaml:418-433`) and which the
     islands already accept as `SectionProps.initial`. It returns the first page
     of the 7 fact sections, relationships, important dates and reminders with a
     per-section `status` (`ready`, `unavailable`, `hidden`, as the search read
     model does with `unavailable` per group) so a failed section still does not
     blank the profile. Mutations, "load more" and refresh keep calling the
     owning module's endpoints. 11 requests become 1.
- **Expected effect** (estimates by counting; none of these steps was built):
  the rich person at laptop size opens with 5 requests (session, notifications,
  person plus rail, timeline, view) and costs 13 for a full scroll instead of 25
  initially and 29 in total; the blank person drops from 19 to 10 with steps 1
  and 2 alone, and to 4 with preferences in the session and a composed rail.

### FEQ-05 Search palette: N+1 on the empty query, no reuse, no cancellation

- **Severity:** Medium
- **Status:** Verified (dynamic + code read)
- **Where:** `islands/global-people-search/global-people-search.tsx:121-155`
  (`recentAnswer`), `:439-460` (effect and `SEARCH_DEBOUNCE_MS = 200` at `:83`),
  `:351-382` (context load at mount), `islands/core/api.ts:15-17` (the generated
  client takes no `AbortSignal`).
- **What happens.** With nothing typed, the palette reads
  `GET /today/recent-people` (id, archived flag, name) and then
  `GET /people/:id?include=summary` for each of up to 8 recent people, only to
  obtain an avatar and the name parts for the member's name order. Every open
  and every clearing of the field repeats all 9. A search answers all five
  groups in one request (sound), but a query typed slower than the debounce
  fires one request per character, and an abandoned request cannot be cancelled,
  so the server still does the work.
- **Evidence.** M4: 9 requests per empty open; 834 to 860 ms to the first row at
  100 ms on HTTP/1.1 (330 ms over HTTP/2) against 126 to 132 ms unthrottled; 9
  searches for 9 characters at 260 ms per character.
- **Impact.** The palette is the primary navigation aid; its first impression is
  the slowest interaction measured, and it burns 9 of the gateway's per-IP
  tokens each time.
- **Recommendation.** Answer the empty query from the `search` read model in one
  request: it already returns people with `avatar` and name parts and its
  boundary already lists `files` and `people`
  (`docs/architecture/module-boundaries.yaml:479-488`), so a recent-people group
  (or `q` empty) needs no new dependency; the alternative is to add `avatar` and
  the name parts to `TodayRecentPerson`, which needs `files` added to the
  `today` allowlist. 9 requests become 1. Keep the last recent answer in memory
  for the document (the list changes only when the member views a person).
  Thread an optional `signal` through the generated functions so a superseded
  search is cancelled, and raise the debounce to about 300 ms.

### FEQ-06 Tasks page: three serial steps before the list

- **Severity:** Medium
- **Status:** Verified (dynamic + code read)
- **Where:** `features/tasks/task-surface.tsx:176-212` (`start`): session, then
  `loadTimePreferences`, then `listPeople({ limit: 50 })` (14.2 KB), then
  `load(true)` for the tasks.
- **What happens.** The task list read is the last of four serial steps; the
  50-person list only fills the "Person" filter `<select>`.
- **Evidence.** Hot 100 ms trace: preferences to 562, people 565 to 687, tasks
  687 to 808; first content 812 ms. With preferences embedded (M5) the page is 4
  requests and 379 ms, still waiting for the people read; moving that read out
  would let the task list start at about 120 ms (estimate: first content near
  240 ms).
- **Impact.** The most task-centric page is the slowest data page (812 hot, 1728
  cold at 100 ms) for a control most visits never touch; 14 KB moves on every
  open.
- **Recommendation.** Start `listTasks` as soon as the session is known and
  fetch the filter's people only when the select is focused or opened (it
  already has a "Load more people" button, `:257-262,588-592`); the first page
  can be requested after the list has painted. Tasks 8 to 3 requests (with
  FEQ-02), first content about 240 ms hot (estimate; 379 ms measured with the
  preferences change alone, M5).

### FEQ-07 Gateway TLS listener is HTTP/1.1 only

- **Severity:** Medium (production-edge impact unverified)
- **Status:** Verified (dynamic) for the Compose gateway; Suspected (needs
  confirmation) for the Dokploy edge
- **Where:** `gateway/nginx.conf:95-96` (`listen 8443 ssl;` without `http2`),
  `:76-80` (gzip only for CSS and JS types),
  `docs/architecture/compose-contract.md:54` (Dokploy terminates TLS at the
  gateway's private HTTP port, so the browser-facing protocol there is the
  edge's).
- **What happens.** 99 of the 100 requests of a cold person page load use
  `http/1.1` (the 100th is a `data:` URI). Chromium opens at most 6 connections
  per origin, so a burst of 31 module scripts requested within 2 ms, then 25 API
  requests, then lazily imported chunks, completes in waves one round trip apart
  (script completions at +110, +154, +216, +278, +323, +400, +431, +522, +539,
  +646 ms after a 248 ms start). Every response also repeats about 990 bytes of
  security headers uncompressed (24 responses: 23.8 KB of headers against 57.8
  KB of bodies).
- **Evidence.** Cold 100 ms (proxy simulation, TLS terminated with HTTP/2 in
  front of the same gateway): first API call at 490 ms instead of 900; Today
  attention 964 instead of 1384, person name 1080 instead of 1540, directory
  1170 instead of 1640; hot "settled" for the person page 874 instead of 1091.
  Hot Today, directory, tasks and journal do not change (fewer than 6 parallel
  requests). The palette's 9 reads reach the first row at 330 ms over HTTP/2 and
  835 ms over HTTP/1.1.
- **Impact.** First visit and the request-heavy pages; about -30 percent cold
  time to content. A deployment behind an HTTP/2 edge is unaffected, a
  self-hosted Compose deployment exposing the gateway's TLS port is not.
- **Recommendation.** Enable HTTP/2 on the gateway's TLS listener (`http2 on;`
  in the server block) and keep `tools/gateway_contract_test.ts` strict about
  it; confirm that the Dokploy edge negotiates `h2` and say so in
  `compose-contract.md`. With h2 the header overhead compresses (HPACK) and the
  six-connection ceiling disappears, which also makes the FEQ-04 rail fan-out
  cheap while it exists.

### FEQ-08 No HTTP caching or validators anywhere

- **Severity:** Low
- **Status:** Verified (dynamic + code read)
- **Where:** every `Cache-Control: private, no-store` set in the route handlers
  (for example `packages/backend/modules/people/transport/http/profile.ts`,
  `packages/backend/modules/files/transport/http/routes.ts:195,233,255,308`,
  `packages/http-kit/downloads.ts:45`); no middleware, no `ETag`.
- **What happens.** All 25 sampled successful GET responses answer
  `private, no-store` without `ETag` and with `Vary: Origin` only (the 26th
  sample, a 400 problem, is `no-store`); the API reads `X-Workspace-Id` but does
  not vary on it. So no conditional request is possible, vocabularies
  (`relationship-types`, `communication-options`, `interaction-options`,
  personalization lists, preferences) are re-read on every navigation, and
  avatar and file content, whose URL contains the immutable `fileId`, is
  re-downloaded on every render.
- **Evidence.** Directory with 20 stored avatars: 20 image requests on the first
  load and 20 more on the second (23.6 KB including headers for 1.4 KB of
  pixels); the bell polls a 388-byte body with about 1 KB of headers every
  minute with no `If-None-Match`.
- **Impact.** Low for the data reads (small, fast); real for images and for
  mobile data. Treating `no-store` as policy is deliberate and security-minded,
  so any change needs the security agents' agreement.
- **Recommendation.** (a) Content-addressed media
  (`/people/:id/files/:fileId/content`): `Cache-Control: private, max-age=3600`
  (or immutable), since a new image is a new `fileId`; revocation stays as
  strict as the session. (b) Add a strong `ETag` and `304` for GET JSON in
  `packages/http-kit` (a body hash) so the 60-second bell poll and repeated
  vocabulary reads cost headers only. (c) If any response ever gains `max-age`,
  add `Vary: X-Workspace-Id` first (the workspace is a header, not a path part).

### FEQ-09 No priority tiers for non-critical work

- **Severity:** Low
- **Status:** Verified (code read + dynamic)
- **Where:** `layouts/ApplicationLayout.astro:162-182` (the palette, quick
  capture and bell mount at script start),
  `features/shell/notifications/notification-bell.tsx:105-125`,
  `features/interactions/quick-capture.tsx:180-205`,
  `islands/global-people-search/global-people-search.tsx:351-382`; no use of
  `fetch` `priority`, `requestIdleCallback` (only `recordPersonView`,
  `features/person/workspace.ts:378-390`) or visibility gating other than the
  bell's.
- **What happens.** Everything is issued at page start with default priority:
  the palette context, quick-capture context, the bell, `tag-options`,
  `duplicates` and the person page's identity read all compete for the same six
  connections; the non-critical reads sit in front of, and through FEQ-01 hold
  up, the critical ones.
- **Impact.** Under HTTP/1.1 and contention, ordering decides first paint; the
  shell's three islands and the bell need nothing before the user acts.
- **Recommendation.** Three tiers: (0) session and the page's primary read start
  immediately; (1) hero and rail in parallel; (2) after first content, with
  `requestIdleCallback`, `fetch(..., { priority: "low" })` or on first intent
  (focus, pointerenter, keydown): bell read, palette and capture contexts,
  directory `duplicates` and `tag-options`. With FEQ-02 the shell needs no read
  of its own, so only the bell and the directory extras remain.

### FEQ-10 A write triggers wider re-reads than it needs

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `features/person/interactions/person-interactions.tsx:190,223`
  (re-reads activity and note lists on `INTERACTION_CREATED_EVENT`),
  `islands/person-timeline/person-timeline.tsx:213` (timeline reload on
  `PERSON_TIMELINE_CHANGED_EVENT`),
  `features/person/communications/communications.tsx:164-172` (`refresh` reads
  the history and the whole person to update "last contact"),
  `features/person/reminders/person-reminders.tsx:155-170` (re-reads the profile
  summary).
- **Evidence.** Saving one note: 1 POST then `activity-report?kind=activity`,
  `activity-report?kind=note` and `timeline` (3 GETs) although the activity list
  is unchanged and the note is in the POST response.
- **Impact.** Small per action (3 GETs); it scales with every section that
  re-reads on shared events.
- **Recommendation.** Refresh only the lists the record kind affects (note ->
  note list and timeline), or insert the returned record locally and refresh
  once, and have the hero take "last contact" from the response that changed it.
  This is "prefer one authoritative refresh over several client-side owners"
  (AGENTS.md); a small pure reducer fed by the creation event would own it.

### FEQ-11 Secondary reads fetched at page open

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `/app/people`: `GET /people/duplicates`, `GET /people/tag-options`
  and `GET /people/tag-facet` (`people-directory.tsx`,
  `features/people/duplicates/people-duplicates.tsx:88-96`: itself a
  `session -> prefs -> duplicates` chain); `/app/settings/profile`:
  `GET /settings/personal-lifecycle` (the account-deletion preview) beside the
  profile; `/app/settings/members`: two reads (`workspace-members`,
  `settings/members`, about 1.2 KB each).
- **Impact.** 1 to 3 requests per page; the duplicates read also scales with
  directory size (agent 2).
- **Recommendation.** Fetch duplicates when its review section scrolls into view
  or at idle; derive the tag select from the facet's first page or load options
  on focus; load the deletion preview when its dialog opens; merge the two
  members reads if their data is the same.

### FEQ-12 JSON API responses are not compressed

- **Severity:** Low
- **Status:** Verified (dynamic)
- **Where:** `gateway/nginx.conf:73-80` (comment: private API and renderer
  responses stay uncompressed on purpose; `gzip_types` has no JSON).
- **Evidence.** 24 person-page bodies: 57.8 KB raw, 17.4 KB gzip (30 percent);
  the largest, `GET /people?limit=50`, is 14.2 KB to 2.4 KB. With HTTP/1.1
  headers (about 990 B each), the person page moves about 64 KB of which 25 KB
  is headers.
- **Impact.** Small on broadband, visible on mobile networks.
- **Recommendation.** Decide explicitly with the security agents. BREACH needs a
  secret in the body next to attacker-controlled text; the GET responses sampled
  carry neither CSRF tokens nor secrets (the credential-bearing answers, token
  and calendar-feed creation, are POSTs), but that should be confirmed for every
  compressed route. If accepted, add `application/json` to `gzip_types` (about
  -70 percent bytes) and enable h2 for header compression (FEQ-07).

### FEQ-13 No request-budget regression guard

- **Severity:** Info
- **Status:** Verified (static)
- **Where:** `tests/e2e/perf.PERF-001.spec.ts`,
  `docs/planning/mvp-capacity-profile.json` (ceilings in milliseconds; the page
  check only waits for 20 directory rows within 2000 ms).
- **What happens.** Nothing asserts the number of API requests per page, the
  absence of duplicate GETs, or sequential depth, which is how the preferences
  duplication grew to 3 to 7 per page unnoticed.
- **Recommendation.** One Playwright spec (flow id `PERF-002`) that opens each
  cataloged authenticated page, collects `/api/v1/` requests with
  `page.on("request")`, and fails on (a) any duplicate `GET` URL, (b) a count
  above a per-page budget kept in the capacity profile (the post-fix targets
  below), (c) more than N sequential steps. It costs seconds and pins every
  finding above.

## Recommended request budget after the fixes

Estimated from the simulations (preferences embedded, single-flight) and the
FEQ-04 steps; rows marked (est) are not measured end to end.

| Page                    | Today |  Target | How                                     |
| ----------------------- | ----: | ------: | --------------------------------------- |
| Shell on every page     |   5-9 |       2 | session with preferences, bell          |
| `/app/settings/*`       |   5-8 |     2-4 | shell plus the page read                |
| `/app` Today            |    14 |       7 | shell 2 + 5 independent reads           |
| `/app/people`           |    11 | 5 (est) | shell 2 + list + facet; duplicates idle |
| `/app/tasks`            |     8 | 3 (est) | shell 2 + tasks; people on demand       |
| `/app/journal`          |     7 |       3 | shell 2 + journal                       |
| `/app/people/:id` rich  |    25 | 5 (est) | shell 2 + person/rail, timeline, view   |
| `/app/people/:id` blank |    19 | 4 (est) | shell 2 + person/rail, view             |
| Palette, empty query    |     9 |       1 | recent people from `search`             |

## Checked and sound

- Zone laziness works: tasks, gifts, files and the audit summary do not load
  until their zone is near the viewport (+4 requests after scrolling a laptop
  viewport, +10 on a phone); `POST /view` is deferred to idle and the workspace
  waits for it (REL-046). The August "duplicate contact-methods fetch" and the
  "quick capture prefetches on every page" and "gifts prefetches people and
  files" items are fixed.
- Quick capture loads its options once on first open (2 requests) and none on
  later opens; a Today reconnect opener checks the person with one more read.
- The palette's search is one request for five groups; the 200 ms debounce
  collapses fast typing to 1 request; a latest-request slot ignores stale
  answers.
- Directory pagination is 1 request per 20 rows by an observer with a 160 px
  margin, search is 1 request, a stale cursor restarts cleanly.
- Idle polling: a parked Today tab makes exactly one request per minute
  (`GET /notifications` at +58.4, +118.4, +178.4 s) and skips hidden tabs
  (`features/shell/notifications/notification-bell.tsx:110-113`).
- The session cache logic is careful (TTL, workspace match, shape checks, UI
  state kept, access-lost handling); the issue is only its reach (FEQ-03).
- Page data requests are issued in parallel (the 17-request rail and timeline
  wave is issued within 24 ms) and the payloads are small (the person page's
  bodies add up to about 35 KB).
- Static assets under `/_astro/` are `public, max-age=31536000, immutable`
  (`gateway/nginx.conf:293-298`); documents are static files.
- No 429 from the gateway or the API occurred; the heaviest page spends 25 of
  the per-IP burst of 200 (`gateway/nginx.conf:148`), enough headroom for the
  documented 3 burst users, thin for many users behind one NAT address.

## Observations for other areas

- **Agent 2 (SQL, concurrency).** The database pool is 8
  (`packages/backend/platform/postgres/database.ts:29`). Under the 17-request
  person fan-out the median request takes 40 ms (max 64) against 8 to 15 ms
  alone, and the wave of 17 finishes in 87 ms while the sum of durations is 693
  ms, an effective parallelism of about 8. Every request also resolves the
  session. The directory reads `GET /people/duplicates` on every open, which
  will scale with people count.
- **Agent 5 (hydration, bundle).** A cold person page makes 75 non-API requests
  (71 scripts, one 49 KB font, 425 KB encoded); the module graph has depth 10
  and the first API call starts at 900 ms at 100 ms latency (490 ms over h2).
  Other pages load 34 to 40 scripts. Most chunks are 1 to 8 KB.
- **Agents 3 and 4 (security).** Any caching change (FEQ-08) and compression
  (FEQ-12) must be reviewed against the deliberate `private, no-store` policy;
  response security headers are about 990 B each. Avatar content is served from
  an authenticated API path with `no-store`.

## Reproduction

All probe scripts live in `$S/work/feq/` (scratchpad, temporary); the essential
parts are inline. `account.ts` performs the account steps listed under "Test
environment" in [README.md](README.md).

```sh
S=/c/Users/User/AppData/Local/Temp/claude/D--worktree-relationships-assistant-t3-94400158/6b9a909a-23de-4587-8ac6-0f957d7b4521/scratchpad
cd /d/worktree/relationships-assistant/t3-94400158
DENO_NO_PACKAGE_JSON=1 deno run --allow-net --unsafely-ignore-certificate-errors=127.0.0.1 \
  --allow-run=docker "$S/account.ts" audit-feq-1@example.test "FEQ Workspace" \
  > "$S/work/feq/account1.json"
```

Seeding (public API only, `Origin` and cookie headers, `X-Workspace-Id`):
`seed1.ts` creates contact-method types, contact labels, activity types, life
event types, tags (personalization endpoints) and 120 people; `seed2.ts` builds
the rich person (`POST /people/:id/facts/<section>` with
`expectedPersonUpdatedAt`, `PUT .../facts/tags/:id` with `id` in the body,
`/dates`, `/life-events`, `/relationships`, `/interactions` note, activity,
call, conversation, `/reminders`, `/stay-in-touch-cadences`, `/tasks`, `/gifts`,
`/debts`, `POST /people/:id/files` with `X-File-*` headers, `/journal/posts`),
stars, archives and views; `seed3b.ts` tags 70 people; `avatars.ts` PUTs a 1x1
PNG to `/people/:id/avatar` for the first directory page; a Monica-json dry run
and commit plus `POST /exports` make the import report and notifications.

Page suite (cold, warm, hot; latency 0 or 100):

```sh
node "$S/work/feq/suite.mjs" --mode cold --latency 0   --repeat 1
node "$S/work/feq/suite.mjs" --mode warm --latency 100 --repeat 1
node "$S/work/feq/suite.mjs" --mode hot  --latency 100 --only today,person-rich,tasks
node "$S/work/feq/interactions.mjs" 0 palette,bell,capture,note,directory,person-zones
node "$S/work/feq/navchain.mjs"; node "$S/work/feq/polling.mjs" 200
```

Core of the capture (everything else is bookkeeping):

```js
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 100,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
cdp.on(
  "Network.requestWillBeSent",
  (e) =>
    log.set(e.requestId, {
      method: e.request.method,
      url: e.request.url,
      wall: e.wallTime * 1000,
      t0: e.timestamp,
    }),
);
cdp.on(
  "Network.responseReceived",
  (e) =>
    Object.assign(log.get(e.requestId), {
      status: e.response.status,
      protocol: e.response.protocol,
      cacheControl: e.response.headers["cache-control"],
      etag: e.response.headers["etag"],
    }),
);
cdp.on(
  "Network.loadingFinished",
  (e) =>
    Object.assign(log.get(e.requestId), {
      end: e.timestamp,
      bytes: e.encodedDataLength,
    }),
);
// first content: a MutationObserver in addInitScript records
// performance.timeOrigin + performance.now() when a selector first has text
```

Same-URL serialization microbenchmark (run in a page on the gateway origin after
`Network.emulateNetworkConditions`):

```js
const t0 = performance.now();
const done = await Promise.all([...Array(6)].map(async (_, i) => {
  await fetch(
    "/api/v1/legal-requirements", /* or `?i=${i}` or {cache:"no-store"} */
  )
    .then((r) => r.text());
  return Math.round(performance.now() - t0);
}));
```

Fix simulation proxy
(`proxy.mjs <port> <h1|h2> <passthrough|dedupe|nostore|embedded>`): a Node
`https`/`http2` reverse proxy to `https://127.0.0.1:18443` that rewrites the
built `request.*.js` chunk, replacing

```js
async function e(e, t) {
  let n = await fetch(e, {
      ...t,
      headers: { "content-type": `application/json`, ...t?.headers },
    }),
    r = await n.json();
  return n.ok ? { ok: !0, value: r } : { ok: !1, problem: r };
}
```

with a single-flight version
(`const g=!t||!t.method||String(t.method).toUpperCase()==="GET"`; key =
`url + JSON.stringify(t.headers)`; a `Map` of in-flight promises deleted in
`.finally`; callers receive `structuredClone`), or with
`fetch(e,{cache:"no-store",...t,...})`; the "embedded" variant replaces
`getMemberPreferences` in `settings.*.js` with
`Promise.resolve({ok:!0,value:<recorded response>})`. Then run
`FEQ_ORIGIN=https://127.0.0.1:<port> node whatif2.mjs <label> 100 3 [pages] [hot|cold]`.
Proxies were stopped after the run; the repository and the shared stack were not
modified.

Request-budget spec sketch for FEQ-13:

```ts
test("[PERF-002] people profile stays within its request budget", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/")) {
      calls.push(
        `${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`,
      );
    }
  });
  await page.goto(`/app/people/${personId}`);
  await expect(page.locator("[data-workspace-settled]")).toBeAttached();
  const gets = calls.filter((c) => c.startsWith("GET "));
  expect(new Set(gets).size).toBe(gets.length); // no duplicate GET
  expect(calls.length).toBeLessThanOrEqual(budget.personProfile);
});
```

## Appendix A. API requests on open, all 28 pages

Columns as in M1; "prefs" is `GET /settings/preferences`. The personalization
page with `?section=tags` has the same numbers as the one without.

| Page                                  | cold | unique | prefs | shell | page reads | warm | hot |
| ------------------------------------- | ---: | -----: | ----: | ----: | ---------: | ---: | --: |
| `/app`                                |   14 |      8 |     7 |     9 |          5 |   14 |  14 |
| `/app/people`                         |   11 |      7 |     5 |     7 |          4 |   12 |  11 |
| `/app/people/archived`                |    9 |      6 |     4 |     6 |          3 |   10 |   - |
| `/app/people/new`                     |    5 |      3 |     3 |     5 |          0 |    5 |   - |
| `/app/people/:id` rich                |   25 |     22 |     4 |     6 |         19 |   25 |  25 |
| `/app/people/:id` blank               |   19 |     16 |     4 |     6 |         13 |   19 |  19 |
| `/app/people/:id/audit`               |    7 |      4 |     4 |     6 |          1 |    7 |   - |
| `/app/people/:id/activity-report`     |    7 |      4 |     4 |     6 |          1 |    7 |   - |
| `/app/journal`                        |    7 |      4 |     4 |     6 |          1 |    7 |   7 |
| `/app/journal/:id`                    |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/tasks`                          |    8 |      5 |     4 |     6 |          2 |    9 |   8 |
| `/app/settings`                       |    5 |      3 |     3 |     5 |          0 |    5 |   - |
| `/app/settings/profile`               |    7 |      5 |     3 |     5 |          2 |    7 |   7 |
| `/app/settings/preferences`           |    8 |      4 |     5 |     7 |          1 |    9 |   8 |
| `/app/settings/security`              |    7 |      4 |     4 |     6 |          1 |    7 |   - |
| `/app/settings/workspace`             |    6 |      4 |     3 |     5 |          1 |    7 |   6 |
| `/app/settings/members`               |    8 |      5 |     4 |     6 |          2 |    8 |   8 |
| `/app/settings/personalization`       |    6 |      4 |     3 |     5 |          1 |    7 |   - |
| `/app/settings/workspace/danger-zone` |    6 |      4 |     3 |     5 |          1 |    7 |   - |
| `/app/settings/storage`               |    6 |      4 |     3 |     5 |          1 |    7 |   - |
| `/app/settings/api`                   |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/settings/integrations`          |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/settings/import`                |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/settings/import/new`            |    5 |      3 |     3 |     5 |          0 |    6 |   - |
| `/app/settings/import/:id`            |    6 |      4 |     3 |     5 |          1 |    7 |   - |
| `/app/settings/export`                |    7 |      4 |     4 |     6 |          1 |    8 |   - |
| `/app/settings/audit`                 |    7 |      4 |     4 |     6 |          1 |    7 |   - |
