# Relationships Assistant

The first runnable product surface contains a Deno/Hono API and the static Astro
public home, features page, and oriented not-found state.

## Run locally

Install the pinned dependencies once with `deno task deps`, ensure Docker is
running, then start PostgreSQL, the canonical baseline migration, Mailpit, the
real API, and Astro from the repository root:

```sh
deno task dev
```

The command waits for PostgreSQL, migration, mail, and API readiness before it
starts Astro, and removes its containers/network on exit while retaining the
local PostgreSQL volume. Open <http://127.0.0.1:4321> and use the public
navigation to visit <http://127.0.0.1:4321/features>. Astro proxies `/api/v1/*`
to the API at <http://127.0.0.1:8000>, so the readiness state on the page
reflects the running API. Configure local listeners with `POSTGRES_PORT`,
`API_PORT`, `WEB_PORT`, `SMTP_PORT`, and `MAILPIT_PORT`; set `POSTGRES_PASSWORD`
before starting Compose. `PUBLIC_WEB_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER`,
`APP_ENV`, `SMTP_HOST`, and `SMTP_FROM` use the names shown in `.env.example`.
There is no supported root `PORT` or `API_ORIGIN` setting.

Root `build`, `check`, `test`, `test:coverage`, and `test:e2e` tasks provide the
corresponding application gates. `deno task test:e2e` provisions a unique,
disposable PostgreSQL/Mailpit/API Compose project with Docker-assigned listener
ports, runs all configured browsers against the real Astro development topology,
and always removes the exact test project and volumes. The existing PostgreSQL
schema tasks remain available and independent.

`deno task test:integration`, root `test`, and root `test:coverage` provision a
clean disposable PostgreSQL project themselves; they do not consume an ambient
`DATABASE_URL`. The internal `test:integration:direct` task accepts an injected
`DATABASE_URL` for a controlled existing harness. Plain SMTP is deliberately
restricted to the local Mailpit/loopback capture adapter in explicit development
or test environments; production startup rejects that adapter until a
certificate-validated TLS transport is configured.
