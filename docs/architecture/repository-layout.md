# Repository Layout Contract

## Status

Accepted before scaffolding and rewritten by GAP-043 to the tree as it stands
after the architecture-gap remediation (GAP-001 through GAP-041). Exact
dependencies live in `deno.json`, `package.json`, and their lockfiles, not here.
A change may add files inside this shape but may not weaken its public/private
boundaries without an architecture decision.

## Canonical Shape

```text
apps/
  api/                  composition root, entry point, API configuration
    main.ts
    composition.ts
    app.ts              the default-configured app
    personalization_router.ts
  worker/
    main.ts             runWorker: start, signals, shutdown
    composition.ts
  web/
    astro.config.mjs
    components.json       shadcn CLI configuration
    public/
    src/
      pages/              Astro routes (app/, auth/, invite/, internal/ shells)
      layouts/
      components/         static Astro components
        ui/               vendored shadcn/ui components (Base UI)
        person/           the person shell's per-section partials
      features/<area>/    one product area's islands, hooks, pure helpers
      islands/
        core/             the island kit (mountIsland, IslandRoot, forms, API)
        <island>/         islands not yet filed under an area
      lib/                cross-cutting non-UI helpers only
      styles/
      testing/            the web suites' shared test support

packages/
  backend/
    shared-kernel/        pure contracts every unit may import
    platform/
      composition.ts      the shared composition context type
      postgres/           session, transactions, rows, errors, workspace scope
      telemetry/          the JSON stdout logger adapter
    modules/
      <module-id>/
        domain/
        application/
        ports/
        adapters/
          postgres/       plus other adapter families where needed
        transport/
          http/
            routes.ts
        composition.ts
        public.ts
    read-models/
      <read-model-id>/
        application/
        ports/            optional: the repository port, as `search` keeps it
        adapters/
          postgres/
        composition.ts
        public.ts
    testing/              backend test support (assert, fixtures, fakes)
  contracts/
    routes/               route descriptors, one file per area
    schemas/              pure Zod schemas the web may import
    client/               source of the generated client
    openapi/              checked-in internal and bearer-only external OpenAPI
    generated/            generated client and API types
    tools/                the MCP tool catalog: defineTool, one file per area
    registry.ts           defineRoute and the route registry
  http-kit/               shared HTTP machinery for module routes
  mcp-kit/                the MCP endpoint over the token API (ADR 0009)

gateway/                  nginx configuration for the public entry point

tests/
  integration/            PostgreSQL suites (`<area>_postgres_test.ts`)
  support/                integration support (database, api, fixtures)
  e2e/                    Playwright specs (`<feature>.<FLOW-ID>.spec.ts`)
    support/              E2E fixtures, mail, sign-in, page objects

tools/
  tasks/                  manifest.ts, run.ts, manifest_test.ts
  architecture/           check_boundaries.ts, its baseline and suite, and the
                          remaining ticket-named contract suites
  contracts/              OpenAPI and client generator
  schema/                 canonical schema harness
  migrations/             migration runner
  operations/             private-production preflight, probe, recovery
  product/                catalog and flow-traceability contract suites
  performance/
  *.ts                    E2E launcher, dev launcher, PostgreSQL gate, and
                          repository contract suites (gateway, pipeline,
                          configuration, web build output, source hygiene)
```

Every module in `module-boundaries.yaml` except the optional `billing` exists.
`identity` serves no HTTP of its own, so it has no `transport/`; `operations`
has only adapters, `composition.ts`, and `public.ts`, because it has no
application layer yet. Read models carry no `domain/`, `ports/`, or
`transport/`.

Directories are created only when a real implementation needs them. Empty module
scaffolds are forbidden because they create apparent architecture without
executable boundaries. No `packages/backend/bootstrap/`, `tests/fixtures/`, or
`tools/workflows/` directory exists: composition lives in the roots and each
unit's `composition.ts`, shared fixtures live in the support folders above, and
CI lives in `.github/workflows/ci.yml` and `lefthook.yml`.

## Entry Points

- `apps/api/main.ts` and `apps/worker/main.ts` are executable entry points.
- Their adjacent `composition.ts` files are composition roots. The declared
  roots are the list in `module-boundaries.yaml`, which also names the
  private-production preflight. Outside tests, only those roots and each unit's
  own `composition.ts` instantiate concrete adapters.
