# FND-003 predecessor-lock closure amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/f04996a4-92e8-48b8-94af-e0f2b5f854ac`\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

This controller amendment was issued before RED was frozen. It clarifies AC-02,
AC-04, AC-05, and AC-06 without widening production scope.

The single frozen graph and root lockfiles must be sufficient for FND-003A,
FND-003B, and FND-003C to execute without changing a lockfile or creating a
nested lock. The RED validator therefore rejects a candidate unless it records
all of the following as exact selected and locked import edges, or records the
affected successor as prerequisite-blocked rather than proof-pending:

- the deterministic shadcn Button import closure derived from an immutable
  source identity, including `@base-ui/react` and every class, merge, and icon
  helper imported by that source;
- one exact DOM environment package for the Vitest component proof;
- `@playwright/test` specifically, not an ambiguous Playwright package alias;
- the exact official Playwright image tag plus OCI index digest and its required
  Linux amd64 and arm64 child manifests; and
- every direct/import edge needed by the already declared Hono/Zod,
  Kysely/Postgres.js, Astro/React/shadcn/Vitest, and Playwright successor
  probes.

Clean-cache and offline resolution must be nontrivial: the manifests and locks
resolve this real import graph, not an empty workspace or metadata-only package.
The graph must declare exactly one root `deno.lock` and one root
`pnpm-lock.yaml`, no successor or nested lock plan, and explicit no-mutation
lock reuse by FND-003A/B/C.

The validator must carry positive and negative in-memory discrimination for
these rules before its authoritative repository assertion. A missing edge,
mutable registry inference, vague package identity, nested lock, or successor
lock mutation must fail closed. No production file, manifest, lock, pin record,
or report may be edited until this amended RED proof is frozen by the trusted
controller.
