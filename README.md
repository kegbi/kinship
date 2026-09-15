# Relationships Assistant

The first runnable product surface contains a Deno/Hono API and the static Astro
public home, features page, and oriented not-found state.

## Run locally

Install the pinned dependencies once with `deno task deps:deno` and
`deno task deps:node`, ensure Docker is running, then start PostgreSQL, the
canonical baseline migration, Mailpit, the real API, and Astro from the
repository root:

```sh
deno task dev
```

The command waits for PostgreSQL, migration, Mailpit, pinned RustFS object
storage, and API readiness before it starts Astro, and removes its
containers/network on exit while retaining the local PostgreSQL and RustFS
volumes. Open <http://127.0.0.1:4321> and use the public navigation to visit
<http://127.0.0.1:4321/features>. Astro proxies `/api/v1/*` to the API at
<http://127.0.0.1:8000>, so the readiness state on the page reflects the running
API. Configure local listeners with `POSTGRES_PORT`, `API_PORT`, `WEB_PORT`,
`SMTP_PORT`, `MAILPIT_PORT`, `OBJECT_STORAGE_PORT`, and
`OBJECT_STORAGE_CONSOLE_PORT`; set `POSTGRES_PASSWORD` before starting Compose.
`PUBLIC_WEB_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER`, `APP_ENV`,
`AUTH_MFA_ENCRYPTION_KEYSET`, `AUTH_THROTTLE_SUBJECT_KEYSET`,
`AUTH_MINIMUM_RESPONSE_MS`, `SMTP_HOST`, and `SMTP_FROM` use the names shown in
`.env.example`. Production requires `AUTH_MFA_ENCRYPTION_KEYSET` to be bounded
JSON containing `activeKeyId` and a `keys` object of key IDs to 32 random bytes
encoded as unpadded base64url. New MFA material uses the active key while
retained keys decrypt older material. Local development uses an explicitly
non-production fallback when the variable is blank. Production also requires
`AUTH_THROTTLE_SUBJECT_KEYSET` for keyed, pseudonymous authentication subjects
used by durable pre-admission throttling. Its bounded JSON contains an integer
`activeVersion` and a `keys` object with one to eight canonical version labels
(`v1` or newer), each mapped to 32 random bytes encoded as unpadded base64url;
retain older versions while rotating and never commit or log the keyset.
`AUTH_MINIMUM_RESPONSE_MS` sets the sign-in and MFA response-duration floor. It
defaults to `250` and accepts only integer milliseconds in the inclusive range
`100` through `2000`. There is no supported root `PORT` or `API_ORIGIN` setting.

Root `build`, `check`, `test`, `test:coverage`, and `test:e2e` tasks provide the
corresponding application gates. `deno task test:e2e` provisions a unique,
disposable production-built Compose stack and runs all configured browsers
through its sole public entry point, a TLS gateway on a Docker-assigned loopback
port. The Astro renderer, API, and PostgreSQL services remain private; Mailpit's
Docker-assigned loopback listener is exposed only as test control for captured
mail. The gate always removes the exact test project and volumes. The existing
PostgreSQL schema tasks remain available and independent.

`deno task test:integration`, root `test`, and root `test:coverage` provision a
clean disposable PostgreSQL project themselves; they do not consume an ambient
`DATABASE_URL`. `deno task test:unit`, `test:integration`, `test:contract`, and
`test:coverage` each accept `--module=<id>` to run one module's suite from
`tools/tasks/manifest.ts`, which is the single source of truth for test
composition, coverage includes, and permission sets; root `test` always runs
every aggregated module. Plain SMTP is deliberately restricted to the local
Mailpit/loopback capture adapter in explicit development or test environments;
production startup rejects that adapter until a certificate-validated TLS
transport is configured.
