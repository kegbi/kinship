# FND-003 initial RED dispatch, round 1

Authoritative input base: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Required next state: RED, then stop\
Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Implementer run ID:
`FND-003/implementer/r1/a5eca5bd-4ec8-4aad-be03-e683b901d72d`\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

Read only `AGENTS.md`, this ticket's `ticket.md`, `ticket.json`, `state.json`,
this dispatch, and the accepted contract references declared by the ticket.
FND-001S is the sole dependency and is pinned at its recorded integration
revision. Do not treat accepted-only FND-002 or PRODUCT-001, or the disjoint
WORKFLOW-001 rework, as input authority.

## RED-only write authority

Before any manifest, lock, runtime pin, validation report, configuration, or
other production edit, add only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`;
- deterministic negative fixtures under `tools/runtime/FND-003/fixtures/` only
  when the test genuinely reads them; and
- `docs/planning/tickets/FND-003/evidence/round-01-red.log`.

The single test/check surface must use Deno built-ins only, contain its own
parsing and discrimination helpers, and avoid creating `deno.lock` or any cache,
coverage, generated, package-manager, or install output in the repository.

## Required controls

Before the authoritative repository assertion, exercise passing positive
controls and failing negative controls for every AC-01 category, including:

1. exact versions versus ranges, tags, aliases, and `latest`;
2. the 72-hour cutoff, selection timestamp, newest-eligible rule, and a release
   crossing the cutoff;
3. exact manifest/lock membership, resolution, integrity, and unchanged-hash
   declarations;
4. Corepack descriptor integrity, `COREPACK_DEFAULT_TO_LATEST=0`, enabled
   signature verification, and rejection of unchecked integrity update paths;
5. exact pnpm and Deno lifecycle allowlists, rejection of
   `dangerouslyAllowAllBuilds`, and complete transitive hook inventory;
6. Playwright package/image version equality;
7. Astro/Astro-check/TypeScript, Vite/Vitest, Hono/Standard Schema, and
   Kysely/dialect/Postgres.js graph compatibility, including explicit rejection
   of TypeScript 7 with the selected Astro check and Kysely without
   `kysely-postgres-js`;
8. shadcn CLI package integrity/provenance with no mutable registry invocation;
9. OCI tag-plus-digest shape, index media type, required Linux amd64 and arm64
   children, child/attestation separation, duplicate/missing platform handling,
   and rejection of a platform child digest used as the index; and
10. proof-status/follow-on mapping that cannot mark deferred runtime behavior
    complete or include early Lefthook or mutable generated shadcn payloads.

Fixtures must be small, synthetic, deterministic, and free of live registry or
host-specific values. Missing, malformed, duplicated, oversized, ambiguous, and
unknown-field shapes must fail closed where applicable. The test must not make a
network, Docker, Node, Corepack, pnpm, Git, environment-secret, or wall-clock
call.

## Authoritative RED assertion

After every control passes, inspect only the ticket-declared repository inputs
and fail with one focused aggregate explaining that the exact root manifests,
locks, machine graph, and hashed provenance evidence are absent. Run exactly:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json tools/runtime/FND-003/runtime_graph_contract_test.ts
```

The command must exit non-zero only at that repository assertion. An error from
an absent optional path must be converted into the intended assertion, not an
uncaught filesystem failure. Network, Docker, package-manager, cache,
permission, fixture, syntax, lint, type, or timeout failure is invalid RED.

Also run direct formatting, linting, type checking, and coverage for the exact
check and fixtures. Coverage uses a disposable directory outside the repository
and must prove exact 100% lines, branches, and functions for the validator
implementation even though its one repository assertion remains intentionally
RED. Do not add or change a root task.

Record exact commands, exits, passing-control summary, intended assertion,
concise redacted output, and an empty production-file list in the RED log. Do
not record absolute paths, registry credentials, tokens, cookies, connection
strings, or cache locations.

Stop without committing or beginning GREEN. Return the exact changed check and
fixture paths, RED log path, command evidence, and confirmation that every
manifest, lock, pin/report, accepted contract, schema, application/product
catalog, and protected control path remains byte-identical to the input base.
The trusted controller will reproduce the proof, freeze the test/check-only RED
revision, compute every changed check/fixture SHA-256, and issue the GREEN
continuation for this same round and implementer identity.

## Boundaries preserved

- No root manifest, lock, `.npmrc`, pin record, or validation report edit in
  RED.
- No live package/version decision is frozen in RED; package research happens
  only after controller authorization for GREEN.
- No app/package/E2E scaffold, production Compose, Dockerfile, schema, auth,
  migration, queue, Redis, Better Auth, module, catalog, root-task, hook, CI,
  `.agents`, `.codex`, or `.git` change.
- No mutable shadcn registry request or payload.
- No claim that FND-003A/B/C/D behavior is implemented or proven.
- Do not inspect or mutate Git metadata; the trusted controller alone freezes
  and commits revisions.
