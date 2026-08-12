# FND-003 fixture-binding RED continuation, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized implementer run ID:
`FND-003/implementer/r1/0af5f89f-c6d6-455b-9ee2-6a4b97216ac3`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`25b1c3387c0dc9f665aeb37cb2db0091925c739e` freezes the independently reproduced
controls-only inner RED authorized by
`dispatch/round-01-red-fixture-binding-retry.md`:

- test SHA-256:
  `cffbb155dc712daf0fd258b8e1c1d13718a39b194243d42ac6d3ab3c1f8f542e`;
- embedded canonical whole-source digest:
  `c722266aed23f50d9ac749a71dfe9db7aed39bd0de668ba8d174dc7f96d990c0`;
- controller evidence SHA-256:
  `e4a90fd6f6506b61825a26998337d58b0ab38b244dbf3ed4a3b7dfab0517a15d`;
- ten prior controls passed; the new fixture-binding control failed only for the
  intended missing structural and exact-value bindings; and the repository
  assertion failed only for the same six absent GREEN artifacts.

A read-only controller scope audit confirmed that the frozen diff contains only
one mutation worker harness, one controls-only test, and the required embedded
whole-source digest refresh. The prior positive validator, fixture bytes,
metadata schema, policy, and production files are unchanged. This frozen commit
is the sole test-first authority for the correction below and must remain
immutable.

## Authorized correction

Continue in the same implementer context and edit only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`; and
- existing files under `tools/runtime/FND-003/fixtures/real-tool/` only if
  trimming now-unsubstantiated metadata fields requires changing
  `metadata.json`.

Make the smallest changes that turn the frozen fixture-binding control green:

1. Parse every retained 1:N line as an exact pnpm v9 snapshot identity using the
   existing snapshot identity grammar. Require balanced peer suffixes, the exact
   recorded base package, and two distinct peer contexts. Preserve acceptance of
   a truthful production graph with zero 1:N bases.
2. Make the real-tool metadata exact-keyed. Retain only fields independently
   derived from the committed fixture bytes or hard-bound to reviewed immutable
   constants inside the whole-source-locked validator. Remove
   host/tool/full-lock cardinality or lifecycle observations that the slices
   cannot independently substantiate; do not add a full pnpm lock or new
   evidence surface.
3. Parse and exactly bind the pnpm settings slice, both React-type importer
   specifier/resolution records, and the full seven-root Deno v5 lock structure,
   including exact specifiers, node identities, and peer-qualified resolutions,
   so content-plus-adjacent-hash drift fails for structure or exact value.

Preserve the four accepted revision-14 corrections, every prior discriminator,
the existing fixtures unless the exact metadata trim requires its one JSON
change, and the whole-source lock. Do not add packages, roots, policies, cache
fields, parser features unrelated to these committed shapes, behavior claims,
full locks, or acceptance surface. Do not touch production manifests, root
locks, graph/report/provenance, packet/state/events, prior evidence, .git, main,
or integration artifacts.

## Required proof and hard stop

Run the exact focused command. All eleven controls must pass and the repository
assertion must be the sole failure for the same six absent GREEN artifacts. Run
direct format/lint/check, byte-identical 100 percent line/branch/function
coverage, root format/lint/check, the PostgreSQL 18.4 and 17.10 matrix, the pure
schema-v2 bundle, and the expected canonical pre-candidate checkpoint. Report
the exact test and fixture hashes, embedded digest, commands/exits, dirty paths,
and empty production list.

Then stop without writing final evidence or starting production GREEN. The
controller will dispatch a fresh six-lens reviewer and an independent
real-format mutation auditor against those exact bytes. Only controller-declared
zero findings may authorize the final RED log and production GREEN.
