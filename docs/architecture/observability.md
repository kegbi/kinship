# Observability Contract

## Goals

Telemetry must answer:

- which user-visible operation failed and where;
- which workspace-scoped capability was attempted without exposing CRM content;
- whether API, database, worker, storage, mail, import/export, or an integration
  caused the failure;
- whether a retry is safe and whether it already succeeded;
- which release, schema version, and service instance produced the signal.

Telemetry is operational evidence, not a second audit log or analytics
warehouse.

## Correlation

Every request and background operation carries:

- trace ID and span ID;
- operation/use-case name;
- service and deployment identity;
- result class and stable application error code;
- duration;
- retry/attempt and idempotency identifiers when applicable;
- workspace and actor references only when policy allows their pseudonymous IDs.

HTTP responses expose a safe request/trace reference in problem details. Worker
jobs continue the originating trace when a durable carrier exists or start a
linked trace when it does not.

<!-- deno-fmt-ignore -->
Gateway-to-`web`-to-`api` requests preserve one correlation context, and each hop records its own service span.

## Structured Logs

Production code writes structured events through a telemetry port. `console`
calls are forbidden outside approved bootstrap/tool paths. Message strings do
not contain arbitrary user content; variable data uses allowlisted fields.

<!-- deno-fmt-ignore -->
Renderer telemetry uses safe route templates and redacts token path segments, query values, cookies, authorization data, verification and reset data, invitation data, MFA data, and compliance payloads. Personalized renderer responses use `Cache-Control: private, no-store`; fingerprinted static assets use `Cache-Control: public, max-age=31536000, immutable`.

Minimum event classes:

- process startup, configuration validation, readiness transition, and shutdown;
- request completion and rejected authorization;
- database timeout/serialization/deadlock class without SQL parameter values;
- worker claim, success, retry, dead-letter/manual-attention state;
- import/export phase and aggregate counts;
- external adapter timeout/rate-limit/failure with provider-safe metadata;
- file metadata/object mismatch and quarantine state;
- migration lock, plan, checksum, apply, and failure.

## Metrics

Initial metrics remain low-cardinality:

- request rate, duration, and error class by route template;
- active/queued worker items, claim latency, attempts, and terminal failures;
- reminder occurrence generation/delivery lag and duplicate prevention;
- database pool saturation and query duration buckets;
- object-store and mail adapter duration/error class;
- import/export phase duration, entity counts, and reconciliation failures;
- process readiness and resource saturation.

Person IDs, raw workspace IDs, email addresses, route parameter values, and
free-text errors are forbidden metric labels.

## Traces

Trace application use cases and external boundaries. Do not create a span for
every trivial function. SQL spans use normalized operation/table information and
never record bound values containing personal data.

The person-profile trace should make independently loaded sections visible so a
slow optional section can be diagnosed without treating the entire profile as
one opaque request.

## Audit Versus Telemetry

`audit_events` records durable product/security facts visible to authorized
users. Operational logs and traces may expire and are not authoritative product
history. A successful domain action can deliberately emit both, but telemetry
failure must not corrupt the domain transaction and audit content must follow
the canonical schema.

## Health Endpoints

- Liveness checks only process responsiveness.
- Readiness checks mandatory dependencies with strict timeouts.
- Detailed diagnostics require administrative authorization and remain redacted.
- Public health responses never reveal versions, connection strings, provider
  accounts, stack traces, or schema internals.

## Retention And Failure Artifacts

Retention is environment-specific and documented before production. CI uploads
logs, traces, Compose diagnostics, schema reports, and Playwright traces only on
failure or when explicitly requested. Artifacts are treated as potentially
sensitive, have bounded retention, and are not publicly accessible.

## What Exists Today

The sections above are the target contract. This section records what the
repository implements now (GAP-039), so the two are never confused.

### Port Placement

- The `Logger` port, the closed event catalogue (`LogEvent`,
  `LOG_EVENT_SHAPES`), and the `Correlation` value live in the shared kernel,
  `packages/backend/shared-kernel/telemetry.ts`. The kernel is the one unit
  every layer may import, so a use case logs and carries correlation without
  importing `packages/backend/platform`, which the layer rule forbids.