- Each backend module exposes exactly one code-level public entry point:
  `packages/backend/modules/<module-id>/public.ts`. It carries types, use-case
  factories, and pure helpers; it never re-exports a value from `adapters/`.
- A module that owns adapters also has
  `packages/backend/modules/<module-id>/composition.ts`. It exports
  `compose<Module>(shared, ports)`, where `shared` is the one
  `SharedComposition` context typed in
  `packages/backend/platform/composition.ts` and `ports` are the facades and
  ports of other modules the root hands it. It builds that module's adapters and
  returns the module's facades and outbound ports, and only a declared
  composition root may import it. Every module and read model on disk has one.
- A module that serves HTTP has
  `packages/backend/modules/<module-id>/transport/http/routes.ts`. It exports
  the module's route factories and their service types, and it is the one
  transport file a declared composition root imports to mount them. Nothing else
  imports another module's `transport/`.
- Read models expose their own public entry point and remain query-only. One
  with adapters composes them the same way.
- `apps/api` holds only the composition root, its entry points, the
  configuration it reads, and the cross-cutting wiring no single module owns
  (the personalization router and the authentication response equalizer); the
  routes live in their modules and the shared HTTP machinery lives in
  `packages/http-kit`.
- `apps/web` consumes generated contracts. It never imports `packages/backend`.
  Besides the generated client it may import `packages/contracts/schemas` (the
  `contracts-schemas` token in `module-boundaries.yaml`), the pure Zod schemas
  an island's form validates with; `tools/architecture/check_boundaries.ts`
  refuses the route descriptors, the client internals, and the HTTP kit. Public
  documentation also consumes the generated `openapi/external.json` through the
  narrow `contracts-external-openapi` token at build time. The full internal
  OpenAPI document remains outside the frontend import surface.
- Per [ADR 0006](decisions/0006-ui-stack-shadcn-react-islands.md),
  `apps/web/components.json` configures the shadcn CLI,
  `apps/web/src/components/ui/` holds the vendored source-owned shadcn/ui
  components, `apps/web/src/islands/` holds the hydrated React islands, and
  `apps/web/src/islands/core/` is the island kit GAP-026 builds. A section of a
  static shell becomes an island through that kit's `mountIsland`. Since GAP-033
  `apps/web/src/lib` holds only non-UI helpers, and no production module outside
  `components/ui/` builds DOM with `document.createElement`: public pages render
  static Astro markup whose scripts only query, toggle attributes, set text, and
  clone `<template>` content.
- The person workspace renders from one section registry,
  `apps/web/src/features/person/sections.ts` (GAP-028): pure data the static
  shell, the section navigation, and `tools/gateway_contract_test.ts` all read.
  `features/person/section-mounts.ts` names each section's one owner, always an
  island since GAP-033; `apps/web/src/components/person/` holds the shell's
  per-section Astro partials.
- `apps/web/src/features/<area>/` holds one product area's islands, hooks, and
  pure helpers, each migrated surface in its own subfolder beside the area's
  shared registry and summaries (GAP-029: `features/person/facts/` holds the
  seven profile fact islands, the `FactEditor` they share, and their pure record
  helpers). `apps/web/src/islands/` keeps the island kit and the islands not yet
  filed under an area, and `apps/web/src/lib/` keeps cross-cutting non-UI
  helpers (time presentation, workspace context, routing and destinations, the
  unsaved-changes guard, early submission).
- `apps/web/src/testing/` is the web suites' one shared test support (GAP-030):
  `render.tsx` mounts and renders islands and tears them down after each test,
  `api.ts` stubs `fetch` by route (`stubApi`, `jsonResponse`,
  `problemResponse`), `fixtures.ts` builds contract-typed people, profiles,
  sessions, and preferences, and `a11y.ts` runs axe-core's structural rules.
  Like a `.test-helper.ts`, it is neither production code nor measured by
  coverage.

Tests may import private code only when testing that exact module. A test for
one module may not use a private import from another module as a convenience.

## Layer Contents

### Shared kernel

