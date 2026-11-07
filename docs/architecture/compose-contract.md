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
- `compose.dokploy.yaml` as the standalone owner-operated Dokploy deployment,
  extending the base services, with a blocking configuration preflight and
  private TLS RustFS plus bucket-scoped application identity initialization;
- `compose.dev.yaml` for source mounts and developer services;
- `compose.test.yaml` for isolated test settings and disposable storage;
- `compose.support.yaml` for the local `mailpit` and `object-store` services,
  defined once; `compose.dev.yaml` and `compose.test.yaml` each `extends:`
  both services from it and add only what differs: development
  publishes their host ports and keeps objects in a named volume; test
  publishes only the Mailpit API on a Docker-assigned port and keeps objects in
  a tmpfs. Production-like `compose.yaml` never loads it.

Application images come from two Dockerfiles. `Dockerfile.api` builds the Deno image that
`migrate`, `api`, and `worker` share. `Dockerfile.web` has one `build` stage
that installs the frozen pnpm lockfile and runs the Astro build once, and two
targets that copy from it: `web`, the private Node renderer, and `gateway`,
nginx serving the static client output. Compose selects each with `target:`,
so the images keep their per-service names. Node images use the exact
`nodejs` version in `.tool-versions`, pinned by digest.

`Dockerfile.storage-init` is separate administrative tooling for the Dokploy
one-shot initializer. It uses the pinned Deno runtime and a SHA-256-verified
official `mc` release; the client binary is absent from application images.
The Dokploy edge terminates Let's Encrypt TLS at gateway's private HTTP port,
and the optional trusted-proxy include allows only its verified exact address.
Browsers there speak whatever protocol the edge negotiates, not the gateway's;
see the HTTP/2 item under Gateway Hardening.
Only gateway joins the external edge network. Storage credentials and private
CA trust stay in the owning private services. See the private-production
runbook for file mounts, rollout, rollback, and the explicitly temporary backup
waiver, which does not change ordinary preflight or production acceptance.

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
- **HSTS.** `Strict-Transport-Security: max-age=31536000`, without `includeSubDomains` and without `preload`. The private deployment is one owner-operated host; asserting HSTS for sibling subdomains the operator may not control, or committing a whole domain to browser preload lists, is the operator's decision at the domain level, not this application's. The 2026-11-07 audit (SECA-13 item 3) reconfirmed this as standing decision D6 of the audit remediation plan; an operator who controls every sibling host may add both at the edge.
- **CSP.** `script-src 'self'` plus a SHA-256 hash for each inline script. Pages are static files the gateway serves directly, so a per-request nonce would need response rewriting; the hash of static output is fixed at build time instead. The one inline script is the theme bootstrap in `ApplicationLayout.astro`, which must run before first paint. `astro.config.mjs` stops Astro inlining small bundled page scripts, so every other script is a same-origin file and no build output changes the policy. The contract test hashes every `is:inline` script in the Astro sources and rejects a missing or stale hash; the `build` verb's output suite checks every built page, and the gateway Compose fixture checks pages rendered on demand. No page uses an inline event attribute, which a hash cannot allow. `style-src` is `'self'` alone (AUD-G3; FER-15, SECA-13 item 4): no page carries a `<style>` element or a `style` attribute in markup, and `astro.config.mjs` sets `inlineStylesheets: "never"` so Astro ships every stylesheet as a same-origin file. Styles that React, Base UI, and floating-ui positioning set at runtime through the CSSOM are not inline styles and stay allowed; Base UI's only `<style>` elements belong to `ScrollArea` and an aligned `Select`, which the application does not use, and either would need its own decision. Every E2E spec takes `test` from `tests/e2e/support/test.ts`, which collects each browser context's `securitypolicyviolation` events and fails the test on any refusal; the gateway contract test rejects a spec that bypasses it, and the `build` verb's output suite rejects an inline style in any built page.
- **Request identifier.** The gateway forwards its own `$request_id` as `X-Request-Id` on every proxied location — the API, the readiness probes, and each on-demand renderer route — replacing any client value.

AUD-G1 (2026-11-07 audit: FER-05, FEQ-07, FER-07, SECA-12, and SECA-13 items 2, 3, 5, and 8) added the delivery rules below; the same contract test and the live gateway fixture in `tools/gateway_log_capture_test.ts` reject each weaker form.

