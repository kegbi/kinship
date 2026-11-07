# Security: authentication, sessions, credential flows, CSRF, and the edge

Audit agent 3 of 5, finding prefix `SECA`, 2026-11-07. Scope: every mounted
route of the API (156), the session and credential lifecycle (registration,
verification, sign-in, MFA, reset, invitations, API tokens, calendar feed), the
legal guard, CSRF/CORS, the nginx gateway, the private Astro renderer, XSS and
content injection, and configuration hardening. The user's question was:
"recheck the architecture to make sure users can't bypass login". Cross-tenant
data access and role permissions belong to agent 4; two places where this audit
touches them are flagged inside SECA-01 and SECA-05. Not covered: performance
(agent 5), schema design, DAV protocol correctness, and the worker's reminder
delivery.

## Method

Static reading (about 70 files, all cited below as `path:line`):
`packages/http-kit/*`, `apps/api/composition.ts`, `apps/api/security_config.ts`,
every `transport/http` file under `packages/backend/modules/*`, the identity and
api-access adapters, the nginx configuration and security headers,
`Dockerfile.*`, `compose*.yaml`, the Astro pages and the auth/shell scripts.

Dynamic evidence, all produced for this audit:

- The shared stack `kinship-audit` (gateway `https://127.0.0.1:18443`) for the
  all-routes sweeps, header collection, static shells and traversal probes. No
  flooding, restarts or configuration changes were done there; the throwaway
  accounts it holds are named `audit-seca-*@example.test`.
- A private Compose project `kinship-audit-sec` (gateway `:18445`, images
  re-tagged from the shared stack, no rebuild) for everything that floods,
  pauses, restarts, or edits the database: throttles, mail volume, timing,
  legal-document publication, MFA seeding, DB outage, session expiry. It was
  torn down at the end.
- Playwright/Chromium for the XSS corpus, the anonymous visit to a protected
  shell, and a cross-site cookie-planting experiment.
- A route generator built from the contract registry (`API_ROUTES`, zod to JSON
  Schema) so that every request in the sweeps carries a valid body, query and
  path parameters and therefore reaches the authentication check if one exists.

Probe scripts live in the audit scratchpad under `work/seca/`; the defensive
sweeps are inlined in "Reproduction" and the two attack chains are described,
not inlined. The test overlay sets `AUTH_MINIMUM_RESPONSE_MS=100` (the
production default is 250).

## Verdict on the question

No login bypass was found. All 142 protected routes refuse an anonymous,
garbage-cookie, malformed-cookie and signed-out request with 401 (or, for the
five handoff routes, a 4xx that discloses nothing; sign-out is idempotent)
before any data is read; the sweep found no 2xx data response on any of them. A
password-only session for an MFA account does not exist (no session row is
issued until the factor succeeds). The legal guard fails closed. What the audit
did find is (a) one way to defeat the _meaning_ of a login without bypassing it
(SECA-01, the pre-registered password survives email verification) and (b) that
the protection is a per-handler convention with no mechanical net (SECA-10).

## Summary

| ID      | Severity | Title                                                        | Status                  |
| ------- | -------- | ------------------------------------------------------------ | ----------------------- |
| SECA-01 | High     | Pre-registered password survives email verification          | Verified (dynamic)      |
| SECA-02 | Medium   | Registration is an account-existence oracle                  | Verified (dynamic)      |
| SECA-03 | Medium   | Unthrottled mail relay with attacker-chosen text             | Verified (dynamic)      |
| SECA-04 | Medium   | Unauthenticated registrations and auth rows are never purged | Verified (dyn., static) |
| SECA-05 | Low      | Personal API tokens bypass the legal-acceptance guard        | Verified (dynamic)      |
| SECA-06 | Low      | Sign-in throttle is per address and account; state in memory | Verified (dyn., static) |
| SECA-07 | Low      | Sign-out is not idempotent; a stale cookie gives 503         | Verified (dynamic)      |
| SECA-08 | Low      | Hostile input mapped to 503 (workspace header, NUL bytes)    | Verified (dynamic)      |
| SECA-09 | Low      | Session cookie has no `__Host-` prefix; first duplicate wins | Verified (static, dyn.) |
| SECA-10 | Low      | Authentication is a per-handler convention, no default-deny  | Verified (static)       |
| SECA-11 | Low      | Configuration fails open without `APP_ENV`; test keys pass   | Verified (dynamic)      |
| SECA-12 | Info     | Gateway body envelope is below the 10 MiB document limit     | Verified (dynamic)      |
| SECA-13 | Info     | Edge and container hardening notes                           | Verified                |
| SECA-14 | Info     | MFA and credential-store notes                               | Verified                |
| SECA-15 | Info     | Database stall fails closed but requests hang                | Verified (dynamic)      |

Counts: Critical 0, High 1, Medium 3, Low 7, Info 4.

## Route authentication sweep (item 1)

156 routes are registered (`packages/contracts/routes/mod.ts`; the test
`apps/api/routes_test.ts:111-127` proves the app mounts exactly that set).
Classification from the descriptors' `security` field:

- 14 public by design: the 3 probes, `POST` registrations, email-verifications,
  email-verification-deliveries, password-reset-requests, password-resets,
  sessions, workspace-invitations/{authenticate,inspect, register}, `GET`
  calendar-feeds/{feedFile} (secret in path) and legal-documents/{type}.
- 142 protected: 136 take the session cookie (some also a PAT), and 6 take a
  one-purpose handoff cookie (`kinship_entry`, `kinship_mfa`,
  `kinship_invitation`) or are the idempotent sign-out.

The sweep (`sweep_unauth.ts`, inlined below) called each route on the running
gateway with a generated valid request in five credential states: no cookie;
`kinship_session=` (empty); `kinship_session=x` (malformed); an unknown
well-formed 43-character value; and a genuine session cookie after
`POST /sign-out` (revoked on the server).

