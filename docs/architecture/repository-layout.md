# Repository Layout Contract

## Status

Accepted before scaffolding. Exact dependencies are intentionally absent. The
first executable scaffold may add files inside this shape but may not weaken its
public/private boundaries without an architecture decision.

## Canonical Shape

```text
apps/
  api/
    main.ts
    composition.ts
  worker/
    main.ts
    composition.ts
  web/
    components.json
    src/
      pages/
      layouts/
      components/
        ui/
        person/
      features/
        person/
          facts/
      islands/
        core/
      lib/
    public/

packages/
  backend/
    bootstrap/
    shared-kernel/
    platform/
    modules/
      <module-id>/
        domain/
        application/
        ports/
        adapters/
          postgres/
        transport/
          http/
        composition.ts
        public.ts
    read-models/
      <read-model-id>/
    testing/
  contracts/
    openapi/
    generated/
  http-kit/

tests/
  e2e/
  fixtures/
  support/

tools/
  architecture/
  contracts/
  schema/
  workflows/
```

Directories are created only when a real implementation needs them. Empty module
scaffolds are forbidden because they create apparent architecture without
executable boundaries.

## Entry Points

- `apps/api/main.ts` and `apps/worker/main.ts` are executable entry points.
- Their adjacent `composition.ts` files are composition roots. The declared
  roots are the list in `module-boundaries.yaml`, and they are the only files
  that may instantiate concrete adapters.
- Each backend module exposes exactly one code-level public entry point:
  `packages/backend/modules/<module-id>/public.ts`. It carries types, use-case
  factories, and pure helpers; it never re-exports a value from `adapters/`.
- A module that owns adapters also has
  `packages/backend/modules/<module-id>/composition.ts`. It builds that module's
  adapters and returns the module's facades and outbound ports, and only a
  declared composition root may import it.
- A module that serves HTTP has
  `packages/backend/modules/<module-id>/transport/http/routes.ts`. It exports
  the module's route factories and their service types, and it is the one
  transport file a declared composition root imports to mount them. Nothing else
  imports another module's `transport/`.
- Read models expose their own public entry point and remain query-only. One
  with adapters composes them the same way.
- `apps/api` holds only the composition root, its entry points, and the
  configuration it reads; the routes live in their modules and the shared HTTP
  machinery lives in `packages/http-kit`.
- `apps/web` consumes generated contracts. It never imports `packages/backend`.
  Besides the generated client it may import `packages/contracts/schemas` (the
  `contracts-schemas` token in `module-boundaries.yaml`), the pure Zod schemas
  an island's form validates with; `tools/architecture/check_boundaries.ts`
  refuses the route descriptors, the client internals, and the HTTP kit.
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
`PersonRepository`, `Clock`, `FileObjectStore`, and `ReminderDelivery`; a
generic repository base class is forbidden.

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
and the session types on the workspaces facade. It never depends on an app.

### Read models

Named query-only compositions for person profile, Today, directories, reports,
and audit views. Their cross-module access is allowlisted in
[`module-boundaries.yaml`](module-boundaries.yaml).

## Import Names

The scaffold should define stable aliases without using aliases to conceal an
illegal import:

```text
@app/          apps and composition roots
@backend/      backend package root
@contracts/    OpenAPI and generated process contracts
@test/         shared test fixtures and harnesses
```

Inside a module, relative imports are preferred. Cross-module imports must name
the target module's `public.ts`; paths into `domain`, `application`, `ports`,
`adapters`, or `transport` of another module are always illegal.

## Generated And Canonical Files

- Generated database types live under an explicit generated path and are never
  edited by hand.
- Generated API client/types live in `packages/contracts/generated` and may be
  imported by the web application.
- OpenAPI artifacts are checked in and checked for drift.
- The canonical schema bundle remains outside generator and formatter write
  targets.
- A generated-file header names its generator command and source artifact.

## Tests

Unit and adapter contract tests may be colocated with the production code they
exercise. Cross-module integration tests live at the narrowest shared boundary.
Browser workflows live under `tests/e2e` and carry IDs from
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
