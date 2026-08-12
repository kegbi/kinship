# FND-003: Freeze the immutable candidate runtime graph

Status: ready, round 0 (fresh RED retry pending)\
Owner: trusted top-level orchestrator\
Packet revision: 4\
Base revision: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Execution class: `ordinary`\
Depends on: FND-001S at integration revision
`fcc8663751a6b2f1efb62f744655ad68771df4ca`\
Maximum rounds: 3

Current GREEN authority: none pending a truthful round-1 RED retry.

Rejected RED attempts:

- `810afc27a0a1d1e6029ec61793ca067f00f6f40b`, validator SHA-256
  `7515751e75d4c6a7730716c7b3a19e5114b5523026de5d25014aeb3d85bc05d5`:
  package-only OCI tag grammar rejected official image tags.
- `44c71432344a0e9fca0093e7d37a8a52f8fa4fe0`, validator SHA-256
  `f62c935b9199828899f5bdef7057eb949da5de0524307c1e4197e7a4289bd970`: official
  image tags were corrected, but official timestamp precision, transitive hook
  ownership, actual lock filenames, and source-derived Button imports remained
  unrepresentable.

Both attempts and all associated evidence remain immutable history and confer no
production-write authority.

## Outcome

One dependency-free, self-tested runtime-graph validator and its exact
machine-readable inputs make the candidate Deno, Node, pnpm, frontend, backend,
test, and OCI dependency graph immutable, age-eligible, lifecycle-denied by
default, and repeatable from clean and offline caches. This pin slice does not
claim the executable compatibility behavior assigned to its named follow-ons.

## Atomic boundary

FND-02's complete clean-cache, database, frontend, browser, image, command, and
hook outcome spans independent real-dependency harnesses and open proof gates.
This first slice freezes the candidate graph and the policy that later proofs
must consume:

- FND-003A: Hono/Zod Standard Schema request/type behavior and
  Kysely/Postgres.js connection, query, transaction, rollback, and teardown on
  the pinned PostgreSQL 18 and 17 indexes.
- FND-003B: Astro check/static-first build, one React island, committed and
  hashed shadcn/Base UI source, 100% Vitest coverage, and repeated Windows
  execution.
- FND-003C: exact Playwright package/image/browser matching and Chromium smoke.
- FND-003D: truthful root-command expansion and Lefthook wiring after the
  accepted FND-12 prerequisites exist.
- FND-003E: after FND-003 integration and before DG-03, a tiny strict-TDD graph
  amendment adds one real unpublished Better Auth probe member and its exact
  age-eligible Better Auth/passkey development closure to these same root locks,
  with empty lifecycle approvals and no production entry point.
- FND-003F: before accessibility E2E/FND-11/FND-12, a strict-TDD root-lock
  amendment selects `@axe-core/playwright` and `axe-core` from published
  tarballs without approving or executing the source registry's `prepare` hook.

These are follow-ons, not dependencies or unresolved decisions in this packet.
FND-003A, FND-003B, and FND-003C must consume the two root locks frozen here
without editing them or creating nested locks. A missing successor import edge
rejects this graph or prerequisite-blocks that successor; it cannot be deferred
as incidental lock drift.

## In scope

- Add one dependency-free Deno validator with in-memory discriminators and
  committed negative fixtures.
- Select exact versions at one freshly verified UTC proof timestamp under the
  accepted 72-hour policy; record publication, integrity, provenance,
  compatibility, exclusion, and upgrade evidence.
- Commit exact root Deno/pnpm manifests, workspace metadata, locks, Corepack
  descriptor integrity, and explicit deny-by-default lifecycle policies.
- Lock the nontrivial backend/frontend/test closure required by FND-003A/B/C,
  including the immutable shadcn Button source's `@base-ui/react`, class, merge,
  and icon helpers, one exact Vitest DOM environment, and `@playwright/test`
  specifically, plus current compatible ESLint, `eslint-plugin-astro` and its
  transitive Astro parser/accessibility closure, `eslint-plugin-jsx-a11y`,
  `@typescript-eslint/parser`, and the official `eslint-plugin-react-hooks`
  required before FND-003D can wire truthful checks.
- Resolve and repeat the graph in disposable clean and offline/cached-only
  environments without changing either lock hash or executing a lifecycle
  script.
- Pin and inspect the selected Deno, Node, Playwright, PostgreSQL 18, and
  PostgreSQL 17 OCI indexes with separate runnable amd64/arm64 and attestation
  records.
- Create only non-empty, tool-owned fixture members under
  `tools/runtime/FND-003/` when the proof genuinely needs them.

## Out of scope

- Runtime behavior claimed by FND-003A, FND-003B, FND-003C, or FND-003D.
- Mutable shadcn registry payload or generated component acceptance.
- Better Auth or passkey packages in this graph; their probe-only root-lock
  amendment belongs to FND-003E and the current time-sensitive version snapshot
  is not a pin.