`packages/backend/shared-kernel/` holds the pure contracts every layer may
import and that import nothing outside the kernel: the clock, identifiers,
results and failures, partial dates, pagination cursors, validation helpers, the
transaction runner, the audit event recorder contract, and the `Logger` port
with its closed telemetry event catalogue. It has no I/O and no generic
repository, and its coverage set carries a 95% threshold.

### Platform

`packages/backend/platform/` holds infrastructure shared by adapters and
composition roots: the shared composition context, the fail-closed `APP_ENV`
resolver, the PostgreSQL session, transaction, row, error, timestamp,
workspace-scope, display-name, reference-counter, and lifecycle-impact helpers
under `postgres/`, and the JSON stdout logger with its redaction under
`telemetry/`. Domain, application, and ports never import it.

### Domain

Entities, value objects, invariants, pure policies, domain errors, and domain
events. Domain code has no framework, runtime, I/O, environment, wall-clock, or
random-number dependency.

### Application

Commands, queries, use cases, authorization policy, transaction boundaries, and
coordination through ports or another module's public facade. Public use-case
input and output types are explicit.

### Ports

Capability-specific interfaces owned by their consumer. Examples are
`PeopleRepository`, `ObjectStorage`, `ReminderDeliveryProvider`, and the
kernel's `Clock`; a generic repository base class is forbidden.

### Adapters

PostgreSQL queries and external service implementations. An adapter never
becomes a public module API. SQL writes live with the module that owns the table
in `module-boundaries.yaml`.

### Transport

Hono routes, Zod request/response schemas, cookies, status codes, OpenAPI
annotations, and mapping to RFC 9457 problems. Transport code calls application
use cases and does not contain business decisions.

A module's `transport/` imports its own `public.ts`, `application/`, and
`transport/`, the shared kernel, the facades of modules it declares, the facade
of a read model that names the module among its sources, `packages/contracts`,
`packages/http-kit`, Hono, and Zod. It never imports its own `adapters/`,
`domain/`, `ports/`, or `composition.ts`, the platform, or an app. Read models
carry no `transport/`: the module whose data a projection reads serves its
routes beside its writes, through the read model's facade.

### The HTTP kit

`packages/http-kit/` is what every module's routes share: mounting a contract
descriptor, the session middleware, problem responses and failure tables,
cookies, the origin and CORS checks, body limits, request identifiers, request
logging, secure headers, downloads, the health probe, and the browser security
policy shape. It depends on Hono, Zod, the shared kernel, `packages/contracts`,
and the session types and actor admission on the workspaces facade. It never
depends on an app.

### The MCP kit

`packages/mcp-kit/` serves `POST /api/v1/mcp` (ADR 0009): it authenticates the
personal token, builds a per-request MCP server holding the tools of
`packages/contracts/tools/` that the token's scopes allow, turns each tool call
into an in-process request to the tool's own route, and turns the route's answer
into the tool result. It depends on `packages/contracts`, `packages/http-kit`,
Hono, Zod, and `@modelcontextprotocol/server`, the one place that library is
imported. Only `apps/api/composition.ts` mounts it; no module, read model, or
`apps/web` imports it. The tool catalog under `packages/contracts/tools/` is
contract data importing only the contracts and Zod.
`tools/architecture/check_boundaries.ts` enforces both.

### Read models

Named query-only compositions for person profile, Today, directories, reports,
and audit views. Their cross-module access is allowlisted in
[`module-boundaries.yaml`](module-boundaries.yaml).

## Import Names

The backend, contracts, tools, and tests define no import aliases; every import
is a relative path, so an illegal import is always visible in the path itself.
The one alias is `@/`, which `apps/web/tsconfig.json`, the Astro Vite
configuration, and `vitest.config.ts` map to `apps/web/src/` for the vendored
shadcn/ui components and the islands that import them; it never leaves
`apps/web`. Cross-module imports must name the target module's `public.ts`;
paths into `domain`, `application`, `ports`, `adapters`, or `transport` of
another module are always illegal, apart from a declared composition root
importing a unit's `composition.ts` or `transport/http/routes.ts`.
`tools/architecture/check_boundaries.ts` resolves every relative import and
enforces these rules.

## Generated And Canonical Files