| Outcome in all five states                                   | Routes |
| ------------------------------------------------------------ | ------ |
| 401 (`session_invalid` or the route's own 401 code)          | 136    |
| 4xx with no data: handoff routes lacking their own cookie    | 5      |
| `POST /sign-out`: 200 without a cookie, 503 with a stale one | 1      |
| 2xx on a protected route                                     | 0      |
| 5xx other than the sign-out case                             | 0      |

The five handoff routes answer: `application-entry` 409 `entry_handoff_invalid`,
`mfa-challenges` and `workspace-invitations/mfa` 410 `mfa_challenge_expired`,
`workspace-invitations/accept` and `.../verification-delivery` 404
`invitation_invalid`.

Public routes, anonymous (a garbage cookie changes nothing on any of them):

| Route                                      | Anonymous answer                     |
| ------------------------------------------ | ------------------------------------ |
| `GET /api/v1/health`                       | 200 `{status, readiness}`            |
| `GET /livez`, `GET /readyz`                | 404 at the gateway (not routed)      |
| `POST /registrations`                      | 202 (409 `duplicate_email`, SECA-02) |
| `POST /email-verifications`                | 409 for an unknown token             |
| `POST /email-verification-deliveries`      | 202 always                           |
| `POST /password-reset-requests`            | 202 always                           |
| `POST /password-resets`                    | 410 for an unknown token             |
| `POST /sessions`                           | 401 `invalid_credentials`            |
| `POST /workspace-invitations/authenticate` | 401 `invalid_credentials`            |
| `POST /workspace-invitations/inspect`      | 404 `invitation_invalid`             |
| `POST /workspace-invitations/register`     | 404 for an unknown token             |
| `GET /calendar-feeds/{feedFile}`           | 404 for any unknown secret           |
| `GET /legal-documents/{privacy,terms}`     | public document or 404               |

Complementary checks:

- Static: 152 `mount()` call sites under `transport/http`. A script checked that
  an actor-resolving helper runs before the first service call. 128 pass; of the
  24 flagged, 16 are the public/handoff handlers above and 8 resolve the actor
  inside a shared closure that I read (`setStar`, `issue`, `mutate`,
  `auditRoute`).
- Routing tricks against five protected routes (trailing slash, double slash,
  upper case, encoded letters and slashes, dot segments, `;param`,
  `X-HTTP-Method-Override`, `X-Original-URL`, `X-Forwarded-User`, `Basic`/empty
  `Authorization`, duplicate cookies, HEAD/PROPFIND/TRACE): none produced data.
- The web shells are public static files; see "Checked and sound".

Full list of the 136 routes that answered 401 everywhere: see the appendix at
the end of the "Reproduction" section.

## Findings

### SECA-01 Pre-registered password survives email verification

- Severity: High (cross-tenant exposure through a pending invitation).
- Status: Verified (dynamic), two end-to-end proofs of concept.
- Where:
  `packages/backend/modules/identity/adapters/postgres/identity_repository.ts:13-40`
  (the pending user is inserted with the registrant's `password_hash`,
  `status = 'active'`, `email_verified_at = null`);
  `packages/backend/modules/identity/adapters/postgres/email_verification.ts:39-100`
  (verification sets `email_verified_at`, never touches `password_hash`, and
  hands whoever clicked an entry session);
  `packages/backend/modules/workspaces/transport/http/registration.ts:227-257`
  (an address with any existing account answers 409);
  `packages/backend/modules/workspaces/application/invite_member.ts:116-177` and
  `.../invitations/accept.ts:172-237` (the invitation path).

What happens: `POST /api/v1/registrations` accepts any address, stores the
password the _requester_ chose, and mails a verification link to the address.
Nothing ties the verification to the browser that registered. When the mailbox
owner clicks the link the account becomes verified with the requester's password
still in force, and the clicker is signed in to it. The requester then signs in
with the known password. A pending invitation makes it worse: an invitee who
tries to register through the invitation gets 409
(`invitation_registration_unavailable`), signing in needs a password they never
set, and the only path the product offers is "re-send the verification mail" for
the pending identity, after which accepting the invitation puts the requester's
account into the inviting workspace.

Exploit scenario 1 (identity takeover). Mallory registers `victim@example.test`
with her own password and a plausible workspace name. Victim receives "Verify
your Kinship email" and clicks it (or registers themselves, gets 409, and uses
the retry). Victim is now signed in to an account whose password Mallory knows;
Mallory signs in and reads everything the victim stores. The victim's only
escape is a password reset, which nothing prompts. Exploit scenario 2
(cross-tenant). Mallory pre-registers the addresses of an organisation's staff.
Any workspace admin who later invites one of them gives Mallory a member session
in that workspace.

Evidence (shared stack, `prehijack.ts`):

```text
1. attacker registers victim's address -> 202 verification-required
1b. attacker sign-in before verification -> 401 invalid_credentials
2. mail subject: Verify your Kinship email | from: hello@kinship.local
   victim's browser verified -> 200  entry -> 200  victim session issued: true
   victim stores a contact -> 201
3. attacker signs in as victim -> 200 role: owner userId: ec397080-...
   attacker lists victim's people -> 200 ["Grandma Secret"]
```

Evidence (private stack, `prehijack_invite.ts`, the invitation variant):

```text
1. employer invites the victim's address                invitation mailed
2. attacker pre-registers the same address              202 verification-required
3a. victim registers through the invitation             409 invitation_registration_unavailable
3b. victim signs in through the invitation              401 invalid_credentials
3c. victim asks for the verification mail to be re-sent 202 accepted
4. victim clicks the verification link                  200 next=/invite/continue
5. victim accepts the invitation                        200 {"status":"accepted",...,"name":"Employer Confidential WS"}
6. attacker signs in as the invitee, step-2 password    200 workspaces=["Whatever","Employer Confidential WS"]
   attacker reads the EMPLOYER workspace's people       200 ["Client"]
```

Impact: full takeover of the mailbox owner's identity and, through invitations,
read/write access to every workspace they join at the invited role. The
`private-production-profile.json` describes a one-owner deployment: there the
owner's own address can be squatted before first registration and the owner's
"fix" (verify via the retry) lands them in the attacker's account. Preconditions
are modest: the attacker needs only the address and must register before the
victim; the victim must click a verification mail or follow the invitation flow.
Agent 4 should treat the invitation variant as a tenant-boundary item.

Recommendation (architecture-compliant, stays inside `identity`/`workspaces`):

1. Do not let the requester set a credential that outlives an unproven mailbox.
   Bind verification to the registering browser (a random verifier in an
   `HttpOnly; SameSite=Strict` cookie set at registration, its hash stored on
   the verification-token row, required by `POST /email-verifications`). If the
   verifier is absent or wrong, mark the email verified, discard the stored
   `password_hash`, and send the clicker to a "choose your password" step (the
   existing reset flow can serve).
2. Let a new registration for an address that has only an _unverified_ account
   replace that pending account (new hash, new token, old tokens void) and
   answer 202; this removes squatting and the 409 for unverified addresses.
3. For verified addresses answer 202 and mail "you already have an account"
   (also fixes SECA-02).
4. Mail the address whenever its password is set or reset. Add a regression test
   built from the two request sequences above, failing first.

### SECA-02 Registration is an account-existence oracle

- Severity: Medium.
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/workspaces/transport/http/registration.ts:244-248`,
  `.../application/register_first_workspace.ts:145-147`,
  `.../application/register_first_workspace.ts:159-185` (verification retry, no
  equalizer).

What happens: `POST /api/v1/registrations` answers `409 duplicate_email` ("An
account already uses that email address.") for any existing account, verified or
not, and 202 otherwise. It needs no credentials and is limited only by the
gateway (300 requests a minute per address, burst 100). The verification retry
endpoint answers 202 for everyone, but its latency differs for an address with a
pending registration (an SMTP exchange follows) and one without.

Evidence (private stack):

```text
registration duplicate : 409 duplicate_email 20ms
registration fresh     : 202 verification-required 45ms
POST /email-verification-deliveries  pending address  {"n":8,"min":7,"max":9}
                                     unknown address  {"n":8,"min":2,"max":3}
