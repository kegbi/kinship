<!-- deno-fmt-ignore-file -->
# Docker Compose Contract

## Status

Accepted topology and lifecycle contract. Compose files and exact image versions
are created during the executable scaffold, then pinned for reproducibility.

## Service Topology

| Service          | Purpose                                                                      | Profile            | Lifecycle    |
| ---------------- | ---------------------------------------------------------------------------- | ------------------ | ------------ |
| `gateway`        | Same-origin entry point, TLS in production-like use, and static Astro assets | default, test      | Long-running |
| `api`            | Deno/Hono HTTP composition root                                              | default, dev, test | Long-running |
| `worker`         | Reminder, import/export, synchronization, and maintenance commands           | default, dev, test | Long-running |
| `migrate`        | Applies and verifies immutable SQL before API/worker readiness               | default, test      | One-shot     |
| `postgres`       | Canonical durable database                                                   | default, dev, test | Long-running |
| `web`            | Private Astro renderer; hot reload in development                            | default, dev, test | Long-running |
| `object-store`   | S3-compatible development/test attachment storage                            | dev, test          | Long-running |
| `mail`           | Captured development/test email                                              | dev, test          | Long-running |
| `otel-collector` | Optional OTLP receiver and local telemetry routing                           | observability      | Long-running |

`api` and `worker` use the same backend image and different explicit commands.
They may have different Deno permissions and environment allowlists.

## Files

The implementation uses:

- `compose.yaml` for the production-like base;
- `compose.dev.yaml` for source mounts and developer services;
- `compose.test.yaml` for isolated test settings and disposable storage;
- `compose.support.yaml` for the local `mailpit` and `object-store` services,
  defined once; `compose.dev.yaml` and `compose.test.yaml` each `extends:`
  both services from it and add only what differs: development
  publishes their host ports and keeps objects in a named volume; test
  publishes only the Mailpit API on a Docker-assigned port and keeps objects in
  a tmpfs. Production-like `compose.yaml` never loads it.

Images come from two Dockerfiles. `Dockerfile.api` builds the Deno image that
`migrate`, `api`, and `worker` share. `Dockerfile.web` has one `build` stage
that installs the frozen pnpm lockfile and runs the Astro build once, and two
targets that copy from it: `web`, the private Node renderer, and `gateway`,
nginx serving the static client output. Compose selects each with `target:`,
so the images keep their per-service names. Node images use the exact
`nodejs` version in `.tool-versions`, pinned by digest.

The existing schema validation Compose file remains a narrow independent harness
until the application stack supersedes none of its checks.

## Startup And Readiness

1. PostgreSQL becomes healthy.
2. `migrate` obtains the migration lock, applies/verifies schema state, and
   exits successfully.
3. API and worker start only after successful migration completion.
4. Gateway becomes ready only after the API readiness endpoint succeeds and its
   static assets exist.

Liveness means the process event loop is responsive. Readiness means the process
can perform its role. API readiness includes a bounded database probe; API
liveness must not restart the process merely because PostgreSQL is briefly
unavailable. Worker readiness reports whether it can claim work, separately from
whether an external mail or object provider is degraded.

The gateway waits only for `web` readiness before forwarding an on-demand request and returns a bounded unavailable response when that dependency is not ready. `web` liveness reports whether its renderer process is alive; readiness additionally requires the renderer to accept requests and its private `api` origin to be reachable. Development alone overrides the `web` command to `astro dev`; production-like and test profiles use the private production renderer.

## Gateway Routing

The gateway serves static, prerendered, and fingerprinted Astro output directly. It routes `/api/v1/*` to the private `api` service and routes only the following cataloged on-demand pages to the private `web` renderer:

| Page catalog ID | Path pattern | Destination |
| --- | --- | --- |
| `auth.verify-email` | `/auth/verify-email` | private `web` |
| `auth.reset` | `/auth/reset-password` | private `web` |
| `auth.mfa` | `/auth/mfa` | private `web` |
| `invitation.accept` | `/invite/:token` | private `web` |
| `compliance.accept` | `/app/compliance` | private `web` |

No other page or request path may be routed to `web`. Production and test keep both `web` and `api` private; development alone overrides `web` to run `astro dev`.

## Gateway Hardening

GAP-040 fixed the gateway's edge policy in `gateway/nginx.conf` and `gateway/security_headers.conf`; `tools/gateway_contract_test.ts` rejects each weaker form.

