# Technology Baseline

## Accepted Constraints

| Area            | Baseline                                          | Consequence                                                                                                               |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Delivery        | Docker Compose with multiple containers           | Local, test, and production-like environments use the same service model.                                                 |
| Database        | PostgreSQL                                        | The audited SQL bundle is the only schema source of truth.                                                                |
| Backend runtime | Deno and TypeScript                               | Prefer Web Standards and Deno-native security, tasks, checks, tests, and observability.                                   |
| Frontend        | Astro, static-first                               | Prerender public and stable pages; hydrate only deliberately selected islands.                                            |
| Interactive UI  | Current stable shadcn/ui components               | Use the current shadcn CLI and source-owned components; React is confined to interactive islands.                         |
| Types           | Strict TypeScript throughout application code     | No implicit `any`; validate all untrusted runtime data.                                                                   |
| Quality         | Unit, integration, contract, and end-to-end tests | Production TypeScript has at least 80% line, branch, and function coverage; every defined user workflow has E2E coverage. |

Astro prerendering cannot produce private, per-user data at build time. An
authenticated screen should use a static shell plus a focused client island when
the loading trade-off is acceptable, or selective on-demand rendering when the
first render must contain personalized data. This is a page-level choice, not
permission to switch the whole frontend to SSR.

Use Node.js LTS with pnpm inside the frontend build and E2E toolchain because
Astro, shadcn/ui, and Playwright are maintained in the Node ecosystem. Deno
remains the backend runtime and the top-level task orchestrator. Adding Bun
would create a third JavaScript runtime without solving a current requirement,
so Bun is deferred.

At scaffolding time, use shadcn/ui's current default primitive family (Base UI
in this research snapshot) unless an accessibility or component-coverage test
shows a concrete blocker. Keep the choice consistent across the application; do
not mix Base UI and Radix primitives component by component without a documented
architecture decision.

## Accepted Backend Stack

These choices were accepted on 2026-08-09. Exact versions remain pinned by the
implementation manifests and lockfiles.

| Concern            | Selection                                      | Why                                                                                                                                                                            |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP adapter       | Hono                                           | Small Web Standards surface, first-class Deno support, typed handlers, routing composition, testing helpers, and OpenAPI integrations. Keep it at the transport boundary.      |
| Runtime validation | Zod through Hono's Standard Schema validator   | Mature TypeScript inference and one boundary schema for request validation and OpenAPI generation. Domain value objects remain framework-independent.                          |
| API description    | OpenAPI 3.1 plus RFC 9457 problem details      | Stable process boundary for the Astro client, importers, integrations, and future external clients.                                                                            |
| SQL access         | Kysely plus Postgres.js                        | SQL-shaped, strongly typed access with good Deno support and escape hatches for PostgreSQL features. Generate database types from a live database created by canonical SQL.    |
| SQL migrations     | Immutable raw SQL with checksums               | Preserve the audited DDL as source of truth. Select a thin Deno-compatible runner only after it proves locking, failure recovery, and drift detection against real PostgreSQL. |
| Git hooks          | Lefthook invoking `deno task` commands         | Fast standalone binary, parallel commands, staged-file filtering, and no Node bootstrap solely for hooks. CI remains authoritative.                                            |
| Password hashing   | Deno Web Crypto Argon2id                       | Deno 2.9 provides a runtime-native implementation without npm native addons or FFI. Store a versioned encoded representation and test parameter upgrades.                      |
| Telemetry          | Deno OpenTelemetry export to an OTLP collector | Built-in traces, metrics, and logs reduce application instrumentation dependencies.                                                                                            |
| API client         | Generated client/types from checked-in OpenAPI | Prevents the frontend from importing backend internals. `openapi-typescript` and `openapi-fetch` are suitable candidates.                                                      |
| Frontend lint      | `astro check` plus targeted ESLint plugins     | Deno lint covers TS/JS/TSX but not `.astro` templates. Use `eslint-plugin-astro`, its accessibility preset, and React's official hooks plugin for checks Deno cannot express.  |