POST /sessions wrong password        known   {"n":28,"min":102,"max":105}
                                     unknown {"n":28,"min":102,"max":104}
POST /password-reset-requests        known   {"n":14,"min":1506,"max":1508}
                                     unknown {"n":14,"min":1505,"max":1507}
```

The last two rows show the project's own standard (sign-in and reset are
constant-time and body-identical); registration and the retry do not meet it.

Impact: an attacker can test any address against the service, and the oracle
selects victims for SECA-01. Recommendation: the uniform 202 plus "already
registered" mail in SECA-01 item 3; run the retry and registration inside the
existing response equalizer (`apps/api/authentication_response.ts`) and add an
application-level per-address budget (the durable `AuthenticationAttemptBudget`
already exists).

### SECA-03 Unthrottled mail relay with attacker-chosen text

- Severity: Medium (brand and deliverability abuse; harassment).
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/workspaces/application/invite_member.ts:275-305`,
  `.../adapters/postgres/workspace_invitations.ts:13-65` (no quota of any kind),
  `.../adapters/mail/smtp_verification_mail.ts:192-218` (`workspaceName` is
  placed in the Subject and the first body line),
  `packages/contracts/schemas/registration.ts` (`workspaceName`: any text, 2-120
  characters),
  `packages/backend/modules/identity/adapters/postgres/identity_repository.ts:107-113`
  (retry spacing), `.../password_recovery.ts:14-19` (reset cap).

What happens: any person who can register and verify an address owns a workspace
and is its owner, so may invite anyone. The invitation mail is sent from the
product's address, with the workspace name in the Subject and body and a real,
valid link. There is no limit per workspace, per actor, per recipient or per
day.

Evidence (private stack, `mailabuse.ts`):

```text
workspace: "Security alert: sign in at https://kinship-login.evil.example now"
invitation statuses: [[201,40]]            (40 invitations, no refusal)
Subject: Join Security alert: sign in at https://kinship-login.evil.example now on Kinship
From   : {"Name":"Kinship","Address":"hello@kinship.local"}
invitation mails delivered: 40 of 40
60 registrations back-to-back: [[202,60]]  (60 verification mails)
10 verification retries for one pending address: 2 mails delivered
```

Impact: a free phishing/spam relay from a trusted sender; one pending address
can be mailed about 12 times an hour indefinitely (retry spacing is 5 minutes,
and the pending account is never purged, SECA-04); a verified address can be
sent 3 reset mails per 15 minutes (silently capped). Unlike the reminder mail
adapter, the invitation Subject is not RFC 2047 encoded, so a non-ASCII
workspace name is sent as raw 8-bit header text.

Recommendation: a durable per-workspace daily invitation quota and a
per-recipient cap (reuse the attempt-budget table with a new scope); a fixed
Subject ("You were invited to a Kinship workspace") with the workspace name only
in the body, truncated and stripped of URLs; require the inviter's address to
have been verified for some time before invitations are sent; per-address daily
ceilings for verification and reset mails.

### SECA-04 Unauthenticated registrations and auth rows are never purged

- Severity: Medium (storage exhaustion by an anonymous caller; indefinite
  retention of addresses and user agents).
- Status: Verified (dynamic counts, static search for any purge).
- Where: `apps/worker/composition.ts:38-95` (the worker runs object cleanup,
  recurring debts and reminder delivery only; nothing deletes authentication
  rows);
  `packages/backend/modules/workspaces/application/register_first_workspace.ts:51-157`
  (the whole workspace is provisioned before verification);
  `packages/backend/modules/api-access/adapters/postgres/authentication_attempt_budget.ts:188-201`
  (one `crm.api_request_logs` row per sign-in attempt, with `client_ip`).

What happens: one anonymous `POST /registrations` creates a user, a workspace,
an owner membership, preferences, settings, the 26-pair relationship vocabulary
and an audit event, and sends a mail. Unverified accounts are never expired. The
same is true of revoked and expired `crm.user_sessions` (with IP and user
agent), `crm.password_reset_requests` (including the rows created for unknown
addresses), verification tokens and `crm.api_request_logs`.

Evidence (private stack, `growth.ts`, 100 registrations in 5.1 s from one
client):

```json
{
  "registrations": 100,
  "perSecond": 19.7,
  "rowsPerRegistration": 30,
  "bytesPerRegistration": 7537
}
```

After the audit's own traffic: `api_request_logs` 19 rows, `user_sessions` 70
(26 revoked or expired), `password_reset_requests` with no user 14, unverified
users 74, workspaces 101, relationship types 2626.

Impact: at the gateway's sustained 300 a minute per address that is about 432
thousand registrations a day, roughly 3.2 GB and 13 million rows a day from one
source address (more from an IPv6 range), plus the same number of mails. Under
the single-owner deployment profile this is also a free denial of service on the
database volume. The IP and user-agent columns have no retention limit at all.

Recommendation: provision the workspace at verification, not at registration (an
unverified registration then costs 2 rows); a worker job (the worker already
exists) that deletes unverified users older than 7 days, sessions
revoked/expired for 30 days, reset requests and verification tokens older than 7
days, and `api_request_logs` older than the 5-minute throttle window plus a
retention margin; an application-level registration budget per address and per
day using the existing durable budget.

### SECA-05 Personal API tokens bypass the legal-acceptance guard

- Severity: Low (compliance gate, not a confidentiality break).
- Status: Verified (dynamic).
- Where: `packages/backend/modules/governance/transport/http/routes.ts:212-251`
  (the guard resolves only the cookie, through `readActor`:
  `packages/http-kit/session.ts:234-244`; an `Authorization: Bearer` request
  with no cookie resolves to nobody and `next()` is called);
  `packages/http-kit/session.ts:276-296`,
  `packages/http-kit/scoped_actor.ts:19-36`.

What happens: with a required legal document outstanding, cookie requests to
data routes get `403 legal_acceptance_required`, but a personal access token
minted earlier keeps reading and writing.

Evidence (private stack, `legal.ts`; a `terms` document was published after the
token was created):

```text
cookie  GET  /people                                  403 legal_acceptance_required
cookie  POST /people (write)                          403 legal_acceptance_required
cookie  GET  /session, /legal-requirements (exempt)   200
BEARER  GET  /people (people:read)                    200
BEARER  GET  /tasks (tasks:read)                      200
BEARER  POST /tasks (tasks:create)                    201
```

Impact: a workspace owner or admin (only they can mint tokens) can keep
processing workspace data through the API without accepting a new document.
Recommendation: have the token admission path (`tokenOrSessionActor` callers)
consult the same `LegalAcceptance.requirements` use case for the token's user
and workspace and answer 403 `legal_acceptance_required`; add a focused test
beside `tests/integration/governance_postgres_test.ts`.

The same run proved the guard fails closed (see "Checked and sound").

### SECA-06 Sign-in throttle is per address and account; state is in memory

- Severity: Low.
- Status: Verified (dynamic for the per-address behaviour, static for the rest;
  the distributed case is reasoned, not exercised).