- `@axe-core/playwright` or `axe-core`; FND-003F selects them before
  accessibility E2E without retaining a source-only `prepare` hook.
- Lefthook, new or changed root task definitions, hooks, CI, applications,
  packages, E2E scaffold, production Compose, Dockerfiles, migrations, Atlas or
  another migration runner/comparator, auth, Better Auth, Redis, queues,
  modules, or business behavior.
- Architecture/product/schema/catalog/control-path changes, including the
  synchronized `personal-crm-schema/v1` bundle and accepted ticket packets.
- FND-002, PRODUCT-001, or WORKFLOW-001 as dependencies.
- Push, deploy, main merge, integration, or `integration.md`.

## Accepted contracts

- `AGENTS.md#mandatory-change-method`
- `docs/development/autonomous-delivery.md#red-green-and-refactor-rules`
- `docs/development/autonomous-delivery.md#command-truth`
- `docs/architecture/decisions/0001-astro-personalized-rendering.md#decision`
- `docs/architecture/technology-baseline.md#accepted-constraints`
- `docs/architecture/technology-baseline.md#accepted-backend-stack`
- `docs/architecture/technology-baseline.md#deno-responsibilities`
- `docs/architecture/technology-baseline.md#dependency-and-runtime-policy`
- `docs/architecture/repository-layout.md#status`
- `docs/architecture/repository-layout.md#canonical-shape`
- `docs/architecture/quality-gates.md#test-first-change-contract`
- `docs/architecture/quality-gates.md#canonical-commands`
- `docs/architecture/quality-gates.md#deno-dependency-and-security-gates`
- `docs/architecture/compose-contract.md#image-and-supply-chain-policy`
- `docs/planning/roadmap.md#fnd-02-runtime-and-dependency-pins` (proposed
  execution direction explicitly bounded and approved by the user)
- `docs/planning/research.md#sp-01-pinned-runtime-and-dependency-matrix`
- `docs/planning/research.md#version-selection-checklist`
- `docs/planning/quality-and-operations.md#current-executable-commands`
- `docs/planning/quality-and-operations.md#image-requirements`
- `docs/planning/quality-and-operations.md#stage-1-reproducibility-and-static-contracts`
- `docs/planning/tickets/FND-001S/integration.md`

## Acceptance criteria and RED proof

- AC-01: the dependency-free validator's controls pass while it rejects every
  mutable, stale, incompatible, lock-drifting, lifecycle-unsafe, and invalid OCI
  graph named in `ticket.json`.
- AC-02: one timestamped, exact, current, age-eligible graph covers the selected
  runtime, package-manager, backend, frontend, test, browser, and shadcn CLI
  candidates and the full immutable Button/DOM/browser-test import closure with
  official evidence and newer-version exclusions.
- AC-03: Corepack integrity/signatures and pnpm/Deno lifecycle allowlists are
  exact and deny by default; the transitive install-hook inventory justifies any
  non-empty exception.
- AC-04: fresh-cache frozen resolution and cached-only/offline repeat preserve
  both single-root lock hashes over that real import graph, create no nested
  locks, and execute no lifecycle or startup install; A/B/C reuse those locks
  without mutation.
- AC-05: all five OCI references are exact indexes with separate required Linux
  amd64/arm64 child and attestation classification, and the official Playwright
  image version matches `@playwright/test` exactly.
- AC-06: the graph keeps all executable behavior proof-pending under the four
  named follow-ons, declares no-mutation predecessor-lock reuse, and excludes
  early Lefthook or mutable shadcn payloads.

The criterion-specific negative cases are authoritative in `ticket.json`. The
one initial RED command is:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json,docs/validation/runtime-graph-fnd003.md tools/runtime/FND-003/runtime_graph_contract_test.ts
```

Every harness control must pass. Against the unchanged input base, only the
authoritative repository assertion may fail, specifically because the manifests,
locks, pin record, and provenance snapshot do not exist. Network, Docker, Node,
Corepack, pnpm, registry, cache, permission, syntax, type, or fixture failures
are invalid RED.

## Required gates

- The focused FND-003 command above.
- Direct format, lint, type, and exact 100% line/branch/function coverage checks
  for the frozen validator implementation.
- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task test:schema:matrix`
- `deno task ticket:validate docs/planning/tickets/FND-003` from the canonical
  repository root after each controller metadata commit.

No new root task is authorized. Focused package, lock, OCI, and offline probes
remain direct commands until FND-003D adds truthful guarded wiring.

## Risks

The exact age-boundary, Corepack, lifecycle, compatibility-overstatement, OCI,
mutable-registry, clean-cache, shared-root-write, and evidence-redaction risks
are recorded in `ticket.json` and are mandatory review inputs.

## Unresolved decisions

None. Proofs that are not safe in this atomic slice have explicit follow-on
ownership and cannot be marked complete here.
