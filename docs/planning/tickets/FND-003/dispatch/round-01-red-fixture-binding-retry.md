# FND-003 fixture-binding RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/0af5f89f-c6d6-455b-9ee2-6a4b97216ac3`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`faa77465828ebfc1451013e42010e8d4c8ac3a32` preserves the rejected revision-14
oracle at SHA-256
`77e681e048802f792e2ee0b32bb81f667cec8ee367c3c6e3c3615855785aec5c` and its
real-tool fixtures. That attempt accepted the four demonstrated pnpm/Deno
feasibility corrections, but review found two bounded proof defects: adjacent
self-authored metadata could drift with fixture hashes, and the retained pnpm
1:N lines were not structurally parsed. Its controls-only inner RED was observed
live but not captured with a complete hash set, so it is rejected rather than
reconstructed. It has no GREEN authority. Preserve every prior attempt and
evidence byte-for-byte.

This retry authorizes only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`;
- existing files under `tools/runtime/FND-003/fixtures/real-tool/`; and
- after controller independent reproduction of the new controls-only RED,
  controller-owned
  `docs/planning/tickets/FND-003/evidence/round-01-red-fixture-binding-inner.log`.

After a controller commit freezes that controls-only RED, a separate
continuation dispatch may authorize the same implementer-owned test and fixture
paths for the minimal correction. Only after fresh zero-finding audits may the
controller authorize
`docs/planning/tickets/FND-003/evidence/round-01-red-fixture-binding-retry.log`
and GREEN. No production manifest, root lock, graph, report, provenance, other
packet, state, prior evidence, main merge, rebase, push, deploy, or integration
write is authorized now.

## Strict controls-only RED and hard stop

Start from the exact rejected revision-14 bytes. Add only the smallest
regression controls and, if needed, mutation-only fixture copies that prove
these three defects while every prior control remains green:

1. Mutate both retained 1:N lines together with the adjacent metadata hash and
   reject malformed, truncated, wrong-base, unbalanced-peer-suffix, and
   duplicate peer-context identities. The failure must come from structural
   snapshot validation, not a stale hash.
2. Mutate every retained metadata field and add unknown inner fields. A retained
   field must either be independently derived from committed bytes and rejected
   on drift, or be explicitly identified for removal because the committed
   fixture cannot substantiate it.
3. Mutate fixture content and its metadata hash together for the pnpm settings,
   React-type importer, 1:N snapshot, and Deno-lock boundaries; each mutation
   must fail at its structural or exact-value binding rather than pass because
   two self-authored values agree.

Run the narrow controls-only command and stop before changing validators,
metadata schemas, fixture contents, or policy behavior. Report the exact
command, exit, intended assertions, complete test and fixture SHA-256 set,
passing prior controls, dirty-path list, and empty production-write list. The
controller must independently reproduce the same failure, write the authorized
inner-RED log, and commit the exact controls-only bytes before implementation
may continue.

## Minimal correction after separate continuation authority

Do not implement this section during the initial dispatch. Once the
controls-only RED is frozen, the continuation is limited to:

- parse each retained pnpm line as an exact v9 snapshot identity with a balanced
  peer suffix, require the same exact package base, and require two distinct
  peer contexts while continuing to accept a truthful production graph with zero
  1:N bases;
- validate exact inner fixture schemas and hard-bind committed fixture SHA-256
  values inside the whole-source-locked validator;
- parse and bind the React-type importer records and the full seven-root Deno v5
  lock structure, including exact specifiers, node identities, and
  peer-qualified resolutions; and
- remove metadata observations that the committed slices cannot independently
  substantiate instead of adding a full pnpm lock or new evidence surface.

Preserve the four accepted revision-14 policy corrections and every earlier
oracle discriminator. Do not add a package, parser feature unrelated to these
fixtures, policy, cache field, runtime behavior claim, full pnpm lock, or new
acceptance surface.

## Later freeze condition

After continuation, all fixture-binding negatives and every prior control must
pass. The focused command must retain one repository assertion failing only for
the same six absent GREEN artifacts. Direct format/lint/check, byte-identical
exact 100 percent coverage without ignores, root gates, PostgreSQL 18.4 and
17.10, and the schema-v2 checkpoint must pass. A fresh six-lens review and a
fresh real-format mutation audit must both return zero findings against the same
exact test and fixture hashes before final RED evidence or GREEN authority.