- Where:
  `packages/backend/modules/api-access/adapters/postgres/authentication_attempt_budget.ts:10-11,44-86,114-153`
  (key = path, `client_ip`, HMAC of the subject; 5 failures per 5 minutes);
  `packages/backend/modules/identity/adapters/postgres/authentication.ts:36-76,127-200`
  (`AttemptWindow` per process and key `ip\nemail`),
  `.../authentication.ts:73,184-192` (MFA challenges in a `Map`).

What happens: the durable budget counts failures per (client address, account).
There is no ceiling per account across addresses, so a distributed or
IPv6-rotating guesser is limited only by nginx's per-address zone (the key is
the full 128-bit address). The correct password is refused while the budget is
exhausted. Behind a proxy whose address is not trusted, every user shares one
address, so five failures lock an account for everyone
(`gateway/dokploy-proxy.conf:2` hard-codes the single trusted proxy address
`10.0.1.40`). The in-memory `AttemptWindow` (10 000 keys, oldest evicted) and
the MFA challenge store do not survive a restart or span replicas.

Evidence (private stack, `throttle.ts`, `mfa_restart.ts`):

```text
one known account:   1:401 2:401 3:401 4:401 5:401 6:429(ra=300) 7:429 8:429
correct password right after the lockout   -> 429 authentication_rate_limited
a different account from the same address  -> 200
unknown address, same sequence             -> identical (no oracle)
gateway: first nginx 429 at request 181 of 400 (burst 100 + 5/s refill)
MFA: 5 wrong codes -> 429; a VALID code on a fresh challenge -> 429 (retry 300)
API restart between the password step and the code -> 410 mfa_challenge_expired
```

Impact: no bypass; the weaknesses are a missing per-account ceiling and
availability coupling to a hard-coded proxy address. Recommendation: add a
per-account (not per-address) failure ceiling that triggers a delay or an email
unlock rather than refusing the right password; keep the MFA challenge in the
database (a hashed row with `purpose = 'mfa-challenge'` fits
`crm.user_sessions`) so a restart or a second replica does not break it;
document the single-replica constraint until then; derive the trusted proxy from
deployment configuration rather than one literal.

### SECA-07 Sign-out is not idempotent; a stale cookie gives 503

- Severity: Low.
- Status: Verified (dynamic).
- Where:
  `packages/backend/modules/workspaces/transport/http/authentication.ts:509-529`,
  `packages/backend/modules/identity/adapters/postgres/authentication.ts:416-431`
  (`revokeSession` throws when no active row matches),
  `apps/web/src/features/shell/application-shell/application-shell.ts:439-458`.

What happens: `POST /sign-out` with an unknown, expired or already revoked
cookie returns `503 sign_out_unavailable` and does not clear the cookie. A user
whose session was revoked from another device, or who reset their password, sees
"Your session could not be revoked" and nothing changes.

Evidence: sweep rows `POST /api/v1/sign-out  200 | 200 | 503 | 503 | 503`;
direct request with a 43-character unknown cookie returns `503`
`application/problem+json` with no `Set-Cookie`.

Impact: confusing on shared computers (the session is already dead but the user
cannot tell), and every stale sign-out is a 5xx in the error rate.
Recommendation: make `revokeSession` return a boolean; always answer 200 and
always clear the cookie.

### SECA-08 Hostile input mapped to 503

- Severity: Low.
- Status: Verified (dynamic).
- Where: `packages/http-kit/session.ts:100-123,234-244` (the optional
  `X-Workspace-Id` header is passed to SQL as `::uuid` unvalidated);
  `packages/backend/modules/governance/transport/http/routes.ts:230-235` (any
  exception from `readActor` becomes `legal_unavailable`);
  `packages/http-kit/validate.ts:64-70` and the string schemas (no NUL rule).

What happens: a request with a valid cookie and a malformed `X-Workspace-Id`
fails the uuid cast, the legal guard reports it as an outage, and the client
gets `503 legal_unavailable` ("Required legal documents cannot be confirmed"). A
NUL byte in a text field passes validation and PostgreSQL rejects it, giving
`503 people_unavailable`.

Evidence:
`cookie + X-Workspace-Id: not-a-uuid GET /people -> 503
legal_unavailable`;
`cookie + a random valid uuid -> 401`;
`POST /people
{"givenName":"a\u0000b"} -> 503 people_unavailable`.

Impact: an authenticated user can generate 5xx at will, polluting error budgets
and alerts; the 503 also hides the real cause from a client with a bad header.
Recommendation: parse the header as a uuid in `sessionActor` (invalid means
absent, or 400) and reject `\u0000` once, in the shared string schemas or in
`parseJsonBody`.

### SECA-09 Session cookie has no `__Host-` prefix; the first duplicate wins

- Severity: Low (needs control of a sibling subdomain).
- Status: Verified (static, plus the ordering behaviour dynamically).
- Where: `packages/http-kit/cookies.ts:15,18-25,43-55`;
  `packages/backend/modules/workspaces/transport/http/authentication.ts:274-286`.

What happens: the cookie is `kinship_session`, host-only,
`HttpOnly;
SameSite=Strict; Secure; Path=/`. `cookieValue` returns the first
`kinship_session=` in the header. Cookie tossing from a sibling subdomain (a
cookie with `Domain=` the parent) can therefore shadow the real one, forcing a
victim onto an attacker-chosen session (login CSRF) or logging them out.

Evidence: `valid first, garbage second -> 200`;
`garbage first, valid second
-> 401`; a `__Host-` prefixed cookie is not read at
all.

Impact: low unless the app shares a registrable domain with less-trusted sites.
Recommendation: name the cookie `__Host-kinship_session` whenever `secureCookie`
is true (it requires Secure, Path=/, no Domain, which the composer already
produces); treat more than one `kinship_session` in a request as invalid and
clear it.

### SECA-10 Authentication is a per-handler convention, no default-deny

- Severity: Low (hardening; no current bypass).
- Status: Verified (static); this is the direct answer to the architecture
  question.
- Where: `packages/http-kit/session.ts:145-171` (the middleware only memoizes
  the resolution; it never refuses), `packages/http-kit/route.ts:32-42` (`mount`
  binds a method and a path), `apps/api/routes_test.ts:111-127` (proves routes
  match the registry, not that they authenticate).

What happens: each of 142 handlers calls `requireActor`, `requireSession`,
`requireScopedActor`, `tokenOrSessionActor` or `workspaceScopedActor` itself.
The registry already knows which routes are public (`security === undefined`)
and the sweep shows today's code is uniformly correct, but a new route that
forgets the call is public by default and no test fails. Eleven routes validate
the body before the actor (for example `createProfileFact`,
`saveMemberUiState`); that is harmless today because nothing is read between the
two, but it is the pattern in which a future edit introduces a leak.

Recommendation (no new framework): add one test that iterates `API_ROUTES` with
a `security` entry, builds the request exactly as the generator in
"Reproduction" does, calls `createApiApp` with the stubbed services used by
`routes_test.ts` and a session coordinator that resolves nobody, and asserts 401
(with an explicit allowlist for the six handoff routes and sign-out). Optionally
let `mount` set a flag that `requireActor`/`requireSession` flip and fail in
tests when a `security` route answers 2xx without it.

