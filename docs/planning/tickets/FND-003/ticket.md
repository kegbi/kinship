# FND-003: Freeze the immutable candidate runtime graph

Status: ready, round 0\
Owner: trusted top-level orchestrator\
Base revision: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Execution class: `ordinary`\
Depends on: FND-001S at integration revision
`fcc8663751a6b2f1efb62f744655ad68771df4ca`\
Maximum rounds: 3

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

These are follow-ons, not dependencies or unresolved decisions in this packet.

## In scope

- Add one dependency-free Deno validator with in-memory discriminators and
  committed negative fixtures.
- Select exact versions at one freshly verified UTC proof timestamp under the
  accepted 72-hour policy; record publication, integrity, provenance,
  compatibility, exclusion, and upgrade evidence.
- Commit exact root Deno/pnpm manifests, workspace metadata, locks, Corepack
  descriptor integrity, and explicit deny-by-default lifecycle policies.
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
- Lefthook, new or changed root task definitions, hooks, CI, applications,
  packages, E2E scaffold, production Compose, Dockerfiles, migrations, auth,
  Better Auth, Redis, queues, modules, or business behavior.
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
  candidates with official evidence and newer-version exclusions.
- AC-03: Corepack integrity/signatures and pnpm/Deno lifecycle allowlists are
  exact and deny by default; the transitive install-hook inventory justifies any
  non-empty exception.
- AC-04: fresh-cache frozen resolution and cached-only/offline repeat preserve
  both lock hashes and execute no lifecycle or startup install.
- AC-05: all five OCI references are exact indexes with separate required Linux
  amd64/arm64 child and attestation classification.
- AC-06: the graph keeps all executable behavior proof-pending under the four
  named follow-ons and excludes early Lefthook or mutable shadcn payloads.

The criterion-specific negative cases are authoritative in `ticket.json`. The
one initial RED command is:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json tools/runtime/FND-003/runtime_graph_contract_test.ts
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
