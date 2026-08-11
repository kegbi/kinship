# Implementation Research And Capability Assessment

## Scope And Method

Research was checked against primary project documentation and standards on
2026-08-11. This file records implementation consequences, not package pins.
Exact versions are deliberately selected only by the Foundation compatibility
matrix, then committed in manifests, lockfiles, image digests, and frozen CI
installs as required by the accepted architecture.

The repository itself was also inspected. It currently contains architecture and
product contracts, the synchronized PostgreSQL schema bundle, and a Deno
schema-validation harness. It does not yet contain the API, worker, web app,
production Dockerfiles, main Compose topology, application tests, E2E tests,
frontend lockfile, Lefthook configuration, or CI workflow. This means Slice 0 is
executable foundation work, not cleanup around an existing application.

## Feasibility Conclusion

The accepted stack is capable of delivering the application, but adoption is
conditional on five repository-specific proofs:

1. Astro on-demand rendering must gain an accepted production runtime topology.
2. Kysely plus the external Postgres.js dialect must pass on the pinned Deno
   runtime against both supported PostgreSQL majors.
3. The selected Hono OpenAPI integration must generate deterministic OpenAPI 3.1
   and the repository's RFC 9457 error contract.
4. Better Auth must adapt to the canonical identity tables without creating,
   renaming, or owning schema; otherwise the application implements its own
   identity orchestration behind the same module ports.
5. Migration and durable worker designs must fit the canonical schema. Any new
   ledger, outbox, lease, or attempt columns require a synchronized schema
   version before application implementation relies on them.

None of these proofs justifies changing the modular-monolith boundaries,
introducing a second schema authority, substituting Bun, adding Redis, or
turning the UI into an always-server-rendered SPA.

Least-privilege database roles are required, but their provisioning boundary is
not yet defined. DG-02 must classify roles/grants as reviewed deployment
bootstrap or synchronized schema content and test that boundary. Compose
initialization scripts may not silently become another DDL authority.

## Capability And Requirement Ledger