### SECA-11 Configuration fails open without `APP_ENV`; test keys pass

- Severity: Low.
- Status: Verified (dynamic, `config_matrix.ts`).
- Where: `apps/api/composition.ts:887`
  (`Deno.env.get("APP_ENV") ?? "development"`), `:850-869` (`configuredKeyset`
  falls back to a fixed local key outside production), `:1167-1217`;
  `apps/api/security_config.ts:10-37`;
  `tools/operations/private_production_preflight.ts:224-238`.

What happens: `compose.yaml` defaults `APP_ENV` to `production`, and production
refuses plain SMTP, missing keysets, a missing, HTTP, loopback or path-bearing
origin and a response floor outside 100-2000 ms. But a process started without
`APP_ENV` is a development process: `http://127.0.0.1:4321`, non-Secure cookies
and the public constant keysets. Production also accepts the published test keys
(`AAAA...` for MFA, `UlJS...` for the throttle subject, `aWlp...` for DAV); the
preflight only checks that keysets decode.

Evidence:

```text
production, no MFA keyset ........ REFUSED: AUTH_MFA_ENCRYPTION_KEYSET is required
production, http origin .......... REFUSED: PUBLIC_WEB_ORIGIN must use HTTPS
production, response floor 99ms .. REFUSED: ... between 100 and 2000
APP_ENV unset, nothing else set .. ACCEPTED {"origin":"http://127.0.0.1:4321","secureCookie":false}, LOCAL DEFAULT keys
APP_ENV=development + https origin  ACCEPTED, LOCAL DEFAULT keys
production, all-zero MFA key ..... ACCEPTED
```

Impact: a deployment that loses one variable silently runs with keys anyone can
read in the repository (MFA secrets would be decryptable from a database copy).
Recommendation: default to production when `APP_ENV` is unset, or refuse to
start; in production reject any keyset whose key equals one of the repository
constants (a three-entry denylist in the preflight and in `configuredKeyset`).

### SECA-12 Gateway body envelope is below the 10 MiB document limit

- Severity: Info (a product defect behind a sound control).
- Status: Verified (dynamic).
- Where: `gateway/nginx.conf:154,174` (`client_max_body_size 1501024`) against
  `packages/backend/modules/files/domain/file_rules.ts:28`
  (`PERSON_FILE_MAX_BYTES = 10 MiB`) and `.../transport/http/routes.ts:199-236`.

Evidence: a 1.2 MB text document returns 201; a 2.0 MB one returns nginx's HTML
`413 Request Entity Too Large`; a 1.1 MB JSON body returns the API's own
`413 request_too_large` problem. Documents between about 1.43 and 10 MiB cannot
be uploaded through the shipped gateway, and the refusal is not a
`problem+json`. The comment at `file_rules.ts:30-36` shows the avatar limit was
sized for the envelope; the document limit was not. Recommendation: give the
upload location its own `client_max_body_size` (10 MiB plus headers) and add
`error_page 413 = @request_too_large` returning the project's problem body, or
lower the constant.

### SECA-13 Edge and container hardening notes

- Severity: Info. Status: Verified.

1. Duplicate header: file, vCard and export downloads carry
   `X-Content-Type-Options: nosniff` twice
   (`packages/http-kit/downloads.ts:42-52` and
   `gateway/security_headers.conf:5`), contradicting the invariant in
   `packages/http-kit/secure_headers.ts:1-16`. Harmless; drop it from
   `fileDownload` or add the case to `secure_headers_test.ts`.
2. `Server: nginx/1.29.1` is disclosed; set `server_tokens off`.
3. HSTS is `max-age=31536000` without `includeSubDomains`/`preload`
   (`gateway/security_headers.conf:4`); fine for an owner-operated host, but
   pairs with SECA-09.
4. CSP `style-src 'self' 'unsafe-inline'`; scripts are hash-only (one inline
   script, hash verified on all 25 sampled pages), `connect-src 'self'`,
   `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`. The
   residual risk is CSS injection only, and no sink exists (see XSS below).
5. `proxy_set_header Host $http_host` with `server_name _` forwards any Host.
   Nothing consumes it: mail links come from `PUBLIC_WEB_ORIGIN` (proved), the
   renderer pages read no request data (`Astro.request/url/cookies` are unused).
6. Three public POSTs have no Origin check: `registrations`,
   `email-verifications`, `email-verification-deliveries`. A cross-site page can
   send them with `Content-Type: text/plain` because `parseJsonBody` ignores the
   header (`packages/http-kit/validate.ts:64-70`). Chromium experiment
   (`login_csrf.cjs`): the server did process the cross-site `fetch`, but the
   `Set-Cookie: kinship_entry` (SameSite=Strict) was discarded by the browser,
   so no forced login is possible; top-level form posts cannot produce the exact
   JSON the strict schema needs. Add the Origin check anyway; it costs nothing
   and removes the dependency on browser cookie rules.
7. Compose sets `read_only`, non-root users and tmpfs, but no
   `no-new-privileges`, `cap_drop: [ALL]`, memory or pid limits. The API runs
   with unrestricted `--allow-net` (needed for DAV) and no read/write/run/ffi
   permissions, which is good.
8. `GET /app/*` static shells carry no `Cache-Control`; they contain no user
   data (verified), so this is harmless.

### SECA-14 MFA and credential-store notes

- Severity: Info. Status: Verified.

1. There is no API to enrol TOTP or issue recovery codes (`user_mfa_totp` and
   `user_recovery_codes` appear only in the verifier, the account-deletion
   cleanup and tests; `docs/planning/research.md:106` lists it as future). The
   verification path was exercised by seeding rows (below), so the review covers
   the code that will be reachable once enrolment lands.
2. Recovery codes are hashed with unsalted SHA-256 under a global unique index
   (`identity/adapters/postgres/authentication.ts:274`); fine for high-entropy
   generated codes, which enrolment must guarantee.
3. `PasswordHasher.needsUpgrade` exists (`identity/ports/security.ts:8`) but is
   never called, so a later Argon2 cost increase will not reach existing hashes
   until a user resets. The current cost (m=19 MiB, t=2, p=1,
   `identity/composition.ts:34-40`) is the OWASP minimum.
4. The `kinship_mfa` challenge and the password window live in API memory
   (SECA-06).

### SECA-15 Database stall fails closed but requests hang

- Severity: Info. Status: Verified (dynamic).
- Where: `packages/backend/platform/postgres/database.ts:33-35` sets
  `connect_timeout: 5` and `idle_timeout: 10` but no statement timeout.

Evidence (`docker pause` of PostgreSQL on the private stack): a valid cookie
request returned `504` after the gateway's 15 s; a garbage cookie
`503
legal_unavailable`; no cookie `401`; a bearer request `401`; `/health`
`503`. No data was ever served. Recommendation: set a `statement_timeout` (for
example 10 s) on the pool so a stalled database frees API workers before the
gateway gives up.

## Checked and sound

