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
