# Backend Architecture

## Architecture Style

Start with a modular monolith. Deploy the API and background worker as separate
processes from the same backend image, while keeping one codebase and one
PostgreSQL database. This preserves strong module boundaries without paying the
operational and transactional cost of premature microservices.

Each bounded context is a vertical module with a small hexagonal core:

```text
HTTP / worker trigger
        |
        v
transport adapter -> application use case -> domain
                           |
                           v
                         ports
                           ^
                           |
              PostgreSQL / file / mail adapters
```

Frameworks are implementation details at the edges. A module's domain and use
cases must remain runnable in tests without Hono, PostgreSQL, Deno environment
access, the filesystem, or a network.

## Repository Shape

```text
apps/
  api/                    # Deno HTTP composition root
  worker/                 # Deno background composition root
  web/                    # Astro frontend
packages/
  backend/
    bootstrap/            # configuration and concrete dependency wiring
    platform/             # narrowly scoped shared infrastructure adapters
    modules/
      identity/
        domain/
        application/
        ports/
        adapters/postgres/
        transport/http/
      people/
      interactions/
      reminders/
      ...
    read-models/           # explicitly approved cross-module read queries
  contracts/              # OpenAPI artifact and generated consumer types
tools/                    # repository checks, schema verification, generators
```

The scaffold-level path and entry-point contract is now accepted in
[`repository-layout.md`](repository-layout.md). The sketch above is
illustrative; where it differs in detail, that contract and
[`module-boundaries.yaml`](module-boundaries.yaml) are authoritative.

## Dependency Rules

1. `domain` is pure TypeScript. It may depend only on its own domain code and a
   deliberately tiny shared kernel.
2. `application` owns use cases, authorization, transaction boundaries, and
   ports. It depends on domain code, never on concrete adapters.
3. `ports` are capability-specific interfaces owned by the consuming module. Do
   not create a generic base repository abstraction.
4. `adapters` implement ports for PostgreSQL, object storage, email, clocks,
   identifiers, and external services.
5. `transport` maps HTTP/auth/validation concerns to application commands and
   maps results to API responses. Hono, Zod, cookies, and OpenAPI annotations
   stay here.
6. Composition roots are the only locations allowed to instantiate concrete
   adapters and inject them into use cases. Do not use a global mutable service
   locator.
7. A module may call another module only through its public application facade
   or a published domain contract. It may not import the other module's
   repositories, database adapter, or private entities.
8. Cross-module projections and dashboards use named, read-only read models.
   Their joins are explicit exceptions, tested for tenancy, and cannot perform
   writes.
9. Optional modules such as billing, DAV, weather, OAuth integrations, and
   operations may depend on core contracts; core modules must not depend on
   optional module implementations.

The shared kernel should contain only stable primitives such as branded
identifiers, result/error types, clocks, instants, and explicit partial-date
values. It must not become a generic `utils` package.

## Module Boundaries

Align bounded contexts with the canonical schema and the product contract, not
necessarily one module per table:

- identity and access;
- workspaces and workspace configuration;
- people, contact methods, addresses, and personal details;
- relationships and groups;
- interactions and communications;
- journal and life events;
- tasks, reminders, and notifications;
- files and attachments;
- gifts and debts;
- import and export;
- integrations;
- API clients/tokens/webhooks;
- compliance and audit;
- billing and operations as optional outer modules.

The accepted module IDs, exact table ownership, allowed module dependencies,
public entry points, events, and read models are recorded in
[`module-boundaries.yaml`](module-boundaries.yaml). Refining them requires
dependency evidence from use cases and a synchronized manifest/documentation
change. Do not split modules into services merely because their tables are
grouped separately.

## Person Profile Read Composition

The product has one canonical person workspace at `/app/people/:personId`. It
composes identity, profile facts, relationships, life events, notes,
communications, activities, tasks, reminders, gifts, debts, documents, and
photos on the same user-facing surface.

This does not turn `people` into a module that owns all those tables. The
`person-profile` read model is an explicit query-only exception allowed to read
the source modules named in the boundary manifest. It cannot write, return raw
database rows as process contracts, or expose a general query builder.

Every profile mutation calls the public application facade of the module that
owns the changed data. The API may compose those facades; the profile read model
may not bypass them. Heavy sections can be loaded independently so one optional
failure does not make the complete profile unavailable.

## Data Access and Transactions