Login and sessions

- All 142 protected routes refuse anonymous, garbage, malformed and revoked
  cookies; 128 of 152 handlers statically match the actor-before-data pattern
  and the other 24 were read by hand.
- A session token is 256 random bits (43 base64url characters); only
  `SHA-256("authenticated-session:" + token)` is stored; the raw token appears
  nowhere in the database. `purpose` separates sessions from the 10-minute
  `verified-entry` handoffs, and neither a handoff, a verification token nor an
  MFA challenge is accepted as a session.
- Cookie attributes: `HttpOnly; SameSite=Strict; Secure; Max-Age=43199; Path=/`,
  no `Domain`; the entry, MFA and invitation cookies are scoped to the single
  route that consumes them.
- Absolute lifetime is 12 hours. Sign-in always mints a new token (a planted
  value is never adopted), and presenting the old cookie revokes it; other
  sessions stay valid until the user lists and revokes them
  (`/settings/sessions`; another user's session id answers 403).
- Server-side invalidation: sign-out; password reset (all sessions, including
  invitation purposes, plus all pending resets); member suspension (the
  membership is re-read on every request: 401 at once, 403 on sign-in; role
  changes and promotion attempts behave the same way); personal identity
  deletion (sessions revoked, password nulled, tokens dead, address freed).
  Final owners cannot delete themselves (409).
- Password reset: 256-bit hashed token, 60 minutes, single use, expired and
  reused tokens 410, 12-character minimum, constant 1.5 s response, three
  requests per 15 minutes per address.
- MFA (seeded): password-only sign-in yields only `kinship_mfa` scoped to
  `/api/v1/mfa-challenges`; it reaches no protected route; five wrong codes lock
  the budget; a TOTP counter cannot be replayed; recovery codes are single use;
  a challenge dies when the password changes; TOTP secrets are AES-256-GCM with
  user and key id as AAD. Detail: `mfa.ts`.
- Invitations: the token is bound to the invited address; another signed-in user
  gets 403 `invitation_wrong_user`; registering a different address against the
  token gets 409; role is `admin` or `member` only.
- API tokens: 256-bit secret, SHA-256 at rest, constant-time compare, lookup by
  id; scopes are independent (a `people:read` token cannot read tasks, identity
  or full person); `X-Workspace-Id` mismatch 401; expiry and revocation take
  effect at once; demotion applies, suspension kills the token; the secret is
  never listed or audited; a refused or malformed `Authorization` never falls
  back to the cookie (also `Basic`, empty and a `kin_cal_` value); tokens cannot
  call session-only routes or mint tokens.
- Calendar feed: 256-bit secret in the path, hashed, revocable, one per member;
  wrong secret, wrong id, revoked, rotated and PAT-as-feed all give the same
  404; strong ETag and 304; the iCalendar writer escapes CR/LF and controls
  (`integrations/domain/ical.ts:60-71`); the gateway rate-limits per feed id and
  logs no path.
- Legal guard fails closed: a garbage cookie with the database paused gets 503;
  outstanding documents give 403 on every data route; exempt routes are exactly
  the documented list.

CSRF and CORS

- 84 of 84 unsafe cookie-protected routes answer 403 `origin_invalid` for a
  foreign, missing and `null` Origin, before any work (the one with its own code
  is `PATCH /member/ui-state`); 11 of the 14 unsafe credential and handoff
  routes also check it (the exceptions are in SECA-13 item 6). Bearer requests
  need no Origin only on the documented token routes. SameSite=Strict is the
  second lock.
- CORS echoes only the configured origin; `null`, a sub-domain suffix and the
  http scheme get no `Access-Control-Allow-Origin`; preflight allows only
  `Content-Type`, `X-Request-Id`, `X-Workspace-Id`.
- No GET changes state except audited reads. Export downloads need the session
  _and_ a short-lived token.

Edge

- Static shells: 25 pages sampled; no user data, no e-mail addresses, no inline
  handlers, exactly one inline script and its hash is in the CSP. An anonymous
  visit to `/app/people/<id>` calls `GET /session` (401) and shows the sign-in
  state with the protected shell hidden. `/internal/*` shells (five directories)
  return 404 in every encoding tried; traversal, `.git`, `.env` and case
  variants are 400/404. The image holds 176 files, no source maps.
- Headers: CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy:
  no-referrer`, `Permissions-Policy` on every response
  including 413/429 pages; no duplicates between nginx and the API except
  SECA-13 item 1. Every authenticated GET sets
  `Cache-Control: private, no-store` (about 60 checked), as does every problem
  response.
- `X-Request-Id` and `X-Kinship-Client-Address` are replaced by the gateway; a
  spoofed value never reached the log or the session row (the stored address was
  the gateway's view); `X-Forwarded-For` is not read. Request ids that are
  oversized or contain control characters are replaced.
- TLS 1.0/1.1 refused, 1.2/1.3 only, forward-secret AEAD suites, tickets off.
- Request-size and URL limits: 414 and 400 pages for 60 KB queries and 70 KB
  headers; 413 for 1.1 MB JSON.
- The renderer's on-demand pages are thin shells: they set `no-store` and
  `no-referrer`, call no API server-side, read no request data, and strip the
  token from the address bar with `history.replaceState` before posting it. The
  token reaches neither logs (the gateway log format has no URI or query; the
  API logs only the route pattern) nor Referer. Password reset does not consume
  its token on page load. The compliance page's `next` is restricted to
  `/app/*`. Host and `X-Forwarded-Host` injection reflected nothing.
- No credential material appeared in 17 read, audit and export surfaces, the
  gateway/API/web/worker logs, or the JSON/CSV exports.

XSS and content

- Hostile text (`"><img onerror>`, `<svg onload>`, `javascript:`, `</script>`)
  stored in profile, workspace, person, note, task, journal, tag, contact (all
  seven kinds), pet, food, work, address, first meeting, gift, token name, DAV
  name and file title was rendered as text on 22 application pages in Chromium:
  `window.__pwn` stayed 0, no injected element, no inline handler, no CSP
  violation, no dangerous link. The only raw-HTML sinks are constant icon maps;
  `href` values are built from ids, `mailto:`/`tel:` or fixed paths;
  `target="_blank"` carries `rel="noopener noreferrer"`.
- Uploads: SVG, HTML and octet-stream are refused (415); HTML bytes declared as
  `text/plain` are accepted but served `text/plain` + `attachment` + `nosniff`
  - `private, no-store`; a fake PNG is quarantined; `Content-Disposition` is
    sanitised against CR/LF/quote injection (tested).
- CSV export prefixes `= + - @` cells with an apostrophe (verified in the
  unpacked file); vCard escapes line breaks (a name containing
  `END:VCARD`/`BEGIN:VCARD` stayed one card); mail is plain text with
  `safeHeader` on every header value; the SMTP writer dot-stuffs.
- SSRF: DAV subscriptions require `https`, no userinfo, resolve all addresses
  and require global unicast, connect to the validated address (no rebinding),
  do not follow redirects, bound the response and parse XML without entities
  (`integrations/adapters/dav/http_dav_client.ts`). Every loopback, private,
  link-local, metadata, IPv4-mapped and numeric-host target tried was rejected
  or failed.
- SQL: the few `sql.raw`/`sql.ref` uses take constants chosen from validated
  enums, not request text.

Configuration

- Legacy Monica credentials are never activated: only identity and api-access
  write `crm.users`, sessions and tokens; the importer counts and discards user
  rows and refuses secret columns (`monica_source.ts:56-62`); the database
  forbids an unrevoked `legacy` session.
- Production refuses the insecure inputs listed in SECA-11; production compose
  binds the gateway to loopback and publishes nothing else.

## Reproduction

Private stack (everything that floods, restarts or edits the database):

```sh
S=<scratchpad>; cd <worktree>
for s in api web gateway worker migrate; do
  docker tag kinship-audit-$s kinship-audit-sec-$s; done
sed -e 's/kinship-audit$/kinship-audit-sec/' -e 's/18443/18445/g' \
    -e 's/kinship_audit/kinship_sec/g' $S/audit-stack.env > sec-stack.env
docker compose --env-file sec-stack.env -p kinship-audit-sec \
  -f compose.yaml -f compose.test.yaml up -d --no-build
# teardown: ... down -v ; docker rmi kinship-audit-sec-{api,web,gateway,worker,migrate}
```

Run every script with
`SECA_BASE=https://127.0.0.1:18445 SECA_PROJECT=kinship-audit-sec
DENO_NO_PACKAGE_JSON=1 deno run --config deno.json --allow-read --allow-write
--allow-env --allow-net --allow-run=docker
--unsafely-ignore-certificate-errors=127.0.0.1 script.ts`.

`lib.ts` (condensed; `createAccount` registers, reads the mail from Mailpit,
verifies, signs in, accepts legal documents):

```ts
export const BASE = Deno.env.get("SECA_BASE") ?? "https://127.0.0.1:18443";
export const PASSWORD = "correct horse battery staple";
export async function call(method: string, path: string, o: {
  cookie?: string;
  origin?: string | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  bearer?: string;
} = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (o.origin === undefined) { if (unsafe) headers.origin = BASE; }
  else if (o.origin !== null) headers.origin = o.origin;
  let body = o.body;
  if (o.json !== undefined) {
    headers["content-type"] ??= "application/json";
    body = JSON.stringify(o.json);
  }
  const started = performance.now();
  const r = await fetch(BASE + path, {
    method,
    headers,
    body,
    redirect: "manual",
  });
  const text = await r.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch { /* not json */ }
  return {
    status: r.status,
    headers: r.headers,
    text,
    json,
    ms: performance.now() - started,
    setCookies: r.headers.getSetCookie(),
  };
}
// mailsTo/waitForMail query Mailpit: GET /api/v1/search?query=to:<email>, then
// /api/v1/message/<id>; linkToken() takes ?token= from the first matching URL.
```

Route generator and sweep (`gen.ts` builds a valid request per route from the
registry; `sweep_unauth.ts` is the loop):

```ts
import { z } from "zod";
import { API_ROUTES } from ".../packages/contracts/routes/mod.ts";
function sample(s: any): any { // JSON Schema -> a valid value
  if (s.$ref) s = DEFS[String(s.$ref).split("/").pop()!];
  if ("const" in s) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(s.anyOf.find((x: any) => x.type !== "null")!);
  if (s.type === "object") {
    return Object.fromEntries(
      (s.required ?? []).map((k: string) => [k, sample(s.properties[k])]),
    );
  }
  if (s.type === "array") return [sample(s.items)];
  if (s.type === "string") { /* uuid, email, date-time, pattern candidates */ }
  /* integer/number/boolean */
}
// per route: params -> path, required query -> ?a=b, body -> sample(schema),
// then ~12 hand-written bodies where sampling is not enough (see comments).
for (const spec of specs) {
  for (
    const [state, cookie] of Object.entries({
      none: undefined,
      empty: "kinship_session=",
      malformed: "kinship_session=x",
      unknown: "kinship_session=" + randomBase64Url(32),
      signedout: revokedCookie,
    })
  ) {
    const r = await call(spec.method, spec.path + spec.query, {
      cookie,
      headers: spec.headers,
      json: spec.json,
    });
    record(spec.key, state, r.status, r.json?.code);
    if (!isPublic(spec) && r.status >= 200 && r.status < 300) flag(spec, state);
  }
}
```

Attack chains are not inlined. The SECA-01 takeover scripts (`prehijack.ts`,
`prehijack_invite.ts`) and the SECA-03 mail-volume script (`mailabuse.ts`) are
working attack sequences against account ownership and against a mail relay, so
they stay in the scratchpad. The evidence blocks under SECA-01 and SECA-03
record every request and status code in order; write the failing regression test
from those sequences (they only need the helper above).

Other probes in `work/seca/`, what they check, and where the result is used:

| Script                            | Checks                                      | Used by         |
| --------------------------------- | ------------------------------------------- | --------------- |
| `sweep_unauth.ts`                 | all routes, five credential states          | sweep, SECA-07  |
| `sweep_auth.ts`                   | origin matrix, Cache-Control of every GET   | CSRF, headers   |
| `public_origin.ts`                | Origin check on unsafe public routes        | SECA-13         |
| `tricks.ts`                       | routing, method and header bypass attempts  | sweep           |
| `static_scan.cjs`                 | actor resolved before first service call    | SECA-10         |
| `legal.ts`                        | legal guard, bearer, database pause         | SECA-05, 08, 15 |
| `sessions.ts`, `lifecycle.ts`     | cookie, hash, rotation, reset, suspension   | sound list      |
| `deletion.ts`                     | identity deletion of a non-owner member     | sound list      |
| `mfa.ts`, `mfa_restart.ts`        | seeded TOTP and recovery-code paths         | SECA-06, 14     |
| `tokens.ts`                       | API token scopes, binding, calendar feed    | sound list      |
| `timing.ts`, `throttle.ts`        | enumeration timing, lockout, gateway limit  | SECA-02, 06     |
| `growth.ts`                       | rows and bytes per unverified registration  | SECA-04         |
| `config_matrix.ts`                | what `createApiRuntime` accepts or refuses  | SECA-11         |
| `shells.ts`, `edge.sh`            | static shells, headers, spoofing, TLS, logs | sound list      |
| `xss_seed*.ts`, `xss_browser.cjs` | hostile text on 22 pages in Chromium        | sound list      |
| `files.ts`, `exports.ts`          | upload, download, CSV, vCard, size limits   | SECA-12         |
| `ssrf.ts`                         | DAV subscription targets                    | sound list      |
| `cors_cookie.ts`                  | CORS, cookie order, content-type handling   | SECA-09, 13     |
| `login_csrf.cjs`                  | cross-site cookie storage in Chromium       | SECA-13         |
| `errors.ts`                       | hostile input and error bodies              | SECA-08         |

Two short checks that need no script:

```sh
# duplicate response headers on a download (SECA-13 item 1)
curl -sk -D - -o /dev/null -H "cookie: $COOKIE" "$BASE/api/v1/people/$ID/vcard" \
  | sed 's/\r//' | awk -F: 'NF>1{print tolower($1)}' | sort | uniq -d

