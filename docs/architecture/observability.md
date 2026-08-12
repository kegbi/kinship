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
