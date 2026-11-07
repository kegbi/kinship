# Configuration And Secrets Contract

## Principles

- Configuration is validated once at each composition root before serving work.
- Domain and application code receive typed values or capabilities, never raw
  environment access.
- Missing, malformed, contradictory, or unsafe production configuration fails
  startup with a redacted actionable error.
- Defaults are limited to harmless local-development behavior. Security,
  persistence, origins, and credentials never gain production defaults.
- Configuration fails closed. Development and test behavior is opted into by
  name; it is never what a process gets for a missing value.
- Secret values are never committed, logged, included in problem details,
  returned by diagnostics, or placed in client bundles.

## Sources And Precedence

Lowest to highest precedence:

1. checked-in non-secret application defaults;
2. a documented local `.env` file ignored by Git;
3. Compose environment and secret files;
4. deployment-provided secret/configuration mechanisms.

The scaffold adds `.env.example` containing names, descriptions, and safe sample
shapes only. It never contains working credentials.

## Configuration Ownership

| Area                 | Owner                | Examples                                                  |
| -------------------- | -------------------- | --------------------------------------------------------- |
| Application identity | bootstrap            | environment name, public origin, build metadata           |
| Database             | PostgreSQL adapter   | connection URL, pool bounds, statement timeout            |
| Browser session      | identity adapter     | cookie name/domain/security and signing/encryption keyset |
| Object storage       | files adapter        | endpoint, bucket, region, access identity, size limits    |
| Mail                 | notification adapter | transport endpoint, sender identity, bounded retry policy |
| Telemetry            | platform telemetry   | OTLP endpoint, sampling, service identity, log level      |
| Import/export        | import-export module | input/output limits and temporary storage policy          |
| Optional providers   | owning integration   | provider endpoint and credentials                         |

The exact variable catalog is finalized with the first consuming code. Variable
names should be stable, uppercase, and capability-specific. Public browser
variables use an explicit public prefix; no secret is ever renamed into that
namespace.

## Application Environment

`APP_ENV` is `development`, `test`, or `production`. Every process reads it
through `packages/backend/platform/application_environment.ts`, and an unset or
empty `APP_ENV` is `production`; any other value refuses to start. A deployment
that loses the variable therefore gets production's refusals (missing keysets,
plain SMTP, a non-HTTPS origin, local object-storage credentials) instead of
development's public defaults.

Every launcher states the environment it wants: `compose.dev.yaml` and
`deno task dev` set `development`, `compose.test.yaml` and the PostgreSQL
integration harness (`tools/postgres_gate.ts`) set `test`, and `compose.yaml`
and `compose.dokploy.yaml` default to `production`. A test that composes a
process states `APP_ENV` in the environment it passes.

Development falls back to fixed local keysets, and `compose.test.yaml` publishes
fixed test keysets. Both are repository constants, so production refuses any
keyset holding one of them, as the active key or a retained one. The denylist in
`apps/api/configured_keysets.ts` is shared by API startup (`configuredKeyset`)
and `deno task ops preflight`; a new secret joins it by listing its published
fill there.

## Gateway Trusted Proxy

`GATEWAY_TRUSTED_PROXY` (Dokploy gateway and preflight only; AUD-G4, SECA-06) is
the one address whose `X-Forwarded-For` the gateway believes. nginx keys its
rate limits on the client address, and the API's per-address sign-in budget
reads the address the gateway forwards as `X-Kinship-Client-Address`, so behind
an untrusted edge every visitor shares the proxy's address and five failures
lock an account for all of them; trusting too much lets any peer choose its own
address.

- Source: the deployment's `runtime.env`, interpolated by
  `compose.dokploy.yaml`. It is not a secret, and it has no default: Compose
  refuses to render the gateway or the preflight without it.
- Rendering: the gateway image carries the reviewed `gateway/dokploy-proxy.conf`
  as `/etc/nginx/trusted-proxy-templates/dokploy.conf.template`. Only
  `compose.dokploy.yaml` points the nginx entrypoint's template step at it, with
  `NGINX_ENVSUBST_FILTER` admitting this one variable, and writes the result
  into a private tmpfs at `/etc/nginx/trusted-proxy.d`, the directory
  `gateway/nginx.conf` includes. The base, development, and test gateways set no
  template directory and trust no proxy.