- Canonical, immutable SQL migrations create the database. ORM/query-builder
  declarations must not generate competing DDL.
- Generate Kysely database types from a clean PostgreSQL instance after
  migrations apply. Generated types describe storage; they are not domain
  entities or API contracts.
- Application services own transactions. Repositories accept a
  transaction/session capability when a use case needs atomic work.
- Keep SQL in the module that owns the write model. Approved read models may
  join across modules for queries only.
- Avoid exposing raw query-builder instances outside adapters.
- Concurrency-sensitive use cases must use explicit PostgreSQL constraints, row
  locks, advisory locks, or compare-and-swap semantics and must have race tests.

### DG-06A onboarding and invitation coordination

The authoritative decision is
[`ADR 0004`](decisions/0004-onboarding-invitation-and-atomic-audit-coordination.md).

A workspaces-owned, use-case-specific application service coordinates both
first-user/workspace creation and invitation acceptance. Identity is called only
through its public application facade, and each module retains ownership of its
tables and writes.

The workspaces application service owns one transaction/session boundary for the
identity, workspace membership, invitation, and required governance audit
effects. The composition root registers the synchronous, transaction-scoped
governance audit handlers and supplies the same transaction/session capability
to every participant. This is distinct from durable asynchronous delivery and
does not create a workspaces-to-governance dependency.

Any failed required effect triggers all-or-nothing rollback. After all effects
succeed, the service verifies explicit success postconditions before commit; any
unmet postcondition also triggers rollback. A participant is not permitted to
use a private adapter import or direct cross-module table write, and this
specialization does not introduce a generic horizontal coordinator.

FND-002 records this contract but does not implement or prove the application
behavior, rollback, or postconditions. Protected walking-skeleton and Slice 1
executable proof remains required.

The first implementation milestone must execute the audited baseline against a
supported real PostgreSQL image. It must verify clean apply, teardown or
rollback, catalog introspection, generated-type agreement, and every validation
case required by `AGENTS.md`. Structural review alone is not enough.

## Workspace Isolation

Workspace isolation is a security boundary, not a repository filter convention.

- Resolve the authenticated principal and active workspace before invoking a
  protected use case.
- Pass typed principal/workspace context explicitly to application services.
- Application services reject unauthorized or cross-workspace identifiers before
  persistence.
- Repositories scope aggregate access by workspace whenever the canonical model
  carries `workspace_id`.
- Strict child/link tables without `workspace_id` are reachable only through a
  verified owning aggregate.
- Never accept `workspace_id` from an untrusted body as authorization evidence.
- Add a negative integration test for every cross-aggregate link and every
  cross-workspace mutation path.

PostgreSQL row-level security can be evaluated later as defense in depth, but it
must not replace application authorization or these tests.

## Time and Partial Dates

- Represent an instant and a calendar date as different types.
- Use Temporal for instants, zones, recurrence calculations, and scheduling.
- Model birthdays and other partial dates with explicit precision and
  components; never coerce an unknown year or day into a JavaScript `Date`.
- Inject a clock into use cases so time-dependent behavior is deterministic in
  tests.
- Persist and compare time according to the canonical schema contract, including
  user/workspace time zones and daylight-saving transitions.

## HTTP Contract

- Expose versioned REST endpoints under `/api/v1`.
- Generate and check in an OpenAPI 3.1 document from transport-boundary schemas.
- Return machine-readable errors using RFC 9457 problem details with stable
  application error codes.
- Use cursor pagination for mutable collections; do not expose storage offsets
  as a durable client contract.
- Generate frontend API types/client from OpenAPI and fail CI on generation
  drift.
- Keep transport DTOs distinct from database rows and domain entities.
- Use idempotency keys for retryable external mutations where duplicates would
  be harmful.

Prefer same-origin, `HttpOnly`, `Secure`, appropriately `SameSite` cookies for
browser sessions. Keep API tokens separate and never store browser session
credentials in `localStorage`. Apply CSRF protection to cookie-authenticated
mutations and explicit origin/CORS rules at the gateway and API.

## Pagination

Every list endpoint pages the same way, so a client learns the rule once.
`packages/contracts/schemas/shared.ts` publishes the query as `pageQuery`, and a
list that carries extra filters extends it rather than restating the bounds.

- **Request.** `limit` is an integer between 1 and 50 and defaults to 20; a page
  smaller than 20 keeps its own smaller default. `cursor` is an opaque string of
  at most 2,000 characters. Neither is required, and a first page asks for
  neither. An endpoint that pages two independent collections in one answer
  names one cursor per collection (`giftCursor` and `debtCursor`) and shares the
  one `limit`.