- **Caching.** Every static HTML response — `location /`, the five internal shell rewrites (person profile, person audit, activity report, import report, and journal item), and `/docs/api/openapi.json` — carries `Cache-Control: no-cache`, so a browser revalidates the document with a cheap `304` against `Last-Modified` and `ETag` instead of reusing a heuristically fresh copy that names fingerprinted chunks a deploy has deleted. `/_astro/*` stays `public, max-age=31536000, immutable`, `/favicon.svg` is `public, max-age=86400`, and the on-demand renderer pages stay `private, no-store`. nginx's `add_header` in a location replaces the server-level headers, so every location that adds a header repeats `include security_headers.conf`; the contract test rejects one that does not.
- **Subresource headers.** `/_astro/*` responses carry only `Cache-Control`, `X-Content-Type-Options: nosniff`, and `Cross-Origin-Resource-Policy: same-origin`. The CSP, framing, permissions, referrer, and HSTS headers govern documents, and every document still carries them.
- **HTTP/2.** The TLS listener (`8443`) has `http2 on`, so a browser reaching it directly multiplexes one connection with compressed headers instead of six HTTP/1.1 connections; the cleartext `8080` listener the edge proxies to still answers HTTP/1.1. The fixture asserts that `curl --http2` against `8443` negotiates `2`. The Dokploy edge is Dokploy's Traefik, whose entry points and TLS options this repository does not configure; Traefik offers `h2` through ALPN on a TLS entry point by default, so the edge is expected to serve HTTP/2. That is unverified against the live edge. After a deploy or an edge change, an operator confirms it from outside the deployment network with `curl -sS -o /dev/null -w '%{http_version}' https://<public-origin>/`, which prints `2`, or with `openssl s_client -connect <public-host>:443 -servername <public-host> -alpn h2,http/1.1 </dev/null 2>/dev/null | grep '^ALPN'`, which prints `ALPN protocol: h2`. Record the answer here when it is measured.
- **Request bodies.** `/api/v1/*` admits 1,501,024 bytes, the 1.5 MB import source plus its JSON envelope. `/api/v1/people/:personId/files` streams a person file as its raw body, so it admits `PERSON_FILE_MAX_BYTES` (10 MiB) plus 64 KiB, streams the body to the API (`proxy_request_buffering off`, because two buffered files would not fit the gateway's 16 MiB `/tmp` tmpfs), ends a stalled body with `client_body_timeout 15s`, and otherwise proxies exactly like `/api/v1/*`; the API answers its own `file_storage_limit` problem for a file between the two, and the avatar keeps the ordinary envelope. A body past any API location's envelope gets `413` with `Cache-Control: no-store` and the API's own RFC 9457 `request_too_large` problem, not nginx's HTML page. Residual: that timeout bounds each read, not the whole body, so a client that trickles a byte every few seconds can hold an API request for as long as it keeps sending; the per-address `limit_conn` of 64 bounds how many it can hold at once.
- **Server identity.** `server_tokens off`: the `Server` header says `nginx` without its version.
- **Forwarded host.** The gateway forwards the client's `Host` (`proxy_set_header Host $http_host`) with `server_name _`, so a client can choose it. Nothing consumes it: mail and other absolute links come from `PUBLIC_WEB_ORIGIN`, the API builds no URL from the request, and the on-demand renderer pages read no request data. A change that starts reading the request host must first pin it to the configured public host.

## Compression

AUD-G2 (2026-11-07 audit: FEQ-12 and FER-08) implements decision D4 of the [audit remediation plan](../planning/audit-remediation-plan-2026-11-07.md), *compress, except secrets*. `tools/gateway_contract_test.ts` checks the configuration against the route registry, and the live fixture in `tools/gateway_log_capture_test.ts` proves each rule against the pinned nginx.

- **What compresses.** Locations opt in to gzip. `gzip_types` covers CSS, JavaScript, `application/json`, and `image/svg+xml`; nginx always includes `text/html`. Static files, the internal shell rewrites, and `/docs/api/openapi.json` compress, and so do the API locations (`/api/v1/*`, the person-file upload, and the calendar feed, whose `text/calendar` body is not a listed type). Responses under 1 KiB stay as they are, every compressed response carries `Vary: Accept-Encoding`, `gzip_proxied any` compresses behind the edge too, and a client that refuses gzip gets the identity bytes. The API itself never sets `Content-Encoding`, so nothing is compressed twice.
- **Pre-compressed static assets.** The `build` stage of `Dockerfile.web` compresses each HTML, CSS, JavaScript, JSON, and SVG file over 1 KiB in the client output once at gzip level 9 (`gzip -9 -k -n`, keeping the original), and the gateway's `gzip_static on` sends that `.gz` sibling instead of compressing the file again at level 5 on every request.
- **What never compresses.** A body that carries a secret must not share a compression context with text an attacker chose (BREACH). The usual precondition is already absent: the session cookie is `SameSite=Strict` and a bearer request carries no cookie, so a cross-site page cannot trigger an authenticated request (plan Part 1.2 item 6). Even so, one API location answers with `gzip off`, and otherwise proxies and rate-limits exactly like `/api/v1/*`. It serves the paths of every route that `packages/contracts` marks with `secrecy`:
  - `issues-secret`, a body that carries a secret minted for the request: API-token creation (`POST /api/v1/settings/api-tokens`), calendar-feed creation and rotation (`POST /api/v1/settings/calendar-feed` and `/rotation`), and export-download issuance (`POST /api/v1/exports/{exportId}/downloads`);
  - `credential`, excluded conservatively: sign-in, MFA, registration and email verification, password reset, and each invitation-acceptance step, the same endpoints the credential rate-limit zone counts.

  A location serves every method on its path, so the token list, the feed status, and the feed revocation on those paths stay uncompressed too; they are small. The contract test fails when a marked route's path is compressed, when any other API path is not, or when the registry's marks drift from D4's list, so a new or moved route must be marked before it ships. The renderer pages, which include the invitation page carrying its token in the path, keep nginx's uncompressed default.
- **Brotli at the edge.** The pinned nginx image has no brotli module, so the gateway offers gzip only. FER-08 measured brotli level 11 at about 12–17% fewer bytes than gzip for scripts and styles. The Dokploy edge is Traefik, which this repository does not configure; an operator may add its `compress` middleware with brotli. That middleware leaves a response that already carries `Content-Encoding` alone, so the gateway's gzip passes through, but it would compress the excluded answers, which arrive uncompressed. An edge compressor must therefore be attached only to a router that excludes the paths above, or not at all. Until an operator measures and records one here, the edge adds no compression.

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
