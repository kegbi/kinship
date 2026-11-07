# Architecture, security, and performance audit — 2026-11-07

This audit answers three questions about commit `bc8579ae`:

1. Is data fetched optimally, in number of requests to the backend, in database
   indexes, and in loading priorities?
2. Can a user bypass login, or reach another user's or workspace's data?
3. Are static generation (SSG), server rendering, and client-side (SPA-like)
   JavaScript used only where needed?

Five agents audited one area each, in parallel, against a production-built
Compose stack. The orchestrator then re-checked the High findings by hand (see
[Orchestrator re-checks](#orchestrator-re-checks)). The audit changed no
production code, tests, schema, or configuration. Each report below records its
method, evidence, and reproduction steps.

| Report                                                                                                 | Area                                                      | Findings (C/H/M/L/I) |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------- |
| [01-frontend-request-waterfall.md](01-frontend-request-waterfall.md)                                   | API requests per page, waterfalls, priorities             | 0/1/6/5/1            |
| [02-backend-queries-and-indexes.md](02-backend-queries-and-indexes.md)                                 | Request pipeline, SQL per request, indexes, worker        | 0/2/5/6/2            |
| [03-security-authentication-and-edge.md](03-security-authentication-and-edge.md)                       | Login bypass, sessions, credentials, CSRF, gateway, XSS   | 0/1/3/7/4            |
| [04-security-tenant-isolation-and-authorization.md](04-security-tenant-isolation-and-authorization.md) | Cross-workspace access, roles, tokens, database backstops | 0/0/4/5/2            |
| [05-frontend-rendering-strategy.md](05-frontend-rendering-strategy.md)                                 | SSG / SSR / islands, JavaScript cost, caching, Web Vitals | 0/1/5/6/4            |

The reports contain 70 findings. Four pairs describe the same root cause from
two angles, so there are 66 distinct findings: 0 Critical, 5 High, 22 Medium, 27
Low, and 12 Info. The merged pairs are FEQ-01 and FER-04, FEQ-07 and FER-07,
FEQ-12 and FER-08, and FEQ-13 and FER-11.

## Answers

### 1. Data fetching: requests, indexes, priorities

**Not optimal, but the causes are few and cheap to fix.** Most data reads are
small, parallel, and correctly lazy below the fold. Most of the waste is in the
application shell, in request scheduling, and in fixed per-request overhead.

- **Requests per page.** Today opens with 14 API requests (8 unique). The person
  workspace opens with 19 requests for an empty person and 25 for a rich one,
  the same as the August review measured. The empty search palette costs 9.
  Duplicate `GET /settings/preferences` calls make up **47% of all API
  requests** across 28 pages, 3 to 7 per page, from eight independent call sites
  with no shared memo (FEQ-01). Chromium serializes identical concurrent
  requests to a URL it cannot cache yet, so each duplicate adds a round trip.
  The critical path is the serial chain `session → preferences → data` (FEQ-02),
  and late islands bypass the session cache (FEQ-03).
  - Achievable budget: 2 shell requests per page (instead of 5 to 9), 7 for
    Today, and 4 to 5 for the person page. See the
    [01 report's budget table](01-frontend-request-waterfall.md#recommended-request-budget-after-the-fixes).
- **Per-request backend overhead.** Every authenticated request makes 23 to 24
  database round trips in 6 transactions before its handler runs its own query.
  This is about 10 ms of an 11 to 14 ms request. The legal guard and then the
  route each resolve the session, so it happens twice (BEQ-03). Reads also write
  (BEQ-05): `last_seen_at` updates, row locks, and vocabulary "ensure" calls.
  With `max: 8` connections per process, this caps throughput early.
- **Indexes.** These are mostly sound. Queries are set-based and keyset
  paginated, and the per-person paths use indexes. Two hot widgets scan whole
  histories:
  - Today's recent activity takes 227 ms at the large profile. A limit-first
    rewrite plus one index brings it to 1.1 ms (BEQ-06).
  - Notifications and Today attention scan all of `reminder_occurrences`. Two
    partial indexes take them from about 17 ms to 1.3 to 1.7 ms (BEQ-07).
  - About 20 non-unique indexes were never scanned during the exercised
    workload, and `reminders.person_date_id` has no index (BEQ-12).
  - The proposed schema v13 index set adds 5 indexes and drops 10. Per
    `AGENTS.md`, that must ship as a synchronized schema version.
- **Priorities.** There are no priority tiers (FEQ-09). The notifications,
  search, and quick-capture reads in the shell compete with the page's own data.
  The JavaScript module graph is a 7 to 8 level waterfall with no
  `modulepreload`, and the session request queues behind React's boot. On the
  throttled profile this is about 0.5 s of the 1.3 to 1.4 s the shell takes to
  appear (FER-02).
- **The largest backend problem is the worker, not the API.** Every 5 s tick
  tries again to insert the next eight occurrences of every recurring reminder,
  one statement per occurrence, although almost all of them already exist
  (BEQ-01). That is about 12,000 statements and 10 s per tick at 2,000 people,
  and about 58,800 statements and 40 s per tick at 10,000 people, even when
  nothing has changed. The same transaction holds `FOR SHARE` locks on
  `member_preferences` and `workspace_settings` throughout (BEQ-02). Routine
  user writes, such as recording a person view, wait for it and were observed
  returning 504 after 15 s. Neither fix needs a schema change.

### 2. Security: login bypass and access to other users' data

**No login bypass and no cross-workspace data access were found. One High
account-takeover flaw was found, and the database provides no backstop.**

- **Login bypass: none found.** All 156 registered routes were called in five
  credential states: no cookie, empty, malformed, unknown, and revoked. All 142
  protected routes refused every request without returning data. All 84
  cookie-authenticated unsafe routes reject a foreign, missing, or `null`
  `Origin`. The session design is strong:
  - Tokens are 256-bit, and only a hash is stored.
  - Cookies are `HttpOnly; Secure; SameSite=Strict`, with a 12-hour absolute
    lifetime.
  - Sign-in rotates the token, and invalidation happens on the server.
  - A password-only MFA session reaches only the MFA challenge.
- **Cross-workspace access: none found.** An attacker owner in workspace B sent
  964 requests carrying A's real ids. These covered 183 request builders: 122 of
  the 153 non-probe routes directly, and most of the rest through targeted
  scenarios. The 04 report lists the 10 authentication and own-identity routes
  that could not be exercised across tenants, and why. Variants included:
  - mixed-ownership bodies;
  - B's own API token;
  - `X-Workspace-Id` set to A;
  - forged cursors.

  Every request was refused. A before-and-after dump of all 657 rows that
  reference A's ids was identical. The static review covered about 825 SQL
  statements.
- **SECA-01 (High): a pre-registered password survives email verification.**
  - An attacker registers the victim's address with a password of their own
    choosing.
  - When the victim clicks the verification mail, the account becomes active
    with the attacker's password still valid.
  - Through a pending invitation, the attacker also joins the inviting
    workspace. This is a real cross-tenant path, even though every query is
    correctly scoped.
  - Re-checked independently (below).
  - SECA-02 (registration answers 409 for an existing address) is part of the
    same fix.
- **Defense in depth is missing (SECT-01, SECT-02, SECA-10, SECT-08).** Tenant
  isolation depends entirely on application code being correct:
  - There is no row-level security.
  - Only 7 of 63 tenant-to-tenant foreign keys include the workspace.
  - In the Compose deployment, the API, worker, and migrator all connect as the
    PostgreSQL superuser.
  - Authentication and role checks are a per-handler convention, with no
    default-deny route registration.
  - `authorization-matrix.yaml` is not checked by any tool.

  Today all of this holds. Any future missing predicate would become a data
  breach with nothing to stop it.
- **Data protection (SECT-03, Medium, treat as a release blocker).** Workspace
  delete and reset fail with 503 once any contact method exists, because of an
  `ON DELETE RESTRICT` key. The last owner also cannot delete their own account.
  Erasure is therefore impossible for most real workspaces.
- Other notable items:
  - SECA-03: invitation mail carries attacker-chosen text with no quota.
  - SECA-04: unauthenticated registrations are never purged.
  - SECT-04: a pending invitation survives its inviter's suspension, and there
    is no revoke route.
  - SECA-05: personal API tokens skip the legal-acceptance guard.

### 3. SSG / SSR / SPA usage

**The rendering strategies match the catalog and there is no SPA. The protected
static shells boot far more JavaScript than they need, and the remaining
server-rendered routes do not need a renderer.**

- All 39 delivered catalog pages are served exactly as
  `docs/product/page-catalog.yaml` says. The public and auth pages ship no React
  (0 to 10 KB of vanilla JavaScript). There is no client router and there are no
  view transitions.
- **FER-01 (High).** `ApplicationLayout.astro` mounts three React islands (the
  search palette, quick capture, and the notification bell) unconditionally on
  every protected page, even for signed-out visitors.
  - These islands are 78 to 100% of each protected page's JavaScript.
  - A signed-out `/app` visit downloads 206 KB.
  - Mounting them lazily and only for signed-in users takes Today's ready time
    from 2.19 s to 1.39 s (−37%) on a 4x-CPU, 4G profile.
- **FER-03.** The five `on-demand` routes return byte-identical HTML on every
  request, and nginx already replaces the headers they set. The renderer is a
  1.08 GB image, and the gateway's health check depends on it. Prerendering
  these routes would remove a service, but it amends ADR 0001 and the catalog,
  so it needs an explicit decision. In the other direction, `/privacy` and
  `/terms` are the only public pages whose body is request-time data, and they
  are client-fetched shells (FER-10).
- **Delivery:**
  - HTML has no `Cache-Control`. After a deploy, stale shells request
    fingerprinted chunks that no longer exist and get 404 (FER-05).
  - The gateway speaks HTTP/1.1 only (FEQ-07/FER-07). HTTP/2 was measured at −23
    to −30% on cold loads. The production edge probably negotiates HTTP/2, but
    nobody has verified it.
  - Compression is gzip only, and JSON is not compressed (FEQ-12/FER-08).
  - Today's layout shift is 0.26 on desktop and 0.38 on a phone (FER-06).
- **SSR for protected pages is not recommended yet.** Lazy shell islands plus
  HTTP/2 bring Today to ready in 1.1 s, down from 2.2 s, even before reads are
  de-duplicated. They do this without per-request rendering with cookies, which
  would reopen ADR 0001.

## Orchestrator re-checks

The orchestrator re-checked the High findings and the release blocker
independently of the agents:

| Finding   | Re-check                                                                                                                                                                                                                                                                                                                                                    | Result    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| SECA-01   | On the shared stack: register an address with password P (202), sign in before verification (401), POST the mailed verification token (200), then sign in with P (200). Code: `identity/adapters/postgres/identity_repository.ts:19-26` inserts `status = 'active'` with the requester's hash; `email_verification.ts:79-83` only sets `email_verified_at`. | Confirmed |
| BEQ-01/02 | `planning/application/reminder_delivery.ts:353` calls `replenish` on every tick before `claimDue`. `reminder_repository.ts` runs one transaction that opens with two `for share` selects and loops per candidate (`count: 8`) with one INSERT per occurrence. `apps/worker/main.ts:48` sets a 5 s interval.                                                 | Confirmed |
| BEQ-03    | The legal guard calls `readActor` (`governance/transport/http/routes.ts:230`), which resolves the session itself. Each module router then builds its own `sessionActor` memo (38 call sites).                                                                                                                                                               | Confirmed |
| FEQ-01    | Eight independent `getMemberPreferences` call sites with no shared memo: shell, global search, quick capture, `lib/time-presentation.ts`, directory, duplicates, person workspace, and preference settings.                                                                                                                                                 | Confirmed |
| FER-01    | `apps/web/src/layouts/ApplicationLayout.astro:176-181` statically imports and calls `mountGlobalPeopleSearch()`, `mountQuickCapture()`, and `mountNotificationBell()`.                                                                                                                                                                                      | Confirmed |
| SECT-03   | `begin; delete from crm.workspaces where id = <workspace with contact methods>; rollback;` fails with `violates RESTRICT setting of foreign key constraint "person_contact_methods_type_id_fkey"` (schema v12 line 815). The workspace was intact afterwards.                                                                                               | Confirmed |

## Recommended order of work

Each item cites the findings it resolves. Items marked **v13** need a new
synchronized schema version. Items marked **ADR** need an explicit architecture
decision before implementation, per `AGENTS.md`.

1. **Security and data protection. Fix now.**
   - SECA-01 and SECA-02: bind verification to the browser that registered. When
     the verifier is missing, discard the registrant's password and route the
     user to a set-password step. Let a new registration replace an unverified
     pending account. For an address that is already verified, answer 202 and
     send an "account exists" mail. The two request sequences in the 03 report
     give a failing-first regression test.
   - SECT-03: delete in dependency order inside the lifecycle transaction, or
     change the two `RESTRICT` keys in v13. Add an integration test that seeds
     every module and then runs workspace reset and delete.
   - SECT-04: add an invitation-revoke route, and re-check the inviter's
     authority when an invitation is accepted.
   - SECA-03 and SECA-04: per-workspace and per-sender invitation quotas, and a
     purge job for unverified registrations.
2. **Worker stability (BEQ-01, BEQ-02, BEQ-08, BEQ-09).** These need no schema
   change.
   - Run `claimDue` first in each tick.
   - Make replenishment demand-driven: one set-based "needs top-up" query (25 ms
     at the large profile), run hourly or when a definition changes.
   - Insert missing occurrences in chunks, in short per-workspace transactions,
     with no deployment-wide `FOR SHARE`.
   - Add error handling to the worker loop.
   - Add a capacity test that uses recurring reminders.
3. **Frontend quick wins.**
   - FEQ-01/FER-04: add `cache: "no-store"` in
     `packages/contracts/client/request.ts` (one line; repeat-visit time to
     content −40 to −47% at 100 ms latency) and single-flight identical GETs.
     Then embed preferences in `GET /session` (FEQ-02, FEQ-03). That takes the
     shell from 5 to 9 requests to 2, and repeat-visit time to content −55 to
     −63%.
   - FER-01: mount the three shell islands lazily, only for signed-in users.
   - FER-05: send `Cache-Control: no-cache` on HTML.
   - FEQ-07/FER-07: enable HTTP/2 on the gateway and verify that the Dokploy
     edge negotiates it.
   - FEQ-12/FER-08: compress JSON. Exclude responses that return a secret, such
     as API-token creation, to avoid BREACH-style oracles.
   - FER-06: reserve space in loading states. FER-12: preload the Inter font.
4. **Backend per-request overhead (BEQ-03, BEQ-04, BEQ-05).**
   - Resolve the session once: the legal guard stores its resolution in `c.var`
     for the routes to reuse.
   - Fold the read-model `revalidate` transaction into the read.
   - Throttle `last_seen_at` writes instead of writing on every read.
5. **Request shape (FEQ-04, FEQ-05, FEQ-06, FEQ-10, FEQ-11).**
   - Compose the person rail in the `person-profile` read model. Modules allowed
     by `module-boundaries.yaml` already cover it.
   - Serve the palette's recent people from the `search` read model.
   - Fetch the tasks page's people list on demand.
   - Re-read less after writes.
6. **v13 index package (BEQ-06, BEQ-07, BEQ-10 to BEQ-13).** Add 5 indexes, drop
   10, and apply the query rewrites listed in the 02 report.
7. **Decisions to make (ADR).**
   - FER-03: retire the renderer (prerender four routes, give the invite route a
     shell, switch to `output: "static"`).
   - SECT-01 and SECT-02: least-privilege database roles, plus row-level
     security as a backstop for tenant isolation.
   - SECA-10 and SECT-08: default-deny route registration and a machine-checked
     authorization matrix.
8. **Regression guards (FEQ-13/FER-11).**
   - A `PERF-002` Playwright spec that fails on duplicate GETs, on exceeding a
     per-page request budget or sequential-depth limit, or on exceeding a byte
     or Web Vitals budget.
   - Keep the budgets in `docs/planning/mvp-capacity-profile.json`.

## Test environment

- **Shared stack.** `compose.yaml` plus `compose.test.yaml` (production-built
  images, `APP_ENV=test`), Compose project `kinship-audit`. The only public
  entry point was the TLS gateway at `https://127.0.0.1:18443`, with a
  self-signed certificate and `PUBLIC_WEB_ORIGIN` set to that origin. To
  recreate it from the repository root (Git Bash):

  ```sh
  mkdir -p .tls/audit
  MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout .tls/audit/gateway.key -out .tls/audit/gateway.crt \
    -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
  cat > .tls/audit/stack.env <<'EOF'
  POSTGRES_DB=kinship_audit
  POSTGRES_USER=kinship_audit
  POSTGRES_PASSWORD=audit-local-password
  PUBLIC_WEB_ORIGIN=https://127.0.0.1:18443
  E2E_GATEWAY_PORT=18443
  GATEWAY_TLS_CERTIFICATE_PATH=./.tls/audit/gateway.crt
  GATEWAY_TLS_PRIVATE_KEY_PATH=./.tls/audit/gateway.key
  EOF
  docker compose --env-file .tls/audit/stack.env -p kinship-audit \
    -f compose.yaml -f compose.test.yaml up -d --build --wait
  # Mailpit (verification links): docker compose ... port mailpit 8025
  # teardown: docker compose ... down -v
  ```

  `.tls/` is git-ignored. Test accounts follow the same sequence as
  `tests/e2e/support/api.ts`:
  1. `POST /api/v1/registrations` returns 202.
  2. Read the `/auth/verify-email?token=…` link from Mailpit.
  3. `POST /api/v1/email-verifications`.
  4. `POST /api/v1/sessions`.
  5. Accept every document listed by `GET /api/v1/legal-requirements` with
     `POST /api/v1/legal-acceptances`.

  Every unsafe request carries `Origin: https://127.0.0.1:18443`.
- **Private stacks.** Two agents ran separate, later removed Compose projects
  for intrusive work:
  - Agent 2: PostgreSQL with `pg_stat_statements` and `auto_explain`, and the
    medium and large datasets from `docs/planning/mvp-capacity-profile.json`.
  - Agent 3: throttle and flood tests, and a database stall.
- **Probe scripts.** The agents wrote their scripts to the audit session's
  temporary scratchpad (`$S/work/<area>/`, as the reports call it). Each report
  inlines the parts needed to reproduce its findings. The scripts that exploit
  SECA-01 and SECA-03 are deliberately described as request sequences rather
  than included as code.
- **Limits.** Browser measurements used Chromium only. Mobile figures are
  emulated (4x CPU throttling, 4G latency). Timings on the audit machine drifted
  10 to 20% between batches, so the core A/B comparisons were interleaved. The
  production edge (Dokploy) was not available, so its HTTP/2 and compression
  behavior is unverified.
