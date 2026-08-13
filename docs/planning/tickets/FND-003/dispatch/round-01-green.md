# FND-003 GREEN continuation, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Implementer run ID:
`FND-003/implementer/r1/f04996a4-92e8-48b8-94af-e0f2b5f854ac`\
Ticket revision: 2\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

Resume the same clean implementer context that produced the authoritative RED.
Read the revised packet, state, this dispatch, and the predecessor-lock closure
amendment before editing. Do not infer authority from conversation history.

## Frozen RED boundary

The trusted controller froze the exact test-only revision
`810afc27a0a1d1e6029ec61793ca067f00f6f40b`.

- Validator: `tools/runtime/FND-003/runtime_graph_contract_test.ts`
- Validator SHA-256:
  `7515751e75d4c6a7730716c7b3a19e5114b5523026de5d25014aeb3d85bc05d5`
- Authoritative RED log:
  `docs/planning/tickets/FND-003/evidence/round-01-red-retry.log`
- Authoritative RED log SHA-256:
  `2f7ec4618ae4ee0359f99e8a16ad93804053338a4473d40e9ae68ed56c7f3431`
- Preserved failed-attempt RED log SHA-256:
  `21f9453d8dee94c5a9a2bb6796a009bdc60136d6920c2bfb8a6a4bfd8189e0e4`

Verify these bytes before GREEN and do not edit, regenerate, format, weaken,
skip, or replace the frozen validator or either RED log. Stop if any digest or
revision differs.

## Exact GREEN authority

Select the smallest graph that makes the frozen validator green. Query official
registries again at the actual selection timestamp; the prior research snapshot
and prompt candidates are not selection authority. Choose only the newest
compatible stable release that is at least 72 hours old at that timestamp, and
record every newer exclusion with evidence. In particular, re-evaluate pnpm at
the actual timestamp because its eligibility boundary changes during this round.

Production writes are limited to:

- `.npmrc`, `deno.json`, `deno.lock`, `package.json`, `pnpm-workspace.yaml`, and
  `pnpm-lock.yaml`;
- non-empty proof assets under `tools/runtime/FND-003/` only if genuinely
  required and without changing the frozen validator; and
- `docs/validation/runtime-graph-fnd003.json` plus its synchronized Markdown
  report.

Evidence logs may be added only under this ticket directory. Do not add or
change root tasks, Lefthook, application/package/E2E scaffolds, production
Compose, Dockerfiles, catalogs, schema, auth, migrations, Better Auth, Redis, or
any other excluded surface.

## Required graph closure

The Deno and pnpm graphs must resolve real imports rather than empty metadata.
Lock every exact edge required by the declared FND-003A/B/C successors:

- Hono, Zod, the selected Standard Schema adapter/spec edge, Kysely,
  `kysely-postgres-js`, and Postgres.js;
- Astro, selected Astro integrations, React and React DOM, Astro check,
  compatible TypeScript, Tailwind/Vite integration, Vite, Vitest, coverage-v8,
  and one proven exact DOM environment;
- the deterministic shadcn Button import closure from an immutable source
  identity, including `@base-ui/react` and every class, merge, and icon helper
  the frozen source imports; and
- `@playwright/test` specifically, with its version exactly matching the
  official Playwright OCI image tag.

There must be exactly one root `deno.lock` and one root `pnpm-lock.yaml`, no
nested or successor lock, and an explicit machine declaration that FND-003A,
FND-003B, and FND-003C consume both root locks without mutation. If an edge
cannot be selected safely, reject the graph and record that successor as
prerequisite-blocked; do not omit the edge or weaken the gate.

## Supply-chain and repeatability proof

- Use an exact Corepack pnpm descriptor including registry integrity;
  demonstrate `COREPACK_DEFAULT_TO_LATEST=0` with signatures enabled.
- Keep exact-save and frozen-lock behavior. Reject `dangerouslyAllowAllBuilds`.
  Inventory all transitive lifecycle hooks from the actual graph and keep pnpm's
  build allowlist and Deno `allowScripts` exactly empty unless executable
  evidence proves one minimal exception is unavoidable.
- In disposable clean cache roots or pinned containers, record exact
  Deno/Node/Corepack/pnpm identities, perform fresh-cache frozen resolution,
  repeat Deno cached-only and pnpm offline, and prove both committed lock hashes
  remain byte-identical with no lifecycle or startup install.
- Reinspect live registry metadata for exact Deno, Node, official Playwright,
  PostgreSQL 18.4, and PostgreSQL 17.10 tag-plus-index references. Record Linux
  amd64 and arm64 children separately from attestations, and distinguish the
  multi-architecture index from platform child manifests.
- Hash every committed repository input named by the machine graph and keep the
  Markdown report synchronized. Redact cache paths, credentials, cookies,
  tokens, and irrelevant host details.

## Required execution and handoff

Run the frozen focused command until it exits zero:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json tools/runtime/FND-003/runtime_graph_contract_test.ts
```

Also prove exact 100% line, branch, and function coverage for the frozen
validator without ignores, then run direct format/lint/type checks and these
unchanged root gates:

```text
deno task fmt:check
deno task lint
deno task check
deno task test:schema:matrix
```

Write concise redacted `round-01-green.log` and `round-01-refactor.log`
evidence. Return the exact changed production paths, commands, exits, lock and
artifact hashes, version-selection timestamp, lifecycle inventory, OCI proof
summary, and clean-status result. Do not commit, self-review, or advance ticket
state.