- Validation: `tools/operations/dokploy_preflight.ts` blocks the deployment
  (`gateway-trusted-proxy`) unless the value is one canonical IPv4 or IPv6
  literal: no prefix length, hostname, list, `unix:`, unspecified address,
  surrounding whitespace, or non-canonical spelling. The backup waiver never
  covers it. Every service the gateway waits for depends on the preflight.
- Failure is closed: a value nginx cannot parse stops the gateway, and an
  unwritable output directory renders nothing, so the gateway trusts no proxy
  rather than a broader one.

## Runtime Schema

Each process defines a Zod schema at its composition boundary and transforms raw
strings into domain-appropriate values such as URLs, durations, byte limits,
booleans, and bounded integers. The parsed object is immutable.

Validation also checks relationships that a single field cannot express:

- production origins use HTTPS;
- secure cookies are enabled outside deliberate local HTTP development;
- public and internal origins are not accidentally confused;
- database and provider timeouts are positive and bounded;
- object bucket and application environment cannot point at a known test target
  in production;
- optional modules cannot be enabled without their complete configuration.

## Secret Lifecycle

- Store authentication key material as a versioned keyset so rotation can
  validate old sessions while issuing only with the active key.
- Store API and provider secrets through deployment secret mounts or equivalent
  mechanisms, not normal source-controlled environment files.
- Record secret owner, rotation procedure, last rotation, and affected services
  outside the secret value itself.
- Rotating a secret is a tested operation. Session-signing rotation, storage-key
  rotation, and provider-key rotation have independent procedures.
- Imported Monica credentials, MFA seeds, sessions, OAuth secrets, and recovery
  codes are never copied into active secret stores.

### Sign-in device keyset

`AUTH_SIGN_IN_DEVICE_KEYSET` (API only) signs the stateless sign-in device token
(AUD-A3). A password sign-in that answers `200` or `202` sets it as the
`kinship_signin_device` cookie: `HttpOnly`, `SameSite=Strict`, `Secure` on
HTTPS, `Path=/api/v1/sessions`, thirty days. The token is an HMAC-SHA256 over
its expiry and the account's pseudonymous throttle-subject digest; a valid one
exempts its browser from the per-account sign-in ceiling for that account, never
from the per-address limit. It is not a session.

- Shape: the same bounded JSON as `AUTH_THROTTLE_SUBJECT_KEYSET`, an integer
  `activeVersion` and one to eight `v<n>` labels mapped to 32 random bytes in
  unpadded base64url.
- Production fails startup when it is missing, malformed, holds a key the
  repository publishes (its local and test fallback included), or reuses any
  `AUTH_THROTTLE_SUBJECT_KEYSET` key: one key, one purpose. Local development
  without it uses an explicitly non-production fallback.
- Rotation: add a new active version, keep the prior versions for the thirty-day
  token lifetime, then remove them. Losing or retiring the keyset only returns
  browsers to the per-account ceiling.

## Outbound Mail Limits

The product never relays mail on a caller's say-so (SECA-03, AUD-M3). These
limits are fixed policy, not configuration: no variable raises or disables them,
in any environment. Every window is a rolling 24 hours, so no time zone or
midnight is involved.

| Limit                                               | Value                                        | Counted in                                                                      |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| Invitations sent by one workspace                   | 20 per rolling 24 hours                      | `crm.api_request_logs`, `mail-budget/invitation` rows by `workspace_id`         |
| Invitations received by one address, all workspaces | 3 per rolling 24 hours                       | the same rows, by the recipient's digest                                        |
| Inviter's address verified for at least             | 24 hours                                     | `crm.users.email_verified_at`                                                   |
| Registration mail to one address                    | 10 per rolling 24 hours                      | `crm.api_request_logs`, `mail-budget/registration` rows by the address's digest |
| Password-reset requests for one address             | 3 per 15 minutes and 10 per rolling 24 hours | `crm.password_reset_requests`                                                   |

- **Invitations.** An owner or admin whose address was verified less than 24
  hours ago is refused with `403 inviter_not_established`. An invitation past
  the workspace quota or the recipient cap is refused with
  `429 invitation_limit_reached`; one problem covers both, so the answer never
  says which limit was reached or anything about the recipient's account. A
  refusal writes no invitation and sends no mail, and only admitted invitations
  are counted. The Subject is always "You were invited to a Kinship workspace";
  the workspace name appears only in the body, at most 60 characters, with any
  URL, bare host name, or address in it replaced by `[link removed]`.