| Area                        | What current official material establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Repository consequence                                                                                                                                                                                                                                                                      | Foundation evidence                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno runtime                | Deno provides TypeScript execution, a permission model for tests/processes, coverage collection/reporting with thresholds, lockfile-oriented dependency controls, and native OpenTelemetry support with documented [limitations](https://docs.deno.com/runtime/fundamentals/open_telemetry/#limitations). See the official [test reference](https://docs.deno.com/runtime/reference/cli/test/), [coverage reference](https://docs.deno.com/runtime/reference/cli/coverage/), [configuration reference](https://docs.deno.com/runtime/reference/deno_json/), [dependency security guidance](https://docs.deno.com/runtime/packages/supply_chain/), and [OpenTelemetry guide](https://docs.deno.com/runtime/fundamentals/open_telemetry/). | Use Deno-first tasks for backend build/test/coverage and deny undeclared runtime permissions. Commit `deno.lock`; cache only as an optimization; export OTLP through configuration and prove explicit Hono/log/DB instrumentation.                                                          | Pinned runtime passes format, lint, typecheck, unit/integration/contract tests and the PostgreSQL 17/18 matrix with frozen resolution.                            |
| Hono HTTP delivery          | Hono documents direct Deno execution, route testing through `app.request`, validation middleware, and OpenAPI integrations. See [Hono on Deno](https://hono.dev/docs/getting-started/deno), [testing](https://hono.dev/docs/guides/testing), [validation](https://hono.dev/docs/guides/validation), and the [OpenAPI example](https://hono.dev/examples/hono-openapi).                                                                                                                                                                                                                                                                                                                                                                   | Keep Hono in transport/composition only. Zod schemas define transport validation, while generated API artifacts must not leak transport types into domain code.                                                                                                                             | Protected request, validation failure, RFC 9457 response, OpenAPI generation, and generated-client round trip all pass.                                           |
| OpenAPI/error format        | [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) defines Problem Details for HTTP APIs. Hono integrations vary in their documented OpenAPI output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Prove, do not assume, OpenAPI 3.1 generation. Normalize every error at the transport boundary and test content type, required fields, stable codes, trace correlation, and safe detail.                                                                                                     | Byte-stable spec generation; no diff after regeneration; client compiles; representative success/error contract tests pass.                                       |
| Query layer                 | [Kysely](https://www.kysely.dev/) is a type-safe SQL query builder and [Postgres.js](https://github.com/porsager/postgres) is a PostgreSQL client. The selected [`kysely-postgres-js`](https://github.com/kysely-org/kysely-postgres-js) support is external to Kysely's built-in `pg` dialect.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Treat the dialect combination as provisional until Deno compatibility, transactions, parameter binding, cancellation, pooling, TLS, numeric/date mapping, and error mapping are proven. Raw SQL remains the schema source of truth.                                                         | Focused compatibility executable runs against PostgreSQL 17 and 18 under the exact pinned Deno/package graph.                                                     |
| Astro rendering             | Astro is static by default; a route rendered on demand needs server output and an adapter. See [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/) and the official [Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/).                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The five cataloged on-demand routes cannot run in the currently documented static-only production path. Recommended resolution: private Astro Node runtime behind the gateway for only dynamic routes, while static assets remain gateway-served.                                           | Production-image E2E proves all five dynamic routes and a representative static-shell route through the same public gateway.                                      |
| Astro islands and shadcn/ui | Astro's [islands architecture](https://docs.astro.build/en/concepts/islands/) hydrates focused interactive components; shadcn publishes an [Astro installation path](https://ui.shadcn.com/docs/installation/astro).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Prefer Astro pages and server-independent static shells. Hydrate React only for shadcn/ui or genuinely interactive islands. No backend-internal imports; use only the generated client.                                                                                                     | Bundle/hydration budget, no-JavaScript public page, keyboard/accessibility, and generated-client import-boundary tests pass.                                      |
| Node/pnpm for web tooling   | Node publishes defined release lines and LTS status in its [release overview](https://nodejs.org/en/about/previous-releases); pnpm supports a frozen lockfile install, documented by [`pnpm install`](https://pnpm.io/cli/install).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pin an active supported Node line for Astro build/E2E tooling and an exact package-manager version. Commit `pnpm-lock.yaml`; production builds use frozen installs. Node becomes a private web runtime only if DG-01 accepts the recommended topology; it is never a backend substitution.  | Clean container build succeeds from lockfiles with no implicit global package state.                                                                              |
| Authentication candidate    | Better Auth documents table/field customization, a custom adapter interface, Hono integration, and plugins for passkeys and 2FA. See [database customization](https://better-auth.com/docs/concepts/database), [custom adapters](https://better-auth.com/docs/guides/create-a-db-adapter), [Hono integration](https://better-auth.com/docs/integrations/hono), [passkeys](https://better-auth.com/docs/plugins/passkey), and [2FA](https://better-auth.com/docs/plugins/2fa).                                                                                                                                                                                                                                                            | These capabilities make a spike plausible, not accepted. Plugin/default schema generation must be disabled or bypassed. Map the exact canonical tables/constraints and preserve workspace authorization in application code. Reject on any required shadow table or schema ownership.       | The auth matrix below passes against an unmodified canonical schema and the spike ADR records accept/reject with package graph and limitations.                   |
| PostgreSQL coordination     | PostgreSQL provides [advisory locks](https://www.postgresql.org/docs/current/functions-admin.html). `SELECT ... FOR UPDATE SKIP LOCKED` can reduce contention for queue-like consumers, with the caveat documented in [`SELECT`](https://www.postgresql.org/docs/current/sql-select.html) that it provides an inconsistent view unsuitable for general-purpose reads. PostgreSQL also provides [row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).                                                                                                                                                                                                                                                    | Use transaction/advisory coordination where proven. Do not mistake `SKIP LOCKED` for a complete durable-worker design or RLS for the primary application authorization boundary. RLS, if adopted, is defense in depth and needs an ADR plus tests.                                          | Concurrent migration/worker tests, process-death recovery, duplicate suppression, cross-workspace rejection, and least-privilege database roles pass.             |
| Compose                     | Docker documents health/one-shot dependency conditions in [startup order](https://docs.docker.com/compose/how-tos/startup-order/), plus [profiles](https://docs.docker.com/compose/how-tos/profiles/), [project names](https://docs.docker.com/compose/how-tos/project-name/), [secrets](https://docs.docker.com/compose/how-tos/use-secrets/), and immutable [build best practices](https://docs.docker.com/build/building/best-practices/).                                                                                                                                                                                                                                                                                            | Model `postgres -> migrate -> api and worker`. Gateway waits for API readiness and built static assets and, only if DG-01 retains on-demand routes, the private web renderer. Worker degradation is reported separately and does not block gateway readiness. Keep only the gateway public. | Fresh build/up, readiness, service restart, migration failure, and isolated test-project teardown pass.                                                           |
| Browser E2E                 | Playwright installs and runs Chromium, Firefox, and WebKit projects and documents image/package version matching and automated accessibility checks; see [browser support](https://playwright.dev/docs/browsers), [Docker](https://playwright.dev/docs/docker), and [accessibility testing](https://playwright.dev/docs/accessibility-testing).                                                                                                                                                                                                                                                                                                                                                                                          | Every required flow runs in all three browser engines as the accepted contract requires. Automated accessibility checks are paired with keyboard/focus/semantic assertions because automation cannot prove all accessibility.                                                               | Each stable flow ID maps to a spec; traces/screenshots are retained on failure; representative axe, keyboard, focus, responsive, and reduced-motion cases pass.   |
| Accessibility               | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the current web accessibility recommendation researched for the UI baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Propose WCAG 2.2 AA for user-facing surfaces: semantics, focus, keyboard, contrast, names, errors, status messages, target size, reflow, and authentication usability. The accepted catalog's automated and keyboard requirements remain mandatory while the formal target is approved.     | Automated scan plus manual/behavioral checks are recorded per reusable component and representative flow.                                                         |
| Security assurance          | [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) provides an application-security verification framework.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Create a threat model and choose the applicable ASVS verification requirements before Slice 1. Make auth, tenant isolation, file/import handling, secrets, logging, and supply chain explicit CI/release gates.                                                                             | Requirement-to-test ledger, dependency/container scans, secret scan, abuse cases, and release sign-off exist.                                                     |
| Observability               | OpenTelemetry defines vendor-neutral traces, metrics, and logs and standardized semantic conventions; see [concepts](https://opentelemetry.io/docs/concepts/) and [semantic conventions](https://opentelemetry.io/docs/specs/semconv/).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Carry correlation context gateway-to-API-to-worker/provider. Never record credentials, tokens, file contents, free-form notes, or imported source payloads. Decide backend/retention separately from instrumentation.                                                                       | Trace/log correlation, redaction tests, metric cardinality budgets, health/readiness and alert runbooks pass.                                                     |
| AI safety                   | NIST publishes an [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework), while OWASP maintains risks for [LLM applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | AI has no accepted product contract yet. Start only after defining module ownership, permissions, data minimization, provider/retention policy, prompt-injection boundaries, human confirmation, evals, costs, and failure behavior.                                                        | Deterministic fake provider, authorization/data-boundary tests, adversarial eval set, no autonomous writes/sends, explicit user confirmation, and disable switch. |

## Required Foundation Spikes

Each spike is bounded, executable, and disposable. A spike passes only when its
evidence is committed and its result is reflected in an ADR/contract; prototype
code does not silently become production architecture. The roadmap schedules all
eight spikes explicitly; SP-07 is FND-06 and covers generic durable jobs as well
as reminder delivery.

### SP-01: Pinned runtime and dependency matrix

Prove the selected Deno, Node, pnpm, Astro, Hono, Zod, Kysely, Postgres.js
dialect, test, and build graph on every supported host/container target.

Pass criteria:

- exact manifests, lockfiles, checksums, and base-image digests are recorded;
- Deno frozen dependency resolution and pnpm frozen install work from a clean
  cache;
- the repository's PostgreSQL 17 and 18 schema matrix remains green; and
- runtime/tool packages have compatible licenses and no unaccepted critical
  vulnerabilities.

### SP-02: Kysely plus Postgres.js on Deno

Run a real PostgreSQL exercise covering connection/TLS configuration,
parameters, transactions and rollback, nested transaction behavior if used,
constraint error classification, cancellation/timeouts, pooling shutdown,
`bigint`/numeric/timestamp/date/JSON/array mapping, and concurrent requests.

Fail means evaluate another Deno-compatible adapter through an ADR; it does not
authorize Bun, an ORM schema authority, or application-wide raw driver usage.

### SP-03: Better Auth canonical-schema compatibility

Exercise:

- registration and email verification;
- custom password hooks using the accepted Deno Web Crypto Argon2id encoded
  format, including parameter/version upgrade tests rather than Better Auth's
  default password-hash choice; see Better Auth's
  [security reference](https://better-auth.com/docs/reference/security);
- password reset expiry, replay prevention, and session invalidation;
- TOTP enrollment/challenge/recovery codes;
- passkey register/challenge/revoke;
- session create/rotate/revoke/all-session revoke;
- table and field mapping for every canonical identity table;
- transactions, canonical IDs/timestamps, and normalized errors; and
- exact mapping to canonical `users.password_hash`; and
- complete operation with schema generation, unapproved account/shadow tables,
  secondary storage/Redis, and auto-migrations disabled.

Reject Better Auth if any required flow needs a shadow table, incompatible
constraint, unowned migration, unrepresentable session semantics, or unsafe
extension point. Record what application-owned security controls remain even if
it passes.

### SP-04: OpenAPI 3.1 and generated client

Generate a minimal protected and public API with success, validation,
authorization, not-found, conflict, rate-limit, and internal Problem Details.
Regenerate twice and compare bytes, compile the client, consume it from an Astro
island, and fail CI when source and generated output drift.

### SP-05: Astro production rendering topology

If DG-01 accepts the recommended private Astro runtime, build production images
and prove:

- the gateway serves versioned static assets directly;
- `/api/v1/*` reaches only the Deno API, with health endpoints routed under
  their separately accepted paths;
- the five cataloged on-demand routes reach the private Astro runtime;
- static-shell routes still use focused islands and generated API calls;
- forwarded headers, cookies, CSRF/origin policy, cache headers, compression,
  CSP, and request IDs behave at the public boundary; and
- `web` has no database credentials or backend-internal dependency.

If this topology is rejected, update the page catalog and an ADR before recoding
on-demand pages as static shells.

### SP-06: Migration runner and schema ledger

Prove discovery order, checksum verification, one-at-a-time locking, transaction
behavior, failed-state reporting, rerun/no-op behavior, and PostgreSQL 17/18
execution. First decide where migration metadata lives. If it requires a
database ledger table, introduce that table only through a complete synchronized
schema v2 bundle.

### SP-07: Durable background claims and recovery

Use the existing reminder, import, export, and DAV shapes to attempt concurrent
claim, lease expiry, retry/attempt accounting, cancellation, resumption,
provider timeout, process death around external effects, stale claims, and
duplicate execution. Prove workload-specific guarantees: duplicate-safe reminder
effects, rerunnable import staging plus atomic commit, resumable export
artifacts, and DAV token/conflict continuity. Otherwise propose the minimal
synchronized schema change; do not repurpose `scheduled_job_runs` as a queue.

### SP-08: Compose production-like path

Build the same immutable images used for release, run isolated Compose project
names, gate dependencies on migration completion/readiness, expose only the
gateway, seed deterministic fixtures, execute API/worker/selected-renderer/E2E
tests, retain failure artifacts, and tear down volumes/networks reliably.

## Product And Policy Research Still Required

Implementation research cannot resolve these choices without a product or
security decision:

- inert preservation/discard/report/re-enrollment semantics for imported
  password hashes, TOTP secrets, recovery factors, WebAuthn credentials, and
  user accounts while preserving the accepted invariant that no imported account
  or credential material can activate access, issue a session, or authenticate a
  factor;
- support level and fixture corpus for each Monica source version and archive
  layout;
- vCard/CSV import scope in addition to Monica imports;
- external API compatibility versus a new stable API only;
- storage, email, gateway/TLS, deployment, telemetry, and AI providers;
- CI provider, trigger/fork trust model, token permissions, secret boundary,
  immutable reusable-step policy, and artifact retention;
- reminder delivery channels and whether provider idempotency keys are
  available;
- multi-workspace switching and security-settings workflow breadth;
- operations/admin UI, roles, and deployment model;
- representative MVP capacity/performance ceilings, followed separately by
  production SLOs, provider limits, RTO/RPO, backup retention, and data
  residency; and
- the first AI capability, if any, plus consent, retention, evaluation, and cost
  limits.

Defaults in the roadmap keep provider interfaces replaceable and core CRM
behavior functional when optional providers/modules are disabled.

## Version-Selection Checklist

When Slice 0 first needs an executable dependency, record:

1. exact direct and transitive resolution in the relevant lockfile;
2. runtime and package-manager versions in tool configuration and CI;
3. container base image by immutable digest and supported OS/architecture;
4. compatibility evidence for PostgreSQL 17 and 18;
5. license, maintenance/release status, vulnerability and provenance review;
6. Deno permissions, Node lifecycle use, network endpoints, and native
   dependencies;
7. generated artifacts and reproducible clean-cache command; and
8. owner/date for scheduled upgrade review.

Automated updates should open reviewable changes and run the full gated matrix;
they must never update a manifest without its lockfile or bypass the spike
invariants.

## Research Revalidation

Recheck official documentation and compatibility evidence when a foundation
spike selects versions, when a major runtime/framework/database version is
proposed, before the first production deployment, and at each supported-stack
upgrade. Record changed assumptions in an ADR or the relevant accepted contract
rather than editing implementation around the contract silently.