- The adapter lives in `packages/backend/platform/telemetry/json_logger.ts`: one
  redacted JSON line per event on stdout. The API and worker composition roots
  construct it; nothing else does.
- The HTTP kit's request logging (`packages/http-kit/logging.ts`) writes through
  the kernel port. Tests use `recordingLogger()` from
  `packages/backend/testing/fakes.ts` or `silentLogger()` from the kernel.

### Event Catalogue

Only these events exist. The two gateway events are Nginx log formats; the
adapter accepts only `api.request` and `worker.job` and refuses any other name.

| Event               | Emitted by                                    | Fields                                                                                       |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `gateway.request`   | Nginx access log                              | `method`, `route` (template), `status`, `duration_seconds`, `bytes_sent`, `request_id`       |
| `gateway.readiness` | Nginx readiness probe                         | `boundary`, `state`, `status`, `dependency_status`                                           |
| `api.request`       | HTTP kit, one per API request                 | `method`, `route` (registered pattern or `unmatched`), `status`, `duration_ms`, `request_id` |
| `worker.job`        | reminder delivery, one per claimed occurrence | `job`, `request_id`, `attempt`, `outcome`, `duration_ms`                                     |

`worker.job` outcomes are the stable delivery codes `sent`, `retry`, `failed`,
`manual_attention`, `stale-claim`, and `processing-error`. A failure is
described by that code or by an HTTP status, never by `error.message`.

### Redaction

The adapter enforces the catalogue at runtime, whatever a caller passes through
a cast or a spread:

- a field an event does not declare is stripped, so authorization values,
  cookies, query strings, person and workspace identifiers, CRM content, and
  free-form error text (the `forbiddenLogData` classes in
  `docs/planning/private-production-profile.json`) have nowhere to go;
- a declared field whose value is outside its class is stripped: a `route` must
  be a template without a query string or a UUID, a `code` must be a short
  lower-case token that is not a UUID, a `request_id` must match the request-ID
  rule, and numbers must be non-negative integers.

### Correlation

- The gateway forwards its own `$request_id` to the API as `X-Request-Id`
  (`/api/v1/` and `/gateway-health`) and logs it as `request_id` in
  `gateway.request`. A client-supplied `X-Request-Id` does not pass the gateway.
- The API's request-ID middleware keeps a supplied `[\w-]{1,128}` value or mints
  a UUID, echoes it in the `X-Request-Id` response header, and logs it in
  `api.request`.
- The HTTP kit's session middleware puts the identifier on the resolved actor
  (`SessionActor.requestId`, including token-authenticated and workspace-scoped
  actors), so every use case that receives the actor receives its correlation.
- Each module's `describe…Event` forwards the actor's correlation as
  `AuditEvent.requestId`, and the one governance writer stores it as
  `payload.requestId` (`auditPayload` in `shared-kernel/audit_event.ts`). The
  canonical schema is unchanged: `audit_events.payload` is `jsonb`.
- The worker mints one correlation identifier per job run (one per claimed
  reminder occurrence); it appears in that run's `worker.job` line and in the
  delivery audit row's `payload.requestId`.
- `payload.requestId` is operational correlation, not product history. The
  audit-history read model drops it without marking the event redacted, and the
  portable JSON export does not contain audit events.

Not correlated yet: audit events written before an actor exists (registration,
authentication, invitation acceptance, legal acceptance) and the lifecycle
events built from a resolved session rather than an actor; the Astro renderer's
server-side API calls; the workspace-cleanup reconciler, which logs nothing yet.

### Not Implemented

- There is no metrics port and no tracing port. Worker counts and durations are
  `worker.job` log events. A metrics port becomes worth adding when a consumer
  needs aggregated rates or saturation that log queries cannot answer (for
  example an alerting rule on reminder-delivery lag); a tracing port when a
  second hop (the renderer calling the API, or an external provider) needs spans
  rather than a shared request identifier.
- Problem-detail bodies do not repeat the request identifier; the `X-Request-Id`
  response header carries it.
- Logs are local only (`telemetry.thirdPartyExport` is `false`); retention is
  whatever the container runtime keeps.