Hono's RPC client may be useful within a single repository, but it must not
become the canonical boundary. The checked-in OpenAPI document and generated
client must work without importing the API application's source tree.

### Framework Comparison

| Framework | Assessment                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hono      | **Selected.** Best fit for Deno, Web Standards, a thin HTTP layer, typed routes, and the desired modular architecture.                               |
| Oak       | Strong second choice when a conventional Koa/Express-style middleware model matters more than minimal surface area and typed RPC/OpenAPI ergonomics. |
| H3 v2     | Promising universal HTTP core, but v2 is still documented as beta in this research snapshot. Do not base the initial production architecture on it.  |
| Elysia    | Attractive when Bun is the primary runtime. Its main optimization target does not match the accepted Deno runtime.                                   |

The framework does not define the backend architecture. Hono can be replaced
because handlers, middleware, and request schemas live only in transport
adapters.

Kysely is preferable to Drizzle for this project because the database contract
already exists as audited PostgreSQL SQL. A schema-in-TypeScript ORM model would
be a second definition that can drift. Kysely supplies typed queries without
claiming ownership of DDL. Likewise, Zod is the selected default; Hono's
Standard Schema integration leaves Valibot available if measured client bundle
cost later justifies a change, but the initial implementation should not carry
two validation libraries.

Migration-runner selection remains open. A bounded spike must compare a thin
Kysely/Deno raw-SQL provider with a dedicated versioned-migration CLI. The
winner must support advisory locking or equivalent single-runner coordination,
transactional failure behavior where PostgreSQL permits it, immutable-file
checksums, dry-run/status inspection, and clean Compose operation. Advanced
linting hidden behind a paid tier must not be the only enforcement of schema
safety.

## Authentication Decision

The Better Auth compatibility spike is **accepted and required before the auth
implementation begins**. Better Auth itself is not yet an accepted dependency.
Its Hono integration, passkey support, and relational adapter model are useful,
but its default data model overlaps the canonical users, sessions, verification,
recovery, MFA, and WebAuthn tables.

The spike must map Better Auth to the exact canonical schema through supported
table/field configuration or a custom adapter. Adopt it only if all of the
following hold:

1. No canonical table or field is changed merely to satisfy the library.
2. Password, session rotation/revocation, MFA, passkey, recovery, CSRF, and
   workspace-isolation tests pass.
3. Legacy credentials imported from Monica cannot become active accidentally.
4. The adapter can be maintained without relying on unstable private APIs.

If the spike fails, implement the identity application layer against the
canonical tables using standards-based cryptography and WebAuthn libraries. Do
not create a parallel auth schema.

## Compose Topology

The initial topology uses a base `compose.yaml`, a development override, and an
isolated test override. The accepted lifecycle, readiness, isolation, storage,
and reset behavior is defined in [`compose-contract.md`](compose-contract.md).

| Service          | Responsibility                                                   | Lifecycle                                                   |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `gateway`        | TLS/reverse proxy and production Astro static assets             | Long-running                                                |
| `api`            | Deno/Hono HTTP adapter and application composition root          | Long-running                                                |
| `worker`         | Reminder, notification, import/export, and maintenance use cases | Long-running; same backend image, different command         |
| `migrate`        | Apply and verify immutable SQL migrations before rollout         | One-shot                                                    |
| `postgres`       | Canonical durable store                                          | Long-running                                                |
| `web`            | Private Astro renderer                                           | Long-running in production/test; `astro dev` in development |
| `object-store`   | S3-compatible attachment storage such as MinIO                   | Development/test profile or separate production service     |
| `mail`           | Captured development/test mail such as Mailpit                   | Development/test profile                                    |
| `otel-collector` | Optional OTLP destination and local observability stack          | Observability profile                                       |

The frontend image should use a Node LTS/pnpm build stage, then copy static
artifacts into the gateway image. The API and worker use one pinned Deno image.
Health checks distinguish liveness from readiness; API readiness includes
database connectivity, while liveness does not fail merely because PostgreSQL is
briefly unavailable.