- **Registration mail** is a verification link or the "you already have an
  account" notice. Registering and asking for another verification link each
  spend one, counted per request whatever the address turns out to be. Past the
  ceiling, public registration and its retry still answer the same `202` inside
  the response equalizer, but write and send nothing, so a fresh, a pending, and
  a registered address are indistinguishable. Registering through an invitation
  and asking for that verification link again spend one only for a pending
  invitation to that very address; an invalid, expired, revoked, used, or
  mismatched invitation answers as it always did and spends nothing. Past the
  ceiling the invitee routes answer `429 verification_mail_limit_reached` and
  write no account or token.
- **Password resets.** A request past either limit writes and sends nothing and
  is answered exactly as one that sent a link. A reset link carried by an
  "account exists" notice is a request too.

`crm.api_request_logs` has no scope column in schema v12, so a mail budget is a
distinct `path` that no HTTP route has (`mail-budget/invitation`,
`mail-budget/registration`), with `method = 'POST'` and `status_code = 202`, as
the sign-in throttle separates its scopes by path (AUD-A3). The address is kept
only as its versioned HMAC under `AUTH_THROTTLE_SUBJECT_KEYSET`, labelled
`kinship.authentication.mail.v1`; every retained key's digest is counted, so a
rotation does not reset a budget. A future retention job must keep these rows
for at least 24 hours.

A per-address ceiling can be spent by somebody else: anyone may exhaust an
address's registration mail for the day, or invite it three times. That delays
its owner by at most a day; the alternative is an unbounded relay. It reveals
nothing about whether the address has an account. It does reveal one thing,
inherent to a cap shared by every workspace: an established owner or admin whose
own workspace quota is not exhausted, and who is still refused with
`429 invitation_limit_reached`, learns that other workspaces invited the address
within the last 24 hours. Registering through an invitation spends registration
mail only once the invitation is known to be pending for that very address, so a
made-up or mismatched token measures nothing.

Known limit: the caps count an address as typed, trimmed and lower-cased. A
provider's sub-addresses (`name+tag@`, or dots ignored by some providers) reach
one mailbox under many addresses, so each such alias has its own per-recipient
cap and registration-mail ceiling, and one mailbox can be sent that much per
alias. Each workspace's quota still bounds what that workspace sends, but
workspaces held by plus-aliased accounts of one person are counted apart.
Folding aliases would mean guessing each provider's rules, so it is not done.

## Redaction

Structured telemetry uses an allowlist of fields. At minimum, redact:

- authorization and cookie headers;
- password, recovery, MFA, WebAuthn challenge, and session material;
- API/OAuth tokens and provider credentials;
- full email, phone, address, note, message, journal, and import source content;
- signed object/download URLs and raw file names when they contain user data;
- database URLs and exception strings that embed connection properties.

Identifiers may be logged only when useful for operations and after the
workspace/security implications are understood. Prefer trace and operation IDs.

## Deno Permission Profiles

| Process          | Filesystem                                      | Environment                  | Network                                 | Subprocess          |
| ---------------- | ----------------------------------------------- | ---------------------------- | --------------------------------------- | ------------------- |
| API              | built assets/config and bounded temp paths only | explicit API allowlist       | PostgreSQL and configured adapters      | none by default     |
| Worker           | bounded job/temp paths                          | explicit worker allowlist    | PostgreSQL and configured adapters      | none by default     |
| Migrate          | read-only migration bundle                      | database/migration allowlist | PostgreSQL only                         | none                |
| Repository tools | task-specific repository paths                  | task-specific allowlist      | only when the tool contract requires it | explicit tools only |

`--allow-all` is forbidden for normal development, tests, CI, and containers.
Permission changes are reviewed like dependency changes.

## Client Configuration

The Astro build receives only explicitly public values. Private API location,
provider credentials, session keys, database configuration, and internal
topology remain server-side. Runtime user/workspace data comes from authorized
API contracts rather than environment substitution into static files.

<!-- deno-fmt-ignore -->
The private Astro renderer receives only a private API origin, forwarded request context, generated API contracts, and renderer operations configuration. It receives no database or object-store configuration, provider credentials, identity keys, backend-internal imports, or direct-adapter authority.