- **Response.** A page answers with its items and, when more rows exist,
  `nextCursor` — one `next…Cursor` per paged collection. The member is absent
  when the page is the last one, so "is there more" is a property of the body
  rather than something a client infers from a full page. The page is produced
  by reading `limit + 1` rows in the adapter and serving `limit` of them, never
  by a second `count(*)`.
- **Order.** A paged listing orders by a stable key pair whose last component is
  the row identifier — `updated_at desc, id`, `created_at, id`, and so on — so
  the anchor names exactly one row and a page boundary cannot drop or repeat a
  row when a neighbour changes.
- **Cursors.** A cursor carries the keyset anchor it resumes from and the
  question it was minted for, never an offset, and it is encoded with the
  shared-kernel codec in `packages/backend/shared-kernel/pagination.ts`. Each
  module owns its own codec in `<module>/domain/cursors.ts`, because minting and
  reading one is arithmetic over the anchor rather than a database concern. The
  workspace, and the person where the listing hangs off one, are part of the
  encoded body and re-checked on the way in, so a cursor replayed against
  another tenant's listing is refused rather than answered. A listing whose
  filters travel inside the cursor signs it, because a forged body would widen
  the query; a listing whose anchor is re-validated against rows the caller may
  already see needs only the opaque encoding.
- **Refusal.** Decoding never throws. A malformed, foreign, or stale cursor is a
  rejected request: the surface answers `400` with its own `*_query_invalid`
  code unless it already distinguishes staleness, in which case it keeps that
  answer (tasks answer `409 task_cursor_stale`, relationship listings answer
  their own `stale-cursor` problem). Every paged endpoint therefore documents a
  `400`.

## Response and Timestamp Conventions

- A read answers `{ …collection, status: "ready" }` and a write answers
  `{ …subject, status: "created" | "saved" | "unchanged" | … }`. `status` is a
  literal the document publishes, so a client branches on it rather than on a
  status code.
- Every transport shape is closed (`additionalProperties: false`) and every
  array is bounded by the page size it can hold.
- Timestamps crossing the boundary are ISO 8601 in UTC, produced by the use case
  that owns the value. A route never formats one: it passes through what the use
  case returned. Adapters render `timestamptz` with
  `packages/backend/platform/postgres/timestamps.ts` so the precision is the
  column's, not the driver's.
- A calendar date stays a `YYYY-MM-DD` string and is never widened into an
  instant.

## Background Work

The worker calls the same public application use cases as HTTP adapters. It does
not bypass authorization/invariants by writing tables directly.

- Use database-backed claiming and locking for work already representable by the
  canonical schema.
- Make handlers idempotent and safe to retry.
- Store attempt/outcome observability according to the canonical contract.
- Coordinate multiple workers explicitly and test duplicate delivery, process
  death, and lease expiry.
- Do not treat in-memory events as durable delivery.
- Do not repurpose `scheduled_job_runs` as a job queue.

If reliable publication between modules or external systems requires a
transactional outbox, design it as a synchronized next schema version before
implementation.

## Files and External Effects

Store file metadata and authorization in PostgreSQL and file bytes behind an
object-storage port. Development and tests use the pinned RustFS server;
production may use RustFS or another compatible S3 implementation. Uploads
require size/type limits, generated object names, malware-scanning integration
points, and tests for missing or quarantined objects.

Email, webhooks, OAuth, AI providers, geocoding, and similar services are ports.
Each adapter has timeouts, bounded retries, redacted structured logs, and
deterministic fakes for tests. No domain code calls vendor SDKs directly.

## Architectural Enforcement

The intended dependency graph must be machine-enforced, not left to review
memory. The quality strategy requires:

- validation of `module-boundaries.yaml` against its JSON Schema;
- proof that every canonical table has exactly one module owner;
- a Deno lint plugin for forbidden imports and layer-only APIs;
- a dependency-graph test for cycles and illegal module edges;
- lint rules preventing framework, environment, filesystem, network, and
  database imports in domain code;
- tests that instantiate use cases with in-memory/fake ports;
- an explicit allowlist for cross-module read models;
- ownership rules for schema-backed modules and generated contracts.

Any exception needs a narrow documented rule and a regression test. Broad
disables are architecture changes.