- Generated database types live in
  `packages/backend/platform/postgres/generated/database.ts` and are never
  edited by hand. `tools/tasks/run.ts schema-types` derives them from a database
  migrated to the canonical DDL, and `test:integration` fails on drift. Adapters
  may import them; application, domain, and ports never do.
- `deno task contracts:generate` writes
  `packages/contracts/openapi/openapi.json`, `openapi/external.json`, and
  `packages/contracts/generated/` (`api-types.ts` and `auth-client.ts`) from the
  route descriptors and `packages/contracts/client/`. They are checked in, and
  `deno task contracts:check` fails on drift. Only `apps/web` and `tests/e2e`
  consume the generated client.
- The external OpenAPI projects only bearer-enabled operations from the full
  executable contract, with bearer security and complete transitive component
  references. `/docs/api` renders that artifact at build time and prerenders its
  download at `/docs/api/openapi.json`; neither route needs credentials or page
  JavaScript. No second schema authority or endpoint inventory is maintained.
- The canonical schema bundle under `personal-crm-schema/` remains outside
  generator and formatter write targets.
- A generated-file header names its generator command and source artifact.
- Build and test output stays untracked: `apps/web/dist/`, `apps/web/.astro/`,
  `.coverage/`, and `.artifacts/`.

## Tests

Unit and adapter contract tests are colocated with the production code they
exercise (the backend placement rule is in
[`quality-gates.md`](quality-gates.md)). Every test file is reachable from
[`tools/tasks/manifest.ts`](../../tools/tasks/manifest.ts), and none has two
unit homes. PostgreSQL integration suites live in `tests/integration/` and share
`tests/support/`: `database.ts` (the pool, `truncate`, `resetDatabase`, and the
revocable-actor and membership helpers), `api.ts` (register, verify, sign in,
and workspace-scoped requests over the in-process app), and `fixtures.ts`
(people and important dates through the API). A family's own shared setup sits
beside its suites as a `<family>.test-helper.ts`. Web suites sit beside their
components as `*.test.ts(x)` and run under Vitest. Browser workflows live under
`tests/e2e` and carry IDs from
[`docs/product/user-flows.yaml`](../product/user-flows.yaml). A spec is named
`<feature>.<FLOW-ID>.spec.ts` for the primary flow it proves (for example
`reminders.PLANNING-002.spec.ts`); a spec without a flow keeps its feature name
and any other catalog ID it carries (`perf.PERF-001.spec.ts`). Each test that
proves a flow carries a `flow` annotation with its ID, and
`tools/product/flow_traceability_test.ts` fails unless every required flow's
`testRefs` name specs that carry its annotation and every annotation's spec is
among that flow's `testRefs`. Shared E2E setup lives in `tests/e2e/support/`:
the origins (`env.ts`), API fixtures (`api.ts`), Mailpit capture (`mail.ts`),
direct database access (`database.ts`), UI sign-in (`sign-in.ts`), axe scans and
the CSP report guard (`page-checks.ts`), navigation settles (`navigation.ts`,
`islands.ts`), and thin page objects for locators several specs repeat
(`shell.ts`, `directory.ts`, `profile.ts`).

No test-only barrel may expose private production internals across modules.

### The backend test support package

`packages/backend/testing/` is the one shared test-support package for the
backend and the API. It holds assertions (`assert.ts`), deterministic identities
(`fixtures.ts`), and generic test doubles (`fakes.ts`): a stopped clock,
sequential identifiers, a recording audit port, a `Map`-backed repository, mail,
and object storage.

It is bound by the same boundaries as production code, and by three more:

- Only test modules import it. No production file may, and nothing in it runs at
  service start.
- Its own files are typed against the shared kernel and against public types
  only. It never imports a unit's `domain/`, `application/`, `ports/`,
  `adapters/`, `transport/`, or `composition.ts`, and it re-exports nothing from
  them, so it cannot become the cross-module back door the rule above forbids.
  Today it imports the shared kernel's contracts and nothing else: the actor,
  mail, and object-storage shapes are declared structurally, so the package adds
  no module to a test's runtime graph.
- It carries no behaviour a single test owns. A double that needs a failure
  toggle, an assertion inside itself, or a module-specific rule stays in the
  test that needs it.

`tools/architecture/check_boundaries.ts` skips `_test.ts` files but scans every
other file here, so the second rule is enforced rather than merely stated.