<!-- deno-fmt-ignore -->
`web` is a long-running private Astro renderer in production and test and an `astro dev` server only in development. `web` may consume only generated API contracts, a private API origin, forwarded request context, and renderer operations configuration. It receives no database, object-store, provider credential, identity key, backend-internal import, or direct-adapter authority.

Do not add Redis initially. PostgreSQL is the source of truth and is sufficient
for the first modular monolith. Add a cache or broker only after a measured
requirement and a failure-mode design. `scheduled_job_runs` is observability
data, not a durable queue. A transactional outbox or persistent job queue would
change the data model and therefore requires a synchronized new schema version.

## Deno Responsibilities

Deno 2.9 already covers the backend's core toolchain:

- `deno fmt` for supported source and documentation formats;
- `deno lint`, including project-specific lint plugins;
- `deno check` for type checking without execution;
- `deno test` for unit and integration tests;
- `deno coverage` with line, branch, and function thresholds;
- `deno task` as the repository command interface;
- `deno.lock`, `deno ci`, `deno audit`, and `deno outdated` for deterministic
  and inspected dependencies;
- deny-by-default runtime permissions;
- built-in OpenTelemetry export.

Deno does not manage Git hooks. Lefthook is used only as a thin trigger for
canonical `deno task` commands. Astro formatting in Deno 2.9 is behind the
component-formatting unstable flag; trial it with the runtime version pinned and
fall back to Prettier only if repository examples expose correctness or
stability problems.

For maximum frontend checking, use Deno lint for general TypeScript/TSX rules
and a narrowly configured current ESLint only for Astro-template, accessibility,
and React-specific plugin rules. Pin `eslint-plugin-astro` tightly because its
own versioning policy allows new findings in minor releases. Run `astro check`
separately with warnings treated as CI failures; ESLint does not replace Astro's
project-wide compiler diagnostics.

## Dependency and Runtime Policy

- Architecture and product documents intentionally do not pin snapshot package
  versions. Select compatible current stable releases only when the first
  executable scaffold or approved spike needs them.
- Once executable code exists, pin exact resolved dependencies,
  runtime/container versions, and action revisions in committed manifests and
  lockfiles. Do not use the pre-scaffold policy as permission for floating
  production builds.
- Pin the Deno image and Node LTS major; commit all lockfiles.
- Use `deno ci` in CI and reject lockfile drift.
- Keep npm lifecycle scripts disabled by default; explicitly allowlist any
  unavoidable package script after review.
- Set a deliberate minimum package age, initially three days, with documented
  exceptions for urgent security fixes.
- Prefer JSR, Web APIs, and packages verified on Deno; npm compatibility is
  available but not a reason to copy a Node-only backend architecture.
- Give each Deno process the smallest filesystem, environment, network,
  subprocess, and system permissions it needs. Avoid `--allow-all` outside
  disposable local investigation.
- Keep canonical audited schema files outside automatic formatters and code
  generators so their validated bytes and hashes remain stable.

## Official References

- [Deno Node and npm compatibility](https://docs.deno.com/runtime/fundamentals/node/)
- [Deno lint and custom lint plugins](https://docs.deno.com/runtime/reference/cli/lint/)
- [Deno testing and coverage](https://docs.deno.com/runtime/reference/cli/test/)
- [Deno security and permissions](https://docs.deno.com/runtime/fundamentals/security/)
- [Deno OpenTelemetry](https://docs.deno.com/runtime/fundamentals/open_telemetry/)
- [Hono documentation](https://hono.dev/docs/)
- [Hono validation](https://hono.dev/docs/guides/validation)
- [Astro islands](https://docs.astro.build/en/concepts/islands/)
- [Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [Astro TypeScript and `astro check`](https://docs.astro.build/en/guides/typescript/)
- [`eslint-plugin-astro`](https://ota-meshi.github.io/eslint-plugin-astro/user-guide/)
- [React hooks lint plugin](https://react.dev/reference/eslint-plugin-react-hooks)
- [shadcn/ui for Astro](https://ui.shadcn.com/docs/installation/astro)
- [Kysely documentation](https://www.kysely.dev/)
- [Zod documentation](https://zod.dev/)
- [Lefthook](https://lefthook.dev/)
