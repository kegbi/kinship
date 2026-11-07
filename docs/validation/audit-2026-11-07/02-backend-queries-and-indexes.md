# Backend query efficiency, indexes, and per-request overhead

Audit agent 2 of 5 (finding prefix `BEQ`), 2026-11-07, worktree
`t3/backend-security-performance-audit` (HEAD `bc8579ae`).

**Scope.** How a request reaches PostgreSQL (gateway, Hono, kit middleware,
module routes, use cases, Kysely/postgres.js adapters), the fixed number of SQL
statements every authenticated request pays before its own work, the SQL of
every hot read model (session, Today, people directory, person profile and its
sections, global search, notifications, journal, activity report, audit history,
calendar feed), the index coverage of those statements against
`personal-crm-schema/v12/personal_crm_schema_v12.sql`, and the worker's
reminder-delivery scan. Each claim is measured on seeded data at the `medium`
and `large` sizes of `docs/planning/mvp-capacity-profile.json`. **Not covered:**
the number of requests per page (agent 1, `FEQ`), security (agents 3 and 4),
rendering strategy (agent 5). No repository file was changed; every index or
schema remark below needs a synchronized **schema v13** (AGENTS.md), and none of
it was applied to a repository database.

**Short answer to "are we fetching the data the optimal way, in indexes and
priorities?"** The data queries themselves are mostly sound: set-based,
keyset-paginated, bounded (no result set above 100 rows except a static currency
list and the 2,000-event calendar cap), page-first laterals, and index-backed
for every per-person path (a person with 5,000 calls, 3,000 notes and 800
conversations still reads its profile in 9 ms). The waste is around the queries,
plus a short list of statements that are O(history) where they should be
O(page):

- **The worker.** Every 5 s tick re-generates every recurring reminder's next
  eight occurrences with one `INSERT ... WHERE NOT EXISTS` per occurrence,
  inside one transaction that row-locks `member_preferences` and
  `workspace_settings` for the whole loop (BEQ-01, BEQ-02). At 2,000 people that
  is about 12,000 statements and ~10 s per tick; at 10,000 people about 58,800
  statements and ~40 s. Meanwhile `POST /people/{id}/view` timed out (504 after
  15 s).
- **Fixed overhead.** A directory page costs 24 database round trips and 6
  transactions, of which 23 are session, legal and revalidation chatter (the
  session is even resolved twice), 0.39 ms of database execution but 1.37 ms of
  planning and ~10 ms of wall time. Every authenticated read also writes (a
  `last_seen_at` UPDATE and row locks, ~600 bytes of WAL) (BEQ-03 to BEQ-05).
- **A handful of O(history) read paths:** Today "recent activity" (227 ms for 20
  rows at the large profile), the notification feed polled every minute, Today
  attention and reminders, and the `last-contacted` directory order (BEQ-06,
  BEQ-07, BEQ-10). A notes index, two partial indexes on `reminder_occurrences`
  and limit-first rewrites bring the first three to 1 to 2 ms (measured);
  `last-contacted` needs a projection.
- **Index inventory:** about 20 non-unique indexes on the active tables were
  never scanned by any workload I could drive (several only back rare cascades),
  two are redundant by prefix, `people_active_name_idx` matches no query, and
  one hot lookup (`reminders.person_date_id`) has no index (BEQ-12).

## Method

**Read.** `apps/api/composition.ts` (route wiring, middleware order, pool
composition); `packages/http-kit/{session,logging,body_limit,route}.ts`;
`packages/backend/modules/governance/transport/http/routes.ts` (legal guard);
`packages/backend/modules/workspaces/application/protected_session*.ts` and
`adapters/postgres/actor_revalidation.ts`;
`packages/backend/modules/identity/adapters/postgres/authentication.ts`;
`packages/backend/platform/postgres/{database,transactions,name_match,timestamps}.ts`;
the adapters under `packages/backend/read-models/*/adapters/postgres` (the
activity report only through its plans);
`packages/backend/modules/planning/{application/reminder_delivery.ts,
adapters/postgres/reminder_repository.ts}`;
`apps/worker/*`;
`packages/backend/modules/relationships/application/relationship_listing.ts` and
`workspaces/adapters/postgres/relationship_workspace_boundary.ts`;
`tests/integration/people_directory_capacity_postgres_test.ts`,
`tests/e2e/perf.PERF-001.spec.ts`; the 157 index definitions of the v12 DDL.

