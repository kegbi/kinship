# Relationships Assistant

The first runnable product surface contains a Deno/Hono API and the static Astro
public home, features page, and oriented not-found state.

## Run locally

Install the pinned dependencies once with `deno task deps`, then start both real
applications from the repository root:

```sh
deno task dev
```

Open <http://127.0.0.1:4321> and use the public navigation to visit
<http://127.0.0.1:4321/features>. Astro proxies `/api/v1/*` to the API at
<http://127.0.0.1:8000>, so the readiness state on the page reflects the running
API. Set `PORT` or `API_ORIGIN` only when the default local ports are
unavailable.

Root `build`, `check`, `test`, `test:coverage`, and `test:e2e` tasks provide the
corresponding application gates. The existing PostgreSQL schema tasks remain
available and independent.