# anonymous sign-out with an unknown cookie (SECA-07): 503, no Set-Cookie
curl -sk -D - -X POST "$BASE/api/v1/sign-out" -H "Origin: $BASE" \
  -H "Cookie: kinship_session=$(printf 'a%.0s' {1..43})"
```

### Appendix: the 136 routes that answered 401 in all five states

```text
GET /api/v1/audit-events
GET /api/v1/communication-options
GET /api/v1/exports
POST /api/v1/exports
GET /api/v1/exports/{exportId}/download
POST /api/v1/exports/{exportId}/downloads
GET /api/v1/imports
POST /api/v1/imports/dry-runs
GET /api/v1/imports/{importId}
POST /api/v1/imports/{importId}/commit
POST /api/v1/imports/{importId}/mapping
GET /api/v1/interaction-options
POST /api/v1/interactions
GET /api/v1/journal
POST /api/v1/journal/activities
PUT /api/v1/journal/day-ratings
GET /api/v1/journal/items/{itemId}
DELETE /api/v1/journal/items/{itemId}
POST /api/v1/journal/posts
PUT /api/v1/journal/posts/{itemId}
POST /api/v1/legal-acceptances
GET /api/v1/legal-requirements
GET /api/v1/member/ui-state
PATCH /api/v1/member/ui-state
GET /api/v1/notifications
GET /api/v1/people
POST /api/v1/people
POST /api/v1/people/bulk
POST /api/v1/people/bulk/vcard
GET /api/v1/people/duplicates
POST /api/v1/people/duplicates/dismissals
GET /api/v1/people/tag-facet
GET /api/v1/people/tag-options
GET /api/v1/people/{personId}
PATCH /api/v1/people/{personId}
DELETE /api/v1/people/{personId}
GET /api/v1/people/{personId}/activity-report
POST /api/v1/people/{personId}/archive
GET /api/v1/people/{personId}/audit
PUT /api/v1/people/{personId}/avatar
DELETE /api/v1/people/{personId}/avatar
GET /api/v1/people/{personId}/communications
GET /api/v1/people/{personId}/dates
POST /api/v1/people/{personId}/dates
PATCH /api/v1/people/{personId}/dates/{dateId}
DELETE /api/v1/people/{personId}/dates/{dateId}
POST /api/v1/people/{personId}/debts
DELETE /api/v1/people/{personId}/debts/{debtId}
GET /api/v1/people/{personId}/debts/{debtId}/settlements
PATCH /api/v1/people/{personId}/debts/{debtId}/status
GET /api/v1/people/{personId}/deletion-impact
GET /api/v1/people/{personId}/facts/{section}
POST /api/v1/people/{personId}/facts/{section}
PUT /api/v1/people/{personId}/facts/{section}/{factId}
DELETE /api/v1/people/{personId}/facts/{section}/{factId}
GET /api/v1/people/{personId}/files
POST /api/v1/people/{personId}/files
DELETE /api/v1/people/{personId}/files/{fileId}
GET /api/v1/people/{personId}/files/{fileId}/content
GET /api/v1/people/{personId}/gifts
POST /api/v1/people/{personId}/gifts
PATCH /api/v1/people/{personId}/gifts/{giftId}/status
GET /api/v1/people/{personId}/identity
GET /api/v1/people/{personId}/life-events
POST /api/v1/people/{personId}/life-events
PATCH /api/v1/people/{personId}/life-events/{lifeEventId}
DELETE /api/v1/people/{personId}/life-events/{lifeEventId}
POST /api/v1/people/{personId}/recurring-debts
PATCH /api/v1/people/{personId}/recurring-debts/{recurringDebtId}
DELETE /api/v1/people/{personId}/recurring-debts/{recurringDebtId}
GET /api/v1/people/{personId}/relationships
POST /api/v1/people/{personId}/relationships
POST /api/v1/people/{personId}/relationships/related-person
PATCH /api/v1/people/{personId}/relationships/{relationshipId}
DELETE /api/v1/people/{personId}/relationships/{relationshipId}
GET /api/v1/people/{personId}/reminders
POST /api/v1/people/{personId}/restore
PUT /api/v1/people/{personId}/star
DELETE /api/v1/people/{personId}/star
GET /api/v1/people/{personId}/timeline
GET /api/v1/people/{personId}/vcard
POST /api/v1/people/{personId}/view
POST /api/v1/people/{primaryId}/merge
GET /api/v1/people/{primaryId}/merge-preview
GET /api/v1/relationship-types
PUT /api/v1/reminder-occurrences/{occurrenceId}/acknowledgement
POST /api/v1/reminders
PUT /api/v1/reminders/{reminderId}/active
GET /api/v1/search
GET /api/v1/session
GET /api/v1/settings/api-tokens
POST /api/v1/settings/api-tokens
DELETE /api/v1/settings/api-tokens/{tokenId}
GET /api/v1/settings/calendar-feed
POST /api/v1/settings/calendar-feed
DELETE /api/v1/settings/calendar-feed
POST /api/v1/settings/calendar-feed/rotation
GET /api/v1/settings/integrations/dav
POST /api/v1/settings/integrations/dav
DELETE /api/v1/settings/integrations/dav/{subscriptionId}
POST /api/v1/settings/integrations/dav/{subscriptionId}/sync
GET /api/v1/settings/members
PATCH /api/v1/settings/members/{memberId}
GET /api/v1/settings/personal-lifecycle
DELETE /api/v1/settings/personal-lifecycle
POST /api/v1/settings/personal-lifecycle/leave
GET /api/v1/settings/personalization/{section}
POST /api/v1/settings/personalization/{section}
PATCH /api/v1/settings/personalization/{section}/{id}
DELETE /api/v1/settings/personalization/{section}/{id}
GET /api/v1/settings/preferences
PUT /api/v1/settings/preferences
GET /api/v1/settings/profile
PUT /api/v1/settings/profile
GET /api/v1/settings/sessions
DELETE /api/v1/settings/sessions/{sessionId}
GET /api/v1/settings/storage
GET /api/v1/settings/workspace
PUT /api/v1/settings/workspace
GET /api/v1/settings/workspace-lifecycle
DELETE /api/v1/settings/workspace-lifecycle
POST /api/v1/settings/workspace-lifecycle/reset
POST /api/v1/stay-in-touch-cadences
GET /api/v1/tasks
POST /api/v1/tasks
GET /api/v1/tasks/{taskId}
PATCH /api/v1/tasks/{taskId}
PUT /api/v1/tasks/{taskId}/completion
GET /api/v1/today/attention
GET /api/v1/today/favorite-notes
GET /api/v1/today/recent-activity
GET /api/v1/today/recent-people
GET /api/v1/today/reminders
GET /api/v1/today/tasks
POST /api/v1/workspace-invitations
GET /api/v1/workspace-members
```