**Stack.** My own Compose project `kinship-audit-db` (the shared `kinship-audit`
stack was not touched): the images already built for the shared stack (same
tree), PostgreSQL 18.4 (alpine) started with
`shared_preload_libraries=pg_stat_statements`, `pg_stat_statements.track=all`,
`track_planning=on`, `track_io_timing=on`, `log_statement=all`,
`log_line_prefix='%m [%p] %a %x '`, and `auto_explain` (`log_min_duration=0`,
`log_analyze`, `log_buffers`) set per role so every statement the API runs is
logged with its bound parameters and its real plan. `PGAPPNAME` was set to `api`
and `worker` to tell the two apart. The database sits on tmpfs; the host is
Docker Desktop with 32 CPUs and 32 GB. PostgreSQL ran with image defaults
(`shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4,
`max_connections` 100); nothing in `compose.yaml` tunes it. Latency figures come
from a keep-alive client running inside the `api` container straight at `:8000`
(no nginx rate limit, no TLS), so they are floors: a database one millisecond
away multiplies every round-trip count below by roughly 3 to 5.

**Per-request statement counts** were taken by bracketing one HTTP request with
two marker statements in the Postgres log and listing what the `api` application
sent between them (BEGIN and COMMIT counted as round trips, `RT`). Plans were
captured by `auto_explain` for the same window. Server-side time, planning time
and WAL per request come from `pg_stat_statements` after
`pg_stat_statements_reset()` and N identical requests.

**Datasets** (one workspace, seeded by SQL that mimics what the application
writes: every birthday has its reminder, eight future occurrences and three sent
years):

| profile | people | reminders / occurrences | calls + threads + messages |  notes | activities | audit events |
| ------- | -----: | ----------------------: | -------------------------: | -----: | ---------: | -----------: |
| small   |    250 |             179 / 1,969 |                      6,000 |    800 |        400 |        1,000 |
| medium  |  2,000 |          1,478 / 16,258 |                     50,000 |  6,000 |      3,000 |        8,000 |
| large   | 10,000 |          7,347 / 80,817 |                    250,000 | 30,000 |     15,000 |       40,000 |

The large profile also has 10,463 person-tag links, 8,369 person dates, 5,000
relationships, 5,000 tasks and 3,000 journal posts (about 190 MB with indexes).
After loading, `VACUUM (ANALYZE)` was run so plans reflect steady state. Row
counts in the profile JSON are met or exceeded.

## Architecture overview

1. **Edge.** nginx gateway (rate limits, request id) forwards `/api/v1/*` to the
   private `api`. The Hono app is `createApiApp`
   (`apps/api/composition.ts:376`).
2. **Kit middleware, in order** (`apps/api/composition.ts:386-413`): request id,
   request log (stdout JSON only, no database), secure headers, same-origin
   CORS, body limit (1 MiB, three self-bounded routes exempt), health probes,
   then the **legal guard on `/api/v1/*`**
   (`governance/transport/http/routes.ts:212-251`), which resolves the session
   and asks the legal use case before any route runs.
3. **Module routes** (`packages/backend/modules/*/transport/http/routes.ts`,
   mounted at `/`). There is no global auth middleware: each route file builds
   `sessionActor(protectedSessions)` (`packages/http-kit/session.ts:145`), a
   per-request memoised thunk, and the handler calls `requireActor` /
   `requireSession`.
4. **Use case, then adapter.** Read models
   (`packages/backend/read-models/*/application`) first run
   `transaction.run(actors.revalidate(...))`, a separate small transaction that
   re-checks the actor (`list_people.ts:298-301`; the same call is in 12 read
   model use cases), then run their SQL on the pool. Write use cases do all
   their work in one `database.transaction().execute`
   (`platform/postgres/transactions.ts:34`), including the audit insert and
   postcondition selects.
5. **Database access.** One Kysely over postgres.js per process
   (`platform/postgres/database.ts:29-42`): `max: 8`, `idle_timeout: 10` s,
   `connect_timeout: 5` s, `prepare: true`. The API and the worker each own an
   8-connection pool. There is no request-scoped connection or transaction: one
   request is 6 to 10 separate transactions, each re-acquiring a pooled
   connection (BEQ-04).
6. **Worker** (`apps/worker/main.ts:48`): serial loop, 5 s sleep between ticks;
   a tick is workspace cleanup, recurring-debt charging, then reminder
   replenish, claim and delivery (`reminder_delivery.ts:350-360`).

The architecture rule that matters for what follows is
`docs/architecture/backend-architecture.md:302-305`: "resolve the authenticated
principal and active workspace before invoking a protected use case". It asks
for one resolution; nothing in the docs requires a re-resolution per layer.

## Summary

| ID     | Severity | Title                                                                  | Status             |
| ------ | -------- | ---------------------------------------------------------------------- | ------------------ |
| BEQ-01 | High     | Reminder replenish re-runs for every reminder on every 5 s tick        | Verified (dynamic) |
| BEQ-02 | High     | The replenish transaction row-locks preferences and blocks user writes | Verified (dynamic) |
| BEQ-03 | Medium   | The session is resolved twice per authenticated request                | Verified (dynamic) |
| BEQ-04 | Medium   | 24 round trips and 6 transactions of fixed overhead per request        | Verified (dynamic) |
| BEQ-05 | Medium   | Reads that write: session UPDATE, row locks, vocabulary "ensure"       | Verified (dynamic) |
| BEQ-06 | Medium   | Today "recent activity" is O(activities + notes) for a 20-row widget   | Verified (dynamic) |
| BEQ-07 | Medium   | `reminder_occurrences` read paths are O(history)                       | Verified (dynamic) |
| BEQ-08 | Low      | Worker claim and scan statements defeat the partial due index          | Verified (dynamic) |
| BEQ-09 | Low      | The worker loop has no error handling                                  | Verified (dynamic) |
| BEQ-10 | Low      | Directory name sorts, search and `last-contacted` are O(N)             | Verified (dynamic) |
| BEQ-11 | Low      | Global search cost is independent of hit count; common terms are slow  | Verified (dynamic) |
| BEQ-12 | Low      | Index inventory: unused, redundant, missing, write amplification       | Verified (dynamic) |
| BEQ-13 | Low      | Casts and expressions defeat indexes in two smaller paths              | Verified (dynamic) |
| BEQ-14 | Info     | Calendar feed: a 304 still pays the full query and render              | Verified (dynamic) |
| BEQ-15 | Info     | Unbounded tables, untuned PostgreSQL, random UUID keys                 | Verified (dynamic) |

0 Critical, 2 High, 5 Medium, 6 Low, 2 Info.

## Findings

### BEQ-01 Reminder replenish re-runs for every reminder on every 5 s tick

- **Severity:** High
- **Status:** Verified (dynamic), code read.
- **Where:**
  `packages/backend/modules/planning/application/reminder_delivery.ts:353`
  (`replenish` before every `claimDue`),
  `packages/backend/modules/planning/adapters/postgres/reminder_repository.ts:878-1038`
  (the INSERT per occurrence is at `:995`; candidate scans at `:909-917` and
  `:931-965`; global DELETE at `:1022`; `rechannelWaiting` at `:1036`),
  `apps/worker/main.ts:48` (5 s sleep), `apps/worker/composition.ts:94-114`.

**What happens.** A tick starts with `replenish({ now })` regardless of whether
anything changed. It scans every active reminder joined to **all** its
occurrence rows (sent history included), then, for each reminder (times each
active lead rule) and each of the next **eight** occurrences, issues one
`INSERT ... SELECT ... WHERE NOT EXISTS (...) ON CONFLICT DO NOTHING`, one round
trip each. In steady state the answer is always "already there": 6 rows were
inserted by 114,592 statements in the run below. After the loop it runs a global
DELETE of withdrawn lead occurrences and `rechannelWaiting` (an INSERT and a
DELETE that read every waiting occurrence). Only then does `claimDue` look for
work. The whole of `replenish` is one `database.transaction()`.

**Evidence.** Worker started on the seeded workspaces; counts from
`pg_stat_statements`, tick rate from the per-tick statements:

| profile | reminders | INSERTs per tick | ticks per minute | cycle (measured) | tick duration (derived) |
| ------- | --------: | ---------------: | ---------------: | ---------------: | ----------------------: |
| small   |       179 |           ~1,350 |      11 per 62 s |           ~5.6 s |                  ~0.6 s |
| medium  |     1,478 |          ~12,000 |       4 per 60 s |            ~15 s |                   ~10 s |
| large   |     7,347 |          ~58,800 |       2 per 90 s |            ~45 s |                   ~40 s |

```
-- large, 90 s window, nothing due, nothing changed
 calls  | total_ms | rows | query
 114592 |     2234 |    6 | insert into crm.reminder_occurrences (...) select ... where not exists
      2 |      119 |14126 | select distinct reminder.id::text as reminder_id, occurrence.member_id ...
      2 |       72 |   40 | with inactive_expired_unattempted as (...)        -- claimDue
-- docker stats:  worker cpu=43.8%   postgres cpu=62.1%   (idle workspace)
```

The cost is the round trips (each INSERT executes in 0.02 ms inside Postgres,
about 0.8 ms end to end), so it is invisible in per-statement timings and shows
only as a worker that is permanently busy: about 1,300 statements per second at
large, roughly 110 million no-op statements a day.

`tests/e2e/perf.PERF-001.spec.ts:385-423` checks `workerDueToDelivery` (10,000
ms) with one reminder whose `recurrence_unit` is `'none'`, which `replenish`
skips (`reminder.recurrence_unit <> 'none'`, `:963`), so the profile's ceiling
is never exercised against recurring reminders.

**Impact.** At the medium profile `claimDue` runs after a ~10 s replenish and a
5 s sleep, so a reminder that falls due just after a claim waits up to ~15 s
(profile ceiling: 10 s); at large up to ~45 s. A busy worker also competes with
the API for Postgres CPU and, worse, holds locks (BEQ-02).

**Recommendation.** Make replenishment demand-driven; no schema change is
required.

1. Replace the per-occurrence loop by a set-based "needs top-up" query and act
   on its result only. This one statement takes 25 ms at large and returns 0
   rows in steady state (measured, 3,044 buffers):
   `select o.reminder_id, o.member_id, o.lead_time_days from reminders r join
   reminder_occurrences o on o.reminder_id = r.id where r.is_active and
   r.deleted_at is null and r.recurrence_unit <> 'none' group by 1,2,3 having
   count(*) filter (where o.occurs_on >= current_date) < 8`.
2. Run that check at most hourly (or once per local date change) rather than per
   tick, and when definitions change (the use cases that edit a reminder, date,
   lead rule, timezone or delivery preference already call the publisher).
3. When rows are missing, insert them in chunks of 500 to 1,000 with one
   `INSERT ... SELECT FROM unnest(...)` per chunk, each in its own short
   transaction.
4. Keep `claimDue` first in the tick so delivery latency no longer depends on
   how many reminders exist.
5. Optional for v13: a `reminders.generated_through date` column makes step 1 an
   index range read instead of an aggregate over occurrences.

### BEQ-02 The replenish transaction row-locks preferences and blocks user writes

- **Severity:** High
- **Status:** Verified (dynamic).
- **Where:** `reminder_repository.ts:881-904` (two `FOR SHARE` selects over
  `workspace_settings` and `member_preferences`, held until the loop ends at
  `:1037`); the writers it blocks:
  `workspaces/adapters/postgres/member_ui_state.ts:25` and
  `workspaces/adapters/postgres/recent_people.ts:15` (`SELECT ... FOR UPDATE` on
  `member_preferences`), plus any preference or timezone save.

**What happens.** `replenish` takes `FOR SHARE` on every `workspace_settings`
and `member_preferences` row that owns reminders, then runs the whole BEQ-01
loop in the same transaction. Any `UPDATE` or `SELECT ... FOR UPDATE` of those
rows (recording a recently viewed person, saving the theme or "notifications
read through", saving preferences, changing a timezone) waits for the
transaction to commit, which at the large profile is about 40 s of every 45.

**Evidence.** Worker mid-replenish (transaction age 3 s and more), large
profile; the API's `POST /api/v1/people/{id}/view` (what opening a person page
sends):

```
 pid  | app | wait_event_type | wait_event    | blocked_by | waiting_for | query
 9760 | api | Lock            | transactionid | {8964}     | 00:00:03.19 | select ui_state as "uiState" from crm.member_preferences
                                                                          where member_id = $1::uuid for update
POST /view -> 200 in    74 ms   (between ticks)
POST /view -> 504 in 15032 ms   (worker transaction age 20 s; gateway timeout)
POST /view -> 200 in 12064 ms   (waited for the commit)
POST /view -> 200 in    61 ms
POST /view -> 504 in 15027 ms
```

Locks held by the worker backend: `RowShareLock` on `member_preferences_pkey`,
`AccessShareLock` on `people`, `workspaces_slug_unique`, `reminder_rules_pkey`
and others (`pg_locks`). Reads are not blocked (MVCC); only writes are.

**Impact.** User-visible stalls and gateway 504s on routine writes whenever the
worker is inside a replenish; the fraction of time grows with data: roughly 10
percent at small, 65 percent at medium (derived from the tick table), 90 percent
at large. A write that waits also holds one of the API's 8 pool connections.

**Recommendation.** Remove the long-held locks together with BEQ-01. If the
`FOR SHARE` pre-locks protect a real invariant (a timezone change racing
generation), take them per workspace inside a short transaction that covers only
that workspace's top-up (milliseconds), not the whole deployment's loop. Add a
regression test that a `member_preferences` update completes within a bounded
time while a replenish transaction is open.

### BEQ-03 The session is resolved twice per authenticated request

- **Severity:** Medium
- **Status:** Verified (dynamic), code read.
- **Where:** `apps/api/composition.ts:405-413` (guard mounted on `/api/v1/*`),
  `governance/transport/http/routes.ts:230` (`readActor`, not memoised),
  `packages/http-kit/session.ts:234-244` (`readActor` calls the coordinator
  directly) and `:145-171` (`sessionActor` memoises only inside the route file
  that builds it).

**What happens.** The legal guard resolves the session to learn who to ask about
legal documents; it never stores the answer in `c.var`. The route then runs its
own `sessionActor` and resolves again: a second identical sequence (BEGIN,
SELECT FOR UPDATE, UPDATE `user_sessions`, COMMIT, BEGIN, two context SELECTs,
COMMIT: 8 round trips, 4 statements, 1 UPDATE).

**Evidence.** 400 sequential `GET /api/v1/member/ui-state` after a stats reset:

```
calls | mean_ms | query
  800 |   0.042 | select u.id::text as "userId" from crm.user_sessions s join crm.users u ...  for update of s
  800 |   0.039 | update crm.user_sessions set last_seen_at = $1 where session_hash = $2 ...
  800 |   0.041 | select wm.id::text as "memberId", wm.role ... for share of u, wm, w   (resolveActiveContext)
  800 |   0.033 | select wm.id::text ... (listActiveContexts)
```

800 calls for 400 requests: two resolutions each. `GET /api/v1/session`, which
the guard exempts, resolves once and costs 16 round trips instead of 24.

**Impact.** 8 of the 24 round trips of every authenticated request, one of the
two `last_seen_at` UPDATEs and row-lock sets, and the doubled contention on the
session row (BEQ-05).

**Recommendation.** Mount `sessionActor` once, in front of the legal guard, and
let the guard read `actorOf(context)` (memoised) instead of `readActor`. The
guard can keep its "outage versus nobody" distinction by reading the thunk with
a variant that does not swallow errors. This removes 8 round trips with no
schema or module-boundary change, and is the cheapest fix in this report.

### BEQ-04 24 round trips and 6 transactions of fixed overhead per request

- **Severity:** Medium
- **Status:** Verified (dynamic).
- **Where:** `protected_session.ts:220-236` (`resolve`: 2 transactions),
  `governance/.../routes.ts:239` (legal), `list_people.ts:298-301` and the same
  `revalidate` in 12 read models, `platform/postgres/database.ts:29-42`.

**What happens.** Before a handler's own SQL, an authenticated request runs:

| step                                                                                                        | round trips |
| ----------------------------------------------------------------------------------------------------------- | ----------: |
| legal guard: session (BEGIN, SELECT FOR UPDATE, UPDATE, COMMIT, BEGIN, 2 context SELECTs FOR SHARE, COMMIT) |           8 |
| legal guard: requirements (BEGIN, revalidate, legal documents, COMMIT)                                      |           4 |
| route: session again                                                                                        |           8 |
| use case: `revalidate` (BEGIN, SELECT, COMMIT)                                                              |           3 |
| the handler's query                                                                                         |           1 |
| **total for `GET /api/v1/people?limit=20`**                                                                 |      **24** |

Write endpoints add their own transaction (revalidate again with a lock, the
statement, the audit insert, two postcondition selects): `POST /people` 28,
`POST /interactions` (note) 33, `POST .../dates` (birthday) 35.

**Evidence.** Clean accounting for 400 sequential `GET /api/v1/member/ui-state`
(no business query):

| measure (per request)                     | value                                 |
| ----------------------------------------- | ------------------------------------- |
| database round trips                      | 24 (12 statements, 6 transactions)    |
| Postgres execution time                   | 0.33 to 0.39 ms (two runs)            |
| Postgres planning time (`track_planning`) | 1.37 ms (about 4 times the execution) |
| WAL written                               | 599 bytes, 10 records                 |
| wall time, keep-alive, in-network         | p50 10.6 to 11.9 ms                   |
| `GET /api/v1/health` (no database)        | p50 0.6 ms                            |

So ~96 percent of the wall time is round trips and driver work, about 0.45 ms
each; and Postgres spends 80 percent of its own time planning because every
statement is parsed and planned afresh: the connection option `prepare: true`
(`database.ts:36`) has no effect on Kysely, whose postgres.js dialect calls
`connection.unsafe(sql, params)` without `{ prepare: true }`
(`kysely-postgres-js@3.0.0/dist/index.js:54,67`); the log shows every statement
as `execute <unnamed>`.

Latency and throughput in-network, one session (medium dataset; the first three
rows do not depend on data size, the person-page burst ran at large):

```
/api/v1/session                 p50  7.3 ms   (16 RT)
/api/v1/member/ui-state         p50 11.1 ms   (24 RT, no query)
/api/v1/people?limit=20         p50 14.1 ms   (24 RT + 3 ms query)
/api/v1/people?...last-contacted p50 25.5 ms (medium)
c=1 : 94 rps   c=8 : 306-363 rps   c=16 : 343-389 rps   c=32 : 338 rps, p95 125 ms
person-page burst (25 parallel calls of agent 1's list): 129 ms wall, one call up
to 133 ms; the same 25 calls one after another: 362 ms
```

Idle pool: the first request after more than 10 s without traffic measured 25 ms
against 15 ms warm in the same configuration, because `idle_timeout: 10` closes
every pooled connection (new backend, SCRAM) before the next click.

**Impact.** On a directory page about 75 to 80 percent of the backend time is
fixed overhead; the page cost scales with agent 1's request count (25 requests
per person page, so 600 round trips). The throughput ceiling (~360 requests per
second for the cheapest read, 8 pooled connections) is far above the profile's 3
burst users, so this is an efficiency and headroom finding, not an outage.
Against a remote database the same 24 round trips become 24 times the network
latency.

**Recommendation.** Keep the module boundaries; shrink the number of hops.

1. BEQ-03 (-8 round trips).
2. In `resolve`, run `resolveSession` and both context reads on one connection
   without separate BEGIN/COMMIT pairs, or as one statement per module port (-4
   to -6).
3. Fold the legal check into the session resolution result: carry
   `requiredLegalDocuments` in `ResolvedSession`, computed in the same round
   trip, or cache it per (user, workspace) for 30 to 60 s in the process and
   invalidate on `legal-acceptances` (-4; an acceptance made through another
   instance becomes visible within the TTL).
4. Let a read use case reuse the actor the request has just resolved instead of
   re-running `revalidate` (-3 each); keep the locking `revalidate` for writes.
   A one-statement prototype of "session + accessible workspaces + legal
   outstanding + throttled last-seen" executes in 0.46 ms (measured), so the
   whole fixed cost can approach 1 to 2 round trips.
5. Use real prepared statements for the repeated overhead statements
   (`unsafe(sql, params, { prepare: true })` in a thin wrapper, or a named
   statement cache) to drop planning from 1.4 ms to ~0.
6. Raise `idle_timeout` to 60 to 300 s (and set `max_lifetime`) so an
   interactive pause does not cost a reconnect.
7. Sequencing inside use cases: global search spends 9 extra round trips on the
   `BEGIN` / `SET TRANSACTION READ ONLY` / `set_config('statement_timeout')` /
   `COMMIT` brackets around its two statements (33 against 24 for a plain read);
   send each bracket as one multi-statement round trip, set the timeout per
   role, and run the people and text arms on two connections. The notification
   poll already runs its list and count concurrently, but reads the read-through
   watermark first; joining `member_preferences` into the count would remove
   that dependency.

### BEQ-05 Reads that write: session UPDATE, row locks, vocabulary "ensure"

- **Severity:** Medium
- **Status:** Verified (dynamic).
- **Where:** `identity/adapters/postgres/authentication.ts:403,407-411`
  (`select ... for update of s`, then `update user_sessions set last_seen_at`),
  `workspaces/adapters/postgres/actor_revalidation.ts:179,226`
  (`for share of u, wm, w`),
  `workspaces/adapters/postgres/relationship_workspace_boundary.ts:25-113`
  (`ensureDefaultRelationshipTypes`), called from reads at
  `relationships/application/relationship_listing.ts:72,127`.

**What happens.**

1. Every authenticated request (twice, BEQ-03) takes a row lock on its session
   (`FOR UPDATE`), updates `last_seen_at` and locks the user, membership and
   workspace rows `FOR SHARE`. None of that is needed to answer a read: the
   write is a presence timestamp and the locks protect nothing a read writes.
2. `GET /api/v1/people/{id}/relationships` and `GET /api/v1/relationship-types`
   take `pg_advisory_xact_lock(hashtextextended(workspaceId, version))`, run
   `INSERT INTO crm.relationship_types ... SELECT ... WHERE NOT EXISTS` over the
   26 default types, then a verification statement that rebuilds the same 26-row
   `VALUES` list. After the first call the INSERT is always a no-op, but the
   lock is taken and held to the end of the transaction, so every relationships
   read and write in a workspace serializes behind one key.

**Evidence.** Per request (BEQ-04 table): 10 WAL records and 599 bytes, from
`user_sessions` (80 + 57 bytes), the FOR SHARE locks (162 bytes per resolution)
and their dirtied pages. 24,537 session UPDATEs ran in my session with 99.7
percent HOT, so heap bloat is contained; the table was 168 kB for 10 live rows.
Contention on the session row, same endpoint, 800 requests, in-network:

```
c=8  one shared session : 306 rps  p95 31.9 ms
c=8  eight sessions     : 363 rps  p95 25.1 ms     (-16 percent for the shared session)
c=16 one shared session : 343 rps  p95 55.6 ms
c=16 eight sessions     : 389 rps  p95 44.6 ms
```

A browser fires its page's requests in parallel under one session, which is the
shared-session case. The relationships read, handler statements only:

```
select pg_advisory_xact_lock( hashtextextended($1, $2) )
with expected (forward_label, reverse_label, sort_order) as ( values ... 26 ) insert ...
with expected (...) select count(*) = 26 and bool_and(matches = 1 and exact) ...   -- postcondition
```

`GET /api/v1/relationship-types` costs 30 round trips and the relationships list
32, against 24 for a plain read. The calendar feed's token path already does the
right thing: its `last_used_at` UPDATE carries
`and (last_used_at is null or last_used_at < $...)`, so it writes only when the
value is stale.

**Impact.** A write path on every read: WAL and dirtied pages grow linearly with
traffic (about 18 GB of WAL a day at a sustained 360 requests per second, a
negligible 0.9 MB per tab-day for the one-per-minute notification poll), a
session-row hot spot for parallel page loads, and a workspace-wide advisory lock
on a read endpoint.

**Recommendation.**

1. Throttle the presence write the way the token path already does:
   `update crm.user_sessions set last_seen_at = $1 where session_hash = $2 and
   last_seen_at < $1 - interval '1 minute'`.
2. Resolve with a plain `SELECT` (no `FOR UPDATE`) and drop `FOR SHARE` from
   `resolveActiveContext` / `listActiveContexts`. Writes already take their own
   `FOR NO KEY UPDATE` through `revalidate({ lock: true })`
   (`actor_revalidation.ts:122-149`), which is the place that needs it.
3. Seed the relationship-type vocabulary at registration (as the other defaults
   are) or behind an unlocked `SELECT exists` guard, and only take the advisory
   lock when something is actually missing. Keep the lock on the writing paths.

### BEQ-06 Today "recent activity" is O(activities + notes) for a 20-row widget

- **Severity:** Medium
- **Status:** Verified (dynamic).
- **Where:**
  `read-models/today/adapters/postgres/today_interactions_repository.ts:54-107`
  (`getRecentActivity`), exposed as `GET /api/v1/today/recent-activity`.

**What happens.** One statement `UNION ALL`s every activity (each with a lateral
`jsonb_agg` of its participants, joined to `people`) and every note of the
workspace, projects the time with `instantColumn("happened_at")` (a `to_char`
text), then orders by that text and `id::text` and takes 20. The sort key is an
expression, so neither `activities_workspace_time_idx` nor any note index can
feed a top-N: all 15,000 activities get their lateral participant subquery
(25,500 participant joins) and all 30,000 notes are read before the `LIMIT 20`.

**Evidence.** Large profile, `EXPLAIN (ANALYZE, BUFFERS)`:

```
-- baseline (repo statement)                  Execution Time: 227.5 ms  Buffers: shared hit=108287 read=680
   Seq Scan on activities (rows=15000), Aggregate loops=15000 (Index Only Scan activity_participants_pkey
   30000 + Index Scan people_workspace_id_id_key 76,455 buffers), Seq Scan on notes (rows=30013)
-- medium: 32 ms, 22,520 buffers.  HTTP p50 at medium 40.8 ms vs 11 ms for a trivial read.

-- candidate: limit each arm on the real timestamp first, aggregate participants for the 20
-- survivors; needs notes (workspace_id, created_at desc, id desc)   Execution Time: 1.1 ms, 315 buffers
   Index Scan using activities_workspace_time_idx   (rows=21)
   Index Scan using exp_notes_ws_created_idx         (rows=20)
```

That is 227 ms to 1.1 ms (about 200 times) at the large profile, which is 91
percent of the profile's 250 ms `representativeQuery` ceiling before the 11 ms
of BEQ-04 overhead is added.

**Impact.** Every Today visit; the cost grows linearly with total notes plus
activities (no ceiling), and the time is spent on rows that are discarded.

**Recommendation.** Rewrite as shown (an `a` CTE ordered by
`happened_at desc, id desc limit 20` using the existing index, an `n` CTE for
notes with the same shape, the lateral participants only on the survivors, and a
final sort of at most 40 rows) and add, in v13,
`CREATE INDEX notes_workspace_created_idx ON notes (workspace_id, created_at DESC, id DESC)`.
Order by the real `timestamptz` and render with `instantColumn` only in the
select list. `getFavoriteNotes` (`:111`) already limits correctly and is served
by `notes_favorite_idx`.

### BEQ-07 `reminder_occurrences` read paths are O(history)

- **Severity:** Medium
- **Status:** Verified (dynamic).
- **Where:**
  `read-models/notifications/adapters/postgres/notifications_repository.ts:46-100,150-186`
  (feed, polled every 60 s by every visible tab,
  `apps/web/src/features/shell/notifications/notification-bell.tsx:48`),
  `read-models/today/adapters/postgres/today_attention_repository.ts:125-168`,
  `today_reminders_repository.ts:46-93`. Indexes:
  `personal_crm_schema_v12.sql:1521-1525`.

**What happens.** The table keeps every occurrence ever generated, including
every `sent` row (the bulk, and the part that grows by one row per reminder per
year). The three readers filter by `member_id` and statuses;
`reminder_occurrences_member_idx (member_id)` is the only member-leading index
and it matches every row of the only member, so the planner scans the table:

- Notifications: the feed unions all of the member's sent in-app occurrences and
  three audit-event arms, **sorts the lot**, then takes 51; the unread count is
  a second statement over the same union (capped by `LIMIT 100`, good). The plan
  used a Gather with two parallel workers for a polling endpoint.
- Today attention: the delivery arm is a sequential scan of all 80,817
  occurrences (`Rows Removed by Filter: 80334`) to return 669 open ones, then a
  `DISTINCT ON` sort.
- Today reminders: same table, `member_id` filter, a 90-day sent window.

**Evidence.** Large profile, `EXPLAIN (ANALYZE, BUFFERS)`:

| statement                         | before                            | after (candidate index)         |
| --------------------------------- | --------------------------------- | ------------------------------- |
| notifications feed, first page    | 17.8 ms, 3,624 buffers, 2 workers | 1.7 ms, 383 buffers, no workers |
| Today attention, occurrence arm   | 17.2 ms, Seq Scan, 2,861 buffers  | 1.3 ms, Bitmap Index Scan, 210  |
| Today reminders (whole statement) | 21.7 ms, 3,648 buffers            | not tested                      |
| Today attention (whole statement) | 37.8 ms hot, 6,064 buffers        | not tested                      |

```
create index on crm.reminder_occurrences (member_id, visible_at desc, id desc)
  where channel = 'in_app' and status = 'sent' and visible_at is not null;     -- feed
create index on crm.reminder_occurrences (member_id,
  (case when status = 'retry' then next_attempt_at else deliver_at end))
  where status in ('pending','retry','failed','manual_attention');             -- attention
```

and the feed rewritten with a `(... order by visible_at desc, id desc limit 52)`
per arm before the `UNION ALL` and the final `ORDER BY ... LIMIT 51`
(sub-millisecond ties in `date_trunc('milliseconds', ...)` need the same key in
index and query; take `limit + 1` per arm and keep the final sort).
`pg_stat_user_tables` after the full sweep: `reminder_occurrences` accounts for
5.6 million sequentially read rows (avg 31,000 per scan, 180 scans), more than
any other table.

**Impact.** Cheap at small scale and linear in history: each year adds one sent
row per birthday reminder, so the poll that every open tab runs each minute
reads more rows every year. Parallel workers for a 20 ms polling query waste CPU
under concurrency.

**Recommendation.** Add the two partial indexes in v13 and apply the per-arm
limits; `reminder_occurrences_member_idx` becomes redundant once the partial
indexes lead with `member_id` (keep it only if member-removal cascades are
measured to need it). The partial index excludes the sent history, so it stays
small. Consider a retention rule for sent occurrences older than the 90-day
window the UI reads (BEQ-15).

### BEQ-08 Worker claim and scan statements defeat the partial due index

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:** `reminder_repository.ts:1040-1223` (`claimDue`), `:909-917`,
  `:1045-1054`; index `reminder_occurrences_due_idx` at
  `personal_crm_schema_v12.sql:1521`.

**What happens.** The due predicate sits inside a large `OR` (pending or retry
or claimed, plus provider-state branches, plus a digest `CASE`), applied as a
join filter after the planner has joined every pending occurrence to `reminders`
and `people`. The plan reads all 58,776 pending rows
(`Rows Removed by Join Filter: 58776`, `Seq Scan on reminder_occurrences`, 6,078
buffers, ~50 ms) to find none due. `reminder_occurrences_due_idx` was never
scanned (`idx_scan = 0`). The candidate-member scans
(`select distinct
occurrence.member_id`, at `:909` and `:1045`) are full scans
too (29 to 33 ms). `FOR UPDATE ... SKIP LOCKED` itself is used correctly.

**Evidence.** Same large data, index-first form of the due selection
(`status in ('pending','retry') and coalesce(next_attempt_at, deliver_at) <=
now() ... order by ... for update skip locked limit 20`):
Bitmap Index Scan on `reminder_occurrences_due_idx`, 126 buffers, **0.59 ms**,
against 6,078 buffers and about 50 ms for the current shape.

**Impact.** Roughly 150 ms of avoidable scanning per 5 s tick at large (the
claim 50 ms, the two candidate-member scans 29 to 33 ms each, the replenish
candidate scans 33 and 64 ms), about 3 percent of a core; secondary once BEQ-01
is fixed, but it would then be the next O(rows) cost per tick.

**Recommendation.** Select due ids from the indexable predicate first (a CTE
with `FOR UPDATE SKIP LOCKED LIMIT n`), then join to `reminders`, `people` and
the eligibility arrays to filter, and run the provider-state/lease branches as
separate small selects over `reminder_occurrences_lease_idx`.

### BEQ-09 The worker loop has no error handling

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:** `apps/worker/composition.ts:94-114` (`await worker.tick(...)` with
  no `try/catch`), `apps/worker/main.ts:32-58`.

**What happens.** Any exception from a tick propagates out of
`runReminderWorkerLoop` and `runWorker`, ending the process; Docker's
`restart: unless-stopped` restarts it. A long replenish transaction (BEQ-01)
makes that exposure larger.

**Evidence.** `pg_terminate_backend()` on the worker's active backend (a
stand-in for a failover or network blip) crashed the process
(`Uncaught TypeError: Cannot read properties of null (reading 'write')` from
`postgres/3.4.9/src/connection.js:255`) and Docker restarted it (`RestartCount`
0 to 1).

**Impact.** A transient database error is a process crash and a container
restart, with the reconnect storm and lost in-flight work that implies, instead
of a logged failed tick and a retry on the next one.

**Recommendation.** Catch per tick, log a `worker.job` failure line with
backoff, and let the next tick retry; rebuild the connection if the driver
reports it closed.

### BEQ-10 Directory name sorts, search and `last-contacted` are O(N)

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:**
  `read-models/people-directory/adapters/postgres/people_directory_repository.ts:148-189`
  (ordering), `:364-415` (page), `:120-136` and `last_contact.ts:29-58` (last
  contact); `platform/postgres/name_match.ts`; index
  `personal_crm_schema_v12.sql:682`.

**What happens.** The default sort key is
`lower(coalesce(nullif(btrim(given_name),''),
nullif(btrim(nickname),''), nullif(btrim(family_name),''),''))`;
the only name index,
`people_active_name_idx (workspace_id, lower(family_name), lower(given_name))`,
is a different expression, so every page (and every keyset continuation) scans
all active people and top-N sorts them. `last-contacted` computes
`max(called_at)` over all calls, threads and messages of the workspace on every
page (`lastContactByPerson`). Page-first design (avatar and tag laterals only
for the 20 survivors) and keyset cursors are correct.

**Evidence.** Large profile, in-database:

```
given-name, first page   9.4 ms  Seq Scan people + sort of 9,520 rows   ->  0.19 ms, 21 buffers with
   create index on people (workspace_id, (lower(coalesce(nullif(btrim(given_name),''),
     nullif(btrim(nickname),''), nullif(btrim(family_name),''),''))),
     (lower(coalesce(family_name,''))), id) where archived_at is null and deleted_at is null
family-name 10.2 ms, recently-updated 6.4 ms, recently-added 3.2 ms
last-contacted  90.9 ms cold / 51.6 ms continuation page (5,253 buffers, 3 parallel workers)
starredFirst, first page: 0.56 ms (people_starred_idx, 221 starred people)
HTTP p50 in-network (medium): given-name 14.1 ms, last-contacted 25.5 ms
```

`tests/integration/people_directory_capacity_postgres_test.ts` sets the 500 ms /
250 ms ceilings on the repository call alone, so it excludes the ~11 ms of
BEQ-04 overhead; the 51 to 91 ms above sit inside them. `pg_stat_user_indexes`:
`people_active_name_idx` 0 scans.

**Impact.** Within every ceiling at 10,000 people; linear growth, and the
quick-capture person picker uses the default sort with `starredFirst`.
`last-contacted` is the one order that is O(history) (250,000 rows at large).

**Recommendation.** In v13 replace `people_active_name_idx` with the expression
index above (the ORDER BY and seek must use the same expressions), optionally
one for `family-name`. For `last-contacted`, keep the current query until a
measured need, then maintain a projection (a `person_last_contact` table updated
by the interaction use cases' publisher port, or a trigger) so the order is an
index read; this respects module ownership because the directory read model
would own the projection.

### BEQ-11 Global search cost is independent of hit count; common terms are slow

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:** `read-models/search/adapters/postgres/search_repository.ts:175-233`
  (people), `:242-371` (text); `name_match.ts:22-50`;
  `packages/contracts/schemas/name_search.ts` (42 fold steps).

**What happens.** The people arm is
`strpos(lower(concat_ws(...)), lower(q)) > 0` OR an
`exists (select 1 from unnest(forms) ...)` whose expression applies 42 nested
`replace()` calls to every candidate row for each of the query's forms (2 in the
examples). It is a sequential scan of the workspace's people for every
keystroke, whatever the query. The text arm uses the GIN indexes correctly and
is bounded by `statement_timeout`, but it computes `clipped(...)` (a window and
`strpos` over each body) and the participant name for every matching row before
the `row_number() ... LIMIT`.

**Evidence.** Large profile, plan time per statement:

| query            | people statement | text statement |
| ---------------- | ---------------: | -------------: |
| `zzyzx` (no hit) |          27.2 ms |            n/a |
| `dinner` (3k)    |          27.5 ms |        12.4 ms |
| `coffee`         |          26.9 ms |         9.1 ms |
| `lorem` (30k)    |          25.9 ms |        75.3 ms |
| `lorem ipsum`    |          25.9 ms |        77.8 ms |

The filter evaluates the 42-replace expression 9,520 times with 2 forms. Tenant
coupling of the GIN indexes was checked: a 60,000-hit term owned by another
workspace costs 2.9 ms through a BitmapAnd with the workspace index.

**Impact.** About 26 ms of database time per palette or quick-capture keystroke
at 10,000 people (linear); a common word costs up to 75 ms. Within budget today.

**Recommendation.** Evaluate the fold once per row (a LATERAL or CTE) instead of
per form, and skip the folded arm when the query is plain ASCII and the
workspace has no non-Latin names. If the corpus grows, add (v13) an immutable
wrapper function over `concat_ws`, a stored `name_search`/`name_fold` generated
column and a `pg_trgm` GIN index on it. For the text arm take the top `limit`
ids by rank first and compute the snippets for those rows only.

### BEQ-12 Index inventory: unused, redundant, missing, write amplification

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:** `personal_crm_schema_v12.sql` (lines in the table).

**Evidence.** `pg_stat_reset()` after loading, then a sweep of 68 GET endpoints
three times, about 100 mutations (people, dates with reminders, notes, calls,
tasks, stars, cadences, a relationship, archive and restore), one sign-in, one
calendar feed read and two worker replenish cycles. Non-unique indexes with
`idx_scan = 0` at the large profile:

| index (schema line)                           |    rows | reading                                             |
| --------------------------------------------- | ------: | --------------------------------------------------- |
| `calls_workspace_date_idx` (1153)             | 125,000 | 9.5 MB; only lifecycle impact counts and cascades   |
| `conversation_threads_workspace_idx` (1189)   |  25,000 | 2.9 MB; same reading                                |
| `reminder_occurrences_member_idx` (1523)      |  80,817 | 1.9 MB; matches every row of the only member        |
| `person_contact_methods_normalized_idx` (837) |  15,070 | 1.3 MB; the duplicate finder never reads the column |
| `people_active_name_idx` (682)                |  10,000 | 0.6 MB; matches no query (BEQ-10)                   |
| `reminder_occurrences_due_idx` (1521)         |  80,817 | defeated by the claim query shape (BEQ-08)          |
| `person_dates_person_idx` (790)               |   8,369 | redundant: prefix of `person_dates_person_kind_idx` |
| `people_workspace_idx` (680)                  |  10,000 | redundant: prefix of `people_workspace_id_id_key`   |
| `person_contact_methods_type_idx` (836)       |  15,070 | FK helper only                                      |
| `person_dates_month_day_idx` (792)            |   8,369 | not chosen by the Today calendar join at this size  |

Also never scanned, all small: the low-selectivity status indexes
`users_status_idx` (232), `workspaces_status_idx` (255),
`workspace_members_status_idx` (287), `gifts_status_idx` (1657) and
`debts_status_idx` (1760); and the workspace FK helpers
`journal_posts_workspace_date_idx` (1258), `tasks_workspace_status_idx` (1383),
`reminders_workspace_active_idx` (1453), `reminders_anchor_idx` (1455),
`life_events_workspace_date_idx` (1345) and `relationships_workspace_idx`
(1602).

**Missing.** Foreign keys without a leading index that matter on a hot path:
`reminders.person_date_id`. Every birthday edit or delete looks the reminder up
by that column (`... where person_date_id = $1 ... for update`), a sequential
scan of all 7,347 reminders at large (1.69 ms, `Rows Removed by Filter: 7346`)
against 0.06 ms with
`create index on reminders (person_date_id) where person_date_id is not null`
(measured); `life_event_id` and `task_id` are the same shape. Other unindexed
foreign keys (`audit_events.actor_member_id`, the `created_by_member_id`
columns, `conversation_threads.channel_type_id` and `contact_method_id`) are
only touched when a member or contact method is deleted.

**Write amplification.** Index-to-heap ratios at large: `calls` 1.29 (3
indexes), `reminder_occurrences` 1.14 (6 indexes, 25 MB of indexes on 22 MB of
heap), `conversation_threads` 1.57, `people` 1.57 (5 indexes), `person_dates`
1.90, `tasks` 1.97. Inserting 300,000 occurrences into a copy with all six
indexes versus only the primary key and the two unique ones took 3.23 s versus
2.77 s (-14 percent) and wrote 223 MB versus 179 MB of WAL (-20 percent): the
three non-unique indexes cost a seventh of insert time and a fifth of WAL on the
hottest write table. Each birthday creates eight such rows.

**Recommendation (v13).** Add: `notes_workspace_created_idx`, the two partial
`reminder_occurrences` indexes (BEQ-07), the `people` sort expression index,
`reminders (person_date_id)`. Drop: `people_workspace_idx`,
`people_active_name_idx`, `person_dates_person_idx`,
`reminder_occurrences_member_idx` (after BEQ-07),
`person_contact_methods_normalized_idx` (or use it in the duplicate finder), the
five status indexes. Net: 5 added, 10 dropped. Validate
`calls_workspace_date_idx` and `conversation_threads_workspace_idx` against the
workspace reset and delete paths first (Suspected, needs confirmation). Per
AGENTS.md this is a new synchronized schema version, not an ad hoc migration.

### BEQ-13 Casts and expressions defeat indexes in two smaller paths

- **Severity:** Low
- **Status:** Verified (dynamic).
- **Where:**
  `read-models/today/adapters/postgres/today_recent_people_repository.ts:63`
  (`join crm.people person on person.id::text = recent.person_id`),
  `modules/people/adapters/postgres/people_repository.ts:42` (duplicate-name
  check on create).

**What happens.** The recent-people join casts the indexed uuid to text, so the
8-element lookup becomes a hash join over a sequential scan of `people`. The
create-person duplicate check compares `lower(btrim(given_name))`,
`lower(btrim(coalesce(family_name,'')))`, `lower(btrim(coalesce(nickname,'')))`,
which matches no index, so it is also a sequential scan.

**Evidence.** `EXPLAIN` at large, three runs each: recent people with the repo
shape 6.9 to 7.2 ms (Seq Scan on `people`, 9,894 rows, 191 buffers) against the
typed `unnest(...::uuid[])` join 0.08 to 0.11 ms (8 probes of
`people_workspace_id_id_key`, 24 buffers), about 70 times faster; at 250 people
both are 0.2 ms. `POST /api/v1/people` pays a 1.6 ms Seq Scan (191 buffers,
10,003 rows removed) for the duplicate check.

**Impact.** Small today; both are O(people) for what should be O(1).

**Recommendation.** Cast the array, not the column (`::uuid[]`). For the
duplicate check add, with the v13 sort index, a partial expression index on the
three exact expressions, or compare on a precomputed normalized column.

### BEQ-14 Calendar feed: a 304 still pays the full query and render

- **Severity:** Info
- **Status:** Verified (dynamic).
- **Where:**
  `read-models/calendar-feed/adapters/postgres/calendar_feed_repository.ts:92-190`,
  `GET /api/v1/calendar-feeds/{feedFile}`.

**Evidence.** Large profile: 13 round trips and 7 statements per poll (token
lookup, conditional `last_used_at` update, revalidate, the feed statement inside
a read-only transaction with a 1,500 ms statement timeout); the feed statement
runs 21.1 ms and the response is 824 KB (2,000 events). A request with
`If-None-Match` answers 304 but still executes the statement every time
(`pg_stat_statements` calls 6 for 1 plain and 5 conditional polls) and takes 105
to 131 ms against 160 to 182 ms for a full answer.

**Impact.** Calendar apps poll every 5 to 60 minutes; low volume. The ETag saves
bandwidth, not database or CPU work.

**Recommendation.** If feeds become popular, derive a cheap validator (max
`updated_at` over the member's dates and occurrences, plus the day) so a 304
skips the render; otherwise leave as is.

### BEQ-15 Unbounded tables, untuned PostgreSQL, random UUID keys

- **Severity:** Info
- **Status:** Verified (dynamic), code read.

- **No retention.** Nothing deletes expired or revoked `user_sessions`, old
  `api_request_logs` (one or two rows per sign-in attempt) or sent
  `reminder_occurrences`; `grep` finds no pruning outside account deletion
  (`identity/adapters/postgres/personal_lifecycle.ts:54-58`). Sent occurrences
  are what drive BEQ-07.
- **Defaults.** `compose.yaml` runs stock PostgreSQL 18.4: `shared_buffers` 128
  MB, `work_mem` 4 MB, `random_page_cost` 4 (an SSD wants about 1.1), no
  `pg_stat_statements`, no `log_min_duration_statement`, although
  `docs/architecture/observability.md:63` lists "query duration buckets". The
  statement-level evidence in this report needed `pg_stat_statements` and
  `auto_explain`; consider enabling `pg_stat_statements` in the production
  image.
- **Random primary keys.** Every id is a v4 UUID (`gen_random_uuid()` /
  `crypto.randomUUID()`). A 1,000,000-row insert benchmark on this PostgreSQL
  18.4 (primary key plus a `(workspace_id, at desc)` index): v4 3.1 s, 263 MB
  WAL, 38 MB key; `uuidv7()` 2.1 s, 249 MB WAL, 30 MB key (-33 percent time, -21
  percent key size). For append-heavy tables (`audit_events`, `calls`,
  `messages`, `notes`, `reminder_occurrences`) generating v7 ids is a cheap win
  in v13.

## Per-endpoint database cost (large profile)

`RT` = database round trips (BEGIN and COMMIT included) counted in the Postgres
log for one request; the fixed overhead is 23 for a read of one statement. The
last column is the heaviest statement's time from `auto_explain` (hot unless
noted).

| endpoint                                               |      RT | heaviest statement        |
| ------------------------------------------------------ | ------: | ------------------------- |
| `GET /session`                                         |      16 | none                      |
| `GET /member/ui-state`                                 |      24 | none                      |
| `GET /people` (given-name / family-name)               |      24 | 10.2 ms                   |
| `GET /people` (recently-added / recently-updated)      |      24 | 3.2 / 6.4 ms              |
| `GET /people?sort=last-contacted`                      |      24 | 90.9 ms cold, 51.6        |
| `GET /people?search=` (Latin / Cyrillic)               |      24 | 16.8 / 28.2 ms            |
| `GET /people?tag=` , tag-facet                         |      24 | 4.3 , 4.5 ms              |
| `GET /people/duplicates`                               |      24 | 58.4 ms (own page)        |
| `GET /today/attention`                                 |      27 | 37.8 ms                   |
| `GET /today/reminders`                                 |      26 | 21.7 ms                   |
| `GET /today/tasks`, `favorite-notes`, `recent-people`  |   24-26 | below 6 ms                |
| `GET /today/recent-activity`                           |      24 | 227.5 ms                  |
| `GET /notifications`                                   |      26 | 19.9 + 1.6 ms             |
| `GET /search?q=`                                       |      33 | 27 + 12 to 75 ms          |
| `GET /people/{id}` (+`?include=summary`)               |      24 | 1.8 ms (8.6 heavy)        |
| `GET /people/{id}/timeline`                            |      25 | 1.3 ms (7.5 heavy)        |
| `.../dates`, `/life-events`, `/files`                  |   24-25 | below 1 ms                |
| `.../facts/{section}`                                  |   27-28 | below 1 ms                |
| `.../relationships`                                    |      32 | below 1 ms + lock         |
| `.../reminders`, `/communications`, `/activity-report` |   25-27 | 1.9 ms max                |
| `.../gifts` (gifts, debts, recurring debts)            |      29 | below 1 ms                |
| `GET /relationship-types`                              |      30 | below 1 ms + lock         |
| `GET /tasks` , `/journal` , `/audit-events`            |      25 | 6.0 , 0.6 , 0.8 ms        |
| `GET /calendar-feeds/{file}` (no session)              |      13 | 21.4 ms                   |
| `POST /people` , `POST /interactions` (note)           | 28 , 33 | 1.6 ms duplicate check    |
| `POST /people/{id}/dates` (birthday)                   |      35 | below 1 ms                |
| `POST /sessions` (sign-in)                             |      17 | advisory lock per subject |

A "heavy" person in this table has 5,000 calls, 3,000 notes and 800
conversations of 6 messages each.

## Checked and sound

- **Pagination.** Every collection I traced is keyset-based (directory,
  notifications, timeline, audit, activity report, tasks); no `OFFSET`, no
  `COUNT(*)` over a large set (the unread badge is capped by `LIMIT 100`, the
  tag facet is a grouped read of a bounded join). Directory continuation
  re-reads one anchor row, an acceptable second statement.
- **Bounded result sets.** The largest rows per call over the whole sweep: the
  static currency list (165) and the Today reminders cap (100); everything else
  is at most 51. The calendar feed is capped at 2,000 events.
- **No N+1 on reads.** The directory chooses the page on sort keys alone and
  draws avatars and tag previews for those rows
  (`people_directory_repository.ts:361-363`); profile, timeline, communications,
  and report statements are single set-based statements. Row-by-row loops exist
  only in the worker (BEQ-01), one-off registration vocabulary seeding, and
  imports bounded to 500 people.
- **Per-person aggregates are index-backed.** For a person with 5,000 calls,
  3,000 notes, 800 conversations and 4,800 messages: profile with summary 8.6
  ms, timeline 7.5 ms, communications 1.9 ms, activity report 1.5 ms
  (`calls_person_date_idx`, `notes_person_idx`,
  `conversation_threads_person_idx`, `messages_conversation_idx`).
- **Tags.** Tag-filtered directory 4.3 ms and tag facet 4.5 ms at 10,000 people
  and 10,463 tag links.
- **Audit history** uses `audit_events_workspace_time_idx` and
  `audit_events_person_idx` (0.8 ms for a filtered page).
- **Writes** are bounded (28 to 35 round trips) and set-based: a birthday
  inserts its reminder and its eight occurrences in one statement
  (`planning/adapters/postgres/person_date_reminders.ts:188`), then an audit
  event and postcondition checks in the same transaction.
- **Worker claim safety.** `FOR UPDATE ... SKIP LOCKED` with a lease and token
  (`reminder_repository.ts:1144,1169`), idempotency keys per occurrence, claims
  finalized per occurrence; the replenish problems are about cost and locks, not
  double delivery.
- **Search and feed bounds.** Read-only transactions with transaction-local
  `statement_timeout` (1,500 ms) on search and the calendar feed.
- **Conditional presence write.** The API-token path updates `last_used_at` only
  when stale (`api-access`), the pattern BEQ-05 recommends for sessions.
- **Sign-in** costs 17 round trips with one advisory lock per (address, subject)
  bucket and throttle rows in `api_request_logs`; fine.
- **Session table hygiene under update.** 99.7 percent of session UPDATEs were
  HOT, so the per-request write does not bloat `user_sessions` or its indexes.

## Reproduction

The probes lived in a scratch folder; the essentials follow.

**1. Private stack** (do not use the shared `kinship-audit` project). Copy the
shared env file, change the project name, database names and gateway port to
`kinship-audit-db`, `kinship_audit_db` and `18444`, and add this override:

```yaml
services:
  postgres:
    command:
      - postgres
      - -c
      - shared_preload_libraries=pg_stat_statements
      - -c
      - pg_stat_statements.track=all
      - -c
      - compute_query_id=on
      - -c
      - track_io_timing=on
      - -c
      - log_statement=all
      - -c
      - "log_line_prefix=%m [%p] %a %x "
  migrate: { image: kinship-audit-migrate:latest, pull_policy: never }
  api:
    image: kinship-audit-api:latest
    pull_policy: never
    environment: { PGAPPNAME: api }
  worker:
    image: kinship-audit-worker:latest
    pull_policy: never
    environment: { PGAPPNAME: worker }
  web: { image: kinship-audit-web:latest, pull_policy: never }
  gateway: { image: kinship-audit-gateway:latest, pull_policy: never }
```

```sh
docker compose --env-file beq.env -p kinship-audit-db \
  -f compose.yaml -f compose.test.yaml -f beq.override.yaml up -d --no-build --wait
psql() { docker compose ... exec -T postgres psql -U kinship_audit_db -d kinship_audit_db -X "$@"; }
psql -c "create extension pg_stat_statements"
psql -c "alter system set pg_stat_statements.track_planning = on" -c "select pg_reload_conf()"
psql -c "alter role kinship_audit_db set session_preload_libraries = 'auto_explain'" \
     -c "alter role kinship_audit_db set auto_explain.log_min_duration = 0" \
     -c "alter role kinship_audit_db set auto_explain.log_analyze = on" \
     -c "alter role kinship_audit_db set auto_explain.log_buffers = on"
docker compose ... restart api      # new connections pick up the role settings
```

Create an account through the gateway (registration, Mailpit token,
`/api/v1/sessions`, legal acceptance) exactly as the shared helper `account.ts`
does, with its origin changed to `https://127.0.0.1:18444`.

**2. Statements of one request** (bracket with marker statements):

```sh
PG=kinship-audit-db-postgres-1; n=$RANDOM
q() { docker exec -i $PG psql -U kinship_audit_db -d kinship_audit_db -X -At -c "$1" >/dev/null; }
q "select 'BEQ_MARK_START_$n'"
curl -sk -H "Cookie: $COOKIE" "https://127.0.0.1:18444/api/v1/people?limit=20" >/dev/null
sleep 0.3; q "select 'BEQ_MARK_END_$n'"
docker logs --since 5m $PG 2>&1 | awk "/BEQ_MARK_START_$n/{p=1;next} /BEQ_MARK_END_$n/{p=0} p" |
  grep -E ' api [0-9]+ LOG:  (statement|execute)'
```

Count lines (BEGIN/COMMIT included) for `RT`; the `plan:` entries of
`auto_explain` for the same window give every plan with real timings.

**3. Server-side cost per request:**

```sql
select pg_stat_statements_reset();
-- N sequential identical requests (keep-alive client inside the api container)
select sum(calls)/:N calls, sum(total_exec_time)/:N exec_ms,
       sum(total_plan_time)/:N plan_ms, sum(wal_bytes)/:N wal_bytes,
       sum(wal_records)/:N wal_records
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
  and query not ilike '%pg_stat%';
```

The latency client is a 40-line Deno script (fetch against
`http://127.0.0.1:8000` with the session cookie, N requests over C concurrent
workers, percentiles of wall time) piped into the API container:

```sh
cat bench.ts | docker exec -i -e BEQ_COOKIE="$COOKIE" kinship-audit-db-api-1   deno run --allow-net --allow-env - --n 400 --c 1 /api/v1/member/ui-state
```

**4. Data.** The seed script is reproduced in the appendix below. Run it with
the workspace and owner member ids of the registered account:

```sh
cat seed.sql | psql ... -v ws=<workspace-uuid> -v member=<member-uuid>   -v people=10000 -v calls=125000 -v threads=25000 -v msgs=100000   -v notes=30000 -v acts=15000 -v audit=40000 -v journal=3000 -v tasks=5000 -f -
# medium: people=2000 calls=25000 threads=5000 msgs=20000 notes=6000 acts=3000
#         audit=8000 journal=600 tasks=1000
```

Its heart is the birthday block, which creates the reminder the application
creates for each date and its occurrences:

```sql
with d as (insert into crm.person_dates (person_id, kind, year, month, day, precision)
           select person_id, 'birthday', year, month, day, 'full' from seed_birthdays
           returning id, person_id, month, day),
r as (insert into crm.reminders (workspace_id, person_id, person_date_id,
        target_kind, title, anchor_on, recurrence_unit, recurrence_interval,
        is_active, created_by_member_id)
      select :'ws', d.person_id, d.id, 'person_date', 'Birthday',
        case when make_date(extract(year from now())::int, d.month, d.day) >= current_date
             then make_date(extract(year from now())::int, d.month, d.day)
             else make_date(extract(year from now())::int + 1, d.month, d.day) end,
        'year', 1, true, :'member' from d returning id, anchor_on)
insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on, deliver_at,
  lead_time_days, channel, status, title_snapshot, body_snapshot, sent_at,
  provider_result_state, provider_receipt, provider_effect_at, visible_at)
select r.id, :'member', (r.anchor_on + k * interval '1 year')::date,
  ((r.anchor_on + k * interval '1 year')::date + time '12:00') at time zone 'UTC',
  0, 'in_app', case when k < 0 then 'sent' else 'pending' end, 'Birthday',
  'Reminder for Birthday', /* sent rows: sent_at = visible_at = provider_effect_at = deliver_at,
  provider_result_state 'confirmed', provider_receipt 'seed' */ ...
from r cross join generate_series(-3, 7) k;
```

then calls, threads and messages (the shapes of the repo's capacity test),
notes, activities with 1 to 3 participants, journal posts and items, tasks (half
open, due -30..+60 days), life events, cadences for 10 percent of people, audit
events, tags (`person_tags` for 60 percent of people), then `VACUUM (ANALYZE)`.
Stop the worker while seeding or deleting (a bulk delete deadlocked against the
worker once).

**5. Experiments** (run on the large data,
`EXPLAIN (ANALYZE, BUFFERS,
COSTS OFF)`; indexes were created in the throwaway
database and dropped):

```sql
create index exp_notes on crm.notes (workspace_id, created_at desc, id desc);
create index exp_feed on crm.reminder_occurrences (member_id, visible_at desc, id desc)
  where channel = 'in_app' and status = 'sent' and visible_at is not null;
create index exp_open on crm.reminder_occurrences (member_id,
  (case when status = 'retry' then next_attempt_at else deliver_at end))
  where status in ('pending','retry','failed','manual_attention');
create index exp_name on crm.people (workspace_id,
  (lower(coalesce(nullif(btrim(given_name),''), nullif(btrim(nickname),''),
     nullif(btrim(family_name),''),''))), (lower(coalesce(family_name,''))), id)
  where archived_at is null and deleted_at is null;
```

and the rewritten Today recent-activity statement (BEQ-06): activities arm
`order by happened_at desc, id desc limit 20`, notes arm
`... exists (select 1 from crm.people ...) order by created_at desc, id desc
limit 20`,
laterals on the survivors, final `order by happened_at desc, id desc
limit 20`.

**6. Worker.** `docker compose ... start worker`, then after 90 s read
`pg_stat_statements` for `insert into crm.reminder_occurrences%` (statement
count) and `select setting.workspace_id%` (ticks started). Blocking probe: while
the worker transaction is older than 3 s, send `POST /api/v1/people/{id}/view`
(cookie, `Origin: https://127.0.0.1:18444`) and read `pg_blocking_pids(pid)`
from `pg_stat_activity` for the waiting backend. Crash probe:
`select pg_terminate_backend(pid) from pg_stat_activity where
application_name = 'worker' and state <> 'idle'`,
then `docker inspect -f '{{.RestartCount}}'` on the worker container.

Tear the private project down with
`docker compose ... -p kinship-audit-db down
-v` when finished.

## Appendix: seed script

<details>
<summary>seed.sql (psql, about 200 lines)</summary>

```sql
-- BEQ bulk seed: one workspace, "medium"/"large" profile of
-- docs/planning/mvp-capacity-profile.json plus the rows a real workspace has
-- (tags, contact methods, birthdays WITH their reminder + 8 future
-- occurrences + 3 years of sent history, relationships, notes, activities,
-- calls, conversations, tasks, life events, cadences, audit events, journal).
--
-- psql -v ws=<uuid> -v member=<uuid> -v people=2000 -v calls=25000 \
--   -v threads=5000 -v msgs=20000 -v notes=6000 -v acts=3000 -v audit=8000 \
--   -v journal=600 -v tasks=1000 -f seed.sql
\set ON_ERROR_STOP on
set log_statement = 'none';
select setseed(0.42);
\timing on

create temporary table seed_people as
with given as (select string_to_array(
  'James,Mary,John,Patricia,Robert,Jennifer,Michael,Linda,William,Elizabeth,David,Barbara,Richard,Susan,Joseph,Jessica,Thomas,Sarah,Charles,Karen,Elena,Dmitri,Natalia,Ivan,Olga,Sergey,Tatiana,Andrei,Yulia,Mikhail',
  ',') as g),
fam as (select string_to_array(
  'Smith,Johnson,Williams,Brown,Jones,Garcia,Miller,Davis,Rodriguez,Martinez,Hernandez,Lopez,Gonzalez,Wilson,Anderson,Thomas,Taylor,Moore,Jackson,Martin,Lee,Perez,Thompson,White,Harris,Ivanov,Petrov,Sidorov,Smirnov,Kuznetsov',
  ',') as f)
select i as n, gen_random_uuid() as id,
  (select g[1 + (i * 37 + i / 11) % array_length(g, 1)] from given) as given_name,
  (select f[1 + (i * 53 + i / 7) % array_length(f, 1)] from fam) as family_name,
  now() - (random() * interval '1095 days') as created_at,
  random() as r1, random() as r2, random() as r3
from generate_series(1, :people) i;

insert into crm.people (id, workspace_id, created_by_member_id, given_name,
  middle_name, family_name, nickname, description, is_partial, is_starred,
  archived_at, deleted_at, created_at, updated_at)
select id, :'ws'::uuid, :'member'::uuid, given_name,
  case when r1 < 0.1 then 'Mid' || (n % 20) end,
  family_name,
  case when r2 < 0.2 then 'Nick' || (n % 300) end,
  case when r3 < 0.3 then 'Met at event ' || n end,
  r1 > 0.97, r2 > 0.98,
  case when r3 > 0.96 then created_at + interval '30 days' end,
  case when r1 < 0.01 then created_at + interval '60 days' end,
  created_at, created_at + (random() * interval '700 days')
from seed_people;

-- vocabulary
insert into crm.contact_method_types (workspace_id, name, kind, protocol, is_system)
values (:'ws', 'Email', 'email', 'mailto', true), (:'ws', 'Phone', 'phone', 'tel', true)
on conflict do nothing;
insert into crm.tags (workspace_id, name, slug)
select :'ws', 'Tag ' || lpad(i::text, 2, '0'), 'tag-' || lpad(i::text, 2, '0')
from generate_series(1, 25) i on conflict do nothing;
insert into crm.activity_type_categories (workspace_id, name) values (:'ws', 'Seed category');
insert into crm.activity_types (workspace_id, category_id, name)
select :'ws', (select id from crm.activity_type_categories where workspace_id = :'ws'::uuid limit 1), 'Seed type ' || i
from generate_series(1, 6) i;

-- tags: skewed popularity, 1-3 per person for ~60% of people (deterministic)
create temporary table seed_tags as
select row_number() over (order by name) as k, id from crm.tags where workspace_id = :'ws'::uuid;
insert into crm.person_tags (person_id, tag_id)
select p.id, t.id
from seed_people p
cross join generate_series(1, 3) j
join seed_tags t on t.k = 1 + (floor(power(((abs(hashtext(p.id::text || j::text)) % 1000) / 1000.0), 2) * 25))::int
where (abs(hashtext(p.id::text)) % 10) < 6
  and (j = 1 or (abs(hashtext(p.id::text || 'x' || j::text)) % 10) < 4)
on conflict do nothing;

-- contact methods
insert into crm.person_contact_methods (person_id, type_id, value, normalized_value, is_primary, sort_order)
select p.id, (select id from crm.contact_method_types where workspace_id = :'ws'::uuid and kind = 'email'),
  'user' || p.n || '@example.test', 'user' || p.n || '@example.test', true, 0
from seed_people p where p.r1 < 0.8;
insert into crm.person_contact_methods (person_id, type_id, value, normalized_value, is_primary, sort_order)
select p.id, (select id from crm.contact_method_types where workspace_id = :'ws'::uuid and kind = 'phone'),
  '+1555' || lpad(p.n::text, 7, '0'), '1555' || lpad(p.n::text, 7, '0'), true, 1
from seed_people p where p.r3 < 0.7;

-- birthdays (75% of people), the reminder the app creates for each, its 8
-- future yearly occurrences (as `replenish` keeps them) and 3 sent years.
create temporary table seed_birthdays as
select p.id as person_id, 1950 + (p.n % 55) as year, 1 + (p.n * 7) % 12 as month,
  1 + (p.n * 13) % 28 as day
from seed_people p where p.r2 < 0.75 and p.r1 >= 0.01;
with d as (
  insert into crm.person_dates (person_id, kind, year, month, day, precision)
  select person_id, 'birthday', year, month, day, 'full' from seed_birthdays
  returning id, person_id, month, day
), r as (
  insert into crm.reminders (workspace_id, person_id, person_date_id, target_kind,
    title, anchor_on, recurrence_unit, recurrence_interval, is_active, created_by_member_id)
  select :'ws'::uuid, d.person_id, d.id, 'person_date', 'Birthday',
    case when make_date(extract(year from now())::int, d.month, d.day) >= current_date
      then make_date(extract(year from now())::int, d.month, d.day)
      else make_date(extract(year from now())::int + 1, d.month, d.day) end,
    'year', 1, true, :'member'::uuid
  from d returning id, anchor_on
)
insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on, deliver_at,
  lead_time_days, channel, status, title_snapshot, body_snapshot, sent_at,
  provider_result_state, provider_receipt, provider_effect_at, visible_at, attempt_count)
select r.id, :'member'::uuid, (r.anchor_on + k * interval '1 year')::date,
  ((r.anchor_on + k * interval '1 year')::date + time '12:00') at time zone 'UTC',
  0, 'in_app', case when k < 0 then 'sent' else 'pending' end, 'Birthday', 'Reminder for Birthday',
  case when k < 0 then ((r.anchor_on + k * interval '1 year')::date + time '12:00') at time zone 'UTC' end,
  case when k < 0 then 'confirmed' else 'unattempted' end,
  case when k < 0 then 'seed-receipt' end,
  case when k < 0 then ((r.anchor_on + k * interval '1 year')::date + time '12:00') at time zone 'UTC' end,
  case when k < 0 then ((r.anchor_on + k * interval '1 year')::date + time '12:00') at time zone 'UTC' end,
  case when k < 0 then 1 else 0 end
from r cross join generate_series(-3, 7) k;

-- first_met / custom dates for a few
insert into crm.person_dates (person_id, kind, label, year, month, day, precision)
select id, 'custom', 'Anniversary', null, 1 + n % 12, 1 + n % 28, 'month_day'
from seed_people where r3 < 0.1;

-- relationships
insert into crm.relationships (workspace_id, from_person_id, to_person_id, relationship_type_id)
select distinct on (a.id, b.id, t.id) :'ws'::uuid, a.id, b.id, t.id
from seed_people a
join seed_people b on b.n = 1 + (a.n * 31 + 17) % :people and b.id <> a.id
join lateral (select id from crm.relationship_types where workspace_id = :'ws'::uuid order by id offset (a.n % 20) limit 1) t on true
where a.r2 < 0.5;

-- notes (a person who is not deleted)
create temporary table live_people as
select row_number() over (order by n) as pk, id from seed_people where r1 >= 0.01;
select count(*) as live_people from live_people \gset
insert into crm.notes (workspace_id, person_id, body, is_favorited, favorited_at, created_by_member_id, created_at, updated_at)
select :'ws'::uuid, lp.id,
  'Note ' || i || ' about ' || (array['coffee','dinner plans','a new job','the kids','moving cities','book recommendation','birthday gift idea','holiday trip','health update','project news'])[1 + i % 10]
    || '. ' || repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', 1 + i % 8),
  (i % 33 = 0), case when i % 33 = 0 then now() end, :'member'::uuid,
  now() - (random() * interval '1095 days'), now()
from generate_series(1, :notes) i
join live_people lp on lp.pk = 1 + (i * 7919) % :live_people;

-- activities with 1-3 participants
create temporary table seed_acts as
select i, gen_random_uuid() as id, now() - (random() * interval '1095 days') as happened_at
from generate_series(1, :acts) i;
insert into crm.activities (id, workspace_id, activity_type_id, summary, description, happened_at, created_by_member_id)
select a.id, :'ws'::uuid, (select id from crm.activity_types where workspace_id = :'ws'::uuid order by id offset a.i % 6 limit 1),
  'Activity ' || a.i || ' ' || (array['lunch','hike','movie','call','trip','game night'])[1 + a.i % 6],
  case when a.i % 3 = 0 then 'Details of activity ' || a.i || '. ' || repeat('We talked for a long time. ', 1 + a.i % 5) end,
  a.happened_at, :'member'::uuid
from seed_acts a;
insert into crm.activity_participants (activity_id, person_id)
select a.id, lp.id
from seed_acts a cross join generate_series(1, 3) j
join live_people lp on lp.pk = 1 + (a.i * 104729 + j * 6007) % :live_people
where j = 1 or (j = 2 and a.i % 2 = 0) or (j = 3 and a.i % 5 = 0)
on conflict do nothing;

-- calls / threads / messages
insert into crm.calls (workspace_id, person_id, called_at, contact_was_caller, content, created_by_member_id)
select :'ws'::uuid, lp.id, now() - ((i * 13) % 500000 || ' minutes')::interval, i % 2 = 0,
  case when i % 4 = 0 then 'Call notes ' || i end, :'member'::uuid
from generate_series(1, :calls) i
join live_people lp on lp.pk = 1 + (i::bigint * 7919) % :live_people;
create temporary table seed_threads as
select i, gen_random_uuid() as id, lp.id as person_id, now() - ((i * 17) % 500000 || ' minutes')::interval as happened_at
from generate_series(1, :threads) i
join live_people lp on lp.pk = 1 + (i::bigint * 104729) % :live_people;
insert into crm.conversation_threads (id, workspace_id, person_id, happened_at, title)
select id, :'ws'::uuid, person_id, happened_at, 'Thread ' || i from seed_threads;
insert into crm.messages (conversation_id, content, written_at, direction)
select t.id, 'Hello ' || j, t.happened_at + (j || ' minutes')::interval,
  case when j % 2 = 0 then 'outbound' else 'inbound' end
from seed_threads t
cross join generate_series(1, greatest(1, :msgs / greatest(:threads, 1))) j;

-- journal posts + items
create temporary table seed_posts as
select i, gen_random_uuid() as id, now() - (random() * interval '1095 days') as occurred_at
from generate_series(1, :journal) i;
insert into crm.journal_posts (id, workspace_id, title, body, occurred_at, created_by_member_id)
select id, :'ws'::uuid, 'Post ' || i, 'Journal entry ' || i || '. ' || repeat('Today was a good day. ', 1 + i % 12), occurred_at, :'member'::uuid
from seed_posts;
insert into crm.journal_items (workspace_id, occurred_at, journal_post_id, created_by_member_id)
select :'ws'::uuid, occurred_at, id, :'member'::uuid from seed_posts;
insert into crm.journal_items (workspace_id, occurred_at, activity_id, created_by_member_id)
select :'ws'::uuid, happened_at, id, :'member'::uuid from seed_acts where i % 10 = 0;

-- tasks: ~50% open (due -30d..+60d), rest completed/cancelled
insert into crm.tasks (workspace_id, person_id, title, description, status, due_at, completed_at, created_by_member_id, created_at, updated_at)
select :'ws'::uuid, case when i % 3 = 0 then null else lp.id end,
  'Task ' || i || ' ' || (array['call','email','buy gift','plan visit','send card'])[1 + i % 5],
  case when i % 4 = 0 then 'Task description ' || i end,
  case when i % 10 < 5 then 'open' when i % 10 < 9 then 'completed' else 'cancelled' end,
  case when i % 10 < 5 then now() + ((i % 90) - 30 || ' days')::interval
       when i % 3 = 0 then now() - ((i % 400) || ' days')::interval end,
  case when i % 10 >= 5 and i % 10 < 9 then now() - ((i % 300) || ' days')::interval end,
  :'member'::uuid, now() - ((i % 700) || ' days')::interval, now()
from generate_series(1, :tasks) i
left join live_people lp on lp.pk = 1 + (i * 31) % :live_people;

-- life events (full precision), cadences, gifts, debts
insert into crm.life_events (workspace_id, person_id, name, year, month, day, happened_at, precision)
select :'ws'::uuid, lp.id, 'Life event ' || e.k, extract(year from e.d)::int, extract(month from e.d)::int, extract(day from e.d)::int, e.d, 'full'
from (select k, now() - (random() * interval '1800 days') as d from generate_series(1, :people / 10) k) e
join live_people lp on lp.pk = 1 + (e.k * 17) % :live_people;
insert into crm.stay_in_touch_cadences (person_id, interval_count, interval_unit, next_due_at, last_contacted_at, is_active)
select lp.id, 1 + k % 6, (array['week','month'])[1 + k % 2],
  now() + (((k * 7) % 80) - 40 || ' days')::interval, now() - (((k * 5) % 200) || ' days')::interval, true
from generate_series(1, :people / 10) k
join live_people lp on lp.pk = 1 + (k * 41) % :live_people
on conflict do nothing;
insert into crm.gifts (workspace_id, person_id, name, status, event_at)
select :'ws'::uuid, lp.id, 'Gift ' || k, (array['idea','purchased','given'])[1 + k % 3], now() + ((k % 200) - 100 || ' days')::interval
from generate_series(1, :people / 20) k join live_people lp on lp.pk = 1 + (k * 23) % :live_people;
insert into crm.debts (workspace_id, person_id, direction, status, amount)
select :'ws'::uuid, lp.id, (array['i_owe','they_owe'])[1 + k % 2], 'open', 10 + k
from generate_series(1, :people / 25) k join live_people lp on lp.pk = 1 + (k * 29) % :live_people;

-- audit history
insert into crm.audit_events (workspace_id, actor_member_id, person_id, subject_type, subject_id, action, payload, occurred_at)
select :'ws'::uuid, :'member'::uuid, case when i % 3 = 0 then null else lp.id end,
  'person', lp.id,
  (array['people.created','people.updated','notes.created','tasks.completed','relationships.created','reminders.created','interactions.logged','people.starred'])[1 + i % 8],
  jsonb_build_object('sequence', i, 'summary', 'seed event'),
  now() - (random() * interval '1095 days')
from generate_series(1, :audit) i
join live_people lp on lp.pk = 1 + (i * 13) % :live_people;

drop table seed_people, seed_tags, seed_birthdays, live_people, seed_acts, seed_threads, seed_posts;
vacuum (analyze);
\timing off
```

</details>