- **Rate limits.** Every `/api/v1/*` request counts against a per-client-address zone of 50 requests per second with a burst of 200, and at most 64 concurrent requests per address. The credential endpoints (sign-in, MFA challenges, registration and email verification, password reset, and each invitation-acceptance step) also count against a stricter zone of 300 requests per minute (5 per second) with a burst of 100. Those numbers come from the serial E2E suite, whose single client address peaks at 144 POSTs in a minute and 67 in ten seconds; at 60 per minute with a burst of 30 the back-to-back AUTH-002 and AUTH-003 specs tripped it. The calendar feed (`/api/v1/calendar-feeds/*`, REL-068) keeps the per-address zone and, in place of the credential zone, counts against a per-feed zone of 12 requests per minute with a burst of 6, keyed on the feed id that precedes the secret in the path, so one leaked subscription URL cannot drive the feed's statements at the address rate, the zone's memory never holds a secret, and no log line records the key; calendar applications poll every few minutes. Every zone refuses past its burst at once rather than queueing, with `429`, `Retry-After`, `Cache-Control: no-store`, and the API's RFC 9457 problem body (`code: request_rate_limited`). The API's own per-subject throttles still apply behind them, and the API's own `429` problems pass through unchanged. The limits sit above one owner and the serial E2E suite, which the full Chromium run proves; the credential zone is a coarse per-address bound, and the per-subject throttles do the fine-grained work.
- **TLS.** `TLSv1.2` and `TLSv1.3` only. TLS 1.2 offers only forward-secret ECDHE suites with AES-GCM or ChaCha20-Poly1305 (Mozilla's intermediate profile without its DHE suites), `ssl_prefer_server_ciphers off` because every offered suite is strong, a shared session cache, and `ssl_session_tickets off` so a ticket key never outlives the process's forward secrecy.
- **HSTS.** `Strict-Transport-Security: max-age=31536000`, without `includeSubDomains` and without `preload`. The private deployment is one owner-operated host; asserting HSTS for sibling subdomains the operator may not control, or committing a whole domain to browser preload lists, is the operator's decision at the domain level, not this application's.
- **CSP.** `script-src 'self'` plus a SHA-256 hash for each inline script. Pages are static files the gateway serves directly, so a per-request nonce would need response rewriting; the hash of static output is fixed at build time instead. The one inline script is the theme bootstrap in `ApplicationLayout.astro`, which must run before first paint. `astro.config.mjs` stops Astro inlining small bundled page scripts, so every other script is a same-origin file and no build output changes the policy. The contract test hashes every `is:inline` script in the Astro sources and rejects a missing or stale hash; the `build` verb's output suite checks every built page, and the gateway Compose fixture checks pages rendered on demand. No page uses an inline event attribute, which a hash cannot allow. `style-src` keeps `'unsafe-inline'`: Base UI renders `<style>` elements, so dropping it is not free.
- **Request identifier.** The gateway forwards its own `$request_id` as `X-Request-Id` on every proxied location — the API, the readiness probes, and each on-demand renderer route — replacing any client value.

## Network Exposure

Public reachability is restricted to this complete allowlist:

| Service or service class | Production-like and test reachability |
| --- | --- |
| `gateway` | Sole public entry point |
| `web` | Private |
| `api` | Private |
| `worker`, `migrate`, `postgres`, `object-store`, `mail`, and `otel-collector` | Private |

Development-only loopback exposure does not make a service public.
Test ports are dynamically assigned or project-scoped for concurrent worktrees and CI jobs.

## Data And Volumes

- PostgreSQL and object bytes use named volumes in development.
- Test profiles use disposable, project-scoped volumes.
- Static build artifacts are copied into images, not shared from a developer
  directory in production-like operation.
- Canonical migrations are mounted or copied read-only into `migrate`.
- Secrets are not stored in images, Compose YAML, named volumes intended for
  source artifacts, or command-line arguments visible in process lists.

## Reset And Cleanup

Reset commands are split by environment:

- `dev:reset-data` removes only the explicitly resolved development Compose
  project volumes after displaying the project name and targets.
- `test:down` removes only the unique test project and its disposable volumes.
- no repository task may infer a destructive target from an empty variable,
  current directory name alone, or a broad Docker prune.

Production data reset is not a Compose command. It requires an explicit
operational runbook and restore point.

## Test Isolation

Every integration/E2E run uses a unique Compose project name derived from a
validated test-run identifier. The harness must:

1. start from empty database and object-store state;
2. wait on health/readiness rather than fixed sleeps;
3. apply migrations through the same migration command as deployment;
4. seed deterministic fixtures through supported application or fixture APIs;
5. collect logs, traces, database diagnostics, and Playwright artifacts on
   failure;
6. tear down its exact project and volumes in a finalizer.

## Backups And Restore

Before production deployment is accepted, a runbook and automated acceptance
test must prove:

- consistent PostgreSQL backup and restore;
- object-store backup or replication and manifest reconciliation;
- restored schema/app compatibility;
- handling of missing objects without corrupting metadata;
- recovery time and recovery point objectives chosen for the deployment.

## Image And Supply-Chain Policy

Architecture documents name technologies but not snapshot versions. At
scaffolding time:

- runtime and service images are pinned to reviewed immutable versions or
  digests;
- build stages use committed lockfiles and frozen installs;
- images run as non-root where supported and have read-only filesystems except
  explicit writable paths;
- health-check tools are present intentionally rather than installed at
  container startup;
- dependency and image updates arrive through reviewed automated changes.
